import type { Customer, Order, OrderItem, Payment } from '@querobroapp/shared';

type DeliveryProviderCode = 'NONE' | 'LOCAL' | 'UBER_DIRECT' | 'LOGGI';
type DeliveryFeeSourceCode = 'NONE' | 'UBER_QUOTE' | 'LOGGI_QUOTE' | 'MANUAL_FALLBACK';

export const nextStatusByCurrent: Record<string, string | null> = {
  ABERTO: 'CONFIRMADO',
  CONFIRMADO: null,
  EM_PREPARACAO: null,
  PRONTO: null,
  ENTREGUE: null,
  CANCELADO: null
};

export type OrderView = Omit<Order, 'deliveryProvider' | 'deliveryFeeSource'> & {
  deliveryProvider?: DeliveryProviderCode;
  deliveryFeeSource?: DeliveryFeeSourceCode;
  items?: OrderItem[];
  customer?: Customer | null;
  payments?: Payment[];
  amountPaid?: number;
  balanceDue?: number;
  paymentStatus?: 'PENDENTE' | 'PARCIAL' | 'PAGO';
};

export type MassPrepEvent = {
  version: 1;
  id: string;
  eventName: 'FAZER MASSA';
  orderId: number;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  massRecipes: number;
  status: 'INGREDIENTES' | 'PREPARO' | 'NO_FORNO' | 'PRONTA';
  createdAt: string;
};

export type DeliveryReadiness = {
  provider: 'NONE' | 'LOCAL' | 'UBER_DIRECT' | 'LOGGI';
  mode: 'PROVIDER';
  ready: boolean;
  reason: string;
  missingRequirements: string[];
  quoteStatus: 'NOT_REQUIRED' | 'PENDING' | 'QUOTED' | 'FALLBACK' | 'EXPIRED' | 'FAILED';
  deliveryFee: number;
  draft: {
    orderId: number;
    customerName: string;
    customerPhone: string;
    dropoffAddress: string;
    orderTotal: number;
    scheduledAt: string;
    manifestSummary: string;
    items: Array<{
      productId: number;
      name: string;
      quantity: number;
    }>;
  };
};

export type DeliveryTracking = {
  orderId: number;
  provider: 'NONE' | 'LOCAL' | 'UBER_DIRECT' | 'LOGGI';
  mode: 'PROVIDER';
  status:
    | 'NOT_REQUESTED'
    | 'PENDING_REQUIREMENTS'
    | 'REQUESTED'
    | 'OUT_FOR_DELIVERY'
    | 'DELIVERED'
    | 'FAILED'
    | 'CANCELED';
  createdAt: string;
  updatedAt: string;
  trackingId: string;
  providerDeliveryId?: string | null;
  providerTrackingUrl?: string | null;
  providerQuoteId?: string | null;
  quoteFee?: number | null;
  quoteExpiresAt?: string | null;
  pickupEta: string | null;
  dropoffEta: string | null;
  lastError: string | null;
  draft: DeliveryReadiness['draft'];
};

export type DeliveryQuote = {
  provider: 'NONE' | 'LOCAL' | 'UBER_DIRECT' | 'LOGGI';
  fee: number;
  currencyCode: string;
  source: 'NONE' | 'UBER_QUOTE' | 'LOGGI_QUOTE' | 'MANUAL_FALLBACK';
  status: 'NOT_REQUIRED' | 'PENDING' | 'QUOTED' | 'FALLBACK' | 'EXPIRED' | 'FAILED';
  quoteToken: string | null;
  expiresAt: string | null;
  fallbackReason: string | null;
  breakdownLabel?: string | null;
};

export type ProductionBatchAllocation = {
  orderId: number;
  orderItemId: number;
  productId: number;
  productName: string;
  broasPlanned: number;
  saleUnitsApprox: number;
};

export type ProductionBatch = {
  id: string;
  triggerSource: 'MANUAL';
  triggerLabel: string;
  requestedTimerMinutes: number | null;
  bakeTimerMinutes: number;
  ovenCapacityBroas: number;
  startedAt: string;
  readyAt: string;
  status: 'BAKING' | 'READY' | 'DISPATCHED' | 'DELIVERED';
  linkedOrderIds: number[];
  allocations: ProductionBatchAllocation[];
};

export type ProductionBoard = {
  oven: {
    capacityBroas: number;
    bakeTimerMinutes: number;
    activeBatch: ProductionBatch | null;
    busy: boolean;
  };
  queue: Array<{
    orderId: number;
    customerName: string;
    scheduledAt: string | null;
    status: string;
    totalBroas: number;
    producedBroas: number;
    remainingBroas: number;
  }>;
  recentBatches: ProductionBatch[];
};
