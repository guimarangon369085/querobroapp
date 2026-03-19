import { BadGatewayException, BadRequestException, GatewayTimeoutException } from '@nestjs/common';
import { normalizePhoneNumber, roundMoney } from '@querobroapp/shared';
import type {
  DeliveryDispatchInput,
  DeliveryDispatchOutput,
  DeliveryProvider,
  DeliveryQuoteInput,
  DeliveryQuoteOutput
} from './delivery-provider.js';
import { FIXED_PICKUP_ORIGIN } from './pickup-origin.js';

function normalizePath(pathname: string) {
  if (!pathname) return '';
  return pathname.startsWith('/') ? pathname : `/${pathname}`;
}

export class UberDirectProvider implements DeliveryProvider {
  private accessTokenCache: { accessToken: string; expiresAt: number } | null = null;

  private toMoney(value: number) {
    return roundMoney(value);
  }

  private baseUrl() {
    return String(process.env.UBER_DIRECT_API_BASE_URL || process.env.UBER_DIRECT_BASE_URL || 'https://api.uber.com')
      .trim()
      .replace(/\/+$/, '');
  }

  private tokenUrl() {
    return String(process.env.UBER_DIRECT_TOKEN_URL || 'https://login.uber.com/oauth/v2/token').trim();
  }

  private staticBearerToken() {
    return String(process.env.UBER_DIRECT_BEARER_TOKEN || '').trim();
  }

  private clientId() {
    return String(process.env.UBER_DIRECT_CLIENT_ID || '').trim();
  }

  private clientSecret() {
    return String(process.env.UBER_DIRECT_CLIENT_SECRET || '').trim();
  }

  private scope() {
    return String(process.env.UBER_DIRECT_SCOPE || 'eats.deliveries').trim() || 'eats.deliveries';
  }

  private customerId() {
    return String(process.env.UBER_DIRECT_CUSTOMER_ID || '').trim();
  }

  private storeId() {
    return String(process.env.UBER_DIRECT_STORE_ID || '').trim();
  }

  private apiMode() {
    return String(process.env.UBER_DIRECT_API_MODE || 'LEGACY_CUSTOMER')
      .trim()
      .toUpperCase();
  }

  private usesCurrentOrdersApi() {
    return this.apiMode() === 'STORE_ESTIMATES' && Boolean(this.storeId());
  }

