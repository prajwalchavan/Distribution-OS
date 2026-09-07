# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Distribution OS: a multi-tenant SaaS for Indian FMCG distributors (manufacturer → distributor → retailer), sold by subscription to the distributor, built for lakhs of users from day one (`docs/20-scale-rules.md`). One git repo, TWO independent pnpm workspaces (`docs/19-layout-restructure.md`): `backend/` (one runnable NestJS service per app, an auth service and a worker, composed from the libraries in `backend/libs/`, on one Postgres database) and `frontend/` (one app per role, web + Android + iOS, linking the contract and domain packages from `backend/libs`). The repo root holds only those two folders, `docs/`, this file and dotfiles. Seven apps: owner, manager (shared with the accountant), sales, warehouse, delivery, retailer, and a platform-admin console (`admin-service` :3007, decided 2026-09-05, built at the end of the backend chain). Solo founder; pilot customer Tarsun Enterprises (Kalyan). Current goal: fully working apps on a local database with dummy data; deployment comes later.

**Read `docs/22-source-of-truth.md` first** — the single source of truth that survives context compression: the six apps and their services, the order-to-cash / stock-in / money / sign-in flows as Mermaid diagrams, the dated founder decisions register, the never-list and the open questions. **Any founder decision, correction or requirement is written into it in the same turn it is given** (§8 register + the diagram it changes + §11 change log), then `python3 docs/tools/render-source-of-truth.py` regenerates the HTML view and the artifact is republished (URL in the build log). Then **`docs/18-build-log.md`** (where the build is, what is next, local links; update it after every module), then `docs/00-overview.md`, `docs/adr/0000-irreversibility-register.md`, and `docs/16-module-implementation-pattern.md` before writing a backend module. `docs/design/five-apps-flow-atlas.html` is the earlier five-app illustrated map, kept as history; docs/22 wins where they differ. Product and architecture decisions live in `docs/15-decisions-log.md` and `docs/17-corrections-from-review.md`; do not re-decide them silently.

## Session resume protocol

**Standing instruction (founder, 2026-09-05): keep developing until a hard blocker.** When a background module finishes, the same turn verifies it, records it in the build log, and launches the next module. A turn must not end with nothing running while work remains. **Push, do not only commit (founder, 2026-09-07):** the moment an app's gate is green and the build log is updated, commit the snapshot AND `git push origin main`, so the remote always holds every finished piece.

**Autonomy (founder, 2026-09-06).** Restart anything that stops — the workflow chain, a service, the worker, an emulator — and install whatever the build needs, without asking; say in one line afterwards what was restarted or installed. Still ask for: anything needing the founder's password (`sudo`, an Apple ID sign-in), anything destructive, and product or architecture decisions.

**Where the build is (2026-09-07).** The backend is COMPLETE and verified: 23 modules, eight services, 139 tables, 34 migrations, ~2 400 tests, `pnpm smoke` 1 588 calls with 0 broken. The frontend is mid-chain: the kit, the universal layer, the offline client, and the owner, manager, sales and warehouse apps are green; delivery, retailer and admin remain, then a final end-to-end gate. The chain is a background Workflow (`scratchpad/dos-frontend.js`, resumed with its run id); each slice is implement → independent gate, and the gate walks every screen in a browser, on the Android emulator and headlessly on iOS.

