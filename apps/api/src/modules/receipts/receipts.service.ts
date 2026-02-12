import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException
} from '@nestjs/common';
import {
  BuilderIntegrationsSchema,
  ReceiptOfficialItemEnum,
  type BuilderReceiptStockRule,
  type ReceiptOfficialItem
} from '@querobroapp/shared';
import { z } from 'zod';
import { parseWithSchema } from '../../common/validation.js';
import { BuilderService } from '../builder/builder.service.js';
import { InventoryService } from '../inventory/inventory.service.js';

const officialItems = [...ReceiptOfficialItemEnum.options];

const parseReceiptInputSchema = z
  .object({
    imageBase64: z.string().trim().min(1).optional(),
    imageUrl: z.string().trim().url().optional(),
    mimeType: z.string().trim().min(1).optional().default('image/jpeg'),
    providerHint: z.string().trim().min(1).max(120).optional()
  })
  .refine((data) => Boolean(data.imageBase64 || data.imageUrl), {
    message: 'Informe imageBase64 ou imageUrl para analisar o cupom fiscal.'
  });

const parsedReceiptSchema = z.object({
  purchaseDate: z.string().trim().default(''),
  items: z
    .array(
      z.object({
        item: ReceiptOfficialItemEnum,
        quantity: z.coerce.number().positive(),
        unitPrice: z.coerce.number().positive()
      })
    )
    .default([])
});

type ParseReceiptInput = z.output<typeof parseReceiptInputSchema>;
type ParsedReceipt = z.output<typeof parsedReceiptSchema>;

type ChatCompletionMessage = {
  content?: string | Array<{ type?: string; text?: string }>;
  refusal?: string;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: ChatCompletionMessage;
  }>;
};

type ParsedReceiptItem = {
  item: ReceiptOfficialItem;
  quantity: number;
  unitPrice: number;
};

type ReceiptsRuntimeConfig = {
  shortcutsEnabled: boolean;
  receiptsPrompt: string;
  receiptsSeparator: string;
  receiptsAutoIngestEnabled: boolean;
  receiptStockRules: BuilderReceiptStockRule[];
};

type ParsedReceiptRuntime = {
  purchaseDate: string;
  items: ParsedReceiptItem[];
  lines: string[];
  runtimeConfig: ReceiptsRuntimeConfig;
};

type IngestIgnoredReason =
  | 'REGRA_DESABILITADA'
  | 'REGRA_NAO_CONFIGURADA'
  | 'ITEM_ESTOQUE_NAO_ENCONTRADO'
  | 'ITEM_NAO_INGREDIENTE'
  | 'QUANTIDADE_INVALIDA';

type InventoryLookupItem = {
  id: number;
  name: string;
  category: string;
};

@Injectable()
export class ReceiptsService {
  private readonly model = process.env.OPENAI_RECEIPTS_MODEL || 'gpt-4o-mini';
  private readonly openAiBaseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(
    /\/+$/,
    ''
  );
  private readonly receiptsApiToken = (process.env.RECEIPTS_API_TOKEN || '').trim();
  private readonly defaultSeparator = ';';

  constructor(
    @Inject(BuilderService) private readonly builderService: BuilderService,
    @Inject(InventoryService) private readonly inventoryService: InventoryService
  ) {}

  async parse(payload: unknown, token?: string) {
    const parsed = await this.parseReceiptPayload(payload, token);
    return this.toPublicParseResponse(parsed);
  }

  async ingest(payload: unknown, token?: string) {
    const parsed = await this.parseReceiptPayload(payload, token);

    if (!parsed.runtimeConfig.receiptsAutoIngestEnabled) {
      throw new BadRequestException(
        'Automacao de entrada de estoque por cupom esta desabilitada no Builder > Integracoes.'
      );
    }

    const ingest = await this.applyStockIngest(
      parsed.items,
      parsed.purchaseDate,
      parsed.runtimeConfig.receiptStockRules
    );

    return {
      ...this.toPublicParseResponse(parsed),
      ingest
    };
  }

