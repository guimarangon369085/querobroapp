'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type RouteMeta = {
  title: string;
  eyebrow: string;
  subtitle: string;
  primaryAction?: { href: string; label: string };
  secondaryAction?: { href: string; label: string };
};

const routeMeta: Record<string, RouteMeta> = {
  '/': {
    eyebrow: 'Brand experience',
    title: 'Visao geral da plataforma',
    subtitle: 'Entrada principal para navegar entre operacao, vendas, clientes e inventario.',
    primaryAction: { href: '/dashboard', label: 'Abrir dashboard' },
    secondaryAction: { href: '/pedidos', label: 'Ver pedidos' },
  },
  '/dashboard': {
    eyebrow: 'Painel executivo',
    title: 'Dashboard de performance',
    subtitle: 'KPIs centrais para decisao rapida e acompanhamento diario.',
    primaryAction: { href: '/pedidos', label: 'Novo pedido' },
    secondaryAction: { href: '/estoque', label: 'Acompanhar estoque' },
  },
  '/produtos': {
    eyebrow: 'Catalogo inteligente',
    title: 'Gestao de produtos',
    subtitle: 'Portifolio, precificacao e margem com foco em consistencia comercial.',
    primaryAction: { href: '/produtos', label: 'Cadastrar produto' },
    secondaryAction: { href: '/estoque', label: 'Ver custo de insumos' },
  },
  '/clientes': {
    eyebrow: 'Relacionamento',
    title: 'Gestao de clientes',
    subtitle: 'Base ativa, historico e dados de contato para operacao consultiva.',
    primaryAction: { href: '/clientes', label: 'Cadastrar cliente' },
    secondaryAction: { href: '/pedidos', label: 'Criar pedido' },
  },
  '/pedidos': {
    eyebrow: 'Operacao comercial',
    title: 'Fluxo de pedidos',
    subtitle: 'Controle completo de status, pagamento e acompanhamento de entregas.',
    primaryAction: { href: '/pedidos', label: 'Abrir novo pedido' },
    secondaryAction: { href: '/dashboard', label: 'Ver KPIs' },
  },
  '/estoque': {
    eyebrow: 'Supply intelligence',
    title: 'Controle de estoque e fichas',
    subtitle: 'Movimentos, capacidade produtiva e custo por unidade de venda.',
    primaryAction: { href: '/estoque', label: 'Lancar movimento' },
    secondaryAction: { href: '/produtos', label: 'Ajustar catalogo' },
  },
  '/builder': {
    eyebrow: 'No-code studio',
    title: 'Builder modular do app',
    subtitle: 'Altere blocos de UX, tema, integracoes e home sem escrever codigo.',
    primaryAction: { href: '/builder', label: 'Editar blocos' },
    secondaryAction: { href: '/', label: 'Ver landing' },
  },
};

function getMeta(pathname: string): RouteMeta {
  const exact = routeMeta[pathname];
  if (exact) return exact;
  const firstSegment = `/${pathname.split('/').filter(Boolean)[0] || ''}`;
  return routeMeta[firstSegment] || routeMeta['/'];
}

export function Topbar() {
  const pathname = usePathname();
  const meta = getMeta(pathname);

  return (
    <header className="app-topbar">
      <div>
        <p className="app-topbar__eyebrow">{meta.eyebrow}</p>
        <h2 className="app-topbar__title">{meta.title}</h2>
        <p className="app-topbar__subtitle">{meta.subtitle}</p>
      </div>
      <div className="app-topbar__actions">
        {meta.secondaryAction ? (
          <Link href={meta.secondaryAction.href} className="app-ghost">
            {meta.secondaryAction.label}
          </Link>
        ) : null}
        {meta.primaryAction ? (
          <Link href={meta.primaryAction.href} className="app-primary">
            {meta.primaryAction.label}
          </Link>
        ) : null}
      </div>
    </header>
  );
}
