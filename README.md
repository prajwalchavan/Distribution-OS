# Distribution OS

An operating system for Indian FMCG distributors: one system for inbound stock (scan the manufacturer's
invoice, no typing), orders from salespeople and shopkeepers, GST billing, delivery trips, and collections.
Five surfaces (owner, salesperson, warehouse manager, delivery team, retailer) on one backend.

- Start here: [`CLAUDE.md`](CLAUDE.md) for commands and architecture, [`docs/`](docs/00-overview.md) for the blueprint.
- Layout (`docs/19-layout-restructure.md`): `backend-services/` (five independently runnable NestJS services on one `core`
  library, one Postgres database, a worker), `frontend-apps/` (five Expo apps, web + Android + iOS; the legacy `frontend/`
  console stays until they land), `shared/` (contracts, domain, config).
- Run any service alone: `pnpm --filter @dos/owner-service dev` → http://localhost:3001/docs (sales :3002, warehouse :3003,
  delivery :3004, retailer :3005). Every service README lists each endpoint with sample request and responses.
