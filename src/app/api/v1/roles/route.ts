import { api } from "@/server/http/api";
import { createRole } from "@/server/modules/identity/roles.service";
import { listRoles } from "@/server/modules/identity/team.service";

export const GET = api(({ ctx }) => listRoles(ctx));
export const POST = api(async ({ ctx, body }) => createRole(ctx, await body()), { status: 201 });
