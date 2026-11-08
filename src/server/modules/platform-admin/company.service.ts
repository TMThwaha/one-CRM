import "server-only";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { getDatabase, type Database } from "@/server/db/client";
import {
  invitations,
  organizationMembers,
  organizations,
  platformAdmins,
  roles,
  subscriptionPlans,
  users,
} from "@/server/db/schema";
import { getConfig } from "@/server/platform/config";
import { hashToken, newToken, verifyPassword } from "@/server/platform/crypto";
import { conflict, invalid, notFound, unauthenticated } from "@/server/platform/errors";
import { sendBestEffort } from "@/server/platform/mailer";
import { enforceRateLimit } from "@/server/platform/rate-limit";
import type { CompanyStatus } from "@/shared/countries";
import {
  appointAdministratorSchema,
  createCompanySchema,
  deleteCompanySchema,
  setCompanyStatusSchema,
  updateCompanySchema,
  type CreateCompanyInput,
} from "@/shared/schemas/platform";
import { createCompanyRecords } from "../identity/auth.service";
import { isUniqueViolation, platformAudit } from "./audit";
import type { PlatformContext } from "./context";

const INVITE_TTL_DAYS = 7;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

const STATUS_TRANSITIONS: Record<CompanyStatus, CompanyStatus[]> = {
  active: ["suspended", "deactivated", "archived"],
  suspended: ["active", "deactivated", "archived"],
  deactivated: ["active", "archived"],
  archived: ["deactivated"],
};

// ---------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------

async function assertNotPlatformAdminEmail(db: Pick<Database, "select">, email: string) {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(platformAdmins, eq(platformAdmins.userId, users.id))
    .where(sql`lower(${users.email}) = ${email.toLowerCase()}`);
  if (row) throw conflict("That email belongs to a platform administrator and cannot administer a company.");
}

async function assertNoDuplicateCompany(
  db: Pick<Database, "select">,
  p: { legalName: string; country: string; registrationNumber: string | null },
  excludeId?: string,
) {
  const notSelf = excludeId ? ne(organizations.id, excludeId) : undefined;
  const [byName] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(and(sql`lower(${organizations.legalName}) = ${p.legalName.toLowerCase()}`, eq(organizations.country, p.country), isNull(organizations.deletedAt), notSelf));
  if (byName) throw conflict("A company with this legal name already exists in that country.");
  if (p.registrationNumber) {
    const [byReg] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(sql`lower(${organizations.registrationNumber}) = ${p.registrationNumber.toLowerCase()}`, eq(organizations.country, p.country), isNull(organizations.deletedAt), notSelf));
    if (byReg) throw conflict("A company with this registration number already exists in that country.");
  }
}

function mapDuplicate(e: unknown): never {
  if (isUniqueViolation(e, "organizations_legal_name_country_uq")) throw conflict("A company with this legal name already exists in that country.");
  if (isUniqueViolation(e, "organizations_registration_uq")) throw conflict("A company with this registration number already exists in that country.");
  throw e;
}

async function loadCompany(db: Pick<Database, "select">, id: string) {
  const [org] = await db.select().from(organizations).where(and(eq(organizations.id, id), isNull(organizations.deletedAt)));
  if (!org) throw notFound("Company");
  return org;
}

/** Revokes any pending invitation for this email, then issues a fresh single-use one. */
async function issueAdminInvitation(
  tx: Tx,
  o: {
    organizationId: string;
    ownerRoleId: string;
    invitedBy: string;
    admin: { name: string; email: string; phone: string | null; jobTitle: string | null };
  },
) {
  await tx
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(invitations.organizationId, o.organizationId),
        sql`lower(${invitations.email}) = ${o.admin.email.toLowerCase()}`,
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
      ),
    );
  const token = newToken();
  const [inv] = await tx
    .insert(invitations)
    .values({
      organizationId: o.organizationId,
      email: o.admin.email.toLowerCase(),
      roleId: o.ownerRoleId,
      tokenHash: hashToken(token),
      invitedBy: o.invitedBy,
      invitedName: o.admin.name,
      jobTitle: o.admin.jobTitle,
      phone: o.admin.phone,
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
    })
    .returning({ id: invitations.id });
  return { token, invitationId: inv.id, url: `${getConfig().APP_URL}/accept-invite/${token}` };
}

