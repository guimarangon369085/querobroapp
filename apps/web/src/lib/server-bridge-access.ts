import {
  isLoopbackHost,
  isOpsOrLoopbackHost,
  normalizeHost,
  resolveRequestHostFromHeaders
} from '@/lib/public-site-config';

function resolveUrlHost(value?: string | null) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  try {
    return normalizeHost(new URL(raw).host);
  } catch {
    return null;
  }
}

function hostsMatch(left?: string | null, right?: string | null) {
  const normalizedLeft = normalizeHost(left);
  const normalizedRight = normalizeHost(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;
  return isLoopbackHost(normalizedLeft) && isLoopbackHost(normalizedRight);
}

export function resolveRequestHost(request: Request) {
  return resolveRequestHostFromHeaders(request.headers);
}

export function isTrustedSameOriginBridgeRequest(request: Request) {
  const requestHost = resolveRequestHost(request);
  if (!requestHost) return false;

  const fetchSite = String(request.headers.get('sec-fetch-site') || '').trim().toLowerCase();
  if (fetchSite === 'same-origin') {
    return true;
  }

  const originHeader = request.headers.get('origin');
  if (originHeader != null) {
    return hostsMatch(resolveUrlHost(originHeader), requestHost);
  }

  const refererHeader = request.headers.get('referer');
  if (refererHeader != null) {
    return hostsMatch(resolveUrlHost(refererHeader), requestHost);
  }

  const isProduction = (process.env.NODE_ENV || 'development') === 'production';
  return !isProduction && isLoopbackHost(requestHost);
}

export function isTrustedDashboardBridgeRequest(request: Request) {
  const requestHost = resolveRequestHost(request);
  if (!isOpsOrLoopbackHost(requestHost)) {
    return false;
  }
  return isTrustedSameOriginBridgeRequest(request);
}
