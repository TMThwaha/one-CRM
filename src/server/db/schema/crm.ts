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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, pk, tstz, updatedAt } from "./_helpers";
import { organizationMembers, organizations, users } from "./identity";
import { deals } from "./sales";

/**
 * Tenant-owned tables always:
 *  - carry organization_id NOT NULL
 *  - expose UNIQUE (organization_id, id) so children can use COMPOSITE foreign keys
 *    (organization_id, parent_id). That makes cross-tenant references impossible at the
 *    database level, independent of application code.
 *  - are protected by row-level security (see the rls migration).
 */

export const companies = pgTable(
  "companies",
  {
    id: pk(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    name: text("name").notNull(),
    domain: text("domain"),
    industry: text("industry"),
    size: text("size"),
    phone: text("phone"),
    website: text("website"),
    city: text("city"),
    country: text("country"),
    ownerId: uuid("owner_id"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    custom: jsonb("custom").notNull().default(sql`'{}'::jsonb`),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: tstz("deleted_at"),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    unique("companies_org_id_uq").on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.ownerId],
      foreignColumns: [organizationMembers.organizationId, organizationMembers.userId],
    }),
    uniqueIndex("companies_domain_uq")
      .on(t.organizationId, sql`lower(${t.domain})`)
      .where(sql`${t.deletedAt} is null and ${t.domain} is not null`),
    index("companies_org_name_idx").on(t.organizationId, sql`lower(${t.name})`),
  ],
);

export const contacts = pgTable(
  "contacts",
  {
    id: pk(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    firstName: text("first_name").notNull(),
    lastName: text("last_name"),
    email: text("email"),
    phone: text("phone"),
    jobTitle: text("job_title"),
    companyId: uuid("company_id"),
    ownerId: uuid("owner_id"),
    source: text("source"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    custom: jsonb("custom").notNull().default(sql`'{}'::jsonb`),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: tstz("deleted_at"),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    unique("contacts_org_id_uq").on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.companyId],
      foreignColumns: [companies.organizationId, companies.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.ownerId],
      foreignColumns: [organizationMembers.organizationId, organizationMembers.userId],
    }),
    // One active contact per email per organization: prevents duplicate customer records.
    uniqueIndex("contacts_email_uq")
      .on(t.organizationId, sql`lower(${t.email})`)
      .where(sql`${t.deletedAt} is null and ${t.email} is not null`),
    index("contacts_org_name_idx").on(t.organizationId, sql`lower(${t.firstName})`),
    index("contacts_company_idx").on(t.organizationId, t.companyId),
  ],
);

export const LEAD_STATUSES = ["new", "contacted", "qualified", "unqualified", "converted"] as const;

export const leads = pgTable(
  "leads",
  {
    id: pk(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    firstName: text("first_name").notNull(),
    lastName: text("last_name"),
    email: text("email"),
    phone: text("phone"),
    companyName: text("company_name"),
    jobTitle: text("job_title"),
    source: text("source"),
    status: text("status").notNull().default("new"),
    /** Rule-based score 0..100 with human-readable reasons (see crm/lead-scoring). Not ML. */
    score: integer("score").notNull().default(0),
    scoreReasons: jsonb("score_reasons").notNull().default(sql`'[]'::jsonb`),
    ownerId: uuid("owner_id"),
    convertedContactId: uuid("converted_contact_id"),
    convertedDealId: uuid("converted_deal_id"),
    convertedAt: tstz("converted_at"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    custom: jsonb("custom").notNull().default(sql`'{}'::jsonb`),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: tstz("deleted_at"),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    unique("leads_org_id_uq").on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.ownerId],
      foreignColumns: [organizationMembers.organizationId, organizationMembers.userId],
    }),
    foreignKey({
      columns: [t.organizationId, t.convertedContactId],
      foreignColumns: [contacts.organizationId, contacts.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.convertedDealId],
      foreignColumns: [deals.organizationId, deals.id],
    }),
    check("leads_status_chk", sql`${t.status} in ('new','contacted','qualified','unqualified','converted')`),
    check("leads_score_chk", sql`${t.score} between 0 and 100`),
    index("leads_org_status_idx").on(t.organizationId, t.status),
    index("leads_owner_idx").on(t.organizationId, t.ownerId),
  ],
);
