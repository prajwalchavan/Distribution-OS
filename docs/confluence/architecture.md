# Architecture & Technology

## Document Information

| Property     | Value                     |
| ------------ | ------------------------- |
| Document     | Architecture & Technology |
| Product      | Distribution OS           |
| Version      | 3.3                       |
| Status       | Active                    |
| Owner        | Prajwal Chavan            |
| Last Updated | 29 September 2026         |

---

# Purpose

This page describes the architecture Distribution OS is built on: the services, the stack, the hosting, and how the modules are kept apart.

The technology stack is TypeScript end to end.

# 1. Architecture in nine lines

1. One git repository, **two independent pnpm workspaces**: `backend/` and `frontend/`.
2. **One NestJS service per role** — eight of them, counting sign-in and the platform console — each assembled from one shared core library; not a monolith, not microservices with their own databases. For a small deployment all eight plus the worker run in **one process** (all-in-one mode), and they can be split with no code change.
3. **One PostgreSQL 17 database.** Every tenant table carries `tenant_id` with row-level security **enabled and forced**.
4. **Append-only ledgers** for stock and for money; balances are derived, never edited.
5. **Contract-first API** (oRPC + Zod) with a **permission matrix** deciding every endpoint × every role before any business logic runs.
6. **The product's own authentication service**: username + password, EdDSA access tokens, rotating per-device refresh tokens; the token also carries an **elected role**, granted downward only.
7. **Object storage** for every binary, and **one pg-boss worker** for outbox relay, retention and document rendering.
8. An **offline write protocol that never answers 4xx**, **the product's own delta-sync client** on the device, and scale rules that apply from the first distributor.
9. **One Expo codebase for the app**: six role groups behind one sign-in — one website and one Android app, with iOS built from the same code and not released yet — plus the separate platform console; the backend runs natively as one process on one VM, with the website on a CDN.

# 2. Technology stack

| Layer             | Technology                                               | Note                                                                                     |
| ----------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Language          | TypeScript 6.0.x, Node 24                                | Exactly one TypeScript version per workspace                                             |
| Backend framework | NestJS 12 on Fastify                                     | One service per role, one shared core library                                            |
| API               | oRPC, contract-first                                     | Contracts declared in Zod 4 before implementation                                        |
| Database          | PostgreSQL 17                                            | One database, shared schema, forced RLS                                                  |
| ORM / migrations  | Drizzle ORM + drizzle-kit                                | Generated migrations plus hand-written guarantee migrations                              |
| Queue / jobs      | pg-boss (inside Postgres)                                | No Redis, no BullMQ                                                                      |
| Object storage    | S3-compatible, or a local driver                         | Local driver is the default and needs no cloud account                                   |
| Auth              | Own service: argon2id + EdDSA JWT + JWKS                 | No third-party auth provider                                                             |
| Apps              | Expo (React Native) + expo-router, web + Android + iOS   | One codebase renders all three; the six business roles are one app, the console a second |
| Offline           | The product's own delta-sync client on SQLite            | No PowerSync, no TanStack Query                                                          |
| Compute           | One native process, all-in-one mode, on Oracle Cloud ARM | See §4.3; run by systemd, reached through a Cloudflare tunnel with Cloudflare's TLS      |
| Web hosting       | Cloudflare Pages; nightly backups to object storage      | Website at `www.distributionos.in`                                                       |
| Tooling           | pnpm 11 workspaces + Turborepo                           | Dependency versions pinned in a workspace `catalog:`                                     |
| API docs          | Swagger UI + Scalar, generated from the contract         | Examples built from real seeded rows                                                     |

# 3. Repository shape

Two workspaces, `backend/` and `frontend/`, install and build separately.

**`backend/`**

