import { getPublicAppOrigin } from '@/lib/public-site-config';

const devDefaultBaseUrl = 'http://127.0.0.1:3001';
const productionApiHostname = 'api.querobroa.com.br';

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

function getLocalDevBaseUrl() {
  if (typeof window === 'undefined') return devDefaultBaseUrl;
  const hostname = window.location.hostname.trim();
  if (!isLoopbackHostname(hostname)) return devDefaultBaseUrl;
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
      return getLocalDevBaseUrl();
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

export { devDefaultBaseUrl };
