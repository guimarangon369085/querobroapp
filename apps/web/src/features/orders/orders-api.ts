import type {
  Customer,
  OrderIntake,
  OrderIntakeMeta,
  PixCharge,
  Product
} from '@querobroapp/shared';
import { apiFetch } from '@/lib/api';
import type {
  DeliveryReadiness,
  DeliveryQuote,
  DeliveryTracking,
  OrderView,
  ProductionBoard
} from './orders-model';

export type OrdersWorkspaceData = {
  orders: OrderView[];
  customers: Customer[];
  products: Product[];
};

export type OrderIntakeResult = {
  order: OrderView;
  intake: OrderIntakeMeta;
};

export async function fetchOrdersWorkspace(): Promise<OrdersWorkspaceData> {
  const [orders, customers, products] = await Promise.all([
    apiFetch<OrderView[]>('/orders'),
    apiFetch<Customer[]>('/customers'),
    apiFetch<Product[]>('/inventory-products')
  ]);

  return { orders, customers, products };
}

export function submitOrderIntake(payload: OrderIntake) {
  return apiFetch<OrderIntakeResult>('/orders/intake', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function fetchOrderPixCharge(orderId: number) {
  return apiFetch<PixCharge>(`/orders/${orderId}/pix-charge`);
}

export function fetchOrderDeliveryReadiness(orderId: number) {
  return apiFetch<DeliveryReadiness>(`/deliveries/orders/${orderId}/readiness`);
}

export function fetchDeliveryQuote(payload: {
  mode: 'DELIVERY' | 'PICKUP';
  scheduledAt: string;
  customer: {
    name?: string | null;
    phone?: string | null;
    address?: string | null;
    placeId?: string | null;
    lat?: number | null;
    lng?: number | null;
    deliveryNotes?: string | null;
  };
  manifest: {
    items: Array<{ name: string; quantity: number }>;
    subtotal: number;
    totalUnits: number;
  };
}) {
  return apiFetch<DeliveryQuote>('/deliveries/quotes', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function fetchInternalDeliveryQuote(payload: {
  mode: 'DELIVERY' | 'PICKUP';
  scheduledAt: string;
  customer: {
    name?: string | null;
    phone?: string | null;
    address?: string | null;
    placeId?: string | null;
    lat?: number | null;
    lng?: number | null;
    deliveryNotes?: string | null;
  };
  manifest: {
    items: Array<{ name: string; quantity: number }>;
    subtotal: number;
    totalUnits: number;
  };
}) {
  return apiFetch<DeliveryQuote>('/deliveries/quotes/internal', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function refreshOrderDeliveryQuote(orderId: number) {
  return apiFetch<DeliveryQuote>(`/deliveries/orders/${orderId}/quote`, {
    method: 'POST'
  });
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