The founder works in sessions that end when tokens run out. Every session: (1) read `docs/22-source-of-truth.md`, then `docs/18-build-log.md` "RESUME HERE" and do exactly that first; (2) work one module at a time to "stable" = backend procedures + DB-backed spec + service wiring (`backend/<role>-service/src/service.ts`) + regenerated READMEs (`pnpm docs:readme`) + app screen + demo data + scale rules (`docs/20`) + build-log row; (3) delegate mechanical slices to Sonnet subagents with the brief pattern in `docs/16` (they never edit `contract.ts` / `index.ts` / `app.module.ts` permanently — the main session wires); (4) before the session ends, update the build log's RESUME HERE and status table, run `pnpm format`, and `git commit` the snapshot (if the tool refuses to commit, `git add -A` and hand the founder the one-line `git commit … && git push origin main` command); (5) end the reply with the local links from the build log and the sign-in ids. The product requirement right now (founder, 2026-09-04): **backend first, production grade on the local database** — our own username + password auth service issuing tokens (OTP later), a per-endpoint permission matrix, every endpoint of every service built and tested, demo data for **three distributors, staff under each, and shops linked to more than one distributor**; then the six apps one at a time, each against its own service; built for lakhs of users from day one (docs/20); deployment later.

## Toolchain

Node 24 (`.node-version` at the root and in each workspace; `fnm use`) and pnpm 11 (`packageManager` in each workspace's `package.json`). There is no root `package.json`: run pnpm inside `backend/` or `frontend/`. Non-login shells (Claude's Bash tool, `.claude/launch.json`) start on the system Node 22: run `export PATH=/opt/homebrew/bin:$PATH; eval "$(fnm env)"; fnm use 24` before any `pnpm` command. All dependency versions are pinned in the `catalog:` of that workspace's `pnpm-workspace.yaml` — add packages there, then reference `"catalog:"`; keep typescript/eslint/prettier equal on both sides. pnpm settings (hoisted linker, allowed build scripts) also live in `pnpm-workspace.yaml`. After adding a dependency run `pnpm install` in that workspace so its lockfile changes (CI uses `--frozen-lockfile`). The frontend depends on `@dos/contracts` and `@dos/domain` through `link:../../backend/libs/<pkg>` (a symlink, not a copy), so build those two in backend before frontend typecheck/build.

Exactly ONE TypeScript version (6.0.x) per workspace, including the Expo apps (`"typescript": "catalog:"`). Two copies make typescript-eslint's type-aware rules crash or report nonsense. typescript-eslint 8.x supports TS < 6.1; do not move to TS 7 until it does.

Each Node package has `tsconfig.json` (editor + lint + `typecheck`: `src`, tests, config files, `noEmit`) and `tsconfig.build.json` (`build`: `src` only → `dist/`). New config files (`drizzle.config.ts` etc.) must be in the `include` of `tsconfig.json` or ESLint's project service rejects them.

## Commands (run inside `backend/` unless noted)

```bash
cd backend && pnpm install         # backend workspace (libs + services + worker)
pnpm format:check && pnpm lint && pnpm typecheck && pnpm build && pnpm docs:readme:check && pnpm db:migrate && pnpm test   # CI backend job, in this order
pnpm format                        # prettier --write for this workspace (run in both before finishing a slice)
pnpm docs:readme                   # regenerate every service README + each existing app README from the contract (CI runs --check)
pnpm auth:keygen                   # print an EdDSA key pair for AUTH_JWT_PRIVATE_KEY / AUTH_JWT_PUBLIC_KEY
pnpm smoke                         # sign in per role and call every operation of every RUNNING service with its published example; must end with 0 BROKEN (`--service owner`, `--only GET`, `--destructive`; see backend/tools/README.md)
pnpm --filter @dos/domain test -- src/money.test.ts       # one file
pnpm --filter @dos/core test -- src/modules/orders         # one module's specs (all module specs live in core)
pnpm --filter @dos/sales-service test                      # one service's smoke spec (health, /docs, role gate)
pnpm --filter @dos/db test                                 # the database guarantee tests (RLS, ledgers, journals)
cd frontend && pnpm install && pnpm lint && pnpm typecheck && pnpm build   # CI frontend job (needs backend libs built first)
```

Turbo runs `lint`, `typecheck` and `test` after `^build`, so a library that fails to build blocks every downstream task; the `test` task is the only one that receives `DATABASE_URL`.

