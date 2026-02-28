import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { parseWithSchema } from '../../common/validation.js';
import { AlexaOauthService } from './alexa-oauth.service.js';
import { AutomationsService } from '../automations/automations.service.js';
import { ProductionService } from '../production/production.service.js';

const alexaBridgeInputSchema = z.object({
  applicationId: z.string().trim().max(220).optional().default(''),
  userId: z.string().trim().max(260).optional().default(''),
  locale: z.string().trim().max(20).optional().default('pt-BR'),
  requestType: z.string().trim().min(1).max(120),
  requestId: z.string().trim().max(220).optional().default(''),
  intentName: z.string().trim().max(140).optional().default(''),
  slots: z.record(z.string(), z.unknown()).optional().default({}),
  utterance: z.string().trim().max(500).optional().default(''),
  accessToken: z.string().trim().max(4000).optional().default('')
});

type AlexaBridgeInput = z.output<typeof alexaBridgeInputSchema>;

type AlexaBridgeResponse = {
  ok: boolean;
  action: string;
  speechText: string;
  shouldEndSession: boolean;
  data: Record<string, unknown>;
};

type AlexaBridgeAuthInput = {
  token?: string;
  signature?: string;
  timestamp?: string;
};

@Injectable()
export class AlexaService {
  private readonly isProduction = (process.env.NODE_ENV || 'development') === 'production';
  private readonly alexaBridgeToken = (process.env.ALEXA_BRIDGE_TOKEN || '').trim();
  private readonly alexaBridgeHmacSecret = (process.env.ALEXA_BRIDGE_HMAC_SECRET || '').trim();
  private readonly automationsApiToken = (process.env.AUTOMATIONS_API_TOKEN || '').trim();
  private readonly receiptsApiToken = (process.env.RECEIPTS_API_TOKEN || '').trim();
  private readonly requireSignature = this.resolveBooleanEnv(
    process.env.ALEXA_BRIDGE_REQUIRE_SIGNATURE,
    true
  );
  private readonly requireSkillIdAllowlist = this.resolveBooleanEnv(
    process.env.ALEXA_BRIDGE_REQUIRE_SKILL_ID_ALLOWLIST,
    this.isProduction
  );
  private readonly bridgeMaxSkewSeconds = this.resolveBridgeMaxSkewSeconds();
  private readonly bridgeReplayTtlSeconds = this.resolveBridgeReplayTtlSeconds();
  private readonly replayCache = new Map<string, number>();
  private readonly allowedSkillIds = new Set(
    (process.env.ALEXA_ALLOWED_SKILL_IDS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );

  constructor(
    @Inject(AutomationsService) private readonly automationsService: AutomationsService,
    @Inject(AlexaOauthService) private readonly alexaOauthService: AlexaOauthService,
    @Inject(ProductionService) private readonly productionService: ProductionService
  ) {}

  async handleBridge(payload: unknown, auth: AlexaBridgeAuthInput = {}): Promise<AlexaBridgeResponse> {
    this.ensureBridgeSecurityConfig();
    this.ensureBridgeToken(auth.token);
    this.ensureSignedRequest(payload, auth.signature, auth.timestamp);

    const input = parseWithSchema(alexaBridgeInputSchema, payload) as AlexaBridgeInput;
    this.ensureAllowedSkillId(input.applicationId);
    await this.ensureAccountLinked(input.accessToken);

    const normalizedRequestType = input.requestType.trim();
    if (normalizedRequestType === 'LaunchRequest') {
      return this.response(
        'LAUNCH',
        'Conexao com QUEROBROAPP pronta. Voce pode dizer: sincronizar fornecedores, gerar plano de compras ou status da ultima automacao.',
        false,
        {
          requestId: input.requestId,
          locale: input.locale
        }
      );
    }

    if (normalizedRequestType === 'SessionEndedRequest') {
      return this.response('SESSION_ENDED', 'Sessao encerrada.', true, {
        requestId: input.requestId
      });
    }

    if (normalizedRequestType !== 'IntentRequest') {
      return this.response('UNSUPPORTED_REQUEST', 'Tipo de requisicao nao suportado.', true, {
        requestType: normalizedRequestType
      });
    }

    return this.handleIntentRequest(input);
  }

  private async handleIntentRequest(input: AlexaBridgeInput): Promise<AlexaBridgeResponse> {
    const intentName = (input.intentName || '').trim();
    const slots = this.normalizeSlots(input.slots || {});
    const utterance = (input.utterance || '').trim();

    if (!intentName) {
      return this.response(
        'MISSING_INTENT',
        'Nao recebi o nome da intencao. Confira o mapeamento do Lambda para o bridge.',
        true,
        {}
      );
    }

    if (intentName === 'AMAZON.HelpIntent') {
      return this.response(
        'HELP',
        'Comandos disponiveis: sincronizar fornecedores, gerar plano de compras de hoje e status da ultima automacao.',
        false,
        {}
      );
    }

    if (intentName === 'AMAZON.CancelIntent' || intentName === 'AMAZON.StopIntent') {
      return this.response('STOP', 'Perfeito. Encerrando por aqui.', true, {});
    }

    if (intentName === 'AMAZON.FallbackIntent') {
      return this.response(
        'FALLBACK',
        'Nao entendi esse comando. Tente: sincronizar fornecedores, gerar plano de compras ou status da ultima automacao.',
        false,
        {}
      );
    }

    const automationToken = this.resolveAutomationAccessToken();

    if (intentName === 'SyncSupplierPricesIntent') {
      const run = await this.automationsService.createRun(
        {
          skill: 'SUPPLIER_PRICE_SYNC',
          objective: 'Sincronizar precos de fornecedores via Alexa',
          input: {},
          autoStart: true
        },
        automationToken
      );

      return this.response('SUPPLIER_PRICE_SYNC_STARTED', 'Sincronizacao iniciada com sucesso.', true, {
        runId: run.id,
        runSkill: run.skill,
        runStatus: run.status
      });
    }

    if (intentName === 'BuildPurchasePlanIntent') {
      const dateValue = this.normalizeAlexaDate(this.pickSlotValue(slots, ['date', 'data', 'dia']));
      const run = await this.automationsService.createRun(
        {
          skill: 'D1_PURCHASE_PLAN',
          objective: dateValue
            ? `Gerar plano de compras para ${dateValue} via Alexa`
            : 'Gerar plano de compras via Alexa',
          input: {
            date: dateValue || undefined,
            syncSupplierPricesFirst: true
          },
          autoStart: true
        },
        automationToken
      );

      return this.response(
        'PURCHASE_PLAN_STARTED',
        dateValue
          ? `Plano de compras iniciado para ${dateValue}.`
          : 'Plano de compras iniciado para a data padrao.',
        true,
        {
          runId: run.id,
          runSkill: run.skill,
          runStatus: run.status,
          date: dateValue || ''
        }
      );
    }

    if (intentName === 'LatestAutomationStatusIntent') {
      const latest = await this.automationsService.listRuns({ limit: '1' }, automationToken);
      const run = latest.runs[0];

      if (!run) {
        return this.response('LATEST_STATUS_EMPTY', 'Ainda nao ha automacoes registradas.', true, {});
      }

      return this.response(
        'LATEST_STATUS',
        `Ultima automacao: skill ${run.skill}, status ${run.status}.`,
        true,
        {
          runId: run.id,
          runSkill: run.skill,
          runStatus: run.status,
          updatedAt: run.updatedAt
        }
      );
    }

    const timerMinutes = this.extractTimerMinutesFromAlexaIntent(intentName, slots, utterance);
    if (timerMinutes != null) {
      const result = await this.productionService.startNextBatch({
        triggerSource: 'ALEXA',
        triggerLabel: utterance || `Alexa timer ${timerMinutes} minutos`,
        requestedTimerMinutes: timerMinutes
      });
      const allocationSummary = result.allocations
        .map((entry) => `${entry.productName}: ${entry.broasPlanned} broa(s)`)
        .join(', ');

      return this.response(
        'OVEN_BATCH_STARTED',
        `Fornada iniciada. ${allocationSummary}. Forno ajustado para ${result.board.oven.bakeTimerMinutes} minutos.`,
        true,
        {
          batchId: result.batchId,
          readyAt: result.readyAt,
          requestedTimerMinutes: timerMinutes,
          allocations: result.allocations
        }
      );
    }

    return this.response(
      'UNSUPPORTED_INTENT',
      'Intencao ainda nao mapeada no bridge do QUEROBROAPP.',
      true,
      { intentName }
    );
  }

  private ensureBridgeSecurityConfig() {
    if (!this.alexaBridgeToken) {
      throw new BadRequestException('ALEXA_BRIDGE_TOKEN nao configurado para /alexa/bridge.');
    }

    if (this.requireSignature && !this.alexaBridgeHmacSecret) {
      throw new BadRequestException(
        'ALEXA_BRIDGE_HMAC_SECRET nao configurado e assinatura esta obrigatoria.'
      );
    }

    if (this.requireSkillIdAllowlist && this.allowedSkillIds.size === 0) {
      throw new BadRequestException(
        'ALEXA_ALLOWED_SKILL_IDS vazio. Defina allowlist para aceitar apenas skills autorizadas.'
      );
    }
  }

  private ensureBridgeToken(token?: string) {
    const provided = (token || '').trim();
    if (provided && provided === this.alexaBridgeToken) return;
    throw new BadRequestException(
      'Token invalido para /alexa/bridge. Envie x-alexa-token com ALEXA_BRIDGE_TOKEN.'
    );
  }

  private ensureSignedRequest(payload: unknown, signatureHeader?: string, timestampHeader?: string) {
    if (!this.requireSignature) return;

    const normalizedSignature = this.normalizeSignatureHeader(signatureHeader);
    if (!normalizedSignature) {
      throw new BadRequestException('Assinatura ausente/invalida. Envie x-alexa-signature (sha256=<hex>).');
    }

    const timestamp = this.parseRequestTimestamp(timestampHeader);
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSeconds - timestamp) > this.bridgeMaxSkewSeconds) {
      throw new BadRequestException('Timestamp fora da janela permitida para /alexa/bridge.');
    }

