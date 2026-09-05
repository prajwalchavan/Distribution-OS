# R08 — Backend architecture & infrastructure for Distribution OS (solo dev, production-grade, India-resident, scale to lakhs)

Date: 2026-09-04. Method: official docs and vendor pricing pages fetched today (WebFetch), AWS Price List bulk CSVs for ap-south-1 pulled directly (RDS/EC2/S3/ECS/ElastiCache price files dated 2026-06/08/09). Web search quota was exhausted before this task started, so every claim below is either backed by a fetched primary source (linked) or explicitly marked **[unverified]**. Nothing here contradicts the decisions in CONTEXT.md; the few places where I recommend a refinement are flagged "Recommended refinement".

---

## 0. The one-paragraph recommendation

**TypeScript end-to-end. Backend = a NestJS 12 modular monolith on the Fastify adapter, Node 24 LTS, Postgres 17/18 as the only stateful system at launch (shared schema + `tenant_id` + Row Level Security, with a global product/manufacturer master), Drizzle ORM + drizzle-kit migrations, Zod 4 schemas in `backend/libs/contracts` consumed by mobile/web via oRPC (typed RPC + generated OpenAPI), pg-boss for jobs/outbox relay (no Redis at launch), SSE for live dashboards, S3 ap-south-1 for invoice photos, Better Auth (self-hosted, phone-OTP + organization plugins) for identity, CASL + RLS for authorization, OpenTelemetry → Grafana Cloud free tier + Sentry, hosted on AWS Mumbai (RDS + ECS Fargate ARM) provisioned with SST v3, deployed by GitHub Actions with native ECS blue/green.** Pilot cost is roughly $50–70/month; ~10 distributors ≈ $250–350/month; ~100 distributors ≈ $1.1–1.4k/month (details in §6). The cheaper India-resident fallback is DigitalOcean Bangalore (BLR1) at ≈ $45/month for the pilot with the _same code_ (Docker + Kamal), because the stack has zero AWS-specific runtime dependencies.

---

## 1. Language / framework

### 1.1 Why TypeScript (not Go, Python, Elixir) for a solo developer whose clients are TypeScript

The decisive constraint is not raw throughput; it is one person's context-switching cost and the ability to share _domain code_ (GST math, scheme stacking, order state machines, Zod validators) between five apps and the server.

| Option                  | What you gain                                                                                                                                                                                                              | What a solo TS-client dev loses                                                                                                                                            | Verdict  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **TypeScript (Node)**   | One language, one toolchain, shared Zod contracts and domain logic, largest hiring pool for a later 1–2 hires in India, every SaaS integration (Razorpay, MSG91, WhatsApp Cloud API, Google Maps) has a first-party JS SDK | Single-threaded CPU per process (irrelevant for I/O-bound CRUD + ledger; scale horizontally)                                                                               | **Pick** |
| Go                      | Small static binaries, easy concurrency, great for high-QPS services                                                                                                                                                       | No shared types with mobile (must generate), two ecosystems to keep patched, slower iteration on a large CRUD-heavy domain, no DI/module convention                        | Not now  |
| Python (Django/FastAPI) | Django admin, mature ORM/migrations, best LLM/OCR libraries                                                                                                                                                                | Same split-language cost; Document Intelligence can call a hosted LLM vision API from Node just as well (the pipeline is photo → LLM → human review → commit, per CONTEXT) | Not now  |
| Elixir/Phoenix          | Superb for realtime/presence, BEAM fault tolerance                                                                                                                                                                         | Tiny Indian hiring pool, split language, LiveView does not help native mobile                                                                                              | Not now  |

### 1.2 Which TypeScript framework

Facts fetched today:

