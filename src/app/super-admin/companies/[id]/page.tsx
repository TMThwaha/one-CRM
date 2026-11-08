import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/ui";
import { AppointAdministrator, DeleteCompany, DemoteButton, StatusControls } from "@/components/platform/company-actions";
import { EditCompanyForm } from "@/components/platform/company-form";
import { Empty, Section, StatusBadge, Table, Td, countryName, utc } from "@/components/platform/bits";
import { getCountry, type CompanyStatus } from "@/shared/countries";
import { getCompanyDetail, listPlans } from "@/server/modules/platform-admin/queries.service";
import { orNotFound } from "@/server/http/page";

export const metadata = { title: "Company" };

export default async function CompanyPage({ params }: PageProps<"/super-admin/companies/[id]">) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const [d, plans] = await Promise.all([orNotFound(() => getCompanyDetail(id)), listPlans()]);
  const { org } = d;
  const status = org.status as CompanyStatus;
  const country = getCountry(org.country);
  const activeAdmins = d.admins.filter((a) => a.status === "active").length;

  const initial: Record<string, string> = {
    legalName: org.legalName ?? org.name, displayName: org.name, industry: org.industry, website: org.website ?? "",
    businessEmail: org.businessEmail ?? "", businessPhone: org.businessPhone ?? "", logoUrl: org.logoUrl ?? "",
    country: org.country ?? "", region: org.region ?? "", city: org.city ?? "", address: org.address ?? "",
    registrationNumber: org.registrationNumber ?? "", taxId: org.taxId ?? "", baseCurrency: org.baseCurrency, timezone: org.timezone,
    locale: org.locale, dateFormat: org.dateFormat, phoneCountryCode: org.phoneCountryCode ?? country?.phoneCode ?? "", planId: org.planId ?? "",
  };

  const facts: [string, string][] = [
    ["Company ID", org.id],
    ["Legal name", org.legalName ?? "—"],
    ["Country", countryName(org.country)],
    ["Location", [org.city, org.region].filter(Boolean).join(", ") || "—"],
    ["Industry", org.industry],
    ["Currency", org.baseCurrency],
    ["Time zone", org.timezone],
    ["Language", org.locale],
    ["Plan", d.planName ?? "—"],
    [country?.taxLabel ?? "Tax identifier", org.taxId ?? "—"],
    ["Registration number", org.registrationNumber ?? "—"],
    ["Created", utc(org.createdAt, true)],
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={org.name}
        description={org.legalName && org.legalName !== org.name ? org.legalName : undefined}
        actions={<><StatusBadge status={status} /><StatusControls id={org.id} status={status} /></>}
      />
      {status !== "active" && org.statusReason && (
        <p className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-fg">
          {status === "suspended" ? "Suspended" : status === "deactivated" ? "Deactivated" : "Archived"} on {utc(org.statusChangedAt, true)}: {org.statusReason}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Section title="Company details">
            <dl className="grid gap-x-6 sm:grid-cols-2">
              {facts.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b border-border py-2 text-sm"><dt className="text-muted">{k}</dt><dd className="text-right font-medium break-all">{v}</dd></div>
              ))}
            </dl>
          </Section>
        </div>
        <Section title="Team">
          {d.roleCounts.length === 0 ? <p className="text-sm text-muted">No active members yet.</p> : (
            <ul className="space-y-1.5 text-sm">{d.roleCounts.map((r) => <li key={r.role} className="flex justify-between"><span>{r.role}</span><span className="tabular-nums text-muted">{r.n}</span></li>)}</ul>
          )}
        </Section>
      </div>

      <Section title="Company administrators" action={<AppointAdministrator id={org.id} companyName={org.name} disabled={status === "archived"} />}>
        {d.admins.length === 0 && d.pendingInvites.length === 0 ? (
          <Empty title="No administrator yet" body="Appoint one so this company can start using its workspace." />
        ) : (
          <Table head={["Name", "Email", "Status", "2FA", "Since", ""]}>
            {d.admins.map((a) => (
              <tr key={a.membershipId}>
                <Td>{a.name}{a.jobTitle && <p className="text-xs text-muted">{a.jobTitle}</p>}</Td>
                <Td>{a.email}</Td>
                <Td>{a.status === "active" ? "Active" : "Suspended"}</Td>
                <Td>{a.mfaEnabled ? "On" : "Off"}</Td>
                <Td>{utc(a.since)}</Td>
                <Td>{a.status === "active" && activeAdmins > 1 && <DemoteButton companyId={org.id} membershipId={a.membershipId} email={a.email} />}</Td>
              </tr>
            ))}
            {d.pendingInvites.map((p) => (
              <tr key={p.id}>
                <Td>{p.invitedName ?? "—"}</Td>
                <Td>{p.email}</Td>
                <Td>Invitation pending</Td>
                <Td>—</Td>
                <Td>expires {utc(p.expiresAt)}</Td>
                <Td />
              </tr>
            ))}
          </Table>
        )}
      </Section>

      {status !== "archived" && (
        <Section title="Edit company">
          <EditCompanyForm id={org.id} initial={initial} plans={plans.filter((p) => p.isActive || p.id === org.planId).map((p) => ({ id: p.id, name: p.name }))} />
        </Section>
      )}

      <Section title="Audit history" action={<Link href={`/super-admin/audit?company=${org.id}`} className="text-sm text-accent hover:underline">Open in audit log</Link>}>
        {d.audit.length === 0 ? <Empty title="No recorded actions" /> : (
          <ul className="divide-y divide-border text-sm">
            {d.audit.map((a) => (
              <li key={a.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>{a.summary ?? a.action}</span>
                <span className="text-xs text-muted">{a.actorEmail} · {utc(a.createdAt, true)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {status === "archived" && (
        <Section title="Delete company">
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="max-w-xl text-muted">Deleting needs the legal name typed back and your password. The company is removed from the platform; its data is retained.</p>
            <DeleteCompany id={org.id} legalName={org.legalName ?? org.name} />
          </div>
        </Section>
      )}
    </div>
  );
}
