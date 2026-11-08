"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Copy } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { Button, ErrorNote, Field, Input, Select, useHydrated, useToast } from "@/components/ui";
import { ApiError, api, post } from "@/lib/api";
import { COUNTRIES, DATE_FORMATS, LANGUAGES, getCountry } from "@/shared/countries";
import { companyProfileSchema, createCompanySchema, type CreateCompanyData, type CreateCompanyInput } from "@/shared/schemas/platform";

export interface PlanOption { id: string; name: string }

// The form works on the schema's INPUT shape (strings from controls); the server re-validates.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyForm = UseFormReturn<any>;

const get = (obj: unknown, path: string): { message?: string } | undefined =>
  path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj) as { message?: string } | undefined;

export function Text({ form, name, label, hint, type = "text", autoComplete, autoFocus, placeholder }: {
  form: AnyForm; name: string; label: string; hint?: string; type?: string; autoComplete?: string; autoFocus?: boolean; placeholder?: string;
}) {
  const e = get(form.formState.errors, name)?.message;
  return (
    <Field label={label} error={e} hint={hint}>
      {(id, d) => <Input id={id} type={type} autoComplete={autoComplete ?? "off"} autoFocus={autoFocus} placeholder={placeholder} aria-describedby={d} aria-invalid={!!e} {...form.register(name)} />}
    </Field>
  );
}

export function Pick({ form, name, label, hint, children, onChange }: {
  form: AnyForm; name: string; label: string; hint?: string; children: React.ReactNode; onChange?: (v: string) => void;
}) {
  const e = get(form.formState.errors, name)?.message;
  const reg = form.register(name);
  return (
    <Field label={label} error={e} hint={hint}>
      {(id, d) => (
        <Select id={id} aria-describedby={d} aria-invalid={!!e} {...reg} onChange={(ev) => { void reg.onChange(ev); onChange?.(ev.target.value); }}>
          {children}
        </Select>
      )}
    </Field>
  );
}

export const supported = (kind: "timeZone" | "currency"): string[] => {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf(kind);
  } catch {
    return [];
  }
};

