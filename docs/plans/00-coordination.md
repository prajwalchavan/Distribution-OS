# 00 — Coordination contract for the last ten backend modules

The ten briefs in `docs/plans/` were written independently and therefore contradict each other: four claim migration
`0006`, three each propose to build "a minimal version" of the same shared service, several rename the same method,
and several restate the same founder question with a different assumed answer. **This file wins over any individual
brief.** Where a brief disagrees with a rule here, this file is right and the brief is stale.

Ground truth checked against the repo on 2026-09-04 (not against the briefs):

- Highest migration on disk is `0005_auth_guarantees`; `migrations/meta/_journal.json` has entries `idx` 0–5.
  **Next free number is 0006.**
- Seven services exist, not five: `auth` :3000 (all roles), `owner` :3001, `manager` :3002 (manager + accountant),
  `sales` :3003, `warehouse` :3004, `delivery` :3005, `retailer` :3006.
- **Auth is done.** Bearer JWT; the `x-tenant-id` / `x-actor-id` / `x-actor-role` headers are gone. Any brief text
  about header actors is stale.
- `platform/authz.ts`'s `STAFF` **already contains `'warehouse'`.** billing §4.20, docint §2 and warehouse §3 all say
  it does not. Do not "fix" it.
- `InventoryService` already exports `post`, `reserve`, `releaseReservation`, `postReservationAsSale`,
  `findOrCreateLot`, `pgConstraint`. Only `postPick`, `listReservations`, `ensureVehicleLocation`,
  `valuationByLocation`, `ledgerRowsByReason` are missing.
- `pg_trgm` is **not** installed. integrations §4.6 ("already an installed extension per D12") is wrong; docint §3h is
  right.
- `CHART_OF_ACCOUNTS` has `CASH_VAN`, `CHEQUES`, `UPI`, `BAD_DEBTS`, `OPENING`, `SCHEME_EXPENSE`,
  `SCHEME_RECEIVABLE`, `CLAIMS_RECEIVABLE`, `DAMAGES`, `TRIP_EXPENSES`, `ROUND_OFF`. It is **missing**
  `BANK_CHARGES` and `CASH_SHORT`. The account code is `CHEQUES`, not `CHEQUES_IN_HAND` (delivery §2 is wrong).
- `NUMBERING_SERIES` has `INV CN SO GRN PO RCPT TRIP PICK CLAIM`. **`DC` is missing** (warehouse needs it).
- Founder decided **English only, no i18n, no Devanagari fonts** (build log §4d, 2026-09-04 23:00). Every brief that
  says "headless Chromium with Noto Sans Devanagari" or "bilingual Hindi message" is stale for this phase.

---

## 1. Build order and why

**The order in the task is right for 1–5 and wrong for 6–9.** `integrations` moves from 9 to 6.

| #   | module                               | what it unblocks                                                                                                                                                                                                                  | why here                                                                                                                                               |
| --- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **receivables**                      | the money ledger every later module posts through (`postEntry`), the credit verdict orders already needs, outstanding/ageing                                                                                                      | owns `journal_*`, `accounts`, `receipts`, `allocations`; billing, delivery, claims all post through it, so it cannot be second                         |
| 2   | **billing**                          | the invoice document, GST split, credit notes, registers; `issueForPack` for warehouse, `issueFromLocation` for delivery, `importBrandDms` + `recordOpeningInvoice` for integrations, `RegistersService` for reporting and claims | needs receivables' ledger; four later modules import from it                                                                                           |
| 3   | **warehouse**                        | pick → pack → invoice → load sheet → challan; `LoadSheetsService.confirmedForTrip` for delivery                                                                                                                                   | needs billing's `issueForPack`; delivery reads its load sheets                                                                                         |
| 4   | **delivery**                         | trips, doorstep POD, collections, van sales, settlement; the real `deliveryPerformance` rows reporting wants                                                                                                                      | needs warehouse's load sheet, billing's credit notes, receivables' receipts                                                                            |
| 5   | **docint**                           | inbound invoice capture → supplier invoice draft; **installs `pg_trgm`**, which integrations' fuzzy matching stands on; **builds the outbox handler registry** in the worker                                                      | independent of 1–4 (it only calls procurement/catalog); must precede integrations for `pg_trgm`                                                        |
| 6   | **integrations** _(moved up from 9)_ | `export_jobs` + `ExportJobsService` + the single `exports.render` queue with a per-`kind` renderer registry; TradeEzee/FieldAssist imports; opening balances; Tally XML                                                           | see below                                                                                                                                              |
| 7   | **claims**                           | scheme/damage/expiry recovery from brands; registers a `claim_sheet` renderer on integrations' queue                                                                                                                              | needs billing's invoice lines, receivables' `postEntry`, procurement's discrepancies, and integrations' `enqueueExport`                                |
| 8   | **notifications**                    | every WhatsApp/SMS/push row; consumes the events modules 1–7 already emit                                                                                                                                                         | needs docint's relay registry; every event shape it consumes is real by now, so no no-op handlers                                                      |
| 9   | **reporting**                        | dashboards, registers, chart series for the owner app; registers `report_*` renderers on integrations' queue                                                                                                                      | wraps billing's `RegistersService` and receivables' `collectionsRegister`; **`deliveryPerformance` is real, not a stub, because delivery landed at 4** |
| 10  | **incentives**                       | targets, achievements, statements                                                                                                                                                                                                 | leaf; reads orders/visits/receipts aggregates that all exist by now                                                                                    |

### Why integrations must move to 6

`claims.statements.generate` calls `IntegrationsService.enqueueExport()` (claims §2, §4.17) and
`reporting.exports.request` calls an `ExportJobsService` in `modules/integrations` (reporting §1, §8.2). Both briefs,
written independently, propose to **build their own minimal version of the same service on the same table**. In the
task's order, integrations lands at 9 — after both — so `export_jobs` would be written by three modules and the
`exports.render` worker job would exist three times (claims §7, reporting §7, integrations §7), all polling one table.

Integrations itself depends only on `RetailersService`, `CatalogService`, `TenantCatalogService`, `BillingService`,
`ReceivablesService`, `ProcurementService` — all built by step 4 — plus `pg_trgm` from docint at 5. Nothing in
integrations needs claims, notifications, reporting or incentives. Slot 6 is free of forward references in both
directions.

The alternative (leave integrations at 9, let claims build the stub) is the exact pattern this document exists to
kill. If the founder insists on the original order, the fallback rule is: **claims at 6 builds
`modules/integrations/{export-jobs.service.ts,integrations.module.ts,index.ts}` and the `exports.render` queue with
the renderer registry, integrations at 9 extends it and deletes nothing.** Do not let reporting build a second one.

### Two other order facts, not reorders

- **docint (5) does not depend on 1–4 at all.** It could be built at any point. It stays at 5 because it installs
  `pg_trgm` and the outbox registry, and both are wanted before 6.
- **`modules/imports/README.md` is a stub for exactly integrations' scope.** The main session deletes that folder when
  `modules/integrations/integrations.module.ts` lands (integrations §"Files to create"). Reporting must not create
  `modules/integrations` — by the corrected order it already exists.

---

## 2. Migration number assignment

### The rule

1. Migrations are **expand-only from 0004 onward**. No `DROP COLUMN`, no `DROP TABLE`, no narrowing type change.
   Policy replacement (`DROP POLICY` + `CREATE POLICY`, or `ALTER POLICY`) and check-constraint replacement are
   allowed — they move no data.
2. **A number is claimed when the module is built, not when its brief was written.** Before writing a migration, read
   `backend/libs/database/migrations/meta/_journal.json`, take `max(idx) + 1`, and append your entry. If the build
   order shifts, every number below shifts with it — the table is the plan, the journal is the truth.
3. **Split by what drizzle-kit can express, not by taste.** Anything declared in `src/schema/*.ts` (columns, tables,
   enum values, indexes, `DROP NOT NULL`) goes in the **generated** file from `pnpm db:generate`. Anything drizzle
   cannot express goes in the **hand-written sibling**: policy replacement, `FORCE ROW LEVEL SECURITY`, `GRANT`,
   triggers and functions, `CREATE EXTENSION`, check-constraint swaps, backfill + `SET NOT NULL`, views. Several
   briefs hand-write index DDL that is also declared in the schema — do not: the next `pnpm db:generate` will emit it
   again.
4. **`ALTER TYPE … ADD VALUE` goes in the generated file** (this is what `0004` did for `'warehouse'`). PostgreSQL 12+
   allows it inside a transaction; what it forbids is _using_ the new value in the same transaction. So the value is
   added in the generated file and first used from the hand-written sibling or from application code. The briefs that
   say "must run outside a transaction block" (claims §3, delivery §3.3, integrations §3.1) are stale.
5. Both halves get an entry in `meta/_journal.json` with `"version": "7"`.

### The assignment

