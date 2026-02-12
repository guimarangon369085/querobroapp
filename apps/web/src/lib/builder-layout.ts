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
) {
  const byId = new Map((currentItems || []).map((item) => [item.id, item]));

  return defaultItems
    .map((base, index) => {
      const current = byId.get(base.id);
      if (!current) {
        return { ...base, order: sanitizeOrder(base.order, index) };
      }

      return {
        id: base.id,
        label: current.label || base.label,
        visible: current.visible,
        order: sanitizeOrder(current.order, index),
      };
    })
    .sort((a, b) => a.order - b.order);
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
