import type { Metadata } from "next";
import Link from "next/link";
import { AddTaskButton, DealContactsEditor, DeleteButton, LogActivity, RemoveDealContact, StageStepper } from "@/components/detail/actions";
import { Timeline } from "@/components/timeline";
import { TaskCheck } from "@/components/task-check";
import { Badge, Panel } from "@/components/ui";
import { formatDate, formatMoney, fullName, relativeTime } from "@/lib/format";
import { orNotFound } from "@/server/http/page";
import { requireAuth } from "@/server/http/session";
import { getDeal } from "@/server/modules/sales/deals.service";
import { listTasks } from "@/server/modules/workforce/tasks.service";

export async function generateMetadata({ params }: PageProps<"/deals/[id]">): Promise<Metadata> {
  const { id } = await params;
  const ctx = await requireAuth();
  const d = await getDeal(ctx, id).catch(() => null);
  return { title: d?.title ?? "Deal" };
}

export default async function DealPage({ params }: PageProps<"/deals/[id]">) {
  const { id } = await params;
  const ctx = await requireAuth();
  const d = await orNotFound(() => getDeal(ctx, id));
  const tasks = ctx.permissions["task.read"] ? (await listTasks(ctx, { dealId: id, status: "open", pageSize: 20 })).items : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[13px] text-muted"><Link href="/deals" className="hover:underline">Deals</Link></p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{d.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            <span className="text-xl font-semibold tabular">{formatMoney(d.amount, d.currency)}</span>
            <Badge tone={d.status === "won" ? "success" : d.status === "lost" ? "danger" : "accent"}>{d.status}</Badge>
            <span className="text-muted">{d.probability}% likely</span>
            {d.companyId && <Link href={`/companies/${d.companyId}`} className="text-muted hover:underline">{d.companyName}</Link>}
            <span className="text-muted">Owner: {d.ownerName ?? "Unassigned"}</span>
            {d.expectedCloseDate && <span className="text-muted">Close: {formatDate(d.expectedCloseDate)}</span>}
          </div>
          {d.lostReason && <p className="mt-2 text-sm text-danger">Lost: {d.lostReason}</p>}
        </div>
        <div className="flex items-center gap-2"><DeleteButton endpoint={`/deals/${d.id}`} redirectTo="/deals" label="Deal" permission="deal.delete" /></div>
      </div>

      <StageStepper dealId={d.id} version={d.version} stageId={d.stageId} stages={d.stages} />

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-4">
          <LogActivity links={{ dealId: d.id }} />
          <Panel title="Timeline"><div className="p-5"><Timeline kind="deal" id={d.id} /></div></Panel>
        </div>
        <div className="space-y-6">
          <Panel title={`People (${d.contacts.length})`}>
            {d.contacts.length === 0 ? <p className="p-4 text-sm text-muted">No contacts on this deal yet.</p> : (
              <ul className="divide-y divide-border">
                {d.contacts.map((p) => (
                  <li key={p.contactId} className="flex items-center justify-between gap-2 px-4 py-2">
                    <div className="min-w-0">
                      <Link href={`/contacts/${p.contactId}`} className="block truncate font-medium hover:underline">{fullName(p.firstName, p.lastName)}</Link>
                      <p className="text-xs text-muted">{p.isPrimary ? "Primary" : p.role ?? p.email}</p>
                    </div>
                    <RemoveDealContact dealId={d.id} contactId={p.contactId} name={fullName(p.firstName, p.lastName)} />
                  </li>
                ))}
              </ul>
            )}
            <DealContactsEditor dealId={d.id} linked={d.contacts.map((p) => p.contactId)} />
          </Panel>
          <Panel title="Open tasks" action={<AddTaskButton links={{ dealId: d.id }} label="Add" />}>
            {tasks.length === 0 ? <p className="p-4 text-sm text-muted">No open tasks for this deal.</p> : (
              <ul className="divide-y divide-border">
                {tasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                    <TaskCheck id={t.id} done={false} title={t.title} />
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    <span className="text-xs text-muted">{t.dueAt ? relativeTime(t.dueAt) : ""}</span>
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
