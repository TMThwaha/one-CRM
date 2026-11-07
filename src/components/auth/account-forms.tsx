"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useSubmit } from "@/components/auth/auth-forms";
import { Button, ErrorNote, Field, Input, useHydrated } from "@/components/ui";
import { api } from "@/lib/api";
import {
  forgotPasswordSchema, resetPasswordFormSchema,
  type ForgotPasswordInput, type ResetPasswordFormInput,
} from "@/shared/schemas/identity";

export function ForgotPasswordForm() {
  const hydrated = useHydrated();
  const [sent, setSent] = useState(false);
  const form = useForm<ForgotPasswordInput>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: "" } });
  const { error, run } = useSubmit<ForgotPasswordInput>(async (v) => {
    await api("/auth/forgot-password", { method: "POST", body: v });
    setSent(true);
  });
  const { errors, isSubmitting } = form.formState;
  if (sent) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
        <p className="text-sm text-muted">
          If an account exists for that address, we have sent a link to choose a new password. It is valid for 60 minutes and can be used once.
        </p>
        <Link href="/login" className="text-sm font-medium text-accent hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }
  return (
    <form method="post" onSubmit={form.handleSubmit(run)} className="space-y-5" noValidate>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
        <p className="mt-1 text-sm text-muted">Enter your email and we will send you a reset link.</p>
      </div>
      <ErrorNote message={error} />
      <Field label="Email" error={errors.email?.message}>
        {(id, d) => <Input id={id} type="email" autoComplete="email" autoFocus aria-describedby={d} aria-invalid={!!errors.email} {...form.register("email")} />}
      </Field>
      <Button type="submit" variant="primary" className="w-full" loading={isSubmitting} disabled={!hydrated}>
        Send reset link
      </Button>
      <p className="text-center text-sm text-muted">
        <Link href="/login" className="font-medium text-accent hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const hydrated = useHydrated();
  const [done, setDone] = useState(false);
  const form = useForm<ResetPasswordFormInput>({ resolver: zodResolver(resetPasswordFormSchema), defaultValues: { password: "" } });
  const { error, run } = useSubmit<ResetPasswordFormInput>(async (v) => {
    await api("/auth/reset-password", { method: "POST", body: { token, password: v.password } });
    setDone(true);
  });
  const { errors, isSubmitting } = form.formState;
  if (done) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Password updated</h1>
        <p className="text-sm text-muted">You have been signed out everywhere. Sign in with your new password.</p>
        <Link href="/login" className="text-sm font-medium text-accent hover:underline">
          Go to sign in
        </Link>
      </div>
    );
  }
  return (
    <form method="post" onSubmit={form.handleSubmit(run)} className="space-y-5" noValidate>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
        <p className="mt-1 text-sm text-muted">This will sign you out of every device.</p>
      </div>
      <ErrorNote message={error?.startsWith("Link ") ? "This link is invalid, expired or already used. Request a new one." : error} />
      <Field label="New password" error={errors.password?.message} hint="At least 10 characters.">
        {(id, d) => <Input id={id} type="password" autoComplete="new-password" autoFocus aria-describedby={d} aria-invalid={!!errors.password} {...form.register("password")} />}
      </Field>
      <Button type="submit" variant="primary" className="w-full" loading={isSubmitting} disabled={!hydrated}>
        Update password
      </Button>
      <p className="text-center text-sm text-muted">
        <Link href="/forgot-password" className="font-medium text-accent hover:underline">
          Request a new link
        </Link>
      </p>
    </form>
  );
}

/** A button, not an auto-GET: mail scanners that prefetch links must not consume the token. */
export function VerifyEmailPanel({ token }: { token: string }) {
  const hydrated = useHydrated();
  const [state, setState] = useState<"idle" | "busy" | "done" | "failed">("idle");
  const confirm = async () => {
    setState("busy");
    try {
      await api("/auth/verify-email", { method: "POST", body: { token } });
      setState("done");
    } catch {
      setState("failed");
    }
  };
  if (state === "done") {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Email verified</h1>
        <p className="text-sm text-muted">Thanks. Your email address is confirmed.</p>
        <Link href="/dashboard" className="text-sm font-medium text-accent hover:underline">
          Continue to ONECRM
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Confirm your email</h1>
      <p className="text-sm text-muted">Select the button to confirm this email address for your ONECRM account.</p>
      <ErrorNote message={state === "failed" ? "This link is invalid, expired or already used. You can request a new one from your security settings." : null} />
      <Button variant="primary" className="w-full" loading={state === "busy"} disabled={!hydrated} onClick={confirm}>
        Confirm email
      </Button>
    </div>
  );
}
