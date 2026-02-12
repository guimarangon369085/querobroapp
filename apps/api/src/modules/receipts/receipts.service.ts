import {
  BadRequestException,
  Injectable,
  InternalServerErrorException
} from '@nestjs/common';
import { z } from 'zod';
import { parseWithSchema } from '../../common/validation.js';

const officialItems = [
  'FARINHA DE TRIGO',
  'FUBÁ DE CANJICA',
  'AÇÚCAR',
  'MANTEIGA',
  'LEITE',
  'OVOS',
  'GOIABADA',
  'DOCE DE LEITE',
  'QUEIJO DO SERRO',
  'REQUEIJÃO DE CORTE',
  'SACOLA',
  'CAIXA DE PLÁSTICO',
  'PAPEL MANTEIGA'
] as const;

const officialItemSchema = z.enum(officialItems);

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
        item: officialItemSchema,
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

@Injectable()
export class ReceiptsService {
  private readonly model = process.env.OPENAI_RECEIPTS_MODEL || 'gpt-4o-mini';
  private readonly openAiBaseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(
    /\/+$/,
    ''
  );
  private readonly receiptsApiToken = (process.env.RECEIPTS_API_TOKEN || '').trim();

  async parse(payload: unknown, token?: string) {
    this.ensureReceiptsToken(token);

    const input = parseWithSchema(parseReceiptInputSchema, payload) as ParseReceiptInput;
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new BadRequestException(
        'OPENAI_API_KEY nao configurada. Defina a chave no ambiente da API para usar /receipts/parse.'
      );
    }

    const modelOutput = await this.callVisionModel(input, apiKey);
    const extracted = parseWithSchema(parsedReceiptSchema, modelOutput) as ParsedReceipt;
    const purchaseDate = this.normalizeDate(extracted.purchaseDate);
    const items = this.normalizeItems(extracted);

    const lines = items.map((item) => {
      return `${purchaseDate};${item.item};${this.formatQuantity(item.quantity)};${this.formatMoney(item.unitPrice)}`;
    });

    return {
      purchaseDate,
      items,
      lineCount: lines.length,
      lines,
      clipboardText: lines.join('\n'),
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

  private async callVisionModel(input: ParseReceiptInput, apiKey: string) {
    const imageUrl = this.buildImageUrl(input);
    const providerInfo = input.providerHint ? `Fornecedor informado: ${input.providerHint}.` : '';
    const itemListText = officialItems.map((item) => `- ${item}`).join('\n');

    const systemPrompt = [
      'Voce extrai dados de cupom fiscal e responde SOMENTE em JSON valido.',
      'Itens validos (use exatamente o nome oficial):',
      itemListText,
      'Se item nao estiver na lista, ignore completamente.',
      'Retorne purchaseDate em YYYY-MM-DD quando possivel.',
      'Para cada item aceito, retorne quantity e unitPrice numericos.'
    ].join('\n');

    const userPrompt = [
      'Extrair dados do cupom fiscal da imagem.',
      providerInfo,
      'Nao inclua itens fora da lista oficial.',
      'Se nao identificar data, use string vazia em purchaseDate.'
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
    const raw = input.imageBase64 || '';
    if (raw.startsWith('data:')) {
      return raw;
    }
    return `data:${input.mimeType};base64,${raw}`;
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

    const br = value.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
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
