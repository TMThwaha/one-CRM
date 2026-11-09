import { z } from "zod";
import { platformApi } from "@/server/http/api";
import { cancelJob } from "@/server/modules/platform-admin/jobs.service";

export const POST = platformApi(async ({ ctx, params }) => cancelJob(ctx, z.string().uuid().parse(params.id)));
