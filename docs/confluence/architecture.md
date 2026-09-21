# Architecture & Technology

## Document Information

| Property     | Value                     |
| ------------ | ------------------------- |
| Document     | Architecture & Technology |
| Product      | Distribution OS           |
| Version      | 3.1                       |
| Status       | Active                    |
| Owner        | Product Management        |
| Last Updated | 21 September 2026         |

---

# Purpose

This page describes the architecture Distribution OS is actually built on, as of 21 September 2026 — not a target design. Every statement here is traceable to the repository: `docs/22-source-of-truth.md` (the single source of truth and its dated decisions register), `CLAUDE.md`, `docs/04-system-architecture-and-data-model.md`, `docs/20-scale-rules.md`, `docs/26-environments-and-configuration.md`, `docs/29-sign-in-roles-and-one-store-app.md`, `docs/18-build-log.md` and `QA/STATE.md` (status numbers).

**Decided 2026-09-05:** the repository is the single source of truth; Confluence mirrors it. Where this page and an older Confluence page disagree, this page and `docs/22` win.

**Decided 2026-09-04:** the technology stack is TypeScript end to end. The August 2026 "Technology Stack (Planned)" table on Home 0.1 named Flutter, Next.js, Redis and BullMQ; none of those is used. The stack below replaces it.

# 1. Architecture in nine lines

1. One git repository, **two independent pnpm workspaces**: `backend/` and `frontend/`.
2. **One NestJS service per app** — eight of them — each assembled from one shared core library; not a monolith, not microservices with their own databases. For a small deployment all eight plus the worker run in **one process** (all-in-one mode) and split later with no code change.
3. **One PostgreSQL 17 database.** Every tenant table carries `tenant_id` with row-level security **enabled and forced**.
4. **Append-only ledgers** for stock and for money; balances are derived, never edited.
5. **Contract-first API** (oRPC + Zod) with a **permission matrix** deciding every endpoint × every role before any business logic runs.
6. **Our own authentication service**: username + password, EdDSA access tokens, rotating per-device refresh tokens; from 2026-09-21 the token also carries an **elected role**, granted downward only.
7. **Object storage** for every binary, and **one pg-boss worker** for outbox relay, retention and document rendering.
8. An **offline write protocol that never answers 4xx**, **our own delta-sync client** on the device, and scale rules (`docs/20`) that apply from day one.
9. **One Expo codebase for the apps**: six role groups behind one sign-in — one website, one Android app, one iOS app — shipped as one container image on one VM, with the web app on a CDN.

# 2. Technology stack (actual)

| Layer             | Technology                                                | Note                                                                                |
| ----------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Language          | TypeScript 6.0.x, Node 24                                 | Exactly one TypeScript version per workspace                                        |
| Backend framework | NestJS 12 on Fastify                                      | One service per app, one shared core library                                        |
| API               | oRPC, contract-first                                      | Contracts declared in Zod 4 before implementation                                   |
| Database          | PostgreSQL 17                                             | One database, shared schema, forced RLS                                             |
| ORM / migrations  | Drizzle ORM + drizzle-kit                                 | Generated migrations plus hand-written guarantee migrations                         |
| Queue / jobs      | pg-boss (inside Postgres)                                 | **Decided 2026-09-04:** no Redis, no BullMQ                                         |
| Object storage    | S3-compatible, or a local driver                          | Local driver is the default and needs no cloud account                              |
| Auth              | Own service: argon2id + EdDSA JWT + JWKS                  | **Decided 2026-09-04:** no third-party auth provider                                |
| Apps              | Expo (React Native) + expo-router, web + Android + iOS    | One codebase per app renders all three; all seven are built (**2026-09-07**)        |
| Offline           | Our own delta-sync client on SQLite (`docs/27`)           | **Decided 2026-09-05:** no PowerSync, no TanStack Query                             |
| Compute (pilot)   | One arm64 Docker image, all-in-one mode, on Oracle Cloud  | **Decided 2026-09-21** — see §4.3; Caddy with automatic Let's Encrypt in front       |
| Web hosting       | Cloudflare Pages; backups to Cloudflare R2                | **Decided 2026-09-21**; domain `distributionos.in`                                  |
| Tooling           | pnpm 11 workspaces + Turborepo                            | Dependency versions pinned in a workspace `catalog:`                                |
| API docs          | Swagger UI + Scalar, generated from the contract          | Examples built from real seeded rows                                                |

