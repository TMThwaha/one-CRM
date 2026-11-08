import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { Empty, Pager, StatusBadge, Table, Td, countryName, qs, utc } from "@/components/platform/bits";
import { COMPANY_STATUSES, COUNTRIES } from "@/shared/countries";
import { companyListQuerySchema } from "@/shared/schemas/platform";
import { listCompanies, listIndustries, listPlans } from "@/server/modules/platform-admin/queries.service";

export const metadata = { title: "Companies" };

const field = "h-9 rounded-lg border border-border-strong bg-surface px-2.5 text-sm";

export default async function CompaniesPage({ searchParams }: PageProps<"/super-admin/companies">) {
  const raw = await searchParams;
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    const s = Array.isArray(v) ? v[0] : v;
    if (s) flat[k] = s; // blank form fields mean "no filter"
  }
  const parsed = companyListQuerySchema.safeParse(flat);
  const query = parsed.success ? parsed.data : companyListQuerySchema.parse({});
  const [result, plans, industries] = await Promise.all([listCompanies(query), listPlans(), listIndustries()]);

  const base = { q: query.q, country: query.country, industry: query.industry, status: query.status, plan: query.plan, from: query.from, to: query.to, sort: query.sort, dir: query.dir };
  const sortHref = (col: string) => `/super-admin/companies${qs(base, { sort: col, dir: query.sort === col && query.dir === "asc" ? "desc" : "asc", page: undefined })}`;
  const sortTh = (col: string, label: string) => (
    <Link key={col} href={sortHref(col)} className="inline-flex items-center gap-1 hover:text-fg">
      {label}
      {query.sort === col && <span aria-hidden>{query.dir === "asc" ? "▲" : "▼"}</span>}
    </Link>
  );
  const hasFilters = Boolean(query.q || query.country || query.industry || query.status || query.plan || query.from || query.to);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Companies"
        description={`${result.total} ${result.total === 1 ? "company" : "companies"}${hasFilters ? " match your filters" : " on the platform"}.`}
        actions={<Link href="/super-admin/companies/new" className="inline-flex h-9 items-center rounded-lg bg-accent px-3.5 text-sm font-medium text-accent-fg hover:bg-accent-hover">Create company</Link>}
      />

      <form method="get" className="grid gap-2 rounded-xl border border-border bg-surface p-3 sm:grid-cols-2 lg:grid-cols-4" role="search" aria-label="Filter companies">
        <input className={`${field} sm:col-span-2`} type="search" name="q" defaultValue={query.q} placeholder="Search name, legal name or ID" aria-label="Search" />
        <select className={field} name="country" defaultValue={query.country ?? ""} aria-label="Country">
          <option value="">All countries</option>
          {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
        <select className={field} name="industry" defaultValue={query.industry ?? ""} aria-label="Industry">
          <option value="">All industries</option>
          {industries.map((i) => <option key={i} value={i}>{i}</option>)}
        </select>
        <select className={field} name="status" defaultValue={query.status ?? ""} aria-label="Status">
          <option value="">All statuses</option>
          {COMPANY_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className={field} name="plan" defaultValue={query.plan ?? ""} aria-label="Subscription plan">
          <option value="">All plans</option>
          {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <label className="flex items-center gap-2 text-xs text-muted">Created from<input className={`${field} flex-1`} type="date" name="from" defaultValue={query.from} /></label>
        <label className="flex items-center gap-2 text-xs text-muted">to<input className={`${field} flex-1`} type="date" name="to" defaultValue={query.to} /></label>
        <div className="flex gap-2">
          <button className="h-9 rounded-lg bg-accent px-3.5 text-sm font-medium text-accent-fg hover:bg-accent-hover" type="submit">Apply</button>
          {hasFilters && <Link className="inline-flex h-9 items-center rounded-lg border border-border-strong px-3 text-sm hover:bg-hover" href="/super-admin/companies">Clear</Link>}
        </div>
      </form>

      <Table
        head={[sortTh("name", "Company"), "Company ID", sortTh("country", "Country"), "Industry", "Company Admin", "Admin email", sortTh("employees", "Employees"), "Plan", sortTh("createdAt", "Created"), sortTh("status", "Status"), "Actions"]}
        empty={result.rows.length === 0 ? <Empty title={hasFilters ? "No companies match these filters" : "No companies yet"} body={hasFilters ? "Try removing a filter." : "Create the first company and appoint its administrator."} /> : undefined}
      >
        {result.rows.map((c) => (
          <tr key={c.id}>
            <Td>
              <Link className="font-medium text-accent hover:underline" href={`/super-admin/companies/${c.id}`}>{c.name}</Link>
              {c.legalName && c.legalName !== c.name && <p className="text-xs text-muted">{c.legalName}</p>}
            </Td>
            <Td><code className="text-xs text-muted" title={c.id}>{c.id.slice(0, 8)}</code></Td>
            <Td>{countryName(c.country)}</Td>
            <Td className="capitalize">{c.industry}</Td>
            <Td>{c.adminName ?? <span className="text-muted">{c.pendingAdminEmail ? "Invitation pending" : "—"}</span>}</Td>
            <Td>{c.adminEmail ?? c.pendingAdminEmail ?? "—"}</Td>
            <Td className="tabular-nums">{c.employees}</Td>
            <Td>{c.planName ?? "—"}</Td>
            <Td className="whitespace-nowrap">{utc(c.createdAt)}</Td>
            <Td><StatusBadge status={c.status} /></Td>
            <Td><Link className="text-accent hover:underline" href={`/super-admin/companies/${c.id}`}>Manage</Link></Td>
          </tr>
        ))}
      </Table>
      <Pager page={result.page} pages={result.pages} total={result.total} pageSize={result.pageSize} href={(p) => `/super-admin/companies${qs(base, { page: p })}`} />
    </div>
  );
}