| Package                              | Responsibility                                                                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/domain`                        | Pure TypeScript, **zero runtime dependencies**: money in paise, quantities in pieces, GST split, GSTIN checksum, UUIDv7, IST business dates, state machines, the pricing engine |
| `libs/contracts`                     | Zod schemas, the oRPC contract (one file per module), and `permissions.ts` — the only place wire shapes and role rules live                                                     |
| `libs/database`                      | The only place SQL schema lives: Drizzle schema, RLS policies as code, migrations, seed data, `withTenant()`                                                                    |
| `libs/core`                          | Platform services (tenant context, authorization, idempotency, numbering, object storage, PDF documents) and one folder per business module                                     |
| `libs/config`                        | Shared TypeScript / ESLint / Vitest presets                                                                                                                                     |
| `auth-service` + seven role services | ~20 lines each: which roles it serves, which modules it mounts, its default port                                                                                                |
| `all-in-one`                         | The same eight services mounted behind path prefixes in one process, for a small deployment (§4.3)                                                                              |
| `worker`, `tools`, `infra`           | pg-boss consumers; README and key generation, smoke harness; the server's setup, release and backup scripts, and a Dockerfile, compose files and Caddyfile for other machines   |

**`frontend/`** holds `libs/{ui,api-client,offline,config}` and two app packages: `dos-app`, the one app of the six business roles, and `admin-app`, the platform console. The apps link `@dos/contracts` and `@dos/domain` as symlinks into the backend, so the wire types and the pricing engine are one implementation shared by server and device — not a copy.

**Module boundaries are enforced, not conventional.** A backend module reaches another module only through its exported application service or an outbox event, never its tables (`eslint-plugin-boundaries`). Cross-module foreign keys point downstream only: tenancy → identity → catalog → tenant-catalog → retailers → pricing → inventory → orders → procurement → warehouse → billing → receivables → delivery → docint → claims → notifications → reporting → integrations → incentives.

# 4. Services, ports and URLs

Every role gets its own service, so a role can only reach the endpoints its service mounts. The permission matrix then decides per endpoint inside that. The eighth service, admin, serves the platform console.

| Service   | Port | Roles served            | Local base URL        |
| --------- | ---- | ----------------------- | --------------------- |
| auth      | 3000 | everyone (sign-in only) | http://localhost:3000 |
| owner     | 3001 | owner                   | http://localhost:3001 |
| manager   | 3002 | manager, accountant     | http://localhost:3002 |
| sales     | 3003 | salesperson             | http://localhost:3003 |
| warehouse | 3004 | warehouse               | http://localhost:3004 |
| delivery  | 3005 | delivery                | http://localhost:3005 |
| retailer  | 3006 | retailer                | http://localhost:3006 |
| admin     | 3007 | platform_admin          | http://localhost:3007 |
| worker    | —    | system                  | —                     |

Every service exposes the same four routes: `/health` (liveness, unauthenticated and outside the tenant guard), `/swagger` (Swagger UI with a working example on every operation), `/docs` (Scalar reference) and `/docs/openapi.json` (the OpenAPI document for that service's contract subset only).

Services are **stateless**: any number of instances of any service may run behind a load balancer with no code change. The database is the only shared state.

## 4.1 One app, six role groups

The six business roles are **one Expo project, `frontend/dos-app`**, published as a single store listing and a single website:

- Each role's screens live in a **role group** with its own visible path — `/owner`, `/manager`, `/sales`, `/warehouse`, `/delivery`, `/retailer`. One root layout reads the token's elected role and mounts that group's navigation, strings and touch floor. Every screen imports only `@dos/ui`, which is what lets one screen work on web, Android and iOS.
- The API client picks the service for every call from the elected role (**`serviceFor(role)`** — one base URL per service), so the sales group talks only to sales-service. **The one app is packaging, never a security boundary**: the boundary is the eight services, the permission matrix and row-level security.
- **The platform-admin console is a separate app.** Platform staff are not a distributor's users.
- Why one listing: one build, one review queue and one update cycle for all six roles — and a distributor's new hire is never told _which_ of six apps to install.

## 4.2 Role election at sign-in, downward only

A membership is one (person, distributor, role), but real distributorships do not work that way: the owner drives some mornings, the warehouse man delivers on Tuesdays. So **the device asks for the role it needs, and the auth service grants it only downward**:

| Membership role                              | May act as                                               |
| -------------------------------------------- | -------------------------------------------------------- |
| owner                                        | manager, accountant, warehouse, delivery, salesperson    |
| manager                                      | warehouse, delivery, salesperson                         |
| accountant, warehouse, delivery, salesperson | own role, plus each role the owner or manager adds to it |
| retailer, platform_admin                     | never anything else                                      |

- The access token's `role` claim is the **elected** role; the subject stays the person, so every audit row, every receipt and every delivery still records _who_ did it — the token merely says _as what_. A refused election is a clear 403 at sign-in ("Your login at Tarsun is a salesperson; ask the owner to add delivery to it"), never a silent downgrade.
- **An owner token never enters the field screens.** A van phone is a shared, droppable device; an owner token on it would reach owner-service — every margin, every setting — for the life of its refresh token. That is exactly what the eight services exist to prevent.
- On the server an elected role is an ordinary role: services keep their role lists, the permission matrix keeps its rows, and RLS reads the elected role as the actor's role.

## 4.3 Deployment shape

| Piece           | Shape                                                                                                                                                                 |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compute         | **All eight services plus the worker in one process** (all-in-one mode), run natively under systemd, no container, on **Oracle Cloud, Mumbai** (2 OCPU, 12 GB, arm64) |
| TLS and routing | A **Cloudflare tunnel** that the server opens outward, with Cloudflare's TLS; `api.distributionos.in`. The server accepts no inbound connection except SSH            |
| Database        | **PostgreSQL 17 self-hosted on the same VM**, listening on its loopback only                                                                                          |
| Web app         | **Cloudflare Pages**; `www.distributionos.in`, with the bare `distributionos.in` redirecting to it                                                                    |
| Backups         | **Nightly dump of every database plus the cluster's roles**, kept seven days on the VM, uploaded to object storage through a write-only link, with a tested restore   |
| Builds          | **On the server**: a release copies the source and builds there, rehearses new migrations on a restore of the latest backup, dumps, migrates, restarts, checks health |
| Domain          | `distributionos.in`: the website at `www.distributionos.in`, the API at `api.distributionos.in`                                                                       |

**Why the database is not managed.** The schema creates a `BYPASSRLS` database role for the worker, which requires superuser rights. No free managed tier grants them — Neon, Supabase and RDS all withhold it — so a managed free Postgres cannot host this schema at all. The database therefore runs on the same VM as the services.

# 5. Data layer: one database, hard tenant isolation

- **Shared schema, `tenant_id` on every tenant table**, with `ENABLE` **and** `FORCE ROW LEVEL SECURITY` — forced, so even the owning connection obeys policy.
- All tenant data access goes through `withTenant()`: a transaction that runs `SET LOCAL ROLE app_rw` and sets `app.tenant_id`, `app.actor_id`, `app.actor_role`. Policies read those settings. Nothing reaches a tenant row outside that transaction.
- **Purchase cost, landed cost and margin** live in `tenant_product_costs` under a back-office-only policy. A salesperson, warehouse, delivery or retailer role cannot read them — a database guarantee with tests, not an application rule.
- A retailer sees only rows linked to their own shop; a tenant never sees another tenant's rows. Cross-tenant worker jobs use a separate `app_worker` role.
- **Global vs tenant data:** manufacturers, products and variants are global and curated (a distributor may propose one and use it immediately); retailers, prices, orders and ledgers are per tenant. A user is global and holds one membership per tenant, which is what lets one shopkeeper log in once and see several distributors.
- **One tenant is one distributorship.** Branches are not modelled in version 1; multi-branch comes after version 1.
- Migrations are **expand-only** from 0004 onward. Roles, grants, forced-RLS assertions, triggers and views live in hand-written migrations beside the generated ones.
- `backend/libs/database/src/rls.test.ts` is the executable form of these rules: cost invisible to a salesperson, tenant isolation, retailer scope, append-only ledgers, journals balancing.

# 6. Append-only ledgers

Two ledgers carry everything that matters, and neither can be edited:

| Ledger                              | Guarantee                                                                                                                                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stock_ledger`                      | Append-only by trigger; one row per physical movement (GRN, reservation, pick, pack, load, return, adjustment, cycle count); `stock_balances` derived in the same transaction; `UNIQUE(tenant_id, idempotency_key)` |
| `journal_lines` / `journal_entries` | Append-only by trigger; double entry that **must balance at commit**, enforced by a `SECURITY DEFINER` database trigger so the check cannot be blinded by the caller's own row-level policy                         |

