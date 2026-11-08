"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useSubmit } from "@/components/auth/auth-forms";
import { Button, ErrorNote, Field, Input, useHydrated } from "@/components/ui";
import { api } from "@/lib/api";
import { bootstrapSchema, type BootstrapInput } from "@/shared/schemas/platform";

/** First-run only: creates the Global Super Admin. Authorised by the operator's BOOTSTRAP_TOKEN. */
export function SetupForm() {
  const hydrated = useHydrated();
  const [done, setDone] = useState(false);
  const form = useForm<BootstrapInput>({ resolver: zodResolver(bootstrapSchema), defaultValues: { token: "", name: "", email: "", password: "" } });
  const { error, run } = useSubmit<BootstrapInput>(async (v) => {
    await api("/auth/setup", { method: "POST", body: v });
    setDone(true);
  });
  const { errors, isSubmitting } = form.formState;

  if (done) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Super Admin created</h1>
        <p className="text-sm text-muted">
          Setup is now closed for good. Remove <code>BOOTSTRAP_TOKEN</code> from the server environment, then sign in and turn on two-factor authentication.
        </p>
        <Link href="/login" className="text-sm font-medium text-accent hover:underline">Go to sign in</Link>
      </div>
    );
  }
  return (
    <form method="post" onSubmit={form.handleSubmit(run)} className="space-y-5" noValidate>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Set up the platform</h1>
        <p className="mt-1 text-sm text-muted">Create the Global Super Admin. This page works once, and only for whoever holds the server&apos;s setup token.</p>
      </div>
      <ErrorNote message={error === "Setup not found" ? "The setup token is not correct, or setup is closed." : error} />
      <Field label="Setup token" error={errors.token?.message} hint="The BOOTSTRAP_TOKEN value from the server environment.">
        {(id, d) => <Input id={id} type="password" autoComplete="off" autoFocus aria-describedby={d} aria-invalid={!!errors.token} {...form.register("token")} />}
      </Field>
      <Field label="Your name" error={errors.name?.message}>
        {(id, d) => <Input id={id} autoComplete="name" aria-describedby={d} aria-invalid={!!errors.name} {...form.register("name")} />}
      </Field>
      <Field label="Email" error={errors.email?.message} hint="Use a dedicated address; an email that already has an account is refused.">
        {(id, d) => <Input id={id} type="email" autoComplete="email" aria-describedby={d} aria-invalid={!!errors.email} {...form.register("email")} />}
      </Field>
      <Field label="Password" error={errors.password?.message} hint="At least 10 characters.">
        {(id, d) => <Input id={id} type="password" autoComplete="new-password" aria-describedby={d} aria-invalid={!!errors.password} {...form.register("password")} />}
      </Field>
      <Button type="submit" variant="primary" className="w-full" loading={isSubmitting} disabled={!hydrated}>Create Super Admin</Button>
    </form>
  );
}
