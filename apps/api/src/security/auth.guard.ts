import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, Inject } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { getSecurityRuntimeConfig } from './security-config.js';
import type { AuthPrincipal } from './security.types.js';

type RequestLike = {
  method?: string;
  originalUrl?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  authPrincipal?: AuthPrincipal;
};

function getHeaderValue(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) return (value[0] || '').trim();
  return (value || '').trim();
}

function extractPath(request: RequestLike) {
  const raw = request.originalUrl || request.url || '';
  const [path] = raw.split('?');
  return path || '/';
}

function extractBearerToken(headers: Record<string, string | string[] | undefined>) {
  const authHeader = getHeaderValue(headers, 'authorization');
  if (!authHeader) return '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestLike>();
    const config = getSecurityRuntimeConfig();
    if (!config.enabled) return true;

    const path = extractPath(request);
    if (path === '/health') return true;

    const receiptsTokenHeader = getHeaderValue(request.headers, 'x-receipts-token');
    if (
      path.startsWith('/receipts/') &&
      config.receiptsToken &&
      receiptsTokenHeader &&
      receiptsTokenHeader === config.receiptsToken
    ) {
      request.authPrincipal = {
        role: 'operator',
        tokenLabel: 'RECEIPTS_API_TOKEN'
      };
      return true;
    }

    const appTokenHeader = getHeaderValue(request.headers, 'x-app-token');
    const bearerToken = extractBearerToken(request.headers);
    const token = appTokenHeader || bearerToken;
    if (!token) {
      throw new UnauthorizedException('Autenticacao obrigatoria. Envie x-app-token ou Authorization Bearer.');
    }

    const principal = config.tokensBySecret.get(token);
    if (!principal) {
      throw new UnauthorizedException('Token invalido.');
    }

    request.authPrincipal = principal;
    return true;
  }
}
