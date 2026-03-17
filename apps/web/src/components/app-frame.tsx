'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { Nav } from '@/components/nav';
import { Topbar } from '@/components/topbar';

function isPublicOrderPath(pathname: string) {
  return pathname === '/pedido' || pathname.startsWith('/pedido/');
}

function isPublicLandingPath(pathname: string) {
  return pathname === '/';
}

export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (isPublicOrderPath(pathname) || isPublicLandingPath(pathname)) {
    return <>{children}</>;
  }

  return (
    <div className="app-shell">
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
