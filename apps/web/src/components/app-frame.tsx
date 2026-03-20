'use client';

import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { Nav } from '@/components/nav';
import { Topbar } from '@/components/topbar';

function isPublicOrderPath(pathname: string) {
  return pathname === '/pedido' || pathname.startsWith('/pedido/');
}

function isPublicOrderCompletionPath(pathname: string) {
  return pathname === '/pedidofinalizado';
}

function isPublicLandingPath(pathname: string) {
  return pathname === '/';
}

function shouldAllowTouchContextMenu(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      'input, textarea, select, option, [contenteditable="true"], [data-allow-context-menu="true"]'
    )
  );
}

export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const handleContextMenuCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (typeof window === 'undefined') return;
    if (!window.matchMedia('(hover: none) and (pointer: coarse)').matches) return;
    if (shouldAllowTouchContextMenu(event.target)) return;
    event.preventDefault();
  }, []);

  if (isPublicOrderPath(pathname) || isPublicOrderCompletionPath(pathname) || isPublicLandingPath(pathname)) {
    return <>{children}</>;
  }

  return (
    <div className="app-shell" onContextMenuCapture={handleContextMenuCapture}>
      <aside className="app-sidebar">
        <div className="app-brand">
          <div className="app-brand__logo">
            <h1 className="app-brand__name brand-wordmark brand-wordmark--micro">@QUEROBROA</h1>
          </div>
        </div>
        <Nav />
      </aside>
      <div className="app-main">
        <main className="app-content">
          <Topbar />
          {children}
        </main>
      </div>
    </div>
  );
}
