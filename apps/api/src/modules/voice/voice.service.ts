import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException
} from '@nestjs/common';
import { z } from 'zod';
import { AutomationsService } from '../automations/automations.service.js';

const realtimeSessionInputSchema = z.object({
  model: z.string().trim().min(1).max(120).optional(),
  voice: z.string().trim().min(1).max(40).optional(),
  instructions: z.string().trim().max(2000).optional(),
  temperature: z.coerce.number().min(0).max(2).optional(),
  maxResponseOutputTokens: z.coerce.number().int().min(32).max(4096).optional(),
  modalities: z.array(z.enum(['text', 'audio'])).min(1).max(2).optional()
});

const voiceCommandInputSchema = z.object({
  transcript: z.string().trim().min(1).max(5000),
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  autoExecute: z.boolean().default(false)
});

const voiceCommandResultSchema = z.object({
  action: z.enum(['NONE', 'SUPPLIER_PRICE_SYNC', 'D1_PURCHASE_PLAN', 'RECEIPTS_BATCH_INGEST']),
  confidence: z.coerce.number().min(0).max(1),
  summary: z.string().trim().min(1).max(320),
  date: z.string().trim().optional(),
  reasoning: z.string().trim().max(500).optional(),
  payload: z
    .object({
      continueOnError: z.boolean().optional(),
      items: z
        .array(
          z.object({
            imageBase64: z.string().trim().min(1).optional(),
            imageUrl: z.string().trim().url().optional(),
            mimeType: z.string().trim().min(1).optional(),
            providerHint: z.string().trim().min(1).max(120).optional(),
            sourceFriendly: z.string().trim().min(1).max(140).optional()
          })
        )
        .optional()
    })
    .optional()
});

type RealtimeSessionInput = z.output<typeof realtimeSessionInputSchema>;
type VoiceCommandInput = z.output<typeof voiceCommandInputSchema>;
type VoiceCommandResult = z.output<typeof voiceCommandResultSchema>;

@Injectable()
export class VoiceService {
  private readonly openAiBaseUrl = this.resolveOpenAiBaseUrl();
  private readonly voiceApiToken = (process.env.VOICE_API_TOKEN || '').trim();
  private readonly realtimeDefaultModel = (process.env.OPENAI_VOICE_REALTIME_MODEL || 'gpt-realtime').trim();
  private readonly commandDefaultModel = (process.env.OPENAI_VOICE_COMMAND_MODEL || 'gpt-4.1-mini').trim();
  private readonly defaultVoice = (process.env.OPENAI_VOICE_DEFAULT || 'alloy').trim();

  constructor(@Inject(AutomationsService) private readonly automationsService: AutomationsService) {}

  async createRealtimeSession(payload: unknown, token?: string) {
    this.ensureVoiceAccessToken(token);
    const apiKey = this.requireApiKey();
    const input = realtimeSessionInputSchema.parse(payload) as RealtimeSessionInput;

    const body: Record<string, unknown> = {
      model: (input.model || this.realtimeDefaultModel).trim(),
      voice: (input.voice || this.defaultVoice).trim(),
      modalities: input.modalities || ['text', 'audio']
    };

    const instructions = (input.instructions || '').trim();
    if (instructions) {
      body.instructions = instructions;
    }
    if (input.temperature != null) {
      body.temperature = input.temperature;
    }
    if (input.maxResponseOutputTokens != null) {
      body.max_response_output_tokens = input.maxResponseOutputTokens;
    }

    return this.callOpenAiJsonEndpoint('/realtime/sessions', apiKey, body);
  }

