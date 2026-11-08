import "server-only";
import { eq } from "drizzle-orm";
import { organizations } from "@/server/db/schema";
import { withTenant } from "@/server/db/tenant";
import { audit } from "@/server/platform/audit";
import { companySettingsSchema } from "@/shared/schemas/platform";
import { require as requirePerm, type AuthContext } from "./context";

export async function getOrganizationBasics(ctx: AuthContext) {
  return withTenant(ctx, async (tx) => {
    const [org] = await tx
      .select({ id: organizations.id, name: organizations.name, baseCurrency: organizations.baseCurrency, logoUrl: organizations.logoUrl })
      .from(organizations);
    return org;
  });
}

/** The company's own profile. Only the Company Admin (`org.manage`) can see or change it. */
export async function getCompanyProfile(ctx: AuthContext) {
  requirePerm(ctx, "org.manage");
  return withTenant(ctx, async (tx) => {
    const [o] = await tx
      .select({
        legalName: organizations.legalName,
        country: organizations.country,
        registrationNumber: organizations.registrationNumber,
        displayName: organizations.name,
        industry: organizations.industry,
        website: organizations.website,
        businessEmail: organizations.businessEmail,
        businessPhone: organizations.businessPhone,
        logoUrl: organizations.logoUrl,
        region: organizations.region,
        city: organizations.city,
        address: organizations.address,
        taxId: organizations.taxId,
        baseCurrency: organizations.baseCurrency,
        timezone: organizations.timezone,
        locale: organizations.locale,
        dateFormat: organizations.dateFormat,
        phoneCountryCode: organizations.phoneCountryCode,
      })
      .from(organizations);
    return { ...o, baseCurrency: o.baseCurrency.trim() };
  });
}

/**
 * Edits the company profile and regional settings. Deliberately NOT editable here: legal name,
 * country, registration number, plan and status. Those are platform-controlled (they drive duplicate
 * prevention and billing), the input schema drops them, and the database role has no column grant
 * for status or plan either.
 */
export async function updateCompanyProfile(ctx: AuthContext, input: unknown) {
  requirePerm(ctx, "org.manage");
  const data = companySettingsSchema.parse(input);
  return withTenant(ctx, async (tx) => {
    const [before] = await tx.select().from(organizations);
    const next = {
      name: data.displayName,
      industry: data.industry ?? "general",
      website: data.website,
      businessEmail: data.businessEmail,
      businessPhone: data.businessPhone,
      logoUrl: data.logoUrl,
      region: data.region,
      city: data.city,
      address: data.address,
      taxId: data.taxId,
      baseCurrency: data.baseCurrency,
      timezone: data.timezone,
      locale: data.locale,
      dateFormat: data.dateFormat,
      phoneCountryCode: data.phoneCountryCode,
    };
    const patch: Record<string, unknown> = {};
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const [k, v] of Object.entries(next)) {
      const cur = (before as Record<string, unknown>)[k];
      const same = typeof cur === "string" && typeof v === "string" ? cur.trim() === v.trim() : (cur ?? null) === (v ?? null);
      if (!same) {
        patch[k] = v;
        changes[k] = { from: cur ?? null, to: v ?? null };
      }
    }
    if (Object.keys(patch).length === 0) return { changed: false };
    await tx.update(organizations).set({ ...patch, updatedAt: new Date() }).where(eq(organizations.id, ctx.organizationId));
    await audit(tx, ctx, {
      action: "company.profile_updated",
      entityType: "company",
      entityId: ctx.organizationId,
      summary: `Updated company settings: ${Object.keys(changes).join(", ")}`,
      changes,
    });
    return { changed: true };
  });
}
