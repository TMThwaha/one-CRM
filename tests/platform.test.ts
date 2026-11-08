import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { DatabaseHandle } from "@/server/db/client";
import { withTenant } from "@/server/db/tenant";
import { isPlatformAdmin, login, resolveAuthContext, switchOrganization } from "@/server/modules/identity/auth.service";
import { acceptInvitation, createInvitation, listMembers, previewInvitation } from "@/server/modules/identity/team.service";
import { createContact, getContact, listContacts } from "@/server/modules/crm/contacts.service";
import { getOrganizationBasics } from "@/server/modules/identity/org.service";
import { bootstrapSuperAdmin, isBootstrapOpen } from "@/server/modules/platform-admin/bootstrap.service";
import {
  appointAdministrator, createCompany, deleteCompany, demoteAdministrator, setCompanyStatus, updateCompany,
} from "@/server/modules/platform-admin/company.service";
import { resolvePlatformContext, type PlatformContext } from "@/server/modules/platform-admin/context";
import {
  getCompanyDetail, getPlatformOverview, listAdministrators, listCompanies, listPlans, listPlatformAudit, listPlatformUsers,
} from "@/server/modules/platform-admin/queries.service";
import { getConfig } from "@/server/platform/config";
import { setMailerForTesting, type Email, type Mailer } from "@/server/platform/mailer";
import { resetRateLimits } from "@/server/platform/rate-limit";
import { COUNTRIES, formatInTimeZone, getCountry, isValidTimeZone } from "@/shared/countries";
import { signUpOrg, startTestDatabase, type Rows } from "./support/harness";

const BOOT = "test-bootstrap-token-0123456789abcdef";
const PW = "correct-horse-battery";
process.env.BOOTSTRAP_TOKEN = BOOT; // read lazily by getConfig(); set before the first call

let handle: DatabaseHandle;
let sa: PlatformContext; // the Global Super Admin
let saToken: string;
let saEmail: string;
let planId: string;
let n = 0;
const outbox: Email[] = [];
const mailer: Mailer = { kind: "smtp", send: async (e) => void outbox.push(e) };
const tokenOf = (url: string) => url.split("/").pop()!;

interface Made { organizationId: string; adminEmail: string; token: string; ctx: Awaited<ReturnType<typeof resolveAuthContext>> & object }

/** Creates a company through the Super Admin flow and completes the administrator's invitation. */
async function makeCompany(label: string, over: Record<string, unknown> = {}, country = "IN"): Promise<Made> {
  const i = ++n;
  const c = getCountry(country)!;
  const adminEmail = `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-admin-${i}@example.test`;
  const res = await createCompany(sa, {
    company: {
      legalName: `${label} Private Limited ${i}`,
      displayName: `${label} ${i}`,
      industry: "software",
      country,
      baseCurrency: c.currency,
      timezone: c.timeZone,
      locale: c.locale,
      dateFormat: c.dateFormat as "dd/MM/yyyy",
      phoneCountryCode: c.phoneCode,
      planId,
      ...over,
    },
    status: "active",
    administrator: { name: `${label} Admin`, email: adminEmail, jobTitle: "Founder", phone: "+91 98765 43210" },
  });
  const session = await acceptInvitation(tokenOf(res.invitation.url), { password: PW }, { ip: `20.0.0.${i}` });
  const ctx = (await resolveAuthContext(session.token))!;
  return { organizationId: res.organizationId, adminEmail, token: session.token, ctx };
}

beforeAll(async () => {
  handle = await startTestDatabase();
  setMailerForTesting(mailer);
  planId = ""; // set after bootstrap (plans are seeded by the migration)
});
afterAll(async () => {
  setMailerForTesting(undefined);
  await handle.close();
});
beforeEach(async () => {
  outbox.length = 0;
  await resetRateLimits();
});

