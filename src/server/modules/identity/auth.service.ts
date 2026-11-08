import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { getDatabase, type Database } from "@/server/db/client";
import {
  authEvents,
  organizationMembers,
  organizations,
  platformAdmins,
  rolePermissions,
  roles,
  sessions,
  users,
} from "@/server/db/schema";
import { getConfig } from "@/server/platform/config";
import { dummyHash, hashPassword, hashToken, newToken, verifyPassword } from "@/server/platform/crypto";
import { conflict, forbidden, invalid, rateLimited, unauthenticated } from "@/server/platform/errors";
import { enforceRateLimit } from "@/server/platform/rate-limit";
import { seedDefaultPipeline } from "@/server/modules/sales/seed";
import {
  SYSTEM_ROLES,
  type Permission,
  type PermissionMap,
  type Scope,
} from "@/shared/permissions";
import {
  registerSchema,
  type LoginInput,
  type RegisterInput,
} from "@/shared/schemas/identity";
import type { AuthContext } from "./context";

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export interface IssuedSession {
  token: string;
  expiresAt: Date;
  /** True when the password was correct but a second factor is still required. */
  mfaRequired?: boolean;
  /** True for Global Super Admins (decides where the client lands after sign-in). */
  platformAdmin?: boolean;
}

/** A session awaiting its second factor lives only briefly and grants no access. */
export const MFA_PENDING_MINUTES = 10;

/** Platform (Super Admin) sessions are deliberately short-lived. */
export const PLATFORM_SESSION_HOURS = 12;

export async function isPlatformAdmin(userId: string, db?: Pick<Database, "select">): Promise<boolean> {
  const executor = db ?? (await getDatabase()).db;
  const [row] = await executor.select({ id: platformAdmins.userId }).from(platformAdmins).where(eq(platformAdmins.userId, userId));
  return Boolean(row);
}

export function sessionLifetimeMs(platformAdmin: boolean): number {
  return platformAdmin ? PLATFORM_SESSION_HOURS * 3_600_000 : getConfig().SESSION_TTL_DAYS * 86_400_000;
}

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

