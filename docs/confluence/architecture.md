# Architecture & Technology

## Document Information

| Property     | Value                     |
| ------------ | ------------------------- |
| Document     | Architecture & Technology |
| Product      | Distribution OS           |
| Version      | 2.0                       |
| Status       | Active                    |
| Owner        | Product Management        |
| Last Updated | September 2026            |

---

# Purpose

This page describes the architecture Distribution OS is actually built on, as of 5 September 2026 — not a target design. Every statement here is traceable to the repository: `docs/22-source-of-truth.md` (the single source of truth and its dated decisions register), `CLAUDE.md`, `docs/04-system-architecture-and-data-model.md`, `docs/20-scale-rules.md` and `docs/18-build-log.md` (status numbers).

**Decided 2026-09-05:** the repository is the single source of truth; Confluence mirrors it. Where this page and an older Confluence page disagree, this page and `docs/22` win.

**Decided 2026-09-04:** the technology stack is TypeScript end to end. The August 2026 "Technology Stack (Planned)" table on Home 0.1 named Flutter, Next.js, Redis and BullMQ; none of those is used. The stack below replaces it.

# 1. Architecture in eight lines

1. One git repository, **two independent pnpm workspaces**: `backend/` and `frontend/`.
2. **One NestJS service per app**, each assembled from one shared core library — not a monolith, not microservices with their own databases.
3. **One PostgreSQL 17 database.** Every tenant table carries `tenant_id` with row-level security **enabled and forced**.
4. **Append-only ledgers** for stock and for money; balances are derived, never edited.
5. **Contract-first API** (oRPC + Zod) with a **permission matrix** deciding every endpoint × every role before any business logic runs.
6. **Our own authentication service**: username + password, EdDSA access tokens, rotating per-device refresh tokens.
7. **Object storage** for every binary, and **one pg-boss worker** for outbox relay, retention and document rendering.
8. An **offline write protocol that never answers 4xx**, and scale rules (`docs/20`) that apply from day one.

# 2. Technology stack (actual)

| Layer             | Technology                                       | Note                                                        |
| ----------------- | ------------------------------------------------ | ----------------------------------------------------------- |
| Language          | TypeScript 6.0.x, Node 24                        | Exactly one TypeScript version per workspace                |
| Backend framework | NestJS 12 on Fastify                             | One service per app, one shared core library                |
| API               | oRPC, contract-first                             | Contracts declared in Zod 4 before implementation           |
| Database          | PostgreSQL 17                                    | One database, shared schema, forced RLS                     |
| ORM / migrations  | Drizzle ORM + drizzle-kit                        | Generated migrations plus hand-written guarantee migrations |
| Queue / jobs      | pg-boss (inside Postgres)                        | **Decided 2026-09-04:** no Redis, no BullMQ                 |
| Object storage    | S3-compatible, or a local driver                 | Local driver is the default and needs no cloud account      |
| Auth              | Own service: argon2id + EdDSA JWT + JWKS         | **Decided 2026-09-04:** no third-party auth provider        |
| Web apps          | Vite + React                                     | Owner app runs today on `:5173`                             |
| Mobile apps       | Expo (React Native), Android + iOS               | Starts after the backend is complete                        |
| Tooling           | pnpm 11 workspaces + Turborepo                   | Dependency versions pinned in a workspace `catalog:`        |
| API docs          | Swagger UI + Scalar, generated from the contract | Examples built from real seeded rows                        |

# 3. Repository shape

Two workspaces install and build separately; the repository root holds only `backend/`, `frontend/`, `docs/`, `CLAUDE.md` and dotfiles (**Decided 2026-09-04**).

**`backend/`**

