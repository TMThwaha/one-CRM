import { api } from "@/server/http/api";
import { mfaDisable } from "@/server/modules/identity/account.service";
import { AppError, invalid } from "@/server/platform/errors";
import { mfaDisableSchema } from "@/shared/schemas/identity";

export const POST = api(async ({ ctx, body }) => {
  const input = mfaDisableSchema.parse(await body());
  try {
    await mfaDisable(ctx, input);
  } catch (e) {
    // A wrong password is a form error, not a dead session (the client signs out on 401).
    if (e instanceof AppError && e.code === "unauthenticated") throw invalid(e.message);
    throw e;
  }
  return { ok: true };
});