  private async parseReceiptPayload(payload: unknown, token?: string): Promise<ParsedReceiptRuntime> {
    this.ensureReceiptsToken(token);

    const input = parseWithSchema(parseReceiptInputSchema, payload) as ParseReceiptInput;
    const apiKey = process.env.OPENAI_API_KEY;
    const runtimeConfig = await this.getRuntimeConfig();

    if (!apiKey) {
      throw new BadRequestException(
        'OPENAI_API_KEY nao configurada. Defina a chave no ambiente da API para usar /receipts/parse.'
      );
    }

    if (!runtimeConfig.shortcutsEnabled) {
      throw new BadRequestException(
        'Integracao de Atalhos desabilitada no Builder. Reative em /builder > Integracoes.'
      );
    }

    const modelOutput = await this.callVisionModel(input, apiKey, runtimeConfig.receiptsPrompt);
    const extracted = parseWithSchema(parsedReceiptSchema, modelOutput) as ParsedReceipt;
    const purchaseDate = this.normalizeDate(extracted.purchaseDate);
    const items = this.normalizeItems(extracted);
    const lines = items.map((item) =>
      [
        purchaseDate,
        item.item,
        this.formatQuantity(item.quantity),
        this.formatMoney(item.unitPrice)
      ].join(runtimeConfig.receiptsSeparator)
    );

    return {
      purchaseDate,
      items,
      lines,
      runtimeConfig
    };
  }

  private toPublicParseResponse(parsed: ParsedReceiptRuntime) {
    return {
      purchaseDate: parsed.purchaseDate,
      items: parsed.items,
      lineCount: parsed.lines.length,
      lines: parsed.lines,
      clipboardText: parsed.lines.join('\n'),
      separator: parsed.runtimeConfig.receiptsSeparator,
      officialItems
    };
  }

  private ensureReceiptsToken(token?: string) {
    if (!this.receiptsApiToken) return;
    if ((token || '').trim() === this.receiptsApiToken) return;
    throw new BadRequestException(
      'Token invalido para /receipts. Envie cabecalho x-receipts-token com RECEIPTS_API_TOKEN.'
    );
  }

  private async getRuntimeConfig(): Promise<ReceiptsRuntimeConfig> {
    const defaults = BuilderIntegrationsSchema.parse({});

    try {
      const config = await this.builderService.getConfig();
      return {
        shortcutsEnabled: config.integrations.shortcutsEnabled,
        receiptsPrompt: (config.integrations.receiptsPrompt || '').trim(),
        receiptsSeparator: this.normalizeSeparator(config.integrations.receiptsSeparator),
        receiptsAutoIngestEnabled: config.integrations.receiptsAutoIngestEnabled,
        receiptStockRules: this.normalizeStockRules(config.integrations.receiptStockRules)
      };
    } catch {
      return {
        shortcutsEnabled: defaults.shortcutsEnabled,
        receiptsPrompt: defaults.receiptsPrompt,
        receiptsSeparator: this.normalizeSeparator(defaults.receiptsSeparator),
        receiptsAutoIngestEnabled: defaults.receiptsAutoIngestEnabled,
        receiptStockRules: this.normalizeStockRules(defaults.receiptStockRules)
      };
    }
  }

  private normalizeSeparator(value?: string) {
    const normalized = (value || '').trim();
    if (!normalized) return this.defaultSeparator;
    return normalized.slice(0, 4);
  }

  private normalizeStockRules(rules: BuilderReceiptStockRule[] | undefined) {
    const byOfficial = new Map<ReceiptOfficialItem, BuilderReceiptStockRule>();
    for (const rule of rules || []) {
      byOfficial.set(rule.officialItem, {
        officialItem: rule.officialItem,
        inventoryItemName: (rule.inventoryItemName || '').trim() || rule.officialItem,
        enabled: Boolean(rule.enabled),
        quantityMultiplier: this.normalizeMultiplier(rule.quantityMultiplier)
      });
    }

    return officialItems.map((officialItem) => {
      const current = byOfficial.get(officialItem as ReceiptOfficialItem);
      if (current) return current;
      return {
        officialItem: officialItem as ReceiptOfficialItem,
        inventoryItemName: officialItem,
        enabled: this.defaultRuleEnabled(officialItem as ReceiptOfficialItem),
        quantityMultiplier: 1
      };
    });
  }