- **NestJS 12.0.0 (released 27 Aug 2026)**: ESM-native packages, first-class _Standard Schema_ validation (Zod/Valibot/ArkType accepted directly in `@Body()/@Query()` via `StandardSchemaValidationPipe`), rebuilt CLI with `nest upgrade` and `nest deploy`, native observability SDK `@nestjs/observe` that auto-instruments HTTP, queues and cron; requires Node ≥20.19 / ≥22.12. ([release notes](https://github.com/nestjs/nest/releases/tag/v12.0.0)). Nest's module system (feature/shared/dynamic/global modules, providers private unless exported) is exactly the "modular monolith" primitive ([docs](https://docs.nestjs.com/modules)). Fastify adapter is officially supported and "nearly twice" Express throughput; caveat: Express-specific middleware recipes will not apply ([docs](https://docs.nestjs.com/techniques/performance)).
- **Fastify 5.11.x**: ~88k req/s vs Express 5 ~58k in the project's own illustrative benchmark ([fastify.dev/benchmarks](https://fastify.dev/benchmarks/)); `fastify-type-provider-zod` gives Zod 4 validation + OpenAPI generation ([repo](https://github.com/turkerdev/fastify-type-provider-zod)).
- **Hono 4.13.5 (26 Aug 2026, security-fix release)**: fastest router on Workers/Deno; runs on Node via `@hono/node-server` ([Node guide](https://hono.dev/docs/getting-started/nodejs), [benchmarks](https://hono.dev/docs/concepts/benchmarks)); `@hono/zod-openapi` gives Zod-typed routes + OpenAPI ([example](https://hono.dev/examples/zod-openapi)).
- **AdonisJS v7**: "backend-first, type-safe", batteries included (auth, validator, Lucid ORM, mail, rate limiting), ESM-only ([docs](https://docs.adonisjs.com/guides/preface/introduction)).

| Criterion (weighted for solo + production + hires later)            | NestJS 12 + Fastify      | Hono         | Fastify bare      | AdonisJS 7                    |
| ------------------------------------------------------------------- | ------------------------ | ------------ | ----------------- | ----------------------------- |
| Enforced module boundaries / DI (keeps a 12-module monolith honest) | Built in                 | You build it | You build it      | Partial (IoC container)       |
| Zod contracts shared with mobile                                    | Native in v12            | Native       | Via type provider | VineJS, not Zod               |
| Jobs, cron, WebSockets, SSE, guards, interceptors, testing harness  | First-party packages     | Assemble     | Assemble          | First-party but own ecosystem |
| Observability                                                       | `@nestjs/observe` + OTel | OTel manual  | OTel manual       | OTel manual                   |
| Hiring pool in India (2026)                                         | Largest                  | Growing      | Medium            | Small                         |
| Ceremony / decorator magic                                          | High                     | Very low     | Low               | Medium                        |
| Multi-runtime/edge                                                  | No (not needed)          | Yes          | No                | No                            |

**Pick NestJS 12 on the Fastify adapter.** The value for one person is that the framework's conventions replace a team's code-review discipline: every bounded context is a `@Module()` whose only public surface is exported services; guards and interceptors give one place to enforce tenant context and idempotency; the CLI scaffolds consistently; and a future hire has documentation to read instead of you. If the founder dislikes decorators, the runner-up is **Hono + oRPC** with hand-rolled module folders — same shared/ contracts, ~30% less code, ~2× more conventions to invent.

Runtime: **Node 24 (Active LTS)**; Node 22 entered end-of-life in late July 2026 per the release table ([nodejs.org](https://nodejs.org/en/about/previous-releases)). Do not build on Bun for a production ledger system yet.

---

## 2. Postgres multi-tenancy: shared schema + `tenant_id` + RLS, with a global master

### 2.1 Pattern choice

AWS's reference article frames the three models as silo (DB per tenant), bridge (schema per tenant) and pool (shared schema), and shows that RLS "enables the pool model's cost benefits while centralizing isolation enforcement at the database layer" ([AWS Database Blog](https://aws.amazon.com/blogs/database/multi-tenant-data-isolation-with-postgresql-row-level-security/)). Crunchy Data's guidance is the same: one app role, tenant id in a session setting, policy `org_id = NULLIF(current_setting('rls.org_id', TRUE), '')::uuid`, "ideally you have that org_id in every table" ([Crunchy Data](https://www.crunchydata.com/blog/row-level-security-for-tenants-in-postgres)).

| Pattern                             | Pros                                                                                             | Cons for this product                                                                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema-per-tenant                   | Hard isolation, per-tenant restore                                                               | Migrations × N schemas; a _global_ product master needs cross-schema joins; connection poolers and ORMs handle it badly; 100+ schemas × 60 tables = catalog bloat |
| DB-per-tenant                       | Strongest isolation                                                                              | Cost and ops multiply; kills the "retailer linked to many distributors" requirement                                                                               |
| **Shared schema + tenant_id + RLS** | One migration, one pool, global tables trivially joinable, retailer-to-many-distributors natural | Must be disciplined: every tenant table has `tenant_id`, every index leads with it, every transaction sets the tenant                                             |

**Pick shared schema + RLS.** It is the only model that makes the two CONTEXT decisions — global manufacturer/product master, and a retailer identity that spans distributors — cheap.

### 2.2 The concrete mechanism

1. Two DB roles: `app_owner` (runs migrations, owns tables) and `app_rw` (the API/worker role, **no `BYPASSRLS`, not the table owner**). Postgres bypasses RLS for superusers, `BYPASSRLS` roles and table owners unless `FORCE ROW LEVEL SECURITY` is set ([PostgreSQL docs](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)). Apply `ENABLE` + `FORCE ROW LEVEL SECURITY` on every tenant table so even an accidental owner connection is policed.
2. Per request/job: open a transaction, `SELECT set_config('app.tenant_id', $1, true)` and `set_config('app.actor_role', $2, true)` (the `true` = transaction-local), run the unit of work, commit. Transaction-local settings are what make this safe behind a pooler; AWS explicitly warns session-level `SET` "may be incompatible with server-side connection pooling such as pgBouncer" — use `SET LOCAL`/`set_config(..., true)` and transaction-mode pooling.
3. Policy on every tenant table: `USING (tenant_id = (SELECT current_setting('app.tenant_id', true)::uuid))` and the same as `WITH CHECK`. Wrapping the function in a `SELECT` makes the planner cache it once per statement instead of per row; index every column a policy filters on, because "an unindexed filter column turns a read into a sequential scan" ([Supabase RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security)). Keep the policy expression to current-row values only (no sub-selects into other tables) — the Postgres docs call this both fastest and race-free.
4. **Defence in depth:** the ORM layer still adds `WHERE tenant_id = ?` (cheap, and it lets the planner prune partitions), and a NestJS guard refuses any request without a resolved tenant. RLS is the last line, not the only line.
5. Drizzle can express all of this in code (`pgPolicy`, `pgRole`, `.withRLS()`), so policies live in migrations next to tables ([Drizzle RLS docs](https://orm.drizzle.team/docs/rls)).

### 2.3 Global master + tenant overlay

- `manufacturers`, `products`, `product_variants`, `hsn_codes`, `uom` have **no** `tenant_id`. RLS: `SELECT` allowed to everyone; `INSERT/UPDATE` allowed only when `current_setting('app.actor_role') = 'catalog_curator'` (your back-office role) — or, at launch, simply do not grant write on those tables to `app_rw` and route curation through a separate `app_curator` role.
- `tenant_products` (tenant_id, product_id, alias, case_size_override, purchase_price, margin, is_listed, …) is the per-distributor overlay. Note from the real invoices: case sizes are embedded in names ("x 90", "_120", "CS1"); keep `case_size` on the global variant _and_ allow a tenant override, since a distributor may receive a different pack configuration from a sub-distributor.
- Distributor-proposed new products land in `product_proposals` (tenant-scoped) → curator approval → promoted to the global table. That preserves "every distributor does not re-create Campa 1L" without letting one tenant pollute others.
- **Purchase price and margin never live on a table a salesperson-role transaction can read.** Put costs in `tenant_product_costs` with an extra RLS predicate `current_setting('app.actor_role') IN ('owner','manager')`. This turns the Vyapar-failure test from a code-review rule into a database guarantee.

### 2.4 Keys, indexes, partitions

- Use **UUIDv7** for all ids: PG18 ships `uuidv7()` natively ([PG18 release](https://www.postgresql.org/about/news/postgresql-18-released-3142/)); on PG17 generate in the app. Offline-first field apps must generate ids client-side anyway; time-ordered UUIDs keep B-tree inserts append-friendly.
- Every tenant table: `PRIMARY KEY (id)`, plus `(tenant_id, …)` leading composite indexes for each access path.
- Ledgers (§3) are range-partitioned by month **later**, not at launch; the Postgres docs say partitioning pays off when a table "exceeds the physical memory of the database server" and warns against assuming more partitions is better ([partitioning docs](https://www.postgresql.org/docs/current/ddl-partitioning.html)). Design the ledger with `(tenant_id, occurred_at)` in the key from day one so adding partitions is a data move, not a schema change.

---

## 3. Ledgers, idempotency, outbox, CQRS-light, analytics

### 3.1 Stock ledger (append-only, derived balances) — refines the CONTEXT decision

```
stock_ledger(id uuidv7, tenant_id, occurred_at, product_variant_id, batch_id nullable,
             location_id, qty_delta int (pcs, signed), reason enum
             [grn, sale, sale_return, damage, transfer_out, transfer_in, adjustment, van_load, van_unload],
             ref_type, ref_id, actor_id, idempotency_key, created_at)
stock_balance(tenant_id, product_variant_id, batch_id, location_id, on_hand int, reserved int, version int)
```

- Every mutation inserts a ledger row **and** updates `stock_balance` in the _same transaction_ with `UPDATE … SET on_hand = on_hand + $delta WHERE … RETURNING on_hand`, plus a `CHECK (on_hand >= 0)` unless the tenant enables negative stock. This is the simplest correct design: the ledger is the truth, the balance is a maintained cache, and a nightly job re-derives balances from the ledger and alerts on drift.
- **Reservations** (order accepted but not picked): model as a two-phase entry — `reserved` increment on order confirm, then either post (pick → `on_hand -= qty`, `reserved -= qty`) or void. This is the same pending/post/void discipline TigerBeetle uses for two-phase transfers ([TigerBeetle docs](https://docs.tigerbeetle.com/coding/two-phase-transfers/)); you do not need TigerBeetle itself for FMCG volumes, but copying its state model avoids the classic "phantom stock" bug.
- Quantities are stored in **pieces**; cases are a display/UOM conversion using `case_size`. This matches the invoices observed (ordered in cases, invoiced in pcs).
- Van sales (open question in CONTEXT): a vehicle is just a `location`; `van_load/van_unload` reasons make it a transfer. The ledger design needs no change to support it later.

### 3.2 Money ledger (double-entry)

```
journal_entries(id, tenant_id, posted_at, kind [invoice, receipt, credit_note, write_off, opening_balance], ref_type, ref_id, idempotency_key)
journal_lines(entry_id, account_id, debit numeric(14,2), credit numeric(14,2), party_id nullable)
accounts(tenant_id, code, type [asset, liability, income, expense], name)   -- AR, Cash, UPI clearing, Sales, CGST/SGST/IGST payable, Discounts, Sales returns
```

- Constraint: `SUM(debit) = SUM(credit)` per entry (enforce in the service and with a deferred trigger).
- Retailer outstanding = balance of the AR account for that party; ageing is a query over open invoices minus allocations. "Retailers pay in bulk every 2–3 orders" is a `receipt` entry with an `allocations(receipt_id, invoice_id, amount)` table — never mutate invoice rows to track payment.
- Sales returns → credit notes (per CONTEXT) are entries that reverse income and GST payable, plus a stock ledger row.
- Keep the money ledger _inside_ Postgres; there is no fintech scope now, so a separate ledger service (TigerBeetle, Modern Treasury) is premature.

### 3.3 Idempotency

Offline-first clients will retry. Follow Stripe's semantics: client generates a UUID key per _operation_, server stores the key with the first result (status + body) and replays it on retry, and errors if the same key arrives with different parameters; keys can be pruned after ~24h ([Stripe docs](https://docs.stripe.com/api/idempotent_requests)). Implement as `idempotency_keys(tenant_id, key, request_hash, response_status, response_body, created_at, PRIMARY KEY(tenant_id,key))`, checked inside the same transaction as the write. Every mutating endpoint requires the header; a NestJS interceptor does it once for all modules.

### 3.4 Outbox + event bus

The transactional outbox pattern: write the domain event into an `outbox` table _in the same transaction_ as the business write; a relay publishes it; consumers must be idempotent because delivery is at-least-once ([microservices.io](https://microservices.io/patterns/data/transactional-outbox.html)). For a monolith, the "bus" is just pg-boss queues (see §5): pg-boss can "create jobs in an existing db transaction" with Drizzle/Kysely/Prisma adapters ([pg-boss](https://github.com/timgit/pg-boss)), so the outbox row _is_ the job — no separate relay process needed at launch. Consumers: read-model updaters, WhatsApp/SMS notifications, incentive recomputation, GPS trip summaries, document-intelligence pipeline steps.

### 3.5 CQRS-light for dashboards

- Owner dashboard "sales, stock movement, orders, payments for day/month" = a handful of per-tenant, per-day aggregate rows (`daily_tenant_stats`) updated by the event consumers above, plus live counts straight from indexed tables. That is CQRS-light: same database, separate read tables, eventually consistent by seconds.
- Where a query is too complex to maintain incrementally, use a materialized view refreshed with `REFRESH MATERIALIZED VIEW CONCURRENTLY` (requires a unique index; does not block readers) on a pg-boss cron ([PG docs](https://www.postgresql.org/docs/current/sql-refreshmaterializedview.html)).
- Realtime push of these numbers to the owner app is SSE (§5).

### 3.6 Analytics at scale

- Up to ~100 distributors, Postgres with partitioned ledgers + aggregate tables + a read replica is enough; do not add a second datastore before you have a measured problem.
- When you do: **ClickHouse Cloud has a public AWS Mumbai (ap-south-1) region** ([supported regions](https://clickhouse.com/docs/cloud/reference/supported-regions)) — good for cross-tenant benchmark analytics ("how fast does Campa 1L move in Kalyan vs Thane") and brand-facing reports. TimescaleDB (Tiger Cloud) is the other candidate; its docs do not list regions, so **India availability is unverified** ([Tiger pricing](https://www.tigerdata.com/docs/about/latest/pricing-and-account-management)). Feed either from the outbox stream, never by dual-writing from request handlers.

---

## 4. ORM, migrations, shared validation

|                                                             | Drizzle                                                                                                                                   | Prisma 7.x                                                                                                                                                                                                                                                                                                                        | Kysely                                                                                           |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Status (Sept 2026)                                          | 0.45.x stable line; v1.0.0-rc.4 on the release page (v1 not yet final) ([releases](https://github.com/drizzle-team/drizzle-orm/releases)) | v7 is Rust-free (TS query compiler), needs driver adapters (`@prisma/adapter-pg`), `prisma.config.ts`, **ESM-only**; 7.10 current and an 8.0 RC line exists ([upgrade guide](https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7), [releases](https://github.com/prisma/prisma/releases)) | Stable, "type-safe SQL builder, no magic", Node/Deno/Bun ([docs](https://kysely.dev/docs/intro)) |
| RLS / roles / policies as code                              | Yes (`pgPolicy`, `pgRole`)                                                                                                                | No (raw SQL migration)                                                                                                                                                                                                                                                                                                            | No (raw SQL)                                                                                     |
| Migrations                                                  | `drizzle-kit generate` → SQL files → `migrate` (six documented workflows) ([docs](https://orm.drizzle.team/docs/migrations))              | `prisma migrate`                                                                                                                                                                                                                                                                                                                  | Bring your own                                                                                   |
| Zod from schema                                             | `drizzle-zod`                                                                                                                             | `zod-prisma-types` (3rd party)                                                                                                                                                                                                                                                                                                    | Manual                                                                                           |
| SQL transparency (ledgers, `RETURNING`, CTEs, `FOR UPDATE`) | High                                                                                                                                      | Medium                                                                                                                                                                                                                                                                                                                            | Highest                                                                                          |
| Learning curve for a hire                                   | Low if they know SQL                                                                                                                      | Lowest                                                                                                                                                                                                                                                                                                                            | Low                                                                                              |

**Pick Drizzle** (schema in TS, SQL-shaped queries, policies in migrations, `drizzle-zod` for validators) and use **Kysely-style raw `sql` tags inside Drizzle** for ledger statements. Pin the 0.45 line until v1 ships final, then upgrade in one PR. Migration workflow: generate SQL files in CI, review them, apply with `drizzle-kit migrate` as a one-shot job _before_ the new app version receives traffic (this is what makes blue/green safe — migrations must be backward compatible with the still-running blue version).

**Zod 4** is the single validation library: 6–14× faster parsing than Zod 3, ~half the bundle, `zod/mini` for the mobile bundle, and `z.toJSONSchema()` for OpenAPI ([zod.dev](https://zod.dev/v4)). NestJS 12 accepts Zod natively; Expo/React Native import the same schemas from `backend/libs/contracts`. Use **oRPC** on top: typed procedures with Zod input/output, TanStack Query bindings for the apps, and the _same router_ served as an OpenAPI/REST surface for Tally/Marg importers or a future brand-DMS integration ([oRPC](https://orpc.dev/docs/getting-started)).

---

## 5. Jobs, realtime, files, search

### 5.1 Job queue

|               | pg-boss 12.x                                                                                                                                                                                                                                                                                                                           | BullMQ                                                                                                                                       | Temporal Cloud                                                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backing store | Postgres (SKIP LOCKED), "exactly-once job delivery", transactional enqueue, cron, retries/backoff, dead-letter, LISTEN/NOTIFY low latency; needs Node ≥22.12, PG ≥13; v12.30 (3 Sept 2026) cut fetch query from 47.8 ms to 0.11 ms ([repo](https://github.com/timgit/pg-boss), [releases](https://github.com/timgit/pg-boss/releases)) | Redis/Valkey; delayed, repeatable, rate limiting, flows, sandboxed processors; Pro tier for groups/batches ([docs](https://docs.bullmq.io/)) | Durable workflows; $50 per million actions with a **$100/month minimum**; no India region listed ([pricing](https://docs.temporal.io/cloud/pricing)) |

**Pick pg-boss.** One stateful system, transactional outbox for free, no Redis to run or pay for, and the throughput ceiling (thousands of jobs/min on a small instance) is far above a distributor OS. Move only the _rate-limited notification fan-out_ to BullMQ on Valkey (BSD-licensed Redis fork backed by AWS/GCP/DO — [valkey.io](https://valkey.io/)) if and when pg-boss becomes a measurable load on the primary. Temporal is the right tool for month-long, multi-step human workflows (the migration playbook's parallel run could qualify) but not at this budget.

### 5.2 Realtime

- **SSE from the NestJS API** for the owner dashboard, approvals queue and order-status screens: one-directional, HTTP/1.1-friendly through every Indian mobile network and proxy, trivial reconnect, and NestJS has a first-party `@Sse()` decorator. Fan-out across API instances via Postgres `LISTEN/NOTIFY` (payload < 8000 bytes, transactional, so send ids not documents — [PG docs](https://www.postgresql.org/docs/current/sql-notify.html)) or pg-boss pub/sub.
- **WebSocket only for the live delivery map** (bidirectional GPS stream from the delivery app). GPS points also go to a `trip_points` table (partition candidate #1).
- Supabase Realtime is excellent but only worth it if you adopt Supabase as the platform; its limits are 500 concurrent connections / 500 msg/s on Pro, 10,000 / 2,500 on Pro without spend cap ([limits](https://supabase.com/docs/guides/realtime/limits)).

### 5.3 File storage (full-quality invoice photos, per CONTEXT)

|                | S3 ap-south-1 (Mumbai)                              | Cloudflare R2                                                                                                                                             | DO Spaces (BLR1)                                                                                                                                               |
| -------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storage        | $0.025/GB-mo first 50 TB (AWS price list, Aug 2026) | $0.015/GB-mo, 10 GB free ([R2 pricing](https://developers.cloudflare.com/r2/pricing/))                                                                    | $5/mo incl. 250 GiB + 1 TiB egress, $0.02/GiB after ([Spaces](https://www.digitalocean.com/pricing/spaces-object-storage))                                     |
| Egress         | $0.1093/GB first 10 TB from Mumbai (price list)     | Free                                                                                                                                                      | 1 TiB included                                                                                                                                                 |
| Data residency | Region-pinned in India                              | **No India jurisdiction**; only an "apac" _best-effort_ location hint ([R2 data location](https://developers.cloudflare.com/r2/reference/data-location/)) | Region-pinned (BLR1) — Spaces in BLR1 confirmed in DO's regional availability table ([DO docs](https://docs.digitalocean.com/platform/regional-availability/)) |

**Pick S3 Mumbai** (or Spaces BLR1 on the DO path). R2's economics are tempting, but it cannot promise Indian residency for documents containing retailer names/phones/GST numbers. Serve images via pre-signed URLs; a 3 MB photo × 200 GRN photos/month/distributor is ~0.6 GB/month/distributor — storage cost is noise, egress is not, so cache thumbnails on the client.

### 5.4 Search

Product and retailer search is short-string fuzzy matching in Hindi/English transliterations ("Too Yumm", "TY! Wafers", "Dhanlaxmi"). **Postgres `pg_trgm` with a GIN index** supports `ILIKE`, similarity and regex lookups with an index ([pg_trgm docs](https://www.postgresql.org/docs/current/pgtrgm.html)); combine with `tsvector` for multi-word product names. No Elasticsearch/Meilisearch/Typesense until catalog search is a proven bottleneck (Typesense Cloud India region **unverified** — its docs page 404'd).

---

## 6. Hosting in India, DPDP, and monthly cost at 1 / 10 / 100 distributors

### 6.1 What DPDP actually requires

- The DPDP Act 2023 permits transfer of personal data outside India except to countries the Central Government restricts by notification ([PRS summary](https://prsindia.org/billtrack/digital-personal-data-protection-bill-2023)). Fiduciaries must keep "reasonable security safeguards", notify breaches to the Board and affected persons, and erase data once the purpose is met.
- The **DPDP Rules were notified on 13/14 Nov 2025**, phased in with full compliance by **13 May 2027**; breach: notify without delay and file a detailed report **within 72 hours**; Significant Data Fiduciaries must keep specified personal/traffic data inside India and have an India-based DPO ([EY guide](https://www.ey.com/en_in/insights/cybersecurity/decoding-the-digital-personal-data-protection-act-2023), [KPMG](https://kpmg.com/in/en/insights/digital-personal-data-protection-dpdp.html), [Wikipedia on the Rules](https://en.wikipedia.org/wiki/Digital_Personal_Data_Protection_Rules,_2025)). Exact rule numbers **[unverified — official PDF returned 403/404 today]**.
- Practical reading for Distribution OS: you will hold retailer phone numbers, delivery-staff GPS trails and Aadhaar-adjacent KYC only if you choose to; you are not an SDF. Hosting in India is not legally mandatory today, but it is cheap, removes an entire compliance conversation with brand partners, and cuts latency to Thane from ~70 ms (Singapore) to ~10 ms. **Host in India.** Build the 72-hour breach runbook and an erasure job now.

### 6.2 Region availability (fetched today)

| Provider     | India region for **compute**                                                                                                                                                         | India region for **managed Postgres**                                                                                                                                                                                                                             | Notes                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| AWS          | ap-south-1 Mumbai (+ Hyderabad)                                                                                                                                                      | RDS in Mumbai (prices below)                                                                                                                                                                                                                                      | Most complete                                                                  |
| GCP          | asia-south1 Mumbai (Tier-1 pricing), asia-south2 Delhi (Tier-2) for Cloud Run ([locations](https://docs.cloud.google.com/run/docs/locations))                                        | Cloud SQL Mumbai **[pricing unverified — page is interactive]**                                                                                                                                                                                                   |                                                                                |
| Azure        | Central India (Pune, AZs), South India, West India (Mumbai), India South Central (Hyderabad, AZs) ([regions list](https://learn.microsoft.com/en-us/azure/reliability/regions-list)) | Flexible Server in Central India **[pricing unverified]**                                                                                                                                                                                                         |                                                                                |
| DigitalOcean | BLR1 Bangalore: Droplets, DOKS, App Platform, Spaces                                                                                                                                 | Managed PostgreSQL in BLR1 confirmed ([regional availability](https://docs.digitalocean.com/platform/regional-availability/)); 1 vCPU/1 GiB $15.15, 2 vCPU/4 GiB $60.90, 4 vCPU/8 GiB $122.10 ([pricing](https://www.digitalocean.com/pricing/managed-databases)) | Cheapest India-resident managed PG                                             |
| Supabase     | —                                                                                                                                                                                    | **Mumbai ap-south-1 available** ([regions](https://supabase.com/docs/guides/platform/regions)); Pro $25 + compute (Micro $10 … XL $210), PITR add-on $100/mo per 7 days ([pricing](https://supabase.com/pricing))                                                 | Fastest to ship, but PITR is priced for larger teams                           |
| Neon         | —                                                                                                                                                                                    | **No India region** (AWS us/eu/sg/au/br only) ([regions](https://neon.com/docs/introduction/regions))                                                                                                                                                             | Out                                                                            |
| Aiven        | —                                                                                                                                                                                    | Managed PG on AWS Mumbai/Hyderabad, GCP Mumbai/Delhi, Azure Central/South India, DO Bangalore ([clouds](https://aiven.io/docs/platform/reference/list_of_clouds))                                                                                                 | Useful if you want managed PG in India on a non-AWS cloud; pricing not fetched |
| Fly.io       | bom Mumbai for apps                                                                                                                                                                  | **Managed Postgres not offered in bom** ([regions](https://fly.io/docs/reference/regions/))                                                                                                                                                                       | App only                                                                       |
| Railway      | Singapore only ([regions](https://docs.railway.com/reference/regions))                                                                                                               | —                                                                                                                                                                                                                                                                 | Out                                                                            |
| Render       | Singapore only ([regions](https://render.com/docs/regions))                                                                                                                          | —                                                                                                                                                                                                                                                                 | Out                                                                            |
| Hetzner      | Singapore only ([locations](https://docs.hetzner.com/cloud/general/locations/))                                                                                                      | —                                                                                                                                                                                                                                                                 | Out for residency                                                              |

### 6.3 AWS Mumbai unit prices (AWS Price List bulk CSV, ap-south-1, effective 2026-06/08/09)

| Item                                                                   | On-demand                                      |
| ---------------------------------------------------------------------- | ---------------------------------------------- |
| RDS PostgreSQL db.t4g.micro (2 vCPU burst, 1 GiB) Single-AZ / Multi-AZ | $0.021 / $0.042 per hour                       |
| db.t4g.small (2 GiB)                                                   | $0.042 / $0.084                                |
| db.t4g.medium (4 GiB)                                                  | $0.084 / $0.167                                |
| db.t4g.large (8 GiB)                                                   | $0.167 / $0.334                                |
| db.m7g.large (2 vCPU Graviton3, 8 GiB)                                 | $0.240 / $0.479                                |
| db.r7g.large (16 GiB)                                                  | $0.272 / $0.544                                |
| RDS gp3 storage Single-AZ / Multi-AZ                                   | $0.131 / $0.262 per GB-month                   |
| RDS backup storage beyond free (= DB size)                             | $0.095 per GB-month                            |
| EC2 t4g.medium / t4g.large / c7g.large / m7g.large                     | $0.0224 / $0.0448 / $0.0491 / $0.0583 per hour |
| Fargate ARM                                                            | $0.02383 per vCPU-hour, $0.00261 per GB-hour   |
| ElastiCache cache.t4g.micro (Redis/Valkey)                             | $0.020 per hour                                |
| S3 Standard                                                            | $0.025 per GB-month (first 50 TB)              |
| Internet egress                                                        | $0.1093/GB first 10 TB, $0.085 next 40 TB      |

(ALB ≈ $18–25/month **[unverified — not in the CSVs pulled]**.)

### 6.4 Cost model (USD/month, on-demand, no reserved discounts)

Assumptions: 1 distributor ≈ 1 owner, 3 reps, 2 warehouse, 4 delivery, 150 retailers; 10 distributors ≈ 100 staff + 2,000 retailers; 100 distributors ≈ 1,000 staff + 20,000 retailers, ~50k orders/month, ~1 GB GPS points/month.

| Component                                                               | 1 distributor (pilot)                                           | 10 distributors                                                                    | 100 distributors                                                                                 |
| ----------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **AWS Mumbai path**                                                     |                                                                 |                                                                                    |                                                                                                  |
| RDS Postgres                                                            | t4g.micro Single-AZ, 20 GB gp3: **$18**                         | t4g.medium Multi-AZ, 100 GB: **$148**                                              | m7g.large Multi-AZ, 500 GB + m7g.large read replica: **$657**                                    |
| API + worker (Fargate ARM)                                              | 1 task 0.5 vCPU/1 GB: **$11**                                   | 2 API (1 vCPU/2 GB) + 1 worker: **$64**                                            | 4 API (2 vCPU/4 GB) + 2 workers: **$255**                                                        |
| ALB                                                                     | ~$20                                                            | ~$20                                                                               | ~$25                                                                                             |
| S3 + egress                                                             | <$2                                                             | 50 GB + 100 GB out: **$12**                                                        | 500 GB + 1 TB out: **$122**                                                                      |
| Valkey (ElastiCache)                                                    | none (pg-boss)                                                  | optional t4g.micro **$15**                                                         | t4g.small ≈ **$30** [est]                                                                        |
| Observability (Grafana Cloud free + Sentry Dev)                         | $0                                                              | Sentry Team $26 + Grafana Pro $19 ≈ **$45**                                        | ≈ **$150**                                                                                       |
| SMS OTP (MSG91 ₹0.16–0.25/SMS; [pricing](https://msg91.com/in/pricing)) | ~₹300                                                           | ~~₹4,000 (~~$48)                                                                   | ~~₹40,000 (~~$480) — push WhatsApp/passkey login to cut this                                     |
| **AWS total**                                                           | **≈ $55**                                                       | **≈ $310 + SMS**                                                                   | **≈ $1,240 + SMS**                                                                               |
| **DigitalOcean BLR1 path**                                              | Droplet 4 GB $24 + Managed PG 1 GiB $15 + Spaces $5 = **≈ $45** | 2× Droplet 8 GB $96 + Managed PG 4 GiB (2-node HA ≈ 2× $60.90) + Spaces ≈ **$230** | DO tops out earlier on managed PG sizes; expect **$900–1,200** but plan to be on AWS/GCP by then |
| **Supabase Mumbai path**                                                | Pro $25 (Micro compute incl.) ≈ **$25–35**                      | Pro + Medium compute $60 + PITR $100 ≈ **$190**                                    | Team $599 + XL $210 + PITR ≈ **$950+**                                                           |

Reserved instances/Savings Plans cut RDS and EC2 by ~30–40% once volume is predictable **[standard AWS discount ranges; not re-verified today]**. Note the shape: at 100 distributors the database is half the bill; that is where a read replica and the aggregate read-models (§3.5) earn their keep, and where Graviton `r7g` memory-optimised nodes beat throwing vCPUs at it.

### 6.5 Recommended path

1. **Pilot (Tarsun):** AWS ap-south-1 from day one _if_ you accept ~$55/month and one afternoon of SST setup; else DO BLR1 for ≈$45 with Kamal. Both are Docker deployments of the same image; the only hosting-specific code is the SST config.
2. Why AWS over DO for the long run: Multi-AZ RDS with automated backups/PITR, IAM-scoped S3, ECS native blue/green with bake time and automatic rollback ([ECS blue/green](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-blue-green.html)), and both Hyderabad and Mumbai regions for a future DR copy inside India.
3. Why not Supabase as the platform: PITR at $100/month per 7 days is the tax on a serious ledger system, Realtime caps at 500 connections on Pro, and the auth/RLS coupling makes later migration painful. Use Supabase _Postgres_ only if you want a managed Mumbai database with a nicer console than RDS — it is a fine Postgres.

---

## 7. Auth and authorization

| Option                           | Fit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Cost        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| **Better Auth (self-hosted TS)** | Framework-agnostic; `phoneNumber` plugin does OTP send/verify with `otpLength`, `expiresIn` (300 s), `allowedAttempts` (3) and `signUpOnVerification` ([plugin](https://www.better-auth.com/docs/plugins/phone-number)); `organization` plugin gives orgs, members, invitations, teams, `createAccessControl()` roles, dynamic per-org roles and an _active organization_ in the session ([plugin](https://www.better-auth.com/docs/plugins/organization)); Expo client stores session cookies in `expo-secure-store` ([Expo integration](https://www.better-auth.com/docs/integrations/expo)); Drizzle adapter | $0 + SMS    |
| Clerk                            | Polished, but SMS outside US/Canada is "market rate", B2B orgs beyond 100 cost $1/org/month and the enhanced B2B package is $100/month ([pricing](https://clerk.com/pricing)); user data lives outside India                                                                                                                                                                                                                                                                                                                                                                                                    | $25 + usage |
| Supabase Auth                    | 100k MAU included on Pro; good if you adopt Supabase                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | in Pro      |
| Keycloak                         | Enterprise SSO; heavy Java service for a solo dev                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | ops cost    |
| Own OTP + JWT                    | You will re-implement rate limits, attempt caps, session revocation, device lists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | time        |

**Pick Better Auth** with: phone OTP via MSG91 (retailers, reps, delivery), email+password or passkey for owners, `organization` = distributor tenant, a user's memberships = the "retailer linked to many distributors" relationship (retailer identity is global; membership rows are tenant-scoped — exactly the CONTEXT rule). Sessions are DB-backed (revocable when a rep quits), mobile uses bearer session tokens; a short-lived JWT plugin only if a separate service needs stateless verification. Rate-limit OTP per phone and per IP at the API (NestJS throttler) and cap SMS spend with an alarm.

**Authorization:** three layers. (1) Better Auth org roles decide _which tenant and role_ go into the transaction settings; (2) **CASL** abilities in `shared/` express action/subject/field rules (`cannot('read', 'Product', ['purchasePrice'])` for reps) and run isomorphically in the apps and API ([CASL](https://casl.js.org/v6/en/guide/intro/)); (3) RLS + the cost-table split (§2.3) make the database refuse what code forgets. Cerbos (open source PDP; Hub from $25/month) is a later option if brands demand policy-as-code audits ([Cerbos](https://www.cerbos.dev/pricing)) — not needed now.

---

## 8. Observability, backups, CI/CD, IaC, containers, blue/green

- **Telemetry:** OpenTelemetry Node SDK with `@opentelemetry/auto-instrumentations-node` (traces/metrics stable; the JS logs SDK is still "under development" per the docs — ship logs as JSON via pino to a log sink) ([OTel Node](https://opentelemetry.io/docs/languages/js/getting-started/nodejs/)); NestJS 12's `@nestjs/observe` wires the request lifecycle automatically. Backends: **Grafana Cloud Free** — 10k metric series, 50 GB logs, 50 GB traces, 14-day retention, 3 users; Pro adds a $19 platform fee, $6.50/1k series, $0.50/GB logs ([pricing](https://grafana.com/pricing/)); **Sentry Developer** free (5k errors) → Team $26/month (50k errors) ([pricing](https://sentry.io/pricing/)); **Axiom** free 500 GB/month, 30-day retention if you prefer a single log/trace store ([pricing](https://axiom.co/pricing)). Add a synthetic check hitting `/health` from outside India and inside India.
- **Backups/PITR:** RDS automated backups + PITR (managed); additionally a nightly `pg_dump` to a _second_ S3 bucket with Object Lock and a monthly **restore drill** — a backup you have not restored is a hypothesis. On self-managed Postgres (DO Droplet or EC2) use **pgBackRest** (parallel, incremental, S3 target, encryption, PITR) ([pgBackRest](https://pgbackrest.org/)) with WAL archiving ([PG continuous archiving](https://www.postgresql.org/docs/current/continuous-archiving.html)). DO Managed PG backup/PITR terms **[unverified today]**.
- **CI/CD:** GitHub Actions — 2,000 free minutes/month on Free, 3,000 on Team; Linux overage $0.006/min ([billing](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions)). Pipeline: `pnpm turbo run lint typecheck test --filter=...[origin/main]` → build multi-arch Docker (arm64 for Graviton/Fargate ARM) → push ECR → run migration task → ECS blue/green with 10-minute bake and auto-rollback. Turborepo remote cache keeps CI minutes small ([Turborepo](https://turborepo.dev/docs)).
- **IaC:** **SST v3** — TypeScript, built on Pulumi/Terraform providers, first-class AWS + Cloudflare components (Postgres, Service/ECS, Bucket), resource linking, no Pulumi account required ([SST](https://sst.dev/docs/)). It keeps infra in the same language and repo as everything else, which is the point for a solo dev. If you go DO first, use **Kamal 2** (Docker deploys to any Ubuntu host, zero-downtime via kamal-proxy, Let's Encrypt SSL, Postgres/Valkey "accessories") ([Kamal](https://kamal-deploy.org/)) and a 40-line Terraform/OpenTofu file for the droplet, managed DB and Spaces.
- **Containers:** one Dockerfile, multi-stage, `node:24-alpine`, non-root, `pnpm deploy --filter backend/api --prod` for a slim image; API and worker are the _same image_ with different `CMD`.
- **Blue/green:** ECS native blue/green (no CodeDeploy needed) runs blue and green simultaneously during bake time and rolls back by keeping blue alive ([ECS docs](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-blue-green.html)); on Kamal, the proxy does a rolling swap. Either way the rule that matters is **expand/contract migrations**: add columns nullable, backfill by job, switch code, drop later.

---

## 9. Monorepo tooling and folder layout

**pnpm workspaces + Turborepo.** Turborepo supports npm/yarn/pnpm, caches task outputs locally and remotely, and is "adopted incrementally … in just a few minutes" with one `turbo.json` ([docs](https://turborepo.dev/docs)). Nx offers a richer project graph, generators and module-boundary lint rules, but its docs page 404'd today and, for one person, its extra concepts (executors, plugins, Nx Cloud) are ceremony without a team to pay it off. Enforce module boundaries with `eslint-plugin-boundaries` instead. NestJS 12's own monorepo mode (Rspack bundling) is not needed — keep Nest as a plain workspace package.

```
distribution-os/
├─ package.json  pnpm-workspace.yaml  turbo.json  tsconfig.base.json  .github/workflows/
├─ frontend/
│  ├─ apps/
│  │  ├─ owner-web/            # Next.js or Vite+React PWA: dashboard, approvals, price control, live map
│  │  ├─ field-mobile/         # Expo (iOS+Android): rep / warehouse-manager / delivery modules, role-gated
│  │  └─ retailer-mobile/      # Expo: shopping-app experience, WhatsApp-first notifications
│  └─ packages/
│     ├─ ui/                   # design system, Hindi/English i18n, number/currency formatting
│     ├─ api-client/           # oRPC client + TanStack Query hooks (types come from backend/libs/contracts)
│     └─ offline/              # SQLite (expo-sqlite) queue + sync engine, idempotency keys, UUIDv7
├─ backend/
│  ├─ apps/
│  │  ├─ api/                  # NestJS 12 (Fastify) — the modular monolith
│  │  │  └─ src/modules/
│  │  │     ├─ tenancy/        # tenants, plans, subscription status, tenant-context guard
│  │  │     ├─ identity/       # Better Auth mount, org memberships, device sessions, OTP providers
│  │  │     ├─ catalog/        # GLOBAL manufacturers/products/variants/HSN + curation workflow
│  │  │     ├─ tenant-catalog/ # tenant_products overlay, costs (owner/manager only), case sizes
│  │  │     ├─ retailers/      # retailer aggregate, credit limits, price tier, directory opt-in
│  │  │     ├─ pricing/        # price lists, overrides, schemes, bargain requests (domain service)
│  │  │     ├─ orders/         # Sales Order aggregate + fulfilment state machine
│  │  │     ├─ inventory/      # stock ledger, balances, reservations, batches, locations (incl. vans)
│  │  │     ├─ procurement/    # purchase orders, GRN from document-intelligence commits, LR docs
│  │  │     ├─ billing/        # invoices (CGST/SGST/IGST, e-way fields, UPI QR), credit notes
│  │  │     ├─ receivables/    # double-entry journal, receipts, allocations, ageing, outstanding
│  │  │     ├─ delivery/       # vehicles, trips, stops, delivery state machine, GPS ingest
│  │  │     ├─ docint/         # photo -> LLM vision extraction -> review queue -> commit (never auto)
│  │  │     ├─ incentives/     # targets, achievements, computed amounts
│  │  │     ├─ notifications/  # WhatsApp/SMS/push adapters, templates (Hindi/English)
│  │  │     ├─ reporting/      # read models, daily aggregates, materialized views, SSE feeds
│  │  │     └─ imports/        # Tally/Marg/CSV importers, rate-limited background jobs
│  │  │     # each module: domain/  application/  infrastructure/  http/  (+ events.ts, module.ts)
│  │  └─ worker/               # same image, pg-boss consumers: outbox handlers, crons, imports, docint
│  ├─ db/                      # drizzle schema (one file per module), RLS policies, migrations/, seeds/
│  └─ infra/                   # sst.config.ts (AWS) | kamal/deploy.yml (DO), Dockerfile, otel config
└─ shared/
   ├─ contracts/               # Zod 4 schemas + oRPC router *types*; OpenAPI json generated in CI
   ├─ domain/                  # pure TS used by server AND apps: money/qty value objects, GST split,
   │                           # scheme stacking, order/delivery/invoice state machines, CASL abilities
   └─ config/                  # tsconfig, eslint (incl. boundaries), prettier, vitest presets
```

Rules that keep this honest with one developer: modules talk to each other only through exported application services or outbox events (never import another module's repository); `backend/libs/domain` has zero runtime dependencies so it bundles into Expo; `backend/db` is the only place SQL schema lives; every mutating procedure in `backend/libs/contracts` declares an `idempotencyKey` input.

---

## 10. Sequencing for a solo build (dependency order, not "phases")

CONTEXT says "build all five at once" but also that dependency sequencing is needed. Backend modules in dependency order: tenancy → identity → catalog + tenant-catalog → retailers → pricing → orders → inventory → billing → receivables → delivery → docint → notifications → reporting → incentives → imports. The first three weeks are unglamorous (tenancy, RLS, auth, contracts, CI) and are exactly what makes the remaining modules cheap. Ship the manager app's GRN-by-photo and the rep app's order-taking first, because they populate the ledgers every other screen reads.

---

## 11. Risks and things I could not verify

- Drizzle v1 is still release-candidate; pin 0.45.x and expect one migration-file review when upgrading. Prisma 7/8 is a credible alternative if you prefer its migration UX, at the cost of writing RLS in raw SQL.
- Exact DPDP Rules text (rule numbers, SDF thresholds) — official PDFs returned 403/404 today; conclusions above rest on EY/KPMG/PRS/Wikipedia summaries.
- GCP Cloud SQL / Azure Flexible Server India prices, ALB hourly price in Mumbai, DO managed-PG backup/PITR terms, Typesense/Upstash India regions — not verified.
- SMS OTP cost scales with retailer logins; move retailers to WhatsApp-based login or long-lived device sessions early.
- Postgres LISTEN/NOTIFY and pg-boss both live on the primary; at ~100 distributors, watch primary CPU and move notification fan-out to Valkey/BullMQ if it exceeds ~10% of load.
- A single-region deployment has no DR; at 10+ paying distributors, add cross-region RDS snapshot copies to ap-south-2 (Hyderabad) and rehearse a restore.

---

## Sources (fetched 2026-09-04)

- NestJS 12 release: https://github.com/nestjs/nest/releases/tag/v12.0.0 · Modules: https://docs.nestjs.com/modules · Fastify adapter: https://docs.nestjs.com/techniques/performance
- Fastify benchmarks: https://fastify.dev/benchmarks/ · fastify-type-provider-zod: https://github.com/turkerdev/fastify-type-provider-zod
- Hono: https://hono.dev/docs/concepts/benchmarks · https://hono.dev/docs/getting-started/nodejs · https://hono.dev/examples/zod-openapi · https://github.com/honojs/hono/releases
- AdonisJS: https://docs.adonisjs.com/guides/preface/introduction · Node releases: https://nodejs.org/en/about/previous-releases
- PostgreSQL RLS: https://www.postgresql.org/docs/current/ddl-rowsecurity.html · AWS RLS multi-tenant: https://aws.amazon.com/blogs/database/multi-tenant-data-isolation-with-postgresql-row-level-security/ · Crunchy Data: https://www.crunchydata.com/blog/row-level-security-for-tenants-in-postgres · Supabase RLS performance: https://supabase.com/docs/guides/database/postgres/row-level-security
- PG18 release: https://www.postgresql.org/about/news/postgresql-18-released-3142/ · Partitioning: https://www.postgresql.org/docs/current/ddl-partitioning.html · NOTIFY: https://www.postgresql.org/docs/current/sql-notify.html · Materialized views: https://www.postgresql.org/docs/current/sql-refreshmaterializedview.html · pg_trgm: https://www.postgresql.org/docs/current/pgtrgm.html · PITR: https://www.postgresql.org/docs/current/continuous-archiving.html
- Outbox: https://microservices.io/patterns/data/transactional-outbox.html · TigerBeetle two-phase: https://docs.tigerbeetle.com/coding/two-phase-transfers/ · Stripe idempotency: https://docs.stripe.com/api/idempotent_requests
- Drizzle: https://orm.drizzle.team/docs/rls · https://orm.drizzle.team/docs/migrations · https://github.com/drizzle-team/drizzle-orm/releases · Prisma 7 upgrade: https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7 · https://github.com/prisma/prisma/releases · Kysely: https://kysely.dev/docs/intro · Zod 4: https://zod.dev/v4 · oRPC: https://orpc.dev/docs/getting-started
- pg-boss: https://github.com/timgit/pg-boss · https://github.com/timgit/pg-boss/releases · BullMQ: https://docs.bullmq.io/ · Temporal Cloud pricing: https://docs.temporal.io/cloud/pricing · Valkey: https://valkey.io/
- Supabase: https://supabase.com/docs/guides/platform/regions · https://supabase.com/pricing · https://supabase.com/docs/guides/realtime/limits · Neon regions: https://neon.com/docs/introduction/regions · Aiven clouds: https://aiven.io/docs/platform/reference/list_of_clouds · Fly regions: https://fly.io/docs/reference/regions/ · Railway: https://docs.railway.com/reference/regions · Render: https://render.com/docs/regions · Hetzner: https://docs.hetzner.com/cloud/general/locations/ · DigitalOcean: https://docs.digitalocean.com/platform/regional-availability/ · https://www.digitalocean.com/pricing/managed-databases · https://www.digitalocean.com/pricing/droplets · https://www.digitalocean.com/pricing/spaces-object-storage · Cloud Run locations: https://docs.cloud.google.com/run/docs/locations · Azure regions: https://learn.microsoft.com/en-us/azure/reliability/regions-list · ClickHouse Cloud regions: https://clickhouse.com/docs/cloud/reference/supported-regions · Tiger Cloud: https://www.tigerdata.com/docs/about/latest/pricing-and-account-management
- AWS Price List bulk CSVs (ap-south-1): https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/ap-south-1/index.csv (and AmazonEC2, AmazonS3, AmazonECS, AmazonElastiCache, AWSDataTransfer equivalents)
- R2: https://developers.cloudflare.com/r2/pricing/ · https://developers.cloudflare.com/r2/reference/data-location/
- DPDP: https://prsindia.org/billtrack/digital-personal-data-protection-bill-2023 · https://www.ey.com/en_in/insights/cybersecurity/decoding-the-digital-personal-data-protection-act-2023 · https://kpmg.com/in/en/insights/digital-personal-data-protection-dpdp.html · https://en.wikipedia.org/wiki/Digital_Personal_Data_Protection_Rules,_2025
- Auth: https://www.better-auth.com/docs/introduction · https://www.better-auth.com/docs/plugins/phone-number · https://www.better-auth.com/docs/plugins/organization · https://www.better-auth.com/docs/integrations/expo · Clerk: https://clerk.com/pricing · MSG91: https://msg91.com/in/pricing · CASL: https://casl.js.org/v6/en/guide/intro/ · Cerbos: https://www.cerbos.dev/pricing
- Observability/ops: https://opentelemetry.io/docs/languages/js/getting-started/nodejs/ · https://grafana.com/pricing/ · https://sentry.io/pricing/ · https://axiom.co/pricing · https://pgbackrest.org/ · https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions · https://sst.dev/docs/ · https://kamal-deploy.org/ · https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-blue-green.html · https://turborepo.dev/docs
