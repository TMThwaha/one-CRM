import "server-only";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { getDatabase } from "@/server/db/client";
import {
  auditLogs,
  organizationMembers,
  organizations,
  platformAdmins,
  platformAuditLogs,
  rolePermissions,
  roles,
  subscriptionPlans,
  users,
} from "@/server/db/schema";
import { createCompanyRecords } from "@/server/modules/identity/auth.service";
import { hashPassword } from "@/server/platform/crypto";
import { getCountry } from "@/shared/countries";
import { passwordSchema } from "@/shared/schemas/identity";

/**
 * DEVELOPMENT ONLY. Creates one dummy company and its Company Admin so the app can be tried without
 * going through the Super Admin panel. It refuses to run in production, never stores a password in
 * source (the caller supplies it at run time), and is idempotent: running it again changes nothing.
 *
 * Mapping notes (the schema has no such columns, so nothing was invented):
 *  - company code  -> organizations.slug (lower-cased)
 *  - PIN code      -> appended to the address line
 *  - description   -> not stored
 *  - username      -> not a concept here: people sign in with their email address
 *  - "Super Admin" -> the company's top role, "Company Admin" (the `owner` system role). A platform
 *    Super Admin sits outside every company and can never be a company member, by design.
 */
export const NEXORA = {
  code: "NEX001",
  legalName: "Nexora Technologies Pvt Ltd",
  email: "admin@nexoratech.test",
  phone: "+91 9876543210",
  address: "Technopark, Kazhakkoottam, PIN 695581",
  city: "Thiruvananthapuram",
  region: "Kerala",
  country: "IN",
  website: "https://nexoratech.test",
  industry: "technology",
  admin: { name: "System Administrator", email: "admin@nexoratech.test", jobTitle: "System Administrator" },
} as const;

export interface DevSeedInput {
  company: typeof NEXORA;
  password: string;
}

export interface DevSeedReport {
  company: { id: string; name: string; code: string; slug: string; email: string | null; status: string; country: string | null; planName: string | null; created: boolean };
  admin: { id: string; name: string; email: string; roleKey: string; roleName: string; permissions: number; membershipStatus: string; userCreated: boolean; membershipCreated: boolean };
}

