/**
 * Runs once when the Next.js server starts (Node.js runtime only). Starts the background worker that
 * dispatches domain events and runs queued jobs. register() must not block start-up, so the worker
 * schedules itself with timers and returns immediately.
 *
 * On hosts that cannot keep a process running (serverless), set JOBS_WORKER=off and call
 * POST /api/internal/jobs/drain from a scheduler instead (see docs/KNOWN_LIMITATIONS.md).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startWorker } = await import("@/server/jobs/worker");
  startWorker();
}
