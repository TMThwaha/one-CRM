# ONECRM

An AI-native, all-in-one business operating system — customers, sales, work and (later) automation and AI agents in one connected platform.

> **Status: Phase 1 foundation.** The CRM core (identity, multi-tenancy, roles, contacts, companies, leads, deals, tasks, timeline, audit) is implemented and tested. Communication, marketing, support, finance, automation, AI and everything else in the vision are **not built yet**. See [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) for the honest, per-feature state.

## Quick start

Requires Node 22+ (developed on Node 24). No Docker or database install needed for development — it uses an embedded PostgreSQL (PGlite).

```bash
npm install
npm run dev          # http://localhost:3000
```

Open the app, choose **Create an account**, and you become the owner of a new workspace with a default sales pipeline. Data persists in `.data/pglite/`. To start fresh, stop the server and delete `.data/`.

Try the permission model: **Settings → Team → Invite teammate**, pick the *Sales* role, open the invitation link in a private window, then create a deal in each account. The Sales user will only ever see their own deals and leads.

### Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run typecheck` | Generates route types, runs `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest: tenant isolation, RLS, permissions, workflows (real Postgres engine, real migrations) |
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
