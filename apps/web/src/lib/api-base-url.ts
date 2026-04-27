import { getPublicAppOrigin } from '@/lib/public-site-config';

const devDefaultBaseUrl = 'http://127.0.0.1:3001';
const devDefaultWebOrigin = 'http://127.0.0.1:3000';
const productionApiHostname = 'api.querobroa.com.br';
const internalApiProxyPath = '/api/internal';

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.trim().toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1' || normalized === '[::1]';
}

function formatHostnameForUrl(hostname: string) {
  return hostname.includes(':') && !hostname.startsWith('[') ? `[${hostname}]` : hostname;
}

function extractHostname(rawUrl: string) {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return '';
  }
}

function normalizeBaseUrl(rawUrl?: string | null) {
  const normalized = String(rawUrl || '').trim();
  if (!normalized) return '';

  try {
    return new URL(normalized).toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function resolveProductionApiBaseUrlFromHostname(hostname: string, protocol = 'https:') {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized || isLoopbackHostname(normalized)) return '';

  if (
    normalized === 'querobroa.com.br' ||
    normalized === productionApiHostname ||
    normalized.endsWith('.querobroa.com.br')
  ) {
    return `${protocol}//${productionApiHostname}`;
  }

  return '';
}

function resolveProductionApiBaseUrlFromPublicAppOrigin() {
  const appOrigin = getPublicAppOrigin();
  if (!appOrigin) return '';

  try {
    const url = new URL(appOrigin);
    return resolveProductionApiBaseUrlFromHostname(url.hostname, url.protocol);
  } catch {
    return '';
  }
}

function getLocalDevBaseUrl(configuredBaseUrl?: string | null) {
  if (typeof window === 'undefined') return normalizeBaseUrl(configuredBaseUrl) || devDefaultBaseUrl;

  const hostname = window.location.hostname.trim();
  if (!isLoopbackHostname(hostname)) return normalizeBaseUrl(configuredBaseUrl) || devDefaultBaseUrl;

  const normalizedConfiguredBaseUrl = normalizeBaseUrl(configuredBaseUrl);
  if (normalizedConfiguredBaseUrl) {
    try {
      const url = new URL(normalizedConfiguredBaseUrl);
      if (isLoopbackHostname(url.hostname)) {
        url.hostname = hostname;
        return url.toString().replace(/\/+$/, '');
      }
    } catch {
      // usa o fallback padrao abaixo
    }
  }

  return `http://${formatHostnameForUrl(hostname)}:3001`;
}

export function getApiBaseUrl() {
  const configuredBaseUrl = normalizeBaseUrl(process.env.NEXT_PUBLIC_API_URL);
  const configuredHostname = extractHostname(configuredBaseUrl);

  if (typeof window !== 'undefined') {
    const browserHostname = window.location.hostname;

    if (isLoopbackHostname(browserHostname) && configuredHostname && !isLoopbackHostname(configuredHostname)) {
      return getLocalDevBaseUrl();
    }

    if (isLoopbackHostname(browserHostname)) {
      return getLocalDevBaseUrl(configuredBaseUrl);
    }

    if (configuredBaseUrl && !isLoopbackHostname(configuredHostname)) {
      return configuredBaseUrl;
    }

    const inferredBrowserBaseUrl = resolveProductionApiBaseUrlFromHostname(
      browserHostname,
      window.location.protocol || 'https:'
    );
    if (inferredBrowserBaseUrl) return inferredBrowserBaseUrl;
  }

  if (configuredBaseUrl && !isLoopbackHostname(configuredHostname)) return configuredBaseUrl;

  const inferredPublicBaseUrl = resolveProductionApiBaseUrlFromPublicAppOrigin();
  if (inferredPublicBaseUrl) return inferredPublicBaseUrl;

  return configuredBaseUrl || devDefaultBaseUrl;
}

export function getInternalApiBaseUrl() {
  if (typeof window !== 'undefined') {
    const browserHostname = window.location.hostname;
    if (isLoopbackHostname(browserHostname)) {
      return getLocalDevBaseUrl(normalizeBaseUrl(process.env.NEXT_PUBLIC_API_URL));
    }
    return `${window.location.origin}${internalApiProxyPath}`;
  }

  const origin = getPublicAppOrigin({ allowLocalFallback: true });
  if (origin) {
    return `${origin}${internalApiProxyPath}`;
  }

  return `${devDefaultWebOrigin}${internalApiProxyPath}`;
}

export { devDefaultBaseUrl, internalApiProxyPath, productionApiHostname, resolveProductionApiBaseUrlFromHostname };
