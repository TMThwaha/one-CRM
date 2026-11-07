"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { CalendarClock, CircleDot, Mail, MessageSquareText, Phone, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { Button, EmptyState, Skeleton, cn } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDateTime, relativeTime } from "@/lib/format";

interface Entry {
  id: string; type: string; subject: string; body: string | null; occurredAt: string; durationMinutes: number | null;
  authorName: string | null; dealId: string | null; contactId: string | null; leadId: string | null; companyId: string | null;
}

const ICONS: Record<string, LucideIcon> = { note: MessageSquareText, call: Phone, email: Mail, meeting: CalendarClock, system: CircleDot };
const PLURAL = { contact: "contacts", company: "companies", lead: "leads", deal: "deals" } as const;

/** One connected timeline: your notes and calls, plus everything the platform recorded. */
export function Timeline({ kind, id, hideSystem }: { kind: keyof typeof PLURAL; id: string; hideSystem?: boolean }) {
  const q = useInfiniteQuery({
    queryKey: ["timeline", kind, id],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api<{ items: Entry[]; nextBefore: string | null }>(`/${PLURAL[kind]}/${id}/timeline`, { query: { before: pageParam } }),
    getNextPageParam: (last) => last.nextBefore ?? undefined,
  });
  const items = (q.data?.pages.flatMap((p) => p.items) ?? []).filter((i) => !(hideSystem && i.type === "system"));

  if (q.isLoading) return <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>;
  if (q.isError) return <p role="alert" className="text-sm text-danger">Could not load the timeline.</p>;
  if (items.length === 0) return <EmptyState title="No activity yet" body="Log a note, call or meeting above. Changes to this record also appear here." />;

  return (
    <div>
      <ol className="relative space-y-4 border-l border-border pl-5">
        {items.map((a) => {
          const Icon = ICONS[a.type] ?? CircleDot;
          const system = a.type === "system";
          return (
            <li key={a.id} className="relative">
              <span className={cn("absolute -left-[31px] flex h-[22px] w-[22px] items-center justify-center rounded-full border border-border bg-surface", system ? "text-faint" : "text-accent")}>
                <Icon className="h-3 w-3" aria-hidden />
              </span>
              <div className="flex flex-wrap items-baseline gap-x-2">
                <p className={cn("text-sm", system ? "text-muted" : "font-medium")}>{a.subject}</p>
                {a.dealId && kind !== "deal" && <Link href={`/deals/${a.dealId}`} className="text-xs text-accent hover:underline">deal</Link>}
              </div>
              {a.body && <p className="mt-1 text-sm whitespace-pre-wrap text-muted">{a.body}</p>}
              <p className="mt-0.5 text-xs text-faint" title={formatDateTime(a.occurredAt)}>
                {system ? "System" : a.authorName ?? "Someone"}
                {a.type === "call" || a.type === "meeting" ? ` · ${a.type}${a.durationMinutes ? ` ${a.durationMinutes} min` : ""}` : ""} · {relativeTime(a.occurredAt)}
              </p>
            </li>
          );
        })}
      </ol>
      {q.hasNextPage && (
        <div className="pt-4 pl-5">
          <Button size="sm" onClick={() => q.fetchNextPage()} loading={q.isFetchingNextPage}>Load older activity</Button>
        </div>
      )}
    </div>
  );
}
