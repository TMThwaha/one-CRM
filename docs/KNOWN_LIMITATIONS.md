# Known limitations

Honest list of what is missing, weak or unverified. Security-relevant items first.

## Security
1. **Email delivery needs SMTP.** Password reset, email verification and invitation emails are only delivered when `SMTP_URL` is set; otherwise they are written to the server log and the UI tells the inviter to share the link. Email verification is *not enforced* (unverified users can still sign in). Registration does not prove email ownership until the user confirms the link. MFA is TOTP only: no WebAuthn/passkeys, no SMS, no admin-enforced MFA policy, and no admin reset for a user who lost both their device and recovery codes. Do not expose this build to the public internet.
2. **Rate limiting is database-backed** (`rate_limit_hits`), so it holds across instances and restarts, at the cost of a write per limited request. It is not a substitute for edge/WAF limits against volumetric abuse.
3. **`X-Forwarded-For` is trusted** for IP logging/limits. Only safe behind a proxy that overwrites it.
4. **Invitation links are the only delivery mechanism.** They are shown once to the inviter; anyone holding the link can join as the invited role until it expires (7 days) or is revoked.
5. **No CSP header yet** (other security headers are set). Next.js inline scripts need a nonce-based policy; planned.
6. **`team` scope** is enforced as `own` (more restrictive). Teams do not exist yet.
7. **Row-level security was verified on PGlite** (real PostgreSQL engine) but **not yet on a managed Postgres** with a non-superuser connection role. The migration assumes the connecting role can `CREATE ROLE` and `SET ROLE onecrm_app`; validate on your target host before relying on it.
8. Not security-reviewed by a third party; no penetration test; no compliance (DPDP/GDPR/SOC2) claims are made.

## Product
9. No email/SMS/WhatsApp; invitations and notifications are not delivered.
10. Pipeline stages cannot be edited in the UI (create via API only).
11. No duplicate *merge* (duplicates are prevented by email uniqueness and reported on conflict); no tags/custom-field UI; no import/export.
12. Company/contact pickers load the first 100 options (no async search) — fails for large datasets.
13. A task is visible to its assignee and its creator. If an `own`-scoped user assigns a task to a colleague, both can see it; nobody else with `own` scope can.
14. Search is `ILIKE` without trigram/full-text indexes — fine to ~10⁵ rows per tenant, then needs `pg_trgm`/OpenSearch.
15. List endpoints use offset pagination; deep pages on very large tables will be slow (keyset pagination planned).
16. Dashboard figures are computed live per request (no caching/materialisation).
17. Money is displayed through `Intl` (JS number) — exact in storage and transport, display-only rounding beyond ~15 significant digits.
18. Deal amounts in different currencies are never summed; the dashboard shows one figure per currency. No FX conversion.

## Engineering
19. **UI not verified in a real browser** during the build (browser tooling unavailable). Server-rendered output and the API were verified; client interactions (drag and drop, command palette, forms) rely on type checking, lint and code review only.
20. No end-to-end, accessibility, or load tests yet. No performance targets have been measured.
21. PGlite is single-connection and for development/tests only. Production requires PostgreSQL via `DATABASE_URL`.
22. `next build` prints a Turbopack warning ("dynamic filesystem access") from resolving the `drizzle/` migrations folder at runtime; harmless but should be replaced by bundling migrations.
23. Background jobs, event outbox, Redis, object storage, observability (OpenTelemetry) are designed but not built.
24. `docker-compose.yml` and the CI workflow were written but never executed.

## Platform administration
1. **No support-access sessions.** The Super Admin cannot enter a company workspace (safe, but no support path yet). The reason/start/end/visible-to-company mechanism is unbuilt.
2. **Only one way to get a Super Admin.** The one-time `/setup`. There is no UI to add a second Super Admin, rotate, or recover one who lost both password and second factor (recovery means operator access to the database).
3. **Super Admin MFA is encouraged, not required.**
4. **Plans are names only.** No pricing, employee/storage limits, module entitlements, trials or payments exist, and **no plan limit is enforced**. Plan creation/editing UI is not built.
5. **Date format pattern is stored but not applied.** The workspace now shows dates, times and money in the company's time zone and locale (month-name style from the language setting), but the company's `dateFormat` pattern (e.g. `dd/MM/yyyy`) is not used because no screen displays purely numeric dates yet. Platform pages show UTC. Date-only fields (e.g. expected close date) are never shifted between zones.
6. **Company logo is a URL**, not an upload (no file storage exists). It must be an `https://` address; the workspace sidebar shows it (no referrer is sent). The image is fetched from the company's own host, so a company can point it at any https image.
7. **Platform pages not yet built:** usage, global AI settings, integration management, announcements, system health, platform settings (shown as "Not built yet" in the sidebar), and platform-wide user actions (disable a user).
8. **Departments/teams and custom roles** are not built (Phase 3). A Company Admin can edit their company's profile and regional settings (**Settings → Company**) but not its legal name, country, registration number, plan or status; those are platform-controlled.
9. **Deleting a company is a soft delete.** Data is retained; there is no purge or data-export tool.
10. **Tax fields are labels only.** Nothing is validated, calculated or filed, and no regional compliance is claimed.
11. **Country catalogue is curated (39 countries)**, not exhaustive; multi-time-zone countries default to one zone.

## Roles and navigation
1. **Permissions are coarse-grained and per resource.** No field-level permissions, no export or finance permissions (those modules do not exist), and no `team` scope in the editor (teams do not exist; the scope would silently behave as `own`).
2. A company can have at most **50 custom roles**. Deleting a role also removes its spent (accepted, revoked or expired) invitations, which are already recorded in the audit log.
3. Navigation shows only built modules and has no favourites/pinning yet.
4. A person cannot change their own role (an intentional safeguard), so a sole Company Admin cannot test a custom role on themselves; invite or use a second account.
5. The registration rate limit (default 10 per IP per hour) is configurable via `REGISTER_RATE_LIMIT_PER_HOUR`; it is only raised for automated test runs.
