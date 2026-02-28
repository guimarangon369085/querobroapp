'use client';

import { usePathname } from 'next/navigation';
import { resolveNavItem } from '@/lib/navigation-model';

export function Topbar() {
  const pathname = usePathname();
  const route = resolveNavItem(pathname);

  return (
    <header className="app-topbar">
      <div className="app-topbar__identity">
        <h2 className="app-topbar__title">{route.title}</h2>
      </div>
    </header>
  );
}