| #    | module        | file                                             | contains                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | depends on |
| ---- | ------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 0006 | receivables   | `0006_receivables_expand.sql` (generated)        | `receipts`: `device_id`, `client_receipt_no`, `reverses_receipt_id`, `deposited_at`, `deposit_ref`, `deposit_account_id`, `bounced_at`, `bounce_reason`, `bank_charges_paise`. New tables `write_offs`, `retailer_outstanding_summary`. `allocations.write_off_id`. `ageing_snapshots`: `bucket_61_90_paise`, `bucket_90_plus_paise`, `overdue_paise`, `unallocated_credit_paise`, `computed_at`. Indexes `receipts_device_client_no_idx` (partial unique), `receipts_status_idx`, `write_offs_idempotency_idx`, `write_offs_invoice_idx`, `retailer_outstanding_overdue_idx`, `retailer_outstanding_amount_idx`, `allocations_write_off_idx` | 0005       |
| 0007 | receivables   | `0007_receivables_guarantees.sql` (hand-written) | Policy replacement on `journal_entries`, `journal_lines`, `accounts`, `allocations`, `cash_discount_conditions` (§5). `FORCE ROW LEVEL SECURITY` + `GRANT` for `write_offs` and `retailer_outstanding_summary`. Check swaps: `receipts_amount_positive` → `receipts_amount_nonzero`, `allocations_amount_positive` → `allocations_amount_nonzero`, `allocations_one_source` → the three-way form. **`CREATE OR REPLACE FUNCTION dos_journal_entry_balanced() … SECURITY DEFINER SET search_path = public`** (§5, this is a real hole)                                                                                                         | 0006       |
| 0008 | billing       | `0008_billing_expand.sql` (generated)            | `invoices_order_active_idx` (partial unique, `state <> 'cancelled'`), `invoices_external_no_idx` (partial unique), `invoices_source_date_idx`, `credit_notes_retailer_idx` — all declared in `schema/billing.ts`. No new tables, columns or enums                                                                                                                                                                                                                                                                                                                                                                                             | 0007       |
| 0009 | billing       | `0009_billing_guards.sql` (hand-written)         | The single shared `tenant_settings` read policy (§5): `CREATE POLICY tenant_settings_staff_read`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 0008       |
| 0010 | warehouse     | `0010_warehouse_fulfilment.sql` (generated)      | `load_sheet_status` enum. `picklists`: `pick_date`, `trip_id`, `beat_id`, `note`, `cancelled_at`, `cancel_reason`. `pick_lines`: `variant_id`, `line_no`, `free_qty_pcs`, `suggested_lot_id`, `case_size`, `fefo_override`. `pack_confirmations`: `picklist_id`, `short_packed`. `load_sheets`: `status`, `sheet_date`, `expected_packages`, `counted_packages`, `variance_note`, `pin_verified_by`, `ewb_required`, `cancelled_at`, `cancel_reason`, `trip_id DROP NOT NULL`. `delivery_challans`: `series_code`, `load_value_gst_paise`. Indexes per §5 (including dropping the now-redundant `pack_confirmations_order_idx`)               | 0009       |
| 0011 | warehouse     | `0011_warehouse_guarantees.sql` (hand-written)   | Drop `picklists_tenant`, `pick_lines_tenant`, `pack_confirmations_tenant`, `load_sheets_tenant`, `delivery_challans_tenant`; create `staffReadPolicy` + `roleWritePolicies(STOCK_KEEPER_ROLES)` for each (new helpers in `columns.ts`)                                                                                                                                                                                                                                                                                                                                                                                                        | 0010       |
| 0012 | delivery      | `0012_delivery_expand.sql` (generated)           | `ALTER TYPE approval_kind ADD VALUE 'trip_settlement'`. `trip_points.device_id` (nullable here). `trip_settlements`: `approved_by`, `approved_at`. `deliveries`: `retailer_id` (nullable here), `device_id`. Indexes `trip_points_dedupe_idx`, `deliveries_stop_invoice_idx`, `deliveries_retailer_idx`                                                                                                                                                                                                                                                                                                                                       | 0011       |
| 0013 | delivery      | `0013_delivery_guarantees.sql` (hand-written)    | Backfill `deliveries.retailer_id` from `trip_stops` and `trip_points.device_id` to `''`, then `SET NOT NULL` on both. Policy replacement on `deliveries`, `delivery_lines`, `pod_evidence`, `vehicles`, `trips`, `trip_expenses`, `collections`, `trip_settlements`, `vehicle_positions` (§5)                                                                                                                                                                                                                                                                                                                                                 | 0012       |
| 0014 | docint        | `0014_docint_pipeline.sql` (generated)           | `document_qr_status` enum. `documents`: `expected_pages`, `captured_at`, `note`, `rejected_reason`, `attempt_count`, `job_id`, `prompt_profile`, `qr_status`. `document_pages`: `sha256`, `printed_page_label`, `qr_detected`. `extractions`: `invoice_no`, `invoice_date`, `supplier_gstin`, `buyer_gstin`, `total_paise`, `line_count`, `engine_version`, `escalated_from_extraction_id`. `extraction_checks.line_no`. `sku_match_candidates`: `matched_by`, `features`. `review_sessions`: `edits_count`, `heartbeat_at`. `supplier_aliases`: `hits`, `last_seen_at`. Indexes per §5                                                       | 0013       |
| 0015 | docint        | `0015_docint_guarantees.sql` (hand-written)      | `CREATE EXTENSION IF NOT EXISTS pg_trgm` + the five `gin_trgm_ops` indexes. `ALTER POLICY documents_tenant` and `document_pages_tenant` to the kind-scoped predicates (docint §3i)                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 0014       |
| 0016 | integrations  | `0016_integrations_expand.sql` (generated)       | `ALTER TYPE job_status ADD VALUE 'staged'`. `import_jobs`: `started_at`, `finished_at`. `import_rows`: `reviewed_by`, `reviewed_at`. `tally_sync_ledger_export_idx`. **No hand-written sibling** — integrations changes no policy (all five of its tables are already `tenantRolePolicy(…, BACK_OFFICE_ROLES)` from `0003`)                                                                                                                                                                                                                                                                                                                   | 0015       |
| 0017 | claims        | `0017_claims_expand.sql` (generated)             | `ALTER TYPE claim_status ADD VALUE 'written_off'`. New enums `claim_value_basis`, `claim_period_kind` (declared in `tenant-catalog.ts`), `claim_settlement_mode`, `claim_line_status`. `return_policies` +6 columns. `claims` +9 columns. `claim_lines` +10 columns. `claim_evidence` +2 columns. `claim_statements`: `object_key`/`generated_at` DROP NOT NULL, `export_job_id`, `row_count`. New table `claim_settlements`. Indexes per §5                                                                                                                                                                                                  | 0016       |
| 0018 | claims        | `0018_claims_guarantees.sql` (hand-written)      | `FORCE ROW LEVEL SECURITY` + `GRANT` for `claim_settlements`. The `coalesce()`-based partial unique indexes and the two check constraints (`claims_settled_within_claimed`, `claims_period_order`) that drizzle cannot express                                                                                                                                                                                                                                                                                                                                                                                                                | 0017       |
| 0019 | notifications | `0019_notifications_expand.sql` (generated)      | `messages`: `attempts`, `next_attempt_at`. New table `broadcasts`. Indexes `messages_dispatch_idx` (partial), `messages_recipient_retailer_idx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 0018       |
| 0020 | notifications | `0020_notifications_guards.sql` (hand-written)   | `FORCE ROW LEVEL SECURITY` + `GRANT` for `broadcasts`. Policy replacement on `messages`, `inbound_messages`, `whatsapp_windows`, `push_tokens` (§5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 0019       |
| 0021 | reporting     | `0021_reporting_expand.sql` (generated)          | `daily_rep_stats_day_idx` on `(tenant_id, day)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 0020       |
| 0022 | reporting     | `0022_reporting_guards.sql` (hand-written)       | Drop `daily_tenant_stats_tenant` and `retailer_behaviour_tenant`; create `tenantRolePolicy(…, STAFF_ROLES)` for both                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 0021       |
| 0023 | incentives    | `0023_incentives_expand.sql` (generated)         | `ALTER TYPE target_metric ADD VALUE 'visits'`. `targets`: `name`, `created_by`. `targets_tenant_period_idx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 0022       |
| 0024 | incentives    | `0024_incentives_guards.sql` (hand-written)      | Split `computed_payouts_back_office` into `computed_payouts_read` (back office **or** `user_id = actor`) and `computed_payouts_write` (back office only)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 0023       |

**Modules needing no migration: none.** All ten touch the schema. The smallest is integrations (one generated file,
no hand-written sibling); the next smallest are billing (four index declarations plus one shared policy) and reporting
(one index plus two policy swaps).

Not migrations, but schema-adjacent code edits — do them in the same slice:

| slice           | file                      | change                                                                                                                                                                                                                                                 |
| --------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 receivables   | `src/tenant-bootstrap.ts` | add `{ code: 'BANK_CHARGES', name: 'Bank charges', kind: 'expense' }` to `CHART_OF_ACCOUNTS` (insert is `onConflictDoNothing`, so re-running `bootstrapTenant` backfills every tenant)                                                                 |
| 3 warehouse     | `src/tenant-bootstrap.ts` | add `{ seriesCode: 'DC', prefix: 'DC-' }` to `NUMBERING_SERIES`; insert default `tenant_settings('ewb_intra_state_threshold', 10000000)` in `bootstrapTenant`                                                                                          |
| 4 delivery      | `src/tenant-bootstrap.ts` | add `{ code: 'CASH_SHORT', name: 'Cash short/over on settlement', kind: 'expense' }`; insert defaults `delivery.settlement_tolerance_paise=10000`, `delivery.pod_required='credit_only'`, `delivery.geofence_metres=150`, `dpdp.gps_retention_days=90` |
| 8 notifications | `src/tenant-bootstrap.ts` | insert default `notifications.default_locale='en-IN'` (English-only decision, build log §4d — **not** `hi-IN` as the brief says)                                                                                                                       |

---

## 3. Shared services no single module owns

Rule applied throughout: **the module that owns the tables builds the service; the first module that needs a shared
platform helper builds it under an agreed name; nobody builds a second one.** If your brief says "if that module does
not yet exist, create a minimal version" — check this section first. In the corrected order, every one of those
escape hatches is unnecessary.

### 3.1 The receivables ledger surface — built by **receivables (1)**

Four briefs name it four different ways: billing wants `LedgerService`, delivery wants `ReceiptsService` +
`ReceivablesService.postJournal`, claims wants `ReceivablesService.postEntry` + `reverseEntry`, integrations wants
`ReceivablesService.postOpeningBalance`. **There is one exported class, `ReceivablesService`.** No `LedgerService`, no
`ReceiptsService`. `backend/libs/core/src/modules/receivables/index.ts` exports exactly:

```ts
export { ReceivablesModule } from './receivables.module.js'
export { ReceivablesService } from './receivables.service.js'
export { checkCredit, type CreditVerdict } from './credit.js' // moved here from modules/orders
```

`ReceivablesService` must ship **all** of these at step 1, even the ones receivables' own procedures do not use,
because steps 2, 4 and 7 import them:

```ts
postEntry(tx: Db, e: { entryDate: string; refType: string; refId: string; narration?: string
                       idempotencyKey: string
                       lines: { accountCode: string; amountPaise: number
                                partyType?: string; partyId?: string; memo?: string }[] }): Promise<{ entryId: string }>
