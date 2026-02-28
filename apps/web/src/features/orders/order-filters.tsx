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
    <div className="flex flex-wrap items-center gap-2">
      <input
        className="app-input"
        placeholder={isOperationMode ? 'Buscar pedido ou cliente' : 'Buscar pedido ou cliente'}
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
            <option value="TODOS">Financeiro</option>
            <option value="PENDENTE">Pendente</option>
            <option value="PARCIAL">Parcial</option>
            <option value="PAGO">Pago</option>
          </select>
        </>
      ) : null}
    </div>
  );
}
