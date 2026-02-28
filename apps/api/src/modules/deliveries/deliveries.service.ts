import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  Inject,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma.service.js';

type OrderWithDeliveryContext = Awaited<ReturnType<DeliveriesService['getOrderForDelivery']>>;

type DeliveryDraft = {
  orderId: number;
  customerName: string;
  customerPhone: string;
  dropoffAddress: string;
  pickupAddress: string;
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
  provider: 'UBER_DIRECT';
  flow: 'SERVER_TO_SERVER';
  iframeSupported: false;
  ready: boolean;
  missingRequirements: string[];
  missingConfiguration: string[];
  manualHandoffUrl: string;
  draft: DeliveryDraft;
};

type DeliveryQuoteResult = {
  provider: 'UBER_DIRECT';
  flow: 'SERVER_TO_SERVER';
  iframeSupported: false;
  quoteCreated: true;
  requestedAt: string;
  manualHandoffUrl: string;
  draft: DeliveryDraft;
  quote: {
    providerQuoteId: string;
    fee: number;
    currencyCode: string;
    expiresAt: string;
    pickupDurationSeconds: number | null;
    dropoffEta: string;
  };
};

type DeliveryTrackingStatus =
  | 'PENDING_REQUIREMENTS'
  | 'REQUESTED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'FAILED';

type DeliveryTrackingRecord = {
  orderId: number;
  provider: 'UBER_DIRECT' | 'LOCAL_SIMULATED';
  mode: 'LIVE' | 'SIMULATED';
  status: DeliveryTrackingStatus;
  createdAt: string;
  updatedAt: string;
  providerDeliveryId: string;
  providerOrderId: string | null;
  providerQuoteId: string | null;
  trackingUrl: string;
  pickupEta: string | null;
  dropoffEta: string | null;
  lastProviderError: string | null;
  lastWebhookEventId: string | null;
  draft: DeliveryDraft;
};

@Injectable()
export class DeliveriesService {
  private uberAccessTokenCache: { accessToken: string; expiresAt: number } | null = null;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getUberDirectReadiness(orderId: number): Promise<DeliveryReadinessResult> {
    const order = await this.getOrderForDelivery(orderId);
    const pickupAddress = this.buildPickupAddressFromEnv();
    const dropoffAddress = this.buildCustomerAddress(order.customer);
    const manualHandoffUrl = this.buildManualUberUrl(order.customer);

    const missingRequirements = [
      ...(!order.customer?.name?.trim() ? ['cliente sem nome'] : []),
      ...(!order.customer?.phone?.trim() ? ['cliente sem telefone'] : []),
      ...(!dropoffAddress ? ['cliente sem endereco completo para entrega'] : []),
      ...((order.items || []).length === 0 ? ['pedido sem itens'] : [])
    ];

    const missingConfiguration = this.listMissingUberDirectConfiguration(pickupAddress);
    const items = (order.items || []).map((item) => ({
      productId: item.productId,
      name: item.product?.name || `Produto ${item.productId}`,
      quantity: item.quantity
    }));

    return {
      provider: 'UBER_DIRECT',
      flow: 'SERVER_TO_SERVER',
      iframeSupported: false,
      ready: missingRequirements.length === 0 && missingConfiguration.length === 0,
      missingRequirements,
      missingConfiguration,
      manualHandoffUrl,
      draft: {
        orderId: order.id,
        customerName: (order.customer?.name || '').trim(),
        customerPhone: (order.customer?.phone || '').trim(),
        dropoffAddress,
        pickupAddress,
        orderTotal: this.toMoney(order.total ?? 0),
        scheduledAt: order.scheduledAt?.toISOString() || '',
        manifestSummary: items.map((item) => `${item.name} x ${item.quantity}`).join(', '),
        items
      }
    };
  }