reverseEntry(tx: Db, entryId: string, idempotencyKey: string, narration?: string): Promise<{ entryId: string }>
postInvoiceIssued(tx: Db, invoice: InvoiceForPosting): Promise<{ entryId: string }>
postCreditNoteIssued(tx: Db, cn: CreditNoteForPosting, opts?: { autoAllocate?: boolean }): Promise<{ entryId: string }>
postOpeningBalance(tx: Db, i: { retailerId: string; invoiceId: string; amountPaise: number
                                asOfDate: string; importJobId: string }): Promise<{ entryId: string }>
openCashDiscountCondition(tx: Db, i: { id: string; invoiceId: string; discountBps: number; payBy: string }): Promise<void>
allocateCreditNote(tx: Db, i: { id: string; invoiceId: string; creditNoteId: string; amountPaise: number }): Promise<void>
invoiceOutstandingPaise(tx: Db, invoiceId: string): Promise<number>
recordReceipt(tx: Db, i: RecordReceiptInput): Promise<RecordReceiptResult>
creditVerdict(tx: Db, retailerId: string, orderTotalPaise: number): Promise<CreditVerdict>
refreshOutstanding(tx: Db, retailerId: string): Promise<void>
```

Added later by the slice that needs them, as small edits to receivables' own files (allowed, and listed here so they
are not invented twice): `collectionsRegister(tx, {from, to, groupBy})` and `outstandingList(tx, filter)` by
**reporting (9)**; `collectedByUser(tx, {userId, from, to})` by **incentives (10)**.

Delivery (4) calls `recordReceipt` and `postEntry`. It must not call anything named `ReceiptsService.record` or
`postJournal`; those names do not exist.

### 3.2 `invoices.state` — written by **receivables**, one sanctioned exception

billing owns `invoices`; receivables computes the payment state. Making billing export
`setInvoicePaymentState()` and receivables call it creates a genuine import cycle between two Nest modules
(`billing → receivables` for the ledger, `receivables → billing` for the state), resolvable only with `forwardRef` —
worse than the disease.

**Decision:** `invoices.state` and `invoices.due_date` are the two columns receivables writes directly, with a
`// module-boundary: receivables owns the derived payment state, see docs/plans/00-coordination.md §3.2` comment and
an `eslint-plugin-boundaries` exception, exactly the way `orders/credit.ts` is already sanctioned. Every other invoice
column is billing's alone. The guarantee is not the import graph — it is the `invoices_immutable` trigger from
migration `0003`, which already permits only `state` and the document-key columns to change after issue.
Consequently: **billing → receivables is the only edge; there is no receivables → billing import.**

### 3.3 Object storage and pre-signed URLs — built by **billing (2)**

Assumed by receivables (statement PDFs), billing (invoice PDFs), warehouse (challan PDFs), delivery (POD photos,
expense proofs), docint (page images — its brief proposes a _second_ implementation, `createStorage()` in
`@dos/docint`; do not build it), claims (evidence, statement files), reporting (CSV files), integrations (import
source files, export files). Nothing exists today: a grep for `objectStorage`, `presign`, `S3Client`, `@aws-sdk`
across `backend/libs/core/src` and `backend/worker/src` returns nothing.

Billing builds `backend/libs/core/src/platform/object-storage.ts` as **plain, DI-free functions** (not an
`@Injectable`), exported through a new `"./platform"` subpath in `@dos/core`'s `package.json` `exports`, and adds
`"@dos/core": "workspace:*"` to `backend/worker/package.json` at the same time. The worker imports
`@dos/core/platform` only — never the barrel — so tsx never has to resolve a Nest constructor.

```ts
export interface ObjectStorage {
  putUrl(
    key: string,
    opts: { mimeType: string; bytes: number; ttlSeconds?: number },
  ): Promise<{
    url: string | null
    method: 'PUT' | null
    headers: Record<string, string>
    expiresAt: string
    inline: boolean
  }>
  getUrl(key: string, ttlSeconds?: number): Promise<string>
  put(key: string, body: Buffer, mimeType: string): Promise<void> // local driver / worker writes
  get(key: string): Promise<Buffer>
  delete(key: string): Promise<void>
}
export function createObjectStorage(env?: NodeJS.ProcessEnv): ObjectStorage
```

Two drivers behind `OBJECT_STORAGE_DRIVER` (`local` | `s3`, default `local`). `local` writes under
`OBJECT_STORAGE_DIR` (default `backend/.storage`, gitignored) and returns `inline: true, url: null` from `putUrl`,
meaning "send the bytes on the create call" — this is what makes the local demo work with no S3 and no Docker.
Key convention, fixed now so every module agrees: `tenant/{tenantId}/{domain}/{entityId}/{name}.{ext}` where
`domain ∈ docs | invoices | challans | pod | claims | exports | statements`.

Modules 1 (receivables) and 2 (billing) return `url: null` from every PDF procedure until a renderer exists (§3.4);
that is a normal state, not an error. docint (5) uses `createObjectStorage()` and deletes the `createStorage()` plan
from its brief; `DOCINT_STORAGE_DRIVER`/`DOCINT_STORAGE_DIR` collapse into `OBJECT_STORAGE_DRIVER`/`OBJECT_STORAGE_DIR`.

### 3.4 PDF rendering — **deferred; nobody builds it in these ten slices**

Four briefs each specify a headless-Chromium renderer (receivables §7 statements, billing §7
`invoice.pdf.render`, warehouse §7 `challan.pdf`, delivery §7 `delivery.pdf.pod`). Chromium plus a font stack is a
real dependency on a machine with no Docker, and the founder's current goal is working apps on local data.

**Decision:** billing (2) defines the queue name `documents.pdf.render` and a template registry
(`registerPdfTemplate(kind, fn)`) in `backend/worker/src/jobs/pdf-render.ts`, and ships a **stub renderer** that marks
the job `failed` with `error: 'pdf_renderer_not_configured'`. Every `*.pdf` contract procedure returns
`{ status: 'queued', url: null, objectKey: null }` and never throws. Warehouse, delivery, receivables and claims
register template ids on the same queue and build no renderer of their own. The real renderer is a separate slice
after the ten — and it uses the system font stack, **not** Noto Sans Devanagari (English only, build log §4d).

### 3.5 `export_jobs`, the export queue and the renderer registry — built by **integrations (6)**

Integrations owns `export_jobs`, `import_jobs`, `import_rows`, `tally_mappings`, `tally_sync_ledger`. It builds:

```ts
// modules/integrations/index.ts
export { IntegrationsModule, IntegrationsService, ExportJobsService } from './…'
// ExportJobsService
enqueueExport(tx: Db, i: { id?: string; kind: string; params: Record<string, unknown>; requestedBy: string }): Promise<ExportJob>
get(tx: Db, id: string): Promise<ExportJob | null>
markRunning(tx: Db, id: string): Promise<void>
markSucceeded(tx: Db, id: string, r: { objectKey: string; rowCount: number }): Promise<void>
markFailed(tx: Db, id: string, error: string): Promise<void>
```

**One queue, not three.** `backend/worker/src/jobs/exports-render.ts` owns the single `exports.render` pg-boss queue
and a registry `registerExportRenderer(kind, fn)`. Claims (7) registers `claim_sheet`; reporting (9) registers
`report_<register>_<format>`; integrations registers `tally_xml`, `gstr1_json`, `sales_register_xlsx`,
`outstanding_xlsx`, `eway_bill_json`, `einvoice_json`. Three briefs each describe their own `*.render` job polling
the same table — that would be three consumers racing for the same row. Delete `claims.statement.render` and
`reporting.export.render` as separate queues; keep them as registered renderers.

### 3.6 The outbox relay handler registry — built by **docint (5)**

`backend/worker/src/jobs/outbox-relay.ts` is a no-op that logs "no handlers registered yet". docint is the first
module whose design _requires_ an event to cause work, so its slice turns the file into a dispatcher:

```ts
export type OutboxHandler = (e: {
  tenantId: string
  aggregateType: string
  aggregateId: string
  eventType: string
  payload: unknown
}) => Promise<void>
export function registerOutboxHandler(eventType: string, handler: OutboxHandler): void
```

