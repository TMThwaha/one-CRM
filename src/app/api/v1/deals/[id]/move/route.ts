import { api } from "@/server/http/api";
import { moveDeal } from "@/server/modules/sales/deals.service";

export const POST = api(async ({ ctx, params, body }) => moveDeal(ctx, params.id, await body()));
