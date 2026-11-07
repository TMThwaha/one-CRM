import "server-only";
import { and, asc, desc, eq, gte, isNull, lt, lte, sql } from "drizzle-orm";
import { activities, deals, leads, tasks, users } from "@/server/db/schema";
import { withTenant } from "@/server/db/tenant";
import { isOwnOnly, type AuthContext } from "@/server/modules/identity/context";

/**
 * Real aggregates over the actor's visible data. Money is grouped by currency - amounts in
 * different currencies are never summed together. No placeholders: empty data yields zeros.
 */
export async function getDashboard(ctx: AuthContext) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);
  const startOfMonth = new Date(startOfDay.getFullYear(), startOfDay.getMonth(), 1);
  const in30Days = new Date(startOfDay);
  in30Days.setDate(in30Days.getDate() + 30);

  const dealScope = ctx.permissions["deal.read"];
  const leadScope = ctx.permissions["lead.read"];
  const taskScope = ctx.permissions["task.read"];

  return withTenant(ctx, async (tx) => {
    const dealVisible = dealScope && isOwnOnly(dealScope) ? eq(deals.ownerId, ctx.userId) : undefined;

    // --- my work ---
    const myTasks = taskScope
      ? await tx
          .select({ id: tasks.id, title: tasks.title, dueAt: tasks.dueAt, priority: tasks.priority, dealId: tasks.dealId, contactId: tasks.contactId })
          .from(tasks)
          .where(and(eq(tasks.assigneeId, ctx.userId), eq(tasks.status, "open"), isNull(tasks.deletedAt)))
          .orderBy(sql`${tasks.dueAt} asc nulls last`)
          .limit(8)
      : [];
    const taskCounts = taskScope
      ? (
          await tx
            .select({
              overdue: sql<number>`count(*) filter (where ${tasks.dueAt} < now())::int`,
              today: sql<number>`count(*) filter (where ${tasks.dueAt} >= ${startOfDay} and ${tasks.dueAt} < ${endOfDay})::int`,
              open: sql<number>`count(*)::int`,
            })
            .from(tasks)
            .where(and(eq(tasks.assigneeId, ctx.userId), eq(tasks.status, "open"), isNull(tasks.deletedAt)))
        )[0]
      : { overdue: 0, today: 0, open: 0 };

    const newLeads = leadScope
      ? (
          await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(leads)
            .where(and(isNull(leads.deletedAt), eq(leads.status, "new"), eq(leads.ownerId, ctx.userId)))
        )[0].n
      : 0;

    const hotLeads = leadScope
      ? await tx
          .select({ id: leads.id, firstName: leads.firstName, lastName: leads.lastName, companyName: leads.companyName, score: leads.score })
          .from(leads)
          .where(
            and(
              isNull(leads.deletedAt),
              sql`${leads.status} in ('new','contacted','qualified')`,
              isOwnOnly(leadScope) ? eq(leads.ownerId, ctx.userId) : undefined,
            ),
          )
          .orderBy(desc(leads.score), desc(leads.createdAt))
          .limit(5)
      : [];

    // --- pipeline ---
    let pipeline: { currency: string; openCount: number; openAmount: string; weightedAmount: string }[] = [];
    let wonThisMonth: { currency: string; count: number; amount: string }[] = [];
    let byStage: { stageId: string; stageName: string; count: number; amount: string; currency: string }[] = [];
    let closingSoon: { id: string; title: string; amount: string; currency: string; expectedCloseDate: string | null }[] = [];

    if (dealScope) {
      pipeline = await tx
        .select({
          currency: deals.currency,
          openCount: sql<number>`count(*)::int`,
          openAmount: sql<string>`coalesce(sum(${deals.amount}), 0)::text`,
          weightedAmount: sql<string>`coalesce(round(sum(${deals.amount} * ${deals.probability} / 100.0), 2), 0)::text`,
        })
        .from(deals)
        .where(and(isNull(deals.deletedAt), eq(deals.status, "open"), dealVisible))
        .groupBy(deals.currency);

      wonThisMonth = await tx
        .select({
          currency: deals.currency,
          count: sql<number>`count(*)::int`,
          amount: sql<string>`coalesce(sum(${deals.amount}), 0)::text`,
        })
        .from(deals)
        .where(and(isNull(deals.deletedAt), eq(deals.status, "won"), gte(deals.closedAt, startOfMonth), dealVisible))
        .groupBy(deals.currency);

      byStage = await tx
        .select({
          stageId: deals.stageId,
          stageName: sql<string>`(select name from pipeline_stages ps where ps.id = ${deals.stageId})`,
          currency: deals.currency,
          count: sql<number>`count(*)::int`,
          amount: sql<string>`coalesce(sum(${deals.amount}), 0)::text`,
        })
        .from(deals)
        .where(and(isNull(deals.deletedAt), eq(deals.status, "open"), dealVisible))
        .groupBy(deals.stageId, deals.currency);

      closingSoon = await tx
        .select({ id: deals.id, title: deals.title, amount: deals.amount, currency: deals.currency, expectedCloseDate: deals.expectedCloseDate })
        .from(deals)
        .where(
          and(
            isNull(deals.deletedAt),
            eq(deals.status, "open"),
            lte(deals.expectedCloseDate, in30Days.toISOString().slice(0, 10)),
            dealVisible,
          ),
        )
        .orderBy(asc(deals.expectedCloseDate))
        .limit(6);
    }

    // --- recent activity (visibility mirrors the timeline rules) ---
    const recent = ctx.permissions["activity.read"]
      ? await tx
          .select({
            id: activities.id,
            type: activities.type,
            subject: activities.subject,
            occurredAt: activities.occurredAt,
            contactId: activities.contactId,
            dealId: activities.dealId,
            leadId: activities.leadId,
            companyId: activities.companyId,
            authorName: users.name,
          })
          .from(activities)
          .leftJoin(users, eq(users.id, activities.createdBy))
          .where(
            and(
              !dealScope ? isNull(activities.dealId) : isOwnOnly(dealScope)
                ? sql`(${activities.dealId} is null or ${activities.dealId} in (select id from deals where owner_id = ${ctx.userId}))`
                : undefined,
              !leadScope ? isNull(activities.leadId) : isOwnOnly(leadScope)
                ? sql`(${activities.leadId} is null or ${activities.leadId} in (select id from leads where owner_id = ${ctx.userId}))`
                : undefined,
              !ctx.permissions["contact.read"] ? isNull(activities.contactId) : undefined,
              !ctx.permissions["company.read"] ? isNull(activities.companyId) : undefined,
              lt(activities.occurredAt, new Date(Date.now() + 60_000)),
            ),
          )
          .orderBy(desc(activities.occurredAt))
          .limit(8)
      : [];

    return {
      tasks: { ...taskCounts, items: myTasks },
      leads: { newAssignedToMe: newLeads, top: hotLeads },
      pipeline,
      byStage,
      wonThisMonth,
      closingSoon,
      recent,
    };
  });
}
