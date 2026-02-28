'use client';

import { usePathname } from 'next/navigation';
import { useOperationFlow } from '@/hooks/use-operation-flow';
import { resolveNavItem } from '@/lib/navigation-model';

function modeLabel(mode: 'loading' | 'online' | 'offline') {
  if (mode === 'online') return 'online';
  if (mode === 'offline') return 'offline';
  return 'sincronizando';
}

export function Topbar() {
  const pathname = usePathname();
  const route = resolveNavItem(pathname);
  const { mode, refreshing, refresh } = useOperationFlow();

  return (
    <header className="app-topbar">
      <div className="app-topbar__identity">
        <p className="app-topbar__eyebrow">{route.label} · jornada da broa</p>
        <h2 className="app-topbar__title">{route.title}</h2>
      </div>
      <div className="app-topbar__actions">
        <span className={`app-topbar__status app-topbar__status--${mode}`}>{modeLabel(mode)}</span>
        <button type="button" onClick={() => refresh()} className="app-ghost" disabled={refreshing}>
          {refreshing ? 'Atualizando' : 'Atualizar'}
        </button>
      </div>
    </header>
  );
}