// ---------------------------------------------------------------------------------------
// Organization provisioning
// ---------------------------------------------------------------------------------------

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "org"}-${randomBytes(3).toString("hex")}`;
}

type DbTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Profile and regional fields a company is created with. Everything is optional except the name. */
export interface CompanyProfile {
  name: string;
  legalName?: string | null;
  industry?: string | null;
  country?: string | null;
  region?: string | null;
  city?: string | null;
  address?: string | null;
  website?: string | null;
  businessEmail?: string | null;
  businessPhone?: string | null;
  phoneCountryCode?: string | null;
  registrationNumber?: string | null;
  taxId?: string | null;
  logoUrl?: string | null;
  baseCurrency?: string;
  timezone?: string;
  locale?: string;
  dateFormat?: string;
  planId?: string | null;
  status?: "active" | "suspended";
}

/**
 * Creates the company record, its system roles + permissions and its default pipeline. It does NOT
 * create any member: callers add the first administrator (self-service owner, or an invitation).
 */
export async function createCompanyRecords(
  tx: DbTx,
  opts: { createdBy: string; profile: CompanyProfile },
): Promise<{ organizationId: string; roleIds: Record<string, string> }> {
  const p = opts.profile;
  const [org] = await tx
    .insert(organizations)
    .values({
      name: p.name,
      slug: slugify(p.name),
      industry: p.industry || "general",
      legalName: p.legalName ?? null,
      country: p.country ?? null,
      region: p.region ?? null,
      city: p.city ?? null,
      address: p.address ?? null,
      website: p.website ?? null,
      businessEmail: p.businessEmail ?? null,
      businessPhone: p.businessPhone ?? null,
      phoneCountryCode: p.phoneCountryCode ?? null,
      registrationNumber: p.registrationNumber ?? null,
      taxId: p.taxId ?? null,
      logoUrl: p.logoUrl ?? null,
      planId: p.planId ?? null,
      status: p.status ?? "active",
      statusChangedAt: new Date(),
      // Omitted regional fields fall back to the column defaults (INR / Asia/Kolkata / en-IN).
      ...(p.baseCurrency ? { baseCurrency: p.baseCurrency } : {}),
      ...(p.timezone ? { timezone: p.timezone } : {}),
      ...(p.locale ? { locale: p.locale } : {}),
      ...(p.dateFormat ? { dateFormat: p.dateFormat } : {}),
      createdBy: opts.createdBy,
    })
    .returning({ id: organizations.id });

  const roleRows = await tx
    .insert(roles)
    .values(
      SYSTEM_ROLES.map((r) => ({
        organizationId: org.id,
        key: r.key,
        name: r.name,
        description: r.description,
        isSystem: true,
      })),
    )
    .returning({ id: roles.id, key: roles.key });

  const permRows = SYSTEM_ROLES.flatMap((r) => {
    const roleId = roleRows.find((x) => x.key === r.key)!.id;
    return Object.entries(r.permissions).map(([permission, scope]) => ({
      roleId,
      organizationId: org.id,
      permission,
      scope: scope as Scope,
    }));
  });
  await tx.insert(rolePermissions).values(permRows);
  await seedDefaultPipeline(tx as unknown as Database, org.id);
  return { organizationId: org.id, roleIds: Object.fromEntries(roleRows.map((r) => [r.key, r.id])) };
}

/** Self-service path (disabled in production by default): a company plus its first Company Admin. */
async function provisionOrganization(
  tx: DbTx,
  opts: { userId: string; name: string; industry?: string },
): Promise<{ organizationId: string; membershipId: string }> {
  const { organizationId, roleIds } = await createCompanyRecords(tx, {
    createdBy: opts.userId,
    profile: { name: opts.name, industry: opts.industry },
  });
  const [member] = await tx
    .insert(organizationMembers)
    .values({ organizationId, userId: opts.userId, roleId: roleIds.owner })
    .returning({ id: organizationMembers.id });
  return { organizationId, membershipId: member.id };
}

// ---------------------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------------------

async function issueSession(
  db: Pick<Database, "insert">,
  userId: string,
  organizationId: string | null,
  meta: RequestMeta,
  opts: { mfaPending?: boolean; platformAdmin?: boolean } = {},
): Promise<IssuedSession> {
  const token = newToken();
  const expiresAt = opts.mfaPending
    ? new Date(Date.now() + MFA_PENDING_MINUTES * 60_000)
    : new Date(Date.now() + sessionLifetimeMs(opts.platformAdmin ?? false));
  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    activeOrganizationId: organizationId,
    mfaPending: opts.mfaPending ?? false,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
    expiresAt,
  });
  return { token, expiresAt, mfaRequired: opts.mfaPending ? true : undefined, platformAdmin: opts.platformAdmin ?? false };
}

async function logAuthEvent(
  db: Pick<Database, "insert">,
  e: { type: string; success: boolean; userId?: string | null; email?: string; meta: RequestMeta },
) {
  await db.insert(authEvents).values({
    type: e.type,
    success: e.success,
    userId: e.userId ?? null,
    email: e.email,
    ip: e.meta.ip ?? null,
    userAgent: e.meta.userAgent?.slice(0, 300) ?? null,
  });
}

// ---------------------------------------------------------------------------------------
// Registration & login
// ---------------------------------------------------------------------------------------

export async function register(input: RegisterInput, meta: RequestMeta): Promise<IssuedSession> {
  const data = registerSchema.parse(input);
  await enforceRateLimit(`register:ip:${meta.ip ?? "unknown"}`, 10, 60 * 60_000);
  const { db } = await getDatabase();
  const passwordHash = await hashPassword(data.password);

  const issued = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${data.email}`);
    if (existing) throw conflict("An account with this email already exists. Try signing in.");

    const [user] = await tx
      .insert(users)
      .values({ email: data.email, name: data.name, passwordHash })
      .returning({ id: users.id });

    const { organizationId } = await provisionOrganization(tx, {
      userId: user.id,
      name: data.organizationName,
      industry: data.industry,
    });
    await logAuthEvent(tx, { type: "register", success: true, userId: user.id, email: data.email, meta });
    return { session: await issueSession(tx, user.id, organizationId, meta), userId: user.id };
  });
  // Verification email is best-effort and outside the transaction: a mail outage must not block sign-up.
  const { sendVerificationEmail } = await import("./account.service");
  await sendVerificationEmail(issued.userId).catch((e) => console.error("[register] verification email failed", e));
  return issued.session;
}

