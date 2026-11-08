import { accountApi } from "@/server/http/api";
import { resendVerification } from "@/server/modules/identity/account.service";

export const POST = accountApi(async ({ ctx }) => {
  await resendVerification(ctx);
  return { ok: true };
});
