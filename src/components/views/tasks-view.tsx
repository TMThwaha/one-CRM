"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { TaskModal } from "@/components/forms";
import { ListEmpty, SearchBox, useList } from "@/components/list-kit";
import { useCan, useSession } from "@/components/session";
import { Badge, Button, Panel, PageHeader, Skeleton, cn, useToast } from "@/components/ui";
import { TaskCheck } from "@/components/task-check";
import { ApiError, del } from "@/lib/api";
import { formatDateTime, isOverdue } from "@/lib/format";

interface Row {
  id: string; title: string; status: "open" | "done"; priority: string; dueAt: string | null; assigneeId: string | null; assigneeName: string | null;
  contactId: string | null; contactName: string | null; companyName: string | null; dealId: string | null; dealTitle: string | null;
}

const FILTERS = [
  { key: "mine", label: "My open tasks" },
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Due today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "done", label: "Completed" },
  { key: "all", label: "Everything" },
] as const;

export function TasksView() {
  const can = useCan();
  const { user } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("mine");
  const [creating, setCreating] = useState(false);

  const extra =
    filter === "mine" ? { status: "open", assigneeId: user.id }
    : filter === "overdue" ? { due: "overdue", status: "open" }
    : filter === "today" ? { due: "today", status: "open" }
    : filter === "upcoming" ? { due: "upcoming", status: "open" }
    : filter === "done" ? { status: "done" }
    : {};
  const { q, setQ, page, setPage, pageSize, query } = useList<Row>("tasks", "/tasks", extra as Record<string, string>, 50);

  const remove = useMutation({
    mutationFn: (id: string) => del(`/tasks/${id}`),
    onSuccess: () => qc.invalidateQueries(),
    onError: (e) => toast(e instanceof ApiError ? e.message : "Could not delete", "danger"),
  });

  const rows = query.data?.items;
  return (
    <>
      <PageHeader title="Tasks" description="Everything that needs doing, connected to the customer it is for."
        actions={can("task.write") && <Button variant="primary" onClick={() => setCreating(true)}>New task</Button>} />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Task filter" className="flex flex-wrap gap-1 rounded-lg bg-surface-2 p-1">
          {FILTERS.map((f) => (
            <button key={f.key} role="tab" aria-selected={filter === f.key} onClick={() => setFilter(f.key)}
              className={cn("rounded-md px-3 py-1 text-[13px] font-medium", filter === f.key ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg")}>
              {f.label}
            </button>
          ))}
        </div>
        <SearchBox value={q} onChange={setQ} placeholder="Search tasks" />
      </div>
      <Panel>
        {query.isLoading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : rows && rows.length === 0 ? (
          <ListEmpty filtered={Boolean(q)} title={filter === "mine" ? "Nothing on your plate" : "No tasks here"} body="Create a task from here, or from any contact, lead or deal."
            action={can("task.write") ? <Button variant="primary" onClick={() => setCreating(true)}>New task</Button> : undefined} />
        ) : (
          <ul className="divide-y divide-border">
            {rows?.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-4 py-3">
                <TaskCheck id={t.id} done={t.status === "done"} title={t.title} />
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate", t.status === "done" && "text-faint line-through")}>{t.title}</p>
                  <p className="truncate text-xs text-muted">
                    {t.contactId && <Link href={`/contacts/${t.contactId}`} className="hover:underline">{t.contactName}</Link>}
                    {t.dealId && <>{t.contactId ? " · " : ""}<Link href={`/deals/${t.dealId}`} className="hover:underline">{t.dealTitle}</Link></>}
                    {!t.contactId && !t.dealId && "Not linked to a record"}
                    {t.assigneeId !== user.id && t.assigneeName ? ` · ${t.assigneeName}` : ""}
                  </p>
                </div>
                {(t.priority === "urgent" || t.priority === "high") && t.status === "open" && <Badge tone={t.priority === "urgent" ? "danger" : "warning"}>{t.priority}</Badge>}
                <span className={cn("hidden w-36 text-right text-xs tabular sm:block", isOverdue(t.dueAt, t.status) ? "font-medium text-danger" : "text-muted")}>
                  {t.dueAt ? formatDateTime(t.dueAt) : "No due date"}
                </span>
                {can("task.delete") && (
                  <Button size="icon" variant="ghost" aria-label={`Delete task ${t.title}`} onClick={() => remove.mutate(t.id)}><Trash2 className="h-4 w-4" /></Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {query.data && query.data.total > pageSize && (
          <div className="flex justify-between border-t border-border px-4 py-2 text-[13px] text-muted">
            <span>{query.data.total} tasks</span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <Button size="sm" variant="ghost" disabled={page * pageSize >= query.data.total} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </div>
        )}
      </Panel>
      <TaskModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
