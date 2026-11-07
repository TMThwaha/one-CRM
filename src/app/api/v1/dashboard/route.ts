import { api } from "@/server/http/api";
import { getDashboard } from "@/server/modules/platform/dashboard.service";

export const GET = api(({ ctx }) => getDashboard(ctx));