  async parseOperationalCommand(payload: unknown, token?: string) {
    this.ensureVoiceAccessToken(token);
    const apiKey = this.requireApiKey();
    const input = voiceCommandInputSchema.parse(payload) as VoiceCommandInput;

    const command = await this.extractVoiceCommand(input.transcript, input.date, apiKey);

    if (!input.autoExecute || command.action === 'NONE') {
      return {
        parsedAt: new Date().toISOString(),
        command,
        execution: null
      };
    }

    if (command.confidence < 0.45) {
      return {
        parsedAt: new Date().toISOString(),
        command,
        execution: {
          status: 'skipped',
          reason: 'Confianca baixa; execucao automatica bloqueada.'
        }
      };
    }

    let runPayload: unknown;
    if (command.action === 'SUPPLIER_PRICE_SYNC') {
      runPayload = {
        skill: 'SUPPLIER_PRICE_SYNC',
        objective: command.summary,
        input: {},
        autoStart: true
      };
    } else if (command.action === 'D1_PURCHASE_PLAN') {
      runPayload = {
        skill: 'D1_PURCHASE_PLAN',
        objective: command.summary,
        input: {
          date: (command.date || input.date || '').trim() || undefined,
          syncSupplierPricesFirst: true
        },
        autoStart: true
      };
    } else {
      const items = command.payload?.items || [];
      if (items.length === 0) {
        return {
          parsedAt: new Date().toISOString(),
          command,
          execution: {
            status: 'skipped',
            reason: 'Comando de ingestao sem itens de cupom no payload.'
          }
        };
      }
      runPayload = {
        skill: 'RECEIPTS_BATCH_INGEST',
        objective: command.summary,
        input: {
          continueOnError: command.payload?.continueOnError !== false,
          items
        },
        autoStart: true
      };
    }

    const run = await this.automationsService.createRun(runPayload, token);

    return {
      parsedAt: new Date().toISOString(),
      command,
      execution: {
        status: 'started',
        runId: run.id,
        runStatus: run.status,
        runSkill: run.skill
      }
    };
  }

