import "server-only";
import { and, asc, desc, eq, ilike, isNull, lt, gte, sql } from "drizzle-orm";
import { companies, contacts, deals, tasks, users } from "@/server/db/schema";
import { withTenant } from "@/server/db/tenant";
import { audit } from "@/server/platform/audit";
import { emit } from "@/server/jobs/emit";
import { conflict, invalid, notFound } from "@/server/platform/errors";
import { isOwnOnly, require as requirePerm, type AuthContext } from "@/server/modules/identity/context";
import { assertVersion, diff, isForeignKeyViolation, likePattern } from "@/server/modules/_shared/helpers";
import { taskInput, taskListQuery, taskUpdate, type TaskInput } from "@/shared/schemas/workforce";
import { assertLinksVisible, recordSystemActivity } from "./activities.service";

/** Tasks are visible to their assignee and creator; `all` scope sees every task. */
function visible(ctx: AuthContext, scope: "all" | "team" | "own") {
  return isOwnOnly(scope)
    ? sql`(${tasks.assigneeId} = ${ctx.userId} or ${tasks.createdBy} = ${ctx.userId})`
    : undefined;
}

function dayBounds() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

const taskColumns = {
  id: tasks.id,
  title: tasks.title,
  description: tasks.description,
  dueAt: tasks.dueAt,
  priority: tasks.priority,
  status: tasks.status,
  assigneeId: tasks.assigneeId,
  assigneeName: users.name,
  contactId: tasks.contactId,
  contactName: sql<string | null>`concat_ws(' ', ${contacts.firstName}, ${contacts.lastName})`,
  companyId: tasks.companyId,
  companyName: companies.name,
  leadId: tasks.leadId,
  dealId: tasks.dealId,
  dealTitle: deals.title,
  completedAt: tasks.completedAt,
  version: tasks.version,
  createdAt: tasks.createdAt,
};

