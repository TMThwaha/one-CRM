import "server-only";
import { and, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { invitations, organizationMembers, rolePermissions, roles } from "@/server/db/schema";
import { withTenant } from "@/server/db/tenant";
import { audit } from "@/server/platform/audit";
import { conflict, forbidden, invalid, notFound } from "@/server/platform/errors";
import { covers, validatePermissionSet, type PermissionMap } from "@/shared/permissions";
import { roleInputSchema } from "@/shared/schemas/identity";
import { require as requirePerm, type AuthContext } from "./context";
import { assertCanGrantRole } from "./team.service";

const MAX_CUSTOM_ROLES = 50;

function slug(name: string): string {
  const s = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return s || "role";
}

/**
 * Parses and checks a role definition. The server is the authority: the UI hides what you cannot do,
 * but a hand-made request is held to exactly the same rules.
 *  1. only permissions that exist, with a scope that permission really supports
 *  2. internally coherent (a "write" needs its "read", at least as broad)
 *  3. nothing the actor does not hold themselves (no privilege escalation through a role)
 */
function parse(ctx: AuthContext, input: unknown) {
  const data = roleInputSchema.parse(input);
  const problems = validatePermissionSet(data.permissions);
  if (problems.length) throw invalid(problems[0], { problems });
  if (Object.keys(data.permissions).length === 0) throw invalid("Choose at least one permission");
  if (!covers(ctx.permissions, data.permissions as PermissionMap)) {
    throw forbidden("You can only give a role permissions you hold yourself");
  }
  return data;
}

function diff(before: Record<string, string>, after: Record<string, string>) {
  const added = Object.keys(after).filter((k) => !(k in before));
  const removed = Object.keys(before).filter((k) => !(k in after));
  const changed = Object.keys(after).filter((k) => k in before && before[k] !== after[k]).map((k) => ({ permission: k, from: before[k], to: after[k] }));
  return { added, removed, changed };
}

export async function createRole(ctx: AuthContext, input: unknown) {
  requirePerm(ctx, "role.manage");
  const data = parse(ctx, input);
  return withTenant(ctx, async (tx) => {
    const existing = await tx.select({ name: roles.name, key: roles.key, isSystem: roles.isSystem }).from(roles);
    if (existing.some((r) => r.name.toLowerCase() === data.name.toLowerCase())) throw conflict("A role with that name already exists");
    if (existing.filter((r) => !r.isSystem).length >= MAX_CUSTOM_ROLES) throw conflict(`An organization can have at most ${MAX_CUSTOM_ROLES} custom roles`);

    const taken = new Set(existing.map((r) => r.key));
    let key = `custom_${slug(data.name)}`;
    for (let i = 2; taken.has(key); i++) key = `custom_${slug(data.name)}_${i}`;

    const [role] = await tx
      .insert(roles)
      .values({ organizationId: ctx.organizationId, key, name: data.name, description: data.description, isSystem: false })
      .returning({ id: roles.id, key: roles.key, name: roles.name });
    await tx.insert(rolePermissions).values(
      Object.entries(data.permissions).map(([permission, scope]) => ({ roleId: role.id, organizationId: ctx.organizationId, permission, scope })),
    );
    await audit(tx, ctx, {
      action: "role.created",
      entityType: "role",
      entityId: role.id,
      summary: `Created role ${role.name}`,
      changes: { permissions: data.permissions },
    });
    return role;
  });
}

export async function updateRole(ctx: AuthContext, roleId: string, input: unknown) {
  requirePerm(ctx, "role.manage");
  const data = parse(ctx, input);
  return withTenant(ctx, async (tx) => {
    const [role] = await tx.select().from(roles).where(eq(roles.id, roleId));
    if (!role) throw notFound("Role");
    if (role.isSystem) throw conflict("System roles cannot be edited. Create a custom role instead.");
    // You cannot rewrite a role that is more powerful than you are.
    await assertCanGrantRole(tx, ctx, role.id);

    const [clash] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(sql`lower(${roles.name}) = ${data.name.toLowerCase()}`, ne(roles.id, role.id)));
    if (clash) throw conflict("A role with that name already exists");

    const beforeRows = await tx.select({ permission: rolePermissions.permission, scope: rolePermissions.scope }).from(rolePermissions).where(eq(rolePermissions.roleId, role.id));
    const before = Object.fromEntries(beforeRows.map((r) => [r.permission, r.scope]));
    const changes = diff(before, data.permissions);
    const nameChanged = role.name !== data.name || (role.description ?? null) !== (data.description ?? null);
    if (!nameChanged && !changes.added.length && !changes.removed.length && !changes.changed.length) return { id: role.id, changed: false };

    await tx.update(roles).set({ name: data.name, description: data.description }).where(eq(roles.id, role.id));
    await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, role.id));
    await tx.insert(rolePermissions).values(
      Object.entries(data.permissions).map(([permission, scope]) => ({ roleId: role.id, organizationId: ctx.organizationId, permission, scope })),
    );
    await audit(tx, ctx, {
      action: "role.updated",
      entityType: "role",
      entityId: role.id,
      summary: `Updated role ${data.name}`,
      changes: { ...changes, renamedFrom: role.name !== data.name ? role.name : undefined },
    });
    // Nothing else to do: every request re-reads a member's role, so the change applies on their next request.
    return { id: role.id, changed: true };
  });
}

export async function deleteRole(ctx: AuthContext, roleId: string) {
  requirePerm(ctx, "role.manage");
  return withTenant(ctx, async (tx) => {
    const [role] = await tx.select().from(roles).where(eq(roles.id, roleId));
    if (!role) throw notFound("Role");
    if (role.isSystem) throw conflict("System roles cannot be deleted");
    await assertCanGrantRole(tx, ctx, role.id);

    const [m] = await tx.select({ n: sql<number>`count(*)::int` }).from(organizationMembers).where(eq(organizationMembers.roleId, role.id));
    const [i] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(invitations)
      .where(and(eq(invitations.roleId, role.id), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, new Date())));
    if (m.n > 0 || i.n > 0) {
      const parts = [m.n > 0 ? `${m.n} ${m.n === 1 ? "person has" : "people have"} this role` : null, i.n > 0 ? `${i.n} pending ${i.n === 1 ? "invitation uses" : "invitations use"} it` : null].filter(Boolean);
      throw conflict(`${parts.join(" and ")}. Move them to another role first.`);
    }
    await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, role.id));
    // Spent invitations (accepted, revoked or expired) still reference the role through a foreign key.
    // They are history, already recorded in the audit log ("member.invited"), so they go with the role.
    await tx.delete(invitations).where(eq(invitations.roleId, role.id));
    await tx.delete(roles).where(eq(roles.id, role.id));
    await audit(tx, ctx, { action: "role.deleted", entityType: "role", entityId: role.id, summary: `Deleted role ${role.name}` });
    return { id: role.id };
  });
}
