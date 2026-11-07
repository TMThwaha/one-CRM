import type { Metadata } from "next";
import { VerifyEmailPanel } from "@/components/auth/account-forms";

export const metadata: Metadata = { title: "Verify email" };

export default async function VerifyEmailPage({ params }: PageProps<"/verify-email/[token]">) {
  const { token } = await params;
  return <VerifyEmailPanel token={token} />;
}
