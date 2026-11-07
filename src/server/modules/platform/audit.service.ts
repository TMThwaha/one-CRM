import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { auditLogs, users } from "@/server/db/schema";
import { withTenant } from "@/server/db/tenant";
import { require as requirePerm, type AuthContext } from "@/server/modules/identity/context";
import { pageQuery } from "@/shared/schemas/common";

const auditQuery = pageQuery.extend({
  entityType: z.string().max(40).optional(),
  entityId: z.string().uuid().optional(),
  actorUserId: z.string().uuid().optional(),
});

export async function listAuditLogs(ctx: AuthContext, rawQuery: unknown) {
  requirePerm(ctx, "audit.read");
  const q = auditQuery.parse(rawQuery);
  return withTenant(ctx, async (tx) => {
    const where = and(
      q.entityType ? eq(auditLogs.entityType, q.entityType) : undefined,
      q.entityId ? eq(auditLogs.entityId, q.entityId) : undefined,
      q.actorUserId ? eq(auditLogs.actorUserId, q.actorUserId) : undefined,
      q.q ? sql`${auditLogs.action} ilike ${"%" + q.q.replace(/[\\%_]/g, "\\$&") + "%"}` : undefined,
    );
    const [items, [{ total }]] = await Promise.all([
      tx
        .select({
          id: auditLogs.id,
          action: auditLogs.action,
          entityType: auditLogs.entityType,
          entityId: auditLogs.entityId,
          summary: auditLogs.summary,
          changes: auditLogs.changes,
          createdAt: auditLogs.createdAt,
          actorName: users.name,
        })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.actorUserId))
        .where(where)
        .orderBy(desc(auditLogs.createdAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      tx.select({ total: sql<number>`count(*)::int` }).from(auditLogs).where(where),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  });
}
