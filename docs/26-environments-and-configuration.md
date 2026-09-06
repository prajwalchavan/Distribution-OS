# Environments, configuration and the least-cost deployment

Written 2026-09-05 for a solo founder with no funding. Constraint from the founder: least cost, real cloud (AWS), nothing that depends on a local machine or a small regional cloud. Numbers are list prices in USD/month, Mumbai (ap-south-1), to be re-checked at sign-up. docs/11 keeps the target shape at scale (RDS, Fargate, ALB); this file is the way in.

## 1. Local configuration (today, done)

| Item | Value |
| --- | --- |
| Postgres | 17, Homebrew `postgresql@17`, `127.0.0.1:5439`, db `dos`, user `dos`, password `dos` (`brew services start postgresql@17`) |
| DBeaver / pgAdmin | new PostgreSQL connection: host `127.0.0.1`, port `5439`, database `dos`, user `dos`, password `dos` |
| Node / pnpm | Node 24 via fnm (`fnm use` in `backend/` and `frontend/`), pnpm 11 (pinned in each `package.json`) |
| Backend env | `backend/.env` (copy of `backend/.env.example`): `DATABASE_URL`, `AUTH_JWT_PRIVATE_KEY` + `AUTH_JWT_PUBLIC_KEY` (`pnpm auth:keygen`), `CORS_ORIGINS` (empty = any localhost), `OBJECT_STORAGE_DRIVER=local`, `DOCINT_ENGINE=stub` |
| Optional keys | `ANTHROPIC_API_KEY` + `DOCINT_ENGINE=anthropic` for real invoice vision and the AI module; everything else has a stub driver |
| Frontend env | `VITE_API_URL` (owner web) / `EXPO_PUBLIC_API_URL` (Expo apps), one per app, pointing at that app's service port |
| Simulators | Xcode (iOS) and Android Studio (Android) for Expo; a dev build (`expo run:*`), not Expo Go, because camera, GPS background task and SQLite need native modules |
| Demo data | `pnpm db:migrate && pnpm db:seed`; sign-in ids in docs/18 |

## 2. Configuration reference (every variable the services and worker read)

| Group | Variables | Notes |
| --- | --- | --- |
| Runtime | `NODE_ENV`, `<NAME>_SERVICE_PORT` | never a global `PORT` |
| Database | `DATABASE_URL`, `DATABASE_REPLICA_URL`, `APP_DB_ROLE`, `DATABASE_POOL_MAX` | replica empty until a replica exists; pool × instances < `max_connections` |
| Auth | `AUTH_JWT_PRIVATE_KEY`, `AUTH_JWT_PUBLIC_KEY`, `AUTH_ACCESS_TTL_SECONDS`, `AUTH_REFRESH_TTL_DAYS` | one key pair per environment, never shared; private key only on auth-service |
| Web | `CORS_ORIGINS` | must be set outside development |
| Storage | `OBJECT_STORAGE_DRIVER` (`local`/`s3`), `OBJECT_STORAGE_DIR`, `OBJECT_STORAGE_URL_TTL_SECONDS`, `OBJECT_STORAGE_SIGNING_SECRET`, `OBJECT_STORAGE_PUBLIC_URL`, `OBJECT_STORAGE_S3_BUCKET`, `OBJECT_STORAGE_S3_REGION`, `OBJECT_STORAGE_S3_ENDPOINT`, `OBJECT_STORAGE_S3_*` credentials | `s3` in test and prod, one bucket per environment |
| Docint / AI | `ANTHROPIC_API_KEY`, `DOCINT_ENGINE`, `DOCINT_MODEL`, `DOCINT_ESCALATION_MODEL`, `DOCINT_INLINE_JOBS`, `DOCINT_AUTO_ESCALATE`, `DOCINT_MAX_ATTEMPTS`, `DOCINT_LOCK_TTL_SECONDS`, `DOCINT_IRP_KEYS`, `DOCINT_USD_INR`, `DOCINT_EXTRACT_CONCURRENCY` | `stub` engine wherever the key is empty |
| Worker | `OUTBOX_MAX_ATTEMPTS` | |
| Later (added by their modules) | WhatsApp Cloud API token + phone id, SMS (OTP) key, maps key, GSP credentials, Sentry DSN | each has a stub driver until the key arrives |