export async function seedDevCompany(input: DevSeedInput, nodeEnv: string | undefined = process.env.NODE_ENV): Promise<DevSeedReport> {
  if (nodeEnv === "production") throw new Error("Refusing to seed dummy data: NODE_ENV is production.");
  const pw = passwordSchema.safeParse(input.password);
  if (!pw.success) throw new Error(`Seed password rejected: ${pw.error.issues[0].message}`);

  const c = input.company;
  const country = getCountry(c.country);
  if (!country) throw new Error(`Unknown country ${c.country}`);
  const adminEmail = c.admin.email.toLowerCase();
  const { db } = await getDatabase();

  // A platform administrator can never be a company member; do not even try.
  const [pa] = await db.select({ id: users.id }).from(users).innerJoin(platformAdmins, eq(platformAdmins.userId, users.id)).where(sql`lower(${users.email}) = ${adminEmail}`);
  if (pa) throw new Error(`${adminEmail} is a platform administrator and cannot be a company administrator.`);

  const [existingUser] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${adminEmail}`);
  // Hash only when a new account is needed (scrypt is deliberately slow). An existing account's password is never touched.
  const passwordHash = existingUser ? null : await hashPassword(input.password);
  const [starter] = await db.select({ id: subscriptionPlans.id }).from(subscriptionPlans).where(eq(subscriptionPlans.key, "starter"));

  const flags = await db.transaction(async (tx) => {
    // ---- company (duplicate = same legal name in the same country, the platform's own rule)
    let [org] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(sql`lower(${organizations.legalName}) = ${c.legalName.toLowerCase()}`, eq(organizations.country, c.country), isNull(organizations.deletedAt)));
    let companyCreated = false;
    if (!org) {
      const made = await createCompanyRecords(tx, {
        createdBy: null,
        profile: {
          name: c.legalName,
          legalName: c.legalName,
          industry: c.industry,
          country: c.country,
          region: c.region,
          city: c.city,
          address: c.address,
          website: c.website,
          businessEmail: c.email,
          businessPhone: c.phone,
          phoneCountryCode: country.phoneCode,
          baseCurrency: country.currency,
          timezone: country.timeZone,
          locale: country.locale,
          dateFormat: country.dateFormat,
          planId: starter?.id ?? null,
          status: "active",
        },
      });
      org = { id: made.organizationId };
      companyCreated = true;
      // Company code -> slug, only if no other company already uses it.
      const slug = c.code.toLowerCase();
      const [clash] = await tx.select({ id: organizations.id }).from(organizations).where(and(eq(organizations.slug, slug), ne(organizations.id, org.id)));
      if (!clash) await tx.update(organizations).set({ slug }).where(eq(organizations.id, org.id));
      const summary = `[dev seed] Created ${c.legalName} (${c.code})`;
      await tx.insert(platformAuditLogs).values({ actorEmail: "dev-seed", action: "company.created", entityType: "company", entityId: org.id, organizationId: org.id, summary, changes: { source: "dev seed" } });
      await tx.insert(auditLogs).values({ organizationId: org.id, action: "platform.company.created", entityType: "company", entityId: org.id, summary, changes: { source: "dev seed" } });
    }

    // ---- administrator account
    let userId = existingUser?.id;
    let userCreated = false;
    if (!userId) {
      const [u] = await tx
        .insert(users)
        .values({ email: adminEmail, name: c.admin.name, passwordHash: passwordHash!, emailVerifiedAt: new Date() })
        .returning({ id: users.id });
      userId = u.id;
      userCreated = true;
    }

    // ---- membership with the company's top role
    const [ownerRole] = await tx.select({ id: roles.id }).from(roles).where(and(eq(roles.organizationId, org.id), eq(roles.key, "owner")));
    const [member] = await tx
      .select({ id: organizationMembers.id, roleId: organizationMembers.roleId, status: organizationMembers.status })
      .from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, org.id), eq(organizationMembers.userId, userId)));
    let membershipCreated = false;
    if (!member) {
      await tx.insert(organizationMembers).values({ organizationId: org.id, userId, roleId: ownerRole.id, jobTitle: c.admin.jobTitle });
      membershipCreated = true;
    } else if (member.roleId !== ownerRole.id || member.status !== "active") {
      await tx.update(organizationMembers).set({ roleId: ownerRole.id, status: "active", updatedAt: new Date() }).where(eq(organizationMembers.id, member.id));
      membershipCreated = true;
    }
    if (userCreated || membershipCreated) {
      await tx.insert(platformAuditLogs).values({
        actorEmail: "dev-seed", action: "company.administrator_seeded", entityType: "member", organizationId: org.id,
        summary: `[dev seed] ${adminEmail} is Company Admin of ${c.legalName}`, changes: { email: adminEmail, userCreated },
      });
    }
    return { orgId: org.id, userId, companyCreated, userCreated, membershipCreated };
  });

  // ---- read back what is actually in the database (never report from memory)
  const [org] = await db
    .select({ o: organizations, planName: sql<string | null>`(select name from subscription_plans p where p.id = ${organizations.planId})` })
    .from(organizations)
    .where(eq(organizations.id, flags.orgId));
  const [m] = await db
    .select({ membershipId: organizationMembers.id, status: organizationMembers.status, roleId: roles.id, roleKey: roles.key, roleName: roles.name, name: users.name, email: users.email })
    .from(organizationMembers)
    .innerJoin(roles, eq(roles.id, organizationMembers.roleId))
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(eq(organizationMembers.organizationId, flags.orgId), eq(organizationMembers.userId, flags.userId)));
  const [perm] = await db.select({ n: sql<number>`count(*)::int` }).from(rolePermissions).where(eq(rolePermissions.roleId, m.roleId));

  return {
    company: {
      id: org.o.id, name: org.o.name, code: c.code, slug: org.o.slug, email: org.o.businessEmail, status: org.o.status,
      country: org.o.country, planName: org.planName, created: flags.companyCreated,
    },
    admin: {
      id: flags.userId, name: m.name, email: m.email, roleKey: m.roleKey, roleName: m.roleName, permissions: perm.n,
      membershipStatus: m.status, userCreated: flags.userCreated, membershipCreated: flags.membershipCreated,
    },
  };
}
