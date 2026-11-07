import "server-only";
import { sql } from "drizzle-orm";
import { getDatabase } from "@/server/db/client";
import { rateLimited } from "./errors";

/**
 * Sliding-window limiter stored in PostgreSQL, so every app instance shares the same counters
 * and restarts do not reset them. Check-and-insert is a single statement; under heavy
 * concurrency a few extra hits may slip through (acceptable for brute-force throttling).
 * Fails OPEN on database errors for availability, but logs loudly.
 */
export async function enforceRateLimit(key: string, limit: number, windowMs: number): Promise<void> {
  const { db } = await getDatabase();
  const windowSeconds = Math.ceil(windowMs / 1000);
  let allowed = true;
  try {
    const res = await db.execute(sql`
      with c as (
        select count(*)::int as n from rate_limit_hits
        where key = ${key} and hit_at > now() - make_interval(secs => ${windowSeconds})
      )
      insert into rate_limit_hits (key)
      select ${key} from c where c.n < ${limit}
      returning id
    `);
    allowed = ((res as unknown as { rows: unknown[] }).rows?.length ?? 0) > 0;
    // Opportunistic cleanup keeps the table small.
    if (Math.random() < 0.02) {
      await db.execute(sql`delete from rate_limit_hits where hit_at < now() - interval '1 day'`);
    }
  } catch (e) {
    console.error("[rate-limit] database error; failing open", e);
    return;
  }
  if (!allowed) throw rateLimited();
}

export async function resetRateLimits(): Promise<void> {
  const { db } = await getDatabase();
  await db.execute(sql`delete from rate_limit_hits`);
}
