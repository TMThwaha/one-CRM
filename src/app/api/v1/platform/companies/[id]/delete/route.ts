import { z } from "zod";
import { platformApi } from "@/server/http/api";
import { AppError, invalid } from "@/server/platform/errors";
import { deleteCompany } from "@/server/modules/platform-admin/company.service";

export const POST = platformApi(async ({ ctx, params, body }) => {
  try {
    return await deleteCompany(ctx, z.string().uuid().parse(params.id), await body());
  } catch (e) {
    // A wrong password is a form error, not a dead session (the client signs out on 401).
    if (e instanceof AppError && e.code === "unauthenticated") throw invalid(e.message);
    throw e;
  }
});
