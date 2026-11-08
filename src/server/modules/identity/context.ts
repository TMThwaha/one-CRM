import { forbidden } from "@/server/platform/errors";
import type { Permission, PermissionMap, Scope } from "@/shared/permissions";

/**
 * The authenticated, organization-scoped identity for one request. Built server-side from the
 * session cookie; the organization is NEVER taken from client input.
 */
export interface AuthContext {
  userId: string;
  userName: string;
  userEmail: string;
  organizationId: string;
  membershipId: string;
  roleKey: string;
  roleName: string;
  sessionId: string;
  permissions: PermissionMap;
  ip?: string | null;
}

/**
 * What personal-account operations (2FA, password, sessions) need: a person and their session, with
 * no company. Both a company AuthContext and a Super Admin PlatformContext satisfy it.
 */
export type AccountContext = Pick<AuthContext, "userId" | "userName" | "userEmail" | "sessionId" | "ip">;

export function can(ctx: AuthContext, permission: Permission): boolean {
  return ctx.permissions[permission] !== undefined;
}

/** Throws unless the permission is held; returns its record scope. */
export function require(ctx: AuthContext, permission: Permission): Scope {
  const scope = ctx.permissions[permission];
  if (!scope) throw forbidden(`Missing permission: ${permission}`);
  return scope;
}

/** True when record-level filtering must be applied (anything narrower than `all`). */
export function isOwnOnly(scope: Scope): boolean {
  return scope !== "all";
}
