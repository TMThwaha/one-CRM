import type { Metadata } from "next";
import { SecurityView } from "@/components/views/security-view";
import { requireAuth } from "@/server/http/session";
import { isEmailVerified, listMySessions, mfaStatus } from "@/server/modules/identity/account.service";

export const metadata: Metadata = { title: "Security" };

export default async function SecurityPage() {
  const ctx = await requireAuth();
  const [mfa, sessions, verified] = await Promise.all([mfaStatus(ctx), listMySessions(ctx), isEmailVerified(ctx.userId)]);
  return (
    <SecurityView
      email={ctx.userEmail}
      emailVerified={verified}
      mfa={mfa}
      sessions={sessions.map((s) => ({
        id: s.id,
        ip: s.ip,
        userAgent: s.userAgent,
        current: s.current,
        lastSeenAt: s.lastSeenAt.toISOString(),
      }))}
    />
  );
}
