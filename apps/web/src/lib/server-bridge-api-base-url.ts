import { devDefaultBaseUrl, getApiBaseUrl } from '@/lib/api-base-url';

function normalizeHost(rawHost: string | null | undefined) {
  return String(rawHost || '')
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, '')
    .replace(/^\[(.+)\]$/, '$1');
}

function isLoopbackHost(rawHost: string | null | undefined) {
  const host = normalizeHost(rawHost);
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

export function resolveServerBridgeApiBaseUrl(request: Request, explicitBaseUrl?: string | null) {
  const explicit = String(explicitBaseUrl || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const requestHost =
    request.headers.get('x-forwarded-host') ||
    request.headers.get('host') ||
    request.headers.get('x-forwarded-server');

  if (isLoopbackHost(requestHost)) {
    return devDefaultBaseUrl;
  }

  if ((process.env.NODE_ENV || 'development') !== 'production') {
    return devDefaultBaseUrl;
  }

  return getApiBaseUrl().replace(/\/+$/, '');
}
