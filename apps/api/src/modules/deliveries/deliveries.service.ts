import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  Inject,
  Injectable,
  NotFoundException
} from '@nestjs/common';
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

    const customerId = String(process.env.UBER_DIRECT_CUSTOMER_ID || '').trim();
    const quoteUrl = `${this.getUberDirectApiBaseUrl()}/v1/customers/${encodeURIComponent(customerId)}/delivery_quotes`;
    const accessToken = await this.getUberDirectAccessToken();
    const response = await this.fetchWithTimeout(
      quoteUrl,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          pickup_address: readiness.draft.pickupAddress,
          dropoff_address: readiness.draft.dropoffAddress
        })
      },
      'Nao foi possivel consultar a cotacao da Uber.'
    );
    const body = await this.readResponseBody(response);

    if (!response.ok) {
      throw new BadGatewayException(
        `Uber recusou a cotacao (HTTP ${response.status}): ${this.summarizeProviderBody(body)}`
      );
    }

    const quoteId = this.getStringField(body, 'quote_id');
    const fee = this.getNumberField(body, 'fee');
    const currencyCode = this.getStringField(body, 'currency_code');

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
        fee: this.toMoney(fee),
        currencyCode,
        expiresAt: this.getStringField(body, 'expires'),
        pickupDurationSeconds: this.getNestedNumberField(body, 'pickup', 'duration'),
        dropoffEta: this.getNestedStringField(body, 'dropoff', 'eta')
      }
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
    return [
      ...(!pickupAddress ? ['endereco de coleta da loja nao configurado'] : []),
      ...(!String(process.env.UBER_DIRECT_PICKUP_NAME || '').trim() ? ['nome de coleta nao configurado'] : []),
      ...(!String(process.env.UBER_DIRECT_PICKUP_PHONE || '').trim() ? ['telefone de coleta nao configurado'] : []),
      ...(!String(process.env.UBER_DIRECT_CUSTOMER_ID || '').trim() ? ['UBER_DIRECT_CUSTOMER_ID ausente'] : []),
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
