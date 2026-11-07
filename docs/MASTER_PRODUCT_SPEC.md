# Master product spec

Scope per module with its first acceptance criteria and current state. "Built" means implemented and tested as recorded in IMPLEMENTATION_STATUS.

| # | Module | Scope (target) | Built now | Acceptance (first slice) |
|---|---|---|---|---|
| 1 | Identity & organization | Register, login, reset, verification, MFA, orgs, switching, invitations, departments, teams, roles, sessions | Register, login, logout, sessions, orgs + switching, invitations, roles, members | No cross-tenant access; role change effective next request; invite single-use |
| 2 | Personalized dashboard | Role dashboards, configurable widgets | Fixed dashboard from real aggregates | Shows only data the caller may see; per-currency money |
| 3 | CRM | Contacts, companies, leads, dedupe/merge, enrichment, scoring, segmentation, custom fields, 360 | Contacts, companies, leads, uniqueness, scoring, convert, 360 | No duplicate contacts by email; lead→contact preserves history |
| 4 | Sales | Pipelines, deals, quotes, discount approvals, forecasting, renewals | Pipelines, deals, stages, lost reasons, deal contacts, weighted pipeline | Stage move derives status/probability, recorded on timeline |
| 5 | Communication center | Email, WhatsApp, SMS, chat, telephony, unified inbox | — | Planned (Phase 2) |
| 6 | Marketing automation | Campaigns, segments, journeys, attribution | — | Planned (Phase 6) |
| 7 | Support | Tickets, SLA, portal, knowledge base | — | Planned (Phase 2) |
| 8 | Products/quotes/finance | Catalogue, quotes, invoices, payments | — | Planned (Phase 2/6); decimal-safe model already in place |
| 9 | Tasks & workforce | Tasks, calendar, approvals, projects | Tasks linked to records, completion, filters | Overdue/today views; completion on timeline |
| 10 | Visual automation engine | Triggers, branches, approvals, retries, simulation | — | Planned (Phase 3) |
| 11 | AI command center | NL commands with authorization & confirmation | Command **palette** (search/navigate/create), not AI | Planned (Phase 4) |
| 12 | AI agents | Nine specialised agents with bounded autonomy | — | Planned (Phase 5) |
| 13 | AI business intelligence | Briefings, risk, forecasts with uncertainty | Rule-based, explainable lead score only | Planned (Phase 4+) |
| 14 | Company memory | Permission-aware semantic search | — | Planned (Phase 6) |
| 15 | Industry templates | Configurable templates | Org `industry` field only | Planned (Phase 6) |
| 16 | No-code customization | Fields, modules, layouts | `custom` JSONB column reserved | Planned (Phase 6) |
| 17 | Analytics & reporting | Custom reports, exports | Dashboard aggregates only | Planned |
| 18 | Integrations | OAuth, webhooks, marketplace | — | Planned (see INTEGRATION_STRATEGY) |
| 19 | Customer portal | Isolated customer identities | — | Planned (Phase 2) |
| 20 | Enterprise admin & security | SSO, audit, retention, consent, export | Audit log, RBAC, RLS | SSO/retention/consent planned (Phase 7) |
| 21 | Mobile & global | Offline, i18n, multi-currency | `en-IN` formatting; ISO currency per deal | Planned (Phase 7) |

## Cross-cutting requirements
Tenant isolation at three layers; every mutation audited; optimistic concurrency; exact decimals; typed links (no polymorphic FKs); idempotent, retryable background work and an outbox for events (when jobs arrive); consent/unsubscribe respected before any outbound communication; AI output is never an authorization source.

## Industry strategy
One core; industries are configuration (entities, fields, pipelines, workflows, roles, templates). No industry-specific code paths in the core. Today only an `industry` label exists on the organization.
