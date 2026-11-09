import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { DatabaseHandle } from "@/server/db/client";
import { withTenant } from "@/server/db/tenant";
import { PermanentJobError, backoffMs, defineJob, enqueue, registeredJobKinds, runDueJobs } from "@/server/jobs/queue";
import { enqueueDueSchedules, registeredSchedules } from "@/server/jobs/scheduler";
import { drain, tick } from "@/server/jobs/worker";
import { signUpOrg, startTestDatabase, type Rows } from "./support/harness";

let handle: DatabaseHandle;
const q = async (query: string) => ((await handle.db.execute(sql.raw(query))) as unknown as Rows).rows;
const job = async (id: string) => (await q(`select * from jobs where id = '${id}'`))[0];
const hours = (n: number, from = new Date()) => new Date(from.getTime() + n * 3_600_000);

beforeAll(async () => {
  handle = await startTestDatabase();
});
afterAll(async () => {
  await handle.close();
});

describe("running jobs", () => {
  it("runs a due job once, records its result and does not run it again", async () => {
    let runs = 0;
    defineJob({ kind: "test.ok", handler: async () => { runs++; return { n: 1 }; } });
    const { id } = await enqueue(handle.db, "test.ok", { a: 1 });
    expect((await runDueJobs()).succeeded).toBe(1);
    expect(await job(id)).toMatchObject({ status: "succeeded", attempts: 1, result: { n: 1 }, last_error: null });
    expect((await job(id)).finished_at).toBeTruthy();
    expect((await runDueJobs()).claimed).toBe(0);
    expect(runs).toBe(1);
  });

  it("does not run a job before its time", async () => {
    defineJob({ kind: "test.later", handler: async () => undefined });
    const { id } = await enqueue(handle.db, "test.later", {}, { runAt: hours(1) });
    expect((await runDueJobs()).claimed).toBe(0);
    expect((await runDueJobs({ now: hours(2) })).succeeded).toBe(1);
    expect((await job(id)).status).toBe("succeeded");
  });

  it("retries with growing delays, then succeeds", async () => {
    let calls = 0;
    defineJob({ kind: "test.flaky", maxAttempts: 5, handler: async () => { if (++calls < 3) throw new Error(`boom ${calls}`); return "fine"; } });
    const start = new Date();
    const { id } = await enqueue(handle.db, "test.flaky");

    expect((await runDueJobs({ now: start })).retried).toBe(1);
    let row = await job(id);
    expect(row).toMatchObject({ status: "queued", attempts: 1, last_error: "boom 1" });
    const delay1 = new Date(row.run_at).getTime() - start.getTime();
    expect(delay1).toBeGreaterThanOrEqual(24_000);
    expect(delay1).toBeLessThanOrEqual(36_000); // 30s ± 20% jitter
    expect((await runDueJobs({ now: new Date(start.getTime() + 5_000) })).claimed).toBe(0); // still backing off

    const t2 = hours(1, start);
    expect((await runDueJobs({ now: t2 })).retried).toBe(1);
    row = await job(id);
    const delay2 = new Date(row.run_at).getTime() - t2.getTime();
    expect(delay2).toBeGreaterThanOrEqual(48_000);
    expect(delay2).toBeLessThanOrEqual(72_000); // 60s ± 20%: it doubled

    expect((await runDueJobs({ now: hours(2, start) })).succeeded).toBe(1);
    expect(await job(id)).toMatchObject({ status: "succeeded", attempts: 3, last_error: null });
  });

  it("dead-letters after the last attempt and keeps the reason", async () => {
    defineJob({ kind: "test.doomed", maxAttempts: 2, handler: async () => { throw new Error("always fails"); } });
    const { id } = await enqueue(handle.db, "test.doomed");
    await runDueJobs();
    expect((await job(id)).status).toBe("queued");
    await runDueJobs({ now: hours(1) });
    expect(await job(id)).toMatchObject({ status: "dead", attempts: 2, last_error: "always fails" });
    expect((await job(id)).finished_at).toBeTruthy();
    expect((await runDueJobs({ now: hours(9) })).claimed).toBe(0); // dead means dead
  });

  it("a PermanentJobError skips the retries", async () => {
    defineJob({ kind: "test.permanent", maxAttempts: 5, handler: async () => { throw new PermanentJobError("record is gone"); } });
    const { id } = await enqueue(handle.db, "test.permanent");
    await runDueJobs();
    expect(await job(id)).toMatchObject({ status: "dead", attempts: 1, last_error: "record is gone" });
  });

  it("an unknown kind is dead-lettered with a clear message, not looped forever", async () => {
    const { id } = await enqueue(handle.db, "test.nobody_handles_this");
    await runDueJobs();
    expect(await job(id)).toMatchObject({ status: "dead" });
    expect((await job(id)).last_error).toContain("No handler is registered");
  });

  it("a handler that hangs is timed out and retried", async () => {
    defineJob({ kind: "test.hang", timeoutMs: 40, maxAttempts: 3, handler: () => new Promise(() => {}) });
    const { id } = await enqueue(handle.db, "test.hang");
    expect((await runDueJobs()).retried).toBe(1);
    expect((await job(id)).last_error).toMatch(/Timed out after 40 ms/);
  });

  it("can wipe a sensitive payload once finished", async () => {
    defineJob({ kind: "test.scrub", scrubPayload: true, handler: async () => undefined });
    const { id } = await enqueue(handle.db, "test.scrub", { secret: "one-time-link" });
    expect((await job(id)).payload).toEqual({ secret: "one-time-link" });
    await runDueJobs();
    expect((await job(id)).payload).toEqual({});
  });
});

