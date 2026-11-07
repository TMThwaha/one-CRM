import { api } from "@/server/http/api";
import { createCompany, listCompanies } from "@/server/modules/crm/companies.service";

export const GET = api(({ ctx, query }) => listCompanies(ctx, query));
export const POST = api(async ({ ctx, body }) => createCompany(ctx, (await body()) as never), { status: 201 });
