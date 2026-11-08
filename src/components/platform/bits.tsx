import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui";
import { getCountry } from "@/shared/countries";

/** Platform pages show absolute UTC times: unambiguous for an operator spanning many countries. */
export function utc(d: Date | string | null | undefined, withTime = false): string {
  if (!d) return "—";
  return (
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC", day: "numeric", month: "short", year: "numeric",
      ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    }).format(new Date(d)) + (withTime ? " UTC" : "")
  );
}

export const countryName = (code: string | null | undefined) => (code ? getCountry(code)?.name ?? code : "Not set");

const STATUS_TONE = { active: "success", suspended: "warning", deactivated: "neutral", archived: "neutral" } as const;
export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status as keyof typeof STATUS_TONE] ?? "neutral"}>{status.charAt(0).toUpperCase() + status.slice(1)}</Badge>;
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: "danger" | "warning" }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tracking-tight tabular-nums ${tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : ""}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-faint">{hint}</p>}
    </div>
  );
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="border-b border-border bg-surface-2 text-xs font-semibold text-muted">
          <tr>{head.map((h, i) => <th key={i} scope="col" className="px-3 py-2.5 whitespace-nowrap">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
      {empty}
    </div>
  );
}
export const Td = ({ children, className = "" }: { children?: ReactNode; className?: string }) => <td className={`px-3 py-2.5 align-top ${className}`}>{children}</td>;

export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-sm text-xs text-muted">{body}</p>}
    </div>
  );
}

/** Builds a query string from the current params with overrides (undefined removes a key). */
export function qs(base: Record<string, string | number | undefined>, over: Record<string, string | number | undefined> = {}): string {
  const merged = { ...base, ...over };
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function Pager({ page, pages, total, pageSize, href }: { page: number; pages: number; total: number; pageSize: number; href: (p: number) => string }) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const btn = "rounded-lg border border-border-strong px-3 py-1.5 text-sm hover:bg-hover";
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 pt-3 text-sm text-muted">
      <span>{total === 0 ? "No results" : `${from}–${to} of ${total}`}</span>
      <span className="flex gap-2">
        {page > 1 ? <Link className={btn} href={href(page - 1)}>Previous</Link> : <span className={`${btn} pointer-events-none opacity-40`} aria-disabled>Previous</span>}
        {page < pages ? <Link className={btn} href={href(page + 1)}>Next</Link> : <span className={`${btn} pointer-events-none opacity-40`} aria-disabled>Next</span>}
      </span>
    </nav>
  );
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Horizontal bar list (no chart library needed for a ranked breakdown). */
export function BarList({ rows, empty }: { rows: { label: string; value: number }[]; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="mb-1 flex justify-between text-sm"><span>{r.label}</span><span className="tabular-nums text-muted">{r.value}</span></div>
          <div className="h-2 rounded-full bg-surface-2" role="img" aria-label={`${r.label}: ${r.value}`}>
            <div className="h-2 rounded-full bg-accent" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
