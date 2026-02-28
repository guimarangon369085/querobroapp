'use client';

import Link from 'next/link';
import type { Product } from '@querobroapp/shared';
import { FormField } from '@/components/form/FormField';
import type { OrderView } from '@/features/orders/orders-model';
import { formatCurrencyBR } from '@/lib/format';

type CalendarOrderDetailPanelProps = {
  selectedOrder: OrderView;
  customerName: string;
  selectedOrderDateLabel: string;
  selectedOrderScheduledAt: string;
  savingOrderSchedule: boolean;
  productMap: Map<number, Product>;
  orderStatusBadgeClass: (status: string) => string;
  onSelectedOrderScheduledAtChange: (value: string) => void;
  onSaveSelectedOrderSchedule: () => void;
};

export function CalendarOrderDetailPanel({
  selectedOrder,
  customerName,
  selectedOrderDateLabel,
  selectedOrderScheduledAt,
  savingOrderSchedule,
  productMap,
  orderStatusBadgeClass,
  onSelectedOrderScheduledAtChange,
  onSaveSelectedOrderSchedule
}: CalendarOrderDetailPanelProps) {
  return (
    <div className="app-panel grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-semibold">Pedido #{selectedOrder.id}</h3>
          <p className="text-sm text-neutral-500">
            {customerName} •{' '}
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${orderStatusBadgeClass(selectedOrder.status || '')}`}
            >
              {selectedOrder.status}
            </span>
          </p>
        </div>
        <Link className="app-button app-button-ghost" href="/pedidos">
          Abrir gestao completa
        </Link>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-white/60 bg-white/70 px-3 py-3 text-sm text-neutral-600">
          <p className="font-semibold text-neutral-900">Resumo</p>
          <p className="mt-1">Horario atual: {selectedOrderDateLabel || 'Sem horario'}</p>
          <p className="mt-1">Total: {formatCurrencyBR(selectedOrder.total ?? 0)}</p>
          <p className="mt-1">
            Itens: {(selectedOrder.items || []).reduce((sum, item) => sum + item.quantity, 0)}
          </p>
        </div>
        <FormField
          label="Reagendar pedido"
          hint="Este horario alimenta o calendario e a previsao de producao."
        >
          <input
            className="app-input"
            type="datetime-local"
            value={selectedOrderScheduledAt}
            onChange={(e) => onSelectedOrderScheduledAtChange(e.target.value)}
          />
        </FormField>
      </div>

      <div className="app-form-actions app-form-actions--mobile-sticky">
        <button
          className="app-button app-button-primary disabled:cursor-not-allowed disabled:opacity-60"
          type="button"
          onClick={onSaveSelectedOrderSchedule}
          disabled={savingOrderSchedule}
        >
          {savingOrderSchedule ? 'Salvando...' : 'Salvar horario'}
        </button>
      </div>

      <div className="grid gap-2">
        {(selectedOrder.items || []).map((item) => (
          <div
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/60 bg-white/70 px-3 py-2"
          >
            <p className="text-sm text-neutral-700">
              {productMap.get(item.productId)?.name ?? `Produto ${item.productId}`} x {item.quantity}
            </p>
            <span className="text-xs text-neutral-500">{formatCurrencyBR(item.total ?? 0)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
