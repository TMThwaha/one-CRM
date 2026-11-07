import { eq, type SQL, type AnyColumn } from "drizzle-orm";
import { conflict } from "@/server/platform/errors";
import { isOwnOnly, type AuthContext } from "@/server/modules/identity/context";
import type { Scope } from "@/shared/permissions";

/** Escapes LIKE wildcards so user input is matched literally. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, "\\$&")}%`;
}

/** Record-level scope: restricts to records owned by the actor unless they hold `all`. */
export function ownerCondition(ctx: AuthContext, scope: Scope, ownerColumn: AnyColumn): SQL | undefined {
  return isOwnOnly(scope) ? eq(ownerColumn, ctx.userId) : undefined;
}

export function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}

export function isForeignKeyViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23503" || err?.cause?.code === "23503";
}

/** Optimistic concurrency check shared by every updatable record. */
export function assertVersion(current: number, expected: number | undefined, what: string) {
  if (expected !== undefined && expected !== current) {
    throw conflict(`This ${what} was changed by someone else. Reload to see the latest version.`, {
      currentVersion: current,
    });
  }
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Names the changed fields (not values of free text) for audit entries. */
export function diff<T extends Record<string, unknown>>(before: T, patch: Partial<T>) {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const b = before[k];
    if (JSON.stringify(b) !== JSON.stringify(v)) out[k] = { from: b, to: v };
  }
  return out;
}
