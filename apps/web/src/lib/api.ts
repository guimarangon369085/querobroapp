const devDefaultBaseUrl = 'http://127.0.0.1:3001';
const baseUrl = (process.env.NEXT_PUBLIC_API_URL || devDefaultBaseUrl).trim() || devDefaultBaseUrl;

function toAbsoluteUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith('/')) return `${baseUrl}${path}`;
  return `${baseUrl}/${path}`;
}

function extractErrorMessage(body: unknown) {
  if (typeof body === 'string') return body;
  if (!body || typeof body !== 'object') return '';

  const record = body as Record<string, unknown>;
  if (typeof record.message === 'string') return record.message;
  if (Array.isArray(record.message)) {
    return record.message.map((value) => String(value)).join('; ');
  }
  if (typeof record.error === 'string') return record.error;

  try {
    return JSON.stringify(body);
  } catch {
    return '';
  }
}

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = toAbsoluteUrl(path);
  const method = (options?.method || 'GET').toUpperCase();

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
      ...options
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error';
    throw new Error(
      `[apiFetch] ${method} ${url} failed to fetch (${reason}). Dicas: API offline em ${devDefaultBaseUrl} ou bloqueio de CORS.`
    );
  }

  if (!res.ok) {
    const contentType = res.headers.get('content-type') || '';
    let body: unknown = '';

    try {
      body = contentType.includes('application/json') ? await res.json() : await res.text();
    } catch {
      body = '';
    }

    const detail = extractErrorMessage(body);
    const suffix = detail ? `: ${detail}` : '';
    throw new Error(`[apiFetch] ${method} ${url} -> HTTP ${res.status} ${res.statusText}${suffix}`);
  }

  if (res.status === 204) return undefined as T;

  const raw = await res.text();
  if (!raw) return undefined as T;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as T;
  }
}
