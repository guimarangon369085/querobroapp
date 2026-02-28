import type { Customer, Product } from '@querobroapp/shared';
import { apiFetch } from '@/lib/api';
import type {
  DeliveryTracking,
  OrderView,
  ProductionBoard,
  UberDirectQuote,
  UberDirectReadiness
} from './orders-model';

export type OrdersWorkspaceData = {
  orders: OrderView[];
  customers: Customer[];
  products: Product[];
};

export async function fetchOrdersWorkspace(): Promise<OrdersWorkspaceData> {
  const [orders, customers, products] = await Promise.all([
    apiFetch<OrderView[]>('/orders'),
    apiFetch<Customer[]>('/customers'),
    apiFetch<Product[]>('/products')
  ]);

  return { orders, customers, products };
}

export function fetchUberDirectReadiness(orderId: number) {
  return apiFetch<UberDirectReadiness>(`/deliveries/orders/${orderId}/uber-direct/readiness`);
}

export function fetchUberDirectQuote(orderId: number) {
  return apiFetch<UberDirectQuote>(`/deliveries/orders/${orderId}/uber-direct/quote`, {
    method: 'POST'
  });
}

export function dispatchUberDirectOrder(orderId: number) {
  return apiFetch<{ reusedExisting: boolean; tracking: DeliveryTracking }>(
    `/deliveries/orders/${orderId}/uber-direct/dispatch`,
    {
      method: 'POST'
    }
  );
}

export function fetchOrderDeliveryTracking(orderId: number) {
  return apiFetch<{ exists: boolean; tracking: DeliveryTracking | null }>(`/deliveries/orders/${orderId}/tracking`);
}

export function markOrderDeliveryComplete(orderId: number) {
  return apiFetch<DeliveryTracking>(`/deliveries/orders/${orderId}/tracking/complete`, {
    method: 'POST'
  });
}

export function fetchProductionBoard() {
  return apiFetch<ProductionBoard>('/production/queue');
}

export function startNextProductionBatch(payload?: {
  triggerSource?: 'ALEXA' | 'MANUAL';
  triggerLabel?: string;
  requestedTimerMinutes?: number;
}) {
  return apiFetch<{
    batchId: string;
    readyAt: string;
    allocations: Array<{
      orderId: number;
      orderItemId: number;
      productId: number;
      productName: string;
      broasPlanned: number;
      saleUnitsApprox: number;
    }>;
    board: ProductionBoard;
  }>('/production/batches/start-next', {
    method: 'POST',
    body: JSON.stringify(payload || {})
  });
}

export function completeProductionBatch(batchId: string) {
  return apiFetch<{
    batch: ProductionBoard['recentBatches'][number];
    board: ProductionBoard;
  }>(`/production/batches/${encodeURIComponent(batchId)}/complete`, {
    method: 'POST'
  });
}

export type WhatsappOrderIntakeLaunchResult = {
  sessionId: string;
  sessionToken: string;
  previewUrl: string;
  outboxMessageId: number;
  canSendViaMeta: boolean;
  metaDispatchMode: 'FLOW' | 'TEXT_LINK' | 'NONE';
  flowId: string | null;
  dispatchStatus: 'PENDING' | 'SENT' | 'FAILED';
  dispatchTransport: 'FLOW' | 'TEXT_LINK' | 'TEXT_ONLY' | 'NONE';
  dispatchError: string | null;
};

export function launchWhatsappOrderIntakeFlow(payload: {
  recipientPhone: string;
  customerId?: number;
  scheduledAt?: string | null;
  notes?: string | null;
}) {
  return apiFetch<WhatsappOrderIntakeLaunchResult>('/whatsapp/flows/order-intake/launch', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}
