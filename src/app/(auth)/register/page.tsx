import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RegisterForm } from "@/components/auth/auth-forms";
import { getAuthContext } from "@/server/http/session";

export const metadata: Metadata = { title: "Create workspace" };

export default async function RegisterPage() {
  if (await getAuthContext()) redirect("/dashboard");
  return <RegisterForm />;
}
