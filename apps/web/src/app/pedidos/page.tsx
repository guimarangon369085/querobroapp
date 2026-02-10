'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Customer, Order, Product, OrderItem, Payment } from '@querobroapp/shared';
import { apiFetch } from '@/lib/api';
import { formatCurrencyBR, parseCurrencyBR } from '@/lib/format';
import { FormField } from '@/components/form/FormField';

const orderStatuses = ['ABERTO', 'CONFIRMADO', 'EM_PREPARACAO', 'PRONTO', 'ENTREGUE', 'CANCELADO'];

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [newOrderCustomerId, setNewOrderCustomerId] = useState<number | ''>('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [newOrderItems, setNewOrderItems] = useState<Array<{ productId: number; quantity: number }>>([]);
  const [newOrderDiscount, setNewOrderDiscount] = useState<string>('0');
  const [newOrderNotes, setNewOrderNotes] = useState<string>('');
  const [draftProductId, setDraftProductId] = useState<number | ''>('');
  const [draftProductSearch, setDraftProductSearch] = useState('');
  const [draftQty, setDraftQty] = useState<number>(1);
  const [addItemProductId, setAddItemProductId] = useState<number | ''>('');
  const [addItemProductSearch, setAddItemProductSearch] = useState('');
  const [addItemQty, setAddItemQty] = useState<number>(1);
  const [orderError, setOrderError] = useState<string | null>(null);

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
    if (!draftProductId || draftQty <= 0) return;
    setNewOrderItems((prev) => [...prev, { productId: Number(draftProductId), quantity: draftQty }]);
    setDraftProductId('');
    setDraftProductSearch('');
    setDraftQty(1);
  };

  const createOrder = async () => {
    if (!newOrderCustomerId || newOrderItems.length === 0) {
      setOrderError('Selecione cliente e pelo menos um item.');
      return;
    }
    if (draftDiscount < 0) {
      setOrderError('Desconto nao pode ser negativo.');
      return;
    }
    setOrderError(null);
    await apiFetch('/orders', {
      method: 'POST',
      body: JSON.stringify({
        customerId: Number(newOrderCustomerId),
        items: newOrderItems,
        discount: parseCurrencyBR(newOrderDiscount),
        notes: newOrderNotes || undefined
      })
    });
    setNewOrderCustomerId('');
    setCustomerSearch('');
    setNewOrderItems([]);
    setNewOrderDiscount('0');
    setNewOrderNotes('');
    await loadAll();
  };

  const addItem = async (orderId: number) => {
    if (!addItemProductId || addItemQty <= 0) return;
    await apiFetch(`/orders/${orderId}/items`, {
      method: 'POST',
      body: JSON.stringify({ productId: Number(addItemProductId), quantity: addItemQty })
    });
    setAddItemProductId('');
    setAddItemProductSearch('');
    setAddItemQty(1);
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

  const productMap = useMemo(() => {
    return new Map(products.map((p) => [p.id!, p]));
  }, [products]);

  const customerOptions = useMemo(
    () => customers.map((c) => ({ id: c.id!, label: `${c.name} (#${c.id})` })),
    [customers]
  );
  const productOptions = useMemo(
    () => products.map((p) => ({ id: p.id!, label: `${p.name} (#${p.id})` })),
    [products]
  );

  const parseIdFromLabel = (value: string) => {
    const match = value.match(/#(\d+)\)?$/);
    return match ? Number(match[1]) : NaN;
  };

  const draftSubtotal = useMemo(() => {
    return newOrderItems.reduce((sum, item) => {
      const product = productMap.get(item.productId);
      return sum + (product?.price ?? 0) * item.quantity;
    }, 0);
  }, [newOrderItems, productMap]);

  const draftDiscount = useMemo(() => Math.max(parseCurrencyBR(newOrderDiscount), 0), [newOrderDiscount]);
  const draftTotal = Math.max(draftSubtotal - draftDiscount, 0);
  const canCreateOrder = Boolean(newOrderCustomerId) && newOrderItems.length > 0;

  return (
    <section className="grid gap-8">
      <div>
        <h2 className="text-2xl font-semibold">Pedidos</h2>
        <p className="text-neutral-600">Acompanhe pedidos, itens e pagamentos.</p>
      </div>

      <div className="grid gap-4 rounded-2xl border border-neutral-200 bg-white p-6">
        <h3 className="text-lg font-semibold">Novo pedido</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <FormField label="Cliente" hint="Digite para buscar e selecione">
            <input
              className="rounded-lg border border-neutral-200 px-3 py-2"
              list="customers-list"
              placeholder="Buscar cliente..."
              value={customerSearch}
              onChange={(e) => {
                const value = e.target.value;
                setCustomerSearch(value);
                const parsedId = parseIdFromLabel(value);
                setNewOrderCustomerId(Number.isFinite(parsedId) ? parsedId : '');
              }}
            />
            <datalist id="customers-list">
              {customerOptions.map((c) => (
                <option key={c.id} value={c.label} />
              ))}
            </datalist>
          </FormField>
          <FormField label="Produto" hint="Digite para buscar">
            <input
              className="rounded-lg border border-neutral-200 px-3 py-2"
              list="products-list"
              placeholder="Buscar produto..."
              value={draftProductSearch}
              onChange={(e) => {
                const value = e.target.value;
                setDraftProductSearch(value);
                const parsedId = parseIdFromLabel(value);
                setDraftProductId(Number.isFinite(parsedId) ? parsedId : '');
              }}
            />
            <datalist id="products-list">
              {productOptions.map((p) => (
                <option key={p.id} value={p.label} />
              ))}
            </datalist>
          </FormField>
          <FormField label="Quantidade">
            <input
              className="rounded-lg border border-neutral-200 px-3 py-2"
              type="number"
              min={1}
              value={draftQty}
              onChange={(e) => setDraftQty(Number(e.target.value))}
            />
          </FormField>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <FormField label="Desconto (R$)" hint="Opcional">
            <input
              className="rounded-lg border border-neutral-200 px-3 py-2"
              placeholder="0,00"
              value={newOrderDiscount}
              inputMode="decimal"
              onChange={(e) => setNewOrderDiscount(e.target.value)}
            />
          </FormField>
          <FormField label="Observacoes" hint="Opcional">
            <input
              className="rounded-lg border border-neutral-200 px-3 py-2 md:col-span-2"
              placeholder="Observacoes do pedido"
              value={newOrderNotes}
              onChange={(e) => setNewOrderNotes(e.target.value)}
            />
          </FormField>
        </div>
        <div className="flex flex-wrap gap-3">
          <button className="rounded-full border border-neutral-200 px-4 py-2" onClick={addItemDraft}>
            Adicionar item
          </button>
          <button
            className="rounded-full bg-neutral-900 px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-60"
            onClick={createOrder}
            disabled={!canCreateOrder}
          >
            Criar pedido
          </button>
        </div>
        {newOrderItems.length > 0 && (
          <div className="grid gap-2 text-sm text-neutral-600">
            {newOrderItems.map((item, index) => {
              const product = productMap.get(item.productId);
              const total = (product?.price ?? 0) * item.quantity;
              return (
                <div
                  key={`${item.productId}-${index}`}
                  className="flex items-center justify-between rounded-lg border border-neutral-100 px-3 py-2"
                >
                  <div>
                    <p className="text-neutral-800">
                      {product?.name ?? `Produto ${item.productId}`} x {item.quantity}
                    </p>
                    <p className="text-xs text-neutral-500">{formatCurrencyBR(total)}</p>
                  </div>
                  <button
                    className="rounded-full border border-red-200 px-2 py-1 text-xs text-red-600"
                    onClick={() =>
                      setNewOrderItems((prev) => prev.filter((_, i) => i !== index))
                    }
                  >
                    Remover
                  </button>
                </div>
              );
            })}
            <div className="flex flex-wrap items-center justify-between rounded-lg bg-neutral-50 px-3 py-2 text-sm">
              <span>Subtotal</span>
              <span className="font-semibold">{formatCurrencyBR(draftSubtotal)}</span>
            </div>
            <div className="flex flex-wrap items-center justify-between rounded-lg bg-neutral-50 px-3 py-2 text-sm">
              <span>Desconto</span>
              <span className="font-semibold">{formatCurrencyBR(draftDiscount)}</span>
            </div>
            <div className="flex flex-wrap items-center justify-between rounded-lg bg-neutral-100 px-3 py-2 text-sm">
              <span>Total</span>
              <span className="font-semibold">{formatCurrencyBR(draftTotal)}</span>
            </div>
          </div>
        )}
        {orderError && <p className="text-xs text-red-600">{orderError}</p>}
        {!canCreateOrder && !orderError && (
          <p className="text-xs text-neutral-500">
            Selecione um cliente e pelo menos um item para criar o pedido.
          </p>
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
            <p className="text-sm text-neutral-500">Total: {formatCurrencyBR(order.total)}</p>
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
                      {productMap.get(item.productId)?.name ?? `Produto ${item.productId}`} x {item.quantity}
                    </p>
                    <p className="text-xs text-neutral-500">Total item: {formatCurrencyBR(item.total)}</p>
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
            <FormField label="Produto">
              <input
                className="rounded-lg border border-neutral-200 px-3 py-2"
                list="products-list"
                placeholder="Buscar produto..."
                value={addItemProductSearch}
                onChange={(e) => {
                  const value = e.target.value;
                  setAddItemProductSearch(value);
                  const parsedId = parseIdFromLabel(value);
                  setAddItemProductId(Number.isFinite(parsedId) ? parsedId : '');
                }}
              />
            </FormField>
            <FormField label="Quantidade">
              <input
                className="rounded-lg border border-neutral-200 px-3 py-2"
                type="number"
                min={1}
                value={addItemQty}
                onChange={(e) => setAddItemQty(Number(e.target.value))}
              />
            </FormField>
            <div className="flex items-end">
              <button
                className="w-full rounded-full border border-neutral-200 px-4 py-2"
                onClick={() => addItem(selectedOrder.id!)}
              >
                Adicionar item
              </button>
            </div>
          </div>

          <div>
            <h4 className="font-semibold">Pagamentos</h4>
            <div className="mt-3 grid gap-2">
              {selectedPayments.length === 0 ? (
                <p className="text-sm text-neutral-500">Nenhum pagamento registrado.</p>
              ) : (
                selectedPayments.map((payment) => (
                  <div key={payment.id} className="rounded-lg border border-neutral-200 px-3 py-2 text-sm">
                    {payment.method} • {payment.status} • {formatCurrencyBR(payment.amount)}
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
