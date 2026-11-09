import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { DatabaseHandle } from "@/server/db/client";
import { withTenant } from "@/server/db/tenant";
import { emit } from "@/server/jobs/emit";
import { defineEventHandler, dispatchEvents, handlerMatches } from "@/server/jobs/events";
import { runDueJobs } from "@/server/jobs/queue";
import { tick } from "@/server/jobs/worker";
import { createLead } from "@/server/modules/crm/leads.service";
import { listNotifications, markNotificationsRead } from "@/server/modules/platform/notifications.service";
import { createTask, updateTask } from "@/server/modules/workforce/tasks.service";
import { sendBestEffort, setMailerForTesting, type Email, type Mailer } from "@/server/platform/mailer";
import { addMember, signUpOrg, startTestDatabase, type Rows } from "./support/harness";

let handle: DatabaseHandle;
const q = async (query: string) => ((await handle.db.execute(sql.raw(query))) as unknown as Rows).rows;
const hours = (n: number) => new Date(Date.now() + n * 3_600_000);

beforeAll(async () => {
  handle = await startTestDatabase();
});
afterAll(async () => {
  setMailerForTesting(undefined);
  await handle.close();
});

describe("handler matching", () => {
  it("matches exact types, prefixes and the wildcard", () => {
    const h = (types: string[]) => ({ name: "x", types, handle: async () => {} });
    expect(handlerMatches(h(["task.assigned"]), "task.assigned")).toBe(true);
    expect(handlerMatches(h(["task.assigned"]), "task.created")).toBe(false);
    expect(handlerMatches(h(["task.*"]), "task.created")).toBe(true);
    expect(handlerMatches(h(["task.*"]), "taskforce.created")).toBe(false);
    expect(handlerMatches(h(["*"]), "anything.at.all")).toBe(true);
  });
});

describe("the outbox: events exist if and only if the change committed", () => {
  it("a rolled-back transaction publishes nothing; a committed one publishes", async () => {
    const o = await signUpOrg("Outbox");
    await expect(
      withTenant(o.ctx, async (tx) => {
        await emit(tx, o.ctx, { type: "contact.created", entityType: "contact" });
        throw new Error("the business change failed");
      }),
    ).rejects.toThrow("the business change failed");
    expect((await q(`select count(*)::int as n from domain_events where organization_id = '${o.ctx.organizationId}'`))[0].n).toBe(0);

    await createLead(o.ctx, { firstName: "Real" });
    const evs = await q(`select type, entity_type, actor_user_id from domain_events where organization_id = '${o.ctx.organizationId}'`);
    expect(evs).toEqual([{ type: "lead.created", entity_type: "lead", actor_user_id: o.ctx.userId }]);
  });

  it("a company can only see and publish its own events", async () => {
    const a = await signUpOrg("EventsA");
    const b = await signUpOrg("EventsB");
    await createLead(a.ctx, { firstName: "A-lead" });
    const seen = await withTenant(b.ctx, (tx) => tx.execute(sql`select organization_id from domain_events`));
    expect((seen as unknown as Rows).rows.every((r) => r.organization_id === b.ctx.organizationId)).toBe(true);
    await expect(
      withTenant(b.ctx, (tx) => tx.execute(sql`insert into domain_events (organization_id, type, entity_type) values (${a.ctx.organizationId}, 'forged', 'x')`)),
    ).rejects.toThrow();
    await expect(withTenant(a.ctx, (tx) => tx.execute(sql`update domain_events set type = 'tampered'`))).rejects.toThrow();
    await expect(withTenant(a.ctx, (tx) => tx.execute(sql`delete from domain_events`))).rejects.toThrow();
  });
});