Database (`DATABASE_URL` comes from `backend/.env`, auto-loaded by every script through `loadDotenv()` in `@dos/db`, which takes the nearest `.env` walking up from the process's cwd, so a service may carry its own; real env vars win):

```bash
pnpm db:migrate                    # apply backend/libs/database/migrations (CI and deploy run this too)
pnpm db:seed                       # pilot tenant (Tarsun) + chart of accounts/locations/series + demo data: staff and retailers (every password `Dos@1234`), catalog, orders, bills, receipts; idempotent, re-run after `pnpm smoke --destructive`
pnpm db:generate                   # drizzle-kit: schema change -> new SQL migration
pnpm db:studio                     # Drizzle Studio at https://local.drizzle.studio
```

Run things (the desktop app's Browser pane uses `.claude/launch.json` entries `<name>-service`, `worker`, `<name>-app`; each entry `cd`s into the right workspace):

```bash
pnpm --filter @dos/auth-service dev       # :3000  public: sign-in, refresh, me, switch distributor, jwks (auth module)
pnpm --filter @dos/owner-service dev      # :3001  owner            GET /health, /swagger (Swagger UI), /docs (Scalar), /docs/openapi.json
pnpm --filter @dos/manager-service dev    # :3002  manager, accountant
pnpm --filter @dos/sales-service dev      # :3003  salesperson
pnpm --filter @dos/warehouse-service dev  # :3004  warehouse
pnpm --filter @dos/delivery-service dev   # :3005  delivery
pnpm --filter @dos/retailer-service dev   # :3006  retailer
pnpm --filter @dos/worker dev             # pg-boss worker: outbox relay (registered handlers per event), retention sweep, PDF renderer (documents.pdf.render), docint pipeline
cd ../frontend && pnpm --filter @dos/owner-app web   # expo start --web on :5173; manager 5174, sales 5175, warehouse 5176, delivery 5177,
                                                    # retailer 5178, admin 5179. `expo run:ios` / `expo run:android` build the device app
                                                    # (the emulator is `Pixel_7_API_36`); `pnpm --filter @dos/<role>-app export:web` for a static build
```

Frontend checks: `pnpm lint`, `pnpm typecheck`, `pnpm test` (kit + client + offline specs), `pnpm build` (every app runs
`expo export --platform web`), `pnpm format:check` — all from inside `frontend/`. `pnpm --filter @dos/ui test` alone is the fastest
loop while working on a component. A screen change needs no rebuild of the kit; a kit change does (`pnpm --filter @dos/ui build`)
only for the packages that consume `dist/`, which today is nothing in the frontend — the apps consume its `src` through the
platform-resolved entry points.

`pnpm dev` in a workspace runs every `dev` task through turbo. Libraries (`@dos/domain`, `@dos/contracts`, `@dos/db`, `@dos/core`) are consumed from `dist/`: after editing one, `pnpm --filter <pkg> build` (or keep `pnpm dev` running) or the services and the frontend will not see the change. Ports: `<NAME>_SERVICE_PORT` overrides a service's default; never set a global `PORT` in `.env`.

## Local environment (founder's Mac)

- Postgres 17 runs as the Homebrew service `postgresql@17` on **127.0.0.1:5439** (data in `/opt/homebrew/var/postgresql@17`, log `/opt/homebrew/var/log/postgresql@17.log`); `brew services start postgresql@17` if it is down. Port 5432 belongs to an unrelated Postgres 14 (too old: the schema needs 15+). `backend/.env` has `DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/dos`; `psql` lives in `/opt/homebrew/opt/postgresql@17/bin`; the founder views data in DBeaver/pgAdmin with the same connection. Role `dos` is the owner (CREATEDB, CREATEROLE, BYPASSRLS — it runs migrations and seeds); `app_rw` and `app_worker` are created by migrations.
- No Docker on this machine; `backend/infra/docker-compose.yml` and the `Dockerfile` are for CI/other machines.
- **Mobile toolchains are installed.** iOS: **Xcode 16.2** (installed 2026-09-06 from the developer download; the App Store's
  Xcode 26 needs macOS 26 and this Mac runs 14.6.1), iOS 18.0 simulator runtime, so React Native 0.86 dev builds
  (`expo run:ios`) work as well as Expo Go. `xcode-select -p` already points at `/Applications/Xcode.app`; if it ever points
  at the Command Line Tools, only the founder can change it back (`sudo xcode-select -s`).
  **Never open the iOS simulator panel in the Claude app** (founder, 2026-09-06): drive the simulator headlessly with
  `xcrun simctl` and take screenshots with `xcrun simctl io booted screenshot <file>`.
  Android: the SDK lives in `~/Library/Android/sdk` (command-line tools only, no Android Studio project needed), the JDK is
  **Homebrew's `openjdk@21`** (installed 2026-09-07 by the retailer gate), and the virtual device is `Pixel_7_API_36`
  (API 36 arm64) — **boot it with `-memory 3072`**: at the default 2 GB it thrashes on a dev bundle this size and throws
  ANR dialogs that swallow `adb` input (delivery gate, 2026-09-07). **Do NOT use Android Studio's bundled jbr any more**: it is
  now JDK 25, whose "WARNING: A restricted method in java.lang.System has been called" is written to stderr, and AGP's
  `GeneratePrefabPackages.reportErrors` turns any stderr line into a build failure — `:react-native-worklets:configureCMakeDebug`
  then fails on a clean tree with that warning as its entire message (retailer gate, 2026-09-07). Any shell that builds or runs
  Android needs:
  `export ANDROID_HOME=$HOME/Library/Android/sdk; export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home;
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$JAVA_HOME/bin:$PATH"`. Boot it with
  `emulator -avd Pixel_7_API_36 -memory 3072 -no-snapshot-save` and check with `adb devices`.
- Tests that need a database (`describeDb` in specs, `backend/libs/database/src/rls.test.ts`) run whenever `DATABASE_URL` resolves, which with `.env` present is always; they create their own fixtures with a unique run suffix, so the dev database accumulates test rows (harmless; `pnpm db:seed` data is separate).
- Sign-in everywhere is username + password against the auth service on :3000 (demo users from `pnpm db:seed`, e.g. `sunil.tarsun` / `Dos@1234`; `docs/18-build-log.md` lists one per role). Omit `tenantId` on login unless the user belongs to more than one distributor.

## Layout and the rules that keep it honest

```
backend/                      pnpm workspace: package.json, pnpm-workspace.yaml (catalog), turbo.json, .env
backend/libs/domain           pure TS, ZERO runtime deps: Money (paise), Qty (pieces + case size), GST split + GSTIN
                              checksum, UUIDv7, IST business dates/FY, state machines, pricing engine priceOrder().
backend/libs/contracts        Zod 4 schemas + the oRPC contract (one file per module + contract.ts) + permissions.ts
                              (roles per procedure). Wire shapes live ONLY here. The frontend links this package.
backend/libs/config           tsconfig / eslint / vitest presets for the backend (extend, don't copy).
backend/libs/database         @dos/db — the ONLY place SQL schema lives: Drizzle schema (one file per module), RLS
                              policies as code, migrations, seed + seed-demo, withTenant(), bootstrapTenant(), loadDotenv().
backend/libs/core             @dos/core — library, no main.ts. src/platform/ (db provider, tenant context, authz,
                              idempotency, numbering, OwnsReply), src/modules/<name>/ (one bounded context, only
                              index.ts importable, ALL module specs here), src/service/ (defineService, ServiceModule,
                              docs, bootstrap), src/docs/ (README renderer), src/testing/app.ts (spec harness).
backend/<role>-service        auth, owner, manager, sales, warehouse, delivery, retailer. ~20 lines each: src/service.ts
                              (roles, modules, contract keys, default port), src/main.ts, src/service.spec.ts, generated
                              README.md, optional .env. Each runs alone: `pnpm --filter @dos/<role>-service dev`.
backend/worker                pg-boss consumers: outbox relay + handler registry, retention, PDF render (`@dos/core/documents`),
                              docint four-step pipeline (jobs/docint.ts); later imports/rollups/forecasts.
backend/tools                 generate-readmes.mts, auth-keygen.mts, smoke-endpoints.mts (`pnpm smoke`).   backend/infra: Dockerfile, compose.
frontend/                     pnpm workspace (hoisted linker for Expo): package.json, pnpm-workspace.yaml, turbo.json
frontend/libs/config          tsconfig / eslint presets for the frontend (kept equal in versions to the backend's).
frontend/libs/{ui,api-client,offline}   @dos/ui = A Ledger design system: ONE component contract (src/types.ts) implemented twice
                              (src/web = React DOM, src/native = React Native) and resolved per platform by Metro (index.web.ts /
                              index.native.ts) + layout primitives + AppShell + platform modules; typed oRPC client with session,
                              refresh, cache hooks; our own delta-sync client (SQLite) — no PowerSync, no TanStack Query.
frontend/libs/app-template    the skeleton every app is generated from (expo-router app/, metro/babel/tsconfig/eslint, the font sync
                              script, `new-app.mjs`). Change the shape of an app here, not in seven places.
frontend/<role>-app           owner, manager, sales, warehouse, delivery, retailer, admin: SEVEN UNIVERSAL Expo apps (expo-router),
                              website + Android + iOS from one codebase each. Screens import ONLY @dos/ui (never react-native or
                              react-dom; ESLint enforces). `pnpm --filter @dos/<role>-app web` serves the browser build; each app
                              carries its own EXPO_PUBLIC_API_URL, strings namespace and navigation data.
docs/                         22 source of truth · 18 build log · 23 screen inventory + API gaps · 24 Confluence audit · 25 phase-2
                              enhancements · 26 environments, config and least-cost deployment · 27 offline sync client design (binding for @dos/offline) · plans/ (one brief per module + 00-coordination) · confluence/ (sources of the founder's
                              Confluence space, README maps page ids; docs/22 wins) · design/ (UX-00 design system on layout A Ledger,
                              layout-options.html) · adr/, domain/, research/, blueprint 00–21. docs/08 §0 is the universal-app architecture;
                              docs/27 is binding for the offline client.
```

- Backend modules talk only through exported application services or outbox events, never another module's tables (`eslint-plugin-boundaries` enforces the `index.ts` entry point). Cross-module FKs in the schema point only downstream: tenancy → platform/identity → catalog → tenant-catalog → retailers → pricing → inventory → orders → procurement → warehouse → billing → receivables → delivery → docint → claims → notifications → reporting → integrations → incentives; an upstream reference is a plain `text` id with a comment.
- `backend/libs/domain` must stay dependency-free so it bundles into Expo unchanged.
- Every mutating contract procedure extends `MutationBase` (`idempotencyKey`) and carries the client-generated UUIDv7 `id`; GET inputs use `QueryBoolSchema`/`QueryIntSchema` (query strings arrive as strings).

## Architecture facts you cannot infer from one file

- **Tenancy (ADR 0002).** Shared schema, `tenant_id` on every tenant table, RLS enabled + FORCE (hand-written migration). All tenant data access goes through `withTenant(db, ctx, fn)` (`backend/libs/database/src/client.ts`): a transaction that runs `SET LOCAL ROLE app_rw` (so even the owner connection obeys RLS) and sets `app.tenant_id`, `app.actor_id`, `app.actor_role`; policies read those settings. Cross-tenant work (auth sign-in before a tenant is known, worker jobs) uses `withSystem(db, fn)` → role `app_worker` (BYPASSRLS, `actor_role = system`). Pool size is `DATABASE_POOL_MAX` (default 10, specs set 3): keep `instances × DATABASE_POOL_MAX` under Postgres `max_connections` (100 locally) or parallel specs starve and time out. In the api, `TenantGuard` puts the context in `AsyncLocalStorage` (`src/platform/tenant-context.ts`); `currentTenant()` throws outside a guarded request; `/health` is unguarded.
- **Policy helpers** (`backend/libs/database/src/schema/columns.ts`): `tenantPolicy` (any member), `tenantRolePolicy(name, BACK_OFFICE_ROLES)` (owner/manager/accountant/system — every table carrying purchase cost), `tenantOrOwnRetailerPolicy` + `staffWritePolicy` (retailer role reads only rows linked to it via the denormalised `retailer_links.user_id`), `globalCuratedPolicies` (global tables: read all, write curator/system). Never write a policy that joins `retailer_identities` from a tenant table: Postgres reports infinite recursion (42P17).
- **Hand-written migrations.** drizzle-kit generates `NNNN_<name>.sql`; roles, grants, FORCE RLS, triggers (append-only ledgers, journal balance at commit, issued-invoice immutability, load-sheet approval, numbering-series lock) and views (`sellable_stock`, security_invoker → Postgres 15+) live in the hand-written sibling which must also be appended to `migrations/meta/_journal.json`. Policies ARE expressible in Drizzle, so policy replacements land in the GENERATED file (never hand-write them twice); the hand-written file ends with a DO block that fails the migration if any touched table lacks FORCE RLS or still carries a `FOR ALL` policy. Migration numbers in briefs are relative order: always take the next free index from `_journal.json`. New table → add its FORCE line. `CREATE ROLE` is wrapped in `DO … IF NOT EXISTS` (roles are cluster-wide). Migrations are expand-only from 0004 onward (0004 auth, 0006/0007 receivables, 0008/0009 billing …); each module adds a drizzle-generated expand migration plus a hand-written guarantees sibling (FORCE RLS, grants, triggers, policies), and `pnpm db:generate` may prompt interactively on policy renames. SQL functions used by triggers are `SECURITY DEFINER SET search_path = public, pg_temp` because FORCE RLS otherwise hides rows from the check itself (0007 fixed a silent unbalanced-journal hole this way).
- **DB guarantee tests.** `backend/libs/database/src/rls.test.ts` is the executable form of the ADRs (cost invisible to salesperson, tenant isolation, retailer sees only own orders and cannot touch credit, ledgers append-only + idempotent, journals balance). Extend it when adding a role-restricted table.
- **Global vs tenant data.** Manufacturers/products/variants are global and curated; a distributor may insert `proposed` ones and use them immediately. Retailers, prices, orders, ledgers are per tenant. A user is global (phone) with memberships per tenant. Purchase cost lives in `tenant_product_costs` (back-office RLS) and never in anything a salesperson/delivery/retailer role can read — a database guarantee plus CI tests.
- **Ledgers.** `stock_ledger` and `journal_lines` are append-only (triggers), balances derived (`stock_balances` updated UPDATE-first in the same transaction), `UNIQUE(tenant_id, idempotency_key)`. An issued invoice is immutable except its derived payment state; corrections are credit notes; an invoice cancelled before dispatch keeps its number with `state = cancelled`.
- **Aggregates and states.** Sales Order is the primary aggregate; invoice is issued at pack. State machines in `backend/libs/domain/src/state-machines/` (order, trip/stop, invoice); use `machine.next()`, never set a state column by hand.
- **Money, quantities, dates.** Integer paise (`Paise`), integer pieces (`Pieces`), basis points; `allocate()` spreads header amounts to the paisa. Sell-side case size = `tenant_products.case_size_override` else `product_variants.default_case_size`; buy-side = `supplier_pack_configs`; lots carry their own `case_size`. Business dates and FY are IST (`businessDate()`, `financialYear()` in `backend/libs/domain/src/calendar.ts`).
- **Pricing (ADR 0008 + docs/17).** `priceOrder()` in `backend/libs/domain/src/pricing/schemes.ts` is the only engine: tier price → retailer override (`final` blocks schemes) → schemes (stacked in `priority, id` order, percentage rules compounding on the running net, exclusive scheme applies alone, order-level rules allocated by largest remainder) → approved bargain → cash discount reported, not deducted. Every order/invoice line stores `applied_rules`. The api's `pricing.quote` feeds it from the DB.
- **Offline sync (ADR 0007).** `POST /sync/upload` (`modules/sync`) NEVER answers 4xx: rejections are 2xx + `sync_errors`; outcomes are durable in `sync_ops`; modules register per-table handlers in `SyncRegistry` on `onModuleInit`; `SyncRejection` = business error. GPS points bypass the queue via `/gps/points` (not built yet).
- **Inbound invoices (`modules/docint`, built).** "Zero manual entry" = zero typing except the blind gate count: QR/IRN verify → optional structured pull → LLM vision (`extractions.service.ts`; engine is pluggable and deterministic under test, so specs and `pnpm smoke` never call a network) → validators → SKU match → human review → GRN commit (`procurement.grns.post` writes lots, `grn` ledger rows and costs). The worker runs the four steps off the `docint.document.submitted` outbox event. Brand-DMS invoices (Too Yumm on FieldAssist) are captured before loading and committed as `source = brand_dms_import`; never a second legal invoice.
- **Services (docs/19).** A service is `defineService({ name, title, defaultPort, roles, modules, contractKeys })`; `runService()` mounts oRPC, `DbModule`, `ServiceModule.forService` (provides `SERVICE_INFO`, serves `/swagger`, `/docs` + `/docs/openapi.json` from the contract subset with `x-roles` and real examples built from demo rows in `src/service/examples.ts`) and `HealthModule`, then the listed modules. CORS comes from `corsOptions()` (`CORS_ORIGINS`; any localhost origin in non-prod). `TenantGuard` injects `SERVICE_INFO` when present and answers 403 for roles the service does not serve, before any business logic. Services are stateless: any number of instances may run behind a load balancer.
- **READMEs are generated.** `backend/*-service/README.md` and each app README's endpoint table (prettier-ignored) come from `backend/tools/generate-readmes.mts` via `@dos/core`'s `renderServiceReadme` (Zod sampler in `src/docs/sample.ts`, field-name hints for realistic paise/phone/GSTIN examples). After any contract change run `pnpm docs:readme`; never edit those files by hand.
- **API style.** Contract-first oRPC: declare in `backend/libs/contracts/src/<module>.ts`, wire in `contract.ts`, implement with `@Implement(contract.x.y)` + `implement(...).handler(...)`. Every `@Implement` method takes `@OwnsReply() _reply: unknown` (oRPC writes the Fastify reply itself; without it Nest replies twice). Services: `requireRole(...)` → `requireDb(this.db)` → `withTenant(...)` → `idempotent(tx, key, input, fn)` for mutations. Specs use `src/testing/app.ts`.
- **Decorator metadata.** esbuild-based runners (tsx, vitest's default transform) never emit `design:paramtypes`, so Nest DI silently injects `undefined`. Core and the services run dev via `@swc-node/register` and tests via `unplugin-swc`; tsx is fine for decorator-free scripts (database migrate/seed, worker).
- **Documents and files.** `@dos/core/documents` renders invoice / credit note / challan / receipt PDFs (own dependency-free renderer, white-labelled from `tenant_settings` branding keys) in the worker job `documents.pdf.render`, stores them under `tenant/{tenantId}/documents/…` and exposes `pdfObjectKey`; `modules/files` issues signed upload/read URLs over the object-storage platform with a per-domain role check. Never link a raw object key to a client.
- **Roles beyond the seven.** `platform_admin` (module 13) is a global actor with no membership, accepted only by `admin-service`; support access to a tenant is a time-boxed, owner-approved, audited grant. Accountant = money desk + reads (no prices, schemes, credit limits, approvals, settings). Manager approves load-out from the manager app; the warehouse device waits for it.
- **Universal apps (decided 2026-09-06, docs/08 §0).** Every app is one Expo codebase (expo-router) for web + Android + iOS. A screen imports ONLY `@dos/ui` and never `react-native` or `react-dom` — ESLint fails the build otherwise — and Metro picks the renderer through the package's own entry points (`src/index.web.ts` → `./web`, a real DOM with HTML tables and print; `src/index.native.ts` → `./native`). The layout vocabulary a screen may use is fixed: `Screen`, `Box`, `Stack`, `Row`, `Scroll`, `List`, `Pressable`, `Img`, `Link`, `Txt`. `AppShell` renders the desk rail at ≥ 1024 px and the phone tabs below, from the same navigation data, so the shell follows the VIEWPORT, not the app. Anything genuinely platform-specific lives in `@dos/ui/platform` as a `.web.ts` / `.native.ts` pair behind one signature (storage, documents/print, camera, location, files, haptics, share, crypto). The Expo SDK dictates the react / react-native versions in the frontend catalog; never pin those by hand. New app: `pnpm --filter @dos/app-template new <role> <port>`.
- **Frontend data flow.** `@dos/api-client` is the only caller of the backend: a typed oRPC client over `@dos/contracts` with the access token in memory, the refresh token in `platform.storage`, one transparent refresh per 401, a 20 s deadline on every request, typed errors, and a UUIDv7 `id` + `idempotencyKey` per mutation keyed on the INPUT (a different payload starts a new intent, the same payload keeps its key). Its React layer gives `<ApiProvider>`, `useSession()`, `useQuery()` and `useMutation()` — there is no TanStack Query and no Zustand. `@dos/offline` (docs/27) is the device half for the field apps: SQLite tables built from `sync.manifest`, a cursor pull that applies tombstones before rows, an outbox that replays FIFO with the original `opId`, LWW with the server's veto, and a status object that `<ConnectionStrip>` renders honestly (including "not saved on this browser" when it falls back to the memory adapter). Screens never write SQL and never call `sync.*` directly.
- **Permissions on the device.** A route declares the contract procedures it needs; the shell hides what `PERMISSIONS` (the same matrix the server enforces, linked from `@dos/contracts`) refuses for the signed-in role. The server still answers 403 — the app never carries a second permission list.

## Things that look wrong but are intentional

- **Auth is ours, not a vendor's.** `TenantGuard` verifies the EdDSA access token (15 min; claims `sub`, `tid`, `role`, `sid`, `did`) synchronously with `node:crypto` (an `await` before `AsyncLocalStorage.enterWith` makes the context invisible to handlers), then checks `PERMISSIONS` in `backend/libs/contracts/src/permissions.ts` by `${METHOD} ${pattern}` and fails closed (500) on any route the matrix does not declare. Refresh tokens rotate per device (`auth_sessions`, previous hash kept for reuse detection); `auth_events` is append-only. Keys come from `AUTH_JWT_PRIVATE_KEY`/`AUTH_JWT_PUBLIC_KEY` (`pnpm auth:keygen`) and are ephemeral under `NODE_ENV=test`. Every service spec runs `describePermissionMatrix` (every endpoint × every role). OTP is a later enhancement on top, not a replacement.
- The retailers `linkIdentity` procedure is back-office only: a salesperson must not learn whether a phone exists in another distributor's network (docs/17 item 27).
- Expo apps (when created) pin their own `react`/`react-native` from the template; the frontend catalog's React versions are for the web builds.
- `Dockerfile` has not been built here (no Docker); CI is the first place it runs.
- The `describeDb` specs run against the dev database by default; that is deliberate (local-first), not a leak.
- `frontend/libs/config` duplicates ~60 lines of the backend presets on purpose: the two workspaces install separately, and a `link:` to the backend config would make the frontend lint with the backend's copy of typescript-eslint.
