import { api } from "@/server/http/api";
import { removeDealContact } from "@/server/modules/sales/deals.service";

export const DELETE = api(async ({ ctx, params }) => { await removeDealContact(ctx, params.id, params.contactId); });
