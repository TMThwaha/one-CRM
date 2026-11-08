import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { BarList, Empty, Section, Stat, StatusBadge, Table, Td, countryName, utc } from "@/components/platform/bits";
import { getPlatformOverview } from "@/server/modules/platform-admin/queries.service";

export const metadata = { title: "Overview" };

export default async function OverviewPage() {
  const o = await getPlatformOverview();
  return (
    <div className="space-y-5">
      <PageHeader
        title="Platform overview"
        description="Live figures from the platform database."
        actions={<Link href="/super-admin/companies/new" className="inline-flex h-9 items-center rounded-lg bg-accent px-3.5 text-sm font-medium text-accent-fg hover:bg-accent-hover">Create company</Link>}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Registered companies" value={o.companies.total} />
        <Stat label="Active companies" value={o.companies.active} />
        <Stat label="Suspended companies" value={o.companies.suspended} tone={o.companies.suspended ? "warning" : undefined} />
        <Stat label="New this month (UTC)" value={o.companies.newThisMonth} />
        <Stat label="Users across companies" value={o.users.total} hint="Excludes platform administrators" />
        <Stat label="Company administrators" value={o.users.companyAdmins} />
        <Stat label="Active seats" value={o.users.activeSeats} hint="Memberships in non-deleted companies" />
        <Stat label="Companies with a plan" value={o.companies.withPlan} hint="Billing is not integrated; no revenue shown" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Companies by country">
          <BarList rows={o.byCountry.map((r) => ({ label: countryName(r.country), value: r.n }))} empty="No companies yet." />
        </Section>
        <Section title="Companies by plan">
          <BarList rows={o.byPlan.map((r) => ({ label: r.plan, value: r.n }))} empty="No plans." />
        </Section>
      </div>

      <Section title="Security signals, last 7 days" action={<Link href="/super-admin/audit" className="text-sm text-accent hover:underline">Audit log</Link>}>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Failed sign-ins" value={o.security.failedSignIns} />
          <Stat label="Account lockouts" value={o.security.lockouts} tone={o.security.lockouts ? "warning" : undefined} />
          <Stat label="Failed 2FA codes" value={o.security.failedSecondFactor} tone={o.security.failedSecondFactor ? "warning" : undefined} />
        </div>
      </Section>

      <Section title="Recent company registrations" action={<Link href="/super-admin/companies" className="text-sm text-accent hover:underline">All companies</Link>}>
        {o.recentCompanies.length === 0 ? (
          <Empty title="No companies yet" body="Create the first company and appoint its administrator." />
        ) : (
          <Table head={["Company", "Country", "Administrator", "Status", "Created"]}>
            {o.recentCompanies.map((c) => (
              <tr key={c.id}>
                <Td><Link className="font-medium text-accent hover:underline" href={`/super-admin/companies/${c.id}`}>{c.name}</Link></Td>
                <Td>{countryName(c.country)}</Td>
                <Td>{c.adminName ?? (c.pendingAdminEmail ? `${c.pendingAdminEmail} (invited)` : "—")}</Td>
                <Td><StatusBadge status={c.status} /></Td>
                <Td>{utc(c.createdAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title="Recent administrative actions">
        {o.recentAudit.length === 0 ? (
          <Empty title="Nothing recorded yet" />
        ) : (
          <ul className="divide-y divide-border text-sm">
            {o.recentAudit.map((a) => (
              <li key={a.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>{a.summary ?? a.action}</span>
                <span className="text-xs text-muted">{a.actorEmail} · {utc(a.createdAt, true)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
