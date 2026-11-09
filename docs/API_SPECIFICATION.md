# REST API v1

Base path `/api/v1`. JSON in/out. Cookie-authenticated (same-origin browser clients). Machine/API-key access and an OpenAPI document are **planned**, not built.

## Conventions
- **Auth:** session cookie. 401 `unauthenticated` if missing/expired.
- **Tenancy:** the organization is the session's active organization. There is no org id in any URL or body.
- **Mutations:** must send `Origin` equal to the app origin (or `Sec-Fetch-Site: same-origin`); otherwise 403.
- **Errors:** `{ "error": { "code", "message", "details?" } }`. Codes → status: `unauthenticated` 401, `forbidden` 403, `not_found` 404, `conflict` 409, `validation_failed` 422 (`details.fields` maps field → message), `rate_limited` 429, `internal` 500. Records you may not see are reported as `not_found`.
- **Lists:** `?page=1&pageSize=25&q=` → `{ items, total, page, pageSize }`. `pageSize` ≤ 100.
- **Concurrency:** PATCH bodies may include `version`; mismatch → 409.
- **Money:** decimal strings (`"1500.50"`) plus ISO currency code.
- **Dates:** ISO-8601 UTC strings; `expectedCloseDate` is `YYYY-MM-DD`.
- Responses are `Cache-Control: no-store`.

## Endpoints
| Method & path | Permission | Notes |
|---|---|---|
| `POST /auth/register` | public | **404 unless `ALLOW_PUBLIC_REGISTRATION=true`** (development only). Creates user + org, sets cookie. 201 |
| `POST /auth/setup` | public + `BOOTSTRAP_TOKEN` | One-time creation of the first Super Admin. 404 afterwards, and when no token is configured. 201 |
| `POST /auth/login` | public | Sets cookie. Returns `{ok, redirectTo}` (`/super-admin` or `/dashboard`) or `{mfaRequired}`. 403 if the account has no active company. 429 when locked/limited |
| `POST /auth/mfa` | pending session | Second sign-in step; returns `redirectTo` |
| `POST /auth/logout` | public | Revokes session |
| `GET /me` | any | User, org, role, permissions, organizations |
| `POST /me/organization` | member | `{organizationId}` switch |
| *(removed)* `POST /organizations` | — | Companies are created only by the Super Admin |
| `GET /invite/{token}` · `POST /invite/{token}` | public | Preview / accept (`{name?, password}`) |
| `GET/POST /invitations` · `DELETE /invitations/{id}` | `member.invite` | POST returns the one-time `url` |
| `GET /members` · `PATCH /members/{id}` | `member.read` / `member.manage` | `{roleKey?, status?}` |
| `GET /roles` | `role.read` | With permissions, `isSystem`, `memberCount` |
| `POST /roles` | `role.manage` | `{name, description?, permissions: {key: "all"|"own"}}`. 422 for unknown keys, unsupported scopes or incoherent sets; 403 if it contains a permission the caller does not hold; 409 duplicate name. 201 |
| `PATCH /roles/{id}` · `DELETE /roles/{id}` | `role.manage` | Custom roles only (system roles 409). 403 for a role stronger than the caller. DELETE 409 while people or live invitations use it |
| `GET/POST /contacts` · `GET/PATCH/DELETE /contacts/{id}` · `GET /contacts/{id}/timeline` | `contact.*` | Email unique per org → 409 with `existingContactId` |
| `GET/POST /companies` · `…/{id}` · `…/{id}/timeline` | `company.*` | |
| `GET/POST /leads` · `…/{id}` · `…/{id}/timeline` · `POST /leads/{id}/convert` | `lead.*`, `lead.convert` | Convert `{createDeal, dealTitle?, dealAmount?, pipelineId?}` |
| `GET/POST /deals` · `…/{id}` · `…/{id}/timeline` | `deal.*` | |
| `POST /deals/{id}/move` | `deal.write` | `{stageId, lostReason?, version?}`; lost needs a reason |
| `POST /deals/{id}/contacts` · `DELETE /deals/{id}/contacts/{contactId}` | `deal.write` | |
| `GET /board?pipelineId=` | `deal.read` | Stages with deals |
| `GET/POST /pipelines` | `deal.read` / `pipeline.manage` | POST `{name, stages[]}` needs a won and a lost stage |
| `GET/POST /tasks` · `PATCH/DELETE /tasks/{id}` | `task.*` | Filters: `status, assigneeId, contactId, dealId, due=overdue|today|upcoming` |
| `POST /activities` · `DELETE /activities/{id}` | `activity.write` | `type` ∈ note, call, email, meeting; must link a record you can see |
| `GET /search?q=` | per type | ≥2 chars; scoped by permission |
| `GET /dashboard` | any | Aggregates for the caller |
| `GET /audit-logs` | `audit.read` | |
| `GET /health` | public | `{status, database}` |

