import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { getDatabase } from "@/server/db/client";
import {
  invitations,
  organizationMembers,
  organizations,
  rolePermissions,
  roles,
  users,
} from "@/server/db/schema";
import { withTenant, type Tx } from "@/server/db/tenant";
import { audit } from "@/server/platform/audit";
import { getConfig } from "@/server/platform/config";
import { hashPassword, hashToken, newToken, verifyPassword } from "@/server/platform/crypto";
import { conflict, forbidden, invalid, notFound, unauthenticated } from "@/server/platform/errors";
import { sendBestEffort } from "@/server/platform/mailer";
import { enforceRateLimit } from "@/server/platform/rate-limit";
import type { Permission, Scope } from "@/shared/permissions";
import {
  acceptInviteSchema,
  inviteSchema,
  passwordSchema,
  updateMemberSchema,
  type AcceptInviteInput,
  type InviteInput,
} from "@/shared/schemas/identity";
import { _issueSession, isPlatformAdmin, type IssuedSession, type RequestMeta } from "./auth.service";
import { require as requirePerm, type AuthContext } from "./context";

const INVITE_TTL_DAYS = 7;
const SCOPE_RANK: Record<Scope, number> = { own: 0, team: 1, all: 2 };

/**
 * Privilege-escalation guard: you can only grant a role whose every permission you already
 * hold at an equal or broader scope. An Admin therefore cannot mint an Owner.
 */
export async function assertCanGrantRole(tx: Tx, ctx: AuthContext, roleId: string) {
  const perms = await tx
    .select({ permission: rolePermissions.permission, scope: rolePermissions.scope })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, roleId));
  for (const p of perms) {
    const held = ctx.permissions[p.permission as Permission];
    if (!held || SCOPE_RANK[held] < SCOPE_RANK[p.scope as Scope]) {
      throw forbidden("You cannot assign a role with more privileges than your own");
    }
  }
}

async function roleByKey(tx: Tx, key: string) {
  const [role] = await tx.select().from(roles).where(eq(roles.key, key));
  if (!role) throw invalid(`Unknown role: ${key}`);
  return role;
}

// ---------------------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------------------

export async function listMembers(ctx: AuthContext) {
  requirePerm(ctx, "member.read");
  return withTenant(ctx, (tx) =>
    tx
      .select({
        membershipId: organizationMembers.id,
        userId: users.id,
        name: users.name,
        email: users.email,
        status: organizationMembers.status,
        jobTitle: organizationMembers.jobTitle,
        roleKey: roles.key,
        roleName: roles.name,
        joinedAt: organizationMembers.createdAt,
      })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .innerJoin(roles, eq(roles.id, organizationMembers.roleId))
      .orderBy(asc(users.name)),
  );
}

export async function listRoles(ctx: AuthContext) {
  requirePerm(ctx, "role.read");
  return withTenant(ctx, async (tx) => {
    const rs = await tx.select().from(roles).orderBy(asc(roles.name));
    const perms = await tx.select().from(rolePermissions);
    const counts = await tx
      .select({ roleId: organizationMembers.roleId, n: sql<number>`count(*)::int` })
      .from(organizationMembers)
      .groupBy(organizationMembers.roleId);
    return rs.map((r) => ({
      ...r,
      memberCount: counts.find((c) => c.roleId === r.id)?.n ?? 0,
      permissions: perms
        .filter((p) => p.roleId === r.id)
        .map((p) => ({ permission: p.permission, scope: p.scope })),
    }));
  });
}

async function activeOwnerCount(tx: Tx) {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(organizationMembers)
    .innerJoin(roles, eq(roles.id, organizationMembers.roleId))
    .where(and(eq(roles.key, "owner"), eq(organizationMembers.status, "active")));
  return row.n;
}

