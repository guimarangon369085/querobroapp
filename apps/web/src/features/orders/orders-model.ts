import type { Order, OrderItem, Payment } from '@querobroapp/shared';

export const orderStatuses = [
  'ABERTO',
  'CONFIRMADO',
  'EM_PREPARACAO',
  'PRONTO',
  'ENTREGUE',
  'CANCELADO'
] as const;

export const paymentMethods = ['pix', 'dinheiro', 'cartao', 'transferencia'] as const;

export const nextStatusByCurrent: Record<string, string | null> = {
  ABERTO: 'CONFIRMADO',
  CONFIRMADO: null,
  EM_PREPARACAO: null,
  PRONTO: null,
  ENTREGUE: null,
  CANCELADO: null
};

export type FinancialFilter = 'TODOS' | 'PENDENTE' | 'PARCIAL' | 'PAGO';

export type OrderView = Order & {
  items?: OrderItem[];
  payments?: Payment[];
  amountPaid?: number;
  balanceDue?: number;
  paymentStatus?: 'PENDENTE' | 'PARCIAL' | 'PAGO';
};

export type UberDirectReadiness = {
  provider: 'UBER_DIRECT';
  flow: 'SERVER_TO_SERVER';
  iframeSupported: false;
  ready: boolean;
  missingRequirements: string[];
  missingConfiguration: string[];
  manualHandoffUrl: string;
  draft: {
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
};

export type UberDirectQuote = {
  provider: 'UBER_DIRECT';
  flow: 'SERVER_TO_SERVER';
  iframeSupported: false;
  quoteCreated: true;
  requestedAt: string;
  manualHandoffUrl: string;
  draft: UberDirectReadiness['draft'];
  quote: {
    providerQuoteId: string;
    fee: number;
    currencyCode: string;
    expiresAt: string;
    pickupDurationSeconds: number | null;
    dropoffEta: string;
  };
};

export type DeliveryTracking = {
  orderId: number;
  provider: 'UBER_DIRECT' | 'LOCAL_SIMULATED';
  mode: 'LIVE' | 'SIMULATED';
  status: 'PENDING_REQUIREMENTS' | 'REQUESTED' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'FAILED';
  createdAt: string;
  updatedAt: string;
  providerDeliveryId: string;
  providerQuoteId: string | null;
  trackingUrl: string;
  pickupEta: string | null;
  dropoffEta: string | null;
  lastProviderError: string | null;
  draft: UberDirectReadiness['draft'];
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
  triggerSource: 'ALEXA' | 'MANUAL';
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
    waitingAlexaTrigger: boolean;
  }>;
  recentBatches: ProductionBatch[];
};
