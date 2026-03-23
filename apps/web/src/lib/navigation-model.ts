import type { AppIconName } from '@/components/app-icons';

export type AppNavItem = {
  href: string;
  label: string;
  title: string;
  icon: AppIconName;
};

export type AppNavSection = {
  id: string;
  label: string;
  items: AppNavItem[];
};

export const primaryNavItems: AppNavItem[] = [
  {
    href: '/pedidos',
    label: 'PEDIDOS',
    title: 'PEDIDOS',
    icon: 'pedidos'
  },
  {
    href: '/clientes',
    label: 'CLIENTES',
    title: 'CLIENTES',
    icon: 'clientes'
  },
  {
    href: '/estoque',
    label: 'ESTOQUE',
    title: 'ESTOQUE',
    icon: 'estoque'
  },
  {
    href: '/dashboard',
    label: 'DASHBOARD',
    title: 'DASHBOARD',
    icon: 'pedidos'
  }
];

const byHref = new Map(primaryNavItems.map((item) => [item.href, item]));
const pathAliases = new Map<string, string>([
  ['/', '/pedidos'],
  ['/dashboard', '/dashboard'],
  ['/inicio', '/pedidos'],
  ['/jornada', '/pedidos'],
  ['/hoje', '/pedidos'],
  ['/resumo', '/pedidos'],
  ['/producao', '/estoque'],
  ['/produtos', '/estoque'],
  ['/saidas', '/pedidos'],
  ['/caixa', '/pedidos'],
  ['/base', '/clientes'],
  ['/builder', '/pedidos'],
  ['/whatsapp-flow', '/pedidos']
]);

function pickItems(hrefs: string[]) {
  return hrefs
    .map((href) => byHref.get(href))
    .filter((entry): entry is AppNavItem => Boolean(entry));
}

export const navSections: AppNavSection[] = [
  {
    id: 'principal',
    label: 'PRINCIPAL',
    items: pickItems(['/pedidos', '/clientes', '/estoque', '/dashboard'])
  }
];

export function isActivePath(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  const firstSegment = `/${pathname.split('/').filter(Boolean)[0] || ''}`;
  if ((pathAliases.get(firstSegment) || '') === href) return true;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function resolveNavItem(pathname: string) {
  const direct = byHref.get(pathname);
  if (direct) return direct;
  const aliasTarget = pathAliases.get(pathname);
  if (aliasTarget) {
    return byHref.get(aliasTarget) || primaryNavItems[0];
  }
  const firstSegment = `/${pathname.split('/').filter(Boolean)[0] || ''}`;
  const aliasedSegment = pathAliases.get(firstSegment) || firstSegment;
  return byHref.get(aliasedSegment) || byHref.get('/pedidos') || primaryNavItems[0];
}
