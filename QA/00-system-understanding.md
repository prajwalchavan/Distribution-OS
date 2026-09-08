# 00 — System understanding: architecture as implemented

Phase 0 artefact for the Distribution OS QA programme. Written from the code, not from the blueprint. Eight readers each documented one subsystem; this file merges their findings. Where the code and a document disagree, the code is recorded here and the disagreement is listed in §12.

This is an inspection record. It does not judge quality, propose fixes, or rank work. Every claim below is anchored to a file path exactly as the reader cited it.

---

## 1. What exists

### 1.1 Backend services

All eight services are defined in one place — `backend/libs/core/src/service/definitions.ts`. Each `backend/<name>-service/src/service.ts` is a one-line re-export of its definition. A service is `defineService({ name, title, defaultPort, roles, modules, contractKeys })`; `runService()` mounts oRPC, `DbModule`, `ServiceModule.forService` and `HealthModule`, then the listed modules.

| Service | Port | Run command | Roles served | Contract keys | Demo sign-in (Tarsun tenant) |
|---|---|---|---|---|---|
| auth | 3000 | `pnpm --filter @dos/auth-service dev` | owner, manager, accountant, salesperson, warehouse, delivery, retailer | health, auth | any account below |
| owner | 3001 | `pnpm --filter @dos/owner-service dev` | owner | 22 keys / 20 modules: health, tenancy, catalog, tenantCatalog, retailers, pricing, inventory, procurement, orders, receivables, billing, warehouse, sync, files, delivery, docint, integrations, claims, notifications, reporting, incentives, ai | `sunil.tarsun` |
| manager | 3002 | `pnpm --filter @dos/manager-service dev` | manager, accountant | identical 22-key list to owner | `vikas.kadam` (manager), `meena.joshi` (accountant) |
| sales | 3003 | `pnpm --filter @dos/sales-service dev` | salesperson | as owner minus `files`; receivables and billing read-only | `rahul.deshmukh`, `amit.pawar`, `pooja.shinde` |
| warehouse | 3004 | `pnpm --filter @dos/warehouse-service dev` | warehouse | as owner minus `receivables`, minus `pricing`, minus `claims`, minus `incentives` | `dinesh.patil`, `kavita.sawant` |
| delivery | 3005 | `pnpm --filter @dos/delivery-service dev` | delivery | health, tenancy, catalog, tenantCatalog, retailers, pricing, inventory, orders, receivables, billing, warehouse, sync, files, delivery, notifications, reporting, incentives, ai | `ganesh.more`, `raju.yadav`, `santosh.kamble`, `iqbal.shaikh` |
| retailer | 3006 | `pnpm --filter @dos/retailer-service dev` | retailer | health, tenancy, catalog, tenantCatalog, retailers, pricing, inventory, orders, receivables, billing, sync, files, delivery, notifications, ai | `ramesh.gupta`, `fatima.shaikh` |
| admin | 3007 | `pnpm --filter @dos/admin-service dev` | platform_admin only | health, admin (PlatformAdminModule) | `dos.admin` (platform login) |

Password for every seeded account, every role, all three tenants and the platform console: **`Dos@1234`** (`DEMO_PASSWORD`, `backend/libs/database/src/seed-demo/index.ts:45`). `mustChangePassword` is deliberately left `false`.

**A ninth runnable package exists: `backend/all-in-one`** (`backend/all-in-one/src/main.ts`), port 3100 in `.claude/launch.json`. It mounts all eight `SERVICE_DEFINITIONS` behind path prefixes on one port (the docs/26 §7 all-in-one deployment mode), has its own `vitest.config.ts` and `all-in-one.spec.ts`, and is supported by `pnpm smoke --base`. It is absent from CLAUDE.md's layout tree.

### 1.2 Worker

One pg-boss process, `backend/worker/src/main.ts`, run with `pnpm --filter @dos/worker dev`. No port of its own in code; `.claude/launch.json` assigns 3999. Registered queues and schedules (cron strings in code are UTC; IST equivalents noted):

| Queue | Schedule | Source |
|---|---|---|
| `outbox-relay` | every minute | `backend/worker/src/jobs/outbox-relay.ts` |
| `retention` | hourly at `:17` | `backend/worker/src/jobs/retention.ts` |
| `documents.pdf.render` | on demand + bare drain | `backend/worker/src/jobs/pdf-render.ts` |
| `docint.qr-read`, `docint.extract`, `docint.validate`, `docint.match` | on demand, batchSize 1, `singletonKey = documentId` | `backend/worker/src/jobs/docint.ts` |
| `imports.run`, `exports.render` | on demand | integrations + claims renderer share `exports.render` |
| `integrations.sweep` | every minute | integrations |
| `notifications.dispatch` | every minute | `backend/worker/src/jobs/notifications.ts` |
| `notifications.deliveryToday` | 07:00 IST | same |
| `notifications.duesReminder` | 09:00 IST | same |
| `reporting.rollup.schedule` | every 15 min | reporting |
| `reporting.rollup.tenant` | on demand | reporting |
| `reporting.rollup.finalize` | 00:20 IST | reporting |
| `incentives.achievements.sweep` | hourly (+ `targets.refresh`) | incentives |
| `ai.forecast.run` | on demand | `backend/worker/src/jobs/ai.ts` |
| `ai.forecast.sweep` | `10 22 * * *` UTC = 03:40 IST | same |

### 1.3 Frontend applications

Seven Expo universal apps (web + Android + iOS from one codebase each), all generated from `frontend/libs/app-template` via `pnpm --filter @dos/app-template new <role> <port>`. `app/_layout.tsx` is byte-identical across owner, manager, sales, warehouse, delivery and the template; admin overrides it. Per-app knobs live in `src/config.ts` as an `APP` const (`role`, `title`, `webPort`, `servicePort`, `touch`, `density`).

| App | Platforms | Web port | Backend service | Run command (web) | Role | Sign-in | Bundle id / scheme |
|---|---|---|---|---|---|---|---|
| owner | web, android, ios (prebuild present) | 5173 | :3001 | `pnpm --filter @dos/owner-app web` | owner | `sunil.tarsun` | `in.distributionos.owner` / `dos-owner` |
| manager | web, android | 5174 | :3002 | `pnpm --filter @dos/manager-app web` | manager, accountant | `vikas.kadam`, `meena.joshi` | `in.distributionos.manager` / `dos-manager` |
| sales | web, android, ios (prebuild present) | 5175 | :3003 | `pnpm --filter @dos/sales-app web` | salesperson | `rahul.deshmukh` | `in.distributionos.sales` / `dos-sales` |
| warehouse | web, android | 5176 | :3004 | `pnpm --filter @dos/warehouse-app web` | warehouse | `dinesh.patil` | `in.distributionos.warehouse` / `dos-warehouse` |
| delivery | web, android | 5177 | :3005 | `pnpm --filter @dos/delivery-app web` | delivery | `ganesh.more` | `in.distributionos.delivery` / `dos-delivery` |
| retailer | web, android | 5178 | :3006 | `pnpm --filter @dos/retailer-app web` | retailer | `ramesh.gupta` | `in.distributionos.retailer` / `dos-retailer` |
| admin | web, android | 5179 | :3007 (+ `EXPO_PUBLIC_TENANT_API_URL` = :3001 for support-grant reads) | `pnpm --filter @dos/admin-app web` | platform_admin | `dos.admin` | `in.distributionos.admin` / `dos-admin` |

Every app carries `EXPO_PUBLIC_AUTH_URL=http://127.0.0.1:3000`. `frontend/libs/app-template` occupies port 5170 in `.claude/launch.json` and is the generator skeleton, not a shipped app.

**Prebuilt mobile artefacts.** A debug APK exists for all seven apps at `frontend/<app>/android/app/build/outputs/apk/debug/app-debug.apk`. `ios/` prebuild directories exist only for `frontend/owner-app` and `frontend/sales-app`.

### 1.4 Route inventory per app

- **owner** (28 route files): `/`, `/approvals`, `/billing/{index,credit-notes}`, `/change-password`, `/map`, `/money/{index,books,claims,receipts}`, `/orders/{index,trips}`, `/prices`, `/reports/{index,exports,incentives,profit}`, `/settings/{index,audit,imports,notifications}`, `/shops`, `/sign-in`, `/staff`, `/stock/{index,catalog,documents,inbound}`.
- **manager** (24): `/`, `/billing/{index,brand-dms,credit-notes}`, `/change-password`, `/fulfilment/{index,load-out,pack}`, `/inbound/{index,documents,gate}`, `/messages`, `/money/{index,claims,day-end}`, `/orders/{index,drafts}`, `/prices`, `/registers/{index,tally,team}`, `/settings`, `/shops`, `/sign-in`, `/stock`.
- **sales** (17): `/`, `/change-password`, `/me/{index,drafts,inbox,visits}`, `/orders/{index,[id],attention,new}`, `/settings`, `/shops/{index,[id],catalog,lapsed,new}`, `/sign-in`.
- **warehouse** (19): `/`, `/change-password`, `/inbound/{[id],capture}`, `/load/{index,[id],check-in,trips}`, `/pack/{index,[orderId]}`, `/pick/{index,[id],attention}`, `/settings`, `/sign-in`, `/stock/{index,reservations,counts/{index,[id]}}`.
- **delivery** (16): `/`, `/attention`, `/change-password`, `/day`, `/expenses`, `/settings`, `/share/[invoiceId]`, `/sign-in`, `/stop/[id]/{index,collect,deliver,van-sale}`, `/trip/start`, `/trips`.
- **retailer** (18): `/`, `/bills/{index,[id]}`, `/change-password`, `/deals`, `/dues`, `/inbox`, `/order`, `/orders/{index,[id]}`, `/pay`, `/receipts`, `/returns`, `/settings`, `/shop`, `/sign-in`, `/statement`.
- **admin** (12): `/`, `/audit`, `/change-password`, `/distributors/{index,[id],new}`, `/settings`, `/sign-in`, `/subscriptions`, `/support`, `/users`.

---

## 2. How to run each application

Non-login shells (the Bash tool, `.claude/launch.json`) start on system Node 22. Every command below is preceded by:

```bash
export PATH=/opt/homebrew/bin:$PATH; eval "$(fnm env)"; fnm use 24
```

**Database first.** Postgres 17 runs as Homebrew service `postgresql@17` on `127.0.0.1:5439`; `brew services start postgresql@17` if down. `backend/.env` holds `DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/dos`.

```bash
cd backend
pnpm install
pnpm db:migrate          # apply backend/libs/database/migrations
pnpm db:seed             # three tenants, staff, retailers, catalog, orders, bills, receipts; idempotent
```

Libraries are consumed from `dist/`. After editing `@dos/domain`, `@dos/contracts`, `@dos/db` or `@dos/core`, run `pnpm --filter <pkg> build` (or keep `pnpm dev` running) or the services and the frontend will not see the change. The frontend links `@dos/contracts` and `@dos/domain` by `link:`, so those two must be built before frontend typecheck/build.

**Backend services** (each runs alone, one terminal each):

```bash
pnpm --filter @dos/auth-service dev        # :3000
pnpm --filter @dos/owner-service dev       # :3001
pnpm --filter @dos/manager-service dev     # :3002
pnpm --filter @dos/sales-service dev       # :3003
pnpm --filter @dos/warehouse-service dev   # :3004
pnpm --filter @dos/delivery-service dev    # :3005
pnpm --filter @dos/retailer-service dev    # :3006
pnpm --filter @dos/admin-service dev       # :3007
pnpm --filter @dos/worker dev              # pg-boss worker
pnpm --filter @dos/all-in-one dev          # :3100, all eight behind path prefixes
```

Per-service port override is `<NAME>_SERVICE_PORT`; never set a global `PORT`. Each service exposes `GET /health` (unguarded), `/swagger` (Swagger UI), `/docs` (Scalar) and `/docs/openapi.json`.

**Frontend apps** (from `frontend/`):

```bash
cd frontend && pnpm install
pnpm --filter @dos/owner-app web       # :5173 ... admin-app :5179
pnpm --filter @dos/<role>-app export:web   # static build to dist/
pnpm --filter @dos/<role>-app ios          # expo run:ios (device/simulator build)
pnpm --filter @dos/<role>-app android      # expo run:android
```

Android shells need:

```bash
export ANDROID_HOME=$HOME/Library/Android/sdk
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$JAVA_HOME/bin:$PATH"
emulator -avd Pixel_7_API_36 -memory 3072 -no-snapshot-save
adb devices
```

**Checks.** Backend, in this order: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm build && pnpm docs:readme:check && pnpm db:migrate && pnpm test`. Frontend, from inside `frontend/`: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm format:check`. Endpoint sweep: `pnpm smoke` (see §11).

---

## 3. Database and tenancy

**Model.** Shared schema, `tenant_id` on every tenant table, RLS enabled and FORCE. Every id, including `tenant_id`, is a client-generated UUIDv7 stored as `text` — `tenantIdColumn = () => text('tenant_id').notNull()` at `backend/libs/database/src/schema/columns.ts:21`, and `id()` at line 6.

**Postgres roles.** `dos` is the owner (CREATEDB, CREATEROLE, BYPASSRLS — runs migrations and seeds). Migrations create two application roles:

- `app_rw` — **no** BYPASSRLS. Entered by `SET LOCAL ROLE app_rw` inside `withTenant`, so even an owner connection obeys RLS.
- `app_worker` — **BYPASSRLS**, created in `backend/libs/database/migrations/0003_force_rls_ledgers_views.sql:182`. Entered by `withSystem`, used for sign-in, refresh and worker jobs (cross-tenant work before a tenant is known).

