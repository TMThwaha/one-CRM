# Implementation status

Legend: **Tested** = covered by automated tests that pass. **Implemented** = works end to end but only manually exercised. **Planned** = not built.

Last verified: 2026-11-08 — `npm run verify`: 147 unit/integration tests passed, lint 0 problems, typecheck clean, production build succeeds, `npm audit --omit=dev` 0 vulnerabilities. Playwright (real Chrome, production build with the background worker running, fresh database): 22 tests passed, including the full assignment → notification flow and axe WCAG 2.1 A/AA scans. Full audit: [EXISTING_SYSTEM_AUDIT.md](EXISTING_SYSTEM_AUDIT.md).

## Platform hierarchy (Super Admin → Companies → Company Admin → employees)

| Feature | State | Notes |
|---|---|---|
| Super Admin identity, one-time secure bootstrap (`/setup`) | Tested | Unit + browser. No default credentials; closes forever; refuses existing accounts. |
| Separate Super Admin panel (`/super-admin`) and platform authorization path | Tested | Company Admin gets 404 on pages and API; verified over HTTP and in the browser. |
| Public registration disabled (centrally managed) | Tested | Flag `ALLOW_PUBLIC_REGISTRATION`; self-service org creation removed. |
| Create company (transactional) + appoint administrator by invitation | Tested | Atomic (fault-injection test), duplicate prevention, invitation single-use, hashed token, optional email. |
| Companies list: search, filters, sort, pagination, admin/employee columns | Tested (data) / Implemented (UI) | |
| Company detail, edit, change/promote/demote administrator | Tested (data) / Implemented (UI) | Last-admin guard. |
| Activate / suspend / deactivate / archive / protected delete | Tested | Access ends on the next request; reason required and audited. |
| Platform overview (live aggregates), users, administrators, countries, plans (read-only) | Tested (data) / Implemented (UI) | No revenue shown: billing is not integrated. |
| Platform audit log (append-only) + mirror into company audit | Tested | |
| Country/currency/time-zone defaults per company | Tested | Pre-filled from a 39-country catalogue, overridable per company. |
| Company settings (Company Admin): profile, logo URL, currency, time zone, language | Tested | `org.manage` only; audited; platform-controlled fields (legal name, country, registration number, plan, status) cannot be changed, enforced by the schema and by column grants. |
| Workspace uses the company's time zone and locale for dates and money | Tested (formatters, context) / Implemented (UI) | Fixed a hard-coded `en-IN` money locale that applied to every company. Numeric date *pattern* is stored but not yet applied. |
| Super Admin MFA | Implemented | Available; not enforced. |
| Support-access sessions, plan limits/pricing, usage, AI settings, integrations, announcements, system health | **Planned** | |

## Phase 1 — Foundation

| Feature | State | Notes |
|---|---|---|
| Application shell (nav, org switcher, command palette, create menu, theme) | Implemented | Rendered and checked via server-side requests only; **not visually verified in a browser** (extension unavailable). |
| Registration, login, logout | Tested | Lockout after 5 failures, generic errors, timing equalisation. |
| Sessions (server-side, hashed token, revocable, expiry) | Tested | |
| Company membership + multiple companies per person + switching | Tested | Companies are created only by the Super Admin; membership comes from invitations. |
| Tenant isolation (app layer, RLS, composite FKs) | Tested | See SECURITY_MODEL. |
| Invitations (create, preview, accept once, revoke) | Tested | **No email is sent** — the inviter copies the link. |
| Roles & permissions: 5 system roles, record scopes `all`/`own` | Tested | `team` scope is enforced as `own` (teams do not exist yet). |
| **Custom roles** with a granular permission editor (create, edit, delete, "use as template") | Tested | `role.manage` (Company Admin only). Server enforces: real permissions only, scopes the service honours, "write needs read", nothing the author doesn't hold, no editing a stronger role, system roles immutable, no delete while in use. Changes apply on the member's next request. Audited. Migration 0007 backfills existing companies. |
| **Scalable navigation**: sections (Workspace, Customers, Sales, Administration), collapsible and remembered, permission-aware, current page never hidden | Tested (browser) | Only built modules are shown; planned ones are not rendered as dead links. Favourites/pinning: Planned. |
| **Phone-width layout** (390px): 10 pages do not scroll sideways, menu opens as a drawer | Tested (browser) | Previously unverified. |
| Privilege-escalation guard, last-owner protection, suspension | Tested | |
| Contacts (CRUD, duplicate prevention, 360 view) | Tested | |
| Companies (CRUD, domain uniqueness) | Tested | |
| Leads (CRUD, explainable rule-based score, convert) | Tested | Score is deterministic rules, **not ML**. |
| Pipelines & deals (board, list, stage moves, lost reason, contacts) | Tested | Stage *editing* UI not built; pipelines can be created via API. |
| Tasks (CRUD, completion, overdue/today filters) | Tested | Subtasks, recurrence, calendar: planned. |
| Activities + connected timeline | Tested | Contact timeline includes its deals; company includes contacts + deals. |
| Dashboard (real aggregates, per-currency) | Tested (data) / Implemented (UI) | |
| Global search | Tested | ILIKE based; permission-scoped. |
| Audit log (append-only, same transaction) | Tested | |
| Optimistic concurrency (`version`) | Tested | |
| REST API v1 | Implemented | Exercised via curl; no OpenAPI file yet. |
| CSRF origin check, rate limiting | Tested (service) | Rate limiter is database-backed (multi-instance safe). CSRF check exercised via curl. |
| MFA (TOTP + recovery codes), email verification, password reset, password change, session list/revoke | Tested (services) / Implemented (UI) | Needs `SMTP_URL` to deliver mail, otherwise logged only. Verification is not enforced at sign-in. No WebAuthn, no enforced-MFA policy. |
| Teams (as a grouping), `team` scope | **Planned** | |
| Custom fields UI, tags UI, duplicate *merge* | **Planned** | Columns exist (`tags`, `custom`); no UI. |
| In-app notifications (bell, unread count, mark read) | Tested | First consumer of the event pipeline: assigning a task notifies the new assignee. Polled every 15 s; live push, per-person preferences, email/push delivery: Planned. |
| Playwright E2E, accessibility automation, load tests | **Planned** | |
| CI pipeline | Tested | `.github/workflows/ci.yml` ran green on GitHub Actions (2026-11-07, Ubuntu, Node 24): typecheck, lint, 58 tests, build, `npm audit --audit-level=high`. Runner pinned to `ubuntu-24.04`. |

