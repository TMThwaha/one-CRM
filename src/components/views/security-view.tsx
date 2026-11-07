"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Copy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useSubmit } from "@/components/auth/auth-forms";
import { Badge, Button, ErrorNote, Field, Input, Modal, PageHeader, Panel, useHydrated, useToast } from "@/components/ui";
import { ApiError, del, post } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import {
  changePasswordSchema, mfaCodeSchema, mfaDisableSchema,
  type ChangePasswordInput, type MfaCodeInput, type MfaDisableInput,
} from "@/shared/schemas/identity";

interface SessionRow { id: string; ip: string | null; userAgent: string | null; current: boolean; lastSeenAt: string }

interface Props {
  email: string;
  emailVerified: boolean;
  mfa: { enabled: boolean; recoveryCodesRemaining: number };
  sessions: SessionRow[];
}

export function SecurityView({ email, emailVerified, mfa, sessions }: Props) {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Security" description="Protect your account and review where you are signed in." />
      <EmailPanel email={email} verified={emailVerified} />
      <PasswordPanel />
      <MfaPanel mfa={mfa} />
      <SessionsPanel sessions={sessions} />
    </div>
  );
}

function EmailPanel({ email, verified }: { email: string; verified: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const resend = async () => {
    setBusy(true);
    try {
      await post("/me/verification");
      toast("Verification email sent. If mail delivery is not configured, nothing will arrive.", "success");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not send the email", "danger");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Email address">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-2 text-sm">
          <span>{email}</span>
          <Badge tone={verified ? "success" : "warning"}>{verified ? "Verified" : "Not verified"}</Badge>
        </div>
        {!verified && (
          <Button size="sm" loading={busy} onClick={resend}>
            Send verification email
          </Button>
        )}
      </div>
    </Panel>
  );
}

function PasswordPanel() {
  const hydrated = useHydrated();
  const toast = useToast();
  const router = useRouter();
  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", newPassword: "" },
  });
  const { error, run } = useSubmit<ChangePasswordInput>(async (v) => {
    await post("/me/password", v);
    form.reset();
    toast("Password changed. Other devices were signed out.", "success");
    router.refresh();
  });
  const { errors, isSubmitting } = form.formState;
  return (
    <Panel title="Password">
      <form onSubmit={form.handleSubmit(run)} className="space-y-4 p-4" noValidate>
        <ErrorNote message={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Current password" error={errors.currentPassword?.message}>
            {(id, d) => <Input id={id} type="password" autoComplete="current-password" aria-describedby={d} aria-invalid={!!errors.currentPassword} {...form.register("currentPassword")} />}
          </Field>
          <Field label="New password" error={errors.newPassword?.message} hint="At least 10 characters.">
            {(id, d) => <Input id={id} type="password" autoComplete="new-password" aria-describedby={d} aria-invalid={!!errors.newPassword} {...form.register("newPassword")} />}
          </Field>
        </div>
        <Button type="submit" variant="primary" loading={isSubmitting} disabled={!hydrated}>
          Change password
        </Button>
      </form>
    </Panel>
  );
}

interface Setup { secret: string; otpauthUri: string; qrSvg: string }

function MfaPanel({ mfa }: { mfa: Props["mfa"] }) {
  const toast = useToast();
  const router = useRouter();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [busy, setBusy] = useState(false);

  const begin = async () => {
    setBusy(true);
    try {
      setSetup(await post<Setup>("/me/mfa"));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not start setup", "danger");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Two-factor authentication" action={<Badge tone={mfa.enabled ? "success" : "neutral"}>{mfa.enabled ? "On" : "Off"}</Badge>}>
      <div className="space-y-3 p-4 text-sm">
        {mfa.enabled ? (
          <>
            <p className="text-muted">
              Sign-in asks for a code from your authenticator app. You have <strong className="text-fg">{mfa.recoveryCodesRemaining}</strong> unused recovery{" "}
              {mfa.recoveryCodesRemaining === 1 ? "code" : "codes"}.
            </p>
            <Button variant="danger" size="sm" onClick={() => setDisabling(true)}>
              Turn off two-factor authentication
            </Button>
          </>
        ) : (
          <>
            <p className="text-muted">Add a second step at sign-in using an authenticator app such as 1Password, Authy or Google Authenticator.</p>
            <Button variant="primary" size="sm" loading={busy} onClick={begin}>
              Set up two-factor authentication
            </Button>
          </>
        )}
      </div>

      <Modal open={!!setup} onClose={() => setSetup(null)} title="Set up two-factor authentication" description="Scan the QR code, then enter the 6-digit code it shows.">
        {setup && (
          <EnableForm
            setup={setup}
            onEnabled={(recovery) => {
              setSetup(null);
              setCodes(recovery);
              router.refresh();
            }}
          />
        )}
      </Modal>

      <Modal open={!!codes} onClose={() => setCodes(null)} title="Save your recovery codes" description="Each code works once if you lose your authenticator. They will not be shown again.">
        {codes && <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />}
      </Modal>

      <Modal open={disabling} onClose={() => setDisabling(false)} title="Turn off two-factor authentication" description="Confirm with your password and a current code.">
        <DisableForm
          onDisabled={() => {
            setDisabling(false);
            toast("Two-factor authentication is off", "success");
            router.refresh();
          }}
        />
      </Modal>
    </Panel>
  );
}

function EnableForm({ setup, onEnabled }: { setup: Setup; onEnabled: (codes: string[]) => void }) {
  const form = useForm<MfaCodeInput>({ resolver: zodResolver(mfaCodeSchema), defaultValues: { code: "" } });
  const { error, run } = useSubmit<MfaCodeInput>(async (v) => {
    const res = await post<{ recoveryCodes: string[] }>("/me/mfa/enable", v);
    onEnabled(res.recoveryCodes);
  });
  const { errors, isSubmitting } = form.formState;
  return (
    <form onSubmit={form.handleSubmit(run)} className="space-y-4" noValidate>
      {/* The SVG is generated on the server from our own otpauth URI. */}
      <div className="flex justify-center rounded-lg bg-white p-2" dangerouslySetInnerHTML={{ __html: setup.qrSvg }} />
      <p className="text-xs text-muted">
        Can&apos;t scan? Enter this key manually: <code className="break-all rounded bg-surface-2 px-1.5 py-0.5 text-fg">{setup.secret}</code>
      </p>
      <ErrorNote message={error} />
      <Field label="6-digit code" error={errors.code?.message}>
        {(id, d) => <Input id={id} inputMode="numeric" autoComplete="one-time-code" autoFocus aria-describedby={d} aria-invalid={!!errors.code} {...form.register("code")} />}
      </Field>
      <Button type="submit" variant="primary" className="w-full" loading={isSubmitting}>
        Turn on
      </Button>
    </form>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      toast("Copied", "success");
    } catch {
      toast("Copy failed. Select the codes and copy them manually.", "danger");
    }
  };
  return (
    <div className="space-y-4">
      <ul className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-surface-2 p-3 font-mono text-sm">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button onClick={copy}>
          <Copy className="h-4 w-4" aria-hidden /> Copy
        </Button>
        <Button variant="primary" onClick={onDone}>
          I have saved them
        </Button>
      </div>
    </div>
  );
}

function DisableForm({ onDisabled }: { onDisabled: () => void }) {
  const form = useForm<MfaDisableInput>({ resolver: zodResolver(mfaDisableSchema), defaultValues: { password: "", code: "" } });
  const { error, run } = useSubmit<MfaDisableInput>(async (v) => {
    await post("/me/mfa/disable", v);
    onDisabled();
  });
  const { errors, isSubmitting } = form.formState;
  return (
    <form onSubmit={form.handleSubmit(run)} className="space-y-4" noValidate>
      <ErrorNote message={error} />
      <Field label="Password" error={errors.password?.message}>
        {(id, d) => <Input id={id} type="password" autoComplete="current-password" autoFocus aria-describedby={d} aria-invalid={!!errors.password} {...form.register("password")} />}
      </Field>
      <Field label="Authenticator or recovery code" error={errors.code?.message}>
        {(id, d) => <Input id={id} autoComplete="one-time-code" aria-describedby={d} aria-invalid={!!errors.code} {...form.register("code")} />}
      </Field>
      <Button type="submit" variant="danger" className="w-full" loading={isSubmitting}>
        Turn off
      </Button>
    </form>
  );
}

function SessionsPanel({ sessions }: { sessions: SessionRow[] }) {
  const toast = useToast();
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const revoke = async (id: string) => {
    setBusyId(id);
    try {
      await del(`/me/sessions/${id}`);
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not sign out that session", "danger");
    } finally {
      setBusyId(null);
    }
  };
  return (
    <Panel title="Active sessions">
      <ul className="divide-y divide-border">
        {sessions.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
            <div className="min-w-0">
              <p className="truncate font-medium">
                {describeAgent(s.userAgent)} {s.current && <Badge tone="accent" className="ml-1">This device</Badge>}
              </p>
              <p className="text-xs text-muted">
                {s.ip ?? "Unknown IP"} · active {relativeTime(s.lastSeenAt)}
              </p>
            </div>
            {!s.current && (
              <Button size="sm" loading={busyId === s.id} onClick={() => revoke(s.id)}>
                Sign out
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function describeAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}
