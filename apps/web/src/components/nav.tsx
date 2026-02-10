'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/dashboard', label: 'Dashboard', icon: '◌' },
  { href: '/produtos', label: 'Produtos', icon: '◒' },
  { href: '/clientes', label: 'Clientes', icon: '◍' },
  { href: '/pedidos', label: 'Pedidos', icon: '◉' },
  { href: '/estoque', label: 'Estoque', icon: '◎' },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="app-nav">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={`app-nav__link ${isActive(pathname, link.href) ? 'app-nav__link--active' : ''}`}
        >
          <span aria-hidden className="app-nav__icon">
            {link.icon}
          </span>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
