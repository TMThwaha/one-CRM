import "server-only";
import { sql } from "drizzle-orm";
import { getDatabase } from "@/server/db/client";
import { conflict, notFound } from "@/server/platform/errors";
import { platformAudit } from "./audit";
import type { PlatformContext } from "./context";

type Rows<T> = { rows: T[] };
const rows = <T>(r: unknown) => (r as Rows<T>).rows;

export interface JobStats {
  queued: number;
  running: number;
  retrying: number;
  dead: number;
  succeeded: number;
  pendingEvents: number;
  /** How long the oldest runnable job has been waiting. Large and growing means no worker is running. */
  lagSeconds: number;
  lastSucceededAt: Date | null;
  deadLast24h: number;
}

/** Live numbers from the queue tables. */
export async function getJobStats(): Promise<JobStats> {
  const { db } = await getDatabase();
  const r = rows<Record<string, string | number | Date | null>>(
    await db.execute(sql`
      select
        count(*) filter (where status = 'queued' and attempts = 0)::int as queued,
        count(*) filter (where status = 'running')::int as running,
        count(*) filter (where status = 'queued' and attempts > 0)::int as retrying,
        count(*) filter (where status = 'dead')::int as dead,
        count(*) filter (where status = 'succeeded')::int as succeeded,
        count(*) filter (where status = 'dead' and finished_at > now() - interval '24 hours')::int as dead_24h,
        coalesce(extract(epoch from (now() - min(run_at) filter (where status = 'queued' and run_at <= now())))::int, 0) as lag,
        max(finished_at) filter (where status = 'succeeded') as last_ok
      from jobs`),
  )[0];
  const pending = rows<{ n: number }>(await db.execute(sql`select count(*)::int as n from domain_events where dispatched_at is null`))[0].n;
  return {
    queued: Number(r.queued),
    running: Number(r.running),
    retrying: Number(r.retrying),
    dead: Number(r.dead),
    succeeded: Number(r.succeeded),
    pendingEvents: pending,
    lagSeconds: Number(r.lag),
    lastSucceededAt: r.last_ok ? new Date(r.last_ok as string) : null,
    deadLast24h: Number(r.dead_24h),
  };
}

export interface ProblemJob {
  id: string;
  kind: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  runAt: Date;
  updatedAt: Date;
  company: string | null;
}

/** Jobs that need a human's eyes: dead-lettered, or failing and being retried. The payload is never shown. */
export async function listProblemJobs(limit = 50): Promise<ProblemJob[]> {
  const { db } = await getDatabase();
  const r = rows<{ id: string; kind: string; status: string; attempts: number; max_attempts: number; last_error: string | null; run_at: string; updated_at: string; company: string | null }>(
    await db.execute(sql`
      select j.id, j.kind, j.status, j.attempts, j.max_attempts, j.last_error, j.run_at, j.updated_at, o.name as company
      from jobs j left join organizations o on o.id = j.organization_id
      where j.status = 'dead' or (j.status = 'queued' and j.attempts > 0)
      order by j.updated_at desc
      limit ${limit}`),
  );
  return r.map((x) => ({
    id: x.id, kind: x.kind, status: x.status, attempts: x.attempts, maxAttempts: x.max_attempts, lastError: x.last_error,
    runAt: new Date(x.run_at), updatedAt: new Date(x.updated_at), company: x.company,
  }));
}

/** Puts a dead or cancelled job back on the queue with a fresh attempt budget. */
export async function retryJob(actor: PlatformContext, id: string) {
  const { db } = await getDatabase();
  return db.transaction(async (tx) => {
    const res = rows<{ id: string; kind: string; organization_id: string | null }>(
      await tx.execute(sql`
        update jobs set status = 'queued', attempts = 0, run_at = now(), finished_at = null, locked_at = null, locked_by = null, updated_at = now()
        where id = ${id} and status in ('dead','cancelled')
        returning id, kind, organization_id`),
    );
    if (!res[0]) {
      const exists = rows<{ status: string }>(await tx.execute(sql`select status from jobs where id = ${id}`))[0];
      if (!exists) throw notFound("Job");
      throw conflict(`Only dead or cancelled jobs can be retried (this one is ${exists.status})`);
    }
    await platformAudit(tx, actor, { action: "job.retried", entityType: "job", entityId: id, organizationId: res[0].organization_id, summary: `Retried ${res[0].kind} job` });
    return { id };
  });
}

/** Stops a job that has not started. A running job cannot be interrupted safely and is left alone. */
export async function cancelJob(actor: PlatformContext, id: string) {
  const { db } = await getDatabase();
  return db.transaction(async (tx) => {
    const res = rows<{ id: string; kind: string; organization_id: string | null }>(
      await tx.execute(sql`
        update jobs set status = 'cancelled', finished_at = now(), updated_at = now()
        where id = ${id} and status = 'queued'
        returning id, kind, organization_id`),
    );
    if (!res[0]) {
      const exists = rows<{ status: string }>(await tx.execute(sql`select status from jobs where id = ${id}`))[0];
      if (!exists) throw notFound("Job");
      throw conflict(`Only queued jobs can be cancelled (this one is ${exists.status})`);
    }
    await platformAudit(tx, actor, { action: "job.cancelled", entityType: "job", entityId: id, organizationId: res[0].organization_id, summary: `Cancelled ${res[0].kind} job` });
    return { id };
  });
}
