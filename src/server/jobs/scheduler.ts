import "server-only";
import { getDatabase } from "@/server/db/client";
import { enqueue } from "./queue";

/**
 * Recurring work. Each schedule enqueues one job per time slot, with an idempotency key built from the
 * slot, so any number of workers can call this at once and the job is still created exactly once.
 */
export interface ScheduleDefinition {
  name: string;
  everyMs: number;
  kind: string;
  payload?: Record<string, unknown>;
}

const schedules = new Map<string, ScheduleDefinition>();
export function defineSchedule(def: ScheduleDefinition) {
  schedules.set(def.name, def);
}
export const registeredSchedules = () => [...schedules.values()];

export async function enqueueDueSchedules(now: Date = new Date()): Promise<number> {
  const { db } = await getDatabase();
  let created = 0;
  for (const s of schedules.values()) {
    const slot = Math.floor(now.getTime() / s.everyMs);
    const r = await enqueue(db, s.kind, s.payload ?? {}, { idempotencyKey: `sched:${s.name}:${slot}` });
    if (r.created) created++;
  }
  return created;
}
