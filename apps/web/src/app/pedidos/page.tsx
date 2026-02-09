'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Customer, Order, Product, OrderItem, Payment } from '@querobroapp/shared';
import { apiFetch } from '@/lib/api';

const orderStatuses = ['ABERTO', 'CONFIRMADO', 'EM_PREPARACAO', 'PRONTO', 'ENTREGUE', 'CANCELADO'];

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [newOrderCustomerId, setNewOrderCustomerId] = useState<number | ''>('');
  const [newOrderItems, setNewOrderItems] = useState<Array<{ productId: number; quantity: number }>>([]);
  const [itemProductId, setItemProductId] = useState<number | ''>('');
  const [itemQty, setItemQty] = useState<number>(1);

  const loadAll = async () => {
    const [ordersData, customersData, productsData] = await Promise.all([
      apiFetch<Order[]>('/orders'),
      apiFetch<Customer[]>('/customers'),
      apiFetch<Product[]>('/products')
    ]);
    setOrders(ordersData);
    setCustomers(customersData);
    setProducts(productsData);
    if (selectedOrder) {
      const fresh = ordersData.find((o) => o.id === selectedOrder.id) || null;
      setSelectedOrder(fresh);
    }
  };

  useEffect(() => {
    loadAll().catch(console.error);
  }, []);

  const addItemDraft = () => {
    if (!itemProductId || itemQty <= 0) return;
    setNewOrderItems((prev) => [...prev, { productId: Number(itemProductId), quantity: itemQty }]);
    setItemProductId('');
    setItemQty(1);
  };

  const createOrder = async () => {
    if (!newOrderCustomerId || newOrderItems.length === 0) return;
    await apiFetch('/orders', {
      method: 'POST',
      body: JSON.stringify({ customerId: Number(newOrderCustomerId), items: newOrderItems })
    });
    setNewOrderCustomerId('');
    setNewOrderItems([]);
    await loadAll();
  };

  const addItem = async (orderId: number) => {
    if (!itemProductId || itemQty <= 0) return;
    await apiFetch(`/orders/${orderId}/items`, {
      method: 'POST',
      body: JSON.stringify({ productId: Number(itemProductId), quantity: itemQty })
    });
    setItemProductId('');
    setItemQty(1);
    await loadAll();
  };

  const removeItem = async (orderId: number, itemId: number) => {
    await apiFetch(`/orders/${orderId}/items/${itemId}`, { method: 'DELETE' });
    await loadAll();
  };

  const updateStatus = async (orderId: number, status: string) => {
    await apiFetch(`/orders/${orderId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
    await loadAll();
  };

  const markPaid = async (orderId: number, amount: number) => {
    await apiFetch('/payments', {
      method: 'POST',
      body: JSON.stringify({
        orderId,
        amount,
        method: 'pix',
        status: 'PAGO',
        paidAt: new Date().toISOString()
      })
    });
    await loadAll();
  };

  const selectedPayments = useMemo(() => {
    if (!selectedOrder) return [];
    return (selectedOrder.payments || []) as Payment[];
  }, [selectedOrder]);

  return (
    <section className="grid gap-8">
      <div>
        <h2 className="text-2xl font-semibold">Pedidos</h2>
        <p className="text-neutral-600">Acompanhe pedidos, itens e pagamentos.</p>
      </div>

      <div className="grid gap-4 rounded-2xl border border-neutral-200 bg-white p-6">
        <h3 className="text-lg font-semibold">Novo pedido</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <select
            className="rounded-lg border border-neutral-200 px-3 py-2"
            value={newOrderCustomerId}
            onChange={(e) => setNewOrderCustomerId(Number(e.target.value))}
          >
            <option value="">Selecione cliente</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            className="rounded-lg border border-neutral-200 px-3 py-2"
            value={itemProductId}
            onChange={(e) => setItemProductId(Number(e.target.value))}
          >
            <option value="">Produto</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            className="rounded-lg border border-neutral-200 px-3 py-2"
            type="number"
            min={1}
            value={itemQty}
            onChange={(e) => setItemQty(Number(e.target.value))}
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <button className="rounded-full border border-neutral-200 px-4 py-2" onClick={addItemDraft}>
            Adicionar item
          </button>
          <button className="rounded-full bg-neutral-900 px-4 py-2 text-white" onClick={createOrder}>
            Criar pedido
          </button>
        </div>
        {newOrderItems.length > 0 && (
          <ul className="text-sm text-neutral-600">
            {newOrderItems.map((item, index) => (
              <li key={`${item.productId}-${index}`}>
                Produto {item.productId} x {item.quantity}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {orders.map((order) => (
          <button
            key={order.id}
            className={`rounded-xl border p-4 text-left ${
              selectedOrder?.id === order.id ? 'border-neutral-900 bg-white' : 'border-neutral-200 bg-white'
            }`}
            onClick={() => setSelectedOrder(order)}
          >
            <p className="text-lg font-semibold">Pedido #{order.id}</p>
            <p className="text-sm text-neutral-500">Status: {order.status}</p>
            <p className="text-sm text-neutral-500">Total: R$ {order.total}</p>
          </button>
        ))}
      </div>

      {selectedOrder && (
        <div className="grid gap-4 rounded-2xl border border-neutral-200 bg-white p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold">Pedido #{selectedOrder.id}</h3>
              <p className="text-sm text-neutral-500">Status atual: {selectedOrder.status}</p>
            </div>
            <select
              className="rounded-lg border border-neutral-200 px-3 py-2"
              value={selectedOrder.status}
              onChange={(e) => updateStatus(selectedOrder.id!, e.target.value)}
            >
              {orderStatuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>

          <div>
            <h4 className="font-semibold">Itens</h4>
            <div className="mt-3 grid gap-2">
              {(selectedOrder.items as OrderItem[] | undefined)?.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-200 px-3 py-2"
                >
                  <div>
                    <p className="text-sm text-neutral-700">
                      Produto {item.productId} x {item.quantity}
                    </p>
                    <p className="text-xs text-neutral-500">Total item: R$ {item.total}</p>
                  </div>
                  <button
                    className="rounded-full border border-red-200 px-2 py-1 text-xs text-red-600"
                    onClick={() => removeItem(selectedOrder.id!, item.id!)}
                  >
                    Remover
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <select
              className="rounded-lg border border-neutral-200 px-3 py-2"
              value={itemProductId}
              onChange={(e) => setItemProductId(Number(e.target.value))}
            >
              <option value="">Produto</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <input
              className="rounded-lg border border-neutral-200 px-3 py-2"
              type="number"
              min={1}
              value={itemQty}
              onChange={(e) => setItemQty(Number(e.target.value))}
            />
            <button className="rounded-full border border-neutral-200 px-4 py-2" onClick={() => addItem(selectedOrder.id!)}>
              Adicionar item
            </button>
          </div>

          <div>
            <h4 className="font-semibold">Pagamentos</h4>
            <div className="mt-3 grid gap-2">
              {selectedPayments.length === 0 ? (
                <p className="text-sm text-neutral-500">Nenhum pagamento registrado.</p>
              ) : (
                selectedPayments.map((payment) => (
                  <div key={payment.id} className="rounded-lg border border-neutral-200 px-3 py-2 text-sm">
                    {payment.method} • {payment.status} • R$ {payment.amount}
                  </div>
                ))
              )}
            </div>
            <button
              className="mt-3 rounded-full bg-neutral-900 px-4 py-2 text-white"
              onClick={() => markPaid(selectedOrder.id!, selectedOrder.total ?? 0)}
            >
              Registrar pagamento
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
