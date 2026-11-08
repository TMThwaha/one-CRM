import { api } from "@/server/http/api";
import { getCompanyProfile, updateCompanyProfile } from "@/server/modules/identity/org.service";

/** The signed-in Company Admin's own company. The company comes from the session, never the request. */
export const GET = api(async ({ ctx }) => getCompanyProfile(ctx));
export const PATCH = api(async ({ ctx, body }) => updateCompanyProfile(ctx, await body()));