## Platform foundations (background work)

| Feature | State | Notes |
|---|---|---|
| Job queue (Postgres, `SKIP LOCKED`): idempotent enqueue, retries with exponential backoff + jitter, dead-letter, timeouts, crash recovery by lease | Tested | At-least-once delivery: handlers must be idempotent. No new infrastructure (no Redis). |
| Domain events (transactional outbox) + dispatcher: one job per interested handler, idempotent fan-out | Tested | 8 event types are emitted (`contact.created`, `lead.created`, `lead.converted`, `deal.created`, `deal.stage_changed`, `task.created`, `task.assigned`, `task.completed`). **Only `task.assigned` has a consumer today**; the rest are recorded for automation (Phase 3). |
| Email retry: inline first attempt, queued retries (8 attempts over about a day) on SMTP failure | Tested | Message body stored encrypted and wiped when the job finishes. Nothing is queued when SMTP is not configured. |
| Scheduled jobs + housekeeping (purges rate-limit hits, expired tokens and sessions, finished jobs, old events) | Tested | Hourly, exactly once across instances. Audit and authentication logs are never purged. |
| In-process worker started by `instrumentation.ts`; secret-protected `/api/internal/jobs/drain` for serverless hosts | Tested (worker, drain logic) / Implemented (HTTP drain) | The drain endpoint's HTTP wrapper was exercised manually, not by an automated test. |
| Super Admin "Background jobs": live queue health, problem jobs, retry / cancel | Tested (service) / Implemented (UI) | Retry and cancel are audited. |

## Product scope: module status (21 modules)
Statuses: Planned · In Progress · Implemented · Tested · Blocked. Per-feature detail is in the tables above; how this was derived is in [EXISTING_SYSTEM_AUDIT.md](EXISTING_SYSTEM_AUDIT.md) §5.

| # | Module | Status |
|---|---|---|
| 1 | Identity & organization management | **Tested**: auth, MFA, reset, sessions, invitations, multi-company, platform admin, custom roles & permissions. **Planned**: departments/teams, SSO, org policies |
| 2 | Personalized dashboard | Implemented (one live dashboard). Planned: per-role views, widgets, saved layouts |
| 3 | CRM | Tested (contacts, companies, leads, timeline, duplicate prevention). Planned: CSV import, merge UI, tags/custom fields UI, attachments, Customer 360 |
| 4 | Sales | Tested (pipeline, deals, Kanban, lost reasons). Planned: products, quotes, forecasting, approvals |
| 5 | Unified communication | Planned |
| 6 | Marketing automation | Planned |
| 7 | Customer support | Planned |
| 8 | Products & finance | Planned |
| 9 | Tasks, projects, workforce | Tested (tasks). Planned: subtasks, recurrence, calendar, projects |
| 10 | Visual automation engine | Planned (needs job queue + domain events first) |
| 11-14 | AI command center, agents, BI, company memory | Planned. **Blocked**: needs an AI provider decision and credentials |
| 15-16 | Industry templates, no-code customization | Planned |
| 17 | Analytics & reporting | Planned beyond the dashboard |
| 18 | Integration ecosystem | Planned |
| 19 | Customer portal | Planned |
| 20 | Enterprise administration & security | Partial: audit log, MFA, sessions, rate limiting Tested. Planned: SSO, retention, export, backup |
| 21 | Mobile & global | Partial: responsive shell Tested at 390px; multi-currency/time zone Tested. Planned: i18n, offline |

## Phases 2–7
All **Planned**. Nothing from communication, marketing, support, finance, automation, AI, company memory, industry templates, enterprise SSO, mobile, or integrations exists. Those documents are design intent only.

## Blocked / needs your input
- No browser extension connection in the build session → UI not visually verified.
- Email/SMS/WhatsApp/payments/AI providers: no accounts or keys; nothing is simulated or faked in the product.
