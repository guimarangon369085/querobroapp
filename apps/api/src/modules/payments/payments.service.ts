import { BadRequestException, Injectable, NotFoundException, Inject } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../prisma.service.js';
import {
  moneyToMinorUnits,
  OpenFinancePixWebhookSchema,
  PaymentSchema,
  PaymentStatusEnum,
  PixReconciliationWebhookSchema,
  PixSettlementWebhookSchema,
  PixChargeSchema,
  roundMoney
} from '@querobroapp/shared';
import { readBusinessRuntimeProfile } from '../../common/business-profile.js';

type TransactionClient = Prisma.TransactionClient;
type PaymentRecord = {
  id: number;
  orderId: number;
  amount: number;
  method: string;
  status: string;
  paidAt: Date | null;
  dueDate: Date | null;
  providerRef: string | null;
};
type PendingPixPaymentCandidate = PaymentRecord & {
  order: {
    id: number;
    publicNumber: number | null;
    status: string;
    total: number;
    createdAt: Date;
    customer: {
      id: number;
      name: string;
      phone: string | null;
    } | null;
  };
};

const PIX_RECONCILIATION_NAME_STOPWORDS = new Set(['DA', 'DAS', 'DE', 'DI', 'DO', 'DOS', 'DU', 'E']);
const OPEN_FINANCE_PIX_WEBHOOK_SCOPE = 'OPEN_FINANCE_PIX_WEBHOOK';
const PLUGGY_WEBHOOK_EVENT_SCOPE = 'PLUGGY_WEBHOOK_EVENT';

const PluggyWebhookSchema = z.object({
  event: z.string().trim().min(1).max(120),
  eventId: z.string().trim().min(1).max(160),
  itemId: z.string().trim().min(1).max(160).optional().nullable(),
  accountId: z.string().trim().min(1).max(160).optional().nullable(),
  clientUserId: z.string().trim().min(1).max(160).optional().nullable(),
  triggeredBy: z.string().trim().min(1).max(40).optional().nullable(),
  transactionIds: z.array(z.string().trim().min(1).max(160)).optional(),
  createdTransactionsLink: z.string().trim().url().optional().nullable()
});

const PluggyTransactionSchema = z.object({
  id: z.string().trim().min(1).max(160),
  accountId: z.string().trim().min(1).max(160).optional().nullable(),
  description: z.string().trim().optional().nullable(),
  amount: z.number(),
  date: z.string().trim().min(1),
  type: z.string().trim().optional().nullable(),
  status: z.string().trim().optional().nullable(),
  paymentData: z
    .object({
      payer: z
        .object({
          name: z.string().trim().optional().nullable(),
          documentNumber: z
            .object({
              type: z.string().trim().optional().nullable(),
              value: z.string().trim().optional().nullable()
            })
            .optional()
            .nullable()
        })
        .optional()
        .nullable(),
      receiver: z
        .object({
          name: z.string().trim().optional().nullable()
        })
        .optional()
        .nullable(),
      referenceNumber: z.string().trim().optional().nullable(),
      receiverReferenceId: z.string().trim().optional().nullable(),
      paymentMethod: z.string().trim().optional().nullable(),
      reason: z.string().trim().optional().nullable()
    })
    .optional()
    .nullable()
});

type PluggyTransaction = z.infer<typeof PluggyTransactionSchema>;

@Injectable()
export class PaymentsService {
  private pluggyApiKeyCache: { apiKey: string; expiresAt: number } | null = null;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private toMoney(value: number) {
    return roundMoney(value);
  }

  private getConfiguredPixProvider() {
    const explicit = (process.env.PIX_PROVIDER || '').trim().toUpperCase();
    if (explicit === 'STATIC_PIX') return 'STATIC_PIX' as const;
    if (explicit === 'LOCAL_DEV') return 'LOCAL_DEV' as const;
    if (this.hasStaticPixConfig()) return 'STATIC_PIX' as const;
    return 'LOCAL_DEV' as const;
  }

  private hasStaticPixConfig() {
    return Boolean(
      (process.env.PIX_STATIC_KEY || '').trim() &&
        (process.env.PIX_RECEIVER_NAME || '').trim() &&
        (process.env.PIX_RECEIVER_CITY || '').trim()
    );
  }

  private pad2(value: number) {
    return String(value).padStart(2, '0');
  }

  private pixField(id: string, value: string) {
    return `${id}${this.pad2(value.length)}${value}`;
  }

  private sanitizePixText(value: string, maxLength: number) {
    const normalized = value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9 .,/:-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return normalized.slice(0, maxLength) || 'QUERO BROA';
  }

