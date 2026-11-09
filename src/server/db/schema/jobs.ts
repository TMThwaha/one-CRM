import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, pk, tstz, updatedAt } from "./_helpers";
import { organizationMembers, organizations, users } from "./identity";

/**
 * Background work queue (Postgres-backed; no extra infrastructure). Workers claim rows with
 * FOR UPDATE SKIP LOCKED, so any number of instances can run safely. A job that crashes mid-run
 * becomes claimable again once its lease expires. Platform infrastructure: not readable by the
 * tenant database role.
 */
export const jobs = pgTable(
  "jobs",
  {
    id: pk(),
    /** The company the work belongs to, when there is one (null for platform housekeeping). */
    organizationId: uuid("organization_id").references(() => organizations.id),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("queued"),
    priority: integer("priority").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    runAt: tstz("run_at").notNull().defaultNow(),
    lockedAt: tstz("locked_at"),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    result: jsonb("result"),
    /** Enqueueing the same key twice creates one job: safe to retry the enqueue itself. */
    idempotencyKey: text("idempotency_key"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    finishedAt: tstz("finished_at"),
  },
  (t) => [
    check("jobs_status_chk", sql`${t.status} in ('queued','running','succeeded','dead','cancelled')`),
    uniqueIndex("jobs_idempotency_uq").on(t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
    index("jobs_due_idx").on(t.runAt).where(sql`${t.status} in ('queued','running')`),
    index("jobs_status_idx").on(t.status, t.finishedAt),
    index("jobs_org_idx").on(t.organizationId),
  ],
);

/**
 * Transactional outbox of business events. A row is inserted in the SAME transaction as the change
 * it describes, so an event exists if and only if the change committed. A dispatcher then turns each
 * event into one job per interested handler.
 */
export const domainEvents = pgTable(
  "domain_events",
  {
    id: pk(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    type: text("type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    occurredAt: tstz("occurred_at").notNull().defaultNow(),
    dispatchedAt: tstz("dispatched_at"),
  },
  (t) => [
    index("domain_events_pending_idx").on(t.occurredAt).where(sql`${t.dispatchedAt} is null`),
    index("domain_events_org_idx").on(t.organizationId, t.occurredAt),
  ],
);

/**
 * In-app notifications, one row per person. Created by a background handler, readable only by the
 * person it is for (row-level security on organization AND user). The composite foreign key makes it
 * impossible to notify someone who is not a member of the company.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: pk(),
    organizationId: uuid("organization_id").notNull(),
    userId: uuid("user_id").notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    /** The event that caused it: with the user, unique, so a redelivered event cannot notify twice. */
    eventId: uuid("event_id"),
    readAt: tstz("read_at"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.userId],
      foreignColumns: [organizationMembers.organizationId, organizationMembers.userId],
    }),
    uniqueIndex("notifications_event_user_uq").on(t.eventId, t.userId).where(sql`${t.eventId} is not null`),
    index("notifications_user_idx").on(t.userId, t.readAt, t.createdAt),
  ],
);

