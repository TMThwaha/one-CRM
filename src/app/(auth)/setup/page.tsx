import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SetupForm } from "@/components/auth/setup-form";
import { isBootstrapOpen } from "@/server/modules/platform-admin/bootstrap.service";

export const metadata: Metadata = { title: "Platform setup", robots: { index: false, follow: false } };
// Reads the database per request; must never be prerendered at build time.
export const dynamic = "force-dynamic";

/** 404 unless setup is genuinely open: no Super Admin yet AND the operator configured a token. */
export default async function SetupPage() {
  if (!(await isBootstrapOpen())) notFound();
  return <SetupForm />;
}
