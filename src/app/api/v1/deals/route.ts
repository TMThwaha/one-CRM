import { api } from "@/server/http/api";
import { createDeal, listDeals } from "@/server/modules/sales/deals.service";

export const GET = api(({ ctx, query }) => listDeals(ctx, query));
export const POST = api(async ({ ctx, body }) => createDeal(ctx, (await body()) as never), { status: 201 });