/** The company profile and regional fields, shared by the create wizard and the edit page. */
export function CompanyFields({ form, section, plans }: { form: AnyForm; section: "profile" | "region"; plans: PlanOption[] }) {
  const hydrated = useHydrated();
  // Option lists come from the runtime's Intl database, which can differ between server and browser:
  // render them only after hydration so the markup always matches.
  const zones = useMemo(() => (hydrated ? supported("timeZone") : []), [hydrated]);
  const currencies = useMemo(() => (hydrated ? supported("currency") : []), [hydrated]);
  const tz = form.watch("company.timezone") as string;
  const cur = form.watch("company.baseCurrency") as string;
  const country = form.watch("company.country") as string;
  const taxLabel = getCountry(country)?.taxLabel;
  const withCurrent = (list: string[], v: string) => (v && !list.includes(v) ? [v, ...list] : list);

  const onCountry = (code: string) => {
    const c = getCountry(code);
    if (!c) return;
    const opts = { shouldDirty: true, shouldValidate: true };
    form.setValue("company.baseCurrency", c.currency, opts);
    form.setValue("company.timezone", c.timeZone, opts);
    form.setValue("company.locale", c.locale, opts);
    form.setValue("company.dateFormat", c.dateFormat, opts);
    form.setValue("company.phoneCountryCode", c.phoneCode, opts);
  };

  if (section === "profile") {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <Text form={form} name="company.legalName" label="Legal company name *" autoFocus />
        <Text form={form} name="company.displayName" label="Display name *" hint="Shown to the company's team." />
        <Text form={form} name="company.industry" label="Industry" placeholder="e.g. software, retail" />
        <Text form={form} name="company.website" label="Website" type="url" placeholder="https://" />
        <Text form={form} name="company.businessEmail" label="Business email" type="email" />
        <Text form={form} name="company.businessPhone" label="Business phone" type="tel" />
        <Text form={form} name="company.registrationNumber" label="Registration number" hint="Optional. Must be unique within the country." />
        <Text form={form} name="company.taxId" label={taxLabel ? `Tax identifier (${taxLabel})` : "Tax identifier"} hint="Stored as entered. OneCRM does not validate or file taxes." />
        <Text form={form} name="company.logoUrl" label="Logo URL" type="url" placeholder="https://" hint="An https:// image address. File upload is not available yet." />
      </div>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Pick form={form} name="company.country" label="Country *" onChange={onCountry} hint="Pre-fills the regional settings below; you can change each.">
        <option value="">Select a country…</option>
        {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
      </Pick>
      <Text form={form} name="company.region" label="State or region" />
      <Text form={form} name="company.city" label="City" />
      <Text form={form} name="company.address" label="Business address" />
      <Pick form={form} name="company.baseCurrency" label="Default currency *">
        {withCurrent(currencies, cur).map((c) => <option key={c} value={c}>{c}</option>)}
        {!cur && <option value="">Select…</option>}
      </Pick>
      <Pick form={form} name="company.timezone" label="Time zone *" hint="Times are stored in UTC and shown in this zone.">
        {withCurrent(zones, tz).map((z) => <option key={z} value={z}>{z}</option>)}
        {!tz && <option value="">Select…</option>}
      </Pick>
      <Pick form={form} name="company.locale" label="Preferred language *">
        {LANGUAGES.map((l) => <option key={l.locale} value={l.locale}>{l.label}</option>)}
      </Pick>
      <Pick form={form} name="company.dateFormat" label="Date format *">
        {DATE_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
      </Pick>
      <Text form={form} name="company.phoneCountryCode" label="Phone country code *" placeholder="+91" />
      <Pick form={form} name="company.planId" label="Subscription plan *">
        <option value="">Select a plan…</option>
        {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </Pick>
    </div>
  );
}

const STEPS = ["Company", "Region and plan", "Administrator", "Review"] as const;
const STEP_FIELDS: string[][] = [
  ["company.legalName", "company.displayName", "company.industry", "company.website", "company.businessEmail", "company.businessPhone", "company.registrationNumber", "company.taxId", "company.logoUrl"],
  ["company.country", "company.region", "company.city", "company.address", "company.baseCurrency", "company.timezone", "company.locale", "company.dateFormat", "company.phoneCountryCode", "company.planId", "status"],
  ["administrator.name", "administrator.email", "administrator.phone", "administrator.jobTitle"],
];

interface Created {
  organizationId: string;
  companyName: string;
  administrator: { name: string; email: string };
  invitation: { url: string; emailed: boolean; expiresInDays: number };
}

export function CreateCompanyWizard({ plans }: { plans: PlanOption[] }) {
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Created | null>(null);
  const [busy, setBusy] = useState(false);
  const india = getCountry("IN")!;
  const form = useForm<CreateCompanyInput, unknown, CreateCompanyData>({
    resolver: zodResolver(createCompanySchema),
    defaultValues: {
      status: "active",
      company: {
        legalName: "", displayName: "", industry: "", website: "", businessEmail: "", businessPhone: "", logoUrl: "",
        country: "", region: "", city: "", address: "", registrationNumber: "", taxId: "",
        baseCurrency: india.currency, timezone: india.timeZone, locale: india.locale, dateFormat: india.dateFormat as "dd/MM/yyyy",
        phoneCountryCode: india.phoneCode, planId: "",
      },
      administrator: { name: "", email: "", phone: "", jobTitle: "" },
    },
  });

  const next = async () => {
    const ok = await form.trigger(STEP_FIELDS[step] as never[]);
    if (ok) setStep((s) => s + 1);
  };
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    setBusy(true);
    try {
      setDone(await post<Created>("/platform/companies", values));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Nothing was created; please try again.");
    } finally {
      setBusy(false);
    }
  });

  if (done) return <Success created={done} onAnother={() => { setDone(null); setStep(0); form.reset(); }} />;

  const v = form.getValues();
  const plan = plans.find((p) => p.id === v.company.planId)?.name ?? "—";
  const rows: [string, string][] = [
    ["Legal name", v.company.legalName], ["Display name", v.company.displayName], ["Industry", v.company.industry || "—"],
    ["Country", getCountry(v.company.country)?.name ?? "—"], ["Location", [v.company.city, v.company.region].filter(Boolean).join(", ") || "—"],
    ["Currency", v.company.baseCurrency], ["Time zone", v.company.timezone], ["Language", v.company.locale], ["Date format", v.company.dateFormat],
    ["Plan", plan], ["Account status", v.status === "suspended" ? "Suspended" : "Active"],
    ["Administrator", `${v.administrator.name} (${v.administrator.email})`], ["Job title", v.administrator.jobTitle || "—"],
  ];

  return (
    <div className="max-w-3xl space-y-5">
      <ol className="flex flex-wrap gap-2 text-sm" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? "step" : undefined} className={`flex items-center gap-2 rounded-full border px-3 py-1 ${i === step ? "border-accent bg-accent-soft text-accent" : i < step ? "border-border text-fg" : "border-border text-faint"}`}>
            {i < step ? <Check className="h-3.5 w-3.5" aria-hidden /> : <span className="tabular-nums">{i + 1}</span>}
            {s}
          </li>
        ))}
      </ol>

      <form onSubmit={(e) => { e.preventDefault(); if (step === 3) void submit(e); else void next(); }} className="space-y-5 rounded-xl border border-border bg-surface p-5" noValidate>
        <h2 className="text-base font-semibold">{STEPS[step]}</h2>
        {step === 0 && <CompanyFields form={form as AnyForm} section="profile" plans={plans} />}
        {step === 1 && (
          <>
            <CompanyFields form={form as AnyForm} section="region" plans={plans} />
            <Pick form={form as AnyForm} name="status" label="Account status">
              <option value="active">Active</option>
              <option value="suspended">Suspended (create now, enable later)</option>
            </Pick>
          </>
        )}
        {step === 2 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <p className="text-sm text-muted sm:col-span-2">
              The administrator receives a secure, single-use invitation to set their own password. No password is ever created or shown.
            </p>
            <Text form={form as AnyForm} name="administrator.name" label="Administrator full name *" autoFocus />
            <Text form={form as AnyForm} name="administrator.email" label="Administrator email *" type="email" />
            <Text form={form as AnyForm} name="administrator.phone" label="Administrator phone" type="tel" />
            <Text form={form as AnyForm} name="administrator.jobTitle" label="Job title" />
          </div>
        )}
        {step === 3 && (
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {rows.map(([k, val]) => (
              <div key={k} className="flex justify-between gap-3 border-b border-border py-1.5"><dt className="text-muted">{k}</dt><dd className="text-right font-medium break-words">{val}</dd></div>
            ))}
          </dl>
        )}
        <ErrorNote message={error} />
        <div className="flex justify-between gap-2">
          <Button type="button" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || busy}>Back</Button>
          {step < 3 ? (
            <Button type="submit" variant="primary">Continue</Button>
          ) : (
            <Button type="submit" variant="primary" loading={busy}>Confirm and create company</Button>
          )}
        </div>
      </form>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const toast = useToast();
  return (
    <Button type="button" size="sm" onClick={async () => {
      try { await navigator.clipboard.writeText(text); toast("Link copied", "success"); } catch { toast("Copy failed. Select the link and copy it manually.", "danger"); }
    }}>
      <Copy className="h-3.5 w-3.5" aria-hidden /> Copy link
    </Button>
  );
}

