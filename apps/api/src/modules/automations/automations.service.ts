import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { ProductionService } from '../production/production.service.js';
import { ReceiptsService } from '../receipts/receipts.service.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '..', '..', '..', '..', '..');
const dataDir = path.join(repoRoot, 'data', 'automations');
const runsPath = path.join(dataDir, 'runs.json');

const automationStatusEnum = z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED']);
const automationSkillEnum = z.enum([
  'D1_PURCHASE_PLAN',
  'SUPPLIER_PRICE_SYNC',
  'RECEIPTS_BATCH_INGEST',
  'RUNBOOK_SHELL'
]);

const runbookShellCommandIdEnum = z.enum([
  'cleanup_test_data',
  'api_typecheck',
  'web_typecheck',
  'security_secrets_staged'
]);

const createRunSchema = z.object({
  skill: automationSkillEnum,
  objective: z.string().trim().min(1).max(220).optional(),
  input: z.unknown().optional(),
  autoStart: z.boolean().default(true),
  maxEvents: z.coerce.number().int().min(40).max(1000).default(250)
});

const listRunsQuerySchema = z.object({
  limit: z
    .preprocess((value) => (value == null || value === '' ? undefined : Number(value)), z.number().int().min(1).max(200))
    .optional(),
  status: automationStatusEnum.optional()
});

const d1PurchasePlanInputSchema = z.object({
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  maxSourcesPerItem: z.coerce.number().int().min(1).max(5).default(3),
  maxSearchResultsPerItem: z.coerce.number().int().min(3).max(10).default(6),
  syncSupplierPricesFirst: z.boolean().default(true)
});

const batchIngestItemSchema = z
  .object({
    id: z.string().trim().min(1).max(80).optional(),
    idempotencyKey: z.string().trim().min(1).max(120).optional(),
    imageBase64: z.string().trim().min(1).optional(),
    imageUrl: z.string().trim().url().optional(),
    mimeType: z.string().trim().min(1).optional(),
    providerHint: z.string().trim().min(1).max(120).optional(),
    sourceFriendly: z.string().trim().min(1).max(140).optional()
  })
  .refine((value) => Boolean(value.imageBase64 || value.imageUrl), {
    message: 'Cada item deve incluir imageBase64 ou imageUrl.'
  });

const receiptsBatchIngestInputSchema = z.object({
  continueOnError: z.boolean().default(true),
  items: z.array(batchIngestItemSchema).min(1).max(25)
});

const runbookShellInputSchema = z.object({
  commandId: runbookShellCommandIdEnum.default('cleanup_test_data'),
  timeoutMs: z.coerce.number().int().min(2_000).max(180_000).default(60_000)
});

type AutomationStatus = z.infer<typeof automationStatusEnum>;
type AutomationSkill = z.infer<typeof automationSkillEnum>;
type RunbookShellCommandId = z.infer<typeof runbookShellCommandIdEnum>;
type CreateRunInput = z.output<typeof createRunSchema>;
type D1PurchasePlanInput = z.output<typeof d1PurchasePlanInputSchema>;
type ReceiptsBatchIngestInput = z.output<typeof receiptsBatchIngestInputSchema>;
type RunbookShellInput = z.output<typeof runbookShellInputSchema>;

type RunEventType = 'info' | 'step' | 'warning' | 'error' | 'result' | 'compaction';

type AutomationRunEvent = {
  id: string;
  at: string;
  type: RunEventType;
  message: string;
  data: unknown;
};

type AutomationRunRecord = {
  id: string;
  skill: AutomationSkill;
  objective: string;
  status: AutomationStatus;
  createdAt: string;
  updatedAt: string;
  startedAt: string;
  finishedAt: string;
  maxEvents: number;
  compactionCount: number;
  compactedSummary: string;
  input: unknown;
  events: AutomationRunEvent[];
  result: unknown;
  error: string;
};

type PersistedRunsStore = {
  version: 1;
  runs: AutomationRunRecord[];
};

type ShellCommandDescriptor = {
  cmd: string;
  args: string[];
  description: string;
};

const shellCommands: Record<RunbookShellCommandId, ShellCommandDescriptor> = {
  cleanup_test_data: {
    cmd: 'pnpm',
    args: ['cleanup:test-data'],
    description: 'Limpa dados de teste marcados no banco local.'
  },
  api_typecheck: {
    cmd: 'pnpm',
    args: ['--filter', '@querobroapp/api', 'typecheck'],
    description: 'Executa typecheck estrito da API.'
  },
  web_typecheck: {
    cmd: 'pnpm',
    args: ['--filter', '@querobroapp/web', 'typecheck'],
    description: 'Executa typecheck estrito do web.'
  },
  security_secrets_staged: {
    cmd: 'pnpm',
    args: ['security:secrets:staged'],
    description: 'Audita segredos apenas em arquivos staged.'
  }
};

