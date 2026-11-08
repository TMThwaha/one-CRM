# ONECRM

An AI-native, all-in-one business operating system — customers, sales, work and (later) automation and AI agents in one connected platform.

> **Status: Phase 1 foundation + platform administration.** A centrally managed, multi-company platform: a Global Super Admin creates companies and appoints their administrators; each company gets an isolated workspace. The CRM core (identity, multi-tenancy, roles, contacts, companies, leads, deals, tasks, timeline, audit) is implemented and tested. Communication, marketing, support, finance, automation, AI and everything else in the vision are **not built yet**. See [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) for the honest, per-feature state.

## Quick start

Requires Node 22+ (developed on Node 24). No Docker or database install needed for development — it uses an embedded PostgreSQL (PGlite).

```bash
npm install
npm run dev          # http://localhost:3000
```

OneCRM is **centrally managed**: visitors cannot create companies. You (the platform owner) are the Global Super Admin and create every company. There are **no default credentials**; you create the Super Admin once, yourself:

1. Put a one-time setup secret in `.env.local` (24+ characters): `BOOTSTRAP_TOKEN=<output of: openssl rand -hex 24>`
2. `npm run dev`, then open **http://localhost:3000/setup** and create the Super Admin with your own name, email and password. The page works once; afterwards `/setup` is a 404 forever. Then remove `BOOTSTRAP_TOKEN` from the environment.
3. Sign in at `/login`. You land in the **Super Admin panel** (`/super-admin`). Turn on two-factor authentication under **Security**.
4. **Create Company**: fill in the company, its country (pre-fills currency, time zone and language), plan, and the administrator. Without `SMTP_URL` no email is sent, so the success page shows the administrator's invitation link once; send it to them.
5. The administrator opens the link, sets their own password and lands in their company's workspace (`/dashboard`). They can never see `/super-admin` (404) or any other company.

Data persists in `.data/pglite/`. To start fresh, stop the server and delete `.data/`. For quick local experiments only, `ALLOW_PUBLIC_REGISTRATION=true` re-enables self-service sign-up at `/register`.

Try the permission model: as a Company Admin, **Settings → Team → Invite teammate**, pick the *Sales* role, open the link in a private window, then create a deal in each account. The Sales user only ever sees their own deals and leads.

### Optional: dummy company for local testing

`npm run seed:dev` creates one dummy company ("Nexora Technologies Pvt Ltd", India) and its **Company Admin**, so you can try a company workspace without using the Super Admin panel. It is development-only, refuses to run in production, is idempotent, and takes the password at run time so none is stored in the repo:

```bash
# stop the dev server first: the embedded database is single-process
SEED_ADMIN_PASSWORD='<at least 10 characters>' npm run seed:dev
```

Sign in at `/login` with the email `admin@nexoratech.test` (people sign in by email; there are no usernames). This is a *company* account, not the platform Super Admin, which is created once at `/setup`.

### Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run typecheck` | Generates route types, runs `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest: tenant isolation, RLS, permissions, platform hierarchy, workflows (real Postgres engine, real migrations) |
| `npm run e2e` | Playwright in a real browser (builds, starts a production server on a fresh database; needs Chrome) |
| `npm run build` | Production build |
| `npm run verify` | All of the above, in order |
| `npm run db:generate` | Generate a SQL migration from schema changes (`drizzle/`) |

### Production database

Set `DATABASE_URL` to a PostgreSQL 15+ instance. Migrations run automatically at start-up. The connecting role must be allowed to create roles and to `SET ROLE onecrm_app` (see [SECURITY_MODEL](docs/SECURITY_MODEL.md)). The app refuses to start in production without `DATABASE_URL`. A `docker-compose.yml` is provided for local Postgres; it has **not** been exercised in this environment.

Copy `.env.example` to `.env.local` for configuration.

## Documentation

| Doc | Contents |
|---|---|
| [PRODUCT_VISION](docs/PRODUCT_VISION.md) | What ONECRM is for and the principles it is held to |
| [MASTER_PRODUCT_SPEC](docs/MASTER_PRODUCT_SPEC.md) | Module-by-module scope and acceptance criteria |
| [SYSTEM_ARCHITECTURE](docs/SYSTEM_ARCHITECTURE.md) | Modular monolith, layering, request flow |
| [DATABASE_DESIGN](docs/DATABASE_DESIGN.md) | Schema, tenancy model, ER diagram |
| [SECURITY_MODEL](docs/SECURITY_MODEL.md) | Auth, sessions, RBAC/ABAC, RLS, threats |
| [AI_ARCHITECTURE](docs/AI_ARCHITECTURE.md) | Planned AI gateway, agent permission model (**design only**) |
| [AUTOMATION_ENGINE](docs/AUTOMATION_ENGINE.md) | Planned workflow engine (**design only**) |
| [UX_DESIGN_SYSTEM](docs/UX_DESIGN_SYSTEM.md) | Tokens, components, interaction principles |
| [API_SPECIFICATION](docs/API_SPECIFICATION.md) | REST v1 contract |
| [INTEGRATION_STRATEGY](docs/INTEGRATION_STRATEGY.md) | Planned integration framework (**design only**) |
| [IMPLEMENTATION_ROADMAP](docs/IMPLEMENTATION_ROADMAP.md) | Phases 0–7 |
| [IMPLEMENTATION_STATUS](docs/IMPLEMENTATION_STATUS.md) | What is planned / in progress / implemented / tested |
| [DECISIONS](docs/DECISIONS.md) | Architecture decision records |
| [KNOWN_LIMITATIONS](docs/KNOWN_LIMITATIONS.md) | What does not work or is not safe yet |
