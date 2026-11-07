import { api } from "@/server/http/api";
import { getTimeline } from "@/server/modules/workforce/activities.service";

export const GET = api(({ ctx, params, query }) =>
  getTimeline(ctx, { kind: "contact", id: params.id }, { before: query.before, limit: query.limit ? Number(query.limit) : undefined }));
