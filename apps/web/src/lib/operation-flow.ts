import {
  normalizeOrderStatus,
  resolveDisplayNumber,
  roundMoney,
  type Bom,
  type Customer,
  type Order,
  type Payment,
  type Product
} from '@querobroapp/shared';
import { formatCurrencyBR } from '@/lib/format';

export type OperationFlowRaw = {
  products: Product[];
  customers: Customer[];
  orders: Order[];
  payments: Payment[];
  boms: Bom[];
};

export type FlowConnectionMode = 'loading' | 'online' | 'offline';
export type FlowStepState = 'done' | 'current' | 'locked';

export type FlowStep = {
  key: 'catalog' | 'customer' | 'order' | 'ready' | 'deliver' | 'pay';
  index: number;
  icon: string;
  title: string;
  compact: string;
  question: string;
  detail: string;
  actionLabel: string;
  href: string;
  statusLabel: string;
  done: boolean;
  state: FlowStepState;
};

export type OperationFlow = {
  steps: FlowStep[];
  currentStep: FlowStep;
  nextStep: FlowStep | null;
  progressPercent: number;
  metrics: {
    products: number;
    customers: number;
    openOrders: number;
    deliveredOrders: number;
    pendingValue: number;
  };
};

export const EMPTY_FLOW_RAW: OperationFlowRaw = {
  products: [],
  customers: [],
  orders: [],
  payments: [],
  boms: []
};

export const OFFLINE_FALLBACK_FLOW_RAW: OperationFlowRaw = {
  products: [
    {
      id: 1,
      name: 'Broa classica',
      price: 12.5,
      active: true,
      salesLimitEnabled: false,
      salesLimitExhausted: false
    }
  ],
  customers: [{ id: 1, name: 'Cliente demo' }],
  orders: [
    {
      id: 1,
      customerId: 1,
      fulfillmentMode: 'DELIVERY',
      status: 'PRONTO',
      total: 80,
      amountPaid: 40,
      balanceDue: 40,
      paymentStatus: 'PARCIAL'
    }
  ],
  payments: [{ id: 1, orderId: 1, amount: 40, method: 'pix', status: 'PAGO' }],
  boms: [{ id: 1, productId: 1, name: 'Receita base da broa' }]
};

const statusRank: Record<string, number> = {
  ABERTO: 0,
  PRONTO: 1,
  ENTREGUE: 2,
  CANCELADO: -1
};

function toMoney(value: number | null | undefined) {
  return roundMoney(value || 0);
}

function pickMainOrder(orders: Order[]) {
  const sorted = [...orders].sort(
    (a, b) => (resolveDisplayNumber(b) ?? b.id ?? 0) - (resolveDisplayNumber(a) ?? a.id ?? 0)
  );
  return sorted.find((entry) => normalizeOrderStatus(entry.status) !== 'CANCELADO') || null;
}

function hasAnyData(raw: OperationFlowRaw) {
  return (
    raw.products.length > 0 ||
    raw.customers.length > 0 ||
    raw.orders.length > 0 ||
    raw.payments.length > 0 ||
    raw.boms.length > 0
  );
}

export function resolveFlowFallback(previous: OperationFlowRaw) {
  return hasAnyData(previous) ? previous : OFFLINE_FALLBACK_FLOW_RAW;
}

function resolveOrderPaymentStatus(order: Order, payments: Payment[]) {
  if (
    order.paymentStatus === 'PENDENTE' ||
    order.paymentStatus === 'PARCIAL' ||
    order.paymentStatus === 'PAGO'
  ) {
    return order.paymentStatus;
  }

  const paid = toMoney(
    (order.amountPaid ?? 0) +
      payments.reduce((sum, payment) => {
        if (payment.orderId !== order.id) return sum;
        const isPaid = payment.status === 'PAGO' || Boolean(payment.paidAt);
        return isPaid ? sum + (payment.amount || 0) : sum;
      }, 0)
  );
  const total = toMoney(order.total);
  if (paid <= 0) return 'PENDENTE';
  if (paid + 0.00001 >= total) return 'PAGO';
  return 'PARCIAL';
}

function resolveOrderBalance(order: Order, payments: Payment[]) {
  if (typeof order.balanceDue === 'number') return Math.max(toMoney(order.balanceDue), 0);
  const paid = toMoney(
    (order.amountPaid ?? 0) +
      payments.reduce((sum, payment) => {
        if (payment.orderId !== order.id) return sum;
        const isPaid = payment.status === 'PAGO' || Boolean(payment.paidAt);
        return isPaid ? sum + (payment.amount || 0) : sum;
      }, 0)
  );
  return Math.max(toMoney(order.total) - paid, 0);
}

