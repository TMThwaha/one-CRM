import { api } from "@/server/http/api";
import { deleteTask, updateTask } from "@/server/modules/workforce/tasks.service";

export const PATCH = api(async ({ ctx, params, body }) => updateTask(ctx, params.id, await body()));
export const DELETE = api(async ({ ctx, params }) => { await deleteTask(ctx, params.id); });
