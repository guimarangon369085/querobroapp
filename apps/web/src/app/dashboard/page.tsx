'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { Customer, Order, Payment, Product } from '@querobroapp/shared';
import { BuilderLayoutItemSlot, BuilderLayoutProvider } from '@/components/builder-layout';

type DashboardState = {
  products: number;
  customers: number;
  orders: number;
  payments: number;
};

const initialState: DashboardState = {
  products: 0,
  customers: 0,
  orders: 0,
  payments: 0,
};

export default function DashboardPage() {
  const [data, setData] = useState<DashboardState>(initialState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [products, customers, orders, payments] = await Promise.all([
          apiFetch<Product[]>('/products'),
          apiFetch<Customer[]>('/customers'),
          apiFetch<Order[]>('/orders'),
          apiFetch<Payment[]>('/payments'),
        ]);
        setData({
          products: products.length,
          customers: customers.length,
          orders: orders.length,
          payments: payments.length,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Falha ao carregar dashboard.');
      } finally {
        setLoading(false);
      }
    }

    load().catch(() => {
      // erro tratado no bloco try/catch
    });
  }, []);

  const cards = [
    { label: 'Produtos', value: data.products },
    { label: 'Clientes', value: data.customers },
    { label: 'Pedidos', value: data.orders },
    { label: 'Pagamentos', value: data.payments },
  ];

  return (
    <BuilderLayoutProvider page="dashboard">
      <section className="grid gap-8">
        <BuilderLayoutItemSlot id="header">
          <div className="app-section-title">
            <div>
              <span className="app-chip">Panorama</span>
              <h2 className="mt-3 text-3xl font-semibold">Dashboard executivo</h2>
              <p className="text-neutral-600">Resumo premium da operacao em tempo real.</p>
            </div>
          </div>
        </BuilderLayoutItemSlot>

        <BuilderLayoutItemSlot id="error">
          {error ? (
            <div className="app-panel">
              <p className="text-sm text-red-700">Nao foi possivel carregar os indicadores: {error}</p>
            </div>
          ) : null}
        </BuilderLayoutItemSlot>

        <BuilderLayoutItemSlot id="kpis">
          <div className="grid gap-4 md:grid-cols-4">
            {cards.map((card) => (
              <div key={card.label} className="app-kpi">
                <p className="text-xs uppercase tracking-[0.25em] text-neutral-500">{card.label}</p>
                <p className="mt-3 text-3xl font-semibold">{loading ? '...' : card.value}</p>
              </div>
            ))}
          </div>
        </BuilderLayoutItemSlot>
      </section>
    </BuilderLayoutProvider>
  );
}