export async function listTasks(ctx: AuthContext, rawQuery: unknown) {
  const scope = requirePerm(ctx, "task.read");
  const q = taskListQuery.parse(rawQuery);
  const { start, end } = dayBounds();
  return withTenant(ctx, async (tx) => {
    const where = and(
      isNull(tasks.deletedAt),
      visible(ctx, scope),
      q.status ? eq(tasks.status, q.status) : undefined,
      q.mine ? eq(tasks.assigneeId, ctx.userId) : undefined,
      q.assigneeId ? eq(tasks.assigneeId, q.assigneeId) : undefined,
      q.contactId ? eq(tasks.contactId, q.contactId) : undefined,
      q.dealId ? eq(tasks.dealId, q.dealId) : undefined,
      q.due === "overdue" ? and(eq(tasks.status, "open"), lt(tasks.dueAt, new Date())) : undefined,
      q.due === "today" ? and(gte(tasks.dueAt, start), lt(tasks.dueAt, end)) : undefined,
      q.due === "upcoming" ? gte(tasks.dueAt, end) : undefined,
      q.q ? ilike(tasks.title, likePattern(q.q)) : undefined,
    );
    const [items, [{ total }]] = await Promise.all([
      tx
        .select(taskColumns)
        .from(tasks)
        .leftJoin(users, eq(users.id, tasks.assigneeId))
        .leftJoin(contacts, eq(contacts.id, tasks.contactId))
        .leftJoin(companies, eq(companies.id, tasks.companyId))
        .leftJoin(deals, eq(deals.id, tasks.dealId))
        .where(where)
        .orderBy(asc(tasks.status), sql`${tasks.dueAt} asc nulls last`, desc(tasks.createdAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      tx.select({ total: sql<number>`count(*)::int` }).from(tasks).where(where),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  });
}

export async function createTask(ctx: AuthContext, input: TaskInput) {
  requirePerm(ctx, "task.write");
  const data = taskInput.parse(input);
  try {
    return await withTenant(ctx, async (tx) => {
      await assertLinksVisible(tx, ctx, data);
      const [row] = await tx
        .insert(tasks)
        .values({
          ...data,
          dueAt: data.dueAt ? new Date(data.dueAt) : null,
          assigneeId: data.assigneeId ?? ctx.userId,
          organizationId: ctx.organizationId,
          createdBy: ctx.userId,
        })
        .returning();
      await audit(tx, ctx, { action: "task.created", entityType: "task", entityId: row.id, summary: row.title });
      await emit(tx, ctx, { type: "task.created", entityType: "task", entityId: row.id });
      // Telling someone about work they gave themselves is noise.
      if (row.assigneeId && row.assigneeId !== ctx.userId) {
        await emit(tx, ctx, { type: "task.assigned", entityType: "task", entityId: row.id, payload: { assigneeId: row.assigneeId, title: row.title } });
      }
      return row;
    });
  } catch (e) {
    if (isForeignKeyViolation(e)) throw invalid("The assignee does not exist in this organization");
    throw e;
  }
}

export async function updateTask(ctx: AuthContext, id: string, input: unknown) {
  const scope = requirePerm(ctx, "task.write");
  const { version, ...rawPatch } = taskUpdate.parse(input);
  const { dueAt, status, ...rest } = rawPatch;
  try {
    return await withTenant(ctx, async (tx) => {
      const [before] = await tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, id), isNull(tasks.deletedAt), visible(ctx, scope)));
      if (!before) throw notFound("Task");
      assertVersion(before.version, version, "task");
      await assertLinksVisible(tx, ctx, {
        contactId: rest.contactId !== undefined && rest.contactId !== before.contactId ? rest.contactId : null,
        companyId: rest.companyId !== undefined && rest.companyId !== before.companyId ? rest.companyId : null,
        leadId: rest.leadId !== undefined && rest.leadId !== before.leadId ? rest.leadId : null,
        dealId: rest.dealId !== undefined && rest.dealId !== before.dealId ? rest.dealId : null,
      });

      const patch: Partial<typeof tasks.$inferInsert> = {
        ...rest,
        ...(dueAt !== undefined ? { dueAt: dueAt ? new Date(dueAt) : null } : {}),
      };
      if (status && status !== before.status) {
        patch.status = status;
        patch.completedAt = status === "done" ? new Date() : null;
      }
      const [row] = await tx
        .update(tasks)
        .set({ ...patch, updatedAt: new Date(), version: before.version + 1 })
        .where(and(eq(tasks.id, id), eq(tasks.version, before.version)))
        .returning();
      if (!row) throw conflict("This task was changed by someone else. Reload to see the latest version.");

      if (status === "done" && before.status !== "done") {
        // Completed work shows up on the customer timeline.
        const link = { contactId: row.contactId, companyId: row.companyId, leadId: row.leadId, dealId: row.dealId };
        if (link.contactId || link.companyId || link.leadId || link.dealId) {
          await recordSystemActivity(tx, ctx, { ...link, subject: `Task completed: ${row.title}` });
        }
      }
      await audit(tx, ctx, { action: status && status !== before.status ? `task.${status === "done" ? "completed" : "reopened"}` : "task.updated", entityType: "task", entityId: id, changes: diff(before, patch) });
      if (status === "done" && before.status !== "done") {
        await emit(tx, ctx, { type: "task.completed", entityType: "task", entityId: id });
      }
      if (row.assigneeId && row.assigneeId !== before.assigneeId && row.assigneeId !== ctx.userId) {
        await emit(tx, ctx, { type: "task.assigned", entityType: "task", entityId: id, payload: { assigneeId: row.assigneeId, title: row.title } });
      }
      return row;
    });
  } catch (e) {
    if (isForeignKeyViolation(e)) throw invalid("The assignee does not exist in this organization");
    throw e;
  }
}

export async function deleteTask(ctx: AuthContext, id: string) {
  const scope = requirePerm(ctx, "task.delete");
  await withTenant(ctx, async (tx) => {
    const res = await tx
      .update(tasks)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(tasks.id, id), isNull(tasks.deletedAt), visible(ctx, scope)))
      .returning({ id: tasks.id });
    if (res.length === 0) throw notFound("Task");
    await audit(tx, ctx, { action: "task.deleted", entityType: "task", entityId: id });
  });
}