export async function updateMember(ctx: AuthContext, membershipId: string, input: unknown) {
  requirePerm(ctx, "member.manage");
  const data = updateMemberSchema.parse(input);
  return withTenant(ctx, async (tx) => {
    const [target] = await tx
      .select({
        id: organizationMembers.id,
        userId: organizationMembers.userId,
        status: organizationMembers.status,
        roleKey: roles.key,
        roleId: roles.id,
      })
      .from(organizationMembers)
      .innerJoin(roles, eq(roles.id, organizationMembers.roleId))
      .where(eq(organizationMembers.id, membershipId));
    if (!target) throw notFound("Member");

    // Managing an owner requires being able to grant the owner role (i.e. be an owner).
    await assertCanGrantRole(tx, ctx, target.roleId);

    const patch: Partial<typeof organizationMembers.$inferInsert> = { updatedAt: new Date() };
    const changes: Record<string, unknown> = {};
    const losingOwner =
      target.roleKey === "owner" &&
      ((data.roleKey && data.roleKey !== "owner") || data.status === "suspended");

    if (losingOwner && (await activeOwnerCount(tx)) <= 1) {
      throw conflict("An organization must keep at least one active owner");
    }
    if (data.status === "suspended" && target.userId === ctx.userId) {
      throw conflict("You cannot suspend yourself");
    }
    if (data.roleKey && data.roleKey !== target.roleKey) {
      const role = await roleByKey(tx, data.roleKey);
      await assertCanGrantRole(tx, ctx, role.id);
      patch.roleId = role.id;
      changes.role = { from: target.roleKey, to: role.key };
    }
    if (data.status && data.status !== target.status) {
      patch.status = data.status;
      changes.status = { from: target.status, to: data.status };
    }
    if (Object.keys(changes).length === 0) return { membershipId, changed: false };

    await tx.update(organizationMembers).set(patch).where(eq(organizationMembers.id, membershipId));
    await audit(tx, ctx, {
      action: "member.updated",
      entityType: "member",
      entityId: membershipId,
      changes,
    });
    return { membershipId, changed: true };
  });
}

// ---------------------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------------------

export async function createInvitation(ctx: AuthContext, input: InviteInput) {
  requirePerm(ctx, "member.invite");
  const data = inviteSchema.parse(input);
  const token = newToken();

  const invitation = await withTenant(ctx, async (tx) => {
    const role = await roleByKey(tx, data.roleKey);
    await assertCanGrantRole(tx, ctx, role.id);

    const [already] = await tx
      .select({ id: organizationMembers.id })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(sql`lower(${users.email}) = ${data.email}`);
    if (already) throw conflict("That person is already a member of this organization");

    const [pending] = await tx
      .select({ id: invitations.id })
      .from(invitations)
      .where(
        and(
          sql`lower(${invitations.email}) = ${data.email}`,
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
        ),
      );
    if (pending) throw conflict("There is already a pending invitation for that email");

    const [inv] = await tx
      .insert(invitations)
      .values({
        organizationId: ctx.organizationId,
        email: data.email,
        roleId: role.id,
        tokenHash: hashToken(token),
        invitedBy: ctx.userId,
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
      })
      .returning();
    await audit(tx, ctx, {
      action: "member.invited",
      entityType: "invitation",
      entityId: inv.id,
      summary: `Invited ${data.email} as ${role.name}`,
      changes: { email: data.email, role: role.key },
    });
    return inv;
  });

  const url = `${getConfig().APP_URL}/accept-invite/${token}`;
  // Best effort. `emailed` is true ONLY if the message was handed to a real SMTP server; otherwise
  // the inviter must share the link themselves (it is always returned to them).
  const emailed = await sendBestEffort({
    to: data.email,
    subject: `${ctx.userName} invited you to join on ONECRM`,
    text: `${ctx.userName} invited you to join their ONECRM workspace.

Accept the invitation (valid 7 days, single use):
${url}`,
  });
  return { invitation, token, url, emailed };
}