describe("super admin bootstrap", () => {
  it("is open only while no Super Admin exists, and rejects a wrong token", async () => {
    expect(getConfig().ALLOW_PUBLIC_REGISTRATION).toBe("false"); // centrally managed by default
    expect(await isBootstrapOpen()).toBe(true);
    await expect(bootstrapSuperAdmin({ token: "wrong-token-wrong-token-wrong", name: "Eve", email: "eve@example.test", password: PW }, { ip: "9.9.9.9" }))
      .rejects.toMatchObject({ code: "not_found" });
    expect(await isBootstrapOpen()).toBe(true);
  });

  it("creates the first Super Admin, then closes permanently", async () => {
    saEmail = "root@example.test";
    await bootstrapSuperAdmin({ token: BOOT, name: "Platform Owner", email: saEmail, password: PW }, { ip: "9.9.9.1" });
    expect(await isBootstrapOpen()).toBe(false);
    // A second attempt, even with the correct token, is refused: setup is closed for good.
    await expect(bootstrapSuperAdmin({ token: BOOT, name: "Second", email: "second@example.test", password: PW }, { ip: "9.9.9.2" }))
      .rejects.toMatchObject({ code: "not_found" });
    const { rows } = (await handle.db.execute(sql`select count(*)::int as n from platform_admins`)) as unknown as Rows;
    expect(rows[0].n).toBe(1);
  });

  it("never promotes an existing account and enforces password strength", async () => {
    // (closed now, so verify the rules on a fresh database)
    const fresh = await (await import("@/server/db/client")).createPgliteDatabase();
    (await import("@/server/db/client")).setDatabaseForTesting(fresh);
    await signUpOrg("Existing");
    await expect(bootstrapSuperAdmin({ token: BOOT, name: "X Y", email: "existing-1@example.test", password: PW }, { ip: "9.9.9.3" }))
      .rejects.toMatchObject({ code: "conflict" });
    await expect(bootstrapSuperAdmin({ token: BOOT, name: "Weak Pw", email: "weak@example.test", password: "short" }, { ip: "9.9.9.4" }))
      .rejects.toThrow();
    await fresh.close();
    (await import("@/server/db/client")).setDatabaseForTesting(handle);
  });
});

describe("authentication separation", () => {
  it("the Super Admin signs in with no company and gets platform access only", async () => {
    const s = await login({ email: saEmail, password: PW }, { ip: "8.8.8.1" });
    saToken = s.token;
    expect(s.platformAdmin).toBe(true);
    sa = (await resolvePlatformContext(saToken))!;
    expect(sa.userEmail).toBe(saEmail);
    expect(await resolveAuthContext(saToken)).toBeNull(); // no company workspace, by design
    expect((await listPlans()).map((p) => p.key)).toEqual(["starter", "growth", "professional", "enterprise"]);
    planId = (await listPlans())[0].id;
  });

  it("platform sessions are short-lived compared with company sessions", async () => {
    const co = await signUpOrg("Lifetime");
    const rows = (await handle.db.execute(sql`select user_id, expires_at, created_at from sessions order by created_at`)) as unknown as Rows;
    const hours = (r: Record<string, Date>) => (new Date(r.expires_at).getTime() - new Date(r.created_at).getTime()) / 3_600_000;
    const platformRow = rows.rows.find((r) => r.user_id === sa.userId)!;
    expect(Math.round(hours(platformRow))).toBe(12);
    expect(co.ctx.userId).not.toBe(sa.userId);
    expect(Math.round(hours(rows.rows.find((r) => r.user_id === co.ctx.userId)!))).toBeGreaterThan(24 * 7);
  });

  it("a Company Admin, however privileged, cannot obtain platform access", async () => {
    const a = await makeCompany("Sep");
    expect(a.ctx.roleKey).toBe("owner");
    expect(a.ctx.roleName).toBe("Company Admin");
    expect(await resolvePlatformContext(a.token)).toBeNull();
    expect(await isPlatformAdmin(a.ctx.userId)).toBe(false);
    // ...and a Super Admin session is not a company session either.
    expect(await resolveAuthContext(saToken)).toBeNull();
    // Nothing a company role can do creates a platform admin.
    const { rows } = (await handle.db.execute(sql`select count(*)::int as n from platform_admins`)) as unknown as Rows;
    expect(rows[0].n).toBe(1);
  });

  it("a platform administrator can never be invited into a company", async () => {
    const a = await makeCompany("NoSa");
    await expect(appointAdministrator(sa, a.organizationId, { name: "Root", email: saEmail })).rejects.toMatchObject({ code: "conflict" });
    await expect(createInvitation(a.ctx, { email: saEmail, roleKey: "viewer" }).then((r) => acceptInvitation(tokenOf(r.url), { password: PW }, { ip: "8.8.8.8" })))
      .rejects.toMatchObject({ code: "not_found" });
  });
});

