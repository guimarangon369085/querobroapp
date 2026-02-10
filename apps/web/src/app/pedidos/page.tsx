'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Customer, Order, Product, OrderItem, Payment } from '@querobroapp/shared';
import { apiFetch } from '@/lib/api';
import { formatCurrencyBR, parseCurrencyBR } from '@/lib/format';
import { FormField } from '@/components/form/FormField';

const orderStatuses = ['ABERTO', 'CONFIRMADO', 'EM_PREPARACAO', 'PRONTO', 'ENTREGUE', 'CANCELADO'];
const paymentMethods = ['pix', 'dinheiro', 'cartao', 'transferencia'];

type OrderView = Order & {
  items?: OrderItem[];
  payments?: Payment[];
  amountPaid?: number;
  balanceDue?: number;
  paymentStatus?: 'PENDENTE' | 'PARCIAL' | 'PAGO';
};

function toMoney(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function paidAmountFromPayments(order: OrderView | null) {
  if (!order) return 0;
  return toMoney(
    (order.payments || []).reduce((sum, payment) => {
      const isPaid = payment.status === 'PAGO' || Boolean(payment.paidAt);
      return isPaid ? sum + (payment.amount || 0) : sum;
    }, 0)
  );
}

function derivePaymentStatus(order: OrderView) {
  const total = toMoney(order.total ?? 0);
  const amountPaid = toMoney(order.amountPaid ?? paidAmountFromPayments(order));
  if (amountPaid <= 0) return 'PENDENTE';
  if (amountPaid + 0.00001 >= total) return 'PAGO';
  return 'PARCIAL';
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<OrderView[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<OrderView | null>(null);
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [orderSearch, setOrderSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('TODOS');
  const [financialFilter, setFinancialFilter] = useState<'TODOS' | 'PENDENTE' | 'PARCIAL' | 'PAGO'>('TODOS');

  const [paymentAmount, setPaymentAmount] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<string>('pix');
  const [paymentDate, setPaymentDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentFeedback, setPaymentFeedback] = useState<string | null>(null);
  const [markingPaid, setMarkingPaid] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [ordersData, customersData, productsData] = await Promise.all([
        apiFetch<OrderView[]>('/orders'),
        apiFetch<Customer[]>('/customers'),
        apiFetch<Product[]>('/products'),
      ]);
      setOrders(ordersData);
      setCustomers(customersData);
      setProducts(productsData);
      if (selectedOrder) {
        const fresh = ordersData.find((o) => o.id === selectedOrder.id) || null;
        setSelectedOrder(fresh);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Falha ao carregar dados de pedidos.');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll().catch(() => {
      // erro tratado em loadError
    });
  }, []);

  useEffect(() => {
    setPaymentError(null);
    setPaymentFeedback(null);
    setPaymentAmount('');
    setPaymentMethod('pix');
    setPaymentDate(new Date().toISOString().slice(0, 10));
  }, [selectedOrder?.id]);

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
        notes: newOrderNotes || undefined,
      }),
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
      body: JSON.stringify({ productId: Number(addItemProductId), quantity: addItemQty }),
    });
    setAddItemProductId('');
    setAddItemProductSearch('');
    setAddItemQty(1);
    await loadAll();
  };

  const removeItem = async (orderId: number, itemId: number) => {
    if (!confirm('Remover este item do pedido?')) return;
    try {
      await apiFetch(`/orders/${orderId}/items/${itemId}`, { method: 'DELETE' });
      await loadAll();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Nao foi possivel remover o item.');
    }
  };

  const removeOrder = async (orderId: number) => {
    if (!confirm('Excluir este pedido?')) return;
    try {
      await apiFetch(`/orders/${orderId}`, { method: 'DELETE' });
      setSelectedOrder(null);
      await loadAll();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Nao foi possivel excluir o pedido.');
    }
  };

  const updateStatus = async (orderId: number, status: string) => {
    await apiFetch(`/orders/${orderId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    await loadAll();
  };

  const registerPayment = async () => {
    if (!selectedOrder?.id) return;

    const amount = parseCurrencyBR(paymentAmount);
    if (amount <= 0) {
      setPaymentError('Informe um valor de pagamento maior que zero.');
      return;
    }

    if (amount > selectedOrderBalance + 0.00001) {
      setPaymentError('Pagamento acima do saldo do pedido.');
      return;
    }

    setPaymentError(null);
    setPaymentFeedback(null);

    const paidAtIso = paymentDate
      ? new Date(`${paymentDate}T12:00:00.000Z`).toISOString()
      : new Date().toISOString();

    try {
      await apiFetch('/payments', {
        method: 'POST',
        body: JSON.stringify({
          orderId: selectedOrder.id,
          amount,
          method: paymentMethod,
          status: 'PAGO',
          paidAt: paidAtIso,
        }),
      });
      setPaymentAmount('');
      setPaymentFeedback('Pagamento registrado com sucesso.');
      await loadAll();
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : 'Nao foi possivel registrar pagamento.');
    }
  };

  const markOrderPaid = async () => {
    if (!selectedOrder?.id) return;
    if (selectedOrderBalance <= 0) {
      setPaymentError('Este pedido ja esta totalmente pago.');
      return;
    }

    const confirmed = confirm(
      `Marcar o pedido #${selectedOrder.id} como pago no valor de ${formatCurrencyBR(selectedOrderBalance)}?`
    );
    if (!confirmed) return;

    setMarkingPaid(true);
    setPaymentError(null);
    setPaymentFeedback(null);

    const paidAtIso = paymentDate
      ? new Date(`${paymentDate}T12:00:00.000Z`).toISOString()
      : new Date().toISOString();

    try {
      await apiFetch(`/orders/${selectedOrder.id}/mark-paid`, {
        method: 'PATCH',
        body: JSON.stringify({
          method: paymentMethod,
          paidAt: paidAtIso,
        }),
      });
      setPaymentFeedback('Pedido marcado como pago com sucesso.');
      await loadAll();
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : 'Nao foi possivel marcar o pedido como pago.');
    } finally {
      setMarkingPaid(false);
    }
  };

  const removePayment = async (paymentId: number) => {
    if (!confirm('Remover este pagamento?')) return;
    try {
      await apiFetch(`/payments/${paymentId}`, { method: 'DELETE' });
      await loadAll();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Nao foi possivel remover o pagamento.');
    }
  };

  const selectedPayments = useMemo(() => {
    if (!selectedOrder) return [];
    return selectedOrder.payments || [];
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

  const customerMap = useMemo(() => new Map(customers.map((c) => [c.id!, c])), [customers]);

  const filteredOrders = useMemo(() => {
    const query = orderSearch.trim().toLowerCase();
    return orders.filter((order) => {
      if (statusFilter !== 'TODOS' && order.status !== statusFilter) return false;
      const paymentStatus = derivePaymentStatus(order);
      if (financialFilter !== 'TODOS' && paymentStatus !== financialFilter) return false;
      if (!query) return true;
      const customerName = customerMap.get(order.customerId)?.name?.toLowerCase() || '';
      return (
        `${order.id}`.includes(query) ||
        customerName.includes(query) ||
        order.status.toLowerCase().includes(query) ||
        paymentStatus.toLowerCase().includes(query)
      );
    });
  }, [orders, orderSearch, statusFilter, financialFilter, customerMap]);

  const orderKpis = useMemo(() => {
    const totalOrders = orders.length;
    const openOrders = orders.filter((o) => o.status !== 'ENTREGUE' && o.status !== 'CANCELADO').length;
    const revenue = orders.reduce((sum, o) => sum + (o.total ?? 0), 0);
    return { totalOrders, openOrders, revenue };
  }, [orders]);

  const draftSubtotal = useMemo(() => {
    return newOrderItems.reduce((sum, item) => {
      const product = productMap.get(item.productId);
      return sum + (product?.price ?? 0) * item.quantity;
    }, 0);
  }, [newOrderItems, productMap]);

  const draftDiscount = useMemo(() => Math.max(parseCurrencyBR(newOrderDiscount), 0), [newOrderDiscount]);
  const draftTotal = Math.max(draftSubtotal - draftDiscount, 0);
  const canCreateOrder = Boolean(newOrderCustomerId) && newOrderItems.length > 0;

  const selectedOrderTotal = toMoney(selectedOrder?.total ?? 0);
  const selectedOrderAmountPaid = toMoney(
    selectedOrder?.amountPaid ?? paidAmountFromPayments(selectedOrder)
  );
  const selectedOrderBalance = toMoney(
    selectedOrder?.balanceDue ?? Math.max(selectedOrderTotal - selectedOrderAmountPaid, 0)
  );
  const selectedOrderPaymentStatus = selectedOrder ? derivePaymentStatus(selectedOrder) : 'PENDENTE';

  return (
    <section className="grid gap-8">
      <div className="app-section-title">
        <div>
          <span className="app-chip">Operacao</span>
          <h2 className="mt-3 text-3xl font-semibold">Pedidos</h2>
          <p className="text-neutral-600">Acompanhe pedidos, itens e pagamentos.</p>
        </div>
      </div>

      {loadError ? (
        <div className="app-panel">
          <p className="text-sm text-red-700">Nao foi possivel carregar os pedidos: {loadError}</p>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        <div className="app-kpi">
          <p className="text-xs uppercase tracking-[0.25em] text-neutral-500">Pedidos</p>
          <p className="mt-2 text-3xl font-semibold">{orderKpis.totalOrders}</p>
        </div>
        <div className="app-kpi">
          <p className="text-xs uppercase tracking-[0.25em] text-neutral-500">Em andamento</p>
          <p className="mt-2 text-3xl font-semibold">{orderKpis.openOrders}</p>
        </div>
        <div className="app-kpi">
          <p className="text-xs uppercase tracking-[0.25em] text-neutral-500">Receita</p>
          <p className="mt-2 text-3xl font-semibold">{formatCurrencyBR(orderKpis.revenue)}</p>
        </div>
      </div>

      <div className="app-panel grid gap-5">
        <div>
          <span className="app-chip">Criacao</span>
          <h3 className="mt-3 text-xl font-semibold">Novo pedido</h3>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <FormField label="Cliente" hint="Digite para buscar e selecione">
            <input
              className="app-input"
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
              className="app-input"
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
              className="app-input"
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
              className="app-input"
              placeholder="0,00"
              value={newOrderDiscount}
              inputMode="decimal"
              onChange={(e) => setNewOrderDiscount(e.target.value)}
            />
          </FormField>
          <FormField label="Observacoes" hint="Opcional">
            <input
              className="app-input md:col-span-2"
              placeholder="Observacoes do pedido"
              value={newOrderNotes}
              onChange={(e) => setNewOrderNotes(e.target.value)}
            />
          </FormField>
        </div>
        <div className="flex flex-wrap gap-3">
          <button className="app-button app-button-ghost" onClick={addItemDraft}>
            Adicionar item
          </button>
          <button
            className="app-button app-button-primary disabled:cursor-not-allowed disabled:opacity-60"
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
                  className="flex items-center justify-between rounded-lg border border-white/60 bg-white/70 px-3 py-2"
                >
                  <div>
                    <p className="text-neutral-800">
                      {product?.name ?? `Produto ${item.productId}`} x {item.quantity}
                    </p>
                    <p className="text-xs text-neutral-500">{formatCurrencyBR(total)}</p>
                  </div>
                  <button
                    className="app-button app-button-danger"
                    onClick={() => setNewOrderItems((prev) => prev.filter((_, i) => i !== index))}
                  >
                    Remover
                  </button>
                </div>
              );
            })}
            <div className="flex flex-wrap items-center justify-between rounded-lg bg-white/70 px-3 py-2 text-sm">
              <span>Subtotal</span>
              <span className="font-semibold">{formatCurrencyBR(draftSubtotal)}</span>
            </div>
            <div className="flex flex-wrap items-center justify-between rounded-lg bg-white/70 px-3 py-2 text-sm">
              <span>Desconto</span>
              <span className="font-semibold">{formatCurrencyBR(draftDiscount)}</span>
            </div>
            <div className="flex flex-wrap items-center justify-between rounded-lg bg-white/90 px-3 py-2 text-sm">
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

      <div className="app-panel grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-xl font-semibold">Lista de pedidos</h3>
          <div className="flex flex-wrap gap-2">
            <input
              className="app-input"
              placeholder="Buscar pedido, cliente, status ou financeiro"
              value={orderSearch}
              onChange={(e) => setOrderSearch(e.target.value)}
            />
            <select
              className="app-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="TODOS">Todos</option>
              {orderStatuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            <select
              className="app-select"
              value={financialFilter}
              onChange={(e) =>
                setFinancialFilter(e.target.value as 'TODOS' | 'PENDENTE' | 'PARCIAL' | 'PAGO')
              }
            >
              <option value="TODOS">Financeiro: todos</option>
              <option value="PENDENTE">Financeiro: pendente</option>
              <option value="PARCIAL">Financeiro: parcial</option>
              <option value="PAGO">Financeiro: pago</option>
            </select>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {loading ? (
            <div className="app-panel border-dashed text-sm text-neutral-500">
              Carregando pedidos...
            </div>
          ) : (
            <>
              {filteredOrders.map((order) => {
                const amountPaid = toMoney(order.amountPaid ?? paidAmountFromPayments(order));
                const balance = toMoney(order.balanceDue ?? Math.max((order.total ?? 0) - amountPaid, 0));
                return (
                  <button
                    key={order.id}
                    className={`app-panel text-left ${selectedOrder?.id === order.id ? 'ring-2 ring-orange-200' : ''}`}
                    onClick={() => setSelectedOrder(order)}
                  >
                    <p className="text-lg font-semibold">Pedido #{order.id}</p>
                    <p className="text-sm text-neutral-500">Status: {order.status}</p>
                    <p className="text-sm text-neutral-500">
                      Cliente: {customerMap.get(order.customerId)?.name || 'Sem cliente'}
                    </p>
                    <p className="text-sm text-neutral-500">Total: {formatCurrencyBR(order.total ?? 0)}</p>
                    <p className="text-sm text-neutral-500">
                      Financeiro: {derivePaymentStatus(order)} • Pago: {formatCurrencyBR(amountPaid)} • Saldo:{' '}
                      {formatCurrencyBR(balance)}
                    </p>
                  </button>
                );
              })}
              {filteredOrders.length === 0 && (
                <div className="app-panel border-dashed text-sm text-neutral-500">
                  {orders.length === 0
                    ? 'Sem pedidos ainda — crie o primeiro.'
                    : 'Nenhum pedido encontrado com os filtros atuais.'}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {selectedOrder && (
        <div className="app-panel grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-xl font-semibold">Pedido #{selectedOrder.id}</h3>
              <p className="text-sm text-neutral-500">Status atual: {selectedOrder.status}</p>
            </div>
            <select
              className="app-select"
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

          <div className="grid gap-3 md:grid-cols-4">
            <div className="app-kpi">
              <p className="text-xs uppercase tracking-[0.25em] text-neutral-500">Total</p>
              <p className="mt-2 text-xl font-semibold">{formatCurrencyBR(selectedOrderTotal)}</p>
            </div>
            <div className="app-kpi">
              <p className="text-xs uppercase tracking-[0.25em] text-neutral-500">Pago</p>
              <p className="mt-2 text-xl font-semibold">{formatCurrencyBR(selectedOrderAmountPaid)}</p>
            </div>
            <div className="app-kpi">
              <p className="text-xs uppercase tracking-[0.25em] text-neutral-500">Saldo</p>
              <p className="mt-2 text-xl font-semibold">{formatCurrencyBR(selectedOrderBalance)}</p>
            </div>
            <div className="app-kpi">
              <p className="text-xs uppercase tracking-[0.25em] text-neutral-500">Financeiro</p>
              <p className="mt-2 text-xl font-semibold">{selectedOrderPaymentStatus}</p>
            </div>
          </div>

          <div>
            <h4 className="font-semibold">Itens</h4>
            <div className="mt-3 grid gap-2">
              {(selectedOrder.items || []).map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/60 bg-white/70 px-3 py-2"
                >
                  <div>
                    <p className="text-sm text-neutral-700">
                      {productMap.get(item.productId)?.name ?? `Produto ${item.productId}`} x {item.quantity}
                    </p>
                    <p className="text-xs text-neutral-500">Total item: {formatCurrencyBR(item.total ?? 0)}</p>
                  </div>
                  <button
                    className="app-button app-button-danger"
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
                className="app-input"
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
                className="app-input"
                type="number"
                min={1}
                value={addItemQty}
                onChange={(e) => setAddItemQty(Number(e.target.value))}
              />
            </FormField>
            <div className="flex items-end">
              <button className="app-button app-button-ghost w-full" onClick={() => addItem(selectedOrder.id!)}>
                Adicionar item
              </button>
            </div>
          </div>

          <div className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h4 className="font-semibold">Pagamentos</h4>
              <button className="app-button app-button-danger" onClick={() => removeOrder(selectedOrder.id!)}>
                Excluir pedido
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <FormField label="Valor" hint={`Saldo atual: ${formatCurrencyBR(selectedOrderBalance)}`}>
                <input
                  className="app-input"
                  placeholder="0,00"
                  inputMode="decimal"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                />
              </FormField>
              <FormField label="Metodo">
                <select
                  className="app-select"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                >
                  {paymentMethods.map((method) => (
                    <option key={method} value={method}>
                      {method}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Data do pagamento">
                <input
                  className="app-input"
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                />
              </FormField>
              <div className="flex items-end gap-2">
                <button className="app-button app-button-primary w-full" onClick={registerPayment}>
                  Registrar pagamento
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                className="app-button app-button-ghost disabled:cursor-not-allowed disabled:opacity-60"
                onClick={markOrderPaid}
                disabled={markingPaid || selectedOrderBalance <= 0}
              >
                {markingPaid ? 'Marcando...' : `Marcar pedido como pago (${formatCurrencyBR(selectedOrderBalance)})`}
              </button>
            </div>

            {paymentError ? <p className="text-xs text-red-600">{paymentError}</p> : null}
            {paymentFeedback ? <p className="text-xs text-emerald-700">{paymentFeedback}</p> : null}

            <div className="mt-1 grid gap-2">
              {selectedPayments.length === 0 ? (
                <p className="text-sm text-neutral-500">Nenhum pagamento registrado.</p>
              ) : (
                selectedPayments.map((payment) => (
                  <div key={payment.id} className="rounded-lg border border-white/60 bg-white/70 px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {payment.method} • {payment.status} • {formatCurrencyBR(payment.amount)} •{' '}
                        {payment.paidAt ? new Date(payment.paidAt).toLocaleDateString('pt-BR') : 'sem data'}
                      </span>
                      <button className="app-button app-button-danger" onClick={() => removePayment(payment.id!)}>
                        Remover
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
