import { publicApi } from "@/server/http/api";
import { bootstrapSuperAdmin } from "@/server/modules/platform-admin/bootstrap.service";
import { bootstrapSchema } from "@/shared/schemas/platform";

/** One-time creation of the first Super Admin. 404 once one exists or if no BOOTSTRAP_TOKEN is set. */
export const POST = publicApi(async ({ body, ip, userAgent }) => {
  const input = bootstrapSchema.parse(await body());
  await bootstrapSuperAdmin(input, { ip, userAgent });
  return { ok: true };
}, { status: 201 });
