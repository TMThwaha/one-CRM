import type { Metadata } from "next";
import Link from "next/link";
import { CompanyActions, LogActivity } from "@/components/detail/actions";
import { Timeline } from "@/components/timeline";
import { Badge, Panel } from "@/components/ui";
import { formatMoney, fullName } from "@/lib/format";
import { orNotFound } from "@/server/http/page";
import { requireAuth } from "@/server/http/session";
import { getCompany } from "@/server/modules/crm/companies.service";

export async function generateMetadata({ params }: PageProps<"/companies/[id]">): Promise<Metadata> {
  const { id } = await params;
  const ctx = await requireAuth();
  const c = await getCompany(ctx, id).catch(() => null);
  return { title: c?.name ?? "Company" };
}

export default async function CompanyPage({ params }: PageProps<"/companies/[id]">) {
  const { id } = await params;
  const ctx = await requireAuth();
  const c = await orNotFound(() => getCompany(ctx, id));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[13px] text-muted"><Link href="/companies" className="hover:underline">Companies</Link></p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{c.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted">
            {c.domain && <span>{c.domain}</span>}
            {c.industry && <Badge>{c.industry}</Badge>}
            {c.size && <Badge>{c.size} people</Badge>}
            {[c.city, c.country].filter(Boolean).length > 0 && <span>{[c.city, c.country].filter(Boolean).join(", ")}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2"><CompanyActions company={{ ...c }} /></div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-4">
          <LogActivity links={{ companyId: c.id }} />
          <Panel title="Timeline"><div className="p-5"><Timeline kind="company" id={c.id} /></div></Panel>
        </div>
        <div className="space-y-6">
          <Panel title={`People (${c.contacts.length})`}>
            {c.contacts.length === 0 ? <p className="p-4 text-sm text-muted">No contacts at this company yet.</p> : (
              <ul className="divide-y divide-border">
                {c.contacts.map((p) => (
                  <li key={p.id} className="px-4 py-2.5">
                    <Link href={`/contacts/${p.id}`} className="font-medium hover:underline">{fullName(p.firstName, p.lastName)}</Link>
                    <p className="text-xs text-muted">{p.jobTitle ?? p.email}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title={`Deals (${c.deals.length})`}>
            {c.deals.length === 0 ? <p className="p-4 text-sm text-muted">No deals yet.</p> : (
              <ul className="divide-y divide-border">
                {c.deals.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0"><Link href={`/deals/${d.id}`} className="block truncate font-medium hover:underline">{d.title}</Link><p className="text-xs text-muted">{d.stageName}</p></div>
                    <span className="text-sm tabular">{formatMoney(d.amount, d.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
