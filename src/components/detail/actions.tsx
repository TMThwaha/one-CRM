"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CompanyModal, ContactModal, LogActivityForm, TaskModal, type TaskLinks } from "@/components/forms";
import { LostReasonDialog } from "@/components/views/deals-view";
import { useCan } from "@/components/session";
import { Button, Modal, Select, useToast, cn } from "@/components/ui";
import { ApiError, del, post } from "@/lib/api";
import { useContactOptions } from "@/lib/hooks";
import { fullName } from "@/lib/format";

export function DeleteButton({ endpoint, redirectTo, label, permission }: { endpoint: string; redirectTo: string; label: string; permission: "contact.delete" | "company.delete" | "deal.delete" }) {
  const can = useCan();
  const [confirm, setConfirm] = useState(false);
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({
    mutationFn: () => del(endpoint),
    onSuccess: async () => { await qc.invalidateQueries(); toast(`${label} deleted`, "success"); router.replace(redirectTo); router.refresh(); },
    onError: (e) => toast(e instanceof ApiError ? e.message : "Could not delete", "danger"),
  });
  if (!can(permission)) return null;
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setConfirm(true)}><Trash2 className="h-4 w-4" />Delete</Button>
      <Modal open={confirm} onClose={() => setConfirm(false)} title={`Delete this ${label.toLowerCase()}?`} description="It will be removed from lists and search. The deletion is recorded in the audit log." width={420}>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
          <Button variant="danger" loading={m.isPending} onClick={() => m.mutate()}>Delete {label.toLowerCase()}</Button>
        </div>
      </Modal>
    </>
  );
}

export function ContactActions({ contact }: { contact: { id: string; version: number } & Record<string, unknown> }) {
  const can = useCan();
  const [edit, setEdit] = useState(false);
  const [task, setTask] = useState(false);
  return (
    <>
      {can("task.write") && <Button size="sm" onClick={() => setTask(true)}><Plus className="h-4 w-4" />Task</Button>}
      {can("contact.write") && <Button size="sm" onClick={() => setEdit(true)}><Pencil className="h-4 w-4" />Edit</Button>}
      <DeleteButton endpoint={`/contacts/${contact.id}`} redirectTo="/contacts" label="Contact" permission="contact.delete" />
      <ContactModal open={edit} onClose={() => setEdit(false)} contact={contact as never} />
      <TaskModal open={task} onClose={() => setTask(false)} links={{ contactId: contact.id }} />
    </>
  );
}

export function CompanyActions({ company }: { company: { id: string; version: number } & Record<string, unknown> }) {
  const can = useCan();
  const [edit, setEdit] = useState(false);
  const [task, setTask] = useState(false);
  return (
    <>
      {can("task.write") && <Button size="sm" onClick={() => setTask(true)}><Plus className="h-4 w-4" />Task</Button>}
      {can("company.write") && <Button size="sm" onClick={() => setEdit(true)}><Pencil className="h-4 w-4" />Edit</Button>}
      <DeleteButton endpoint={`/companies/${company.id}`} redirectTo="/companies" label="Company" permission="company.delete" />
      <CompanyModal open={edit} onClose={() => setEdit(false)} company={company as never} />
      <TaskModal open={task} onClose={() => setTask(false)} links={{ companyId: company.id }} />
    </>
  );
}

export function AddTaskButton({ links, label = "Add task" }: { links: TaskLinks; label?: string }) {
  const can = useCan();
  const [open, setOpen] = useState(false);
  if (!can("task.write")) return null;
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />{label}</Button>
      <TaskModal open={open} onClose={() => setOpen(false)} links={links} />
    </>
  );
}

export function LogActivity({ links }: { links: TaskLinks }) {
  const can = useCan();
  if (!can("activity.write")) return null;
  return <div className="rounded-xl border border-border bg-surface p-4"><LogActivityForm links={links} /></div>;
}

export function StageStepper({ dealId, version, stageId, stages }: { dealId: string; version: number; stageId: string; stages: { id: string; name: string; kind: string; position: number }[] }) {
  const can = useCan();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [lost, setLost] = useState<string | null>(null);
  const move = useMutation({
    mutationFn: (v: { stageId: string; lostReason?: string }) => post(`/deals/${dealId}/move`, { ...v, version }),
    onSuccess: async () => { await qc.invalidateQueries(); router.refresh(); },
    onError: (e) => { toast(e instanceof ApiError ? e.message : "Could not move the deal", "danger"); router.refresh(); },
  });
  const current = stages.findIndex((s) => s.id === stageId);
  return (
    <>
      <ol className="flex flex-wrap gap-1.5" aria-label="Deal stage">
        {stages.map((s, i) => (
          <li key={s.id}>
            <button
              disabled={!can("deal.write") || move.isPending}
              aria-current={s.id === stageId ? "step" : undefined}
              onClick={() => (s.kind === "lost" ? setLost(s.id) : move.mutate({ stageId: s.id }))}
              className={cn(
                "rounded-full border px-3 py-1 text-[13px] font-medium transition-colors disabled:cursor-default",
                s.id === stageId
                  ? s.kind === "won" ? "border-success bg-success-soft text-success" : s.kind === "lost" ? "border-danger bg-danger-soft text-danger" : "border-accent bg-accent-soft text-accent"
                  : i < current ? "border-border bg-surface-2 text-muted" : "border-border text-muted hover:bg-hover",
              )}
            >{s.name}</button>
          </li>
        ))}
      </ol>
      <LostReasonDialog target={lost} onClose={() => setLost(null)} onConfirm={(reason) => { move.mutate({ stageId: lost!, lostReason: reason }); setLost(null); }} />
    </>
  );
}

export function DealContactsEditor({ dealId, linked }: { dealId: string; linked: string[] }) {
  const can = useCan();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: options = [] } = useContactOptions();
  const [pick, setPick] = useState("");
  const add = useMutation({
    mutationFn: () => post(`/deals/${dealId}/contacts`, { contactId: pick }),
    onSuccess: async () => { setPick(""); await qc.invalidateQueries(); router.refresh(); },
    onError: (e) => toast(e instanceof ApiError ? e.message : "Could not add contact", "danger"),
  });
  if (!can("deal.write") || !can("contact.read")) return null;
  const available = options.filter((o) => !linked.includes(o.id));
  return (
    <div className="flex gap-2 border-t border-border p-3">
      <Select aria-label="Add a contact to this deal" value={pick} onChange={(e) => setPick(e.target.value)} className="h-8 text-[13px]">
        <option value="">Add a contact…</option>
        {available.map((o) => <option key={o.id} value={o.id}>{fullName(o.firstName, o.lastName)}</option>)}
      </Select>
      <Button size="sm" disabled={!pick} loading={add.isPending} onClick={() => add.mutate()}>Add</Button>
    </div>
  );
}

export function RemoveDealContact({ dealId, contactId, name }: { dealId: string; contactId: string; name: string }) {
  const can = useCan();
  const router = useRouter();
  const qc = useQueryClient();
  const m = useMutation({ mutationFn: () => del(`/deals/${dealId}/contacts/${contactId}`), onSuccess: async () => { await qc.invalidateQueries(); router.refresh(); } });
  if (!can("deal.write")) return null;
  return <Button size="icon" variant="ghost" aria-label={`Remove ${name} from deal`} onClick={() => m.mutate()}><X className="h-4 w-4" /></Button>;
}
