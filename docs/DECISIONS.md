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
