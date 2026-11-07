"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Handshake } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DealModal } from "@/components/forms";
import { DataTable, ListEmpty, SearchBox, useList, type Column } from "@/components/list-kit";
import { useCan, useSession } from "@/components/session";
import { Badge, Button, ErrorNote, Field, Input, Modal, PageHeader, Select, Skeleton, cn, useToast } from "@/components/ui";
import { ApiError, api, post } from "@/lib/api";
import { formatDate, formatMoney, sumDecimal } from "@/lib/format";

interface BoardDeal {
  id: string; title: string; amount: string; currency: string; stageId: string; ownerName: string | null; companyName: string | null;
  expectedCloseDate: string | null; version: number; status: string;
}
interface Board {
  pipeline: { id: string; name: string };
  stages: { id: string; name: string; kind: "open" | "won" | "lost"; probability: number; deals: BoardDeal[] }[];
}

function totals(deals: BoardDeal[]) {
  const byCur = new Map<string, string[]>();
  for (const d of deals) byCur.set(d.currency, [...(byCur.get(d.currency) ?? []), d.amount]);
  return [...byCur].map(([cur, vals]) => formatMoney(sumDecimal(vals), cur)).join(" + ");
}

export function DealsView() {
  const can = useCan();
  const [mode, setMode] = useState<"board" | "list">("board");
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader title="Deals" description="Track opportunities from first conversation to close."
        actions={<>
          <div role="tablist" aria-label="View" className="flex gap-1 rounded-lg bg-surface-2 p-1">
            {(["board", "list"] as const).map((m) => (
              <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
                className={cn("rounded-md px-3 py-1 text-[13px] font-medium capitalize", mode === m ? "bg-surface text-fg shadow-sm" : "text-muted")}>{m}</button>
            ))}
          </div>
          {can("deal.write") && <Button variant="primary" onClick={() => setCreating(true)}>New deal</Button>}
        </>} />
      {mode === "board" ? <BoardView onCreate={() => setCreating(true)} /> : <ListView onCreate={() => setCreating(true)} />}
      <DealModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function BoardView({ onCreate }: { onCreate: () => void }) {
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [lost, setLost] = useState<{ deal: BoardDeal; stageId: string } | null>(null);
  const board = useQuery({ queryKey: ["board"], queryFn: () => api<Board>("/board") });

  const move = useMutation({
    mutationFn: (v: { deal: BoardDeal; stageId: string; lostReason?: string }) =>
      post(`/deals/${v.deal.id}/move`, { stageId: v.stageId, lostReason: v.lostReason, version: v.deal.version }),
    onSuccess: () => qc.invalidateQueries(),
    onError: (e) => { toast(e instanceof ApiError ? e.message : "Could not move the deal", "danger"); qc.invalidateQueries(); },
  });

  const requestMove = (deal: BoardDeal, stageId: string) => {
    if (deal.stageId === stageId) return;
    const stage = board.data?.stages.find((s) => s.id === stageId);
    if (stage?.kind === "lost") setLost({ deal, stageId });
    else move.mutate({ deal, stageId });
  };

  if (board.isLoading) return <div className="grid gap-3 md:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-64" />)}</div>;
  if (board.isError || !board.data) return <ErrorNote message="Could not load the pipeline." />;
  const allDeals = board.data.stages.flatMap((s) => s.deals);
  if (allDeals.length === 0)
    return (
      <div className="rounded-xl border border-border bg-surface">
        <ListEmpty title="No deals in this pipeline" body="Create a deal, or convert a qualified lead into one." action={can("deal.write") ? <Button variant="primary" onClick={onCreate}><Handshake className="h-4 w-4" />New deal</Button> : undefined} />
      </div>
    );

  return (
    <>
      <div className="flex gap-3 overflow-x-auto pb-3">
        {board.data.stages.map((stage) => (
          <section
            key={stage.id}
            aria-label={`${stage.name}, ${stage.deals.length} deals`}
            onDragOver={(e) => { if (dragging) { e.preventDefault(); setOver(stage.id); } }}
            onDragLeave={() => setOver((o) => (o === stage.id ? null : o))}
            onDrop={(e) => {
              e.preventDefault(); setOver(null);
              const deal = allDeals.find((d) => d.id === dragging);
              if (deal && can("deal.write")) requestMove(deal, stage.id);
              setDragging(null);
            }}
            className={cn("flex w-72 shrink-0 flex-col rounded-xl border bg-surface-2/60", over === stage.id ? "border-accent" : "border-border")}
          >
            <header className="px-3 pt-3 pb-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">{stage.name}</h2>
                <Badge tone={stage.kind === "won" ? "success" : stage.kind === "lost" ? "danger" : "neutral"}>{stage.deals.length}</Badge>
              </div>
              <p className="mt-0.5 text-xs text-muted tabular">{stage.deals.length ? totals(stage.deals) : "—"}</p>
            </header>
            <ul className="flex min-h-16 flex-col gap-2 p-2">
              {stage.deals.map((d) => (
                <li key={d.id}
                  draggable={can("deal.write")}
                  onDragStart={() => setDragging(d.id)}
                  onDragEnd={() => { setDragging(null); setOver(null); }}
                  className={cn("rounded-lg border border-border bg-surface p-3 shadow-sm", can("deal.write") && "cursor-grab active:cursor-grabbing", dragging === d.id && "opacity-50")}>
                  <Link href={`/deals/${d.id}`} className="block text-sm font-medium hover:text-accent hover:underline">{d.title}</Link>
                  <p className="mt-0.5 truncate text-xs text-muted">{d.companyName ?? "No company"}</p>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="font-medium tabular">{formatMoney(d.amount, d.currency)}</span>
                    <span className="text-faint">{d.expectedCloseDate ? formatDate(d.expectedCloseDate, { day: "numeric", month: "short" }) : ""}</span>
                  </div>
                  {can("deal.write") && (
                    <label className="mt-2 block">
                      <span className="sr-only">Move {d.title} to stage</span>
                      <Select value={d.stageId} onChange={(e) => requestMove(d, e.target.value)} className="h-7 text-xs">
                        {board.data!.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </Select>
                    </label>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <LostReasonDialog target={lost} onClose={() => setLost(null)} onConfirm={(reason) => { move.mutate({ deal: lost!.deal, stageId: lost!.stageId, lostReason: reason }); setLost(null); }} />
    </>
  );
}

export function LostReasonDialog({ target, onClose, onConfirm }: { target: unknown; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Modal open={Boolean(target)} onClose={onClose} title="Why was this deal lost?" description="Recording a reason helps you learn from lost deals." width={420}>
      <div className="space-y-4">
        <Field label="Reason">{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Price, competitor, timing…" autoFocus />}</Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" disabled={!reason.trim()} onClick={() => { onConfirm(reason.trim()); setReason(""); }}>Mark as lost</Button>
        </div>
      </div>
    </Modal>
  );
}

interface Row { id: string; title: string; amount: string; currency: string; stageName: string; stageKind: string; status: string; companyName: string | null; ownerName: string | null; expectedCloseDate: string | null }

function ListView({ onCreate }: { onCreate: () => void }) {
  const can = useCan();
  const { user } = useSession();
  const [status, setStatus] = useState("");
  const [mine, setMine] = useState(false);
  const { q, setQ, page, setPage, pageSize, query } = useList<Row>("deals", "/deals", { ...(status ? { status } : {}), ...(mine ? { ownerId: user.id } : {}) });
  const columns: Column<Row>[] = [
    { header: "Deal", cell: (d) => <div><Link href={`/deals/${d.id}`} className="font-medium hover:text-accent hover:underline">{d.title}</Link><p className="text-xs text-muted">{d.companyName ?? "No company"}</p></div> },
    { header: "Amount", className: "tabular whitespace-nowrap", cell: (d) => formatMoney(d.amount, d.currency) },
    { header: "Stage", cell: (d) => <Badge tone={d.status === "won" ? "success" : d.status === "lost" ? "danger" : "accent"}>{d.stageName}</Badge> },
    { header: "Owner", hideBelow: "md", cell: (d) => d.ownerName ?? "—" },
    { header: "Close", hideBelow: "sm", className: "text-muted whitespace-nowrap", cell: (d) => formatDate(d.expectedCloseDate, { day: "numeric", month: "short", year: "numeric" }) },
  ];
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <SearchBox value={q} onChange={setQ} placeholder="Search deals or companies" />
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-36">
          <option value="">All statuses</option><option value="open">Open</option><option value="won">Won</option><option value="lost">Lost</option>
        </Select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />Only mine</label>
      </div>
      <DataTable columns={columns} rows={query.data?.items} loading={query.isLoading}
        empty={<ListEmpty filtered={Boolean(q || status || mine)} title="No deals yet" body="Create your first deal." action={can("deal.write") ? <Button variant="primary" onClick={onCreate}>New deal</Button> : undefined} />}
        pagination={query.data ? { page, pageSize, total: query.data.total, onPage: setPage } : undefined} />
    </>
  );
}
