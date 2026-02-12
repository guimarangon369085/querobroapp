'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/dashboard', label: 'Dashboard', icon: '◌' },
  { href: '/produtos', label: 'Produtos', icon: '◒' },
  { href: '/clientes', label: 'Clientes', icon: '◍' },
  { href: '/pedidos', label: 'Pedidos', icon: '◉' },
  { href: '/estoque', label: 'Estoque', icon: '◎' },
  { href: '/builder', label: 'Builder', icon: '◈' },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="app-nav" aria-label="Navegacao principal">
      {links.map((link) => {
        const active = isActive(pathname, link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={`app-nav__link ${active ? 'app-nav__link--active' : ''}`}
          >
            <span aria-hidden className="app-nav__icon">
              {link.icon}
            </span>
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
