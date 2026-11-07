import "server-only";
import { sql } from "drizzle-orm";
import type { PgTransaction, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import { getDatabase } from "./client";
import type * as schema from "./schema";

export type Tx = PgTransaction<PgQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>;

export interface TenantScope {
  organizationId: string;
  userId: string;
}

/**
 * The ONLY way tenant-owned data is accessed.
 *
 * Opens a transaction, switches to the restricted `onecrm_app` role (subject to RLS) and pins
 * the organization for that transaction. A forgotten WHERE clause therefore cannot leak rows,
 * and a bug cannot write into another tenant. Both settings are transaction-local.
 */
export async function withTenant<T>(scope: TenantScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const { db } = await getDatabase();
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.org_id', ${scope.organizationId}, true), set_config('app.user_id', ${scope.userId}, true)`,
    );
    await tx.execute(sql`set local role onecrm_app`);
    return fn(tx as unknown as Tx);
  });
}
