import { publicApi } from "@/server/http/api";
import { resetPassword } from "@/server/modules/identity/account.service";
import { resetPasswordSchema } from "@/shared/schemas/identity";

export const POST = publicApi(async ({ body, ip, userAgent }) => {
  const { token, password } = resetPasswordSchema.parse(await body());
  await resetPassword(token, password, { ip, userAgent });
  return { ok: true };
});
