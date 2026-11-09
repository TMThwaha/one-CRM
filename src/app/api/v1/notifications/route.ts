import { api } from "@/server/http/api";
import { listNotifications } from "@/server/modules/platform/notifications.service";

export const GET = api(({ ctx }) => listNotifications(ctx));
