"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button, ErrorNote, Field, Input, useHydrated } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import {
  acceptInviteSchema, loginSchema, mfaCodeSchema, registerSchema,
  type AcceptInviteInput, type LoginInput, type MfaCodeInput, type RegisterInput,
} from "@/shared/schemas/identity";

export function useSubmit<T extends object>(fn: (v: T) => Promise<void>) {
  const [error, setError] = useState<string | null>(null);
  const run = async (values: T) => {
    setError(null);
    try {
      await fn(values);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
    }
  };
  return { error, run };
}

export function LoginForm() {
  const hydrated = useHydrated();
  const router = useRouter();
  const [step, setStep] = useState<"password" | "code">("password");
  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });
  const { error, run } = useSubmit<LoginInput>(async (v) => {
    const res = await api<{ mfaRequired?: boolean }>("/auth/login", { method: "POST", body: v });
    if (res?.mfaRequired) {
      setStep("code");
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  });
  const { errors, isSubmitting } = form.formState;
  if (step === "code") {
    return (
      <MfaCodeForm
        onDone={() => {
          router.replace("/dashboard");
          router.refresh();
        }}
        onBack={() => {
          form.resetField("password");
          setStep("password");
        }}
      />
    );
  }
  return (
    <form method="post" onSubmit={form.handleSubmit(run)} className="space-y-5" noValidate>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="mt-1 text-sm text-muted">Sign in to your workspace.</p>
      </div>
      <ErrorNote message={error} />
      <Field label="Email" error={errors.email?.message}>
        {(id, d) => <Input id={id} type="email" autoComplete="email" autoFocus aria-describedby={d} aria-invalid={!!errors.email} {...form.register("email")} />}
      </Field>
      <Field label="Password" error={errors.password?.message}>
        {(id, d) => <Input id={id} type="password" autoComplete="current-password" aria-describedby={d} aria-invalid={!!errors.password} {...form.register("password")} />}
      </Field>
      <Button type="submit" variant="primary" className="w-full" loading={isSubmitting} disabled={!hydrated}>
        Sign in
      </Button>
      <p className="text-center text-sm text-muted">
        <Link href="/forgot-password" className="font-medium text-accent hover:underline">
          Forgot your password?
        </Link>
      </p>
      <p className="text-center text-sm text-muted">
        New to ONECRM?{" "}
        <Link href="/register" className="font-medium text-accent hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}

function MfaCodeForm({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const hydrated = useHydrated();
  const form = useForm<MfaCodeInput>({ resolver: zodResolver(mfaCodeSchema), defaultValues: { code: "" } });
  const { error, run } = useSubmit<MfaCodeInput>(async (v) => {
    await api("/auth/mfa", { method: "POST", body: v });
    onDone();
  });
  const { errors, isSubmitting } = form.formState;
  return (
    <form method="post" onSubmit={form.handleSubmit(run)} className="space-y-5" noValidate>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Two-factor authentication</h1>
        <p className="mt-1 text-sm text-muted">Enter the 6-digit code from your authenticator app, or one of your recovery codes.</p>
      </div>
      <ErrorNote message={error} />
      <Field label="Authentication code" error={errors.code?.message}>
        {(id, d) => <Input id={id} autoComplete="one-time-code" autoFocus aria-describedby={d} aria-invalid={!!errors.code} {...form.register("code")} />}
      </Field>
      <Button type="submit" variant="primary" className="w-full" loading={isSubmitting} disabled={!hydrated}>
        Verify
      </Button>
      <p className="text-center text-sm text-muted">
        <button type="button" onClick={onBack} className="font-medium text-accent hover:underline">
          Back to sign in
        </button>
      </p>
    </form>
  );
}

export function RegisterForm() {
  const hydrated = useHydrated();
  const router = useRouter();
  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: "", email: "", password: "", organizationName: "" },
  });
  const { error, run } = useSubmit<RegisterInput>(async (v) => {
    await api("/auth/register", { method: "POST", body: v });
    router.replace("/dashboard");
    router.refresh();
  });
  const { errors, isSubmitting } = form.formState;
  return (
    <form method="post" onSubmit={form.handleSubmit(run)} className="space-y-5" noValidate>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Create your workspace</h1>
        <p className="mt-1 text-sm text-muted">You will be the owner. Invite your team afterwards.</p>
      </div>
      <ErrorNote message={error} />
      <Field label="Your name" error={errors.name?.message}>
        {(id, d) => <Input id={id} autoComplete="name" autoFocus aria-describedby={d} aria-invalid={!!errors.name} {...form.register("name")} />}
      </Field>
      <Field label="Work email" error={errors.email?.message}>
        {(id, d) => <Input id={id} type="email" autoComplete="email" aria-describedby={d} aria-invalid={!!errors.email} {...form.register("email")} />}
      </Field>
      <Field label="Password" error={errors.password?.message} hint="At least 10 characters.">
        {(id, d) => <Input id={id} type="password" autoComplete="new-password" aria-describedby={d} aria-invalid={!!errors.password} {...form.register("password")} />}
      </Field>
      <Field label="Company name" error={errors.organizationName?.message}>
        {(id, d) => <Input id={id} autoComplete="organization" aria-describedby={d} aria-invalid={!!errors.organizationName} {...form.register("organizationName")} />}
      </Field>
      <Button type="submit" variant="primary" className="w-full" loading={isSubmitting} disabled={!hydrated}>
        Create workspace
      </Button>
      <p className="text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}

export function AcceptInviteForm({
  token,
  email,
  organizationName,
  roleName,
  hasAccount,
}: {
  token: string;
  email: string;
  organizationName: string;
  roleName: string;
  hasAccount: boolean;
}) {
  const hydrated = useHydrated();
  const router = useRouter();
  const form = useForm<AcceptInviteInput>({
    resolver: zodResolver(acceptInviteSchema),
    defaultValues: { name: "", password: "" },
  });
  const { error, run } = useSubmit<AcceptInviteInput>(async (v) => {
    await api(`/invite/${token}`, { method: "POST", body: hasAccount ? { password: v.password } : v });
    router.replace("/dashboard");
    router.refresh();
  });
  const { errors, isSubmitting } = form.formState;
  return (
    <form method="post" onSubmit={form.handleSubmit(run)} className="space-y-5" noValidate>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Join {organizationName}</h1>
        <p className="mt-1 text-sm text-muted">
          You have been invited as <strong className="text-fg">{roleName}</strong> using <strong className="text-fg">{email}</strong>.
        </p>
      </div>
      <ErrorNote message={error} />
      {!hasAccount && (
        <Field label="Your name" error={errors.name?.message}>
          {(id, d) => <Input id={id} autoComplete="name" autoFocus aria-describedby={d} {...form.register("name")} />}
        </Field>
      )}
      <Field
        label={hasAccount ? "Your ONECRM password" : "Choose a password"}
        error={errors.password?.message}
        hint={hasAccount ? "You already have an account with this email." : "At least 10 characters."}
      >
        {(id, d) => (
          <Input
            id={id}
            type="password"
            autoComplete={hasAccount ? "current-password" : "new-password"}
            aria-describedby={d}
            {...form.register("password")}
          />
        )}
      </Field>
      <Button type="submit" variant="primary" className="w-full" loading={isSubmitting} disabled={!hydrated}>
        Join workspace
      </Button>
    </form>
  );
}
