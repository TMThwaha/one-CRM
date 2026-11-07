import { api } from "@/server/http/api";
import { createLead, listLeads } from "@/server/modules/crm/leads.service";

export const GET = api(({ ctx, query }) => listLeads(ctx, query));
export const POST = api(async ({ ctx, body }) => createLead(ctx, (await body()) as never), { status: 201 });
