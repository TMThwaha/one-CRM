import { z } from "zod";
import { platformApi } from "@/server/http/api";
import { setCompanyStatus } from "@/server/modules/platform-admin/company.service";

export const POST = platformApi(async ({ ctx, params, body }) =>
  setCompanyStatus(ctx, z.string().uuid().parse(params.id), await body()),
);