`published_at` is set only after **every** handler currently registered for that event type has resolved; a throwing
handler leaves the row unpublished for the next tick (at-least-once, which is why every handler must be idempotent).
One `published_at` column means "every handler that exists today saw it" — there is no per-consumer flag anywhere in
the schema and none is being added.

Modules 1–4 **write outbox rows and register no handlers.** Where a brief says a handler is needed before step 5, the
work is done inline in the same transaction instead: billing calls `ReceivablesService.postInvoiceIssued` directly
(billing §8.7 already assumes this), delivery posts its settlement journal directly. Receivables' proposed
`InvoiceIssued`/`CreditNoteIssued` safety-net consumers (receivables §7) are **not built at step 1** — they are dead
code without a registry. Notifications (8) registers handlers; it does not rebuild the file.

### 3.7 CSV writing — built by **reporting (9)**

`backend/libs/core/src/platform/csv.ts`, a plain function `renderCsv(rows, columns): string` (RFC 4180, `\r\n`, UTF-8
BOM so Excel opens rupee columns correctly). No overlap with integrations: integrations' export kinds are XML, JSON
and XLSX, and it brings its own writers for those at step 6.

### 3.8 `DATABASE_REPLICA_URL` second pool — built by **reporting (9)**

Reporting is the only module that reads it. `platform/config.ts` gains `DATABASE_REPLICA_URL: z.string().optional()`;
`platform/db.module.ts` gains a `DB_REPLICA` provider that is the same pool identity as `DB` when the variable is
unset. Every reporting GET reads `replica ?? primary`; every write and every `SELECT … FOR UPDATE` stays on the
primary. This is correctness-neutral today (one Postgres on :5439) and satisfies docs/20 rule 10. If the separate
"second pool" task in the build log's next-steps lands first, reporting uses what is there and adds nothing.

### 3.9 Small additions to already-built modules (do them in the slice that needs them)

| slice           | module edited                          | added                                                                                                                                                                                                                                                            |
| --------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2 billing       | `platform/numbering.ts`                | widen `seriesCode` from the `SeriesCode` union to `SeriesCode \| (string & {})`, keeping the `${seriesCode}-` prefix fallback — one widening, not two (billing §4.10 and delivery §3.10 both ask)                                                                |
| 2 billing       | `domain/src/state-machines/invoice.ts` | states become `draft \| issued \| partially_paid \| paid \| written_off \| cancelled`; events gain `cancel` from `draft` and `issued`; `void` is removed (it is not a value of the `invoice_state` enum). Update `state-machines.test.ts`, rebuild `@dos/domain` |
| 2 billing       | `modules/orders`                       | `markPacked(tx, order, deviceId)` — superseded at step 3 by `applyFulfilmentEvent`, keep the name as a thin alias                                                                                                                                                |
| 3 warehouse     | `modules/inventory`                    | `postPick(tx, input)`, `listReservations(tx, filter)`                                                                                                                                                                                                            |
| 3 warehouse     | `modules/orders`                       | `fulfilmentQueue`, `fulfilmentLines`, `applyFulfilmentEvent`, `recordPick`; `emitOrderEvent` union gains `OrderPicking \| OrderPacked \| OrderDispatched`                                                                                                        |
| 3 warehouse     | `schema/columns.ts`                    | `staffReadPolicy(name)`, `roleWritePolicies(name, roles)`, `STOCK_KEEPER_ROLES`                                                                                                                                                                                  |
| 4 delivery      | `modules/inventory`                    | `ensureVehicleLocation(tx, {vehicleId, name})`                                                                                                                                                                                                                   |
| 4 delivery      | `modules/orders`                       | `recordDelivered(tx, orderId, lines)`                                                                                                                                                                                                                            |
| 6 integrations  | `modules/retailers`                    | `linkExternalCode(tx, …)`, `recordPurchaseHistory(tx, rows)` — first writers of `external_party_codes` and `retailer_purchase_history`                                                                                                                           |
| 8 notifications | `modules/retailers`                    | `contactPreferences(tx, retailerId)`                                                                                                                                                                                                                             |
| 9 reporting     | `modules/orders`                       | `fillRateLines(tx, filter)`                                                                                                                                                                                                                                      |
| 9 reporting     | `modules/inventory`                    | `valuationByLocation(tx, filter)`                                                                                                                                                                                                                                |
| 9 reporting     | `modules/procurement`                  | `SupplierInvoiceService.purchaseRegister(tx, {from, to})`                                                                                                                                                                                                        |
| 9 reporting     | `modules/retailers`                    | `beatAssignmentsFor(tx, filter)`                                                                                                                                                                                                                                 |
| 10 incentives   | `modules/orders`                       | `salesAggregate(tx, {userId, brandId?, metric, from, to})` as a **plain exported function**, not a method — the incentives worker sweep imports it and cannot resolve Nest DI                                                                                    |
| 10 incentives   | `modules/retailers`                    | `visitCount(tx, {userId, from, to})`, plain function                                                                                                                                                                                                             |

**Worker rule:** anything the worker calls is a plain exported function in the owning module, never an `@Injectable`
class. tsx emits no `design:paramtypes`, so a Nest service instantiated in the worker silently receives `undefined`
dependencies (CLAUDE.md, "Decorator metadata").

---

## 4. Cross-module call graph

`eslint-plugin-boundaries` enforces that a module is reached only through its `index.ts`. This table is the complete
set of legal edges for these ten slices; anything not listed is a violation.

| caller        | callee                                                                                  | calls                                                                                                                                                               | why not just read the table                                                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| billing       | receivables                                                                             | `postEntry`, `postInvoiceIssued`, `postCreditNoteIssued`, `openCashDiscountCondition`, `allocateCreditNote`, `invoiceOutstandingPaise`                              | `journal_lines` is append-only with a deferred balance trigger and a derived idempotency key; a raw insert cannot produce a balanced, keyed, reversible entry |
| billing       | orders                                                                                  | `lockOrder`, `detail`, `markPacked`                                                                                                                                 | the order aggregate moves through `orderMachine`; a `sales_orders.state` write by hand is the one thing the state machine exists to prevent                   |
| billing       | inventory                                                                               | `reserve`, `releaseReservation`, `postReservationAsSale`, `post`                                                                                                    | `stock_ledger` is append-only and `stock_balances` is updated UPDATE-first in the same transaction; only `InventoryService` keeps the pair consistent         |
| receivables   | _(billing tables)_                                                                      | writes `invoices.state`, `invoices.due_date` directly                                                                                                               | §3.2 — the alternative is a Nest import cycle; the `invoices_immutable` trigger is the guarantee                                                              |
| receivables   | retailers                                                                               | `RetailersService` credit terms                                                                                                                                     | credit terms are retailers' column and are role-restricted                                                                                                    |
| orders        | receivables                                                                             | `creditVerdict`                                                                                                                                                     | replaces the raw SQL in `modules/orders/credit.ts`, which is deleted and re-exported from receivables so `checkCredit`'s call sites keep working              |
| warehouse     | orders                                                                                  | `fulfilmentQueue`, `fulfilmentLines`, `applyFulfilmentEvent`, `recordPick`                                                                                          | state machine + `order_state_transitions` + the outbox row must be written together                                                                           |
| warehouse     | inventory                                                                               | `postPick`, `post`, `releaseReservation`, `listReservations`                                                                                                        | ledger + balances + reservation close in one consistent step                                                                                                  |
| warehouse     | billing                                                                                 | `issueForPack`                                                                                                                                                      | numbering takes a row lock and the invoice must be immutable from its first INSERT                                                                            |
| delivery      | warehouse                                                                               | `confirmedForTrip(tx, tripId)`                                                                                                                                      | read-only "is the load confirmed"; `load_sheets` is warehouse's                                                                                               |
| delivery      | billing                                                                                 | `issueFromLocation`, `CreditNotesService.raiseForDelivery`                                                                                                          | van-sale GST and the credit note at the original rate live in exactly one module                                                                              |
| delivery      | receivables                                                                             | `recordReceipt`, `postEntry`                                                                                                                                        | doorstep cash is a numbered receipt plus a balanced entry                                                                                                     |
| delivery      | orders                                                                                  | `applyFulfilmentEvent`, `recordDelivered`                                                                                                                           | as above                                                                                                                                                      |
| delivery      | inventory                                                                               | `post`, `reserve`, `postReservationAsSale`, `ensureVehicleLocation`                                                                                                 | vehicle stock may not go negative; the constraint lives with the balance writer                                                                               |
| docint        | procurement                                                                             | `SupplierInvoiceService.create`                                                                                                                                     | the header-total check and the IRN/(supplier,no,date) duplicate refusal are procurement's, and must apply unchanged                                           |
| docint        | catalog / tenant-catalog                                                                | `search`, variant helpers, supplier resolution                                                                                                                      | global catalog is curator-owned; docint may read, never write                                                                                                 |
| integrations  | billing                                                                                 | `importBrandDms`, `recordOpeningInvoice`, `RegistersService.salesRegister`, `gstSummary`                                                                            | never a second legal invoice, and the Tally sales voucher must be the same arithmetic the register shows                                                      |
| integrations  | receivables                                                                             | `postOpeningBalance`, `outstandingList`, journal/receipt reads                                                                                                      | opening money enters the books only through a balanced entry                                                                                                  |
| integrations  | retailers                                                                               | `upsert`, `linkExternalCode`, `recordPurchaseHistory`                                                                                                               | party master and the two previously-unwritten tables                                                                                                          |
| integrations  | catalog / tenant-catalog                                                                | `search`, `upsertListing`                                                                                                                                           | a bulk import never proposes a global product                                                                                                                 |
| integrations  | procurement                                                                             | `SupplierInvoiceService.list`                                                                                                                                       | Tally purchase voucher source                                                                                                                                 |
| claims        | integrations                                                                            | `enqueueExport`                                                                                                                                                     | `export_jobs` is integrations' table and one queue renders every kind                                                                                         |
| claims        | billing                                                                                 | `invoiceLinesForPeriod`, `creditNoteLinesForPeriod`                                                                                                                 | `invoice_lines.applied_rules` is the claim source and only billing knows what a cancelled invoice means                                                       |
| claims        | receivables                                                                             | `postEntry`, `reverseEntry`                                                                                                                                         | accrual and reversal, both keyed and balanced                                                                                                                 |
| claims        | pricing / procurement / inventory / tenant-catalog / docint                             | `schemesByIds`, `openDiscrepancies` + `markDiscrepanciesClaimed`, `ledgerRowsByReason`, `returnPolicy`/`upsertReturnPolicy`/`costsForVariants`, `DocintService.get` | each is the owner of a role-restricted table                                                                                                                  |
| notifications | retailers                                                                               | `contactPreferences`                                                                                                                                                | phone/opt-in/locale live on `retailer_links`, and the global `retailer_identities.phone` must never leak which other distributors share this shopkeeper       |
| reporting     | billing                                                                                 | `RegistersService.gstSummary`, `salesRegister`, `schemeSpend`                                                                                                       | the GST arithmetic exists once; reporting wraps it                                                                                                            |
| reporting     | receivables                                                                             | `collectionsRegister`, `outstandingList`                                                                                                                            | receipts are receivables'                                                                                                                                     |
| reporting     | orders / inventory / procurement / retailers / delivery / tenant-catalog / integrations | `fillRateLines`, `valuationByLocation`, `purchaseRegister`, `beatAssignmentsFor`, `performanceRows`, `costs`, `ExportJobsService`                                   | reporting owns four rollup tables and nothing else                                                                                                            |
| incentives    | orders / retailers / receivables                                                        | `salesAggregate`, `visitCount`, `collectedByUser` (plain functions)                                                                                                 | keeps the boundaries lint clean and lets the worker sweep import them without Nest DI                                                                         |

