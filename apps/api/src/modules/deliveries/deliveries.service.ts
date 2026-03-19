import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  DeliveryJobSchema,
  DeliveryQuoteDraftSchema,
  DeliveryQuoteResponseSchema,
  DeliveryQuoteSelectionSchema,
  OrderFulfillmentModeEnum,
  moneyFromMinorUnits,
  moneyToMinorUnits,
  roundMoney
} from '@querobroapp/shared';
import { PrismaService } from '../../prisma.service.js';
import {
  externalOrderScheduleErrorMessage,
  isExternalOrderScheduleAllowed
} from '../../common/external-order-schedule.js';
import type { DeliveryDispatchInput, DeliveryProvider, DeliveryQuoteInput } from './delivery-provider.js';
import { LocalDeliveryProvider } from './local-delivery.provider.js';
import { LoggiProvider } from './loggi.provider.js';
import { FIXED_PICKUP_ORIGIN } from './pickup-origin.js';
import { UberDirectProvider } from './uber-direct.provider.js';

type OrderWithDeliveryContext = Awaited<ReturnType<DeliveriesService['getOrderForDelivery']>>;
type DeliveryQuoteDraft = typeof DeliveryQuoteDraftSchema._type;
type DeliveryProviderCode = 'NONE' | 'LOCAL' | 'UBER_DIRECT' | 'LOGGI';
type DeliveryQuoteSourceCode = 'NONE' | 'UBER_QUOTE' | 'LOGGI_QUOTE' | 'MANUAL_FALLBACK';
type DeliveryQuoteStatusCode = 'NOT_REQUIRED' | 'PENDING' | 'QUOTED' | 'FALLBACK' | 'EXPIRED' | 'FAILED';
type DeliveryJobStatusCode =
  | 'NOT_REQUESTED'
  | 'PENDING_REQUIREMENTS'
  | 'REQUESTED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'FAILED'
  | 'CANCELED';
type DeliveryQuoteResponse = Omit<typeof DeliveryQuoteResponseSchema._type, 'provider' | 'source' | 'status'> & {
  provider: DeliveryProviderCode;
  source: DeliveryQuoteSourceCode;
  status: DeliveryQuoteStatusCode;
};
type DeliveryJob = Omit<typeof DeliveryJobSchema._type, 'provider' | 'status'> & {
  provider: DeliveryProviderCode;
  status: DeliveryJobStatusCode;
};

type DeliveryDraft = {
  orderId: number;
  customerName: string;
  customerPhone: string;
  dropoffAddress: string;
  dropoffPlaceId: string | null;
  dropoffLat: number | null;
  dropoffLng: number | null;
  orderTotal: number;
  totalUnits: number;
  scheduledAt: string;
  manifestSummary: string;
  items: Array<{
    productId: number;
    name: string;
    quantity: number;
  }>;
};

type DeliveryReadinessResult = {
  provider: DeliveryProviderCode;
  mode: 'PROVIDER';
  ready: boolean;
  reason: string;
  missingRequirements: string[];
  draft: DeliveryDraft;
  quoteStatus: DeliveryQuoteResponse['status'];
  deliveryFee: number;
};

type DeliveryTrackingRecord = DeliveryJob & {
  trackingId: string;
  mode: 'PROVIDER';
  draft: DeliveryDraft;
  providerQuoteId: string | null;
  quoteFee: number | null;
  quoteExpiresAt: string | null;
};

type LegacyDeliveryTrackingRecord = Partial<DeliveryTrackingRecord> & {
  provider?: string;
  mode?: string;
  status?: string;
  providerDeliveryId?: string | null;
  providerOrderId?: string | null;
  providerQuoteId?: string | null;
  trackingUrl?: string | null;
  lastProviderError?: string | null;
};

type QuoteRecordPayload = {
  requestHash: string;
  quote: DeliveryQuoteResponse;
};

