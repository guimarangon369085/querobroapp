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

function resolveDefaultMode(options: UseSurfaceModeOptions) {
  if (options.defaultMode) return options.defaultMode;
  if (
    typeof window !== 'undefined' &&
    Number.isFinite(options.breakpointPx) &&
    (options.breakpointPx ?? 0) > 0 &&
    window.innerWidth <= (options.breakpointPx ?? 0)
  ) {
    return 'operation' as SurfaceMode;
  }
  return 'full' as SurfaceMode;
}

export function useSurfaceMode(pageKey: string, options: UseSurfaceModeOptions = {}) {
  const storageKey = useMemo(
    () => `${options.storagePrefix ?? DEFAULT_STORAGE_PREFIX}:${pageKey}`,
    [pageKey, options.storagePrefix]
  );
  const [viewMode, setViewMode] = useState<SurfaceMode>(() => {
    return readStoredMode(storageKey) ?? resolveDefaultMode(options);
  });

  useEffect(() => {
    const storedMode = readStoredMode(storageKey);
    setViewMode(storedMode ?? resolveDefaultMode(options));
  }, [storageKey, options.breakpointPx, options.defaultMode]);

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
