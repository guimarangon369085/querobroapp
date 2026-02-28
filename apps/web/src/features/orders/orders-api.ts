import type { Customer, Product } from '@querobroapp/shared';
import { apiFetch } from '@/lib/api';
import type { OrderView, UberDirectQuote, UberDirectReadiness } from './orders-model';

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