### Cycles the briefs create, and how each is broken

1. **billing ↔ receivables** (billing posts the ledger; receivables sets the invoice payment state). Broken by §3.2:
   receivables writes the two derived columns directly under a documented exception. One edge, one direction.
2. **warehouse ↔ billing** (warehouse issues the invoice at pack; billing's brief §8.8 has billing advance the order
   to `packed` and post the sale rows itself, "because the warehouse pick/pack module does not exist yet"). Both
   briefs post `sale` rows for the same order — stock would leave twice. Broken by a phased hand-over:
   - **Step 2:** billing exports `issueForPack(tx, { orderId, packConfirmationId?, lines: {orderLineId, lotId, qtyPcs, freeQtyPcs}[], issuedBy })`, which does **only** the document: number, GST split, lines from the given lot quantities, the AR journal entry, the cash-discount condition, the `InvoiceIssued` event. It moves no stock and no order state. The `billing.invoices.issue` HTTP procedure is the temporary caller that does the reserve → `postReservationAsSale` → `markPacked` half itself and then calls `issueForPack`.
   - **Step 3:** warehouse's `packs.confirm` takes over the stock and state half (`postPick`, `recordPick`,
     `applyFulfilmentEvent('pack')`) and calls `issueForPack`. **`billing.invoices.issue` is removed from the
     contract and from `permissions.ts`** — `warehouse.packs.confirm` becomes the only way a pack invoice is issued.
     Regenerate READMEs. Nothing external consumes the contract yet, so this is free.
   - `BillingService` is **not** `@Optional()` in warehouse (warehouse §3 assumes it might not exist; by this order it
     always does).
