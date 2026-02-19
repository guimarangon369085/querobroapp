'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { scrollToLayoutSlot } from '@/lib/layout-scroll';

type RouteMeta = {
  title: string;
  eyebrow: string;
  subtitle: string;
  helper: string;
  primaryAction?: { href: string; label: string; focusSlot?: string };
  secondaryAction?: { href: string; label: string; focusSlot?: string };
};

const routeMeta: Record<string, RouteMeta> = {
  '/': {
    eyebrow: 'Comeco rapido',
    title: 'Painel principal',
    subtitle: 'Tudo organizado para operar sem complicacao.',
    helper: 'Siga os passos 1, 2, 3 e 4 no menu lateral.',
    primaryAction: { href: '/dashboard', label: 'Abrir resumo' },
    secondaryAction: { href: '/pedidos', label: 'Ir para pedidos' },
  },
  '/dashboard': {
    eyebrow: 'Painel rapido',
    title: 'Resumo da operacao',
    subtitle: 'Entenda o dia em poucos segundos.',
    helper: 'Se estiver tudo certo, avance para Pedidos.',
    primaryAction: { href: '/pedidos?focus=new_order', label: 'Criar pedido' },
    secondaryAction: { href: '/estoque?focus=d1', label: 'Ver D+1' },
  },
  '/jornada': {
    eyebrow: 'Fluxo unico',
    title: 'Jornada da broa',
    subtitle: 'Toque no no e continue.',
    helper: 'Um passo por vez.',
    primaryAction: { href: '/jornada', label: 'Abrir mapa' },
    secondaryAction: { href: '/pedidos?focus=new_order', label: 'Criar pedido' }
  },
  '/produtos': {
    eyebrow: 'Passo 1',
    title: 'Produtos e sabores',
    subtitle: 'Cadastre rapido: nome, preco e pronto.',
    helper: 'Use os atalhos de preenchimento para reduzir cliques.',
    primaryAction: { href: '/produtos', label: 'Novo produto', focusSlot: 'form' },
    secondaryAction: { href: '/estoque?focus=bom', label: 'Abrir ficha tecnica' },
  },
  '/clientes': {
    eyebrow: 'Passo 2',
    title: 'Clientes',
    subtitle: 'Nome, telefone e endereco em fluxo simples.',
    helper: 'Campos avancados ficam escondidos ate voce precisar.',
    primaryAction: { href: '/clientes', label: 'Novo cliente', focusSlot: 'form' },
    secondaryAction: { href: '/pedidos?focus=new_order', label: 'Criar pedido' },
  },
  '/pedidos': {
    eyebrow: 'Passo 3',
    title: 'Pedidos e pagamentos',
    subtitle: 'Fluxo guiado para montar, acompanhar e receber.',
    helper: 'Primeiro cliente, depois itens, por fim pagamento.',
    primaryAction: { href: '/pedidos', label: 'Novo pedido', focusSlot: 'new_order' },
    secondaryAction: { href: '/dashboard', label: 'Voltar ao resumo' },
  },
  '/estoque': {
    eyebrow: 'Passo 4',
    title: 'Estoque e D+1',
    subtitle: 'Saldo atual, necessidades e custos num so lugar.',
    helper: 'Priorize o quadro D+1 antes de abrir a producao.',
    primaryAction: { href: '/estoque', label: 'Lancar movimento', focusSlot: 'movement' },
    secondaryAction: { href: '/estoque', label: 'Ver D+1', focusSlot: 'd1' },
  },
  '/builder': {
    eyebrow: 'Configuracao',
    title: 'Editor modular',
    subtitle: 'Ajuste blocos da interface sem programar.',
    helper: 'Mantenha na tela apenas o que o operador realmente usa.',
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
        <p className="app-topbar__helper">{meta.helper}</p>
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
