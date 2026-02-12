/* eslint-disable @next/next/no-img-element */
import Link from 'next/link';
import { fetchBuilderConfigServer, resolveBuilderImageSrc } from '@/lib/builder';

const links = [
  { href: '/dashboard', title: 'Dashboard', desc: 'KPIs e leitura de performance em tempo real.' },
  { href: '/produtos', title: 'Produtos', desc: 'Catalogo, custo, margem e status comercial.' },
  { href: '/clientes', title: 'Clientes', desc: 'Base ativa, recorrencia e relacionamento.' },
  { href: '/pedidos', title: 'Pedidos', desc: 'Fluxo operacional com pagamentos e entregas.' },
  { href: '/estoque', title: 'Estoque', desc: 'Inventario, ficha tecnica e consumo por receita.' },
  { href: '/builder', title: 'Builder', desc: 'Edicao modular por blocos, sem codigo.' },
];

export default async function HomePage() {
  const builderConfig = await fetchBuilderConfigServer();
  const hero = builderConfig.home;
  const gallery = hero.gallery.length ? hero.gallery : [];

  return (
    <section className="grid gap-6">
      <div className="app-hero app-panel">
        <span className="app-hero__kicker">{hero.kicker}</span>
        <h2 className="text-4xl font-semibold">{hero.title}</h2>
        <p className="max-w-3xl text-[0.98rem] text-neutral-700">{hero.description}</p>
      </div>

      <div className="app-gallery">
        {gallery.map((item, index) => (
          <div key={item.id} className="app-gallery__item">
            <img
              src={resolveBuilderImageSrc(item.src)}
              alt={item.alt}
              loading={index === 0 ? 'eager' : 'lazy'}
            />
          </div>
        ))}
      </div>

      <div className="app-feature-grid md:grid-cols-2">
        {links.map((link) => (
          <Link key={link.href} href={link.href} className="app-feature-card">
            <h3 className="app-feature-card__title">{link.title}</h3>
            <p className="app-feature-card__desc">{link.desc}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
