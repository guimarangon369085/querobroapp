'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { Customer, Product } from '@querobroapp/shared';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { formatCurrencyBR, formatMoneyInputBR, parseCurrencyBR } from '@/lib/format';
import { consumeFocusQueryParam, scrollToLayoutSlot } from '@/lib/layout-scroll';
import { useSurfaceMode } from '@/hooks/use-surface-mode';
import { useTutorialSpotlight } from '@/hooks/use-tutorial-spotlight';
import { useFeedback } from '@/components/feedback-provider';
import { FormField } from '@/components/form/FormField';
import { BuilderLayoutItemSlot, BuilderLayoutProvider } from '@/components/builder-layout';
import { CalendarBoard } from '@/features/calendar/calendar-board';
import { CalendarOrderDetailPanel } from '@/features/calendar/calendar-order-detail-panel';
import { OrderFilters } from './order-filters';
import { OrderQuickCreate } from './order-quick-create';
import {
  type DeliveryTracking,
  type FinancialFilter,
  type OrderView,
  type ProductionBoard,
  type UberDirectQuote,
  type UberDirectReadiness,
  nextStatusByCurrent,
  orderStatuses,
  paymentMethods
} from './orders-model';
import {
  completeProductionBatch,
  dispatchUberDirectOrder,
  fetchOrderDeliveryTracking,
  type WhatsappOrderIntakeLaunchResult,
  fetchProductionBoard,
  fetchOrdersWorkspace,
  fetchUberDirectQuote,
  fetchUberDirectReadiness,
  launchWhatsappOrderIntakeFlow,
  markOrderDeliveryComplete,
  startNextProductionBatch
} from './orders-api';

const TEST_DATA_TAG = '[TESTE_E2E]';
const TUTORIAL_QUERY_VALUE = 'primeira_vez';

function parsePositiveIntegerInput(value: string, fallback = 1) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function formatDateTimeLocalValue(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function parseDateTimeLocalInput(value: string) {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hours, minutes] = match;
  const parsed = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hours),
    Number(minutes),
    0,
    0
  );
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function defaultOrderDateTimeInput() {
  return formatDateTimeLocalValue(new Date());
}

function resolveOrderDate(order?: Pick<OrderView, 'scheduledAt' | 'createdAt'> | null) {
  if (!order) return null;
  return safeDateFromIso(order.scheduledAt ?? order.createdAt ?? null);
}

function formatOrderDateTimeLabel(date?: Date | null) {
  if (!date) return '';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatCurrencyByCode(value: number, currencyCode: string) {
  const normalized = currencyCode.trim().toUpperCase() || 'BRL';

  try {
    return value.toLocaleString('pt-BR', {
      style: 'currency',
      currency: normalized
    });
  } catch {
    return `${value.toFixed(2)} ${normalized}`;
  }
}

function buildCustomerAddressForUber(customer?: Customer | null) {
  if (!customer) return '';
  const normalizedFallback = (customer.address || '').trim();
  const cityState = [customer.city, customer.state].filter(Boolean).join(' - ');
  const parts = [
    customer.addressLine1,
    customer.addressLine2,
    customer.neighborhood,
    cityState,
    customer.postalCode,
    customer.country
  ]
    .map((part) => (part || '').trim())
    .filter(Boolean);

  if (parts.length > 0) {
    return parts.join(', ');
  }

  return normalizedFallback;
}

function buildUberDeliveryUrl(customer?: Customer | null) {
  const normalizedAddress = buildCustomerAddressForUber(customer);
  if (!normalizedAddress) return '';

  const params = new URLSearchParams();
  params.set('action', 'setPickup');
  params.set('pickup', 'my_location');
  params.set('dropoff[formatted_address]', normalizedAddress);
  if (customer?.name) params.set('dropoff[nickname]', customer.name.trim());
  if (Number.isFinite(customer?.lat) && Number.isFinite(customer?.lng)) {
    params.set('dropoff[latitude]', String(customer?.lat));
    params.set('dropoff[longitude]', String(customer?.lng));
  }
  return `https://m.uber.com/?${params.toString()}`;
}

function buildUberOrderSummary(order: OrderView | null, customer: Customer | null, productsById: Map<number, Product>) {
  if (!order || !customer) return '';

  const address = buildCustomerAddressForUber(customer);
  const scheduledAt = formatOrderDateTimeLabel(resolveOrderDate(order));
  const items = (order.items || [])
    .map((item) => `${productsById.get(item.productId)?.name ?? `Produto ${item.productId}`} x ${item.quantity}`)
    .join(', ');

  return [
    `Pedido #${order.id}`,
    customer.name ? `Cliente: ${customer.name}` : '',
    scheduledAt ? `Entrega: ${scheduledAt}` : '',
    address ? `Endereco: ${address}` : '',
    items ? `Itens: ${items}` : '',
    order.notes ? `Observacoes: ${order.notes}` : '',
    `Total: ${formatCurrencyBR(order.total ?? 0)}`
  ]
    .filter(Boolean)
    .join('\n');
}

function toMoney(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function containsTestDataTag(value?: string | null) {
  return (value || '').toLowerCase().includes(TEST_DATA_TAG.toLowerCase());
}

function withTestDataTag(value?: string | null, fallback = '') {
  const normalized = (value || '').trim();
  const baseValue = normalized || fallback;
  if (!baseValue) return TEST_DATA_TAG;
  if (containsTestDataTag(baseValue)) return baseValue;
  return `${baseValue} ${TEST_DATA_TAG}`.trim();
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
  if (
    order.paymentStatus === 'PENDENTE' ||
    order.paymentStatus === 'PARCIAL' ||
    order.paymentStatus === 'PAGO'
  ) {
    return order.paymentStatus;
  }
  const total = toMoney(order.total ?? 0);
  const amountPaid = toMoney(order.amountPaid ?? paidAmountFromPayments(order));
  if (amountPaid <= 0) return 'PENDENTE';
  if (amountPaid + 0.00001 >= total) return 'PAGO';
  return 'PARCIAL';
}

function paymentStatusBadgeClass(status: 'PENDENTE' | 'PARCIAL' | 'PAGO') {
  if (status === 'PAGO') return 'bg-emerald-100 text-emerald-800 border-emerald-200';
  if (status === 'PARCIAL') return 'bg-amber-100 text-amber-800 border-amber-200';
  return 'bg-rose-100 text-rose-800 border-rose-200';
}

function orderStatusBadgeClass(status: string) {
  if (status === 'ENTREGUE') return 'bg-emerald-100 text-emerald-800 border-emerald-200';
  if (status === 'CANCELADO') return 'bg-rose-100 text-rose-800 border-rose-200';
  if (status === 'PRONTO') return 'bg-blue-100 text-blue-800 border-blue-200';
  return 'bg-neutral-100 text-neutral-700 border-neutral-200';
}

function paymentRecordBadgeClass(status: string) {
  if (status === 'PAGO') return 'bg-emerald-100 text-emerald-800 border-emerald-200';
  if (status === 'PENDENTE') return 'bg-rose-100 text-rose-800 border-rose-200';
  if (status === 'CANCELADO') return 'bg-neutral-100 text-neutral-700 border-neutral-200';
  return 'bg-amber-100 text-amber-800 border-amber-200';
}

type CalendarViewMode = 'DAY' | 'WEEK' | 'MONTH';
type OrdersScreenMode = 'orders' | 'calendar';

const calendarViewLabels: Record<CalendarViewMode, string> = {
  DAY: 'Dia',
  WEEK: 'Semana',
  MONTH: 'Mes'
};

type CalendarOrderEntry = {
  order: OrderView;
  createdAt: Date;
  dateKey: string;
};

const calendarDayLabels = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab', 'Dom'];

function safeDateFromIso(iso?: string | null) {
  if (!iso) return null;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfLocalDay(date: Date) {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
}

function dateKeyFromDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateFromDateKey(key: string) {
  const [yearRaw, monthRaw, dayRaw] = key.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return startOfLocalDay(new Date());
  }
  return new Date(year, month - 1, day);
}

function addDaysLocal(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return startOfLocalDay(next);
}

function addMonthsLocal(date: Date, amount: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + amount, 1);
  return startOfLocalDay(next);
}

function startOfWeekMonday(date: Date) {
  const normalized = startOfLocalDay(date);
  const weekday = normalized.getDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  return addDaysLocal(normalized, mondayOffset);
}

function shiftDateByCalendarView(date: Date, view: CalendarViewMode, direction: number) {
  if (view === 'MONTH') return addMonthsLocal(date, direction);
  if (view === 'WEEK') return addDaysLocal(date, direction * 7);
  return addDaysLocal(date, direction);
}

function monthGridDates(reference: Date) {
  const firstDay = new Date(reference.getFullYear(), reference.getMonth(), 1);
  const gridStart = startOfWeekMonday(firstDay);
  return Array.from({ length: 42 }, (_, index) => addDaysLocal(gridStart, index));
}

function weekGridDates(reference: Date) {
  const weekStart = startOfWeekMonday(reference);
  return Array.from({ length: 7 }, (_, index) => addDaysLocal(weekStart, index));
}

function formatCalendarRangeLabel(reference: Date, view: CalendarViewMode) {
  if (view === 'MONTH') {
    return reference.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  }
  if (view === 'WEEK') {
    const weekStart = startOfWeekMonday(reference);
    const weekEnd = addDaysLocal(weekStart, 6);
    return `${weekStart.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'short'
    })} - ${weekEnd.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}`;
  }
  return reference.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });
}

function formatCalendarWeekdayLabel(date: Date) {
  return date
    .toLocaleDateString('pt-BR', { weekday: 'short' })
    .replace('.', '')
    .trim();
}

