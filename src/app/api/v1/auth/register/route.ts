import { publicApi } from "@/server/http/api";
import { setSessionCookie } from "@/server/http/session";
import { register } from "@/server/modules/identity/auth.service";
import { registerSchema } from "@/shared/schemas/identity";

export const POST = publicApi(async ({ body, ip, userAgent }) => {
  const input = registerSchema.parse(await body());
  const s = await register(input, { ip, userAgent });
  await setSessionCookie(s.token, s.expiresAt);
  return { ok: true };
}, { status: 201 });
