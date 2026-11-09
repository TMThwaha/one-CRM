import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDatabase, type Database } from "@/server/db/client";

/**
 * A Postgres-backed job queue.
 *
 *  - enqueue():     idempotent (same key = same job); used from the owning connection. Tenant code never
 *                   enqueues directly: it emits a domain event inside its own transaction instead.
 *  - runDueJobs():  claims with FOR UPDATE SKIP LOCKED, so many workers can run at once without
 *                   double-running a job; retries with exponential backoff; dead-letters after maxAttempts.
 *  - Crash safety:  a job left "running" past its lease is claimed again (and dead-lettered if it keeps
 *                   killing its worker).
 *
 * Delivery is at-least-once: handlers must be idempotent (use the job id or an idempotency key).
 */

/** Throw this from a handler when retrying cannot help (bad payload, record gone): straight to dead. */
export class PermanentJobError extends Error {
  readonly permanent = true;
}

export interface JobContext {
  jobId: string;
  attempt: number;
  maxAttempts: number;
  organizationId: string | null;
}

export interface JobDefinition<P = Record<string, unknown>> {
  kind: string;
  handler: (payload: P, ctx: JobContext) => Promise<unknown>;
  maxAttempts?: number;
  timeoutMs?: number;
  /** Clear the payload once the job is finished (it may hold something sensitive, e.g. an email body). */
  scrubPayload?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const registry = new Map<string, JobDefinition<any>>();
export function defineJob<P = Record<string, unknown>>(def: JobDefinition<P>) {
  registry.set(def.kind, def);
}
export const registeredJobKinds = () => [...registry.keys()].sort();

type Exec = Pick<Database, "execute">;
type Rows<T> = { rows: T[] };
const rows = <T>(r: unknown) => (r as Rows<T>).rows;

export interface EnqueueOptions {
  organizationId?: string | null;
  runAt?: Date;
  maxAttempts?: number;
  priority?: number;
  /** Enqueueing the same key again returns the existing job instead of creating a second. */
  idempotencyKey?: string;
}

export async function enqueue(exec: Exec, kind: string, payload: Record<string, unknown> = {}, opts: EnqueueOptions = {}): Promise<{ id: string; created: boolean }> {
  const maxAttempts = opts.maxAttempts ?? registry.get(kind)?.maxAttempts ?? 5;
  const key = opts.idempotencyKey ?? null;
  const inserted = rows<{ id: string }>(
    await exec.execute(sql`
      insert into jobs (organization_id, kind, payload, max_attempts, priority, run_at, idempotency_key)
      values (${opts.organizationId ?? null}::uuid, ${kind}, ${JSON.stringify(payload)}::jsonb, ${maxAttempts}, ${opts.priority ?? 0},
              ${(opts.runAt ?? new Date()).toISOString()}::timestamptz, ${key})
      on conflict (idempotency_key) where idempotency_key is not null do nothing
      returning id`),
  );
  if (inserted[0]) return { id: inserted[0].id, created: true };
  const existing = rows<{ id: string }>(await exec.execute(sql`select id from jobs where idempotency_key = ${key}`));
  return { id: existing[0].id, created: false };
}

/** 30s, 1m, 2m, 4m … capped at 1h, with ±20% jitter so a recovering service is not hit all at once. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 3_600_000);
  return Math.round(base * (0.8 + random() * 0.4));
}

const LEASE_MS = 5 * 60_000;
const DEFAULT_TIMEOUT_MS = 30_000;

interface Claimed {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  organization_id: string | null;
}

export interface RunSummary {
  claimed: number;
  succeeded: number;
  retried: number;
  dead: number;
}

export interface RunOptions {
  limit?: number;
  /** Injectable clock, so tests can move through backoff delays without waiting. */
  now?: Date;
  workerId?: string;
}

export async function runDueJobs(opts: RunOptions = {}): Promise<RunSummary> {
  const { db } = await getDatabase();
  const now = opts.now ?? new Date();
  const workerId = opts.workerId ?? `worker-${randomUUID().slice(0, 8)}`;
  const limit = opts.limit ?? 4;
  const nowIso = now.toISOString();
  const cutoffIso = new Date(now.getTime() - LEASE_MS).toISOString();

  // A job whose worker keeps dying must not loop forever: dead-letter it instead of re-claiming.
  await db.execute(sql`
    update jobs set status = 'dead', finished_at = ${nowIso}::timestamptz, locked_at = null, locked_by = null,
           last_error = 'Worker stopped before finishing, too many times', updated_at = ${nowIso}::timestamptz
    where status = 'running' and locked_at < ${cutoffIso}::timestamptz and attempts >= max_attempts`);

  const claimed = rows<Claimed>(
    await db.execute(sql`
      update jobs set status = 'running', locked_at = ${nowIso}::timestamptz, locked_by = ${workerId},
             attempts = attempts + 1, updated_at = ${nowIso}::timestamptz
      where id in (
        select id from jobs
        where (status = 'queued' and run_at <= ${nowIso}::timestamptz)
           or (status = 'running' and locked_at < ${cutoffIso}::timestamptz)
        order by priority desc, run_at asc
        limit ${limit}
        for update skip locked)
      returning id, kind, payload, attempts, max_attempts, organization_id`),
  );

  const summary: RunSummary = { claimed: claimed.length, succeeded: 0, retried: 0, dead: 0 };
  await Promise.all(
    claimed.map(async (job) => {
      const outcome = await runOne(db, job, workerId, now);
      summary[outcome]++;
    }),
  );
  return summary;
}

async function runOne(db: Database, job: Claimed, workerId: string, now: Date): Promise<"succeeded" | "retried" | "dead"> {
  const def = registry.get(job.kind);
  const nowIso = now.toISOString();
  const fail = async (message: string, permanent: boolean): Promise<"retried" | "dead"> => {
    const dead = permanent || job.attempts >= job.max_attempts;
    const runAtIso = new Date(now.getTime() + backoffMs(job.attempts)).toISOString();
    const scrub = dead && def?.scrubPayload;
    await db.execute(sql`
      update jobs set status = ${dead ? "dead" : "queued"}, last_error = ${message.slice(0, 2000)},
             run_at = ${dead ? sql`run_at` : sql`${runAtIso}::timestamptz`},
             finished_at = ${dead ? sql`${nowIso}::timestamptz` : sql`null`},
             payload = ${scrub ? sql`'{}'::jsonb` : sql`payload`},
             locked_at = null, locked_by = null, updated_at = ${nowIso}::timestamptz
      where id = ${job.id} and status = 'running' and locked_by = ${workerId}`);
    return dead ? "dead" : "retried";
  };

  if (!def) return fail(`No handler is registered for job kind "${job.kind}"`, true);

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutMs = def.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const result = await Promise.race([
      def.handler(job.payload, { jobId: job.id, attempt: job.attempts, maxAttempts: job.max_attempts, organizationId: job.organization_id }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs} ms`)), timeoutMs);
      }),
    ]);
    await db.execute(sql`
      update jobs set status = 'succeeded', finished_at = ${nowIso}::timestamptz, last_error = null,
             result = ${result === undefined ? sql`null` : sql`${JSON.stringify(result)}::jsonb`},
             payload = ${def.scrubPayload ? sql`'{}'::jsonb` : sql`payload`},
             locked_at = null, locked_by = null, updated_at = ${nowIso}::timestamptz
      where id = ${job.id} and status = 'running' and locked_by = ${workerId}`);
    return "succeeded";
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return fail(message, e instanceof PermanentJobError);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
