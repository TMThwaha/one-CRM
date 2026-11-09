import "server-only";
import { getConfig } from "@/server/platform/config";
import { dispatchEvents } from "./events";
import { runDueJobs, type RunSummary } from "./queue";
import { enqueueDueSchedules } from "./scheduler";
import "./handlers"; // registers every job kind and event handler

export interface TickResult {
  schedules: number;
  events: number;
  handlerJobs: number;
  run: RunSummary;
}

/** One pass: due schedules -> pending events -> due jobs. Tests call this directly with an injected clock. */
export async function tick(opts: { now?: Date; limit?: number } = {}): Promise<TickResult> {
  const schedules = await enqueueDueSchedules(opts.now);
  const dispatched = await dispatchEvents();
  const run = await runDueJobs({ now: opts.now, limit: opts.limit ?? getConfig().JOBS_CONCURRENCY });
  return { schedules, events: dispatched.events, handlerJobs: dispatched.jobs, run };
}

/** Runs ticks until there is nothing left to do (or the time budget runs out). For cron-driven hosts. */
export async function drain(opts: { maxMs?: number } = {}): Promise<{ ticks: number; ran: number; finished: boolean }> {
  const deadline = Date.now() + (opts.maxMs ?? 20_000);
  let ticks = 0;
  let ran = 0;
  while (Date.now() < deadline) {
    const r = await tick();
    ticks++;
    ran += r.run.claimed;
    if (r.run.claimed === 0 && r.events === 0) return { ticks, ran, finished: true };
  }
  return { ticks, ran, finished: false };
}

interface WorkerHandle {
  stop: () => void;
}
const g = globalThis as unknown as { __onecrmWorker?: WorkerHandle };

/**
 * Starts the polling loop inside this server process. Idempotent (also across hot reloads in
 * development). Several instances can run at once: claiming uses SKIP LOCKED. Never throws, and backs
 * off when the database is unavailable instead of spamming the log.
 */
export function startWorker(): WorkerHandle | null {
  const cfg = getConfig();
  if (cfg.JOBS_WORKER === "off") return null;
  if (g.__onecrmWorker) return g.__onecrmWorker;

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;

  const loop = async () => {
    try {
      await tick();
      failures = 0;
    } catch (e) {
      failures++;
      if (failures === 1 || failures % 10 === 0) console.error(`[jobs] worker tick failed (${failures} in a row)`, e instanceof Error ? e.message : e);
    }
    if (stopped) return;
    const delay = Math.min(cfg.JOBS_POLL_MS * 2 ** Math.min(failures, 5), 60_000);
    timer = setTimeout(loop, delay);
    timer.unref?.(); // never keeps the process alive on its own
  };

  timer = setTimeout(loop, cfg.JOBS_POLL_MS);
  timer.unref?.();
  const handle: WorkerHandle = {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      g.__onecrmWorker = undefined;
    },
  };
  g.__onecrmWorker = handle;
  console.log(`[jobs] worker started (poll ${cfg.JOBS_POLL_MS} ms, concurrency ${cfg.JOBS_CONCURRENCY})`);
  return handle;
}