  private crc16Ccitt(payload: string) {
    let crc = 0xffff;

    for (let i = 0; i < payload.length; i += 1) {
      crc ^= payload.charCodeAt(i) << 8;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
      }
    }

    return crc.toString(16).toUpperCase().padStart(4, '0');
  }

  private stablePixTxid(orderId: number, paymentId: number) {
    const orderPart = orderId.toString(36).toUpperCase();
    const paymentPart = paymentId.toString(36).toUpperCase();
    return `QB${orderPart}P${paymentPart}`.slice(0, 25);
  }

  private buildProviderRef(provider: 'STATIC_PIX' | 'LOCAL_DEV', txid: string) {
    return `${provider}:${txid}`;
  }

  private parseProviderRef(providerRef?: string | null) {
    const raw = providerRef?.trim();
    if (!raw) return null;
    const separator = raw.indexOf(':');
    if (separator <= 0) return null;
    const provider = raw.slice(0, separator).toUpperCase();
    const txid = raw.slice(separator + 1).trim();
    if (!txid) return null;
    if (provider !== 'STATIC_PIX' && provider !== 'LOCAL_DEV') return null;
    return { provider: provider as 'STATIC_PIX' | 'LOCAL_DEV', txid };
  }

  private buildStaticPixCopyPaste(input: { txid: string; amount: number }) {
    const businessProfile = readBusinessRuntimeProfile();
    const pixKey = this.normalizeStaticPixKey(businessProfile.pixKey || process.env.PIX_STATIC_KEY || '');
    const receiverName = this.sanitizePixText(
      businessProfile.brandName || process.env.PIX_RECEIVER_NAME || 'QUEROBROA',
      25
    );
    const receiverCity = this.sanitizePixText(
      businessProfile.city || process.env.PIX_RECEIVER_CITY || 'SAO PAULO',
      15
    );
    const descriptionPrefix = this.sanitizePixText(process.env.PIX_DESCRIPTION_PREFIX || 'PEDIDO', 20);
    const amount = this.toMoney(input.amount);
    const description = `${descriptionPrefix} ${input.txid}`.slice(0, 60).trim();

    const merchantAccountInfo =
      this.pixField('00', 'br.gov.bcb.pix') +
      this.pixField('01', pixKey) +
      this.pixField('02', description);

    const additionalData = this.pixField('05', input.txid);

    const payload =
      this.pixField('00', '01') +
      this.pixField('01', '11') +
      this.pixField('26', merchantAccountInfo) +
      this.pixField('52', '0000') +
      this.pixField('53', '986') +
      this.pixField('54', amount.toFixed(2)) +
      this.pixField('58', 'BR') +
      this.pixField('59', receiverName) +
      this.pixField('60', receiverCity) +
      this.pixField('62', additionalData) +
      '6304';

    return `${payload}${this.crc16Ccitt(payload)}`;
  }

  private normalizeStaticPixKey(value: string) {
    const raw = value.trim();
    if (!raw) return '';
    if (raw.includes('@')) return raw.toLowerCase();
    if (/^[0-9a-fA-F-]{32,}$/i.test(raw)) return raw;

    const digits = raw.replace(/\D/g, '');
    if (digits.length === 10 || digits.length === 11) {
      return `+55${digits}`;
    }
    if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
      return `+${digits}`;
    }

    return raw;
  }

  private getPixReconciliationLookbackDays() {
    const raw = Number(process.env.PIX_RECONCILIATION_LOOKBACK_DAYS || '');
    if (!Number.isFinite(raw) || raw <= 0) return 45;
    return Math.min(Math.floor(raw), 180);
  }

  private allowUniqueAmountFallbackForPixReconciliation() {
    return String(process.env.PIX_RECONCILIATION_ALLOW_UNIQUE_AMOUNT_FALLBACK || '')
      .trim()
      .toLowerCase() === 'true';
  }

  private normalizeHumanName(value?: string | null) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private tokenizeHumanName(value?: string | null) {
    return this.normalizeHumanName(value)
      .split(' ')
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && !PIX_RECONCILIATION_NAME_STOPWORDS.has(token));
  }

  private compareHumanNames(left?: string | null, right?: string | null) {
    const normalizedLeft = this.normalizeHumanName(left);
    const normalizedRight = this.normalizeHumanName(right);
    if (!normalizedLeft || !normalizedRight) return 0;
    if (normalizedLeft === normalizedRight) return 1;
    if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) return 0.92;

    const leftTokens = this.tokenizeHumanName(left);
    const rightTokens = this.tokenizeHumanName(right);
    if (!leftTokens.length || !rightTokens.length) return 0;

    const rightSet = new Set(rightTokens);
    const intersection = leftTokens.filter((token) => rightSet.has(token)).length;
    const overlap = intersection / Math.max(leftTokens.length, rightTokens.length);
    const firstMatches = leftTokens[0] === rightTokens[0];
    const lastMatches = leftTokens[leftTokens.length - 1] === rightTokens[rightTokens.length - 1];

    let score = overlap;
    if (firstMatches) score += 0.15;
    if (lastMatches) score += 0.15;
    return Math.min(score, 0.99);
  }

  private summarizePixReconciliationCandidate(candidate: PendingPixPaymentCandidate, score: number) {
    return {
      paymentId: candidate.id,
      orderId: candidate.order.id,
      publicNumber: candidate.order.publicNumber ?? candidate.order.id,
      customerName: candidate.order.customer?.name ?? 'Cliente sem nome',
      amount: this.toMoney(candidate.amount),
      createdAt: candidate.order.createdAt.toISOString(),
      dueAt: candidate.dueDate?.toISOString() ?? null,
      nameScore: Number(score.toFixed(3))
    };
  }

  private hashWebhookPayload(payload: unknown) {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  private getPluggyApiBaseUrl() {
    return String(process.env.PLUGGY_API_URL || 'https://api.pluggy.ai').trim().replace(/\/$/, '');
  }

  private hasPluggyApiConfig() {
    return Boolean(
      String(process.env.PLUGGY_CLIENT_ID || '').trim() && String(process.env.PLUGGY_CLIENT_SECRET || '').trim()
    );
  }

  private isPluggyPixTransaction(transaction: PluggyTransaction) {
    const method = String(transaction.paymentData?.paymentMethod || '')
      .trim()
      .toUpperCase();
    const description = this.normalizeHumanName(transaction.description || transaction.paymentData?.reason || '');
    const type = String(transaction.type || '')
      .trim()
      .toUpperCase();

    if (transaction.amount <= 0) return false;
    if (type && type !== 'CREDIT') return false;
    if (method === 'PIX') return true;
    return description.includes('PIX');
  }

  private normalizePluggyTransactionStatus(status?: string | null) {
    const normalized = String(status || '')
      .trim()
      .toUpperCase();
    if (normalized === 'POSTED' || normalized === 'BOOKED') return 'BOOKED' as const;
    if (normalized === 'PENDING') return 'PENDING' as const;
    if (normalized === 'CANCELED' || normalized === 'CANCELLED') return 'CANCELED' as const;
    return 'BOOKED' as const;
  }

  private normalizeIsoDateWithOffset(value: string) {
    const raw = String(value || '').trim();
    if (!raw) {
      throw new BadRequestException('Transacao bancaria sem data valida.');
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return `${raw}T12:00:00-03:00`;
    }
    const parsed = new Date(raw);
    if (!Number.isFinite(parsed.getTime())) {
      throw new BadRequestException('Transacao bancaria com data invalida.');
    }
    return parsed.toISOString();
  }

  private async getPluggyApiKey() {
    if (!this.hasPluggyApiConfig()) {
      throw new BadRequestException('PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET obrigatorios para integrar a Pluggy.');
    }

    if (this.pluggyApiKeyCache && this.pluggyApiKeyCache.expiresAt > Date.now() + 60_000) {
      return this.pluggyApiKeyCache.apiKey;
    }

    const response = await fetch(`${this.getPluggyApiBaseUrl()}/auth`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        clientId: String(process.env.PLUGGY_CLIENT_ID || '').trim(),
        clientSecret: String(process.env.PLUGGY_CLIENT_SECRET || '').trim()
      })
    });

    const raw = await response.text();
    let body: Record<string, unknown> | null = null;
    try {
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    } catch {}

    if (!response.ok) {
      throw new BadRequestException(`Pluggy auth falhou: HTTP ${response.status} ${response.statusText}`);
    }

    const apiKey = String(body?.apiKey || '').trim();
    if (!apiKey) {
      throw new BadRequestException('Pluggy auth respondeu sem apiKey.');
    }

    this.pluggyApiKeyCache = {
      apiKey,
      expiresAt: Date.now() + 110 * 60_000
    };

    return apiKey;
  }

  private async pluggyFetchJson<T>(url: string) {
    const apiKey = await this.getPluggyApiKey();
    const response = await fetch(url, {
      headers: {
        'x-api-key': apiKey
      }
    });
    const raw = await response.text();
    let body: unknown = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = raw;
    }

    if (!response.ok) {
      throw new BadRequestException(`Pluggy request falhou: HTTP ${response.status} ${response.statusText}`);
    }

    return body as T;
  }

  private buildPluggyTransactionsUrlByIds(ids: string[]) {
    const url = new URL(`${this.getPluggyApiBaseUrl()}/transactions`);
    url.searchParams.set('ids', ids.join(','));
    return url.toString();
  }

  private async fetchPluggyTransactionsFromCreatedLink(createdTransactionsLink: string) {
    const collected: PluggyTransaction[] = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      const url = new URL(createdTransactionsLink);
      url.searchParams.set('page', String(page));
      const payload = await this.pluggyFetchJson<{
        total?: number;
        totalPages?: number;
        page?: number;
        results?: unknown[];
      }>(url.toString());
      const results = Array.isArray(payload?.results) ? payload.results : [];
      collected.push(...results.map((entry) => PluggyTransactionSchema.parse(entry)));
      totalPages = Number(payload?.totalPages || 1);
      page += 1;
    }

    return collected;
  }

  private async fetchPluggyTransactionsByIds(ids: string[]) {
    if (!ids.length) return [];
    const payload = await this.pluggyFetchJson<unknown[]>(this.buildPluggyTransactionsUrlByIds(ids));
    return (Array.isArray(payload) ? payload : []).map((entry) => PluggyTransactionSchema.parse(entry));
  }

  private mapPluggyTransactionToOpenFinanceEvent(
    webhook: z.infer<typeof PluggyWebhookSchema>,
    transaction: PluggyTransaction
  ) {
    const payerName =
      transaction.paymentData?.payer?.name?.trim() ||
      transaction.description?.trim() ||
      transaction.paymentData?.reason?.trim();

    if (!payerName) {
      return null;
    }

    return {
      provider: 'PLUGGY' as const,
      eventId: `${webhook.eventId}:${transaction.id}`,
      transactionId: transaction.id,
      accountId: transaction.accountId || webhook.accountId || null,
      rail: 'PIX' as const,
      direction: 'INCOMING' as const,
      status: this.normalizePluggyTransactionStatus(transaction.status),
      amount: this.toMoney(transaction.amount),
      bookedAt: this.normalizeIsoDateWithOffset(transaction.date),
      payerName,
      payerDocument: transaction.paymentData?.payer?.documentNumber?.value?.trim() || null,
      endToEndId: transaction.paymentData?.referenceNumber?.trim() || null,
      txid: transaction.paymentData?.receiverReferenceId?.trim() || null,
      description: transaction.description?.trim() || transaction.paymentData?.reason?.trim() || null,
      metadata: {
        pluggyWebhookEvent: webhook.event,
        pluggyWebhookEventId: webhook.eventId,
        pluggyItemId: webhook.itemId ?? null,
        pluggyTriggeredBy: webhook.triggeredBy ?? null
      }
    };
  }

  private async findWebhookReplay(scope: string, idemKey: string, requestHash: string) {
    const existing = await this.prisma.idempotencyRecord.findFirst({
      where: {
        scope,
        idemKey
      }
    });
    if (!existing) return null;
    if (existing.requestHash !== requestHash) {
      throw new BadRequestException('Evento bancario reutilizado com payload divergente.');
    }
    return JSON.parse(existing.responseJson);
  }

  private async rememberWebhookResult(scope: string, idemKey: string, requestHash: string, response: unknown) {
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 12);

    try {
      await this.prisma.idempotencyRecord.create({
        data: {
          scope,
          idemKey,
          requestHash,
          responseJson: JSON.stringify(response),
          expiresAt
        }
      });
      return response;
    } catch {
      const replay = await this.findWebhookReplay(scope, idemKey, requestHash);
      if (replay) {
        return {
          ...replay,
          replayed: true
        };
      }
      throw new BadRequestException('Nao foi possivel registrar a idempotencia do evento bancario.');
    }
  }

  private async findPendingPixReconciliationCandidates(amount: number) {
    const lookbackStart = new Date();
    lookbackStart.setDate(lookbackStart.getDate() - this.getPixReconciliationLookbackDays());

    return (await this.prisma.payment.findMany({
      where: {
        method: 'pix',
        amount: this.toMoney(amount),
        paidAt: null,
        status: { not: PaymentStatusEnum.enum.PAGO },
        order: {
          status: { not: 'CANCELADO' },
          createdAt: { gte: lookbackStart }
        }
      },
      include: {
        order: {
          select: {
            id: true,
            publicNumber: true,
            status: true,
            total: true,
            createdAt: true,
            customer: {
              select: {
                id: true,
                name: true,
                phone: true
              }
            }
          }
        }
      },
      orderBy: [{ id: 'desc' }]
    })) as PendingPixPaymentCandidate[];
  }

  buildPixCharge(payment: PaymentRecord) {
    const parsed = this.parseProviderRef(payment.providerRef);
    const provider = parsed?.provider ?? this.getConfiguredPixProvider();
    const txid = parsed?.txid ?? this.stablePixTxid(payment.orderId, payment.id);
    const providerRef = parsed?.txid
      ? parsed.provider === provider
        ? payment.providerRef || this.buildProviderRef(provider, txid)
        : this.buildProviderRef(parsed.provider, txid)
      : this.buildProviderRef(provider, txid);

    if (provider === 'STATIC_PIX' && this.hasStaticPixConfig()) {
      return PixChargeSchema.parse({
        provider,
        providerRef,
        txid,
        copyPasteCode: this.buildStaticPixCopyPaste({
          txid,
          amount: payment.amount
        }),
        expiresAt: payment.dueDate?.toISOString() ?? null,
        payable: true
      });
    }

    return PixChargeSchema.parse({
      provider: 'LOCAL_DEV',
      providerRef: this.buildProviderRef('LOCAL_DEV', txid),
      txid,
      copyPasteCode: `LOCALDEV|PIX|${txid}|${this.toMoney(payment.amount).toFixed(2)}`,
      expiresAt: payment.dueDate?.toISOString() ?? null,
      payable: false
    });
  }

  private normalizePayment(payment: PaymentRecord) {
    const pixCharge = payment.method === 'pix' ? this.buildPixCharge(payment) : null;

    return PaymentSchema.parse({
      ...payment,
      method: 'pix',
      paidAt: payment.paidAt?.toISOString() ?? null,
      dueDate: payment.dueDate?.toISOString() ?? null,
      providerRef: payment.providerRef,
      pixCharge
    });
  }

  private async getPaidTotal(
    tx: TransactionClient,
    orderId: number,
    excludePaymentId?: number
  ) {
    const where: Prisma.PaymentWhereInput = {
      orderId,
      status: PaymentStatusEnum.enum.PAGO
    };

    if (excludePaymentId) {
      where.id = { not: excludePaymentId };
    }

    const aggregation = await tx.payment.aggregate({
      where,
      _sum: { amount: true }
    });

    return this.toMoney(aggregation._sum.amount ?? 0);
  }

  private ensureWithinOrderTotal(orderTotal: number, paidCurrent: number, amountToAdd: number) {
    const nextPaid = moneyToMinorUnits(paidCurrent) + moneyToMinorUnits(amountToAdd);
    if (nextPaid > moneyToMinorUnits(orderTotal)) {
      throw new BadRequestException(
        `Pagamento excede o total do pedido. Total=${this.toMoney(orderTotal)} PagoAtual=${paidCurrent} NovoPagamento=${amountToAdd}`
      );
    }
  }

  async ensurePixChargeOnRecord(tx: TransactionClient, payment: PaymentRecord) {
    if (payment.method !== 'pix' || payment.status === PaymentStatusEnum.enum.PAGO || payment.paidAt) {
      return payment;
    }

    const currentProviderRef = this.parseProviderRef(payment.providerRef)
      ? payment.providerRef
      : this.buildProviderRef(this.getConfiguredPixProvider(), this.stablePixTxid(payment.orderId, payment.id));

    if (currentProviderRef === payment.providerRef) {
      return {
        ...payment,
        providerRef: currentProviderRef
      };
    }

    return tx.payment.update({
      where: { id: payment.id },
      data: { providerRef: currentProviderRef }
    }) as Promise<PaymentRecord>;
  }

  async getPaymentPixCharge(paymentId: number) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) {
      throw new NotFoundException('Pagamento nao encontrado.');
    }

    const normalized =
      payment.status !== PaymentStatusEnum.enum.PAGO && !payment.paidAt
        ? await this.prisma.$transaction((tx) => this.ensurePixChargeOnRecord(tx, payment as PaymentRecord))
        : (payment as PaymentRecord);

    return this.buildPixCharge(normalized);
  }

  async getOrderPixCharge(orderId: number) {
    const payments = await this.prisma.payment.findMany({
      where: { orderId, method: 'pix' },
      orderBy: { id: 'desc' }
    });
    const payment =
      payments.find((entry) => entry.status !== PaymentStatusEnum.enum.PAGO && !entry.paidAt) ?? payments[0];

    if (!payment) {
      throw new NotFoundException('Pedido nao possui cobranca PIX.');
    }

    const normalized =
      payment.status !== PaymentStatusEnum.enum.PAGO && !payment.paidAt
        ? await this.prisma.$transaction((tx) => this.ensurePixChargeOnRecord(tx, payment as PaymentRecord))
        : (payment as PaymentRecord);

    return this.buildPixCharge(normalized);
  }

  list() {
    return this.prisma.payment
      .findMany({ orderBy: { id: 'desc' } })
      .then((payments) => payments.map((payment) => this.normalizePayment(payment as PaymentRecord)));
  }

  private async findPaymentForSettlement(
    tx: TransactionClient,
    input: {
      paymentId?: number | null;
      orderId?: number | null;
      txid?: string | null;
      providerRef?: string | null;
    }
  ) {
    if (input.paymentId) {
      const payment = await tx.payment.findUnique({ where: { id: input.paymentId } });
      return payment as PaymentRecord | null;
    }

    if (input.providerRef) {
      const payment = await tx.payment.findFirst({
        where: {
          method: 'pix',
          providerRef: input.providerRef,
          ...(input.orderId ? { orderId: input.orderId } : {})
        },
        orderBy: [{ id: 'desc' }]
      });
      return payment as PaymentRecord | null;
    }

    if (input.txid) {
      const payment = await tx.payment.findFirst({
        where: {
          method: 'pix',
          providerRef: {
            endsWith: `:${input.txid}`
          },
          ...(input.orderId ? { orderId: input.orderId } : {})
        },
        orderBy: [{ id: 'desc' }]
      });
      return payment as PaymentRecord | null;
    }

    return null;
  }

  async reconcilePixWebhook(payload: unknown) {
    const data = PixReconciliationWebhookSchema.parse(payload);
    const candidates = await this.findPendingPixReconciliationCandidates(data.amount);
    const scoredCandidates = candidates.map((candidate) => ({
      candidate,
      score: this.compareHumanNames(candidate.order.customer?.name, data.payerName)
    }));
    const strongMatches = scoredCandidates.filter((entry) => entry.score >= 0.74);

    const exactCandidate =
      strongMatches.length === 1
        ? strongMatches[0]
        : strongMatches.length === 0 &&
            scoredCandidates.length === 1 &&
            this.allowUniqueAmountFallbackForPixReconciliation()
          ? scoredCandidates[0]
          : null;

    if (!exactCandidate) {
      return {
        ok: true,
        matched: false,
        reason: strongMatches.length > 1 || scoredCandidates.length > 1 ? 'AMBIGUOUS' : 'NO_MATCH',
        payerName: data.payerName,
        amount: this.toMoney(data.amount),
        candidateCount: scoredCandidates.length,
        candidates: scoredCandidates.map((entry) =>
          this.summarizePixReconciliationCandidate(entry.candidate, entry.score)
        )
      };
    }

    const settlement = await this.settlePixWebhook({
      paymentId: exactCandidate.candidate.id,
      amount: data.amount,
      paidAt: data.paidAt ?? null,
      source: data.source,
      metadata: {
        payerName: data.payerName,
        sourceTransactionId: data.sourceTransactionId ?? null,
        ...(data.metadata || {})
      }
    });

    return {
      ...settlement,
      matched: true,
      matchReason: strongMatches.length === 1 ? 'NAME_AND_AMOUNT' : 'UNIQUE_AMOUNT',
      matchConfidence: Number(exactCandidate.score.toFixed(3)),
      payerName: data.payerName,
      sourceTransactionId: data.sourceTransactionId ?? null,
      order: {
        id: exactCandidate.candidate.order.id,
        publicNumber: exactCandidate.candidate.order.publicNumber ?? exactCandidate.candidate.order.id,
        customerName: exactCandidate.candidate.order.customer?.name ?? 'Cliente sem nome',
        total: this.toMoney(exactCandidate.candidate.order.total)
      }
    };
  }

  async ingestOpenFinancePixWebhook(payload: unknown) {
    const data = OpenFinancePixWebhookSchema.parse(payload);
    const idemKey = `${data.provider}:${data.eventId}`;
    const requestHash = this.hashWebhookPayload(data);
    const replay = await this.findWebhookReplay(OPEN_FINANCE_PIX_WEBHOOK_SCOPE, idemKey, requestHash);
    if (replay) {
      return {
        ...replay,
        replayed: true
      };
    }

    const sourceTransactionId = data.transactionId || data.endToEndId || data.txid || data.eventId;
    const baseResponse = {
      ok: true,
      provider: data.provider,
      eventId: data.eventId,
      sourceTransactionId
    };

    if (data.status !== 'BOOKED') {
      return this.rememberWebhookResult(OPEN_FINANCE_PIX_WEBHOOK_SCOPE, idemKey, requestHash, {
        ...baseResponse,
        ignored: true,
        reason: 'STATUS_NOT_BOOKED'
      });
    }

    if (data.direction !== 'INCOMING') {
      return this.rememberWebhookResult(OPEN_FINANCE_PIX_WEBHOOK_SCOPE, idemKey, requestHash, {
        ...baseResponse,
        ignored: true,
        reason: 'DIRECTION_NOT_INCOMING'
      });
    }

    if (data.rail !== 'PIX') {
      return this.rememberWebhookResult(OPEN_FINANCE_PIX_WEBHOOK_SCOPE, idemKey, requestHash, {
        ...baseResponse,
        ignored: true,
        reason: 'RAIL_NOT_PIX'
      });
    }

    let result: Record<string, unknown> | null = null;
    let matchedViaTxid = false;
    if (data.txid) {
      try {
        result = (await this.settlePixWebhook({
          txid: data.txid,
          amount: data.amount,
          paidAt: data.bookedAt,
          source: 'open-finance-webhook',
          metadata: {
            provider: data.provider,
            eventId: data.eventId,
            transactionId: data.transactionId ?? null,
            endToEndId: data.endToEndId ?? null,
            payerDocument: data.payerDocument ?? null,
            description: data.description ?? null,
            ...(data.metadata || {})
          }
        })) as Record<string, unknown>;
        matchedViaTxid = true;
      } catch (error) {
        if (!(error instanceof NotFoundException)) {
          throw error;
        }
      }
    }

    if (!result) {
      result = (await this.reconcilePixWebhook({
        payerName: data.payerName,
        amount: data.amount,
        paidAt: data.bookedAt,
        source: 'open-finance-webhook',
        sourceTransactionId,
        metadata: {
          provider: data.provider,
          eventId: data.eventId,
          accountId: data.accountId ?? null,
          payerDocument: data.payerDocument ?? null,
          txid: data.txid ?? null,
          endToEndId: data.endToEndId ?? null,
          description: data.description ?? null,
          ...(data.metadata || {})
        }
      })) as Record<string, unknown>;
    }

    return this.rememberWebhookResult(OPEN_FINANCE_PIX_WEBHOOK_SCOPE, idemKey, requestHash, {
      ...baseResponse,
      ...result,
      ignored: false,
      matched: matchedViaTxid ? true : result?.matched === true,
      matchReason: matchedViaTxid ? 'TXID' : result?.matchReason ?? null
    });
  }

  async ingestPluggyWebhook(payload: unknown) {
    const data = PluggyWebhookSchema.parse(payload);
    const webhookIdemKey = data.eventId;
    const requestHash = this.hashWebhookPayload(data);
    const replay = await this.findWebhookReplay(PLUGGY_WEBHOOK_EVENT_SCOPE, webhookIdemKey, requestHash);
    if (replay) {
      return {
        ...replay,
        replayed: true
      };
    }

    if (data.event !== 'transactions/created' && data.event !== 'transactions/updated') {
      return this.rememberWebhookResult(PLUGGY_WEBHOOK_EVENT_SCOPE, webhookIdemKey, requestHash, {
        ok: true,
        event: data.event,
        eventId: data.eventId,
        ignored: true,
        reason: 'EVENT_NOT_SUPPORTED'
      });
    }

    let transactions: PluggyTransaction[] = [];
    if (data.event === 'transactions/created') {
      const createdTransactionsLink = String(data.createdTransactionsLink || '').trim();
      if (!createdTransactionsLink) {
        throw new BadRequestException('Webhook Pluggy transactions/created sem createdTransactionsLink.');
      }
      transactions = await this.fetchPluggyTransactionsFromCreatedLink(createdTransactionsLink);
    } else {
      transactions = await this.fetchPluggyTransactionsByIds(data.transactionIds || []);
    }

    const candidateTransactions = transactions.filter((transaction) => this.isPluggyPixTransaction(transaction));
    let processed = 0;
    let matched = 0;
    let ignored = transactions.length - candidateTransactions.length;
    const results: Array<Record<string, unknown>> = [];

    for (const transaction of candidateTransactions) {
      const openFinancePayload = this.mapPluggyTransactionToOpenFinanceEvent(data, transaction);
      if (!openFinancePayload) {
        ignored += 1;
        continue;
      }
      processed += 1;
      const result = (await this.ingestOpenFinancePixWebhook(openFinancePayload)) as Record<string, unknown>;
      const payment = result.payment as { status?: string } | undefined;
      if (result.matched === true || result.alreadyPaid === true || payment?.status === 'PAGO') {
        matched += 1;
      }
      results.push({
        transactionId: transaction.id,
        amount: this.toMoney(transaction.amount),
        payerName: openFinancePayload.payerName,
        matched: result.matched === true || result.alreadyPaid === true,
        ignored: result.ignored === true,
        reason: result.reason ?? null
      });
    }

    return this.rememberWebhookResult(PLUGGY_WEBHOOK_EVENT_SCOPE, webhookIdemKey, requestHash, {
      ok: true,
      event: data.event,
      eventId: data.eventId,
      itemId: data.itemId ?? null,
      accountId: data.accountId ?? null,
      fetchedTransactions: transactions.length,
      processedTransactions: processed,
      matchedTransactions: matched,
      ignoredTransactions: ignored,
      results
    });
  }

  async settlePixWebhook(payload: unknown) {
    const data = PixSettlementWebhookSchema.parse(payload);

    return this.prisma.$transaction(async (tx) => {
      const payment = await this.findPaymentForSettlement(tx, data);
      if (!payment) {
        throw new NotFoundException('Pagamento PIX nao encontrado para a liquidacao informada.');
      }

      if (payment.method !== 'pix') {
        throw new BadRequestException('A liquidacao recebida nao corresponde a um pagamento PIX.');
      }

      const normalizedPendingPayment =
        payment.status !== PaymentStatusEnum.enum.PAGO && !payment.paidAt
          ? await this.ensurePixChargeOnRecord(tx, payment)
          : payment;
      const expectedCharge = this.buildPixCharge(normalizedPendingPayment);

      if (data.amount != null) {
        const expectedAmount = moneyToMinorUnits(normalizedPendingPayment.amount);
        const settledAmount = moneyToMinorUnits(data.amount);
        if (expectedAmount !== settledAmount) {
          throw new BadRequestException(
            `Valor da liquidacao diverge do pagamento. Esperado=${normalizedPendingPayment.amount} Recebido=${this.toMoney(data.amount)}`
          );
        }
      }

      if (data.txid && data.txid !== expectedCharge.txid) {
        throw new BadRequestException('TXID da liquidacao nao corresponde ao pagamento encontrado.');
      }

      if (normalizedPendingPayment.status === PaymentStatusEnum.enum.PAGO || normalizedPendingPayment.paidAt) {
        return {
          ok: true,
          alreadyPaid: true,
          source: data.source,
          payment: this.normalizePayment(normalizedPendingPayment)
        };
      }

      const nextProviderRef = data.providerRef?.trim() || normalizedPendingPayment.providerRef || expectedCharge.providerRef;
      const paidAt = data.paidAt ? new Date(data.paidAt) : new Date();
      const updated = (await tx.payment.update({
        where: { id: normalizedPendingPayment.id },
        data: {
          status: PaymentStatusEnum.enum.PAGO,
          paidAt,
          providerRef: nextProviderRef
        }
      })) as PaymentRecord;

      return {
        ok: true,
        alreadyPaid: false,
        source: data.source,
        payment: this.normalizePayment(updated)
      };
    });
  }

  async create(payload: unknown) {
    const data = PaymentSchema.omit({ id: true, pixCharge: true }).parse(payload);
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: data.orderId } });
      if (!order) throw new NotFoundException('Pedido nao encontrado');
      if (order.status === 'CANCELADO') {
        throw new BadRequestException('Nao e possivel registrar pagamento para pedido cancelado.');
      }

      const amount = this.toMoney(data.amount);
      if (amount <= 0) {
        throw new BadRequestException('Valor do pagamento deve ser maior que zero.');
      }

      const isPaid = data.status === PaymentStatusEnum.enum.PAGO || Boolean(data.paidAt);
      const amountToAdd = isPaid ? amount : 0;
      const paidCurrent = await this.getPaidTotal(tx, data.orderId);
      this.ensureWithinOrderTotal(order.total, paidCurrent, amountToAdd);

      const created = (await tx.payment.create({
        data: {
          orderId: data.orderId,
          amount,
          method: 'pix',
          status: isPaid ? PaymentStatusEnum.enum.PAGO : data.status,
          paidAt: isPaid ? (data.paidAt ? new Date(data.paidAt) : new Date()) : null,
          dueDate: data.dueDate ? new Date(data.dueDate) : null,
          providerRef: data.providerRef ?? null
        }
      })) as PaymentRecord;

      const normalized = isPaid ? created : await this.ensurePixChargeOnRecord(tx, created);
      return this.normalizePayment(normalized);
    });
  }

  async remove(id: number) {
    const payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment) throw new NotFoundException('Pagamento nao encontrado');
    await this.prisma.payment.delete({ where: { id } });
  }
}