Secrets never live in the repo: locally in `.env` (git-ignored), in the cloud in AWS SSM Parameter Store (SecureString, free) injected at container start, in CI as GitHub environment secrets.

## 3. Accounts to open (one time)

| Account | Cost | Needed when |
| --- | --- | --- |
| AWS (region ap-south-1) | free plan credits for new accounts (up to ~$200, 6 months; verify at sign-up); apply to AWS Activate Founders (~$1,000 credits, no investor needed) | before the test environment |
| Domain (.in or .com) + Route 53 hosted zone | ~₹1,000/yr + $0.50/mo | with the test environment |
| GitHub (repo exists) | free (2,000 Actions minutes/mo on private repos) | now |
| Expo account (EAS) | free tier; local builds are unlimited and free | first Android build |
| Google Play Console | $25 once | pilot Android release |
| Apple Developer | $99/yr | only when an iPhone user appears (pilot is Android first) |
| Anthropic API | pay per use (~$5/mo at pilot volume) | docint + AI module go live |
| Meta WhatsApp Cloud API (direct, no BSP) | 1,000 free service conversations/mo; utility templates ~₹0.12 each | notifications module goes live |
| SMS for OTP (MSG91 or AWS SNS) + DLT registration | DLT ~₹5,900 once; ~₹0.20/SMS | OTP sign-in (after pilot; password sign-in is built) |
| Google Maps Platform | native map SDKs free; no geocoding needed (GPS pins) | delivery app |
| Sentry | free tier (5k errors/mo) | test environment |
| GSP for e-invoice / e-way bill (ClearTax, MasterGST …) | ~₹5–15k/yr | post-pilot, only for tenants above the e-invoice threshold |

## 4. Cost stages (founder, 2026-09-05)

| Stage | Who is on it | Monthly spend | What runs |
| --- | --- | --- | --- |
| **0 — first run at ₹0** | founder + Tarsun pilot | $0 (AWS new-account credits pay for the one VM for ~6 months; S3 + CloudFront always-free; EAS free / local builds; pilot Android app sideloaded as an APK, no store fee; domain is the only cash item, ~₹1,000/yr, or a free `sslip.io` name until then) | one Lightsail VM, all-in-one mode, Postgres in a container, stub drivers except Anthropic (pay per page, a few rupees) |
| **1 — 1 to 10 clients** | paying distributors | ~$36–45 (test + prod VMs, S3, DNS, WhatsApp/AI usage) | same shape, prod VM separated from test, nightly dumps, Play Store |
| **2 — hundreds to thousands** | scale | docs/11 table (~$500 at 10 → ~$2,900 at 100 tenants) | per-service containers on Fargate, RDS Multi-AZ + replica, ALB, SQS if pg-boss saturates |

The architecture already carries stage 2: stateless services behind any load balancer, one service per app (split from all-in-one by changing the command), shared-schema RLS multi-tenancy, `DATABASE_REPLICA_URL` for reports, S3-backed object storage, migrations expand-only, per-tenant ids on every row (docs/20 scale rules). Nothing in stage 0 has to be rewritten to reach stage 2; only the infrastructure under it changes.

## 5. Environments (least-cost plan)