describe("dispatching", () => {
  it("creates exactly one job per matching handler, even if dispatch runs again", async () => {
    const seen: string[] = [];
    defineEventHandler({ name: "test.tasks", types: ["task.*"], handle: async (e) => { seen.push(`tasks:${e.type}`); } });
    defineEventHandler({ name: "test.everything", types: ["*"], handle: async (e) => { seen.push(`all:${e.type}`); } });
    defineEventHandler({ name: "test.deals", types: ["deal.*"], handle: async () => { seen.push("deals"); } });
    await tick(); // flush anything left by earlier tests
    seen.length = 0;

    const o = await signUpOrg("Dispatch");
    await createTask(o.ctx, { title: "Plain task" });
    const first = await dispatchEvents();
    expect(first.events).toBe(1); // task.created
    expect(first.jobs).toBeGreaterThanOrEqual(2); // test.tasks + test.everything (+ built-ins that match)
    expect((await dispatchEvents()).events).toBe(0); // already dispatched

    // Force a redelivery of the SAME event: the idempotency keys stop any duplicate job.
    await handle.db.execute(sql`update domain_events set dispatched_at = null where organization_id = ${o.ctx.organizationId}`);
    expect((await dispatchEvents()).jobs).toBe(0);

    await runDueJobs({ limit: 20 });
    expect(seen.sort()).toEqual(["all:task.created", "tasks:task.created"]); // each once; deals handler never fired
  });

  it("an event nobody listens to is still marked dispatched", async () => {
    const o = await signUpOrg("NoListeners");
    await createLead(o.ctx, { firstName: "Quiet" });
    await tick();
    expect((await q(`select count(*)::int as n from domain_events where organization_id = '${o.ctx.organizationId}' and dispatched_at is null`))[0].n).toBe(0);
  });

  it("a failing handler is retried on its own and never blocks another handler", async () => {
    let good = 0;
    defineEventHandler({ name: "test.broken", types: ["lead.created"], handle: async () => { throw new Error("handler exploded"); } });
    defineEventHandler({ name: "test.fine", types: ["lead.created"], handle: async () => { good++; } });
    const o = await signUpOrg("Isolation");
    good = 0;
    await createLead(o.ctx, { firstName: "Trigger" });
    await tick();
    expect(good).toBe(1);
    const broken = (await q(`select status, attempts, last_error from jobs where kind = 'event.handle' and payload->>'handler' = 'test.broken' order by created_at desc limit 1`))[0];
    expect(broken).toMatchObject({ status: "queued", attempts: 1, last_error: "handler exploded" }); // waiting to retry, not lost
  });
});

describe("notifications (the first real consumer)", () => {
  let owner: Awaited<ReturnType<typeof signUpOrg>>;
  let bea: Awaited<ReturnType<typeof addMember>>;
  let cal: Awaited<ReturnType<typeof addMember>>;

  beforeAll(async () => {
    owner = await signUpOrg("Notify");
    bea = await addMember(owner.ctx, "Bea Assignee", "sales");
    cal = await addMember(owner.ctx, "Cal Bystander", "sales");
  });

  it("assigning a task notifies the assignee, and only the assignee", async () => {
    const task = await createTask(owner.ctx, { title: "Call the supplier", assigneeId: bea.ctx.userId });
    expect((await listNotifications(bea.ctx)).unread).toBe(0); // nothing until the worker runs
    await tick();

    const mine = await listNotifications(bea.ctx);
    expect(mine.unread).toBe(1);
    expect(mine.items[0]).toMatchObject({ type: "task.assigned", title: "Notify Owner assigned you a task", body: "Call the supplier", link: "/tasks", readAt: null });
    expect((await listNotifications(owner.ctx)).items).toHaveLength(0);
    expect((await listNotifications(cal.ctx)).items).toHaveLength(0);

    // Reassigning notifies the NEW assignee.
    await updateTask(owner.ctx, task.id, { assigneeId: cal.ctx.userId, version: task.version });
    await tick();
    expect((await listNotifications(cal.ctx)).unread).toBe(1);
    expect((await listNotifications(bea.ctx)).unread).toBe(1); // unchanged
  });

  it("assigning work to yourself is not news", async () => {
    const before = (await q(`select count(*)::int as n from notifications where organization_id = '${owner.ctx.organizationId}'`))[0].n;
    await createTask(owner.ctx, { title: "My own to-do" });
    await createTask(owner.ctx, { title: "Also mine", assigneeId: owner.ctx.userId });
    await tick();
    expect((await q(`select count(*)::int as n from notifications where organization_id = '${owner.ctx.organizationId}'`))[0].n).toBe(before);
  });

  it("marking read affects only your own notifications", async () => {
    const mine = (await listNotifications(bea.ctx)).items[0];
    // Cal tries to mark Bea's notification as read: row-level security hides it, so nothing happens.
    expect((await markNotificationsRead(cal.ctx, { ids: [mine.id] })).updated).toBe(0);
    expect((await listNotifications(bea.ctx)).unread).toBe(1);

    expect((await markNotificationsRead(bea.ctx, { ids: [mine.id] })).updated).toBe(1);
    expect((await listNotifications(bea.ctx)).unread).toBe(0);
    expect((await markNotificationsRead(bea.ctx, { all: true })).updated).toBe(0); // idempotent
    await expect(markNotificationsRead(bea.ctx, { ids: ["not-a-uuid"] })).rejects.toThrow();
  });

  it("is private: not even a colleague in the same company, nor another company, can read it", async () => {
    const stranger = await signUpOrg("Stranger");
    const bId = bea.ctx.userId;
    for (const who of [cal.ctx, stranger.ctx, owner.ctx]) {
      const rows = await withTenant(who, (tx) => tx.execute(sql`select id from notifications where user_id = ${bId}`));
      expect((rows as unknown as Rows).rows, who.userEmail).toHaveLength(0);
    }
  });

  it("company code cannot create, edit or delete notifications, only mark its own read", async () => {
    await expect(withTenant(bea.ctx, (tx) => tx.execute(sql`insert into notifications (organization_id, user_id, type, title) values (${owner.ctx.organizationId}, ${bea.ctx.userId}, 'x', 'forged')`))).rejects.toThrow();
    await expect(withTenant(bea.ctx, (tx) => tx.execute(sql`update notifications set title = 'rewritten'`))).rejects.toThrow();
    await expect(withTenant(bea.ctx, (tx) => tx.execute(sql`delete from notifications`))).rejects.toThrow();
  });

  it("a redelivered event cannot notify twice", async () => {
    const t = await createTask(owner.ctx, { title: "Only once please", assigneeId: bea.ctx.userId });
    await tick();
    const count = async () => (await q(`select count(*)::int as n from notifications where entity_id = '${t.id}'`))[0].n;
    expect(await count()).toBe(1);
    // Re-run the very same handler job: the (event, person) uniqueness absorbs it.
    await handle.db.execute(sql`update jobs set status = 'queued', attempts = 0, run_at = now(), finished_at = null where kind = 'event.handle' and payload->>'handler' = 'notifications.task_assigned' and organization_id = ${owner.ctx.organizationId}`);
    await tick();
    expect(await count()).toBe(1);
  });
});

