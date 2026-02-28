import { BuilderConfigSchema, type BuilderConfig } from '@querobroapp/shared';

const devDefaultBaseUrl = 'http://127.0.0.1:3001';
const runtimeConfigPaths = ['/runtime-config', '/builder/config'];

export function getApiBaseUrl() {
  return (process.env.NEXT_PUBLIC_API_URL || devDefaultBaseUrl).trim() || devDefaultBaseUrl;
}

export function resolveBuilderImageSrc(src: string) {
  if (/^https?:\/\//i.test(src)) return src;
  if (src.startsWith('/uploads/')) return `${getApiBaseUrl()}${src}`;
  return src;
}

export function getDefaultBuilderConfig() {
  return BuilderConfigSchema.parse({});
}

export async function fetchBuilderConfigServer(): Promise<BuilderConfig> {
  const fallback = getDefaultBuilderConfig();
  const baseUrl = getApiBaseUrl();

  for (const endpoint of runtimeConfigPaths) {
    try {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        method: 'GET',
        cache: 'no-store'
      });
      if (!response.ok) continue;

      const body = await response.json();
      return BuilderConfigSchema.parse(body);
    } catch {
      continue;
    }
  }

  return fallback;
}

export async function fetchBuilderConfigClient(): Promise<BuilderConfig> {
  const baseUrl = getApiBaseUrl();

  let lastStatus = 0;
  for (const endpoint of runtimeConfigPaths) {
    const response = await fetch(`${baseUrl}${endpoint}`, { method: 'GET' }).catch(() => null);
    if (!response) continue;
    if (!response.ok) {
      lastStatus = response.status;
      continue;
    }

    const body = await response.json();
    return BuilderConfigSchema.parse(body);
  }

  throw new Error(`Falha ao carregar configuracao interna: HTTP ${lastStatus || 0}`);
}