describe("enqueueing", () => {
  it("is idempotent: the same key is the same job", async () => {
    const a = await enqueue(handle.db, "test.ok", {}, { idempotencyKey: "once-only" });
    const b = await enqueue(handle.db, "test.ok", {}, { idempotencyKey: "once-only" });
    expect(a.created).toBe(true);
    expect(b).toEqual({ id: a.id, created: false });
    expect((await q(`select count(*)::int as n from jobs where idempotency_key = 'once-only'`))[0].n).toBe(1);
  });

  it("is atomic with the surrounding transaction: a rollback leaves no job", async () => {
    await expect(
      handle.db.transaction(async (tx) => {
        await enqueue(tx, "test.ok", {}, { idempotencyKey: "rolled-back" });
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect((await q(`select count(*)::int as n from jobs where idempotency_key = 'rolled-back'`))[0].n).toBe(0);
  });
});

describe("crash recovery", () => {
  it("claims a job whose worker died, and dead-letters one that keeps killing its worker", async () => {
    let runs = 0;
    defineJob({ kind: "test.orphan", maxAttempts: 3, handler: async () => { runs++; } });
    const stuck = (await enqueue(handle.db, "test.orphan")).id;
    const poison = (await enqueue(handle.db, "test.orphan")).id;
    // Simulate two crashed workers: both left "running" ten minutes ago.
    await handle.db.execute(sql`update jobs set status = 'running', attempts = 1, locked_by = 'dead-worker', locked_at = now() - interval '10 minutes' where id = ${stuck}`);
    await handle.db.execute(sql`update jobs set status = 'running', attempts = 3, locked_by = 'dead-worker', locked_at = now() - interval '10 minutes' where id = ${poison}`);

    await runDueJobs();
    expect(await job(stuck)).toMatchObject({ status: "succeeded", attempts: 2 });
    expect(await job(poison)).toMatchObject({ status: "dead" });
    expect((await job(poison)).last_error).toContain("Worker stopped");
    expect(runs).toBe(1); // the poisoned job was never run again
  });

  it("does not steal a job that is genuinely still running", async () => {
    defineJob({ kind: "test.busy", handler: async () => undefined });
    const { id } = await enqueue(handle.db, "test.busy");
    await handle.db.execute(sql`update jobs set status = 'running', attempts = 1, locked_by = 'live-worker', locked_at = now() where id = ${id}`);
    expect((await runDueJobs()).claimed).toBe(0);
  });
});

describe("backoff", () => {
  it("grows exponentially and is capped at an hour", () => {
    const mid = () => 0.5; // no jitter
    expect([1, 2, 3, 4].map((a) => backoffMs(a, mid))).toEqual([30_000, 60_000, 120_000, 240_000]);
    expect(backoffMs(30, mid)).toBe(3_600_000);
    expect(backoffMs(30, () => 1)).toBeLessThanOrEqual(3_600_000 * 1.2);
  });
});

describe("schedules and housekeeping", () => {
  it("every registered schedule is enqueued once per time slot, however many workers ask", async () => {
    expect(registeredSchedules().map((s) => s.name)).toContain("housekeeping");
    const now = new Date("2030-01-01T10:15:00Z");
    const first = await enqueueDueSchedules(now);
    const second = await enqueueDueSchedules(now);
    const later = await enqueueDueSchedules(new Date("2030-01-01T11:15:00Z")); // the next hourly slot
    expect(first).toBe(registeredSchedules().length);
    expect(second).toBe(0);
    expect(later).toBe(registeredSchedules().length);
  });

  it("housekeeping removes only what is old and keeps what is fresh", async () => {
    const o = await signUpOrg("Housekeeping");
    const uid = o.ctx.userId;
    await handle.db.execute(sql`insert into rate_limit_hits (key, hit_at) values ('hk:old', now() - interval '3 days'), ('hk:new', now())`);
    await handle.db.execute(sql`insert into email_tokens (user_id, purpose, token_hash, expires_at) values
      (${uid}, 'reset_password', 'hk-old-token', now() - interval '20 days'), (${uid}, 'reset_password', 'hk-new-token', now() + interval '1 hour')`);
    await handle.db.execute(sql`insert into sessions (user_id, token_hash, expires_at, revoked_at) values
      (${uid}, 'hk-old-session', now() - interval '60 days', now() - interval '60 days'), (${uid}, 'hk-new-session', now() + interval '1 day', null)`);
    await handle.db.execute(sql`insert into jobs (kind, status, finished_at) values
      ('hk.old', 'succeeded', now() - interval '10 days'), ('hk.new', 'succeeded', now()), ('hk.olddead', 'dead', now() - interval '40 days'), ('hk.newdead', 'dead', now() - interval '2 days')`);
    await handle.db.execute(sql`insert into domain_events (organization_id, type, entity_type, dispatched_at) values
      (${o.ctx.organizationId}, 'hk.old', 'x', now() - interval '60 days'), (${o.ctx.organizationId}, 'hk.new', 'x', now() - interval '1 day'), (${o.ctx.organizationId}, 'hk.pending', 'x', null)`);

    const { id } = await enqueue(handle.db, "housekeeping.purge");
    await runDueJobs();
    // (Earlier tests left scheduled housekeeping jobs queued; whichever ran first did the purge.)
    expect((await job(id)).status).toBe("succeeded");

    const left = async (table: string, col: string, ...vals: string[]) =>
      (await q(`select ${col} from ${table} where ${col} in (${vals.map((v) => `'${v}'`).join(",")}) order by ${col}`)).map((r) => r[col]);
    expect(await left("rate_limit_hits", "key", "hk:old", "hk:new")).toEqual(["hk:new"]);
    expect(await left("email_tokens", "token_hash", "hk-old-token", "hk-new-token")).toEqual(["hk-new-token"]);
    expect(await left("sessions", "token_hash", "hk-old-session", "hk-new-session")).toEqual(["hk-new-session"]);
    expect(await left("jobs", "kind", "hk.old", "hk.new", "hk.olddead", "hk.newdead")).toEqual(["hk.new", "hk.newdead"]);
    expect(await left("domain_events", "type", "hk.old", "hk.new", "hk.pending")).toEqual(["hk.new", "hk.pending"]); // never purges undelivered events
  });
});

describe("isolation and the worker entry points", () => {
  it("company code cannot read or write the queue at all", async () => {
    const o = await signUpOrg("QueueGuard");
    await expect(withTenant(o.ctx, (tx) => tx.execute(sql`select * from jobs`))).rejects.toThrow();
    await expect(withTenant(o.ctx, (tx) => tx.execute(sql`insert into jobs (kind) values ('x')`))).rejects.toThrow();
  });

  it("the built-in job kinds are registered", () => {
    expect(registeredJobKinds()).toEqual(expect.arrayContaining(["event.handle", "email.send", "housekeeping.purge"]));
  });

  it("drain() works through everything that is due and reports it finished", async () => {
    defineJob({ kind: "test.drain", handler: async () => undefined });
    for (let i = 0; i < 6; i++) await enqueue(handle.db, "test.drain");
    const r = await drain({ maxMs: 5_000 });
    expect(r.finished).toBe(true);
    expect(r.ran).toBeGreaterThanOrEqual(6);
    expect((await q(`select count(*)::int as n from jobs where kind = 'test.drain' and status <> 'succeeded'`))[0].n).toBe(0);
    expect((await tick()).run.claimed).toBe(0);
  });
});
