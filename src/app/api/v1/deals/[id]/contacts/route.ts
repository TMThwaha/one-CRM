import { api } from "@/server/http/api";
import { addDealContact } from "@/server/modules/sales/deals.service";

export const POST = api(async ({ ctx, params, body }) => { await addDealContact(ctx, params.id, await body()); }, { status: 201 });
