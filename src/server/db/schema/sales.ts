import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, pk, tstz, updatedAt } from "./_helpers";
import { companies, contacts } from "./crm";
import { organizationMembers, organizations, users } from "./identity";

export const pipelines = pgTable(
  "pipelines",
  {
    id: pk(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    name: text("name").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: createdAt(),
    archivedAt: tstz("archived_at"),
  },
  (t) => [unique("pipelines_org_id_uq").on(t.organizationId, t.id)],
);

export const pipelineStages = pgTable(
  "pipeline_stages",
  {
    id: pk(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    pipelineId: uuid("pipeline_id").notNull(),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    probability: integer("probability").notNull().default(0),
    /** open = in progress; won / lost = terminal. Deal status is derived from this. */
    kind: text("kind").notNull().default("open"),
  },
  (t) => [
    unique("pipeline_stages_org_pipeline_id_uq").on(t.organizationId, t.pipelineId, t.id),
    foreignKey({
      columns: [t.organizationId, t.pipelineId],
      foreignColumns: [pipelines.organizationId, pipelines.id],
    }),
    check("pipeline_stages_kind_chk", sql`${t.kind} in ('open','won','lost')`),
    check("pipeline_stages_prob_chk", sql`${t.probability} between 0 and 100`),
    index("pipeline_stages_pipeline_idx").on(t.organizationId, t.pipelineId, t.position),
  ],
);

export const deals = pgTable(
  "deals",
  {
    id: pk(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    title: text("title").notNull(),
    pipelineId: uuid("pipeline_id").notNull(),
    stageId: uuid("stage_id").notNull(),
    /** Exact decimal. Never use floating point for money. */
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull().default("0"),
    currency: char("currency", { length: 3 }).notNull().default("INR"),
    expectedCloseDate: date("expected_close_date", { mode: "string" }),
    probability: integer("probability").notNull().default(0),
    status: text("status").notNull().default("open"),
    lostReason: text("lost_reason"),
    closedAt: tstz("closed_at"),
    ownerId: uuid("owner_id"),
    companyId: uuid("company_id"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    custom: jsonb("custom").notNull().default(sql`'{}'::jsonb`),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: tstz("deleted_at"),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    unique("deals_org_id_uq").on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.pipelineId, t.stageId],
      foreignColumns: [pipelineStages.organizationId, pipelineStages.pipelineId, pipelineStages.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.companyId],
      foreignColumns: [companies.organizationId, companies.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.ownerId],
      foreignColumns: [organizationMembers.organizationId, organizationMembers.userId],
    }),
    check("deals_status_chk", sql`${t.status} in ('open','won','lost')`),
    check("deals_amount_chk", sql`${t.amount} >= 0`),
    check("deals_prob_chk", sql`${t.probability} between 0 and 100`),
    check("deals_currency_chk", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    index("deals_org_stage_idx").on(t.organizationId, t.stageId),
    index("deals_owner_idx").on(t.organizationId, t.ownerId),
    index("deals_company_idx").on(t.organizationId, t.companyId),
  ],
);

export const dealContacts = pgTable(
  "deal_contacts",
  {
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    dealId: uuid("deal_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    role: text("role"),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.dealId, t.contactId] }),
    foreignKey({
      columns: [t.organizationId, t.dealId],
      foreignColumns: [deals.organizationId, deals.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.contactId],
      foreignColumns: [contacts.organizationId, contacts.id],
    }),
    index("deal_contacts_contact_idx").on(t.organizationId, t.contactId),
  ],
);
