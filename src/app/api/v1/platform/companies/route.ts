import { platformApi } from "@/server/http/api";
import { createCompany } from "@/server/modules/platform-admin/company.service";
import { listCompanies } from "@/server/modules/platform-admin/queries.service";

export const GET = platformApi(async ({ query }) => listCompanies(query));
export const POST = platformApi(async ({ ctx, body }) => createCompany(ctx, (await body()) as never), { status: 201 });
