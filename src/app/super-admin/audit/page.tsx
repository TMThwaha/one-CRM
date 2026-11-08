import Link from "next/link";
import { z } from "zod";
import { PageHeader } from "@/components/ui";
import { Empty, Pager, Table, Td, qs, utc } from "@/components/platform/bits";
import { listPlatformAudit } from "@/server/modules/platform-admin/queries.service";

export const metadata = { title: "Audit logs" };

export default async function AuditPage({ searchParams }: PageProps<"/super-admin/audit">) {
  const raw = await searchParams;
  const one = (k: string) => (Array.isArray(raw[k]) ? raw[k]![0] : (raw[k] as string | undefined)) || undefined;
  const q = one("q")?.slice(0, 100);
  const company = z.string().uuid().safeParse(one("company"));
  const organizationId = company.success ? company.data : undefined;
  const pageNum = Number(one("page"));
  const page = Number.isInteger(pageNum) && pageNum > 0 ? pageNum : 1;
  const r = await listPlatformAudit({ q, organizationId, page });
  const base = { q, company: organizationId };
  return (
    <div className="space-y-4">
      <PageHeader title="Audit logs" description="Every platform-level action, in order. Entries cannot be edited or deleted." />
      <form method="get" role="search" className="flex flex-wrap items-center gap-2">
        <input type="search" name="q" defaultValue={q} placeholder="Search action, summary or actor" aria-label="Search audit log" className="h-9 w-full max-w-sm rounded-lg border border-border-strong bg-surface px-2.5 text-sm" />
        {organizationId && <input type="hidden" name="company" value={organizationId} />}
        <button className="h-9 rounded-lg bg-accent px-3.5 text-sm font-medium text-accent-fg hover:bg-accent-hover" type="submit">Search</button>
        {organizationId && <Link className="text-sm text-accent hover:underline" href="/super-admin/audit">Show all companies</Link>}
      </form>
      <Table head={["When", "Action", "Summary", "Company", "Actor", "IP"]} empty={r.rows.length === 0 ? <Empty title="No matching entries" /> : undefined}>
        {r.rows.map((a) => (
          <tr key={a.id}>
            <Td className="whitespace-nowrap">{utc(a.createdAt, true)}</Td>
            <Td><code className="text-xs">{a.action}</code></Td>
            <Td className="max-w-md">{a.summary ?? "—"}</Td>
            <Td>{a.organizationId ? <Link className="text-accent hover:underline" href={`/super-admin/companies/${a.organizationId}`}>{a.company ?? "Deleted company"}</Link> : "—"}</Td>
            <Td>{a.actorEmail ?? "—"}</Td>
            <Td className="text-xs text-muted">{a.ip ?? "—"}</Td>
          </tr>
        ))}
      </Table>
      <Pager page={r.page} pages={r.pages} total={r.total} pageSize={r.pageSize} href={(p) => `/super-admin/audit${qs(base, { page: p })}`} />
    </div>
  );
}
