import { api } from "@/server/http/api";
import { updateMember } from "@/server/modules/identity/team.service";

export const PATCH = api(async ({ ctx, params, body }) => updateMember(ctx, params.id, await body()));
