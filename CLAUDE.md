# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Distribution OS: a multi-tenant SaaS for Indian FMCG distributors (manufacturer → distributor → retailer), sold by subscription to the distributor, built for lakhs of users from day one (`docs/20-scale-rules.md`). One TypeScript monorepo laid out per `docs/19-layout-restructure.md`: `backend-services/` (five independently runnable NestJS services composed from one `core` library on one Postgres database, plus a worker) and `frontend-apps/` (five Expo apps, web + Android + iOS) with `shared/` for the code both sides use. The legacy `frontend/` (Vite console, `team`/`retailer` shells) exists until the five Expo apps replace it. Solo founder; pilot customer Tarsun Enterprises (Kalyan). Current goal: fully working apps on a local database with dummy data; deployment comes later.

**Read `docs/18-build-log.md` first** (where the build is, what is next, local links; update it after every module), then `docs/00-overview.md`, `docs/adr/0000-irreversibility-register.md`, and `docs/16-module-implementation-pattern.md` before writing a backend module. `docs/design/five-apps-flow-atlas.html` (and the PDF beside it) is the visual map of what each of the five apps does and how work flows between them. Product and architecture decisions live in `docs/15-decisions-log.md` and `docs/17-corrections-from-review.md`; do not re-decide them silently. Founder questions still open are in `docs/17` §C.

## Session resume protocol

The founder works in sessions that end when tokens run out. Every session: (1) read `docs/18-build-log.md` "RESUME HERE" and do exactly that first; (2) work one module at a time to "stable" = backend procedures + DB-backed spec + service wiring (`backend-services/*-service/src/service.ts`) + regenerated READMEs (`pnpm docs:readme`) + app screen + demo data + scale rules (`docs/20`) + build-log row; (3) delegate mechanical slices to Sonnet subagents with the brief pattern in `docs/16` (they never edit `contract.ts` / `index.ts` / `app.module.ts` permanently — the main session wires); (4) before the session ends, update the build log's RESUME HERE and status table, run `pnpm format`, and `git commit` the snapshot (if the tool refuses to commit, `git add -A` and hand the founder the one-line `git commit … && git push origin main` command); (5) end the reply with the local links from the build log and the sign-in ids. The product requirement right now: fully working apps on the local database with dummy data for **three distributors, staff under each, and shops linked to more than one distributor**; every backend service and every app runs independently (docs/19); built for lakhs of users from day one (docs/20); deployment later.

## Toolchain

