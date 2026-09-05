import { oc } from '@orpc/contract'
import { z } from 'zod'
import { IdSchema, MutationBase, PaiseSchema, QueryBoolSchema, QueryIntSchema } from './common.js'

/**
 * Integrations — the file bridge to whatever the distributor used before, and to whatever the CA and the
 * government need after (docs/10, ADR 0014, docs/17 §D7). "The integration bus is files, not APIs": this
 * module never calls a manufacturer's, a brand's or a GSP's server. It owns `import_jobs`, `import_rows`,
 * the saved column-mapping `import_profiles`, `export_jobs`, `tally_mappings` and `tally_sync_ledger`, and
 * writes NOTHING else: every retailer, listing, invoice, journal entry and purchase-history row it produces
 * goes through the owning module's exported service (coordination §4: `RetailersService.upsert /
 * linkExternalCode / recordPurchaseHistory`, `TenantCatalogService.upsertListing`, `BillingService.
 * recordOpeningInvoice / importBrandDms`, `ReceivablesService.postOpeningBalance`, `CatalogService.search`).
 *
 * WHICH SERVICES MOUNT `integrations` (docs/plans/00-coordination.md §6 table; the brief's §2):
 *
 *   owner :3001      YES — the whole surface: the imports wizard (O21), exports & Tally (O22)
 *   manager :3002    YES — manager + accountant. The MANAGER runs the wizard and its writes; the
 *                    ACCOUNTANT reads every import, takes every export and keeps the Tally mapping (docs/22
 *                    2026-09-05 "money desk + reads ... reads and exports everything", ROLE_GROUPS.MONEY_DESK
 *                    "who takes the exports"). Every import WRITE — create, mapping, dry run, row review,
 *                    commit, confirm, rollback, cancel, profile — refuses the accountant in PERMISSIONS: a bulk
 *                    file creates retailers and catalog listings, which the accountant may not edit one row
 *                    at a time either (`retailers.upsert`, `tenantCatalog.upsertListing` are MANAGEMENT)
 *   sales :3003      NO  — no field app ever touches this module
 *   warehouse :3004  NO
 *   delivery :3005   NO
 *   retailer :3006   NO  — RLS on all six tables is `tenantRolePolicy(…, BACK_OFFICE_ROLES)` since 0003, so
 *                    every one of these roles reads ZERO rows even if a key were mounted by mistake
 *
 * THE GENERIC MAPPED IMPORTER COMES FIRST (docs/17 §D7, 2026-09-04 23:50, overrides the brief's §2):
 *
 *   The founder has no sample export and says a distributor may arrive from TradeEzee, Marg, Busy, Tally, a
 *   brand DMS, loose Excel, or nothing at all. So no vendor's column names are hard-coded anywhere below.
 *   One wizard, five targets, any CSV / XLSX:
 *
 *     upload  →  imports.create   the file was PUT through `files.uploadUrl` (`domain: 'import'`, `entityId`
 *                                 = the job id the client generated); the create call names the object key
 *                                 and the worker STAGES it: parses, detects columns, writes one `import_rows`
 *                                 row per source row (`raw` = cells keyed by header)                 → staged
 *     preview →  imports.preview  the first N rows with the detected columns and a suggested field per
 *                                 column (from the built-in profile of that source + header heuristics)
 *     map     →  imports.setMapping  file column → target field (`IMPORT_TARGETS[target].fields`), fixed
 *                                 values for fields the file lacks (`placeOfSupplyState = 27`), the date
 *                                 format and whether amounts are rupees or paise; optionally SAVED as a named
 *                                 profile per (source, target) — `profiles.list/upsert` — so the next month's
 *                                 file maps itself. Built-in profiles ship per tenant (`builtIn: true`) for
 *                                 TradeEzee, Marg, Busy, Tally and FieldAssist and are refined the moment a
 *                                 real file arrives, never a code change
 *     dry run →  imports.dryRun   validates EVERY row against the target's field rules, matches parties and
 *                                 items, and answers the diff — how many rows would be created, updated,
 *                                 skipped, need a human, or are wrong — plus row-level errors through
 *                                 `rows.list` (`status = error | needs_review`). Creates nothing. Rows beyond
 *                                 `INLINE_DRY_RUN_ROWS` go to the worker; the client polls `imports.get`
 *     review  →  imports.rows.review  the operator resolves one row the matcher could not: pins a retailer
 *                                 or a variant, corrects a value, or skips a junk row. A pinned party code is
 *                                 remembered in `external_party_codes(system = source)` so it auto-matches
 *                                 next month (docs/17 A7)
 *     commit  →  imports.commit   applies, one row per transaction keyed `import:<jobId>:<rowNo>`, so one
 *                                 bad row of 5,000 never rolls back the other 4,999            → committed
 *     confirm →  imports.confirm  the sign-off: the run is final                                → confirmed
 *     rollback → imports.rollback BEFORE confirm, reverses what commit did                      → rolled_back
 *
 *   The five targets and what commit does for each (never a guess — a row below the match floor or with
 *   two close candidates is `needs_review`, and `commit` refuses it unless `skipUnresolved` leaves it out):
 *
 *     party_master        → `RetailersService.upsert` (name, phone, GST, address, beat, Tally ledger name).
 *                           NEVER a credit limit, credit days, a tier or a credit mode — those stay with
 *                           `retailers.setCredit`, one shop at a time. Matched by external code → phone /
 *                           GSTIN → fuzzy name (`pg_trgm`, installed by docint)
 *     item_master         → `TenantCatalogService.upsertListing` (local alias, case size) for a variant
 *                           matched by EAN → item code → fuzzy name through `CatalogService.search`. NO
 *                           global product is ever proposed from a bulk file: an unmatched row stays
 *                           `needs_review` until the operator picks a variant or proposes the product on the
 *                           catalog screen and re-runs the dry run
 *     opening_outstanding → per bill, never a lump sum: `BillingService.recordOpeningInvoice` (`source =
 *                           'import'`, the tenant's external series) then `ReceivablesService.
 *                           postOpeningBalance` — DR Accounts receivable / CR OPENING, so the ledger stays
 *                           balanced and bill-to-bill allocation and ageing work from day one (§D7). No stock,
 *                           no order. `commit` and `confirm` of this target refuse every role but the OWNER
 *                           in the handler (money enters the books with no sale behind it; PERMISSIONS is per
 *                           procedure, so the gate is per target inside)
 *     sales_register      → `RetailersService.recordPurchaseHistory` (`source = 'migration'`): the shop's
 *                           buying history for the suggested-order engine. NO ledger effect, no invoice
 *     brand_dms_invoices  → one file row = one invoice LINE; rows sharing an invoice number become ONE
 *                           `BillingService.importBrandDms` call with `orderId` omitted: the brand's DMS
 *                           (Too Yumm on FieldAssist) already issued the legal invoice, so we store it under
 *                           its own number, post the receivable and move NO stock (never-list 5, ADR 0014).
 *                           An invoice number already on file is `skipped`, never a job failure — a monthly
 *                           export overlaps the last one. "FieldAssist DMS invoice import" IS this target with
 *                           the built-in `fieldassist` profile; there is no separate procedure for it
 *
 *   Rollback (docs/17 §D7 "a migration run must be reversible before it is confirmed"): opening and brand-DMS
 *   invoices are cancelled through the invoice machine and their journal entries reversed with a reversal
 *   entry (ledgers are append-only; nothing is deleted from the books) — refused with 409 if money has since
 *   been allocated to one of them; retailers and listings the job CREATED are deactivated / unlisted, ones it
 *   UPDATED are restored from the `before` snapshot the row keeps; purchase-history rows and external codes
 *   learned by the job are removed (no ledger effect). Rows keep their `status` and `entityId` for the audit
 *   trail; the job says `rolled_back`. A rolled-back job is terminal — start again with `imports.create` on
 *   the same object key.
 *
 * EXPORTS (coordination §3.5 — ONE queue, ONE renderer registry, built here):
 *
 *   `exports.request` inserts an `export_jobs` row and enqueues the single `exports.render` pg-boss job; the
 *   worker's registry maps `kind` → renderer. This module registers `tally_xml`, `gstr1_json`,
 *   `sales_register_xlsx`, `outstanding_xlsx`, `eway_bill_json` and `einvoice_json` — the `ExportKindSchema`
 *   below. Claims registers `claim_sheet` and reporting registers `report_<register>_<format>` on the same
 *   queue; those kinds are requested through THEIR procedures (`claims.statements.generate`,
 *   `reporting.exports.request`), never through `exports.request`, but they are visible in `exports.list /
 *   get / downloadUrl` — the exports screen is one history, whoever queued the row. Nothing binary passes
 *   through a service (docs/20 rule 15): `downloadUrl` mints a pre-signed read URL once the object exists.
 *
 *   `tally_xml` — TallyPrime import XML: sales vouchers (invoices, plus the window's credit notes as Tally
 *   `Credit Note` vouchers so the sales register matches to the paisa), receipts, purchases (supplier
 *   invoices). Every voucher carries a stable GUID (`sha256(tenantId:docType:docId)`) written to
 *   `tally_sync_ledger` with a content hash, so re-exporting an overlapping window makes Tally UPDATE, never
 *   duplicate. `tenant_brands.tally_export_source` is respected per LINE: a line of a brand marked
 *   `brand_dms` or `none` is excluded (the CA already keys those from the brand's own DMS); an invoice with
 *   no eligible line emits no voucher. The company name in the file is the distributor's own
 *   (`tenants.legal_name`, or `tallyCompanyName` when the CA's Tally company is named differently) — never
 *   "Distribution OS" (§D6). Ledger names come from `retailers / suppliers / accounts .tallyLedgerName`
 *   first and `tally_mappings` second; stock items, godowns, units and voucher types from `tally_mappings`.
 *
 *   `eway_bill_json` and `einvoice_json` are STUBS on purpose: they bundle the invoices' already-recorded
 *   fields (`ewayBillNo`, `irn`, `ackNo` — or null where nothing was recorded) into the government's JSON
 *   shape for a human to hand to a GSP tool or the portal. No GSP is ever called (billing's `requestIrn` is
 *   the only IRN stub, and it is local too).
 *
 * Money is integer paise (a file's rupee amounts are converted at staging per the mapping's `amountUnit`),
 * quantities integer pieces (`unit` per row: piece | case | inner, resolved with the tenant's sell-side pack
 * size), percentages basis points, dates IST (a garbled date is a ROW error, never a job failure), ids
 * client-generated UUIDv7. Every list caps `limit` at 200 and pages on `cursor` = the last row's id. Every
 * error message on a row or a job is a short English sentence naming the row and the column, never a raw
 * exception. Every state change of a job goes through `importJobMachine` in `@dos/domain` (to be added with
 * the module): queued → staged → running → committed → confirmed | rolled_back; failed from queued/running;
 * cancelled from queued/staged.
 */

