'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/produtos', label: 'Produtos' },
  { href: '/clientes', label: 'Clientes' },
  { href: '/pedidos', label: 'Pedidos' },
  { href: '/estoque', label: 'Estoque' },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="app-nav">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={`app-nav__link ${pathname === link.href ? 'app-nav__link--active' : ''}`}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
