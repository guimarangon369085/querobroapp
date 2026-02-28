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
  CONFIRMADO: 'EM_PREPARACAO',
  EM_PREPARACAO: 'PRONTO',
  PRONTO: 'ENTREGUE',
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
