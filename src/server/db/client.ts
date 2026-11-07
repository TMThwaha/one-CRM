import "server-only";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import { getConfig } from "@/server/platform/config";
import * as schema from "./schema";

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DatabaseHandle {
  /** The owning connection. Bypasses RLS. Reserved for the identity module and migrations. */
  db: Database;
  kind: "pglite" | "postgres";
  close(): Promise<void>;
}

const MIGRATIONS = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "drizzle");

/** `dir` undefined => in-memory PGlite (tests). */
export async function createPgliteDatabase(dir?: string): Promise<DatabaseHandle> {
  if (dir) fs.mkdirSync(path.dirname(dir), { recursive: true });
  const client = new PGlite(dir);
  await client.waitReady;
  const db = drizzlePglite(client, { schema, casing: "snake_case" });
  await migratePglite(db, { migrationsFolder: MIGRATIONS });
  return { db: db as unknown as Database, kind: "pglite", close: () => client.close() };
}

export async function createPostgresDatabase(url: string): Promise<DatabaseHandle> {
  const pool = new Pool({ connectionString: url, max: 10 });
  const db = drizzlePg(pool, { schema, casing: "snake_case" });
  await migratePg(db, { migrationsFolder: MIGRATIONS });
  return { db: db as unknown as Database, kind: "postgres", close: () => pool.end() };
}

// A process-wide singleton survives Next.js hot reloads in development.
const g = globalThis as unknown as { __onecrmDb?: Promise<DatabaseHandle> };

export function getDatabase(): Promise<DatabaseHandle> {
  if (!g.__onecrmDb) {
    const cfg = getConfig();
    const pending = cfg.DATABASE_URL
      ? createPostgresDatabase(cfg.DATABASE_URL)
      : createPgliteDatabase(path.resolve(/*turbopackIgnore: true*/ process.cwd(), cfg.PGLITE_DIR));
    // A failed start must not be cached, or the process could never recover.
    pending.catch(() => {
      if (g.__onecrmDb === pending) g.__onecrmDb = undefined;
    });
    g.__onecrmDb = pending;
  }
  return g.__onecrmDb;
}

/** Test seam: install a database handle as the process singleton. */
export function setDatabaseForTesting(handle: DatabaseHandle) {
  g.__onecrmDb = Promise.resolve(handle);
}
