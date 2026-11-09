import "server-only";
import { sql } from "drizzle-orm";
import { getDatabase } from "@/server/db/client";
import { defineJob } from "../queue";
import { defineSchedule } from "../scheduler";

/**
 * Keeps operational tables from growing without bound. Retention is deliberately generous: nothing here
 * is the system of record (audit logs and authentication events are NOT touched).
 */
defineJob({
  kind: "housekeeping.purge",
  maxAttempts: 3,
  timeoutMs: 60_000,
  handler: async () => {
    const { db } = await getDatabase();
    const count = async (q: ReturnType<typeof sql>) => {
      const r = (await db.execute(q)) as unknown as { rows: { n: number }[] };
      return r.rows[0].n;
    };
    return {
      rateLimitHits: await count(sql`with d as (delete from rate_limit_hits where hit_at < now() - interval '1 day' returning 1) select count(*)::int as n from d`),
      emailTokens: await count(sql`with d as (delete from email_tokens where expires_at < now() - interval '7 days' or used_at < now() - interval '7 days' returning 1) select count(*)::int as n from d`),
      sessions: await count(sql`with d as (delete from sessions where expires_at < now() - interval '30 days' or revoked_at < now() - interval '30 days' returning 1) select count(*)::int as n from d`),
      finishedJobs: await count(sql`with d as (delete from jobs where (status = 'succeeded' and finished_at < now() - interval '7 days') or (status in ('dead','cancelled') and finished_at < now() - interval '30 days') returning 1) select count(*)::int as n from d`),
      dispatchedEvents: await count(sql`with d as (delete from domain_events where dispatched_at < now() - interval '30 days' returning 1) select count(*)::int as n from d`),
    };
  },
});

defineSchedule({ name: "housekeeping", everyMs: 60 * 60_000, kind: "housekeeping.purge" });