  private normalizeMultiplier(value: number) {
    if (!Number.isFinite(value) || value <= 0) return 1;
    return Math.max(0.001, Math.min(100, Math.round((value + Number.EPSILON) * 1000) / 1000));
  }

  private defaultRuleEnabled(item: ReceiptOfficialItem) {
    return item !== 'SACOLA' && item !== 'CAIXA DE PLÁSTICO' && item !== 'PAPEL MANTEIGA';
  }

  private async applyStockIngest(
    parsedItems: ParsedReceiptItem[],
    purchaseDate: string,
    rules: BuilderReceiptStockRule[]
  ) {
    const rulesByOfficial = new Map<ReceiptOfficialItem, BuilderReceiptStockRule>();
    for (const rule of rules) {
      rulesByOfficial.set(rule.officialItem, rule);
    }

    const inventoryItems = (await this.inventoryService.listItems()) as InventoryLookupItem[];
    const byNormalizedName = new Map<string, InventoryLookupItem[]>();

    for (const item of inventoryItems) {
      const key = this.normalizeLookup(item.name || '');
      if (!key) continue;
      const existing = byNormalizedName.get(key) || [];
      existing.push(item);
      byNormalizedName.set(key, existing);
    }

    const appliedMovements: Array<{
      movementId: number;
      officialItem: ReceiptOfficialItem;
      inventoryItemId: number;
      inventoryItemName: string;
      quantity: number;
      unitPrice: number;
    }> = [];

    const ignoredItems: Array<{
      officialItem: ReceiptOfficialItem;
      quantity: number;
      unitPrice: number;
      reason: IngestIgnoredReason;
      detail: string;
    }> = [];

    for (const parsedItem of parsedItems) {
      const rule = rulesByOfficial.get(parsedItem.item);
      if (!rule) {
        ignoredItems.push({
          officialItem: parsedItem.item,
          quantity: parsedItem.quantity,
          unitPrice: parsedItem.unitPrice,
          reason: 'REGRA_NAO_CONFIGURADA',
          detail: 'Sem regra de mapeamento no bloco Integracoes.'
        });
        continue;
      }

      if (!rule.enabled) {
        ignoredItems.push({
          officialItem: parsedItem.item,
          quantity: parsedItem.quantity,
          unitPrice: parsedItem.unitPrice,
          reason: 'REGRA_DESABILITADA',
          detail: 'Regra desabilitada para este item no bloco Integracoes.'
        });
        continue;
      }

      const lookupName = (rule.inventoryItemName || '').trim() || parsedItem.item;
      const candidates = byNormalizedName.get(this.normalizeLookup(lookupName)) || [];
      const ingredient = candidates.find((item) => item.category === 'INGREDIENTE');

      if (!ingredient) {
        const reason: IngestIgnoredReason =
          candidates.length > 0 ? 'ITEM_NAO_INGREDIENTE' : 'ITEM_ESTOQUE_NAO_ENCONTRADO';

        ignoredItems.push({
          officialItem: parsedItem.item,
          quantity: parsedItem.quantity,
          unitPrice: parsedItem.unitPrice,
          reason,
          detail:
            reason === 'ITEM_NAO_INGREDIENTE'
              ? `O item "${lookupName}" existe, mas nao esta na categoria INGREDIENTE.`
              : `Nao foi encontrado item de estoque chamado "${lookupName}".`
        });
        continue;
      }

      const movementQuantity = this.normalizeQuantity(parsedItem.quantity * rule.quantityMultiplier);
      if (!Number.isFinite(movementQuantity) || movementQuantity <= 0) {
        ignoredItems.push({
          officialItem: parsedItem.item,
          quantity: parsedItem.quantity,
          unitPrice: parsedItem.unitPrice,
          reason: 'QUANTIDADE_INVALIDA',
          detail: 'Quantidade final invalida apos aplicar multiplicador.'
        });
        continue;
      }

      const movement = (await this.inventoryService.createMovement({
        itemId: ingredient.id,
        type: 'IN',
        quantity: movementQuantity,
        reason: this.buildIngestReason(parsedItem, purchaseDate, rule)
      })) as { id: number };

      appliedMovements.push({
        movementId: movement.id,
        officialItem: parsedItem.item,
        inventoryItemId: ingredient.id,
        inventoryItemName: ingredient.name,
        quantity: movementQuantity,
        unitPrice: parsedItem.unitPrice
      });
    }

    return {
      appliedCount: appliedMovements.length,
      ignoredCount: ignoredItems.length,
      appliedMovements,
      ignoredItems
    };
  }

