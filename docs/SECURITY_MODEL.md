# Security model

No certification or regulatory compliance is claimed. This documents controls that exist, how they were tested, and what is missing.

## Authentication & sessions
- Passwords: scrypt N=2^17,r=8,p=1, per-user salt; verification is timing-safe; unknown-user logins burn an equal hash.
- Lockout: 5 consecutive failures ⇒ 15-minute lock (durable). IP and email rate limits (database-backed, shared across instances).
- Sessions: 256-bit random token in HttpOnly, SameSite=Lax cookie (`__Host-` + Secure in production); only SHA-256 stored; 14-day default expiry; revocable; re-validated on every request. Logout revokes server-side.
- Generic "Invalid email or password"; invitation errors are identical for unknown/used/revoked/expired tokens.
- Multi-factor: TOTP (RFC 6238, SHA-1, 6 digits, ±1 step) with seeds encrypted at rest (AES-256-GCM, `APP_ENCRYPTION_KEY`). Password step creates a short-lived *pending* session (10 min) that resolves to no identity anywhere until the code is verified; guessing is throttled per pending session and per user. 8 single-use recovery codes, stored hashed. Disabling needs password and a code.
- Password reset: single-use, 60-minute, hashed tokens; a newer request invalidates older links; identical response for known/unknown accounts; completing a reset revokes all sessions and clears lockout. Changing a password revokes other sessions. Users can list and revoke their own sessions (Settings → Security).
- Email verification: 48-hour single-use token confirmed with an explicit button (POST) so link scanners cannot consume it. Not enforced at sign-in.
- **Missing:** WebAuthn/passkeys, enforced MFA policy, admin MFA reset, breach-password check, step-up auth for sensitive actions.

## Authorization
- RBAC: permission catalog in `src/shared/permissions.ts`; five system roles; scopes `all`/`own`.
- Every service starts with `require(ctx, permission)` and applies record scope in SQL. Out-of-scope records return 404.
- Escalation guard: cannot grant a role holding permissions you lack; last active owner cannot be demoted/suspended; cannot suspend yourself.
- Suspension, role changes and session revocation take effect on the next request (context rebuilt per request).
- Search, dashboard and timeline apply the same scope rules as list endpoints (tested: a Sales user cannot see a colleague's deal, its activity, or find it by search).

## Tenant isolation (see DATABASE_DESIGN)
Org id is derived from the session, never from the request. Defense in depth: service scoping → RLS (`onecrm_app`, `SET LOCAL ROLE`, `app.org_id`) → composite FKs. Tested: cross-tenant read/update/delete by id, lists, board, search, tasks, timeline, audit; raw SQL with no WHERE; cross-tenant insert (WITH CHECK); missing org context; cross-tenant FK references through the owning connection.

## Web security
- CSRF: SameSite=Lax + required same-origin `Origin` (or `Sec-Fetch-Site`) on all state-changing API calls (tested with curl).
- Headers: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, HSTS. **No CSP yet.**
- Output encoding by React; no `dangerouslySetInnerHTML` except the static theme bootstrap script.
- SQL: Drizzle parameterisation; LIKE wildcards escaped.
- Errors: unexpected errors are logged server-side and returned as a generic 500.
- Secrets: none in code; configuration via environment.

## Auditability
Audit rows are written in the same transaction as the change (actor, action, entity, diff of changed fields, IP). The app DB role cannot update or delete them (tested). Authentication events go to `auth_events`.

## Threats considered / open
| Threat | Status |
|---|---|
| Cross-tenant data access | Mitigated, tested |
| Horizontal privilege escalation (own-scope bypass) | Mitigated, tested |
| Vertical escalation via invites/role edits | Mitigated, tested |
| Credential stuffing / brute force | Mitigated (lockout, database-backed limits, optional TOTP MFA) |
| Session theft | HttpOnly/Secure/hashed; no device binding |
| CSRF | Mitigated |
| XSS | React escaping; CSP missing |
| Mass assignment | zod schemas whitelist fields; organization/ownership set server-side |
| Invitation link leakage | Single-use, 7-day expiry, hashed at rest; no email channel |
| Dependency vulnerabilities | `npm audit --omit=dev`: 0 (dev tooling has moderate advisories) |
| Prompt injection / agent abuse | N/A (no AI built); design in AI_ARCHITECTURE |

## Required before any real deployment
CSP, validation of RLS on the production Postgres with a non-owner connection role, an SMTP provider plus `APP_ENCRYPTION_KEY` in secret management, backup/restore drill, external security review.
