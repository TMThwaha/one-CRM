import { api } from "@/server/http/api";
import { getBoard } from "@/server/modules/sales/deals.service";

export const GET = api(({ ctx, query }) => getBoard(ctx, query.pipelineId));
