export const authRoles = ['admin', 'operator', 'viewer'] as const;

export type AuthRole = (typeof authRoles)[number];

export type AuthPrincipal = {
  role: AuthRole;
  tokenLabel: string;
};