| Package                                                                                                                   | Responsibility                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/domain`                                                                                                             | Pure TypeScript, **zero runtime dependencies**: money in paise, quantities in pieces, GST split, GSTIN checksum, UUIDv7, IST business dates, state machines, the pricing engine |
| `libs/contracts`                                                                                                          | Zod schemas, the oRPC contract (one file per module), and `permissions.ts` — the only place wire shapes and role rules live                                                     |
| `libs/database`                                                                                                           | The only place SQL schema lives: Drizzle schema, RLS policies as code, migrations, seed data, `withTenant()`                                                                    |
| `libs/core`                                                                                                               | Platform services (tenant context, authorization, idempotency, numbering, object storage, PDF documents) and one folder per business module                                     |
| `libs/config`                                                                                                             | Shared TypeScript / ESLint / Vitest presets                                                                                                                                     |
| `role-service` (seven role services plus `auth-service` — eight service packages when `admin-service` lands, seven today) | ~20 lines each: which roles it serves, which modules it mounts, its default port                                                                                                |
| `worker`, `tools`, `infra`                                                                                                | pg-boss consumers; README and key generation, smoke harness; Dockerfile and compose for CI                                                                                      |

**`frontend/`** holds `libs/{ui,api-client,offline,config}` and one app package per role. The apps link `@dos/contracts` and `@dos/domain` as symlinks into the backend, so the wire types and the pricing engine are one implementation shared by server and device — not a copy.

**Module boundaries are enforced, not conventional.** A backend module reaches another module only through its exported application service or an outbox event, never its tables (`eslint-plugin-boundaries`). Cross-module foreign keys point downstream only: tenancy → identity → catalog → tenant-catalog → retailers → pricing → inventory → orders → procurement → warehouse → billing → receivables → delivery → docint → claims → notifications → reporting → integrations → incentives.

# 4. Services, ports and URLs

**Decided 2026-09-04:** every role gets its own app, and every app gets its own backend service, so a role can only reach the endpoints its service mounts. The permission matrix then decides per endpoint inside that. **Decided 2026-09-05:** a seventh app and service, Admin, is in v1.

| Service   | Port | Roles served            | App                         | Local base URL        | Status      |
| --------- | ---- | ----------------------- | --------------------------- | --------------------- | ----------- |
| auth      | 3000 | everyone (sign-in only) | —                           | http://localhost:3000 | Built       |
| owner     | 3001 | owner                   | Distribution OS - Owner     | http://localhost:3001 | Built       |
| manager   | 3002 | manager, accountant     | Distribution OS - Manager   | http://localhost:3002 | Built       |
| sales     | 3003 | salesperson             | Distribution OS - Sales     | http://localhost:3003 | Built       |
| warehouse | 3004 | warehouse               | Distribution OS - Warehouse | http://localhost:3004 | Built       |
| delivery  | 3005 | delivery                | Distribution OS - Delivery  | http://localhost:3005 | Built       |
| retailer  | 3006 | retailer                | Distribution OS - Retailer  | http://localhost:3006 | Built       |
| admin     | 3007 | platform_admin          | Distribution OS - Admin     | http://localhost:3007 | Queued (v1) |
| worker    | —    | system                  | —                           | —                     | Built       |

Every service exposes the same four routes: `/health` (liveness, unauthenticated and outside the tenant guard), `/swagger` (Swagger UI with a working example on every operation), `/docs` (Scalar reference) and `/docs/openapi.json` (the OpenAPI document for that service's contract subset only).

Other local endpoints: owner web app on http://localhost:5173, PostgreSQL on 127.0.0.1:5439 (database `dos`). Deployment is deliberately later; the target is AWS ap-south-1 (Mumbai) per `docs/11-infra-and-cost.md`.

Services are **stateless**: any number of instances of any service may run behind a load balancer with no code change. The database is the only shared state.

# 5. Data layer: one database, hard tenant isolation

- **Shared schema, `tenant_id` on every tenant table**, with `ENABLE` **and** `FORCE ROW LEVEL SECURITY` — forced, so even the owning connection obeys policy.
- All tenant data access goes through `withTenant()`: a transaction that runs `SET LOCAL ROLE app_rw` and sets `app.tenant_id`, `app.actor_id`, `app.actor_role`. Policies read those settings. Nothing reaches a tenant row outside that transaction.
- **Purchase cost, landed cost and margin** live in `tenant_product_costs` under a back-office-only policy. A salesperson, warehouse, delivery or retailer role cannot read them — a database guarantee with tests, not an application rule.
- A retailer sees only rows linked to their own shop; a tenant never sees another tenant's rows. Cross-tenant worker jobs use a separate `app_worker` role.
- **Global vs tenant data:** manufacturers, products and variants are global and curated (a distributor may propose one and use it immediately); retailers, prices, orders and ledgers are per tenant. A user is global and holds one membership per tenant, which is what lets one shopkeeper log in once and see several distributors.
- Schema size today: 126 tables across 23 module schema files. Migrations are numbered and, from 0004 onward, **expand-only**. Roles, grants, forced-RLS assertions, triggers and views live in hand-written migrations beside the generated ones.
- `backend/libs/database/src/rls.test.ts` is the executable form of these rules: cost invisible to a salesperson, tenant isolation, retailer scope, append-only ledgers, journals balancing.

# 6. Append-only ledgers

Two ledgers carry everything that matters, and neither can be edited:

| Ledger                              | Guarantee                                                                                                                                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stock_ledger`                      | Append-only by trigger; one row per physical movement (GRN, reservation, pick, pack, load, return, adjustment, cycle count); `stock_balances` derived in the same transaction; `UNIQUE(tenant_id, idempotency_key)` |
| `journal_lines` / `journal_entries` | Append-only by trigger; double entry that **must balance at commit**, enforced by a `SECURITY DEFINER` database trigger so the check cannot be blinded by the caller's own row-level policy                         |

