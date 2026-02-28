'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import type { Order, Payment } from '@querobroapp/shared';
import { useOperationFlow } from '@/hooks/use-operation-flow';
import { formatCurrencyBR } from '@/lib/format';

export type DayOpsMode = 'today' | 'production' | 'dispatch' | 'cash' | 'base';

type DayOpsViewProps = {
  mode: DayOpsMode;
};

function toMoney(value: number | null | undefined) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(((value || 0) + Number.EPSILON) * 100) / 100;
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

function statusBadgeClass(status: string) {
  if (status === 'ENTREGUE') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (status === 'PRONTO') return 'border-sky-200 bg-sky-50 text-sky-800';
  if (status === 'EM_PREPARACAO') return 'border-amber-200 bg-amber-50 text-amber-800';
  if (status === 'CONFIRMADO') return 'border-orange-200 bg-orange-50 text-orange-800';
  if (status === 'CANCELADO') return 'border-rose-200 bg-rose-50 text-rose-800';
  return 'border-stone-200 bg-stone-50 text-stone-700';
}

function statusLabel(status: string) {
  if (status === 'ABERTO') return 'aguardando';
  if (status === 'CONFIRMADO') return 'liberado';
  if (status === 'EM_PREPARACAO') return 'produzindo';
  if (status === 'PRONTO') return 'pronto';
  if (status === 'ENTREGUE') return 'entregue';
  if (status === 'CANCELADO') return 'cancelado';
  return status.toLowerCase();
}

