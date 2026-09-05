# Scale rules (founder decision 2026-09-04: build for lakhs of users from now on)

These are build rules, not a later phase. A module is not "stable" until it follows them. Target load model to design and test against: 10,000 distributors, 100,000 staff devices, 2,000,000 retailers; peak 5,000 orders/minute, 20,000 concurrent sync uploads, 50,000 GPS points/minute, 1,000 invoice scans/minute.

## Services

1. **Stateless processes.** No in-memory session, cache or lock that another instance would not see. Anything per-request lives in `AsyncLocalStorage`; anything shared lives in Postgres or Redis. Every service must run as N replicas behind a load balancer with no code change (`docs/19`).
2. **One responsibility per service, one hot path each.** The sales and retailer services take the order volume; the delivery service takes GPS and collections; the owner service takes reads and approvals; the warehouse service takes scans and GRNs. Scale each independently.
3. **Bounded work per request.** Every list is cursor-paginated with a hard `limit` cap (≤ 500); every batch endpoint caps its array (`ops ≤ 500`, `items ≤ 2,000`); no endpoint ever loads a whole tenant's history. Long work (PDFs, imports, extractions, rollups, notifications) goes to the worker through the outbox or a pg-boss job and returns a job id.
4. **Idempotent by construction.** Every mutation carries a client `idempotencyKey` and a client-generated UUIDv7 id; retries and duplicate uploads are no-ops (`idempotency_keys`, `sync_ops`, `UNIQUE(tenant_id, idempotency_key)` on ledgers).
5. **Per-tenant fairness.** Rate limits and queue priorities are keyed by `tenant_id` (and device for sync) so one distributor's bulk import cannot starve another's orders. Add the limiter at the service edge as part of the identity module.
6. **Timeouts and backpressure.** Database statements carry a statement timeout; queue consumers use bounded concurrency; the sync upload answers 2xx for business rejections and 5xx only for transient faults so devices retry with backoff, never in a hot loop.
7. **Observability first.** Structured logs with `tenant_id`, `actor_id`, `request_id`, `service`; RED metrics per procedure; traces across service → database → worker. No metric, no launch.

## Database

8. **Every table keys on `tenant_id`; every index leads with it.** Already true. This is what makes tenant sharding a data move, not a redesign: Postgres partitioning by hash of `tenant_id`, then Citus-style distribution or per-shard clusters, all with the same schema and RLS.
9. **Ledgers are partition-ready and append-only.** `stock_ledger`, `journal_lines`, `trip_points`, `order_state_transitions`, `audit_log`, `messages` are partitioned by month when they pass ~50M rows; balances and rollups (`stock_balances`, `ageing_snapshots`, `daily_*`, `retailer_behaviour`, `owner_summary`) are the read surfaces so phones never scan ledgers.
10. **Reads scale on replicas.** Reporting, catalog and retailer-app reads go to read replicas; writes and `SELECT … FOR UPDATE` (numbering, balances) stay on the primary. Services carry two pools (`DATABASE_URL`, `DATABASE_REPLICA_URL`) from the start; a missing replica URL falls back to the primary.
11. **Connection discipline.** Services use small pools per instance; a transaction-mode pooler (PgBouncer) sits in front of the primary. All session state is `SET LOCAL` inside the transaction (`withTenant`), so transaction pooling is safe; never rely on session-level `SET`.
12. **One database, one schema, module-owned tables.** Cross-module reads are through the module's service or a read model, never ad-hoc joins into another module's tables (the exceptions marked in code must be replaced by services before v1). This keeps the option of one physical database per service open without rewriting queries.
13. **Hot rows avoided.** Numbering takes a row lock only for the milliseconds of `nextDocumentNumber`; counters and summaries are recomputed by the worker, not incremented on the request path. Van-sale invoice numbers are allocated on the device (`allocation_mode = device`) so offline crews never wait on the primary.

## Sync, files, messaging

14. **PowerSync is per-role, per-beat scoped** so a device syncs kilobytes, not a tenant; bucket definitions are part of the schema review for every synced table. Self-hosted PowerSync (Open Edition) is the plan of record because the hosted tiers price per peak concurrent client.
15. **Files go to object storage** (S3-compatible) with signed URLs; nothing binary passes through a service or the database. Image-heavy pipelines (docint) pull from storage in the worker.
16. **Notifications are queued, deduplicated and metered** per tenant (`messages.idempotency_key`, cost per row); WhatsApp sends use templates and honour the 24-hour window table.

## Frontend

17. **Apps never assume a small tenant.** Lists are virtualised and paginated, search is server-side (with the device DB for offline roles), the catalog syncs in scoped buckets, and images load lazily. Expo web builds ship per-route-group splits under a size budget.

## What this changes in the build queue

- Identity module adds per-tenant rate limiting and request ids alongside login.
- Database gains `DATABASE_REPLICA_URL` support and a partitioning migration plan for the six ledger tables before the first 1,000 tenants.
- The load model above becomes k6 scripts under `backend/infra/k6/` and runs in CI weekly against a staging stack.
