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
  OrderFulfillmentModeEnum
} from '@querobroapp/shared';
import { PrismaService } from '../../prisma.service.js';
import {
  externalOrderScheduleErrorMessage,
  isExternalOrderScheduleAllowed
} from '../../common/external-order-schedule.js';
import type { DeliveryDispatchInput, DeliveryProvider, DeliveryQuoteInput } from './delivery-provider.js';
import { LocalDeliveryProvider } from './local-delivery.provider.js';
import { UberDirectProvider } from './uber-direct.provider.js';

type OrderWithDeliveryContext = Awaited<ReturnType<DeliveriesService['getOrderForDelivery']>>;
type DeliveryQuoteDraft = typeof DeliveryQuoteDraftSchema._type;
type DeliveryQuoteResponse = typeof DeliveryQuoteResponseSchema._type;
type DeliveryJob = typeof DeliveryJobSchema._type;

type DeliveryDraft = {
  orderId: number;
  customerName: string;
  customerPhone: string;
  dropoffAddress: string;
  dropoffPlaceId: string | null;
  dropoffLat: number | null;
  dropoffLng: number | null;
  orderTotal: number;
  scheduledAt: string;
  manifestSummary: string;
  items: Array<{
    productId: number;
    name: string;
    quantity: number;
  }>;
};

type DeliveryReadinessResult = {
  provider: 'NONE' | 'LOCAL' | 'UBER_DIRECT';
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

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async quoteDelivery(payload: unknown) {
    const draft = DeliveryQuoteDraftSchema.parse(payload);
    return this.quoteForDraft(draft, {
      enforceExternalSchedule: true,
      allowManualFallback: false
    });
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
        providerQuoteId: order.deliveryQuoteRef ?? null,
        quoteFee: this.toMoney(order.deliveryFee ?? 0),
        quoteExpiresAt: order.deliveryQuoteExpiresAt?.toISOString() ?? null
      });

      return { reusedExisting: false, tracking: blocked };
    }

    const provider = this.selectDispatchProvider(order.deliveryProvider);
    const input = this.buildProviderInput(readiness.draft, order.deliveryQuoteRef ?? null);

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
        providerQuoteId: order.deliveryQuoteRef ?? null,
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
        providerQuoteId: order.deliveryQuoteRef ?? null,
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

    if (this.uberProvider.isConfigured()) {
      try {
        return await this.uberProvider.quote(input);
      } catch (error) {
        if (options?.allowManualFallback !== false && error instanceof BadGatewayException) {
          return this.localProvider.quote(input);
        }
        throw error;
      }
    }

    return this.localProvider.quote(input);
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
    if (!allowManualFallback && this.uberProvider.isConfigured()) return false;
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
      manifestSummary: draft.manifestSummary,
      items: draft.items.map((item) => ({ name: item.name, quantity: item.quantity })),
      providerQuoteId
    };
  }

  private buildUberStructuredPickupAddress() {
    return [
      process.env.UBER_DIRECT_PICKUP_ADDRESS_LINE1,
      process.env.UBER_DIRECT_PICKUP_ADDRESS_LINE2,
      process.env.UBER_DIRECT_PICKUP_CITY,
      process.env.UBER_DIRECT_PICKUP_STATE,
      process.env.UBER_DIRECT_PICKUP_POSTAL_CODE,
      process.env.UBER_DIRECT_PICKUP_COUNTRY
    ]
      .map((value) => this.normalizeText(value))
      .filter(Boolean)
      .join(', ');
  }

  private pickupOriginKey() {
    return this.pickupOrigin().address || this.normalizeText(process.env.UBER_DIRECT_STORE_ID);
  }

  private hasPickupOriginConfigured() {
    return Boolean(this.pickupOriginKey());
  }

  private pickupOrigin() {
    return {
      name:
        this.normalizeText(process.env.DELIVERY_PICKUP_NAME) ||
        this.normalizeText(process.env.UBER_DIRECT_PICKUP_NAME) ||
        'Quero Broa',
      phone:
        this.normalizeText(process.env.DELIVERY_PICKUP_PHONE) ||
        this.normalizeText(process.env.UBER_DIRECT_PICKUP_PHONE) ||
        this.normalizeText(process.env.PIX_STATIC_KEY) ||
        '',
      address:
        this.normalizeText(process.env.DELIVERY_PICKUP_ADDRESS) || this.buildUberStructuredPickupAddress()
    };
  }

  private selectDispatchProvider(provider: string | null | undefined): DeliveryProvider {
    const normalized = this.normalizeProvider(provider);
    if (normalized === 'UBER_DIRECT' && this.uberProvider.isConfigured()) {
      return this.uberProvider;
    }
    return this.localProvider;
  }

  private quoteRequestHash(draft: DeliveryQuoteDraft) {
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
          itemCount: draft.manifest.items.length
        })
      )
      .digest('hex');
  }

  private quoteToken(requestHash: string) {
    return `DQ_${requestHash}`;
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
        quote: DeliveryQuoteResponseSchema.parse(parsed.quote)
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
    if (!Number.isFinite(value)) return 0;
    return Math.round((value + Number.EPSILON) * 100) / 100;
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
    if (provider === 'LOCAL' || provider === 'UBER_DIRECT' || provider === 'NONE') return provider;
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