const IsoDateSchema = z.iso.date()
const CursorInput = {
  limit: QueryIntSchema.min(1).max(200).default(50),
  cursor: z.string().optional(),
}

/** A dry run at or below this many rows answers inline; above it the worker scores the rows and `imports.get` is polled. */
export const INLINE_DRY_RUN_ROWS = 2_000
/** A file with more source rows than this is refused at staging (`failed`, "split the file"); bounded work per job (docs/20). */
export const MAX_IMPORT_ROWS = 50_000
/** An export window is at most one financial year plus a day. */
export const MAX_EXPORT_WINDOW_DAYS = 366

// ---------------------------------------------------------------------------------------------------------------
// enums

/**
 * Which software the file came from. Decides which built-in profile suggests the mapping, the `system` under
 * which a pinned party code is remembered (`external_party_codes.system`), and nothing else — every source is
 * read through the same generic path. `excel` is "a pile of sheets"; `other` is anything unnamed.
 */
export const ImportSourceSchema = z.enum([
  'tradeezee',
  'marg',
  'busy',
  'tally',
  'fieldassist',
  'excel',
  'other',
])
export type ImportSource = z.infer<typeof ImportSourceSchema>

/** What the file is, in the founder's words (docs/17 §D7). One target per job; the entity it becomes is in `IMPORT_TARGETS`. */
export const ImportTargetSchema = z.enum([
  'party_master',
  'item_master',
  'opening_outstanding',
  'sales_register',
  'brand_dms_invoices',
])
export type ImportTarget = z.infer<typeof ImportTargetSchema>

/**
 * `queued` (file registered, staging pending) → `staged` (rows parsed; preview / map / dry run / review loop) →
 * `running` (the commit worker is walking the rows) → `committed` (applied, REVERSIBLE) → `confirmed` (final) |
 * `rolled_back` (reversed, terminal). `failed` = the file did not parse or the worker crashed; `cancelled` =
 * abandoned from `queued` / `staged`. A dry run never changes the job's status.
 */
export const ImportJobStatusSchema = z.enum([
  'queued',
  'staged',
  'running',
  'committed',
  'confirmed',
  'rolled_back',
  'failed',
  'cancelled',
])
export type ImportJobStatus = z.infer<typeof ImportJobStatusSchema>