Consequences that shape the whole product:

1. An issued invoice is never edited. Corrections are credit or debit notes; an invoice cancelled before dispatch keeps its number.
2. Outstanding and ageing are derived from open invoices minus allocations. "Overdue" is computed, never stored.
3. Every mutation carries a client-generated UUIDv7 id and an idempotency key, so a retry or a duplicate offline upload is a no-op.
4. State columns change only through the state machines in `libs/domain` (order, trip and stop, invoice) — never by hand.

# 7. API: contract-first, with a permission matrix

The contract is written first, in `backend/libs/contracts`, and everything else is derived from it:

1. Declare the procedure and its Zod input/output in the module's contract file.
2. Add its row to `PERMISSIONS` — 250 rows today, one per procedure, each naming `public`, `authenticated`, or an explicit role list. **The guard fails closed**: an undeclared route is refused.
3. Implement it in the module, always in the order `requireRole → requireDb → withTenant → idempotent` for mutations.
4. Service READMEs and the OpenAPI documents regenerate from the contract; they are never edited by hand.

Two properties are worth calling out to reviewers:

- **The matrix is tested exhaustively.** Every service spec runs every endpoint against every role and asserts the expected allow or 403. A service also refuses a role it does not serve before any business logic runs.
- **The published examples work.** Every OpenAPI operation carries an example built from real seeded rows, and `pnpm smoke` signs in as each service's role and calls every operation of every service with the example it publishes. That is the endpoint-call number quoted in section 13.

Wire-shape rules: every mutating procedure extends a mutation base carrying `idempotencyKey` plus the client UUIDv7 `id`; every list is cursor-paginated with a hard limit.

# 8. Authentication and sessions

**Decided 2026-09-04:** we run our own auth service; OTP over SMS or WhatsApp is a later enhancement layered on top of username and password, not a replacement.

| Element           | Implementation                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| Credential        | Username + password; argon2id at OWASP's 2024 interactive minimum (19 MiB, 2 passes, 1 lane)     |
| Lockout           | 5 failed attempts, 15-minute lock; every attempt written to an auth event log                    |
| Access token      | EdDSA (Ed25519) JWT, 15 minutes, claims: user, tenant, role, session, device                     |
| Refresh token     | Per device, rotating, 30 days; reuse of a retired token revokes the whole session                |
| Verification      | Services verify with the public key from JWKS — no call back to the auth service on the hot path |
| Multi-distributor | `switch-tenant` issues a token for another membership; one shopkeeper login, many distributors   |
| Recovery          | Forgot / reset password via a signed token bound to the current password hash (no reset table)   |

Authorization is layered: token verification, then the permission matrix, then row-level security in Postgres, then any narrowing inside the handler. The database layer is the guarantee; the matrix exists to give a clear 403 early and to be reviewable in one file.

# 9. Files, documents and printing

