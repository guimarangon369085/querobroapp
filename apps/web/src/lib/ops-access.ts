export type OpsAccessRole = 'admin' | 'operator' | 'viewer';

type OpsCredential = {
  role: OpsAccessRole;
  label: string;
};

type OpsAccessConfig = {
  enabled: boolean;
  credentialsBySecret: Map<string, OpsCredential>;
  signingSecret: string;
  sessionTtlSeconds: number;
};

const OPS_SESSION_TTL_SECONDS = 60 * 60 * 24 * 180;
export const OPS_SESSION_COOKIE_NAME = 'querobroapp_ops_session';

const STATIC_PUBLIC_PREFIXES = ['/querobroa-brand/', '/uploads/', '/_next/'];
const PUBLIC_API_PREFIXES = [
  '/api/analytics/track',
  '/api/customer-form',
  '/api/delivery-quote',
  '/api/google-form',
  '/api/ops-auth',
  '/api/order-schedule',
  '/api/runtime-theme'
];
const PUBLIC_METADATA_PATHS = new Set(['/favicon.ico', '/icon.png', '/manifest.webmanifest', '/robots.txt', '/sitemap.xml']);

function parseBooleanEnv(value: string | undefined, fallback: boolean) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseRoleToken(raw: string, index: number): [string, OpsCredential] | null {
  const value = raw.trim();
  if (!value) return null;

  const splitIndex = value.indexOf(':');
  if (splitIndex <= 0) return null;

  const role = value.slice(0, splitIndex).trim().toLowerCase() as OpsAccessRole;
  const secret = value.slice(splitIndex + 1).trim();
  if (!secret || !['admin', 'operator', 'viewer'].includes(role)) return null;

  return [secret, { role, label: `APP_AUTH_TOKENS[${index}]` }];
}

let cachedConfig: OpsAccessConfig | null = null;

export function getOpsAccessConfig() {
  if (cachedConfig) return cachedConfig;

  const credentialsBySecret = new Map<string, OpsCredential>();

  const adminToken = String(process.env.APP_AUTH_TOKEN || '').trim();
  if (adminToken) {
    credentialsBySecret.set(adminToken, { role: 'admin', label: 'APP_AUTH_TOKEN' });
  }

  const internalBasicPassword = String(process.env.INTERNAL_BASIC_AUTH_PASSWORD || '').trim();
  const internalBasicUser = String(process.env.INTERNAL_BASIC_AUTH_USER || '').trim() || 'operacao';
  if (internalBasicPassword) {
    credentialsBySecret.set(internalBasicPassword, {
      role: 'operator',
      label: `INTERNAL_BASIC_AUTH_PASSWORD(${internalBasicUser})`
    });
  }

  const rawPairs = String(process.env.APP_AUTH_TOKENS || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  for (const [index, rawPair] of rawPairs.entries()) {
    const parsed = parseRoleToken(rawPair, index);
    if (!parsed) continue;
    credentialsBySecret.set(parsed[0], parsed[1]);
  }

  const bridgeToken = String(process.env.APP_API_BRIDGE_TOKEN || '').trim();
  if (bridgeToken && !credentialsBySecret.has(bridgeToken)) {
    credentialsBySecret.set(bridgeToken, { role: 'admin', label: 'APP_API_BRIDGE_TOKEN' });
  }

  const hasCredentials = credentialsBySecret.size > 0;
  const isProduction = (process.env.NODE_ENV || 'development') === 'production';
  const enabled = parseBooleanEnv(process.env.APP_OPS_AUTH_ENABLED, isProduction ? true : hasCredentials);
  const signingSecret =
    String(process.env.APP_OPS_SESSION_SECRET || '').trim() ||
    bridgeToken ||
    adminToken ||
    credentialsBySecret.keys().next().value ||
    '';

  cachedConfig = {
    enabled,
    credentialsBySecret,
    signingSecret,
    sessionTtlSeconds: OPS_SESSION_TTL_SECONDS
  };

  return cachedConfig;
}

export function isPublicOrderPath(pathname: string) {
  return pathname === '/pedido' || pathname.startsWith('/pedido/');
}

export function isPublicOrderCompletionPath(pathname: string) {
  return pathname === '/pedidofinalizado';
}

export function isPublicLandingPath(pathname: string) {
  return pathname === '/';
}

export function isOpsAccessPath(pathname: string) {
  return pathname === '/acesso';
}

export function isPublicPagePath(pathname: string) {
  return (
    isPublicLandingPath(pathname) ||
    isPublicOrderPath(pathname) ||
    isPublicOrderCompletionPath(pathname) ||
    isOpsAccessPath(pathname)
  );
}

export function isProtectedInternalApiPath(pathname: string) {
  return pathname === '/api/internal' || pathname.startsWith('/api/internal/');
}

function isStaticAssetPath(pathname: string) {
  if (PUBLIC_METADATA_PATHS.has(pathname)) return true;
  if (STATIC_PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
  return /\.[a-z0-9]+$/i.test(pathname);
}

export function isProtectedOpsPath(pathname: string) {
  if (isProtectedInternalApiPath(pathname)) return true;
  if (pathname.startsWith('/api/')) {
    return !PUBLIC_API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  }
  if (isStaticAssetPath(pathname)) return false;
  return !isPublicPagePath(pathname);
}

export function resolveSafeNextPath(value?: string | null) {
  const normalized = String(value || '').trim();
  if (!normalized.startsWith('/')) return '/pedidos';
  if (normalized.startsWith('//')) return '/pedidos';
  if (normalized.startsWith('/api/ops-auth')) return '/pedidos';
  return normalized;
}