async function sendAdminInvite(companyName: string, admin: { name: string; email: string }, url: string) {
  return sendBestEffort({
    to: admin.email,
    subject: `You have been appointed administrator of ${companyName} on OneCRM`,
    text: `Hi ${admin.name},

You have been appointed as the administrator of ${companyName} on OneCRM.

Set your password and open the workspace (valid ${INVITE_TTL_DAYS} days, single use):
${url}

If you were not expecting this, ignore this email; nothing happens until the link is used.`,
  });
}

async function ownerRoleId(db: Pick<Database, "select">, organizationId: string) {
  const [r] = await db.select({ id: roles.id }).from(roles).where(and(eq(roles.organizationId, organizationId), eq(roles.key, "owner")));
  if (!r) throw invalid("Company has no administrator role");
  return r.id;
}

// ---------------------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------------------

export async function createCompany(actor: PlatformContext, input: CreateCompanyInput) {
  const data = createCompanySchema.parse(input);
  const { company, administrator, status } = data;
  await enforceRateLimit(`company-create:${actor.userId}`, 30, 60 * 60_000);
  const { db } = await getDatabase();

  const [plan] = await db.select().from(subscriptionPlans).where(and(eq(subscriptionPlans.id, company.planId), eq(subscriptionPlans.isActive, true)));
  if (!plan) throw invalid("Select an available subscription plan");
  await assertNotPlatformAdminEmail(db, administrator.email);
  await assertNoDuplicateCompany(db, { legalName: company.legalName, country: company.country, registrationNumber: company.registrationNumber });

  // One transaction: company, roles, pipeline, invitation and audit all commit together or not at all.
  let created;
  try {
    created = await db.transaction(async (tx) => {
      const { organizationId, roleIds } = await createCompanyRecords(tx, {
        createdBy: actor.userId,
        profile: {
          name: company.displayName,
          legalName: company.legalName,
          industry: company.industry,
          country: company.country,
          region: company.region,
          city: company.city,
          address: company.address,
          website: company.website,
          businessEmail: company.businessEmail,
          businessPhone: company.businessPhone,
          phoneCountryCode: company.phoneCountryCode,
          registrationNumber: company.registrationNumber,
          taxId: company.taxId,
          logoUrl: company.logoUrl,
          baseCurrency: company.baseCurrency,
          timezone: company.timezone,
          locale: company.locale,
          dateFormat: company.dateFormat,
          planId: plan.id,
          status,
        },
      });
      const invite = await issueAdminInvitation(tx, {
        organizationId,
        ownerRoleId: roleIds.owner,
        invitedBy: actor.userId,
        admin: administrator,
      });
      await platformAudit(tx, actor, {
        action: "company.created",
        entityType: "company",
        entityId: organizationId,
        organizationId,
        summary: `Created ${company.displayName} (${company.country}) on the ${plan.name} plan`,
        changes: { legalName: company.legalName, country: company.country, currency: company.baseCurrency, timezone: company.timezone, plan: plan.key, status },
        mirrorToCompany: true,
      });
      await platformAudit(tx, actor, {
        action: "company.administrator_invited",
        entityType: "invitation",
        entityId: invite.invitationId,
        organizationId,
        summary: `Invited ${administrator.email} as Company Admin of ${company.displayName}`,
        changes: { email: administrator.email },
        mirrorToCompany: true,
      });
      return { organizationId, invite };
    });
  } catch (e) {
    mapDuplicate(e);
  }

  // Outside the transaction: a mail outage must never undo or block company creation.
  const emailed = await sendAdminInvite(company.displayName, administrator, created.invite.url);
  return {
    organizationId: created.organizationId,
    companyName: company.displayName,
    administrator: { name: administrator.name, email: administrator.email },
    invitation: { url: created.invite.url, emailed, expiresInDays: INVITE_TTL_DAYS },
  };
}

// ---------------------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------------------

