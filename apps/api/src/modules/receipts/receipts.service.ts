import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  BuilderIntegrationsSchema,
  ReceiptOfficialItemEnum,
  type BuilderReceiptStockRule,
  type BuilderSupplierPriceSource,
  type ReceiptOfficialItem
} from '@querobroapp/shared';
import { z } from 'zod';
import { parseLocaleNumber } from '../../common/normalize.js';
import { parseWithSchema } from '../../common/validation.js';
import { BuilderService } from '../builder/builder.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { PrismaService } from '../../prisma.service.js';

const officialItems = [...ReceiptOfficialItemEnum.options];

const parseReceiptInputSchema = z
  .object({
    imageBase64: z.string().trim().min(1).optional(),
    imageUrl: z.string().trim().url().optional(),
    mimeType: z.string().trim().min(1).optional().default('image/jpeg'),
    providerHint: z.string().trim().min(1).max(120).optional(),
    sourceFriendly: z.string().trim().min(1).max(140).optional()
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
  supplierPricesEnabled: boolean;
  supplierPriceSources: BuilderSupplierPriceSource[];
};

type ParsedReceiptRuntime = {
  purchaseDate: string;
  sourceFriendly: string;
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
  unit: string;
  purchasePackSize: number;
  purchasePackCost?: number | null;
};

type IngestAppliedMovement = {
  movementId: number;
  officialItem: ReceiptOfficialItem;
  inventoryItemId: number;
  inventoryItemName: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  sourceLabel: string;
};

type IngestIgnoredItem = {
  officialItem: ReceiptOfficialItem;
  quantity: number;
  unitPrice: number;
  reason: IngestIgnoredReason;
  detail: string;
};

type IngestSummary = {
  appliedCount: number;
  ignoredCount: number;
  appliedMovements: IngestAppliedMovement[];
  ignoredItems: IngestIgnoredItem[];
};

type ReceiptsIngestResponse = {
  purchaseDate: string;
  sourceFriendly: string;
  items: ParsedReceiptItem[];
  lineCount: number;
  lines: string[];
  clipboardText: string;
  separator: string;
  officialItems: string[];
  ingest: IngestSummary;
};

type SupplierPriceSyncItem = {
  sourceId: string;
  officialItem: ReceiptOfficialItem;
  inventoryItemName: string;
  supplierName: string;
  url: string;
  extractedPrice: number | null;
  applied: boolean;
  detail: string;
};

type SupplierPriceSyncResult = {
  syncedAt: string;
  appliedCount: number;
  attemptedCount: number;
  skippedCount: number;
  results: SupplierPriceSyncItem[];
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
  private readonly idempotencyScope = 'receipts-ingest-v1';
  private readonly idempotencyTtlHours = this.resolveIdempotencyTtlHours();

  constructor(
    @Inject(BuilderService) private readonly builderService: BuilderService,
    @Inject(InventoryService) private readonly inventoryService: InventoryService,
    @Inject(PrismaService) private readonly prisma: PrismaService
  ) {}

  async parse(payload: unknown, token?: string) {
    const parsed = await this.parseReceiptPayload(payload, token);
    return this.toPublicParseResponse(parsed);
  }

  async ingest(payload: unknown, token?: string, idempotencyKey?: string): Promise<ReceiptsIngestResponse> {
    const normalizedIdempotencyKey = this.normalizeIdempotencyKey(idempotencyKey);
    if (!normalizedIdempotencyKey) {
      return this.runIngest(payload, token);
    }

    const requestHash = this.hashPayload(payload);
    const existing = await this.readIdempotencyRecord(normalizedIdempotencyKey);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new BadRequestException(
          'Idempotency-Key reutilizada com payload diferente. Use uma nova chave para esta requisicao.'
        );
      }
      return this.parseStoredIngestResponse(existing.responseJson);
    }

    const response = await this.runIngest(payload, token);
    await this.storeIdempotencyRecord(normalizedIdempotencyKey, requestHash, response);
    return response;
  }

  async syncSupplierPrices(token?: string): Promise<SupplierPriceSyncResult> {
    this.ensureReceiptsToken(token);
    const runtimeConfig = await this.getRuntimeConfig();
    if (!runtimeConfig.supplierPricesEnabled) {
      throw new BadRequestException('Sincronizacao de preco de fornecedor esta desabilitada no Builder.');
    }

    const enabledSources = runtimeConfig.supplierPriceSources.filter((source) => source.enabled);
    if (enabledSources.length === 0) {
      return {
        syncedAt: new Date().toISOString(),
        appliedCount: 0,
        attemptedCount: 0,
        skippedCount: 0,
        results: []
      };
    }

    const inventoryItems = (await this.inventoryService.listItems()) as InventoryLookupItem[];
    const byNormalizedName = new Map<string, InventoryLookupItem[]>();
    for (const item of inventoryItems) {
      const key = this.normalizeLookup(item.name || '');
      if (!key) continue;
      const list = byNormalizedName.get(key) || [];
      list.push(item);
      byNormalizedName.set(key, list);
    }

    const results: SupplierPriceSyncItem[] = [];
    let appliedCount = 0;
    let skippedCount = 0;

    for (const source of enabledSources) {
      const normalizedLookup = this.normalizeLookup(source.inventoryItemName);
      const candidates = byNormalizedName.get(normalizedLookup) || [];
      const inventoryItem = candidates[0];
      if (!inventoryItem) {
        skippedCount += 1;
        results.push({
          sourceId: source.id,
          officialItem: source.officialItem,
          inventoryItemName: source.inventoryItemName,
          supplierName: source.supplierName,
          url: source.url,
          extractedPrice: null,
          applied: false,
          detail: `Item "${source.inventoryItemName}" nao encontrado no estoque.`
        });
        continue;
      }

      const extractedPrice = await this.extractSupplierPrice(source);
      const price = extractedPrice ?? source.fallbackPrice ?? null;
      if (price === null || !Number.isFinite(price) || price <= 0) {
        skippedCount += 1;
        results.push({
          sourceId: source.id,
          officialItem: source.officialItem,
          inventoryItemName: source.inventoryItemName,
          supplierName: source.supplierName,
          url: source.url,
          extractedPrice: null,
          applied: false,
          detail: 'Nao foi possivel extrair preco valido da fonte.'
        });
        continue;
      }

      const normalizedPrice = this.normalizeMoney(price);
      const shouldApply = source.applyToInventoryCost !== false;
      if (shouldApply) {
        await this.inventoryService.updateItem(inventoryItem.id, {
          purchasePackCost: normalizedPrice
        });
        appliedCount += 1;
      } else {
        skippedCount += 1;
      }

      results.push({
        sourceId: source.id,
        officialItem: source.officialItem,
        inventoryItemName: source.inventoryItemName,
        supplierName: source.supplierName,
        url: source.url,
        extractedPrice: normalizedPrice,
        applied: shouldApply,
        detail:
          extractedPrice === null
            ? 'Preco aplicado via fallback configurado.'
            : 'Preco extraido e aplicado com sucesso.'
      });
    }

    return {
      syncedAt: new Date().toISOString(),
      appliedCount,
      attemptedCount: enabledSources.length,
      skippedCount,
      results
    };
  }

  private async runIngest(payload: unknown, token?: string): Promise<ReceiptsIngestResponse> {
    const parsed = await this.parseReceiptPayload(payload, token);

    if (!parsed.runtimeConfig.receiptsAutoIngestEnabled) {
      throw new BadRequestException(
        'Automacao de entrada de estoque por cupom esta desabilitada no Builder > Integracoes.'
      );
    }

    const ingest = await this.applyStockIngest(
      parsed.items,
      parsed.purchaseDate,
      parsed.runtimeConfig.receiptStockRules,
      parsed.sourceFriendly
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
    const sourceFriendly = (input.sourceFriendly || input.providerHint || 'Cupom fiscal').trim();
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
      sourceFriendly,
      items,
      lines,
      runtimeConfig
    };
  }

  private toPublicParseResponse(parsed: ParsedReceiptRuntime) {
    return {
      purchaseDate: parsed.purchaseDate,
      sourceFriendly: parsed.sourceFriendly,
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
        receiptStockRules: this.normalizeStockRules(config.integrations.receiptStockRules),
        supplierPricesEnabled: config.integrations.supplierPricesEnabled,
        supplierPriceSources: this.normalizeSupplierPriceSources(config.integrations.supplierPriceSources)
      };
    } catch {
      return {
        shortcutsEnabled: defaults.shortcutsEnabled,
        receiptsPrompt: defaults.receiptsPrompt,
        receiptsSeparator: this.normalizeSeparator(defaults.receiptsSeparator),
        receiptsAutoIngestEnabled: defaults.receiptsAutoIngestEnabled,
        receiptStockRules: this.normalizeStockRules(defaults.receiptStockRules),
        supplierPricesEnabled: defaults.supplierPricesEnabled,
        supplierPriceSources: this.normalizeSupplierPriceSources(defaults.supplierPriceSources)
      };
    }
  }

  private normalizeSeparator(value?: string) {
    const normalized = (value || '').trim();
    if (!normalized) return this.defaultSeparator;
    return normalized.slice(0, 4);
  }

  private normalizeStockRules(rules: BuilderReceiptStockRule[] | undefined): BuilderReceiptStockRule[] {
    const byOfficial = new Map<ReceiptOfficialItem, BuilderReceiptStockRule>();
    for (const rule of rules || []) {
      byOfficial.set(rule.officialItem, {
        officialItem: rule.officialItem,
        inventoryItemName: (rule.inventoryItemName || '').trim() || rule.officialItem,
        enabled: Boolean(rule.enabled),
        quantityMultiplier: this.normalizeMultiplier(rule.quantityMultiplier),
        quantityMode:
          (rule.quantityMode === 'BASE_UNIT' ? 'BASE_UNIT' : 'PURCHASE_PACK') as BuilderReceiptStockRule['quantityMode'],
        purchasePackCostMultiplier: this.normalizeMultiplier(rule.purchasePackCostMultiplier),
        applyPriceToInventoryCost: rule.applyPriceToInventoryCost !== false,
        sourceLabel: (rule.sourceLabel || '').trim()
      });
    }

    return officialItems.map((officialItem) => {
      const current = byOfficial.get(officialItem as ReceiptOfficialItem);
      if (current) return current;
      return {
        officialItem: officialItem as ReceiptOfficialItem,
        inventoryItemName: officialItem,
        enabled: this.defaultRuleEnabled(officialItem as ReceiptOfficialItem),
        quantityMultiplier: 1,
        quantityMode: 'PURCHASE_PACK' as BuilderReceiptStockRule['quantityMode'],
        purchasePackCostMultiplier: 1,
        applyPriceToInventoryCost: true,
        sourceLabel: 'Cupom fornecedor'
      };
    });
  }

  private normalizeSupplierPriceSources(sources: BuilderSupplierPriceSource[] | undefined) {
    const seen = new Set<string>();
    const normalized: BuilderSupplierPriceSource[] = [];

    for (const [index, source] of (sources || []).entries()) {
      const id = (source.id || '').trim() || `source-${index + 1}`;
      if (seen.has(id)) continue;
      seen.add(id);

      const url = (source.url || '').trim();
      if (!url) continue;

      const fallbackPrice =
        source.fallbackPrice == null || !Number.isFinite(source.fallbackPrice) || source.fallbackPrice <= 0
          ? null
          : this.normalizeMoney(source.fallbackPrice);

      normalized.push({
        id,
        officialItem: source.officialItem,
        inventoryItemName: (source.inventoryItemName || '').trim() || source.officialItem,
        supplierName: (source.supplierName || '').trim() || 'Fornecedor',
        url,
        priceXPath: (source.priceXPath || '').trim(),
        enabled: source.enabled !== false,
        fallbackPrice,
        applyToInventoryCost: source.applyToInventoryCost !== false
      });
    }

    return normalized.slice(0, 40);
  }

  private normalizeMultiplier(value: number) {
    if (!Number.isFinite(value) || value <= 0) return 1;
    return Math.max(0.001, Math.min(100, Math.round((value + Number.EPSILON) * 1000) / 1000));
  }

  private defaultRuleEnabled(item: ReceiptOfficialItem) {
    return Boolean(item);
  }

  private async applyStockIngest(
    parsedItems: ParsedReceiptItem[],
    purchaseDate: string,
    rules: BuilderReceiptStockRule[],
    sourceFriendly: string
  ): Promise<IngestSummary> {
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

    const appliedMovements: IngestAppliedMovement[] = [];
    const ignoredItems: IngestIgnoredItem[] = [];

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
      const inventoryItem = candidates[0];

      if (!inventoryItem) {
        ignoredItems.push({
          officialItem: parsedItem.item,
          quantity: parsedItem.quantity,
          unitPrice: parsedItem.unitPrice,
          reason: 'ITEM_ESTOQUE_NAO_ENCONTRADO',
          detail: `Nao foi encontrado item de estoque chamado "${lookupName}".`
        });
        continue;
      }

      const baseQuantityFactor =
        rule.quantityMode === 'PURCHASE_PACK'
          ? Math.max(1, this.normalizeQuantity(inventoryItem.purchasePackSize || 1))
          : 1;
      const movementQuantity = this.normalizeQuantity(
        parsedItem.quantity * rule.quantityMultiplier * baseQuantityFactor
      );
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

      const sourceLabel = (sourceFriendly || rule.sourceLabel || 'Cupom fiscal').trim();
      const movementUnitCost = this.resolveMovementUnitCost(parsedItem, inventoryItem, rule);

      if (rule.applyPriceToInventoryCost) {
        const nextPackCost = this.normalizeMoney(parsedItem.unitPrice * rule.purchasePackCostMultiplier);
        await this.inventoryService.updateItem(inventoryItem.id, {
          purchasePackCost: nextPackCost
        });
      }

      const movement = (await this.inventoryService.createMovement({
        itemId: inventoryItem.id,
        type: 'IN',
        quantity: movementQuantity,
        reason: this.buildIngestReason(
          parsedItem,
          purchaseDate,
          rule,
          sourceLabel,
          movementQuantity,
          inventoryItem.unit
        ),
        source: 'CUPOM',
        sourceLabel,
        unitCost: movementUnitCost
      })) as { id: number };

      appliedMovements.push({
        movementId: movement.id,
        officialItem: parsedItem.item,
        inventoryItemId: inventoryItem.id,
        inventoryItemName: inventoryItem.name,
        quantity: movementQuantity,
        unitPrice: parsedItem.unitPrice,
        unitCost: movementUnitCost,
        sourceLabel
      });
    }

    return {
      appliedCount: appliedMovements.length,
      ignoredCount: ignoredItems.length,
      appliedMovements,
      ignoredItems
    };
  }

  private resolveMovementUnitCost(
    parsedItem: ParsedReceiptItem,
    inventoryItem: InventoryLookupItem,
    rule: BuilderReceiptStockRule
  ) {
    const normalizedPackCost = this.normalizeMoney(parsedItem.unitPrice * rule.purchasePackCostMultiplier);
    if (rule.quantityMode === 'PURCHASE_PACK' && inventoryItem.purchasePackSize > 0) {
      return this.normalizeMoney(normalizedPackCost / inventoryItem.purchasePackSize);
    }
    return normalizedPackCost;
  }

  private buildIngestReason(
    parsedItem: ParsedReceiptItem,
    purchaseDate: string,
    rule: BuilderReceiptStockRule,
    sourceLabel: string,
    movementQuantity: number,
    movementUnit: string
  ) {
    const dateLabel = purchaseDate || 'sem data';
    return [
      `Entrada automatica por cupom`,
      `Origem: ${sourceLabel}`,
      `Data: ${dateLabel}`,
      `Item: ${parsedItem.item}`,
      `Quantidade lancada: ${this.formatQuantity(movementQuantity)} ${movementUnit}`,
      `Pacotes no cupom: ${this.formatQuantity(parsedItem.quantity)}x`,
      `Valor unitario de compra: R$ ${this.formatMoney(parsedItem.unitPrice)}`,
      `Modo de quantidade: ${rule.quantityMode === 'PURCHASE_PACK' ? 'embalagem de compra' : 'unidade base'}`
    ].join(' • ');
  }

  private normalizeLookup(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
  }

  private async extractSupplierPrice(source: BuilderSupplierPriceSource) {
    let html = '';
    try {
      const response = await fetch(source.url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.7'
        }
      });
      if (!response.ok) return null;
      html = await response.text();
    } catch {
      return null;
    }

    return this.extractPriceFromHtml(html);
  }

  private extractPriceFromHtml(html: string) {
    const jsonLdPrice = html.match(/"price"\s*:\s*"?(?<value>\d+[.,]\d{2})"?/i)?.groups?.value;
    if (jsonLdPrice) {
      const parsed = this.parseMoneyValue(jsonLdPrice);
      if (parsed != null) return parsed;
    }

    const openGraphPrice = html.match(
      /(?:product:price:amount|price:amount)["']?\s*content=["'](?<value>\d+[.,]\d{2})["']/i
    )?.groups?.value;
    if (openGraphPrice) {
      const parsed = this.parseMoneyValue(openGraphPrice);
      if (parsed != null) return parsed;
    }

    const visibleMatches = Array.from(
      html.matchAll(/R\$\s*(?<value>\d{1,4}(?:\.\d{3})*(?:,\d{2})|\d+\.\d{2})/gi)
    );
    for (const match of visibleMatches) {
      const raw = match.groups?.value;
      if (!raw) continue;
      const parsed = this.parseMoneyValue(raw);
      if (parsed != null && parsed > 0.01) {
        return parsed;
      }
    }

    return null;
  }

  private parseMoneyValue(value: string) {
    const parsed = parseLocaleNumber(value);
    if (parsed == null || !Number.isFinite(parsed) || parsed <= 0) return null;
    return this.normalizeMoney(parsed);
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

  private resolveIdempotencyTtlHours() {
    const parsed = Number(process.env.RECEIPTS_IDEMPOTENCY_TTL_HOURS || 48);
    if (!Number.isFinite(parsed) || parsed <= 0) return 48;
    return Math.min(24 * 14, Math.round(parsed));
  }

  private normalizeIdempotencyKey(value?: string) {
    const key = (value || '').trim();
    if (!key) return '';
    if (key.length > 120) {
      throw new BadRequestException('Idempotency-Key excede 120 caracteres.');
    }
    if (!/^[a-zA-Z0-9._:-]+$/.test(key)) {
      throw new BadRequestException(
        'Idempotency-Key invalida. Use apenas letras, numeros, ponto, underscore, hifen e dois-pontos.'
      );
    }
    return key;
  }

  private hashPayload(payload: unknown) {
    const stable = this.stableStringify(payload);
    return createHash('sha256').update(stable).digest('hex');
  }

  private stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map((entry) => this.stableStringify(entry)).join(',')}]`;
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${this.stableStringify(record[key])}`).join(',')}}`;
  }

  private async readIdempotencyRecord(idemKey: string) {
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: {
        scope_idemKey: {
          scope: this.idempotencyScope,
          idemKey
        }
      }
    });
    if (!existing) return null;

    const now = Date.now();
    if (existing.expiresAt.getTime() <= now) {
      await this.prisma.idempotencyRecord.delete({ where: { id: existing.id } }).catch(() => undefined);
      return null;
    }

    return existing;
  }

  private parseStoredIngestResponse(responseJson: string): ReceiptsIngestResponse {
    try {
      return JSON.parse(responseJson) as ReceiptsIngestResponse;
    } catch {
      throw new InternalServerErrorException(
        'Registro de idempotencia corrompido. Gere uma nova Idempotency-Key.'
      );
    }
  }

  private async storeIdempotencyRecord(
    idemKey: string,
    requestHash: string,
    response: ReceiptsIngestResponse
  ) {
    const expiresAt = new Date(Date.now() + this.idempotencyTtlHours * 60 * 60 * 1000);
    const responseJson = JSON.stringify(response);

    try {
      await this.prisma.idempotencyRecord.create({
        data: {
          scope: this.idempotencyScope,
          idemKey,
          requestHash,
          responseJson,
          expiresAt
        }
      });
      return;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== 'P2002') {
        throw error;
      }
    }

    const existing = await this.readIdempotencyRecord(idemKey);
    if (!existing) {
      return;
    }
    if (existing.requestHash !== requestHash) {
      throw new BadRequestException(
        'Idempotency-Key reutilizada com payload diferente. Use uma nova chave para esta requisicao.'
      );
    }
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
