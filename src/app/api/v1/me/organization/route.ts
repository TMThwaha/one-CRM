import { api } from "@/server/http/api";
import { z } from "zod";
import { switchOrganization } from "@/server/modules/identity/auth.service";

export const POST = api(async ({ ctx, body }) => {
  const { organizationId } = z.object({ organizationId: z.string().uuid() }).parse(await body());
  await switchOrganization(ctx, organizationId);
  return { ok: true };
});
