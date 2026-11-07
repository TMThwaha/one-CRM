import { api } from "@/server/http/api";
import { deleteLead, getLead, updateLead } from "@/server/modules/crm/leads.service";

export const GET = api(({ ctx, params }) => getLead(ctx, params.id));
export const PATCH = api(async ({ ctx, params, body }) => updateLead(ctx, params.id, await body()));
export const DELETE = api(async ({ ctx, params }) => { await deleteLead(ctx, params.id); });
