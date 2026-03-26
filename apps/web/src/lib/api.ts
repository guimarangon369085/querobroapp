import { devDefaultBaseUrl, getInternalApiBaseUrl } from '@/lib/api-base-url';

function toAbsoluteUrl(path: string) {
  const baseUrl = getInternalApiBaseUrl();
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith('/')) return `${baseUrl}${path}`;
  return `${baseUrl}/${path}`;
}

function extractErrorMessage(body: unknown) {
  if (typeof body === 'string') return body;
  if (!body || typeof body !== 'object') return '';

  const record = body as Record<string, unknown>;
  if (Array.isArray(record.formErrors) || (record.fieldErrors && typeof record.fieldErrors === 'object')) {
    const formErrors = Array.isArray(record.formErrors)
      ? record.formErrors.map((value) => String(value)).filter(Boolean)
      : [];
    const fieldErrors =
      record.fieldErrors && typeof record.fieldErrors === 'object'
        ? Object.values(record.fieldErrors as Record<string, unknown>)
            .flatMap((value) =>
              Array.isArray(value) ? value.map((entry) => String(entry)) : [String(value)]
            )
            .filter(Boolean)
        : [];
    const merged = [...formErrors, ...fieldErrors];
    if (merged.length) return merged.join('; ');
  }

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
  const headers = new Headers(options?.headers || undefined);
  const body = options?.body;
  const hasExplicitContentType = headers.has('Content-Type');
  const shouldSetJsonContentType =
    body != null &&
    !hasExplicitContentType &&
    !(body instanceof FormData) &&
    !(body instanceof URLSearchParams) &&
    !(body instanceof Blob) &&
    !(body instanceof ArrayBuffer) &&
    !ArrayBuffer.isView(body);

  if (shouldSetJsonContentType) {
    headers.set('Content-Type', 'application/json');
  }

  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      headers
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
