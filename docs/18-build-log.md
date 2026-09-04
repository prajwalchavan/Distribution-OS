# Build log — where we are, what is next

## RESUME HERE (updated 2026-09-04 19:40 IST, end of session 2)

Start of a new session, in this order:

1. `source` nothing special: run `brew services list | grep postgresql@17` (must be `started`; else `brew services start postgresql@17`). Node 24 via `fnm use`.
2. `pnpm install` (no-op if nothing changed), then `pnpm db:migrate` (no-op if current).
3. Demo dataset is DONE for one distributor (`backend/db/src/seed-demo/`, `pnpm db:seed` idempotent, prints sign-in ids per role; the demo owner is Sunil Tarsun). Known nit: `sales_orders.created_at` is "now" for every demo order (the business dates are on the invoices/transitions) — set `createdAt` per order when touching the seed next.
4. **Extend the demo to three distributors** (founder requirement, 2026-09-04): add tenants "Sai Distributors" and "Kalyan Agencies" with their own staff, a smaller catalog overlay and prices; ~10 shops linked to two distributors (`retailer_identities` shared, one `retailers` row + `retailer_links` per tenant); one shopkeeper user with `memberships` (role retailer) in two tenants; a few orders/invoices per extra tenant. Print sign-in ids for each owner.
5. `pnpm db:seed` twice (second run adds nothing), `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green, then update the table below and the session history.
6. Founder 2026-09-04 evening: BUILD FOR SCALE FROM NOW ON — every module follows `docs/20-scale-rules.md`; "stable" includes them. LAYOUT RESTRUCTURE in progress per `docs/19-layout-restructure.md` (founder answered 2026-09-04 evening: one DB, all five apps web+Android+iOS, ports 3001–3005 with Swagger). Backend half DONE 2026-09-04 (five services on 3001–3005 with /docs, core library, worker, generated READMEs with samples + CI check; 53 workspace tasks green). NEXT, in order: (a) frontend half — create `frontend-apps/{owner,sales,warehouse,delivery,retailer}-app` as Expo SDK 57 apps (web + Android + iOS) with `EXPO_PUBLIC_API_URL` per service, move `frontend/packages/*` to `frontend-apps/shared-ui`, port the Vite console pages into owner-app (Expo web), delete legacy `frontend/`, add each app to `.claude/launch.json` and `pnpm docs:readme`; (b) demo data for three distributors + shared shops; (c) `DATABASE_REPLICA_URL` + ledger partition plan per docs/20; then resume modules (warehouse/billing, receivables, delivery, identity).
7. Only then start the next module (warehouse + billing), one module to "stable" (backend + tests + console page + demo data + this log) before the next.

Rule reminders: never edit `shared/contracts/src/contract.ts`, `index.ts`, `app.module.ts` from a subagent — the main session wires; subagents may add TEMP lines and must remove them. Prettier is repo-wide (`pnpm format`); run it only from the main session. Migrations 0002/0003 are still local-only and may be regenerated (see gaps below); after the first deploy they become expand-only.

Read this first in a new session. Updated after every module. Newest first. Verified means: typecheck, lint and the module's DB-backed spec were green on the local database at the time.

## Local links (Browser pane entries in `.claude/launch.json`, or the commands in CLAUDE.md "Run things")

| What                                               | Link / command                                                                   | Notes                                                                                                                                                       |
| -------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner service                                      | http://localhost:3001/docs (Scalar API reference) · http://localhost:3001/health | roles owner, manager, accountant                                                                                                                            |
| Sales service                                      | http://localhost:3002/docs                                                       | salesperson (+owner/manager)                                                                                                                                |
| Warehouse service                                  | http://localhost:3003/docs                                                       | manager (+owner)                                                                                                                                            |
| Delivery service                                   | http://localhost:3004/docs                                                       | delivery (+owner/manager)                                                                                                                                   |
| Retailer service                                   | http://localhost:3005/docs                                                       | retailer only                                                                                                                                               |
| Owner console (legacy Vite, until owner-app lands) | http://localhost:5173                                                            | dev sign-in with the ids printed by `pnpm db:seed` (demo owner: tenant `01a06c94-5a6c-752a-ab3c-65716a47362f`, user `a66bacc8-4212-73e1-b75f-405af2960e36`) |
| Database viewer                                    | `pnpm db:studio` → https://local.drizzle.studio                                  | Drizzle Studio on `DATABASE_URL`                                                                                                                            |
| Database                                           | `postgres://dos:dos@127.0.0.1:5439/dos` (Postgres 17, Homebrew service)          | `psql` from `/opt/homebrew/opt/postgresql@17/bin`                                                                                                           |
| Flow Atlas                                         | https://claude.ai/code/artifact/43a7cc6d-5018-4df9-8d8a-e9e76ce04d1f             | source + PDF in `docs/design/`                                                                                                                              |

Calling a service without the app: every request needs `x-tenant-id`, `x-actor-id`, `x-actor-role` headers (placeholder auth) — the Scalar page has an auth panel for headers; the demo seed prints one user id per role.

## Status by module

| Module                                                   | Backend                                 | Console                          | Team app | Retailer app | Notes                                                       |
| -------------------------------------------------------- | --------------------------------------- | -------------------------------- | -------- | ------------ | ----------------------------------------------------------- |
| platform (tenancy, idempotency, sync, outbox, retention) | ✅ verified                             | dashboard                        | —        | —            | sync upload never 4xx (4 tests); worker retention hourly    |
| catalog + tenant-catalog                                 | ✅ verified (4 tests)                   | ✅ catalog, costs                | —        | —            | reference pattern (docs/16)                                 |
| retailers (beats, visits, links)                         | ✅ verified (7 tests)                   | ✅ list, add, credit             | —        | —            | identity linking back-office only (docs/17 item 27)         |
| pricing (lists, overrides, schemes, quote, bargains)     | ✅ verified (10 tests; engine 22 tests) | ✅ lists, schemes, bargain queue | —        | —            | engine compounds per step, priority order (review item 14)  |
| inventory + procurement                                  | 🔄 in progress (agent)                  | —                                | —        | —            | GRN → lots → ledger, costs from GRN                         |
| orders                                                   | ⏳                                      |                                  |          |              | needs pricing quote + inventory reserve                     |
| warehouse (pick/pack) + billing (invoice at pack)        | ⏳                                      |                                  |          |              | numbering at issue only                                     |
| receivables (receipts, allocations, journal)             | ⏳                                      |                                  |          |              |                                                             |
| delivery (trips, stops, POD, collections, GPS)           | ⏳                                      |                                  |          |              |                                                             |
| docint (invoice scanning)                                | ⏳                                      |                                  |          |              | eval set needed from Tarsun                                 |
| identity (Better Auth phone OTP)                         | ⏳                                      |                                  |          |              | replaces header placeholder                                 |
| demo seed (dummy data for all of the above)              | ⏳                                      |                                  |          |              | `pnpm db:seed` must produce a browsable Tarsun-like dataset |

## Known gaps to fix in the next schema regeneration (0002 is still local-only)

- `sales_orders_retailer_update` RLS allows retailer updates only when `state = 'draft'`, but the orders service lets a retailer cancel a `submitted` order → widen the USING clause to `state IN ('draft','submitted')`.
- `order_state_transitions` has staff-only writes; the orders service temporarily sets `app.actor_role = 'system'` for a retailer's own cancel → add a retailer-write policy and delete that branch (`orders.internals.ts`).

## Next steps (in order)

1. Finish inventory + procurement (agent), wire, verify, update this log.
2. Migration 0004: review deltas from docs/17 §A + `app_worker` BYPASSRLS role; regenerate types; re-run all specs.
3. `pnpm install` to refresh the lockfile (console now depends on `@dos/contracts`); full workspace green; `/init` refresh of CLAUDE.md.
4. Permanent local Postgres 17 as a Homebrew service on 5439 (data outside the session scratchpad); `.env` at repo root; demo seed with dummy data (brands/products from the real invoices, 3 beats, ~30 retailers, price lists, schemes, stock, a week of orders/invoices/receipts, 2 vehicles, trips).
5. Console pages: pricing (price lists, schemes, bargains queue).
6. Orders module + console approvals; then warehouse/billing, receivables, delivery; then the team app (Expo) screens per role, then the retailer app.

## Session history

- 2026-09-04 (session 1–2): research + synthesis + skeleton; schema (121 tables incl. docs/17 deltas, RLS, ledgers); catalog, retailers, pricing, inventory, procurement, orders, sync modules (API 53 tests, DB 5, domain 50); console with dashboard/catalog/costs/retailers/pricing/orders; review corrections adopted (docs/17); permanent Postgres 17 service on 5439; Flow Atlas artifact + PDF; demo seed in flight at session end.
