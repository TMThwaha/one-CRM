import { api } from "@/server/http/api";
import { globalSearch } from "@/server/modules/platform/search.service";

export const GET = api(({ ctx, query }) => globalSearch(ctx, query.q ?? ""));