Consequences that shape the whole product:

1. An issued invoice is never edited. Corrections are credit or debit notes; an invoice cancelled before dispatch keeps its number — and cancelling that bill cancels its order in the same step, so nothing is left in the billing queue.
2. Outstanding and ageing are derived from open invoices minus allocations. "Overdue" is computed, never stored, and every distributor's ageing is rebuilt nightly so each morning's buckets are dated today.
3. Every mutation carries a client-generated UUIDv7 id and an idempotency key, so a retry or a duplicate offline upload is a no-op.
4. State columns change only through the state machines in `libs/domain` (order, trip and stop, invoice) — never by hand.
5. **Money moves exactly once**: banking a receipt, undoing it and settling its trip all lock it, so only one of them can win; and money already recorded wrongly is corrected by an appended balancing entry, never by an edit.

# 7. API: contract-first, with a permission matrix

The contract is written first, in `backend/libs/contracts`, and everything else is derived from it:

1. Declare the procedure and its Zod input/output in the module's contract file.
2. Add its row to `PERMISSIONS` — one row per procedure, each naming `public`, `authenticated`, or an explicit role list. **The guard fails closed**: an undeclared route is refused.
3. Implement it in the module, always in the order `requireRole → requireDb → withTenant → idempotent` for mutations.
4. Service READMEs and the OpenAPI documents regenerate from the contract; they are never edited by hand.

