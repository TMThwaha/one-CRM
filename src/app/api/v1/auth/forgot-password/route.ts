import { publicApi } from "@/server/http/api";
import { requestPasswordReset } from "@/server/modules/identity/account.service";
import { forgotPasswordSchema } from "@/shared/schemas/identity";

/** Same response whether or not the account exists. */
export const POST = publicApi(async ({ body, ip, userAgent }) => {
  const { email } = forgotPasswordSchema.parse(await body());
  await requestPasswordReset(email, { ip, userAgent });
  return { ok: true };
});