**Access wrappers** (`backend/libs/database/src/client.ts`):

- `withTenant(db, ctx, fn)` (lines 61-75) — opens a transaction, `SET LOCAL ROLE app_rw`, then three transaction-local `set_config` calls: `app.tenant_id`, `app.actor_id`, `app.actor_role`. Policies read those settings.
- `withSystem(db, fn)` (lines 83-89) — `SET LOCAL ROLE app_worker`, `app.actor_role = 'system'`, **no tenant setting at all**.

Pool size is `DATABASE_POOL_MAX`, default 10 (`poolMax()`, `backend/libs/database/src/client.ts:41-45`); specs set 3. `instances × DATABASE_POOL_MAX` must stay under Postgres `max_connections` (100 locally).

**Policy helpers** (`backend/libs/database/src/schema/columns.ts`):

| Helper | Shape |
|---|---|
| `tenantPolicy` | any tenant member, FOR ALL |
| `tenantRolePolicy(name, roles)` | tenant + role predicate, FOR ALL — used on every table carrying purchase cost |
| `tenantOrOwnRetailerPolicy` | SELECT only; a retailer-role actor is scoped through the denormalised `retailer_links.user_id` with `status='active'` |
| `staffReadPolicy` / `staffWritePolicy` | any non-retailer member; excludes `actor_role='retailer'` from internal paperwork (picklists, load sheets) |
| `roleReadPolicy` / `roleInsertPolicy` / `roleUpdatePolicy` / `roleWritePolicies` | named role sets, split per SQL command |
| `platformReadPolicy` / `platformWritePolicies` | role-only, no tenant predicate; the four platform-console tables, INSERT/UPDATE only, deliberately **no DELETE** |
| `globalCuratedPolicies` | SELECT true for everyone, write only `curator`/`system` |

Never write a policy that joins `retailer_identities` from a tenant table — Postgres reports infinite recursion (42P17). That is why the denormalised `retailer_links.user_id` exists.

**FORCE RLS coverage.** 204 `FORCE ROW LEVEL SECURITY` statements across 18 hand-written "guarantees" migrations: `0001, 0003, 0005, 0007, 0009, 0011, 0013, 0015, 0017, 0019, 0022, 0025, 0028, 0030, 0032, 0034, 0036, 0040`. Each hand-written file ends with a DO block that fails the migration if any touched table lacks FORCE RLS or still carries a `FOR ALL` policy.

**Global vs tenant data.** Manufacturers, brands, products and variants are global and curated; a distributor may insert `proposed` rows and use them immediately. Retailers, prices, orders and ledgers are per tenant. A user is global (unique phone, unique lower(username)) with memberships per tenant. Purchase cost lives in `tenant_product_costs` under back-office RLS and never in anything a salesperson, delivery or retailer role can read.

**Migrations.** `backend/libs/database/drizzle.config.ts`: dialect postgresql, schema `./src/schema/index.ts`, out `./migrations`, `strict:true`, `verbose:true`, role provider filtered to `app_rw`. `migrations/meta/_journal.json` currently holds **43 entries** (idx 0-42, version `'7'`); the last three are `0040_sync_delta_guarantees`, `0041_sync_tombstone_shop_scope`, `0042_platform_idempotency_scope`. Migrations are expand-only from 0004 onward: a drizzle-generated expand migration plus a hand-written guarantees sibling (FORCE RLS, grants, triggers, policies) that must also be appended to `_journal.json`. **No down-migrations exist anywhere** — rollback tooling is genuinely absent, by design. SQL functions used by triggers are `SECURITY DEFINER SET search_path = public, pg_temp` because FORCE RLS otherwise hides rows from the check itself.

**Guarantee tests.** `backend/libs/database/src/rls.test.ts` is the executable form of the ADRs: cost invisible to salesperson, tenant isolation, retailer sees only own orders and cannot touch credit, ledgers append-only and idempotent, journals balance.

---

## 4. Authentication and authorization as implemented

### 4.1 Endpoints (auth-service :3000)

Contract at `backend/libs/contracts/src/auth.ts`; controller at `backend/libs/core/src/modules/auth/auth.controller.ts`.

| Method | Path | Permission | Guard |
|---|---|---|---|
| POST | `/auth/login` | public | none |
| POST | `/auth/refresh` | public | none |
| POST | `/auth/logout` | public | none |
| POST | `/auth/switch-tenant` | public | none |
| GET | `/auth/me` | authenticated | AccessTokenGuard |
| POST | `/auth/platform/login` | public | none |
| POST | `/auth/platform/refresh` | public | none |
| GET | `/auth/platform/me` | platform_admin | PlatformTokenGuard |
| POST | `/auth/platform/support-pass` | platform_admin | PlatformTokenGuard |
| GET | `/auth/sessions` | authenticated | AccessTokenGuard |
| POST | `/auth/sessions/revoke` | authenticated | AccessTokenGuard |
| POST | `/auth/change-password` | authenticated | AccessTokenGuard |
| POST | `/auth/forgot-password` | public | none |
| POST | `/auth/reset-password` | public | none |
| GET | `/.well-known/jwks.json` | public | none |

`logout`, `refresh` and `switch-tenant` are marked `public` because they authenticate with the refresh token in the body, not a bearer header (`backend/libs/contracts/src/permissions.ts:337-343`).

### 4.2 Sign-in

`AuthService.login()` (`backend/libs/core/src/modules/auth/auth.service.ts:156-272`) runs inside `withSystem()`. It looks up `users` by lower(username), verifies with argon2id, and runs the verification against a cached dummy hash for an unknown username (`dummy()`, line 789) so timing is constant. It then checks the 5-failure / 15-minute lockout (`MAX_FAILED_LOGINS=5`, `LOCK_MINUTES=15`, lines 68-69), checks `user.status==='active'`, picks the membership (the `tenantId` parameter or the first active one), refuses a platform_admin (directed to `/auth/platform/login`), refuses **423** if the chosen tenant is not `active` (lines 87-95), upserts `devices`, revokes any existing session for that `(userId, deviceId)` pair — one live session per device — creates a new `auth_sessions` row plus a rotating refresh token, writes `auth_events`, and returns the token pair.

**Access token.** EdDSA (Ed25519) JWT, 15-minute default (`AUTH_ACCESS_TTL_SECONDS`, `DEFAULT_ACCESS_TTL_SECONDS=900`, `backend/libs/core/src/modules/auth/tokens.ts:9,18-23`). Claims: `sub` (userId), `tid` (tenantId or null), `role`, `sid` (session id), `did` (device id), `jti`, fixed `iss`/`aud`, `iat`, `exp`, plus a `kid` header for JWKS.

**Refresh token.** 32 random bytes base64url; only its sha256 hash is stored (`tokens.ts:109-116`). Default 30 days (`DEFAULT_REFRESH_TTL_DAYS`). Rotates on every `refresh`, `switchTenant` and `platformRefresh`; the previous hash is retained in `previousRefreshTokenHash`, and presenting it after rotation revokes the whole session (`validateRefresh`, `auth.service.ts:953-984`).

**Passwords** (`backend/libs/database/src/auth/password.ts`). argon2id, `memoryCost:19456, timeCost:2, parallelism:1`. Rules: 8-72 characters, at least one letter and one digit; no symbol or uppercase requirement. Usernames: 3-32 characters, lowercase letters/digits/dots/underscores, stored and compared lowercase.

**Brute force.** 5 consecutive failed logins lock the account for 15 minutes (`users.failed_login_count`, `locked_until`), identically on `login` and `platformLogin`. Password-reset requests are separately limited to 5/hour per username and 5/hour per caller IP (`otp_rate_limits` table, `underResetLimit()`, lines 796-809). No IP-based limiter on `login` itself; no CAPTCHA.

**Password reset.** `forgotPassword` always answers `{ok:true}`. When valid it signs a compact Ed25519 token (not a JWT, `signResetToken`, `tokens.ts:146-162`) bound to a fingerprint of the current password hash, 30-minute TTL, and delivers it via `console.warn` outside production — `deliverResetToken()` (lines 821-831) is an explicit no-op in production. `resetPassword` verifies signature and fingerprint (single-use, since the fingerprint changes) and revokes every session.

**OTP.** Not implemented. No OTP contract procedure exists. `otp_rate_limits` is consumed only by the password-reset limiter.

### 4.3 Session revocation semantics

`logout()` (`auth.service.ts:321-336`) flips `auth_sessions.revoked_at` for the session matched by the refresh token's hash. It does not touch the access token. `TenantGuard.canActivate` (`backend/libs/core/src/modules/tenancy/tenant.guard.ts:135-183`) — the guard used by all six tenant services and admin-service — verifies the JWT **synchronously and statelessly with `node:crypto`, with no database lookup** (comment lines 109-115: an `await` before `AsyncLocalStorage.enterWith` would make the context invisible to handlers). Consequence, from code: an already-issued access token keeps working on every business service until its own `exp`, after logout, after the user is disabled, and after the tenant is suspended. Revocation, disable and suspension bite at the next **refresh** (`auth.service.ts:290-295`; `platformRefresh` docstring lines 469-472). `changePassword` revokes all *other* device sessions; `resetPassword` revokes all sessions; neither shortens a live access token.

### 4.4 Roles

`membershipRole` Postgres enum (`backend/libs/database/src/schema/tenancy.ts:109-117`), 7 values: `owner, manager, salesperson, delivery, accountant, retailer, warehouse`. Bound per tenant through `memberships` (`tenantId`, `userId`, `role`, `status: invited|active|disabled`).

`platform_admin` is deliberately **not** in that enum. It is a global role held by rows in `platform_admins` (`userId`, `role: super|support|billing`, `disabledAt`), reachable only via `/auth/platform/login`, and is the one role in `ActorRole`/`PermissionRole` with no `tenant_id` (`backend/libs/database/src/client.ts:9-27`; `backend/libs/contracts/src/permissions.ts:14-30` keeps `PLATFORM_ROLES` disjoint from `ALL_ROLES`).

### 4.5 Permission matrix

`backend/libs/contracts/src/permissions.ts` (1059 lines) is `Record<ProcedurePath, Permission>` — one row per contract procedure, where `Permission = readonly PermissionRole[] | 'public' | 'authenticated'`. `isAllowed(permission, role)` (lines 1008-1016): `undefined` → false; `'public'` → true; `role===null` → false; `'authenticated'` → true; array → `includes(role)`.

Fail-closed is structural: `TenantGuard.canActivate` (`tenant.guard.ts:139-142`) throws `InternalServerErrorException` (500) for any route with no PERMISSIONS entry. Route permissions are resolved from the whole contract (`routePermissions()`), not per service, so adding a contract procedure without a matrix row breaks every service that mounts it. Every service spec runs `describePermissionMatrix` (every endpoint × every role).

### 4.6 Service role gate

`TenantGuard.requireServed(role)` (`tenant.guard.ts:249-253`): if the `ServiceDefinition` injected as `SERVICE_INFO` does not list the caller's role in `service.roles`, it throws `ForbiddenException` — "`<service>`-service does not serve the `<role>` role". This runs **before** the PERMISSIONS role check, so a role that is allowed the procedure but not served by this service instance is still refused.

### 4.7 Platform console and support access

A `platform_admin` token (no `tid`) is handled by `admitConsole()` (`tenant.guard.ts:189-233`):

- With no `x-support-grant` header it passes only on admin-service, entering tenant context `{tenantId: PLATFORM_SCOPE=''}` — an empty tenant id, so any accidental query against a business table matches zero rows.
- With a signed `x-support-grant` pass it acts as `owner` for exactly the named tenant (`SUPPORT_ACTING_ROLE='owner'`), restricted to GET when `scope==='read_only'` (`passAllowsMethod`, `backend/libs/core/src/modules/tenancy/support-access.ts:167-169`), refused if the pass names a different admin. The request is recorded on `req.supportAccess` for `SupportAuditInterceptor` to write to `platform_audit`.
- A membership token presenting a support-grant header is refused outright (lines 160-164).

Grant flow: `admin.support.request` (platform_admin) inserts a `support_grants` row (reason, `requestedHours` 1-72, default 4) → the distributor's **owner only** approves via `tenancy.support.approve`, which may shorten but never widen the window (DB trigger `dos_support_grant_guard()`) → `POST /auth/platform/support-pass` (`auth.service.ts:533-579`) exchanges the approved grant for a 5-minute Ed25519-signed pass (`SUPPORT_PASS_TTL_SECONDS=300`, `support-access.ts:39`) carrying `grantId, tenantId, adminUserId, scope, expiresAt`, where `expiresAt = min(grant.expiresAt, now+5min)`. Five explicit refusals: not an admin, wrong admin, not yet approved, revoked, expired.

Note for anyone grepping the schema: the DB enum `supportGrantScope` is `['read','read_write']` (`backend/libs/database/src/schema/platform-admin.ts:95`), while the wire type is `'read_only'|'read_write'`; `supportPass()` maps `read_write ? 'read_write' : 'read_only'` (line 558).

---

## 5. Order lifecycle as implemented

State machines are plain data tables built with `defineMachine()` (`backend/libs/domain/src/state-machines/machine.ts`); `next()` throws `TransitionError` on an illegal move, wrapped as HTTP 409 by each module's `transition()` / `invoiceTransition()` / `tripTransition()` / `stopTransition()` helper.

