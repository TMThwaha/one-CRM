import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { DatabaseHandle } from "@/server/db/client";
import { withTenant } from "@/server/db/tenant";
import { resolveAuthContext } from "@/server/modules/identity/auth.service";
import { getCompanyProfile, getOrganizationBasics, updateCompanyProfile } from "@/server/modules/identity/org.service";
import { formatCompactMoney, formatDate, formatDateTime, formatMoney, hourIn } from "@/lib/format";
import { addMember, signUpOrg, startTestDatabase, type Rows } from "./support/harness";

let handle: DatabaseHandle;
beforeAll(async () => {
  handle = await startTestDatabase();
});
afterAll(async () => {
  await handle.close();
});

const settings = (over: Record<string, unknown> = {}) => ({
  displayName: "Renamed Co", industry: "retail", baseCurrency: "GBP", timezone: "Europe/London", locale: "en-GB",
  dateFormat: "dd/MM/yyyy", phoneCountryCode: "+44", ...over,
});

describe("company settings (Company Admin)", () => {
  it("a Company Admin edits their own profile; the change is audited and takes effect on the next request", async () => {
    const a = await signUpOrg("Settings");
    expect(a.ctx.regional).toMatchObject({ timeZone: "Asia/Kolkata", locale: "en-IN", currency: "INR" }); // defaults
    const r = await updateCompanyProfile(a.ctx, settings({ website: "https://example.test", city: "London", logoUrl: "https://example.test/logo.png" }));
    expect(r.changed).toBe(true);

    const fresh = (await resolveAuthContext(a.token))!;
    expect(fresh.regional).toMatchObject({ timeZone: "Europe/London", locale: "en-GB", currency: "GBP", dateFormat: "dd/MM/yyyy" });
    const p = await getCompanyProfile(fresh);
    expect(p).toMatchObject({ displayName: "Renamed Co", city: "London", website: "https://example.test", logoUrl: "https://example.test/logo.png", baseCurrency: "GBP" });
    expect((await getOrganizationBasics(fresh)).logoUrl).toBe("https://example.test/logo.png");

    const log = await withTenant(fresh, (tx) => tx.execute(sql`select action, changes from audit_logs where action = 'company.profile_updated'`));
    const rows = (log as unknown as Rows).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].changes.timezone).toEqual({ from: "Asia/Kolkata", to: "Europe/London" });

    expect((await updateCompanyProfile(fresh, settings({ website: "https://example.test", city: "London", logoUrl: "https://example.test/logo.png" }))).changed).toBe(false); // no-op is not audited
  });

  it("only changes the caller's own company", async () => {
    const a = await signUpOrg("Alpha Settings");
    const b = await signUpOrg("Bravo Settings");
    await updateCompanyProfile(a.ctx, settings({ displayName: "Alpha Changed" }));
    expect((await getCompanyProfile(b.ctx)).displayName).toBe("Bravo Settings Inc");
    expect((await getCompanyProfile(b.ctx)).timezone).toBe("Asia/Kolkata");
  });

  it("requires org.manage: employees and even a delegated Admin are refused", async () => {
    const a = await signUpOrg("Perms");
    for (const role of ["admin", "manager", "sales", "viewer"]) {
      const m = await addMember(a.ctx, `Emp ${role}`, role);
      await expect(getCompanyProfile(m.ctx), role).rejects.toMatchObject({ code: "forbidden" });
      await expect(updateCompanyProfile(m.ctx, settings()), role).rejects.toMatchObject({ code: "forbidden" });
    }
  });

  it("rejects invalid regional data and cannot be used to change status, plan, country or legal name", async () => {
    const a = await signUpOrg("Guarded");
    await expect(updateCompanyProfile(a.ctx, settings({ timezone: "Mars/Olympus" }))).rejects.toThrow();
    await expect(updateCompanyProfile(a.ctx, settings({ baseCurrency: "XXQ" }))).rejects.toThrow();
    await expect(updateCompanyProfile(a.ctx, settings({ logoUrl: "javascript:alert(1)" }))).rejects.toThrow();
    await expect(updateCompanyProfile(a.ctx, settings({ logoUrl: "http://insecure.test/logo.png" }))).rejects.toThrow(); // https only

    // Smuggled platform-controlled fields are dropped by the schema...
    await updateCompanyProfile(a.ctx, settings({ status: "archived", planId: "11111111-1111-4111-8111-111111111111", country: "AE", legalName: "Hijacked Ltd", registrationNumber: "X1" }));
    const row = ((await handle.db.execute(sql`select status, plan_id, country, legal_name, registration_number from organizations where id = ${a.ctx.organizationId}`)) as unknown as Rows).rows[0];
    expect(row).toEqual({ status: "active", plan_id: null, country: null, legal_name: null, registration_number: null });
    // ...and the database refuses them too, even if application code were wrong.
    await expect(withTenant(a.ctx, (tx) => tx.execute(sql`update organizations set status = 'archived'`))).rejects.toThrow();
    await expect(withTenant(a.ctx, (tx) => tx.execute(sql`update organizations set plan_id = null`))).rejects.toThrow();
  });
});

describe("regional formatting", () => {
  it("shows an instant in the company's time zone", () => {
    const instant = "2026-01-15T23:30:00.000Z";
    expect(formatDate(instant, { day: "numeric", month: "short", year: "numeric" }, { timeZone: "Asia/Kolkata", locale: "en-GB" })).toBe("16 Jan 2026");
    expect(formatDate(instant, { day: "numeric", month: "short", year: "numeric" }, { timeZone: "America/Los_Angeles", locale: "en-GB" })).toBe("15 Jan 2026");
    expect(formatDateTime(instant, { timeZone: "Asia/Dubai", locale: "en-GB" })).toMatch(/^16 Jan, 0?3:30/);
    expect(formatDateTime(instant, { timeZone: "Europe/London", locale: "en-GB" })).toMatch(/^15 Jan, 23:30/);
  });

  it("never shifts a bare calendar date, whatever the company's zone", () => {
    for (const timeZone of ["Pacific/Auckland", "America/Los_Angeles", "Asia/Kolkata"]) {
      expect(formatDate("2026-03-10", { day: "numeric", month: "short", year: "numeric" }, { timeZone, locale: "en-GB" }), timeZone).toBe("10 Mar 2026");
    }
  });

  it("follows the company's clock for the time of day", () => {
    const now = new Date("2026-01-15T23:30:00.000Z");
    expect(hourIn("Asia/Kolkata", now)).toBe(5); // 05:00 next day in India
    expect(hourIn("Europe/London", now)).toBe(23);
    expect(hourIn("America/Los_Angeles", now)).toBe(15);
  });

  it("formats money in the company's locale, not a hard-coded one", () => {
    const amount = "1234567.5";
    const india = formatMoney(amount, "INR", "en-IN");
    const uk = formatMoney(amount, "INR", "en-GB");
    expect(india).toContain("12,34,567"); // lakh grouping
    expect(uk).toContain("1,234,567"); // western grouping
    expect(india).not.toBe(uk);
    expect(formatCompactMoney(1_500_000, "GBP", "en-GB")).toMatch(/1.5m/i);
    expect(formatMoney("1", "NOT_A_CURRENCY")).toBe("NOT_A_CURRENCY 1"); // falls back, never throws
  });
});
