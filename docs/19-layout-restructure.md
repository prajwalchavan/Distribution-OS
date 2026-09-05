# 19 · Repository layout (two independent workspaces)

Founder decisions, 2026-09-04: the repo root holds only `backend/`, `frontend/`, `docs/` and `CLAUDE.md` (plus dotfiles);
every service and every app is its own package that runs alone; one database; one app per role, six apps; every
service has functional endpoints with an API page; every service and app has a README listing every endpoint with a
sample request, a success response and a failure response.

## Tree

```
Distribution OS/
├─ CLAUDE.md  README.md  docs/            .github/ci.yml  .claude/launch.json  .editorconfig  .prettierrc.json
├─ backend/                               ← pnpm workspace #1 (package.json, pnpm-workspace.yaml, lockfile, turbo.json, .env)
│  ├─ libs/domain                          pure TypeScript, zero deps (money, quantities, GST, dates, state machines, pricing)
│  ├─ libs/contracts                       Zod + oRPC contract, one file per module, permissions.ts (roles per procedure)
│  ├─ libs/config                          tsconfig / eslint / vitest presets
│  ├─ libs/database                        Drizzle schema + RLS policies, migrations, seed, seed-demo, withTenant()
│  ├─ libs/core                            NestJS modules (one per bounded context), platform, service framework, README renderer
│  ├─ auth-service        :3000            username + password sign-in, refresh, me, switch distributor, public keys
│  ├─ owner-service       :3001  owner
│  ├─ manager-service     :3002  manager, accountant
│  ├─ sales-service       :3003  salesperson
│  ├─ warehouse-service   :3004  warehouse
│  ├─ delivery-service    :3005  delivery
│  ├─ retailer-service    :3006  retailer
│  ├─ worker                               pg-boss consumers (outbox relay, retention, later docint/imports/rollups)
│  ├─ tools/                               generate-readmes.mts, auth-keygen.mts
│  └─ infra/                               Dockerfile (one image per service), docker-compose (CI database), hosting notes
└─ frontend/                              ← pnpm workspace #2 (hoisted node_modules for Expo)
   ├─ libs/config                          tsconfig / eslint presets (same versions as backend)
   ├─ libs/ui  libs/api-client  libs/offline
   ├─ owner-app        → :3001             Vite web today; Expo (web + Android + iOS) when the frontend phase starts
   ├─ manager-app      → :3002             Expo
   ├─ sales-app        → :3003             Expo, offline-first (PowerSync)
   ├─ warehouse-app    → :3004             Expo
   ├─ delivery-app     → :3005             Expo, trip-scoped GPS
   └─ retailer-app     → :3006             Expo, online-first
```

## Why two workspaces and a `libs/` folder rather than a copy per service

- A service is one process on one port with its own `package.json`, `.env` (optional; `backend/.env` is the shared default),
  README, tests and Docker image. It runs alone: `cd backend && pnpm --filter @dos/owner-service dev`.
- The business modules live once, in `backend/libs/core`, and each service composes the subset it serves
  (`src/service.ts`: roles, modules, contract keys, port). Copying modules into each service would mean fixing every bug
  six times; linking them means one fix, six deployables.
- `pnpm install` in `backend/` installs everything the backend needs once (pnpm links, it does not copy); `pnpm install`
  in `frontend/` does the same for the apps. The two sides do not share a lockfile or a `node_modules`.
- The frontend needs the contract (routes, request/response shapes) and the domain helpers. It links them from
  `backend/libs` with `"@dos/contracts": "link:../../backend/libs/contracts"` and reads their `dist/`, so build those two
  packages in backend before frontend typecheck/build (CI does).
- Every service is stateless behind a load balancer (docs/20). The auth service issues signed tokens; the others verify
  the signature with the public key and never call auth per request.

## Ports and roles

| Service           | Port | Roles served                | App           |
| ----------------- | ---- | --------------------------- | ------------- |
| auth-service      | 3000 | public + any signed-in user | all apps      |
| owner-service     | 3001 | owner                       | owner-app     |
| manager-service   | 3002 | manager, accountant         | manager-app   |
| sales-service     | 3003 | salesperson                 | sales-app     |
| warehouse-service | 3004 | warehouse                   | warehouse-app |
| delivery-service  | 3005 | delivery                    | delivery-app  |
| retailer-service  | 3006 | retailer                    | retailer-app  |

`<NAME>_SERVICE_PORT` overrides a port. A role that a service does not serve receives 403 from `TenantGuard` before any
business logic; within a service, the permission matrix in `backend/libs/contracts/src/permissions.ts` decides per endpoint.

## Status

- 2026-09-04: split into two workspaces; manager-service added; ports renumbered; legacy Vite console became
  `frontend/owner-app`; Expo template shells removed (the apps are created fresh in the frontend phase); READMEs
  regenerated; both workspaces green (backend 44 tasks, frontend 9).
- Next: auth-service + permission matrix (docs/18 RESUME HERE), then the remaining backend modules, then the apps.