@Injectable()
export class AutomationsService {
  private readonly runs = new Map<string, AutomationRunRecord>();
  private readonly runningRunIds = new Set<string>();
  private readonly automationsApiToken = (process.env.AUTOMATIONS_API_TOKEN || '').trim();
  private readonly shellSkillEnabled = this.parseBooleanEnv(process.env.AUTOMATIONS_RUNBOOK_SHELL_ENABLED, false);
  private readonly shellSkillToken = (process.env.AUTOMATIONS_RUNBOOK_SHELL_TOKEN || '').trim();
  private loadPromise: Promise<void> | null = null;
  private persistChain = Promise.resolve();

  constructor(
    @Inject(ProductionService) private readonly productionService: ProductionService,
    @Inject(ReceiptsService) private readonly receiptsService: ReceiptsService
  ) {}

  async listRuns(query: { limit?: string; status?: string }, token?: string) {
    await this.ensureLoaded();
    this.ensureAutomationsToken(token);
    const parsed = listRunsQuerySchema.parse(query);
    const records = this.sortedRuns();
    const filtered = parsed.status ? records.filter((run) => run.status === parsed.status) : records;
    const limit = parsed.limit || 30;
    return {
      total: filtered.length,
      runs: filtered.slice(0, limit)
    };
  }

  async getRun(id: string, token?: string) {
    await this.ensureLoaded();
    this.ensureAutomationsToken(token);
    const run = this.runs.get(id);
    if (!run) {
      throw new NotFoundException('Automation run nao encontrado.');
    }
    return run;
  }

  async createRun(payload: unknown, token?: string) {
    await this.ensureLoaded();
    this.ensureAutomationsToken(token);
    const input = createRunSchema.parse(payload) as CreateRunInput;

    const now = new Date().toISOString();
    const run: AutomationRunRecord = {
      id: randomUUID(),
      skill: input.skill,
      objective: input.objective?.trim() || this.defaultObjective(input.skill),
      status: 'PENDING',
      createdAt: now,
      updatedAt: now,
      startedAt: '',
      finishedAt: '',
      maxEvents: input.maxEvents,
      compactionCount: 0,
      compactedSummary: '',
      input: input.input ?? {},
      events: [],
      result: null,
      error: ''
    };

    this.runs.set(run.id, run);
    await this.persistRunsStore();

    if (input.autoStart) {
      await this.startRun(run.id, token);
    }

    return run;
  }

  async startRun(runId: string, token?: string) {
    await this.ensureLoaded();
    this.ensureAutomationsToken(token);
    const run = this.runs.get(runId);
    if (!run) {
      throw new NotFoundException('Automation run nao encontrado.');
    }

    if (run.status === 'RUNNING') {
      return run;
    }

    if (this.runningRunIds.has(run.id)) {
      return run;
    }

    run.status = 'RUNNING';
    run.startedAt = new Date().toISOString();
    run.updatedAt = run.startedAt;
    run.finishedAt = '';
    run.error = '';
    run.result = null;
    run.events = [];
    run.compactionCount = 0;
    run.compactedSummary = '';
    this.runningRunIds.add(run.id);
    await this.persistRunsStore();

    const automationToken = this.resolveAutomationToken(token);

    void this.executeRun(run.id, automationToken)
      .catch((error) => {
        this.handleExecutionFailure(run.id, error).catch(() => undefined);
      })
      .finally(() => {
        this.runningRunIds.delete(run.id);
      });

    return run;
  }

  private async executeRun(runId: string, token?: string) {
    const run = this.requireRun(runId);

    await this.recordEvent(run, 'info', `Run iniciada para skill ${run.skill}`, {
      objective: run.objective
    });

    let result: unknown;

    if (run.skill === 'D1_PURCHASE_PLAN') {
      result = await this.executeD1PurchasePlan(run, token);
    } else if (run.skill === 'SUPPLIER_PRICE_SYNC') {
      result = await this.executeSupplierPriceSync(run, token);
    } else if (run.skill === 'RECEIPTS_BATCH_INGEST') {
      result = await this.executeReceiptsBatchIngest(run, token);
    } else {
      result = await this.executeRunbookShell(run, token);
    }

    run.status = 'COMPLETED';
    run.finishedAt = new Date().toISOString();
    run.updatedAt = run.finishedAt;
    run.result = result;
    run.error = '';

    await this.recordEvent(run, 'result', 'Run concluida com sucesso.', {
      skill: run.skill
    });

    await this.persistRunsStore();
  }

