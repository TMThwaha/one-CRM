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
| `POST /auth/register` | public | Creates user + org (+ roles, default pipeline), sets cookie. 201 |
| `POST /auth/login` | public | Sets cookie. 429 when locked/limited |
| `POST /auth/logout` | public | Revokes session |
| `GET /me` | any | User, org, role, permissions, organizations |
| `POST /me/organization` | member | `{organizationId}` switch |
| `POST /organizations` | any | Create additional org |
| `GET /invite/{token}` · `POST /invite/{token}` | public | Preview / accept (`{name?, password}`) |
| `GET/POST /invitations` · `DELETE /invitations/{id}` | `member.invite` | POST returns the one-time `url` |
| `GET /members` · `PATCH /members/{id}` | `member.read` / `member.manage` | `{roleKey?, status?}` |
| `GET /roles` | `role.read` | With permissions |
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

Request/response schemas are the zod definitions in `src/shared/schemas/*` (single source of truth for client and server validation).
