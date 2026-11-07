import type { Metadata } from "next";
import Link from "next/link";
import { Mail, Phone } from "lucide-react";
import { AddTaskButton, ContactActions, LogActivity } from "@/components/detail/actions";
import { Timeline } from "@/components/timeline";
import { TaskCheck } from "@/components/task-check";
import { Badge, Panel } from "@/components/ui";
import { formatMoney, fullName, relativeTime } from "@/lib/format";
import { orNotFound } from "@/server/http/page";
import { requireAuth } from "@/server/http/session";
import { getContact } from "@/server/modules/crm/contacts.service";

export async function generateMetadata({ params }: PageProps<"/contacts/[id]">): Promise<Metadata> {
  const { id } = await params;
  const ctx = await requireAuth();
  const c = await getContact(ctx, id).catch(() => null);
  return { title: c ? fullName(c.firstName, c.lastName) : "Contact" };
}

export default async function ContactPage({ params }: PageProps<"/contacts/[id]">) {
  const { id } = await params;
  const ctx = await requireAuth();
  const c = await orNotFound(() => getContact(ctx, id));
  const name = fullName(c.firstName, c.lastName);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[13px] text-muted"><Link href="/contacts" className="hover:underline">Contacts</Link> / Customer 360</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{name}</h1>
          <p className="mt-0.5 text-sm text-muted">
            {c.jobTitle}
            {c.jobTitle && c.companyId ? " at " : ""}
            {c.companyId && <Link href={`/companies/${c.companyId}`} className="font-medium text-fg hover:underline">{c.companyName}</Link>}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
            {c.email && <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1.5 text-accent hover:underline"><Mail className="h-3.5 w-3.5" />{c.email}</a>}
            {c.phone && <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1.5 text-muted hover:text-fg"><Phone className="h-3.5 w-3.5" />{c.phone}</a>}
            {c.source && <Badge>Source: {c.source}</Badge>}
            {c.tags.map((t) => <Badge key={t} tone="accent">{t}</Badge>)}
          </div>
        </div>
        <div className="flex items-center gap-2"><ContactActions contact={{ ...c }} /></div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-4">
          <LogActivity links={{ contactId: c.id }} />
          <Panel title="Timeline"><div className="p-5"><Timeline kind="contact" id={c.id} /></div></Panel>
        </div>
        <div className="space-y-6">
          <Panel title="Deals">
            {c.deals.length === 0 ? <p className="p-4 text-sm text-muted">No deals yet.</p> : (
              <ul className="divide-y divide-border">
                {c.deals.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <Link href={`/deals/${d.id}`} className="block truncate font-medium hover:underline">{d.title}</Link>
                      <p className="text-xs text-muted">{d.stageName}{d.role ? ` · ${d.role}` : ""}</p>
                    </div>
                    <span className="text-sm tabular">{formatMoney(d.amount, d.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Open tasks" action={<AddTaskButton links={{ contactId: c.id }} label="Add" />}>
            {c.openTasks.length === 0 ? <p className="p-4 text-sm text-muted">Nothing to do for this contact.</p> : (
              <ul className="divide-y divide-border">
                {c.openTasks.map((t) => (
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