  private async executeD1PurchasePlan(run: AutomationRunRecord, token?: string) {
    const input = d1PurchasePlanInputSchema.parse((run.input || {}) as unknown) as D1PurchasePlanInput;

    await this.recordEvent(run, 'step', 'Calculando necessidades de producao D+1...');
    const requirements = await this.productionService.requirements(input.date);
    const shortages = requirements.rows.filter((row) => row.shortageQty > 0);

    await this.recordEvent(run, 'info', 'Necessidades de producao calculadas.', {
      date: requirements.date,
      shortageCount: shortages.length,
      warningCount: requirements.warnings.length
    });

    let syncSummary: unknown = null;
    if (input.syncSupplierPricesFirst) {
      await this.recordEvent(run, 'step', 'Sincronizando preco de fornecedores antes das recomendacoes...');
      try {
        const syncResult = await this.receiptsService.syncSupplierPrices(token);
        syncSummary = {
          appliedCount: syncResult.appliedCount,
          attemptedCount: syncResult.attemptedCount,
          skippedCount: syncResult.skippedCount
        };
        await this.recordEvent(run, 'info', 'Sincronizacao de fornecedores concluida.', syncSummary);
      } catch (error) {
        await this.recordEvent(run, 'warning', 'Falha na sincronizacao de fornecedores; continuando run.', {
          error: this.stringifyError(error)
        });
      }
    }

    if (shortages.length === 0) {
      return {
        date: requirements.date,
        shortageCount: 0,
        warningCount: requirements.warnings.length,
        warnings: requirements.warnings,
        syncSummary,
        recommendations: {
          itemCount: 0,
          items: []
        },
        suggestedActions: ['Sem faltas para D+1. Nao ha compras urgentes agora.']
      };
    }

    await this.recordEvent(run, 'step', 'Buscando recomendacoes de compra online para faltas D+1...');

    const recommendationPayload = {
      date: requirements.date,
      shortages: shortages.map((row) => ({
        ingredientId: row.ingredientId,
        shortageQty: row.shortageQty,
        requiredQty: row.requiredQty,
        availableQty: row.availableQty,
        name: row.name,
        unit: row.unit
      })),
      maxSourcesPerItem: input.maxSourcesPerItem,
      maxSearchResultsPerItem: input.maxSearchResultsPerItem
    };

    const recommendations = await this.receiptsService.recommendOnlineSupplierPrices(recommendationPayload, token);

    await this.recordEvent(run, 'info', 'Recomendacoes de compra geradas.', {
      itemCount: recommendations.itemCount
    });

    const suggestedActions = recommendations.items.map((item) => {
      if (!item.recommendedOffer) {
        return `${item.name}: sem oferta confiavel. Comprar manualmente ${item.neededPacks} pacote(s).`;
      }
      return `${item.name}: comprar ${item.neededPacks} pacote(s) em ${item.recommendedOffer.supplierName} (total estimado R$ ${item.recommendedOffer.estimatedTotal.toFixed(2)}).`;
    });

    return {
      date: requirements.date,
      shortageCount: shortages.length,
      warningCount: requirements.warnings.length,
      warnings: requirements.warnings,
      syncSummary,
      recommendations,
      suggestedActions
    };
  }

  private async executeSupplierPriceSync(run: AutomationRunRecord, token?: string) {
    await this.recordEvent(run, 'step', 'Executando sincronizacao de preco de fornecedores...');
    const result = await this.receiptsService.syncSupplierPrices(token);
    await this.recordEvent(run, 'info', 'Sincronizacao concluida.', {
      appliedCount: result.appliedCount,
      attemptedCount: result.attemptedCount,
      skippedCount: result.skippedCount
    });
    return result;
  }

  private async executeReceiptsBatchIngest(run: AutomationRunRecord, token?: string) {
    const input = receiptsBatchIngestInputSchema.parse((run.input || {}) as unknown) as ReceiptsBatchIngestInput;
    await this.recordEvent(run, 'step', 'Executando ingestao em lote de cupons...');
    const result = await this.receiptsService.ingestBatch(input, token);
    await this.recordEvent(run, 'info', 'Ingestao em lote concluida.', {
      total: result.total,
      okCount: result.okCount,
      errorCount: result.errorCount
    });
    return result;
  }

