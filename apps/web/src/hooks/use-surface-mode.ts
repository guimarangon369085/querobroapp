'use client';

import { useEffect, useMemo, useState } from 'react';

export type SurfaceMode = 'operation' | 'full';

type UseSurfaceModeOptions = {
  breakpointPx?: number;
  defaultMode?: SurfaceMode;
  storagePrefix?: string;
};

const DEFAULT_STORAGE_PREFIX = 'querobroapp.surface-mode';

function isSurfaceMode(value: string | null): value is SurfaceMode {
  return value === 'operation' || value === 'full';
}

function readStoredMode(storageKey: string) {
  if (typeof window === 'undefined') return null;
  const storedMode = window.localStorage.getItem(storageKey);
  return isSurfaceMode(storedMode) ? storedMode : null;
}

function resolveDefaultMode(breakpointPx: number | undefined, defaultMode: SurfaceMode | undefined) {
  if (defaultMode) return defaultMode;
  if (
    typeof window !== 'undefined' &&
    Number.isFinite(breakpointPx) &&
    (breakpointPx ?? 0) > 0 &&
    window.innerWidth <= (breakpointPx ?? 0)
  ) {
    return 'operation' as SurfaceMode;
  }
  return 'full' as SurfaceMode;
}

export function useSurfaceMode(pageKey: string, options: UseSurfaceModeOptions = {}) {
  const { breakpointPx, defaultMode, storagePrefix } = options;
  const storageKey = useMemo(
    () => `${storagePrefix ?? DEFAULT_STORAGE_PREFIX}:${pageKey}`,
    [pageKey, storagePrefix]
  );
  const [viewMode, setViewMode] = useState<SurfaceMode>(() => {
    return readStoredMode(storageKey) ?? resolveDefaultMode(breakpointPx, defaultMode);
  });

  useEffect(() => {
    const storedMode = readStoredMode(storageKey);
    setViewMode(storedMode ?? resolveDefaultMode(breakpointPx, defaultMode));
  }, [storageKey, breakpointPx, defaultMode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(storageKey, viewMode);
  }, [storageKey, viewMode]);

  return {
    viewMode,
    setViewMode,
    isOperationMode: viewMode === 'operation'
  };
}