function formatDateLabel(value?: string | null) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function DayOpsView({ mode }: DayOpsViewProps) {
  const { raw, flow, mode: connectionMode, error } = useOperationFlow();

  const customerMap = useMemo(
    () => new Map(raw.customers.map((customer) => [customer.id, customer.name || `Cliente #${customer.id}`])),
    [raw.customers]
  );

  const liveOrders = useMemo(
    () => raw.orders.filter((order) => order.status !== 'CANCELADO'),
    [raw.orders]
  );

  const productionQueue = useMemo(
    () =>
      liveOrders.filter(
        (order) =>
          order.status === 'ABERTO' ||
          order.status === 'CONFIRMADO' ||
          order.status === 'EM_PREPARACAO'
      ),
    [liveOrders]
  );

  const readyToShip = useMemo(
    () => liveOrders.filter((order) => order.status === 'PRONTO'),
    [liveOrders]
  );

  const receivables = useMemo(
    () =>
      liveOrders
        .map((order) => ({
          order,
          balance: resolveOrderBalance(order, raw.payments)
        }))
        .filter((entry) => entry.balance > 0.00001),
    [liveOrders, raw.payments]
  );

  const todayCards = (
    <>
      <section className="grid gap-3 md:grid-cols-3">
        <div className="rounded-3xl border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">Agora</p>
          <p className="mt-2 text-lg font-semibold text-neutral-950">{flow.currentStep.title}</p>
          <p className="mt-1 text-sm text-neutral-600">{flow.currentStep.detail}</p>
          <Link href={flow.currentStep.href} className="app-button app-button-primary mt-3 inline-flex">
            {flow.currentStep.actionLabel}
          </Link>
        </div>
        <div className="rounded-3xl border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">Fila do dia</p>
          <p className="mt-2 text-lg font-semibold text-neutral-950">{flow.metrics.openOrders} compromissos abertos</p>
          <p className="mt-1 text-sm text-neutral-600">
            {readyToShip.length} prontos para sair • {flow.metrics.deliveredOrders} concluidos
          </p>
        </div>
        <div className="rounded-3xl border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">Caixa do dia</p>
          <p className="mt-2 text-lg font-semibold text-neutral-950">{formatCurrencyBR(flow.metrics.pendingValue)}</p>
          <p className="mt-1 text-sm text-neutral-600">Em aberto para receber.</p>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <Link href="/producao" className="rounded-3xl border border-neutral-200 bg-white p-4 transition hover:border-neutral-300">
          <p className="text-sm font-semibold text-neutral-950">Produzir</p>
          <p className="mt-1 text-sm text-neutral-600">
            {productionQueue.length} compromissos ainda pedem preparo.
          </p>
        </Link>
        <Link href="/saidas" className="rounded-3xl border border-neutral-200 bg-white p-4 transition hover:border-neutral-300">
          <p className="text-sm font-semibold text-neutral-950">Separar e sair</p>
          <p className="mt-1 text-sm text-neutral-600">
            {readyToShip.length} pedidos ja podem ser entregues ou retirados.
          </p>
        </Link>
        <Link href="/caixa" className="rounded-3xl border border-neutral-200 bg-white p-4 transition hover:border-neutral-300">
          <p className="text-sm font-semibold text-neutral-950">Fechar caixa</p>
          <p className="mt-1 text-sm text-neutral-600">
            {receivables.length} pedidos ainda tem saldo pendente.
          </p>
        </Link>
      </section>

      <section className="rounded-3xl border border-neutral-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-neutral-950">Compromissos que puxam o dia</p>
            <p className="text-sm text-neutral-600">Comece por aqui. O restante da operacao acompanha esta fila.</p>
          </div>
          <Link href="/pedidos" className="app-button app-button-ghost">
            Abrir detalhes
          </Link>
        </div>
        <div className="mt-3 grid gap-3">
          {liveOrders.slice(0, 6).map((order) => (
            <div key={order.id} className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-neutral-950">
                  Pedido #{order.id} • {customerMap.get(order.customerId) || `Cliente #${order.customerId}`}
                </p>
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${statusBadgeClass(order.status || '')}`}
                >
                  {statusLabel(order.status || '')}
                </span>
              </div>
              <p className="mt-1 text-sm text-neutral-600">
                {formatDateLabel(order.scheduledAt || order.createdAt) || 'Sem horario definido'} • total{' '}
                {formatCurrencyBR(order.total ?? 0)}
              </p>
            </div>
          ))}
          {liveOrders.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 p-4 text-sm text-neutral-600">
              Nenhum compromisso ativo. O dia esta livre para novos pedidos.
            </p>
          ) : null}
        </div>
      </section>
    </>
  );

  const productionCards = (
    <>
      <section className="grid gap-3 md:grid-cols-3">
        <div className="rounded-3xl border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">A produzir</p>
          <p className="mt-2 text-lg font-semibold text-neutral-950">{productionQueue.length} compromissos</p>
          <p className="mt-1 text-sm text-neutral-600">Pedidos ainda nao chegaram a pronto.</p>
        </div>
        <div className="rounded-3xl border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">Receitas ativas</p>
          <p className="mt-2 text-lg font-semibold text-neutral-950">{raw.boms.length}</p>
          <p className="mt-1 text-sm text-neutral-600">Bases de preparo cadastradas.</p>
        </div>
        <div className="rounded-3xl border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">Pronto agora</p>
          <p className="mt-2 text-lg font-semibold text-neutral-950">{readyToShip.length} pedidos</p>
          <p className="mt-1 text-sm text-neutral-600">Ja podem seguir para separacao e saida.</p>
        </div>
      </section>

      <section className="rounded-3xl border border-neutral-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-neutral-950">Roteiro operacional</p>
            <p className="text-sm text-neutral-600">Planejar, comprar, produzir e conferir continuam no detalhe.</p>
          </div>
          <Link href="/estoque?focus=ops" className="app-button app-button-primary">
            Abrir operacao
          </Link>
        </div>
        <div className="mt-3 grid gap-3">
          {productionQueue.slice(0, 8).map((order) => (
            <div key={order.id} className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3">
              <p className="text-sm font-semibold text-neutral-950">
                Pedido #{order.id} • {customerMap.get(order.customerId) || `Cliente #${order.customerId}`}
              </p>
              <p className="mt-1 text-sm text-neutral-600">
                Status {statusLabel(order.status || '')} • {formatCurrencyBR(order.total ?? 0)}
              </p>
            </div>
          ))}
          {productionQueue.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 p-4 text-sm text-neutral-600">
              Nenhum pedido aguardando producao agora.
            </p>
          ) : null}
        </div>
      </section>
    </>
  );

  const dispatchCards = (
    <>
      <section className="grid gap-3 md:grid-cols-2">
        <div className="rounded-3xl border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">Prontos para sair</p>
          <p className="mt-2 text-lg font-semibold text-neutral-950">{readyToShip.length} pedidos</p>
          <p className="mt-1 text-sm text-neutral-600">Retirada, entrega propria ou parceiro.</p>
        </div>
        <div className="rounded-3xl border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">Ja concluidos</p>
          <p className="mt-2 text-lg font-semibold text-neutral-950">{flow.metrics.deliveredOrders} pedidos</p>
          <p className="mt-1 text-sm text-neutral-600">Saidas ja marcadas como entregues.</p>
        </div>
      </section>

      <section className="rounded-3xl border border-neutral-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-neutral-950">Fila de saida</p>
            <p className="text-sm text-neutral-600">A Uber e outras integracoes ficam como adaptadores, nao como fluxo principal.</p>
          </div>
          <Link href="/pedidos?focus=detail" className="app-button app-button-primary">
            Despachar pedidos
          </Link>
        </div>
        <div className="mt-3 grid gap-3">
          {readyToShip.map((order) => (
            <div key={order.id} className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3">
              <p className="text-sm font-semibold text-neutral-950">
                Pedido #{order.id} • {customerMap.get(order.customerId) || `Cliente #${order.customerId}`}
              </p>
              <p className="mt-1 text-sm text-neutral-600">
                {formatDateLabel(order.scheduledAt || order.createdAt) || 'Sem horario definido'} • total{' '}
                {formatCurrencyBR(order.total ?? 0)}
              </p>
            </div>
          ))}
          {readyToShip.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 p-4 text-sm text-neutral-600">
              Nenhum pedido pronto para sair agora.
            </p>
          ) : null}
        </div>
      </section>
    </>
  );

  const cashCards = (
    <>
      <section className="grid gap-3 md:grid-cols-2">
        <div className="rounded-3xl border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">A receber</p>
          <p className="mt-2 text-lg font-semibold text-neutral-950">{formatCurrencyBR(flow.metrics.pendingValue)}</p>
          <p className="mt-1 text-sm text-neutral-600">Saldo total ainda aberto.</p>
        </div>
        <div className="rounded-3xl border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">Pendencias</p>
          <p className="mt-2 text-lg font-semibold text-neutral-950">{receivables.length} pedidos</p>
          <p className="mt-1 text-sm text-neutral-600">Concluir o caixa e fechar o dia.</p>
        </div>
      </section>

      <section className="rounded-3xl border border-neutral-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-neutral-950">Pedidos com saldo</p>
            <p className="text-sm text-neutral-600">O caixa deixa de ser um modulo separado: ele fecha a venda.</p>
          </div>
          <Link href="/pedidos?focus=detail" className="app-button app-button-primary">
            Registrar pagamentos
          </Link>
        </div>
        <div className="mt-3 grid gap-3">
          {receivables.map(({ order, balance }) => (
            <div key={order.id} className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3">
              <p className="text-sm font-semibold text-neutral-950">
                Pedido #{order.id} • {customerMap.get(order.customerId) || `Cliente #${order.customerId}`}
              </p>
              <p className="mt-1 text-sm text-neutral-600">
                Falta receber {formatCurrencyBR(balance)} de {formatCurrencyBR(order.total ?? 0)}
              </p>
            </div>
          ))}
          {receivables.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 p-4 text-sm text-neutral-600">
              Sem pendencias financeiras neste momento.
            </p>
          ) : null}
        </div>
      </section>
    </>
  );

  const baseCards = (
    <>
      <section className="grid gap-3 md:grid-cols-3">
        <div className="rounded-3xl border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">Clientes</p>
          <p className="mt-2 text-lg font-semibold text-neutral-950">{raw.customers.length}</p>
          <p className="mt-1 text-sm text-neutral-600">Base de entrega e contato.</p>
        </div>
        <div className="rounded-3xl border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">Produtos</p>
          <p className="mt-2 text-lg font-semibold text-neutral-950">{raw.products.length}</p>
          <p className="mt-1 text-sm text-neutral-600">Tipos de broa e preco.</p>
        </div>
        <div className="rounded-3xl border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">Receitas</p>
          <p className="mt-2 text-lg font-semibold text-neutral-950">{raw.boms.length}</p>
          <p className="mt-1 text-sm text-neutral-600">Fichas tecnicas da producao.</p>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        <Link href="/clientes?focus=form" className="rounded-3xl border border-neutral-200 bg-white p-4 transition hover:border-neutral-300">
          <p className="text-sm font-semibold text-neutral-950">Editar clientes</p>
          <p className="mt-1 text-sm text-neutral-600">Cadastro enxuto para quem compra e recebe.</p>
        </Link>
        <Link href="/produtos?focus=form" className="rounded-3xl border border-neutral-200 bg-white p-4 transition hover:border-neutral-300">
          <p className="text-sm font-semibold text-neutral-950">Editar produtos</p>
          <p className="mt-1 text-sm text-neutral-600">Catalogo de broas e preco base.</p>
        </Link>
      </section>
    </>
  );

  return (
    <div className="grid gap-4">
      <section className="rounded-3xl border border-neutral-200 bg-neutral-50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-neutral-950">Operacao do dia</p>
            <p className="text-sm text-neutral-600">
              {connectionMode === 'online'
                ? 'Dados carregados da operacao real.'
                : 'Modo offline de seguranca ativo. O app continua utilizavel.'}
            </p>
          </div>
          <div className="text-right text-sm text-neutral-600">
            <p>{raw.orders.length} pedidos totais</p>
            <p>{raw.payments.length} registros de pagamento</p>
          </div>
        </div>
        {error ? (
          <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {error}
          </p>
        ) : null}
      </section>

      {mode === 'today' ? todayCards : null}
      {mode === 'production' ? productionCards : null}
      {mode === 'dispatch' ? dispatchCards : null}
      {mode === 'cash' ? cashCards : null}
      {mode === 'base' ? baseCards : null}
    </div>
  );
}
