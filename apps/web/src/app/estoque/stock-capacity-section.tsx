'use client';

import type { KeyboardEvent } from 'react';

export type StockCapacityEntry = {
  bom: {
    id: number;
    name: string;
    product?: { name?: string | null } | null;
  } & Record<string, unknown>;
  maxUnits: number;
  hasNegativeInput: boolean;
  missingQtyDefinitions: boolean;
  limitingItemName: string;
};

type StockCapacitySectionProps = {
  capacity: StockCapacityEntry[];
  bomCostByBomId: Map<number, number>;
  selectedBomId: number | null;
  onSelectBom: (bom: StockCapacityEntry['bom']) => void;
  onCardKeyDown: (event: KeyboardEvent<HTMLDivElement>, action: () => void) => void;
};

export function StockCapacitySection({
  capacity,
  bomCostByBomId,
  selectedBomId,
  onSelectBom,
  onCardKeyDown
}: StockCapacitySectionProps) {
  return (
    <details className="app-details">
      <summary>4. Capacidade de producao</summary>
      <div className="app-panel mt-3 grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-xl font-semibold">Capacidade por produto</h3>
          <p className="text-sm text-neutral-500">
            Quantas caixas sao possiveis agora e qual insumo esta limitando
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {capacity.map((entry) => {
            const isExpanded = selectedBomId === entry.bom.id;
            return (
              <div
                key={entry.bom.id}
                className={`app-panel app-panel--interactive app-panel--expandable ${
                  isExpanded ? 'app-panel--expanded' : ''
                } ${entry.hasNegativeInput || entry.missingQtyDefinitions ? 'stock-capacity-card--warning' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => onSelectBom(entry.bom)}
                onKeyDown={(event) => onCardKeyDown(event, () => onSelectBom(entry.bom))}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      <p className="truncate font-semibold">{entry.bom.name}</p>
                      <span className="app-panel__chevron" aria-hidden="true" />
                    </div>
                    <p className="mt-1 text-sm text-neutral-500">
                      Produto: {entry.bom.product?.name || 'Produto'}
                    </p>
                  </div>
                  <span className="rounded-full border border-white/80 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-700">
                    {entry.maxUnits} cx
                  </span>
                </div>

                <div className="app-panel__expand" aria-hidden={!isExpanded}>
                  <div className="app-panel__expand-inner">
                    <div className="app-panel__expand-surface grid gap-2 text-sm text-neutral-600">
                      {entry.limitingItemName ? <p>Gargalo: {entry.limitingItemName}</p> : null}
                      {entry.hasNegativeInput ? (
                        <p className="font-semibold text-rose-700">
                          Saldo negativo impactando a capacidade.
                        </p>
                      ) : null}
                      {entry.missingQtyDefinitions ? (
                        <p className="font-semibold text-amber-700">
                          BOM sem quantidades suficientes para calcular capacidade.
                        </p>
                      ) : null}
                      <p>Custo por caixa: R$ {(bomCostByBomId.get(entry.bom.id) ?? 0).toFixed(2)}</p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {capacity.length === 0 ? (
            <div className="app-panel border-dashed text-sm text-neutral-500">Nenhuma BOM cadastrada.</div>
          ) : null}
        </div>
      </div>
    </details>
  );
}
