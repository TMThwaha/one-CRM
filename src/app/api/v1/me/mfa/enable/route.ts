import { accountApi } from "@/server/http/api";
import { mfaEnable } from "@/server/modules/identity/account.service";
import { mfaCodeSchema } from "@/shared/schemas/identity";

export const POST = accountApi(async ({ ctx, body }) => mfaEnable(ctx, mfaCodeSchema.parse(await body()).code));
