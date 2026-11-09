import { PageHeader } from "@/components/ui";
import { JobActions } from "@/components/platform/job-actions";
import { Empty, Stat, Table, Td, utc } from "@/components/platform/bits";
import { getJobStats, listProblemJobs } from "@/server/modules/platform-admin/jobs.service";

export const metadata = { title: "Background jobs" };
export const dynamic = "force-dynamic";

function lag(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}

export default async function JobsPage() {
  const [s, problems] = await Promise.all([getJobStats(), listProblemJobs()]);
  const stalled = s.lagSeconds > 120;
  return (
    <div className="space-y-5">
      <PageHeader title="Background jobs" description="Event dispatch, email retries, notifications and housekeeping. Live numbers from the queue." />
      {stalled && (
        <p role="status" className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-fg">
          Work has been waiting {lag(s.lagSeconds)}. The background worker is probably not running. Start the server normally (it runs the worker), or, on a host without a long-running process, schedule a call to the drain endpoint.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Waiting" value={s.queued} />
        <Stat label="Running" value={s.running} />
        <Stat label="Failing, will retry" value={s.retrying} tone={s.retrying ? "warning" : undefined} />
        <Stat label="Dead (needs a person)" value={s.dead} hint={`${s.deadLast24h} in the last 24 hours`} tone={s.dead ? "danger" : undefined} />
        <Stat label="Events not yet dispatched" value={s.pendingEvents} />
        <Stat label="Oldest waiting job" value={s.queued + s.retrying === 0 ? "—" : lag(s.lagSeconds)} />
        <Stat label="Succeeded (retained 7 days)" value={s.succeeded} />
        <Stat label="Last success" value={s.lastSucceededAt ? utc(s.lastSucceededAt, true) : "—"} />
      </div>
      <Table
        head={["Kind", "Company", "Status", "Attempts", "Last error", "Next run", ""]}
        empty={problems.length === 0 ? <Empty title="Nothing needs attention" body="Jobs that fail are retried automatically with growing delays; after the last attempt they appear here as dead." /> : undefined}
      >
        {problems.map((j) => (
          <tr key={j.id}>
            <Td><code className="text-xs">{j.kind}</code></Td>
            <Td>{j.company ?? "Platform"}</Td>
            <Td>{j.status === "dead" ? "Dead" : "Retrying"}</Td>
            <Td className="tabular-nums">{j.attempts} / {j.maxAttempts}</Td>
            <Td className="max-w-md break-words text-xs">{j.lastError ?? "—"}</Td>
            <Td className="whitespace-nowrap">{j.status === "dead" ? "—" : utc(j.runAt, true)}</Td>
            <Td><JobActions id={j.id} status={j.status} /></Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
