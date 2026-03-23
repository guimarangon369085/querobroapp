'use client';

import { useEffect } from 'react';

const recoveryStorageKey = 'querobroapp.runtime-recovery';
const recoveryCooldownMs = 15_000;

function normalizeErrorMessage(value: unknown) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message || String(value);
  if (typeof value === 'object' && 'message' in value) {
    const message = (value as { message?: unknown }).message;
    return typeof message === 'string' ? message : '';
  }
  return '';
}

function isRecoverableAssetError(message: string) {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;

  return (
    normalized.includes('chunkloaderror') ||
    normalized.includes('loading chunk') ||
    normalized.includes('failed to fetch dynamically imported module') ||
    normalized.includes('dynamically imported module')
  );
}

function triggerRecovery() {
  if (typeof window === 'undefined') return;

  const now = Date.now();
  const currentUrl = window.location.href;

  try {
    const raw = window.sessionStorage.getItem(recoveryStorageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as { url?: string; at?: number };
      if (
        parsed.url === currentUrl &&
        typeof parsed.at === 'number' &&
        now - parsed.at < recoveryCooldownMs
      ) {
        return;
      }
    }

    window.sessionStorage.setItem(
      recoveryStorageKey,
      JSON.stringify({
        url: currentUrl,
        at: now
      })
    );
  } catch {
    // sessionStorage can fail in restricted modes; reload anyway.
  }

  window.location.reload();
}

export function RuntimeRecovery() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      const message = normalizeErrorMessage(event.error) || normalizeErrorMessage(event.message);
      if (!isRecoverableAssetError(message)) return;
      triggerRecovery();
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const message = normalizeErrorMessage(event.reason);
      if (!isRecoverableAssetError(message)) return;
      triggerRecovery();
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);

    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, []);

  return null;
}
