import Image from 'next/image';
import Link from 'next/link';

const links = [
  { href: '/dashboard', title: 'Dashboard', desc: 'KPIs e leitura de performance em tempo real.' },
  { href: '/produtos', title: 'Produtos', desc: 'Catalogo, custo, margem e status comercial.' },
  { href: '/clientes', title: 'Clientes', desc: 'Base ativa, recorrencia e relacionamento.' },
  { href: '/pedidos', title: 'Pedidos', desc: 'Fluxo operacional com pagamentos e entregas.' },
  { href: '/estoque', title: 'Estoque', desc: 'Inventario, ficha tecnica e consumo por receita.' },
];

const gallery = [
  { src: '/querobroa/hero-01.jpg', alt: 'Bandeja com broas e utensilios' },
  { src: '/querobroa/hero-02.jpg', alt: 'Selecao de broas e sabores' },
  { src: '/querobroa/hero-03.jpg', alt: 'Composicao com broas e loucas artesanais' },
  { src: '/querobroa/hero-04.jpg', alt: 'Doce de leite artesanal' },
];

export default function HomePage() {
  return (
    <section className="grid gap-6">
      <div className="app-hero app-panel">
        <span className="app-hero__kicker">Brand system aplicado</span>
        <h2 className="text-4xl font-semibold">QUEROBROApp · UX soft-edge e sensorial</h2>
        <p className="max-w-3xl text-[0.98rem] text-neutral-700">
          Redesenho completo com base em tons de goiabada, crosta assada, creme e verde menta:
          contraste premium, leitura rapida para operacao e identidade visual coerente com o
          universo artesanal da marca.
        </p>
      </div>

      <div className="app-gallery">
        {gallery.map((item) => (
          <div key={item.src} className="app-gallery__item">
            <Image
              src={item.src}
              alt={item.alt}
              width={1200}
              height={760}
              priority={item.src.includes('01')}
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
