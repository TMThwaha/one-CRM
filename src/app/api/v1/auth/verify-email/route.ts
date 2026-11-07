import { z } from "zod";
import { publicApi } from "@/server/http/api";
import { verifyEmail } from "@/server/modules/identity/account.service";

/** POST (not GET) so mail scanners that prefetch links cannot consume the token. */
export const POST = publicApi(async ({ body }) => {
  const { token } = z.object({ token: z.string().min(10).max(200) }).parse(await body());
  await verifyEmail(token);
  return { ok: true };
});
