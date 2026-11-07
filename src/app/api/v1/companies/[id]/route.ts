import { api } from "@/server/http/api";
import { deleteCompany, getCompany, updateCompany } from "@/server/modules/crm/companies.service";

export const GET = api(({ ctx, params }) => getCompany(ctx, params.id));
export const PATCH = api(async ({ ctx, params, body }) => updateCompany(ctx, params.id, await body()));
export const DELETE = api(async ({ ctx, params }) => { await deleteCompany(ctx, params.id); });
