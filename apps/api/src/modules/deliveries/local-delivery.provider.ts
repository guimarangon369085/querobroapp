import { randomUUID } from 'node:crypto';
import { roundMoney } from '@querobroapp/shared';
import type { DeliveryDispatchInput, DeliveryDispatchOutput, DeliveryProvider, DeliveryQuoteInput, DeliveryQuoteOutput } from './delivery-provider.js';

export class LocalDeliveryProvider implements DeliveryProvider {
  private toMoney(value: number) {
    return roundMoney(value);
  }

  private fallbackFee() {
    const raw = Number(process.env.DELIVERY_MANUAL_FALLBACK_FEE || 12);
    if (!Number.isFinite(raw) || raw < 0) return 0;
    return this.toMoney(raw);
  }

  async quote(_input: DeliveryQuoteInput): Promise<DeliveryQuoteOutput> {
    return {
      provider: 'LOCAL',
      fee: this.fallbackFee(),
      currencyCode: 'BRL',
      source: 'MANUAL_FALLBACK',
      status: 'FALLBACK',
      providerQuoteId: null,
      expiresAt: null,
      fallbackReason: 'Cotacao dos provedores indisponivel. Frete provisório aplicado.',
      breakdownLabel: 'Frete provisório',
      distanceKm: null,
      rawPayload: null
    };
  }

  async createDelivery(_input: DeliveryDispatchInput): Promise<DeliveryDispatchOutput> {
    const now = Date.now();
    return {
      provider: 'LOCAL',
      status: 'REQUESTED',
      trackingId: `local-${randomUUID()}`,
      providerDeliveryId: null,
      providerTrackingUrl: null,
      pickupEta: new Date(now + 10 * 60_000).toISOString(),
      dropoffEta: new Date(now + 40 * 60_000).toISOString(),
      lastError: null,
      rawPayload: null
    };
  }
}