- Object storage sits behind two drivers. The **local driver is the default** — it writes under `backend/.storage` and signs its own URLs with HMAC, so the whole product runs on a laptop with no cloud account. The **S3 driver** implements SigV4 signing directly with `node:crypto` (about 70 lines) rather than pulling in the AWS SDK, and is tested against AWS's published signing vectors with no network call.
- Keys are tenant-scoped and a key that tries to escape its tenant prefix is refused. Uploads are pre-signed PUTs on both drivers, so the local flow is the S3 flow; reads follow the owning row's RLS, so another shop's invoice PDF is a 403, not a leak.
- PDFs (invoice in A4, A5 and thermal widths, credit note, delivery challan, receipt) are rendered by a dependency-free renderer in the worker and white-labelled from tenant settings.

# 10. Background work

One worker process, pg-boss inside the same PostgreSQL database — no separate broker.

| Job             | Schedule     | Purpose                                                                          |
| --------------- | ------------ | -------------------------------------------------------------------------------- |
| Outbox relay    | Every minute | Publishes `outbox_events` written in the same transaction as the business change |
| Retention sweep | Hourly       | DPDP-driven retention (GPS points, idempotency keys, expired artefacts)          |
| Document render | Every minute | Invoice, credit note, challan and receipt PDFs                                   |

Later modules add document intelligence, imports and exports, rollups and notification sends to the same worker.

# 11. Offline sync protocol

**Decided 2026-09-04:** online-first now; offline for the sales and delivery apps before the pilot.

- `POST /sync/upload` takes a batch of at most 500 operations from one device. **It never answers 4xx.** A business rejection is a 2xx with a rejection entry plus a durable `sync_errors` row that comes back to the device's "needs attention" tray; only a transient fault is a 5xx, so the device retries with backoff and the queue can never wedge (`docs/07`, ADR 0007).
- Outcomes are durable in `sync_ops`, keyed by tenant, device and operation id, so a replay after days offline returns the stored outcome instead of double-posting; the ledgers' own idempotency uniqueness is the second line of defence. Modules register their own per-table handlers, so the protocol knows no business rules — the module does.
- `sync.pull` is the bounded delta download and `sync.errors.list` re-reads the tray; the staff services mount sync, the retailer service does not (that app is online-only).
- **GPS breadcrumbs bypass the queue.** The delivery app buffers points and posts batches to `/gps/points`; a device offline for hours must never replay hundreds of location rows ahead of a cash receipt.
- Device-side streaming (PowerSync, self-hosted Open Edition) is the plan of record for the read set, scoped per role and per beat so a device syncs kilobytes rather than a tenant.

# 12. Scale rules (docs/20)

**Decided 2026-09-04:** build for lakhs of users from day one. These are build rules, not a later phase — a module is not "stable" until it follows them. The load model designed and tested against: 10,000 distributors, 100,000 staff devices, 2,000,000 retailers; peak 5,000 orders per minute, 20,000 concurrent sync uploads, 50,000 GPS points per minute, 1,000 invoice scans per minute.

| Rule                          | What it means in the code                                                                                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stateless services            | Nothing in process memory another instance would miss; per-request state in `AsyncLocalStorage`                                                                |
| Bounded work per request      | Every list cursor-paginated with a hard cap; batches capped; long work goes to the worker and returns a job id                                                 |
| Idempotent by construction    | Client idempotency key + client UUIDv7 on every mutation                                                                                                       |
| Per-tenant fairness           | Rate limits and queue priority keyed by tenant, so one distributor's bulk import cannot starve another's orders                                                |
| Indexes lead with `tenant_id` | Makes sharding a data move, not a redesign                                                                                                                     |
| Ledgers partition-ready       | Monthly partitioning past roughly 50M rows; rollup tables are the read surface so phones never scan ledgers                                                    |
| Reads scale on replicas       | Two pools from the start (`DATABASE_URL`, `DATABASE_REPLICA_URL`); a missing replica falls back to the primary                                                 |
| Connection discipline         | Small pools behind a transaction-mode pooler; all session state is `SET LOCAL`. The hard constraint found in build: **replicas × pool size ≤ max_connections** |
| Hot rows avoided              | Numbering holds a row lock for milliseconds; counters are recomputed by the worker, not on the request path                                                    |
| Observability first           | Structured logs with tenant, actor, request id and service; per-procedure metrics. No metric, no launch                                                        |

# 13. Build status and how it is verified

As at 2026-09-05 13:45 IST: **14 backend modules verified, 1,442 automated tests, 1,004 endpoint calls exercised, 0 broken** (Build Status & Roadmap mirrors `docs/18-build-log.md`).

