import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDatabase } from "@/server/db/client";
import { platformAdmins, sessions, users } from "@/server/db/schema";
import { hashToken } from "@/server/platform/crypto";

/**
 * The authenticated identity of a Global Super Admin for one request.
 *
 * This is a DIFFERENT type and a DIFFERENT resolver from the company AuthContext on purpose: a
 * company role (even Company Admin) can never satisfy it, and it carries no organization, so it
 * cannot be passed to any tenant-scoped service by mistake.
 */
export interface PlatformContext {
  userId: string;
  userName: string;
  userEmail: string;
  sessionId: string;
  mfaEnabled: boolean;
  ip?: string | null;
}

/**
 * Re-validated on every request: live session, user not disabled, and a row in platform_admins.
 * Revoking the row (or disabling the user) takes effect on the next request.
 */
export async function resolvePlatformContext(
  token: string | undefined | null,
  meta: { ip?: string | null } = {},
): Promise<PlatformContext | null> {
  if (!token) return null;
  const { db } = await getDatabase();
  const now = new Date();
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(platformAdmins, eq(platformAdmins.userId, users.id))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        isNull(sessions.revokedAt),
        eq(sessions.mfaPending, false),
        gt(sessions.expiresAt, now),
        isNull(users.disabledAt),
      ),
    );
  if (!row) return null;
  if (now.getTime() - row.session.lastSeenAt.getTime() > 60_000) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.session.id));
  }
  return {
    userId: row.user.id,
    userName: row.user.name,
    userEmail: row.user.email,
    sessionId: row.session.id,
    mfaEnabled: Boolean(row.user.mfaEnabledAt),
    ip: meta.ip ?? null,
  };
}
