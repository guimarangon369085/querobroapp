import Link from 'next/link';

const links = [
  { href: '/dashboard', title: 'Dashboard', desc: 'Visao geral de vendas e operacoes.' },
  { href: '/produtos', title: 'Produtos', desc: 'Catalogo, precos e status.' },
  { href: '/clientes', title: 'Clientes', desc: 'Base de clientes e contatos.' },
  { href: '/pedidos', title: 'Pedidos', desc: 'Acompanhe pedidos e pagamentos.' },
  { href: '/estoque', title: 'Estoque', desc: 'Movimentacoes e saldo atual.' }
];

export default function HomePage() {
  return (
    <section className="grid gap-6">
      <div>
        <p className="text-sm uppercase tracking-[0.3em] text-neutral-500">QuerobroApp</p>
        <h2 className="mt-3 text-3xl font-semibold">Painel ERP</h2>
        <p className="mt-2 text-neutral-600">
          Acesse os modulos principais para gerenciar produtos, clientes, pedidos e estoque.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5"
          >
            <h3 className="text-lg font-semibold text-neutral-900">{link.title}</h3>
            <p className="mt-2 text-sm text-neutral-600">{link.desc}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
