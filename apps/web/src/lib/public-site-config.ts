const LOCAL_DEV_WEB_ORIGIN = 'http://127.0.0.1:3000';

function normalizeUrlOrigin(value?: string | null) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  try {
    return new URL(withProtocol).origin;
  } catch {
    return null;
  }
}

function getOriginCandidates() {
  return [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.APP_PUBLIC_BASE_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL
  ]
    .map((value) => normalizeUrlOrigin(value))
    .filter((value): value is string => Boolean(value));
}

export function getPublicAppOrigin(options?: { allowLocalFallback?: boolean }) {
  const origin = getOriginCandidates()[0];
  if (origin) return origin;
  if (options?.allowLocalFallback) return LOCAL_DEV_WEB_ORIGIN;
  return null;
}

export function buildPublicAppUrl(pathname: string, options?: { allowLocalFallback?: boolean }) {
  const origin = getPublicAppOrigin(options);
  if (!origin) return null;
  return new URL(pathname, origin).toString();
}

export function normalizeHost(value?: string | null) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, '');
}

export function isLoopbackHost(hostname?: string | null) {
  const normalized = normalizeHost(hostname);
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '[::1]'
  );
}

export function isOpsHost(hostname?: string | null) {
  const normalized = normalizeHost(hostname);
  return normalized === 'ops.querobroa.com.br' || normalized.startsWith('ops.');
}

export function isOpsOrLoopbackHost(hostname?: string | null) {
  return isOpsHost(hostname) || isLoopbackHost(hostname);
}

export function resolveRequestHostFromHeaders(headersLike: Pick<Headers, 'get'>) {
  return normalizeHost(
    headersLike.get('x-forwarded-host') ||
      headersLike.get('host') ||
      headersLike.get('x-forwarded-server')
  );
}