| | dev | test | prod |
| --- | --- | --- | --- |
| Where | founder's Mac (free) | AWS Lightsail Mumbai, 2 GB / 2 vCPU / 60 GB (~$12/mo) | AWS Lightsail Mumbai, 4 GB / 2 vCPU / 80 GB (~$24/mo); grows to docs/11 shape with revenue |
| Postgres | Homebrew 17 :5439 | Postgres 17 container on the same VM | Postgres 17 container on the VM; nightly `pg_dump` to S3 (versioned, Object Lock); move to RDS at ~10 paying tenants |
| Services | `pnpm dev` per service | one Docker image, all-in-one mode (see §6) behind Caddy with Let's Encrypt | same image, all-in-one mode; split into per-service containers when load asks |
| Worker | `pnpm --filter @dos/worker dev` | same image, `worker` command | same |
| Object storage | local driver | S3 bucket `dos-test` | S3 bucket `dos-prod` |
| Web apps (owner, retailer web) | Vite dev server | S3 + CloudFront (always-free 1 TB/mo) | S3 + CloudFront |
| Mobile apps | dev build on simulator / phone | EAS `preview` profile (internal APK link) | EAS `production`, Play Store; App Store later |
| Data | `pnpm db:seed` demo | seed + anonymised pilot data | Tarsun and later tenants |
| External APIs | stubs | sandbox keys | live keys |
| Domains | localhost | `api-test.<domain>`, `app-test.<domain>` | `api.<domain>`, `app.<domain>` |
| TLS | none | Caddy automatic | Caddy automatic; ACM on CloudFront |
| Deploy | — | GitHub Actions on push to `main`: build image, `pnpm db:migrate`, restart | GitHub Actions on a tag; migrations expand-only, so old and new can overlap |
| Monitoring | — | Sentry free, `/health` pinged by the worker cron + a free uptime checker | same + CloudWatch free-tier alarms (CPU, disk) |

Monthly during pilot: **~$36 compute + ~$2 storage/DNS + usage-based AI/WhatsApp (~$5–10) ≈ $45 (~₹3,800)**. Before the pilot goes live only `test` exists (~$15). AWS credits cover the first months.

## 6. Build ourselves vs buy

