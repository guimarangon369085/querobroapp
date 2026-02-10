import Link from 'next/link';

const links = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/produtos', label: 'Produtos' },
  { href: '/clientes', label: 'Clientes' },
  { href: '/pedidos', label: 'Pedidos' },
  { href: '/estoque', label: 'Estoque' }
];

export function Nav() {
  return (
    <nav className="app-nav">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="app-nav__link"
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
