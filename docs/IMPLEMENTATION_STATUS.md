# Implementation status

Legend: **Tested** = covered by automated tests that pass. **Implemented** = works end to end but only manually exercised. **Planned** = not built.

Last verified: 2026-11-07 — `npm run verify`: 58 tests passed, lint 0 problems, typecheck clean, production build succeeds. Account-security HTTP flow (register → enable MFA → pending login → code → access) also exercised against a running dev server with curl; pages were **not** viewed in a browser.

## Phase 1 — Foundation

| Feature | State | Notes |
|---|---|---|
| Application shell (nav, org switcher, command palette, create menu, theme) | Implemented | Rendered and checked via server-side requests only; **not visually verified in a browser** (extension unavailable). |
| Registration, login, logout | Tested | Lockout after 5 failures, generic errors, timing equalisation. |
| Sessions (server-side, hashed token, revocable, expiry) | Tested | |
| Organization creation + multiple orgs per user + switching | Tested | UI for *creating an additional* org is not built (API only). |
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
| CI pipeline | Implemented (untested) | `.github/workflows/ci.yml` has not run. |

## Phases 2–7
All **Planned**. Nothing from communication, marketing, support, finance, automation, AI, company memory, industry templates, enterprise SSO, mobile, or integrations exists. Those documents are design intent only.

## Blocked / needs your input
- No browser extension connection in the build session → UI not visually verified.
- Email/SMS/WhatsApp/payments/AI providers: no accounts or keys; nothing is simulated or faked in the product.
