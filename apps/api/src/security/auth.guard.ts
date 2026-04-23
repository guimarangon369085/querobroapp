import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, Inject } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { getSecurityRuntimeConfig } from './security-config.js';
import type { AuthPrincipal } from './security.types.js';

type RequestLike = {
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

    const appTokenHeader = getHeaderValue(request.headers, 'x-app-token');
    const bearerToken = extractBearerToken(request.headers);
    const token = appTokenHeader || bearerToken;
    if (!token) {
      throw new UnauthorizedException('Autenticação obrigatória. Envie x-app-token ou Authorization Bearer.');
    }

    const principal = config.tokensBySecret.get(token);
    if (!principal) {
      throw new UnauthorizedException('Token inválido.');
    }

    request.authPrincipal = principal;
    return true;
  }
}