const DELIVERY_TRACKING_SCOPE = 'DELIVERY_TRACKING';
const DELIVERY_QUOTE_SCOPE = 'DELIVERY_QUOTE';
@Injectable()
export class DeliveriesService {
  private readonly localProvider = new LocalDeliveryProvider();
  private readonly uberProvider = new UberDirectProvider();
  private readonly loggiProvider = new LoggiProvider();

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async quoteDelivery(
    payload: unknown,
    options?: { enforceExternalSchedule?: boolean; allowManualFallback?: boolean }
  ) {
    const draft = DeliveryQuoteDraftSchema.parse(payload);
    try {
      return await this.quoteForDraft(draft, {
        enforceExternalSchedule: options?.enforceExternalSchedule ?? true,
        allowManualFallback: options?.allowManualFallback ?? false
      });
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof BadGatewayException || error instanceof NotFoundException) {
        throw error;
      }
      const detail = error instanceof Error ? error.message : 'unknown error';
      throw new BadGatewayException(`Nao foi possivel calcular o frete agora. (${detail})`);
    }
  }

  async refreshOrderQuote(orderId: number) {
    const order = await this.getOrderForDelivery(orderId);
    const payments = await this.prisma.payment.findMany({
      where: { orderId },
      orderBy: { id: 'desc' }
    });
    const draft = this.buildOrderDraft(order);
    const missingRequirements = this.collectMissingRequirements(order, draft);
    if (missingRequirements.length > 0) {
      throw new BadRequestException(
        `Corrija os dados do pedido antes de recalcular: ${missingRequirements.join(' • ')}`
      );
    }

    const quote = await this.quoteForDraft(
      {
        mode: order.fulfillmentMode === OrderFulfillmentModeEnum.enum.DELIVERY ? 'DELIVERY' : 'PICKUP',
        scheduledAt: order.scheduledAt?.toISOString() || new Date().toISOString(),
        customer: {
          name: order.customer?.name ?? null,
          phone: order.customer?.phone ?? null,
          address: draft.dropoffAddress,
          placeId: draft.dropoffPlaceId,
          lat: draft.dropoffLat,
          lng: draft.dropoffLng,
          deliveryNotes: order.customer?.deliveryNotes ?? null
        },
        manifest: {
          items: draft.items.map((item) => ({
            name: item.name,
            quantity: item.quantity
          })),
          subtotal: this.toMoney(order.subtotal ?? 0),
          totalUnits: draft.items.reduce((sum, item) => sum + Math.max(Math.floor(item.quantity || 0), 0), 0)
        }
      },
      {
        forceRefresh: true,
        enforceExternalSchedule: false,
        allowManualFallback: false
      }
    );

    const subtotalMinorUnits = moneyToMinorUnits(order.subtotal ?? 0);
    const discountMinorUnits = moneyToMinorUnits(order.discount ?? 0);
    const deliveryFeeMinorUnits = moneyToMinorUnits(quote.fee ?? 0);
    const nextSubtotalAfterDiscount = Math.max(subtotalMinorUnits - discountMinorUnits, 0);
    const nextTotal = moneyFromMinorUnits(nextSubtotalAfterDiscount + deliveryFeeMinorUnits);
    const paidMinorUnits = payments.reduce((sum, payment) => {
      if (payment.status === 'PAGO' || payment.paidAt) {
        return sum + moneyToMinorUnits(payment.amount ?? 0);
      }
      return sum;
    }, 0);
    if (nextSubtotalAfterDiscount + deliveryFeeMinorUnits < paidMinorUnits) {
      throw new BadRequestException('O frete recalculado deixaria o total abaixo do valor ja pago no pedido.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: {
          deliveryFee: this.toMoney(quote.fee ?? 0),
          deliveryProvider: quote.provider,
          deliveryFeeSource: quote.source,
          deliveryQuoteStatus: quote.status,
          deliveryQuoteRef: quote.quoteToken ?? null,
          deliveryQuoteExpiresAt: this.parseOptionalDateTime(quote.expiresAt ?? null),
          total: nextTotal
        }
      });

      await tx.payment.updateMany({
        where: {
          orderId,
          method: 'pix',
          paidAt: null,
          status: {
            not: 'PAGO'
          }
        },
        data: {
          amount: nextTotal
        }
      });
    });

    return quote;
  }

  async resolveDeliverySelection(
    selectionPayload: unknown,
    draftPayload: DeliveryQuoteDraft,
    options?: { enforceExternalSchedule?: boolean; allowManualFallback?: boolean }
  ) {
    const draft = DeliveryQuoteDraftSchema.parse(draftPayload);
    if (draft.mode !== OrderFulfillmentModeEnum.enum.DELIVERY) {
      return this.buildNotRequiredQuote();
    }
    if (options?.enforceExternalSchedule) {
      this.ensureExternalOrderQuoteScheduleAllowed(draft.scheduledAt);
    }

    const requestHash = this.quoteRequestHash(draft);
    const selection = DeliveryQuoteSelectionSchema.parse(selectionPayload ?? {});
    const quoteToken = selection.quoteToken?.trim();

    if (!quoteToken) {
      return this.quoteForDraft(draft, {
        forceRefresh: true,
        enforceExternalSchedule: options?.enforceExternalSchedule,
        allowManualFallback: options?.allowManualFallback
      });
    }

    const stored = await this.readQuoteRecord(quoteToken);
    if (
      stored &&
      stored.requestHash === requestHash &&
      !this.isQuoteExpired(stored.quote) &&
      this.isAcceptableDeliveryQuote(stored.quote, options?.allowManualFallback)
    ) {
      return stored.quote;
    }

    const refreshed = await this.quoteForDraft(draft, {
      forceRefresh: true,
      enforceExternalSchedule: options?.enforceExternalSchedule,
      allowManualFallback: options?.allowManualFallback
    });
    throw new BadRequestException({
      code: 'DELIVERY_QUOTE_REFRESH_REQUIRED',
      message: 'Frete atualizado. Revise o valor antes de enviar novamente.',
      delivery: refreshed
    });
  }

  async getReadiness(orderId: number): Promise<DeliveryReadinessResult> {
    const order = await this.getOrderForDelivery(orderId);
    const draft = this.buildOrderDraft(order);
    const missingRequirements = this.collectMissingRequirements(order, draft);

    if (order.fulfillmentMode !== OrderFulfillmentModeEnum.enum.DELIVERY) {
      return {
        provider: 'NONE',
        mode: 'PROVIDER',
        ready: false,
        reason: 'Pedido marcado para retirada. Nao ha entrega para solicitar.',
        missingRequirements: ['pedido configurado como retirada'],
        draft,
        quoteStatus: 'NOT_REQUIRED',
        deliveryFee: 0
      };
    }

    return {
      provider: this.normalizeProvider(order.deliveryProvider),
      mode: 'PROVIDER',
      ready: missingRequirements.length === 0,
      reason:
        missingRequirements.length === 0
          ? 'Entrega pronta para solicitar.'
          : `Corrija os dados do pedido antes de iniciar: ${missingRequirements.join(' • ')}`,
      missingRequirements,
      draft,
      quoteStatus: this.normalizeQuoteStatus(order.deliveryQuoteStatus),
      deliveryFee: this.toMoney(order.deliveryFee ?? 0)
    };
  }

  async startOrderDelivery(orderId: number) {
    const order = await this.getOrderForDelivery(orderId);
    if (order.fulfillmentMode !== OrderFulfillmentModeEnum.enum.DELIVERY) {
      throw new BadRequestException('Pedido configurado como retirada. Nao ha envio para solicitar.');
    }
    if (!['PRONTO', 'ENTREGUE'].includes(order.status)) {
      throw new BadRequestException('Entrega so pode ser iniciada quando o pedido estiver PRONTO.');
    }

    const readiness = await this.getReadiness(orderId);
    const existing = await this.readTracking(orderId);
    const providerQuoteId = await this.resolveStoredProviderQuoteId(order.deliveryQuoteRef);
    if (existing && !['FAILED', 'DELIVERED', 'CANCELED'].includes(existing.status)) {
      return {
        reusedExisting: true,
        tracking: await this.syncTrackingRecord(existing)
      };
    }

    if (!readiness.ready) {
      const blocked = await this.saveTracking(orderId, {
        orderId,
        provider: this.normalizeProvider(order.deliveryProvider),
        status: 'PENDING_REQUIREMENTS',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        trackingId: `blocked-${randomUUID()}`,
        providerDeliveryId: null,
        providerTrackingUrl: null,
        pickupEta: null,
        dropoffEta: null,
        lastError: readiness.missingRequirements.join(' • '),
        mode: 'PROVIDER',
        draft: readiness.draft,
        providerQuoteId,
        quoteFee: this.toMoney(order.deliveryFee ?? 0),
        quoteExpiresAt: order.deliveryQuoteExpiresAt?.toISOString() ?? null
      });

      return { reusedExisting: false, tracking: blocked };
    }

    const provider = this.selectDispatchProvider(order.deliveryProvider);
    const input = this.buildProviderInput(readiness.draft, providerQuoteId);

    try {
      const dispatch = await provider.createDelivery(input);
      const tracking = await this.saveTracking(orderId, {
        orderId,
        provider: dispatch.provider,
        status: dispatch.status,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        trackingId: dispatch.trackingId,
        providerDeliveryId: dispatch.providerDeliveryId,
        providerTrackingUrl: dispatch.providerTrackingUrl,
        pickupEta: dispatch.pickupEta,
        dropoffEta: dispatch.dropoffEta,
        lastError: dispatch.lastError,
        mode: 'PROVIDER',
        draft: readiness.draft,
        providerQuoteId,
        quoteFee: this.toMoney(order.deliveryFee ?? 0),
        quoteExpiresAt: order.deliveryQuoteExpiresAt?.toISOString() ?? null
      });
      return {
        reusedExisting: false,
        tracking
      };
    } catch (error) {
      const failed = await this.saveTracking(orderId, {
        orderId,
        provider: this.normalizeProvider(order.deliveryProvider),
        status: 'FAILED',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        trackingId: `failed-${randomUUID()}`,
        providerDeliveryId: null,
        providerTrackingUrl: null,
        pickupEta: null,
        dropoffEta: null,
        lastError: error instanceof Error ? error.message : 'Falha ao solicitar envio.',
        mode: 'PROVIDER',
        draft: readiness.draft,
        providerQuoteId,
        quoteFee: this.toMoney(order.deliveryFee ?? 0),
        quoteExpiresAt: order.deliveryQuoteExpiresAt?.toISOString() ?? null
      });
      return {
        reusedExisting: false,
        tracking: failed
      };
    }
  }

  async getOrderTracking(orderId: number) {
    await this.getOrderForDelivery(orderId);
    const tracking = await this.readTracking(orderId);
    if (!tracking) {
      return {
        exists: false,
        tracking: null
      };
    }

    return {
      exists: true,
      tracking: await this.syncTrackingRecord(tracking)
    };
  }

  async markTrackingAsDelivered(orderId: number) {
    await this.getOrderForDelivery(orderId);
    const tracking = await this.readTracking(orderId);
    if (!tracking) {
      throw new NotFoundException('Entrega ainda nao foi iniciada para este pedido.');
    }

    const delivered = await this.persistSyncedTracking({
      ...tracking,
      status: 'DELIVERED',
      updatedAt: new Date().toISOString()
    });
    await this.markOrderDeliveredIfNeeded(orderId);
    return delivered;
  }

  private buildNotRequiredQuote() {
    return DeliveryQuoteResponseSchema.parse({
      provider: 'NONE',
      fee: 0,
      currencyCode: 'BRL',
      source: 'NONE',
      status: 'NOT_REQUIRED',
      quoteToken: null,
      expiresAt: null,
      fallbackReason: null,
      breakdownLabel: 'Sem frete'
    });
  }

  private parseOptionalDateTime(value: string | null | undefined) {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private async quoteForDraft(
    draftPayload: DeliveryQuoteDraft,
    options?: { forceRefresh?: boolean; enforceExternalSchedule?: boolean; allowManualFallback?: boolean }
  ) {
    const draft = DeliveryQuoteDraftSchema.parse(draftPayload);
    if (draft.mode !== OrderFulfillmentModeEnum.enum.DELIVERY) {
      return this.buildNotRequiredQuote();
    }
    if (options?.enforceExternalSchedule) {
      this.ensureExternalOrderQuoteScheduleAllowed(draft.scheduledAt);
    }

    const requestHash = this.quoteRequestHash(draft);
    const quoteToken = this.quoteToken(requestHash);
    if (!options?.forceRefresh) {
      const existing = await this.readQuoteRecord(quoteToken);
      if (
        existing &&
        existing.requestHash === requestHash &&
        !this.isQuoteExpired(existing.quote) &&
        this.isAcceptableDeliveryQuote(existing.quote, options?.allowManualFallback)
      ) {
        return existing.quote;
      }
    }

    const input = this.buildQuoteInput(draft);
      const quote = await this.fetchProviderQuote(input, {
        allowManualFallback: options?.allowManualFallback ?? true
      });
      const normalized = DeliveryQuoteResponseSchema.parse({
        provider: quote.provider,
        fee: this.toMoney(quote.fee),
        currencyCode: quote.currencyCode || 'BRL',
        source: quote.source,
        status: quote.status,
        quoteToken,
        providerQuoteId: quote.providerQuoteId ?? null,
        expiresAt: quote.expiresAt ?? null,
        fallbackReason: quote.fallbackReason ?? null,
        breakdownLabel: quote.breakdownLabel ?? null
      });

    await this.saveQuoteRecord(quoteToken, requestHash, normalized);
    return normalized;
  }

  private async fetchProviderQuote(input: DeliveryQuoteInput, options?: { allowManualFallback?: boolean }) {
    if (!input.dropoffAddress.trim()) {
      throw new BadRequestException('Endereco de entrega obrigatorio para cotar frete.');
    }
    if (this.isPickupAndDropoffSameAddress(input.pickupAddress, input.dropoffAddress)) {
      throw new BadRequestException(
        'O endereco de entrega coincide com o ponto de coleta da Alameda Jau 731. Selecione retirada ou informe outro destino.'
      );
    }

    if (this.uberProvider.isConfigured()) {
      try {
        return await this.uberProvider.quote(input);
      } catch (error) {
        if (this.uberProvider.isCoverageLimitError(error) && this.loggiProvider.isConfigured()) {
          try {
            return await this.loggiProvider.quote(input);
          } catch (fallbackError) {
            if (options?.allowManualFallback !== false && fallbackError instanceof BadGatewayException) {
              return this.localProvider.quote(input);
            }
            throw fallbackError;
          }
        }
        if (options?.allowManualFallback !== false && error instanceof BadGatewayException) {
          return this.localProvider.quote(input);
        }
        throw error;
      }
    }

    if (this.loggiProvider.isConfigured()) {
      try {
        return await this.loggiProvider.quote(input);
      } catch (error) {
        if (options?.allowManualFallback !== false && error instanceof BadGatewayException) {
          return this.localProvider.quote(input);
        }
        throw error;
      }
    }

    return this.localProvider.quote(input);
  }

  private isPickupAndDropoffSameAddress(pickupAddress: string, dropoffAddress: string) {
    const pickupKey = this.normalizeAddressKey(pickupAddress);
    const dropoffKey = this.normalizeAddressKey(dropoffAddress);
    return Boolean(pickupKey && dropoffKey && pickupKey === dropoffKey);
  }

  private normalizeAddressKey(value: string | null | undefined) {
    const normalized = this.normalizeText(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    return normalized.replace(/\s+/g, ' ');
  }

  private ensureExternalOrderQuoteScheduleAllowed(scheduledAt: string | null | undefined) {
    const parsed = scheduledAt ? new Date(scheduledAt) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('Data/hora do pedido invalida.');
    }
    if (isExternalOrderScheduleAllowed(parsed)) return;
    throw new BadRequestException(externalOrderScheduleErrorMessage());
  }

  private isAcceptableDeliveryQuote(quote: DeliveryQuoteResponse, allowManualFallback = true) {
    if (quote.provider === 'UBER_DIRECT' && quote.source === 'UBER_QUOTE') return true;
    if (quote.provider === 'LOGGI' && quote.source === 'LOGGI_QUOTE') return true;
    if (!allowManualFallback) return false;
    return quote.provider === 'LOCAL' && quote.source === 'MANUAL_FALLBACK';
  }

  private buildQuoteInput(draft: DeliveryQuoteDraft): DeliveryQuoteInput {
    const pickupOrigin = this.pickupOrigin();
    return {
      orderId: null,
      pickupName: pickupOrigin.name,
      pickupPhone: pickupOrigin.phone,
      pickupAddress: pickupOrigin.address,
      dropoffName: this.normalizeText(draft.customer.name) || 'Cliente',
      dropoffPhone: this.normalizeText(draft.customer.phone) || '',
      dropoffAddress: this.normalizeText(draft.customer.address),
      dropoffPlaceId: this.normalizeText(draft.customer.placeId) || null,
      dropoffLat: typeof draft.customer.lat === 'number' && Number.isFinite(draft.customer.lat) ? draft.customer.lat : null,
      dropoffLng: typeof draft.customer.lng === 'number' && Number.isFinite(draft.customer.lng) ? draft.customer.lng : null,
      scheduledAt: draft.scheduledAt,
      orderTotal: this.toMoney(draft.manifest.subtotal),
      totalUnits: Math.max(Math.floor(draft.manifest.totalUnits || 0), 0),
      manifestSummary: this.buildManifestSummary(draft.manifest.items),
      items: draft.manifest.items.map((item) => ({ name: item.name, quantity: item.quantity }))
    };
  }

  private buildProviderInput(draft: DeliveryDraft, providerQuoteId: string | null): DeliveryDispatchInput {
    const pickupOrigin = this.pickupOrigin();
    return {
      orderId: draft.orderId,
      pickupName: pickupOrigin.name,
      pickupPhone: pickupOrigin.phone,
      pickupAddress: pickupOrigin.address,
      dropoffName: draft.customerName,
      dropoffPhone: draft.customerPhone,
      dropoffAddress: draft.dropoffAddress,
      dropoffPlaceId: draft.dropoffPlaceId,
      dropoffLat: draft.dropoffLat,
      dropoffLng: draft.dropoffLng,
      scheduledAt: draft.scheduledAt || null,
      orderTotal: this.toMoney(draft.orderTotal),
      totalUnits: Math.max(Math.floor(draft.totalUnits || 0), 0),
      manifestSummary: draft.manifestSummary,
      items: draft.items.map((item) => ({ name: item.name, quantity: item.quantity })),
      providerQuoteId
    };
  }

  private pickupOriginKey() {
    return this.pickupOrigin().address;
  }

  private hasPickupOriginConfigured() {
    return Boolean(this.pickupOriginKey());
  }

  private pickupOrigin() {
    return {
      name:
        this.normalizeText(process.env.DELIVERY_PICKUP_NAME) ||
        this.normalizeText(process.env.UBER_DIRECT_PICKUP_NAME) ||
        this.normalizeText(process.env.LOGGI_PICKUP_NAME) ||
        'Quero Broa',
      phone:
        this.normalizeText(process.env.DELIVERY_PICKUP_PHONE) ||
        this.normalizeText(process.env.UBER_DIRECT_PICKUP_PHONE) ||
        this.normalizeText(process.env.LOGGI_PICKUP_PHONE) ||
        '',
      address: FIXED_PICKUP_ORIGIN.fullAddress
    };
  }

  private selectDispatchProvider(provider: string | null | undefined): DeliveryProvider {
    const normalized = this.normalizeProvider(provider);
    if (normalized === 'UBER_DIRECT' && this.uberProvider.isConfigured()) {
      return this.uberProvider;
    }
    if (normalized === 'LOGGI' && this.loggiProvider.isConfigured()) {
      return this.loggiProvider;
    }
    return this.localProvider;
  }

  private quoteRequestHash(draft: DeliveryQuoteDraft) {
    const itemSignature = draft.manifest.items
      .map((item) => ({
        signature: this.resolveManifestItemSignature(item.name),
        quantity: Math.max(Number(item.quantity) || 0, 0)
      }))
      .filter((item) => item.quantity > 0)
      .sort((left, right) => {
        if (left.signature === right.signature) {
          return left.quantity - right.quantity;
        }
        return left.signature.localeCompare(right.signature);
      });

    return createHash('sha256')
      .update(
        JSON.stringify({
          mode: draft.mode,
          scheduledAt: draft.scheduledAt,
          pickupAddress: this.pickupOriginKey(),
          customerAddress: this.normalizeText(draft.customer.address),
          customerPlaceId: this.normalizeText(draft.customer.placeId),
          customerLat:
            typeof draft.customer.lat === 'number' && Number.isFinite(draft.customer.lat) ? draft.customer.lat : null,
          customerLng:
            typeof draft.customer.lng === 'number' && Number.isFinite(draft.customer.lng) ? draft.customer.lng : null,
          subtotal: this.toMoney(draft.manifest.subtotal),
          totalUnits: draft.manifest.totalUnits,
          items: itemSignature
        })
      )
      .digest('hex');
  }

  private resolveManifestItemSignature(value: string | null | undefined) {
    const normalized = this.normalizeText(value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

    if (!normalized) return 'ITEM';
    if (normalized.includes('goiabad')) return 'FLAVOR_G';
    if (normalized.includes('doce') && normalized.includes('leite')) return 'FLAVOR_D';
    if (normalized.includes('requeij')) return 'FLAVOR_R';
    if (normalized.includes('queijo') || normalized.includes('serro')) return 'FLAVOR_Q';
    if (normalized.includes('tradicion')) return 'FLAVOR_T';
    return normalized;
  }

  private quoteToken(requestHash: string) {
    return `DQ_${requestHash}`;
  }

  private async resolveStoredProviderQuoteId(quoteToken: string | null | undefined) {
    const normalizedQuoteToken = this.normalizeText(quoteToken);
    if (!normalizedQuoteToken) return null;
    const stored = await this.readQuoteRecord(normalizedQuoteToken);
    return stored?.quote.providerQuoteId ?? null;
  }

  private async readQuoteRecord(quoteToken: string): Promise<QuoteRecordPayload | null> {
    const record = await this.prisma.idempotencyRecord.findUnique({
      where: {
        scope_idemKey: {
          scope: DELIVERY_QUOTE_SCOPE,
          idemKey: quoteToken
        }
      }
    });
    if (!record?.responseJson) return null;

    try {
      const parsed = JSON.parse(record.responseJson) as QuoteRecordPayload;
      return {
        requestHash: this.normalizeText(parsed.requestHash),
        quote: this.normalizeQuoteRecord(parsed.quote)
      };
    } catch {
      return null;
    }
  }

  private async saveQuoteRecord(quoteToken: string, requestHash: string, quote: DeliveryQuoteResponse) {
    const expiry = quote.expiresAt ? new Date(quote.expiresAt) : this.defaultQuoteExpiry();
    await this.prisma.idempotencyRecord.upsert({
      where: {
        scope_idemKey: {
          scope: DELIVERY_QUOTE_SCOPE,
          idemKey: quoteToken
        }
      },
      update: {
        requestHash,
        responseJson: JSON.stringify({ requestHash, quote }),
        expiresAt: expiry
      },
      create: {
        scope: DELIVERY_QUOTE_SCOPE,
        idemKey: quoteToken,
        requestHash,
        responseJson: JSON.stringify({ requestHash, quote }),
        expiresAt: expiry
      }
    });
  }

  private defaultQuoteExpiry() {
    return new Date(Date.now() + 20 * 60_000);
  }

  private normalizeQuoteRecord(quote: unknown): DeliveryQuoteResponse {
    const payload = quote && typeof quote === 'object' ? (quote as Record<string, unknown>) : {};
    const provider = this.normalizeProvider(this.normalizeText(payload.provider as string));
    const source = this.normalizeQuoteSource(payload.source as string | null | undefined);
    return DeliveryQuoteResponseSchema.parse({
      provider,
      fee: this.toMoney(Number(payload.fee) || 0),
      currencyCode: this.normalizeText(payload.currencyCode as string) || 'BRL',
      source,
      status: this.normalizeQuoteStatus(payload.status as string | null | undefined),
      quoteToken: this.normalizeText(payload.quoteToken as string) || null,
      providerQuoteId: this.normalizeText(payload.providerQuoteId as string) || null,
      expiresAt: this.normalizeIsoTimestamp(payload.expiresAt as string | null | undefined),
      fallbackReason: this.normalizeText(payload.fallbackReason as string) || null,
      breakdownLabel: this.normalizeText(payload.breakdownLabel as string) || null
    });
  }

  private isQuoteExpired(quote: DeliveryQuoteResponse) {
    if (!quote.expiresAt) return false;
    const timestamp = Date.parse(quote.expiresAt);
    if (Number.isNaN(timestamp)) return false;
    return timestamp <= Date.now();
  }

  private async getOrderForDelivery(orderId: number) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: true,
        items: {
          include: {
            product: true
          }
        }
      }
    });

    if (!order) {
      throw new NotFoundException('Pedido nao encontrado.');
    }

    return order;
  }

  private buildOrderDraft(order: OrderWithDeliveryContext): DeliveryDraft {
    const items = (order.items || []).map((item) => ({
      productId: item.productId,
      name: item.product?.name || `Produto ${item.productId}`,
      quantity: item.quantity
    }));

    return {
      orderId: order.id,
      customerName: (order.customer?.name || '').trim(),
      customerPhone: (order.customer?.phone || '').trim(),
      dropoffAddress: this.buildCustomerAddress(order.customer),
      dropoffPlaceId: this.normalizeText(order.customer?.placeId) || null,
      dropoffLat:
        typeof order.customer?.lat === 'number' && Number.isFinite(order.customer.lat) ? order.customer.lat : null,
      dropoffLng:
        typeof order.customer?.lng === 'number' && Number.isFinite(order.customer.lng) ? order.customer.lng : null,
      orderTotal: this.toMoney(order.total ?? 0),
      totalUnits: items.reduce((sum, item) => sum + Math.max(Math.floor(item.quantity || 0), 0), 0),
      scheduledAt: order.scheduledAt?.toISOString() || '',
      manifestSummary: items.map((item) => `${item.name} x ${item.quantity}`).join(', '),
      items
    };
  }

  private collectMissingRequirements(order: OrderWithDeliveryContext, draft: DeliveryDraft) {
    return [
      ...(!this.hasPickupOriginConfigured() ? ['origem de coleta sem endereco configurado'] : []),
      ...(!order.customer?.name?.trim() ? ['cliente sem nome'] : []),
      ...(!order.customer?.phone?.trim() ? ['cliente sem telefone'] : []),
      ...(!draft.dropoffAddress ? ['cliente sem endereco completo para entrega'] : []),
      ...((order.items || []).length === 0 ? ['pedido sem itens'] : [])
    ];
  }

  private toMoney(value: number) {
    return roundMoney(value);
  }

  private buildCustomerAddress(customer?: OrderWithDeliveryContext['customer'] | null) {
    if (!customer) return '';

    const normalizedFallback = (customer.address || '').trim();
    const cityState = [customer.city, customer.state].filter(Boolean).join(' - ');
    const parts = [
      customer.addressLine1,
      customer.addressLine2,
      customer.neighborhood,
      cityState,
      customer.postalCode,
      customer.country
    ]
      .map((part) => (part || '').trim())
      .filter(Boolean);

    return parts.length > 0 ? parts.join(', ') : normalizedFallback;
  }

  private buildManifestSummary(items: DeliveryQuoteDraft['manifest']['items']) {
    return items.map((item) => `${item.name} x ${item.quantity}`).join(', ');
  }

  private async syncTrackingRecord(tracking: DeliveryTrackingRecord) {
    if (tracking.provider !== 'LOCAL') {
      return tracking;
    }

    const now = Date.now();
    const pickupAt = tracking.pickupEta ? new Date(tracking.pickupEta).getTime() : NaN;
    const dropoffAt = tracking.dropoffEta ? new Date(tracking.dropoffEta).getTime() : NaN;

    if (tracking.status !== 'DELIVERED' && Number.isFinite(dropoffAt) && now >= dropoffAt) {
      const delivered = await this.persistSyncedTracking({
        ...tracking,
        status: 'DELIVERED',
        updatedAt: new Date().toISOString()
      });
      await this.markOrderDeliveredIfNeeded(delivered.orderId);
      return delivered;
    }

    if (tracking.status === 'REQUESTED' && Number.isFinite(pickupAt) && now >= pickupAt) {
      return this.persistSyncedTracking({
        ...tracking,
        status: 'OUT_FOR_DELIVERY',
        updatedAt: new Date().toISOString()
      });
    }

    return tracking;
  }

  private async markOrderDeliveredIfNeeded(orderId: number) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.status === 'ENTREGUE' || order.status === 'CANCELADO') {
      return;
    }

    if (order.status !== 'PRONTO') {
      return;
    }

    await this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'ENTREGUE' }
    });
  }

  private async readTracking(orderId: number): Promise<DeliveryTrackingRecord | null> {
    const record = await this.prisma.idempotencyRecord.findUnique({
      where: {
        scope_idemKey: {
          scope: DELIVERY_TRACKING_SCOPE,
          idemKey: `ORDER_${orderId}`
        }
      }
    });
    if (!record) return null;

    try {
      return this.normalizeTrackingRecord(orderId, JSON.parse(record.responseJson) as LegacyDeliveryTrackingRecord);
    } catch {
      return null;
    }
  }

  private normalizeTrackingRecord(orderId: number, tracking: LegacyDeliveryTrackingRecord): DeliveryTrackingRecord {
    const createdAt = this.normalizeIsoTimestamp(tracking.createdAt) || new Date().toISOString();
    const updatedAt = this.normalizeIsoTimestamp(tracking.updatedAt) || createdAt;
    const trackingId =
      this.normalizeText(tracking.trackingId) ||
      this.normalizeText(tracking.providerDeliveryId) ||
      this.normalizeText(tracking.providerOrderId) ||
      `legacy-order-${orderId}`;

    return {
      id: Number(tracking.id) || undefined,
      orderId,
      provider: this.normalizeProvider(tracking.provider),
      status: this.normalizeTrackingStatus(tracking.status),
      providerDeliveryId: this.normalizeText(tracking.providerDeliveryId) || null,
      providerTrackingUrl: this.normalizeText(tracking.providerTrackingUrl) || this.normalizeText(tracking.trackingUrl) || null,
      pickupEta: this.normalizeIsoTimestamp(tracking.pickupEta),
      dropoffEta: this.normalizeIsoTimestamp(tracking.dropoffEta),
      lastError:
        this.normalizeText(tracking.lastError) || this.normalizeText(tracking.lastProviderError) || null,
      createdAt,
      updatedAt,
      trackingId,
      mode: 'PROVIDER',
      draft: this.normalizeDraft(orderId, tracking.draft),
      providerQuoteId: this.normalizeText(tracking.providerQuoteId) || null,
      quoteFee: Number.isFinite(Number(tracking.quoteFee)) ? this.toMoney(Number(tracking.quoteFee)) : null,
      quoteExpiresAt: this.normalizeIsoTimestamp(tracking.quoteExpiresAt)
    };
  }

  private normalizeProvider(provider: string | null | undefined): DeliveryTrackingRecord['provider'] {
    if (provider === 'LOCAL' || provider === 'UBER_DIRECT' || provider === 'LOGGI' || provider === 'NONE') {
      return provider;
    }
    return 'LOCAL';
  }

  private normalizeTrackingStatus(status: string | undefined): DeliveryTrackingRecord['status'] {
    if (
      status === 'NOT_REQUESTED' ||
      status === 'PENDING_REQUIREMENTS' ||
      status === 'REQUESTED' ||
      status === 'OUT_FOR_DELIVERY' ||
      status === 'DELIVERED' ||
      status === 'FAILED' ||
      status === 'CANCELED'
    ) {
      return status;
    }
    return 'REQUESTED';
  }

  private normalizeQuoteStatus(status: string | null | undefined): DeliveryQuoteResponse['status'] {
    if (
      status === 'NOT_REQUIRED' ||
      status === 'PENDING' ||
      status === 'QUOTED' ||
      status === 'FALLBACK' ||
      status === 'EXPIRED' ||
      status === 'FAILED'
    ) {
      return status;
    }
    return 'NOT_REQUIRED';
  }

  private normalizeQuoteSource(source: string | null | undefined): DeliveryQuoteResponse['source'] {
    if (source === 'NONE' || source === 'UBER_QUOTE' || source === 'LOGGI_QUOTE' || source === 'MANUAL_FALLBACK') {
      return source;
    }
    return 'NONE';
  }

  private normalizeDraft(orderId: number, draft?: Partial<DeliveryDraft>): DeliveryDraft {
    return {
      orderId,
      customerName: this.normalizeText(draft?.customerName) || '',
      customerPhone: this.normalizeText(draft?.customerPhone) || '',
      dropoffAddress: this.normalizeText(draft?.dropoffAddress) || '',
      dropoffPlaceId: this.normalizeText(draft?.dropoffPlaceId) || null,
      dropoffLat:
        typeof draft?.dropoffLat === 'number' && Number.isFinite(draft.dropoffLat) ? draft.dropoffLat : null,
      dropoffLng:
        typeof draft?.dropoffLng === 'number' && Number.isFinite(draft.dropoffLng) ? draft.dropoffLng : null,
      orderTotal: this.toMoney(Number(draft?.orderTotal) || 0),
      totalUnits: Math.max(
        Math.floor(Number(draft?.totalUnits) || 0),
        Array.isArray(draft?.items)
          ? draft.items.reduce((sum, item) => sum + Math.max(Number(item?.quantity) || 0, 0), 0)
          : 0
      ),
      scheduledAt: this.normalizeText(draft?.scheduledAt) || '',
      manifestSummary: this.normalizeText(draft?.manifestSummary) || '',
      items: Array.isArray(draft?.items)
        ? draft.items
            .map((item) => ({
              productId: Number(item?.productId) || 0,
              name: this.normalizeText(item?.name) || '',
              quantity: Math.max(Number(item?.quantity) || 0, 0)
            }))
            .filter((item) => item.productId > 0 || item.name || item.quantity > 0)
        : []
    };
  }

  private normalizeIsoTimestamp(value: string | null | undefined) {
    const normalized = this.normalizeText(value);
    if (!normalized) return null;

    const timestamp = Date.parse(normalized);
    if (Number.isNaN(timestamp)) {
      return null;
    }

    return new Date(timestamp).toISOString();
  }

  private normalizeText(value: string | null | undefined) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || '';
  }

  private async saveTracking(orderId: number, tracking: DeliveryTrackingRecord | LegacyDeliveryTrackingRecord) {
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 10);
    const normalized = this.normalizeTrackingRecord(orderId, tracking);

    await this.prisma.idempotencyRecord.upsert({
      where: {
        scope_idemKey: {
          scope: DELIVERY_TRACKING_SCOPE,
          idemKey: `ORDER_${orderId}`
        }
      },
      update: {
        requestHash: normalized.trackingId,
        responseJson: JSON.stringify(normalized),
        expiresAt
      },
      create: {
        scope: DELIVERY_TRACKING_SCOPE,
        idemKey: `ORDER_${orderId}`,
        requestHash: normalized.trackingId,
        responseJson: JSON.stringify(normalized),
        expiresAt
      }
    });

    return normalized;
  }

  private async persistSyncedTracking(tracking: DeliveryTrackingRecord) {
    return this.saveTracking(tracking.orderId, tracking);
  }
}
