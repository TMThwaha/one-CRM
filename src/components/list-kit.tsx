"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { EmptyState, Input, Pagination, Panel, Skeleton, cn } from "@/components/ui";
import { api } from "@/lib/api";

export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number }

/** Search + pagination state wired to a REST list endpoint (server does filtering and scoping). */
export function useList<T>(key: string, endpoint: string, extra: Record<string, string | number | undefined> = {}, pageSize = 25) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const extraKey = JSON.stringify(extra);
  // Page is tied to the search + filter it was chosen under, so changing either resets to page 1.
  const scope = `${debounced}|${extraKey}`;
  const [pageState, setPageState] = useState({ scope, page: 1 });
  const page = pageState.scope === scope ? pageState.page : 1;
  const setPage = (p: number) => setPageState({ scope, page: p });
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const query = useQuery({
    queryKey: [key, debounced, page, extraKey],
    queryFn: () => api<Paged<T>>(endpoint, { query: { q: debounced || undefined, page, pageSize, ...extra } }),
    placeholderData: keepPreviousData,
  });
  return { q, setQ, page, setPage, pageSize, query };
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative w-full max-w-xs">
      <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="pl-9" />
    </div>
  );
}

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
  hideBelow?: "sm" | "md" | "lg";
}

const HIDE = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell" };

export function DataTable<T extends { id: string }>({
  columns, rows, loading, empty, pagination,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  loading: boolean;
  empty: ReactNode;
  pagination?: { page: number; pageSize: number; total: number; onPage: (p: number) => void };
}) {
  return (
    <Panel>
      {loading && !rows ? (
        <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
      ) : rows && rows.length === 0 ? (
        empty
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium text-muted">
                {columns.map((c) => (
                  <th key={c.header} scope="col" className={cn("px-4 py-2.5 font-medium whitespace-nowrap", c.hideBelow && HIDE[c.hideBelow], c.className)}>{c.header}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows?.map((r) => (
                <tr key={r.id} className="hover:bg-hover/60">
                  {columns.map((c) => (
                    <td key={c.header} className={cn("px-4 py-2.5", c.hideBelow && HIDE[c.hideBelow], c.className)}>{c.cell(r)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pagination && <Pagination {...pagination} />}
    </Panel>
  );
}

export function ListEmpty({ title, body, action, filtered }: { title: string; body: string; action?: ReactNode; filtered?: boolean }) {
  return filtered ? <EmptyState title="No matches" body="Try a different search or clear the filters." /> : <EmptyState title={title} body={body} action={action} />;
}