Node 24 (`.node-version`; `fnm use`) and pnpm 11 (`packageManager` in `package.json`). Non-login shells (Claude's Bash tool, `.claude/launch.json`) start on the system Node 22: run `export PATH=/opt/homebrew/bin:$PATH; eval "$(fnm env)"; fnm use 24` before any `pnpm` command. All dependency versions are pinned in the `catalog:` of `pnpm-workspace.yaml` — add packages there, then reference `"catalog:"`. pnpm settings (hoisted linker for Expo, allowed build scripts) also live in `pnpm-workspace.yaml`, not `.npmrc`. After adding a workspace dependency run `pnpm install` so the lockfile changes (CI uses `--frozen-lockfile`).

Exactly ONE TypeScript version (6.0.x) in the tree, including the Expo apps (`"typescript": "catalog:"`). Two copies make typescript-eslint's type-aware rules crash or report nonsense. typescript-eslint 8.x supports TS < 6.1; do not move to TS 7 until it does.

Each Node package has `tsconfig.json` (editor + lint + `typecheck`: `src`, tests, config files, `noEmit`) and `tsconfig.build.json` (`build`: `src` only → `dist/`). New config files (`drizzle.config.ts` etc.) must be in the `include` of `tsconfig.json` or ESLint's project service rejects them.

## Commands (repo root)

```bash
pnpm install                       # whole workspace
pnpm format:check && pnpm lint && pnpm typecheck && pnpm build && pnpm docs:readme:check && pnpm db:migrate && pnpm test   # CI, in this order
pnpm format                        # prettier --write (repo-wide; run before finishing a slice)
pnpm docs:readme                   # regenerate every service/app README from the contract (CI runs --check)
pnpm --filter @dos/domain test -- src/money.test.ts       # one file
pnpm --filter @dos/core test -- src/modules/orders         # one module's specs (all module specs live in core)
pnpm --filter @dos/sales-service test                      # one service's smoke spec (health, /docs, role gate)
pnpm --filter @dos/db test                                 # the database guarantee tests (RLS, ledgers, journals)
```

Turbo runs `lint`, `typecheck` and `test` after `^build`, so a library that fails to build blocks every downstream task; the `test` task is the only one that receives `DATABASE_URL`.

Database (`DATABASE_URL` comes from the repo-root `.env`, auto-loaded by every script through `loadDotenv()` in `@dos/db`; real env vars win):

```bash
pnpm db:migrate                    # apply backend-services/database/migrations (CI and deploy run this too)
pnpm db:seed                       # pilot tenant + owner + chart of accounts/locations/series (prints ids)
pnpm db:generate                   # drizzle-kit: schema change -> new SQL migration
pnpm db:studio                     # Drizzle Studio at https://local.drizzle.studio
```

Run things (the desktop app's Browser pane uses `.claude/launch.json` entries `<name>-service`, `worker`, `console`):

```bash
pnpm --filter @dos/owner-service dev      # :3001  roles owner/manager/accountant   GET /health, GET /docs (Scalar), /docs/openapi.json
pnpm --filter @dos/sales-service dev      # :3002  salesperson (+owner/manager)
pnpm --filter @dos/warehouse-service dev  # :3003  manager (+owner)
pnpm --filter @dos/delivery-service dev   # :3004  delivery (+owner/manager)
pnpm --filter @dos/retailer-service dev   # :3005  retailer only
pnpm --filter @dos/worker dev             # pg-boss worker: outbox relay every minute, retention sweep hourly
pnpm --filter @dos/console dev            # legacy Vite console on :5173; proxies /api -> :3001
pnpm --filter @dos/team start      # Expo dev server (needs a dev build once native modules are added)
pnpm --filter @dos/retailer start
```

`pnpm dev` runs every `dev` task through turbo; `pnpm dev:backend` only the services, worker and libraries. Libraries (`@dos/domain`, `@dos/contracts`, `@dos/db`, `@dos/core`) are consumed from `dist/`: after editing one, `pnpm --filter <pkg> build` (or keep `pnpm dev` running) or the services will not see the change. Ports: `<NAME>_SERVICE_PORT` overrides a service's default; never set a global `PORT` in `.env`.

## Local environment (founder's Mac)

- Postgres 17 runs as the Homebrew service `postgresql@17` on **127.0.0.1:5439** (data in `/opt/homebrew/var/postgresql@17`, log `/opt/homebrew/var/log/postgresql@17.log`); `brew services start postgresql@17` if it is down. Port 5432 belongs to an unrelated Postgres 14. `.env` has `DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/dos`; `psql` lives in `/opt/homebrew/opt/postgresql@17/bin`. Role `dos` is the owner (CREATEDB, CREATEROLE, BYPASSRLS — it runs migrations and seeds); `app_rw` and `app_worker` are created by migrations.
- No Docker on this machine; `docker-compose.yml` and the `Dockerfile` are for CI/other machines.
- Tests that need a database (`describeDb` in specs, `backend-services/database/src/rls.test.ts`) run whenever `DATABASE_URL` resolves, which with `.env` present is always; they create their own fixtures with a unique run suffix, so the dev database accumulates test rows (harmless; `pnpm db:seed` data is separate).
- Console dev sign-in: paste the tenant id and user id printed by `pnpm db:seed` with role `owner` (placeholder until phone OTP).

## Layout and the rules that keep it honest

```
shared/domain        pure TS, ZERO runtime deps: Money (paise), Qty (pieces + case size), GST split + GSTIN
                     checksum, UUIDv7, IST business dates/FY, state machines, pricing engine priceOrder().
shared/contracts     Zod 4 schemas + the oRPC contract (one file per module + contract.ts). Wire shapes live ONLY here.
shared/config        tsconfig / eslint / vitest presets (extend, don't copy).
backend-services/database   @dos/db — the ONLY place SQL schema lives: Drizzle schema (one file per module), RLS
                     policies as code, migrations, seed + seed-demo, withTenant(), bootstrapTenant(), loadDotenv().
backend-services/core       @dos/core — library, no main.ts. src/platform/ (db provider, tenant context, authz,
                     idempotency, numbering, OwnsReply), src/modules/<name>/ (one bounded context, only index.ts
                     importable, ALL module specs here), src/service/ (defineService, ServiceModule, docs, bootstrap),
                     src/testing/app.ts (spec harness).
backend-services/<owner|sales|warehouse|delivery|retailer>-service   ~20 lines each: src/service.ts (roles,
                     modules, contract keys, default port), src/main.ts, src/service.spec.ts (health, docs, role gate).
backend-services/worker     pg-boss consumers (outbox relay, retention; later docint/imports/rollups).
backend-services/infra      Dockerfile + hosting notes.
frontend-apps/<name>-app    five Expo apps (web + Android + iOS), each with EXPO_PUBLIC_API_URL of its service.
frontend-apps/shared-ui     components, typed oRPC client, PowerSync (moving from frontend/packages).
frontend/            LEGACY until the Expo apps land: apps/console (Vite owner console, proxies to :3001),
                     apps/team + apps/retailer shells, packages/{ui,api-client,offline}.
docs/                blueprint 00–20, adr/, domain/, design/ (synthesis, verdicts, completeness, flow atlas), research/.
```

- Backend modules talk only through exported application services or outbox events, never another module's tables (`eslint-plugin-boundaries` enforces the `index.ts` entry point). Cross-module FKs in the schema point only downstream: tenancy → platform/identity → catalog → tenant-catalog → retailers → pricing → inventory → orders → procurement → warehouse → billing → receivables → delivery → docint → claims → notifications → reporting → integrations → incentives; an upstream reference is a plain `text` id with a comment.
- `shared/domain` must stay dependency-free so it bundles into Expo unchanged.
- Every mutating contract procedure extends `MutationBase` (`idempotencyKey`) and carries the client-generated UUIDv7 `id`; GET inputs use `QueryBoolSchema`/`QueryIntSchema` (query strings arrive as strings).

## Architecture facts you cannot infer from one file

- **Tenancy (ADR 0002).** Shared schema, `tenant_id` on every tenant table, RLS enabled + FORCE (hand-written migration). All tenant data access goes through `withTenant(db, ctx, fn)` (`backend-services/database/src/client.ts`): a transaction that runs `SET LOCAL ROLE app_rw` (so even the owner connection obeys RLS) and sets `app.tenant_id`, `app.actor_id`, `app.actor_role`; policies read those settings. Cross-tenant worker jobs use the `app_worker` role (BYPASSRLS). In the api, `TenantGuard` puts the context in `AsyncLocalStorage` (`src/platform/tenant-context.ts`); `currentTenant()` throws outside a guarded request; `/health` is unguarded.
- **Policy helpers** (`backend-services/database/src/schema/columns.ts`): `tenantPolicy` (any member), `tenantRolePolicy(name, BACK_OFFICE_ROLES)` (owner/manager/accountant/system — every table carrying purchase cost), `tenantOrOwnRetailerPolicy` + `staffWritePolicy` (retailer role reads only rows linked to it via the denormalised `retailer_links.user_id`), `globalCuratedPolicies` (global tables: read all, write curator/system). Never write a policy that joins `retailer_identities` from a tenant table: Postgres reports infinite recursion (42P17).
- **Hand-written migrations.** drizzle-kit generates `NNNN_<name>.sql`; roles, grants, FORCE RLS, triggers (append-only ledgers, journal balance at commit, issued-invoice immutability) and views (`sellable_stock`, security_invoker → Postgres 15+) live in the hand-written sibling (`0001`, `0003`) which must also be appended to `migrations/meta/_journal.json`. New table → add its FORCE line. `CREATE ROLE` is wrapped in `DO … IF NOT EXISTS` (roles are cluster-wide). Migrations 0002/0003 have never left this machine and may still be regenerated; once deployed, migrations are expand-only.
- **DB guarantee tests.** `backend-services/database/src/rls.test.ts` is the executable form of the ADRs (cost invisible to salesperson, tenant isolation, retailer sees only own orders and cannot touch credit, ledgers append-only + idempotent, journals balance). Extend it when adding a role-restricted table.
- **Global vs tenant data.** Manufacturers/products/variants are global and curated; a distributor may insert `proposed` ones and use them immediately. Retailers, prices, orders, ledgers are per tenant. A user is global (phone) with memberships per tenant. Purchase cost lives in `tenant_product_costs` (back-office RLS) and never in anything a salesperson/delivery/retailer role can read — a database guarantee plus CI tests.
- **Ledgers.** `stock_ledger` and `journal_lines` are append-only (triggers), balances derived (`stock_balances` updated UPDATE-first in the same transaction), `UNIQUE(tenant_id, idempotency_key)`. An issued invoice is immutable except its derived payment state; corrections are credit notes; an invoice cancelled before dispatch keeps its number with `state = cancelled`.
- **Aggregates and states.** Sales Order is the primary aggregate; invoice is issued at pack. State machines in `shared/domain/src/state-machines/` (order, trip/stop, invoice); use `machine.next()`, never set a state column by hand.
- **Money, quantities, dates.** Integer paise (`Paise`), integer pieces (`Pieces`), basis points; `allocate()` spreads header amounts to the paisa. Sell-side case size = `tenant_products.case_size_override` else `product_variants.default_case_size`; buy-side = `supplier_pack_configs`; lots carry their own `case_size`. Business dates and FY are IST (`businessDate()`, `financialYear()` in `shared/domain/src/calendar.ts`).
- **Pricing (ADR 0008 + docs/17).** `priceOrder()` in `shared/domain/src/pricing/schemes.ts` is the only engine: tier price → retailer override (`final` blocks schemes) → schemes (stacked in `priority, id` order, percentage rules compounding on the running net, exclusive scheme applies alone, order-level rules allocated by largest remainder) → approved bargain → cash discount reported, not deducted. Every order/invoice line stores `applied_rules`. The api's `pricing.quote` feeds it from the DB.
- **Offline sync (ADR 0007).** `POST /sync/upload` (`modules/sync`) NEVER answers 4xx: rejections are 2xx + `sync_errors`; outcomes are durable in `sync_ops`; modules register per-table handlers in `SyncRegistry` on `onModuleInit`; `SyncRejection` = business error. GPS points bypass the queue via `/gps/points` (not built yet).
- **Inbound invoices.** "Zero manual entry" = zero typing except the blind gate count: QR/IRN verify → optional structured pull → LLM vision → validators → SKU match → human review → GRN commit (`procurement.grns.post` writes lots, `grn` ledger rows and costs). Brand-DMS invoices (Too Yumm on FieldAssist) are captured before loading and committed as `source = brand_dms_import`; never a second legal invoice.
- **Services (docs/19).** A service is `defineService({ name, title, defaultPort, roles, modules, contractKeys })`; `runService()` mounts oRPC, `DbModule`, `ServiceModule.forService` (provides `SERVICE_INFO`, serves `/docs` + `/docs/openapi.json` from the contract subset) and `HealthModule`, then the listed modules. `TenantGuard` injects `SERVICE_INFO` when present and answers 403 for roles the service does not serve, before any business logic. Services are stateless: any number of instances may run behind a load balancer.
- **READMEs are generated.** `backend-services/*-service/README.md` and each app README's endpoint table come from `scripts/generate-readmes.mts` via `@dos/core`'s `renderServiceReadme` (Zod sampler in `src/docs/sample.ts`, field-name hints for realistic paise/phone/GSTIN examples). After any contract change run `pnpm docs:readme`; never edit those files by hand.
- **API style.** Contract-first oRPC: declare in `shared/contracts/src/<module>.ts`, wire in `contract.ts`, implement with `@Implement(contract.x.y)` + `implement(...).handler(...)`. Every `@Implement` method takes `@OwnsReply() _reply: unknown` (oRPC writes the Fastify reply itself; without it Nest replies twice). Services: `requireRole(...)` → `requireDb(this.db)` → `withTenant(...)` → `idempotent(tx, key, input, fn)` for mutations. Specs use `src/testing/app.ts`.
- **Decorator metadata.** esbuild-based runners (tsx, vitest's default transform) never emit `design:paramtypes`, so Nest DI silently injects `undefined`. Core and the services run dev via `@swc-node/register` and tests via `unplugin-swc`; tsx is fine for decorator-free scripts (database migrate/seed, worker).
- **Console.** Hash router (`src/lib/router.tsx`) until nested layouts are needed; `useSession()` stores the placeholder headers; `api` client from `src/lib/api.ts`; money via `<Money>`/`<RupeeInput>` (paise in, paise out). Vite dedupes React (Expo's copy is hoisted alongside).

## Things that look wrong but are intentional

- `TenantGuard` trusts `x-tenant-id` / `x-actor-id` / `x-actor-role` headers. Placeholder until the identity module (Better Auth phone OTP); do not build on it as auth.
- The retailers `linkIdentity` procedure is back-office only: a salesperson must not learn whether a phone exists in another distributor's network (docs/17 item 27).
- `frontend/apps/*/AGENTS.md` are generated by Expo tooling. Expo apps pin their own `react`/`react-native` from the template; the catalog versions are for web and Node.
- `Dockerfile` has not been built here (no Docker); CI is the first place it runs.
- The `describeDb` specs run against the dev database by default; that is deliberate (local-first), not a leak.
