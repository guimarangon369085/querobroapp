import {
  BuilderConfigSchema,
  type BuilderConfig,
  type BuilderConfigPatch,
  type BuilderHomeImage,
} from '@querobroapp/shared';

const devDefaultBaseUrl = 'http://127.0.0.1:3001';

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

  try {
    const response = await fetch(`${baseUrl}/builder/config`, {
      method: 'GET',
      cache: 'no-store',
    });
    if (!response.ok) return fallback;

    const body = await response.json();
    return BuilderConfigSchema.parse(body);
  } catch {
    return fallback;
  }
}

export async function fetchBuilderConfigClient(): Promise<BuilderConfig> {
  const baseUrl = getApiBaseUrl();
  const response = await fetch(`${baseUrl}/builder/config`, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`Falha ao carregar builder: HTTP ${response.status}`);
  }
  const body = await response.json();
  return BuilderConfigSchema.parse(body);
}

export async function updateBuilderConfigClient(patch: BuilderConfigPatch): Promise<BuilderConfig> {
  const baseUrl = getApiBaseUrl();
  const response = await fetch(`${baseUrl}/builder/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Falha ao salvar builder: HTTP ${response.status}${detail ? ` - ${detail}` : ''}`);
  }

  const body = await response.json();
  return BuilderConfigSchema.parse(body);
}

export async function uploadBuilderHomeImageClient(file: File, alt: string) {
  const baseUrl = getApiBaseUrl();
  const form = new FormData();
  form.set('file', file);
  form.set('alt', alt);

  const response = await fetch(`${baseUrl}/builder/home-images`, {
    method: 'POST',
    body: form,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Falha no upload: HTTP ${response.status}${detail ? ` - ${detail}` : ''}`);
  }

  const body = await response.json();
  return {
    config: BuilderConfigSchema.parse(body.config),
    image: body.image as BuilderHomeImage,
  };
}

export async function removeBuilderHomeImageClient(id: string): Promise<BuilderConfig> {
  const baseUrl = getApiBaseUrl();
  const response = await fetch(`${baseUrl}/builder/home-images/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Falha ao remover imagem: HTTP ${response.status}${detail ? ` - ${detail}` : ''}`);
  }

  const body = await response.json();
  return BuilderConfigSchema.parse(body);
}