    this.cleanupReplayCache(nowSeconds);
    const replayKey = `${timestamp}:${normalizedSignature}`;
    const replayExpiry = this.replayCache.get(replayKey);
    if (replayExpiry && replayExpiry > nowSeconds) {
      throw new BadRequestException('Requisicao repetida detectada (replay).');
    }

    const canonicalPayload = this.stableStringify(payload);
    const expectedSignature = createHmac('sha256', this.alexaBridgeHmacSecret)
      .update(`${timestamp}.${canonicalPayload}`)
      .digest('hex');

    if (!this.secureCompareHex(normalizedSignature, expectedSignature)) {
      throw new BadRequestException('Assinatura invalida para /alexa/bridge.');
    }

    this.replayCache.set(replayKey, nowSeconds + this.bridgeReplayTtlSeconds);
  }

  private normalizeSignatureHeader(value?: string) {
    const normalized = (value || '').trim().replace(/^sha256=/i, '').trim();
    if (!/^[a-f0-9]{64}$/i.test(normalized)) return '';
    return normalized.toLowerCase();
  }

  private parseRequestTimestamp(rawValue?: string) {
    const value = (rawValue || '').trim();
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new BadRequestException('Timestamp invalido. Envie x-alexa-timestamp em epoch (segundos).');
    }
    return parsed;
  }

  private secureCompareHex(left: string, right: string) {
    if (!left || !right || left.length !== right.length) return false;
    try {
      return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
    } catch {
      return false;
    }
  }

  private cleanupReplayCache(nowSeconds: number) {
    for (const [key, expiresAt] of this.replayCache.entries()) {
      if (expiresAt <= nowSeconds) {
        this.replayCache.delete(key);
      }
    }
    while (this.replayCache.size > 10_000) {
      const oldestKey = this.replayCache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.replayCache.delete(oldestKey);
    }
  }

  private resolveAutomationAccessToken() {
    const token = this.automationsApiToken || this.receiptsApiToken || '';
    if (token) return token;
    if (this.isProduction) {
      throw new BadRequestException(
        'Nenhum token de automacao configurado. Defina AUTOMATIONS_API_TOKEN ou RECEIPTS_API_TOKEN.'
      );
    }
    return undefined;
  }

  private ensureAllowedSkillId(applicationId: string) {
    if (this.allowedSkillIds.size === 0) return;
    const id = (applicationId || '').trim();
    if (id && this.allowedSkillIds.has(id)) return;
    throw new BadRequestException(
      'applicationId nao autorizado para /alexa/bridge. Ajuste ALEXA_ALLOWED_SKILL_IDS.'
    );
  }

  private async ensureAccountLinked(accessToken: string) {
    const requiresLinking = this.alexaOauthService.isAccountLinkingRequired();
    const normalized = (accessToken || '').trim();

    if (!requiresLinking && !normalized) return;
    if (requiresLinking && !this.alexaOauthService.hasRequiredConfigForEnforcedLinking()) {
      throw new BadRequestException(
        'Account linking exigido, mas OAuth da Alexa nao esta configurado corretamente.'
      );
    }
    if (!normalized) {
      throw new BadRequestException('accessToken ausente. Vincule a conta da skill com o QUEROBROAPP.');
    }

    const token = await this.alexaOauthService.validateAccessToken(normalized);
    if (!token) {
      throw new BadRequestException('accessToken invalido ou expirado para a skill Alexa.');
    }
  }

  private normalizeSlots(rawSlots: Record<string, unknown>) {
    const normalized = new Map<string, string>();
    for (const [key, rawValue] of Object.entries(rawSlots || {})) {
      const normalizedKey = key.trim().toLowerCase();
      if (!normalizedKey) continue;

      const asString = this.slotValueToString(rawValue);
      if (!asString) continue;
      normalized.set(normalizedKey, asString);
    }
    return normalized;
  }

  private slotValueToString(rawValue: unknown) {
    if (typeof rawValue === 'string') return rawValue.trim();
    if (typeof rawValue === 'number' || typeof rawValue === 'boolean') return String(rawValue);
    if (!rawValue || typeof rawValue !== 'object') return '';

    const objectValue = rawValue as { value?: unknown };
    if (typeof objectValue.value === 'string') return objectValue.value.trim();
    if (typeof objectValue.value === 'number' || typeof objectValue.value === 'boolean') {
      return String(objectValue.value);
    }
    return '';
  }

  private pickSlotValue(slots: Map<string, string>, aliases: string[]) {
    for (const alias of aliases) {
      const value = slots.get(alias.toLowerCase());
      if (value) return value;
    }
    return '';
  }

  private normalizeAlexaDate(rawValue: string) {
    const value = (rawValue || '').trim();
    if (!value) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    return '';
  }

  private extractTimerMinutesFromAlexaIntent(
    intentName: string,
    slots: Map<string, string>,
    utterance: string
  ) {
    const explicitIntentNames = new Set([
      'StartNextBatchIntent',
      'StartOvenBatchIntent',
      'SetOvenTimerIntent'
    ]);
    const fromSlot = this.pickSlotValue(slots, ['minutes', 'minute', 'timer', 'minutos']);
    const fromSlotNumber = fromSlot ? Number.parseInt(fromSlot, 10) : NaN;
    if (explicitIntentNames.has(intentName) && Number.isFinite(fromSlotNumber) && fromSlotNumber > 0) {
      return Math.max(1, Math.min(240, fromSlotNumber));
    }

    const match = utterance.match(/(\d{1,3})\s*minutos?/i);
    if (match) {
      const parsed = Number.parseInt(match[1] || '', 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.max(1, Math.min(240, parsed));
      }
    }

    return null;
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

  private resolveBridgeMaxSkewSeconds() {
    const parsed = Number(process.env.ALEXA_BRIDGE_MAX_SKEW_SECONDS || 120);
    if (!Number.isFinite(parsed) || parsed <= 0) return 120;
    return Math.max(30, Math.min(300, Math.round(parsed)));
  }

  private resolveBridgeReplayTtlSeconds() {
    const parsed = Number(process.env.ALEXA_BRIDGE_REPLAY_TTL_SECONDS || 300);
    if (!Number.isFinite(parsed) || parsed <= 0) return 300;
    return Math.max(60, Math.min(3600, Math.round(parsed)));
  }

  private resolveBooleanEnv(rawValue: string | undefined, fallback: boolean) {
    if (rawValue == null) return fallback;
    const value = rawValue.trim().toLowerCase();
    if (!value) return fallback;
    if (['1', 'true', 'yes', 'on'].includes(value)) return true;
    if (['0', 'false', 'no', 'off'].includes(value)) return false;
    return fallback;
  }

  private response(
    action: string,
    speechText: string,
    shouldEndSession: boolean,
    data: Record<string, unknown>
  ): AlexaBridgeResponse {
    return {
      ok: true,
      action,
      speechText,
      shouldEndSession,
      data
    };
  }
}