The matrix is one fixed list of seven roles, the same for every distributor: tenants configure settings, not roles.

Three properties are worth calling out to reviewers:

- **The matrix is tested exhaustively.** Every service spec runs every endpoint against every role and asserts the expected allow or 403. A service also refuses a role it does not serve before any business logic runs.
- **The offline door obeys the same matrix.** A role that may not make a change through the normal endpoint cannot make it through `/sync/upload` either: the upload records a refusal, never a silent write. A salesperson can never record a receipt by any route, and the database says so as well as the matrix.
- **The published examples work.** Every OpenAPI operation carries an example built from real seeded rows, and the smoke harness signs in as each service's role and calls every operation with the example it publishes.

Wire-shape rules: every mutating procedure extends a mutation base carrying `idempotencyKey` plus the client UUIDv7 `id`; every list is cursor-paginated with a hard limit and ordered newest first on the same column its own date window filters — server time for a queue of work, the document's own date for a dated register, the row id only ever breaking a tie.

# 8. Authentication and sessions

The product runs its own auth service. Sign-in is a username and a password; OTP over SMS or WhatsApp comes after version 1, layered on top of the username and password rather than replacing them.

| Element           | Implementation                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| Credential        | Username + password; argon2id at OWASP's 2024 interactive minimum (19 MiB, 2 passes, 1 lane)     |
| Lockout           | 5 failed attempts, 15-minute lock; every attempt written to an auth event log                    |
| Access token      | EdDSA (Ed25519) JWT, 15 minutes, claims: user, tenant, **elected role**, session, device         |
| Role election     | The device asks for a role; granted downward only (§4.2), recorded in the auth event log         |
| Refresh token     | Per device, rotating, 30 days; reuse of a retired token revokes the whole session                |
| Verification      | Services verify with the public key from JWKS — no call back to the auth service on the hot path |
| Multi-distributor | `switch-tenant` issues a token for another membership; one shopkeeper login, many distributors   |
| Recovery          | Forgot / reset password via a signed token bound to the current password hash (no reset table)   |
| Sign-out          | Leaves nothing of the previous person or distributor on the device (§11) — a non-negotiable      |

Authorization is layered: token verification, then the permission matrix, then row-level security in Postgres, then any narrowing inside the handler. The database layer is the guarantee; the matrix exists to give a clear 403 early and to be reviewable in one file.

The app opens on a **Welcome** screen (the Distribution OS mark and one Sign in button — shown once per device, not on every launch) and, after sign-in, a brief **landing**: the distributor's logo and name, the person's name, and the role they are working as. White labelling holds inside the app: Distribution OS shows itself before sign-in and nowhere after it.

# 9. Files, documents and printing

- Object storage sits behind two drivers. The **local driver is the default** — it writes to disk and signs its own URLs with HMAC, so the whole product runs on a laptop, and on a single server, with no cloud account. The **S3 driver** implements SigV4 signing directly with `node:crypto` (about 70 lines) rather than pulling in the AWS SDK, and is tested against AWS's published signing vectors with no network call. Nightly backups are uploaded to an object-storage bucket through a write-only link, so the server can add to the bucket and cannot read it.
- Keys are tenant-scoped and a key that tries to escape its tenant prefix is refused. Uploads are pre-signed PUTs on both drivers, so the local flow is the S3 flow; reads follow the owning row's RLS, so another shop's invoice PDF is a 403, not a leak.
- PDFs (invoice in A4, A5 and thermal widths, credit note, delivery challan, receipt) are rendered by a dependency-free renderer in the worker and white-labelled from tenant settings.
- **No permanent public link to a shop's papers.** Invoices, receipts and statements go out as files shared from the phone; a forever-URL carrying a shop's prices and balance is refused, and any link ever added must be signed and expire in seven days.

# 10. Background work

One worker process, pg-boss inside the same PostgreSQL database — no separate broker.

