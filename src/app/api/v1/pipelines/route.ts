import { api } from "@/server/http/api";
import { createPipeline, listPipelines } from "@/server/modules/sales/deals.service";

export const GET = api(({ ctx }) => listPipelines(ctx));
export const POST = api(async ({ ctx, body }) => createPipeline(ctx, await body()), { status: 201 });
