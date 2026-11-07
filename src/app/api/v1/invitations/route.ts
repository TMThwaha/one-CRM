import { api } from "@/server/http/api";
import { createInvitation, listInvitations } from "@/server/modules/identity/team.service";
import { inviteSchema } from "@/shared/schemas/identity";

export const GET = api(({ ctx }) => listInvitations(ctx));
export const POST = api(async ({ ctx, body }) => {
  const { token, url, invitation, emailed } = await createInvitation(ctx, inviteSchema.parse(await body()));
  // The link is returned ONCE, to the inviter. `emailed` is true only when SMTP actually accepted the message.
  return { id: invitation.id, email: invitation.email, expiresAt: invitation.expiresAt, token, url, emailed };
}, { status: 201 });
