# Existing system audit

Audited 2026-11-08 against commit `HEAD` of `main`, by reading the repository and running it. Where this differs from the product brief it says so. Statuses are the five used everywhere: **Planned · In Progress · Implemented · Tested · Blocked**. "Tested" means an automated test passes; it is never inferred from a UI existing.

## 1. Stack (actual)

| Layer | What is there |
|---|---|
| Framework | Next.js 16.4 (App Router, Turbopack), React 19, TypeScript strict |
| Styling / UI | Tailwind CSS v4 with CSS-variable design tokens (light, dark, system), `lucide-react` icons, an in-house component kit (`src/components/ui.tsx`: Button, Field, Modal, Panel, Badge, Toast, Pagination…), `list-kit.tsx` for tables |
| Forms / data | React Hook Form + Zod (schemas in `src/shared/schemas`, shared by client and server), TanStack Query |
| Backend | **Modular monolith inside Next.js**: route handlers in `src/app/api/v1/**` are thin wrappers (`api`, `publicApi`, `platformApi`, `accountApi` in `src/server/http/api.ts`); business logic in `src/server/modules/{identity,platform-admin,crm,sales,workforce,platform}` |
| Database | PostgreSQL via Drizzle ORM. **Development and tests use embedded PGlite** (`.data/pglite`); production requires `DATABASE_URL`. 6 migrations (4 generated, 2 hand-written for RLS, grants, seed) |
| Auth | Own implementation: scrypt hashes, opaque session tokens (SHA-256 stored), HttpOnly SameSite=Lax cookie (`__Host-` in production), lockout, TOTP MFA + recovery codes, password reset, email verification, CSRF origin check, DB-backed rate limiting |
| Email | `nodemailer` over `SMTP_URL`; **logs only** when unset (never reported as delivered) |
| Tests | Vitest (real Postgres engine, real migrations) · Playwright with real Chrome against a production build, including axe WCAG 2.1 AA scans |
| CI / deploy | GitHub Actions (typecheck, lint, tests, build, `npm audit`); `docker-compose.yml` for Postgres (**never exercised**). **No Dockerfile**, no deployment pipeline |
| Not present at all | AI SDKs/providers, queue/worker/cron, WebSocket/SSE, file storage, webhooks, payment/accounting SDKs, i18n library, vector search |

Size: ~12.6k lines in `src`, ~1.9k lines of tests; 100 unit/integration tests and 17 browser tests, all passing.

## 2. Architecture assessment

**Strong foundations worth keeping**
- Three-layer tenant isolation: service-level scoping, PostgreSQL row-level security under a restricted `onecrm_app` role (`withTenant`), and composite foreign keys. A schema-guard test fails if any table with `organization_id` lacks RLS.
- Platform administration is a separate identity class (`platform_admins`, own resolver and context type); a company role can never satisfy it.
- Audit rows are written in the same transaction as the change; the platform audit log is append-only by trigger.
- Money is exact decimals end to end; timestamps are UTC; regional settings travel on the request context.
- Permission catalogue and role definitions are shared by server (enforcement) and UI (hiding only).

**Gaps that will constrain the roadmap**
1. ~~**No background execution.**~~ **Fixed 2026-11-08:** Postgres-backed job queue, in-process worker, scheduled housekeeping, email retries.
2. ~~**No event bus.**~~ **Fixed 2026-11-08:** transactional-outbox domain events with a dispatcher; first consumer is in-app notifications.
3. **No file storage**, so attachments, logo upload, document library and CSV import have no home.
4. ~~**Roles are fixed.**~~ **Fixed 2026-11-08:** custom roles with a granular permission editor (`role.manage`).
5. **No departments or teams.** The `team` permission scope exists but is enforced as `own` because teams do not exist.
6. ~~**Navigation is two flat groups.**~~ **Fixed 2026-11-08:** sectioned, collapsible, permission-aware navigation.
7. English strings are hard-coded; there is no localisation layer. The company's numeric date-format pattern is stored but unused.

## 3. Security findings

| # | Finding | Severity | State |
|---|---|---|---|
| S1 | No Content-Security-Policy header (other security headers are set) | Medium | Open |
| S2 | `X-Forwarded-For` is trusted for IP logging and rate limits | Medium | Open (safe only behind a proxy that overwrites it) |
| S3 | RLS verified on PGlite only, not on a managed Postgres with a non-owner connection role | Medium | Open |
| S4 | Super Admin MFA is encouraged, not enforced; no support-access mechanism; no second Super Admin path | Medium | Open |
| S5 | Email verification is not enforced at sign-in | Low | Open |
| S6 | Rate limiter writes one row per limited request (fine at this scale, not at high volume) | Low | Mitigated: housekeeping now purges old rows hourly; still a write per request |
| S7 | Logo URL is fetched by each user's browser from a company-chosen https host | Low | Accepted (no referrer sent); replace with upload when storage exists |
| S8 | Embedded PGlite is single-process and was corrupted in development by an unclean stop | Dev only | Mitigated: documented; production requires Postgres |
| S9 | No Dockerfile / hardened deployment, no secret-management integration, no backup or restore procedure | Medium | Open |