export async function updateCompany(actor: PlatformContext, organizationId: string, input: unknown) {
  const data = updateCompanySchema.parse(input);
  const { db } = await getDatabase();
  const before = await loadCompany(db, organizationId);

  const next = {
    name: data.displayName,
    legalName: data.legalName,
    industry: data.industry === undefined ? undefined : data.industry ?? "general",
    website: data.website,
    businessEmail: data.businessEmail,
    businessPhone: data.businessPhone,
    logoUrl: data.logoUrl,
    country: data.country,
    region: data.region,
    city: data.city,
    address: data.address,
    registrationNumber: data.registrationNumber,
    taxId: data.taxId,
    baseCurrency: data.baseCurrency,
    timezone: data.timezone,
    locale: data.locale,
    dateFormat: data.dateFormat,
    phoneCountryCode: data.phoneCountryCode,
    planId: data.planId,
  };
  const patch: Record<string, unknown> = {};
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, v] of Object.entries(next)) {
    if (v === undefined) continue;
    const cur = (before as Record<string, unknown>)[k];
    if ((cur ?? null) !== (v ?? null)) {
      patch[k] = v;
      changes[k] = { from: cur ?? null, to: v ?? null };
    }
  }
  if (Object.keys(patch).length === 0) return { organizationId, changed: false };

  if (patch.planId) {
    const [plan] = await db.select({ id: subscriptionPlans.id }).from(subscriptionPlans).where(and(eq(subscriptionPlans.id, patch.planId as string), eq(subscriptionPlans.isActive, true)));
    if (!plan) throw invalid("Select an available subscription plan");
  }
  if (patch.legalName || patch.country || patch.registrationNumber) {
    await assertNoDuplicateCompany(
      db,
      {
        legalName: (patch.legalName as string) ?? before.legalName ?? before.name,
        country: (patch.country as string) ?? before.country ?? "",
        registrationNumber: ("registrationNumber" in patch ? (patch.registrationNumber as string | null) : before.registrationNumber) ?? null,
      },
      organizationId,
    );
  }

  try {
    await db.transaction(async (tx) => {
      await tx.update(organizations).set({ ...patch, updatedAt: new Date() }).where(eq(organizations.id, organizationId));
      await platformAudit(tx, actor, {
        action: "planId" in changes ? "company.plan_changed" : "company.updated",
        entityType: "company",
        entityId: organizationId,
        organizationId,
        summary: `Updated ${Object.keys(changes).join(", ")} for ${before.name}`,
        changes,
        mirrorToCompany: true,
      });
    });
  } catch (e) {
    mapDuplicate(e);
  }
  return { organizationId, changed: true };
}

// ---------------------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------------------

export async function setCompanyStatus(actor: PlatformContext, organizationId: string, input: unknown) {
  const data = setCompanyStatusSchema.parse(input);
  const { db } = await getDatabase();
  const org = await loadCompany(db, organizationId);
  const from = org.status as CompanyStatus;
  if (from === data.status) throw conflict(`The company is already ${from}`);
  if (!STATUS_TRANSITIONS[from].includes(data.status)) throw conflict(`A ${from} company cannot become ${data.status}`);

  await db.transaction(async (tx) => {
    await tx
      .update(organizations)
      .set({
        status: data.status,
        statusReason: data.status === "active" ? null : data.reason ?? null,
        statusChangedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, organizationId));
    await platformAudit(tx, actor, {
      action: "company.status_changed",
      entityType: "company",
      entityId: organizationId,
      organizationId,
      summary: `${org.name}: ${from} → ${data.status}${data.reason ? ` (${data.reason})` : ""}`,
      changes: { status: { from, to: data.status }, reason: data.reason ?? null },
      mirrorToCompany: true,
    });
  });
  // No session surgery needed: every company request re-checks the company status, so access ends
  // on the member's very next request.
  return { organizationId, status: data.status };
}

/**
 * Protected deletion: only an ARCHIVED company, only with the legal name typed back and the Super
 * Admin's password re-entered. It is a soft delete (data retained, company hidden, name and
 * registration number freed for reuse); a hard purge is deliberately not offered.
 */
export async function deleteCompany(actor: PlatformContext, organizationId: string, input: unknown) {
  const data = deleteCompanySchema.parse(input);
  await enforceRateLimit(`company-delete:${actor.userId}`, 5, 15 * 60_000);
  const { db } = await getDatabase();
  const org = await loadCompany(db, organizationId);
  if (org.status !== "archived") throw conflict("Archive the company before deleting it.");
  if (data.confirmName.trim() !== (org.legalName ?? org.name)) throw invalid("The name you typed does not match the company legal name.");
  const [me] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, actor.userId));
  if (!me || !(await verifyPassword(data.password, me.passwordHash))) throw unauthenticated("Password is incorrect");

  await db.transaction(async (tx) => {
    await tx.update(organizations).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(organizations.id, organizationId));
    await tx
      .update(invitations)
      .set({ revokedAt: new Date() })
      .where(and(eq(invitations.organizationId, organizationId), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)));
    await platformAudit(tx, actor, {
      action: "company.deleted",
      entityType: "company",
      entityId: organizationId,
      organizationId,
      summary: `Deleted ${org.name} (${org.legalName ?? ""})`,
      changes: { legalName: org.legalName, country: org.country },
    });
  });
  return { organizationId };
}

