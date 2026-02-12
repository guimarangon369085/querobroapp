'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { scrollToLayoutSlot } from '@/lib/layout-scroll';

type RouteMeta = {
  title: string;
  eyebrow: string;
  subtitle: string;
  primaryAction?: { href: string; label: string; focusSlot?: string };
  secondaryAction?: { href: string; label: string; focusSlot?: string };
};

const routeMeta: Record<string, RouteMeta> = {
  '/': {
    eyebrow: 'Visao geral',
    title: 'Painel principal',
    subtitle: 'Acesse rapidamente vendas, clientes, estoque e configuracoes.',
    primaryAction: { href: '/dashboard', label: 'Abrir dashboard' },
    secondaryAction: { href: '/pedidos', label: 'Ver pedidos' },
  },
  '/dashboard': {
    eyebrow: 'Dashboard',
    title: 'Resumo da operacao',
    subtitle: 'Indicadores para acompanhar o dia em poucos segundos.',
    primaryAction: { href: '/pedidos?focus=new_order', label: 'Novo pedido' },
    secondaryAction: { href: '/estoque?focus=movement', label: 'Lancar movimento' },
  },
  '/produtos': {
    eyebrow: 'Produtos',
    title: 'Gestao de produtos',
    subtitle: 'Cadastre sabores, ajuste preco e organize seu catalogo.',
    primaryAction: { href: '/produtos', label: 'Cadastrar produto', focusSlot: 'form' },
    secondaryAction: { href: '/estoque?focus=movement', label: 'Ver custo de insumos' },
  },
  '/clientes': {
    eyebrow: 'Clientes',
    title: 'Gestao de clientes',
    subtitle: 'Mantenha contatos, endereco e historico sempre organizados.',
    primaryAction: { href: '/clientes', label: 'Cadastrar cliente', focusSlot: 'form' },
    secondaryAction: { href: '/pedidos?focus=new_order', label: 'Criar pedido' },
  },
  '/pedidos': {
    eyebrow: 'Pedidos',
    title: 'Fluxo de pedidos',
    subtitle: 'Controle status, pagamentos e entregas em um fluxo unico.',
    primaryAction: { href: '/pedidos', label: 'Abrir novo pedido', focusSlot: 'new_order' },
    secondaryAction: { href: '/dashboard', label: 'Ver KPIs' },
  },
  '/estoque': {
    eyebrow: 'Estoque',
    title: 'Controle de estoque',
    subtitle: 'Saldo, custo e fichas tecnicas com atualizacao automatica.',
    primaryAction: { href: '/estoque', label: 'Lancar movimento', focusSlot: 'movement' },
    secondaryAction: { href: '/produtos?focus=form', label: 'Ajustar catalogo' },
  },
  '/builder': {
    eyebrow: 'Builder',
    title: 'Editor modular',
    subtitle: 'Edite blocos da interface sem precisar programar.',
    primaryAction: { href: '/builder?focus=editor', label: 'Editar blocos' },
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
  const renderAction = (action: { href: string; label: string; focusSlot?: string }, kind: 'ghost' | 'primary') => {
    const className = kind === 'ghost' ? 'app-ghost' : 'app-primary';
    const actionPath = action.href.split('?')[0];
    const isSamePageFocus = Boolean(action.focusSlot) && actionPath === pathname;

    if (isSamePageFocus && action.focusSlot) {
      return (
        <button
          type="button"
          className={className}
          onClick={() => scrollToLayoutSlot(action.focusSlot!, { focus: true })}
        >
          {action.label}
        </button>
      );
    }

    return (
      <Link href={action.href} className={className}>
        {action.label}
      </Link>
    );
  };

  return (
    <header className="app-topbar">
      <div>
        <p className="app-topbar__eyebrow">{meta.eyebrow}</p>
        <h2 className="app-topbar__title">{meta.title}</h2>
        <p className="app-topbar__subtitle">{meta.subtitle}</p>
      </div>
      <div className="app-topbar__actions">
        {meta.secondaryAction ? (
          renderAction(meta.secondaryAction, 'ghost')
        ) : null}
        {meta.primaryAction ? (
          renderAction(meta.primaryAction, 'primary')
        ) : null}
      </div>
    </header>
  );
}
