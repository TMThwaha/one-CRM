import { publicApi } from "@/server/http/api";
import { setSessionCookie } from "@/server/http/session";
import { acceptInvitation, previewInvitation } from "@/server/modules/identity/team.service";
import { acceptInviteSchema } from "@/shared/schemas/identity";

export const GET = publicApi(({ params }) => previewInvitation(params.token));
export const POST = publicApi(async ({ params, body, ip, userAgent }) => {
  const s = await acceptInvitation(params.token, acceptInviteSchema.parse(await body()), { ip, userAgent });
  await setSessionCookie(s.token, s.expiresAt);
  return { ok: true };
});
