import { z } from "zod";
import { api } from "@/server/http/api";
import { revokeMySession } from "@/server/modules/identity/account.service";

export const DELETE = api(async ({ ctx, params }) => {
  await revokeMySession(ctx, z.string().uuid().parse(params.id));
  return { ok: true };
});
