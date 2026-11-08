import { z } from "zod";
import { platformApi } from "@/server/http/api";
import { appointAdministrator } from "@/server/modules/platform-admin/company.service";

export const POST = platformApi(
  async ({ ctx, params, body }) => appointAdministrator(ctx, z.string().uuid().parse(params.id), await body()),
  { status: 201 },
);
