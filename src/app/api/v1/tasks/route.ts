import { api } from "@/server/http/api";
import { createTask, listTasks } from "@/server/modules/workforce/tasks.service";

export const GET = api(({ ctx, query }) => listTasks(ctx, query));
export const POST = api(async ({ ctx, body }) => createTask(ctx, (await body()) as never), { status: 201 });