### Platform (Super Admin) endpoints — `/api/v1/platform/*`
Authorised **only** by the platform resolver. A company session, including a Company Admin's, gets **404** (the routes' existence is not disclosed); no session gets 401.

| Method & path | Notes |
|---|---|
| `GET/POST /platform/companies` | GET: filters `q, country, industry, status, plan, from, to`, `sort`, `dir`, `page`. POST: `{company{…}, status, administrator{…}}` creates company + roles + pipeline + admin invitation in one transaction; returns the one-time invitation `url` and whether it was `emailed`. 409 on duplicate legal name / registration number in a country |
| `GET/PATCH /platform/companies/{id}` | Detail with administrators, pending invitations, audit. PATCH takes any profile fields; only real changes are audited |
| `POST /platform/companies/{id}/status` | `{status: active|suspended|deactivated|archived, reason}`; reason required unless activating; illegal transitions 409 |
| `POST /platform/companies/{id}/administrators` | `{name, email, phone?, jobTitle?}`: promotes an existing member or issues a fresh invitation (older links for that email stop working) |
| `DELETE /platform/companies/{id}/administrators/{membershipId}` | Steps a Company Admin down to Admin; refused for the last active one |
| `POST /platform/companies/{id}/delete` | `{confirmName, password}`; archived companies only; soft delete |
| `GET /platform/plans` | Plan catalogue |
| `POST /platform/jobs/{id}/retry` · `POST /platform/jobs/{id}/cancel` | Dead/cancelled → queued with a fresh attempt budget; queued → cancelled. Both audited. Anything else 409 |

### Internal
`POST|GET /api/internal/jobs/drain` with `Authorization: Bearer $CRON_SECRET` runs the queue for up to 20 s. 404 when `CRON_SECRET` is not set, 401 for a wrong secret. For hosts that cannot keep a worker process running.

### Notifications (the signed-in person's own)
| Method & path | Notes |
|---|---|
| `GET /notifications` | `{items (latest 20), unread}`. Row-level security limits rows to the caller, inside their company |
| `POST /notifications/read` | `{all: true}` or `{ids: [uuid…]}`. Marking someone else's notification changes nothing |

### Company settings (Company Admin, `org.manage`)
| Method & path | Notes |
|---|---|
| `GET /company` | The caller's own company profile and regional settings (the company always comes from the session) |
| `PATCH /company` | Display name, industry, website, contact details, logo URL (https only), region/city/address, tax id, currency, time zone, language, date format, phone code. Legal name, country, registration number, plan and status are ignored. Audited as `company.profile_updated` |

### Personal account endpoints (any signed-in person, company user or Super Admin)
`GET/POST /me/mfa`, `POST /me/mfa/enable`, `POST /me/mfa/disable`, `POST /me/password`, `DELETE /me/sessions/{id}`, `POST /me/verification`.

Request/response schemas are the zod definitions in `src/shared/schemas/*` (single source of truth for client and server validation).
