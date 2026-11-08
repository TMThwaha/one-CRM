import "server-only";
import { and, asc, desc, eq, gte, ilike, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { getDatabase } from "@/server/db/client";
import {
  authEvents,
  invitations,
  organizationMembers,
  organizations,
  platformAdmins,
  platformAuditLogs,
  roles,
  subscriptionPlans,
  users,
} from "@/server/db/schema";
import { notFound } from "@/server/platform/errors";
import { companyListQuerySchema, type CompanyListQuery } from "@/shared/schemas/platform";

export const PAGE_SIZE = 20;

const ORG_ID = sql.raw('"organizations"."id"');
const USER_ID = sql.raw('"users"."id"');
const PLAN_ID = sql.raw('"subscription_plans"."id"');

const likeEscape = (v: string) => v.replace(/[\\%_]/g, (m) => `\\${m}`);

// Correlated sub-selects keep the list query one round trip and one row per company.
const adminName = sql<string | null>`(
  select u.name from organization_members m join users u on u.id = m.user_id join roles r on r.id = m.role_id
  where m.organization_id = ${ORG_ID} and r.key = 'owner' and m.status = 'active'
  order by m.created_at asc limit 1)`;
const adminEmail = sql<string | null>`(
  select u.email from organization_members m join users u on u.id = m.user_id join roles r on r.id = m.role_id
  where m.organization_id = ${ORG_ID} and r.key = 'owner' and m.status = 'active'
  order by m.created_at asc limit 1)`;
const pendingAdminEmail = sql<string | null>`(
  select i.email from invitations i join roles r on r.id = i.role_id
  where i.organization_id = ${ORG_ID} and r.key = 'owner'
    and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
  order by i.created_at desc limit 1)`;
const employeeCount = sql<number>`(
  select count(*)::int from organization_members m
  where m.organization_id = ${ORG_ID} and m.status = 'active')`;

export async function listCompanies(rawQuery: Partial<Record<keyof CompanyListQuery, unknown>> = {}, pageSize = PAGE_SIZE) {
  const q = companyListQuerySchema.parse(rawQuery);
  const { db } = await getDatabase();

  const where: (SQL | undefined)[] = [isNull(organizations.deletedAt)];
  if (q.q) {
    const term = `%${likeEscape(q.q)}%`;
    where.push(or(ilike(organizations.name, term), ilike(organizations.legalName, term), sql`${organizations.id}::text like ${likeEscape(q.q.toLowerCase())} || '%'`));
  }
  if (q.country) where.push(eq(organizations.country, q.country));
  if (q.industry) where.push(ilike(organizations.industry, likeEscape(q.industry)));
  if (q.status) where.push(eq(organizations.status, q.status));
  if (q.plan) where.push(eq(organizations.planId, q.plan));
  if (q.from) where.push(gte(organizations.createdAt, new Date(`${q.from}T00:00:00.000Z`)));
  if (q.to) where.push(lt(organizations.createdAt, new Date(new Date(`${q.to}T00:00:00.000Z`).getTime() + 86_400_000)));
  const cond = and(...where);

  const sortCol = {
    name: organizations.name,
    country: organizations.country,
    createdAt: organizations.createdAt,
    employees: employeeCount,
    status: organizations.status,
  }[q.sort];
  const order = q.dir === "asc" ? asc(sortCol) : desc(sortCol);

  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(organizations).where(cond);
  const rows = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      legalName: organizations.legalName,
      country: organizations.country,
      industry: organizations.industry,
      status: organizations.status,
      planId: organizations.planId,
      planName: subscriptionPlans.name,
      createdAt: organizations.createdAt,
      adminName,
      adminEmail,
      pendingAdminEmail,
      employees: employeeCount,
    })
    .from(organizations)
    .leftJoin(subscriptionPlans, eq(subscriptionPlans.id, organizations.planId))
    .where(cond)
    .orderBy(order, asc(organizations.id))
    .limit(pageSize)
    .offset((q.page - 1) * pageSize);

  return { rows, total, page: q.page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)), query: q };
}

export async function listPlans() {
  const { db } = await getDatabase();
  return db
    .select({
      id: subscriptionPlans.id,
      key: subscriptionPlans.key,
      name: subscriptionPlans.name,
      isActive: subscriptionPlans.isActive,
      monthlyPrice: subscriptionPlans.monthlyPrice,
      annualPrice: subscriptionPlans.annualPrice,
      priceCurrency: subscriptionPlans.priceCurrency,
      maxEmployees: subscriptionPlans.maxEmployees,
      maxStorageMb: subscriptionPlans.maxStorageMb,
      companies: sql<number>`(select count(*)::int from organizations o where o.plan_id = ${PLAN_ID} and o.deleted_at is null)`,
    })
    .from(subscriptionPlans)
    .orderBy(asc(subscriptionPlans.sortOrder));
}

