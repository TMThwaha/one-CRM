import "server-only";
import { sql } from "drizzle-orm";
import { getDatabase } from "@/server/db/client";
import { PermanentJobError, defineJob, enqueue } from "./queue";

/**
 * Domain events: the business changes other parts of the system can react to.
 *
 * Producers (tenant services) call emit() INSIDE their own transaction (see ./emit), so the event
 * exists if and only if the change committed. dispatchEvents() then turns each event into one job per
 * interested handler, with an idempotency key, so a crash or a second dispatcher cannot duplicate work.
 * Each handler runs as its own job: its own retries, and one failing handler never blocks another.
 */

export interface DomainEventRow {
  id: string;
  organizationId: string;
  type: string;
  entityType: string;
  entityId: string | null;
  actorUserId: string | null;
  payload: Record<string, unknown>;
  occurredAt: Date;
}

export interface EventHandlerDefinition {
  /** Stable name: it is part of the idempotency key and shown in monitoring. */
  name: string;
  /** Exact types ("task.assigned"), prefixes ("task.*") or "*". */
  types: string[];
  handle: (event: DomainEventRow) => Promise<void>;
  maxAttempts?: number;
}

const handlers = new Map<string, EventHandlerDefinition>();
export function defineEventHandler(def: EventHandlerDefinition) {
  handlers.set(def.name, def);
}
export const registeredEventHandlers = () => [...handlers.keys()].sort();

export function handlerMatches(def: EventHandlerDefinition, type: string): boolean {
  return def.types.some((t) => t === "*" || t === type || (t.endsWith(".*") && type.startsWith(t.slice(0, -1))));
}

interface PendingRow {
  id: string;
  organization_id: string;
  type: string;
}

/** Fans pending events out to handler jobs. Safe to run from many workers at once. */
export async function dispatchEvents(opts: { limit?: number } = {}): Promise<{ events: number; jobs: number }> {
  const { db } = await getDatabase();
  const limit = opts.limit ?? 100;
  return db.transaction(async (tx) => {
    const pending = (
      (await tx.execute(sql`
        select id, organization_id, type from domain_events
        where dispatched_at is null
        order by occurred_at asc
        limit ${limit}
        for update skip locked`)) as unknown as { rows: PendingRow[] }
    ).rows;
    let jobs = 0;
    for (const ev of pending) {
      for (const def of handlers.values()) {
        if (!handlerMatches(def, ev.type)) continue;
        const r = await enqueue(tx, "event.handle", { eventId: ev.id, handler: def.name }, {
          organizationId: ev.organization_id,
          idempotencyKey: `evt:${ev.id}:${def.name}`,
          maxAttempts: def.maxAttempts,
        });
        if (r.created) jobs++;
      }
      await tx.execute(sql`update domain_events set dispatched_at = now() where id = ${ev.id}`);
    }
    return { events: pending.length, jobs };
  });
}

// The job that runs one handler for one event.
defineJob<{ eventId: string; handler: string }>({
  kind: "event.handle",
  maxAttempts: 5,
  timeoutMs: 30_000,
  handler: async ({ eventId, handler }) => {
    const def = handlers.get(handler);
    if (!def) throw new PermanentJobError(`No event handler named "${handler}"`);
    const { db } = await getDatabase();
    const found = (
      (await db.execute(sql`
        select id, organization_id as "organizationId", type, entity_type as "entityType", entity_id as "entityId",
               actor_user_id as "actorUserId", payload, occurred_at as "occurredAt"
        from domain_events where id = ${eventId}`)) as unknown as { rows: DomainEventRow[] }
    ).rows[0];
    if (!found) throw new PermanentJobError(`Event ${eventId} no longer exists`);
    await def.handle(found);
  },
});
