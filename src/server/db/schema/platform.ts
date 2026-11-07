import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, pk } from "./_helpers";
import { organizations, users } from "./identity";

/**
 * Append-only audit trail. The application database role is granted INSERT and SELECT only,
 * so even a compromised service cannot rewrite history.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: pk(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    summary: text("summary"),
    changes: jsonb("changes").notNull().default(sql`'{}'::jsonb`),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_logs_org_created_idx").on(t.organizationId, t.createdAt),
    index("audit_logs_entity_idx").on(t.organizationId, t.entityType, t.entityId),
  ],
);
