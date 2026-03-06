import type { Customer, Product } from '@querobroapp/shared';
import { apiFetch } from '@/lib/api';
import type {
  DeliveryReadiness,
  DeliveryTracking,
  MassPrepEvent,
  OrderView,
  ProductionBoard
} from './orders-model';

export type OrdersWorkspaceData = {
  orders: OrderView[];
  customers: Customer[];
  products: Product[];
  massPrepEvents: MassPrepEvent[];
};

export async function fetchOrdersWorkspace(): Promise<OrdersWorkspaceData> {
  const [orders, customers, products, massPrepEvents] = await Promise.all([
    apiFetch<OrderView[]>('/orders'),
    apiFetch<Customer[]>('/customers'),
    apiFetch<Product[]>('/products'),
    apiFetch<MassPrepEvent[]>('/orders/mass-prep-events')
  ]);

  return { orders, customers, products, massPrepEvents };
}

export function fetchOrderDeliveryReadiness(orderId: number) {
  return apiFetch<DeliveryReadiness>(`/deliveries/orders/${orderId}/readiness`);
}

export function startOrderDelivery(orderId: number) {
  return apiFetch<{ reusedExisting: boolean; tracking: DeliveryTracking }>(`/deliveries/orders/${orderId}/start`, {
    method: 'POST'
  });
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
