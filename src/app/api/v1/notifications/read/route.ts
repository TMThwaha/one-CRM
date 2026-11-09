import { api } from "@/server/http/api";
import { markNotificationsRead } from "@/server/modules/platform/notifications.service";

export const POST = api(async ({ ctx, body }) => markNotificationsRead(ctx, await body()));
