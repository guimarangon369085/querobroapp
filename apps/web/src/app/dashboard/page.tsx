'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { Customer, Product, Order, Payment } from '@querobroapp/shared';

export default function DashboardPage() {
  const [data, setData] = useState({
    products: 0,
    customers: 0,
    orders: 0,
    payments: 0
  });

  useEffect(() => {
    async function load() {
      const [products, customers, orders, payments] = await Promise.all([
        apiFetch<Product[]>('/products'),
        apiFetch<Customer[]>('/customers'),
        apiFetch<Order[]>('/orders'),
        apiFetch<Payment[]>('/payments')
      ]);
      setData({
        products: products.length,
        customers: customers.length,
        orders: orders.length,
        payments: payments.length
      });
    }
    load().catch(console.error);
  }, []);

  const cards = [
    { label: 'Produtos', value: data.products },
    { label: 'Clientes', value: data.customers },
    { label: 'Pedidos', value: data.orders },
    { label: 'Pagamentos', value: data.payments }
  ];

  return (
    <section className="grid gap-8">
      <div className="app-section-title">
        <div>
          <span className="app-chip">Panorama</span>
          <h2 className="mt-3 text-3xl font-semibold">Dashboard executivo</h2>
          <p className="text-neutral-600">Resumo premium da operacao em tempo real.</p>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="app-kpi">
            <p className="text-xs uppercase tracking-[0.25em] text-neutral-500">{card.label}</p>
            <p className="mt-3 text-3xl font-semibold">{card.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
