'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { BuilderConfig, BuilderLayoutItem, BuilderLayoutPageKey } from '@querobroapp/shared';
import { fetchBuilderConfigClient, getDefaultBuilderConfig } from '@/lib/builder';
import { normalizePageLayout } from '@/lib/builder-layout';

type LayoutContextValue = {
  itemsById: Map<string, BuilderLayoutItem>;
};

const BuilderLayoutContext = createContext<LayoutContextValue>({
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
    return { itemsById };
  }, [layoutItems]);

  return <BuilderLayoutContext.Provider value={value}>{children}</BuilderLayoutContext.Provider>;
}

type BuilderLayoutItemProps = {
  id: string;
  children: ReactNode;
};

export function BuilderLayoutItemSlot({ id, children }: BuilderLayoutItemProps) {
  const { itemsById } = useContext(BuilderLayoutContext);
  const item = itemsById.get(id);

  if (item && !item.visible) return null;

  return <div style={{ order: item?.order ?? 0 }}>{children}</div>;
}
