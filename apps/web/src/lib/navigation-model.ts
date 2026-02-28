export type AppNavItem = {
  href: string;
  label: string;
  title: string;
  hint: string;
};

export type AppNavSection = {
  id: string;
  label: string;
  items: AppNavItem[];
};

export const primaryNavItems: AppNavItem[] = [
  {
    href: '/calendario',
    label: 'Calendario',
    title: 'Calendario',
    hint: 'Base diaria de planejamento'
  },
  {
    href: '/pedidos',
    label: 'Pedidos',
    title: 'Pedidos',
    hint: 'Trabalhar os pedidos dentro do calendario'
  },
  {
    href: '/clientes',
    label: 'Clientes',
    title: 'Clientes',
    hint: 'Cadastro e historico de atendimento'
  },
  {
    href: '/produtos',
    label: 'Produtos',
    title: 'Produtos',
    hint: 'Catalogo e precos'
  },
  {
    href: '/estoque',
    label: 'Estoque',
    title: 'Estoque',
    hint: 'Produzir, conferir e repor'
  }
];

const byHref = new Map(primaryNavItems.map((item) => [item.href, item]));
const pathAliases = new Map<string, string>([
  ['/', '/calendario'],
  ['/dashboard', '/calendario'],
  ['/jornada', '/calendario'],
  ['/hoje', '/calendario'],
  ['/producao', '/estoque'],
  ['/saidas', '/pedidos'],
  ['/caixa', '/pedidos'],
  ['/base', '/clientes'],
  ['/whatsapp-flow', '/pedidos'],
  ['/builder', '/calendario']
]);

function pickItems(hrefs: string[]) {
  return hrefs
    .map((href) => byHref.get(href))
    .filter((entry): entry is AppNavItem => Boolean(entry));
}

export const navSections: AppNavSection[] = [
  {
    id: 'principal',
    label: 'Principal',
    items: pickItems(['/calendario', '/pedidos', '/clientes', '/produtos', '/estoque'])
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
  return byHref.get(aliasedSegment) || byHref.get('/calendario') || primaryNavItems[0];
}
