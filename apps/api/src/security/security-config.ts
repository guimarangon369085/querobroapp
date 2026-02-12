import { authRoles, type AuthRole } from './security.types.js';

type RoleToken = {
  role: AuthRole;
  tokenLabel: string;
};

type SecurityRuntimeConfig = {
  enabled: boolean;
  tokensBySecret: Map<string, RoleToken>;
  receiptsToken: string;
};

const authRoleSet = new Set<AuthRole>(authRoles);

function parseBooleanEnv(value: string | undefined, fallback: boolean) {
  const normalized = (value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseAuthEnabled() {
  const env = process.env.APP_AUTH_ENABLED;
  const isDev = (process.env.NODE_ENV || 'development') === 'development';
  return parseBooleanEnv(env, !isDev);
}

function parseRoleToken(raw: string, index: number): [string, RoleToken] | null {
  const pair = raw.trim();
  if (!pair) return null;

  const splitIndex = pair.indexOf(':');
  if (splitIndex <= 0) return null;

  const rawRole = pair.slice(0, splitIndex).trim().toLowerCase() as AuthRole;
  const token = pair.slice(splitIndex + 1).trim();
  if (!authRoleSet.has(rawRole) || !token) return null;

  return [token, { role: rawRole, tokenLabel: `APP_AUTH_TOKENS[${index}]` }];
}

function parseAuthTokens() {
  const bySecret = new Map<string, RoleToken>();

  const adminToken = (process.env.APP_AUTH_TOKEN || '').trim();
  if (adminToken) {
    bySecret.set(adminToken, { role: 'admin', tokenLabel: 'APP_AUTH_TOKEN' });
  }

  const rawPairs = (process.env.APP_AUTH_TOKENS || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  for (const [index, rawPair] of rawPairs.entries()) {
    const parsed = parseRoleToken(rawPair, index);
    if (!parsed) continue;
    bySecret.set(parsed[0], parsed[1]);
  }

  return bySecret;
}

let cachedConfig: SecurityRuntimeConfig | null = null;

export function getSecurityRuntimeConfig() {
  if (cachedConfig) return cachedConfig;

  cachedConfig = {
    enabled: parseAuthEnabled(),
    tokensBySecret: parseAuthTokens(),
    receiptsToken: (process.env.RECEIPTS_API_TOKEN || '').trim()
  };

  return cachedConfig;
}