/**
 * `staged` = parsed, not yet scored; `matched` = validated and resolved, will commit; `needs_review` = below
 * the match floor, ambiguous, or missing a value a human must supply; `error` = the row is wrong (a bad date,
 * a non-numeric amount, an unknown state code) and will never commit as it is; `committed` / `skipped` after
 * commit (`skipped` also for a blank / header / duplicate row).
 */
export const ImportRowStatusSchema = z.enum([
  'staged',
  'matched',
  'needs_review',
  'committed',
  'skipped',
  'error',
])
export type ImportRowStatus = z.infer<typeof ImportRowStatusSchema>

/** What commit would do with a matched row: create the entity, update the one it matched, or skip (duplicate / blank). */
export const ImportRowPlanSchema = z.enum(['create', 'update', 'skip'])
export type ImportRowPlan = z.infer<typeof ImportRowPlanSchema>

/** How a cell is parsed and validated. `amount` honours the mapping's `amountUnit`; `percent` becomes basis points. */
export const ImportFieldTypeSchema = z.enum([
  'text',
  'code',
  'phone',
  'gstin',
  'date',
  'amount',
  'integer',
  'percent',
])
export type ImportFieldType = z.infer<typeof ImportFieldTypeSchema>

/** Every target field of every target, so a mapping validates on the wire; `IMPORT_TARGETS` says which belong to which target. */
export const ImportFieldKeySchema = z.enum([
  // party
  'partyCode',
  'partyName',
  'ownerName',
  'phone',
  'gstin',
  'pan',
  'addressLine1',
  'addressLine2',
  'area',
  'city',
  'pincode',
  'stateCode',
  'beatName',
  'tallyLedgerName',
  // item
  'itemCode',
  'itemName',
  'ean',
  'brandName',
  'hsnCode',
  'mrp',
  'caseSize',
  'gstRate',
  'localAlias',
  // document
  'invoiceNo',
  'invoiceDate',
  'dueDate',
  'amount',
  'buyerGstin',
  'placeOfSupplyState',
  // line
  'qty',
  'freeQty',
  'unit',
  'rate',
  'discount',
  'batchNo',
  'expiryDate',
])
export type ImportFieldKey = z.infer<typeof ImportFieldKeySchema>

export interface ImportTargetField {
  key: ImportFieldKey
  label: string
  type: ImportFieldType
  /** Must be mapped (a column or a constant) before a dry run; `anyOf` groups are checked on top. */
  required: boolean
}

export interface ImportTargetSpec {
  label: string
  /** The entity a committed row becomes, as `ImportRow.entityType` reports it. */
  entity: 'retailer' | 'tenant_product' | 'invoice' | 'purchase_history'
  fields: readonly ImportTargetField[]
  /** At least one field of each group must be mapped (a party is found by code OR name). */
  anyOf: readonly (readonly ImportFieldKey[])[]
}

const PARTY_REF: readonly ImportTargetField[] = [
  {
    key: 'partyCode',
    label: 'Party code in the old software',
    type: 'code',
    required: false,
  },
  { key: 'partyName', label: 'Shop name', type: 'text', required: false },
]
const ITEM_REF: readonly ImportTargetField[] = [
  { key: 'itemCode', label: 'Item code in the old software', type: 'code', required: false },
  { key: 'itemName', label: 'Item name', type: 'text', required: false },
]

/**
 * The target field catalogue the mapping screen renders and the dry run validates against. Static in the
 * contract on purpose — the apps link this package, so the dropdown needs no round trip and the server and
 * the client agree by construction. What is deliberately ABSENT: any credit field on `party_master`
 * (credit limit, days, tier, mode — `retailers.setCredit` only), any purchase cost anywhere (a supplier bill
 * is docint's, never a spreadsheet's), and any global product field on `item_master` (no bulk `catalog.propose`).
 */
export const IMPORT_TARGETS = {
  party_master: {
    label: 'Party master (shops)',
    entity: 'retailer',
    anyOf: [],
    fields: [
      {
        key: 'partyCode',
        label: 'Party code in the old software',
        type: 'code',
        required: false,
      },
      { key: 'partyName', label: 'Shop name', type: 'text', required: true },
      { key: 'ownerName', label: 'Owner / contact name', type: 'text', required: false },
      { key: 'phone', label: 'Mobile', type: 'phone', required: true },
      { key: 'gstin', label: 'GSTIN', type: 'gstin', required: false },
      { key: 'pan', label: 'PAN', type: 'text', required: false },
      { key: 'addressLine1', label: 'Address line 1', type: 'text', required: false },
      { key: 'addressLine2', label: 'Address line 2', type: 'text', required: false },
      { key: 'area', label: 'Area / locality', type: 'text', required: false },
      { key: 'city', label: 'City', type: 'text', required: false },
      { key: 'pincode', label: 'PIN code', type: 'code', required: false },
      { key: 'stateCode', label: 'State code (GST, e.g. 27)', type: 'code', required: true },
      { key: 'beatName', label: 'Beat name', type: 'text', required: false },
      { key: 'tallyLedgerName', label: 'Ledger name in Tally', type: 'text', required: false },
    ],
  },
  item_master: {
    label: 'Item master (products)',
    entity: 'tenant_product',
    anyOf: [['itemCode', 'itemName', 'ean']],
    fields: [
      ...ITEM_REF,
      { key: 'ean', label: 'EAN / barcode', type: 'code', required: false },
      { key: 'brandName', label: 'Brand', type: 'text', required: false },
      { key: 'hsnCode', label: 'HSN code', type: 'code', required: false },
      { key: 'mrp', label: 'MRP', type: 'amount', required: false },
      { key: 'caseSize', label: 'Pieces per case', type: 'integer', required: false },
      { key: 'gstRate', label: 'GST rate (%)', type: 'percent', required: false },
      { key: 'localAlias', label: 'Name the reps use', type: 'text', required: false },
    ],
  },
  opening_outstanding: {
    label: 'Opening outstanding, bill by bill',
    entity: 'invoice',
    anyOf: [['partyCode', 'partyName']],
    fields: [
      ...PARTY_REF,
      { key: 'invoiceNo', label: 'Bill number', type: 'code', required: true },
      { key: 'invoiceDate', label: 'Bill date', type: 'date', required: true },
      { key: 'amount', label: 'Outstanding amount on this bill', type: 'amount', required: true },
      { key: 'dueDate', label: 'Due date', type: 'date', required: false },
    ],
  },
  sales_register: {
    label: 'Sales register (buying history)',
    entity: 'purchase_history',
    anyOf: [
      ['partyCode', 'partyName'],
      ['itemCode', 'itemName', 'ean'],
    ],
    fields: [
      ...PARTY_REF,
      { key: 'invoiceNo', label: 'Bill number', type: 'code', required: false },
      { key: 'invoiceDate', label: 'Bill date', type: 'date', required: true },
      ...ITEM_REF,
      { key: 'ean', label: 'EAN / barcode', type: 'code', required: false },
      { key: 'qty', label: 'Quantity', type: 'integer', required: true },
      {
        key: 'unit',
        label: 'Unit of the quantity (piece | case | inner)',
        type: 'text',
        required: false,
      },
      { key: 'rate', label: 'Rate per unit', type: 'amount', required: false },
    ],
  },
  brand_dms_invoices: {
    label: 'Brand DMS invoices (one row per line)',
    entity: 'invoice',
    anyOf: [
      ['partyCode', 'partyName'],
      ['itemCode', 'itemName', 'ean'],
    ],
    fields: [
      ...PARTY_REF,
      {
        key: 'invoiceNo',
        label: 'Invoice number printed by the brand',
        type: 'code',
        required: true,
      },
      { key: 'invoiceDate', label: 'Invoice date', type: 'date', required: true },
      { key: 'buyerGstin', label: "Shop's GSTIN on the invoice", type: 'gstin', required: false },
      {
        key: 'placeOfSupplyState',
        label: 'Place of supply (state code)',
        type: 'code',
        required: true,
      },
      ...ITEM_REF,
      { key: 'ean', label: 'EAN / barcode', type: 'code', required: false },
      { key: 'hsnCode', label: 'HSN code', type: 'code', required: true },
      { key: 'qty', label: 'Quantity billed', type: 'integer', required: true },
      { key: 'freeQty', label: 'Free quantity', type: 'integer', required: false },
      {
        key: 'unit',
        label: 'Unit of the quantity (piece | case | inner)',
        type: 'text',
        required: false,
      },
      { key: 'rate', label: 'Rate per unit', type: 'amount', required: true },
      { key: 'discount', label: 'Line discount', type: 'amount', required: false },
      { key: 'gstRate', label: 'GST rate (%)', type: 'percent', required: true },
      { key: 'batchNo', label: 'Batch', type: 'text', required: false },
      { key: 'expiryDate', label: 'Expiry', type: 'date', required: false },
      { key: 'mrp', label: 'MRP', type: 'amount', required: false },
    ],
  },
} as const satisfies Record<ImportTarget, ImportTargetSpec>

