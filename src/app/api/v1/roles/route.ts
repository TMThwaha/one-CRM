import { api } from "@/server/http/api";
import { listRoles } from "@/server/modules/identity/team.service";

export const GET = api(({ ctx }) => listRoles(ctx));