3. **warehouse ↔ delivery** (warehouse's `loadSheets.create` wants to sort orders by `trip_stops.sequence`; delivery
   reads warehouse's load sheets). Broken by removing the warehouse → delivery edge: `orderIds` are used **in the
   order the caller supplies** (last stop first is the app's job), and `tripId` on a load sheet is a plain label.
   Delivery → warehouse (`confirmedForTrip`) is the only edge.
4. **Who dispatches an order** — a direct contradiction, not a cycle. warehouse §2 moves `packed → dispatched` at
   `loadSheets.confirm`; delivery §2 moves the same orders at `trips.depart`. The second call would raise
   `TransitionError` → 409 on a normal day. **Warehouse wins** (the goods physically leave with a challan; warehouse
   §8.2 argues it correctly). `delivery.trips.depart` dispatches only orders whose invoices are **not** on a confirmed
   load sheet, and treats an already-`dispatched` order as a no-op, never a 409.
5. **Which ledger reason a van load uses** — warehouse §11 posts `transfer_out`/`transfer_in`; delivery §6's seed
   posts `van_load`/`transfer_in` for the same movement. **Warehouse wins:** godown → vehicle is
   `transfer_out` + `transfer_in` (keys `load:<sheetId>:<lotId>:out|in`). `van_unload` + `transfer_in` is reserved for
   the return direction at check-in (`settle:<tripId>:<lotId>:out|in`). Delivery's seed must be corrected.
6. **claims → integrations** — broken by the reorder in §1.
7. **reporting → integrations** — broken by the reorder in §1.
8. **incentives → orders/retailers/receivables** — incentives §1 proposes raw cross-module SQL. Replaced by the three
   plain functions in §3.9, so no exception is needed at all.

---

## 5. Conflicting RLS and index changes

### 5.1 `tenant_settings` — one change, applied by **billing (0009)**

Three briefs propose a different read policy for the same table (warehouse §3: a three-key whitelist; delivery §3.9:
`STAFF_ROLES`, all keys; notifications and billing simply assume they can read it). Today it is
`tenantRolePolicy('tenant_settings_owner', OWNER_ROLES)` — a manager, accountant, salesperson or delivery actor reads
**nothing**, so `upi_vpa`, `ewb_intra_state_threshold` and the settlement tolerance would silently read as absent.

A key whitelist that four migrations keep editing is worse than the problem. **One policy, added once, never edited:**

```sql
CREATE POLICY "tenant_settings_staff_read" ON "tenant_settings" FOR SELECT TO app_rw
  USING (tenant_id = (SELECT current_setting('app.tenant_id', true))
     AND (SELECT current_setting('app.actor_role', true)) <> 'retailer'
     AND key NOT LIKE 'secret.%');
```

Writes stay owner-only via the existing policy (permissive policies OR together, so the owner policy is untouched).
Convention fixed here: **any setting that is a credential or a token is stored under a `secret.` key prefix** and stays
owner/system-only. Nothing currently in `tenant_settings` qualifies. Warehouse and delivery add **no**
`tenant_settings` policy of their own; they add default rows only.

### 5.2 The journal balance trigger is silently defeated by receivables' own RLS change — **must fix in 0007**

`0003` created:

```sql
CREATE OR REPLACE FUNCTION dos_journal_entry_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
  … SELECT COALESCE(SUM(amount_paise), 0) INTO total FROM journal_lines WHERE entry_id = entry; …
```

It is **not** `SECURITY DEFINER`, and `journal_lines` is `FORCE ROW LEVEL SECURITY`. Receivables §3.6 proposes
`SELECT` on `journal_lines` for back office only, `INSERT` for staff — so a `salesperson` or `delivery` actor posting a
doorstep receipt can insert lines but not select them. The deferred trigger's `SELECT` then returns zero rows,
`total = 0`, and **an unbalanced entry commits silently**. The existing rls.test case
`rejects an unbalanced journal entry at commit` runs as a back-office role and would keep passing while the guarantee
is gone for exactly the roles that collect cash in the field.

Fix, in `0007_receivables_guarantees.sql`:

```sql
CREATE OR REPLACE FUNCTION dos_journal_entry_balanced() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ … same body … $$;
```

and extend `backend/libs/database/src/rls.test.ts` with a `delivery`-role case that inserts an unbalanced entry and
asserts the `check_violation` at COMMIT. Same audit applies to `dos_invoice_lines_immutable()` (it reads `invoices`)
— it is safe today because every role that can update `invoice_lines` can also select `invoices`, but note it in the
migration comment.

### 5.3 Tables changed by exactly one module (no conflict, listed so nobody adds a second policy)

| table(s)                                                                                                                                     | module / migration | change                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `journal_entries`, `journal_lines`                                                                                                           | receivables 0007   | `SELECT` → `BACK_OFFICE_ROLES`; `INSERT` → `STAFF_ROLES` minus `warehouse`; `UPDATE` → back office; no `DELETE`. **This is the ADR 0002 cost guarantee** — `PURCHASES`, `STOCK` and GRN postings are readable today by a salesperson, a delivery crew member and a shopkeeper |
| `accounts`                                                                                                                                   | receivables 0007   | `SELECT` → `STAFF_ROLES` (no amounts here; posting needs the code→id lookup); writes → back office; the `retailer` role loses read access                                                                                                                                     |
| `allocations`, `cash_discount_conditions`                                                                                                    | receivables 0007   | invoice-scoped `SELECT` in the `invoice_lines_read` shape + `staffWritePolicy`                                                                                                                                                                                                |
| `picklists`, `pick_lines`, `pack_confirmations`, `load_sheets`, `delivery_challans`                                                          | warehouse 0011     | `staffReadPolicy` + `roleWritePolicies(STOCK_KEEPER_ROLES)`                                                                                                                                                                                                                   |
| `deliveries`, `delivery_lines`, `pod_evidence`, `vehicles`, `trips`, `trip_expenses`, `collections`, `trip_settlements`, `vehicle_positions` | delivery 0013      | per delivery §3.8                                                                                                                                                                                                                                                             |
| `documents`, `document_pages`                                                                                                                | docint 0015        | `ALTER POLICY` to the kind-scoped predicate                                                                                                                                                                                                                                   |
| `messages`, `inbound_messages`, `whatsapp_windows`, `push_tokens`                                                                            | notifications 0020 | per notifications §3.2–3.4                                                                                                                                                                                                                                                    |
| `daily_tenant_stats`, `retailer_behaviour`                                                                                                   | reporting 0022     | `tenantRolePolicy(…, STAFF_ROLES)`                                                                                                                                                                                                                                            |
| `computed_payouts`                                                                                                                           | incentives 0024    | split read/write so a rep can see their own statement                                                                                                                                                                                                                         |
| `claim_settlements`                                                                                                                          | claims 0018        | new table: FORCE RLS + `tenantRolePolicy(…, BACK_OFFICE_ROLES)` + grants                                                                                                                                                                                                      |

**Never join `retailer_identities` from a tenant table's policy** — Postgres reports 42P17 infinite recursion. Every
retailer-scoped policy goes through the denormalised `retailer_links.user_id`, i.e. `tenantOrOwnRetailerPolicy`.

### 5.4 Duplicate and redundant indexes — drop the old one in the same migration

| new index                                                                                | existing index it subsumes                                     | action                                                                                                                                             |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pack_confirmations_order_uniq` UNIQUE (tenant_id, order_id)                             | `pack_confirmations_order_idx` (tenant_id, order_id)           | drop the plain one in 0010                                                                                                                         |
| `extractions_latest_idx` (tenant_id, document_id, created_at)                            | `extractions_document_idx` (tenant_id, document_id)            | drop the shorter one in 0014                                                                                                                       |
| `sku_match_candidates_unique_idx` UNIQUE (tenant_id, extraction_id, line_no, variant_id) | `sku_match_candidates_idx` (tenant_id, extraction_id, line_no) | drop the shorter one in 0014                                                                                                                       |
| `claim_lines_source_unique_idx` partial UNIQUE (tenant_id, source_type, source_id)       | claims §3's own proposed `claim_lines_claim_source_idx`        | **do not create** `claim_lines_claim_source_idx`; the partial unique gives the guarantee and the existing `claim_lines_claim_idx` gives the lookup |
| `invoices_order_active_idx` partial UNIQUE                                               | `invoices_order_idx`                                           | **keep both** — the plain one still serves lookups that include cancelled invoices                                                                 |
| `trip_points_dedupe_idx` UNIQUE (tenant, trip, device, recorded_at)                      | `trip_points_trip_time_idx` (tenant, trip, recorded_at)        | **keep both** — the unique index cannot serve a time-range scan within a trip                                                                      |

### 5.5 Two RLS proposals that would break an existing test or spec

- **receivables §3.6 on `journal_lines`** — see §5.2. Also: `rls.test.ts`'s
  `rejects an unbalanced journal entry at commit` and `accepts a balanced one` must be re-run as `salesperson` and
  `delivery` after the change, not only as the role they use today.
- **receivables §3.6 on `accounts`** removes `retailer` read access. Nothing reads `accounts` as a retailer today, but
  `receivables.ledger.get`'s retailer path must be built from `invoices` + `credit_notes` + `receipts` +
  `allocations` (which receivables §2 already specifies) and must **not** join `accounts`. The spec that asserts the
  staff path and the retailer path produce the same `closingPaise` is the test that catches a regression here.
- **warehouse §3's `staffReadPolicy` on `pack_confirmations`** removes retailer read. No current spec depends on it.
  Reporting's `fillRate` reads through `OrdersService`, not `pick_lines`, so it is unaffected.

---

## 6. Contract and permission wiring

New contract files, all in `backend/libs/contracts/src/`, each exported from `index.ts` and mounted in `contract.ts`
under the key shown. **Only the main session edits `contract.ts`, `index.ts`, `core/src/index.ts`, module `index.ts`
files and `*-service/src/service.ts`.**

| slice | file               | contract key    | exported const          |
| ----- | ------------------ | --------------- | ----------------------- |
| 1     | `receivables.ts`   | `receivables`   | `receivablesContract`   |
| 2     | `billing.ts`       | `billing`       | `billingContract`       |
| 3     | `warehouse.ts`     | `warehouse`     | `warehouseContract`     |
| 4     | `delivery.ts`      | `delivery`      | `deliveryContract`      |
| 5     | `docint.ts`        | `docint`        | `docintContract`        |
| 6     | `integrations.ts`  | `integrations`  | `integrationsContract`  |
| 7     | `claims.ts`        | `claims`        | `claimsContract`        |
| 8     | `notifications.ts` | `notifications` | `notificationsContract` |
| 9     | `reporting.ts`     | `reporting`     | `reportingContract`     |
| 10    | `incentives.ts`    | `incentives`    | `incentivesContract`    |

### Which service mounts which key

`auth-service` (:3000) mounts nothing new — it serves sign-in only. A service that does not list a key does not
render it in `/docs` and `TenantGuard` 403s the route before any handler runs.

| key             | owner 3001 | manager 3002 | sales 3003 | warehouse 3004 | delivery 3005 | retailer 3006 |
| --------------- | :--------: | :----------: | :--------: | :------------: | :-----------: | :-----------: |
| `receivables`   |     ✅     |      ✅      |     ✅     |       —        |      ✅       |      ✅       |
| `billing`       |     ✅     |      ✅      |     ✅     |       ✅       |      ✅       |      ✅       |
| `warehouse`     |     ✅     |      ✅      |     —      |       ✅       |      ✅       |       —       |
| `delivery`      |     ✅     |      ✅      |     —      |       ✅       |      ✅       |      ✅       |
| `docint`        |     ✅     |      ✅      |     —      |       ✅       |       —       |       —       |
| `integrations`  |     ✅     |      ✅      |     —      |       —        |       —       |       —       |
| `claims`        |     ✅     |      ✅      |     —      |       —        |       —       |       —       |
| `notifications` |     ✅     |      ✅      |     ✅     |       ✅       |      ✅       |      ✅       |
| `reporting`     |     ✅     |      ✅      |     ✅     |       ✅       |      ✅       |       —       |
| `incentives`    |     ✅     |      ✅      |     ✅     |       —        |      ✅       |       —       |

Deviations from the briefs, applied: receivables is **not** on warehouse-service (the warehouse role never touches
money); reporting is **not** on retailer-service (reporting §1 is right); incentives is **not** on warehouse- or
retailer-service; claims and integrations are owner + manager only.

### Role tuples in `permissions.ts`

`permissions.ts` values are **membership roles only** (no `'system'`); `requireRole(...)` in the service takes
`ActorRole` and additionally carries `'system'` for the worker. Keep the two lists in step.

Three tuples the briefs propose **already exist** — reuse them, do not declare duplicates:

- warehouse §2's `WAREHOUSE_DESK` = `ROLE_GROUPS.STOCK_KEEPERS` (`owner, manager, warehouse`)
- warehouse §2's `FULFILMENT_READERS` = the file's existing `STOCK_VIEWERS` (`owner, manager, accountant, warehouse, delivery`)
- docint §2's `DOCINT_CAPTURE` = the file's existing `BACK_OFFICE_OR_WAREHOUSE`

New module-local tuples to declare, in the file's existing style (a `const` with a one-line comment above it):

```ts
/** Who may take money from a shopkeeper. */
const MONEY_COLLECTORS = ['owner', 'manager', 'accountant', 'salesperson', 'delivery'] as const
/** Who may look at a shop's dues, including the shop itself. */
const MONEY_READERS = [
  'owner',
  'manager',
  'accountant',
  'salesperson',
  'delivery',
  'retailer',
] as const
/** Who may issue a numbered GST invoice. */
const BILLING_ISSUERS = ['owner', 'manager', 'accountant', 'warehouse'] as const
/** Two people hold the manager's PIN: load-out, picklist cancel, hold release. */
const PIN_HOLDERS = ['owner', 'manager'] as const
/** Who plans and loads a trip. */
const TRIP_PLANNERS = ['owner', 'manager', 'warehouse', 'delivery'] as const
/** Who touches a doorstep record. */
const DOORSTEP = ['owner', 'manager', 'delivery'] as const
/** Support triage: the desk plus the beat-owning rep. */
const TRIAGE = ['owner', 'manager', 'accountant', 'salesperson'] as const
/** Rep-facing performance surfaces. */
const INCENTIVE_READERS = ['owner', 'manager', 'accountant', 'salesperson', 'delivery'] as const
```

Per-procedure-group permission lists (the full matrix goes in `PERMISSIONS`; every procedure needs a line or
`permissions.test.ts` fails and the guard refuses it, which is the correct failure mode):

| procedure group                                                                                                                                                                                      | permission                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `receivables.receipts.create`                                                                                                                                                                        | `MONEY_COLLECTORS`                                                                                             |
| `receivables.receipts.list/get`                                                                                                                                                                      | `MONEY_READERS`                                                                                                |
| `receivables.receipts.reverse/deposit/bounce`, `receivables.allocations.*`, `receivables.statements.send`, `receivables.cashDiscounts.list`, `receivables.accounts.list`, `receivables.journal.list` | `BACK_OFFICE`                                                                                                  |
| `receivables.outstanding.get`, `receivables.ledger.get`                                                                                                                                              | `MONEY_READERS`                                                                                                |
| `receivables.outstanding.list`, `receivables.creditCheck`                                                                                                                                            | `MONEY_COLLECTORS` (**not** the retailer)                                                                      |
| `receivables.writeOffs.create`, `receivables.ageing.rebuild`                                                                                                                                         | `OWNER_ONLY`                                                                                                   |
| `billing.invoices.queue/issueForPack-path`, `billing.invoices.setEwayBill`                                                                                                                           | `BILLING_ISSUERS`                                                                                              |
| `billing.invoices.get/list/pdf`                                                                                                                                                                      | `ANY_MEMBER` (invoices carry no cost)                                                                          |
| `billing.invoices.upiQr`                                                                                                                                                                             | `MONEY_READERS`                                                                                                |
| `billing.invoices.cancel`                                                                                                                                                                            | `PIN_HOLDERS`                                                                                                  |
| `billing.invoices.issueVanSale`                                                                                                                                                                      | `DOORSTEP`                                                                                                     |
| `billing.invoices.importBrandDms`, `billing.invoices.requestIrn`, `billing.registers.*`                                                                                                              | `BACK_OFFICE`                                                                                                  |
| `billing.creditNotes.create/issue`                                                                                                                                                                   | `['owner','manager','accountant','delivery']`                                                                  |
| `billing.creditNotes.cancel`                                                                                                                                                                         | `BACK_OFFICE`                                                                                                  |
| `billing.creditNotes.get/list`                                                                                                                                                                       | `ANY_MEMBER`                                                                                                   |
| `warehouse.queue.list`, `warehouse.picklists.create/list/get/start/pick`, `warehouse.packs.confirm`, `warehouse.loadSheets.create`, `warehouse.reservations.list`                                    | `STOCK_KEEPERS`                                                                                                |
| `warehouse.packs.list/get`, `warehouse.loadSheets.list/get`, `warehouse.challans.list/get`                                                                                                           | `STOCK_VIEWERS`                                                                                                |
| `warehouse.picklists.cancel`, `warehouse.loadSheets.confirm/cancel`                                                                                                                                  | `PIN_HOLDERS`                                                                                                  |
| `warehouse.challans.recordEwb`, `warehouse.reservations.release`                                                                                                                                     | `BACK_OFFICE`                                                                                                  |
| `delivery.vehicles.list`, `delivery.trips.list/get`, `delivery.expenses.list`, `delivery.collections.list`                                                                                           | `STOCK_VIEWERS`                                                                                                |
| `delivery.vehicles.upsert`, `delivery.trips.cancel`, `delivery.vehicles.positions`, `delivery.gps.trace`                                                                                             | `PIN_HOLDERS`                                                                                                  |
| `delivery.trips.create/startLoading`, `delivery.stops.add`                                                                                                                                           | `TRIP_PLANNERS`                                                                                                |
| `delivery.trips.depart`                                                                                                                                                                              | `TRIP_PLANNERS`                                                                                                |
| `delivery.trips.return`, `delivery.stops.reorder/start/arrive/fail`, `delivery.deliveries.record/addPod`, `delivery.gps.points`                                                                      | `DOORSTEP`                                                                                                     |
| `delivery.trips.settlementPreview`                                                                                                                                                                   | `['owner','manager','accountant','delivery']`                                                                  |
| `delivery.trips.settle`                                                                                                                                                                              | `BACK_OFFICE`                                                                                                  |
| `delivery.stops.list`                                                                                                                                                                                | `ANY_MEMBER` (RLS narrows the retailer to its own stops)                                                       |
| `delivery.deliveries.list`                                                                                                                                                                           | `MONEY_READERS`                                                                                                |
| `delivery.collections.record`, `delivery.expenses.record`                                                                                                                                            | `['owner','manager','accountant','delivery']`                                                                  |
| `delivery.vanSales.create`                                                                                                                                                                           | `DOORSTEP`                                                                                                     |
| `docint.documents.create/pageUploadUrl/addPage/verifyQr/submit/list/get`                                                                                                                             | `BACK_OFFICE_OR_WAREHOUSE`                                                                                     |
| every other `docint.*`                                                                                                                                                                               | `BACK_OFFICE`                                                                                                  |
| every `integrations.*`                                                                                                                                                                               | `BACK_OFFICE`                                                                                                  |
| every `claims.*`                                                                                                                                                                                     | `BACK_OFFICE`, except `claims.policies.upsert` = `OWNER_ONLY` and `claims.writeOff` = `['owner','accountant']` |
| `notifications.messages.list/get/markRead`                                                                                                                                                           | `ANY_MEMBER`                                                                                                   |
| `notifications.messages.resend`, `notifications.broadcasts.list/get`                                                                                                                                 | `BACK_OFFICE`                                                                                                  |
| `notifications.templates.list`                                                                                                                                                                       | `BACK_OFFICE`                                                                                                  |
| `notifications.templates.upsert`, `notifications.broadcasts.create`                                                                                                                                  | `PIN_HOLDERS`                                                                                                  |
| `notifications.pushTokens.register/unregister`                                                                                                                                                       | `STAFF`                                                                                                        |
| `notifications.inbound.list/markHandled`                                                                                                                                                             | `TRIAGE`                                                                                                       |
| `reporting.dashboard.owner`, `reporting.dailyStats.tenant`, `reporting.registers.schemeSpend/stockValue/collections/gstSalesRegister/gstPurchaseRegister`, `reporting.exports.*`                     | `BACK_OFFICE`                                                                                                  |
| `reporting.dashboard.rep`, `reporting.dailyStats.rep`, `reporting.retailers.behaviour/lapsed`, `reporting.registers.repProductivity`                                                                 | `['owner','manager','accountant','salesperson']`                                                               |
| `reporting.registers.fillRate`                                                                                                                                                                       | `BACK_OFFICE_OR_WAREHOUSE`                                                                                     |
| `reporting.registers.deliveryPerformance`                                                                                                                                                            | `['owner','manager','accountant','delivery']`                                                                  |
| `incentives.targets.upsert/bulkAssign/remove`, `incentives.statements.approve/reopen`                                                                                                                | `OWNER_ONLY`                                                                                                   |
| `incentives.targets.refresh/whatIf`, `incentives.progress.team`, `incentives.statements.compute`                                                                                                     | `BACK_OFFICE`                                                                                                  |
| `incentives.targets.get/list`, `incentives.statements.get/list`                                                                                                                                      | `INCENTIVE_READERS`                                                                                            |
| `incentives.progress.mine`                                                                                                                                                                           | `ROLE_GROUPS.FIELD`                                                                                            |

---

## 7. Questions for the founder

_Plain English. Each one is a real business choice we had to guess at to keep building. Nothing is blocked — we have
taken a sensible answer and written it down. The ones at the top are the ones that are painful to change later._

### Very expensive to change (money already in the books, or a tax document already issued)

**1. Cash discount — do we knock it off the bill, or only give it when they actually pay on time?**
_What we assumed:_ the bill shows the full amount and says "2% if you pay within 7 days". The discount is given only
when the money arrives inside the window. The one exception is Too Yumm, where the brand's own system prints the
discount on the bill.
_Affects:_ every invoice, the ledger, claims to brands, doorstep collection.
_Cost to change later:_ very high — bills already printed would be wrong and the accounts would need restating.

**2. Old outstanding from TradeEzee — do we bring it in bill by bill, or one total per shop?**
_What we assumed:_ bill by bill, each old bill entered as a bill dated when it was raised. This is the only way
"which bill did this ₹5,000 pay off?" and the 30/60/90-day ageing work from day one.
_Affects:_ the whole receivables picture, the import wizard.
_Cost to change later:_ very high — every opening entry would have to be reversed and re-entered.

**3. Bill numbers after we switch over — carry on from TradeEzee's `GL/1687`, or start a fresh series?**
_What we assumed:_ a fresh series `INV/0001` per financial year. Carrying on the old numbers is possible with no code
change (just a starting number and a prefix), but it must be decided before the first real bill.
_Affects:_ every invoice, GST filing.
_Cost to change later:_ very high — a GST bill number can never be reissued.

**4. Van sales — is each sale off the van a proper tax invoice, or one summary memo at the end of the day?**
_What we assumed:_ a proper tax invoice from a separate number series per vehicle (`V1/0001`, `V2/0001`), so the crew
can hand over a real bill on the spot even with no signal.
_Affects:_ billing, delivery, the warehouse challan.
_Cost to change later:_ high — it changes what we file with GST.

**5. Which shops are GST-registered, and is any of the three distributorships under the composition scheme?**
_What we need:_ the list of registered shops with their GSTIN. _What we assumed:_ the shops we already have a GSTIN
for are registered (B2B), everyone else is B2C, and nobody is under composition — so we are not building the
"Bill of Supply" format.
_Cost to change later:_ high for bills already filed, low going forward.

**6. Staff incentives — do we count what a rep _booked_, what was _billed_, or what was actually _collected_?**
_What we assumed:_ what was booked (confirmed orders). This is simplest, but it means a rep still earns on an order
that later comes back as a return.
_Affects:_ every incentive statement.
_Cost to change later:_ high — you would be telling staff their earlier payout was wrong.

**7. Does your CA already type the Too Yumm bills into Tally?**
_What we assumed:_ yes. So our Tally export leaves Too Yumm out, to avoid the same bill being counted twice.
_Cost to change later:_ high — a double count in the books is painful to find and unwind.

### Medium — a policy choice; changing it means changing a rule, not the accounts

**8. Damage and expiry claims — do brands pay us back at PTD, at PTR, or at MRP?** We assumed PTD (our buying price),
set per brand so it can differ. Wrong here means we claim the wrong amount from the brand.

**9. If a cheque bounces, is the ₹350 bank charge our cost, or do we recover it from the shop?** We assumed our cost.
Recovering it means raising a debit note on the shop.

**10. When a brand gives us a credit note with GST on it, do we need to mirror that GST on our claim?** We assumed no —
claims are a commercial settlement, the GST side is booked by the CA separately.

**11. Can a salesperson take money from a shop, or only the delivery crew and the office?** We assumed yes, a rep can
collect. Turning it off is one line.

**12. Who can write off a bad debt?** We assumed the owner only, with no rupee limit. The alternative is the accountant
raises it and the owner approves.

**13. Who can cancel a bill before it goes out?** We assumed the owner and the manager. The accountant can raise credit
notes but not cancel a numbered bill.

**14. How much cash difference is acceptable when a delivery crew hands over at the end of the day?** We assumed ₹100.
Anything more, or any stock that does not tally, needs the owner to approve before the trip closes.

**15. The "manager's PIN" at load-out — is the manager being logged in enough, or do you want a real 4-digit code?**
We assumed being logged in as owner/manager is the PIN.

**16. E-way bill — is ₹1,00,000 the right threshold for a single vehicle load in Maharashtra, and does the manager
type the number in from the government portal?** That is what we assumed. Please confirm the number with your CA.

**17. What value do we declare for free van stock on the delivery challan?** We assumed MRP × quantity. Your CA may
prefer the selling rate or the cost.

**18. How often do you claim from each brand, and how many days do they take to settle?** We assumed monthly with a
1st-of-the-month cut-off (Balaji/Guru Kripa fortnightly), and 30 days to settle (Guru Kripa 21, Too Yumm 15).

**19. Should a rep see their calculated incentive before you approve it?** We assumed yes, shown as a live figure
marked "pending approval". Hiding it until approval is a small change.

**20. Can a manager set a rep's target, or only you?** We assumed only you. Managers see the whole team's progress but
cannot change a target or approve a payout.

**21. Dues reminders on WhatsApp — send as soon as a bill is one day late, or only above a certain amount, and how
often?** We assumed any amount, one day late, at most once a week per shop.

**22. Scheme announcements — should the system pick the shops automatically, or do you choose the beat?** We assumed
you choose the beat or the shops by hand.

**23. Delivery proof — photo every time, only for credit shops, or never? And do you want an OTP from the shopkeeper?**
We assumed photo for credit shops only, no OTP for the pilot.

**24. Can the delivery crew sell off the van to a shop that is not in the system yet?** We assumed no — a new shop is
added by a rep or the office first.

**25. If a load comes back undelivered, does the warehouse need its own "unload" screen, or is the delivery crew's
check-in enough?** We assumed check-in is enough.

### Cheap — a settings row or a schedule; change any time

**26. A monthly budget for the bill-scanning AI.** No limit set. We record the cost of every scanned bill from day one,
so you can set a ceiling after the first hundred.
**27. A monthly WhatsApp budget.** No limit set. We record the cost of every message; a hard cut-off is a later
addition.
**28. How long do we keep the GPS breadcrumbs of a trip?** We assumed 90 days. Stop locations and delivery photos are
kept forever.
**29. How long do we keep photographs of supplier bills?** We assumed forever — they are the evidence behind a stock
receipt.
**30. Shop statements — WhatsApp PDF covering the last 90 days?** That is what we assumed.
**31. When a payment does not name a bill, which bill do we settle first?** We assumed the one due earliest, then the
oldest bill number — matching your paper file.
**32. Incentive slabs — does a rep get only the slab they reached, or the lower slabs added on top?** We assumed only
the slab reached, and no extra above the top slab.
**33. Can warehouse staff see the purchase rate printed on a supplier bill while reviewing a scan?** We assumed no —
they can photograph and upload, but only the office sees the rates.
**34. We still need one sample export each from TradeEzee (party master, item master, outstanding, sales register) and
FieldAssist (invoice export), plus the real claim-sheet format from each brand.** Nothing is blocked — the column
mapping screen exists precisely so these can be wired up with no code change — but the imports cannot be tested against
reality until we have them.

### Already answered — recorded here so nobody asks again

- **Language:** English only for now; no Hindi/Marathi layer, no Devanagari fonts (2026-09-04 23:00).
- **Offline:** online first for all six apps; offline sync is its own module before the pilot.
- **Devices:** Android and iOS equally, tuned for a budget Android phone.

---

## 8. Definition of done per module

A slice is **stable** — and only then does the next module start — when every line below is true. This is CLAUDE.md's
"stable" definition, docs/16 §5 and the build log's §4b, merged and made checkable.

**Contract**

1. `backend/libs/contracts/src/<module>.ts` exists, exports `<module>Contract`, is exported from `index.ts` and mounted
   in `contract.ts` under the key in §6 — **by the main session, not a subagent**.
2. Every mutation input extends `MutationBase` and carries the client-generated UUIDv7 `id` of the row it creates.
   Every GET input uses `QueryBoolSchema`/`QueryIntSchema`. Every list caps `limit` at ≤ 200 and pages on `cursor`,
   returning `{ items, nextCursor }`.
3. Every procedure has a line in `PERMISSIONS` matching §6, and `permissions.test.ts` is green. No output shape carries
   a purchase cost, landed cost, PTD or margin unless the procedure is `requireRole(BACK_OFFICE)` and named for it.

**Database** 4. Schema edits are in `src/schema/*.ts`; the generated migration comes from `pnpm db:generate`; the hand-written
sibling contains only what drizzle cannot express (§2 rule 3). Both halves are appended to `meta/_journal.json`. 5. Every new `tenant_id` table has `ENABLE` + `FORCE ROW LEVEL SECURITY`, at least one policy, and
`GRANT SELECT, INSERT, UPDATE, DELETE … TO app_rw` and `app_worker`. 6. Every new index leads with `tenant_id`. Any index it makes redundant is dropped in the same migration (§5.4). 7. `pnpm db:migrate` applies cleanly on a fresh database **and** on the founder's existing one.

**Service** 8. `backend/libs/core/src/modules/<module>/` follows `modules/orders/**`: controller / service(s) / internals /
mappers / module / spec / `index.ts`. Every `@Implement` method takes `@OwnsReply() _reply: unknown`. 9. Every handler is `requireRole(...)` → `requireDb(this.db)` → `withTenant(...)`, and every mutation is wrapped in
`idempotent(tx, input.idempotencyKey, input, fn)`. No query outside `withTenant`. 10. Every state change goes through a `@dos/domain` machine (`orderMachine`, `invoiceMachine`, `tripMachine`,
`stopMachine`, `claimMachine`, docint's document machine). No state column is assigned by hand. 11. Money is integer paise, quantities integer pieces, percentages basis points, all through `@dos/domain`. Dates and
the financial year come from `businessDate()` / `financialYear()` (IST), never
`new Date().toISOString().slice(0,10)`. 12. Cross-module reads and writes use only the edges in §4, through the callee's `index.ts`. Any exception carries a
`// module-boundary:` comment pointing at this file and an `eslint-plugin-boundaries` entry. 13. Anything the worker calls is a plain exported function, never an `@Injectable` class (§3.9). 14. Offline sync handlers, where the brief lists them, are registered in `onModuleInit` through `SyncRegistry` and
throw `SyncRejection` for business faults — `/sync/upload` never answers 4xx.

**Spec** 15. `<module>.spec.ts` under `describeDb`, booted with `bootTestApp`, fixtures built with `@dos/db` +
`bootstrapTenant` keyed by a unique `run = uuidv7().slice(-8)` suffix. 16. It contains, at minimum: the happy path; an idempotent replay (same key + same payload → stored response, changed
payload → 409); **one case per role that must be refused**, asserted at the API (403) _and_ at the database (a
direct `withTenant` select returning 0 rows, so RLS is the guarantee, not the guard); tenant isolation; and 401
with no token. 17. Any role-restricted table the slice adds or re-policies gains a case in
`backend/libs/database/src/rls.test.ts` — that file is the executable form of the ADRs.

**Wiring, data and docs** 18. The module and its contract key are added to exactly the services in §6's table, and to
`backend/libs/core/src/index.ts` — main session only. 19. `pnpm docs:readme` re-run; generated READMEs are never hand-edited. 20. Demo data added in `backend/libs/database/src/seed-demo/<module>.ts`, called from `seed-demo/index.ts`, every row
keyed with `demoId(...)` and inserted with `onConflictDoNothing` so re-seeding is a no-op. **Every seed function
takes `tenantId` and is called once per distributor** — three distributors, staff under each, and at least one shop
linked to two of them. 21. Scale rules honoured (docs/20): bounded work per request, cursor pagination, long work to the worker, rollups as
the read surface, per-tenant fairness on any cron, nothing binary through a service. 22. From `backend/`: `pnpm format` then `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green, plus
`pnpm docs:readme:check` and `pnpm smoke` (every endpoint of every service called with a real token). 23. A row updated in `docs/18-build-log.md`'s status table, and the **RESUME HERE** block refreshed with what is next. 24. Any founder question this slice newly discovered is appended to §7 above, with the assumption taken — not left in
the module's own brief where the next agent will not see it.
