'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { Nav } from '@/components/nav';
import { Topbar } from '@/components/topbar';

function isPublicOrderPath(pathname: string) {
  return pathname === '/pedido' || pathname.startsWith('/pedido/');
}

export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (isPublicOrderPath(pathname)) {
    return <>{children}</>;
  }

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-brand">
          <div className="app-brand__logo">
            <h1 className="app-brand__name">@QUEROBROApp</h1>
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
