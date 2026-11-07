import "server-only";
import { organizations } from "@/server/db/schema";
import { withTenant } from "@/server/db/tenant";
import type { AuthContext } from "./context";

export async function getOrganizationBasics(ctx: AuthContext) {
  return withTenant(ctx, async (tx) => {
    const [org] = await tx
      .select({ id: organizations.id, name: organizations.name, baseCurrency: organizations.baseCurrency })
      .from(organizations);
    return org;
  });
}