Each module is verified by an independent gate before it is called done — not by the agent that wrote it: full build, typecheck, lint and test across the workspace run twice; `pnpm smoke` over every operation of every service plus a destructive pass; a re-seed and a second smoke to prove seeds are idempotent (identical row counts across all 126 tables); generated-README and formatting checks clean; and migrations a no-op on a second run.

**Still to build:** document intelligence, integrations, claims, notifications, reporting and incentives; then the AI module and the platform-admin service (both added to v1 on **2026-09-05**); then the three-distributor demo dataset; then the six apps, one at a time. No app screen exists yet — backend first is a founder decision of 2026-09-04.

**Where AI sits in this architecture. Decided 2026-09-05:** all AI features are in v1 — LLM vision extraction of supplier bills (the document-intelligence module), WhatsApp free-text and voice order capture parsed into a draft, demand forecasting and reorder suggestions, and route sequencing. Architecturally they are ordinary modules calling an external model from the worker, never a separate system, and **none of them commits on its own**: a human confirms the draft order, the reviewed GRN, the purchase suggestion and the route.

# 14. What changed since the August 2026 architecture

| Area            | August 2026 Confluence                          | Now                                                                                                                                           |
| --------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Mobile          | Flutter                                         | Expo / React Native, so the pricing engine is one implementation shared with the server (**Decided 2026-09-04**)                              |
| Web             | Next.js                                         | Vite + React for the owner app                                                                                                                |
| Cache and queue | Redis + BullMQ                                  | pg-boss inside PostgreSQL; no Redis (**Decided 2026-09-04**)                                                                                  |
| Auth            | Generic "JWT + refresh tokens"                  | Our own auth service: argon2id, EdDSA, JWKS, rotating per-device refresh (**Decided 2026-09-04**)                                             |
| Applications    | An admin portal plus role mobile apps           | Six role apps plus a platform-admin app, each web + Android + iOS, each on its own service (**Decided 2026-09-04**, admin app **2026-09-05**) |
| Permissions     | "Role-based, customizable by each organization" | One fixed matrix of seven roles, tested endpoint × role; tenants configure settings, not roles                                                |
| Branches        | Multi-branch as an enterprise tier              | One tenant = one distributorship for v1; multi-branch is v2, each branch its own tenant plus an owner group view (**Decided 2026-09-05**)     |
| Source of truth | "This Confluence space"                         | `docs/22-source-of-truth.md` in the repository; Confluence mirrors it (**Decided 2026-09-05**)                                                |

# 15. Known limits, stated honestly

- **Not deployed.** Everything above runs on a local PostgreSQL with demo data. Hosting, CI image builds, backups and the restore drill are designed (`docs/11`) but not exercised; the Dockerfile has never been built on the founder's machine.
- **No app screens yet.** The backend is complete-first by decision; the owner web app exists only as a sign-in and one list used to prove the auth path end to end.
- **Offline is protocol, not yet product.** The write path, durable outcomes and error tray are built and tested; device-side streaming and the local database for the sales and delivery apps land before the pilot.
- **No APM.** Structured logging and health endpoints exist; request tracing, uptime and crash reporting are deployment-time work and are not measurable today.
- **Reporting, notifications and integrations are queued**, so dashboards, chart series, WhatsApp sends, Tally export and the generic importer have contracts and plans but no implementation yet.

---

# References

| Topic                                               | Document in the repository                                   |
| --------------------------------------------------- | ------------------------------------------------------------ |
| Single source of truth, dated decisions, never-list | `docs/22-source-of-truth.md`                                 |
| Working rules, commands, repository layout          | `CLAUDE.md`, `docs/19-layout-restructure.md`                 |
| Data model and the eight irreversible ADRs          | `docs/04-system-architecture-and-data-model.md`, `docs/adr/` |
| Scale rules, load model, offline sync design        | `docs/20-scale-rules.md`, `docs/07-offline-sync.md`          |
| Infrastructure, environments, cost                  | `docs/11-infra-and-cost.md`                                  |
| Build status, local links, demo sign-ins            | `docs/18-build-log.md`                                       |
| Confluence alignment audit                          | `docs/24-confluence-alignment.md`                            |
