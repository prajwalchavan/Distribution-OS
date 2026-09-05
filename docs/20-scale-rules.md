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

---

# Addendum — Ledger partition plan

Rule 9 above says the ledgers are "partition-ready" and get partitioned "when they pass ~50M rows". This
addendum is the concrete plan a future migration implements: which table takes which partition key, what
has to change in the schema before it can, how the cut-over happens with the services running, and how
long each partition is kept. It is written against the tables as they stand today (checked 2026-09-06);
where a table's primary key has to change, that change is named, because **PostgreSQL requires the
partition key to be part of every UNIQUE and PRIMARY KEY constraint on a partitioned table** — that one
rule decides almost every choice below.

## 1. Which table partitions by what

Two shapes, chosen by how the table is read, not by how big it is:

- **HASH on `tenant_id`** for a ledger that is read by tenant across all of time — a shop's statement,
  a lot's movement history, a trial balance for the year. Splitting it by month would make every one of
  those queries touch every partition. Hash keeps one distributor's history in one partition, which is
  also the shape a later move to per-shard clusters (rule 8) wants.
- **RANGE on the time column, monthly** for a ledger that is written once, read for a few days and then
  dropped or archived. Retention becomes `DROP TABLE` on a partition instead of a delete sweep, and the
  working set stays in cache because only the newest one or two partitions are hot.

| table           | partition                             | why                                                                                                                                                                               | trigger to do it                                                     |
| --------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `stock_ledger`  | **HASH (`tenant_id`)**, 64 partitions | Read as "this lot at this location, all time" and "this tenant, this month". Never dropped — it is the stock book. Hash spreads write load and keeps a tenant's history together. | 50M rows, or the table exceeding ~40% of `shared_buffers`            |
| `journal_lines` | **HASH (`tenant_id`)**, 64 partitions | Same: the trial balance and every statement of account read one tenant across a financial year. Legally retained, never dropped.                                                  | 50M rows, or when a year-end trial balance stops meeting its budget  |
| `trip_points`   | **RANGE (`recorded_at`)**, monthly    | Write-once GPS breadcrumbs, read only for the trip's own replay, deleted at 90 days (DPDP). The single highest insert rate in the system (50,000/minute at target load).          | Immediately at the first pilot with GPS on — this one is not "later" |
| `outbox_events` | **RANGE (`created_at`)**, monthly     | A queue, not a ledger: the relay reads `published_at IS NULL` (newest partition only) and everything published is dropped at 30 days.                                             | 10M rows, or when the unpublished-index scan shows partition bloat   |
| `audit_log`     | **RANGE (`occurred_at`)**, monthly    | Append-only, read by "who changed this row" and "this tenant, this window"; both carry a time bound in the contract. Kept 7 years for the tax trail, so old partitions are cold.  | 50M rows                                                             |
| `sync_ops`      | **RANGE (`created_at`)**, monthly     | Pure dedupe memory for offline devices, deleted at 180 days. Lookups are always by `(tenant_id, device_id, op_id)` for an op a device is replaying now — i.e. a recent partition. | 20M rows                                                             |

Rule 9 also names `order_state_transitions` and `messages`. They follow the same two shapes when they get
there — `order_state_transitions` HASH on `tenant_id` (it is read with the order, for ever),
`messages` RANGE on `created_at` monthly (a send log with a cost meter, kept 13 months) — but neither is
in the first six, because neither is on a hot path today.

## 2. What has to change in the schema first

Every one of these is an expand-only migration that can land long before the partitioning itself, and
each is worth doing on its own merits.

| table           | change                                                                                                     | why                                                                                              |
| --------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `stock_ledger`  | PK `(id)` → `(tenant_id, id)`. `stock_ledger_idempotency_idx (tenant_id, idempotency_key)` already fits.   | The partition key must be in the PK. Every read already filters on `tenant_id` under RLS.        |
| `journal_lines` | PK `(id)` → `(tenant_id, id)`.                                                                             | Same.                                                                                            |
| `trip_points`   | PK `(id)` → `(recorded_at, id)`; `trip_points_dedupe_idx` → `(tenant_id, trip_id, device_id, recorded_at)` | Already contains `recorded_at`, so the dedupe index survives a range partition unchanged.        |
| `outbox_events` | PK `(id)` → `(created_at, id)`; `outbox_unpublished_idx` stays partial on `created_at`.                    | The relay claims rows with `FOR UPDATE SKIP LOCKED` on the newest partition only.                |
| `audit_log`     | PK `(id)` → `(occurred_at, id)`.                                                                           | The three read indexes already lead `(tenant_id, …, occurred_at)`.                               |
| `sync_ops`      | PK `(tenant_id, device_id, op_id)` → `(created_at, tenant_id, device_id, op_id)`.                          | Dedupe stays exact; a replay older than the retention window is a new op, which is correct.      |
| all six         | foreign keys **out of** the table stay; foreign keys **into** it must not exist.                           | Postgres cannot reference a partitioned table from a plain table. None of the six is referenced. |

