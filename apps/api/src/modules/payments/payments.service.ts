import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException, Inject } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service.js';
import {
  CardCheckoutSchema,
  moneyToMinorUnits,
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

type PixReconciliationCandidateSummary = {
  paymentId: number;
  orderId: number;
  publicNumber: number;
  customerName: string;
  amount: number;
  createdAt: string;
  dueAt: string | null;
  nameScore: number;
  current: boolean;
};

type HumanNameMatchSummary = {
  score: number;
  overlap: number;
  firstTokenScore: number;
  lastTokenScore: number;
  shorterCovered: boolean;
  sharedStrongTokenCount: number;
  exactFirstAndLast: boolean;
  strongFirstAndLast: boolean;
};

type SumUpCheckoutPayload = {
  id: string;
  checkout_reference: string;
  status: 'PENDING' | 'FAILED' | 'PAID';
  hosted_checkout_url: string | null;
  valid_until: string | null;
  redirect_url: string | null;
};

type SumUpWebhookPayload = {
  event_type?: string;
  id?: string;
};

const PIX_RECONCILIATION_NAME_STOPWORDS = new Set(['DA', 'DAS', 'DE', 'DI', 'DO', 'DOS', 'DU', 'E']);
const PIX_RECONCILIATION_NAME_WEAK_TOKENS = new Set(['FILHO', 'NETO', 'JUNIOR', 'JR', 'SOBRINHO']);
const PIX_RECONCILIATION_DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class PaymentsService {
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

  private getSumUpConfig() {
    const apiKey = String(process.env.SUMUP_API_KEY || '').trim();
    const merchantCode = String(process.env.SUMUP_MERCHANT_CODE || '').trim();
    const baseUrl = String(process.env.SUMUP_API_BASE_URL || 'https://api.sumup.com').trim().replace(/\/+$/, '');
    return {
      enabled: Boolean(apiKey && merchantCode),
      apiKey,
      merchantCode,
      baseUrl
    };
  }

  isSumUpEnabled() {
    return this.getSumUpConfig().enabled;
  }

  private assertSumUpEnabled() {
    const config = this.getSumUpConfig();
    if (!config.enabled) {
      throw new InternalServerErrorException('Integração SumUp indisponível.');
    }
    return config;
  }

  private buildSumUpProviderRef(checkoutId: string) {
    return `SUMUP:${checkoutId}`;
  }

  private parseSumUpProviderRef(providerRef?: string | null) {
    const raw = String(providerRef || '').trim();
    if (!raw) return null;
    const match = raw.match(/^SUMUP:(.+)$/i);
    return match?.[1]?.trim() || null;
  }

  private normalizePublicAppOrigin(value?: string | null) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    try {
      const url = new URL(raw);
      return url.origin;
    } catch {
      return null;
    }
  }

  private resolvePublicAppOrigin(preferred?: string | null) {
    const candidates = [
      preferred,
      process.env.APP_PUBLIC_BASE_URL,
      process.env.NEXT_PUBLIC_APP_URL,
      process.env.VERCEL_PROJECT_PRODUCTION_URL,
      process.env.VERCEL_URL
    ];

    for (const candidate of candidates) {
      const origin = this.normalizePublicAppOrigin(candidate);
      if (origin) return origin;
    }

    return null;
  }

  private buildSumUpCheckoutReference(input: { orderId: number; paymentId: number }) {
    return `qb-order-${input.orderId}-payment-${input.paymentId}`.slice(0, 90);
  }

  private buildSumUpOrderDescription(input: { orderPublicNumber: number | null; orderId: number }) {
    const displayNumber = input.orderPublicNumber ?? input.orderId;
    return `Pedido #${displayNumber} - Querobroa`.slice(0, 120);
  }

  private parseSumUpCheckoutPayload(payload: unknown): SumUpCheckoutPayload {
    if (!payload || typeof payload !== 'object') {
      throw new BadRequestException('Resposta inválida da SumUp.');
    }
    const record = payload as Record<string, unknown>;
    const id = String(record.id || '').trim();
    const reference = String(record.checkout_reference || '').trim();
    const status = String(record.status || '').trim().toUpperCase();
    const hostedCheckoutUrl = String(record.hosted_checkout_url || '').trim();
    const validUntil = String(record.valid_until || '').trim();
    const redirectUrl = String(record.redirect_url || '').trim();

    if (!id || !reference || (status !== 'PENDING' && status !== 'FAILED' && status !== 'PAID')) {
      throw new BadRequestException('Checkout SumUp inválido.');
    }

    return {
      id,
      checkout_reference: reference,
      status: status as SumUpCheckoutPayload['status'],
      hosted_checkout_url: hostedCheckoutUrl || null,
      valid_until: validUntil || null,
      redirect_url: redirectUrl || null
    };
  }

  private async fetchSumUp(pathname: string, init?: RequestInit) {
    const config = this.assertSumUpEnabled();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);

    try {
      const response = await fetch(`${config.baseUrl}${pathname}`, {
        ...init,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.apiKey}`,
          ...(init?.headers || {})
        },
        signal: controller.signal
      });
      const raw = await response.text();
      let payload: unknown = null;
      try {
        payload = raw ? JSON.parse(raw) : null;
      } catch {
        payload = raw || null;
      }

      if (!response.ok) {
        const detail =
          payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).message === 'string'
            ? String((payload as Record<string, unknown>).message)
            : raw.trim() || `HTTP ${response.status}`;
        throw new BadRequestException(`SumUp: ${detail}`);
      }

      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildCardCheckout(input: SumUpCheckoutPayload) {
    return CardCheckoutSchema.parse({
      provider: 'SUMUP',
      checkoutId: input.id,
      reference: input.checkout_reference,
      status: input.status,
      hostedCheckoutUrl: input.hosted_checkout_url || `https://checkout.sumup.com/pay/${input.id}`,
      expiresAt: input.valid_until,
      redirectUrl: input.redirect_url
    });
  }

  private async createSumUpHostedCheckout(input: {
    paymentId: number;
    orderId: number;
    orderPublicNumber: number | null;
    amount: number;
    publicAppOrigin?: string | null;
  }) {
    const config = this.assertSumUpEnabled();
    const publicAppOrigin = this.resolvePublicAppOrigin(input.publicAppOrigin);
    const redirectUrl = publicAppOrigin ? `${publicAppOrigin}/pedidofinalizado` : null;
    const returnUrl = publicAppOrigin ? `${publicAppOrigin}/api/payments/sumup/webhook` : null;
    const payload = await this.fetchSumUp('/v0.1/checkouts', {
      method: 'POST',
      body: JSON.stringify({
        amount: this.toMoney(input.amount),
        checkout_reference: this.buildSumUpCheckoutReference({
          orderId: input.orderId,
          paymentId: input.paymentId
        }),
        currency: 'BRL',
        description: this.buildSumUpOrderDescription({
          orderPublicNumber: input.orderPublicNumber,
          orderId: input.orderId
        }),
        merchant_code: config.merchantCode,
        ...(returnUrl ? { return_url: returnUrl } : {}),
        ...(redirectUrl ? { redirect_url: redirectUrl } : {}),
        hosted_checkout: { enabled: true }
      })
    });

    return this.parseSumUpCheckoutPayload(payload);
  }

  private async getSumUpCheckoutById(checkoutId: string) {
    const payload = await this.fetchSumUp(`/v0.1/checkouts/${encodeURIComponent(checkoutId)}`, {
      method: 'GET'
    });
    return this.parseSumUpCheckoutPayload(payload);
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

  private tokenizeHumanName(
    value?: string | null,
    options?: {
      keepInitials?: boolean;
      dropWeakTokens?: boolean;
    },
  ) {
    return this.normalizeHumanName(value)
      .split(' ')
      .map((token) => token.trim())
      .filter((token) => {
        if (!token) return false;
        if (PIX_RECONCILIATION_NAME_STOPWORDS.has(token)) return false;
        if (options?.dropWeakTokens && PIX_RECONCILIATION_NAME_WEAK_TOKENS.has(token)) return false;
        if (!options?.keepInitials && token.length < 2) return false;
        return true;
      });
  }

  private compareHumanNameTokens(left: string, right: string) {
    if (!left || !right) return 0;
    if (left === right) return 1;
    if (left.length === 1 && right.startsWith(left)) return 0.72;
    if (right.length === 1 && left.startsWith(right)) return 0.72;
    if (left.length >= 4 && right.length >= 4 && (left.startsWith(right) || right.startsWith(left))) return 0.88;
    return 0;
  }

  private buildHumanNameMatchSummary(left?: string | null, right?: string | null): HumanNameMatchSummary {
    const normalizedLeft = this.normalizeHumanName(left);
    const normalizedRight = this.normalizeHumanName(right);
    if (!normalizedLeft || !normalizedRight) {
      return {
        score: 0,
        overlap: 0,
        firstTokenScore: 0,
        lastTokenScore: 0,
        shorterCovered: false,
        sharedStrongTokenCount: 0,
        exactFirstAndLast: false,
        strongFirstAndLast: false,
      };
    }
    if (normalizedLeft === normalizedRight) {
      return {
        score: 1,
        overlap: 1,
        firstTokenScore: 1,
        lastTokenScore: 1,
        shorterCovered: true,
        sharedStrongTokenCount: 2,
        exactFirstAndLast: true,
        strongFirstAndLast: true,
      };
    }

    const leftTokens = this.tokenizeHumanName(left, { keepInitials: true, dropWeakTokens: true });
    const rightTokens = this.tokenizeHumanName(right, { keepInitials: true, dropWeakTokens: true });
    if (!leftTokens.length || !rightTokens.length) {
      return {
        score: 0,
        overlap: 0,
        firstTokenScore: 0,
        lastTokenScore: 0,
        shorterCovered: false,
        sharedStrongTokenCount: 0,
        exactFirstAndLast: false,
        strongFirstAndLast: false,
      };
    }

    const usedRightIndexes = new Set<number>();
    let weightedMatches = 0;
    let sharedStrongTokenCount = 0;
    for (const token of leftTokens) {
      let bestScore = 0;
      let bestIndex = -1;
      for (let index = 0; index < rightTokens.length; index += 1) {
        if (usedRightIndexes.has(index)) continue;
        const candidateScore = this.compareHumanNameTokens(token, rightTokens[index] || '');
        if (candidateScore > bestScore) {
          bestScore = candidateScore;
          bestIndex = index;
        }
      }
      if (bestIndex >= 0 && bestScore > 0) {
        usedRightIndexes.add(bestIndex);
        weightedMatches += bestScore;
        if (bestScore >= 0.88 && token.length >= 4 && (rightTokens[bestIndex] || '').length >= 4) {
          sharedStrongTokenCount += 1;
        }
      }
    }

    const overlap = weightedMatches / Math.max(leftTokens.length, rightTokens.length);
    const firstMatches = this.compareHumanNameTokens(leftTokens[0] || '', rightTokens[0] || '');
    const lastMatches = this.compareHumanNameTokens(
      leftTokens[leftTokens.length - 1] || '',
      rightTokens[rightTokens.length - 1] || '',
    );
    const shorterTokens = leftTokens.length <= rightTokens.length ? leftTokens : rightTokens;
    const longerTokens = shorterTokens === leftTokens ? rightTokens : leftTokens;
    const shorterCovered = shorterTokens.every((token) =>
      longerTokens.some((candidate) => this.compareHumanNameTokens(token, candidate) >= 0.72),
    );
    const exactFirstAndLast = firstMatches === 1 && lastMatches === 1;
    const strongFirstAndLast = firstMatches >= 0.88 && lastMatches >= 0.88;

    let score = overlap;
    if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) {
      score = Math.max(score, 0.9);
    }
    if (firstMatches > 0) score += 0.16 * firstMatches;
    if (lastMatches > 0) score += 0.18 * lastMatches;
    if (shorterCovered) score += 0.06;
    if (sharedStrongTokenCount >= 2) score += 0.04;
    if (strongFirstAndLast) score += 0.08;
    if (exactFirstAndLast) score += 0.03;

    return {
      score: Math.min(score, 0.995),
      overlap,
      firstTokenScore: firstMatches,
      lastTokenScore: lastMatches,
      shorterCovered,
      sharedStrongTokenCount,
      exactFirstAndLast,
      strongFirstAndLast,
    };
  }

  private compareHumanNames(left?: string | null, right?: string | null) {
    return this.buildHumanNameMatchSummary(left, right).score;
  }

  scoreHumanNameMatch(left?: string | null, right?: string | null) {
    return this.compareHumanNames(left, right);
  }

  describeHumanNameMatch(left?: string | null, right?: string | null) {
    return this.buildHumanNameMatchSummary(left, right);
  }

  private computePixReconciliationTimingScore(
    candidate: PendingPixPaymentCandidate,
    paidAt?: string | null,
  ) {
    const reference = paidAt ? new Date(paidAt) : new Date();
    const referenceTime = Number.isNaN(reference.getTime()) ? Date.now() : reference.getTime();
    const anchor =
      candidate.dueDate?.getTime() ||
      candidate.order.createdAt.getTime();
    const deltaDays = Math.abs(referenceTime - anchor) / PIX_RECONCILIATION_DAY_MS;
    if (deltaDays <= 1) return 1;
    if (deltaDays <= 3) return 0.94;
    if (deltaDays <= 7) return 0.84;
    if (deltaDays <= 14) return 0.72;
    if (deltaDays <= 30) return 0.58;
    return 0.42;
  }

  private scorePixReconciliationCandidate(
    candidate: PendingPixPaymentCandidate,
    payerName?: string | null,
    paidAt?: string | null,
  ) {
    const nameScore = this.compareHumanNames(candidate.order.customer?.name, payerName);
    const timingScore = this.computePixReconciliationTimingScore(candidate, paidAt);
    const totalScore =
      nameScore > 0
        ? Math.min(0.999, nameScore * 0.88 + timingScore * 0.12)
        : timingScore * 0.2;
    return {
      candidate,
      nameScore,
      timingScore,
      totalScore,
    };
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

  async listPixReconciliationCandidates(input: {
    amount: number;
    payerName?: string | null;
    currentPaymentId?: number | null;
  }) {
    const candidates = await this.findPendingPixReconciliationCandidates(input.amount);
    const scoredCandidates = candidates
      .map((candidate) => {
        const scores = this.scorePixReconciliationCandidate(candidate, input.payerName);
        return {
          ...scores,
          ...this.summarizePixReconciliationCandidate(candidate, scores.nameScore),
          current: candidate.id === input.currentPaymentId,
        };
      })
      .sort((left, right) => {
        const scoreDelta = right.totalScore - left.totalScore;
        if (Math.abs(scoreDelta) > 0.0001) return scoreDelta;
        const nameDelta = right.nameScore - left.nameScore;
        if (Math.abs(nameDelta) > 0.0001) return nameDelta;
        const timingDelta = right.timingScore - left.timingScore;
        if (Math.abs(timingDelta) > 0.0001) return timingDelta;
        return right.paymentId - left.paymentId;
      });

    let currentCandidate: PixReconciliationCandidateSummary | null = null;
    if (input.currentPaymentId && !scoredCandidates.some((entry) => entry.paymentId === input.currentPaymentId)) {
      const payment = await this.prisma.payment.findUnique({
        where: { id: input.currentPaymentId },
        include: {
          order: {
            select: {
              id: true,
              publicNumber: true,
              createdAt: true,
              customer: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      });

      if (payment?.order) {
        currentCandidate = {
          paymentId: payment.id,
          orderId: payment.order.id,
          publicNumber: payment.order.publicNumber ?? payment.order.id,
          customerName: payment.order.customer?.name ?? 'Cliente sem nome',
          amount: this.toMoney(payment.amount),
          createdAt: payment.order.createdAt.toISOString(),
          dueAt: payment.dueDate?.toISOString() ?? null,
          nameScore: 1,
          current: true,
        };
      }
    }

    return [...(currentCandidate ? [currentCandidate] : []), ...scoredCandidates].sort((left, right) => {
      const currentDelta = Number(right.current) - Number(left.current);
      if (currentDelta !== 0) return currentDelta;
      const scoreDelta = right.nameScore - left.nameScore;
      if (Math.abs(scoreDelta) > 0.0001) return scoreDelta;
      return right.paymentId - left.paymentId;
    });
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
      method: payment.method === 'card' ? 'card' : 'pix',
      paidAt: payment.paidAt?.toISOString() ?? null,
      dueDate: payment.dueDate?.toISOString() ?? null,
      providerRef: payment.providerRef,
      pixCharge
    });
  }

  async ensureSumUpHostedCheckoutOnRecord(
    tx: TransactionClient,
    payment: PaymentRecord,
    input: {
      orderPublicNumber: number | null;
      publicAppOrigin?: string | null;
    }
  ) {
    if (payment.method !== 'card' || payment.status === PaymentStatusEnum.enum.PAGO || payment.paidAt) {
      throw new BadRequestException('Checkout SumUp só pode ser criado para pagamento de cartão pendente.');
    }

    const existingCheckoutId = this.parseSumUpProviderRef(payment.providerRef);
    const existingCheckout = existingCheckoutId ? await this.getSumUpCheckoutById(existingCheckoutId) : null;
    if (existingCheckout) {
      return {
        payment: payment.providerRef
          ? payment
          : ((await tx.payment.update({
              where: { id: payment.id },
              data: { providerRef: this.buildSumUpProviderRef(existingCheckout.id) }
            })) as PaymentRecord),
        cardCheckout: this.buildCardCheckout(existingCheckout)
      };
    }

    const checkout = await this.createSumUpHostedCheckout({
      paymentId: payment.id,
      orderId: payment.orderId,
      orderPublicNumber: input.orderPublicNumber,
      amount: payment.amount,
      publicAppOrigin: input.publicAppOrigin
    });

    const updated = (await tx.payment.update({
      where: { id: payment.id },
      data: {
        providerRef: this.buildSumUpProviderRef(checkout.id)
      }
    })) as PaymentRecord;

    return {
      payment: updated,
      cardCheckout: this.buildCardCheckout(checkout)
    };
  }

  async syncSumUpCheckoutById(checkoutId: string) {
    const normalizedCheckoutId = String(checkoutId || '').trim();
    if (!normalizedCheckoutId) {
      throw new BadRequestException('Checkout SumUp inválido.');
    }

    const checkout = await this.getSumUpCheckoutById(normalizedCheckoutId);
    const payment = await this.prisma.payment.findFirst({
      where: {
        method: 'card',
        providerRef: this.buildSumUpProviderRef(checkout.id)
      },
      orderBy: [{ id: 'desc' }]
    });
    if (!payment) {
      throw new NotFoundException('Pagamento do checkout SumUp não encontrado.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const current = (await tx.payment.findUnique({
        where: { id: payment.id }
      })) as PaymentRecord | null;
      if (!current) {
        throw new NotFoundException('Pagamento não encontrado.');
      }

      if (checkout.status !== 'PAID') {
        if (current.providerRef === this.buildSumUpProviderRef(checkout.id)) {
          return current;
        }
        return (await tx.payment.update({
          where: { id: current.id },
          data: {
            providerRef: this.buildSumUpProviderRef(checkout.id)
          }
        })) as PaymentRecord;
      }

      if (current.status === PaymentStatusEnum.enum.PAGO || current.paidAt) {
        return current;
      }

      return (await tx.payment.update({
        where: { id: current.id },
        data: {
          status: PaymentStatusEnum.enum.PAGO,
          paidAt: new Date(),
          providerRef: this.buildSumUpProviderRef(checkout.id)
        }
      })) as PaymentRecord;
    });

    return {
      payment: this.normalizePayment(updated),
      cardCheckout: this.buildCardCheckout(checkout)
    };
  }

  async handleSumUpWebhook(payload: unknown) {
    const record = payload && typeof payload === 'object' ? (payload as SumUpWebhookPayload) : null;
    const eventType = String(record?.event_type || '').trim().toUpperCase();
    const checkoutId = String(record?.id || '').trim();
    if (!checkoutId) {
      throw new BadRequestException('Webhook SumUp sem checkout.');
    }
    if (eventType && eventType !== 'CHECKOUT_STATUS_CHANGED') {
      return {
        ok: true,
        ignored: true,
        eventType,
        checkoutId
      };
    }

    const result = await this.syncSumUpCheckoutById(checkoutId);
    return {
      ok: true,
      ignored: false,
      checkoutId,
      payment: result.payment,
      cardCheckout: result.cardCheckout
    };
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
      throw new NotFoundException('Pagamento não encontrado.');
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
      throw new NotFoundException('Pedido não possui cobrança PIX.');
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
    const scoredCandidates = candidates
      .map((candidate) => this.scorePixReconciliationCandidate(candidate, data.payerName, data.paidAt))
      .sort((left, right) => {
        const totalDelta = right.totalScore - left.totalScore;
        if (Math.abs(totalDelta) > 0.0001) return totalDelta;
        const nameDelta = right.nameScore - left.nameScore;
        if (Math.abs(nameDelta) > 0.0001) return nameDelta;
        const timingDelta = right.timingScore - left.timingScore;
        if (Math.abs(timingDelta) > 0.0001) return timingDelta;
        return right.candidate.id - left.candidate.id;
      });
    const strongMatches = scoredCandidates.filter((entry) => entry.nameScore >= 0.74);

    const topStrong = strongMatches[0] || null;
    const secondStrong = strongMatches[1] || null;
    const topStrongGap = topStrong && secondStrong ? topStrong.totalScore - secondStrong.totalScore : 1;

    const exactCandidate =
      strongMatches.length === 1
        ? strongMatches[0]
        : topStrong &&
            topStrong.nameScore >= 0.98 &&
            (!secondStrong || secondStrong.nameScore < 0.94)
          ? topStrong
          : topStrong &&
            topStrong.nameScore >= 0.93 &&
            topStrongGap >= 0.06
          ? topStrong
          : topStrong &&
              topStrong.nameScore >= 0.84 &&
              topStrongGap >= 0.12
            ? topStrong
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
          this.summarizePixReconciliationCandidate(entry.candidate, entry.nameScore)
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
      matchReason:
        strongMatches.length >= 1 ? 'NAME_AND_AMOUNT' : 'UNIQUE_AMOUNT',
      matchConfidence: Number(exactCandidate.totalScore.toFixed(3)),
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

  async settlePixWebhook(payload: unknown) {
    const data = PixSettlementWebhookSchema.parse(payload);

    return this.prisma.$transaction(async (tx) => {
      const payment = await this.findPaymentForSettlement(tx, data);
      if (!payment) {
        throw new NotFoundException('Pagamento PIX não encontrado para a liquidação informada.');
      }

      if (payment.method !== 'pix') {
        throw new BadRequestException('A liquidação recebida não corresponde a um pagamento PIX.');
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
        throw new BadRequestException('TXID da liquidação não corresponde ao pagamento encontrado.');
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

  async reopenPixPayment(paymentId: number) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) {
      throw new NotFoundException('Pagamento não encontrado.');
    }
    if (payment.method !== 'pix') {
      throw new BadRequestException('Somente pagamentos PIX podem ser reabertos via extrato.');
    }

    const updated = await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: PaymentStatusEnum.enum.PENDENTE,
        paidAt: null,
      },
    });

    return this.normalizePayment(updated as PaymentRecord);
  }

  async create(payload: unknown) {
    const data = PaymentSchema.omit({ id: true, pixCharge: true }).parse(payload);
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: data.orderId } });
      if (!order) throw new NotFoundException('Pedido não encontrado');
      if (order.status === 'CANCELADO') {
        throw new BadRequestException('Não é possível registrar pagamento para pedido cancelado.');
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
          method: data.method,
          status: isPaid ? PaymentStatusEnum.enum.PAGO : data.status,
          paidAt: isPaid ? (data.paidAt ? new Date(data.paidAt) : new Date()) : null,
          dueDate: data.dueDate ? new Date(data.dueDate) : null,
          providerRef: data.providerRef ?? null
        }
      })) as PaymentRecord;

      const normalized =
        isPaid || created.method !== 'pix' ? created : await this.ensurePixChargeOnRecord(tx, created);
      return this.normalizePayment(normalized);
    });
  }

  async remove(id: number) {
    const payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment) throw new NotFoundException('Pagamento não encontrado');
    await this.prisma.payment.delete({ where: { id } });
  }
}
