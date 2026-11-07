import { api } from "@/server/http/api";
import { listAuditLogs } from "@/server/modules/platform/audit.service";

export const GET = api(({ ctx, query }) => listAuditLogs(ctx, query));
