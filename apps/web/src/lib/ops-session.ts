import { getOpsAccessConfig, type OpsAccessRole, OPS_SESSION_COOKIE_NAME } from '@/lib/ops-access';
import { isLoopbackHost } from '@/lib/public-site-config';

type OpsSessionPayload = {
  role: OpsAccessRole;
  label: string;
  issuedAt: number;
  expiresAt: number;
};

function getSubtleCrypto() {
  const cryptoLike = globalThis.crypto;
  if (!cryptoLike?.subtle) {
    throw new Error('Web Crypto indisponivel para assinar sessao operacional.');
  }
  return cryptoLike.subtle;
}

function bytesToBase64(bytes: Uint8Array) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }

  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(value, 'base64'));
  }

  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function encodeBase64Url(value: string | Uint8Array) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return base64ToBytes(padded);
}

async function importSigningKey(secret: string) {
  return getSubtleCrypto().importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function signPayload(serializedPayload: string, secret: string) {
  const key = await importSigningKey(secret);
  const signature = await getSubtleCrypto().sign('HMAC', key, new TextEncoder().encode(serializedPayload));
  return encodeBase64Url(new Uint8Array(signature));
}

export async function createOpsSessionCookieValue(input: { role: OpsAccessRole; label: string }) {
  const config = getOpsAccessConfig();
  if (!config.signingSecret) {
    throw new Error('Segredo de sessao operacional nao configurado.');
  }

  const now = Date.now();
  const payload: OpsSessionPayload = {
    role: input.role,
    label: input.label,
    issuedAt: now,
    expiresAt: now + config.sessionTtlSeconds * 1000
  };
  const serializedPayload = JSON.stringify(payload);
  const encodedPayload = encodeBase64Url(serializedPayload);
  const signature = await signPayload(encodedPayload, config.signingSecret);
  return `${encodedPayload}.${signature}`;
}

export async function readValidOpsSession(cookieValue?: string | null) {
  const raw = String(cookieValue || '').trim();
  if (!raw) return null;

  const config = getOpsAccessConfig();
  if (!config.signingSecret) return null;

  const [encodedPayload, signature] = raw.split('.');
  if (!encodedPayload || !signature) return null;

  const key = await importSigningKey(config.signingSecret);
  const isValid = await getSubtleCrypto().verify(
    'HMAC',
    key,
    decodeBase64Url(signature),
    new TextEncoder().encode(encodedPayload)
  );
  if (!isValid) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedPayload))) as OpsSessionPayload;
    if (!payload || typeof payload !== 'object') return null;
    if (!payload.role || !payload.label || !payload.expiresAt) return null;
    if (payload.expiresAt <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function shouldUseSecureCookie(requestUrl?: string | URL) {
  const isProduction = (process.env.NODE_ENV || 'development') === 'production';
  if (!isProduction) return false;
  if (!requestUrl) return true;

  try {
    const url = typeof requestUrl === 'string' ? new URL(requestUrl) : requestUrl;
    return !isLoopbackHost(url.hostname);
  } catch {
    return true;
  }
}

export function getOpsSessionCookieOptions(requestUrl?: string | URL) {
  const config = getOpsAccessConfig();

  return {
    name: OPS_SESSION_COOKIE_NAME,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: shouldUseSecureCookie(requestUrl),
    path: '/',
    maxAge: config.sessionTtlSeconds
  };
}