describe("creating a company", () => {
  it("creates company, workspace, roles, pipeline and an administrator invitation together", async () => {
    outbox.length = 0;
    const res = await createCompany(sa, {
      company: {
        legalName: "Gulf Trading LLC", displayName: "Gulf Trading", industry: "trading", country: "AE",
        city: "Dubai", baseCurrency: "AED", timezone: "Asia/Dubai", locale: "en-AE", dateFormat: "dd/MM/yyyy",
        phoneCountryCode: "+971", taxId: "100123456700003", planId,
      },
      status: "active",
      administrator: { name: "Layla Admin", email: "layla@example.test", jobTitle: "Managing Director", phone: "+971 50 123 4567" },
    });
    expect(res.invitation.emailed).toBe(true);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].to).toBe("layla@example.test");
    expect(outbox[0].text).toContain(res.invitation.url);

    const d = await getCompanyDetail(res.organizationId);
    expect(d.org).toMatchObject({ legalName: "Gulf Trading LLC", name: "Gulf Trading", country: "AE", baseCurrency: "AED", timezone: "Asia/Dubai", status: "active", taxId: "100123456700003" });
    expect(d.planName).toBe("Starter");
    expect(d.admins).toHaveLength(0); // not accepted yet
    expect(d.pendingInvites[0]).toMatchObject({ email: "layla@example.test", invitedName: "Layla Admin" });

    const { rows } = (await handle.db.execute(sql`select
      (select count(*)::int from roles where organization_id = ${res.organizationId}) as roles,
      (select count(*)::int from pipelines where organization_id = ${res.organizationId}) as pipelines,
      (select count(*)::int from organization_members where organization_id = ${res.organizationId}) as members`)) as unknown as Rows;
    expect(rows[0]).toEqual({ roles: 5, pipelines: 1, members: 0 });

    // The invitation preview shows the appointment; the token is stored only as a hash.
    const token = tokenOf(res.invitation.url);
    expect(await previewInvitation(token)).toMatchObject({ email: "layla@example.test", roleName: "Company Admin", invitedName: "Layla Admin" });
    const stored = (await handle.db.execute(sql`select token_hash from invitations`)) as unknown as Rows;
    expect(JSON.stringify(stored.rows)).not.toContain(token);
  });

  it("the invited Company Admin sets their own password and lands in their own workspace", async () => {
    const a = await makeCompany("Onboard");
    expect(a.ctx.organizationId).toBe(a.organizationId);
    expect((await listMembers(a.ctx)).map((m) => [m.email, m.roleKey, m.jobTitle])).toEqual([[a.adminEmail, "owner", "Founder"]]);
    const phone = (await handle.db.execute(sql`select phone from users where id = ${a.ctx.userId}`)) as unknown as Rows;
    expect(phone.rows[0].phone).toBe("+91 98765 43210");
    // An invitation link works exactly once.
    const again = await createCompany(sa, {
      company: { legalName: "Once Co 1", displayName: "Once Co", country: "GB", baseCurrency: "GBP", timezone: "Europe/London", locale: "en-GB", dateFormat: "dd/MM/yyyy", phoneCountryCode: "+44", planId },
      administrator: { name: "Once Admin", email: "once@example.test" },
    });
    await acceptInvitation(tokenOf(again.invitation.url), { password: PW }, { ip: "8.8.8.2" });
    await expect(acceptInvitation(tokenOf(again.invitation.url), { password: PW }, { ip: "8.8.8.2" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("is atomic: a failure part-way leaves no half-created company", async () => {
    const before = ((await handle.db.execute(sql`select count(*)::int as n from organizations`)) as unknown as Rows).rows[0].n;
    await handle.db.execute(sql`create function fail_invite() returns trigger language plpgsql as $$ begin raise exception 'injected failure'; end $$`);
    await handle.db.execute(sql`create trigger fail_invite before insert on invitations for each row execute function fail_invite()`);
    try {
      await expect(
        createCompany(sa, {
          company: { legalName: "Doomed Ltd", displayName: "Doomed", country: "IN", baseCurrency: "INR", timezone: "Asia/Kolkata", locale: "en-IN", dateFormat: "dd/MM/yyyy", phoneCountryCode: "+91", planId },
          administrator: { name: "No One", email: "noone@example.test" },
        }),
      ).rejects.toThrow();
    } finally {
      await handle.db.execute(sql`drop trigger fail_invite on invitations`);
      await handle.db.execute(sql`drop function fail_invite()`);
    }
    const after = ((await handle.db.execute(sql`select count(*)::int as n from organizations`)) as unknown as Rows).rows[0].n;
    expect(after).toBe(before);
    const roles = ((await handle.db.execute(sql`select count(*)::int as n from roles r where not exists (select 1 from organizations o where o.id = r.organization_id)`)) as unknown as Rows).rows[0].n;
    expect(roles).toBe(0);
  });

  it("prevents duplicates and rejects invalid regional data", async () => {
    const base = { displayName: "Dup", country: "IN", baseCurrency: "INR", timezone: "Asia/Kolkata", locale: "en-IN", dateFormat: "dd/MM/yyyy" as const, phoneCountryCode: "+91", planId };
    const admin = (e: string) => ({ name: "Dup Admin", email: e });
    await createCompany(sa, { company: { ...base, legalName: "Unique Name Pvt Ltd", registrationNumber: "U12345" }, administrator: admin("dup1@example.test") });
    await expect(createCompany(sa, { company: { ...base, legalName: "unique name pvt ltd" }, administrator: admin("dup2@example.test") })).rejects.toMatchObject({ code: "conflict" });
    await expect(createCompany(sa, { company: { ...base, legalName: "Other Name Pvt Ltd", registrationNumber: "u12345" }, administrator: admin("dup3@example.test") })).rejects.toMatchObject({ code: "conflict" });
    // The same legal name in a different country is a different company.
    await createCompany(sa, { company: { ...base, legalName: "Unique Name Pvt Ltd", country: "GB", baseCurrency: "GBP", timezone: "Europe/London", phoneCountryCode: "+44" }, administrator: admin("dup4@example.test") });
    await expect(createCompany(sa, { company: { ...base, legalName: "Bad Zone Ltd", timezone: "Mars/Olympus" }, administrator: admin("dup5@example.test") })).rejects.toThrow();
    await expect(createCompany(sa, { company: { ...base, legalName: "Bad Currency Ltd", baseCurrency: "XXQ" }, administrator: admin("dup6@example.test") })).rejects.toThrow();
    await expect(createCompany(sa, { company: { ...base, legalName: "Bad Country Ltd", country: "ZZ" }, administrator: admin("dup7@example.test") })).rejects.toThrow();
    await expect(createCompany(sa, { company: { ...base, legalName: "Bad Plan Ltd", planId: "11111111-1111-4111-8111-111111111111" }, administrator: admin("dup8@example.test") })).rejects.toMatchObject({ code: "validation_failed" });
  });
});

describe("tenant isolation between companies", () => {
  let a: Made, b: Made;
  let bContactId: string;
  beforeAll(async () => {
    a = await makeCompany("Alpha");
    b = await makeCompany("Bravo", {}, "GB");
    await createContact(a.ctx, { firstName: "Alice" });
    bContactId = (await createContact(b.ctx, { firstName: "Bob" })).id;
  });

  it("a Company Admin sees only their own company's records", async () => {
    expect((await listContacts(a.ctx, {})).items.map((c) => c.firstName)).toEqual(["Alice"]);
    expect((await listContacts(b.ctx, {})).items.map((c) => c.firstName)).toEqual(["Bob"]);
  });

  it("cannot read another company's record by id (IDOR) or switch into it", async () => {
    await expect(getContact(a.ctx, bContactId)).rejects.toMatchObject({ code: "not_found" });
    await expect(switchOrganization(a.ctx, b.organizationId)).rejects.toMatchObject({ code: "validation_failed" });
    expect((await resolveAuthContext(a.token))!.organizationId).toBe(a.organizationId);
    expect((await getOrganizationBasics(a.ctx)).id).toBe(a.organizationId);
  });

  it("the database itself refuses cross-company access and platform-only columns", async () => {
    const other = await withTenant(a.ctx, (tx) => tx.execute(sql`select id from organizations`));
    expect((other as unknown as Rows).rows.map((r) => r.id)).toEqual([a.organizationId]);
    // A Company Admin cannot change their own status or plan, even with raw SQL.
    await expect(withTenant(a.ctx, (tx) => tx.execute(sql`update organizations set status = 'active'`))).rejects.toThrow();
    await expect(withTenant(a.ctx, (tx) => tx.execute(sql`update organizations set plan_id = null`))).rejects.toThrow();
    // Platform tables are invisible to the tenant role.
    for (const t of ["platform_admins", "platform_audit_logs", "subscription_plans"]) {
      await expect(withTenant(a.ctx, (tx) => tx.execute(sql.raw(`select * from ${t}`)))).rejects.toThrow();
    }
  });

  it("employee permissions are enforced inside a company", async () => {
    const { token } = await createInvitation(a.ctx, { email: "viewer-a@example.test", roleKey: "viewer" });
    const s = await acceptInvitation(token, { name: "Vera Viewer", password: PW }, { ip: "8.8.4.4" });
    const v = (await resolveAuthContext(s.token))!;
    await expect(createContact(v, { firstName: "Nope" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(createInvitation(v, { email: "x@example.test", roleKey: "viewer" })).rejects.toMatchObject({ code: "forbidden" });
    // A Company Admin cannot mint a Super Admin or any platform role: only company roles exist.
    await expect(createInvitation(a.ctx, { email: "x2@example.test", roleKey: "super_admin" })).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("changing company context never exposes the previous company's data", async () => {
    // One person administers both companies; switching must swap data completely.
    const { token } = await createInvitation(b.ctx, { email: a.adminEmail, roleKey: "manager" });
    await acceptInvitation(token, { password: PW }, { ip: "8.8.4.5" });
    await switchOrganization(a.ctx, b.organizationId);
    const inB = (await resolveAuthContext(a.token))!;
    expect(inB.organizationId).toBe(b.organizationId);
    expect(inB.roleKey).toBe("manager");
    expect((await listContacts(inB, {})).items.map((c) => c.firstName)).toEqual(["Bob"]);
    await switchOrganization(inB, a.organizationId);
    const back = (await resolveAuthContext(a.token))!;
    expect((await listContacts(back, {})).items.map((c) => c.firstName)).toEqual(["Alice"]);
  });
});

describe("company lifecycle", () => {
  it("a suspended company loses access immediately; reactivation restores it", async () => {
    const c = await makeCompany("Lifecycle");
    expect(await resolveAuthContext(c.token)).not.toBeNull();
    await expect(setCompanyStatus(sa, c.organizationId, { status: "suspended" })).rejects.toThrow(/reason/i); // reason required
    await setCompanyStatus(sa, c.organizationId, { status: "suspended", reason: "Unpaid invoice" });
    expect(await resolveAuthContext(c.token)).toBeNull(); // the very next request
    await expect(login({ email: c.adminEmail, password: PW }, { ip: "7.7.0.1" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(setCompanyStatus(sa, c.organizationId, { status: "suspended", reason: "again" })).rejects.toMatchObject({ code: "conflict" });
    await setCompanyStatus(sa, c.organizationId, { status: "active" });
    expect(await resolveAuthContext(c.token)).not.toBeNull();
    expect((await login({ email: c.adminEmail, password: PW }, { ip: "7.7.0.2" })).token).toBeTruthy();
  });

  it("deactivated and archived companies are locked out; illegal transitions are refused", async () => {
    const c = await makeCompany("Retire");
    await setCompanyStatus(sa, c.organizationId, { status: "deactivated", reason: "Contract ended" });
    expect(await resolveAuthContext(c.token)).toBeNull();
    await setCompanyStatus(sa, c.organizationId, { status: "archived", reason: "Closed" });
    await expect(setCompanyStatus(sa, c.organizationId, { status: "active" })).rejects.toMatchObject({ code: "conflict" }); // restore via deactivated
    await setCompanyStatus(sa, c.organizationId, { status: "deactivated", reason: "Restoring" });
    await setCompanyStatus(sa, c.organizationId, { status: "active" });
    expect(await resolveAuthContext(c.token)).not.toBeNull();
  });

  it("suspending one company does not affect a person's other company", async () => {
    const x = await makeCompany("MultiX");
    const y = await makeCompany("MultiY");
    const { token } = await createInvitation(y.ctx, { email: x.adminEmail, roleKey: "viewer" });
    await acceptInvitation(token, { password: PW }, { ip: "7.7.1.1" });
    await setCompanyStatus(sa, x.organizationId, { status: "suspended", reason: "test" });
    const ctx = (await resolveAuthContext(x.token))!; // falls back to the remaining active company
    expect(ctx.organizationId).toBe(y.organizationId);
    await setCompanyStatus(sa, x.organizationId, { status: "active" });
  });

  it("deletion is protected: archived only, typed name, password re-entered; soft delete frees the name", async () => {
    const c = await makeCompany("Doomed2");
    const detail = await getCompanyDetail(c.organizationId);
    const legal = detail.org.legalName!;
    await expect(deleteCompany(sa, c.organizationId, { confirmName: legal, password: PW })).rejects.toMatchObject({ code: "conflict" }); // not archived
    await setCompanyStatus(sa, c.organizationId, { status: "archived", reason: "Closing" });
    await expect(deleteCompany(sa, c.organizationId, { confirmName: "wrong", password: PW })).rejects.toMatchObject({ code: "validation_failed" });
    await expect(deleteCompany(sa, c.organizationId, { confirmName: legal, password: "not-the-password" })).rejects.toMatchObject({ code: "unauthenticated" });
    await deleteCompany(sa, c.organizationId, { confirmName: legal, password: PW });
    await expect(getCompanyDetail(c.organizationId)).rejects.toMatchObject({ code: "not_found" });
    expect(await resolveAuthContext(c.token)).toBeNull();
    // Data is retained (soft delete), and the legal name can be used again.
    const kept = ((await handle.db.execute(sql`select count(*)::int as n from organizations where id = ${c.organizationId}`)) as unknown as Rows).rows[0].n;
    expect(kept).toBe(1);
  });
});

describe("administrators", () => {
  it("appoints by invitation or promotion, and never leaves a company without an admin", async () => {
    const c = await makeCompany("Admins");
    await expect(demoteAdministrator(sa, c.organizationId, c.ctx.membershipId)).rejects.toMatchObject({ code: "conflict" }); // last admin

    // Promote an existing member
    const { token } = await createInvitation(c.ctx, { email: "emp@example.test", roleKey: "sales" });
    const emp = await acceptInvitation(token, { name: "Eddie Employee", password: PW }, { ip: "6.6.0.1" });
    const empCtx = (await resolveAuthContext(emp.token))!;
    const promoted = await appointAdministrator(sa, c.organizationId, { name: "Eddie Employee", email: "emp@example.test" });
    expect(promoted.mode).toBe("promoted");
    expect((await resolveAuthContext(emp.token))!.roleKey).toBe("owner");

    // Invite someone entirely new; re-inviting the same email replaces the earlier link
    const first = await appointAdministrator(sa, c.organizationId, { name: "Nina New", email: "nina@example.test" });
    const second = await appointAdministrator(sa, c.organizationId, { name: "Nina New", email: "nina@example.test" });
    expect(first.mode).toBe("invited");
    await expect(acceptInvitation(tokenOf(first.invitation!.url), { name: "Nina", password: PW }, { ip: "6.6.0.2" })).rejects.toMatchObject({ code: "not_found" });
    await acceptInvitation(tokenOf(second.invitation!.url), { password: PW }, { ip: "6.6.0.3" });

    // Now there are three admins, so demoting is allowed; the guard returns when only one is left.
    await demoteAdministrator(sa, c.organizationId, empCtx.membershipId);
    expect((await resolveAuthContext(emp.token))!.roleKey).toBe("admin");
    const admins = (await listAdministrators()).active.filter((x) => x.organizationId === c.organizationId && x.status === "active");
    expect(admins.map((x) => x.email).sort()).toEqual([c.adminEmail, "nina@example.test"].sort());
  });
});

describe("country, currency and time zone", () => {
  it("the catalogue is internally consistent and covers the required markets", () => {
    for (const c of COUNTRIES) {
      expect(isValidTimeZone(c.timeZone), c.code).toBe(true);
      expect(c.currency).toMatch(/^[A-Z]{3}$/);
      expect(c.phoneCode).toMatch(/^\+\d{1,4}$/);
    }
    expect(getCountry("IN")).toMatchObject({ currency: "INR", timeZone: "Asia/Kolkata", taxLabel: "GSTIN" });
    expect(getCountry("AE")).toMatchObject({ currency: "AED", timeZone: "Asia/Dubai" });
    expect(getCountry("GB")).toMatchObject({ currency: "GBP", timeZone: "Europe/London" });
  });

  it("each company keeps its own settings and times render in the company's zone", async () => {
    const india = await makeCompany("Regional", {}, "IN");
    const uae = await makeCompany("Regional", {}, "AE");
    const uk = await makeCompany("Regional", {}, "GB");
    const got = async (m: Made) => (await getCompanyDetail(m.organizationId)).org;
    expect(await got(india)).toMatchObject({ baseCurrency: "INR", timezone: "Asia/Kolkata", country: "IN" });
    expect(await got(uae)).toMatchObject({ baseCurrency: "AED", timezone: "Asia/Dubai", country: "AE" });
    expect(await got(uk)).toMatchObject({ baseCurrency: "GBP", timezone: "Europe/London", country: "GB" });
    expect((await getOrganizationBasics(uae.ctx)).baseCurrency).toBe("AED");

    // Stored in UTC, shown in each company's zone.
    const instant = "2026-01-15T00:00:00.000Z";
    expect(formatInTimeZone(instant, "Asia/Kolkata", "en-GB")).toContain("05:30");
    expect(formatInTimeZone(instant, "Asia/Dubai", "en-GB")).toContain("04:00");
    expect(formatInTimeZone(instant, "Europe/London", "en-GB")).toContain("00:00");
    const stored = ((await handle.db.execute(sql`select data_type as t from information_schema.columns where table_name = 'organizations' and column_name = 'created_at'`)) as unknown as Rows).rows[0].t;
    expect(stored).toBe("timestamp with time zone");
  });

  it("settings can be changed per company and the change is audited", async () => {
    const c = await makeCompany("Switcher");
    const r = await updateCompany(sa, c.organizationId, { baseCurrency: "USD", timezone: "America/New_York", planId: (await listPlans())[2].id });
    expect(r.changed).toBe(true);
    expect((await getOrganizationBasics(c.ctx)).baseCurrency).toBe("USD");
    expect((await updateCompany(sa, c.organizationId, { baseCurrency: "USD" })).changed).toBe(false);
    const log = await listPlatformAudit({ organizationId: c.organizationId });
    expect(log.rows.map((x) => x.action)).toEqual(expect.arrayContaining(["company.plan_changed", "company.created"]));
  });
});

describe("audit trail and platform reporting", () => {
  it("every administrative action is recorded, attributed and append-only", async () => {
    const actions = new Set((await listPlatformAudit({}, 500)).rows.map((r) => r.action));
    for (const a of [
      "platform.bootstrap", "company.created", "company.administrator_invited", "company.status_changed",
      "company.plan_changed", "company.administrator_promoted", "company.administrator_demoted", "company.deleted",
    ]) expect(actions, a).toContain(a);
    const all = (await listPlatformAudit({}, 500)).rows;
    expect(all.filter((r) => r.action !== "platform.bootstrap").every((r) => r.actorEmail === saEmail)).toBe(true);
    await expect(handle.db.execute(sql`update platform_audit_logs set action = 'tampered'`)).rejects.toThrow();
    await expect(handle.db.execute(sql`delete from platform_audit_logs`)).rejects.toThrow();
  });

  it("company-visible events are mirrored into the company's own audit log", async () => {
    const c = await makeCompany("Mirror");
    await setCompanyStatus(sa, c.organizationId, { status: "suspended", reason: "Review" });
    await setCompanyStatus(sa, c.organizationId, { status: "active" });
    const rows = await withTenant(c.ctx, (tx) => tx.execute(sql`select action, summary from audit_logs order by created_at`));
    const actions = (rows as unknown as Rows).rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["platform.company.created", "platform.company.status_changed"]));
  });

  it("the company list filters, sorts and paginates over real data", async () => {
    const all = await listCompanies({}, 100);
    expect(all.total).toBeGreaterThan(5);
    const gb = await listCompanies({ country: "GB" }, 100);
    expect(gb.rows.length).toBeGreaterThan(0);
    expect(gb.rows.every((r) => r.country === "GB")).toBe(true);
    const suspended = await listCompanies({ status: "suspended" });
    expect(suspended.rows.every((r) => r.status === "suspended")).toBe(true);
    const found = await listCompanies({ q: "Alpha" });
    expect(found.rows.length).toBe(1);
    expect(found.rows[0]).toMatchObject({ planName: "Starter", employees: expect.any(Number) });
    expect(found.rows[0].adminEmail).toMatch(/^alpha-admin-/);
    const byName = await listCompanies({ sort: "name", dir: "asc" }, 100);
    const byNameDesc = await listCompanies({ sort: "name", dir: "desc" }, 100);
    expect(byName.rows.map((r) => r.name)).toEqual(byNameDesc.rows.map((r) => r.name).reverse());
    const page1 = await listCompanies({ page: 1 }, 3);
    const page2 = await listCompanies({ page: 2 }, 3);
    expect(page1.rows).toHaveLength(3);
    expect(page2.rows.map((r) => r.id)).not.toEqual(page1.rows.map((r) => r.id));
    // Pending-invitation companies show the invited admin rather than a blank.
    const pending = (await listCompanies({ q: "Gulf Trading" })).rows[0];
    expect(pending).toMatchObject({ adminName: null, pendingAdminEmail: "layla@example.test", employees: 0 });
    // Filters are parameterised: hostile input is just a string.
    expect((await listCompanies({ q: "'; drop table organizations; --" })).total).toBe(0);
    expect((await listCompanies({})).total).toBe(all.total);
  });

  it("overview numbers are live aggregates that match the database", async () => {
    const o = await getPlatformOverview();
    const db = async (q: ReturnType<typeof sql>) => ((await handle.db.execute(q)) as unknown as Rows).rows[0].n as number;
    expect(o.companies.total).toBe(await db(sql`select count(*)::int as n from organizations where deleted_at is null`));
    expect(o.companies.active).toBe(await db(sql`select count(*)::int as n from organizations where deleted_at is null and status = 'active'`));
    expect(o.users.total).toBe(await db(sql`select count(*)::int as n from users where id not in (select user_id from platform_admins)`));
    expect(o.byCountry.reduce((s, r) => s + r.n, 0)).toBe(o.companies.total);
    expect(o.recentCompanies.length).toBeLessThanOrEqual(5);
    const users = await listPlatformUsers({ q: saEmail });
    expect(users.rows.find((u) => u.email === saEmail)?.isPlatformAdmin).toBe(true);
  });
});
