import type {
  BuilderConfig,
  BuilderLayoutItem,
  BuilderLayoutPageKey,
  BuilderLayouts,
} from '@querobroapp/shared';

function sanitizeOrder(value: number, fallback: number) {
  return Number.isFinite(value) ? Math.max(0, Math.min(99, Math.trunc(value))) : fallback;
}

export function normalizeLayoutItems(
  currentItems: BuilderLayoutItem[] | undefined,
  defaultItems: BuilderLayoutItem[]
): BuilderLayoutItem[] {
  const list = currentItems || [];
  const byId = new Map(list.map((item) => [item.id, item]));
  const defaultIds = new Set(defaultItems.map((item) => item.id));

  const normalizedDefaults = defaultItems
    .map((base, index) => {
      const current = byId.get(base.id);
      if (!current) {
        return {
          ...base,
          kind: 'slot' as const,
          description: base.description || '',
          actionLabel: base.actionLabel || '',
          actionHref: base.actionHref || '',
          actionFocusSlot: base.actionFocusSlot || '',
          order: sanitizeOrder(base.order, index),
        } as BuilderLayoutItem;
      }

      return {
        id: base.id,
        label: current.label || base.label,
        kind: 'slot' as const,
        description: current.description || '',
        actionLabel: current.actionLabel || '',
        actionHref: current.actionHref || '',
        actionFocusSlot: current.actionFocusSlot || '',
        visible: current.visible,
        order: sanitizeOrder(current.order, index),
      } as BuilderLayoutItem;
    })
    .sort((a, b) => a.order - b.order);

  const normalizedCustom = list
    .filter((item) => !defaultIds.has(item.id))
    .map((item, index) => ({
      id: item.id,
      label: item.label || `Card ${index + 1}`,
      kind: item.kind === 'custom' ? 'custom' : 'custom',
      description: item.description || '',
      actionLabel: item.actionLabel || '',
      actionHref: item.actionHref || '',
      actionFocusSlot: item.actionFocusSlot || '',
      visible: item.visible,
      order: sanitizeOrder(item.order, normalizedDefaults.length + index),
    }) as BuilderLayoutItem)
    .sort((a, b) => a.order - b.order);

  return [...normalizedDefaults, ...normalizedCustom].sort((a, b) => a.order - b.order);
}

export function normalizeLayouts(config: BuilderConfig, fallback: BuilderConfig): BuilderLayouts {
  return {
    dashboard: normalizeLayoutItems(config.layouts.dashboard, fallback.layouts.dashboard),
    produtos: normalizeLayoutItems(config.layouts.produtos, fallback.layouts.produtos),
    clientes: normalizeLayoutItems(config.layouts.clientes, fallback.layouts.clientes),
    pedidos: normalizeLayoutItems(config.layouts.pedidos, fallback.layouts.pedidos),
    estoque: normalizeLayoutItems(config.layouts.estoque, fallback.layouts.estoque),
  };
}

export function normalizePageLayout(
  page: BuilderLayoutPageKey,
  config: BuilderConfig,
  fallback: BuilderConfig
) {
  return normalizeLayoutItems(config.layouts[page], fallback.layouts[page]);
}

export function sortedVisibleLayoutIds(items: BuilderLayoutItem[]) {
  return items
    .filter((item) => item.visible)
    .sort((a, b) => a.order - b.order)
    .map((item) => item.id);
}

export function reorderLayoutItems(items: BuilderLayoutItem[], movedId: string, targetId: string) {
  if (movedId === targetId) return items;

  const list = [...items].sort((a, b) => a.order - b.order);
  const fromIndex = list.findIndex((item) => item.id === movedId);
  const toIndex = list.findIndex((item) => item.id === targetId);

  if (fromIndex < 0 || toIndex < 0) return items;

  const [moved] = list.splice(fromIndex, 1);
  list.splice(toIndex, 0, moved);

  return list.map((item, index) => ({ ...item, order: index }));
}

export function shiftLayoutItem(items: BuilderLayoutItem[], id: string, direction: -1 | 1) {
  const list = [...items].sort((a, b) => a.order - b.order);
  const index = list.findIndex((item) => item.id === id);
  if (index < 0) return items;

  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= list.length) return items;

  const swap = list[nextIndex];
  list[nextIndex] = list[index];
  list[index] = swap;

  return list.map((item, position) => ({ ...item, order: position }));
}
