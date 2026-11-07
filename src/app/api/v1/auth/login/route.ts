import { publicApi } from "@/server/http/api";
import { setSessionCookie } from "@/server/http/session";
import { login } from "@/server/modules/identity/auth.service";
import { loginSchema } from "@/shared/schemas/identity";

export const POST = publicApi(async ({ body, ip, userAgent }) => {
  const input = loginSchema.parse(await body());
  const s = await login(input, { ip, userAgent });
  // With MFA the cookie carries a short-lived *pending* session that grants nothing until the
  // second step completes.
  await setSessionCookie(s.token, s.expiresAt);
  return s.mfaRequired ? { ok: true, mfaRequired: true } : { ok: true };
});
