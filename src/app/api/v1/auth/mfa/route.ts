import { publicApi } from "@/server/http/api";
import { getSessionToken, setSessionCookie } from "@/server/http/session";
import { completeMfaLogin } from "@/server/modules/identity/account.service";
import { mfaCodeSchema } from "@/shared/schemas/identity";

/** Second step of sign-in. */
export const POST = publicApi(async ({ body, ip, userAgent }) => {
  const { code } = mfaCodeSchema.parse(await body());
  const s = await completeMfaLogin(await getSessionToken(), code, { ip, userAgent });
  await setSessionCookie(s.token, s.expiresAt);
  return { ok: true, redirectTo: s.platformAdmin ? "/super-admin" : "/dashboard" };
});
