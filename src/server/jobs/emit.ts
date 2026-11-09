import "server-only";
import { domainEvents } from "@/server/db/schema";
import type { Tx } from "@/server/db/tenant";
import type { AuthContext } from "@/server/modules/identity/context";

/**
 * Every business event the platform publishes. Adding a type here is the only step needed before a
 * service can emit it; handlers subscribe by type (see ./events).
 */
export const EVENT_TYPES = [
  "contact.created",
  "lead.created",
  "lead.converted",
  "deal.created",
  "deal.stage_changed",
  "task.created",
  "task.assigned",
  "task.completed",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface EmitInput {
  type: EventType;
  entityType: string;
  entityId?: string | null;
  /** Keep it small and free of anything a handler can look up itself. It is stored as-is. */
  payload?: Record<string, unknown>;
}

/**
 * Publishes an event from inside a tenant transaction, next to the audit write. Rolled back with the
 * change if the transaction fails, so there are no phantom events.
 */
export async function emit(tx: Tx, ctx: Pick<AuthContext, "organizationId" | "userId">, e: EmitInput): Promise<void> {
  await tx.insert(domainEvents).values({
    organizationId: ctx.organizationId,
    type: e.type,
    entityType: e.entityType,
    entityId: e.entityId ?? null,
    actorUserId: ctx.userId,
    payload: e.payload ?? {},
  });
}
