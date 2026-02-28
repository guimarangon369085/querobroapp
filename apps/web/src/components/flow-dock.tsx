'use client';

import Link from 'next/link';
import { useOperationFlow } from '@/hooks/use-operation-flow';

export function FlowDock() {
  const { flow, error } = useOperationFlow({ refreshIntervalMs: 30000 });
  const currentStep = flow.currentStep;

  return (
    <section className="flow-dock" aria-label="Fluxo principal">
      <div className="flow-dock__head">
        <p className="flow-dock__eyebrow">Roteiro do dia</p>
      </div>

      <div className="flow-dock__main">
        <p className="flow-dock__title">
          Etapa {currentStep.index}/7: {currentStep.title}
        </p>
        <div className="flow-dock__progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={flow.progressPercent}>
          <span className="flow-dock__progress-fill" style={{ width: `${flow.progressPercent}%` }} />
        </div>
      </div>

      <div className="flow-dock__stepline">
        {flow.steps.map((step) => (
          step.state === 'locked' ? (
            <span
              key={step.key}
              className={`flow-dock__stepchip flow-dock__stepchip--${step.state}`}
              aria-label={`${step.index}. ${step.title}`}
            >
              <span>{step.index}</span>
              <small>{step.icon}</small>
            </span>
          ) : (
            <Link
              key={step.key}
              href={step.href}
              className={`flow-dock__stepchip flow-dock__stepchip--${step.state}`}
              aria-label={`${step.index}. ${step.title}`}
            >
              <span>{step.index}</span>
              <small>{step.icon}</small>
            </Link>
          )
        ))}
      </div>

      <div className="flow-dock__meta">
        <span>{flow.metrics.openOrders} abertos</span>
        <span>{flow.metrics.deliveredOrders} entregues</span>
      </div>

      <div className="flow-dock__actions">
        <Link href={currentStep.href} className="app-primary">
          {currentStep.actionLabel}
        </Link>
      </div>

      {error ? (
        <details className="flow-dock__error">
          <summary>Detalhe tecnico</summary>
          <p>{error}</p>
        </details>
      ) : null}
    </section>
  );
}
