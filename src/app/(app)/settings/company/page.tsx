import type { Metadata } from "next";
import { CompanySettingsForm } from "@/components/views/company-settings";
import { orNotFound } from "@/server/http/page";
import { requireAuth } from "@/server/http/session";
import { getCompanyProfile } from "@/server/modules/identity/org.service";
import { getCountry } from "@/shared/countries";

export const metadata: Metadata = { title: "Company settings" };

export default async function CompanySettingsPage() {
  const ctx = await requireAuth();
  const p = await orNotFound(() => getCompanyProfile(ctx));
  const initial: Record<string, string> = {
    displayName: p.displayName, industry: p.industry, website: p.website ?? "", businessEmail: p.businessEmail ?? "",
    businessPhone: p.businessPhone ?? "", logoUrl: p.logoUrl ?? "", region: p.region ?? "", city: p.city ?? "",
    address: p.address ?? "", taxId: p.taxId ?? "", baseCurrency: p.baseCurrency, timezone: p.timezone, locale: p.locale,
    dateFormat: p.dateFormat, phoneCountryCode: p.phoneCountryCode ?? getCountry(p.country)?.phoneCode ?? "",
  };
  return (
    <CompanySettingsForm
      initial={initial}
      fixed={{ legalName: p.legalName ?? p.displayName, country: getCountry(p.country)?.name ?? "Not set", registrationNumber: p.registrationNumber, taxLabel: getCountry(p.country)?.taxLabel ?? "Tax identifier" }}
    />
  );
}