  private requestTimeoutMs() {
    const parsed = Number.parseInt(String(process.env.UBER_DIRECT_REQUEST_TIMEOUT_MS || ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return 12_000;
    return parsed;
  }

  private pickupInstructions() {
    return String(process.env.UBER_DIRECT_PICKUP_INSTRUCTIONS || '').trim();
  }

  private currentApiPickupTimes(input: DeliveryQuoteInput) {
    const scheduledAtMs = input.scheduledAt ? Date.parse(input.scheduledAt) : Number.NaN;
    return Number.isFinite(scheduledAtMs) && scheduledAtMs > Date.now() ? [scheduledAtMs] : [0];
  }

  private buildCurrentApiAddressPayload(input: DeliveryQuoteInput) {
    const formattedAddress = input.dropoffAddress.trim();
    if (!formattedAddress) {
      throw new BadRequestException('Endereco de entrega obrigatorio para cotar Uber Envios.');
    }

    const payload: Record<string, unknown> = {
      formatted_address: formattedAddress
    };

    if (input.dropoffPlaceId?.trim()) {
      payload.place = {
        id: input.dropoffPlaceId.trim()
      };
      return payload;
    }

    if (Number.isFinite(input.dropoffLat) && Number.isFinite(input.dropoffLng)) {
      payload.location = {
        latitude: input.dropoffLat,
        longitude: input.dropoffLng
      };
    }

    return payload;
  }

  private quotesPath() {
    const template = String(
      process.env.UBER_DIRECT_QUOTES_PATH ||
        (this.usesCurrentOrdersApi()
          ? '/v1/eats/deliveries/estimates'
          : '/v1/customers/{customerId}/delivery_quotes')
    ).trim();
    return normalizePath(
      template.replaceAll('{customerId}', this.customerId()).replaceAll('{storeId}', this.storeId())
    );
  }

  private deliveriesPath() {
    const template = String(
      process.env.UBER_DIRECT_DELIVERIES_PATH ||
        (this.usesCurrentOrdersApi()
          ? '/v1/eats/deliveries/orders'
          : '/v1/customers/{customerId}/deliveries')
    ).trim();
    return normalizePath(
      template.replaceAll('{customerId}', this.customerId()).replaceAll('{storeId}', this.storeId())
    );
  }

  isConfigured() {
    if (!this.baseUrl()) return false;
    if (!this.staticBearerToken() && !(this.clientId() && this.clientSecret())) return false;
    if (this.usesCurrentOrdersApi()) return true;
    return Boolean(this.customerId());
  }

  isCoverageLimitError(error: unknown) {
    const payload = this.unwrapErrorPayload(error);
    const code = this.getStringField(payload, 'code').toLowerCase();
    const message = this.getStringField(payload, 'message').toLowerCase();
    const details = this.getNestedStringField(payload, 'metadata', 'details').toLowerCase();
    return (
      code === 'address_undeliverable' ||
      /max radius|calculated distance|area de cobertura/.test(`${message} ${details}`)
    );
  }

  private unwrapErrorPayload(error: unknown) {
    if (error instanceof BadRequestException || error instanceof BadGatewayException) {
      const response = error.getResponse();
      return response && typeof response === 'object' ? response : {};
    }
    return error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  }

  private async buildHeaders() {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await this.resolveAccessToken()}`
    };
    if (!this.usesCurrentOrdersApi() && this.customerId()) {
      headers['X-Customer-Id'] = this.customerId();
    }
    return headers;
  }

  private buildQuotePayload(input: DeliveryQuoteInput) {
    const pickupPhone = this.normalizeUberPhone(input.pickupPhone);
    const dropoffPhone = this.normalizeUberPhone(input.dropoffPhone);
    if (this.usesCurrentOrdersApi()) {
      return {
        pickup: {
          store_id: this.storeId(),
          instructions: this.pickupInstructions() || undefined
        },
        dropoff_address: this.buildCurrentApiAddressPayload(input),
        pickup_times: this.currentApiPickupTimes(input),
        order_summary: {
          order_value: Math.round(this.toMoney(input.orderTotal) * 100),
          currency_code: 'BRL'
        }
      };
    }

    return {
      pickup_address: FIXED_PICKUP_ORIGIN.fullAddress,
      pickup_name: input.pickupName,
      pickup_phone_number: pickupPhone,
      dropoff_address: input.dropoffAddress,
      dropoff_name: input.dropoffName,
      dropoff_phone_number: dropoffPhone,
      manifest_total_value: Math.round(this.toMoney(input.orderTotal) * 100),
      manifest_reference: input.manifestSummary.slice(0, 256),
      manifest_items: input.items.map((item) => ({
        name: item.name,
        quantity: Math.max(Math.floor(item.quantity || 0), 0),
        size: 'small'
      })),
      pickup_ready_dt: input.scheduledAt,
      dropoff_ready_dt: input.scheduledAt
    };
  }

  private buildDeliveryPayload(input: DeliveryDispatchInput) {
    const dropoffPhone = this.normalizeUberPhone(input.dropoffPhone);
    if (this.usesCurrentOrdersApi()) {
      return {
        quote_id: input.providerQuoteId || undefined,
        external_order_id: input.orderId ? `querobroapp-order-${input.orderId}` : undefined,
        pickup: {
          store_id: this.storeId(),
          instructions: this.pickupInstructions() || undefined
        },
        dropoff: {
          contact: {
            first_name: input.dropoffName || 'Cliente',
            phone_number: dropoffPhone || undefined
          },
          location: {
            address: this.buildCurrentApiAddressPayload(input)
          }
        },
        order_reference: input.manifestSummary.slice(0, 256)
      };
    }

    return {
      ...this.buildQuotePayload(input),
      external_id: input.orderId ? `order-${input.orderId}` : undefined,
      quote_id: input.providerQuoteId || undefined
    };
  }

  private getStringField(value: unknown, key: string) {
    if (!value || typeof value !== 'object') return '';
    const raw = (value as Record<string, unknown>)[key];
    return typeof raw === 'string' ? raw.trim() : '';
  }

  private getNumberField(value: unknown, key: string) {
    if (!value || typeof value !== 'object') return null;
    const raw = (value as Record<string, unknown>)[key];
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
  }

  private getNestedStringField(value: unknown, outer: string, inner: string) {
    if (!value || typeof value !== 'object') return '';
    return this.getStringField((value as Record<string, unknown>)[outer], inner);
  }

  private getNestedNumberField(value: unknown, outer: string, inner: string) {
    if (!value || typeof value !== 'object') return null;
    return this.getNumberField((value as Record<string, unknown>)[outer], inner);
  }

  private milesToKm(value: number) {
    return this.toMoney(value * 1.60934);
  }

  private metersToKm(value: number) {
    return this.toMoney(value / 1000);
  }

  private resolveDistanceKm(value: unknown): number | null {
    const scalarKm =
      this.getNumberField(value, 'distance_km') ??
      this.getNumberField(value, 'distanceKm') ??
      this.getNumberField(value, 'distance_in_km');
    if (Number.isFinite(scalarKm ?? Number.NaN) && Number(scalarKm) > 0) {
      return this.toMoney(Number(scalarKm));
    }

    const scalarMeters =
      this.getNumberField(value, 'distance_meters') ??
      this.getNumberField(value, 'distanceMeters') ??
      this.getNestedNumberField(value, 'distance', 'meters');
    if (Number.isFinite(scalarMeters ?? Number.NaN) && Number(scalarMeters) > 0) {
      return this.metersToKm(Number(scalarMeters));
    }

    const scalarMiles =
      this.getNumberField(value, 'distance_miles') ??
      this.getNumberField(value, 'distanceMiles') ??
      this.getNestedNumberField(value, 'distance', 'miles');
    if (Number.isFinite(scalarMiles ?? Number.NaN) && Number(scalarMiles) > 0) {
      return this.milesToKm(Number(scalarMiles));
    }

    const scalarDistance = this.getNumberField(value, 'distance');
    if (Number.isFinite(scalarDistance ?? Number.NaN) && Number(scalarDistance) > 0) {
      const unit = [
        this.getStringField(value, 'distance_unit'),
        this.getStringField(value, 'distanceUnit'),
        this.getStringField(value, 'unit')
      ]
        .join(' ')
        .toLowerCase();
      if (unit.includes('mile')) {
        return this.milesToKm(Number(scalarDistance));
      }
      if (unit.includes('meter')) {
        return this.metersToKm(Number(scalarDistance));
      }
      if (unit.includes('km') || unit.includes('kilometer') || unit.includes('kilometre')) {
        return this.toMoney(Number(scalarDistance));
      }
    }

    return null;
  }

  private resolveAmount(value: unknown, options?: { treatScalarAsMinorUnits?: boolean }) {
    if (typeof value === 'number') {
      return this.toMoney(options?.treatScalarAsMinorUnits ? value / 100 : value);
    }
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (typeof record.total === 'number') {
        return this.toMoney(record.total / 100);
      }
      if (typeof record.amount === 'number') {
        const multiplier = typeof record.currency === 'string' || typeof record.currency_code === 'string' ? 100 : 1;
        return this.toMoney(multiplier === 100 ? record.amount / 100 : record.amount);
      }
      if (typeof record.value === 'number') {
        return this.toMoney(record.value);
      }
    }
    return 0;
  }

  private resolveCurrency(value: unknown) {
    if (typeof value === 'string' && value.trim()) return value.trim().toUpperCase();
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (typeof record.currency_code === 'string' && record.currency_code.trim()) {
        return record.currency_code.trim().toUpperCase();
      }
      if (typeof record.currency_type === 'string' && record.currency_type.trim()) {
        return record.currency_type.trim().toUpperCase();
      }
      if (typeof record.currency === 'string' && record.currency.trim()) {
        return record.currency.trim().toUpperCase();
      }
    }
    return 'BRL';
  }

  private async resolveAccessToken() {
    const staticToken = this.staticBearerToken();
    if (staticToken) {
      return staticToken;
    }

    const cached = this.accessTokenCache;
    if (cached && cached.expiresAt > Date.now()) {
      return cached.accessToken;
    }

    const clientId = this.clientId();
    const clientSecret = this.clientSecret();
    if (!clientId || !clientSecret) {
      throw new BadRequestException('Credenciais Uber Direct ausentes para autenticar a cotacao.');
    }

    const body = new URLSearchParams();
    body.set('client_id', clientId);
    body.set('client_secret', clientSecret);
    body.set('grant_type', 'client_credentials');
    body.set('scope', this.scope());

    const response = await this.fetchWithTimeout(
      this.tokenUrl(),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body.toString()
      },
      'Nao foi possivel autenticar com a Uber.'
    );
    const parsed = await this.readResponseBody(response);

    if (!response.ok) {
      throw new BadGatewayException({
        message: 'Uber recusou a autenticacao.',
        statusCode: response.status,
        provider: 'UBER_DIRECT',
        details: parsed
      });
    }

    const accessToken = this.getStringField(parsed, 'access_token');
    if (!accessToken) {
      throw new BadGatewayException('Uber nao retornou access_token para a cotacao.');
    }

    const expiresIn = this.getNumberField(parsed, 'expires_in') ?? 0;
    const ttlSeconds = expiresIn > 90 ? expiresIn - 60 : Math.max(expiresIn, 30);
    this.accessTokenCache = {
      accessToken,
      expiresAt: Date.now() + ttlSeconds * 1000
    };

    return accessToken;
  }

  private async fetchWithTimeout(url: string, init: RequestInit, timeoutMessage: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs());

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

  private async request(pathname: string, body: unknown) {
    const response = await this.fetchWithTimeout(
      `${this.baseUrl()}${pathname}`,
      {
        method: 'POST',
        headers: await this.buildHeaders(),
        body: JSON.stringify(body)
      },
      'Nao foi possivel consultar a Uber.'
    );
    const parsed = await this.readResponseBody(response);
    if (!response.ok) {
      if ([400, 404, 409, 422].includes(response.status)) {
        throw new BadRequestException({
          message: this.resolveBadRequestMessage(parsed),
          statusCode: response.status,
          provider: 'UBER_DIRECT',
          details: parsed
        });
      }
      throw new BadGatewayException({
        message: 'Uber Direct respondeu com erro.',
        statusCode: response.status,
        provider: 'UBER_DIRECT',
        details: parsed
      });
    }
    return parsed;
  }

  async quote(input: DeliveryQuoteInput): Promise<DeliveryQuoteOutput> {
    const payload = this.buildQuotePayload(input);
    const parsed = (await this.request(this.quotesPath(), payload)) as Record<string, unknown> | null;
    const usingCurrentApi = this.usesCurrentOrdersApi();
    const providerQuoteId = usingCurrentApi
      ? this.getStringField(parsed, 'estimate_id') ||
        this.getStringField(parsed, 'quote_id') ||
        this.getStringField(parsed, 'id') ||
        null
      : (typeof parsed?.id === 'string' && parsed.id) ||
        (typeof parsed?.quote_id === 'string' && parsed.quote_id) ||
        (typeof parsed?.quoteId === 'string' && parsed.quoteId) ||
        null;
    const currentEstimates =
      usingCurrentApi && Array.isArray(parsed?.estimates)
        ? (parsed?.estimates as Array<Record<string, unknown>>)
        : [];
    const currentPrimaryEstimate = currentEstimates[0] ?? null;
    const feeSource = usingCurrentApi
      ? currentPrimaryEstimate?.delivery_fee ?? parsed?.delivery_fee ?? parsed?.fee ?? null
      : parsed?.fee ?? parsed?.price ?? parsed?.total_fee ?? parsed?.delivery_fee ?? null;
    const expiresAt =
      (usingCurrentApi
        ? this.resolveDateTime(
            this.getNumberField(parsed, 'expires_at') ??
              this.getNumberField(currentPrimaryEstimate, 'expires_at') ??
              this.getNumberField(currentPrimaryEstimate, 'expiration_time')
          )
        : null) ||
      (typeof parsed?.expires === 'string' && parsed.expires) ||
      (typeof parsed?.expires_at === 'string' && parsed.expires_at) ||
      null;
    const fee = this.resolveAmount(feeSource, {
      treatScalarAsMinorUnits:
        typeof feeSource === 'number' &&
        (Boolean(this.getStringField(parsed, 'currency')) ||
          Boolean(this.getStringField(parsed, 'currency_code')) ||
          Boolean(this.getStringField(parsed, 'currency_type')))
    });
    const distanceKm = usingCurrentApi
      ? this.resolveDistanceKm(currentPrimaryEstimate) ??
        this.resolveDistanceKm(parsed?.route) ??
        this.resolveDistanceKm(parsed)
      : this.resolveDistanceKm(parsed);
    const currencyCode =
      (usingCurrentApi
        ? this.resolveCurrency(feeSource) ||
          this.getStringField(parsed, 'currency_code') ||
          this.getStringField(parsed, 'currency_type') ||
          this.getStringField(parsed, 'currency')
        : this.resolveCurrency(feeSource)) ||
      'BRL';

    if (!providerQuoteId) {
      throw new BadGatewayException('Uber respondeu sem identificador de cotacao.');
    }

    return {
      provider: 'UBER_DIRECT',
      fee,
      currencyCode,
      source: 'UBER_QUOTE',
      status: 'QUOTED',
      providerQuoteId,
      expiresAt,
      fallbackReason: null,
      breakdownLabel: 'Uber Envios',
      distanceKm,
      rawPayload: parsed
    };
  }

  private resolveDateTime(value: number | null) {
    if (!Number.isFinite(value ?? Number.NaN)) return null;
    const milliseconds = Number(value);
    const normalized = milliseconds > 10_000_000_000 ? milliseconds : milliseconds * 1000;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  async createDelivery(input: DeliveryDispatchInput): Promise<DeliveryDispatchOutput> {
    const payload = this.buildDeliveryPayload(input);
    const parsed = (await this.request(this.deliveriesPath(), payload)) as Record<string, unknown> | null;
    const usingCurrentApi = this.usesCurrentOrdersApi();
    return {
      provider: 'UBER_DIRECT',
      status: 'REQUESTED',
      trackingId:
        this.getStringField(parsed, 'id') ||
        this.getStringField(parsed, 'delivery_id') ||
        this.getStringField(parsed, 'external_order_id') ||
        this.getStringField(parsed, 'external_id') ||
        `uber-order-${input.orderId || 'unknown'}`,
      providerDeliveryId:
        this.getStringField(parsed, 'id') ||
        this.getStringField(parsed, 'delivery_id') ||
        null,
      providerTrackingUrl:
        this.getStringField(parsed, 'tracking_url') ||
        this.getStringField(parsed, 'trackingUrl') ||
        this.getNestedStringField(parsed, 'tracking', 'url') ||
        null,
      pickupEta:
        this.getStringField(parsed, 'pickup_eta') ||
        this.getStringField(parsed, 'pickupEta') ||
        this.getNestedStringField(parsed, 'pickup', 'eta') ||
        null,
      dropoffEta:
        this.getStringField(parsed, 'dropoff_eta') ||
        this.getStringField(parsed, 'dropoffEta') ||
        this.getNestedStringField(parsed, 'dropoff', 'eta') ||
        null,
      lastError:
        usingCurrentApi && !this.getStringField(parsed, 'id') && !this.getStringField(parsed, 'delivery_id')
          ? 'Uber respondeu sem delivery id.'
          : null,
      rawPayload: parsed
    };
  }

  private normalizeUberPhone(value?: string | null) {
    const normalized = normalizePhoneNumber(value);
    if (!normalized) return '';
    if (normalized.length === 10 || normalized.length === 11) {
      return `+55${normalized}`;
    }
    return `+${normalized}`;
  }

  private formatDistanceKilometers(miles: number) {
    const kilometers = miles * 1.60934;
    return new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    }).format(kilometers);
  }

  private formatUndeliverableRadius(details: string) {
    const match = details.match(
      /Max Radius:\s*([0-9]+(?:\.[0-9]+)?)\s*miles?,\s*Calculated Distance:\s*([0-9]+(?:\.[0-9]+)?)\s*miles?/i
    );
    if (!match) return null;

    const maximumMiles = Number(match[1]);
    const calculatedMiles = Number(match[2]);
    if (!Number.isFinite(maximumMiles) || !Number.isFinite(calculatedMiles)) return null;

    return {
      maximumKm: this.formatDistanceKilometers(maximumMiles),
      calculatedKm: this.formatDistanceKilometers(calculatedMiles)
    };
  }

  private resolveBadRequestMessage(value: unknown) {
    const code = this.getStringField(value, 'code').toLowerCase();
    const message = this.getStringField(value, 'message');
    const dropoffPhoneError = this.getNestedStringField(value, 'metadata', 'dropoff_phone_number');
    const pickupPhoneError = this.getNestedStringField(value, 'metadata', 'pickup_phone_number');
    const deliverableDetails = this.getNestedStringField(value, 'metadata', 'details');

    if (code === 'address_undeliverable') {
      const radius = deliverableDetails ? this.formatUndeliverableRadius(deliverableDetails) : null;
      if (radius) {
        return `O endereco foi reconhecido, mas esta fora da area de cobertura atual do Uber Envios. Alcance maximo: ${radius.maximumKm} km. Distancia estimada: ${radius.calculatedKm} km.`;
      }
      return 'O endereco foi reconhecido, mas esta fora da area de cobertura atual do Uber Envios.';
    }

    if (dropoffPhoneError || pickupPhoneError) {
      return 'Telefone invalido para cotacao no Uber Envios.';
    }

    if (message) {
      return `Uber Envios recusou os dados da cotacao: ${message}.`;
    }

    return 'Uber Envios recusou os dados da cotacao.';
  }
}
