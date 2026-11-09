import { z } from "zod";
import { platformApi } from "@/server/http/api";
import { retryJob } from "@/server/modules/platform-admin/jobs.service";

export const POST = platformApi(async ({ ctx, params }) => retryJob(ctx, z.string().uuid().parse(params.id)));