function Success({ created, onAnother }: { created: Created; onAnother: () => void }) {
  const { invitation: inv } = created;
  return (
    <div className="max-w-2xl space-y-4 rounded-xl border border-border bg-surface p-6">
      <div className="flex items-center gap-2 text-success"><Check className="h-5 w-5" aria-hidden /><h2 className="text-lg font-semibold text-fg">{created.companyName} was created</h2></div>
      <p className="text-sm text-muted">
        The workspace, default roles and sales pipeline are ready. {created.administrator.name} ({created.administrator.email}) is appointed as Company Admin once they accept the invitation.
      </p>
      {inv.emailed ? (
        <p className="rounded-lg border border-success/30 bg-success-soft px-3 py-2 text-sm text-success">An invitation email was sent to {created.administrator.email}. It is valid for {inv.expiresInDays} days and works once.</p>
      ) : (
        <div className="space-y-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-3 text-sm">
          <p className="font-semibold text-fg">The invitation email was not delivered.</p>
          <p className="text-muted">Email delivery is not configured (or failed). Send this link to the administrator yourself. It is shown only now, is valid for {inv.expiresInDays} days and works once.</p>
          <div className="flex items-center gap-2"><code className="min-w-0 flex-1 truncate rounded bg-surface px-2 py-1.5 text-xs">{inv.url}</code><CopyButton text={inv.url} /></div>
        </div>
      )}
      <div className="flex gap-2">
        <Link href={`/super-admin/companies/${created.organizationId}`} className="inline-flex h-9 items-center rounded-lg bg-accent px-3.5 text-sm font-medium text-accent-fg hover:bg-accent-hover">View company</Link>
        <Button onClick={onAnother}>Create another</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------------------

const editSchema = z.object({ company: companyProfileSchema });

export function EditCompanyForm({ id, initial, plans }: { id: string; initial: Record<string, string>; plans: PlanOption[] }) {
  const router = useRouter();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<{ company: Record<string, string> }, unknown, z.output<typeof editSchema>>({
    resolver: zodResolver(editSchema) as never,
    defaultValues: { company: initial },
  });
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await api(`/platform/companies/${id}`, { method: "PATCH", body: v.company });
      toast("Company updated", "success");
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save changes");
    }
  });
  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      <ErrorNote message={error} />
      <CompanyFields form={form as AnyForm} section="profile" plans={plans} />
      <CompanyFields form={form as AnyForm} section="region" plans={plans} />
      <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>Save changes</Button>
    </form>
  );
}
