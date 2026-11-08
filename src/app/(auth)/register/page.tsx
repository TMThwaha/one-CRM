import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { RegisterForm } from "@/components/auth/auth-forms";
import { getAuthContext } from "@/server/http/session";
import { getConfig } from "@/server/platform/config";

export const metadata: Metadata = { title: "Create workspace" };
// Reads server configuration per request; must never be prerendered at build time.
export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  // Centrally managed platform: companies are created by the Super Admin. 404 unless explicitly enabled.
  if (getConfig().ALLOW_PUBLIC_REGISTRATION !== "true") notFound();
  if (await getAuthContext()) redirect("/dashboard");
  return <RegisterForm />;
}
