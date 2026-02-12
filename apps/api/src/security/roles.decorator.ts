import { SetMetadata } from '@nestjs/common';
import type { AuthRole } from './security.types.js';

export const ROLES_KEY = 'routeRoles';
export const Roles = (...roles: AuthRole[]) => SetMetadata(ROLES_KEY, roles);
