import { api } from "@/server/http/api";
import { createActivity } from "@/server/modules/workforce/activities.service";

export const POST = api(async ({ ctx, body }) => createActivity(ctx, (await body()) as never), { status: 201 });
