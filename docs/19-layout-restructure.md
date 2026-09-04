# Layout restructure: independent services and apps (founder decision, 2026-09-04)

## Target layout

```
Distribution OS/
├─ shared/                       used by BOTH sides (unchanged packages)
│  ├─ domain/      @dos/domain    money, GST, UUIDv7, IST dates, state machines, pricing engine
│  ├─ contracts/   @dos/contracts one API contract; each service exposes a subset
│  └─ config/      @dos/config    tsconfig / eslint / vitest presets
├─ backend-services/
│  ├─ database/    @dos/db        schema, migrations, seed, withTenant()  (ONE Postgres database)
│  ├─ core/        @dos/core      NestJS modules (catalog, retailers, pricing, inventory, procurement,
│  │                              orders, sync, …) + platform (guards, idempotency) + spec harness.
│  │                              A library: no main.ts. All module specs live here.
│  ├─ owner-service/      :3001   roles owner, manager, accountant  — every module + costs/reporting
│  ├─ sales-service/      :3002   roles salesperson (+owner/manager) — catalog, retailers, pricing, orders, sync
│  ├─ warehouse-service/  :3003   roles manager (+owner)            — inventory, procurement, orders(pick/pack), billing
│  ├─ delivery-service/   :3004   roles delivery (+owner/manager)   — delivery, orders(deliver), receivables(receipts), sync, gps
│  ├─ retailer-service/   :3005   role retailer                     — catalog(sellable), orders(own), invoices/receipts(own)
│  └─ worker/             —       pg-boss jobs (outbox relay, retention, PDFs)
└─ frontend-apps/                 five Expo apps (web + Android + iOS), each runs alone
   ├─ owner-app/     EXPO_PUBLIC_API_URL=http://localhost:3001
   ├─ sales-app/     …3002
   ├─ warehouse-app/ …3003
   ├─ delivery-app/  …3004
   ├─ retailer-app/  …3005
   └─ shared-ui/     @dos/ui + @dos/api-client + @dos/offline (components, typed client, PowerSync)
```

Each service: own `package.json`, `src/main.ts`, `src/app.module.ts` (composes modules from `@dos/core`), `SERVICE_ROLES` (which membership roles may call it — enforced by `TenantGuard`), `GET /health`, `GET /docs` (Scalar UI) + `GET /docs/openapi.json` generated from the service's contract subset, and a smoke spec. Ports are defaults; `PORT` overrides.

## Why one database (one schema, module-owned tables) and one core library

The five apps act on the same order, the same stock and the same bill. A rule such as "an issued invoice is immutable" or "reserve stock only on confirm" must live in exactly one place, so business modules are a library the five services compose; independence is at the process, port, deployment and test level. Scale is designed in now, not later (`docs/20-scale-rules.md`): every table keys on `tenant_id`, ledgers are partition-ready, reads go to replicas, services are stateless replicas. Splitting into one physical database per service stays possible because tables are module-owned and cross-module reads go through services.

## Migration steps (keep every test green at each step)

1. Backend: `git mv` packages into `backend-services/`; rename `@dos/api` → `@dos/core` (library exports `./modules/*`, `./platform`, `./testing`); create the five service packages + worker move; update `pnpm-workspace.yaml`, root scripts, turbo, `.claude/launch.json`, CI, CLAUDE.md, docs/16.
2. Frontend: create the five Expo apps from the existing `team`/`retailer` shells; port the console pages into `owner-app` (Expo web); move `frontend/packages/*` into `frontend-apps/shared-ui`; delete `frontend/`.
3. Demo data: extend to three distributors; per-app sign-in ids in the seed output.