**Order enum** (`order_state`, `backend/libs/database/src/schema/orders.ts:35-46`): `draft, submitted, confirmed, picking, packed, dispatched, delivered, partially_delivered, closed, cancelled`. Machine at `backend/libs/domain/src/state-machines/order.ts`.

### 5.1 Order transition table

| From → To | Event | Caller (file:line) | Role | Effects |
|---|---|---|---|---|
| draft → submitted | `submit` | `orders.service.ts:232` `submit()` | `orders.submit` = ANY_MEMBER | writes `sales_orders` (state, `orderNo` via `nextDocumentNumber`, `approvalFlags`, `submittedAt`), `order_state_transitions`, outbox `OrderSubmitted` |
| submitted → confirmed | `confirm` | `orders.service.ts:322` `confirmInTx` — automatic from `submitInTx` when `flags.length===0`; explicit via `confirm()` (`orders.service.ts:305`); or from `approvals.service.ts:111` | `orders.confirm` = MANAGEMENT (owner, manager); the auto path runs `asSystem()` when the actor is a retailer | resolves pending `approvals`; reserves stock line by line via `InventoryService.reserve` (short lines reported as `shortages`, never blocking); writes `sales_orders` (state, `fulfilFromLocationId`, `confirmedAt`), transition row, outbox `OrderConfirmed` |
| confirmed → picking | `start_picking` | `applyFulfilmentEvent` from `warehouse/picklists.service.ts:347` (`picklists.start`) | gate is on the warehouse contract procedure | `sales_orders.state`, transition row, outbox `OrderPicking` |
| picking → packed | `pack` | `applyFulfilmentEvent` from `warehouse/packing.service.ts:129` (`packs.confirm`); `billing/invoices.service.ts:409` `markPacked` inserts `start_picking` first if still `confirmed` | warehouse `packs.confirm` | transition row, outbox `OrderPacked` |
| packed → dispatched | `dispatch` | `applyFulfilmentEvent` from `warehouse/load-sheets.service.ts:416` (`loadSheets.confirm`, crew count + PIN) and `delivery/trips.service.ts:857` (`dispatchIfPacked`, on trip depart) | warehouse / delivery procedures | transition row, outbox `OrderDispatched` |
| dispatched → delivered / partially_delivered | `deliver_all` / `deliver_partial` | `delivery/deliveries.service.ts:165` `recordInTx`, derived by `outcomeOf` from delivered-vs-ordered line quantities | `deliveries.record` (DOORSTEP roles) | `sales_order_lines.delivered_qty_pcs` (additive), transition row, outbox `OrderDelivered` / `OrderPartiallyDelivered` |
| dispatched → packed | `return_undelivered` | `deliveries.service.ts:165` (outcome `failed`) and `trips.service.ts:914` `failStopInTx` (stop fail, or `trips.return`) | DOORSTEP roles | outbox `OrderReturnedUndelivered`; stock stays on the vehicle, nothing else moves |
| delivered / partially_delivered → closed | `close` | **no call site anywhere in the codebase** | — | — |
| draft / submitted / confirmed → cancelled | `cancel` | `orders.service.ts:371` `cancel()`; internally `cancelInTx` from `approvals.service.ts:101` on rejection | `orders.cancel` = ANY_MEMBER, but `assertRetailerOwns` restricts a retailer to its own draft/submitted order | releases every line's reservation (`InventoryService.releaseReservation`), expires pending approvals, writes `sales_orders` (state, `cancelledAt`, `cancelReason`), transition row, outbox `OrderCancelled` |

The only legal writer of `confirmed → picking → packed → dispatched` and the three doorstep outcomes is `OrdersService.applyFulfilmentEvent` (`backend/libs/core/src/modules/orders/orders.service.ts:428`), idempotent by target state, not by key.

Van sale (`delivery/vansales.service.ts:105,123`) drives `dispatch` then `deliver_all` directly off the vehicle's own reservation, bypassing the warehouse, then bills via `invoices.service.ts:400` `issueFromLocation`.

`markPacked` (`orders.service.ts:508`) is annotated in-code as a **temporary alias** kept only for billing's superseded stock-and-state path.

### 5.2 Approvals

`approvalFlags()` (`backend/libs/core/src/modules/orders/orders.internals.ts:140`) computes at most three flags at submit, none of which block the transition:

- `credit_limit` — `checkCredit(tx, retailerId, totalPaise)` breached
- `bargain` — an unresolved `bargain_requests` row with `status='requested'` on the same retailer/variant
- `below_floor` — a line priced under its list rate with no `bargain`/`override` rule explaining it

With zero flags the order self-confirms inside `submitInTx`. Otherwise one `approvals` row per flag is inserted with `status:'pending'`, and `ApprovalsService.decide` (`approvals.service.ts:67`, role MANAGEMENT — accountant excluded) either cancels the order (reject, reason `approval_rejected`) or, once the last pending flag on that order clears (`stillPending` check, line 118), confirms it.

`ApprovalKind` declares seven kinds in both the Zod schema and the Postgres enum. Orders raises only `credit_limit`, `bargain`, `below_floor`; delivery raises `trip_settlement` separately (`settlement.service.ts:291`, decided by owner). `return`, `scheme_override` and `manual_price` are never inserted by any code path.

### 5.3 Modification, repeat, returns, retailer self-service

- `setLines` (`orders.service.ts:153`) throws CONFLICT unless `order.state === 'draft'` — no re-lining after submit.
- `repeatLast` (`orders.service.ts:171`) copies the retailer's last non-cancelled order's lines into a fresh draft and re-prices at today's version through `priceOrderLines`.
- There is no return path on the order aggregate. A doorstep shortfall or return goes through `DeliveriesService.recordInTx` → `CreditNotesService.raiseForDelivery` (`deliveries.service.ts:176-198`): one credit note at the invoice's original rate, restocking saleable pieces to the vehicle (or the warehouse if short-loaded) and damaged pieces to a damaged bin. The order itself only moves via `deliver_partial` or `return_undelivered`.
- Retailer self-order: `create`, `setLines`, `submit`, `cancel` are ANY_MEMBER at the contract layer; `orders.internals.ts:82` forces `source==='retailer_app'` for a retailer caller; `assertRetailerOwns` (`orders.service.ts:591`) restricts a retailer to its own shop's draft/submitted rows; `loadDetail` strips `approvalFlags` and `approvals` from what a retailer sees.

### 5.4 Other machines

- **Trip** (`backend/libs/domain/src/state-machines/delivery.ts`): `planned → loading → active → closing → settled | settled_with_variance`; `cancelled` only from `planned`/`loading` (`delivery/delivery.internals.ts:94`).
- **Stop**: `pending → started → arrived → delivered | partial | failed`.
- **Invoice** (`backend/libs/domain/src/state-machines/invoice.ts`): `draft → issued → partially_paid → paid`, or `issued → paid` directly, plus `write_off` and `cancel`. `cancel` is legal only from `draft`/`issued`; once `partially_paid`, correction is by credit note only.

---

## 6. Inventory ledger as implemented

**Tables** (`backend/libs/database/src/schema/inventory.ts`): `locations` (kind `warehouse|vehicle|damaged|in_transit|customer`, `negativeAllowed` flag, `vehicleId` link), `stock_lots` (identity `UNIQUE(tenant_id, variant_id, batch_no, mrp_paise)`; carries `mfg_date`, `expiry_date`, and its own `case_size` copied from the GRN line at creation), `stock_ledger`, `stock_balances` (PK `(tenant_id, lot_id, location_id)`), `reservations`, `cycle_counts` / `cycle_count_lines`.

**Ledger row shape** (`stock_ledger`, lines 118-148): `id, tenantId, occurredAt, lotId, locationId, qtyDelta (signed int), reason, refType, refId, actorId, idempotencyKey, note, createdAt`. Constraints: `UNIQUE(tenant_id, idempotency_key)` and `CHECK qty_delta <> 0`.

**Reason enum** (`stockReason`, lines 98-112): `opening, grn, sale, sale_return_saleable, sale_return_damaged, damage, expiry_writeoff, transfer_out, transfer_in, van_load, van_unload, adjustment, cycle_count`.

**Append-only.** `backend/libs/database/migrations/0003_force_rls_ledgers_views.sql:123` — `stock_ledger_append_only BEFORE UPDATE OR DELETE ... EXECUTE FUNCTION dos_reject_mutation()`, raising `restrict_violation`. The same function guards `journal_lines`, `journal_entries` (delete only), `order_state_transitions` and `audit_log`.

**Balances.** `InventoryService.applyBalance` (`backend/libs/core/src/modules/inventory/inventory.service.ts:691-755`) is UPDATE-first: `UPDATE stock_balances SET on_hand = on_hand + delta, reserved = reserved + delta, version = version + 1 ... RETURNING`, and only INSERTs a zero-baseline row if none existed, re-attempting the UPDATE if the insert lost a race. `INSERT ... ON CONFLICT DO UPDATE` is avoided because with a negative delta it evaluates the CHECK against the wrong candidate row. `on_hand >= 0 OR negative_allowed` and `reserved >= 0` are Postgres CHECK constraints (lines 172-173) caught by constraint name (`pgConstraint`) and rethrown as `ORPCError('BAD_REQUEST')` — the negative-stock guard is in the database, not only in application code.

**Idempotency.** Every `post()` entry requires a caller-supplied `idempotencyKey`; the insert uses `.onConflictDoNothing({ target: [stockLedger.tenantId, stockLedger.idempotencyKey] })` (`inventory.service.ts:209`). A replay is skipped (`if (!row) continue`) and its balance is not re-applied.

**Reservations.** Held at order confirm, which for a flag-free order happens automatically inside submit. `confirmInTx` (`orders.service.ts:322-360`) reserves `min(requested, available)` pieces per line, FEFO-ordered against `sellable_stock` (earliest expiry, then oldest lot), using a locked conditional UPDATE (`WHERE on_hand - reserved >= take`) so concurrent reservations cannot overbook. A line the location cannot fully cover is reserved short and returned as a `shortage`. Released on cancel via `InventoryService.releaseReservation` (`pending → voided`, giving back `reserved`), and closed at pick time regardless of which lot was actually picked.

**Movement writers.**

| Movement | Code | Reasons written |
|---|---|---|
| Pick / pack | `warehouse/packing.service.ts:96` → `InventoryService.postPick` (`inventory.service.ts:446-483`) | closes every pending reservation of the line (`state:'posted'`, returns `reserved`), then posts one negative `sale` row per (line, lot) actually packed, keyed `${idempotencyKey}:${lotId}` — deliberately decoupled from what was reserved so substitution and short picks work |
| Load-out godown → vehicle | `warehouse/load-sheets.service.ts:379-398` | `transfer_out` + `transfer_in` per lot, keyed `load:<sheetId>:<lotId>:out\|in`, `ref_type='load_sheet'` |
| Trip settlement | `delivery/settlement.service.ts:178-215` | first a `cycle_count` adjustment on the vehicle for counted-vs-expected variance ("the miscount first, so the van never dips below zero"), then `van_unload` out of the vehicle paired with `transfer_in` into the godown; `ref_type='trip_settlement'` |
| GRN commit | `procurement/grn.service.ts:359-399` | finds or creates the lot (copying `case_size` from the invoice line, lines 359-365), posts `grn` for good quantity to `grn.locationId` and `grn` for `line.damagedQtyPcs` to the damaged bin, noted `'damaged at gate'`; `ref_type='grn'` |
| Credit-note restock | `billing/credit-notes.service.ts:452-488` `restock()` | only for `RESTOCKING_REASONS`; re-enters pieces to the **same lot** they left from — `sale_return_saleable` to the restock location, `sale_return_damaged` to the damaged bin; keyed `credit-note:<noteId>:<lineId>` |
| Manual adjust / transfer | `inventory/stock.service.ts:247-318`, role STOCK_WRITERS (back office + warehouse) | `adjust` posts one row; `transfer` posts a `transfer_out`/`transfer_in` pair and refuses `from === to` |
| Cycle count post | `inventory/cycle-counts.service.ts:225-231` | one `cycle_count` row per line with non-zero variance |

Client-facing adjustment reasons are restricted by `AdjustmentReasonSchema` (`backend/libs/contracts/src/inventory.ts:75-81`) to `adjustment, damage, expiry_writeoff, opening, cycle_count`.

**Vehicle as location.** `InventoryService.ensureVehicleLocation` (`inventory.service.ts:233-262`) creates a `kind:'vehicle', negativeAllowed:false` location idempotently keyed on `vehicleId`. A van never goes negative — a van sale beyond van stock is a 400.

**Sellable / ATP view.** `backend/libs/database/migrations/0003_force_rls_ledgers_views.sql:170-175` — `CREATE VIEW sellable_stock WITH (security_invoker = true)` = `stock_balances JOIN stock_lots WHERE (on_hand - reserved) > 0`, `GRANT SELECT ... TO app_rw`. This is the only stock surface every role including retailer can query (`StockService.sellable`, no role gate); it exposes no per-lot on-hand/reserved split and no cost.

**Case sizes.** Sell-side = `tenant_products.case_size_override` else `product_variants.default_case_size` (`backend/libs/database/src/schema/catalog.ts:118`); buy-side = `supplier_pack_configs`; each lot carries its own `case_size`.

**Cost.** Purchase cost lands in `tenant_product_costs` via `grn.service.ts` `upsertCost` (back-office RLS). No `costPaise`-style column exists on `stock_ledger` or `stock_lots`.

**On-hand recompute (run this to detect drift):**

