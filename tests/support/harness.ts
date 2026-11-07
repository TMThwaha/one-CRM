import { createPgliteDatabase, setDatabaseForTesting, type DatabaseHandle } from "@/server/db/client";
import { resolveAuthContext, register } from "@/server/modules/identity/auth.service";
import { createInvitation, acceptInvitation } from "@/server/modules/identity/team.service";
import type { AuthContext } from "@/server/modules/identity/context";
import { resetRateLimits } from "@/server/platform/rate-limit";

let counter = 0;

export async function startTestDatabase(): Promise<DatabaseHandle> {
  const handle = await createPgliteDatabase(); // in-memory, real migrations applied
  setDatabaseForTesting(handle);
  await resetRateLimits();
  return handle;
}

/** Registers a user + organization and returns the resolved AuthContext of the owner. */
export async function signUpOrg(label: string): Promise<{ ctx: AuthContext; token: string; email: string }> {
  const n = ++counter;
  const email = `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${n}@example.test`;
  const session = await register(
    { name: `${label} Owner`, email, password: "correct-horse-battery", organizationName: `${label} Inc` },
    { ip: `10.0.0.${n}` },
  );
  const ctx = await resolveAuthContext(session.token);
  if (!ctx) throw new Error("expected context");
  return { ctx, token: session.token, email };
}

/** Invites a person with the given role into the owner's org and returns their context. */
export async function addMember(owner: AuthContext, label: string, roleKey: string) {
  const n = ++counter;
  const email = `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${n}@example.test`;
  const { token } = await createInvitation(owner, { email, roleKey });
  const session = await acceptInvitation(
    token,
    { name: label, password: "correct-horse-battery" },
    { ip: `10.1.0.${n}` },
  );
  const ctx = await resolveAuthContext(session.token);
  if (!ctx) throw new Error("expected context");
  return { ctx, token: session.token, email };
}

/** Raw `execute()` results are untyped on the shared Database type. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Rows = { rows: Record<string, any>[] };