function calendarStatusDotClass(status: string) {
  if (status === 'ENTREGUE') return 'bg-emerald-500';
  if (status === 'CANCELADO') return 'bg-rose-500';
  if (status === 'PRONTO') return 'bg-sky-500';
  if (status === 'EM_PREPARACAO') return 'bg-orange-400';
  if (status === 'CONFIRMADO') return 'bg-amber-400';
  return 'bg-stone-400';
}

function minutesIntoDay(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function OrdersPageContent({ screenMode = 'orders' }: { screenMode?: OrdersScreenMode }) {
  const searchParams = useSearchParams();
  const { tutorialMode, isSpotlightSlot } = useTutorialSpotlight(searchParams, TUTORIAL_QUERY_VALUE);
  const [orders, setOrders] = useState<OrderView[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<OrderView | null>(null);
  const [newOrderCustomerId, setNewOrderCustomerId] = useState<number | ''>('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [newOrderItems, setNewOrderItems] = useState<Array<{ productId: number; quantity: number }>>([]);
  const [newOrderDiscount, setNewOrderDiscount] = useState<string>('0,00');
  const [newOrderNotes, setNewOrderNotes] = useState<string>('');
  const [newOrderScheduledAt, setNewOrderScheduledAt] = useState<string>(() => defaultOrderDateTimeInput());
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
  const [financialFilter, setFinancialFilter] = useState<FinancialFilter>('TODOS');
  const [calendarView, setCalendarView] = useState<CalendarViewMode>(
    screenMode === 'calendar' ? 'MONTH' : 'WEEK'
  );
  const [calendarAnchorDate, setCalendarAnchorDate] = useState<Date>(() => startOfLocalDay(new Date()));
  const [selectedCalendarDateKey, setSelectedCalendarDateKey] = useState(() => dateKeyFromDate(new Date()));
  const [expandSelectedDayDetails, setExpandSelectedDayDetails] = useState(false);
  const { isOperationMode } = useSurfaceMode('pedidos');

  const [paymentAmount, setPaymentAmount] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<string>('pix');
  const [paymentDate, setPaymentDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentFeedback, setPaymentFeedback] = useState<string | null>(null);
  const [markingPaid, setMarkingPaid] = useState(false);
  const [selectedOrderScheduledAt, setSelectedOrderScheduledAt] = useState<string>('');
  const [savingOrderSchedule, setSavingOrderSchedule] = useState(false);
  const [uberReadinessLoading, setUberReadinessLoading] = useState(false);
  const [uberReadinessError, setUberReadinessError] = useState<string | null>(null);
  const [uberReadiness, setUberReadiness] = useState<UberDirectReadiness | null>(null);
  const [uberQuoteLoading, setUberQuoteLoading] = useState(false);
  const [uberQuoteError, setUberQuoteError] = useState<string | null>(null);
  const [uberQuote, setUberQuote] = useState<UberDirectQuote | null>(null);
  const [productionBoard, setProductionBoard] = useState<ProductionBoard | null>(null);
  const [productionLoading, setProductionLoading] = useState(false);
  const [productionError, setProductionError] = useState<string | null>(null);
  const [startingProductionBatch, setStartingProductionBatch] = useState(false);
  const [completingProductionBatch, setCompletingProductionBatch] = useState(false);
  const [deliveryTracking, setDeliveryTracking] = useState<DeliveryTracking | null>(null);
  const [deliveryTrackingLoading, setDeliveryTrackingLoading] = useState(false);
  const [deliveryTrackingError, setDeliveryTrackingError] = useState<string | null>(null);
  const [whatsappFlowRecipientPhone, setWhatsappFlowRecipientPhone] = useState('');
  const [launchingWhatsappFlow, setLaunchingWhatsappFlow] = useState(false);
  const [whatsappFlowLaunchError, setWhatsappFlowLaunchError] = useState<string | null>(null);
  const [whatsappFlowLaunchResult, setWhatsappFlowLaunchResult] =
    useState<WhatsappOrderIntakeLaunchResult | null>(null);
  const selectedOrderId = selectedOrder?.id ?? null;
  const { confirm, notifyError, notifySuccess, notifyUndo } = useFeedback();

  const refreshOperationalState = useCallback(
    async (orderId: number | null) => {
      setProductionLoading(true);
      setProductionError(null);
      try {
        const board = await fetchProductionBoard();
        setProductionBoard(board);
      } catch (err) {
        setProductionError(err instanceof Error ? err.message : 'Falha ao carregar o forno.');
      } finally {
        setProductionLoading(false);
      }

      if (!orderId) {
        setDeliveryTracking(null);
        setDeliveryTrackingError(null);
        return;
      }

      setDeliveryTrackingLoading(true);
      setDeliveryTrackingError(null);
      try {
        const response = await fetchOrderDeliveryTracking(orderId);
        setDeliveryTracking(response.tracking);
      } catch (err) {
        setDeliveryTrackingError(err instanceof Error ? err.message : 'Falha ao carregar rastreio.');
      } finally {
        setDeliveryTrackingLoading(false);
      }
    },
    []
  );

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { orders: ordersData, customers: customersData, products: productsData } =
        await fetchOrdersWorkspace();
      setOrders(ordersData);
      setCustomers(customersData);
      setProducts(productsData);
      if (selectedOrderId) {
        const fresh = ordersData.find((o) => o.id === selectedOrderId) || null;
        setSelectedOrder(fresh);
      }
      return ordersData;
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Falha ao carregar dados de pedidos.');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [selectedOrderId]);

  const openOrderDetail = (order: OrderView) => {
    setSelectedOrder(order);
    scrollToLayoutSlot('detail', { focus: true, focusSelector: 'select, button, input, h3' });
  };

  useEffect(() => {
    loadAll().catch(() => {
      // erro tratado em loadError
    });
  }, [loadAll]);

  useEffect(() => {
    refreshOperationalState(selectedOrderId).catch(() => {
      // erro tratado em estado proprio
    });
  }, [refreshOperationalState, selectedOrderId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      refreshOperationalState(selectedOrderId).catch(() => undefined);
    }, 10000);

    return () => window.clearInterval(timer);
  }, [refreshOperationalState, selectedOrderId]);

  useEffect(() => {
    const focus = consumeFocusQueryParam(searchParams);
    if (!focus) return;

    const allowed = new Set(['header', 'load_error', 'new_order', 'list', 'detail']);
    if (!allowed.has(focus)) return;

    scrollToLayoutSlot(focus, {
      focus: focus === 'new_order' || focus === 'detail',
      focusSelector: 'input, select, textarea, button'
    });
  }, [searchParams]);

  useEffect(() => {
    setPaymentError(null);
    setPaymentFeedback(null);
    setPaymentAmount('');
    setPaymentMethod('pix');
    setPaymentDate(new Date().toISOString().slice(0, 10));
  }, [selectedOrder?.id]);

  useEffect(() => {
    const orderDate = resolveOrderDate(selectedOrder);
    if (!orderDate) return;
    const normalized = startOfLocalDay(orderDate);
    setCalendarAnchorDate(normalized);
    setSelectedCalendarDateKey(dateKeyFromDate(normalized));
  }, [selectedOrder]);

  useEffect(() => {
    const orderDate = resolveOrderDate(selectedOrder);
    setSelectedOrderScheduledAt(orderDate ? formatDateTimeLocalValue(orderDate) : '');
  }, [selectedOrder]);

  useEffect(() => {
    setUberReadiness(null);
    setUberReadinessError(null);
    setUberQuote(null);
    setUberQuoteError(null);
  }, [selectedOrderId]);

  useEffect(() => {
    if (!tutorialMode) return;
    setNewOrderNotes((prev) => withTestDataTag(prev, 'Pedido do momento'));
  }, [tutorialMode]);

  const addItemDraft = () => {
    if (!draftProductId || draftQty <= 0) return;
    setNewOrderItems((prev) => [...prev, { productId: Number(draftProductId), quantity: draftQty }]);
    setDraftProductId('');
    setDraftProductSearch('');
    setDraftQty(1);
  };

  const clearDraft = () => {
    setNewOrderCustomerId('');
    setCustomerSearch('');
    setNewOrderItems([]);
    setNewOrderDiscount('0,00');
    setNewOrderNotes(tutorialMode ? withTestDataTag('', 'Pedido do momento') : '');
    setNewOrderScheduledAt(defaultOrderDateTimeInput());
    setDraftProductId('');
    setDraftProductSearch('');
    setDraftQty(1);
    setOrderError(null);
  };

  const removeDraftItem = (index: number) => {
    const removed = newOrderItems[index];
    if (!removed) return;
    setNewOrderItems((prev) => prev.filter((_, i) => i !== index));
    const productName = productMap.get(removed.productId)?.name ?? `Produto ${removed.productId}`;
    notifyUndo(`${productName} removido do rascunho do pedido.`, () => {
      setNewOrderItems((prev) => {
        const safeIndex = Math.min(index, prev.length);
        const next = [...prev];
        next.splice(safeIndex, 0, removed);
        return next;
      });
    });
  };

  const createOrder = async () => {
    if (!newOrderCustomerId || newOrderItems.length === 0) {
      setOrderError('Selecione cliente e pelo menos um item.');
      return;
    }
    const scheduledAt = parseDateTimeLocalInput(newOrderScheduledAt);
    if (!scheduledAt) {
      setOrderError('Informe uma data e horario validos para o pedido.');
      return;
    }
    if (draftDiscount < 0) {
      setOrderError('Desconto nao pode ser negativo.');
      return;
    }
    setOrderError(null);
    try {
      const createdOrder = await apiFetch<OrderView>('/orders', {
        method: 'POST',
        body: JSON.stringify({
          customerId: Number(newOrderCustomerId),
          items: newOrderItems,
          discount: parseCurrencyBR(newOrderDiscount),
          scheduledAt: scheduledAt.toISOString(),
          notes: tutorialMode
            ? withTestDataTag(newOrderNotes, 'Pedido do momento')
            : newOrderNotes || undefined,
        }),
      });
      setNewOrderCustomerId('');
      setCustomerSearch('');
      setNewOrderItems([]);
      setNewOrderDiscount('0,00');
      setNewOrderNotes(tutorialMode ? withTestDataTag('', 'Pedido do momento') : '');
      setNewOrderScheduledAt(defaultOrderDateTimeInput());
      const refreshedOrders = await loadAll();
      await refreshOperationalState(createdOrder.id ?? null);
      const freshCreated = refreshedOrders.find((entry) => entry.id === createdOrder.id);
      notifySuccess('Pedido criado com sucesso.');
      if (freshCreated) {
        openOrderDetail(freshCreated);
      } else {
        scrollToLayoutSlot('list');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Nao foi possivel criar o pedido.';
      setOrderError(message);
      notifyError(message);
    }
  };

  const addItem = async (orderId: number) => {
    if (!addItemProductId || addItemQty <= 0) return;
    try {
      await apiFetch(`/orders/${orderId}/items`, {
        method: 'POST',
        body: JSON.stringify({ productId: Number(addItemProductId), quantity: addItemQty }),
      });
      setAddItemProductId('');
      setAddItemProductSearch('');
      setAddItemQty(1);
      await loadAll();
      await refreshOperationalState(orderId);
      notifySuccess('Item adicionado ao pedido.');
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Nao foi possivel adicionar o item.');
    }
  };

  const removeItem = async (orderId: number, itemId: number) => {
    const orderScope = selectedOrder?.id === orderId ? selectedOrder : orders.find((entry) => entry.id === orderId);
    const itemToRestore = orderScope?.items?.find((item) => item.id === itemId);
    const accepted = await confirm({
      title: 'Remover item do pedido?',
      description: 'A fila de producao sera recalculada para este pedido.',
      confirmLabel: 'Remover',
      cancelLabel: 'Cancelar',
      danger: true
    });
    if (!accepted) return;
    try {
      await apiFetch(`/orders/${orderId}/items/${itemId}`, { method: 'DELETE' });
      await loadAll();
      await refreshOperationalState(orderId);
      if (itemToRestore) {
        const productName = productMap.get(itemToRestore.productId)?.name ?? `Produto ${itemToRestore.productId}`;
        notifyUndo(`${productName} removido do pedido.`, async () => {
          await apiFetch(`/orders/${orderId}/items`, {
            method: 'POST',
            body: JSON.stringify({
              productId: itemToRestore.productId,
              quantity: itemToRestore.quantity
            })
          });
          await loadAll();
          notifySuccess('Item restaurado no pedido.');
          scrollToLayoutSlot('detail');
        });
      } else {
        notifySuccess('Item removido do pedido.');
      }
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Nao foi possivel remover o item.');
    }
  };

  const removeOrder = async (orderId: number) => {
    const accepted = await confirm({
      title: 'Excluir pedido?',
      description: 'Essa acao remove o pedido e tira a demanda da fila de producao.',
      confirmLabel: 'Excluir',
      cancelLabel: 'Cancelar',
      danger: true
    });
    if (!accepted) return;
    try {
      await apiFetch(`/orders/${orderId}`, { method: 'DELETE' });
      setSelectedOrder(null);
      await loadAll();
      await refreshOperationalState(null);
      notifySuccess('Pedido excluido com sucesso.');
      scrollToLayoutSlot('list');
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Nao foi possivel excluir o pedido.');
    }
  };

  const updateStatus = async (orderId: number, status: string) => {
    try {
      await apiFetch(`/orders/${orderId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await loadAll();
      await refreshOperationalState(orderId);
      notifySuccess(`Status atualizado para ${status}.`);
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Nao foi possivel atualizar o status.');
    }
  };

  const saveSelectedOrderSchedule = async () => {
    if (!selectedOrder?.id) return;
    const scheduledAt = parseDateTimeLocalInput(selectedOrderScheduledAt);
    if (!scheduledAt) {
      notifyError('Informe uma data e horario validos para o pedido.');
      return;
    }

    setSavingOrderSchedule(true);
    try {
      await apiFetch(`/orders/${selectedOrder.id}`, {
        method: 'PUT',
        body: JSON.stringify({ scheduledAt: scheduledAt.toISOString() }),
      });
      await loadAll();
      await refreshOperationalState(selectedOrder.id);
      notifySuccess('Data e horario do pedido atualizados.');
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Nao foi possivel atualizar a data do pedido.');
    } finally {
      setSavingOrderSchedule(false);
    }
  };

  const advanceStatus = async () => {
    if (!selectedOrder?.id) return;
    const nextStatus = nextStatusByCurrent[selectedOrder.status || ''];
    if (!nextStatus) return;
    await updateStatus(selectedOrder.id, nextStatus);
  };

  const loadUberReadiness = async () => {
    if (!selectedOrder?.id) return;

    setUberReadinessLoading(true);
    setUberReadinessError(null);
    setUberQuote(null);
    setUberQuoteError(null);
    try {
      const data = await fetchUberDirectReadiness(selectedOrder.id);
      setUberReadiness(data);
    } catch (err) {
      setUberReadinessError(
        err instanceof Error ? err.message : 'Nao foi possivel validar a entrega com a Uber.'
      );
    } finally {
      setUberReadinessLoading(false);
    }
  };

  const loadUberQuote = async () => {
    if (!selectedOrder?.id) return;
    if (!uberReadiness?.ready) {
      setUberQuote(null);
      setUberQuoteError('Valide a entrega Uber e resolva as pendencias antes de cotar.');
      return;
    }

    setUberQuoteLoading(true);
    setUberQuoteError(null);
    try {
      const data = await fetchUberDirectQuote(selectedOrder.id);
      setUberQuote(data);
      notifySuccess('Cotacao Uber carregada.');
    } catch (err) {
      setUberQuoteError(
        err instanceof Error ? err.message : 'Nao foi possivel consultar a cotacao da Uber.'
      );
    } finally {
      setUberQuoteLoading(false);
    }
  };

  const startProductionNow = async () => {
    setStartingProductionBatch(true);
    try {
      const result = await startNextProductionBatch({
        triggerSource: 'MANUAL',
        triggerLabel: 'Inicio manual pelo app'
      });
      setProductionBoard(result.board);
      await loadAll();
      await refreshOperationalState(selectedOrderId);
      notifySuccess('Fornada iniciada com baixa real no estoque.');
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Nao foi possivel iniciar a fornada.');
    } finally {
      setStartingProductionBatch(false);
    }
  };

  const completeActiveProductionBatch = async () => {
    const batchId = productionBoard?.oven.activeBatch?.id;
    if (!batchId) return;

    setCompletingProductionBatch(true);
    try {
      const result = await completeProductionBatch(batchId);
      setProductionBoard(result.board);
      await loadAll();
      await refreshOperationalState(selectedOrderId);
      notifySuccess('Fornada concluida. Pedidos prontos seguiram para entrega.');
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Nao foi possivel concluir a fornada.');
    } finally {
      setCompletingProductionBatch(false);
    }
  };

  const dispatchSelectedOrderToUber = async () => {
    if (!selectedOrder?.id) return;

    try {
      const result = await dispatchUberDirectOrder(selectedOrder.id);
      setDeliveryTracking(result.tracking);
      await loadAll();
      await refreshOperationalState(selectedOrder.id);
      notifySuccess(
        result.tracking.mode === 'LIVE'
          ? 'Entrega enviada para a Uber.'
          : 'Entrega criada localmente e pronta para acompanhar.'
      );
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Nao foi possivel enviar a entrega.');
    }
  };

  const completeSelectedDelivery = async () => {
    if (!selectedOrder?.id) return;

    try {
      const result = await markOrderDeliveryComplete(selectedOrder.id);
      setDeliveryTracking(result);
      await loadAll();
      await refreshOperationalState(selectedOrder.id);
      notifySuccess('Entrega marcada como concluida.');
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Nao foi possivel concluir a entrega.');
    }
  };

  const registerPayment = async () => {
    if (!selectedOrder?.id) return;
    if (selectedOrder.status === 'CANCELADO') {
      setPaymentError('Nao e possivel registrar pagamento para pedido cancelado.');
      return;
    }

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
      await refreshOperationalState(selectedOrder.id);
      notifySuccess('Pagamento registrado com sucesso.');
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : 'Nao foi possivel registrar pagamento.');
      notifyError(err instanceof Error ? err.message : 'Nao foi possivel registrar pagamento.');
    }
  };

  const markOrderPaid = async () => {
    if (!selectedOrder?.id) return;
    if (selectedOrder.status === 'CANCELADO') {
      setPaymentError('Nao e possivel quitar um pedido cancelado.');
      return;
    }
    if (selectedOrderBalance <= 0) {
      setPaymentError('Este pedido ja esta totalmente pago.');
      return;
    }

    const confirmed = await confirm({
      title: 'Marcar pedido como pago?',
      description: `Pedido #${selectedOrder.id} sera quitado em ${formatCurrencyBR(selectedOrderBalance)}.`,
      confirmLabel: 'Marcar como pago',
      cancelLabel: 'Cancelar'
    });
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
      await refreshOperationalState(selectedOrder.id);
      notifySuccess('Pedido marcado como pago.');
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : 'Nao foi possivel marcar o pedido como pago.');
      notifyError(err instanceof Error ? err.message : 'Nao foi possivel marcar o pedido como pago.');
    } finally {
      setMarkingPaid(false);
    }
  };

  const removePayment = async (paymentId: number) => {
    const paymentToRestore = selectedPayments.find((entry) => entry.id === paymentId);
    const accepted = await confirm({
      title: 'Remover pagamento?',
      description: 'Essa acao remove o registro de pagamento do pedido.',
      confirmLabel: 'Remover',
      cancelLabel: 'Cancelar',
      danger: true
    });
    if (!accepted) return;
    try {
      await apiFetch(`/payments/${paymentId}`, { method: 'DELETE' });
      await loadAll();
      await refreshOperationalState(selectedOrder?.id ?? null);
      if (paymentToRestore) {
        notifyUndo('Pagamento removido com sucesso.', async () => {
          await apiFetch('/payments', {
            method: 'POST',
            body: JSON.stringify({
              orderId: paymentToRestore.orderId,
              amount: paymentToRestore.amount,
              method: paymentToRestore.method,
              status: paymentToRestore.status || 'PAGO',
              paidAt: paymentToRestore.paidAt || undefined,
              dueDate: paymentToRestore.dueDate || undefined,
              providerRef: paymentToRestore.providerRef || undefined
            })
          });
          await loadAll();
          notifySuccess('Pagamento restaurado com sucesso.');
          scrollToLayoutSlot('detail');
        });
      } else {
        notifySuccess('Pagamento removido com sucesso.');
      }
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Nao foi possivel remover o pagamento.');
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

  const parseIdFromLabel = (
    value: string,
    options: Array<{
      id: number;
      label: string;
    }>
  ) => {
    const raw = value.trim();
    if (!raw) return NaN;

    const byHash = raw.match(/#(\d+)\)?$/);
    if (byHash) return Number(byHash[1]);

    if (/^\d+$/.test(raw)) return Number(raw);

    const normalized = raw.toLowerCase();
    const matches = options.filter((option) => {
      const full = option.label.toLowerCase();
      const withoutId = option.label.replace(/\s*\(#\d+\)\s*$/, '').trim().toLowerCase();
      return full === normalized || withoutId === normalized;
    });
    if (matches.length === 1) return matches[0].id;

    return NaN;
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

  const visibleOrders = useMemo(() => {
    if (!isOperationMode) return filteredOrders;
    return filteredOrders.filter((order) => order.status !== 'ENTREGUE' && order.status !== 'CANCELADO');
  }, [filteredOrders, isOperationMode]);

  const calendarEntries = useMemo<CalendarOrderEntry[]>(() => {
    return visibleOrders
      .map((order) => {
        const createdAt = resolveOrderDate(order) || new Date();
        return {
          order,
          createdAt,
          dateKey: dateKeyFromDate(startOfLocalDay(createdAt))
        };
      })
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }, [visibleOrders]);

  const calendarOrdersByDate = useMemo(() => {
    const grouped = new Map<string, CalendarOrderEntry[]>();
    for (const entry of calendarEntries) {
      const bucket = grouped.get(entry.dateKey) || [];
      bucket.push(entry);
      grouped.set(entry.dateKey, bucket);
    }
    return grouped;
  }, [calendarEntries]);

  const todayDateKey = dateKeyFromDate(new Date());
  const selectedCalendarDate = useMemo(
    () => startOfLocalDay(dateFromDateKey(selectedCalendarDateKey)),
    [selectedCalendarDateKey]
  );

  const selectedDateEntries = useMemo(() => {
    const entries = calendarOrdersByDate.get(selectedCalendarDateKey) || [];
    return [...entries].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }, [calendarOrdersByDate, selectedCalendarDateKey]);

  const selectedDateRevenue = useMemo(
    () => selectedDateEntries.reduce((sum, entry) => sum + (entry.order.total ?? 0), 0),
    [selectedDateEntries]
  );

  const monthCells = useMemo(() => {
    const currentMonth = calendarAnchorDate.getMonth();
    return monthGridDates(calendarAnchorDate).map((date) => {
      const key = dateKeyFromDate(date);
      const entries = calendarOrdersByDate.get(key) || [];
      const dayRevenue = entries.reduce((sum, entry) => sum + (entry.order.total ?? 0), 0);
      return {
        date,
        key,
        entries,
        dayRevenue,
        inCurrentMonth: date.getMonth() === currentMonth,
        isToday: key === todayDateKey,
        isSelected: key === selectedCalendarDateKey
      };
    });
  }, [calendarAnchorDate, calendarOrdersByDate, selectedCalendarDateKey, todayDateKey]);

  const weekCells = useMemo(() => {
    return weekGridDates(calendarAnchorDate).map((date) => {
      const key = dateKeyFromDate(date);
      const entries = calendarOrdersByDate.get(key) || [];
      const dayRevenue = entries.reduce((sum, entry) => sum + (entry.order.total ?? 0), 0);
      return {
        date,
        key,
        entries,
        dayRevenue,
        inCurrentMonth: true,
        isToday: key === todayDateKey,
        isSelected: key === selectedCalendarDateKey
      };
    });
  }, [calendarAnchorDate, calendarOrdersByDate, selectedCalendarDateKey, todayDateKey]);

  const dayHourSlots = useMemo(() => Array.from({ length: 17 }, (_, index) => index + 6), []);
  const dayGridStartMinutes = (dayHourSlots[0] ?? 0) * 60;
  const dayGridEndMinutes = ((dayHourSlots[dayHourSlots.length - 1] ?? 23) + 1) * 60;
  const dayGridDurationMinutes = Math.max(dayGridEndMinutes - dayGridStartMinutes, 60);
  const dayGridPixelsPerHour = 76;
  const dayGridHeight = Math.round((dayGridDurationMinutes / 60) * dayGridPixelsPerHour);
  const selectedDateEntriesInsideGrid = useMemo(() => {
    return selectedDateEntries.filter((entry) => {
      const minutes = minutesIntoDay(entry.createdAt);
      return minutes >= dayGridStartMinutes && minutes < dayGridEndMinutes;
    });
  }, [dayGridEndMinutes, dayGridStartMinutes, selectedDateEntries]);
  const selectedDateOverflowEntries = useMemo(() => {
    return selectedDateEntries.filter((entry) => {
      const minutes = minutesIntoDay(entry.createdAt);
      return minutes < dayGridStartMinutes || minutes >= dayGridEndMinutes;
    });
  }, [dayGridEndMinutes, dayGridStartMinutes, selectedDateEntries]);
  const selectedDateTimelineEvents = useMemo(() => {
    const laneEndMinutes: number[] = [];
    const minCardHeight = 52;
    const baseDuration = 45;
    const pixelsPerMinute = dayGridHeight / dayGridDurationMinutes;

    return selectedDateEntriesInsideGrid.map((entry) => {
      const startMinutes = clampNumber(
        minutesIntoDay(entry.createdAt),
        dayGridStartMinutes,
        dayGridEndMinutes
      );
      let lane = laneEndMinutes.findIndex((value) => startMinutes >= value);
      if (lane === -1) {
        lane = laneEndMinutes.length;
        laneEndMinutes.push(startMinutes + baseDuration);
      } else {
        laneEndMinutes[lane] = startMinutes + baseDuration;
      }

      const top = Math.round((startMinutes - dayGridStartMinutes) * pixelsPerMinute);
      const height = Math.max(Math.round(baseDuration * pixelsPerMinute), minCardHeight);

      return {
        entry,
        lane,
        top,
        height
      };
    });
  }, [
    dayGridDurationMinutes,
    dayGridEndMinutes,
    dayGridHeight,
    dayGridStartMinutes,
    selectedDateEntriesInsideGrid
  ]);
  const dayTimelineLaneCount = useMemo(
    () =>
      Math.max(
        selectedDateTimelineEvents.reduce((max, item) => Math.max(max, item.lane + 1), 0),
        1
      ),
    [selectedDateTimelineEvents]
  );

  const visibleSelectedDateEntries = useMemo(() => {
    if (expandSelectedDayDetails) return selectedDateEntries;
    return selectedDateEntries.slice(0, 4);
  }, [expandSelectedDayDetails, selectedDateEntries]);

  const hasHiddenSelectedDateEntries = selectedDateEntries.length > visibleSelectedDateEntries.length;
  const calendarRangeLabel = useMemo(
    () => formatCalendarRangeLabel(calendarAnchorDate, calendarView),
    [calendarAnchorDate, calendarView]
  );

  const shiftCalendar = (direction: -1 | 1) => {
    setCalendarAnchorDate((previous) => shiftDateByCalendarView(previous, calendarView, direction));
    setSelectedCalendarDateKey((previous) => {
      const shifted = shiftDateByCalendarView(dateFromDateKey(previous), calendarView, direction);
      return dateKeyFromDate(shifted);
    });
    setExpandSelectedDayDetails(false);
  };

  const jumpCalendarToToday = () => {
    const today = startOfLocalDay(new Date());
    setCalendarAnchorDate(today);
    setSelectedCalendarDateKey(dateKeyFromDate(today));
    setExpandSelectedDayDetails(false);
  };

  const selectCalendarDate = (date: Date) => {
    const normalized = startOfLocalDay(date);
    setSelectedCalendarDateKey(dateKeyFromDate(normalized));
    setCalendarAnchorDate(normalized);
    setExpandSelectedDayDetails(false);
  };

  useEffect(() => {
    if (calendarEntries.length === 0) return;
    if (calendarOrdersByDate.has(selectedCalendarDateKey)) return;
    const fallback = startOfLocalDay(calendarEntries[calendarEntries.length - 1].createdAt);
    setSelectedCalendarDateKey(dateKeyFromDate(fallback));
    setCalendarAnchorDate(fallback);
  }, [calendarEntries, calendarOrdersByDate, selectedCalendarDateKey]);

  useEffect(() => {
    if (!newOrderCustomerId) return;
    const customer = customers.find((entry) => entry.id === newOrderCustomerId);
    const normalizedPhone = (customer?.phone || '').replace(/\D+/g, '');
    if (!normalizedPhone) return;
    setWhatsappFlowRecipientPhone(normalizedPhone);
  }, [customers, newOrderCustomerId]);

  const draftSubtotal = useMemo(() => {
    return newOrderItems.reduce((sum, item) => {
      const product = productMap.get(item.productId);
      return sum + (product?.price ?? 0) * item.quantity;
    }, 0);
  }, [newOrderItems, productMap]);

  const draftDiscount = useMemo(() => Math.max(parseCurrencyBR(newOrderDiscount), 0), [newOrderDiscount]);
  const draftTotal = Math.max(draftSubtotal - draftDiscount, 0);
  const canCreateOrder = Boolean(newOrderCustomerId) && newOrderItems.length > 0;

  const selectedOrderPaidAmount = toMoney(
    selectedOrder?.amountPaid ?? paidAmountFromPayments(selectedOrder)
  );
  const selectedOrderBalance = toMoney(
    selectedOrder?.balanceDue ?? Math.max(toMoney(selectedOrder?.total ?? 0) - selectedOrderPaidAmount, 0)
  );
  const selectedCustomer = selectedOrder
    ? customers.find((customer) => customer.id === selectedOrder.customerId) || null
    : null;
  const selectedCustomerAddress = buildCustomerAddressForUber(selectedCustomer);
  const selectedOrderDate = resolveOrderDate(selectedOrder);
  const selectedOrderDateLabel = formatOrderDateTimeLabel(selectedOrderDate);
  const selectedOrderUberUrl = buildUberDeliveryUrl(selectedCustomer);
  const selectedOrderUberSummary = buildUberOrderSummary(selectedOrder, selectedCustomer, productMap);
  const selectedOrderIsCancelled = selectedOrder?.status === 'CANCELADO';
  const selectedOrderNextStatus = selectedOrder
    ? nextStatusByCurrent[selectedOrder.status || '']
    : null;
  const activeProductionBatch = productionBoard?.oven.activeBatch || null;
  const selectedOrderQueueState = selectedOrder
    ? productionBoard?.queue.find((entry) => entry.orderId === selectedOrder.id) || null
    : null;
  const selectedOrderInActiveBatch = Boolean(
    selectedOrder?.id && activeProductionBatch?.linkedOrderIds.includes(selectedOrder.id)
  );
  const selectedOrderTracking =
    selectedOrder?.id && deliveryTracking?.orderId === selectedOrder.id ? deliveryTracking : null;
  const isCalendarScreen = screenMode === 'calendar';

  const launchOrderIntakeWhatsappFlow = async () => {
    if (!whatsappFlowRecipientPhone.trim()) {
      setWhatsappFlowLaunchError('Informe o telefone de destino para o WhatsApp Flow.');
      return;
    }

    setLaunchingWhatsappFlow(true);
    setWhatsappFlowLaunchError(null);
    try {
      const result = await launchWhatsappOrderIntakeFlow({
        recipientPhone: whatsappFlowRecipientPhone,
        customerId:
          typeof newOrderCustomerId === 'number' && Number.isFinite(newOrderCustomerId)
            ? newOrderCustomerId
            : undefined,
        scheduledAt: newOrderScheduledAt
          ? new Date(newOrderScheduledAt).toISOString()
          : null,
        notes: newOrderNotes || null
      });
      setWhatsappFlowLaunchResult(result);
      notifySuccess(
        result.canSendViaMeta
          ? 'WhatsApp Flow preparado e enfileirado no outbox.'
          : 'WhatsApp Flow preparado. Falta configurar o Flow ID da Meta para envio automatico.'
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Nao foi possivel iniciar o WhatsApp Flow.';
      setWhatsappFlowLaunchError(message);
      notifyError(message);
    } finally {
      setLaunchingWhatsappFlow(false);
    }
  };

  return (
    <BuilderLayoutProvider page="pedidos">
      <section className="grid gap-8">
      <BuilderLayoutItemSlot
        id="load_error"
        className={isSpotlightSlot('load_error') ? 'app-spotlight-slot app-spotlight-slot--active' : 'app-spotlight-slot'}
      >
      {loadError ? (
        <div className="app-panel">
          <p className="text-sm text-red-700">Nao foi possivel carregar os pedidos: {loadError}</p>
        </div>
      ) : null}
      </BuilderLayoutItemSlot>

      {!isCalendarScreen ? (
      <BuilderLayoutItemSlot
        id="new_order"
        className={isSpotlightSlot('new_order') ? 'app-spotlight-slot app-spotlight-slot--active' : 'app-spotlight-slot'}
      >
      <details className="grid gap-4">
        <summary className="cursor-pointer text-sm font-semibold text-neutral-700">Novo pedido</summary>
        <div className="app-panel grid gap-3">
          <div>
            <p className="text-sm font-semibold text-neutral-900">Captar pelo WhatsApp Flow</p>
            <p className="text-xs text-neutral-500">Cliente e pedido podem ser preenchidos no WhatsApp e voltar prontos para o app.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <FormField label="Telefone do WhatsApp">
              <input
                className="app-input"
                placeholder="5511999999999"
                value={whatsappFlowRecipientPhone}
                inputMode="tel"
                onChange={(event) => setWhatsappFlowRecipientPhone(event.target.value)}
              />
            </FormField>
            <div className="app-form-actions app-form-actions--mobile-sticky">
              <button
                type="button"
                className="app-button app-button-primary"
                onClick={launchOrderIntakeWhatsappFlow}
                disabled={launchingWhatsappFlow}
              >
                {launchingWhatsappFlow ? 'Preparando...' : 'Enviar Flow'}
              </button>
            </div>
          </div>
          {whatsappFlowLaunchError ? <p className="text-xs text-red-600">{whatsappFlowLaunchError}</p> : null}
          {whatsappFlowLaunchResult ? (
            <div className="rounded-lg border border-white/60 bg-white/70 px-3 py-3 text-sm text-neutral-700">
              <p>
                Sessao criada. Outbox #{whatsappFlowLaunchResult.outboxMessageId}
                {whatsappFlowLaunchResult.canSendViaMeta ? '' : ' • envio automatico aguardando Flow ID da Meta'}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <a
                  className="app-button app-button-ghost"
                  href={whatsappFlowLaunchResult.previewUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Abrir Flow
                </a>
              </div>
            </div>
          ) : null}
        </div>
        <OrderQuickCreate
          tutorialMode={tutorialMode}
          customerOptions={customerOptions}
          productOptions={productOptions}
          customerSearch={customerSearch}
          draftProductSearch={draftProductSearch}
          draftQty={draftQty}
          newOrderScheduledAt={newOrderScheduledAt}
          newOrderDiscount={newOrderDiscount}
          newOrderNotes={newOrderNotes}
          newOrderItems={newOrderItems}
          canCreateOrder={canCreateOrder}
          orderError={orderError}
          draftSubtotal={draftSubtotal}
          draftDiscount={draftDiscount}
          draftTotal={draftTotal}
          productMap={productMap}
          onCustomerSearchChange={(value) => {
            setCustomerSearch(value);
            const parsedId = parseIdFromLabel(value, customerOptions);
            setNewOrderCustomerId(Number.isFinite(parsedId) ? parsedId : '');
          }}
          onProductSearchChange={(value) => {
            setDraftProductSearch(value);
            const parsedId = parseIdFromLabel(value, productOptions);
            setDraftProductId(Number.isFinite(parsedId) ? parsedId : '');
          }}
          onDraftQtyChange={(value) => setDraftQty(parsePositiveIntegerInput(value))}
          onScheduledAtChange={setNewOrderScheduledAt}
          onDiscountChange={setNewOrderDiscount}
          onDiscountBlur={() =>
            setNewOrderDiscount(formatMoneyInputBR(newOrderDiscount || '0') || '0,00')
          }
          onNotesChange={setNewOrderNotes}
          onAddItemDraft={addItemDraft}
          onCreateOrder={createOrder}
          onRemoveDraftItem={removeDraftItem}
          onClearDraft={clearDraft}
        />
      </details>
      </BuilderLayoutItemSlot>
      ) : null}

      <BuilderLayoutItemSlot
        id="list"
        className={isSpotlightSlot('list') ? 'app-spotlight-slot app-spotlight-slot--active' : 'app-spotlight-slot'}
      >
      <CalendarBoard
        filters={
          isCalendarScreen ? null : (
            <OrderFilters
              isOperationMode={isOperationMode}
              orderSearch={orderSearch}
              onOrderSearchChange={setOrderSearch}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              financialFilter={financialFilter}
              onFinancialFilterChange={setFinancialFilter}
              orderStatuses={orderStatuses}
            />
          )
        }
        helperText={null}
        toolbar={
          <div className="orders-calendar-toolbar">
          <div className="app-inline-actions">
            {(['DAY', 'WEEK', 'MONTH'] as CalendarViewMode[]).map((view) => (
              <button
                key={view}
                type="button"
                className={`app-button ${calendarView === view ? 'app-button-primary' : 'app-button-ghost'}`}
                onClick={() => setCalendarView(view)}
              >
                {calendarViewLabels[view]}
              </button>
            ))}
          </div>
          <div className="orders-calendar-nav">
            <button type="button" className="app-button app-button-ghost" onClick={() => shiftCalendar(-1)}>
              ←
            </button>
            <p className="orders-calendar-nav__label">{calendarRangeLabel}</p>
            <button type="button" className="app-button app-button-ghost" onClick={() => shiftCalendar(1)}>
              →
            </button>
            <button type="button" className="app-button app-button-primary" onClick={jumpCalendarToToday}>
              hoje
            </button>
          </div>
        </div>
        }
      >
        {loading ? (
          <div className="app-panel border-dashed text-sm text-neutral-500">
            Carregando pedidos...
          </div>
        ) : (
          <>
            {calendarView === 'DAY' ? (
              <div className="orders-day-sheet">
                <div className="orders-day-sheet__all-day">
                  <div className="orders-day-sheet__all-day-head">
                    <div>
                      <p className="orders-day-sheet__eyebrow">Visao rapida do dia</p>
                      <p className="orders-day-sheet__title">
                        {selectedDateEntries.length === 0
                          ? 'Nenhum pedido para esta data'
                          : `${selectedDateEntries.length} pedido(s) no quadro`}
                      </p>
                    </div>
                    <span className="orders-day-sheet__meta">{formatCurrencyBR(selectedDateRevenue)}</span>
                  </div>
                  {selectedDateEntries.length === 0 ? (
                    <p className="orders-day-sheet__empty">
                      Selecione outra data ou crie um pedido para preencher esta grade.
                    </p>
                  ) : (
                    <div className="orders-day-sheet__all-day-list">
                      {selectedDateEntries.slice(0, 6).map((entry) => (
                        <button
                          type="button"
                          key={`day-quick-${entry.dateKey}-${entry.order.id ?? '-'}-${entry.createdAt.getTime()}`}
                          className={`orders-calendar-chip ${selectedOrder?.id === entry.order.id ? 'orders-calendar-chip--active' : ''}`}
                          onClick={() => openOrderDetail(entry.order)}
                        >
                          <span
                            className={`orders-calendar-chip__dot ${calendarStatusDotClass(entry.order.status || '')}`}
                            aria-hidden="true"
                          />
                          <span className="orders-calendar-chip__time">
                            {entry.createdAt.toLocaleTimeString('pt-BR', {
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </span>
                          <span className="orders-calendar-chip__label">
                            #{entry.order.id ?? '-'} ·{' '}
                            {customerMap.get(entry.order.customerId)?.name || 'Sem cliente'}
                          </span>
                        </button>
                      ))}
                      {selectedDateEntries.length > 6 ? (
                        <span className="orders-calendar-cell__more">
                          +{selectedDateEntries.length - 6} pedido(s) no detalhe abaixo
                        </span>
                      ) : null}
                    </div>
                  )}
                </div>

                <div
                  className="orders-day-grid"
                  style={
                    {
                      '--orders-day-grid-height': `${dayGridHeight}px`,
                      '--orders-day-grid-lanes': `${dayTimelineLaneCount}`
                    } as CSSProperties
                  }
                >
                  <div className="orders-day-grid__hours" aria-hidden="true">
                    {dayHourSlots.map((hour) => (
                      <div key={hour} className="orders-day-grid__hour">
                        <span className="orders-day-grid__hour-label">{`${`${hour}`.padStart(2, '0')}:00`}</span>
                      </div>
                    ))}
                  </div>
                  <div className="orders-day-grid__canvas">
                    {dayHourSlots.map((hour) => {
                      const offsetMinutes = hour * 60 - dayGridStartMinutes;
                      const top = Math.round((offsetMinutes / dayGridDurationMinutes) * dayGridHeight);
                      return (
                        <div
                          key={`line-${hour}`}
                          className="orders-day-grid__line"
                          style={{ top: `${top}px` }}
                          aria-hidden="true"
                        />
                      );
                    })}
                    {selectedDateTimelineEvents.length === 0 ? (
                      <div className="orders-day-grid__empty">sem pedidos entre 06:00 e 22:59</div>
                    ) : (
                      selectedDateTimelineEvents.map((item) => {
                        const customerName = customerMap.get(item.entry.order.customerId)?.name || 'Sem cliente';
                        return (
                          <button
                            type="button"
                            key={`timeline-${item.entry.dateKey}-${item.entry.order.id ?? '-'}-${item.entry.createdAt.getTime()}`}
                            className={`orders-day-grid__event ${selectedOrder?.id === item.entry.order.id ? 'orders-day-grid__event--active' : ''}`}
                            onClick={() => openOrderDetail(item.entry.order)}
                            style={
                              {
                                top: `${item.top}px`,
                                height: `${item.height}px`,
                                '--orders-day-grid-lane': `${item.lane}`
                              } as CSSProperties
                            }
                          >
                            <span
                              className={`orders-calendar-chip__dot ${calendarStatusDotClass(item.entry.order.status || '')}`}
                              aria-hidden="true"
                            />
                            <span className="orders-day-grid__event-time">
                              {item.entry.createdAt.toLocaleTimeString('pt-BR', {
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </span>
                            <span className="orders-day-grid__event-title">
                              #{item.entry.order.id ?? '-'} · {customerName}
                            </span>
                            <span className="orders-day-grid__event-meta">
                              {formatCurrencyBR(item.entry.order.total ?? 0)}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
                {selectedDateEntriesInsideGrid.length > 0 ? (
                  <p className="text-xs text-neutral-500">
                    Horarios mostrados em escala continua. Eventos muito proximos compartilham colunas laterais.
                  </p>
                ) : null}
                  {selectedDateOverflowEntries.length > 0 ? (
                    <div className="orders-day-timeline__overflow">
                      <p className="orders-day-timeline__overflow-title">Pedidos fora da grade 06:00-22:00</p>
                      <div className="orders-day-timeline__overflow-list">
                        {selectedDateOverflowEntries.map((entry) => (
                          <button
                            type="button"
                            key={`overflow-${entry.dateKey}-${entry.createdAt.getTime()}-${entry.order.id ?? '-'}`}
                            className="orders-day-timeline__event"
                            onClick={() => openOrderDetail(entry.order)}
                          >
                            <span className="orders-day-timeline__event-title">
                              #{entry.order.id ?? '-'} ·{' '}
                              {customerMap.get(entry.order.customerId)?.name || 'Sem cliente'}
                            </span>
                            <span className="orders-day-timeline__event-meta">
                              {entry.createdAt.toLocaleTimeString('pt-BR', {
                                hour: '2-digit',
                                minute: '2-digit'
                              })}{' '}
                              • {formatCurrencyBR(entry.order.total ?? 0)}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
            ) : calendarView === 'WEEK' ? (
              <div className="orders-week-board">
                {weekCells.map((cell) => (
                  <div
                    key={cell.key}
                    className={`orders-week-column ${cell.isSelected ? 'orders-week-column--selected' : ''} ${cell.isToday ? 'orders-week-column--today' : ''}`}
                  >
                    <button
                      type="button"
                      className="orders-week-column__select"
                      onClick={() => selectCalendarDate(cell.date)}
                    >
                      <div className="orders-week-column__head">
                        <div>
                          <span className="orders-week-column__eyebrow">
                            {formatCalendarWeekdayLabel(cell.date)}
                          </span>
                          <p className="orders-week-column__date">{cell.date.getDate()}</p>
                        </div>
                        <span className="orders-calendar-cell__count">{cell.entries.length} pedido(s)</span>
                      </div>
                    </button>
                    <div className="orders-week-column__events">
                      {cell.entries.length === 0 ? (
                        <span className="orders-calendar-cell__more">dia livre</span>
                      ) : (
                        <>
                          {cell.entries.slice(0, 6).map((entry) => (
                            <button
                              type="button"
                              key={`week-${cell.key}-${entry.order.id ?? '-'}-${entry.createdAt.getTime()}`}
                              className={`orders-calendar-chip ${selectedOrder?.id === entry.order.id ? 'orders-calendar-chip--active' : ''}`}
                              onClick={() => openOrderDetail(entry.order)}
                            >
                              <span
                                className={`orders-calendar-chip__dot ${calendarStatusDotClass(entry.order.status || '')}`}
                                aria-hidden="true"
                              />
                              <span className="orders-calendar-chip__time">
                                {entry.createdAt.toLocaleTimeString('pt-BR', {
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })}
                              </span>
                              <span className="orders-calendar-chip__label">
                                #{entry.order.id ?? '-'} ·{' '}
                                {customerMap.get(entry.order.customerId)?.name || 'Sem cliente'}
                              </span>
                            </button>
                          ))}
                          {cell.entries.length > 6 ? (
                            <span className="orders-calendar-cell__more">
                              +{cell.entries.length - 6} pedido(s)
                            </span>
                          ) : null}
                        </>
                      )}
                    </div>

                    <button
                      type="button"
                      className="orders-week-column__footer"
                      onClick={() => selectCalendarDate(cell.date)}
                    >
                      {cell.entries.length > 0 ? 'abrir pedidos deste dia' : 'selecionar este dia'}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <>
                <div className="orders-calendar-weekdays" aria-hidden="true">
                  {calendarDayLabels.map((label) => (
                    <span key={label} className="orders-calendar-weekdays__label">
                      {label}
                    </span>
                  ))}
                </div>
                <div className={`orders-calendar-grid ${calendarView === 'MONTH' ? 'orders-calendar-grid--month' : 'orders-calendar-grid--week'}`}>
                  {monthCells.map((cell) => (
                    <div
                      key={cell.key}
                      className={`orders-calendar-cell ${cell.isSelected ? 'orders-calendar-cell--selected' : ''} ${cell.isToday ? 'orders-calendar-cell--today' : ''} ${calendarView === 'MONTH' && !cell.inCurrentMonth ? 'orders-calendar-cell--outside' : ''}`}
                    >
                      <button
                        type="button"
                        className="orders-calendar-cell__select"
                        onClick={() => selectCalendarDate(cell.date)}
                      >
                        <div className="orders-calendar-cell__head">
                          <div className="orders-calendar-cell__day">
                            <span className="orders-calendar-cell__weekday">
                              {formatCalendarWeekdayLabel(cell.date)}
                            </span>
                            <span className="orders-calendar-cell__date">{cell.date.getDate()}</span>
                          </div>
                          <span className="orders-calendar-cell__count">{cell.entries.length} pedido(s)</span>
                        </div>
                      </button>
                      <div className="orders-calendar-cell__events">
                        {cell.entries.slice(0, 2).map((entry) => (
                          <button
                            type="button"
                            key={`preview-${cell.key}-${entry.order.id ?? '-'}-${entry.createdAt.getTime()}`}
                            className={`orders-calendar-chip ${selectedOrder?.id === entry.order.id ? 'orders-calendar-chip--active' : ''}`}
                            onClick={() => openOrderDetail(entry.order)}
                          >
                            <span
                              className={`orders-calendar-chip__dot ${calendarStatusDotClass(entry.order.status || '')}`}
                              aria-hidden="true"
                            />
                            <span className="orders-calendar-chip__time">
                              {entry.createdAt.toLocaleTimeString('pt-BR', {
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </span>
                            <span className="orders-calendar-chip__label">
                              #{entry.order.id ?? '-'} ·{' '}
                              {customerMap.get(entry.order.customerId)?.name || 'Sem cliente'}
                            </span>
                          </button>
                        ))}
                        {cell.entries.length > 2 ? (
                          <span className="orders-calendar-cell__more">
                            +{cell.entries.length - 2} pedidos
                          </span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="orders-calendar-cell__footer-button"
                        onClick={() => selectCalendarDate(cell.date)}
                      >
                        <div className="orders-calendar-cell__footer">
                          {cell.entries.length > 0 ? 'toque para expandir abaixo' : 'dia livre'}
                        </div>
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="orders-calendar-details">
              <div className="orders-calendar-details__header">
                <h4 className="orders-calendar-details__title">
                  {selectedCalendarDate.toLocaleDateString('pt-BR', {
                    weekday: 'long',
                    day: '2-digit',
                    month: 'long',
                    year: 'numeric'
                  })}
                </h4>
                <span className="rounded-full border border-white/80 bg-white/70 px-3 py-1 text-xs font-semibold text-neutral-700">
                  {selectedDateEntries.length} pedido(s)
                </span>
                {selectedDateEntries.length > 4 ? (
                  <button
                    type="button"
                    className="app-button app-button-ghost"
                    onClick={() => setExpandSelectedDayDetails((prev) => !prev)}
                  >
                    {expandSelectedDayDetails ? 'Recolher detalhes' : 'Expandir detalhes'}
                  </button>
                ) : null}
              </div>
              {selectedDateEntries.length === 0 ? (
                <p className="text-sm text-neutral-500">
                  Sem pedidos para esta data com os filtros atuais.
                </p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {visibleSelectedDateEntries.map((entry) => {
                    const amountPaid = toMoney(
                      entry.order.amountPaid ?? paidAmountFromPayments(entry.order)
                    );
                    const balance = toMoney(
                      entry.order.balanceDue ?? Math.max((entry.order.total ?? 0) - amountPaid, 0)
                    );
                    return (
                      <button
                        type="button"
                        key={`detail-${entry.order.id ?? '-'}-${entry.createdAt.getTime()}`}
                        className={`app-panel text-left ${selectedOrder?.id === entry.order.id ? 'ring-2 ring-orange-200' : ''}`}
                        onClick={() => openOrderDetail(entry.order)}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-neutral-900">
                              {entry.createdAt.toLocaleTimeString('pt-BR', {
                                hour: '2-digit',
                                minute: '2-digit'
                              })}{' '}
                              • {customerMap.get(entry.order.customerId)?.name || 'Sem cliente'}
                            </p>
                            <p className="text-xs text-neutral-500">Pedido #{entry.order.id ?? '-'}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold text-neutral-900">
                              {formatCurrencyBR(entry.order.total ?? 0)}
                            </p>
                            <p className="text-xs text-neutral-500">
                              {balance > 0 ? `saldo ${formatCurrencyBR(balance)}` : 'pago'}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              {hasHiddenSelectedDateEntries ? (
                <p className="text-xs text-neutral-500">
                  Mostrando 4 pedidos. Use &quot;Expandir detalhes&quot; para ver todos.
                </p>
              ) : null}
            </div>
          </>
        )}
      </CalendarBoard>
      </BuilderLayoutItemSlot>

      <BuilderLayoutItemSlot
        id="detail"
        className={isSpotlightSlot('detail') ? 'app-spotlight-slot app-spotlight-slot--active' : 'app-spotlight-slot'}
      >
      {selectedOrder && (isCalendarScreen ? (
        <CalendarOrderDetailPanel
          selectedOrder={selectedOrder}
          customerName={
            customers.find((customer) => customer.id === selectedOrder.customerId)?.name || 'Sem cliente'
          }
          selectedOrderDateLabel={selectedOrderDateLabel}
          selectedOrderScheduledAt={selectedOrderScheduledAt}
          savingOrderSchedule={savingOrderSchedule}
          productMap={productMap}
          orderStatusBadgeClass={orderStatusBadgeClass}
          onSelectedOrderScheduledAtChange={setSelectedOrderScheduledAt}
          onSaveSelectedOrderSchedule={saveSelectedOrderSchedule}
        />
      ) : (
        <div className="app-panel grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-xl font-semibold">Pedido #{selectedOrder.id}</h3>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-neutral-500">
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${orderStatusBadgeClass(selectedOrder.status || '')}`}
                >
                  {selectedOrder.status}
                </span>
                <span>{formatCurrencyBR(selectedOrder.total ?? 0)}</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                className="app-button app-button-ghost"
                href={`/clientes?editCustomerId=${selectedOrder.customerId}`}
              >
                Ver cliente
              </Link>
              {selectedOrderNextStatus ? (
                <button
                  className="app-button app-button-primary disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={advanceStatus}
                  disabled={selectedOrderIsCancelled}
                >
                  Avancar para {selectedOrderNextStatus}
                </button>
              ) : null}
            </div>
          </div>
          <details className="app-details" open>
            <summary>Operacao real</summary>
            <div className="mt-3 grid gap-3">
              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-neutral-900">
                      {selectedOrderQueueState
                        ? `${selectedOrderQueueState.producedBroas}/${selectedOrderQueueState.totalBroas} broa(s) produzidas`
                        : selectedOrder.status === 'ENTREGUE'
                        ? 'Pedido entregue'
                        : 'Aguardando entrar na fila de producao'}
                    </p>
                    <p className="mt-1 text-xs text-neutral-500">
                      {productionLoading
                        ? 'Sincronizando forno...'
                        : activeProductionBatch
                        ? `Forno ocupado ate ${formatOrderDateTimeLabel(safeDateFromIso(activeProductionBatch.readyAt))}`
                        : `Forno livre • capacidade ${productionBoard?.oven.capacityBroas || 14} broas`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selectedOrder.status === 'CONFIRMADO' && !activeProductionBatch ? (
                      <button
                        type="button"
                        className="app-button app-button-primary"
                        onClick={startProductionNow}
                        disabled={startingProductionBatch}
                      >
                        {startingProductionBatch ? 'Iniciando...' : 'Entrar no forno'}
                      </button>
                    ) : null}
                    {selectedOrderInActiveBatch && activeProductionBatch ? (
                      <button
                        type="button"
                        className="app-button app-button-ghost"
                        onClick={completeActiveProductionBatch}
                        disabled={completingProductionBatch}
                      >
                        {completingProductionBatch ? 'Concluindo...' : 'Concluir fornada agora'}
                      </button>
                    ) : null}
                  </div>
                </div>
                {selectedOrderQueueState ? (
                  <p className="mt-3 text-xs text-neutral-500">
                    Restam {selectedOrderQueueState.remainingBroas} broa(s) para este pedido.
                    {selectedOrderQueueState.waitingAlexaTrigger ? ' Aguardando o gatilho da Alexa.' : ''}
                  </p>
                ) : null}
                {productionError ? <p className="mt-2 text-xs text-red-700">{productionError}</p> : null}
              </div>

              <div className="rounded-2xl border border-neutral-200 bg-white p-4 text-sm text-neutral-700">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-neutral-900">
                      {selectedOrderTracking
                        ? `Entrega ${selectedOrderTracking.status}`
                        : 'Entrega ainda nao iniciada'}
                    </p>
                    <p className="mt-1 text-xs text-neutral-500">
                      {selectedOrderTracking?.dropoffEta
                        ? `ETA ${formatOrderDateTimeLabel(safeDateFromIso(selectedOrderTracking.dropoffEta))}`
                        : 'Assim que a fornada fechar, o app despacha a entrega automaticamente.'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selectedOrder.status === 'PRONTO' && !selectedOrderTracking ? (
                      <button
                        type="button"
                        className="app-button app-button-primary"
                        onClick={dispatchSelectedOrderToUber}
                      >
                        Enviar entrega
                      </button>
                    ) : null}
                    {selectedOrderTracking && selectedOrderTracking.status !== 'DELIVERED' ? (
                      <button
                        type="button"
                        className="app-button app-button-ghost"
                        onClick={completeSelectedDelivery}
                      >
                        Marcar entregue
                      </button>
                    ) : null}
                    {selectedOrderTracking?.trackingUrl ? (
                      <a
                        className="app-button app-button-ghost"
                        href={selectedOrderTracking.trackingUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        Acompanhar
                      </a>
                    ) : null}
                  </div>
                </div>
                {deliveryTrackingLoading ? (
                  <p className="mt-3 text-xs text-neutral-500">Atualizando rastreio...</p>
                ) : null}
                {selectedOrderTracking?.lastProviderError ? (
                  <p className="mt-3 text-xs text-amber-700">{selectedOrderTracking.lastProviderError}</p>
                ) : null}
                {deliveryTrackingError ? <p className="mt-3 text-xs text-red-700">{deliveryTrackingError}</p> : null}
              </div>
            </div>
          </details>
          {selectedOrderUberSummary || selectedOrderUberUrl ? (
            <details className="app-details">
              <summary>Entrega via Uber</summary>
              <div className="mt-3 rounded-3xl border border-neutral-200 bg-neutral-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="app-button app-button-primary disabled:cursor-not-allowed disabled:opacity-60"
                      type="button"
                      onClick={loadUberReadiness}
                      disabled={uberReadinessLoading}
                    >
                      {uberReadinessLoading ? 'Validando...' : 'Validar'}
                    </button>
                    <button
                      className="app-button app-button-ghost disabled:cursor-not-allowed disabled:opacity-60"
                      type="button"
                      onClick={loadUberQuote}
                      disabled={uberQuoteLoading || uberReadinessLoading || !uberReadiness?.ready}
                    >
                      {uberQuoteLoading ? 'Cotando...' : 'Cotar'}
                    </button>
                    {selectedOrderUberUrl ? (
                      <a
                        className="app-button app-button-ghost"
                        href={selectedOrderUberUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        Abrir Uber
                      </a>
                    ) : null}
                  </div>
                </div>
                {selectedCustomerAddress ? (
                  <p className="mt-3 text-sm text-neutral-700">
                    <span className="font-semibold text-neutral-900">Destino:</span> {selectedCustomerAddress}
                  </p>
                ) : null}
                {selectedOrderDateLabel ? (
                  <p className="mt-1 text-sm text-neutral-700">
                    <span className="font-semibold text-neutral-900">Horario:</span> {selectedOrderDateLabel}
                  </p>
                ) : null}
                {selectedOrderUberSummary ? (
                  <div className="mt-3 rounded-2xl border border-neutral-200 bg-white p-3 text-sm leading-6 text-neutral-600 whitespace-pre-line">
                    {selectedOrderUberSummary}
                  </div>
                ) : null}
                {uberReadinessError ? (
                  <p className="mt-3 text-sm text-red-700">{uberReadinessError}</p>
                ) : null}
                {uberReadiness ? (
                  <div className="mt-3 rounded-2xl border border-neutral-200 bg-white p-3 text-sm text-neutral-700">
                    <p className="font-semibold text-neutral-900">
                      {uberReadiness.ready ? 'Pronto para integrar.' : 'Ainda faltam dados.'}
                    </p>
                    {uberReadiness.draft.pickupAddress ? (
                      <p className="mt-2">
                        <span className="font-semibold text-neutral-900">Coleta:</span>{' '}
                        {uberReadiness.draft.pickupAddress}
                      </p>
                    ) : null}
                    {uberReadiness.missingRequirements.length > 0 ? (
                      <p className="mt-2">
                        <span className="font-semibold text-neutral-900">Falta no pedido:</span>{' '}
                        {uberReadiness.missingRequirements.join(' • ')}
                      </p>
                    ) : null}
                    {uberReadiness.missingConfiguration.length > 0 ? (
                      <p className="mt-2">
                        <span className="font-semibold text-neutral-900">Falta configurar:</span>{' '}
                        {uberReadiness.missingConfiguration.join(' • ')}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {uberQuoteError ? (
                  <p className="mt-3 text-sm text-red-700">{uberQuoteError}</p>
                ) : null}
                {uberQuote ? (
                  <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
                    <p className="font-semibold">
                      {formatCurrencyByCode(uberQuote.quote.fee, uberQuote.quote.currencyCode)}
                    </p>
                    {uberQuote.quote.expiresAt ? (
                      <p className="mt-1">
                        Expira em {formatOrderDateTimeLabel(safeDateFromIso(uberQuote.quote.expiresAt))}
                      </p>
                    ) : null}
                    {uberQuote.quote.dropoffEta ? (
                      <p className="mt-1">
                        ETA {formatOrderDateTimeLabel(safeDateFromIso(uberQuote.quote.dropoffEta))}
                      </p>
                    ) : null}
                    {uberQuote.quote.pickupDurationSeconds != null ? (
                      <p className="mt-1">
                        Coleta em {Math.max(1, Math.round(uberQuote.quote.pickupDurationSeconds / 60))} min
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </details>
          ) : null}
          <details className="app-details">
            <summary>Horario e agenda</summary>
            <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
              <FormField
                label="Data e horario do pedido"
                hint={
                  selectedCustomerAddress
                    ? `Entrega em ${selectedCustomerAddress}`
                    : 'Usado no calendario, no D+1 e na exportacao para a Uber.'
                }
              >
                <input
                  className="app-input"
                  type="datetime-local"
                  value={selectedOrderScheduledAt}
                  onChange={(e) => setSelectedOrderScheduledAt(e.target.value)}
                />
                {selectedOrderDateLabel ? (
                  <p className="mt-2 text-xs text-neutral-500">Agenda atual: {selectedOrderDateLabel}</p>
                ) : null}
              </FormField>
              <div className="app-form-actions app-form-actions--mobile-sticky">
                <button
                  className="app-button app-button-primary w-full disabled:cursor-not-allowed disabled:opacity-60"
                  type="button"
                  onClick={saveSelectedOrderSchedule}
                  disabled={savingOrderSchedule}
                >
                  {savingOrderSchedule ? 'Salvando...' : 'Salvar horario'}
                </button>
              </div>
            </div>
          </details>

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
                  {!isOperationMode ? (
                    <button
                      className="app-button app-button-danger"
                      onClick={() => removeItem(selectedOrder.id!, item.id!)}
                    >
                      Remover
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          {!isOperationMode ? (
            <details className="app-details">
              <summary>Editar itens</summary>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <FormField label="Produto">
                  <input
                    className="app-input"
                    list="products-list"
                    placeholder="Buscar produto..."
                    value={addItemProductSearch}
                    onChange={(e) => {
                      const value = e.target.value;
                      setAddItemProductSearch(value);
                      const parsedId = parseIdFromLabel(value, productOptions);
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
                    onChange={(e) => setAddItemQty(parsePositiveIntegerInput(e.target.value))}
                  />
                </FormField>
                <div className="app-form-actions app-form-actions--mobile-sticky">
                  <button className="app-button app-button-ghost w-full" onClick={() => addItem(selectedOrder.id!)}>
                    Adicionar item
                  </button>
                </div>
              </div>
            </details>
          ) : null}

          <details className="app-details">
            <summary>{selectedOrderBalance > 0 ? `Receber ${formatCurrencyBR(selectedOrderBalance)}` : 'Recebimento'}</summary>
            <div className="mt-3 grid gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                {!isOperationMode ? (
                  <button className="app-button app-button-danger" onClick={() => removeOrder(selectedOrder.id!)}>
                    Excluir pedido
                  </button>
                ) : (
                  <span className="text-sm text-neutral-500">
                    {selectedOrderBalance > 0 ? `Saldo atual: ${formatCurrencyBR(selectedOrderBalance)}` : 'Sem saldo pendente'}
                  </span>
                )}
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <FormField label="Valor" hint={`Saldo atual: ${formatCurrencyBR(selectedOrderBalance)}`}>
                  <input
                    className="app-input"
                    placeholder="0,00"
                    inputMode="decimal"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    onBlur={() => setPaymentAmount(formatMoneyInputBR(paymentAmount || '0') || '')}
                    disabled={selectedOrderIsCancelled}
                  />
                  <div className="app-inline-actions">
                    <button
                      type="button"
                      className="app-button app-button-ghost"
                      onClick={() =>
                        setPaymentAmount(formatMoneyInputBR(selectedOrderBalance) || selectedOrderBalance.toFixed(2))
                      }
                      disabled={selectedOrderIsCancelled || selectedOrderBalance <= 0}
                    >
                      Usar saldo restante
                    </button>
                  </div>
                </FormField>
                <FormField label="Metodo">
                  <select
                    className="app-select"
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    disabled={selectedOrderIsCancelled}
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
                    disabled={selectedOrderIsCancelled}
                  />
                </FormField>
                <div className="app-form-actions app-form-actions--mobile-sticky">
                  <button
                    className="app-button app-button-primary w-full disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={registerPayment}
                    disabled={selectedOrderIsCancelled}
                  >
                    Registrar pagamento
                  </button>
                </div>
              </div>

              <div className="app-form-actions">
                <button
                  className="app-button app-button-ghost disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={markOrderPaid}
                  disabled={markingPaid || selectedOrderBalance <= 0 || selectedOrderIsCancelled}
                >
                  {markingPaid ? 'Marcando...' : `Marcar pedido como pago (${formatCurrencyBR(selectedOrderBalance)})`}
                </button>
              </div>

              {selectedOrderIsCancelled ? (
                <p className="text-xs text-neutral-500">
                  Pagamentos estao bloqueados para pedidos cancelados.
                </p>
              ) : null}
              {paymentError ? <p className="text-xs text-red-600">{paymentError}</p> : null}
              {paymentFeedback ? <p className="text-xs text-emerald-700">{paymentFeedback}</p> : null}

              <details className="app-details">
                <summary>Historico de pagamentos</summary>
                <div className="mt-3 grid gap-2">
                  {selectedPayments.length === 0 ? (
                    <p className="text-sm text-neutral-500">Nenhum pagamento registrado.</p>
                  ) : (
                    selectedPayments.map((payment) => (
                      <div key={payment.id} className="rounded-lg border border-white/60 bg-white/70 px-3 py-2 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span>
                            {payment.method} •{' '}
                            <span
                              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${paymentRecordBadgeClass(payment.status || '')}`}
                            >
                              {payment.status}
                            </span>{' '}
                            • {formatCurrencyBR(payment.amount)} •{' '}
                            {payment.paidAt ? new Date(payment.paidAt).toLocaleDateString('pt-BR') : 'sem data'}
                          </span>
                          {!isOperationMode ? (
                            <button className="app-button app-button-danger" onClick={() => removePayment(payment.id!)}>
                              Remover
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </details>
            </div>
          </details>
        </div>
      ))}
      </BuilderLayoutItemSlot>

      </section>
    </BuilderLayoutProvider>
  );
}

export function OrdersWorkspaceScreen({
  screenMode = 'orders'
}: {
  screenMode?: OrdersScreenMode;
} = {}) {
  return (
    <Suspense fallback={null}>
      <OrdersPageContent screenMode={screenMode} />
    </Suspense>
  );
}

export function OrdersCalendarExperience() {
  return <OrdersWorkspaceScreen screenMode="calendar" />;
}

export default function OrdersScreen() {
  return <OrdersWorkspaceScreen screenMode="orders" />;
}
