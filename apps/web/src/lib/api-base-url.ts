const devDefaultBaseUrl = 'http://127.0.0.1:3001';

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

function getLocalDevBaseUrl() {
  if (typeof window === 'undefined') return devDefaultBaseUrl;
  const hostname = window.location.hostname.trim();
  if (!isLoopbackHostname(hostname)) return devDefaultBaseUrl;
  return `http://${formatHostnameForUrl(hostname)}:3001`;
}

export function getApiBaseUrl() {
  const configuredBaseUrl = (process.env.NEXT_PUBLIC_API_URL || '').trim();

  if (typeof window !== 'undefined') {
    const browserHostname = window.location.hostname;
    const configuredHostname = extractHostname(configuredBaseUrl);

    if (isLoopbackHostname(browserHostname) && configuredHostname && !isLoopbackHostname(configuredHostname)) {
      return getLocalDevBaseUrl();
    }
  }

  return configuredBaseUrl || devDefaultBaseUrl;
}

export { devDefaultBaseUrl };