Verified positives: constant-time token comparison, hashed single-use tokens, session revocation on password change/reset, lockout, no user enumeration on reset, platform routes return 404 to non-platform callers, tenant role cannot write `status`/`plan_id`, every dependency audit clean (`npm audit --omit=dev`: 0).

## 4. What works, by area (verified)

| Area | Status | Evidence |
|---|---|---|
| Registration (disabled by default), login, logout, sessions, lockout | Tested | unit + browser |
| Password reset, email verification, TOTP MFA, session list/revoke | Tested (services) / Implemented (UI) | unit; UI exercised in browser |
| Multi-company membership, switching, invitations | Tested | unit + browser |
| Super Admin: bootstrap, companies, administrators, lifecycle, audit | Tested | unit + HTTP + browser + axe |
| Company settings and company-aware formatting | Tested | unit + browser |
| Roles & permissions: 5 system roles + custom roles, scopes `all`/`own`, escalation guard, last-owner guard | Tested | unit + browser |
| Contacts, companies, leads (rule-based score, convert), deals + Kanban, tasks, activities, timeline | Tested | unit + browser |
| Dashboard (live aggregates), global search, command palette, audit log | Tested (data) / Implemented (UI) | unit; browser smoke |
| Light/dark themes, keyboard skip link, axe-clean pages | Tested | axe in both themes |
| Mobile layout | Tested (browser) | 10 pages checked at 390px for sideways scroll; drawer menu verified (added 2026-11-08) |

**UI placeholders that pretend to work:** none found. Unbuilt features are absent, not faked; the Super Admin sidebar lists unbuilt pages as "Not built yet".

## 5. Coverage against the product scope (21 modules)

Status of each module today (detail and per-feature state in `IMPLEMENTATION_STATUS.md`).

| # | Module | Status |
|---|---|---|
| 1 | Identity & organization management | **Tested (core)**; custom roles/permission UI In Progress; departments/teams, org policies Planned |
| 2 | Personalized dashboard | Implemented (single dashboard; per-role views, widgets, layouts Planned) |
| 3 | CRM | Tested (CRUD, timeline, duplicates on create); CSV import, merge, tags/custom-field UI, attachments, Customer 360 Planned |
| 4 | Sales | Tested (one pipeline model, deals, Kanban); products, quotes, forecasting, approvals Planned |
| 5 | Unified communication | Planned (no channels, no queue) |
| 6 | Marketing automation | Planned |
| 7 | Customer support | Planned |
| 8 | Products & finance | Planned |
| 9 | Tasks, projects, workforce | Tested (tasks); subtasks, recurrence, calendar, projects Planned |
| 10 | Visual automation engine | Planned (needs queue + events) |
| 11-14 | AI command center, agents, BI, company memory | Planned (no provider, no gateway; **Blocked on a provider decision and credentials**) |
| 15-16 | Industry templates, no-code customization | Planned (`organizations.industry` is a label only) |
| 17 | Analytics & reporting | Planned beyond the dashboard |
| 18 | Integration ecosystem | Planned (no OAuth/webhook layer) |
| 19 | Customer portal | Planned |
| 20 | Enterprise administration | Partial: audit log, MFA, sessions, rate limiting Tested; SSO, retention, export, backup Planned |
| 21 | Mobile & global | Partial: responsive shell (unverified), multi-currency/time zone Tested; i18n, offline Planned |

## 6. Difference from the brief
- The brief's navigation lists *Company, Team, Audit Log*; the app also has *Settings → Security* (account menu) and a separate `/super-admin` control panel.
- The workspace keeps its existing URLs (`/dashboard`, `/contacts`, …) rather than `/app/...` (ADR-019).
- "Organization" and "company" are the same entity in code and UI copy.

## 7. Risks to manage as modules are added
1. Any new tenant table must carry `organization_id`, a composite FK, RLS and a grant; the schema-guard test enforces RLS.
2. New permissions must be added to `PERMISSIONS`, to the system roles, **and to existing organizations by migration** (system roles are stored per organization).
3. AI, search, reports, exports and background jobs must all go through the same permission checks, not around them.
4. The embedded database must not be shared between processes; production needs managed Postgres.

## 8. Recommended order
Done: audit → roles & permissions management + scalable navigation. Next: job queue + domain events (unblocks notifications, import, automation) → CSV lead import with duplicate resolution → departments/teams with real `team` scope → products/quotations. AI work waits on the provider/credential decision (section 5, modules 11-14).
