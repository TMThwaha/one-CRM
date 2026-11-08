import type { Metadata } from "next";
import Link from "next/link";
import { Badge, EmptyState, Panel } from "@/components/ui";
import { TaskCheck } from "@/components/task-check";
import { formatCompactMoney, formatDate, fullName, hourIn, isOverdue, relativeTime } from "@/lib/format";
import { requireAuth } from "@/server/http/session";
import { getDashboard } from "@/server/modules/platform/dashboard.service";
import { getOrganizationBasics } from "@/server/modules/identity/org.service";

export const metadata: Metadata = { title: "Dashboard" };

function greeting(timeZone: string) {
  const h = hourIn(timeZone);
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function Tile({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "danger" }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-[13px] text-muted">{label}</p>
      <div className={`mt-1.5 text-2xl font-semibold tracking-tight tabular ${tone === "danger" ? "text-danger" : ""}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export default async function DashboardPage() {
  const ctx = await requireAuth();
  const [d, org] = await Promise.all([getDashboard(ctx), getOrganizationBasics(ctx)]);
  const can = (p: keyof typeof ctx.permissions) => ctx.permissions[p] !== undefined;
  const hasDeals = can("deal.read");
  const stageMax = Math.max(1, ...d.byStage.map((s) => Number(s.amount)));
  const stageOrder = new Map<string, number>();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          {greeting(ctx.regional.timeZone)}, {ctx.userName.split(" ")[0]}
        </h1>
        <p className="mt-0.5 text-sm text-muted">
          {formatDate(new Date(), { weekday: "long", day: "numeric", month: "long" }, ctx.regional)} · {org.name}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {can("task.read") && (
          <Tile
            label="My open tasks"
            value={d.tasks.open}
            tone={d.tasks.overdue > 0 ? "danger" : undefined}
            sub={d.tasks.overdue > 0 ? `${d.tasks.overdue} overdue · ${d.tasks.today} due today` : `${d.tasks.today} due today`}
          />
        )}
        {can("lead.read") && <Tile label="New leads assigned to me" value={d.leads.newAssignedToMe} sub="Not yet contacted" />}
        {hasDeals && (
          <Tile
            label="Open pipeline"
            value={d.pipeline.length === 0 ? "—" : d.pipeline.map((p) => <div key={p.currency}>{formatCompactMoney(p.openAmount, p.currency, ctx.regional.locale)}</div>)}
            sub={d.pipeline.length === 0 ? "No open deals" : d.pipeline.map((p) => `${p.openCount} deals · weighted ${formatCompactMoney(p.weightedAmount, p.currency, ctx.regional.locale)}`).join(" | ")}
          />
        )}
        {hasDeals && (
          <Tile
            label="Won this month"
            value={d.wonThisMonth.length === 0 ? "—" : d.wonThisMonth.map((p) => <div key={p.currency}>{formatCompactMoney(p.amount, p.currency, ctx.regional.locale)}</div>)}
            sub={d.wonThisMonth.length === 0 ? "No deals closed yet" : d.wonThisMonth.map((p) => `${p.count} deals`).join(" | ")}
          />
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-6">
          {can("task.read") && (
            <Panel title="Today's work" action={<Link href="/tasks" className="text-[13px] text-accent hover:underline">All tasks</Link>}>
              {d.tasks.items.length === 0 ? (
                <EmptyState title="You're all caught up" body="Tasks assigned to you will appear here, soonest first." />
              ) : (
                <ul className="divide-y divide-border">
                  {d.tasks.items.map((t) => (
                    <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                      <TaskCheck id={t.id} done={false} title={t.title} />
                      <span className="min-w-0 flex-1 truncate">{t.title}</span>
                      {t.priority === "urgent" || t.priority === "high" ? <Badge tone="warning">{t.priority}</Badge> : null}
                      <span className={`text-xs tabular ${isOverdue(t.dueAt) ? "font-medium text-danger" : "text-muted"}`}>
                        {t.dueAt ? (isOverdue(t.dueAt) ? `Overdue · ${relativeTime(t.dueAt)}` : relativeTime(t.dueAt)) : "No due date"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}

          {can("lead.read") && (
            <Panel title="Leads worth your time" action={<Link href="/leads" className="text-[13px] text-accent hover:underline">All leads</Link>}>
              {d.leads.top.length === 0 ? (
                <EmptyState title="No active leads" body="New leads are scored automatically, highest first." />
              ) : (
                <ul className="divide-y divide-border">
                  {d.leads.top.map((l) => (
                    <li key={l.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="flex h-8 w-10 items-center justify-center rounded-md bg-accent-soft text-sm font-semibold text-accent tabular">{l.score}</span>
                      <div className="min-w-0 flex-1">
                        <Link href={`/leads?open=${l.id}`} className="truncate font-medium hover:underline">{fullName(l.firstName, l.lastName)}</Link>
                        <p className="truncate text-xs text-muted">{l.companyName ?? "No company"}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </div>

        <div className="space-y-6">
          {hasDeals && (
            <Panel title="Open pipeline by stage">
              {d.byStage.length === 0 ? (
                <EmptyState title="No open deals" body="Create a deal to see your pipeline here." />
              ) : (
                <ul className="space-y-3 p-4">
                  {d.byStage.map((s) => {
                    if (!stageOrder.has(s.stageId)) stageOrder.set(s.stageId, stageOrder.size);
                    return (
                      <li key={s.stageId + s.currency}>
                        <div className="mb-1 flex justify-between text-[13px]">
                          <span>{s.stageName} <span className="text-faint">· {s.count}</span></span>
                          <span className="tabular text-muted">{formatCompactMoney(s.amount, s.currency, ctx.regional.locale)}</span>
                        </div>
                        <div className="h-2 rounded-full bg-surface-2">
                          <div className="h-2 rounded-full bg-accent" style={{ width: `${Math.max(3, (Number(s.amount) / stageMax) * 100)}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          )}

          {hasDeals && d.closingSoon.length > 0 && (
            <Panel title="Closing within 30 days">
              <ul className="divide-y divide-border">
                {d.closingSoon.map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <Link href={`/deals/${x.id}`} className="truncate hover:underline">{x.title}</Link>
                    <span className="shrink-0 text-xs text-muted tabular">{formatCompactMoney(x.amount, x.currency, ctx.regional.locale)} · {formatDate(x.expectedCloseDate, { day: "numeric", month: "short" }, ctx.regional)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {can("activity.read") && (
            <Panel title="Recent activity">
              {d.recent.length === 0 ? (
                <EmptyState title="Nothing yet" body="Notes, calls, stage changes and conversions appear here." />
              ) : (
                <ul className="divide-y divide-border">
                  {d.recent.map((a) => (
                    <li key={a.id} className="px-4 py-2.5">
                      <p className="truncate text-sm">{a.subject}</p>
                      <p className="text-xs text-muted">{a.authorName ?? "System"} · {relativeTime(a.occurredAt)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