export function deriveOperationFlow(raw: OperationFlowRaw): OperationFlow {
  const currentOrder = pickMainOrder(raw.orders);
  const normalizedOrderStatus = normalizeOrderStatus(currentOrder?.status) || 'ABERTO';
  const orderRank = currentOrder ? statusRank[normalizedOrderStatus] ?? 0 : -1;
  const paymentStatus = currentOrder ? resolveOrderPaymentStatus(currentOrder, raw.payments) : 'PENDENTE';
  const pendingCurrentOrder = currentOrder ? resolveOrderBalance(currentOrder, raw.payments) : 0;
  const currentCustomer = currentOrder?.customerId
    ? raw.customers.find((entry) => entry.id === currentOrder.customerId) || null
    : null;
  const currentCustomerName = currentCustomer?.name
    ? currentCustomer.name
    : currentOrder?.customerId
      ? `cliente #${resolveDisplayNumber(currentCustomer) ?? currentOrder.customerId}`
      : 'sem cliente';
  const currentOrderNumber = resolveDisplayNumber(currentOrder) ?? currentOrder?.id ?? null;

  const hasProducts = raw.products.length > 0;
  const hasBom = raw.boms.length > 0;
  const hasCatalog = hasProducts && hasBom;
  const hasCustomer = raw.customers.length > 0;
  const hasOrder = Boolean(currentOrder);
  const isReady = orderRank >= 1;
  const isDelivered = orderRank >= 2;
  const isPaid = isDelivered && paymentStatus === 'PAGO';

  const catalogAction = !hasProducts
    ? { label: 'Abrir base', href: '/base' }
    : !hasBom
    ? { label: 'Abrir produção', href: '/producao' }
    : { label: 'Revisar base', href: '/base' };

  const baseSteps: Omit<FlowStep, 'state'>[] = [
    {
      key: 'catalog',
      index: 1,
      icon: 'R',
      title: 'Base pronta',
      compact: 'broa + receita',
      question: 'A base da broa já está pronta para operar?',
      detail: hasCatalog
        ? `${raw.products.length} broas com receita base ativa.`
        : 'Cadastre a broa e a receita antes de começar o dia.',
      actionLabel: catalogAction.label,
      href: catalogAction.href,
      statusLabel: hasCatalog ? 'OK' : !hasProducts ? 'broa' : 'receita',
      done: hasCatalog
    },
    {
      key: 'customer',
      index: 2,
      icon: 'U',
      title: 'Cliente pronto',
      compact: 'base de venda',
      question: 'A base de clientes já cobre o dia?',
      detail: hasCustomer ? `${raw.customers.length} clientes cadastrados.` : 'Cadastre o primeiro cliente.',
      actionLabel: hasCustomer ? 'Abrir base' : 'Criar cliente',
      href: '/base',
      statusLabel: hasCustomer ? 'OK' : 'faltando',
      done: hasCustomer
    },
    {
      key: 'order',
      index: 3,
      icon: 'P',
      title: 'Compromisso criado',
      compact: 'venda do dia',
      question: 'O compromisso principal do dia já entrou?',
      detail: hasOrder
        ? `Pedido #${currentOrderNumber ?? '-'} para ${currentCustomerName}.`
        : 'Crie o primeiro compromisso.',
      actionLabel: hasOrder ? 'Abrir hoje' : 'Criar compromisso',
      href: '/hoje',
      statusLabel: hasOrder ? 'OK' : 'faltando',
      done: hasOrder
    },
    {
      key: 'ready',
      index: 4,
      icon: 'P',
      title: 'Pedido pronto',
      compact: 'sacola pronta',
      question: 'O pedido principal já está pronto para sair?',
      detail: isReady ? 'Pedido principal pronto para retirada ou entrega.' : 'Avance o pedido para pronto.',
      actionLabel: 'Revisar hoje',
      href: '/hoje',
      statusLabel: isReady ? 'OK' : 'aguardando',
      done: isReady
    },
    {
      key: 'deliver',
      index: 5,
      icon: 'E',
      title: 'Saída concluída',
      compact: 'retirada ou entrega',
      question: 'A saída principal já foi concluída?',
      detail: isDelivered ? `Entregue para ${currentCustomerName}.` : 'Conclua a saída do pedido.',
      actionLabel: 'Abrir saídas',
      href: '/saidas',
      statusLabel: isDelivered ? 'OK' : 'aguardando',
      done: isDelivered
    },
    {
      key: 'pay',
      index: 6,
      icon: '$',
      title: 'Caixa fechado',
      compact: 'venda encerrada',
      question: 'O dinheiro do dia já entrou?',
      detail: isPaid ? 'Venda encerrada com pagamento confirmado.' : `Saldo restante ${formatCurrencyBR(pendingCurrentOrder)}.`,
      actionLabel: 'Abrir caixa',
      href: '/caixa',
      statusLabel: isPaid ? 'OK' : 'saldo',
      done: isPaid
    }
  ];

  const firstPending = baseSteps.findIndex((entry) => !entry.done);
  const currentIndex = firstPending >= 0 ? firstPending : baseSteps.length - 1;

  const steps: FlowStep[] = baseSteps.map((entry, index) => ({
    ...entry,
    state: entry.done ? 'done' : index === currentIndex ? 'current' : 'locked'
  }));

  const currentStep = steps[currentIndex];
  const nextStep = steps.find((entry) => !entry.done) || null;

  const pendingValue = raw.orders.reduce((sum, order) => {
    if (normalizeOrderStatus(order.status) === 'CANCELADO') return sum;
    return sum + resolveOrderBalance(order, raw.payments);
  }, 0);

  const openOrders = raw.orders.filter(
    (entry) => {
      const normalizedStatus = normalizeOrderStatus(entry.status);
      return normalizedStatus !== 'ENTREGUE' && normalizedStatus !== 'CANCELADO';
    }
  ).length;
  const deliveredOrders = raw.orders.filter(
    (entry) => normalizeOrderStatus(entry.status) === 'ENTREGUE'
  ).length;

  return {
    steps,
    currentStep,
    nextStep,
    progressPercent: Math.round((steps.filter((entry) => entry.done).length / steps.length) * 100),
    metrics: {
      products: raw.products.length,
      customers: raw.customers.length,
      openOrders,
      deliveredOrders,
      pendingValue: toMoney(pendingValue)
    }
  };
}
