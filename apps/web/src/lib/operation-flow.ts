import type { Bom, Customer, Order, Payment, Product } from '@querobroapp/shared';
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
  key: 'catalog' | 'customer' | 'order' | 'confirm' | 'prepare' | 'deliver' | 'pay';
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
  products: [{ id: 1, name: 'Broa classica', price: 12.5, active: true }],
  customers: [{ id: 1, name: 'Cliente demo' }],
  orders: [
    {
      id: 1,
      customerId: 1,
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
  CONFIRMADO: 1,
  EM_PREPARACAO: 2,
  PRONTO: 3,
  ENTREGUE: 4,
  CANCELADO: -1
};

function toMoney(value: number | null | undefined) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(((value || 0) + Number.EPSILON) * 100) / 100;
}

function pickMainOrder(orders: Order[]) {
  const sorted = [...orders].sort((a, b) => (b.id || 0) - (a.id || 0));
  return sorted.find((entry) => entry.status !== 'CANCELADO') || null;
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
  const orderRank = currentOrder ? statusRank[currentOrder.status || 'ABERTO'] ?? 0 : -1;
  const paymentStatus = currentOrder ? resolveOrderPaymentStatus(currentOrder, raw.payments) : 'PENDENTE';
  const pendingCurrentOrder = currentOrder ? resolveOrderBalance(currentOrder, raw.payments) : 0;
  const currentCustomerName = currentOrder?.customerId
    ? raw.customers.find((entry) => entry.id === currentOrder.customerId)?.name ||
      `cliente #${currentOrder.customerId}`
    : 'sem cliente';

  const hasProducts = raw.products.length > 0;
  const hasBom = raw.boms.length > 0;
  const hasCatalog = hasProducts && hasBom;
  const hasCustomer = raw.customers.length > 0;
  const hasOrder = Boolean(currentOrder);
  const isConfirmed = orderRank >= 1;
  const isPrepared = orderRank >= 3;
  const isDelivered = orderRank >= 4;
  const isPaid = isDelivered && paymentStatus === 'PAGO';

  const preparedDetail = orderRank >= 2 ? 'Producao iniciada. Avance ate pronto.' : 'Inicie o preparo.';

  const catalogAction = !hasProducts
    ? { label: 'Cadastrar produto', href: '/produtos?focus=form' }
    : !hasBom
    ? { label: 'Criar ficha', href: '/estoque?focus=bom' }
    : { label: 'Revisar catalogo', href: '/produtos' };

  const baseSteps: Omit<FlowStep, 'state'>[] = [
    {
      key: 'catalog',
      index: 1,
      icon: 'R',
      title: 'Receita pronta',
      compact: 'produto + ficha',
      question: 'Produto e ficha tecnica ja estao definidos?',
      detail: hasCatalog
        ? `${raw.products.length} produtos com ficha tecnica.`
        : 'Cadastre produto e ficha tecnica da broa.',
      actionLabel: catalogAction.label,
      href: catalogAction.href,
      statusLabel: hasCatalog ? 'OK' : !hasProducts ? 'produto' : 'ficha',
      done: hasCatalog
    },
    {
      key: 'customer',
      index: 2,
      icon: 'U',
      title: 'Cliente pronto',
      compact: 'cadastro',
      question: 'O cliente ja esta cadastrado?',
      detail: hasCustomer ? `${raw.customers.length} clientes cadastrados.` : 'Cadastre o cliente do pedido.',
      actionLabel: hasCustomer ? 'Revisar cliente' : 'Cadastrar cliente',
      href: hasCustomer ? '/clientes' : '/clientes?focus=form',
      statusLabel: hasCustomer ? 'OK' : 'faltando',
      done: hasCustomer
    },
    {
      key: 'order',
      index: 3,
      icon: 'P',
      title: 'Pedido criado',
      compact: 'cliente + itens',
      question: 'O pedido principal ja foi criado?',
      detail: hasOrder ? `Pedido #${currentOrder?.id} para ${currentCustomerName}.` : 'Crie o pedido principal.',
      actionLabel: hasOrder ? 'Abrir pedido' : 'Criar pedido',
      href: hasOrder ? '/pedidos?focus=detail' : '/pedidos?focus=new_order',
      statusLabel: hasOrder ? 'OK' : 'faltando',
      done: hasOrder
    },
    {
      key: 'confirm',
      index: 4,
      icon: 'C',
      title: 'Pedido confirmado',
      compact: 'liberar producao',
      question: 'Pode liberar a producao?',
      detail: isConfirmed ? 'Pedido confirmado.' : 'Confirme o pedido.',
      actionLabel: 'Confirmar pedido',
      href: '/pedidos?focus=detail',
      statusLabel: isConfirmed ? 'OK' : 'aguardando',
      done: isConfirmed
    },
    {
      key: 'prepare',
      index: 5,
      icon: 'F',
      title: 'Producao pronta',
      compact: 'forno e acabamento',
      question: 'A broa ja esta pronta para entrega?',
      detail: isPrepared ? 'Pedido pronto para entrega.' : preparedDetail,
      actionLabel: 'Atualizar preparo',
      href: '/pedidos?focus=detail',
      statusLabel: isPrepared ? 'OK' : 'aguardando',
      done: isPrepared
    },
    {
      key: 'deliver',
      index: 6,
      icon: 'E',
      title: 'Entrega concluida',
      compact: 'rota finalizada',
      question: 'A entrega foi concluida?',
      detail: isDelivered ? `Entregue para ${currentCustomerName}.` : 'Conclua a entrega.',
      actionLabel: 'Concluir entrega',
      href: '/pedidos?focus=detail',
      statusLabel: isDelivered ? 'OK' : 'aguardando',
      done: isDelivered
    },
    {
      key: 'pay',
      index: 7,
      icon: '$',
      title: 'Pagamento fechado',
      compact: 'venda encerrada',
      question: 'O pagamento final ja entrou?',
      detail: isPaid ? 'Venda encerrada com pagamento confirmado.' : `Saldo restante ${formatCurrencyBR(pendingCurrentOrder)}.`,
      actionLabel: 'Registrar pagamento',
      href: '/pedidos?focus=detail',
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
    if (order.status === 'CANCELADO') return sum;
    return sum + resolveOrderBalance(order, raw.payments);
  }, 0);

  const openOrders = raw.orders.filter(
    (entry) => entry.status !== 'ENTREGUE' && entry.status !== 'CANCELADO'
  ).length;
  const deliveredOrders = raw.orders.filter((entry) => entry.status === 'ENTREGUE').length;

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