  private async executeRunbookShell(run: AutomationRunRecord, token?: string) {
    if (!this.shellSkillEnabled) {
      throw new BadRequestException(
        'Skill RUNBOOK_SHELL desabilitada. Defina AUTOMATIONS_RUNBOOK_SHELL_ENABLED=true para habilitar conscientemente.'
      );
    }

    if (this.shellSkillToken && (token || '').trim() !== this.shellSkillToken) {
      throw new BadRequestException('Token invalido para RUNBOOK_SHELL. Use x-receipts-token com token autorizado.');
    }

    const input = runbookShellInputSchema.parse((run.input || {}) as unknown) as RunbookShellInput;
    const command = shellCommands[input.commandId];

    await this.recordEvent(run, 'step', 'Executando comando shell allowlist...', {
      commandId: input.commandId,
      description: command.description
    });

    const shellResult = await this.runShellCommand(command, input.timeoutMs);

    await this.recordEvent(run, 'info', 'Comando shell finalizado.', {
      commandId: input.commandId,
      exitCode: shellResult.exitCode,
      durationMs: shellResult.durationMs
    });

    return {
      commandId: input.commandId,
      command: [command.cmd, ...command.args].join(' '),
      ...shellResult
    };
  }

  private async runShellCommand(command: ShellCommandDescriptor, timeoutMs: number) {
    return new Promise<{
      exitCode: number;
      signal: string;
      durationMs: number;
      stdout: string;
      stderr: string;
      timedOut: boolean;
    }>((resolve, reject) => {
      const startedAt = Date.now();
      const child = spawn(command.cmd, command.args, {
        cwd: repoRoot,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;

      const append = (current: string, chunk: Buffer | string) => {
        const next = `${current}${chunk.toString()}`;
        if (next.length <= 12_000) return next;
        return `${next.slice(0, 11_600)}\n...[truncado]`;
      };

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!settled) {
            child.kill('SIGKILL');
          }
        }, 2_000);
      }, timeoutMs);

