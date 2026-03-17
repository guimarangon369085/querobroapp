type DeliveryManifestItem = {
  name: string;
  quantity: number;
};

export type DeliveryQuoteInput = {
  orderId?: number | null;
  pickupName: string;
  pickupPhone: string;
  pickupAddress: string;
  dropoffName: string;
  dropoffPhone: string;
  dropoffAddress: string;
  dropoffPlaceId?: string | null;
  dropoffLat?: number | null;
  dropoffLng?: number | null;
  scheduledAt: string | null;
  orderTotal: number;
  manifestSummary: string;
  items: DeliveryManifestItem[];
};

export type DeliveryQuoteOutput = {
  provider: 'LOCAL' | 'LOGGI';
  fee: number;
  currencyCode: string;
  source: 'LOGGI_QUOTE' | 'MANUAL_FALLBACK';
  status: 'QUOTED' | 'FALLBACK' | 'FAILED';
  providerQuoteId: string | null;
  expiresAt: string | null;
  fallbackReason: string | null;
  breakdownLabel: string | null;
  rawPayload?: unknown;
};

export type DeliveryDispatchInput = DeliveryQuoteInput & {
  providerQuoteId?: string | null;
};

export type DeliveryDispatchOutput = {
  provider: 'LOCAL' | 'LOGGI';
  status: 'REQUESTED' | 'FAILED';
  trackingId: string;
  providerDeliveryId: string | null;
  providerTrackingUrl: string | null;
  pickupEta: string | null;
  dropoffEta: string | null;
  lastError: string | null;
  rawPayload?: unknown;
};

export interface DeliveryProvider {
  quote(input: DeliveryQuoteInput): Promise<DeliveryQuoteOutput>;
  createDelivery(input: DeliveryDispatchInput): Promise<DeliveryDispatchOutput>;
}
