import { api } from "@/server/http/api";
import { deleteActivity } from "@/server/modules/workforce/activities.service";

export const DELETE = api(async ({ ctx, params }) => { await deleteActivity(ctx, params.id); });
