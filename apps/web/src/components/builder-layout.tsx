'use client';

import Link from 'next/link';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { BuilderConfig, BuilderLayoutItem, BuilderLayoutPageKey } from '@querobroapp/shared';
import { usePathname } from 'next/navigation';
import { fetchBuilderConfigClient, getDefaultBuilderConfig } from '@/lib/builder';
import { normalizePageLayout } from '@/lib/builder-layout';
import { scrollToLayoutSlot } from '@/lib/layout-scroll';

type LayoutContextValue = {
  items: BuilderLayoutItem[];
  itemsById: Map<string, BuilderLayoutItem>;
};

const BuilderLayoutContext = createContext<LayoutContextValue>({
  items: [],
  itemsById: new Map<string, BuilderLayoutItem>(),
});

type BuilderLayoutProviderProps = {
  page: BuilderLayoutPageKey;
  children: ReactNode;
};

export function BuilderLayoutProvider({ page, children }: BuilderLayoutProviderProps) {
  const defaults = useMemo(() => getDefaultBuilderConfig(), []);
  const [layoutItems, setLayoutItems] = useState<BuilderLayoutItem[]>(() =>
    normalizePageLayout(page, defaults, defaults)
  );

  useEffect(() => {
    let active = true;

    fetchBuilderConfigClient()
      .then((config) => {
        if (!active) return;
        setLayoutItems(normalizePageLayout(page, config, defaults));
      })
      .catch(() => {
        if (!active) return;
        setLayoutItems(normalizePageLayout(page, defaults, defaults));
      });

    const onConfigUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<BuilderConfig>;
      if (!active || !customEvent.detail) return;
      setLayoutItems(normalizePageLayout(page, customEvent.detail, defaults));
    };
    window.addEventListener('builder:config-updated', onConfigUpdated as EventListener);

    return () => {
      active = false;
      window.removeEventListener('builder:config-updated', onConfigUpdated as EventListener);
    };
  }, [page, defaults]);

  const value = useMemo<LayoutContextValue>(() => {
    const itemsById = new Map(layoutItems.map((item) => [item.id, item]));
    return { items: layoutItems, itemsById };
  }, [layoutItems]);

  return <BuilderLayoutContext.Provider value={value}>{children}</BuilderLayoutContext.Provider>;
}

type BuilderLayoutItemProps = {
  id: string;
  className?: string;
  children: ReactNode;
};

export function BuilderLayoutItemSlot({ id, className, children }: BuilderLayoutItemProps) {
  const { itemsById } = useContext(BuilderLayoutContext);
  const item = itemsById.get(id);

  if (item && !item.visible) return null;

  return (
    <div
      id={`slot-${id}`}
      data-layout-slot-id={id}
      className={className}
      style={{ order: item?.order ?? 0 }}
    >
      {children}
    </div>
  );
}

export function BuilderLayoutCustomCards() {
  const pathname = usePathname();
  const { items } = useContext(BuilderLayoutContext);
  const cards = items
    .filter((item) => {
      if (item.kind !== 'custom' || !item.visible) return false;
      return Boolean(item.actionLabel && (item.actionHref || item.actionFocusSlot));
    })
    .sort((a, b) => a.order - b.order);

  if (cards.length === 0) return null;

  return (
    <div className="grid gap-3">
      {cards.map((card) => {
        const href = (card.actionHref || '').trim();
        const actionPath = href.split('?')[0];
        const isSamePageFocus = Boolean(card.actionFocusSlot) && (!href || actionPath === pathname);

        return (
          <div key={card.id} className="app-panel" style={{ order: card.order }}>
            <p className="font-semibold text-neutral-900">{card.label}</p>
            {card.description ? <p className="mt-1 text-sm text-neutral-600">{card.description}</p> : null}
            <div className="mt-3">
              {isSamePageFocus && card.actionFocusSlot ? (
                <button
                  type="button"
                  className="app-button app-button-ghost"
                  onClick={() => scrollToLayoutSlot(card.actionFocusSlot!, { focus: true })}
                >
                  {card.actionLabel}
                </button>
              ) : (
                <Link href={href || '#'} className="app-button app-button-ghost">
                  {card.actionLabel}
                </Link>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