# 3. Repository shape

Two workspaces install and build separately; the repository root holds only `backend/`, `frontend/`, `docs/`, `QA/`, `CLAUDE.md` and dotfiles (**Decided 2026-09-04**).

**`backend/`**

| Package                                             | Responsibility                                                                                                                                                                  |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/domain`                                       | Pure TypeScript, **zero runtime dependencies**: money in paise, quantities in pieces, GST split, GSTIN checksum, UUIDv7, IST business dates, state machines, the pricing engine |
| `libs/contracts`                                    | Zod schemas, the oRPC contract (one file per module), and `permissions.ts` — the only place wire shapes and role rules live                                                     |
| `libs/database`                                     | The only place SQL schema lives: Drizzle schema, RLS policies as code, migrations, seed data, `withTenant()`                                                                   |
| `libs/core`                                         | Platform services (tenant context, authorization, idempotency, numbering, object storage, PDF documents) and one folder per business module                                     |
| `libs/config`                                       | Shared TypeScript / ESLint / Vitest presets                                                                                                                                     |
| `auth-service` + seven role services                | ~20 lines each: which roles it serves, which modules it mounts, its default port                                                                                                |
| `all-in-one`                                        | The same eight services mounted behind path prefixes in one process, for a small deployment (§4.3)                                                                              |
| `worker`, `tools`, `infra`                          | pg-boss consumers; README and key generation, smoke harness; Dockerfile, compose, Caddyfile and backup scripts                                                                   |

**`frontend/`** holds `libs/{ui,api-client,offline,config}` and the app packages. The apps link `@dos/contracts` and `@dos/domain` as symlinks into the backend, so the wire types and the pricing engine are one implementation shared by server and device — not a copy.

**Module boundaries are enforced, not conventional.** A backend module reaches another module only through its exported application service or an outbox event, never its tables (`eslint-plugin-boundaries`). Cross-module foreign keys point downstream only: tenancy → identity → catalog → tenant-catalog → retailers → pricing → inventory → orders → procurement → warehouse → billing → receivables → delivery → docint → claims → notifications → reporting → integrations → incentives.

# 4. Services, ports and URLs

**Decided 2026-09-04:** every role gets its own service, so a role can only reach the endpoints its service mounts. The permission matrix then decides per endpoint inside that. **Decided 2026-09-05:** an eighth service, Admin, is in v1. All eight are built.

| Service   | Port | Roles served            | Local base URL        | Status |
| --------- | ---- | ----------------------- | --------------------- | ------ |
| auth      | 3000 | everyone (sign-in only) | http://localhost:3000 | Built  |
| owner     | 3001 | owner                   | http://localhost:3001 | Built  |
| manager   | 3002 | manager, accountant     | http://localhost:3002 | Built  |
| sales     | 3003 | salesperson             | http://localhost:3003 | Built  |
| warehouse | 3004 | warehouse               | http://localhost:3004 | Built  |
| delivery  | 3005 | delivery                | http://localhost:3005 | Built  |
| retailer  | 3006 | retailer                | http://localhost:3006 | Built  |
| admin     | 3007 | platform_admin          | http://localhost:3007 | Built  |
| worker    | —    | system                  | —                     | Built  |

Every service exposes the same four routes: `/health` (liveness, unauthenticated and outside the tenant guard), `/swagger` (Swagger UI with a working example on every operation), `/docs` (Scalar reference) and `/docs/openapi.json` (the OpenAPI document for that service's contract subset only).

Services are **stateless**: any number of instances of any service may run behind a load balancer with no code change. The database is the only shared state.

## 4.1 One app, six role groups (decided 2026-09-21)

Seven separate role apps were built and gated green on 2026-09-07 — one Expo codebase each, serving website + Android + iOS. They are now being merged into **one Expo project, `frontend/dos-app`**, published as a single store listing and a single website:

- The six business apps' screens move under **role groups** — `(owner)`, `(manager)`, `(sales)`, `(warehouse)`, `(delivery)`, `(retailer)`. One root layout reads the token's elected role and mounts that group's navigation, strings and touch floor. Screens move, they do not change: every screen already imports only `@dos/ui`, which is what makes the move mechanical.
- The API client gains **`serviceFor(role)`** — one base URL per service — so the sales group talks only to sales-service, exactly as today. **The one app is a packaging decision, never a security boundary**: the boundary stays the eight services, the permission matrix and row-level security.
- **The seven per-role web apps are retired at the merge** (founder, 2026-09-21: "yes I agree go ahead"). Two front doors would be two things to prove, for ever, and nothing is lost because every screen lives in the one app.
- **The platform-admin console stays a separate app.** Platform staff are not a distributor's users.
- Why one listing: the stores charge per developer account, not per app (Google $25 once, Apple $99/yr). The saving is seven builds, seven review queues and seven update cycles — and a distributor's new hire being told *which* of six apps to install. Design: `docs/29` §3.

## 4.2 Role election at sign-in, downward only (decided 2026-09-21)

A membership is one (person, distributor, role), but real distributorships do not work that way: the owner drives some mornings, the warehouse man delivers on Tuesdays. So **the device asks for the role it needs, and the auth service grants it only downward**:

| Membership role                                     | May act as                                                      |
| --------------------------------------------------- | ----------------------------------------------------------------- |
| owner                                               | manager, accountant, warehouse, delivery, salesperson           |
| manager                                             | warehouse, delivery, salesperson                                |
| accountant, warehouse, delivery, salesperson        | own role, plus each role the owner or manager adds to it         |
| retailer, platform_admin                            | never anything else                                             |

- The access token's `role` claim is the **elected** role; the subject stays the person, so every audit row, every receipt and every delivery still records *who* did it — the token merely says *as what*. A refused election is a clear 403 at sign-in ("Your login at Tarsun is a salesperson; ask the owner to add delivery to it"), never a silent downgrade.
- **An owner token is never let into a field app.** A van phone is a shared, droppable device; an owner token on it would reach owner-service — every margin, every setting — for the life of its refresh token. That is exactly what eight services exist to prevent.
- Nothing on the server changes: services keep their role lists, the permission matrix keeps its rows, and RLS reads the elected role as it always has. Design: `docs/29` §2.

## 4.3 Deployment shape (decided 2026-09-21)

The pilot runs at ₹0 of recurring infrastructure cost, on terms that were verified rather than assumed:

| Piece            | Decision                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Compute          | **One arm64 Docker image in all-in-one mode** — all eight services plus the worker in one process, **377 MB of memory measured** — on **Oracle Cloud Always Free, Mumbai** |
| TLS and routing  | **Caddy** in front, with automatic Let's Encrypt certificates; `api.distributionos.in`                                                                                    |
| Database         | **PostgreSQL 17 self-hosted on the same VM**, with a named volume                                                                                                         |
| Web app          | **Cloudflare Pages** (unlimited bandwidth, no card); `www.distributionos.in`, with the bare `distributionos.in` redirecting to it                                         |
| Backups          | **Nightly `pg_dump` plus an object-storage archive to Cloudflare R2**, rotated, with a restore that is actually tested                                                     |
| Builds           | On the founder's Mac or in CI, **never on the VM** (a free box has too little memory to build); the VM only ever pulls the image                                          |
| Domain           | `distributionos.in`, about ₹690/year — bought on **Hostinger, 21 September 2026**; nameservers moving to **Cloudflare**                                                    |

**Why the database is not managed.** The schema creates a `BYPASSRLS` database role for the worker, which requires superuser rights. No free managed tier grants them — Neon, Supabase and RDS all withhold it — so a managed free Postgres cannot host this schema at all. Self-hosting on the same VM is the only shape that works today; managed Postgres returns at roughly ten paying tenants, as `docs/26` already planned.

**This replaces the earlier AWS shape** (Lightsail Mumbai for compute, S3 + CloudFront for the web app) recorded on 2026-09-05: Oracle's always-free ARM box plus Cloudflare Pages costs nothing per month where the AWS shape costs real money once the new-account credits run out, and the free-tier database question above had not yet been checked. The larger AWS design in `docs/11` (Fargate, ALB, RDS) is still the growth path and returns with revenue.

**Being built now (2026-09-21).** There was no working path from the repository to a server: the Dockerfile had never been built. A dedicated lane is authoring and proving it on the Mac today — a Dockerfile that builds, `compose.prod.yml`, the Caddyfile, a migrate step that also creates the pilot distributor, backups, secret generation, the Pages pipeline, and `docs/30-deploy-runbook.md` (the exact ordered steps from a fresh VM to a live API and a live site, with the rollback). Production is bootstrapped with the tenant-bootstrap routine, **never** the demo seed.

# 5. Data layer: one database, hard tenant isolation

- **Shared schema, `tenant_id` on every tenant table**, with `ENABLE` **and** `FORCE ROW LEVEL SECURITY` — forced, so even the owning connection obeys policy.
- All tenant data access goes through `withTenant()`: a transaction that runs `SET LOCAL ROLE app_rw` and sets `app.tenant_id`, `app.actor_id`, `app.actor_role`. Policies read those settings. Nothing reaches a tenant row outside that transaction.
- **Purchase cost, landed cost and margin** live in `tenant_product_costs` under a back-office-only policy. A salesperson, warehouse, delivery or retailer role cannot read them — a database guarantee with tests, not an application rule.
- A retailer sees only rows linked to their own shop; a tenant never sees another tenant's rows. Cross-tenant worker jobs use a separate `app_worker` role.
- **Global vs tenant data:** manufacturers, products and variants are global and curated (a distributor may propose one and use it immediately); retailers, prices, orders and ledgers are per tenant. A user is global and holds one membership per tenant, which is what lets one shopkeeper log in once and see several distributors.
- Schema size today: **139 tables across 25 module schema files, 57 numbered migrations**. Migrations are **expand-only** from 0004 onward. Roles, grants, forced-RLS assertions, triggers and views live in hand-written migrations beside the generated ones.
- `backend/libs/database/src/rls.test.ts` is the executable form of these rules: cost invisible to a salesperson, tenant isolation, retailer scope, append-only ledgers, journals balancing.

# 6. Append-only ledgers

Two ledgers carry everything that matters, and neither can be edited:

| Ledger                              | Guarantee                                                                                                                                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stock_ledger`                      | Append-only by trigger; one row per physical movement (GRN, reservation, pick, pack, load, return, adjustment, cycle count); `stock_balances` derived in the same transaction; `UNIQUE(tenant_id, idempotency_key)` |
| `journal_lines` / `journal_entries` | Append-only by trigger; double entry that **must balance at commit**, enforced by a `SECURITY DEFINER` database trigger so the check cannot be blinded by the caller's own row-level policy                         |

