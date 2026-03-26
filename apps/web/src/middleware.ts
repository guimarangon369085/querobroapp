import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const PUBLIC_PAGE_PREFIXES = ['/', '/pedido', '/pedidofinalizado'];
const INTERNAL_API_PREFIXES = ['/api/internal'];

function isStaticAssetPath(pathname: string) {
  return (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/images/') ||
    pathname.startsWith('/uploads/') ||
    pathname === '/favicon.ico' ||
    pathname === '/manifest.webmanifest' ||
    pathname === '/robots.txt' ||
    pathname === '/sitemap.xml' ||
    /\.[a-z0-9]+$/i.test(pathname)
  );
}

function isPublicPagePath(pathname: string) {
  return PUBLIC_PAGE_PREFIXES.some((prefix) => {
    if (prefix === '/') return pathname === '/';
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
  });
}

function isProtectedPath(pathname: string) {
  if (isStaticAssetPath(pathname)) return false;
  if (INTERNAL_API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return true;
  if (pathname.startsWith('/api/')) return false;
  return !isPublicPagePath(pathname);
}

function decodeBasicAuth(value: string) {
  try {
    const decoded = atob(value);
    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex < 0) return null;
    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1)
    };
  } catch {
    return null;
  }
}

function buildUnauthorizedResponse() {
  return new NextResponse('Autenticacao obrigatoria para a operacao interna.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="QUEROBROAPP Operacao", charset="UTF-8"'
    }
  });
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!isProtectedPath(pathname)) {
    return NextResponse.next();
  }

  const username = String(process.env.INTERNAL_BASIC_AUTH_USER || '').trim();
  const password = String(process.env.INTERNAL_BASIC_AUTH_PASSWORD || '').trim();
  const isProduction = (process.env.NODE_ENV || 'development') === 'production';

  if (!username || !password) {
    if (!isProduction) {
      return NextResponse.next();
    }
    return new NextResponse('INTERNAL_BASIC_AUTH_USER e INTERNAL_BASIC_AUTH_PASSWORD sao obrigatorios em producao.', {
      status: 503
    });
  }

  const authorization = request.headers.get('authorization') || '';
  const match = authorization.match(/^Basic\s+(.+)$/i);
  if (!match) {
    return buildUnauthorizedResponse();
  }

  const credentials = decodeBasicAuth(match[1] || '');
  if (!credentials || credentials.username !== username || credentials.password !== password) {
    return buildUnauthorizedResponse();
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/:path*'
};
