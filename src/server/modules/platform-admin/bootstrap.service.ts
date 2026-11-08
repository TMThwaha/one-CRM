import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDatabase } from "@/server/db/client";
import { platformAdmins, users } from "@/server/db/schema";
import { getConfig } from "@/server/platform/config";
import { hashPassword } from "@/server/platform/crypto";
import { conflict, notFound } from "@/server/platform/errors";
import { enforceRateLimit } from "@/server/platform/rate-limit";
import { bootstrapSchema, type BootstrapInput } from "@/shared/schemas/platform";
import type { RequestMeta } from "../identity/auth.service";
import { platformAudit } from "./audit";

const sha = (v: string) => createHash("sha256").update(v).digest();

/** Is first-time setup available? Only while NO Super Admin exists AND the operator set a token. */
export async function isBootstrapOpen(): Promise<boolean> {
  if (!getConfig().BOOTSTRAP_TOKEN) return false;
  const { db } = await getDatabase();
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(platformAdmins);
  return row.n === 0;
}

/**
 * Creates the FIRST Super Admin. There is no other way to create one: no public registration, no
 * API for promoting an existing account, no default credentials.
 *
 * Authorisation is proof of server access: the caller must present BOOTSTRAP_TOKEN, a secret only
 * the operator can set. After the first Super Admin exists this permanently refuses (404).
 */
export async function bootstrapSuperAdmin(input: BootstrapInput, meta: RequestMeta): Promise<void> {
  await enforceRateLimit(`bootstrap:ip:${meta.ip ?? "unknown"}`, 5, 60 * 60_000);
  await enforceRateLimit("bootstrap:global", 20, 60 * 60_000);
  const expected = getConfig().BOOTSTRAP_TOKEN;
  if (!expected) throw notFound("Setup");
  const data = bootstrapSchema.parse(input);
  // Compare digests so length differences and timing reveal nothing about the token.
  if (!timingSafeEqual(sha(data.token), sha(expected))) throw notFound("Setup");

  const { db } = await getDatabase();
  const passwordHash = await hashPassword(data.password);
  await db.transaction(async (tx) => {
    // Serialise concurrent setup attempts, then re-check inside the lock.
    await tx.execute(sql`lock table platform_admins in exclusive mode`);
    const [existing] = await tx.select({ n: sql<number>`count(*)::int` }).from(platformAdmins);
    if (existing.n > 0) throw notFound("Setup");

    const [taken] = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${data.email}`);
    // Never promote an existing account: a Super Admin is always a brand-new, dedicated identity.
    if (taken) throw conflict("That email already belongs to an account. Use a dedicated email address for the Super Admin.");

    const [user] = await tx
      .insert(users)
      .values({ email: data.email, name: data.name, passwordHash, emailVerifiedAt: new Date() })
      .returning({ id: users.id });
    await tx.insert(platformAdmins).values({ userId: user.id });
    await platformAudit(
      tx,
      { userId: user.id, userEmail: data.email, ip: meta.ip ?? null },
      { action: "platform.bootstrap", entityType: "platform_admin", entityId: user.id, summary: `First Super Admin created (${data.email})` },
    );
  });
}