/** The fields the mapping screen offers for a target. */
export function importFieldsFor(target: ImportTarget): readonly ImportTargetField[] {
  return IMPORT_TARGETS[target].fields
}

/** How a date cell is written in the file. `auto` tries ISO, then DD-MM-YYYY, then DD/MM/YYYY; ambiguous is a row error. */
export const ImportDateFormatSchema = z.enum([
  'auto',
  'YYYY-MM-DD',
  'DD-MM-YYYY',
  'DD/MM/YYYY',
  'MM/DD/YYYY',
  'DD-MMM-YYYY',
])
export type ImportDateFormat = z.infer<typeof ImportDateFormatSchema>

/** Whether an `amount` cell is in rupees (₹268.50 → 26850 paise) or already in paise. */
export const ImportAmountUnitSchema = z.enum(['rupees', 'paise'])

export const ExportKindSchema = z.enum([
  'tally_xml',
  'gstr1_json',
  'sales_register_xlsx',
  'outstanding_xlsx',
  'eway_bill_json',
  'einvoice_json',
])
export type ExportKind = z.infer<typeof ExportKindSchema>

/** The shared `job_status` enum as `export_jobs` uses it; an export never pauses for a review. */
export const ExportJobStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
])
export type ExportJobStatus = z.infer<typeof ExportJobStatusSchema>

/** Tally voucher types a `tally_xml` export may include; default all three. */
export const TallyVoucherTypeSchema = z.enum(['sales', 'receipts', 'purchases'])
export type TallyVoucherType = z.infer<typeof TallyVoucherTypeSchema>

/**
 * What a `tally_mappings` row names. `party` and `ledger` are OVERRIDES: the export reads
 * `retailers / suppliers / accounts .tallyLedgerName` first and this table second.
 */
export const TallyEntityTypeSchema = z.enum([
  'stock_item',
  'godown',
  'unit',
  'voucher_type',
  'party',
  'ledger',
])
export type TallyEntityType = z.infer<typeof TallyEntityTypeSchema>

/** Our document kinds as `tally_sync_ledger.doc_type` records them. */
export const TallyDocTypeSchema = z.enum(['invoice', 'credit_note', 'receipt', 'supplier_invoice'])
export type TallyDocType = z.infer<typeof TallyDocTypeSchema>

// ---------------------------------------------------------------------------------------------------------------
// the mapping

/** One file column → one target field. `column` is the header text as `imports.preview` detected it (`col_3` when the file has no header row). */
export const ColumnMappingEntrySchema = z.object({
  column: z.string().trim().min(1).max(120),
  field: ImportFieldKeySchema,
})
export type ColumnMappingEntry = z.infer<typeof ColumnMappingEntrySchema>

/** A value the file does not carry, applied to every row: `placeOfSupplyState = 27`, `unit = case`. */
export const MappingConstantSchema = z.object({
  field: ImportFieldKeySchema,
  value: z.string().trim().min(1).max(120),
})
export type MappingConstant = z.infer<typeof MappingConstantSchema>

/**
 * The saved shape of "how to read this file". A field appears at most once across `columns` and
 * `constants`; the same column may feed two fields (a "Name" column is both `partyName` and
 * `tallyLedgerName`). Which fields are valid for the job's target is checked by the handler against
 * `IMPORT_TARGETS`, as are `required` and `anyOf`.
 */
export const ImportMappingSchema = z
  .object({
    columns: z.array(ColumnMappingEntrySchema).min(1).max(60),
    constants: z.array(MappingConstantSchema).max(20).default([]),
    dateFormat: ImportDateFormatSchema.default('auto'),
    amountUnit: ImportAmountUnitSchema.default('rupees'),
  })
  .superRefine((m, ctx) => {
    const seen = new Set<string>()
    for (const [i, c] of m.columns.entries()) {
      if (seen.has(c.field)) {
        ctx.addIssue({
          code: 'custom',
          path: ['columns', i, 'field'],
          message: `${c.field} is mapped twice`,
        })
      }
      seen.add(c.field)
    }
    for (const [i, c] of m.constants.entries()) {
      if (seen.has(c.field)) {
        ctx.addIssue({
          code: 'custom',
          path: ['constants', i, 'field'],
          message: `${c.field} is both a column and a constant`,
        })
      }
      seen.add(c.field)
    }
  })
export type ImportMapping = z.infer<typeof ImportMappingSchema>

// ---------------------------------------------------------------------------------------------------------------
// output shapes