Consequences that shape the whole product:

1. An issued invoice is never edited. Corrections are credit or debit notes; an invoice cancelled before dispatch keeps its number — and, since **2026-09-20**, cancelling that bill cancels its order in the same step, so nothing is left in the billing queue.
2. Outstanding and ageing are derived from open invoices minus allocations. "Overdue" is computed, never stored, and every distributor's ageing is rebuilt nightly so each morning's buckets are dated today.
3. Every mutation carries a client-generated UUIDv7 id and an idempotency key, so a retry or a duplicate offline upload is a no-op.
4. State columns change only through the state machines in `libs/domain` (order, trip and stop, invoice) — never by hand.
5. **Money moves exactly once** (**2026-09-14**): banking a receipt, undoing it and settling its trip all lock it, so only one of them can win; and money already recorded wrongly is corrected by an appended balancing entry, never by an edit.

# 7. API: contract-first, with a permission matrix

The contract is written first, in `backend/libs/contracts`, and everything else is derived from it:

1. Declare the procedure and its Zod input/output in the module's contract file.
2. Add its row to `PERMISSIONS` — **391 rows today**, one per procedure, each naming `public`, `authenticated`, or an explicit role list. **The guard fails closed**: an undeclared route is refused.
3. Implement it in the module, always in the order `requireRole → requireDb → withTenant → idempotent` for mutations.
4. Service READMEs and the OpenAPI documents regenerate from the contract; they are never edited by hand.

