# Distribution OS

An operating system for Indian FMCG distributors: one system for inbound stock (scan the manufacturer's
invoice, no typing), orders from salespeople and shopkeepers, GST billing, delivery trips, and collections.
Seven apps — owner, manager (shared with the accountant), salesperson, warehouse, delivery, retailer, and a
platform-admin console — with one backend service each, on one Postgres database.

- Start here: [`CLAUDE.md`](CLAUDE.md) for commands and architecture,
  [`docs/28-running-it-locally.md`](docs/28-running-it-locally.md) to actually run the whole thing on a Mac,
  [`docs/22-source-of-truth.md`](docs/22-source-of-truth.md) for the product and the founder's decisions, and
  [`docs/18-build-log.md`](docs/18-build-log.md) for where the build is.
- `backend/`: one pnpm workspace. `libs/` (domain, contracts, config, database, core), `auth-service` :3000,
  `owner-service` :3001, `manager-service` :3002, `sales-service` :3003, `warehouse-service` :3004,
  `delivery-service` :3005, `retailer-service` :3006, `admin-service` :3007, `worker`. Every service runs alone
  (`pnpm --filter @dos/owner-service dev` → http://localhost:3001/docs) and its README lists every endpoint with
  sample request and responses.
- `frontend/`: one pnpm workspace. `libs/` (config, ui, api-client, offline, app-template) and one app per role
  on :5173–:5179 — each a single Expo codebase serving website + Android + iOS, pointed at its own service.
