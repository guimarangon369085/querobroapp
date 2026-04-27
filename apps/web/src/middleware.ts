import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
  getOpsAccessConfig,
  isOpsAccessPath,
  isProtectedInternalApiPath,
  isProtectedOpsPath,
  resolveSafeNextPath
} from '@/lib/ops-access';
import { getOpsSessionCookieOptions, readValidOpsSession } from '@/lib/ops-session';

async function redirectToAccess(request: NextRequest) {
  const accessUrl = new URL('/acesso', request.url);
  const requestedPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  accessUrl.searchParams.set('next', resolveSafeNextPath(requestedPath));

  const cookieOptions = getOpsSessionCookieOptions(request.url);
  const response = NextResponse.redirect(accessUrl);
  response.cookies.set({
    ...cookieOptions,
    value: '',
    maxAge: 0
  });
  return response;
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const config = getOpsAccessConfig();
  const cookieOptions = getOpsSessionCookieOptions(request.url);
  const session = await readValidOpsSession(request.cookies.get(cookieOptions.name)?.value);

  if (isOpsAccessPath(pathname)) {
    if (!config.enabled || session) {
      return NextResponse.redirect(new URL(resolveSafeNextPath(request.nextUrl.searchParams.get('next')), request.url));
    }
    return NextResponse.next();
  }

  if (!config.enabled || !isProtectedOpsPath(pathname)) {
    return NextResponse.next();
  }

  if (!session) {
    if (isProtectedInternalApiPath(pathname)) {
      return NextResponse.json({ message: 'Sessao operacional obrigatoria.' }, { status: 401 });
    }
    return redirectToAccess(request);
  }

  const response = NextResponse.next();
  response.cookies.set({
    ...cookieOptions,
    value: request.cookies.get(cookieOptions.name)?.value || ''
  });
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)']
};
