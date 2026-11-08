"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Pick, Text, supported } from "@/components/platform/company-form";
import { Button, ErrorNote, PageHeader, Panel, useHydrated, useToast } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { DATE_FORMATS, LANGUAGES } from "@/shared/countries";
import { companySettingsSchema } from "@/shared/schemas/platform";

interface Fixed { legalName: string; country: string; registrationNumber: string | null; taxLabel: string }

export function CompanySettingsForm({ initial, fixed }: { initial: Record<string, string>; fixed: Fixed }) {
  const router = useRouter();
  const toast = useToast();
  const hydrated = useHydrated();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Record<string, string>, unknown, Record<string, unknown>>({
    resolver: zodResolver(companySettingsSchema) as never,
    defaultValues: initial,
  });
  // Option lists come from the runtime's Intl database; render them after hydration so markup matches.
  const zones = useMemo(() => (hydrated ? supported("timeZone") : []), [hydrated]);
  const currencies = useMemo(() => (hydrated ? supported("currency") : []), [hydrated]);
  const tz = useWatch({ control: form.control, name: "timezone" });
  const cur = useWatch({ control: form.control, name: "baseCurrency" });
  const withCurrent = (list: string[], v: string) => (v && !list.includes(v) ? [v, ...list] : list);

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await api<{ changed: boolean }>("/company", { method: "PATCH", body: values });
      toast(res.changed ? "Company settings saved" : "Nothing to change", "success");
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save settings");
    }
  });

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title="Company settings" description="Your company's profile and regional settings." />

      <Panel title="Set by the platform">
        <dl className="grid gap-x-6 p-4 text-sm sm:grid-cols-2">
          {([
            ["Legal name", fixed.legalName],
            ["Country", fixed.country],
            ["Registration number", fixed.registrationNumber ?? "—"],
          ] as const).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 border-b border-border py-2"><dt className="text-muted">{k}</dt><dd className="text-right font-medium">{v}</dd></div>
          ))}
        </dl>
        <p className="border-t border-border px-4 py-3 text-xs text-muted">These identify your company on the platform. To change them, contact your platform administrator.</p>
      </Panel>

      <form onSubmit={submit} noValidate className="space-y-5">
        <ErrorNote message={error} />
        <Panel title="Profile">
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <Text form={form} name="displayName" label="Display name *" hint="Shown to your team." />
            <Text form={form} name="industry" label="Industry" />
            <Text form={form} name="website" label="Website" type="url" placeholder="https://" />
            <Text form={form} name="businessEmail" label="Business email" type="email" />
            <Text form={form} name="businessPhone" label="Business phone" type="tel" />
            <Text form={form} name="taxId" label={fixed.taxLabel} hint="Stored as entered. OneCRM does not validate or file taxes." />
            <Text form={form} name="region" label="State or region" />
            <Text form={form} name="city" label="City" />
            <Text form={form} name="address" label="Business address" />
            <Text form={form} name="logoUrl" label="Logo URL" type="url" placeholder="https://" hint="An https:// image address, shown in the sidebar. File upload is not available yet." />
          </div>
        </Panel>
        <Panel title="Regional settings">
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <Pick form={form} name="baseCurrency" label="Default currency *" hint="Used for new records and dashboards. Existing deals keep their own currency.">
              {withCurrent(currencies, cur).map((c) => <option key={c} value={c}>{c}</option>)}
            </Pick>
            <Pick form={form} name="timezone" label="Time zone *" hint="Dates and times in the workspace are shown in this zone.">
              {withCurrent(zones, tz).map((z) => <option key={z} value={z}>{z}</option>)}
            </Pick>
            <Pick form={form} name="locale" label="Language and number format *">
              {LANGUAGES.map((l) => <option key={l.locale} value={l.locale}>{l.label}</option>)}
            </Pick>
            <Pick form={form} name="dateFormat" label="Date format *" hint="Stored for upcoming features; the workspace currently shows dates in your language's style.">
              {DATE_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
            </Pick>
            <Text form={form} name="phoneCountryCode" label="Phone country code *" placeholder="+91" />
          </div>
        </Panel>
        <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>Save changes</Button>
      </form>
    </div>
  );
}
