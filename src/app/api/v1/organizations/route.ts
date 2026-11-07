import { api } from "@/server/http/api";
import { createAdditionalOrganization } from "@/server/modules/identity/auth.service";

export const POST = api(async ({ ctx, body }) => createAdditionalOrganization(ctx, (await body()) as { name: string }), { status: 201 });
