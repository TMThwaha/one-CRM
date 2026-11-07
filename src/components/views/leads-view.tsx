"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightCircle, Target } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { LeadModal, LogActivityForm, TaskModal } from "@/components/forms";
import { DataTable, ListEmpty, SearchBox, useList, type Column } from "@/components/list-kit";
import { useCan } from "@/components/session";
import { Badge, Button, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, cn, useToast } from "@/components/ui";
import { Timeline } from "@/components/timeline";
import { ApiError, api, patch, post } from "@/lib/api";
import { fullName, relativeTime } from "@/lib/format";
import { usePipelines } from "@/lib/hooks";

interface Lead {
  id: string; firstName: string; lastName: string | null; email: string | null; phone: string | null; companyName: string | null; jobTitle: string | null;
  source: string | null; status: string; score: number; scoreReasons: { label: string; points: number }[]; version: number;
  convertedContactId: string | null; convertedDealId: string | null; createdAt: string;
}

const STATUS_TONE: Record<string, "neutral" | "accent" | "success" | "warning" | "danger"> = {
  new: "accent", contacted: "neutral", qualified: "success", unqualified: "danger", converted: "success",
};

function ScoreChip({ score }: { score: number }) {
  const tone = score >= 60 ? "bg-success-soft text-success" : score >= 30 ? "bg-warning-soft text-warning" : "bg-surface-2 text-muted";
  return <span className={cn("inline-flex h-6 min-w-9 items-center justify-center rounded-md px-1.5 text-xs font-semibold tabular", tone)} title="Rule-based score">{score}</span>;
}

