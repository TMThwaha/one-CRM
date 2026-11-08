import "server-only";
import type { Database } from "@/server/db/client";
import { auditLogs, platformAuditLogs } from "@/server/db/schema";
import type { PlatformContext } from "./context";

type Executor = Pick<Database, "insert">;

export interface PlatformAuditEntry {
  action: string; // e.g. "company.suspended"
  entityType: string;
  entityId?: string | null;
  organizationId?: string | null;
  summary?: string;
  changes?: Record<string, unknown>;
  /** Also write the event into the company's own audit log so its admins can see it. */
  mirrorToCompany?: boolean;
}

/** Written in the SAME transaction as the action it records. */
export async function platformAudit(
  tx: Executor,
  actor: Pick<PlatformContext, "userId" | "userEmail" | "ip">,
  e: PlatformAuditEntry,
): Promise<void> {
  await tx.insert(platformAuditLogs).values({
    actorUserId: actor.userId,
    actorEmail: actor.userEmail,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId ?? null,
    organizationId: e.organizationId ?? null,
    summary: e.summary,
    changes: e.changes ?? {},
    ip: actor.ip ?? null,
  });
  if (e.mirrorToCompany && e.organizationId) {
    await tx.insert(auditLogs).values({
      organizationId: e.organizationId,
      actorUserId: actor.userId,
      action: `platform.${e.action}`,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      summary: `[Platform] ${e.summary ?? e.action}`,
      changes: e.changes ?? {},
      ip: actor.ip ?? null,
    });
  }
}

/** Postgres unique-violation (23505), optionally for one named constraint/index. */
export function isUniqueViolation(e: unknown, constraint?: string): boolean {
  const err = e as { code?: string; constraint?: string; message?: string; cause?: { code?: string; constraint?: string; message?: string } };
  const code = err?.code ?? err?.cause?.code;
  if (code !== "23505") return false;
  if (!constraint) return true;
  const hay = `${err.constraint ?? ""} ${err.cause?.constraint ?? ""} ${err.message ?? ""} ${err.cause?.message ?? ""}`;
  return hay.includes(constraint);
}
