import { z } from "zod";
import { platformApi } from "@/server/http/api";
import { updateCompany } from "@/server/modules/platform-admin/company.service";
import { getCompanyDetail } from "@/server/modules/platform-admin/queries.service";

const id = (p: Record<string, string>) => z.string().uuid().parse(p.id);

export const GET = platformApi(async ({ params }) => getCompanyDetail(id(params)));
export const PATCH = platformApi(async ({ ctx, params, body }) => updateCompany(ctx, id(params), await body()));
