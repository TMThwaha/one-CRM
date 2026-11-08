"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Copy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useSubmit } from "@/components/auth/auth-forms";
import { Button, ErrorNote, Field, Input, Modal, Textarea, useToast } from "@/components/ui";
import { ApiError, del, post } from "@/lib/api";
import type { CompanyStatus } from "@/shared/countries";
import { administratorSchema, deleteCompanySchema } from "@/shared/schemas/platform";
import type { z } from "zod";

const TRANSITIONS: Record<CompanyStatus, { to: CompanyStatus; label: string; danger?: boolean; hint: string }[]> = {
  active: [
    { to: "suspended", label: "Suspend", danger: true, hint: "Everyone in the company is signed out of the workspace immediately. Data is kept." },
    { to: "deactivated", label: "Deactivate", hint: "Access is closed until you reactivate the company." },
    { to: "archived", label: "Archive", hint: "Closes the company. Required before deletion." },
  ],
  suspended: [
    { to: "active", label: "Activate", hint: "Restores access for the whole company." },
    { to: "deactivated", label: "Deactivate", hint: "Access stays closed until reactivated." },
    { to: "archived", label: "Archive", hint: "Closes the company. Required before deletion." },
  ],
  deactivated: [
    { to: "active", label: "Activate", hint: "Restores access for the whole company." },
    { to: "archived", label: "Archive", hint: "Closes the company. Required before deletion." },
  ],
  archived: [{ to: "deactivated", label: "Restore", hint: "Moves the company back to Deactivated." }],
};

export function CopyLink({ url }: { url: string }) {
  const toast = useToast();
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded bg-surface px-2 py-1.5 text-xs">{url}</code>
      <Button type="button" size="sm" onClick={async () => {
        try { await navigator.clipboard.writeText(url); toast("Link copied", "success"); } catch { toast("Copy failed. Select the link and copy it manually.", "danger"); }
      }}>
        <Copy className="h-3.5 w-3.5" aria-hidden /> Copy
      </Button>
    </div>
  );
}

