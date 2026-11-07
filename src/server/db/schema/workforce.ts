import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { createdAt, pk, tstz, updatedAt } from "./_helpers";
import { companies, contacts, leads } from "./crm";
import { organizationMembers, organizations, users } from "./identity";
import { deals } from "./sales";

/**
 * Activities and tasks link to CRM records through explicit, typed, nullable foreign keys
 * (no uncontrolled polymorphic type/id pairs), each one tenant-composite.
 */
type LinkCols = {
  organizationId: AnyPgColumn;
  contactId: AnyPgColumn;
  companyId: AnyPgColumn;
  leadId: AnyPgColumn;
  dealId: AnyPgColumn;
};

function links(t: LinkCols) {
  return [
    foreignKey({ columns: [t.organizationId, t.contactId], foreignColumns: [contacts.organizationId, contacts.id] }),
    foreignKey({ columns: [t.organizationId, t.companyId], foreignColumns: [companies.organizationId, companies.id] }),
    foreignKey({ columns: [t.organizationId, t.leadId], foreignColumns: [leads.organizationId, leads.id] }),
    foreignKey({ columns: [t.organizationId, t.dealId], foreignColumns: [deals.organizationId, deals.id] }),
  ];
}

export const activities = pgTable(
  "activities",
  {
    id: pk(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    type: text("type").notNull(),
    subject: text("subject").notNull(),
    body: text("body"),
    occurredAt: tstz("occurred_at").notNull().defaultNow(),
    durationMinutes: integer("duration_minutes"),
    contactId: uuid("contact_id"),
    companyId: uuid("company_id"),
    leadId: uuid("lead_id"),
    dealId: uuid("deal_id"),
    /** Structured detail for system events, e.g. {"from":"Qualified","to":"Proposal"}. */
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    /** NULL for events produced by the system itself. */
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("activities_org_id_uq").on(t.organizationId, t.id),
    ...links(t),
    check("activities_type_chk", sql`${t.type} in ('note','call','email','meeting','system')`),
    check(
      "activities_has_link_chk",
      sql`${t.contactId} is not null or ${t.companyId} is not null or ${t.leadId} is not null or ${t.dealId} is not null`,
    ),
    index("activities_contact_idx").on(t.organizationId, t.contactId, t.occurredAt),
    index("activities_company_idx").on(t.organizationId, t.companyId, t.occurredAt),
    index("activities_lead_idx").on(t.organizationId, t.leadId, t.occurredAt),
    index("activities_deal_idx").on(t.organizationId, t.dealId, t.occurredAt),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: pk(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    title: text("title").notNull(),
    description: text("description"),
    dueAt: tstz("due_at"),
    priority: text("priority").notNull().default("normal"),
    status: text("status").notNull().default("open"),
    assigneeId: uuid("assignee_id"),
    contactId: uuid("contact_id"),
    companyId: uuid("company_id"),
    leadId: uuid("lead_id"),
    dealId: uuid("deal_id"),
    completedAt: tstz("completed_at"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: tstz("deleted_at"),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    unique("tasks_org_id_uq").on(t.organizationId, t.id),
    ...links(t),
    foreignKey({
      columns: [t.organizationId, t.assigneeId],
      foreignColumns: [organizationMembers.organizationId, organizationMembers.userId],
    }),
    check("tasks_priority_chk", sql`${t.priority} in ('low','normal','high','urgent')`),
    check("tasks_status_chk", sql`${t.status} in ('open','done')`),
    index("tasks_assignee_idx").on(t.organizationId, t.assigneeId, t.status, t.dueAt),
    index("tasks_deal_idx").on(t.organizationId, t.dealId),
    index("tasks_contact_idx").on(t.organizationId, t.contactId),
  ],
);
