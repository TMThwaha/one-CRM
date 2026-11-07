# System architecture

## Shape
A **modular monolith**: one deployable Next.js application with strict internal layering. Microservices are deliberately not used (see DECISIONS ADR-001); extraction happens only when operational need appears.

```
Browser ──► Next.js (App Router)
              ├─ Server Components  ──┐   read paths call services directly
              ├─ REST /api/v1  ───────┤   thin handlers: auth → CSRF → validate → service
              └─ Client Components ───┘   TanStack Query → REST
                                  │
                      src/server/modules/<domain>   (no framework imports)
                       identity · crm · sales · workforce · platform
                                  │ withTenant(ctx, tx => …)
                      src/server/db   Drizzle · RLS role · migrations
                                  │
                      PostgreSQL (PGlite in dev/test)
```

## Layers and rules
| Layer | Location | Responsibility | Must not |
|---|---|---|---|
| UI | `src/app`, `src/components` | Presentation, forms, optimistic UX | Contain business rules; be trusted for authorization |
| HTTP | `src/server/http` | Cookie → `AuthContext`, CSRF origin check, JSON/zod errors → status codes | Contain business logic |
| Services | `src/server/modules/*/*.service.ts` | Authorization, validation, transactions, audit, domain rules | Import `next/*` (except `server-only`) |
| Data | `src/server/db` | Schema, migrations, tenant transaction helper | Be reachable without a tenant scope (except identity) |
| Shared | `src/shared` | Zod schemas, permission catalog, constants (client + server) | Import server code |

Domains: **identity** (auth, sessions, orgs, members, invitations, roles), **crm** (contacts, companies, leads, scoring), **sales** (pipelines, deals), **workforce** (tasks, activities, timeline), **platform** (search, dashboard, audit).

## Request flow (authenticated write)
1. `api()` checks `Origin`/`Sec-Fetch-Site` (CSRF), reads the session cookie.
2. `resolveAuthContext` validates session → user → active membership → permissions (fresh from DB each request).
3. Handler parses JSON and calls a service with the `AuthContext`; zod validates input.
4. Service calls `require(ctx, permission)` (gets scope), then `withTenant` opens a transaction, `SET LOCAL ROLE onecrm_app`, pins `app.org_id`.
5. Queries apply owner scope; mutation + system activity + audit entry commit atomically.
6. `AppError`/`ZodError` map to `{error:{code,message,details}}`; unknown errors are logged and returned as a generic 500.

## Identity connection vs tenant connection
Sign-in and invitation acceptance run before any tenant exists, so the `identity` module uses the owning connection (bypasses RLS) with explicit scoping and token-gating. Everything else must go through `withTenant`. Enforced by an ESLint `no-restricted-imports` rule: `getDatabase()` cannot be imported outside `identity`, `db` and the health check.

## Not built yet (designed in other docs)
Background jobs (BullMQ/Redis) and the outbox pattern, event bus, workflow engine, AI gateway and agents, object storage, search service, observability. They attach to the same service layer and tenant context; none of them exist in this build.

## Scalability posture
Everything is indexed on `(organization_id, …)`; lists are paginated; no unbounded queries except the board (capped at 1000 cards). No load testing has been done, so no capacity claims are made.
