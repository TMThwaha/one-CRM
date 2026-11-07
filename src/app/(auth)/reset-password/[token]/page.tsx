import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth/account-forms";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ params }: PageProps<"/reset-password/[token]">) {
  const { token } = await params;
  return <ResetPasswordForm token={token} />;
}