export async function listIndustries(): Promise<string[]> {
  const { db } = await getDatabase();
  const rows = await db
    .selectDistinct({ industry: organizations.industry })
    .from(organizations)
    .where(isNull(organizations.deletedAt))
    .orderBy(asc(organizations.industry));
  return rows.map((r) => r.industry);
}

export async function getCompanyDetail(organizationId: string) {
  const { db } = await getDatabase();
  const [org] = await db
    .select({ org: organizations, planName: subscriptionPlans.name })
    .from(organizations)
    .leftJoin(subscriptionPlans, eq(subscriptionPlans.id, organizations.planId))
    .where(and(eq(organizations.id, organizationId), isNull(organizations.deletedAt)));
  if (!org) throw notFound("Company");

  const admins = await db
    .select({
      membershipId: organizationMembers.id,
      name: users.name,
      email: users.email,
      jobTitle: organizationMembers.jobTitle,
      status: organizationMembers.status,
      since: organizationMembers.createdAt,
      mfaEnabled: sql<boolean>`${users.mfaEnabledAt} is not null`,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .innerJoin(roles, eq(roles.id, organizationMembers.roleId))
    .where(and(eq(organizationMembers.organizationId, organizationId), eq(roles.key, "owner")))
    .orderBy(asc(organizationMembers.createdAt));

  const pendingInvites = await db
    .select({ id: invitations.id, email: invitations.email, invitedName: invitations.invitedName, expiresAt: invitations.expiresAt, createdAt: invitations.createdAt })
    .from(invitations)
    .innerJoin(roles, eq(roles.id, invitations.roleId))
    .where(and(eq(invitations.organizationId, organizationId), eq(roles.key, "owner"), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
    .orderBy(desc(invitations.createdAt));

  const roleCounts = await db
    .select({ role: roles.name, n: sql<number>`count(*)::int` })
    .from(organizationMembers)
    .innerJoin(roles, eq(roles.id, organizationMembers.roleId))
    .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.status, "active")))
    .groupBy(roles.name)
    .orderBy(desc(sql`count(*)`));

  const audit = await listPlatformAudit({ organizationId, page: 1 }, 15);
  return { ...org, admins, pendingInvites, roleCounts, audit: audit.rows };
}

export async function listAdministrators() {
  const { db } = await getDatabase();
  const active = await db
    .select({
      membershipId: organizationMembers.id,
      organizationId: organizations.id,
      company: organizations.name,
      companyStatus: organizations.status,
      name: users.name,
      email: users.email,
      jobTitle: organizationMembers.jobTitle,
      status: organizationMembers.status,
      mfaEnabled: sql<boolean>`${users.mfaEnabledAt} is not null`,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .innerJoin(roles, eq(roles.id, organizationMembers.roleId))
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(and(eq(roles.key, "owner"), isNull(organizations.deletedAt)))
    .orderBy(asc(organizations.name), asc(users.name));
  const pending = await db
    .select({
      id: invitations.id,
      organizationId: organizations.id,
      company: organizations.name,
      email: invitations.email,
      invitedName: invitations.invitedName,
      expiresAt: invitations.expiresAt,
    })
    .from(invitations)
    .innerJoin(roles, eq(roles.id, invitations.roleId))
    .innerJoin(organizations, eq(organizations.id, invitations.organizationId))
    .where(and(eq(roles.key, "owner"), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), isNull(organizations.deletedAt)))
    .orderBy(desc(invitations.createdAt));
  return { active, pending };
}

export async function listPlatformUsers(opts: { q?: string; page?: number } = {}, pageSize = PAGE_SIZE) {
  const { db } = await getDatabase();
  const page = Math.max(1, opts.page ?? 1);
  const cond = opts.q
    ? or(ilike(users.name, `%${likeEscape(opts.q)}%`), ilike(users.email, `%${likeEscape(opts.q)}%`))
    : undefined;
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(users).where(cond);
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      createdAt: users.createdAt,
      disabled: sql<boolean>`${users.disabledAt} is not null`,
      mfaEnabled: sql<boolean>`${users.mfaEnabledAt} is not null`,
      emailVerified: sql<boolean>`${users.emailVerifiedAt} is not null`,
      isPlatformAdmin: sql<boolean>`exists (select 1 from ${platformAdmins} pa where pa.user_id = ${USER_ID})`,
      companies: sql<string | null>`(
        select string_agg(o.name || ' (' || r.name || ')', ', ' order by o.name)
        from organization_members m join organizations o on o.id = m.organization_id join roles r on r.id = m.role_id
        where m.user_id = ${USER_ID} and m.status = 'active' and o.deleted_at is null)`,
    })
    .from(users)
    .where(cond)
    .orderBy(desc(users.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function listPlatformAudit(opts: { q?: string; organizationId?: string; page?: number }, pageSize = 30) {
  const { db } = await getDatabase();
  const page = Math.max(1, opts.page ?? 1);
  const where: (SQL | undefined)[] = [];
  if (opts.organizationId) where.push(eq(platformAuditLogs.organizationId, opts.organizationId));
  if (opts.q) {
    const term = `%${likeEscape(opts.q)}%`;
    where.push(or(ilike(platformAuditLogs.action, term), ilike(platformAuditLogs.summary, term), ilike(platformAuditLogs.actorEmail, term)));
  }
  const cond = and(...where);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(platformAuditLogs).where(cond);
  const rows = await db
    .select({
      id: platformAuditLogs.id,
      action: platformAuditLogs.action,
      summary: platformAuditLogs.summary,
      actorEmail: platformAuditLogs.actorEmail,
      organizationId: platformAuditLogs.organizationId,
      company: organizations.name,
      ip: platformAuditLogs.ip,
      changes: platformAuditLogs.changes,
      createdAt: platformAuditLogs.createdAt,
    })
    .from(platformAuditLogs)
    .leftJoin(organizations, eq(organizations.id, platformAuditLogs.organizationId))
    .where(cond)
    .orderBy(desc(platformAuditLogs.createdAt), desc(platformAuditLogs.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Every number here is a live aggregate. Nothing is estimated or fabricated. */
export async function getPlatformOverview() {
  const { db } = await getDatabase();
  const live = isNull(organizations.deletedAt);
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const since7d = new Date(Date.now() - 7 * 86_400_000);

  const byStatus = await db
    .select({ status: organizations.status, n: sql<number>`count(*)::int` })
    .from(organizations)
    .where(live)
    .groupBy(organizations.status);
  const statusCount = (s: string) => byStatus.find((r) => r.status === s)?.n ?? 0;

  const byCountry = await db
    .select({ country: organizations.country, n: sql<number>`count(*)::int` })
    .from(organizations)
    .where(live)
    .groupBy(organizations.country)
    .orderBy(desc(sql`count(*)`));

  const [{ n: newThisMonth }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(organizations)
    .where(and(live, gte(organizations.createdAt, monthStart)));
  const [{ n: withPlan }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(organizations)
    .where(and(live, sql`${organizations.planId} is not null`));
  const byPlan = await db
    .select({ plan: subscriptionPlans.name, n: sql<number>`count(${organizations.id})::int` })
    .from(subscriptionPlans)
    .leftJoin(organizations, and(eq(organizations.planId, subscriptionPlans.id), live))
    .groupBy(subscriptionPlans.name, subscriptionPlans.sortOrder)
    .orderBy(asc(subscriptionPlans.sortOrder));

  const [{ n: totalUsers }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(sql`not exists (select 1 from platform_admins pa where pa.user_id = ${USER_ID})`);
  const [{ n: companyAdmins }] = await db
    .select({ n: sql<number>`count(distinct ${organizationMembers.userId})::int` })
    .from(organizationMembers)
    .innerJoin(roles, eq(roles.id, organizationMembers.roleId))
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(and(eq(roles.key, "owner"), eq(organizationMembers.status, "active"), live));
  const [{ n: seats }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(and(eq(organizationMembers.status, "active"), live));

  const authCount = async (cond: SQL) => {
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(authEvents).where(and(gte(authEvents.createdAt, since7d), cond));
    return r.n;
  };
  const security = {
    failedSignIns: await authCount(and(eq(authEvents.success, false), eq(authEvents.type, "login"))!),
    lockouts: await authCount(eq(authEvents.type, "login_lockout")),
    failedSecondFactor: await authCount(eq(authEvents.type, "mfa_failed")),
  };

  const recent = await listCompanies({ sort: "createdAt", dir: "desc" }, 5);
  const audit = await listPlatformAudit({ page: 1 }, 8);

  return {
    companies: {
      total: statusCount("active") + statusCount("suspended") + statusCount("deactivated") + statusCount("archived"),
      active: statusCount("active"),
      suspended: statusCount("suspended"),
      deactivated: statusCount("deactivated"),
      archived: statusCount("archived"),
      newThisMonth,
      withPlan,
    },
    byCountry,
    byPlan,
    users: { total: totalUsers, companyAdmins, activeSeats: seats },
    security,
    recentCompanies: recent.rows,
    recentAudit: audit.rows,
  };
}

export async function companiesByCountry() {
  const { db } = await getDatabase();
  return db
    .select({ country: organizations.country, n: sql<number>`count(*)::int` })
    .from(organizations)
    .where(isNull(organizations.deletedAt))
    .groupBy(organizations.country);
}
