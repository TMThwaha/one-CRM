import { sql } from "drizzle-orm";
import { timestamp, uuid } from "drizzle-orm/pg-core";

/** UTC timestamp with time zone. All timestamps in ONECRM are stored in UTC. */
export const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const pk = () => uuid("id").primaryKey().defaultRandom();

export const createdAt = () => tstz("created_at").notNull().defaultNow();
export const updatedAt = () => tstz("updated_at").notNull().defaultNow();

export const lowerSql = (col: unknown) => sql`lower(${col})`;