  private buildIngestReason(
    parsedItem: ParsedReceiptItem,
    purchaseDate: string,
    rule: BuilderReceiptStockRule
  ) {
    const dateLabel = purchaseDate || 'sem_data';
    return [
      `Entrada automatica cupom (${dateLabel})`,
      `item=${parsedItem.item}`,
      `qtd=${this.formatQuantity(parsedItem.quantity)}x`,
      `mult=${this.normalizeMultiplier(rule.quantityMultiplier)}x`,
      `vl_unit=${this.formatMoney(parsedItem.unitPrice)}`
    ].join(' | ');
  }

  private normalizeLookup(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
  }

  private async callVisionModel(input: ParseReceiptInput, apiKey: string, customPrompt: string) {
    const imageUrl = this.buildImageUrl(input);
    const itemListText = officialItems.map((item) => `- ${item}`).join('\n');
    const providerInfo = input.providerHint ? `Fornecedor informado: ${input.providerHint}.` : '';

    const systemPrompt = [
      'Voce extrai dados de cupom fiscal e responde SOMENTE em JSON valido.',
      'Itens validos (use exatamente o nome oficial):',
      itemListText,
      'Se item nao estiver na lista, ignore completamente.',
      'Retorne purchaseDate em YYYY-MM-DD quando possivel.',
      'Para cada item aceito, retorne quantity e unitPrice numericos.'
    ].join('\n');

    const defaultUserPrompt = [
      'Extrair dados do cupom fiscal da imagem.',
      'Nao inclua itens fora da lista oficial.',
      'Se nao identificar data, use string vazia em purchaseDate.'
    ].join('\n');

    const userPrompt = [
      customPrompt ? `Prompt operacional:\n${customPrompt}` : defaultUserPrompt,
      providerInfo,
      'Responda SOMENTE com JSON valido no schema solicitado.'
    ]
      .filter(Boolean)
      .join('\n');

    const body = {
      model: this.model,
      temperature: 0,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'receipt_extraction',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['purchaseDate', 'items'],
            properties: {
              purchaseDate: {
                type: 'string',
                description: 'Data da compra no formato YYYY-MM-DD. Se nao encontrar, retornar string vazia.'
              },
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['item', 'quantity', 'unitPrice'],
                  properties: {
                    item: {
                      type: 'string',
                      enum: [...officialItems]
                    },
                    quantity: {
                      type: 'number',
                      minimum: 0.000001
                    },
                    unitPrice: {
                      type: 'number',
                      minimum: 0.000001
                    }
                  }
                }
              }
            }
          }
        }
      },
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: userPrompt
            },
            {
              type: 'image_url',
              image_url: {
                url: imageUrl
              }
            }
          ]
        }
      ]
    };

    let response: Response;
    try {
      response = await fetch(`${this.openAiBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      });
    } catch (error) {
      throw new InternalServerErrorException(`Falha de rede ao chamar OpenAI: ${this.stringifyError(error)}`);
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new BadRequestException(
        `OpenAI retornou erro HTTP ${response.status}: ${this.compactText(errText, 600)}`
      );
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const message = data.choices?.[0]?.message;
    const contentText = this.extractMessageContent(message);

    if (!contentText) {
      if (message?.refusal) {
        throw new BadRequestException(`Modelo recusou o pedido: ${message.refusal}`);
      }
      throw new BadRequestException('Modelo nao retornou conteudo JSON parseavel.');
    }

    try {
      return JSON.parse(contentText) as unknown;
    } catch {
      throw new BadRequestException(`Modelo retornou JSON invalido: ${this.compactText(contentText, 600)}`);
    }
  }

  private buildImageUrl(input: ParseReceiptInput) {
    if (input.imageUrl) {
      return input.imageUrl;
    }
    const raw = (input.imageBase64 || '').trim();
    if (raw.startsWith('data:')) {
      return this.normalizeDataUrl(raw);
    }
    const base64Payload = this.sanitizeBase64(raw);
    const mimeType = this.normalizeImageMimeType(input.mimeType, base64Payload);
    this.ensureSupportedMimeType(mimeType);
    return `data:${mimeType};base64,${base64Payload}`;
  }

  private normalizeDataUrl(raw: string) {
    const match = raw.match(/^data:([^;,]+);base64,(.*)$/is);
    if (!match) {
      return raw;
    }
    const mimeType = this.normalizeImageMimeType(match[1], match[2]);
    this.ensureSupportedMimeType(mimeType);
    const base64Payload = this.sanitizeBase64(match[2]);
    return `data:${mimeType};base64,${base64Payload}`;
  }

  private sanitizeBase64(value: string) {
    return value.replace(/\s+/g, '');
  }

  private normalizeImageMimeType(value: string | undefined, base64Payload: string) {
    const normalized = (value || '').trim().toLowerCase();
    if (normalized.startsWith('image/')) {
      return normalized;
    }
    const inferred = this.inferImageMimeType(base64Payload);
    return inferred || 'image/jpeg';
  }

  private inferImageMimeType(base64Payload: string) {
    const value = this.sanitizeBase64(base64Payload);
    if (!value) return '';
    if (value.startsWith('/9j/')) return 'image/jpeg';
    if (value.startsWith('iVBORw0KGgo')) return 'image/png';
    if (value.startsWith('R0lGOD')) return 'image/gif';
    if (value.startsWith('UklGR')) return 'image/webp';
    if (value.startsWith('AAAAIGZ0eXBoZWlj') || value.startsWith('AAAAHGZ0eXBoZWlj')) return 'image/heic';
    if (value.startsWith('AAAAIGZ0eXBoZWlm') || value.startsWith('AAAAHGZ0eXBoZWlm')) return 'image/heif';
    return '';
  }

  private ensureSupportedMimeType(mimeType: string) {
    if (mimeType === 'image/heic' || mimeType === 'image/heif') {
      throw new BadRequestException(
        'Formato HEIC/HEIF nao suportado neste fluxo. No Atalhos, converta a foto para JPEG antes de codificar em Base64.'
      );
    }
  }

  private extractMessageContent(message?: ChatCompletionMessage) {
    const content = message?.content;
    if (typeof content === 'string') {
      return content.trim();
    }
    if (Array.isArray(content)) {
      return content
        .map((part) => (typeof part?.text === 'string' ? part.text : ''))
        .join('')
        .trim();
    }
    return '';
  }

  private normalizeItems(extracted: ParsedReceipt) {
    return extracted.items.map((item) => ({
      item: item.item,
      quantity: this.normalizeQuantity(item.quantity),
      unitPrice: this.normalizeMoney(item.unitPrice)
    }));
  }

  private normalizeDate(raw: string) {
    const value = raw.trim();
    if (!value) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

    const br = value.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
    if (br) {
      return `${br[3]}-${br[2]}-${br[1]}`;
    }
    return value;
  }

  private normalizeMoney(value: number) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private normalizeQuantity(value: number) {
    return Math.round((value + Number.EPSILON) * 1000) / 1000;
  }

  private formatMoney(value: number) {
    return value.toFixed(2).replace('.', ',');
  }

  private formatQuantity(value: number) {
    if (Number.isInteger(value)) {
      return String(value);
    }
    return value
      .toFixed(3)
      .replace(/0+$/, '')
      .replace(/\.$/, '')
      .replace('.', ',');
  }

  private compactText(text: string, maxLength: number) {
    const compact = text.replace(/\s+/g, ' ').trim();
    if (compact.length <= maxLength) return compact;
    return `${compact.slice(0, maxLength)}...`;
  }

  private stringifyError(error: unknown) {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}
