'use client';

import type { FinancialFilter } from './orders-model';

type OrderFiltersProps = {
  isOperationMode: boolean;
  orderSearch: string;
  onOrderSearchChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  financialFilter: FinancialFilter;
  onFinancialFilterChange: (value: FinancialFilter) => void;
  orderStatuses: readonly string[];
};

export function OrderFilters({
  isOperationMode,
  orderSearch,
  onOrderSearchChange,
  statusFilter,
  onStatusFilterChange,
  financialFilter,
  onFinancialFilterChange,
  orderStatuses
}: OrderFiltersProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-xl font-semibold">Calendario de pedidos</h3>
      <div className="flex flex-wrap gap-2">
        <input
          className="app-input"
          placeholder={
            isOperationMode
              ? 'Buscar pedido ou cliente na carteira ativa'
              : 'Buscar pedido, cliente, status ou financeiro'
          }
          value={orderSearch}
          onChange={(event) => onOrderSearchChange(event.target.value)}
        />
        {!isOperationMode ? (
          <>
            <select
              className="app-select"
              value={statusFilter}
              onChange={(event) => onStatusFilterChange(event.target.value)}
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
              onChange={(event) => onFinancialFilterChange(event.target.value as FinancialFilter)}
            >
              <option value="TODOS">Financeiro: todos</option>
              <option value="PENDENTE">Financeiro: pendente</option>
              <option value="PARCIAL">Financeiro: parcial</option>
              <option value="PAGO">Financeiro: pago</option>
            </select>
          </>
        ) : null}
      </div>
    </div>
  );
}
