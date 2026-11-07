import { api } from "@/server/http/api";
import { listMembers } from "@/server/modules/identity/team.service";

export const GET = api(({ ctx }) => listMembers(ctx));