// ---------------------------------------------------------------------------------------
// Company administrators
// ---------------------------------------------------------------------------------------

/** Appoints a (new) Company Admin: promotes an existing member, otherwise sends a secure invitation. */
export async function appointAdministrator(actor: PlatformContext, organizationId: string, input: unknown) {
  const admin = appointAdministratorSchema.parse(input);
  const { db } = await getDatabase();
  const org = await loadCompany(db, organizationId);
  if (org.status === "archived") throw conflict("Restore the company before appointing an administrator.");
  await assertNotPlatformAdminEmail(db, admin.email);
  const ownerRole = await ownerRoleId(db, organizationId);

  const [existing] = await db
    .select({ membershipId: organizationMembers.id, roleId: organizationMembers.roleId, status: organizationMembers.status, userId: users.id })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(eq(organizationMembers.organizationId, organizationId), sql`lower(${users.email}) = ${admin.email.toLowerCase()}`));

  if (existing) {
    if (existing.roleId === ownerRole && existing.status === "active") throw conflict("That person is already a Company Admin.");
    await db.transaction(async (tx) => {
      await tx.update(organizationMembers).set({ roleId: ownerRole, status: "active", updatedAt: new Date() }).where(eq(organizationMembers.id, existing.membershipId));
      await platformAudit(tx, actor, {
        action: "company.administrator_promoted",
        entityType: "member",
        entityId: existing.membershipId,
        organizationId,
        summary: `Promoted ${admin.email} to Company Admin of ${org.name}`,
        changes: { email: admin.email },
        mirrorToCompany: true,
      });
    });
    return { mode: "promoted" as const, invitation: null };
  }

  const invite = await db.transaction(async (tx) => {
    const inv = await issueAdminInvitation(tx, { organizationId, ownerRoleId: ownerRole, invitedBy: actor.userId, admin });
    await platformAudit(tx, actor, {
      action: "company.administrator_invited",
      entityType: "invitation",
      entityId: inv.invitationId,
      organizationId,
      summary: `Invited ${admin.email} as Company Admin of ${org.name}`,
      changes: { email: admin.email },
      mirrorToCompany: true,
    });
    return inv;
  });
  const emailed = await sendAdminInvite(org.name, admin, invite.url);
  return { mode: "invited" as const, invitation: { url: invite.url, emailed, expiresInDays: INVITE_TTL_DAYS } };
}

/** Steps a Company Admin down to Admin. Refuses to leave the company without an active Company Admin. */
export async function demoteAdministrator(actor: PlatformContext, organizationId: string, membershipId: string) {
  const { db } = await getDatabase();
  const org = await loadCompany(db, organizationId);
  const ownerRole = await ownerRoleId(db, organizationId);
  const [target] = await db
    .select({ id: organizationMembers.id, roleId: organizationMembers.roleId, email: users.email })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(eq(organizationMembers.id, membershipId), eq(organizationMembers.organizationId, organizationId)));
  if (!target || target.roleId !== ownerRole) throw notFound("Company administrator");

  await db.transaction(async (tx) => {
    const [owners] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.roleId, ownerRole), eq(organizationMembers.status, "active")));
    if (owners.n <= 1) throw conflict("A company must keep at least one active Company Admin. Appoint another one first.");
    const adminRole = await tx.select({ id: roles.id }).from(roles).where(and(eq(roles.organizationId, organizationId), eq(roles.key, "admin")));
    await tx.update(organizationMembers).set({ roleId: adminRole[0].id, updatedAt: new Date() }).where(eq(organizationMembers.id, membershipId));
    await platformAudit(tx, actor, {
      action: "company.administrator_demoted",
      entityType: "member",
      entityId: membershipId,
      organizationId,
      summary: `Changed ${target.email} from Company Admin to Admin in ${org.name}`,
      changes: { email: target.email },
      mirrorToCompany: true,
    });
  });
  return { membershipId };
}
