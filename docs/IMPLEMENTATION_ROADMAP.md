# Implementation roadmap

| Phase | Theme | State |
|---|---|---|
| 0 | Product & architecture foundation (docs, schema, design system, CI) | Done (CI file unexecuted) |
| 1 | CRM foundation: shell, auth, tenancy, roles, contacts, companies, leads, deals, tasks, timeline, audit | **Done and tested** (gaps below) |
| 2 | Business operations: products, quotes + approvals, unified inbox foundations, tickets, portal foundations, reports, notifications | Planned |
| 3 | Automation: event outbox, job queue, workflow builder + engine, approvals, retries, monitoring | Planned |
| 4 | AI: provider gateway, command center, summaries, recommendations, permissions, tool framework, approvals, usage/cost | Planned |
| 5 | Specialised agents + orchestration + controls | Planned |
| 6 | Marketing, customer success, analytics, finance workflows, projects, company memory, industry templates, no-code customization | Planned |
| 7 | Enterprise (SSO, retention, consent, regional), i18n, mobile/offline, marketplace, public API, scale | Planned |

## Platform hierarchy (built 2026-11-08)
Super Admin bootstrap and panel, company creation with administrator invitation, company lifecycle, platform audit, tenant-isolation tests across companies. **Next, in order:** Phase 3 company-admin workspace (company profile, departments/teams, custom roles, company settings incl. logo upload and workspace date formatting in the company time zone), then support-access sessions, enforced Super Admin MFA, and plan limits/pricing.

## Phase 1 completion gaps (next milestone, "1.1")
Must-do before treating Phase 1 as production-ready:
1. ~~MFA (TOTP), email verification, password reset~~ — built (needs `SMTP_URL` for real delivery; see KNOWN_LIMITATIONS).
2. Content-Security-Policy with nonces. (Rate limiting is now database-backed.)
3. Validate migrations + RLS on managed PostgreSQL with a non-owner role; backup/restore drill.
4. Playwright E2E (auth, create-contact, convert-lead, board move, permission scenarios) and axe accessibility checks; visual QA in a browser.
5. Notifications (assignment, mentions, due tasks) and a unified notification centre.
6. Teams + `team` scope; stage/pipeline editor; tags + custom-field UI; duplicate merge with history/undo; CSV import/export.
7. Async pickers; keyset pagination; `pg_trgm` search indexes; measured performance budgets.
8. OpenAPI document generated from the zod schemas; API keys for server-to-server access.

## Sequencing rationale
Automation (3) before AI (4–5): agents and workflows need the same event, job, approval and audit infrastructure, and AI actions must reuse tenant context and permission checks rather than invent a parallel path. Phase 2's communication work must include consent and unsubscribe handling before any outbound channel is enabled.
