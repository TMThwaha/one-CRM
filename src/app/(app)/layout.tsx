import { AppShell } from "@/components/shell/app-shell";
import { requireAuth } from "@/server/http/session";
import { getOrganizationBasics } from "@/server/modules/identity/org.service";
import { listMyOrganizations } from "@/server/modules/identity/auth.service";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAuth();
  const [orgs, org] = await Promise.all([listMyOrganizations(ctx.userId), getOrganizationBasics(ctx)]);
  return (
    <AppShell
      session={{
        user: { id: ctx.userId, name: ctx.userName, email: ctx.userEmail },
        organization: org,
        role: { key: ctx.roleKey, name: ctx.roleName },
        permissions: ctx.permissions,
        organizations: orgs.map((o) => ({ id: o.id, name: o.name, roleName: o.roleName })),
      }}
    >
      {children}
    </AppShell>
  );
}
