'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Bom, Customer, Order, Payment, Product } from '@querobroapp/shared';
import { apiFetch } from '@/lib/api';
import { formatCurrencyBR } from '@/lib/format';
import styles from './page.module.css';

type ConnectionMode = 'loading' | 'online' | 'offline';
type StageState = 'done' | 'current' | 'locked';

type OrderView = Order & {
  amountPaid?: number;
  balanceDue?: number;
  paymentStatus?: 'PENDENTE' | 'PARCIAL' | 'PAGO';
};

type JourneyData = {
  products: Product[];
  customers: Customer[];
  orders: OrderView[];
  payments: Payment[];
  boms: Bom[];
};

type Stage = {
  id: string;
  code: number;
  icon: string;
  title: string;
  compact: string;
  detail: string;
  actionLabel: string;
  href: string;
  done: boolean;
};

const initialData: JourneyData = {
  products: [],
  customers: [],
  orders: [],
  payments: [],
  boms: []
};

const offlineDemoData: JourneyData = {
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

function pickMainOrder(orders: OrderView[]) {
  const sorted = [...orders].sort((a, b) => (b.id || 0) - (a.id || 0));
  return sorted.find((entry) => entry.status !== 'CANCELADO') || null;
}

function orderPaymentStatus(order: OrderView, payments: Payment[]) {
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

function orderBalance(order: OrderView) {
  if (typeof order.balanceDue === 'number') return Math.max(toMoney(order.balanceDue), 0);
  return Math.max(toMoney(order.total) - toMoney(order.amountPaid), 0);
}

export default function JornadaPage() {
  const [data, setData] = useState<JourneyData>(initialData);
  const [mode, setMode] = useState<ConnectionMode>('loading');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const [products, customers, orders, payments, boms] = await Promise.all([
        apiFetch<Product[]>('/products'),
        apiFetch<Customer[]>('/customers'),
        apiFetch<OrderView[]>('/orders'),
        apiFetch<Payment[]>('/payments'),
        apiFetch<Bom[]>('/boms')
      ]);
      setData({ products, customers, orders, payments, boms });
      setMode('online');
    } catch (loadError) {
      setData((previous) => {
        if (
          previous.products.length ||
          previous.customers.length ||
          previous.orders.length ||
          previous.payments.length ||
          previous.boms.length
        ) {
          return previous;
        }
        return offlineDemoData;
      });
      setMode('offline');
      setError(loadError instanceof Error ? loadError.message : 'Falha de conexao com a API');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load().catch(() => {
      // erro tratado no load
    });
  }, [load]);

  const customerMap = useMemo(() => new Map(data.customers.map((entry) => [entry.id!, entry])), [data.customers]);
  const mainOrder = useMemo(() => pickMainOrder(data.orders), [data.orders]);

  const orderRank = mainOrder ? statusRank[mainOrder.status || 'ABERTO'] ?? 0 : -1;
  const paymentStatus = mainOrder ? orderPaymentStatus(mainOrder, data.payments) : 'PENDENTE';
  const pendingValue = mainOrder ? orderBalance(mainOrder) : 0;
  const currentCustomer = mainOrder?.customerId
    ? customerMap.get(mainOrder.customerId)?.name || `cliente #${mainOrder.customerId}`
    : 'sem cliente';

  const hasRecipe = data.products.length > 0 && data.boms.length > 0;
  const hasOrder = Boolean(mainOrder);
  const confirmed = orderRank >= 1;
  const preparing = orderRank >= 2;
  const ready = orderRank >= 3;
  const delivered = orderRank >= 4;
  const paid = delivered && paymentStatus === 'PAGO';

  const stages: Stage[] = useMemo(
    () => [
      {
        id: 'recipe',
        code: 1,
        icon: 'R',
        title: 'Receita pronta',
        compact: 'produto + ficha',
        detail: hasRecipe ? `${data.products.length} produtos com receita.` : 'Cadastre produto e ficha tecnica.',
        actionLabel: 'Abrir receita',
        href: '/estoque?focus=bom',
        done: hasRecipe
      },
      {
        id: 'order',
        code: 2,
        icon: 'P',
        title: 'Pedido criado',
        compact: 'cliente + itens',
        detail: hasOrder ? `Pedido #${mainOrder?.id} para ${currentCustomer}.` : 'Crie o pedido principal.',
        actionLabel: 'Criar pedido',
        href: '/pedidos?focus=new_order',
        done: hasOrder
      },
      {
        id: 'confirm',
        code: 3,
        icon: 'C',
        title: 'Confirmado',
        compact: 'liberar producao',
        detail: confirmed ? 'Pedido confirmado para producao.' : 'Confirme o pedido.',
        actionLabel: 'Confirmar',
        href: '/pedidos?focus=detail',
        done: confirmed
      },
      {
        id: 'prep',
        code: 4,
        icon: 'F',
        title: 'Em preparo',
        compact: 'forno ativo',
        detail: preparing ? 'Broa em preparo.' : 'Avance para em preparo.',
        actionLabel: 'Iniciar preparo',
        href: '/pedidos?focus=detail',
        done: preparing
      },
      {
        id: 'ready',
        code: 5,
        icon: 'B',
        title: 'Pronto',
        compact: 'embalar',
        detail: ready ? 'Pronto para entrega.' : 'Marque como pronto.',
        actionLabel: 'Marcar pronto',
        href: '/pedidos?focus=detail',
        done: ready
      },
      {
        id: 'delivery',
        code: 6,
        icon: 'E',
        title: 'Entregue',
        compact: 'final da rota',
        detail: delivered ? `Entregue para ${currentCustomer}.` : 'Conclua a entrega.',
        actionLabel: 'Concluir entrega',
        href: '/pedidos?focus=detail',
        done: delivered
      },
      {
        id: 'payment',
        code: 7,
        icon: '$',
        title: 'Pago',
        compact: 'encerrar venda',
        detail: paid ? 'Venda encerrada.' : `Saldo: ${formatCurrencyBR(pendingValue)}.`,
        actionLabel: 'Registrar pagamento',
        href: '/pedidos?focus=detail',
        done: paid
      }
    ],
    [
      confirmed,
      currentCustomer,
      data.products.length,
      delivered,
      hasOrder,
      hasRecipe,
      mainOrder?.id,
      paid,
      pendingValue,
      preparing,
      ready
    ]
  );

  const currentIndex = stages.findIndex((entry) => !entry.done);
  const safeCurrentIndex = currentIndex >= 0 ? currentIndex : stages.length - 1;
  const completedCount = stages.filter((entry) => entry.done).length;
  const progressPercent = Math.round((completedCount / stages.length) * 100);

  useEffect(() => {
    if (!stages.length) return;
    if (!selectedStageId || !stages.some((entry) => entry.id === selectedStageId)) {
      setSelectedStageId(stages[safeCurrentIndex]?.id ?? stages[0].id);
    }
  }, [safeCurrentIndex, selectedStageId, stages]);

  const selectedStage = stages.find((entry) => entry.id === selectedStageId) || stages[safeCurrentIndex];
  const selectedIndex = stages.findIndex((entry) => entry.id === selectedStage?.id);
  const selectedState: StageState =
    selectedIndex < 0
      ? 'locked'
      : stages[selectedIndex].done
      ? 'done'
      : selectedIndex === safeCurrentIndex
      ? 'current'
      : 'locked';

  const openOrders = data.orders.filter((entry) => entry.status !== 'ENTREGUE' && entry.status !== 'CANCELADO').length;
  const deliveredOrders = data.orders.filter((entry) => entry.status === 'ENTREGUE').length;

  return (
    <section className={styles.screen}>
      <header className={styles.hud}>
        <div className={styles.hudMain}>
          <div className={styles.hudPhoto}>
            <Image src="/querobroa/jornada-hero.jpg" alt="Equipe Quero Broa" fill sizes="72px" />
          </div>
          <div>
            <p className={styles.hudKicker}>Jornada da broa</p>
            <h2 className={styles.hudTitle}>Do inicio ao fim, um passo por vez</h2>
          </div>
        </div>

        <div className={styles.hudMeta}>
          <span>{completedCount}/{stages.length}</span>
          <span>{openOrders} abertos</span>
          <span>{deliveredOrders} entregues</span>
          <span className={mode === 'offline' ? styles.metaWarn : ''}>
            {mode === 'online' ? 'online' : mode === 'offline' ? 'offline' : 'carregando'}
          </span>
        </div>

        <div className={styles.progress}>
          <span className={styles.progressFill} style={{ width: `${progressPercent}%` }} />
        </div>
      </header>

      <ol className={styles.map}>
        {stages.map((stage, index) => {
          const nodeState: StageState =
            stage.done ? 'done' : index === safeCurrentIndex ? 'current' : 'locked';
          const rowClass = index % 2 === 0 ? styles.rowLeft : styles.rowRight;
          const nodeClass = [
            styles.node,
            nodeState === 'done' ? styles.nodeDone : '',
            nodeState === 'current' ? styles.nodeCurrent : '',
            nodeState === 'locked' ? styles.nodeLocked : ''
          ]
            .filter(Boolean)
            .join(' ');

          const showBalloon = selectedStage?.id === stage.id;
          const balloonDirection = index % 2 === 0 ? styles.balloonRight : styles.balloonLeft;

          return (
            <li key={stage.id} className={`${styles.row} ${rowClass}`}>
              <button
                type="button"
                onClick={() => setSelectedStageId(stage.id)}
                className={nodeClass}
                aria-label={`${stage.code}. ${stage.title}`}
              >
                <span className={styles.nodeCode}>{stage.code}</span>
                <span className={styles.nodeIcon}>{stage.icon}</span>
              </button>

              <p className={styles.nodeLabel}>{stage.title}</p>

              {showBalloon ? (
                <div className={`${styles.balloon} ${balloonDirection}`}>
                  <p className={styles.balloonTitle}>{stage.title}</p>
                  <p className={styles.balloonDetail}>{stage.detail}</p>
                  <p className={styles.balloonCompact}>{stage.compact}</p>

                  <div className={styles.balloonActions}>
                    {selectedState === 'locked' ? (
                      <button type="button" className={styles.balloonButtonMuted} disabled>
                        Conclua a etapa anterior
                      </button>
                    ) : (
                      <Link href={stage.href} className={styles.balloonButton}>
                        Continuar
                      </Link>
                    )}
                    <button type="button" onClick={() => load()} className={styles.balloonButtonGhost} disabled={refreshing}>
                      {refreshing ? 'Atualizando' : 'Atualizar'}
                    </button>
                  </div>

                  {error && selectedState !== 'done' ? (
                    <details className={styles.errorBox}>
                      <summary>Detalhe tecnico</summary>
                      <p>{error}</p>
                    </details>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
