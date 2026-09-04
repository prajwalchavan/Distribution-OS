# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Distribution OS: a multi-tenant SaaS for Indian FMCG distributors (manufacturer → distributor → retailer), sold by subscription to the distributor. One TypeScript monorepo: a NestJS modular monolith + worker on Postgres, two Expo apps (`team` with owner/sales/warehouse/delivery role modules, `retailer`) and a Vite console. The blueprint lives in `docs/` — read `docs/00-overview.md` first, then `docs/adr/0000-irreversibility-register.md`. Product/architecture decisions are in `docs/15-decisions-log.md`; do not re-decide them silently.

## Toolchain

Node 24 (`.node-version`; `fnm use` or `nvm use`) and pnpm 11 (`packageManager` in `package.json`). All dependency versions are pinned in the `catalog:` section of `pnpm-workspace.yaml` — add new packages there, then reference `"catalog:"` in the package. pnpm settings (hoisted linker for Expo, allowed build scripts) also live in `pnpm-workspace.yaml`, not `.npmrc`.

Exactly ONE TypeScript version (6.0.x) is allowed in the tree, including the Expo apps (they use `"typescript": "catalog:"`, not the template's own pin). Two copies make typescript-eslint's type-aware rules crash or report nonsense (`only-throw-error` on `new Error`, `await-thenable` on real promises). typescript-eslint 8.x supports TS < 6.1 only, so do not move to TS 7 until it does.

Each Node package has two tsconfigs: `tsconfig.json` (editor + lint + `typecheck`: includes `src`, tests and `vitest.config.ts`, `noEmit`) and `tsconfig.build.json` (`build`: `src` only, emits `dist/`). Keep new config files (`drizzle.config.ts` etc.) in the `include` of `tsconfig.json` or ESLint's project service rejects them.

## Commands (run from the repo root)

```bash
pnpm install                       # whole workspace
pnpm typecheck                     # tsc in every package (turbo)
pnpm lint                          # eslint in every package
pnpm test                          # vitest in every package
pnpm build                         # shared libs, db, api, worker, console
pnpm format                        # prettier --write
```

Single package / single test:

```bash
pnpm --filter @dos/domain test -- src/money.test.ts     # one file
pnpm --filter @dos/domain test:watch                    # watch mode
pnpm --filter @dos/api test                             # api tests (no DB needed)
```

Database (needs `DATABASE_URL`; copy `.env.example` to `.env`; `pnpm db:up` starts Postgres 17 via Docker Compose):

```bash
pnpm db:generate                   # drizzle-kit: schema change -> SQL migration in backend/db/migrations
pnpm db:migrate                    # apply migrations (also what CI and the deploy job run)
pnpm db:seed                       # pilot tenant + owner (placeholder phone)
pnpm db:studio                     # drizzle studio
```

Run things:

```bash
pnpm --filter @dos/api dev         # NestJS on :3000 (node --watch + SWC); GET /health, GET /health/ping
pnpm --filter @dos/worker dev      # pg-boss worker
pnpm --filter @dos/console dev     # Vite on :5173 (VITE_API_URL defaults to http://localhost:3000)
pnpm --filter @dos/team start      # Expo dev server; needs a development build, not Expo Go, once
pnpm --filter @dos/retailer start  #   native modules (op-sqlite, background location) are added
```

`pnpm dev` runs every `dev` task through turbo (api, worker, console, shared watchers). Shared libraries (`@dos/domain`, `@dos/contracts`, `@dos/db`) compile to `dist/` and are consumed from there, so after editing one either run `pnpm build --filter <pkg>` or keep `pnpm dev` running.

## Layout and the rules that keep it honest

```
shared/domain      pure TS, ZERO runtime deps: Money (paise), Qty (pieces + case size), GST split + GSTIN
                   checksum, UUIDv7, state machines, price precedence. Runs on server AND device.
shared/contracts   Zod 4 schemas + the oRPC contract. The only place wire shapes live.
shared/config      tsconfig / eslint / vitest presets (extend, don't copy).
backend/db         The ONLY place SQL schema lives: Drizzle schema (one file per module), RLS policies
                   as code, migrations, seeds, and `withTenant()`.
backend/apps/api   NestJS 12 on Fastify. src/platform/ = cross-cutting (db provider, tenant context).
                   src/modules/<name>/ = one bounded context each; only its index.ts is importable.
backend/apps/worker pg-boss consumers (outbox relay, later docint/imports/rollups). Same image as api.
frontend/apps/team, retailer   Expo SDK 57 + expo-router; route groups per role under src/app/(<role>)/,
                   screens/hooks under src/features/. `team` is the only app with location/camera perms.
frontend/apps/console          Vite + React 19 owner console and billing desk.
frontend/packages/{ui,api-client,offline}   tokens/strings, typed oRPC client, the ONLY PowerSync code.
infra/             Dockerfile (api + worker, one image), hosting notes, runbooks.
docs/              blueprint (00–15), adr/, domain/, design/ (frozen synthesis), research/ (R01–R10).
```

- Backend modules talk only through exported application services or outbox events, never another module's tables or internals. `eslint-plugin-boundaries` (see `shared/config/eslint/backend.js`) enforces the `index.ts` entry point.
- `shared/domain` must stay dependency-free so it bundles into Expo unchanged.
- Every mutating contract procedure takes `idempotencyKey`; every synced table has `id text` (client UUIDv7) and `tenant_id`.

## Architecture facts you cannot infer from one file

- **Tenancy (ADR 0002).** Shared schema, `tenant_id` on every tenant table, RLS enabled (FORCE is added in migrations). The app connects as `app_rw`, never a superuser. All tenant data access goes through `withTenant(db, ctx, fn)` in `backend/db/src/client.ts`, which opens a transaction, runs `SET LOCAL ROLE app_rw` (so even an owner/superuser connection obeys RLS) and sets `app.tenant_id`, `app.actor_id`, `app.actor_role`; policies read those settings. In the API, `TenantGuard` puts the context in `AsyncLocalStorage` (`src/platform/tenant-context.ts`); `currentTenant()` throws outside a guarded request. `/health` is deliberately unguarded.
- **Schema layout.** `backend/db/src/schema/<module>.ts`, one file per bounded context, all re-exported from `schema/index.ts` (drizzle-kit reads that file). Cross-module FKs only point "downstream" in this order: tenancy → platform/identity → catalog → tenant-catalog → retailers → pricing → inventory → orders → procurement → warehouse → billing → receivables → delivery → docint → claims → notifications → reporting → integrations → incentives; an upstream reference (e.g. `tenant_product_costs.updated_from_grn_id`) is a plain `text` id with a comment. Policy helpers in `schema/columns.ts`: `tenantPolicy` (any member), `tenantRolePolicy(name, BACK_OFFICE_ROLES)` (owner/manager/accountant/system — used for every table that carries purchase cost), `tenantOrOwnRetailerPolicy(name, retailerColumn)` + `staffWritePolicy` (retailer role reads only rows linked to it through `retailer_links.user_id`), `globalCuratedPolicies` (global tables: read all, write curator/system). Never write a policy that joins `retailer_identities` from a tenant table: Postgres reports infinite policy recursion (42P17); that is why `retailer_links.user_id` is denormalised.
- **Hand-written migrations.** drizzle-kit generates `NNNN_<name>.sql`; roles, grants, `FORCE ROW LEVEL SECURITY`, triggers (append-only ledgers, journal balance at commit, issued-invoice immutability) and views (`sellable_stock`, `security_invoker`, needs Postgres 15+) live in a hand-written sibling (`0001_…`, `0003_…`) that must also be appended to `migrations/meta/_journal.json`. When you add a table, add its `FORCE ROW LEVEL SECURITY` line to a new hand-written migration. `CREATE ROLE` is wrapped in `DO … IF NOT EXISTS` because roles are cluster-wide.
- **DB guarantee tests.** `backend/db/src/rls.test.ts` runs only when `DATABASE_URL` points at a migrated database (CI does; locally `DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/dos pnpm --filter @dos/db test`). It is the executable form of the ADRs: cost invisible to salesperson, tenant isolation, retailer sees only own orders and cannot touch credit, ledgers append-only + idempotent, journals balance. Extend it when adding a role-restricted table.
- **New tenant bootstrap.** `bootstrapTenant(db, tenantId)` in `backend/db/src/tenant-bootstrap.ts` seeds the chart of accounts, default locations, numbering series (Indian FY label from `financialYear()`) and feature flags. Call it from signup; the seed calls it for the pilot tenant.
- **Global vs tenant data.** Manufacturers and products are global (curated); retailers, prices, orders, ledgers are per tenant. A user is global (phone) and holds memberships per tenant, which is how one shop buys from several distributors. Purchase cost lives in a separate owner/manager-only table and never in a stream a salesperson can sync — this is a database guarantee plus a CI test, not a UI setting (a competitor's leak here made staff quit).
- **Ledgers.** Stock and money are append-only ledgers with derived balances; an issued GST invoice is never edited (credit notes instead). `stock_ledger` and `journal_lines` carry `UNIQUE(tenant_id, idempotency_key)`.
- **Aggregates and states.** Sales Order is the primary aggregate; invoice is a derived artefact issued at pack. Three independent machines in `shared/domain/src/state-machines/`: order (`draft → submitted → confirmed → picking → packed → dispatched → delivered|partially_delivered → closed`), trip/stop (vehicle is a stock location; van sales are on-spot orders fulfilled from it), invoice (`issued → partially_paid → paid → written_off`). Use `machine.next()`; never set a state column by hand.
- **Money and quantities.** Integer paise (`Paise`) and integer pieces (`Pieces`) everywhere; percentages are basis points (8.33% = 833). Cases are display only, derived from the product's case size (supplier packs differ: x90, _120, CS1). Use `allocate()` to spread header discounts without losing a paisa.
- **Pricing.** `resolvePrice()` order is fixed: tier price → retailer override wins → schemes stack unless the override is `final` → approved bargain last. Every order/invoice line stores `applied_rules` so bills print Free/Scheme/Disc exactly and claims reconstruct later.
- **Offline sync (ADR 0007).** The team app is offline-first via PowerSync streams per role; the retailer app is online-first. Devices upload through `/sync/upload`; the server NEVER answers 4xx there (it wedges the device queue) — business rejections are 2xx + a `sync_errors` row. `sync_ops(tenant, device, op_id)` is durable ≥180 days; `idempotency_keys` (online oRPC) is the only 24-hour table. GPS points bypass the sync queue via `POST /gps/points`.
- **Inbound invoices.** "Zero manual entry" = zero typing except the blind gate count: QR/IRN verify → optional structured pull → LLM vision extraction → deterministic validators → SKU match → human review → GRN commit. Never auto-commit an extraction. Brand-DMS invoices (Too Yumm on FieldAssist) are ingested the same way and committed as `source = brand_dms_import` sales invoices; never issue a second legal invoice for them. See `docs/05-inbound-invoice-pipeline.md`.
- **API style.** Contract-first oRPC: define the procedure in `shared/contracts/src/contract.ts` with an explicit `.route({ method, path })`, then implement it in a Nest controller with `@Implement(contract.x.y)` + `implement(...).handler(...)` (see `modules/health/health.controller.ts`). Every `@Implement` method takes `@OwnsReply() _reply: unknown` (from `src/platform`) — oRPC writes the Fastify reply itself and without the marker Nest sends a second time and logs `FST_ERR_REP_ALREADY_SENT` per request. Load-balancer/webhook endpoints stay plain Nest routes.
- **Decorator metadata.** NestJS constructor injection needs `design:paramtypes`, which esbuild-based tools (tsx, vitest's default transform) never emit — a service then arrives as `undefined` with no error. The api therefore runs dev via `@swc-node/register` and tests via `unplugin-swc` (see `backend/apps/api/vitest.config.ts`); `tsc` builds are fine. tsx is still used for scripts without decorators (`backend/db` migrate/seed, worker).
- **Migrations** are generated SQL reviewed in PR and must be backward compatible with the running version (blue/green). Roles/grants/FORCE RLS go in hand-written migration steps, not in app code.

## Things that look wrong but are intentional

- `frontend/apps/*/AGENTS.md` and `CLAUDE.md` are generated by Next/Expo tooling and warn that framework APIs changed after model training; read `node_modules/expo` / `vite` docs before assuming.
- Expo apps pin their own `react`/`react-native`/`typescript` from the Expo template (hoisted layout tolerates two React versions); the catalog versions are for web and Node.
- `TenantGuard` currently trusts `x-tenant-id` / `x-actor-id` / `x-actor-role` headers. That is a placeholder until the identity module (Better Auth) lands; do not build on it as if it were auth.
- `Dockerfile` has not been built on the founder's machine (no Docker there); CI is the first place it runs. Locally the founder runs a scratch Homebrew Postgres 17 on `127.0.0.1:5439` (`postgres://dos:dos@127.0.0.1:5439/dos`); start it with `LC_ALL=en_US.UTF-8` or the postmaster aborts with "became multithreaded".
