import { api } from "@/server/http/api";
import { listMyOrganizations } from "@/server/modules/identity/auth.service";

export const GET = api(async ({ ctx }) => ({
  user: { id: ctx.userId, name: ctx.userName, email: ctx.userEmail },
  organizationId: ctx.organizationId,
  role: { key: ctx.roleKey, name: ctx.roleName },
  permissions: ctx.permissions,
  organizations: await listMyOrganizations(ctx.userId),
}));