```sql
SELECT lot_id, location_id, SUM(qty_delta) AS computed_on_hand
FROM stock_ledger
WHERE tenant_id = :tenantId
GROUP BY lot_id, location_id;

-- compare row-by-row against:
SELECT lot_id, location_id, on_hand, reserved
FROM stock_balances
WHERE tenant_id = :tenantId;
```

`backend/libs/database/src/schema/inventory.ts:150` carries a comment that balances are "re-derived nightly" as a drift alarm; no such job was located in `backend/worker/src/jobs/` during this pass.

---

## 7. Money as implemented

### 7.1 Pricing order

`priceOrder()` (`backend/libs/domain/src/pricing/schemes.ts:232`) is the engine — pure, zero runtime dependencies. Order of application:

1. Tier price from the `tierPrices[variantId]` map passed in.
2. Retailer override (`overrides[]`); `final:true` blocks schemes on that line (line 399).
3. Schemes: line-level (`free_qty`, `line_pct`, `net_scheme_amount` with a per-line trigger) then order-level (`order_pct`, `mix` triggers over the whole in-scope set). `chooseStack()` (line 505) picks whichever total is worth more to the retailer — every stackable scheme together, or the single best exclusive one (`stackable:false` or `final:true`) — never both.
4. Approved bargain last, replacing the rate if it beats it (lines 295-310).
5. Cash discount computed but never deducted (`cashDiscountPaise`, lines 338-365) — reported only, realised at receipt.

Every applied rule is pushed into `AppliedRule[]` on the line (`applied_rules jsonb`): `kind: 'override'|'scheme'|'bargain'|'manual'`, with `amountPaise` / `freeQty` / `freeVariantId`. Order-level rewards are spread to lines by `allocate()` (largest remainder, no paisa lost) in `spread()` (`schemes.ts:661`).

A second, fully implemented and tested engine exists at `backend/libs/domain/src/pricing/resolve-price.ts` (`resolvePrice()`) with **zero non-test callers**. Live wiring is `priceOrder()` only, through `quote.service.ts` (`pricing.quote`) and `orders/pricing-lines.ts` → `orders.service.ts:560`.

### 7.2 GST

`splitGst(taxable, rateBps, supplierStateCode, placeOfSupplyStateCode)` (`backend/libs/domain/src/gst.ts:15`): same state code → CGST + SGST at half the rate each; different → IGST at the full rate. GST is computed **per invoice line** (`billing/invoices.service.ts:1421`, one call per lot-split line, taxable = gross − line discount), never at header.

Rounding: `roundToRupee()` (`backend/libs/domain/src/money.ts:83`) runs **once per invoice** over `taxable + cgst + sgst + igst + cess` summed across lines; the residue goes to the `ROUND_OFF` account (`invoices.service.ts:1504-1509`). This is what makes the journal balance to the paisa. Money is integer paise (`Paise` branded type); `multiply` / `percentOf` round half-up (`money.ts:66-80`); `allocate()` is largest-remainder.

### 7.3 Invoice

Issued at pack by `writeInvoice` (`invoices.service.ts:1469`), one INSERT, `state: invoiceTransition('draft','issue')`. The number (`nextDocumentNumber`) is taken **last inside the transaction** so an earlier refusal never burns it.

Cancellation is lawful only **before dispatch** (`invoices.service.ts:197-199`) and only if no money is allocated and no credit note exists (lines 802-826); role `PIN_HOLDERS`. The number survives with `cancelledAt` / `cancelReason` set (GSTR-1 Table 13). `cancelImported` (line 620) is the file-import rollback variant on the same machine.

Immutability is enforced by triggers in `backend/libs/database/migrations/0003_force_rls_ledgers_views.sql`: `dos_invoice_immutable` (lines 142-158) raises `restrict_violation` on any UPDATE that changes anything besides `state`, `due_date` and document keys once `state <> 'draft'`; `dos_invoice_lines_immutable` (lines 159-168) blocks UPDATE/DELETE on `invoice_lines` once the parent is not draft. Corrections after issue are credit notes only.

### 7.4 Receipts, allocation, outstanding

Receipt modes (`backend/libs/contracts/src/receivables.ts:72`): `cash | upi | bank_transfer | cheque | adjustment`.

`recordReceipt` (`receivables.service.ts:583`) is idempotent twice: by the mutation's `idempotencyKey` via `idempotent()`, and by `(deviceId, clientReceiptNo)` for field-uploaded paper receipts (`findExistingReceipt`, line 1503).