| Need | Decision | Why |
| --- | --- | --- |
| Auth, sessions, permissions | **built** (EdDSA JWT, refresh rotation, matrix) | done; OTP delivery is the only bought part, later |
| PDF documents | **built** (own renderer) | done |
| Job queue | **built** on Postgres (pg-boss) | no Redis, no queue service |
| Object storage abstraction | **built**; S3 driver is small | bytes on S3 (cheapest durable store) |
| Offline sync | **build our own delta sync** on SQLite (`/sync/upload` is ours already; download = per-table pull by `(tenant_id, updated_at)`, indexes exist since 0012) | replaces PowerSync ($0 → $49+/mo and a hosted dependency); ~2 build days |
| Route sequencing, forecasting, reorder | **built** (module `ai`) | product features, no vendor |
| Maps | **free** native SDKs (Apple Maps / Google Maps SDK) + GPS pins; no geocoding, no routing API | our own sequencing |
| Reporting, analytics | **built** (module `reporting`) | |
| Notifications | **built** on WhatsApp Cloud API direct + Expo push (free) | BSP markup avoided |
| Invoice vision | **buy** Anthropic API per page | cannot self-build; QR/IRN path first keeps pages low |
| OTP SMS | **buy** later (MSG91/SNS) | regulated delivery; password sign-in until then |
| e-invoice / e-way bill | **buy** GSP post-pilot | NIC requires a GSP/ASP |
| App stores | **buy** (Play $25; Apple $99 when needed) | |
| Domain, DNS, TLS | domain bought; TLS free (Let's Encrypt / ACM) | |
| CI, error tracking, uptime | free tiers (GitHub Actions, Sentry, CloudWatch) | |
| Subscription billing for tenants | manual invoices at pilot; Razorpay (per-transaction) later | |

## 7. All-in-one deployment mode (BUILT 2026-09-06)

The eight services and the worker are composed from the same libraries, so one process can carry all of them. `backend/all-in-one` (`pnpm --filter @dos/all-in-one dev`, port `ALL_IN_ONE_PORT`, default **3100**) mounts every service behind a path prefix and, with `DOS_MODE=all WORKER_INLINE=1`, starts the pg-boss worker in the same process. Per-service containers stay the scale path (docs/20); the apps only change their base URL.

| Prefix | Service | Roles | | Prefix | Service | Roles |
| --- | --- | --- | --- | --- | --- | --- |
| `/auth` | auth-service | every membership role | | `/warehouse` | warehouse-service | warehouse |
| `/owner` | owner-service | owner | | `/delivery` | delivery-service | delivery |
| `/manager` | manager-service | manager, accountant | | `/retailer` | retailer-service | retailer |
| `/sales` | sales-service | salesperson | | `/admin` | admin-service | platform_admin |

**What is and is not shared.** Each prefix is the real service: the same `ServiceDefinition` its own package exports (they all live in `backend/libs/core/src/service/definitions.ts`, and `backend/<name>-service/src/service.ts` re-exports one — so the two deployment shapes cannot drift into serving different modules), its own `SERVICE_INFO`, its own `TenantGuard` role gate, its own `/health`, `/docs`, `/swagger` under its prefix. There is no combined router and no union of roles: an owner token is refused at `/sales` exactly as it is on :3003. `GET /health` at the root lists what the process is carrying. Mechanically, each Nest app initialises a Fastify instance that never listens, and one Node HTTP server in front strips the prefix and calls that instance's router — not a Fastify plugin tree, because a Nest app registers its routes long after a parent instance would have sealed its plugin scope.

**Memory (measured 2026-09-06, founder budget < 400 MB).** 377 MB RSS with all eight mounted, running from `dist/` on Node 24 (420 MB under the `@swc-node` dev transpiler, which holds the compiler in memory). Eight separate processes cost ~1.2 GB. The number is asserted in `libs/core/src/service/all-in-one.spec.ts` and recorded in docs/18.

**Pools.** Eight services on one Postgres: unless `DATABASE_POOL_MAX` is set, all-in-one mode gives each service `floor(32 / services)` connections so the total stays well inside the local `max_connections = 100` with the worker's pool on top.

**Frontend base URLs.** One environment variable per app, as always — only its value changes between the two shapes:

| App | Split (one service per port) | All-in-one (one port, prefixes) |
| --- | --- | --- |
| owner (Vite web) | `VITE_API_URL=http://localhost:3001` | `VITE_API_URL=https://api.example.in/owner` |
| manager / sales / warehouse / delivery / retailer (Expo) | `EXPO_PUBLIC_API_URL=http://localhost:300{2..6}` | `EXPO_PUBLIC_API_URL=https://api.example.in/{manager,sales,warehouse,delivery,retailer}` |
| every app's sign-in | `…_AUTH_URL=http://localhost:3000` | `…_AUTH_URL=https://api.example.in/auth` |

No app code changes: the client prefixes every route with its base URL already, and the routes under a prefix are the same routes the service serves on its own port. CORS is unchanged (`CORS_ORIGINS`), and there is exactly one origin to allow in this mode instead of eight.

**Proof.** `pnpm smoke --base http://127.0.0.1:3100` walks every endpoint of every service through the prefixes and must end at 0 BROKEN, the same as `pnpm smoke` against the eight ports. Both were green on 2026-09-06 (1588 calls each).

## 8. Founder confirmations

1. ~~dev stays on the Mac; cloud only for test and prod.~~ **Decided yes, 2026-09-05.**
2. ~~Postgres self-managed on the VM until ~10 paying tenants, then RDS.~~ **Decided yes, 2026-09-05.**
3. ~~Build the all-in-one mode (§6).~~ **Decided yes, 2026-09-05 ("for now, will scale later").**
4. ~~Own delta sync instead of PowerSync (docs/07 changes accordingly).~~ **Decided yes, 2026-09-05.**
5. ~~Android first for the pilot; Apple Developer only when needed.~~ **Decided yes, 2026-09-05 (Android first, then iOS).**
6. ~~Lightsail Mumbai as the starting compute; docs/11 shape (Fargate, ALB, RDS) only with revenue.~~ **Decided yes, 2026-09-05 ("light as much in the beginning, then scale").**

All six confirmed; this file is the deployment plan. docs/07 (PowerSync) and docs/11 (RDS/Fargate from day one) are superseded on those points.