  async getUberDirectQuote(orderId: number): Promise<DeliveryQuoteResult> {
    const readiness = await this.getUberDirectReadiness(orderId);
    const blockingIssues = [...readiness.missingRequirements, ...readiness.missingConfiguration];

    if (blockingIssues.length > 0) {
      throw new BadRequestException(
        `Entrega ainda nao pronta para cotacao Uber: ${blockingIssues.join(' • ')}`
      );
    }

    const accessToken = await this.getUberDirectAccessToken();
    const usingCurrentApi = this.usesCurrentUberDirectOrdersApi();
    const response = await this.fetchWithTimeout(
      usingCurrentApi
        ? `${this.getUberDirectApiBaseUrl()}/v1/eats/deliveries/estimates`
        : `${this.getUberDirectApiBaseUrl()}/v1/customers/${encodeURIComponent(
            String(process.env.UBER_DIRECT_CUSTOMER_ID || '').trim()
          )}/delivery_quotes`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(
          usingCurrentApi
            ? {
                pickup: {
                  store_id: this.getUberDirectStoreId()
                },
                dropoff_address: {
                  formatted_address: readiness.draft.dropoffAddress
                },
                order_summary: {
                  total_amount: Math.round(readiness.draft.orderTotal * 100),
                  currency_code: 'BRL'
                }
              }
            : {
                pickup_address: readiness.draft.pickupAddress,
                dropoff_address: readiness.draft.dropoffAddress
              }
        )
      },
      'Nao foi possivel consultar a cotacao da Uber.'
    );
    const body = await this.readResponseBody(response);

    if (!response.ok) {
      throw new BadGatewayException(
        `Uber recusou a cotacao (HTTP ${response.status}): ${this.summarizeProviderBody(body)}`
      );
    }

    const quoteId = usingCurrentApi
      ? this.getStringField(body, 'estimate_id')
      : this.getStringField(body, 'quote_id');
    const fee = usingCurrentApi
      ? this.getNestedNumberField(body, 'delivery_fee', 'total')
      : this.getNumberField(body, 'fee');
    const currencyCode = usingCurrentApi
      ? this.getNestedStringField(body, 'delivery_fee', 'currency_code') ||
        this.getStringField(body, 'currency_code')
      : this.getStringField(body, 'currency_code');

    if (!quoteId || fee == null || !currencyCode) {
      throw new BadGatewayException('Uber respondeu sem os campos minimos da cotacao.');
    }