export async function listInvitations(ctx: AuthContext) {
  requirePerm(ctx, "member.invite");
  return withTenant(ctx, (tx) =>
    tx
      .select({
        id: invitations.id,
        email: invitations.email,
        roleName: roles.name,
        expiresAt: invitations.expiresAt,
        createdAt: invitations.createdAt,
      })
      .from(invitations)
      .innerJoin(roles, eq(roles.id, invitations.roleId))
      .where(and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
      .orderBy(desc(invitations.createdAt)),
  );
}

export async function revokeInvitation(ctx: AuthContext, invitationId: string) {
  requirePerm(ctx, "member.invite");
  await withTenant(ctx, async (tx) => {
    const res = await tx
      .update(invitations)
      .set({ revokedAt: new Date() })
      .where(and(eq(invitations.id, invitationId), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
      .returning({ id: invitations.id });
    if (res.length === 0) throw notFound("Invitation");
    await audit(tx, ctx, { action: "member.invitation_revoked", entityType: "invitation", entityId: invitationId });
  });
}

// --- public (unauthenticated) side of invitations: owning connection, token-gated ---

async function findValidInvitation(token: string) {
  const { db } = await getDatabase();
  const [row] = await db
    .select({
      invitation: invitations,
      organizationName: organizations.name,
      organizationStatus: organizations.status,
      organizationDeletedAt: organizations.deletedAt,
      roleName: roles.name,
    })
    .from(invitations)
    .innerJoin(organizations, eq(organizations.id, invitations.organizationId))
    .innerJoin(roles, eq(roles.id, invitations.roleId))
    .where(eq(invitations.tokenHash, hashToken(token)));
  if (
    !row ||
    row.invitation.acceptedAt ||
    row.invitation.revokedAt ||
    row.invitation.expiresAt < new Date() ||
    row.organizationDeletedAt ||
    row.organizationStatus === "archived"
  ) {
    throw notFound("Invitation"); // identical for unknown, used, revoked and expired
  }
  return { db, ...row };
}

export async function previewInvitation(token: string) {
  const { db, invitation, organizationName, roleName } = await findValidInvitation(token);
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${invitation.email.toLowerCase()}`);
  return {
    email: invitation.email,
    organizationName,
    roleName,
    hasAccount: Boolean(existing),
    invitedName: invitation.invitedName ?? null,
  };
}

export async function acceptInvitation(
  token: string,
  input: AcceptInviteInput,
  meta: RequestMeta,
): Promise<IssuedSession> {
  await enforceRateLimit(`invite:ip:${meta.ip ?? "unknown"}`, 20, 15 * 60_000);
  const data = acceptInviteSchema.parse(input);
  const { db, invitation } = await findValidInvitation(token);

  const [existing] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${invitation.email.toLowerCase()}`);

  let userId: string;
  let newPasswordHash: string | undefined;
  if (existing) {
    // Platform administrators sit outside every company; they can never become a company member.
    if (await isPlatformAdmin(existing.id, db)) throw notFound("Invitation");
    if (!(await verifyPassword(data.password, existing.passwordHash))) {
      throw unauthenticated("That password is incorrect for the invited account");
    }
    userId = existing.id;
  } else {
    if (!(data.name || invitation.invitedName)) throw invalid("Your name is required");
    const pw = passwordSchema.safeParse(data.password);
    if (!pw.success) throw invalid(pw.error.issues[0].message);
    newPasswordHash = await hashPassword(data.password);
    userId = "";
  }

  return db.transaction(async (tx) => {
    // Re-check inside the transaction and consume atomically so a token works exactly once.
    const consumed = await tx
      .update(invitations)
      .set({ acceptedAt: new Date() })
      .where(and(eq(invitations.id, invitation.id), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
      .returning({ id: invitations.id });
    if (consumed.length === 0) throw notFound("Invitation");

    if (!existing) {
      const [u] = await tx
        .insert(users)
        .values({
          email: invitation.email.toLowerCase(),
          name: (data.name || invitation.invitedName)!,
          phone: invitation.phone,
          passwordHash: newPasswordHash!,
          // The invitation link was delivered to this address, which proves control of it.
          emailVerifiedAt: new Date(),
        })
        .returning({ id: users.id });
      userId = u.id;
    }

    await tx
      .insert(organizationMembers)
      .values({ organizationId: invitation.organizationId, userId, roleId: invitation.roleId, jobTitle: invitation.jobTitle })
      .onConflictDoUpdate({
        target: [organizationMembers.organizationId, organizationMembers.userId],
        set: { status: "active", roleId: invitation.roleId, updatedAt: new Date(), ...(invitation.jobTitle ? { jobTitle: invitation.jobTitle } : {}) },
      });
    await tx
      .update(invitations)
      .set({ acceptedBy: userId })
      .where(eq(invitations.id, invitation.id));
    return _issueSession(tx, userId, invitation.organizationId, meta);
  });
}
