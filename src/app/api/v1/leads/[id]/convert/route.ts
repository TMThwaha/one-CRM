import { api } from "@/server/http/api";
import { convertLead } from "@/server/modules/crm/leads.service";

export const POST = api(async ({ ctx, params, body }) => convertLead(ctx, params.id, await body().catch(() => ({}))));