    return {
      provider: 'UBER_DIRECT',
      flow: 'SERVER_TO_SERVER',
      iframeSupported: false,
      quoteCreated: true,
      requestedAt: new Date().toISOString(),
      manualHandoffUrl: readiness.manualHandoffUrl,
      draft: readiness.draft,
      quote: {
        providerQuoteId: quoteId,
        fee: this.toMoney(usingCurrentApi ? fee / 100 : fee),
        currencyCode,
        expiresAt: this.getStringField(body, 'expires') || this.getStringField(body, 'expires_at'),
        pickupDurationSeconds: this.getNestedNumberField(body, 'pickup', 'duration'),
        dropoffEta:
          this.getNestedStringField(body, 'dropoff', 'eta') ||
          this.getStringField(body, 'dropoff_eta') ||
          this.getStringField(body, 'etd')
      }
    };
  }

  async dispatchOrderToUber(orderId: number) {
    const readiness = await this.getUberDirectReadiness(orderId);
    const existing = await this.readTracking(orderId);
    if (existing && existing.status !== 'FAILED' && existing.status !== 'DELIVERED') {
      return {
        reusedExisting: true,
        tracking: await this.syncTrackingRecord(existing)
      };
    }

    if (readiness.missingRequirements.length > 0) {
      const blocked = await this.saveTracking(orderId, {
        orderId,
        provider: 'LOCAL_SIMULATED',
        mode: 'SIMULATED',
        status: 'PENDING_REQUIREMENTS',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        providerDeliveryId: `blocked-${randomUUID()}`,
        providerOrderId: null,
        providerQuoteId: null,
        trackingUrl: readiness.manualHandoffUrl,
        pickupEta: null,
        dropoffEta: null,
        lastProviderError: readiness.missingRequirements.join(' • '),
        lastWebhookEventId: null,
        draft: readiness.draft
      });
      return {
        reusedExisting: false,
        tracking: blocked
      };
    }

    if (this.canUseLiveUberDispatch() && readiness.missingConfiguration.length === 0) {
      try {
        const liveTracking = await this.createLiveUberDirectDelivery(orderId, readiness);
        return {
          reusedExisting: false,
          tracking: liveTracking
        };
      } catch (error) {
        if (!this.shouldFallbackToLocalSimulation()) {
          throw error;
        }

        const fallbackMessage = error instanceof Error ? error.message : 'Falha ao criar entrega Uber.';
        const tracking = await this.createSimulatedTracking(orderId, readiness, fallbackMessage);
        return {
          reusedExisting: false,
          tracking
        };
      }
    }

    const tracking = await this.createSimulatedTracking(
      orderId,
      readiness,
      readiness.missingConfiguration.length > 0 ? readiness.missingConfiguration.join(' • ') : null
    );
    return {
      reusedExisting: false,
      tracking
    };
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

  async handleUberDirectWebhook(payload: unknown) {
    if (!payload || typeof payload !== 'object') {
      throw new BadRequestException('Payload invalido para webhook da Uber.');
    }

    const providerDeliveryId = this.getStringField(payload, 'delivery_id') || this.getStringField(payload, 'id');
    const providerOrderId =
      this.getStringField(payload, 'order_id') ||
      this.getNestedStringField(payload, 'meta', 'order_id');
    const externalOrderId =
      this.getNestedStringField(payload, 'meta', 'external_order_id') ||
      this.getStringField(payload, 'external_order_id');

    if (!providerDeliveryId && !providerOrderId && !externalOrderId) {
      throw new BadRequestException('Webhook da Uber sem identificador da entrega.');
    }

    const tracking = await this.findTrackingByProviderIdentifiers({
      providerDeliveryId,
      providerOrderId,
      externalOrderId
    });
    if (!tracking) {
      return {
        ok: true,
        ignored: true,
        reason: 'Entrega nao encontrada localmente.'
      };
    }

    const resourceHref = this.getStringField(payload, 'resource_href');
    if (resourceHref && tracking.mode === 'LIVE') {
      const refreshed = await this.trySyncLiveUberTrackingFromUrl(tracking, resourceHref);
      if (refreshed) {
        if (refreshed.status === 'DELIVERED') {
          await this.markOrderDeliveredIfNeeded(refreshed.orderId);
        }

        return {
          ok: true,
          ignored: false,
          tracking: refreshed
        };
      }
    }

    const nextStatus = this.mapProviderStatusToTrackingStatus(
      this.getStringField(payload, 'order_status') ||
        this.getStringField(payload, 'status') ||
        this.getNestedStringField(payload, 'delivery_status', 'status')
    );

    const synced = await this.persistSyncedTracking({
      ...tracking,
      status: nextStatus || tracking.status,
      updatedAt: new Date().toISOString(),
      lastWebhookEventId:
        this.getStringField(payload, 'event_id') ||
        this.getNestedStringField(payload, 'meta', 'event_id') ||
        tracking.lastWebhookEventId,
      dropoffEta:
        this.getStringField(payload, 'dropoff_eta') ||
        this.getNestedStringField(payload, 'dropoff', 'eta') ||
        tracking.dropoffEta
    });

    if (synced.status === 'DELIVERED') {
      await this.markOrderDeliveredIfNeeded(synced.orderId);
    }

    return {
      ok: true,
      ignored: false,
      tracking: synced
    };
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

  private buildPickupAddressFromEnv() {
    const parts = [
      process.env.UBER_DIRECT_PICKUP_ADDRESS_LINE1,
      process.env.UBER_DIRECT_PICKUP_ADDRESS_LINE2,
      process.env.UBER_DIRECT_PICKUP_CITY,
      process.env.UBER_DIRECT_PICKUP_STATE,
      process.env.UBER_DIRECT_PICKUP_POSTAL_CODE,
      process.env.UBER_DIRECT_PICKUP_COUNTRY
    ]
      .map((part) => (part || '').trim())
      .filter(Boolean);

    return parts.join(', ');
  }

  private buildManualUberUrl(customer?: OrderWithDeliveryContext['customer'] | null) {
    const dropoffAddress = this.buildCustomerAddress(customer);
    if (!dropoffAddress) return '';

    const params = new URLSearchParams();
    params.set('action', 'setPickup');
    params.set('pickup', 'my_location');
    params.set('dropoff[formatted_address]', dropoffAddress);
    if (customer?.name) params.set('dropoff[nickname]', customer.name.trim());
    if (Number.isFinite(customer?.lat) && Number.isFinite(customer?.lng)) {
      params.set('dropoff[latitude]', String(customer?.lat));
      params.set('dropoff[longitude]', String(customer?.lng));
    }

    return `https://m.uber.com/?${params.toString()}`;
  }

  private listMissingUberDirectConfiguration(pickupAddress: string) {
    const usingCurrentApi = this.usesCurrentUberDirectOrdersApi();
    return [
      ...(!pickupAddress && !usingCurrentApi ? ['endereco de coleta da loja nao configurado'] : []),
      ...(!String(process.env.UBER_DIRECT_PICKUP_NAME || '').trim() ? ['nome de coleta nao configurado'] : []),
      ...(!String(process.env.UBER_DIRECT_PICKUP_PHONE || '').trim() ? ['telefone de coleta nao configurado'] : []),
      ...(!usingCurrentApi && !String(process.env.UBER_DIRECT_CUSTOMER_ID || '').trim()
        ? ['UBER_DIRECT_CUSTOMER_ID ausente']
        : []),
      ...(usingCurrentApi && !this.getUberDirectStoreId() ? ['UBER_DIRECT_STORE_ID ausente'] : []),
      ...(!String(process.env.UBER_DIRECT_CLIENT_ID || '').trim() ? ['UBER_DIRECT_CLIENT_ID ausente'] : []),
      ...(!String(process.env.UBER_DIRECT_CLIENT_SECRET || '').trim() ? ['UBER_DIRECT_CLIENT_SECRET ausente'] : [])
    ];
  }

  private getUberDirectApiBaseUrl() {
    return String(process.env.UBER_DIRECT_API_BASE_URL || 'https://api.uber.com').trim();
  }

  private getUberDirectTokenUrl() {
    return String(process.env.UBER_DIRECT_TOKEN_URL || 'https://login.uber.com/oauth/v2/token').trim();
  }

  private getUberDirectScope() {
    return String(process.env.UBER_DIRECT_SCOPE || 'eats.deliveries').trim() || 'eats.deliveries';
  }

  private getUberDirectStoreId() {
    return String(process.env.UBER_DIRECT_STORE_ID || '').trim();
  }

  private usesCurrentUberDirectOrdersApi() {
    return Boolean(this.getUberDirectStoreId());
  }

  private getUberDirectRequestTimeoutMs() {
    const parsed = Number.parseInt(String(process.env.UBER_DIRECT_REQUEST_TIMEOUT_MS || ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return 12_000;
    return parsed;
  }

  private async getUberDirectAccessToken() {
    const cached = this.uberAccessTokenCache;
    if (cached && cached.expiresAt > Date.now()) {
      return cached.accessToken;
    }

    const clientId = String(process.env.UBER_DIRECT_CLIENT_ID || '').trim();
    const clientSecret = String(process.env.UBER_DIRECT_CLIENT_SECRET || '').trim();
    if (!clientId || !clientSecret) {
      throw new BadRequestException('Credenciais Uber Direct ausentes para autenticar a cotacao.');
    }

    const body = new URLSearchParams();
    body.set('client_id', clientId);
    body.set('client_secret', clientSecret);
    body.set('grant_type', 'client_credentials');
    body.set('scope', this.getUberDirectScope());

    const response = await this.fetchWithTimeout(
      this.getUberDirectTokenUrl(),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body.toString()
      },
      'Nao foi possivel autenticar com a Uber.'
    );
    const payload = await this.readResponseBody(response);

    if (!response.ok) {
      throw new BadGatewayException(
        `Uber recusou a autenticacao (HTTP ${response.status}): ${this.summarizeProviderBody(payload)}`
      );
    }

    const accessToken = this.getStringField(payload, 'access_token');
    if (!accessToken) {
      throw new BadGatewayException('Uber nao retornou access_token para a cotacao.');
    }

    const expiresIn = this.getNumberField(payload, 'expires_in') ?? 0;
    const ttlSeconds = expiresIn > 90 ? expiresIn - 60 : Math.max(expiresIn, 30);
    this.uberAccessTokenCache = {
      accessToken,
      expiresAt: Date.now() + ttlSeconds * 1000
    };

    return accessToken;
  }

  private async fetchWithTimeout(url: string, init: RequestInit, timeoutMessage: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.getUberDirectRequestTimeoutMs());

    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new GatewayTimeoutException(timeoutMessage);
      }

      const detail = error instanceof Error ? error.message : 'unknown error';
      throw new BadGatewayException(`${timeoutMessage} (${detail})`);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async readResponseBody(response: Response): Promise<unknown> {
    const raw = await response.text();
    if (!raw) return '';

    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return raw;
    }
  }

  private canUseLiveUberDispatch() {
    return this.resolveBooleanEnv(process.env.UBER_DIRECT_LIVE_DISPATCH_ENABLED, false);
  }

  private shouldFallbackToLocalSimulation() {
    return this.resolveBooleanEnv(process.env.UBER_DIRECT_FALLBACK_TO_LOCAL_SIMULATION, true);
  }

  private async createSimulatedTracking(
    orderId: number,
    readiness: DeliveryReadinessResult,
    fallbackError: string | null
  ) {
    const now = Date.now();
    const pickupEta = new Date(now + 10 * 60 * 1000).toISOString();
    const dropoffEta = new Date(now + 40 * 60 * 1000).toISOString();
    return this.saveTracking(orderId, {
      orderId,
      provider: 'LOCAL_SIMULATED',
      mode: 'SIMULATED',
      status: 'REQUESTED',
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      providerDeliveryId: `local-${randomUUID()}`,
      providerOrderId: null,
      providerQuoteId: null,
      trackingUrl: readiness.manualHandoffUrl,
      pickupEta,
      dropoffEta,
      lastProviderError: fallbackError,
      lastWebhookEventId: null,
      draft: readiness.draft
    });
  }

  private async createLiveUberDirectDelivery(orderId: number, readiness: DeliveryReadinessResult) {
    const quote = await this.getUberDirectQuote(orderId);
    const accessToken = await this.getUberDirectAccessToken();
    const usingCurrentApi = this.usesCurrentUberDirectOrdersApi();

    const response = await this.fetchWithTimeout(
      usingCurrentApi
        ? `${this.getUberDirectApiBaseUrl()}/v1/eats/deliveries/orders`
        : `${this.getUberDirectApiBaseUrl()}/v1/customers/${encodeURIComponent(
            String(process.env.UBER_DIRECT_CUSTOMER_ID || '').trim()
          )}/deliveries`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(
          usingCurrentApi
            ? {
                estimate_id: quote.quote.providerQuoteId,
                external_order_id: `querobroapp-order-${orderId}`,
                pickup: {
                  store_id: this.getUberDirectStoreId(),
                  instructions: String(process.env.UBER_DIRECT_PICKUP_INSTRUCTIONS || '').trim() || undefined
                },
                dropoff: {
                  contact: {
                    first_name: readiness.draft.customerName || 'Cliente',
                    phone: readiness.draft.customerPhone
                  },
                  address: {
                    formatted_address: readiness.draft.dropoffAddress
                  }
                },
                order_items: readiness.draft.items.map((item) => ({
                  id: String(item.productId),
                  title: item.name,
                  quantity: item.quantity
                })),
                order_summary: {
                  subtotal: {
                    amount: Math.round(readiness.draft.orderTotal * 100),
                    currency_code: 'BRL'
                  }
                }
              }
            : {
                external_id: `querobroapp-order-${orderId}`,
                quote_id: quote.quote.providerQuoteId,
                pickup_name: String(process.env.UBER_DIRECT_PICKUP_NAME || '').trim(),
                pickup_address: readiness.draft.pickupAddress,
                pickup_phone_number: String(process.env.UBER_DIRECT_PICKUP_PHONE || '').trim(),
                dropoff_name: readiness.draft.customerName,
                dropoff_address: readiness.draft.dropoffAddress,
                dropoff_phone_number: readiness.draft.customerPhone,
                manifest_reference: `Pedido #${orderId}`,
                manifest_items: readiness.draft.items.map((item) => ({
                  name: item.name,
                  quantity: item.quantity,
                  size: 'small'
                }))
              }
        )
      },
      'Nao foi possivel criar a entrega da Uber.'
    );
    const body = await this.readResponseBody(response);

    if (!response.ok) {
      throw new BadGatewayException(
        `Uber recusou a criacao da entrega (HTTP ${response.status}): ${this.summarizeProviderBody(body)}`
      );
    }

    const providerOrderId =
      this.getStringField(body, 'order_id') ||
      this.getStringField(body, 'id') ||
      null;
    const providerDeliveryId =
      this.getStringField(body, 'delivery_id') ||
      providerOrderId ||
      `uber-${randomUUID()}`;
    if (!providerOrderId && !providerDeliveryId) {
      throw new BadGatewayException('Uber nao retornou o identificador da entrega criada.');
    }

    return this.saveTracking(orderId, {
      orderId,
      provider: 'UBER_DIRECT',
      mode: 'LIVE',
      status:
        this.mapProviderStatusToTrackingStatus(
          this.getStringField(body, 'order_status') || this.getStringField(body, 'status')
        ) || 'REQUESTED',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      providerDeliveryId,
      providerOrderId,
      providerQuoteId: quote.quote.providerQuoteId,
      trackingUrl:
        this.getStringField(body, 'order_tracking_url') ||
        this.getStringField(body, 'tracking_url') ||
        this.getNestedStringField(body, 'tracking', 'url') ||
        quote.manualHandoffUrl,
      pickupEta:
        this.getStringField(body, 'pickup_eta') ||
        this.getNestedStringField(body, 'pickup', 'eta') ||
        null,
      dropoffEta:
        this.getStringField(body, 'dropoff_eta') ||
        this.getNestedStringField(body, 'dropoff', 'eta') ||
        quote.quote.dropoffEta ||
        null,
      lastProviderError: null,
      lastWebhookEventId: null,
      draft: readiness.draft
    });
  }

  private async syncTrackingRecord(tracking: DeliveryTrackingRecord) {
    if (tracking.mode === 'SIMULATED') {
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

      if (
        tracking.status === 'REQUESTED' &&
        Number.isFinite(pickupAt) &&
        now >= pickupAt
      ) {
        return this.persistSyncedTracking({
          ...tracking,
          status: 'OUT_FOR_DELIVERY',
          updatedAt: new Date().toISOString()
        });
      }

      return tracking;
    }

    const providerTracking = await this.trySyncLiveUberTracking(tracking);
    if (!providerTracking) {
      return tracking;
    }

    if (providerTracking.status === 'DELIVERED') {
      await this.markOrderDeliveredIfNeeded(providerTracking.orderId);
    }
    return providerTracking;
  }

  private async trySyncLiveUberTracking(tracking: DeliveryTrackingRecord) {
    if (!this.resolveBooleanEnv(process.env.UBER_DIRECT_LIVE_TRACKING_ENABLED, false)) {
      return null;
    }
    if (!tracking.providerOrderId && !tracking.providerDeliveryId) {
      return null;
    }

    const liveId = tracking.providerOrderId || tracking.providerDeliveryId;
    const url = `${this.getUberDirectApiBaseUrl()}/v1/eats/deliveries/orders/${encodeURIComponent(liveId)}`;
    return this.trySyncLiveUberTrackingFromUrl(tracking, url);
  }

  private async trySyncLiveUberTrackingFromUrl(tracking: DeliveryTrackingRecord, url: string) {
    const accessToken = await this.getUberDirectAccessToken();
    const normalizedUrl = /^https?:\/\//i.test(url)
      ? url
      : `${this.getUberDirectApiBaseUrl().replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;

    try {
      const response = await this.fetchWithTimeout(
        normalizedUrl,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        },
        'Nao foi possivel sincronizar o rastreio da Uber.'
      );
      const body = await this.readResponseBody(response);
      if (!response.ok) {
        return this.persistSyncedTracking({
          ...tracking,
          updatedAt: new Date().toISOString(),
          lastProviderError: this.summarizeProviderBody(body)
        });
      }

      const nextStatus = this.mapProviderStatusToTrackingStatus(
        this.getStringField(body, 'order_status') || this.getStringField(body, 'status')
      );
      return this.persistSyncedTracking({
        ...tracking,
        status: nextStatus || tracking.status,
        updatedAt: new Date().toISOString(),
        providerDeliveryId:
          this.getStringField(body, 'delivery_id') || tracking.providerDeliveryId,
        providerOrderId:
          this.getStringField(body, 'order_id') || tracking.providerOrderId || tracking.providerDeliveryId,
        trackingUrl:
          this.getStringField(body, 'order_tracking_url') ||
          this.getStringField(body, 'tracking_url') ||
          this.getNestedStringField(body, 'tracking', 'url') ||
          tracking.trackingUrl,
        pickupEta:
          this.getStringField(body, 'pickup_eta') ||
          this.getNestedStringField(body, 'pickup', 'eta') ||
          tracking.pickupEta,
        dropoffEta:
          this.getStringField(body, 'dropoff_eta') ||
          this.getNestedStringField(body, 'dropoff', 'eta') ||
          tracking.dropoffEta,
        lastProviderError: null
      });
    } catch (error) {
      return this.persistSyncedTracking({
        ...tracking,
        updatedAt: new Date().toISOString(),
        lastProviderError: error instanceof Error ? error.message : 'Falha ao sincronizar rastreio.'
      });
    }
  }

  private mapProviderStatusToTrackingStatus(status: string) {
    const normalized = status.trim().toUpperCase();
    if (!normalized) return null;
    if (
      normalized.includes('DELIVERED') ||
      normalized.includes('DROPPED_OFF') ||
      normalized.includes('COMPLETED')
    ) {
      return 'DELIVERED';
    }
    if (
      normalized.includes('COURIER') ||
      normalized.includes('EN_ROUTE') ||
      normalized.includes('PICKED') ||
      normalized.includes('ACTIVE')
    ) {
      return 'OUT_FOR_DELIVERY';
    }
    if (normalized.includes('FAILED') || normalized.includes('CANCELLED') || normalized.includes('CANCELED')) {
      return 'FAILED';
    }
    if (
      normalized.includes('REQUESTED') ||
      normalized.includes('PENDING') ||
      normalized.includes('CREATED') ||
      normalized.includes('ACCEPTED') ||
      normalized.includes('PROCESSING') ||
      normalized.includes('UNASSIGNED')
    ) {
      return 'REQUESTED';
    }
    return null;
  }

  private async markOrderDeliveredIfNeeded(orderId: number) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.status === 'ENTREGUE' || order.status === 'CANCELADO') {
      return;
    }

    await this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'ENTREGUE' }
    });
  }

  private async readTracking(orderId: number) {
    const record = await this.prisma.idempotencyRecord.findUnique({
      where: {
        scope_idemKey: {
          scope: 'DELIVERY_TRACKING',
          idemKey: `ORDER_${orderId}`
        }
      }
    });
    if (!record) return null;

    try {
      return this.normalizeTrackingRecord(JSON.parse(record.responseJson) as DeliveryTrackingRecord);
    } catch {
      return null;
    }
  }

  private normalizeTrackingRecord(tracking: DeliveryTrackingRecord) {
    return {
      ...tracking,
      providerOrderId: tracking.providerOrderId || tracking.providerDeliveryId || null,
      lastWebhookEventId: tracking.lastWebhookEventId || null
    };
  }

  private extractLocalOrderIdFromExternalId(externalOrderId: string) {
    const match = externalOrderId.trim().match(/^querobroapp-order-(\d+)$/i);
    if (!match) return null;
    const parsed = Number.parseInt(match[1] || '', 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
  }

  private async findTrackingByProviderIdentifiers(input: {
    providerDeliveryId?: string | null;
    providerOrderId?: string | null;
    externalOrderId?: string | null;
  }) {
    const localOrderId =
      input.externalOrderId && input.externalOrderId.trim()
        ? this.extractLocalOrderIdFromExternalId(input.externalOrderId)
        : null;
    if (localOrderId) {
      const direct = await this.readTracking(localOrderId);
      if (direct) return direct;
    }

    const records = await this.prisma.idempotencyRecord.findMany({
      where: {
        scope: 'DELIVERY_TRACKING'
      }
    });

    for (const record of records) {
      try {
        const parsed = this.normalizeTrackingRecord(JSON.parse(record.responseJson) as DeliveryTrackingRecord);
        if (
          (input.providerDeliveryId && parsed.providerDeliveryId === input.providerDeliveryId) ||
          (input.providerOrderId && parsed.providerOrderId === input.providerOrderId)
        ) {
          return parsed;
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  private async saveTracking(orderId: number, tracking: DeliveryTrackingRecord) {
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 10);
    const normalized = this.normalizeTrackingRecord(tracking);
    await this.prisma.idempotencyRecord.upsert({
      where: {
        scope_idemKey: {
          scope: 'DELIVERY_TRACKING',
          idemKey: `ORDER_${orderId}`
        }
      },
      update: {
        requestHash: normalized.providerOrderId || normalized.providerDeliveryId,
        responseJson: JSON.stringify(normalized),
        expiresAt
      },
      create: {
        scope: 'DELIVERY_TRACKING',
        idemKey: `ORDER_${orderId}`,
        requestHash: normalized.providerOrderId || normalized.providerDeliveryId,
        responseJson: JSON.stringify(normalized),
        expiresAt
      }
    });

    return normalized;
  }

  private async persistSyncedTracking(tracking: DeliveryTrackingRecord) {
    return this.saveTracking(tracking.orderId, tracking);
  }

  private resolveBooleanEnv(rawValue: string | undefined, fallback: boolean) {
    if (rawValue == null || rawValue.trim() === '') return fallback;
    const normalized = rawValue.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
  }

  private summarizeProviderBody(body: unknown) {
    if (typeof body === 'string') {
      return body.trim() || 'sem detalhes';
    }

    if (!body || typeof body !== 'object') {
      return 'sem detalhes';
    }

    const record = body as Record<string, unknown>;
    const candidates = [
      record.message,
      record.error,
      record.error_description,
      record.code,
      record.title
    ]
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean);

    if (candidates.length > 0) {
      return candidates.join(' • ');
    }

    try {
      return JSON.stringify(body);
    } catch {
      return 'sem detalhes';
    }
  }

  private getStringField(body: unknown, key: string) {
    if (!body || typeof body !== 'object') return '';
    const value = (body as Record<string, unknown>)[key];
    return typeof value === 'string' ? value.trim() : '';
  }

  private getNumberField(body: unknown, key: string) {
    if (!body || typeof body !== 'object') return null;
    const value = (body as Record<string, unknown>)[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private getNestedStringField(body: unknown, parentKey: string, key: string) {
    if (!body || typeof body !== 'object') return '';
    const parent = (body as Record<string, unknown>)[parentKey];
    if (!parent || typeof parent !== 'object') return '';
    const value = (parent as Record<string, unknown>)[key];
    return typeof value === 'string' ? value.trim() : '';
  }

  private getNestedNumberField(body: unknown, parentKey: string, key: string) {
    if (!body || typeof body !== 'object') return null;
    const parent = (body as Record<string, unknown>)[parentKey];
    if (!parent || typeof parent !== 'object') return null;
    const value = (parent as Record<string, unknown>)[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }
}
