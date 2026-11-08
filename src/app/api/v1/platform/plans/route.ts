import { platformApi } from "@/server/http/api";
import { listPlans } from "@/server/modules/platform-admin/queries.service";

export const GET = platformApi(async () => listPlans());
