import { api } from "@/server/http/api";
import { resendVerification } from "@/server/modules/identity/account.service";

export const POST = api(async ({ ctx }) => {
  await resendVerification(ctx);
  return { ok: true };
});