export function LeadsView() {
  const can = useCan();
  const router = useRouter();
  const params = useSearchParams();
  const openId = params.get("open");
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState("");
  const { q, setQ, page, setPage, pageSize, query } = useList<Lead>("leads", "/leads", status ? { status } : {});

  const columns: Column<Lead>[] = [
    { header: "Score", cell: (l) => <ScoreChip score={l.score} /> },
    { header: "Lead", cell: (l) => (
      <div>
        <button onClick={() => router.push(`/leads?open=${l.id}`)} className="font-medium hover:text-accent hover:underline">{fullName(l.firstName, l.lastName)}</button>
        <p className="text-xs text-muted">{[l.jobTitle, l.companyName].filter(Boolean).join(" · ") || "—"}</p>
      </div>
    ) },
    { header: "Source", hideBelow: "sm", cell: (l) => l.source ?? <span className="text-faint">—</span> },
    { header: "Status", cell: (l) => <Badge tone={STATUS_TONE[l.status]}>{l.status}</Badge> },
    { header: "Added", hideBelow: "md", className: "text-muted whitespace-nowrap", cell: (l) => relativeTime(l.createdAt) },
  ];

  return (
    <>
      <PageHeader title="Leads" description="Unqualified interest, ranked by an explainable score. Convert good ones into contacts and deals."
        actions={can("lead.write") && <Button variant="primary" onClick={() => setCreating(true)}>New lead</Button>} />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <SearchBox value={q} onChange={setQ} placeholder="Search name, email or company" />
        <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
          <option value="">All statuses</option>
          {["new", "contacted", "qualified", "unqualified", "converted"].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
        </Select>
      </div>
      <DataTable
        columns={columns}
        rows={query.data?.items}
        loading={query.isLoading}
        empty={<ListEmpty filtered={Boolean(q || status)} title="No leads yet" body="Capture a lead to start qualifying it." action={can("lead.write") ? <Button variant="primary" onClick={() => setCreating(true)}><Target className="h-4 w-4" />New lead</Button> : undefined} />}
        pagination={query.data ? { page, pageSize, total: query.data.total, onPage: setPage } : undefined}
      />
      <LeadModal open={creating} onClose={() => setCreating(false)} />
      <LeadPanel id={openId} onClose={() => router.replace("/leads")} />
    </>
  );
}

function LeadPanel({ id, onClose }: { id: string | null; onClose: () => void }) {
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const router = useRouter();
  const [convertOpen, setConvertOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const lead = useQuery({ queryKey: ["lead", id], enabled: Boolean(id), queryFn: () => api<Lead>(`/leads/${id}`) });

  const setStatus = useMutation({
    mutationFn: (status: string) => patch(`/leads/${id}`, { status, version: lead.data!.version }),
    onSuccess: async () => { await qc.invalidateQueries(); },
    onError: (e) => toast(e instanceof ApiError ? e.message : "Could not update", "danger"),
  });

  const l = lead.data;
  return (
    <>
      <Modal open={Boolean(id)} onClose={onClose} title={l ? fullName(l.firstName, l.lastName) : "Lead"} description={l ? [l.jobTitle, l.companyName].filter(Boolean).join(" · ") : undefined} side width={560}>
        {!l ? (lead.isError ? <ErrorNote message="This lead could not be found." /> : <Spinner />) : (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[l.status]}>{l.status}</Badge>
              {l.email && <a href={`mailto:${l.email}`} className="text-sm text-accent hover:underline">{l.email}</a>}
              {l.phone && <span className="text-sm text-muted">{l.phone}</span>}
            </div>

            <section aria-labelledby="why">
              <div className="mb-2 flex items-center gap-2">
                <ScoreChip score={l.score} />
                <h3 id="why" className="text-sm font-semibold">Why this score</h3>
              </div>
              <ul className="space-y-1 text-sm">
                {l.scoreReasons.map((r) => (
                  <li key={r.label} className="flex justify-between rounded-md bg-surface-2 px-3 py-1.5">
                    <span>{r.label}</span>
                    <span className={cn("tabular", r.points < 0 ? "text-danger" : "text-muted")}>{r.points > 0 ? "+" : ""}{r.points}</span>
                  </li>
                ))}
                {l.scoreReasons.length === 0 && <li className="text-muted">Add contact details to improve the score.</li>}
              </ul>
              <p className="mt-2 text-xs text-faint">A fixed rule set, not a machine-learning model. Every point is listed above.</p>
            </section>

            {l.status !== "converted" && can("lead.write") && (
              <div className="flex flex-wrap gap-2">
                {l.status === "new" && <Button size="sm" onClick={() => setStatus.mutate("contacted")}>Mark contacted</Button>}
                {l.status !== "qualified" && <Button size="sm" onClick={() => setStatus.mutate("qualified")}>Qualify</Button>}
                {l.status !== "unqualified" && <Button size="sm" onClick={() => setStatus.mutate("unqualified")}>Disqualify</Button>}
                {can("lead.convert") && <Button size="sm" variant="primary" onClick={() => setConvertOpen(true)}><ArrowRightCircle className="h-4 w-4" />Convert</Button>}
                {can("task.write") && <Button size="sm" variant="ghost" onClick={() => setTaskOpen(true)}>Add task</Button>}
              </div>
            )}
            {l.status === "converted" && (
              <p className="rounded-lg bg-success-soft px-3 py-2 text-sm text-success">
                Converted.{" "}
                {l.convertedContactId && <Link href={`/contacts/${l.convertedContactId}`} className="font-medium underline">Open contact</Link>}
                {l.convertedDealId && <> · <Link href={`/deals/${l.convertedDealId}`} className="font-medium underline">Open deal</Link></>}
              </p>
            )}

            {can("activity.write") && l.status !== "converted" && (
              <section aria-label="Log activity"><LogActivityForm links={{ leadId: l.id }} /></section>
            )}
            <section aria-label="History">
              <h3 className="mb-3 text-sm font-semibold">History</h3>
              <Timeline kind="lead" id={l.id} />
            </section>
          </div>
        )}
      </Modal>
      {l && <ConvertDialog lead={l} open={convertOpen} onClose={() => setConvertOpen(false)} onDone={(r) => { setConvertOpen(false); router.refresh(); if (r.contactId) router.push(`/contacts/${r.contactId}`); }} />}
      {l && <TaskModal open={taskOpen} onClose={() => setTaskOpen(false)} links={{ leadId: l.id }} defaultTitle={`Follow up with ${l.firstName}`} />}
    </>
  );
}

function ConvertDialog({ lead, open, onClose, onDone }: { lead: Lead; open: boolean; onClose: () => void; onDone: (r: { contactId: string | null; dealId: string | null }) => void }) {
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: pipelines = [] } = usePipelines();
  const [createDeal, setCreateDeal] = useState(false);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  const convert = useMutation({
    mutationFn: () => post<{ contactId: string | null; dealId: string | null; reusedExistingContact: boolean }>(`/leads/${lead.id}/convert`, {
      createDeal, dealTitle: title || undefined, dealAmount: amount || undefined, pipelineId: pipelines.find((p) => p.isDefault)?.id,
    }),
    onSuccess: async (r) => {
      await qc.invalidateQueries();
      toast(r.reusedExistingContact ? "Converted — matched an existing contact" : "Lead converted", "success");
      onDone(r);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not convert"),
  });

  return (
    <Modal open={open} onClose={onClose} title="Convert lead" description="Creates a contact (and company) from this lead. History moves with it." width={460}>
      <div className="space-y-4">
        <ErrorNote message={error} />
        {can("deal.write") && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={createDeal} onChange={(e) => setCreateDeal(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
            Also create a deal
          </label>
        )}
        {createDeal && (
          <>
            <Field label="Deal title">{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`${lead.companyName ?? lead.firstName} - opportunity`} />}</Field>
            <Field label="Amount" hint="Optional. Exact decimal, e.g. 50000">{(id) => <Input id={id} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={convert.isPending} onClick={() => { setError(null); convert.mutate(); }}>Convert lead</Button>
        </div>
      </div>
    </Modal>
  );
}