export const ImportProfileSchema = z.object({
  id: IdSchema,
  name: z.string(),
  source: ImportSourceSchema,
  target: ImportTargetSchema,
  mapping: ImportMappingSchema,
  hasHeaderRow: z.boolean(),
  sheetName: z.string().nullable(),
  /** Shipped with the product for this tenant (TradeEzee, Marg, Busy, Tally, FieldAssist); editable, never deleted. */
  builtIn: z.boolean(),
  /** How many jobs used it; the wizard offers the most-used profile of a (source, target) first. */
  usedCount: z.number().int().nonnegative(),
  lastUsedAt: z.string().nullable(),
  createdBy: IdSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type ImportProfile = z.infer<typeof ImportProfileSchema>

/** A column as staging found it: its position, its header, a few sample cells, and the field the source's built-in profile suggests. */
export const DetectedColumnSchema = z.object({
  index: z.number().int().nonnegative(),
  header: z.string(),
  samples: z.array(z.string()).max(5),
  suggestedField: ImportFieldKeySchema.nullable(),
})
export type DetectedColumn = z.infer<typeof DetectedColumnSchema>

export const ImportRowCountsSchema = z.object({
  staged: z.number().int().nonnegative(),
  matched: z.number().int().nonnegative(),
  needsReview: z.number().int().nonnegative(),
  committed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  error: z.number().int().nonnegative(),
})
export type ImportRowCounts = z.infer<typeof ImportRowCountsSchema>

/** A row-level problem, in English, naming the column when one is to blame. */
export const ImportRowErrorSchema = z.object({
  rowNo: z.number().int().positive(),
  field: ImportFieldKeySchema.nullable(),
  message: z.string(),
})
export type ImportRowError = z.infer<typeof ImportRowErrorSchema>

/**
 * The diff a dry run answers: what commit WOULD do. `amountPaise` is the sum over the rows that would be
 * created, for `opening_outstanding` and `brand_dms_invoices` (the owner compares it with the old
 * software's total before signing off); null for the other targets. `sampleErrors` holds the first
 * `DRY_RUN_SAMPLE_ERRORS` problems; `rows.list` with `status = error | needs_review` pages the rest.
 */
export const DryRunSummarySchema = z.object({
  status: z.enum(['running', 'done']),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  rows: z.number().int().nonnegative(),
  willCreate: z.number().int().nonnegative(),
  willUpdate: z.number().int().nonnegative(),
  willSkip: z.number().int().nonnegative(),
  needsReview: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  amountPaise: PaiseSchema.nullable(),
  sampleErrors: z.array(ImportRowErrorSchema).max(50),
})
export type DryRunSummary = z.infer<typeof DryRunSummarySchema>
export const DRY_RUN_SAMPLE_ERRORS = 50

export const ImportJobSchema = z.object({
  id: IdSchema,
  source: ImportSourceSchema,
  target: ImportTargetSchema,
  status: ImportJobStatusSchema,
  profileId: IdSchema.nullable(),
  /** As uploaded, for the job list; the bytes are behind `sourceObjectKey` (`files.readUrl`, domain `import`). */
  fileName: z.string().nullable(),
  sourceObjectKey: z.string(),
  hasHeaderRow: z.boolean(),
  sheetName: z.string().nullable(),
  /** Null until staged. */
  totalRows: z.number().int().nonnegative().nullable(),
  /** Recomputed from `import_rows` after commit, never incremented ad hoc. */
  okRows: z.number().int().nonnegative(),
  errorRows: z.number().int().nonnegative(),
  requestedBy: IdSchema,
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  committedAt: z.string().nullable(),
  confirmedAt: z.string().nullable(),
  confirmedBy: IdSchema.nullable(),
  rolledBackAt: z.string().nullable(),
  rolledBackBy: IdSchema.nullable(),
  rollbackReason: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  /** A job-level failure in English ("The file has no rows", "Sheet 'Parties' was not found"). */
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type ImportJob = z.infer<typeof ImportJobSchema>

export const ImportJobDetailSchema = ImportJobSchema.extend({
  /** Null until `setMapping` (or a `profileId` / `mapping` on create). */
  mapping: ImportMappingSchema.nullable(),
  /** Empty until staged. */
  columns: z.array(DetectedColumnSchema),
  rowCounts: ImportRowCountsSchema,
  /** The latest dry run, cleared by every mapping change; null until the first. */
  dryRun: DryRunSummarySchema.nullable(),
})
export type ImportJobDetail = z.infer<typeof ImportJobDetailSchema>

/** A party or an item the matcher considered for a row, scored 0–10000 bps; the review screen lists them. */
export const ImportMatchCandidateSchema = z.object({
  entityType: z.enum(['retailer', 'variant']),
  entityId: IdSchema,
  label: z.string(),
  scoreBps: z.number().int().min(0).max(10_000),
})
export type ImportMatchCandidate = z.infer<typeof ImportMatchCandidateSchema>

export const ImportRowSchema = z.object({
  id: IdSchema,
  rowNo: z.number().int().positive(),
  /** Cells keyed by detected header, exactly as read. */
  raw: z.record(z.string(), z.string()),
  /** The mapped, parsed, resolved values keyed by target field (paise, pieces, ISO dates, ids) — null until scored. */
  normalized: z.record(z.string(), z.unknown()).nullable(),
  status: ImportRowStatusSchema,
  plan: ImportRowPlanSchema.nullable(),
  /** The retailer the row resolved to (every target but `item_master`), pinned or matched. */
  retailerId: IdSchema.nullable(),
  /** The variant the row resolved to (`item_master`, `sales_register`, `brand_dms_invoices`). */
  variantId: IdSchema.nullable(),
  candidates: z.array(ImportMatchCandidateSchema).max(5),
  /** What commit created or updated: `IMPORT_TARGETS[target].entity` and its id. */
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  error: z.string().nullable(),
  reviewedBy: IdSchema.nullable(),
  reviewedAt: z.string().nullable(),
})
export type ImportRow = z.infer<typeof ImportRowSchema>

export const ExportJobSchema = z.object({
  id: IdSchema,
  /** `ExportKindSchema` when requested here; `claim_sheet` / `report_<register>_<format>` when claims / reporting queued it. */
  kind: z.string(),
  status: ExportJobStatusSchema,
  params: z.record(z.string(), z.unknown()),
  /** Vouchers / invoices / rows in the file; null until rendered. */
  rowCount: z.number().int().nonnegative().nullable(),
  requestedBy: IdSchema,
  /** Derived from `kind` and the window ("tally-2026-08-01-to-2026-08-31.xml"); what the browser saves it as. */
  fileName: z.string(),
  mimeType: z.string(),
  objectKey: z.string().nullable(),
  error: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  createdAt: z.string(),
})
export type ExportJob = z.infer<typeof ExportJobSchema>

export const TallyMappingSchema = z.object({
  id: IdSchema,
  entityType: TallyEntityTypeSchema,
  entityId: z.string(),
  /** Resolved per `entityType` (variant name, location name, unit code, voucher-type key, party name) so the CA never reads a bare id. */
  entityLabel: z.string(),
  tallyName: z.string(),
  tallyParent: z.string().nullable(),
  updatedAt: z.string(),
})
export type TallyMapping = z.infer<typeof TallyMappingSchema>

export const TallySyncEntrySchema = z.object({
  id: IdSchema,
  docType: TallyDocTypeSchema,
  docId: z.string(),
  tallyGuid: z.string().nullable(),
  tallyVoucherId: z.string().nullable(),
  exportJobId: IdSchema.nullable(),
  exportedAt: z.string(),
  contentHash: z.string(),
})
export type TallySyncEntry = z.infer<typeof TallySyncEntrySchema>

const ImportJobItemOutput = z.object({ item: ImportJobSchema })
const ImportJobDetailOutput = z.object({ item: ImportJobDetailSchema })

// ---------------------------------------------------------------------------------------------------------------
// inputs — imports

/**
 * `id` is the job's client-generated UUIDv7 and also the `entityId` the client used on `files.uploadUrl`
 * (`domain: 'import'`) before this call, so `sourceObjectKey` is `tenant/{tenantId}/import/{id}/…`.
 * `profileId` copies that profile's mapping and options (an explicit `mapping` / `hasHeaderRow` /
 * `sheetName` here wins); with neither, the job stages without a mapping and the wizard sets one after
 * `preview`. Answers `queued`; the stage job moves it to `staged`.
 */
export const CreateImportInput = MutationBase.extend({
  id: IdSchema,
  source: ImportSourceSchema,
  target: ImportTargetSchema,
  sourceObjectKey: z.string().min(1).max(512),
  fileName: z.string().trim().min(1).max(200).optional(),
  profileId: IdSchema.optional(),
  mapping: ImportMappingSchema.optional(),
  hasHeaderRow: z.boolean().optional(),
  /** XLSX only; the first sheet when omitted. */
  sheetName: z.string().trim().min(1).max(80).optional(),
})
export const CreateImportOutput = ImportJobItemOutput

export const ImportsListInput = z.object({
  source: ImportSourceSchema.optional(),
  target: ImportTargetSchema.optional(),
  status: ImportJobStatusSchema.optional(),
  /** Created on or after / on or before this IST date. */
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  ...CursorInput,
})
export const ImportsListOutput = z.object({
  items: z.array(ImportJobSchema),
  nextCursor: z.string().nullable(),
})

export const ImportGetInput = z.object({ id: IdSchema })
export const ImportGetOutput = ImportJobDetailOutput

/** The first `rows` source rows as read, with the detected columns. Available from `staged` on; 409 before. */
export const ImportPreviewInput = z.object({
  id: IdSchema,
  rows: QueryIntSchema.min(1).max(50).default(20),
})
export const PreviewRowSchema = z.object({
  rowNo: z.number().int().positive(),
  cells: z.record(z.string(), z.string()),
})
export type PreviewRow = z.infer<typeof PreviewRowSchema>
export const ImportPreviewOutput = z.object({
  columns: z.array(DetectedColumnSchema),
  rows: z.array(PreviewRowSchema),
  totalRows: z.number().int().nonnegative(),
  /** Every sheet of an XLSX (so the operator can pick another and re-create); `[]` for a CSV. */
  sheetNames: z.array(z.string()),
  hasHeaderRow: z.boolean(),
})

/**
 * Replaces the job's mapping (409 unless `staged`), clears the last dry run and puts every row back to
 * `staged`. `saveAsProfile` also upserts a profile of the job's (source, target) under that name — the
 * "save this mapping for next time" tick on the wizard.
 */
export const SetImportMappingInput = MutationBase.extend({
  id: IdSchema,
  mapping: ImportMappingSchema,
  saveAsProfile: z
    .object({
      id: IdSchema,
      name: z.string().trim().min(2).max(60),
    })
    .optional(),
})
export const SetImportMappingOutput = z.object({
  item: ImportJobDetailSchema,
  profile: ImportProfileSchema.nullable(),
})

/**
 * Validates and matches every row against the mapping; creates nothing (409 unless `staged`; 400
 * `mapping_missing` without one). Inline up to `INLINE_DRY_RUN_ROWS` (`dryRun.status = 'done'`), otherwise
 * queued (`'running'`; poll `imports.get`). Safe to repeat as often as the operator likes.
 */
export const DryRunImportInput = MutationBase.extend({ id: IdSchema })
export const DryRunImportOutput = ImportJobDetailOutput

export const ImportRowsListInput = z.object({
  id: IdSchema,
  status: ImportRowStatusSchema.optional(),
  plan: ImportRowPlanSchema.optional(),
  /** Only rows with a problem (`error` or `needs_review`) — the review grid's default filter. */
  problemsOnly: QueryBoolSchema.optional(),
  limit: QueryIntSchema.min(1).max(200).default(100),
  cursor: z.string().optional(),
})
export const ImportRowsListOutput = z.object({
  items: z.array(ImportRowSchema),
  nextCursor: z.string().nullable(),
})

/**
 * The human resolves one row (409 unless the job is `staged`). Pinning `retailerId` / `variantId` moves it
 * to `matched`; `values` overrides parsed field values (a mistyped phone, a wrong date; an empty value
 * clears the field) and re-validates; `skip` marks a junk row `skipped` with no error. With `rememberCode` (default true) a pinned party whose
 * row carried a `partyCode` is written to `external_party_codes(system = source)` through
 * `RetailersService.linkExternalCode`, so the same code auto-matches on every later file. Sets
 * `reviewedBy` / `reviewedAt`.
 */
/** One hand-corrected cell of a row, as the operator typed it (parsed like a file cell; `''` clears). */
export const ReviewValueSchema = z.object({
  field: ImportFieldKeySchema,
  value: z.string().trim().max(200),
})
export type ReviewValue = z.infer<typeof ReviewValueSchema>

export const ReviewImportRowInput = MutationBase.extend({
  id: IdSchema,
  rowId: IdSchema,
  retailerId: IdSchema.optional(),
  variantId: IdSchema.optional(),
  values: z.array(ReviewValueSchema).max(40).optional(),
  skip: z.boolean().optional(),
  rememberCode: z.boolean().default(true),
})
export const ReviewImportRowOutput = z.object({ item: ImportRowSchema })

/**
 * Applies the job (409 unless `staged`; 400 `dry_run_required` unless a dry run finished after the last
 * mapping change; 400 `unresolved_rows` while any row is `needs_review` / `error` unless `skipUnresolved`
 * leaves them `skipped` — never committed guessing). Answers `running`; the worker walks `matched` rows in
 * batches of 500, each in its own transaction keyed `import:<jobId>:<rowNo>`, and finishes `committed`
 * (some rows may still be `error`) or `failed` (the worker itself crashed). Replaying on a `committed` job
 * is a no-op. `target = 'opening_outstanding'` refuses every role but the owner (403).
 */
export const CommitImportInput = MutationBase.extend({
  id: IdSchema,
  skipUnresolved: z.boolean().default(false),
})
export const CommitImportOutput = ImportJobItemOutput

/** The sign-off: `committed` → `confirmed`, after which nothing is reversible. `opening_outstanding`: owner only. */
export const ConfirmImportInput = MutationBase.extend({ id: IdSchema })
export const ConfirmImportOutput = ImportJobItemOutput

/**
 * `committed` → `rolled_back` (409 from any other status, and 409 `money_allocated` when a receipt has since
 * been allocated to an invoice this job created — reverse that first). See the header for what is reversed
 * per target.
 */
export const RollbackImportInput = MutationBase.extend({
  id: IdSchema,
  reason: z.string().trim().min(1).max(200),
})
export const RollbackImportOutput = z.object({
  item: ImportJobSchema,
  reversedRows: z.number().int().nonnegative(),
  /** Per `entityType` ("invoice": 6, "journal_entry": 6, "retailer": 12). */
  reversedByEntity: z.record(z.string(), z.number().int().nonnegative()),
})

/** Only from `queued` / `staged` (409 otherwise — a running commit is never interrupted mid-batch). */
export const CancelImportInput = MutationBase.extend({
  id: IdSchema,
  reason: z.string().trim().max(200).optional(),
})
export const CancelImportOutput = ImportJobItemOutput

// ---------------------------------------------------------------------------------------------------------------
// inputs — profiles

export const ProfilesListInput = z.object({
  source: ImportSourceSchema.optional(),
  target: ImportTargetSchema.optional(),
  ...CursorInput,
})
export const ProfilesListOutput = z.object({
  items: z.array(ImportProfileSchema),
  nextCursor: z.string().nullable(),
})

/**
 * Create or update a named mapping for a (source, target). `name` is unique per tenant within that pair; a
 * built-in profile may be edited (it keeps `builtIn: true`) but never renamed away from its source. The
 * mapping's fields are validated against `IMPORT_TARGETS[target]` like a job's.
 */
export const UpsertProfileInput = MutationBase.extend({
  id: IdSchema,
  name: z.string().trim().min(2).max(60),
  source: ImportSourceSchema,
  target: ImportTargetSchema,
  mapping: ImportMappingSchema,
  hasHeaderRow: z.boolean().default(true),
  sheetName: z.string().trim().min(1).max(80).nullable().optional(),
})
export const UpsertProfileOutput = z.object({ item: ImportProfileSchema })

// ---------------------------------------------------------------------------------------------------------------
// inputs — exports

/**
 * Kind-specific fields (everything else is ignored for that kind and echoed in `params`):
 *
 *   tally_xml            voucherTypes (default all three), retailerId, supplierId, tallyCompanyName
 *   gstr1_json           supplyType (default `all`); `from`/`to` are normally one GST month
 *   sales_register_xlsx  retailerId
 *   outstanding_xlsx     retailerId; `to` is the "as of" date, `from` is ignored
 *   eway_bill_json       invoiceIds (subset of the window; all invoices of the window when omitted)
 *   einvoice_json        invoiceIds, as above
 *
 * The window is at most `MAX_EXPORT_WINDOW_DAYS`. Answers `queued`; poll `exports.get`, then `downloadUrl`.
 */
export const RequestExportInput = MutationBase.extend({
  id: IdSchema,
  kind: ExportKindSchema,
  from: IsoDateSchema,
  to: IsoDateSchema,
  voucherTypes: z.array(TallyVoucherTypeSchema).min(1).max(3).optional(),
  supplyType: z.enum(['B2B', 'B2C', 'all']).optional(),
  retailerId: IdSchema.optional(),
  supplierId: IdSchema.optional(),
  invoiceIds: z.array(IdSchema).min(1).max(200).optional(),
  /** The CA's company name in TallyPrime when it differs from the distributor's legal name. Never "Distribution OS". */
  tallyCompanyName: z.string().trim().min(1).max(120).optional(),
}).superRefine((v, ctx) => {
  const from = Date.parse(`${v.from}T00:00:00.000+05:30`)
  const to = Date.parse(`${v.to}T00:00:00.000+05:30`)
  if (to < from) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: 'to is before from' })
  } else if ((to - from) / 86_400_000 > MAX_EXPORT_WINDOW_DAYS) {
    ctx.addIssue({
      code: 'custom',
      path: ['to'],
      message: `the window is longer than ${MAX_EXPORT_WINDOW_DAYS} days`,
    })
  }
})
export const RequestExportOutput = z.object({ item: ExportJobSchema })

export const ExportsListInput = z.object({
  /** Any kind, including `claim_sheet` and `report_*` rows queued by claims / reporting. */
  kind: z.string().trim().min(1).max(60).optional(),
  status: ExportJobStatusSchema.optional(),
  /** Requested on or after / on or before this IST date. */
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  ...CursorInput,
})
export const ExportsListOutput = z.object({
  items: z.array(ExportJobSchema),
  nextCursor: z.string().nullable(),
})

export const ExportGetInput = z.object({ id: IdSchema })
export const ExportGetOutput = z.object({ item: ExportJobSchema })

/** `url` is a pre-signed read (10 minutes) once `status = succeeded`; null while queued / running, and after a failure. */
export const ExportDownloadUrlInput = z.object({ id: IdSchema })
export const ExportDownloadUrlOutput = z.object({
  status: ExportJobStatusSchema,
  objectKey: z.string().nullable(),
  url: z.string().nullable(),
  expiresAt: z.string().nullable(),
  fileName: z.string(),
  mimeType: z.string(),
})
export type ExportDownloadUrl = z.infer<typeof ExportDownloadUrlOutput>

// ---------------------------------------------------------------------------------------------------------------
// inputs — tally

export const TallyMappingsListInput = z.object({
  entityType: TallyEntityTypeSchema.optional(),
  /** Matches `tallyName` or `entityLabel`. */
  q: z.string().trim().min(1).max(60).optional(),
  limit: QueryIntSchema.min(1).max(200).default(100),
  cursor: z.string().optional(),
})
export const TallyMappingsListOutput = z.object({
  items: z.array(TallyMappingSchema),
  nextCursor: z.string().nullable(),
})

/** Upsert on `(tenant, entityType, entityId)`; `id` is the row's id on first insert and ignored on update. */
export const UpsertTallyMappingInput = MutationBase.extend({
  id: IdSchema,
  entityType: TallyEntityTypeSchema,
  entityId: z.string().trim().min(1).max(64),
  tallyName: z.string().trim().min(1).max(120),
  tallyParent: z.string().trim().min(1).max(120).nullable().optional(),
})
export const UpsertTallyMappingOutput = z.object({ item: TallyMappingSchema })

export const TallySyncLedgerListInput = z.object({
  docType: TallyDocTypeSchema.optional(),
  exportJobId: IdSchema.optional(),
  /** Exported on or after / on or before this IST date. */
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  limit: QueryIntSchema.min(1).max(200).default(100),
  cursor: z.string().optional(),
})
export const TallySyncLedgerListOutput = z.object({
  items: z.array(TallySyncEntrySchema),
  nextCursor: z.string().nullable(),
})

// ---------------------------------------------------------------------------------------------------------------
// the router: mount as `integrations: integrationsContract` in contract.ts

export const integrationsContract = {
  imports: {
    create: oc
      .route({
        method: 'POST',
        path: '/integrations/imports',
        summary: 'Register an uploaded CSV / XLSX for a target and stage its rows',
      })
      .input(CreateImportInput)
      .output(CreateImportOutput),
    list: oc
      .route({
        method: 'GET',
        path: '/integrations/imports',
        summary: 'Import jobs (the wizard history)',
      })
      .input(ImportsListInput)
      .output(ImportsListOutput),
    get: oc
      .route({
        method: 'GET',
        path: '/integrations/imports/{id}',
        summary: 'One import job with its mapping, detected columns, row counts and last dry run',
      })
      .input(ImportGetInput)
      .output(ImportGetOutput),
    preview: oc
      .route({
        method: 'GET',
        path: '/integrations/imports/{id}/preview',
        summary: 'The first N rows as read, with the detected columns and a suggested field each',
      })
      .input(ImportPreviewInput)
      .output(ImportPreviewOutput),
    setMapping: oc
      .route({
        method: 'POST',
        path: '/integrations/imports/{id}/mapping',
        summary:
          'Map file columns to target fields; optionally save the mapping as a named profile',
      })
      .input(SetImportMappingInput)
      .output(SetImportMappingOutput),
    dryRun: oc
      .route({
        method: 'POST',
        path: '/integrations/imports/{id}/dry-run',
        summary:
          'Validate and match every row; answer the create / update / skip diff, create nothing',
      })
      .input(DryRunImportInput)
      .output(DryRunImportOutput),
    rows: {
      list: oc
        .route({
          method: 'GET',
          path: '/integrations/imports/{id}/rows',
          summary:
            'The rows of an import with their status, plan, match and error (the review grid)',
        })
        .input(ImportRowsListInput)
        .output(ImportRowsListOutput),
      review: oc
        .route({
          method: 'POST',
          path: '/integrations/imports/{id}/rows/{rowId}/review',
          summary: 'Resolve one row: pin a shop or an item, correct a value, or skip it',
        })
        .input(ReviewImportRowInput)
        .output(ReviewImportRowOutput),
    },
    commit: oc
      .route({
        method: 'POST',
        path: '/integrations/imports/{id}/commit',
        summary: 'Apply the matched rows through the owning services (reversible until confirmed)',
      })
      .input(CommitImportInput)
      .output(CommitImportOutput),
    confirm: oc
      .route({
        method: 'POST',
        path: '/integrations/imports/{id}/confirm',
        summary: 'Sign off a committed import; it can no longer be rolled back',
      })
      .input(ConfirmImportInput)
      .output(ConfirmImportOutput),
    rollback: oc
      .route({
        method: 'POST',
        path: '/integrations/imports/{id}/rollback',
        summary: 'Reverse a committed, unconfirmed import (invoices cancelled, journals reversed)',
      })
      .input(RollbackImportInput)
      .output(RollbackImportOutput),
    cancel: oc
      .route({
        method: 'POST',
        path: '/integrations/imports/{id}/cancel',
        summary: 'Abandon a queued or staged import',
      })
      .input(CancelImportInput)
      .output(CancelImportOutput),
  },
  profiles: {
    list: oc
      .route({
        method: 'GET',
        path: '/integrations/import-profiles',
        summary: 'Saved column mappings per source and target (built-in ones included)',
      })
      .input(ProfilesListInput)
      .output(ProfilesListOutput),
    upsert: oc
      .route({
        method: 'POST',
        path: '/integrations/import-profiles',
        summary: 'Create or update a named mapping profile',
      })
      .input(UpsertProfileInput)
      .output(UpsertProfileOutput),
  },
  exports: {
    request: oc
      .route({
        method: 'POST',
        path: '/integrations/exports',
        summary: 'Queue a Tally XML, GSTR-1, register, e-way bill or e-invoice export for a window',
      })
      .input(RequestExportInput)
      .output(RequestExportOutput),
    list: oc
      .route({
        method: 'GET',
        path: '/integrations/exports',
        summary: 'Export jobs of every kind (claims and reports included)',
      })
      .input(ExportsListInput)
      .output(ExportsListOutput),
    get: oc
      .route({
        method: 'GET',
        path: '/integrations/exports/{id}',
        summary: 'One export job and its status',
      })
      .input(ExportGetInput)
      .output(ExportGetOutput),
    downloadUrl: oc
      .route({
        method: 'GET',
        path: '/integrations/exports/{id}/download-url',
        summary: 'A short-lived read URL for a rendered export',
      })
      .input(ExportDownloadUrlInput)
      .output(ExportDownloadUrlOutput),
  },
  tally: {
    mappings: {
      list: oc
        .route({
          method: 'GET',
          path: '/integrations/tally/mappings',
          summary: 'How our items, godowns, units, voucher types and parties are named in Tally',
        })
        .input(TallyMappingsListInput)
        .output(TallyMappingsListOutput),
      upsert: oc
        .route({
          method: 'POST',
          path: '/integrations/tally/mappings',
          summary: 'Set the Tally name (and parent) of one entity',
        })
        .input(UpsertTallyMappingInput)
        .output(UpsertTallyMappingOutput),
    },
    syncLedger: {
      list: oc
        .route({
          method: 'GET',
          path: '/integrations/tally/sync-ledger',
          summary: 'Which documents an export already pushed to Tally, with their GUIDs',
        })
        .input(TallySyncLedgerListInput)
        .output(TallySyncLedgerListOutput),
    },
  },
}