Three properties are worth calling out to reviewers:

- **The matrix is tested exhaustively.** Every service spec runs every endpoint against every role and asserts the expected allow or 403. A service also refuses a role it does not serve before any business logic runs.
- **The offline door obeys the same matrix** (**decided 2026-09-13**). A role that may not make a change through the normal endpoint cannot make it through `/sync/upload` either: the upload records a refusal, never a silent write. A salesperson can never record a receipt by any route, and the database says so as well as the matrix.
- **The published examples work.** Every OpenAPI operation carries an example built from real seeded rows, and the smoke harness signs in as each service's role and calls every operation with the example it publishes.

Wire-shape rules: every mutating procedure extends a mutation base carrying `idempotencyKey` plus the client UUIDv7 `id`; every list is cursor-paginated with a hard limit and, since **2026-09-21**, ordered newest first on the same column its own date window filters — server time for a queue of work, the document's own date for a dated register, the row id only ever breaking a tie.

# 8. Authentication and sessions

**Decided 2026-09-04:** we run our own auth service; OTP over SMS or WhatsApp is a later enhancement layered on top of username and password, not a replacement.

| Element           | Implementation                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| Credential        | Username + password; argon2id at OWASP's 2024 interactive minimum (19 MiB, 2 passes, 1 lane)      |
| Lockout           | 5 failed attempts, 15-minute lock; every attempt written to an auth event log                     |
| Access token      | EdDSA (Ed25519) JWT, 15 minutes, claims: user, tenant, **elected role**, session, device          |
| Role election     | The device asks for a role; granted downward only (§4.2), recorded in the auth event log          |
| Refresh token     | Per device, rotating, 30 days; reuse of a retired token revokes the whole session                 |
| Verification      | Services verify with the public key from JWKS — no call back to the auth service on the hot path  |
| Multi-distributor | `switch-tenant` issues a token for another membership; one shopkeeper login, many distributors    |
| Recovery          | Forgot / reset password via a signed token bound to the current password hash (no reset table)    |
| Sign-out          | Leaves nothing of the previous person or distributor on the device (§11) — a non-negotiable       |

