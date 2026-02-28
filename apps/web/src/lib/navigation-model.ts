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

const allItems: AppNavItem[] = [
  {
    href: '/hoje',
    label: 'Hoje',
    title: 'Hoje',
    hint: 'Tocar o dia'
  },
  {
    href: '/producao',
    label: 'Producao',
    title: 'Producao',
    hint: 'Planejar e produzir'
  },
  {
    href: '/saidas',
    label: 'Saidas',
    title: 'Saidas',
    hint: 'Separar e entregar'
  },
  {
    href: '/caixa',
    label: 'Caixa',
    title: 'Caixa',
    hint: 'Receber e fechar'
  },
  {
    href: '/base',
    label: 'Base',
    title: 'Base',
    hint: 'Clientes e broas'
  },
  {
    href: '/pedidos',
    label: 'Hoje',
    title: 'Hoje',
    hint: 'Compromissos do dia'
  },
  {
    href: '/clientes',
    label: 'Base',
    title: 'Base',
    hint: 'Clientes'
  },
  {
    href: '/produtos',
    label: 'Base',
    title: 'Base',
    hint: 'Produtos'
  },
  {
    href: '/estoque',
    label: 'Producao',
    title: 'Producao',
    hint: 'Planejar D+1'
  }
];

const byHref = new Map(allItems.map((item) => [item.href, item]));
const pathAliases = new Map<string, string>([
  ['/pedidos', '/hoje'],
  ['/dashboard', '/hoje'],
  ['/jornada', '/hoje'],
  ['/estoque', '/producao'],
  ['/clientes', '/base'],
  ['/produtos', '/base']
]);

function pickItems(hrefs: string[]) {
  return hrefs
    .map((href) => byHref.get(href))
    .filter((entry): entry is AppNavItem => Boolean(entry));
}

export const navSections: AppNavSection[] = [
  {
    id: 'jornada',
    label: 'Jornada',
    items: pickItems(['/hoje', '/producao', '/saidas', '/caixa'])
  },
  {
    id: 'base',
    label: 'Base',
    items: pickItems(['/base'])
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
  const firstSegment = `/${pathname.split('/').filter(Boolean)[0] || ''}`;
  return byHref.get(firstSegment) || byHref.get('/hoje') || allItems[0];
}