Also required before the first cut-over: `withTenant` already sets `app.tenant_id` on every statement, so
every hash-partitioned read prunes to one partition without a query change. Any query that omits
`tenant_id` (there are none in `@dos/core` today; `eslint-plugin-boundaries` plus RLS keep it that way)
would scan all 64 — that is the regression to watch for in the k6 run.

## 3. Cut-over without downtime

The same six steps for each table, one table per release, newest-first so the highest-value table
(`trip_points`) is done first:

1. **Expand.** Ship the PK change from §2 as a normal expand-only migration (`ALTER TABLE … DROP
CONSTRAINT … PRIMARY KEY, ADD PRIMARY KEY (…)` — building the new index `CONCURRENTLY` first and
   attaching it with `ADD PRIMARY KEY USING INDEX` so the table is never locked for more than a moment).
   Nothing else changes; the application does not know.
2. **Create the shell.** `CREATE TABLE <t>_p (LIKE <t> INCLUDING ALL) PARTITION BY HASH (tenant_id)` (or
   `RANGE (<time>)`), then create the partitions: 64 hash partitions, or one range partition per month
   from the oldest row to three months ahead, plus a `DEFAULT` partition as a safety net. Apply
   `ENABLE` + `FORCE ROW LEVEL SECURITY`, every policy and every `GRANT` to `app_rw` and `app_worker` on
   the parent — Postgres routes them to the partitions.
3. **Dual-write.** A `BEFORE INSERT` trigger on the old table also writes the row to `<t>_p`. Because
   every row carries a client `idempotencyKey` and a UUIDv7 id (rule 4), a row written twice is a no-op,
   so the trigger can be added and removed at any moment without a maintenance window.
4. **Backfill.** The worker copies history in `tenant_id` batches for a hash table, or month by month for
   a range table, `INSERT … ON CONFLICT DO NOTHING`, bounded to a few tens of thousands of rows per
   statement with a `statement_timeout`, and paced so it never competes with the day's traffic (rule 5:
   per-tenant fairness applies to backfill jobs too). Runs for as many nights as it needs.
5. **Verify, then swap.** Counts and checksums per tenant per month must match, and for the two money
   ledgers the invariant tests must pass against `<t>_p` (`sum(amount_paise) = 0` per `entry_id`; the
   stock balance derived from `<t>_p` equals `stock_balances`). Then, in one transaction:
   `ALTER TABLE <t> RENAME TO <t>_old; ALTER TABLE <t>_p RENAME TO <t>;` and drop the dual-write trigger.
   Services are stateless and hold no prepared statements across the rename, so they carry on; a request
   in flight sees one or the other, never both.
6. **Keep the old table for one release.** `<t>_old` is dropped only after a full backup cycle has run
   with the new table in place. Until then a roll-back is another rename.

Two rules the plan does not break: migrations are expand-only from 0004 onward (a rename plus a drop a
release later is expand-only in effect — no column narrows, no data is lost), and the hand-written
sibling migration ends with the `DO` block that fails if any touched table lacks `FORCE ROW LEVEL
SECURITY` or still carries a `FOR ALL` policy.

## 4. Retention per partition

Retention stops being a delete sweep and becomes a partition drop. The worker's `retention` job
(`backend/worker/src/jobs/retention.ts`) keeps its current windows and its row-limited `DELETE`s for the
unpartitioned tables, and gains a monthly `partition_maintenance` job that creates next month's partition
and detaches expired ones.

| table           | keep                                          | what happens at the boundary                                                                                                                               |
| --------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stock_ledger`  | for ever (8 years hot, then cold storage)     | Nothing is dropped. Partitions older than 8 financial years move to a cheaper tablespace.                                                                  |
| `journal_lines` | for ever (8 years hot, then cold storage)     | Same. The Income-tax Act's 8-year window sets "hot"; nothing is ever deleted.                                                                              |
| `trip_points`   | **90 days** (DPDP, `dpdp.gps_retention_days`) | `DETACH PARTITION` then `DROP TABLE` the month that has fully aged out — one statement, no bloat.                                                          |
| `outbox_events` | **30 days** after `published_at`              | A month is dropped once every row in it is published or dead-lettered; dead-lettered rows are moved to `outbox_dead` first so an operator never loses one. |
| `audit_log`     | **7 years**                                   | Partitions older than 7 years detach to cold storage; they are evidence, so they are archived, not deleted.                                                |
| `sync_ops`      | **180 days**                                  | `DROP` the aged-out month. A device offline longer than that replays as a new op, which is correct.                                                        |

Per-tenant deletion (a distributor leaving, or a DPDP erasure request) stays a `DELETE … WHERE
tenant_id = $1` — cheap on a hash-partitioned table because it touches exactly one partition, and
unchanged on a range-partitioned one.

## 5. When this gets built

Not now, and not speculatively. The order is: `trip_points` at the first pilot that switches GPS on
(its insert rate justifies it on day one); the other five when the k6 load model in `backend/infra/k6/`
shows a table missing its budget, or at 50M rows, whichever comes first. Until then the only work owed
is §2 — the primary-key changes — which are cheap, are expand-only, and are what make the rest a data
move rather than a redesign.
