import type { Metadata } from "next";
import { PlatformShell } from "@/components/platform/platform-shell";
import { requirePlatformAdmin } from "@/server/http/session";

export const metadata: Metadata = { title: { default: "Super Admin", template: "%s · Super Admin" }, robots: { index: false, follow: false } };

/**
 * Every /super-admin page is gated here, on the server, before anything renders. A signed-out
 * visitor is sent to sign-in; a signed-in Company Admin (or anyone else) gets a 404.
 */
export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const me = await requirePlatformAdmin();
  return (
    <PlatformShell user={{ name: me.userName, email: me.userEmail }} mfaEnabled={me.mfaEnabled}>
      {children}
    </PlatformShell>
  );
}
