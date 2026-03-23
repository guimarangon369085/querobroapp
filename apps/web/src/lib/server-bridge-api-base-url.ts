import {
  devDefaultBaseUrl,
  getApiBaseUrl,
  resolveProductionApiBaseUrlFromHostname
} from '@/lib/api-base-url';

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

function resolveRequestProtocol(request: Request) {
  const forwardedProto = String(request.headers.get('x-forwarded-proto') || '')
    .trim()
    .toLowerCase();
  if (forwardedProto === 'http' || forwardedProto === 'https') {
    return `${forwardedProto}:`;
  }

  try {
    const requestUrl = new URL(request.url);
    return requestUrl.protocol || 'https:';
  } catch {
    return 'https:';
  }
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

  const isProduction = (process.env.NODE_ENV || 'development') === 'production';
  if (!isProduction) {
    return devDefaultBaseUrl;
  }

  const inferredFromRequestHost = resolveProductionApiBaseUrlFromHostname(
    normalizeHost(requestHost),
    resolveRequestProtocol(request)
  );
  if (inferredFromRequestHost) {
    return inferredFromRequestHost.replace(/\/+$/, '');
  }

  return getApiBaseUrl().replace(/\/+$/, '');
}
