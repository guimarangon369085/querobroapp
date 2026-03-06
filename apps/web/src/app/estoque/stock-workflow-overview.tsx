'use client';

export type StockWorkflowStep = {
  id: 'plan' | 'buy' | 'produce' | 'check';
  title: string;
  summary: string;
  detail: string;
  toneClass: string;
  actionLabel: string;
};

export type StockWorkflowOverviewKpis = {
  totalItems: number;
  ingredients: number;
  packaging: number;
};

type StockWorkflowOverviewProps = {
  steps: StockWorkflowStep[];
  inventoryKpis: StockWorkflowOverviewKpis;
  onStepAction: (stepId: StockWorkflowStep['id']) => void;
};

export function StockWorkflowOverview({
  steps,
  inventoryKpis,
  onStepAction
}: StockWorkflowOverviewProps) {
  return (
    <>
      <div className="grid gap-3 lg:grid-cols-4">
        {steps.map((step) => (
          <div key={step.id} className={`app-panel grid gap-3 border ${step.toneClass}`}>
            <div className="grid gap-1">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">
                {step.title}
              </p>
              <p className="text-sm font-semibold text-neutral-900">{step.summary}</p>
              <p className="text-sm text-neutral-600">{step.detail}</p>
            </div>
            <button
              type="button"
              className="app-button app-button-ghost"
              onClick={() => onStepAction(step.id)}
            >
              {step.actionLabel}
            </button>
          </div>
        ))}
      </div>
      <div className="app-panel mt-3 flex flex-wrap items-center gap-2 text-sm text-neutral-600">
        <span className="rounded-full border border-white/80 bg-white/70 px-3 py-1 text-neutral-700">
          {inventoryKpis.totalItems} itens ativos
        </span>
        <span className="rounded-full border border-white/80 bg-white/70 px-3 py-1 text-neutral-700">
          {inventoryKpis.ingredients} ingredientes
        </span>
        <span className="rounded-full border border-white/80 bg-white/70 px-3 py-1 text-neutral-700">
          {inventoryKpis.packaging} embalagens
        </span>
      </div>
    </>
  );
}
