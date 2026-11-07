import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, pk, tstz, updatedAt } from "./_helpers";

/** Global (not tenant-owned): a person who can sign in. May belong to many organizations. */
export const users = pgTable(
  "users",
  {
    id: pk(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    emailVerifiedAt: tstz("email_verified_at"),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: tstz("locked_until"),
    disabledAt: tstz("disabled_at"),
    /** AES-256-GCM encrypted TOTP secret (see platform/secrets). Set during setup, active once mfaEnabledAt is set. */
    mfaSecretEnc: text("mfa_secret_enc"),
    mfaEnabledAt: tstz("mfa_enabled_at"),
    /** SHA-256 hashes of unused single-use recovery codes. */
    mfaRecoveryHashes: text("mfa_recovery_hashes").array().notNull().default(sql`'{}'::text[]`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`)],
);

/** Tenant root. */
export const organizations = pgTable(
  "organizations",
  {
    id: pk(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    industry: text("industry").notNull().default("general"),
    baseCurrency: char("base_currency", { length: 3 }).notNull().default("INR"),
    timezone: text("timezone").notNull().default("Asia/Kolkata"),
    locale: text("locale").notNull().default("en-IN"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: tstz("deleted_at"),
  },
  (t) => [check("organizations_currency_chk", sql`${t.baseCurrency} ~ '^[A-Z]{3}$'`)],
);

export const roles = pgTable(
  "roles",
  {
    id: pk(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    unique("roles_org_key_uq").on(t.organizationId, t.key),
    unique("roles_org_id_uq").on(t.organizationId, t.id),
  ],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    permission: text("permission").notNull(),
    /** Record-level scope: all records, the actor's team's, or only records the actor owns. */
    scope: text("scope").notNull().default("all"),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.permission] }),
    foreignKey({
      columns: [t.organizationId, t.roleId],
      foreignColumns: [roles.organizationId, roles.id],
    }),
    check("role_permissions_scope_chk", sql`${t.scope} in ('all','team','own')`),
  ],
);

export const organizationMembers = pgTable(
  "organization_members",
  {
    id: pk(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    roleId: uuid("role_id").notNull(),
    status: text("status").notNull().default("active"),
    jobTitle: text("job_title"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("org_members_org_user_uq").on(t.organizationId, t.userId),
    foreignKey({
      columns: [t.organizationId, t.roleId],
      foreignColumns: [roles.organizationId, roles.id],
    }),
    index("org_members_user_idx").on(t.userId),
    check("org_members_status_chk", sql`${t.status} in ('active','suspended')`),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: pk(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    email: text("email").notNull(),
    roleId: uuid("role_id").notNull(),
    /** SHA-256 of the invitation token. The token itself is never stored. */
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: uuid("invited_by").notNull().references(() => users.id),
    expiresAt: tstz("expires_at").notNull(),
    acceptedAt: tstz("accepted_at"),
    acceptedBy: uuid("accepted_by").references(() => users.id),
    revokedAt: tstz("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.roleId],
      foreignColumns: [roles.organizationId, roles.id],
    }),
    uniqueIndex("invitations_pending_uq")
      .on(t.organizationId, sql`lower(${t.email})`)
      .where(sql`${t.acceptedAt} is null and ${t.revokedAt} is null`),
  ],
);

/** Server-side sessions. The cookie carries an opaque token; only its SHA-256 is stored. */
export const sessions = pgTable(
  "sessions",
  {
    id: pk(),
    userId: uuid("user_id").notNull().references(() => users.id),
    tokenHash: text("token_hash").notNull().unique(),
    activeOrganizationId: uuid("active_organization_id").references(() => organizations.id),
    /** True between password success and second-factor success; such sessions grant no access. */
    mfaPending: boolean("mfa_pending").notNull().default(false),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    lastSeenAt: tstz("last_seen_at").notNull().defaultNow(),
    expiresAt: tstz("expires_at").notNull(),
    revokedAt: tstz("revoked_at"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/** Authentication security events (sign-in success/failure, lockouts). Not tenant-owned. */
export const authEvents = pgTable(
  "auth_events",
  {
    id: pk(),
    userId: uuid("user_id").references(() => users.id),
    email: text("email"),
    type: text("type").notNull(),
    success: boolean("success").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("auth_events_user_idx").on(t.userId, t.createdAt)],
);

/** Single-use, expiring tokens for email verification and password reset. Only the hash is stored. */
export const emailTokens = pgTable(
  "email_tokens",
  {
    id: pk(),
    userId: uuid("user_id").notNull().references(() => users.id),
    purpose: text("purpose").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: tstz("expires_at").notNull(),
    usedAt: tstz("used_at"),
    createdAt: createdAt(),
  },
  (t) => [
    check("email_tokens_purpose_chk", sql`${t.purpose} in ('verify_email','reset_password')`),
    index("email_tokens_user_idx").on(t.userId, t.purpose),
  ],
);

/** Sliding-window rate limiting shared by all app instances. */
export const rateLimitHits = pgTable(
  "rate_limit_hits",
  {
    id: pk(),
    key: text("key").notNull(),
    hitAt: tstz("hit_at").notNull().defaultNow(),
  },
  (t) => [index("rate_limit_key_idx").on(t.key, t.hitAt)],
);
