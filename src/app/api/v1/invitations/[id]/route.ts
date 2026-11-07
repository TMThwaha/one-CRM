import { api } from "@/server/http/api";
import { revokeInvitation } from "@/server/modules/identity/team.service";

export const DELETE = api(async ({ ctx, params }) => { await revokeInvitation(ctx, params.id); });