  private async extractVoiceCommand(transcript: string, date: string | undefined, apiKey: string) {
    const text = transcript.trim();
    const dateHint = (date || '').trim();

    const systemPrompt = [
      'Voce interpreta comandos de voz operacionais para um ERP de producao e estoque.',
      'Retorne apenas JSON valido no schema solicitado.',
      'Acoes permitidas:',
      '- NONE',
      '- SUPPLIER_PRICE_SYNC',
      '- D1_PURCHASE_PLAN',
      '- RECEIPTS_BATCH_INGEST',
      'Use NONE quando o comando for ambiguo ou fora de escopo operacional.',
      'Confidence deve ser um numero de 0 a 1.'
    ].join('\n');

    const userPrompt = [
      `Transcricao: ${text}`,
      dateHint ? `Data de referencia (opcional): ${dateHint}` : '',
      'Interprete o comando e retorne JSON estruturado para automacao.'
    ]
      .filter(Boolean)
      .join('\n');

    const body = {
      model: this.commandDefaultModel,
      temperature: 0,
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: systemPrompt }]
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: userPrompt }]
        }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'voice_command_parser',
          strict: false,
          schema: this.getVoiceCommandJsonSchema()
        }
      }
    };

    const data = (await this.callOpenAiJsonEndpoint('/responses', apiKey, body)) as {
      output_text?: string;
      output?: Array<{
        content?: Array<{
          text?: string;
          json?: unknown;
        }>;
      }>;
      error?: {
        message?: string;
      };
    };

    const payload = this.extractResponsesPayload(data);
    if (!payload) {
      if (data.error?.message) {
        throw new BadRequestException(`Modelo retornou erro ao interpretar comando de voz: ${data.error.message}`);
      }
      throw new BadRequestException('Modelo nao retornou JSON parseavel para o comando de voz.');
    }

    const parsedJson = this.parseModelJsonOutput(payload);
    return voiceCommandResultSchema.parse(parsedJson) as VoiceCommandResult;
  }

  private getVoiceCommandJsonSchema() {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['action', 'confidence', 'summary'],
      properties: {
        action: {
          type: 'string',
          enum: ['NONE', 'SUPPLIER_PRICE_SYNC', 'D1_PURCHASE_PLAN', 'RECEIPTS_BATCH_INGEST']
        },
        confidence: {
          type: 'number',
          minimum: 0,
          maximum: 1
        },
        summary: {
          type: 'string',
          minLength: 1,
          maxLength: 320
        },
        date: {
          type: 'string',
          maxLength: 20
        },
        reasoning: {
          type: 'string',
          maxLength: 500
        },
        payload: {
          type: 'object',
          additionalProperties: false,
          properties: {
            continueOnError: {
              type: 'boolean'
            },
            items: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  imageBase64: {
                    type: 'string'
                  },
                  imageUrl: {
                    type: 'string'
                  },
                  mimeType: {
                    type: 'string'
                  },
                  providerHint: {
                    type: 'string'
                  },
                  sourceFriendly: {
                    type: 'string'
                  }
                }
              }
            }
          }
        }
      }
    };
  }

  private requireApiKey() {
    const key = (process.env.OPENAI_API_KEY || '').trim();
    if (!key) {
      throw new BadRequestException('OPENAI_API_KEY nao configurada para fluxos de voz.');
    }
    return key;
  }

  private ensureVoiceAccessToken(token?: string) {
    const expected = this.resolveExpectedVoiceToken();
    if (!expected) return;
    if ((token || '').trim() === expected) return;
    throw new BadRequestException(
      'Token invalido para /voice. Envie x-voice-token (ou x-automations-token/x-receipts-token) com token autorizado.'
    );
  }

  private resolveExpectedVoiceToken() {
    if (this.voiceApiToken) return this.voiceApiToken;
    const automationsToken = (process.env.AUTOMATIONS_API_TOKEN || '').trim();
    if (automationsToken) return automationsToken;
    const receiptsToken = (process.env.RECEIPTS_API_TOKEN || '').trim();
    if (receiptsToken) return receiptsToken;
    return '';
  }

  private resolveOpenAiBaseUrl() {
    const raw = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').trim();
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error('OPENAI_BASE_URL invalida. Use URL absoluta com protocolo http(s).');
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('OPENAI_BASE_URL deve usar http:// ou https://');
    }

    const host = parsed.hostname.toLowerCase();
    const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (parsed.protocol === 'http:' && !isLocalhost) {
      throw new Error('OPENAI_BASE_URL com http:// so e permitida para localhost.');
    }

    return parsed.toString().replace(/\/+$/, '');
  }

  private extractResponsesPayload(data: {
    output_text?: string;
    output?: Array<{
      content?: Array<{
        text?: string;
        json?: unknown;
      }>;
    }>;
  }) {
    if (typeof data.output_text === 'string' && data.output_text.trim()) {
      return data.output_text.trim();
    }

    for (const item of data.output || []) {
      for (const content of item.content || []) {
        if (typeof content.text === 'string' && content.text.trim()) {
          return content.text.trim();
        }
        if (content.json && typeof content.json === 'object') {
          return content.json;
        }
      }
    }

    return '';
  }

  private parseModelJsonOutput(payload: string | unknown) {
    if (payload && typeof payload === 'object') {
      return payload;
    }

    const text = String(payload || '').trim();
    if (!text) {
      throw new BadRequestException('Resposta vazia na interpretacao de comando de voz.');
    }

    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new BadRequestException('Modelo retornou JSON invalido na interpretacao de comando de voz.');
    }
  }

  private async callOpenAiJsonEndpoint(path: string, apiKey: string, body: unknown) {
    let response: Response;
    try {
      response = await fetch(`${this.openAiBaseUrl}${path}`, {
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
      const detail = await response.text().catch(() => '');
      throw new BadRequestException(
        `OpenAI retornou erro HTTP ${response.status}: ${this.compactText(detail, 600)}`
      );
    }

    return response.json();
  }

  private compactText(value: string, maxLength: number) {
    const compact = (value || '').replace(/\s+/g, ' ').trim();
    if (compact.length <= maxLength) return compact;
    return `${compact.slice(0, maxLength)}...`;
  }

  private stringifyError(error: unknown) {
    if (error instanceof Error) return error.message;
    return String(error);
  }
}
