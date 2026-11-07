import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/auth-forms";
import { getAuthContext } from "@/server/http/session";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getAuthContext()) redirect("/dashboard");
  return <LoginForm />;
}
