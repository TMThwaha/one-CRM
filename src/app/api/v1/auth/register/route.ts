import { publicApi } from "@/server/http/api";
import { setSessionCookie } from "@/server/http/session";
import { register } from "@/server/modules/identity/auth.service";
import { getConfig } from "@/server/platform/config";
import { notFound } from "@/server/platform/errors";
import { registerSchema } from "@/shared/schemas/identity";

/**
 * OneCRM is centrally managed: companies are created by the Super Admin, not by visitors. This
 * endpoint answers 404 unless self-service sign-up was explicitly enabled (development only).
 */
export const POST = publicApi(async ({ body, ip, userAgent }) => {
  if (getConfig().ALLOW_PUBLIC_REGISTRATION !== "true") throw notFound("Resource");
  const input = registerSchema.parse(await body());
  const s = await register(input, { ip, userAgent });
  await setSessionCookie(s.token, s.expiresAt);
  return { ok: true };
}, { status: 201 });
