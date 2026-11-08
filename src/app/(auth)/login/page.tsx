import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/auth-forms";
import { getAuthContext, getPlatformContext } from "@/server/http/session";
import { getConfig } from "@/server/platform/config";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getPlatformContext()) redirect("/super-admin");
  if (await getAuthContext()) redirect("/dashboard");
  return <LoginForm allowRegistration={getConfig().ALLOW_PUBLIC_REGISTRATION === "true"} />;
}
