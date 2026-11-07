"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useForm, type FieldValues, type Path, type UseFormReturn } from "react-hook-form";
import { Button, ErrorNote, Field, Input, Modal, Select, Textarea, useToast } from "@/components/ui";
import { useSession } from "@/components/session";
import { ApiError, patch, post } from "@/lib/api";
import { useCompanyOptions, useContactOptions, useMembers, usePipelines } from "@/lib/hooks";
import { fullName } from "@/lib/format";

/** Maps server-side validation messages onto the matching form fields. */
function applyApiError<T extends FieldValues>(form: UseFormReturn<T>, e: unknown, setFormError: (m: string) => void) {
  if (e instanceof ApiError) {
    const fields = e.details?.fields;
    if (fields) {
      let any = false;
      for (const [k, msg] of Object.entries(fields)) {
        if (k in form.getValues()) {
          form.setError(k as Path<T>, { message: msg });
          any = true;
        }
      }
      if (any) return;
    }
    setFormError(e.message);
    return;
  }
  setFormError("Something went wrong. Please try again.");
}

function useEntityMutation<T extends FieldValues>(
  form: UseFormReturn<T>,
  opts: { request: (v: T) => Promise<unknown>; success: string; onDone: (result: unknown) => void },
) {
  const qc = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: opts.request,
    onSuccess: async (result) => {
      await qc.invalidateQueries();
      router.refresh();
      toast(opts.success, "success");
      opts.onDone(result);
    },
    onError: (e) => applyApiError(form, e, setError),
  });
  return {
    error,
    submit: form.handleSubmit((v) => {
      setError(null);
      m.mutate(v);
    }),
    pending: m.isPending,
  };
}

const blank = (v: string | undefined | null) => (v === "" || v === undefined ? null : v);

