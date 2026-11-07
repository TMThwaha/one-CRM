import type { Metadata } from "next";
import Link from "next/link";
import { AcceptInviteForm } from "@/components/auth/auth-forms";
import { previewInvitation } from "@/server/modules/identity/team.service";
import { AppError } from "@/server/platform/errors";

export const metadata: Metadata = { title: "Accept invitation" };

export default async function AcceptInvitePage({ params }: PageProps<"/accept-invite/[token]">) {
  const { token } = await params;
  let inv: Awaited<ReturnType<typeof previewInvitation>> | null = null;
  try {
    inv = await previewInvitation(token);
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
  }
  if (inv) return <AcceptInviteForm token={token} {...inv} />;
  {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">This invitation is not valid</h1>
        <p className="text-sm text-muted">It may have expired, been revoked, or already been used. Ask your administrator to send a new one.</p>
        <Link href="/login" className="text-sm font-medium text-accent hover:underline">
          Go to sign in
        </Link>
      </div>
    );
  }
}
