import { z } from "zod";
import { platformApi } from "@/server/http/api";
import { demoteAdministrator } from "@/server/modules/platform-admin/company.service";

/** Steps a Company Admin down to Admin (refused for the last active Company Admin). */
export const DELETE = platformApi(async ({ ctx, params }) =>
  demoteAdministrator(ctx, z.string().uuid().parse(params.id), z.string().uuid().parse(params.membershipId)),
);
