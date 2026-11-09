import "server-only";
import { desc, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { notifications } from "@/server/db/schema";
import { withTenant } from "@/server/db/tenant";
import type { AuthContext } from "@/server/modules/identity/context";

/**
 * The signed-in person's own notifications. Row-level security restricts rows to their organization AND
 * their user id, so even a bug here could not show someone else's notifications.
 */
export async function listNotifications(ctx: AuthContext, limit = 20) {
  return withTenant(ctx, async (tx) => {
    const items = await tx
      .select({
        id: notifications.id,
        type: notifications.type,
        title: notifications.title,
        body: notifications.body,
        link: notifications.link,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(notifications).where(isNull(notifications.readAt));
    return { items, unread: n };
  });
}

const readInput = z.union([
  z.object({ all: z.literal(true) }),
  z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }),
]);

export async function markNotificationsRead(ctx: AuthContext, input: unknown) {
  const data = readInput.parse(input);
  return withTenant(ctx, async (tx) => {
    const where = "all" in data ? isNull(notifications.readAt) : inArray(notifications.id, data.ids);
    const res = await tx.update(notifications).set({ readAt: new Date() }).where(where).returning({ id: notifications.id });
    return { updated: res.length };
  });
}