export async function login(input: LoginInput, meta: RequestMeta): Promise<IssuedSession> {
  const email = input.email.trim().toLowerCase();
  await enforceRateLimit(`login:ip:${meta.ip ?? "unknown"}`, 40, 15 * 60_000);
  await enforceRateLimit(`login:email:${email}`, 15, 15 * 60_000);
  const { db } = await getDatabase();

  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`);

  if (!user || user.disabledAt) {
    await verifyPassword(input.password, await dummyHash()); // equalise timing
    await logAuthEvent(db, { type: "login", success: false, email, meta });
    throw unauthenticated("Invalid email or password");
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await logAuthEvent(db, { type: "login_locked", success: false, userId: user.id, email, meta });
    throw rateLimited("Too many failed attempts. This account is locked for a few minutes.");
  }

  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) {
    const failed = user.failedLoginCount + 1;
    const lock = failed >= MAX_FAILED_LOGINS;
    await db
      .update(users)
      .set({
        failedLoginCount: lock ? 0 : failed,
        lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : user.lockedUntil,
      })
      .where(eq(users.id, user.id));
    await logAuthEvent(db, { type: lock ? "login_lockout" : "login", success: false, userId: user.id, email, meta });
    throw unauthenticated("Invalid email or password");
  }

  await db.update(users).set({ failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, user.id));
  const platformAdmin = await isPlatformAdmin(user.id, db);
  const [membership] = await db
    .select({ organizationId: organizationMembers.organizationId })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(
      and(
        eq(organizationMembers.userId, user.id),
        eq(organizationMembers.status, "active"),
        eq(organizations.status, "active"),
        isNull(organizations.deletedAt),
      ),
    )
    .orderBy(asc(organizationMembers.createdAt))
    .limit(1);

  if (!platformAdmin && !membership) {
    // The password was right, so explaining why access is unavailable reveals nothing to a stranger.
    await logAuthEvent(db, { type: "login_no_active_company", success: false, userId: user.id, email, meta });
    throw forbidden("Your account is not linked to an active company. Contact your company administrator.");
  }

  const mfa = Boolean(user.mfaEnabledAt);
  await logAuthEvent(db, { type: mfa ? "login_password_ok_mfa_pending" : "login", success: true, userId: user.id, email, meta });
  return issueSession(db, user.id, platformAdmin ? null : membership.organizationId, meta, { mfaPending: mfa, platformAdmin });
}

export async function logout(token: string): Promise<void> {
  const { db } = await getDatabase();
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt)));
}

/** Revokes every session of the user except (optionally) the current one. */
export async function revokeOtherSessions(ctx: AuthContext): Promise<void> {
  const { db } = await getDatabase();
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(sessions.userId, ctx.userId),
        isNull(sessions.revokedAt),
        sql`${sessions.id} <> ${ctx.sessionId}`,
      ),
    );
}

// ---------------------------------------------------------------------------------------
// Resolving a request's identity
// ---------------------------------------------------------------------------------------

/**
 * Turns a session token into an AuthContext, or null. Re-validated on EVERY request:
 * session not revoked/expired, user not disabled, membership still active, permissions fresh.
 * Role changes and suspensions therefore take effect immediately.
 */
export async function resolveAuthContext(
  token: string | undefined | null,
  meta: RequestMeta = {},
): Promise<AuthContext | null> {
  if (!token) return null;
  const { db } = await getDatabase();
  const now = new Date();

  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        isNull(sessions.revokedAt),
        eq(sessions.mfaPending, false),
        gt(sessions.expiresAt, now),
        isNull(users.disabledAt),
      ),
    );
  if (!row) return null;

  const loadMembership = (organizationId: string) =>
    db
      .select({
        membershipId: organizationMembers.id,
        organizationId: organizationMembers.organizationId,
        roleId: roles.id,
        roleKey: roles.key,
        roleName: roles.name,
        timeZone: organizations.timezone,
        locale: organizations.locale,
        currency: organizations.baseCurrency,
        dateFormat: organizations.dateFormat,
      })
      .from(organizationMembers)
      .innerJoin(roles, eq(roles.id, organizationMembers.roleId))
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .where(
        and(
          eq(organizationMembers.userId, row.user.id),
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.status, "active"),
          eq(organizations.status, "active"),
          isNull(organizations.deletedAt),
        ),
      )
      .then((r) => r[0]);

  let membership = row.session.activeOrganizationId
    ? await loadMembership(row.session.activeOrganizationId)
    : undefined;

  if (!membership) {
    // Active org gone/suspended: fall back to another active membership, else no context.
    const [other] = await db
      .select({ organizationId: organizationMembers.organizationId })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .where(
        and(
          eq(organizationMembers.userId, row.user.id),
          eq(organizationMembers.status, "active"),
          eq(organizations.status, "active"),
          isNull(organizations.deletedAt),
        ),
      )
      .orderBy(asc(organizationMembers.createdAt))
      .limit(1);
    if (!other) return null;
    membership = await loadMembership(other.organizationId);
    if (!membership) return null;
    await db
      .update(sessions)
      .set({ activeOrganizationId: membership.organizationId })
      .where(eq(sessions.id, row.session.id));
  }

  const permRows = await db
    .select({ permission: rolePermissions.permission, scope: rolePermissions.scope })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, membership.roleId));
  const permissions: PermissionMap = {};
  for (const p of permRows) permissions[p.permission as Permission] = p.scope as Scope;

  if (now.getTime() - row.session.lastSeenAt.getTime() > 60_000) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.session.id));
  }

  return {
    userId: row.user.id,
    userName: row.user.name,
    userEmail: row.user.email,
    organizationId: membership.organizationId,
    membershipId: membership.membershipId,
    roleKey: membership.roleKey,
    roleName: membership.roleName,
    sessionId: row.session.id,
    permissions,
    regional: {
      timeZone: membership.timeZone,
      locale: membership.locale,
      currency: membership.currency.trim(),
      dateFormat: membership.dateFormat,
    },
    ip: meta.ip ?? null,
  };
}

// ---------------------------------------------------------------------------------------
// Multiple organizations per user
// ---------------------------------------------------------------------------------------

export async function listMyOrganizations(userId: string) {
  const { db } = await getDatabase();
  return db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      roleName: roles.name,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .innerJoin(roles, eq(roles.id, organizationMembers.roleId))
    .where(
      and(
        eq(organizationMembers.userId, userId),
        eq(organizationMembers.status, "active"),
        eq(organizations.status, "active"),
        isNull(organizations.deletedAt),
      ),
    )
    .orderBy(asc(organizations.name));
}

export async function switchOrganization(ctx: AuthContext, organizationId: string): Promise<void> {
  const { db } = await getDatabase();
  const [m] = await db
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(
      and(
        eq(organizationMembers.userId, ctx.userId),
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.status, "active"),
        eq(organizations.status, "active"),
        isNull(organizations.deletedAt),
      ),
    );
  // Same response for "no such org" and "not a member": do not reveal which orgs exist.
  if (!m) throw invalid("You are not a member of that organization");
  await db.update(sessions).set({ activeOrganizationId: organizationId }).where(eq(sessions.id, ctx.sessionId));
}

export { issueSession as _issueSession };
