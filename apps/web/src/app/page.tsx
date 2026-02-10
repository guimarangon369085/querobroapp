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
        <span className="app-chip">QUEROBROA</span>
        <h2 className="mt-3 text-4xl font-semibold">QUEROBROApp</h2>
        <p className="mt-2 text-neutral-600">
          Operacao premium para produtos artesanais. Acesse os modulos para gerenciar catalogo, clientes,
          pedidos e estoque.
        </p>
      </div>
      <div className="app-gallery">
        <div className="app-gallery__item">
          <img src="/querobroa/hero-01.jpg" alt="Bandeja com broas e utensilios" />
        </div>
        <div className="app-gallery__item">
          <img src="/querobroa/hero-02.jpg" alt="Selecao de broas e sabores" />
        </div>
        <div className="app-gallery__item">
          <img src="/querobroa/hero-03.jpg" alt="Composicao com broas e loucas artesanais" />
        </div>
        <div className="app-gallery__item">
          <img src="/querobroa/hero-04.jpg" alt="Doce de leite artesanal" />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="app-panel transition hover:-translate-y-0.5"
          >
            <h3 className="text-lg font-semibold text-neutral-900">{link.title}</h3>
            <p className="mt-2 text-sm text-neutral-600">{link.desc}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
