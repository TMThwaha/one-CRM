import "server-only";
import type { Tx } from "@/server/db/tenant";
import { auditLogs } from "@/server/db/schema";
import type { AuthContext } from "@/server/modules/identity/context";

export interface AuditEntry {
  action: string; // e.g. "deal.stage_changed"
  entityType: string;
  entityId?: string | null;
  summary?: string;
  changes?: Record<string, unknown>;
}

/** Written in the SAME transaction as the change it describes: no change without a record. */
export async function audit(tx: Tx, ctx: AuthContext, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLogs).values({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    summary: entry.summary,
    changes: entry.changes ?? {},
    ip: ctx.ip ?? null,
  });
}
