# Implementation status

Legend: **Tested** = covered by automated tests that pass. **Implemented** = works end to end but only manually exercised. **Planned** = not built.

Last verified: 2026-11-08 — `npm run verify`: 86 unit/integration tests passed, lint 0 problems, typecheck clean, production build succeeds, `npm audit --omit=dev` 0 vulnerabilities. Playwright (real Chrome, production build, fresh database): 17 tests passed, including axe WCAG 2.1 A/AA scans of every Super Admin page in light and dark mode. GitHub Actions CI also passed on this commit (typecheck, lint, tests, build, audit).

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
| Country/currency/time-zone defaults per company | Tested (storage, validation, defaults) | Workspace date display still uses the browser zone (see KNOWN_LIMITATIONS). |
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
| Roles & permissions (5 system roles, scopes `all`/`own`) | Tested | Custom roles: not built. `team` scope is enforced as `own`. |
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
| Notifications | **Planned** | |
| Playwright E2E, accessibility automation, load tests | **Planned** | |
| CI pipeline | Tested | `.github/workflows/ci.yml` ran green on GitHub Actions (2026-11-07, Ubuntu, Node 24): typecheck, lint, 58 tests, build, `npm audit --audit-level=high`. Runner pinned to `ubuntu-24.04`. |

## Phases 2–7
All **Planned**. Nothing from communication, marketing, support, finance, automation, AI, company memory, industry templates, enterprise SSO, mobile, or integrations exists. Those documents are design intent only.

## Blocked / needs your input
- No browser extension connection in the build session → UI not visually verified.
- Email/SMS/WhatsApp/payments/AI providers: no accounts or keys; nothing is simulated or faked in the product.