      child.stdout?.on('data', (chunk) => {
        stdout = append(stdout, chunk);
      });
      child.stderr?.on('data', (chunk) => {
        stderr = append(stderr, chunk);
      });

      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(new InternalServerErrorException(`Falha ao executar shell skill: ${this.stringifyError(error)}`));
      });

      child.on('close', (code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);

        const exitCode = Number.isFinite(code) ? Number(code) : -1;
        const durationMs = Date.now() - startedAt;
        const resolved = {
          exitCode,
          signal: signal || '',
          durationMs,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          timedOut
        };

        if (exitCode !== 0) {
          reject(
            new BadRequestException(
              `Shell skill falhou (exit=${exitCode}). stderr=${this.compactText(resolved.stderr, 360)}`
            )
          );
          return;
        }

        resolve(resolved);
      });
    });
  }

  private defaultObjective(skill: AutomationSkill) {
    if (skill === 'D1_PURCHASE_PLAN') {
      return 'Gerar plano de compra D+1 com recomendacoes de fornecedor.';
    }
    if (skill === 'SUPPLIER_PRICE_SYNC') {
      return 'Sincronizar preco de fornecedores no estoque.';
    }
    if (skill === 'RECEIPTS_BATCH_INGEST') {
      return 'Executar ingestao em lote de cupons fiscais.';
    }
    return 'Executar runbook shell allowlist.';
  }

  private ensureAutomationsToken(token?: string) {
    const expected = this.resolveExpectedAutomationsToken();
    if (!expected) return;

    if ((token || '').trim() === expected) return;
    throw new BadRequestException(
      'Token invalido para /automations. Envie x-automations-token (ou x-receipts-token) com token autorizado.'
    );
  }

  private resolveExpectedAutomationsToken() {
    if (this.automationsApiToken) return this.automationsApiToken;
    const receiptsToken = (process.env.RECEIPTS_API_TOKEN || '').trim();
    if (receiptsToken) return receiptsToken;
    return '';
  }

  private resolveAutomationToken(token?: string) {
    const receiptsToken = (process.env.RECEIPTS_API_TOKEN || '').trim();
    if (receiptsToken) return receiptsToken;

    const incoming = (token || '').trim();
    if (incoming) return incoming;
    if (this.automationsApiToken) return this.automationsApiToken;
    return undefined;
  }

  private requireRun(id: string) {
    const run = this.runs.get(id);
    if (!run) {
      throw new NotFoundException('Automation run nao encontrado.');
    }
    return run;
  }

  private async recordEvent(run: AutomationRunRecord, type: RunEventType, message: string, data: unknown = null) {
    const now = new Date().toISOString();
    run.events.push({
      id: randomUUID(),
      at: now,
      type,
      message,
      data
    });
    run.updatedAt = now;
    this.compactEvents(run);
    await this.persistRunsStore();
  }

  private compactEvents(run: AutomationRunRecord) {
    const max = run.maxEvents;
    if (run.events.length <= max) return;

    const preserveTail = Math.max(24, Math.floor(max * 0.55));
    const toCompact = run.events.slice(0, Math.max(0, run.events.length - preserveTail));
    const tail = run.events.slice(-preserveTail);
    if (toCompact.length === 0) return;

    const counters: Record<RunEventType, number> = {
      info: 0,
      step: 0,
      warning: 0,
      error: 0,
      result: 0,
      compaction: 0
    };

    for (const event of toCompact) {
      counters[event.type] += 1;
    }

    run.compactionCount += 1;
    const latest = toCompact[toCompact.length - 1];
    const summary = `Compaction #${run.compactionCount}: ${toCompact.length} eventos resumidos (step=${counters.step}, info=${counters.info}, warning=${counters.warning}, error=${counters.error}). Ultimo=${this.compactText(latest.message, 120)}.`;

    run.compactedSummary = [run.compactedSummary, summary].filter(Boolean).join('\n');
    run.events = [
      {
        id: randomUUID(),
        at: new Date().toISOString(),
        type: 'compaction',
        message: summary,
        data: {
          compactedEvents: toCompact.length,
          counters
        }
      },
      ...tail
    ];
  }

  private async handleExecutionFailure(runId: string, error: unknown) {
    await this.ensureLoaded();
    const run = this.runs.get(runId);
    if (!run) return;

    const errorMessage = this.stringifyError(error);

    run.status = 'FAILED';
    run.error = errorMessage;
    run.finishedAt = new Date().toISOString();
    run.updatedAt = run.finishedAt;

    await this.recordEvent(run, 'error', 'Run encerrada com falha.', {
      error: errorMessage
    });

    await this.persistRunsStore();
  }

  private sortedRuns() {
    return [...this.runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private async ensureLoaded() {
    if (!this.loadPromise) {
      this.loadPromise = this.loadRunsStore();
    }
    await this.loadPromise;
  }

  private async loadRunsStore() {
    await fs.mkdir(dataDir, { recursive: true });
    const raw = await fs.readFile(runsPath, 'utf8').catch(() => '');
    if (!raw.trim()) {
      await this.persistRunsStore();
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }

    const store = z
      .object({
        version: z.literal(1).default(1),
        runs: z.array(
          z.object({
            id: z.string().min(1),
            skill: automationSkillEnum,
            objective: z.string().min(1),
            status: automationStatusEnum,
            createdAt: z.string(),
            updatedAt: z.string(),
            startedAt: z.string(),
            finishedAt: z.string(),
            maxEvents: z.number().int().min(40).max(1000).default(250),
            compactionCount: z.number().int().nonnegative().default(0),
            compactedSummary: z.string().default(''),
            input: z.unknown().default({}),
            events: z
              .array(
                z.object({
                  id: z.string().min(1),
                  at: z.string(),
                  type: z.enum(['info', 'step', 'warning', 'error', 'result', 'compaction']),
                  message: z.string().min(1),
                  data: z.unknown().nullable().optional()
                })
              )
              .default([]),
            result: z.unknown().nullable().optional(),
            error: z.string().default('')
          })
        )
      })
      .parse(parsed) as PersistedRunsStore;

    this.runs.clear();
    for (const run of store.runs) {
      this.runs.set(run.id, {
        ...run,
        result: run.result ?? null,
        events: run.events.map((event) => ({
          ...event,
          data: event.data ?? null
        }))
      });
    }

    let normalized = false;
    for (const run of this.runs.values()) {
      if (run.status === 'RUNNING') {
        run.status = 'FAILED';
        run.error = 'Run interrompida por reinicio do servidor.';
        run.finishedAt = new Date().toISOString();
        run.updatedAt = run.finishedAt;
        normalized = true;
      }
    }

    if (normalized) {
      await this.persistRunsStore();
    }
  }

  private async persistRunsStore() {
    await fs.mkdir(dataDir, { recursive: true });
    const payload: PersistedRunsStore = {
      version: 1,
      runs: this.sortedRuns()
    };

    this.persistChain = this.persistChain
      .then(async () => {
        await fs.writeFile(runsPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      })
      .catch(() => undefined);

    await this.persistChain;
  }

  private parseBooleanEnv(rawValue: string | undefined, fallback: boolean) {
    if (rawValue == null) return fallback;
    const normalized = rawValue.trim().toLowerCase();
    if (!normalized) return fallback;
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
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
