import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Panel, EmptyState, Badge } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { requireAuth } from "@/server/http/session";
import { listAuditLogs } from "@/server/modules/platform/audit.service";
import { orNotFound } from "@/server/http/page";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: PageProps<"/settings/audit">) {
  const sp = await searchParams;
  const ctx = await requireAuth();
  const page = Math.max(1, Number(Array.isArray(sp.page) ? sp.page[0] : sp.page) || 1);
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const log = await orNotFound(() => listAuditLogs(ctx, { page, pageSize: 50, q }));
  const pages = Math.max(1, Math.ceil(log.total / log.pageSize));
  const href = (p: number) => `/settings/audit?page=${p}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  return (
    <>
      <PageHeader title="Audit log" description="An append-only record of who changed what. It cannot be edited from the application." />
      <form className="mb-3" action="/settings/audit">
        <input name="q" defaultValue={q} placeholder="Filter by action, e.g. deal.stage_changed" aria-label="Filter by action"
          className="h-9 w-full max-w-sm rounded-lg border border-border-strong bg-surface px-3 text-sm placeholder:text-faint" />
      </form>
      <Panel>
        {log.items.length === 0 ? <EmptyState title="No entries" body="Activity in your workspace will be recorded here." /> : (
          <ul className="divide-y divide-border">
            {log.items.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
                <Badge className="font-mono">{e.action}</Badge>
                <span className="min-w-0 flex-1 truncate text-sm">{e.summary ?? Object.keys(e.changes as object).join(", ")}</span>
                <span className="text-xs text-muted">{e.actorName ?? "System"}</span>
                <time className="w-32 text-right text-xs text-faint tabular" dateTime={e.createdAt.toISOString()}>{formatDateTime(e.createdAt)}</time>
              </li>
            ))}
          </ul>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-[13px] text-muted">
            <span>Page {log.page} of {pages} · {log.total} entries</span>
            <div className="flex gap-3">
              {log.page > 1 && <Link className="text-accent hover:underline" href={href(log.page - 1)}>Previous</Link>}
              {log.page < pages && <Link className="text-accent hover:underline" href={href(log.page + 1)}>Next</Link>}
            </div>
          </div>
        )}
      </Panel>
    </>
  );
}
