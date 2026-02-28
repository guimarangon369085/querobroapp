'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useOperationFlow } from '@/hooks/use-operation-flow';
import { isActivePath, primaryNavItems } from '@/lib/navigation-model';
import { formatCurrencyBR } from '@/lib/format';

export function FlowDock() {
  const pathname = usePathname();
  const { flow, error } = useOperationFlow({ refreshIntervalMs: 30000 });

  return (
    <section className="flow-dock" aria-label="Fluxo principal">
      <div className="flow-dock__head">
        <p className="flow-dock__eyebrow">Acesso rapido</p>
      </div>

      <div className="flow-dock__main">
        <p className="flow-dock__title">As 5 telas principais concentram toda a operacao.</p>
        <div className="flow-dock__progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={flow.progressPercent}>
          <span className="flow-dock__progress-fill" style={{ width: `${flow.progressPercent}%` }} />
        </div>
      </div>

      <div className="flow-dock__stepline">
        {primaryNavItems.map((item, index) => {
          const active = isActivePath(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flow-dock__stepchip ${active ? 'flow-dock__stepchip--current' : 'flow-dock__stepchip--done'}`}
              aria-label={`${index + 1}. ${item.label}`}
            >
              <span>{index + 1}</span>
              <small>{item.label.slice(0, 1)}</small>
            </Link>
          );
        })}
      </div>

      <div className="flow-dock__meta">
        <span>{flow.metrics.openOrders} abertos</span>
        <span>{flow.metrics.deliveredOrders} entregues</span>
        <span>{flow.metrics.customers} clientes</span>
        <span>{flow.metrics.products} produtos</span>
      </div>

      <div className="flow-dock__actions">
        <Link href="/pedidos" className="app-primary">
          Abrir pedidos
        </Link>
        <span>{formatCurrencyBR(flow.metrics.pendingValue)} pendente</span>
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
