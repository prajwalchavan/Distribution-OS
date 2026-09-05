# Distribution OS

An operating system for Indian FMCG distributors: one system for inbound stock (scan the manufacturer's
invoice, no typing), orders from salespeople and shopkeepers, GST billing, delivery trips, and collections.
Six apps (owner, manager + accountant, salesperson, warehouse, delivery, retailer), one backend service each,
one Postgres database.

- Start here: [`CLAUDE.md`](CLAUDE.md) for commands and architecture, [`docs/`](docs/00-overview.md) for the blueprint,
  [`docs/18-build-log.md`](docs/18-build-log.md) for where the build is.
- `backend/`: one pnpm workspace. `libs/` (domain, contracts, config, database, core), `auth-service` :3000,
  `owner-service` :3001, `manager-service` :3002, `sales-service` :3003, `warehouse-service` :3004,
  `delivery-service` :3005, `retailer-service` :3006, `worker`. Every service runs alone
  (`pnpm --filter @dos/owner-service dev` → http://localhost:3001/docs) and its README lists every endpoint with
  sample request and responses.
- `frontend/`: one pnpm workspace. `libs/` (config, ui, api-client, offline) and one app per role
  (`owner-app` today; the rest arrive once the backend is complete), each pointed at its service.
