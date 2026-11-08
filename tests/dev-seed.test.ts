import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { DatabaseHandle } from "@/server/db/client";
import { NEXORA, seedDevCompany } from "@/server/dev/seed-dev-company";
import { isPlatformAdmin, login, resolveAuthContext } from "@/server/modules/identity/auth.service";
import { resolvePlatformContext } from "@/server/modules/platform-admin/context";
import { signUpOrg, startTestDatabase, type Rows } from "./support/harness";

const PW = "a-throwaway-test-password";
let handle: DatabaseHandle;
const count = async (q: string) => ((await handle.db.execute(sql.raw(q))) as unknown as Rows).rows[0].n as number;

beforeAll(async () => {
  handle = await startTestDatabase();
});
afterAll(async () => {
  await handle.close();
});

describe("development seed: Nexora Technologies", () => {
  it("creates the company and a Company Admin that can really sign in", async () => {
    const r = await seedDevCompany({ company: NEXORA, password: PW });
    expect(r.company).toMatchObject({
      name: "Nexora Technologies Pvt Ltd", code: "NEX001", slug: "nex001", email: "admin@nexoratech.test",
      status: "active", country: "IN", planName: "Starter", created: true,
    });
    expect(r.admin).toMatchObject({ email: "admin@nexoratech.test", roleKey: "owner", roleName: "Company Admin", membershipStatus: "active", userCreated: true, membershipCreated: true });
    expect(r.admin.permissions).toBeGreaterThan(20); // the full Company Admin permission set

    const org = ((await handle.db.execute(sql`select * from organizations where id = ${r.company.id}`)) as unknown as Rows).rows[0];
    expect(org).toMatchObject({
      legal_name: "Nexora Technologies Pvt Ltd", city: "Thiruvananthapuram", region: "Kerala", country: "IN",
      website: "https://nexoratech.test", business_phone: "+91 9876543210", phone_country_code: "+91",
      base_currency: "INR", timezone: "Asia/Kolkata", status: "active",
    });
    expect(org.address).toContain("695581");

    // Real authentication: by email, with the supplied password; the stored value is a hash.
    const s = await login({ email: "ADMIN@nexoratech.test", password: PW }, { ip: "5.5.5.5" });
    const ctx = (await resolveAuthContext(s.token))!;
    expect(ctx).toMatchObject({ organizationId: r.company.id, roleKey: "owner", userEmail: "admin@nexoratech.test" });
    expect(ctx.permissions["org.manage"]).toBe("all");
    const stored = ((await handle.db.execute(sql`select password_hash from users where email = 'admin@nexoratech.test'`)) as unknown as Rows).rows[0].password_hash as string;
    expect(stored).not.toContain(PW);
    expect(stored.length).toBeGreaterThan(40);
    await expect(login({ email: "admin@nexoratech.test", password: "wrong-wrong-wrong" }, { ip: "5.5.5.6" })).rejects.toMatchObject({ code: "unauthenticated" });

    // It is a company account, deliberately NOT a platform Super Admin.
    expect(await isPlatformAdmin(ctx.userId)).toBe(false);
    expect(await resolvePlatformContext(s.token)).toBeNull();
  });

  it("is idempotent: a second run creates nothing and leaves the password alone", async () => {
    const before = {
      orgs: await count("select count(*)::int as n from organizations"),
      users: await count("select count(*)::int as n from users"),
      members: await count("select count(*)::int as n from organization_members"),
      roles: await count("select count(*)::int as n from roles"),
      audit: await count("select count(*)::int as n from platform_audit_logs"),
    };
    const again = await seedDevCompany({ company: NEXORA, password: "a-different-password-entirely" });
    expect(again.company.created).toBe(false);
    expect(again.admin).toMatchObject({ userCreated: false, membershipCreated: false });
    expect({
      orgs: await count("select count(*)::int as n from organizations"),
      users: await count("select count(*)::int as n from users"),
      members: await count("select count(*)::int as n from organization_members"),
      roles: await count("select count(*)::int as n from roles"),
      audit: await count("select count(*)::int as n from platform_audit_logs"),
    }).toEqual(before);
    // The original password still works; the new one was not applied.
    await login({ email: "admin@nexoratech.test", password: PW }, { ip: "5.5.5.7" });
    await expect(login({ email: "admin@nexoratech.test", password: "a-different-password-entirely" }, { ip: "5.5.5.8" })).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("leaves other companies and users untouched", async () => {
    const other = await signUpOrg("Bystander");
    const orgsBefore = await count("select count(*)::int as n from organizations");
    await seedDevCompany({ company: NEXORA, password: PW });
    expect(await count("select count(*)::int as n from organizations")).toBe(orgsBefore);
    expect((await resolveAuthContext(other.token))!.userId).toBe(other.ctx.userId);
  });

  it("repairs a missing membership without changing an existing account's password", async () => {
    await handle.db.execute(sql`delete from organization_members where user_id = (select id from users where email = 'admin@nexoratech.test')`);
    const r = await seedDevCompany({ company: NEXORA, password: "irrelevant-new-password" });
    expect(r.admin).toMatchObject({ userCreated: false, membershipCreated: true, roleKey: "owner" });
    await login({ email: "admin@nexoratech.test", password: PW }, { ip: "5.5.5.9" });
  });
});

describe("development seed: safety", () => {
  it("refuses to run in production", async () => {
    await expect(seedDevCompany({ company: NEXORA, password: PW }, "production")).rejects.toThrow(/production/);
  });

  it("rejects a weak password before touching the database", async () => {
    const before = await count("select count(*)::int as n from users");
    await expect(seedDevCompany({ company: NEXORA, password: "short" })).rejects.toThrow(/password/i);
    expect(await count("select count(*)::int as n from users")).toBe(before);
  });
});
