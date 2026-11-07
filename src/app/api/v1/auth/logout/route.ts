import { publicApi } from "@/server/http/api";
import { clearSessionCookie, getSessionToken } from "@/server/http/session";
import { logout } from "@/server/modules/identity/auth.service";

export const POST = publicApi(async () => {
  const token = await getSessionToken();
  if (token) await logout(token);
  await clearSessionCookie();
  return { ok: true };
});
