import { SecurityView } from "@/components/views/security-view";
import { requirePlatformAdmin } from "@/server/http/session";
import { isEmailVerified, listMySessions, mfaStatus } from "@/server/modules/identity/account.service";

export const metadata = { title: "Security" };

export default async function SuperAdminSecurityPage() {
  const me = await requirePlatformAdmin();
  const [mfa, sessions, verified] = await Promise.all([mfaStatus(me), listMySessions(me), isEmailVerified(me.userId)]);
  return (
    <SecurityView
      email={me.userEmail}
      emailVerified={verified}
      mfa={mfa}
      sessions={sessions.map((s) => ({ id: s.id, ip: s.ip, userAgent: s.userAgent, current: s.current, lastSeenAt: s.lastSeenAt.toISOString() }))}
    />
  );
}