export function StatusControls({ id, status }: { id: string; status: CompanyStatus }) {
  const router = useRouter();
  const toast = useToast();
  const [target, setTarget] = useState<(typeof TRANSITIONS)[CompanyStatus][number] | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const needsReason = target && target.to !== "active";

  const confirm = async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await post(`/platform/companies/${id}/status`, { status: target.to, reason: reason.trim() || undefined });
      toast(`Company ${target.to === "active" ? "activated" : target.to}`, "success");
      setTarget(null);
      setReason("");
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not change the status");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {TRANSITIONS[status].map((t) => (
          <Button key={t.to} variant={t.danger ? "danger" : "secondary"} size="sm" onClick={() => { setError(null); setTarget(t); }}>{t.label}</Button>
        ))}
      </div>
      <Modal open={!!target} onClose={() => setTarget(null)} title={target ? `${target.label} this company?` : ""} description={target?.hint}>
        <div className="space-y-4">
          <ErrorNote message={error} />
          {needsReason && (
            <Field label="Reason" hint="Recorded in the audit log, visible to you and in the company's own audit history.">
              {(fid) => <Textarea id={fid} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />}
            </Field>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setTarget(null)}>Cancel</Button>
            <Button variant={target?.danger ? "danger" : "primary"} loading={busy} onClick={confirm} disabled={!!needsReason && reason.trim().length < 3}>
              {target?.label}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

type AdminForm = z.input<typeof administratorSchema>;

export function AppointAdministrator({ id, companyName, disabled }: { id: string; companyName: string; disabled?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ mode: "promoted" | "invited"; invitation: { url: string; emailed: boolean; expiresInDays: number } | null } | null>(null);
  const form = useForm<AdminForm, unknown, z.output<typeof administratorSchema>>({
    resolver: zodResolver(administratorSchema),
    defaultValues: { name: "", email: "", phone: "", jobTitle: "" },
  });
  const { error, run } = useSubmit<z.output<typeof administratorSchema>>(async (v) => {
    const res = await post<NonNullable<typeof result>>(`/platform/companies/${id}/administrators`, v);
    setResult(res);
    router.refresh();
  });
  const close = () => { setOpen(false); setResult(null); form.reset(); };
  const { errors, isSubmitting } = form.formState;
  return (
    <>
      <Button size="sm" variant="primary" disabled={disabled} onClick={() => setOpen(true)}>Appoint or invite administrator</Button>
      <Modal open={open} onClose={close} title="Appoint a Company Admin" description={`For ${companyName}. A new person gets a secure invitation; an existing member is promoted.`}>
        {result ? (
          <div className="space-y-3 text-sm">
            {result.mode === "promoted" ? (
              <p className="rounded-lg border border-success/30 bg-success-soft px-3 py-2 text-success">That member is now a Company Admin.</p>
            ) : result.invitation?.emailed ? (
              <p className="rounded-lg border border-success/30 bg-success-soft px-3 py-2 text-success">Invitation emailed. It is valid for {result.invitation.expiresInDays} days and works once. Any earlier link for this email no longer works.</p>
            ) : (
              <div className="space-y-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-3">
                <p className="font-semibold text-fg">The invitation email was not delivered.</p>
                <p className="text-muted">Send this link yourself. It is shown only now and works once.</p>
                {result.invitation && <CopyLink url={result.invitation.url} />}
              </div>
            )}
            <div className="flex justify-end"><Button variant="primary" onClick={close}>Done</Button></div>
          </div>
        ) : (
          <form onSubmit={form.handleSubmit(run)} className="space-y-4" noValidate>
            <ErrorNote message={error} />
            <Field label="Full name *" error={errors.name?.message}>{(i, d) => <Input id={i} aria-describedby={d} autoFocus {...form.register("name")} />}</Field>
            <Field label="Email *" error={errors.email?.message}>{(i, d) => <Input id={i} type="email" aria-describedby={d} {...form.register("email")} />}</Field>
            <Field label="Phone" error={errors.phone?.message}>{(i, d) => <Input id={i} type="tel" aria-describedby={d} {...form.register("phone")} />}</Field>
            <Field label="Job title" error={errors.jobTitle?.message}>{(i, d) => <Input id={i} aria-describedby={d} {...form.register("jobTitle")} />}</Field>
            <div className="flex justify-end gap-2"><Button type="button" onClick={close}>Cancel</Button><Button type="submit" variant="primary" loading={isSubmitting}>Appoint</Button></div>
          </form>
        )}
      </Modal>
    </>
  );
}

export function DemoteButton({ companyId, membershipId, email }: { companyId: string; membershipId: string; email: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button size="sm" loading={busy} onClick={async () => {
      if (!window.confirm(`Change ${email} from Company Admin to Admin?`)) return;
      setBusy(true);
      try {
        await del(`/platform/companies/${companyId}/administrators/${membershipId}`);
        toast("Changed to Admin", "success");
        router.refresh();
      } catch (e) {
        toast(e instanceof ApiError ? e.message : "Could not change the role", "danger");
      } finally {
        setBusy(false);
      }
    }}>
      Make Admin
    </Button>
  );
}

type DeleteForm = z.infer<typeof deleteCompanySchema>;

export function DeleteCompany({ id, legalName }: { id: string; legalName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const form = useForm<DeleteForm>({ resolver: zodResolver(deleteCompanySchema), defaultValues: { confirmName: "", password: "" } });
  const { error, run } = useSubmit<DeleteForm>(async (v) => {
    await post(`/platform/companies/${id}/delete`, v);
    router.replace("/super-admin/companies");
    router.refresh();
  });
  const { errors, isSubmitting } = form.formState;
  return (
    <>
      <Button variant="danger" size="sm" onClick={() => setOpen(true)}>Delete company…</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Delete this company?" description="The company disappears from the platform and its members can never sign in to it again. Data is retained, not purged.">
        <form onSubmit={form.handleSubmit(run)} className="space-y-4" noValidate>
          <ErrorNote message={error} />
          <Field label={`Type the legal name to confirm: ${legalName}`} error={errors.confirmName?.message}>{(i, d) => <Input id={i} aria-describedby={d} autoComplete="off" autoFocus {...form.register("confirmName")} />}</Field>
          <Field label="Your password" error={errors.password?.message}>{(i, d) => <Input id={i} type="password" aria-describedby={d} autoComplete="current-password" {...form.register("password")} />}</Field>
          <div className="flex justify-end gap-2"><Button type="button" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" variant="danger" loading={isSubmitting}>Delete company</Button></div>
        </form>
      </Modal>
    </>
  );
}
