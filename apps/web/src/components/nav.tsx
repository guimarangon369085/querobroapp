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
    <nav className="flex flex-wrap items-center gap-4 text-sm text-neutral-600">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="rounded-full border border-neutral-200 px-3 py-1 text-neutral-700 hover:bg-neutral-100"
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