describe("email survives a provider outage", () => {
  const outbox: Email[] = [];
  let failing = true;
  const flaky: Mailer = {
    kind: "smtp",
    send: async (e) => {
      if (failing) throw new Error("smtp is down");
      outbox.push(e);
    },
  };
  beforeEach(() => {
    outbox.length = 0;
    failing = true;
    setMailerForTesting(flaky);
  });

  it("queues a retry, stores the body encrypted, delivers once the provider recovers, then wipes it", async () => {
    const link = "https://app.example.test/reset-password/SUPER-SECRET-TOKEN";
    const delivered = await sendBestEffort({ to: "person@example.test", subject: "Reset", text: `Use ${link}` });
    expect(delivered).toBe(false); // not delivered NOW
    const queued = (await q(`select id, status, payload from jobs where kind = 'email.send' and payload->>'to' = 'person@example.test'`))[0];
    expect(queued.status).toBe("queued");
    expect(JSON.stringify(queued.payload)).not.toContain("SUPER-SECRET-TOKEN"); // never stored in clear
    expect(queued.payload.textEnc).toMatch(/^v1\./);

    await tick({ now: hours(1) }); // provider still down
    expect(outbox).toHaveLength(0);
    expect((await q(`select attempts, last_error from jobs where id = '${queued.id}'`))[0]).toMatchObject({ attempts: 1, last_error: "smtp is down" });

    failing = false; // provider recovers
    await tick({ now: hours(3) });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ to: "person@example.test", subject: "Reset" });
    expect(outbox[0].text).toContain("SUPER-SECRET-TOKEN"); // decrypted for sending
    expect((await q(`select status, payload from jobs where id = '${queued.id}'`))[0]).toEqual({ status: "succeeded", payload: {} }); // wiped
    await tick({ now: hours(9) });
    expect(outbox).toHaveLength(1); // never sent twice
  });

  it("wipes the body from a message that never got through", async () => {
    await sendBestEffort({ to: "gone@example.test", subject: "Lost", text: "token-that-never-arrived" });
    const id = (await q(`select id from jobs where kind = 'email.send' and payload->>'to' = 'gone@example.test'`))[0].id;
    for (let i = 1; i <= 9; i++) await tick({ now: hours(i * 2) });
    expect((await q(`select status, attempts, payload from jobs where id = '${id}'`))[0]).toEqual({ status: "dead", attempts: 8, payload: {} });
  });

  it("does not queue anything when mail is simply not configured", async () => {
    setMailerForTesting({ kind: "log-only", send: async () => {} });
    const before = (await q(`select count(*)::int as n from jobs where kind = 'email.send'`))[0].n;
    expect(await sendBestEffort({ to: "nobody@example.test", subject: "x", text: "y" })).toBe(false);
    expect((await q(`select count(*)::int as n from jobs where kind = 'email.send'`))[0].n).toBe(before);
  });
});
