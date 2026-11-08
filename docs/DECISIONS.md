# Architecture decision records

Format: context → decision → consequences. Newest last.

## ADR-001 — Modular monolith inside Next.js, not a separate NestJS service
**Context.** The brief prefers a NestJS backend. The repository was empty; the first milestone is a working, secure vertical slice, deployable as one unit.
**Decision.** One Next.js (App Router, TypeScript strict) application. All business logic lives in `src/server/modules/<domain>/*.service.ts`, framework-independent (no `next/*` imports), called by thin REST route handlers (`src/app/api/v1`) and by Server Components. Route handlers contain no business logic.
**Consequences.** One deploy, one type system, same-origin cookie auth. The service layer can be lifted into a NestJS/Fastify worker or API process later without rewriting domain code; background workers (Phase 3) will be a separate Node process importing the same modules. **This departs from the preferred NestJS stack; if you want NestJS from day one, say so now — it is cheapest to switch before Phase 2.**

## ADR-002 — PostgreSQL via Drizzle; PGlite for development and tests
**Context.** No Docker or Postgres installed on the build machine. Tests must exercise real Postgres features (RLS, composite FKs, partial unique indexes).
**Decision.** Drizzle ORM with SQL migrations (`drizzle/`). Development and tests run on PGlite (the real PostgreSQL engine compiled to WASM, persisted in `.data/`). Production uses `node-postgres` via `DATABASE_URL`. Same migrations for both.
**Consequences.** Zero-install dev experience and fast, hermetic tests. PGlite is single-connection and not for production (enforced: the app refuses to start in production without `DATABASE_URL`). RLS must still be validated on the managed Postgres target.

## ADR-003 — Three-layer tenant isolation
Application authorization on every call → PostgreSQL row-level security under a restricted role (`onecrm_app`, `SET LOCAL ROLE` per transaction, `app.org_id` pinned) → composite foreign keys `(organization_id, id)` so cross-tenant references are structurally impossible. The organization always comes from the server-side session, never from client input.

## ADR-004 — Opaque server-side sessions, not JWTs
Random 256-bit token in an HttpOnly, SameSite=Lax cookie (`__Host-` prefix and Secure in production); only the SHA-256 is stored. Every request re-validates session, user, membership and permissions, so revocation, suspension and role changes take effect immediately. JWTs would make that harder for no benefit at this stage.

## ADR-005 — scrypt for password hashing
Node's built-in scrypt (N=2^17, r=8, p=1, per OWASP) avoids a native dependency that is fragile on Windows. Parameters are stored in the hash string so they can be raised later.

## ADR-006 — RBAC with record scopes (ABAC-lite)
Permissions are `resource.action` strings; each role grants a permission at scope `all` or `own` (`team` reserved, enforced as `own`). Services translate scope into SQL filters. "Not permitted to see" returns 404, not 403, to avoid revealing existence. Privilege-escalation guard: you can only grant roles whose permissions you already hold.

## ADR-007 — Typed link columns instead of polymorphic references
`activities` and `tasks` link to records through explicit nullable FKs (`contact_id`, `company_id`, `lead_id`, `deal_id`), each tenant-composite, plus a CHECK that at least one is set. Chosen over `(entity_type, entity_id)` so the database enforces integrity. Cost: adding a linkable entity adds a column.

## ADR-008 — Money as exact decimals
`numeric(18,2)` + ISO currency code; amounts travel as strings end to end; arithmetic in SQL or `BigInt`. Totals are grouped per currency, never mixed.

## ADR-009 — Optimistic concurrency via `version`
Updatable records carry `version`; updates compare-and-increment and return 409 with a message on conflict.

## ADR-010 — Rule-based lead scoring, labelled as such
The lead score is a deterministic, fully-explained rule set. It is not presented as AI. Real predictive scoring waits for Phase 4 and measured data.

## ADR-011 — `cacheComponents` disabled
The scaffold enabled it. The app is entirely per-user dynamic data; the flag only adds Suspense constraints. Revisit with measured need.

## ADR-012 — Audit written in the same transaction; append-only for the app role
`audit(tx, …)` runs inside the business transaction. The `onecrm_app` role has INSERT and SELECT only on `audit_logs`.

## ADR-013 — No simulated integrations
Where an external provider is needed (email, SMS, payments, AI) and no credentials exist, the feature is documented as not implemented rather than faked. Invitations therefore show a link instead of pretending to email.

## ADR-014 — The Super Admin is a separate kind of identity, not a tenant role
A Global Super Admin is a row in `platform_admins` (no organization). It is resolved by its own function (`resolvePlatformContext`), carries its own type (`PlatformContext`, which has no `organizationId`) and is served by its own API wrapper (`platformApi`). A company role, however powerful, cannot satisfy it, and a platform context cannot be passed to a tenant-scoped service by mistake. Non-platform callers get **404**, not 403. Chosen over a `super_admin` role inside `roles` because roles are per-organization and editable by Company Admins; a platform privilege must not live somewhere a tenant can touch.

## ADR-015 — Company = organization; Company Admin = the system `owner` role
The existing organization is the company (tenant root); renaming tables would be churn with no benefit. The `owner` system role is presented as **Company Admin** (same permissions). `admin` stays as a delegated administrator who cannot change company settings. Manager, Sales (employee) and Viewer are unchanged; custom roles remain Phase 3. A company must always keep one active Company Admin.

## ADR-016 — Bootstrap by one-time setup token, no default credentials
The first Super Admin is created at `/setup`, authorised by `BOOTSTRAP_TOKEN` (proof of server access, compared in constant time, rate limited). It works only while no Super Admin exists and refuses to promote an existing account; afterwards it is permanently a 404. No CLI was added (the `server-only` boundary makes scripts awkward) and nothing is seeded or hardcoded. Public registration is off by default (`ALLOW_PUBLIC_REGISTRATION`).

## ADR-017 — Company status is enforced at request time
`organizations.status` ∈ active / suspended / deactivated / archived. Every company request re-checks it (`resolveAuthContext`, login, org switching), so a suspension ends access on the member's very next request with no session surgery. A member of two companies falls back to the one that is still active. Deletion is a protected soft delete (archived only, legal name typed back, password re-entered); data is retained and a hard purge is deliberately not offered.

## ADR-018 — Platform audit is append-only and mirrored to the company
`platform_audit_logs` has a trigger that rejects UPDATE and DELETE even for the owning connection, and is invisible to the tenant role. Company-relevant events are also written into the company's own `audit_logs` (prefixed `platform.`), so a Company Admin can see what the platform did to their company. The tenant role may edit its own company *profile* columns but, by column-level grant, never `status`, `plan_id`, `slug`, `created_by` or `deleted_at`.

## ADR-019 — Routes
The platform lives at `/super-admin`. The company workspace keeps its existing URLs (`/dashboard`, `/contacts`, …) instead of moving under `/app`: a rename would touch every link, test and e2e flow for no functional gain.

## ADR-020 — Regional settings are stored per company; the catalogue only supplies defaults
`src/shared/countries.ts` pre-fills currency, time zone, language, date format and phone code when a company is created; the company stores its own values and can change each. Tax identifiers are labels only. Timestamps are UTC.

## ADR-021 — Regional settings travel on the request context
`AuthContext.regional` (time zone, locale, currency, date format) is read in the same query that already joins the organization at sign-in, so every server component and API handler can format for the company at no extra cost; client components read it via `useRegional()`. Formatters take the regional object explicitly instead of reading global state, so concurrent requests for different companies can never format with each other's settings. Bare calendar dates are formatted in UTC so they cannot drift a day.