Authorization is layered: token verification, then the permission matrix, then row-level security in Postgres, then any narrowing inside the handler. The database layer is the guarantee; the matrix exists to give a clear 403 early and to be reviewable in one file.

Every app opens on a **Welcome** screen (the Distribution OS mark, this app's name, one Sign in button — shown once per device, not on every launch) and, after sign-in, a brief **landing**: the distributor's logo and name, the person's name, and which app this is. White labelling inside the app is unchanged — Distribution OS shows itself before sign-in and nowhere after it (**founder, 2026-09-21**; `docs/29` §1).

# 9. Files, documents and printing

- Object storage sits behind two drivers. The **local driver is the default** — it writes to disk and signs its own URLs with HMAC, so the whole product runs on a laptop, and on the pilot VM, with no cloud account. The **S3 driver** implements SigV4 signing directly with `node:crypto` (about 70 lines) rather than pulling in the AWS SDK, and is tested against AWS's published signing vectors with no network call. The same driver is what writes backups to Cloudflare R2.
- Keys are tenant-scoped and a key that tries to escape its tenant prefix is refused. Uploads are pre-signed PUTs on both drivers, so the local flow is the S3 flow; reads follow the owning row's RLS, so another shop's invoice PDF is a 403, not a leak.
- PDFs (invoice in A4, A5 and thermal widths, credit note, delivery challan, receipt) are rendered by a dependency-free renderer in the worker and white-labelled from tenant settings.
- **No permanent public link to a shop's papers** (**decided 2026-09-20**). Invoices, receipts and statements go out as files shared from the phone; a forever-URL carrying a shop's prices and balance is refused, and any link ever added must be signed and expire in seven days.

# 10. Background work

One worker process, pg-boss inside the same PostgreSQL database — no separate broker.

| Job             | Schedule     | Purpose                                                                          |
| --------------- | ------------ | -------------------------------------------------------------------------------- |
| Outbox relay    | Every minute | Publishes `outbox_events` written in the same transaction as the business change |
| Retention sweep | Hourly       | DPDP-driven retention (GPS points, idempotency keys, expired artefacts)          |
| Document render | Every minute | Invoice, credit note, challan and receipt PDFs                                   |
| Nightly finalise | 00:20 IST   | Day-end rollups and one ageing rebuild per distributor, so each morning's buckets are dated today |

Document intelligence (supplier-bill extraction), imports and exports, rollups and notification sends run on the same worker. In the pilot deployment the worker runs **inside the same process** as the eight services (§4.3).

# 11. Offline sync protocol

**Decided 2026-09-04:** online-first, with offline for the field apps before the pilot. **Decided 2026-09-05:** the device half is **our own delta-sync client** (`docs/27`), not PowerSync. Both halves are built.

- `POST /sync/upload` takes a batch of operations from one device. **It never answers 4xx.** A business rejection is a 2xx with a rejection entry plus a durable error row that comes back to the device's "needs attention" tray; only a transient fault is a 5xx, so the device retries with backoff and the queue can never wedge.
- Outcomes are durable and keyed by tenant, device and operation id, so a replay after days offline returns the stored outcome instead of double-posting; the ledgers' own idempotency uniqueness is the second line of defence. Modules register their own per-table handlers, so the protocol knows no business rules — the module does.
- The device half is SQLite tables built from the server's own manifest, a cursor pull that applies deletions before rows, and an outbox that replays in order under the original operation id.
- **A device's offline copy belongs to one person in one distributorship** (**decided 2026-09-13**, closed and measured **2026-09-20**). Each person and distributor gets their own store, checked before anything is shown and closed at sign-out; unsent changes stay with that person on that device, go first at their next sign-in there, and are never visible to anyone else. Nothing is thrown away at sign-out, and money already entered is never offered for deletion.
- **The app never claims work is safe when it is not** (**decided 2026-09-19**). A browser or phone that cannot keep an offline copy says so on every screen, and an order saved with no signal keeps saying so until the office actually confirms it.
- **GPS breadcrumbs bypass the queue.** The delivery app buffers points and posts batches separately; a device offline for hours must never replay hundreds of location rows ahead of a cash receipt.

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
| Observability first           | Structured logs with tenant, actor, request id and service; per-procedure metrics. Dashboards and tracing are go-live work                                     |

# 13. Build status and how it is verified

**Backend and frontend are both complete** (Build Status & Roadmap mirrors `docs/18-build-log.md`):

- **Backend, complete 2026-09-06:** 23 modules, eight services and the worker, 139 tables, 57 migrations, roughly 2,400 automated tests, and a smoke harness that walks every published example of every service (1,618 calls at the last full run).
- **Frontend, complete 2026-09-07:** all seven role apps built and gated green — owner, manager (with the accountant on it), sales, warehouse, delivery, retailer and the platform-admin console — each one Expo codebase serving website + Android + iOS.
- Each piece was verified by an **independent gate**, never by the agent that wrote it: full build, typecheck, lint and test across the workspace; every screen walked in a real browser at desk and phone widths, measured rather than eyeballed; the app driven on a real Android device; and a re-seed plus a second smoke run to prove seeds are idempotent.

**Since 2026-09-12 the work has been quality assurance, not construction.** A structured QA programme found and worked 158 findings in its second batch; **153 are merged** as at 2026-09-20, and the remainder are in flight. What it fixed is not cosmetic — receipts that could be banked twice, day-end that missed cash taken at a door with no signal, a shared phone that showed the next person the previous rep's shops, and a van that could leave with a bill nobody had counted out. Every one of those is now a rule in this architecture (§6, §7, §11) and several became non-negotiables in `docs/22` §9.

**The plan to go live is seven days** (`QA/10-DAY-PLAN.md`, revised 2026-09-21): day 1 the cross-role chain across all seven apps, plus Welcome/landing and the start of role election and the deployment plumbing; day 2 role election lands and the one app starts; day 3 the one app is finished and gated; days 4–5 a **seven-day business simulation** on the merged app, judged by a blind auditor and settled by arithmetic (opening stock + receipts − sales − damage − returns = closing stock, and revenue = payments + outstanding; any drift is a stop-the-line defect); day 6 fixing what it found; day 7 Android basics, the security work public URLs require, **go live** on `www.distributionos.in` and `api.distributionos.in`, and the architect's audit with the handover. **Live by Saturday 27 September if Thursday evening's books balance** — four days of scheduled work and one day of the unknown, and the founder hears that night if the books do not.

**Where AI sits in this architecture. Decided 2026-09-05:** all AI features are in v1 — LLM vision extraction of supplier bills, WhatsApp free-text and voice order capture parsed into a draft, demand forecasting and reorder suggestions, and route sequencing. Architecturally they are ordinary modules calling an external model from the worker, never a separate system, and **none of them commits on its own**: a human confirms the draft order, the reviewed GRN, the purchase suggestion and the route.

# 14. What changed since the August 2026 architecture

| Area            | August 2026 Confluence                          | Now                                                                                                                                             |
| --------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mobile          | Flutter                                         | Expo / React Native, so the pricing engine is one implementation shared with the server (**Decided 2026-09-04**)                                 |
| Web             | Next.js                                         | The same Expo codebase renders the website; there is no separate web stack                                                                      |
| Cache and queue | Redis + BullMQ                                  | pg-boss inside PostgreSQL; no Redis (**Decided 2026-09-04**)                                                                                    |
| Auth            | Generic "JWT + refresh tokens"                  | Our own auth service: argon2id, EdDSA, JWKS, rotating per-device refresh, and an elected role (**2026-09-04**, election **2026-09-21**)          |
| Applications    | An admin portal plus role mobile apps           | **One app** — one website, one Android app, one iOS app, six role groups behind one sign-in — plus the separate platform console (**2026-09-21**) |
| Offline         | —                                               | Our own delta-sync client on SQLite; PowerSync was considered and dropped (**Decided 2026-09-05**)                                              |
| Hosting         | AWS-shaped (Lightsail, then S3 + CloudFront)    | Oracle Cloud Always Free Mumbai + Cloudflare Pages + R2, self-hosted Postgres 17 — ₹0 a month, and the only shape this schema can run on (**2026-09-21**) |
| Permissions     | "Role-based, customizable by each organization" | One fixed matrix of seven roles, tested endpoint × role; tenants configure settings, not roles                                                   |
| Branches        | Multi-branch as an enterprise tier              | One tenant = one distributorship for v1; multi-branch is v2, each branch its own tenant plus an owner group view (**Decided 2026-09-05**)        |
| Source of truth | "This Confluence space"                         | `docs/22-source-of-truth.md` in the repository; Confluence mirrors it (**Decided 2026-09-05**)                                                   |

# 15. Known limits, stated honestly

- **Not deployed yet — but the path is being built today.** Until 21 September there was no working route from the repository to a server: the Dockerfile had never been built, and there was no compose file, no TLS, no migrate step, no backups and no secrets. That plumbing is a lane of its own this week, proven on the founder's Mac before the VM exists, and written up as a runbook (§4.3).
- **The one app is not merged yet.** Seven role apps are built and gated; the merge into one project, and the retirement of the seven per-role web apps, happens on days 2–3 and is then re-walked before the simulation.
- **iOS is the one unproven target.** Every app boots and renders on iOS, but device automation on this Mac is limited, so Android has carried the device walks. **Decided 2026-09-21:** both platforms get one complete validation pass at the end, as a scheduled block; Android is the pilot platform.
- **The local database holds no real trade.** A read-only audit on 2026-09-19 confirmed every row in it came from the demo seed. Nothing in the product has yet processed a real customer's money, which is exactly what the seven-day simulation and the pilot exist to change.
- **Deliberately deferred for the pilot**, each with the event that brings it back: performance and search tuning (before about ten paying tenants), accessibility and a hardened public surface (before a public product), observability and DevOps tooling (at go-live), localization and the TradeEzee import (at cut-over), and a larger automated test suite (before customer number two).

---

# References

| Topic                                               | Document in the repository                                                       |
| --------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Single source of truth, dated decisions, never-list | `docs/22-source-of-truth.md`                                                     |
| Working rules, commands, repository layout          | `CLAUDE.md`, `docs/19-layout-restructure.md`                                     |
| Data model and the eight irreversible ADRs          | `docs/04-system-architecture-and-data-model.md`, `docs/adr/`                     |
| Scale rules, load model, offline sync design        | `docs/20-scale-rules.md`, `docs/07-offline-sync.md`, `docs/27-offline-sync-client.md` |
| Sign-in, role election, the one app                 | `docs/29-sign-in-roles-and-one-store-app.md`                                     |
| Environments, deployment shape and cost             | `docs/26-environments-and-configuration.md`, `docs/11-infra-and-cost.md`, `docs/30-deploy-runbook.md` |
| Build status, local links, demo sign-ins            | `docs/18-build-log.md`, `docs/28-running-it-locally.md`                          |
| QA programme, findings and the plan to go live      | `QA/STATE.md`, `QA/10-DAY-PLAN.md`                                               |
| Confluence alignment audit                          | `docs/24-confluence-alignment.md`                                                |