Allocation plans: `planFifo` (`allocation.ts:272`, oldest-due-first) or `planExplicit` (line 312, caller names the bills; an amount exceeding a bill's open balance is refused 409 CONFLICT). Cash discount realises only if the offer is `open`, the payment is inside the window, **and** it settles the bill in full — leftover never spreads silently.

Over-payment: nothing caps `amountPaise` against outstanding. Whatever remains after the plan is exhausted stays as `unallocatedPaise` on the receipt (returned in `RecordReceiptResult`) and is tracked as `unallocated_credit_paise` in `retailer_outstanding_summary` — there is no separate advance table.

Payment state is derived, not assigned: `derivePaymentState()` walks `invoiceMachine` forward (`allocation.ts:29`), and `recomputeInvoiceStates` is the only writer of `invoices.state` outside billing's initial issue (a documented exception to "only through the service").

Outstanding (`receivables/outstanding.ts:218`, `computeOutstanding`): per retailer, `outstandingPaise` = Σ open balance (`totalPaise − allocatedPaise`) of bills in state `issued` or `partially_paid`; `unallocatedCreditPaise` = money paid on account not yet matched. The code states the identity explicitly at lines 13-18: **`Σ(outstanding − unallocated) == AR in journal_lines`, not `Σoutstanding == AR`**. The summary is stored in `retailer_outstanding_summary` and refreshed in the *same transaction* as every posting, never eventually-consistent; `loadOutstanding` (line 337) computes fresh if no row exists.

Ageing buckets (`outstanding.ts:24-40`, `bucketIndex` at line 33): `b0_7, b8_15, b16_30, b31_60, b61_90, b90plus`, on days past due date in IST business dates; a not-yet-due bill counts as `b0_7`. `ageing_snapshots` also carries a legacy `bucket_60_plus_paise = bucket_61_90 + bucket_90_plus`.

### 7.5 Credit limit enforcement point

At **order submit**: `orders.service.ts:266` → `approvalFlags()` (`orders.internals.ts:140`) → `checkCredit()` re-exported from receivables. Three breach reasons: `limit_exceeded` (outstanding + order > `creditLimitPaise`), `bill_count_exceeded` (open bills ≥ `creditLimitBills`), `overdue_days_exceeded` (oldest overdue > `creditDays`). `creditMode` is `indicate | strict | stop`; only `strict`/`stop` enforce. **A breach never rejects the submit** — it appends `'credit_limit'` to `approvalFlags[]`, routing the order to the owner approval queue (verified by `orders.spec.ts:370`).

### 7.6 Journals

Double-entry in `journal_entries` / `journal_lines` (`backend/libs/database/src/schema/receivables.ts:85-140`). Balance is enforced by a deferred constraint trigger `journal_lines_balanced` (`migrations/0003_force_rls_ledgers_views.sql:130-140`, `SUM(amount_paise)=0` per entry, checked at commit), SECURITY DEFINER so FORCE RLS does not hide rows from its own check.

Postings: at invoice issue (`ReceivablesService.postInvoiceIssued`, `receivables.service.ts:381`, called by billing inside billing's own transaction — DR AR, DR DISCOUNTS, CR SALES, CR OUTPUT_CGST/SGST/IGST/CESS, CR ROUND_OFF); at receipt (DR cash/upi/cheque account + DR CASH_DISCOUNT, CR AR); at credit note; at invoice cancel (reversal of the original entry); at write-off. The chart of accounts (`accounts` table) is tenant-seeded: AR, Cash, UPI-per-VPA, SALES, OUTPUT_CGST/SGST/IGST/CESS, DISCOUNTS, ROUND_OFF, claims-receivable. Journal **read** is `BACK_OFFICE_ROLES` only; **posting** is `LEDGER_POSTING_ROLES` (staff minus warehouse).

### 7.7 Reporting surface

`backend/libs/contracts/src/reporting.ts` top-level groups: `dashboard.{owner,rep}`, `series.get`, `dailyStats.{sales,collections,outstanding,ageing,growth,brandMix,categoryMix,topShops,topBeats,productivity,fillRate,deliveryPerformance,stock,grossMargin,schemeSpend,tenant,rep,behaviour}`, `retailers.series`, `registers.{lapsed,repProductivity,schemeSpend,stockValue,fillRate,deliveryPerformance,collections,gstSalesRegister,gstPurchaseRegister}`, `exports.{request,get}`. Numbers come from precomputed daily rollups (`reporting/rollup.ts`) fed by the worker, plus `retailer_outstanding_summary` / `ageing_snapshots` for AR, and `journal_lines` plus invoice rows for GST registers.

### 7.8 Six-place money reconciliation SQL

```sql
-- 1. order total vs its invoices (usually 1:1; a short pack can split)
SELECT o.id, o.total_paise AS order_total,
       (SELECT COALESCE(SUM(i.total_paise),0) FROM invoices i
         WHERE i.order_id = o.id AND i.state <> 'cancelled') AS invoiced_total
  FROM sales_orders o WHERE o.id = :orderId;

-- 2. invoice total = allocated (receipts + credit notes) + open
SELECT i.id, i.total_paise,
       COALESCE((SELECT SUM(a.amount_paise) FROM allocations a WHERE a.invoice_id = i.id),0) AS allocated,
       i.total_paise - COALESCE((SELECT SUM(a.amount_paise) FROM allocations a WHERE a.invoice_id = i.id),0) AS open_paise
  FROM invoices i WHERE i.id = :invoiceId;

-- 3. receipt amount = allocated + unallocated
SELECT r.id, r.amount_paise,
       COALESCE((SELECT SUM(a.amount_paise) FROM allocations a WHERE a.receipt_id = r.id),0) AS allocated
  FROM receipts r WHERE r.id = :receiptId;

-- 4. rollup vs raw: summary must equal the sum of that retailer's live bills
SELECT ros.outstanding_paise, ros.unallocated_credit_paise
  FROM retailer_outstanding_summary ros WHERE ros.retailer_id = :retailerId;

-- 5. every journal entry for that invoice nets to zero
SELECT je.id, SUM(jl.amount_paise) AS should_be_zero
  FROM journal_entries je JOIN journal_lines jl ON jl.entry_id = je.id
 WHERE je.ref_type = 'invoice' AND je.ref_id = :invoiceId
 GROUP BY je.id;

-- 6. tenant identity: SUM(outstanding - unallocated) == AR balance in the ledger
SELECT (SELECT SUM(outstanding_paise - unallocated_credit_paise)
          FROM retailer_outstanding_summary WHERE tenant_id = :tenantId) AS summary_ar,
       (SELECT SUM(jl.amount_paise) FROM journal_lines jl
          JOIN accounts a ON a.id = jl.account_id
         WHERE jl.tenant_id = :tenantId AND a.code = 'AR') AS ledger_ar;
```

Query 6 is the identity the code documents. Comparing raw `SUM(outstanding_paise)` against ledger AR without subtracting `unallocated_credit_paise` produces a by-design gap, not a defect.

---

## 8. Delivery, notifications, jobs, sync, files, docint, integrations

### 8.1 Delivery — real

`delivery/trips.service.ts` drives `tripMachine` / `stopMachine`. `depart` (~line 356) refuses when the driver has no GPS consent row (`gps_consent_missing`).

`deliveries.service.ts` `record` / `recordInTx`: one call; the outcome is **derived** from the submitted lines by `outcomeOf` (lines 504-512) — all delivered → `delivered`; all zero or returned → `failed`; otherwise `partial`. It is never sent by the client. `failed` walks the stop to `failed`, leaves the invoice open, credits nothing, and requires no proof. On partial or delivered, `OrdersService.recordDelivered` plus `applyFulfilmentEvent` update the order; a shortfall or return raises one credit note through `CreditNotesService.raiseForDelivery`, which also restocks (short-loaded → godown, damaged → damage bin). The delivery module posts no ledger row of its own. Emits `DeliveryRecorded`.

POD: object key from `files.uploadUrl`, or inline bytes on the local storage driver; up to 10 evidence rows per delivery (`MAX_POD_PER_DELIVERY`). `addPod` accepts late proof.

Cash collection (`collections.service.ts` `record` / `collectInTx`) calls `ReceivablesService.recordReceipt` **synchronously in the same transaction** — a real numbered receipt and balanced journal (cash to `CASH_VAN` until settlement), not a deferred write. Van sales share the same path. Emits `CollectionRecorded`. Settlement (`settlement.service.ts`) reconciles the van's cash and expenses into one journal entry at trip close.

GPS (`delivery/gps.service.ts`, 282 lines; controller `delivery.controller.ts:195-202`): `d.gps.points` bypasses the sync queue with per-device fairness (flood → wait, batch dropped), a consent gate at depart, and 90-day retention of `trip_points` (`DEFAULT_GPS_RETENTION_DAYS`, swept by `retention.ts`). `d.gps.trace` reads the live map and is audited as `gps.live_map_read`.

**Missing:** no trip/crew reassignment procedure. `assertCrewOrDesk` (`delivery.internals.ts:191`) only checks whether the caller is still the trip's driver/helper or a desk role. `driverId` / `helperId` are set once at trip creation with no update endpoint.

### 8.2 Notifications — two real channels, one stub

Real: WhatsApp via the Meta Cloud API, template messages only (`notifications/adapters/whatsapp.adapter.ts`, env `WHATSAPP_ACCESS_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID`); SMS via MSG91 `sendsms` v2 (`adapters/sms.adapter.ts`, env `MSG91_AUTH_KEY` + `MSG91_SENDER_ID`).

Stub: **push is always `StubProvider`** (`adapters/index.ts:14`, "push is stubbed in this slice") — no FCM or Expo push sender exists. All three channels are forced to `StubProvider` when `NODE_ENV=test`.

`NOTIFICATION_EVENT_TYPES` (`notifications/events.ts:35`): `OrderConfirmed, OrderCancelled, OrderSubmitted, InvoiceIssued, DeliveryRecorded, ReceiptRecorded, retailer.identity_linked`. Each event payload alone drives the template — the source table is never re-read. `OrderSubmitted` fans out a (stub) push to every owner/manager device rather than a shop message. `TripDeparted` is handled outside that list, registered directly at `backend/worker/src/jobs/notifications.ts:170` calling `announceTrip()` to produce `delivery_today` rows.

Inbound: `InboundService` (triage list / mark-handled) and the AI draft-order consumer (`backend/worker/src/jobs/ai.ts`, event `InboundMessageReceived`) are fully built on the consuming side, but **no webhook controller exists anywhere in the repo** to receive a real WhatsApp or SMS message. `inbound_messages` is only ever inserted from specs (`rls.test.ts`, `ai.spec.ts`, `notifications.spec.ts`).

### 8.3 Outbox and jobs

`relayOutbox()` (`backend/worker/src/jobs/outbox-relay.ts`): batches of 100, up to 10 batches per tick, `FOR UPDATE SKIP LOCKED`, at-least-once, exponential backoff `30s * 2^(n-1)` capped at 1 hour, `DEFAULT_MAX_ATTEMPTS=8` (~2 hours) then `dead_lettered_at` is set. Runs every minute under `withSystem` (BYPASSRLS). Event types with no registered handler are never claimed, only logged as pending.

`backend/worker/src/jobs/retention.ts` runs 10 bounded sweeps hourly: `idempotency_keys` 24h, `sync_ops` / `sync_tombstones` 180d, `trip_points` 90d, `sync_errors` 90d after resolved, `outbox_events` 30d after published, docint derived rows 180d, `ai_order_drafts` 180d, `ai_forecasts` 90d.

### 8.4 Sync

Procedures `sync.manifest`, `sync.pull`, `sync.upload`, `sync.errors.list` (`backend/libs/core/src/modules/sync/sync.controller.ts`). `upload` is designed never to answer 4xx — rejections land as 2xx plus `sync_errors` rows, outcomes are durable in `sync_ops`, and a business error is a `SyncRejection`. `SyncRegistry` (532 lines) lets modules register per-table pull/upload handlers on `onModuleInit`. `SYNC_PULL_TABLES` (`backend/libs/database/src/sync-tables.ts`) enumerates every device-held table with its role set (SALES / DELIVERY / WAREHOUSE / SHOP / EVERY_DEVICE) and tombstone scope; no cost or margin table is ever in that list.

### 8.5 Files

`backend/libs/core/src/platform/object-storage.ts` — two drivers behind `OBJECT_STORAGE_DRIVER`: **local** (default; writes to `OBJECT_STORAGE_DIR`, default `backend/.storage`, HMAC-signed relative URLs served and verified by `StorageController`) and **s3** (hand-rolled SigV4 presigned PUT/GET; env `OBJECT_STORAGE_S3_BUCKET/_REGION/_ACCESS_KEY_ID/_SECRET_ACCESS_KEY` or `AWS_*` fallbacks, `OBJECT_STORAGE_S3_ENDPOINT`). No AWS SDK dependency. Per-domain upload/read ACLs are enforced inside `FilesService` (an `UPLOADERS` map plus a `mayRead` switch), not in the guard; a document's read visibility follows the owning row's RLS. `@dos/core/documents` renders invoice, credit note, challan and receipt PDFs with its own dependency-free renderer, white-labelled from `tenant_settings` branding keys, in the worker job `documents.pdf.render`, storing under `tenant/{tenantId}/documents/…` and exposing `pdfObjectKey`.

### 8.6 Docint

Four-step pipeline `qr-read → extract → validate → match`, one pg-boss queue per step, `singletonKey = documentId`. `docintConfig()` (`backend/libs/core/src/modules/docint/pipeline/config.ts`) selects engine `stub` (deterministic, no network) under `NODE_ENV=test` / `VITEST` / no `ANTHROPIC_API_KEY`, else `anthropic`; overridable with `DOCINT_ENGINE`. Model `claude-sonnet-5`, escalation `claude-opus-5` (`DOCINT_MODEL` / `DOCINT_ESCALATION_MODEL`), `DOCINT_AUTO_ESCALATE` default true, `DOCINT_INLINE_JOBS` runs the pipeline inline instead of in the worker. QR/IRN is verified only when `DOCINT_IRP_KEYS` (JWKS) is configured; otherwise it is decoded only. Commit is `procurement.grns.post`, which writes lots, `grn` ledger rows and costs.

### 8.7 Integrations

File bridge only — no live third-party API call exists in this module. Exports render on the single `exports.render` queue: `tally_xml`, `gstr1_json`, `sales_register_{xlsx,csv}`, `outstanding_{xlsx,csv}`, `eway_bill_json`, `einvoice_json`. The last two are produced by `renderEwayBillJson` / `renderEinvoiceJson` (`backend/libs/core/src/modules/integrations/renderers/files.ts:465,508`) as JSON bundles shaped for NIC / GSTN bulk upload by a human — there is no outbound call to any government API, and billing's IRN field is a stub. Imports are the generic mapped CSV/XLSX importer (`imports.run`) plus Tally / FieldAssist / Tradeezee fixtures used in tests and demos. No maps or geocoding integration exists anywhere in the codebase.

---

## 9. Frontend as implemented

**Shape.** Every app is one Expo codebase (expo-router) for web, Android and iOS. A screen imports only `@dos/ui` — never `react-native` or `react-dom` — and ESLint fails the build otherwise. Metro resolves the renderer through the package's entry points (`src/index.web.ts` → `./web` real DOM with HTML tables and print; `src/index.native.ts` → `./native`). The layout vocabulary is fixed: `Screen, Box, Stack, Row, Scroll, List, Pressable, Img, Link, Txt`. Platform-specific behaviour lives in `@dos/ui/platform` as `.web.ts` / `.native.ts` pairs behind one signature (storage, documents/print, camera, location, files, haptics, share, crypto).

**Shell and breakpoints.** `frontend/libs/ui/src/tokens.ts`: `deskBreakpoint = 1024`, `railCollapseBreakpoint = 1100`, `railWidth = 172`, `railCollapsedWidth = 56`. `useViewport()` (`web/viewport.ts`, mirrored in `native/viewport.ts`) sets `kind: width >= 1024 ? 'desk' : 'phone'`. `shell.tsx` renders the left rail at desk and bottom tabs below, both from the same `SECTIONS: NavSection[]` array in each app's `src/nav.ts`. The shell follows the viewport, not the app.

**Sign-in form (test selectors).** All six member apps use a byte-identical `app/sign-in.tsx` from the template:

| Element | Selector | Label / text |
|---|---|---|
| Username | `testID="sign-in-username"`, `autoFocus` | label `t('app.username')` → "Username" |
| Password | `testID="sign-in-password"`, `secure`, `onSubmit=submit` | label `t('app.password')` → "Password" |
| Submit | `testID="sign-in-submit"`, `loading={busy}` | "Sign in" (`t('app.signIn')`) |
| Error | `<ErrorState message={error}/>` (`frontend/libs/ui/src/{web,native}/feedback.tsx`) | rendered under the password field, only when `error !== null` |

`TextInput.label` is always rendered above the field per the kit contract (`frontend/libs/ui/src/types.ts`); no `placeholder` prop is passed on sign-in, so automation must target the testIDs, not placeholder text. There is **no tenantId field** on any sign-in screen — `tenantId` is only sent when passed in code (`SignInOptions.tenantId`, `frontend/libs/api-client/src/client.ts`), and a multi-tenant user switches from the header after login. There is no dev auto-login and no query-parameter login shortcut anywhere in `frontend/`.

admin-app's sign-in differs materially: it imports `usePlatformSession` (not `useSession`) and posts to `POST /auth/platform/login`.

**Data flow.** `@dos/api-client` is the only caller of the backend. `createApiClient()` (`frontend/libs/api-client/src/client.ts`) builds two oRPC clients — `auth` against auth-service and `api` against this app's own service — sharing one in-memory access token, one single-flight refresh-on-401 retried once, and a `requestTimeoutMs` deadline (`link.ts`) so a dead connection reads as "No connection" rather than hanging on the OS TCP timeout. `session.ts` provides `SessionStore` (six member apps) and `PlatformSessionStore` (admin) over a shared `BaseSessionStore` (subscribe/getSnapshot for `useSyncExternalStore`). The access token lives only in memory (`#accessToken`); the refresh token and a JSON session snapshot go through `TokenStorage` (`storage.ts`) under `dos.auth.refresh` and `dos.auth.session`, alongside `dos.device` from `src/api.ts`.

`newMutation()` returns `{ id: uuidv7(), idempotencyKey: uuidv7() }`. `useMutation` keys the intent by `intentHash(input)` (deep, key-sorted JSON): the same input reuses id and key (safe retry, safe double-tap), a different input starts a new intent, `reset()` forces one manually. `useQuery` reads through a shared `QueryCache` (`cache.ts`), repaints from cache on mount then revalidates behind it, default `staleTime` 30 000 ms, and is gated by `readsAllowed(sessionState, enabled)` so it never fires while signed out or hydrating. There is no TanStack Query and no Zustand.

**Offline.** All seven apps carry `@dos/offline` as a dependency from the template, but only **sales (7 files), warehouse (7 files) and delivery (13 files)** import from it; owner, manager, retailer and admin import nothing (retailer is online-only by design). Local tables are not hardcoded — `frontend/libs/offline/src/schema.ts` builds one SQLite table per entry of the server-published `sync.manifest` (column types from `SyncColumnType`), plus four fixed system tables: `_sync_state`, `_outbox`, `_gps_buffer`, `_sync_errors`. `index.web.ts` opens expo-sqlite's web build when the page is cross-origin isolated, otherwise an in-memory store, and says so honestly in the connection strip; `index.native.ts` always uses expo-sqlite on device. Screens never write SQL and never call `sync.*` directly.

**Permissions on device.** A route declares the contract procedures it needs; `app/_layout.tsx`'s `can(item)` calls `isAllowed(permissionFor(item.permission), role)` from `@dos/contracts` — the identical matrix the server enforces (`backend/libs/contracts/src/permissions.ts`). An item with no `permission` field always shows. The server still answers 403 for a hidden route reached directly; the app carries no second permission list.

---

## 10. Environment, logging, monitoring, deployment, migrations, backup, seed

**Environment.** `loadDotenv()` (`backend/libs/database/src/env.ts`) walks up to 6 parent directories from `process.cwd()` for `.env`, loads with `override:false` (real env wins), returns the path or `null`. `@dos/core`'s `loadEnv()` (`backend/libs/core/src/platform/config.ts:27`) calls it only when `source === process.env`.

`Env` schema (`config.ts`): `NODE_ENV` (default `development`), `PORT` (default 3000, unused — services use `<NAME>_SERVICE_PORT`), `DATABASE_URL` (optional), `DATABASE_REPLICA_URL` (optional, falls back to primary), `APP_VERSION` (default `0.0.0`), `CORS_ORIGINS` (optional, comma-separated). `DATABASE_POOL_MAX` is read separately in `backend/libs/database/src/client.ts:41-45`, default 10.

`backend/.env` locally sets `NODE_ENV`, `DATABASE_URL`, `APP_DB_ROLE`, `ANTHROPIC_API_KEY`, `AUTH_ACCESS_TTL_SECONDS`, `AUTH_REFRESH_TTL_DAYS`, `AUTH_JWT_PRIVATE_KEY`/`AUTH_JWT_PUBLIC_KEY`, `DOCINT_ENGINE`, `DOCINT_INLINE_JOBS`. `OBJECT_STORAGE_*`, `CORS_ORIGINS`, `DATABASE_POOL_MAX` and `DATABASE_REPLICA_URL` are unset and fall back to code defaults. `backend/.env.example` documents every key including the docint set and `OUTBOX_MAX_ATTEMPTS=8`.

**CORS.** `corsOptions(env)` (`backend/libs/core/src/service/bootstrap.ts:78-101`): `credentials:false` (tokens go in `Authorization`, never cookies); methods `GET/POST/PUT/PATCH/DELETE/OPTIONS`; allowed request headers `authorization, content-type, x-idempotency-key, x-support-grant`; `exposedHeaders: ['x-request-id']`; `maxAge: 86400`. A request with no `Origin` header always passes (curl, native apps). Otherwise the origin must be in `CORS_ORIGINS`, or — only in non-production with `CORS_ORIGINS` empty — any `http://localhost(:port)` / `http://127.0.0.1(:port)`. In production `CORS_ORIGINS` must be set or every browser call is blocked.

**Logging.** No pino configuration and no structured-logging wrapper anywhere in `backend`. `createServiceApp` (`bootstrap.ts:33-40`) passes `logger: options.logger ?? env.NODE_ENV !== 'test'` to `FastifyAdapter`, so Fastify's default pino instance logs JSON lines to stdout in dev and prod and is silenced under `NODE_ENV=test`; `logger:false` is also forced for the all-in-one boot (`all-in-one.ts:89`) and for specs. No level, format or transport is configured. Nothing in the codebase sets an `x-request-id` response header.

**Error shape.** No custom `ExceptionFilter` or `@Catch` exists in `backend/libs/core`. `ORPCModule.forRoot({ interceptors: [onError((error) => console.error(error))] })` (`bootstrap.ts:19`) only logs server-side. Client-facing serialisation is oRPC's own `toORPCError()` / `ORPCError.toJSON()`, which wraps any thrown non-`ORPCError` into `{defined:false, code:'INTERNAL_SERVER_ERROR', status:500, message:'Internal server error', data:undefined}` — **a 500 never leaks a stack**. Business errors are explicit `ORPCError(code, {message, data})` throws (`FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `BAD_REQUEST`, `SERVICE_UNAVAILABLE`, `INTERNAL_SERVER_ERROR`) in `authz.ts:38`, `db-required.ts:6`, `idempotency.ts:67-69`, `numbering.ts:48` and per module.

**Health.** `GET /health` (`backend/libs/core/src/modules/health/health.controller.ts`) is unguarded and returns `{ ok: boolean, db: 'up'|'down' }`, pinging the DB in a try/catch so it never throws. `contract.health.ping` additionally returns `{ ok, version: APP_VERSION, db, time }`. There is no `/ready` vs `/live` split and no dependency breakdown beyond the database.

**Monitoring.** A grep for `prometheus|otel|opentelemetry|sentry|datadog` across `backend/**/*.ts` returns zero hits. No metrics endpoint, no tracing, no error-reporting SDK.

**Rate limiting.** No general HTTP limiter and no `@nestjs/throttler`. Only two narrow throttles exist: the password-reset limiter (`otp_rate_limits`, 5/hour per key, `auth.service.ts:795-807`) and the GPS ingestion budget (`delivery/gps.service.ts:28-120`, per-device points-per-minute cap returning `{throttled:true, retryAfterSeconds:30}` — not an HTTP 429).

**Deployment.** `backend/infra/docker/Dockerfile` is multi-stage on `node:24-alpine` with `pnpm@11.25.0` via corepack; `ARG SERVICE` selects `@dos/<service>-service`, `@dos/worker` or `@dos/all-in-one`, builds and `pnpm deploy --prod` into `/out/app`, copies migrations, runs as `USER node`, and defaults to `ENV DOS_MODE=all WORKER_INLINE=1` (all-in-one), exposing 3100 and 3000-3007. Its header states it has never been built on this Mac. `backend/infra/docker-compose.yml` runs only `postgres:17-alpine` on 5432 (user/pass/db all `dos`) — no app services. `backend/infra/scripts/git-auto-push.sh` plus a launchd plist handle repository auto-push, unrelated to deployment. No Terraform/CDK/CloudFormation exists; no cloud deployment has been performed.

**Backup.** A grep for `pg_dump|pg_restore` across the backend tree returns nothing. No backup script exists in the repository. Local recovery is limited to re-running `pnpm db:seed`.

### 10.1 Seed account inventory

Three tenants (`backend/libs/database/src/seed.ts` + `backend/libs/database/src/seed-demo/tenants.ts`):

| Tenant | Scope | Shops | Owner | Manager | Accountant |
|---|---|---|---|---|---|
| Tarsun Enterprise (pilot, Kalyan West) | `tarsun` | 36, 4 beats | `sunil.tarsun` | `vikas.kadam` | `meena.joshi` |
| Sai Distributors (Dombivli East) | `sai:` | 32 (first 10 shared with Tarsun) | `prakash.salunkhe` | `sanjay.bhosale` | `nilesh.wagh` |
| Kalyan Agencies (Ulhasnagar) | `kalyan:` | 32 (first 5 shared with Tarsun and Sai) | `nitin.bhoir` | `ashok.kulkarni` | `swati.naik` |

Every distributor's roster shape: 1 owner, 1 manager, 1 accountant, 2 warehouse hands, 3 salespeople (the third sells only Too Yumm and is employed by the manufacturer), 4 delivery staff, 2 retailer-app users.

Tarsun's full roster (`backend/libs/database/src/seed-demo/people.ts:83-151`):

| Role | Usernames |
|---|---|
| owner | `sunil.tarsun` |
| manager | `vikas.kadam` |
| accountant | `meena.joshi` |
| warehouse | `dinesh.patil`, `kavita.sawant` |
| salesperson | `rahul.deshmukh`, `amit.pawar`, `pooja.shinde` |
| delivery | `ganesh.more`, `raju.yadav`, `santosh.kamble`, `iqbal.shaikh` |
| retailer | `ramesh.gupta`, `fatima.shaikh` |
| platform_admin | `dos.admin` (super; `POST /auth/platform/login`, admin-service :3007, no tenant) |

`ramesh.gupta` is one global user with a membership in all three tenants (the shop shared by all three); `fatima.shaikh` has two.

**Data volume and shape.** The global catalog (`seed-demo/catalog.ts`) is seeded once and shared by all tenants; `BRAND_KEYS` filters which brands a non-pilot tenant lists. Tarsun runs at `depth:'full'` (docint, integrations, claims, notifications, incentives, AI drafts, platform support, branding); Sai and Kalyan run at `depth:'core'` — orders → invoices → receipts → trips/deliveries plus AI forecasts and route plans, without docint/integrations/claims/notifications/incentives.

Sales data (`seed-demo/sales.ts:268-277`) spans the last 14 working days, 4-8 orders per day (fewer today), deterministic through a seeded `mulberry32` RNG (`makeRng(seedStr)`, `seed-demo/util.ts:43-51`) — the same seed string yields the same sequence every run, which is why the demo data is reproducible despite looking random. Final states are deliberately spread by age (`finalStateFor`, `sales.ts:262-266`): today's orders sit at `submitted`/`confirmed`; yesterday's at `packed`/`dispatched`; orders two or more days old at `delivered`/`closed` (70% closed). `INVOICE_ELIGIBLE` states are `packed | dispatched | delivered | closed`.

`restoreDemoAccess()` (`seed-demo/index.ts:99-141`) resets suspended and disabled statuses back to active on re-seed — the documented recovery from `pnpm smoke --destructive`.

Known seed defect already recorded in `docs/23-app-screens-and-api-gaps.md:957` (queued, unfixed): the seed's gross margin for the current month is negative.

---

## 11. Existing tests and CI

**Backend: 63 spec files**, all vitest, one `vitest.config.ts` per package (14 in total); `pnpm test` = `turbo run test`.

| Package | Spec files |
|---|---|
| `backend/libs/core` | 35 (all module business-logic specs live here) |
| `backend/libs/domain` | 10 |
| `backend/libs/database` | 3 |
| `backend/libs/contracts` | 5 |
| each of the 8 `*-service` packages | 1 `service.spec.ts` each (health, `/docs`, role gate, `describePermissionMatrix`) |
| `backend/all-in-one` | 1 |
| `backend/worker` | 1 (`outbox-relay.test.ts`) |

`describeDb` (database-backed) appears in **31** of those files and runs whenever `DATABASE_URL` resolves — always, locally, with `.env` present (`backend/libs/core/src/testing/setup.ts`). Those specs create their own fixtures with a unique run suffix, so the dev database accumulates test rows separately from seed data. Turbo runs `lint`, `typecheck` and `test` after `^build`, and `test` is the only task that receives `DATABASE_URL`.

**Frontend: 16 spec files** — `ui` 8, `api-client` 6, `offline` 2. **Zero test files exist inside any `frontend/*-app` package**; screens have no unit specs.

**Smoke.** `backend/tools/smoke-endpoints.mts` (2772 lines, `pnpm smoke`): signs in per service's primary demo role at auth-service, reads that service's own `/docs/openapi.json`, calls every operation with the published example or a body generated from live demo rows, classifies OK / EXPECTED / BROKEN, writes `backend/.smoke/<service>.json`, and exits non-zero on any BROKEN. Flags: `--service`, `--base` (all-in-one mode), `--only GET`, `--destructive`, `--run-tag`, `--verbose`. Mutating writes are tagged with `RUN_TAG`, defaulting to today's IST business date (`istDate()`), so same-day reruns replay the same rows while a run on a new day creates fresh ones that are never cleaned up. `--destructive` additionally exercises `cancel|delete|revoke|writeOff|disable` operations (`DESTRUCTIVE_PATTERN`, line 126).

**E2E.** No Playwright, Maestro, Detox or Cypress anywhere in the repository — checked in both workspaces' `package.json` and on the filesystem. No end-to-end suite exists.

**CI** — `.github/workflows/ci.yml`, one workflow, two parallel jobs with no `needs` between them:

- **backend**: `postgres:17-alpine` service container on 5432 → `pnpm install --frozen-lockfile` → `format:check` → `lint` → `typecheck` → `build` → `docs:readme:check` → `db:migrate` → `test`.
- **frontend**: installs backend, builds only `@dos/domain` and `@dos/contracts`, installs frontend, then `format:check` → `lint` → `typecheck` → `build`. It does **not** run `pnpm test`.

`pnpm smoke` is never invoked in CI.

**Scripts.** backend: `dev, build, lint, typecheck, test, test:watch, format, format:check, db:up, db:down, db:generate, db:migrate, db:seed, db:studio, docs:readme, docs:readme:check, auth:keygen, smoke, clean`. frontend: `dev, build, lint, typecheck, test, format, format:check, clean`.

---

## 12. Divergences from the blueprint

Each item is code-versus-document, deduplicated across readers. None has been verified beyond the reading that produced it; a later phase confirms or discards each one.

**1. `all-in-one` deployment package is absent from the layout tree.**
Blueprint says: `CLAUDE.md` layout tree lists only `backend/<role>-service` (auth, owner, manager, sales, warehouse, delivery, retailer), `backend/worker`, `backend/tools`, `backend/infra`.
Code does: `backend/all-in-one/src/main.ts` is a ninth runnable package with its own `vitest.config.ts`, `all-in-one.spec.ts` and launch.json entry on :3100, mounting every `SERVICE_DEFINITIONS` behind path prefixes per docs/26 §7.
Why it matters: a tester following the layout diagram would not know the package, its port or its test suite exist, although `smoke-endpoints.mts` explicitly supports it via `--base`.
Status: REFUTED — docs/22-source-of-truth.md §8 records a dated 2026-09-05 founder decision commissioning backend/all-in-one, and CLAUDE.md itself says docs/22 wins where they differ, so this is a later decision superseding the layout tree's silence, not an undocumented divergence (the tree also omits admin-service, another later-decided package).

**2. CI frontend job skips `pnpm test`.**
Blueprint says: `CLAUDE.md` — "Frontend checks: `pnpm lint`, `pnpm typecheck`, `pnpm test` (kit + client + offline specs), `pnpm build`, `pnpm format:check`."
Code does: `.github/workflows/ci.yml` frontend job runs only `format:check`, `lint`, `typecheck`, `build`, even though `frontend/package.json` defines `test: turbo run test`.
Why it matters: the 16 frontend unit specs are not a merge gate; a regression in `ui`, `api-client` or `offline` would not fail CI.
Status: REFUTED — CLAUDE.md's line explicitly labeled the CI frontend job already omits `pnpm test`, matching `.github/workflows/ci.yml` exactly; the quoted "Frontend checks" line is a separate, unlabeled list of workspace checks, not a description of what CI runs.

**3. Access token survives logout, user-disable and tenant suspension on business services.**
Blueprint says: `docs/22-source-of-truth.md` §7 and CLAUDE.md describe sign-in, refresh and logout as symmetric session controls without noting that logout has no immediate effect on outstanding tokens.
Code does: `backend/libs/core/src/modules/tenancy/tenant.guard.ts` (`canActivate`, lines 135-183) verifies the JWT by signature and `exp` alone with `node:crypto`, with no database call, on all six tenant services and admin-service; `backend/libs/core/src/modules/auth/auth.service.ts` `logout()` (lines 321-336) only sets `auth_sessions.revoked_at`. Suspension likewise bites only at the next refresh (comment at `auth.service.ts:290-295`).
Why it matters: a logged-out or just-disabled user's access token keeps working on business endpoints for up to 15 minutes. Intentional (stateless verification for scale), but a real window a tester must know about before filing it as a defect.
Status: REFUTED — this behavior is filed under CLAUDE.md's own "Things that look wrong but are intentional" section, which already documents synchronous, database-free, 15-minute access-token verification as deliberate; docs/22 §7 never describes logout as a symmetric session control, so doc and code agree.

**4. ADR 0002 says `tenant_id uuid`; the schema stores `text`.**
Blueprint says: `docs/adr/0002-tenancy-rls.md` — "Shared schema, `tenant_id uuid NOT NULL` on every tenant table".
Code does: `backend/libs/database/src/schema/columns.ts:21` — `tenantIdColumn = () => text('tenant_id').notNull()`; `id()` at line 6 is also `text`, holding a client-generated UUIDv7.
Why it matters: direct-SQL fixtures written with `::uuid` casts, or a column-type check against `information_schema`, will not match the ADR. The choice is justified at the callsite (ADR 0001, PowerSync-era text ids); the ADR document is stale.
Status: CONFIRMED

**5. OTP documented as a near-term layer; entirely absent from code.**
Blueprint says: `docs/22-source-of-truth.md` §7 — "OTP (SMS / WhatsApp) is a later enhancement layered on top of username + password, not a replacement."
Code does: no OTP contract procedure exists in `backend/libs/contracts/src/auth.ts`; the `otp_rate_limits` table is consumed only by the password-reset limiter (`auth.service.ts:796-809`). No code path issues, verifies or resends an OTP.
Why it matters: no OTP endpoint, row or SMS delivery exists to test; even password-reset delivery is a `console.warn` stub outside production (`auth.service.ts:821-831`).
Status: CONFIRMED

**6. The `closed` order state is unreachable.**
Blueprint says: `docs/22-source-of-truth.md` line 138 — "Order: draft → submitted → confirmed → picking → packed → dispatched → delivered | partially_delivered → closed".
Code does: the `close` event exists in `backend/libs/domain/src/state-machines/order.ts` and `closed` is a DB enum value, but nothing calls `transition(order.state,'close')` or writes `state:'closed'`. `closed` appears only in read-side filters (`orders/fill-rate.ts:24`, `orders/sales-aggregate.ts:57`, `billing/invoices.service.ts:202`).
Why it matters: delivered orders stay permanently at `delivered`/`partially_delivered`; any report or logic distinguishing `closed` from `delivered` is untestable end to end. (Note the seed's `finalStateFor` writes `closed` directly for older orders, so the state appears in data without ever being reachable through the API.)
Status: CONFIRMED

**7. Owner-approval gates are narrower than the diagrammed flow.**
Blueprint says: `docs/22-source-of-truth.md` (~lines 109-111) captions the owner approval step "Approve / reject — price variance, credit, MOV, bargain".
Code does: `approvalFlags()` (`backend/libs/core/src/modules/orders/orders.internals.ts:140`) computes only `credit_limit`, `bargain` and `below_floor`. No minimum-order-value check exists anywhere in the orders module. Three of the seven declared `ApprovalKind` values — `return`, `scheme_override`, `manual_price` — are never inserted by any code path.
Why it matters: an order breaching a minimum order value is auto-confirmed regardless of value, and three declared approval kinds can never appear in a real approvals queue.
Status: CONFIRMED

**8. `van_load` is a dead enum value.**
Blueprint says: `docs/adr/0003-stock-ledger-lots.md` lists `van_load` and `van_unload` as the pair of reasons for vehicle load and unload.
Code does: `backend/libs/core/src/modules/warehouse/load-sheets.service.ts:379-398` posts godown → vehicle load-out as `transfer_out`/`transfer_in`. A repository-wide grep of source finds zero writes of `'van_load'`; it exists only as an enum member and in generated type declarations.
Why it matters: filtering the ledger by `reason='van_load'` returns nothing; real load-outs are indistinguishable by reason from a plain warehouse transfer, and only `ref_type='load_sheet'` disambiguates them.
Status: CONFIRMED

**9. Van-unload settlement uses an asymmetric reason pair.**
Blueprint says: ADR 0003's enum implies `van_load`/`van_unload` mirror `transfer_out`/`transfer_in` as a matched pair.
Code does: `backend/libs/core/src/modules/delivery/settlement.service.ts:191-215` posts the outbound leg as `van_unload` but the inbound leg as `transfer_in` — two different reason families for the two legs of one movement.
Why it matters: any reconciliation that expects reason pairs to be symmetric, or a query of `reason IN ('van_load','van_unload')`, misses half of every settlement.
Status: REFUTED — ADR 0003 only declares the reason enum as a flat list and never states van_load/van_unload must mirror transfer_out/transfer_in as a matched pair; the actual governing design doc, docs/plans/delivery.md (citing ADR 0013), explicitly specifies the asymmetric van_unload + transfer_in pair as intended, matching the code.

**10. No automated damage or expiry detection.**
Blueprint says: neither `docs/22` §5 nor CLAUDE.md claims automatic detection — this is a gap against reasonable expectation, not a documented contradiction.
Code does: `damage` and `expiry_writeoff` are reachable only through the manual `stock.adjust` procedure (`AdjustmentReasonSchema`, `backend/libs/contracts/src/inventory.ts:75-81`, role STOCK_WRITERS). No worker job scans `stock_lots.expiryDate`. Damage found at the gate is tagged `reason:'grn'`, not `damage` (`procurement/grn.service.ts:381-389`).
Why it matters: an expired lot stays fully sellable and on hand until a human runs the adjust endpoint; `nearExpiryOnly` / `expiringBefore` on `stock.balances` is a read-only alert surface, not enforcement.
Status: REFUTED — docs/03-scope-and-must-not-build.md explicitly defers the "near-expiry ladder" to v1/post-pilot, and docs/05 together with docs/22 §5 describe damage/expiry capture as a deliberate human review step ("swipe short/damaged"), so the absence of automated detection is documented scope, not an undocumented gap.

**11. A dead pricing engine coexists with the live one.**
Blueprint says: `docs/adr/0008` and `docs/22` describe one engine, `priceOrder()`.
Code does: `backend/libs/domain/src/pricing/resolve-price.ts` implements a second, simpler `resolvePrice()` with its own test file and zero production callers; only `priceOrder()` (`schemes.ts`) is wired through `quote.service.ts` and `orders/pricing-lines.ts`.
Why it matters: reading or extending the dead engine gives the wrong precedence rules for what the application actually does.
Status: CONFIRMED

**12. Credit-limit enforcement is a submit-time approval flag, not a hard gate.**
Blueprint says: `docs/22`'s money flow describes credit control without pinning the trigger point.
Code does: `backend/libs/core/src/modules/orders/orders.service.ts:266` calls `approvalFlags()` at submit; a breach in `strict`/`stop` mode appends `'credit_limit'` to `approvalFlags[]` rather than rejecting (`orders.internals.ts:140-156`, asserted by `orders.spec.ts:370`). Nothing re-checks credit at confirm, pack or invoice issue.
Why it matters: an over-limit order is accepted and queued for approval rather than refused with a 4xx — a different API and UX contract from a hard block.
Status: REFUTED — docs/22 §4's order-to-cash diagram already routes an over-limit order to an approval request (S6 → O1 "approve/reject ... credit, MOV, bargain") rather than a hard rejection, matching the code's approvalFlags() behaviour exactly — the blueprint does pin the trigger point, and it agrees with the code.

**13. `outstandingPaise` is gross, not the AR ledger balance.**
Blueprint says: ADR 0004 as referenced from `docs/22` frames "outstanding" as the shop's AR position.
Code does: `backend/libs/core/src/modules/receivables/outstanding.ts:13-18` documents `Σ(outstanding − unallocated) == AR in journal_lines`, not `Σoutstanding == AR`; `outstandingPaise` is gross bill-open value and unallocated credit is tracked separately.
Why it matters: reconciling `retailer_outstanding_summary` against ledger AR without subtracting `unallocated_credit_paise` produces a by-design gap exactly the size of each retailer's on-account credit.
Status: REFUTED — ADR 0004 itself defines two separate quantities, the AR ledger balance and a distinct "ageing" figure equal to open invoices minus allocations, and the code implements both faithfully with a passing test enforcing outstandingPaise − unallocatedCreditPaise == arBalance; the mismatch is only that the field is named "outstanding" rather than the ADR's word "ageing", not a contradiction of intent.

**14. GPS is documented as unbuilt but is fully implemented.**
Blueprint says: `CLAUDE.md`, architecture facts — "GPS points bypass the queue via `/gps/points` (not built yet)."
Code does: `backend/libs/core/src/modules/delivery/gps.service.ts` (282 lines) and `delivery.controller.ts:195-202` implement `d.gps.points` and `d.gps.trace` with a consent gate at depart, per-device rate limiting, 90-day retention and audited live-map reads.
Why it matters: a tester following CLAUDE.md would skip a real feature with its own failure modes (`gps_consent_missing`, throttling).
Status: REFUTED — docs/22-source-of-truth.md §8 carries a later dated founder decision (2026-09-06, "BACKEND COMPLETE") that postdates the delivery/GPS module's own completion and declares the whole backend including it done, superseding CLAUDE.md's stale "not built yet" note that was simply never revised after the module shipped.

**15. Push notifications are permanently a stub.**
Blueprint says: `docs/22` and the notifications design imply three real channels once wired.
Code does: `backend/libs/core/src/modules/notifications/adapters/index.ts:14` returns `StubProvider` for push regardless of environment; only WhatsApp (Meta Cloud API) and SMS (MSG91) have real adapters.
Why it matters: any test expecting a device to receive an actual push — for example the order-needs-approval fan-out to owner and manager phones — will only ever see a queued row in the database.
Status: REFUTED — the code's own comment frames push as stubbed only "in this slice", with the FCM/Expo sender explicitly named as "a later addition on the same interface", and docs/22 §11's 2026-09-06 entry already lists "Expo push" as a decided platform call — the word "permanently" overstates a currently-stubbed but already-planned feature.

**16. No inbound WhatsApp/SMS webhook exists.**
Blueprint says: `backend/worker/src/jobs/ai.ts` comments and `backend/libs/core/src/modules/ai/inbound.ts` describe the WhatsApp webhook turning a shop's text into a draft order end to end.
Code does: no controller in the repository receives an inbound message; `inbound_messages` is only ever inserted from specs. The AI draft consumer and the `InboundService` triage screen are built but unfed.
Why it matters: the "shop texts in an order" flow cannot be exercised end to end; a tester must insert `inbound_messages` rows directly.
Status: CONFIRMED

**17. e-way bill and e-invoice are file exports, not live portal integrations.**
Blueprint says: `docs/22` and the integrations module header list "e-invoice / e-way bill bundles", readable as live IRN generation and e-way-bill issuance.
Code does: `backend/libs/core/src/modules/integrations/renderers/files.ts:465,508` (`renderEwayBillJson`, `renderEinvoiceJson`) produce downloadable JSON shaped for manual NIC/GSTN bulk upload. Billing's IRN field is a stub. No outbound call to any government API exists.
Why it matters: an invoice never acquires a real IRN or e-way-bill number automatically; the only verifiable behaviour is the exported file's JSON shape.
Status: REFUTED — docs/10-integrations.md (R05) explicitly specifies no live IRN/e-way-bill generation for now, deferring it to a revenue threshold and post-pilot GSP sandboxes; the integrations module's own comment ("stubs on purpose: recorded fields, never a GSP call") matches this design decision, and no docs/22 entry claims live portal integration.

**18. The `TripDeparted` notification handler is outside the module's own event list.**
Blueprint says: `backend/libs/core/src/modules/notifications/events.ts` documents `NOTIFICATION_EVENT_TYPES` as the complete set of outbox events the notifications module consumes.
Code does: `TripDeparted` is registered directly in `backend/worker/src/jobs/notifications.ts:170` (calling `announceTrip`), bypassing `events.ts` entirely.
Why it matters: auditing "which events produce a notification" from `events.ts` alone misses the `TripDeparted` → `delivery_today` path.
Status: REFUTED — the worker file's own header comment already discloses that TripDeparted is handled separately from the notifications module's dispatch list, and delivery's own blueprint (docs/plans/delivery.md) lists TripDeparted as consumed by notifications as a cross-module event, which the module-boundary rule requires to be wired at the worker layer; events.ts's "this module consumes" wording scopes its own internal dispatch, not every registerOutboxHandler call in the codebase.

**19. No trip or crew reassignment procedure.**
Blueprint says: `docs/22`'s delivery flow implies a driver or helper can be swapped mid-day; `backend/libs/core/src/modules/delivery/delivery.internals.ts` carries a comment describing "a helper reassigned mid-day" as normal.
Code does: `reassign` appears only in a comment. `driverId` and `helperId` are set once at trip creation (`trips.service.ts` `create`); no update endpoint was found. `assertCrewOrDesk` (`delivery.internals.ts:191`) only checks membership, it does not change it.
Why it matters: swapping crew on an existing trip requires cancelling and recreating it; whether that is intended needs confirming.
Status: REFUTED — docs/22's order-to-cash flow contains no mention of mid-day crew swapping; the "helper reassigned mid-day" phrase is illustrative prose inside a code comment explaining a 403 scenario, not a design commitment, and docs/25's phase-2 backlog (P2-17) explicitly defers trip/crew reassignment, confirming code and blueprint agree it is intentionally absent today.

**20. retailer-app has screens absent from the screen inventory.**
Blueprint says: `docs/23-app-screens-and-api-gaps.md` §6.1 enumerates retailer screens R1-R13 with no returns screen and no dues screen.
Code does: `frontend/retailer-app/app/returns.tsx` and `frontend/retailer-app/app/dues.tsx` exist as routes with no corresponding R-number.
Why it matters: using docs/23 as the retailer coverage checklist skips `/returns` and `/dues`, and neither maps to a recorded backend gap.
Status: REFUTED — docs/23 §6.1's R3 ("Outstanding", the pending-bills file) and R4's already-documented creditNotes.list/get calls ARE the dues and returns functionality; dues.tsx's own header comment cites R3 directly and calls the same receivables.outstanding.get procedure, and returns.tsx is explicitly billing.creditNotes.list surfaced under a friendlier route name — no undocumented backend gap exists.

**21. admin-app is entirely undocumented in the screen inventory.**
Blueprint says: `docs/23-app-screens-and-api-gaps.md` covers six apps; there is no admin or platform-admin section.
Code does: `frontend/admin-app` exists with 12 routes and its own `/auth/platform/login` sign-in flow.
Why it matters: the admin screens (distributors, subscriptions, support, users, audit) have never been enumerated against contract procedures the way the other six were, so permission cross-checks for admin have no blueprint reference.
Status: CONFIRMED

**22. admin-app config omits `touch` and `density`.**
Blueprint says: `docs/08` §0, paraphrased in the app-template's `config.ts` comment, requires every app's config to declare its UX-00 §5.2 touch floor (`field`/`floor`/`phone`/`desk`) and a density.
Code does: `frontend/admin-app/src/config.ts`'s `APP` block has `role`, `title`, `webPort`, `servicePort` but no `touch:` or `density:` line, unlike the other six apps.
Why it matters: `app/_layout.tsx` passes `touch={APP.touch} density={APP.density}` to `ThemeProvider` unconditionally; with those undefined, the admin console's tap-target sizing falls to the provider default, never verified against UX-00 for this app.
Status: REFUTED — frontend/admin-app/src/config.ts already declares both `touch: 'phone'` and `density: 'desk'` in its APP block, and app/_layout.tsx passes concrete values to ThemeProvider — the claim that these fields are missing is factually incorrect.

**23. `x-request-id` is exposed through CORS but never set.**
Blueprint says: no document claims request correlation; the code's own CORS configuration implies it (`backend/libs/core/src/service/bootstrap.ts:99`, `exposedHeaders: ['x-request-id']`).
Code does: a grep for `x-request-id|reqId|genReqId` across the backend finds only that CORS entry — nothing ever sets the header on a response.
Why it matters: there is no request id to correlate a client error with a server log line; this reads as unfinished plumbing rather than a working feature.
Status: CONFIRMED

**24. No backup tooling exists.**
Blueprint says: `docs/26-environments-and-configuration.md` §5 lists nightly `pg_dump` to S3 (versioned, Object Lock) under the test and prod columns.
Code does: a grep for `pg_dump|pg_restore` across the backend tree returns nothing; no backup script exists anywhere.
Why it matters: consistent with the doc's staging, but worth stating plainly — the local Postgres has no automated backup, and any dev-data loss beyond what `pnpm db:seed` regenerates is unrecoverable.
Status: REFUTED — docs/26-environments-and-configuration.md's table scopes nightly pg_dump-to-S3 to the test and prod columns only; the dev (local Mac) column specifies no backup step, so the local machine having no backup tooling is exactly what the blueprint calls for, not a divergence from it.

**25. No metrics, tracing or error-reporting SDK is wired.**
Blueprint says: `docs/26` §5 places Sentry and CloudWatch alarms under test/prod monitoring; §3 lists Sentry as a later account.
Code does: `prometheus|otel|opentelemetry|sentry|datadog` returns zero hits across `backend/**/*.ts`.
Why it matters: observability today is `GET /health` plus Fastify's raw stdout logger; no dashboards or alerting exist locally.
Status: REFUTED — docs/26 §3/§5 schedule Sentry and CloudWatch monitoring only for the test and prod environments (accounts opened when those environments exist), with the dev column listed as "—"; since no cloud deployment has been performed, zero SDK hits in the backend today matches the doc's own dev-stage plan rather than contradicting it.

**26. `pnpm smoke` leaves data behind in the pilot tenant.**
Blueprint says: `CLAUDE.md` "What is queued next" records this as a known item awaiting a fix.
Code does: `backend/tools/smoke-endpoints.mts` defaults `RUN_TAG` to today's IST date (`istDate()`), so a run on a new calendar day creates rows in the `tarsun` tenant that nothing deletes; only `--destructive`'s narrow `cancel|delete|revoke|writeOff|disable` set removes anything, and even then by breaking shared demo state rather than restoring it.
Why it matters: the pilot tenant's data grows across days of smoke runs, which can confuse UI walkthroughs that expect a fixed dataset. Recovery is re-running `pnpm db:seed` (`restoreDemoAccess()`).
Status: CONFIRMED

**27. Build-log counts are stale against the tree.**
Blueprint says: `docs/18-build-log.md`'s 2026-09-07 snapshot states 23 modules and 34 migrations.
Code does: `backend/libs/core/src/modules` holds 25 directories (23 business modules plus `health` and `identity`); `backend/libs/database/migrations/meta/_journal.json` holds 43 entries (idx 0-42).
Why it matters: a tester sizing coverage or checking migration state against the build log will get the wrong numbers; the counts must be taken from the tree.
Status: REFUTED — the "23 modules, 34 migrations" figures the item attributes to docs/18-build-log.md do not appear anywhere in that file; they are from CLAUDE.md and docs/22-source-of-truth.md §8 instead. docs/18-build-log.md's own latest entries already state 43 migrations, matching the tree exactly, so the document actually named in the item is not stale.

---

## 13. Key facts for testers

Quick reference. Every fact below is expanded, with its file path, in the section named.

### Services and processes (§1, §2, §10)
- Ports: auth 3000, owner 3001, manager 3002, sales 3003, warehouse 3004, delivery 3005, retailer 3006, admin 3007, all-in-one 3100, worker 3999 (launch.json only). Apps: 5173-5179 in role order owner → admin.
- `GET /health` is unguarded, returns `{ok, db:'up'|'down'}`, never throws. No `/ready` vs `/live` split.
- A 500 never leaks a stack — oRPC wraps any unhandled throw into `{defined:false, code:'INTERNAL_SERVER_ERROR', status:500, message:'Internal server error'}`.
- No global rate limiter. Only the password-reset limiter (5/hour per username and per IP) and the GPS per-device throttle (`{throttled:true, retryAfterSeconds:30}`, not HTTP 429).
- CORS `credentials:false`; a request with no `Origin` always passes; with `CORS_ORIGINS` empty in non-production, any localhost/127.0.0.1 origin is allowed.
- No Sentry, Prometheus, OpenTelemetry or Datadog anywhere. Logging is Fastify's default pino, unconfigured, silenced under `NODE_ENV=test`.

### Auth and permissions (§4)
- Access token: EdDSA JWT, 15 min, claims `sub, tid, role, sid, did, jti`. Refresh: 32 random bytes, 30 days, sha256 hash stored, rotates every use; reusing a rotated-away token revokes the session.
- Passwords: argon2id (m=19456, t=2, p=1), 8-72 chars, ≥1 letter and ≥1 digit. Lockout after 5 failures for 15 minutes.
- Seven membership roles; `platform_admin` is global and non-membership, via `/auth/platform/login` only.
- The permission matrix fails closed — a route with no entry throws 500. `requireServed` refuses a role the service does not serve, *before* the matrix check.
- Verification is stateless: logout, disable and tenant suspension take effect at the next refresh, not on a live access token (see divergence 3).
- Support access needs owner approval, then a 5-minute `x-support-grant` pass; read-only scope is GET-only; every use is audited.

### Database (§3)
- `app_rw` has no BYPASSRLS and is entered by `withTenant`; `app_worker` has BYPASSRLS and is entered by `withSystem` (sign-in, refresh, worker jobs).
- 204 FORCE RLS statements across 18 guarantee migrations. `_journal.json` holds 43 entries. No down-migrations exist.
- Retailer scoping goes through the denormalised `retailer_links.user_id`; joining `retailer_identities` from a tenant table causes Postgres 42P17 recursion.
- All ids, `tenant_id` included, are UUIDv7 stored as `text`, not Postgres `uuid`.

### Orders (§5)
- States: `draft, submitted, confirmed, picking, packed, dispatched, delivered, partially_delivered, closed, cancelled`. `closed` is never written by any code path (divergence 6).
- `applyFulfilmentEvent` is the only writer of `confirmed → picking → packed → dispatched` and the doorstep outcomes; idempotent by target state, not by key.
- Approval flags raised at submit: `credit_limit`, `bargain`, `below_floor`. Zero flags means the order self-confirms inside submit. No flag ever blocks the submit itself.
- `setLines` refuses any state other than `draft`. A retailer may cancel only its own draft/submitted order and never sees its own approval flags.
- Returns are credit notes, never an order state.
- Trip: `planned → loading → active → closing → settled | settled_with_variance`. Stop: `pending → started → arrived → delivered | partial | failed`.

### Inventory (§6)
- Ledger is append-only by trigger; `UNIQUE(tenant_id, idempotency_key)`; `CHECK qty_delta <> 0`; replays are silently skipped and balances not re-applied.
- Negative stock is a Postgres CHECK (`on_hand >= 0 OR negative_allowed`), surfaced as `BAD_REQUEST`. Vehicle locations are always `negativeAllowed:false`.
- `sellable_stock` (`security_invoker=true`, `on_hand - reserved > 0`) is the only stock surface a retailer can read; no cost, no per-lot split.
- Reservations are held at confirm, released at cancel, closed at pick regardless of which lot was picked.
- Reason by movement: pick = negative `sale`; load-out = `transfer_out`/`transfer_in`; settlement = `cycle_count` then `van_unload`+`transfer_in`; GRN (good and damaged) = `grn`; credit-note restock = `sale_return_saleable`/`sale_return_damaged`. `van_load` is never written (divergence 8).
- Drift check: `SELECT lot_id, location_id, SUM(qty_delta) FROM stock_ledger WHERE tenant_id=:t GROUP BY lot_id, location_id` against `stock_balances`.

### Money (§7)
- Precedence: tier → override (`final` blocks schemes) → schemes (best of all-stacked vs single exclusive) → bargain → cash discount reported, never deducted.
- GST is split per invoice line; rounding to the rupee happens once per invoice with the residue to `ROUND_OFF`.
- The invoice number is allocated last inside the transaction. Immutability is a trigger. Cancel is legal only pre-dispatch, pre-allocation, pre-credit-note; the number survives.
- Receipt modes: `cash, upi, bank_transfer, cheque, adjustment`. Double idempotency: mutation key plus `(deviceId, clientReceiptNo)`.
- Over-payment is uncapped; the excess becomes `unallocated_credit_paise` (on-account), not a separate advance record.
- Payment state is derived, never assigned. Ageing buckets are `b0_7, b8_15, b16_30, b31_60, b61_90, b90plus` on IST business dates; a not-yet-due bill counts as `b0_7`.
- Journal balance is a deferred constraint trigger checked at commit. Read is back-office only; posting is staff minus warehouse.
- The identity to reconcile is `Σ(outstanding − unallocated) == AR`, not `Σoutstanding == AR` (divergence 13).

### Delivery, jobs, sync, files (§8)
- Delivery outcome is derived from the submitted lines, never client-declared. `failed` leaves the invoice open and requires no proof.
- Doorstep cash writes a real numbered receipt and journal entry in the same transaction, to `CASH_VAN` until settlement.
- Outbox relay: 100/batch, ≤10 batches/tick, `FOR UPDATE SKIP LOCKED`, backoff 30s×2^(n-1) capped at 1 h, dead-letter after 8 attempts. Events with no registered handler are never claimed.
- `sync.upload` never answers 4xx; rejections are 2xx plus `sync_errors`. No cost or margin table appears in `SYNC_PULL_TABLES`.
- Object storage defaults to local disk with HMAC-signed relative URLs; the S3 driver is hand-rolled SigV4 with no AWS SDK.
- Docint runs the deterministic `stub` engine under test or without `ANTHROPIC_API_KEY`.
- Push notifications are always a stub; WhatsApp and SMS are real; there is no inbound webhook (divergences 15, 16).

### Frontend (§9)
- Sign-in selectors on every app: `sign-in-username`, `sign-in-password`, `sign-in-submit`; button text "Sign in"; labels render above the fields, never as placeholders.
- No `tenantId` field on any sign-in screen; no dev auto-login; no query-parameter login shortcut.
- admin-app signs in at `POST /auth/platform/login` via `usePlatformSession()`; the other six use `auth.login` via `useSession()`.
- Desk rail at viewport ≥ 1024 px (collapsing 1024-1100); phone tabs below. The shell follows the viewport, not the app.
- `@dos/offline` is imported only by sales, warehouse and delivery; the other four carry the dependency unused. Local tables are generated from `sync.manifest` plus `_sync_state`, `_outbox`, `_gps_buffer`, `_sync_errors`.
- Route hiding uses the same permission matrix as the server; the server still 403s a hidden route called directly.
- `useMutation` reuses id and idempotency key for an identical input, starts a new intent for a different one. `useQuery` `staleTime` is 30 000 ms.
- Debug APKs exist for all seven apps; `ios/` prebuild directories exist only for owner-app and sales-app.

### Seed and test data (§10)
- Password everywhere, every role, all three tenants and the console: `Dos@1234`. Console user: `dos.admin`.
- Tenants: `tarsun` (pilot, 36 shops, 4 beats, full depth), `sai` (32 shops, core), `kalyan` (32 shops, core). `ramesh.gupta` is a member of all three; `fatima.shaikh` of two.
- Sales data covers the last 14 working days from a deterministic seeded RNG; order final states are spread by age (today submitted/confirmed, yesterday packed/dispatched, older delivered/closed at 70%).
- Known unfixed seed defect: the current month's gross margin is negative.
- `pnpm smoke` tags writes with today's IST date and cleans up nothing; recovery from `--destructive` is re-running `pnpm db:seed`.

### Tests and CI (§11)
- Backend 63 spec files (core 35, domain 10, database 3, contracts 5, one per service ×8, worker 1, all-in-one 1); `describeDb` in 31 of them, running against the dev database whenever `DATABASE_URL` resolves.
- Frontend 16 spec files (ui 8, api-client 6, offline 2); zero specs inside any app package.
- No Playwright, Maestro, Detox or Cypress; no E2E suite exists.
- CI is two parallel jobs; the frontend job does not run `pnpm test`; `pnpm smoke` is never run in CI.
