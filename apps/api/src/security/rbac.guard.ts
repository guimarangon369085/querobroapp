import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Inject
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { ROLES_KEY } from './roles.decorator.js';
import { getSecurityRuntimeConfig } from './security-config.js';
import type { AuthPrincipal, AuthRole } from './security.types.js';

type RequestLike = {
  method?: string;
  authPrincipal?: AuthPrincipal;
};

function isMutatingMethod(method: string) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
}

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    if (isPublic) return true;

    const config = getSecurityRuntimeConfig();
    if (!config.enabled) return true;

    const request = context.switchToHttp().getRequest<RequestLike>();
    const principal = request.authPrincipal;
    if (!principal) {
      throw new InternalServerErrorException('Principal de autenticacao ausente no contexto.');
    }

    const requiredRoles = this.reflector.getAllAndOverride<AuthRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    if (requiredRoles?.length && !requiredRoles.includes(principal.role)) {
      throw new ForbiddenException('Perfil sem permissao para este recurso.');
    }

    const method = (request.method || 'GET').toUpperCase();
    if (isMutatingMethod(method) && principal.role === 'viewer') {
      throw new ForbiddenException('Perfil viewer possui acesso somente leitura.');
    }

    return true;
  }
}
