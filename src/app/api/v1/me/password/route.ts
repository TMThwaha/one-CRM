import { api } from "@/server/http/api";
import { changePassword } from "@/server/modules/identity/account.service";
import { AppError, invalid } from "@/server/platform/errors";
import { changePasswordSchema } from "@/shared/schemas/identity";

export const POST = api(async ({ ctx, body }) => {
  const input = changePasswordSchema.parse(await body());
  try {
    await changePassword(ctx, input);
  } catch (e) {
    if (e instanceof AppError && e.code === "unauthenticated") throw invalid(e.message);
    throw e;
  }
  return { ok: true };
});
