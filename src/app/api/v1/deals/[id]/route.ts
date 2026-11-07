import { api } from "@/server/http/api";
import { deleteDeal, getDeal, updateDeal } from "@/server/modules/sales/deals.service";

export const GET = api(({ ctx, params }) => getDeal(ctx, params.id));
export const PATCH = api(async ({ ctx, params, body }) => updateDeal(ctx, params.id, await body()));
export const DELETE = api(async ({ ctx, params }) => { await deleteDeal(ctx, params.id); });
