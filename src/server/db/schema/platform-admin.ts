import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, pk } from "./_helpers";
import { organizations, users } from "./identity";

/**
 * Platform-level audit trail (Super Admin actions, bootstrap, company lifecycle). Append-only:
 * a trigger rejects UPDATE and DELETE even for the owning connection, and the tenant role has no
 * access at all. Company-visible events are mirrored into the company's own `audit_logs`.
 */
export const platformAuditLogs = pgTable(
  "platform_audit_logs",
  {
    id: pk(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    actorEmail: text("actor_email"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    /** The company the action concerned, when there is one. */
    organizationId: uuid("organization_id").references(() => organizations.id),
    summary: text("summary"),
    changes: jsonb("changes").notNull().default(sql`'{}'::jsonb`),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [
    index("platform_audit_created_idx").on(t.createdAt),
    index("platform_audit_org_idx").on(t.organizationId, t.createdAt),
  ],
);
