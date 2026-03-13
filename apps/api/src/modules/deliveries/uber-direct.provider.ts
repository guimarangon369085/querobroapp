import { BadGatewayException } from '@nestjs/common';
import type {
  DeliveryDispatchInput,
  DeliveryDispatchOutput,
  DeliveryProvider,
  DeliveryQuoteInput,
  DeliveryQuoteOutput
} from './delivery-provider.js';

function normalizePath(pathname: string) {
  if (!pathname) return '';
  return pathname.startsWith('/') ? pathname : `/${pathname}`;
}

export class UberDirectProvider implements DeliveryProvider {
  private toMoney(value: number) {
    if (!Number.isFinite(value)) return 0;
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private baseUrl() {
    return String(process.env.UBER_DIRECT_BASE_URL || '').trim().replace(/\/+$/, '');
  }

  private bearerToken() {
    return String(process.env.UBER_DIRECT_BEARER_TOKEN || '').trim();
  }

  private customerId() {
    return String(process.env.UBER_DIRECT_CUSTOMER_ID || '').trim();
  }

  private quotesPath() {
    const template = String(process.env.UBER_DIRECT_QUOTES_PATH || '/delivery_quotes').trim();
    return normalizePath(template.replaceAll('{customerId}', this.customerId()));
  }

  private deliveriesPath() {
    const template = String(process.env.UBER_DIRECT_DELIVERIES_PATH || '/deliveries').trim();
    return normalizePath(template.replaceAll('{customerId}', this.customerId()));
  }

  isConfigured() {
    return Boolean(this.baseUrl() && this.bearerToken());
  }

  private buildHeaders() {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.bearerToken()}`
    };
    if (this.customerId()) {
      headers['X-Customer-Id'] = this.customerId();
    }
    return headers;
  }

  private buildQuotePayload(input: DeliveryQuoteInput) {
    return {
      pickup_address: input.pickupAddress,
      pickup_name: input.pickupName,
      pickup_phone_number: input.pickupPhone,
      dropoff_address: input.dropoffAddress,
      dropoff_name: input.dropoffName,
      dropoff_phone_number: input.dropoffPhone,
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
    return {
      ...this.buildQuotePayload(input),
      external_id: input.orderId ? `order-${input.orderId}` : undefined,
      quote_id: input.providerQuoteId || undefined
    };
  }

  private resolveAmount(value: unknown): number {
    if (typeof value === 'number') return this.toMoney(value);
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
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
      if (typeof record.currency === 'string' && record.currency.trim()) {
        return record.currency.trim().toUpperCase();
      }
    }
    return 'BRL';
  }

  private async request(pathname: string, body: unknown) {
    const response = await fetch(`${this.baseUrl()}${pathname}`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body)
    });
    const raw = await response.text();
    let parsed: unknown = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = raw;
    }
    if (!response.ok) {
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
    const providerQuoteId =
      (typeof parsed?.id === 'string' && parsed.id) ||
      (typeof parsed?.quote_id === 'string' && parsed.quote_id) ||
      (typeof parsed?.quoteId === 'string' && parsed.quoteId) ||
      null;
    const feeSource = parsed?.fee ?? parsed?.price ?? parsed?.total_fee ?? parsed?.delivery_fee ?? null;
    const expiresAt =
      (typeof parsed?.expires === 'string' && parsed.expires) ||
      (typeof parsed?.expires_at === 'string' && parsed.expires_at) ||
      null;

    return {
      provider: 'UBER_DIRECT',
      fee: this.resolveAmount(feeSource),
      currencyCode: this.resolveCurrency(feeSource),
      source: 'UBER_QUOTE',
      status: 'QUOTED',
      providerQuoteId,
      expiresAt,
      fallbackReason: null,
      breakdownLabel: 'Entrega Uber',
      rawPayload: parsed
    };
  }

  async createDelivery(input: DeliveryDispatchInput): Promise<DeliveryDispatchOutput> {
    const payload = this.buildDeliveryPayload(input);
    const parsed = (await this.request(this.deliveriesPath(), payload)) as Record<string, unknown> | null;
    return {
      provider: 'UBER_DIRECT',
      status: 'REQUESTED',
      trackingId:
        (typeof parsed?.id === 'string' && parsed.id) ||
        (typeof parsed?.delivery_id === 'string' && parsed.delivery_id) ||
        (typeof parsed?.external_id === 'string' && parsed.external_id) ||
        `uber-order-${input.orderId || 'unknown'}`,
      providerDeliveryId:
        (typeof parsed?.id === 'string' && parsed.id) ||
        (typeof parsed?.delivery_id === 'string' && parsed.delivery_id) ||
        null,
      providerTrackingUrl:
        (typeof parsed?.tracking_url === 'string' && parsed.tracking_url) ||
        (typeof parsed?.trackingUrl === 'string' && parsed.trackingUrl) ||
        null,
      pickupEta:
        (typeof parsed?.pickup_eta === 'string' && parsed.pickup_eta) ||
        (typeof parsed?.pickupEta === 'string' && parsed.pickupEta) ||
        null,
      dropoffEta:
        (typeof parsed?.dropoff_eta === 'string' && parsed.dropoff_eta) ||
        (typeof parsed?.dropoffEta === 'string' && parsed.dropoffEta) ||
        null,
      lastError: null,
      rawPayload: parsed
    };
  }
}