function Actions({ pending, onCancel, label }: { pending: boolean; onCancel: () => void; label: string }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <Button type="button" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" variant="primary" loading={pending}>
        {label}
      </Button>
    </div>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

function OwnerSelect({ id, d, ...rest }: { id: string; d?: string } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { data: members = [] } = useMembers();
  return (
    <Select key={members.length} id={id} aria-describedby={d} {...rest}>
      <option value="">Me (default)</option>
      {members.filter((m) => m.status === "active").map((m) => (
        <option key={m.userId} value={m.userId}>
          {m.name}
        </option>
      ))}
    </Select>
  );
}

// --- Contact --------------------------------------------------------------------------------

interface ContactValues {
  firstName: string; lastName: string; email: string; phone: string; jobTitle: string;
  companyId: string; ownerId: string; source: string;
}

export function ContactModal({
  open, onClose, contact, defaults,
}: {
  open: boolean; onClose: () => void;
  contact?: { id: string; version: number } & Partial<Record<keyof ContactValues, string | null>>;
  defaults?: Partial<ContactValues>;
}) {
  const form = useForm<ContactValues>({ values: {
    firstName: contact?.firstName ?? defaults?.firstName ?? "", lastName: contact?.lastName ?? defaults?.lastName ?? "",
    email: contact?.email ?? defaults?.email ?? "", phone: contact?.phone ?? defaults?.phone ?? "",
    jobTitle: contact?.jobTitle ?? defaults?.jobTitle ?? "", companyId: contact?.companyId ?? defaults?.companyId ?? "",
    ownerId: contact?.ownerId ?? "", source: contact?.source ?? defaults?.source ?? "",
  } });
  const { data: companies = [] } = useCompanyOptions();
  const { error, submit, pending } = useEntityMutation(form, {
    success: contact ? "Contact updated" : "Contact created",
    request: (v) => {
      const body = { ...v, companyId: blank(v.companyId), ownerId: blank(v.ownerId) };
      return contact ? patch(`/contacts/${contact.id}`, { ...body, version: contact.version }) : post("/contacts", body);
    },
    onDone: () => { form.reset(); onClose(); },
  });
  const { errors } = form.formState;
  return (
    <Modal open={open} onClose={onClose} title={contact ? "Edit contact" : "New contact"} width={560}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <ErrorNote message={error} />
        <Row>
          <Field label="First name *" error={errors.firstName?.message}>{(id, d) => <Input id={id} aria-describedby={d} autoFocus {...form.register("firstName")} />}</Field>
          <Field label="Last name" error={errors.lastName?.message}>{(id, d) => <Input id={id} aria-describedby={d} {...form.register("lastName")} />}</Field>
        </Row>
        <Row>
          <Field label="Email" error={errors.email?.message}>{(id, d) => <Input id={id} type="email" aria-describedby={d} {...form.register("email")} />}</Field>
          <Field label="Phone" error={errors.phone?.message}>{(id, d) => <Input id={id} type="tel" aria-describedby={d} {...form.register("phone")} />}</Field>
        </Row>
        <Row>
          <Field label="Job title">{(id, d) => <Input id={id} aria-describedby={d} {...form.register("jobTitle")} />}</Field>
          <Field label="Company">
            {(id, d) => (
              <Select key={companies.length} id={id} aria-describedby={d} {...form.register("companyId")}>
                <option value="">No company</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            )}
          </Field>
        </Row>
        <Row>
          <Field label="Owner" error={errors.ownerId?.message}>{(id, d) => <OwnerSelect id={id} d={d} {...form.register("ownerId")} />}</Field>
          <Field label="Source">{(id, d) => <Input id={id} aria-describedby={d} placeholder="Referral, Website…" {...form.register("source")} />}</Field>
        </Row>
        <Actions pending={pending} onCancel={onClose} label={contact ? "Save changes" : "Create contact"} />
      </form>
    </Modal>
  );
}

// --- Company --------------------------------------------------------------------------------

interface CompanyValues { name: string; domain: string; industry: string; size: string; phone: string; website: string; city: string; country: string; ownerId: string }

export function CompanyModal({
  open, onClose, company,
}: { open: boolean; onClose: () => void; company?: { id: string; version: number } & Partial<Record<keyof CompanyValues, string | null>> }) {
  const form = useForm<CompanyValues>({ values: {
    name: company?.name ?? "", domain: company?.domain ?? "", industry: company?.industry ?? "", size: company?.size ?? "",
    phone: company?.phone ?? "", website: company?.website ?? "", city: company?.city ?? "", country: company?.country ?? "", ownerId: company?.ownerId ?? "",
  } });
  const { error, submit, pending } = useEntityMutation(form, {
    success: company ? "Company updated" : "Company created",
    request: (v) => {
      const body = { ...v, ownerId: blank(v.ownerId) };
      return company ? patch(`/companies/${company.id}`, { ...body, version: company.version }) : post("/companies", body);
    },
    onDone: () => { form.reset(); onClose(); },
  });
  const { errors } = form.formState;
  return (
    <Modal open={open} onClose={onClose} title={company ? "Edit company" : "New company"} width={560}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <ErrorNote message={error} />
        <Field label="Company name *" error={errors.name?.message}>{(id, d) => <Input id={id} aria-describedby={d} autoFocus {...form.register("name")} />}</Field>
        <Row>
          <Field label="Website domain" error={errors.domain?.message} hint="e.g. acme.com">{(id, d) => <Input id={id} aria-describedby={d} {...form.register("domain")} />}</Field>
          <Field label="Industry">{(id, d) => <Input id={id} aria-describedby={d} {...form.register("industry")} />}</Field>
        </Row>
        <Row>
          <Field label="Size">
            {(id, d) => (
              <Select id={id} aria-describedby={d} {...form.register("size")}>
                <option value="">Unknown</option>
                {["1-10", "11-50", "51-200", "201-1000", "1000+"].map((s) => <option key={s}>{s}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Phone">{(id, d) => <Input id={id} type="tel" aria-describedby={d} {...form.register("phone")} />}</Field>
        </Row>
        <Row>
          <Field label="City">{(id, d) => <Input id={id} aria-describedby={d} {...form.register("city")} />}</Field>
          <Field label="Country">{(id, d) => <Input id={id} aria-describedby={d} {...form.register("country")} />}</Field>
        </Row>
        <Field label="Owner" error={errors.ownerId?.message}>{(id, d) => <OwnerSelect id={id} d={d} {...form.register("ownerId")} />}</Field>
        <Actions pending={pending} onCancel={onClose} label={company ? "Save changes" : "Create company"} />
      </form>
    </Modal>
  );
}

// --- Lead -----------------------------------------------------------------------------------

interface LeadValues { firstName: string; lastName: string; email: string; phone: string; companyName: string; jobTitle: string; source: string; ownerId: string }

export function LeadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const form = useForm<LeadValues>({ defaultValues: { firstName: "", lastName: "", email: "", phone: "", companyName: "", jobTitle: "", source: "", ownerId: "" } });
  const { error, submit, pending } = useEntityMutation(form, {
    success: "Lead created",
    request: (v) => post("/leads", { ...v, ownerId: blank(v.ownerId) }),
    onDone: () => { form.reset(); onClose(); },
  });
  const { errors } = form.formState;
  return (
    <Modal open={open} onClose={onClose} title="New lead" description="Leads are scored automatically from what you know about them." width={560}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <ErrorNote message={error} />
        <Row>
          <Field label="First name *" error={errors.firstName?.message}>{(id, d) => <Input id={id} aria-describedby={d} autoFocus {...form.register("firstName")} />}</Field>
          <Field label="Last name">{(id, d) => <Input id={id} aria-describedby={d} {...form.register("lastName")} />}</Field>
        </Row>
        <Row>
          <Field label="Email" error={errors.email?.message}>{(id, d) => <Input id={id} type="email" aria-describedby={d} {...form.register("email")} />}</Field>
          <Field label="Phone">{(id, d) => <Input id={id} type="tel" aria-describedby={d} {...form.register("phone")} />}</Field>
        </Row>
        <Row>
          <Field label="Company">{(id, d) => <Input id={id} aria-describedby={d} {...form.register("companyName")} />}</Field>
          <Field label="Job title">{(id, d) => <Input id={id} aria-describedby={d} {...form.register("jobTitle")} />}</Field>
        </Row>
        <Row>
          <Field label="Source">
            {(id, d) => (
              <Select id={id} aria-describedby={d} {...form.register("source")}>
                <option value="">Unknown</option>
                {["Referral", "Partner", "Website", "Event", "Cold outreach"].map((s) => <option key={s}>{s}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Owner" error={errors.ownerId?.message}>{(id, d) => <OwnerSelect id={id} d={d} {...form.register("ownerId")} />}</Field>
        </Row>
        <Actions pending={pending} onCancel={onClose} label="Create lead" />
      </form>
    </Modal>
  );
}

// --- Deal -----------------------------------------------------------------------------------

interface DealValues { title: string; amount: string; currency: string; expectedCloseDate: string; companyId: string; contactId: string; ownerId: string; pipelineId: string; stageId: string }

export function DealModal({
  open, onClose, defaults, stageId,
}: { open: boolean; onClose: () => void; defaults?: Partial<DealValues>; stageId?: string }) {
  const { organization } = useSession();
  const form = useForm<DealValues>({ values: {
    title: defaults?.title ?? "", amount: defaults?.amount ?? "", currency: organization.baseCurrency,
    expectedCloseDate: "", companyId: defaults?.companyId ?? "", contactId: defaults?.contactId ?? "", ownerId: "",
    pipelineId: "", stageId: stageId ?? "",
  } });
  const { data: companies = [] } = useCompanyOptions();
  const { data: contacts = [] } = useContactOptions();
  const { data: pipelines = [] } = usePipelines();
  const pipelineId = pipelines.find((p) => p.isDefault)?.id || pipelines[0]?.id;
  const stages = pipelines.find((p) => p.id === pipelineId)?.stages.filter((s) => s.kind === "open") ?? [];
  const { error, submit, pending } = useEntityMutation(form, {
    success: "Deal created",
    request: (v) =>
      post("/deals", {
        title: v.title,
        amount: v.amount || "0",
        currency: v.currency || undefined,
        expectedCloseDate: blank(v.expectedCloseDate),
        companyId: blank(v.companyId),
        ownerId: blank(v.ownerId),
        pipelineId: v.pipelineId || undefined,
        stageId: v.stageId || undefined,
        contactIds: v.contactId ? [v.contactId] : [],
      }),
    onDone: () => { form.reset(); onClose(); },
  });
  const { errors } = form.formState;
  return (
    <Modal open={open} onClose={onClose} title="New deal" width={560}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <ErrorNote message={error} />
        <Field label="Deal title *" error={errors.title?.message}>{(id, d) => <Input id={id} aria-describedby={d} autoFocus {...form.register("title")} />}</Field>
        <Row>
          <Field label="Amount" error={errors.amount?.message} hint="Exact decimal, e.g. 150000 or 1999.50">
            {(id, d) => <Input id={id} inputMode="decimal" aria-describedby={d} placeholder="0" {...form.register("amount")} />}
          </Field>
          <Field label="Currency" error={errors.currency?.message}>{(id, d) => <Input id={id} maxLength={3} aria-describedby={d} className="uppercase" {...form.register("currency")} />}</Field>
        </Row>
        <Row>
          <Field label="Stage">
            {(id, d) => (
              <Select key={stages.length} id={id} aria-describedby={d} {...form.register("stageId")}>
                <option value="">First stage</option>
                {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Expected close" error={errors.expectedCloseDate?.message}>{(id, d) => <Input id={id} type="date" aria-describedby={d} {...form.register("expectedCloseDate")} />}</Field>
        </Row>
        <Row>
          <Field label="Company">
            {(id, d) => (
              <Select key={companies.length} id={id} aria-describedby={d} {...form.register("companyId")}>
                <option value="">None</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Primary contact">
            {(id, d) => (
              <Select key={contacts.length} id={id} aria-describedby={d} {...form.register("contactId")}>
                <option value="">None</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{fullName(c.firstName, c.lastName)}</option>)}
              </Select>
            )}
          </Field>
        </Row>
        <Field label="Owner" error={errors.ownerId?.message}>{(id, d) => <OwnerSelect id={id} d={d} {...form.register("ownerId")} />}</Field>
        <Actions pending={pending} onCancel={onClose} label="Create deal" />
      </form>
    </Modal>
  );
}

// --- Task -----------------------------------------------------------------------------------

interface TaskValues { title: string; description: string; dueAt: string; priority: string; assigneeId: string }
export interface TaskLinks { contactId?: string; companyId?: string; leadId?: string; dealId?: string }

export function TaskModal({
  open, onClose, links, defaultTitle,
}: { open: boolean; onClose: () => void; links?: TaskLinks; defaultTitle?: string }) {
  const form = useForm<TaskValues>({ values: { title: defaultTitle ?? "", description: "", dueAt: "", priority: "normal", assigneeId: "" } });
  const { error, submit, pending } = useEntityMutation(form, {
    success: "Task created",
    request: (v) =>
      post("/tasks", {
        title: v.title,
        description: blank(v.description),
        dueAt: v.dueAt ? new Date(v.dueAt).toISOString() : null,
        priority: v.priority,
        assigneeId: blank(v.assigneeId),
        ...links,
      }),
    onDone: () => { form.reset(); onClose(); },
  });
  const { errors } = form.formState;
  const quick = (days: number, hour = 9) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    form.setValue("dueAt", `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`);
  };
  return (
    <Modal open={open} onClose={onClose} title="New task" width={520}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <ErrorNote message={error} />
        <Field label="What needs to be done? *" error={errors.title?.message}>{(id, d) => <Input id={id} aria-describedby={d} autoFocus {...form.register("title")} />}</Field>
        <Field label="Due" error={errors.dueAt?.message}>
          {(id, d) => (
            <div className="space-y-2">
              <Input id={id} type="datetime-local" aria-describedby={d} {...form.register("dueAt")} />
              <div className="flex gap-1.5">
                <Button type="button" size="sm" onClick={() => quick(0, 17)}>Today</Button>
                <Button type="button" size="sm" onClick={() => quick(1)}>Tomorrow</Button>
                <Button type="button" size="sm" onClick={() => quick(7)}>Next week</Button>
              </div>
            </div>
          )}
        </Field>
        <Row>
          <Field label="Priority">
            {(id, d) => (
              <Select id={id} aria-describedby={d} {...form.register("priority")}>
                {["low", "normal", "high", "urgent"].map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Assignee" error={errors.assigneeId?.message}>{(id, d) => <OwnerSelect id={id} d={d} {...form.register("assigneeId")} />}</Field>
        </Row>
        <Field label="Notes">{(id, d) => <Textarea id={id} aria-describedby={d} {...form.register("description")} />}</Field>
        <Actions pending={pending} onCancel={onClose} label="Create task" />
      </form>
    </Modal>
  );
}

// --- Log activity (note / call / email / meeting) -------------------------------------------

interface ActivityValues { type: string; subject: string; body: string }

export function LogActivityForm({ links, onDone }: { links: TaskLinks; onDone?: () => void }) {
  const form = useForm<ActivityValues>({ defaultValues: { type: "note", subject: "", body: "" } });
  const { error, submit, pending } = useEntityMutation(form, {
    success: "Logged",
    request: (v) => post("/activities", { type: v.type, subject: v.subject, body: blank(v.body), ...links }),
    onDone: () => { form.reset({ type: form.getValues("type"), subject: "", body: "" }); onDone?.(); },
  });
  const { errors } = form.formState;
  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <ErrorNote message={error} />
      <div className="flex gap-2">
        <Select aria-label="Activity type" className="w-32 shrink-0" {...form.register("type")}>
          <option value="note">Note</option>
          <option value="call">Call</option>
          <option value="email">Email</option>
          <option value="meeting">Meeting</option>
        </Select>
        <Input aria-label="Subject" aria-invalid={!!errors.subject} placeholder="What happened?" {...form.register("subject")} />
      </div>
      {errors.subject && <p role="alert" className="text-xs text-danger">{errors.subject.message}</p>}
      <Textarea aria-label="Details" placeholder="Details (optional)" className="min-h-16" {...form.register("body")} />
      <div className="flex justify-end">
        <Button type="submit" variant="primary" size="sm" loading={pending}>Log activity</Button>
      </div>
    </form>
  );
}
