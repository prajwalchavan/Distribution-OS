# Distribution OS

An operating system for Indian FMCG distributors: one system for inbound stock (scan the manufacturer's
invoice, no typing), orders from salespeople and shopkeepers, GST billing, delivery trips, and collections.
Five surfaces (owner, salesperson, warehouse manager, delivery team, retailer) on one backend.

- Start here: [`CLAUDE.md`](CLAUDE.md) for commands and architecture, [`docs/`](docs/00-overview.md) for the blueprint.
- Layout: `frontend/` (Expo + Next.js apps and UI packages), `backend/` (NestJS API, worker, database), `shared/` (contracts, domain, config).
