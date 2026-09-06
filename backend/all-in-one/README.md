# @dos/all-in-one

**All eight services, and optionally the worker, in ONE process** (founder decision 2026-09-05, docs/22 §8 and docs/26 §7).

Stage 0 of the cost plan is the first run at ₹0: one small VM carrying the whole product. Eight Node processes cost
over a gigabyte before a single order is placed; this one mounts every service behind a path prefix on a single port.

```bash
pnpm --filter @dos/all-in-one dev     # :3100
DOS_MODE=all WORKER_INLINE=1 pnpm --filter @dos/all-in-one start
```

| Prefix       | Service           | Roles                 |
| ------------ | ----------------- | --------------------- |
| `/auth`      | auth-service      | every membership role |
| `/owner`     | owner-service     | owner                 |
| `/manager`   | manager-service   | manager, accountant   |
| `/sales`     | sales-service     | salesperson           |
| `/warehouse` | warehouse-service | warehouse             |
| `/delivery`  | delivery-service  | delivery              |
| `/retailer`  | retailer-service  | retailer              |
| `/admin`     | admin-service     | platform_admin        |

Each prefix is the real service — same `SERVICE_INFO`, same `TenantGuard` role gate, its own `/health`, `/docs`,
`/swagger` — built from the same `ServiceDefinition` its own package exports (`libs/core/src/service/definitions.ts`).
A role refused on :3003 is refused at `/sales` here, by the same guard reading the same definition. The root
`GET /health` lists what the process is carrying.

- Port: `ALL_IN_ONE_PORT` (default 3100).
- Worker in-process: `DOS_MODE=all` **and** `WORKER_INLINE=1`.
- Pools: each service gets a small pool unless `DATABASE_POOL_MAX` is set (eight pools share one Postgres).
- Apps point at a prefix: `VITE_API_URL=http://host:3100/owner`, `EXPO_PUBLIC_API_URL=http://host:3100/sales`, …
  (docs/26 §7). Nothing else in an app changes between this mode and one process per service.

Proved by `pnpm smoke --base http://127.0.0.1:3100` (every endpoint of every service, through the prefixes) and by
`libs/core/src/service/all-in-one.spec.ts`.