| Job              | Schedule     | Purpose                                                                                           |
| ---------------- | ------------ | ------------------------------------------------------------------------------------------------- |
| Outbox relay     | Every minute | Publishes `outbox_events` written in the same transaction as the business change                  |
| Retention sweep  | Hourly       | DPDP-driven retention (GPS points, idempotency keys, expired artefacts)                           |
| Document render  | Every minute | Invoice, credit note, challan and receipt PDFs                                                    |
| Nightly finalise | 00:20 IST    | Day-end rollups and one ageing rebuild per distributor, so each morning's buckets are dated today |

Document intelligence (supplier-bill extraction), imports and exports, rollups and notification sends run on the same worker. In the deployment of §4.3 the worker runs **inside the same process** as the eight services.

# 11. Offline sync protocol

Sales and delivery keep working without signal; the other roles work online. The device half is **the product's own delta-sync client**, not PowerSync.

- `POST /sync/upload` takes a batch of operations from one device. **It never answers 4xx.** A business rejection is a 2xx with a rejection entry plus a durable error row that comes back to the device's "needs attention" tray; only a transient fault is a 5xx, so the device retries with backoff and the queue can never wedge.
- Outcomes are durable and keyed by tenant, device and operation id, so a replay after days offline returns the stored outcome instead of double-posting; the ledgers' own idempotency uniqueness is the second line of defence. Modules register their own per-table handlers, so the protocol knows no business rules — the module does.
- The device half is SQLite tables built from the server's own manifest, a cursor pull that applies deletions before rows, and an outbox that replays in order under the original operation id.
- **A device's offline copy belongs to one person in one distributorship.** Each person and distributor gets their own store, checked before anything is shown and closed at sign-out; unsent changes stay with that person on that device, go first at their next sign-in there, and are never visible to anyone else. Nothing is thrown away at sign-out, and money already entered is never offered for deletion.
- **The app never claims work is safe when it is not.** A browser or phone that cannot keep an offline copy says so on every screen, and an order saved with no signal keeps saying so until the office actually confirms it.
- **GPS breadcrumbs bypass the queue.** On a delivery phone the app buffers points and posts batches separately; a device offline for hours must never replay hundreds of location rows ahead of a cash receipt.

# 12. Scale rules

The product is built for lakhs of users. These are build rules, not a later phase: every module follows them. The load model designed and tested against: 10,000 distributors, 100,000 staff devices, 2,000,000 retailers; peak 5,000 orders per minute, 20,000 concurrent sync uploads, 50,000 GPS points per minute, 1,000 invoice scans per minute.

| Rule                          | What it means in the code                                                                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Stateless services            | Nothing in process memory another instance would miss; per-request state in `AsyncLocalStorage`                                                 |
| Bounded work per request      | Every list cursor-paginated with a hard cap; batches capped; long work goes to the worker and returns a job id                                  |
| Idempotent by construction    | Client idempotency key + client UUIDv7 on every mutation                                                                                        |
| Per-tenant fairness           | Rate limits and queue priority keyed by tenant, so one distributor's bulk import cannot starve another's orders                                 |
| Indexes lead with `tenant_id` | Makes sharding a data move, not a redesign                                                                                                      |
| Ledgers partition-ready       | Monthly partitioning past roughly 50M rows; rollup tables are the read surface so phones never scan ledgers                                     |
| Reads scale on replicas       | Two pools from the start (`DATABASE_URL`, `DATABASE_REPLICA_URL`); a missing replica falls back to the primary                                  |
| Connection discipline         | Small pools behind a transaction-mode pooler; all session state is `SET LOCAL`. The hard constraint: **replicas × pool size ≤ max_connections** |
| Hot rows avoided              | Numbering holds a row lock for milliseconds; counters are recomputed by the worker, not on the request path                                     |
| Observability first           | Structured logs with tenant, actor, request id and service; per-procedure metrics. Dashboards and tracing are not available yet                 |

# 13. Where AI sits in this architecture

The AI features — LLM vision extraction of supplier bills, WhatsApp free-text and voice order capture parsed into a draft, demand forecasting and reorder suggestions, and route sequencing — are ordinary modules calling an external model from the worker, never a separate system, and **none of them commits on its own**: a human confirms the draft order, the reviewed GRN, the purchase suggestion and the route.

# 14. Known limits, stated honestly

- **iOS is not released yet.** The app is built from the same code for iOS; the released phone app is Android.
- **Not available yet:** performance and search tuning, accessibility work and a hardened public surface, observability and DevOps tooling beyond structured logs and metrics, and localization — the app is in English.
