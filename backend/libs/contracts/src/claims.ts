import { oc } from '@orpc/contract'
import { z } from 'zod'
import { ClaimChannelSchema } from './catalog.js'
import {
  IdSchema,
  MutationBase,
  PaiseSchema,
  PiecesSchema,
  QueryBoolSchema,
  QueryIntSchema,
} from './common.js'
import { AppliedRuleSchema } from './pricing.js'

/**
 * Claims — the back-office ledger of money the MANUFACTURER OWES THE DISTRIBUTOR (docs/plans/claims.md,
 * coordination §1 slot 7): company-funded scheme spend already given away on invoices, damaged and
 * expired goods the brand takes back, inbound shortages and rate differences. It owns `claims`,
 * `claim_lines`, `claim_evidence`, `claim_statements` and `claim_settlements`, and reads every source
 * through the owning module's exported service (coordination §4): `BillingService.invoiceLinesForPeriod /
 * creditNoteLinesForPeriod` (`invoice_lines.applied_rules` is THE scheme claim source), `PricingService.
 * schemesByIds`, `ProcurementService.openDiscrepancies / markDiscrepanciesClaimed`, `InventoryService.
 * ledgerRowsByReason`, `TenantCatalogService.returnPolicy / upsertReturnPolicy / costsForVariants`,
 * `ReceivablesService.postEntry / reverseEntry` (every journal entry), `IntegrationsService.enqueueExport`
 * (the claim sheet is an `export_jobs` row of `kind = 'claim_sheet'` on the ONE `exports.render` queue,
 * coordination §3.5) and `DocintService.get` (evidence by document id).
 *
 * WHICH SERVICES MOUNT `claims` (docs/plans/00-coordination.md §6 table — "claims and integrations are
 * owner + manager only"):
 *
 *   owner :3001      YES — the whole surface (O19: policies, periods, open / build / submit / settle,
 *                    ageing, the register), plus the owner-only `policies.upsert`
 *   manager :3002    YES — manager + accountant (M17). The MANAGER opens, builds, reviews and submits;
 *                    the ACCOUNTANT is the money desk (docs/22 2026-09-05): a claim is an entry in the
 *                    books — its submit accrues a receivable from the brand, a settlement books the
 *                    brand's credit note / cheque / bank receipt, a rejection reverses the accrual — so
 *                    every claims procedure is BACK_OFFICE, exactly as coordination §6 says, with two
 *                    exceptions: `policies.upsert` is a SETTING (what money the business believes it can
 *                    recover, per brand) and is OWNER_ONLY; `writeOff` accepts a loss and is the owner's
 *                    or the accountant's, never the manager's (brief §2). None of the writes here is a
 *                    price, a scheme, a credit limit, an order approval or a tenant setting
 *   sales :3003      NO  — `claim_lines.rate_paise` on a damage line IS purchase cost, and a scheme line
 *                    says which schemes the brand funds (the Vyapar failure that made reps quit,
 *                    brief §4.21)
 *   warehouse :3004  NO  — the crew records damage as an inventory movement (`inventory.stock.adjust`);
 *                    the money view of that damage stays at the desk
 *   delivery :3005   NO
 *   retailer :3006   NO  — a shop must never learn what the brand funds. All five tables are
 *                    `tenantRolePolicy(…, BACK_OFFICE_ROLES)` in RLS, so every one of these roles reads
 *                    ZERO rows even if a key were mounted by mistake; never in `SyncRegistry`, never in a
 *                    PowerSync bucket (docs/17 §B security 54–57)
 *
 * THE LIFE OF A CLAIM (states move only through `claimMachine` in `@dos/domain`; never a column write):
 *
 *   periods.list  →  which brand × kind × period windows are due, what is already claimed, what is
 *                    unclaimed and roughly worth how much (a COUNT + SUM, never a line materialisation)
 *   open          →  a DRAFT for (supplier, brand?, kind, periodFrom..periodTo); no number, no journal.
 *                    `claimChannel` is FROZEN here from `tenant_brands.claim_channel` (fallback `dos`)
 *   build         →  reconstructs the lines from the sources the kind implies (below); re-runnable;
 *                    sources already carried by a non-rejected line are `skipped`; sources older than
 *                    the claim window are inserted `rejected` with `detail.reason = 'out_of_window'` so
 *                    the loss is visible, never silently dropped
 *   lines.*       →  review: add a manual line the sources cannot reconstruct, ADJUST a built line
 *                    (its money, or exclude it from this claim which frees its source), remove one
 *   evidence.*    →  damage photos, the brand's mail, its credit note — by `files.uploadUrl`
 *                    (`domain: 'claim'`, `entityId` = the claim id) or a docint document id; never bytes
 *   submit        →  `claimMachine.next('draft', 'submit')`; the CLAIM number is allocated ONLY here
 *                    (`nextDocumentNumber(tx, 'CLAIM')` → `CLM-0001`, per tenant per FY); every open line
 *                    becomes `claimed`; `dueDate = submittedOn + settlementDays` (policy, default 30);
 *                    the accrual is posted (below) unless `claimChannel = 'brand_dms'`; source
 *                    discrepancies are marked `claimed`; and — when the caller passes `statement` — the
 *                    claim sheet is snapshotted and its `claim_sheet` export enqueued in the same
 *                    transaction, so one tap both submits and produces the file the brand is sent
 *   acknowledge   →  the brand's own claim reference, `submitted → acknowledged`; no journal
 *   settlements.record → the brand's credit note / bank receipt / cheque / replacement goods /
 *                    adjustment, partial allowed: `settle_partial → partially_settled`, `settle_full →
 *                    settled` when `settledPaise + writtenOffPaise = claimedPaise`; allocated to lines
 *                    explicitly or by `allocate()` in `lineNo` order, never past a line's `amountPaise`
 *   reject        →  the brand refused: the accrual is REVERSED (a new entry with `reversedByEntryId` on
 *                    the original — `journal_lines` is append-only), every non-settled line is
 *                    `rejected` so its source becomes claimable again; 409 once any settlement exists
 *   writeOff      →  the unrecovered remainder is accepted as a loss (owner / accountant)
 *   cancel        →  a DRAFT opened by mistake is discarded (`draft → cancelled`): its lines go, its
 *                    sources are free again, no number was ever allocated. The brief's machine had no
 *                    exit from draft other than submit, which would have allocated a number and posted
 *                    an accrual just to reject it; `cancelled` joins `claim_status` alongside the
 *                    brief's `written_off` (both `ALTER TYPE … ADD VALUE`, expand-only)
 *
 * WHAT `build` TURNS INTO LINES, per kind (brief §2 `build`, §4.6–4.14):
 *
 *   scheme          every `invoice_lines.applied_rules` entry whose `ruleId` resolves to a scheme with
 *                   `claimable = true AND fundingSource = 'company' AND rewardKind <> 'cash_discount_pct'`,
 *                   on invoices dated inside the period, `state <> 'cancelled'`, brand = the claim's.
 *                   Free goods are claimed AT COST (`qtyPcs = freeQty`, `basis = 'ptd'`); percentage,
 *                   flat and net-scheme rewards at the exact `amountPaise` given away (`basis =
 *                   'scheme_amount'`). A credit note against the invoice scales the claimable quantity
 *                   down, the paise re-spread with `allocate()`. DISTRIBUTOR-FUNDED SCHEMES ARE NEVER
 *                   CLAIMABLE (our own promotion cost; claiming it would be fraud on the brand) and a
 *                   CASH-DISCOUNT SCHEME IS NEVER CLAIMABLE (realised at receipt, ADR 0004 / docs/17 §D2 —
 *                   nothing was given away on the invoice)
 *   damage, expiry  credit notes with `reason = 'return_damaged'` plus `stock_ledger` rows with `reason
 *                   = 'damage' | 'expiry_writeoff'` into the damaged location, valued at the brand's
 *                   `damageValueBasis` / `expiryValueBasis` (PTD by default, from `tenant_product_costs`,
 *                   never MRP unless configured); `caseSize` is the LOT's own so a sheet reprints
 *                   "3 cs + 12 pcs" after the case size changes. Refused with 409 naming the brand when
 *                   the policy says `damageClaimable = false` / `expiryClaimable = false`
 *   shortage, rate_difference   `inbound_discrepancies` with `status = 'open'` and `kind in (short,
 *                   damaged, price_mismatch)` on GRNs of that supplier in the period
 *   other           manual lines only
 *
 * THE MONEY (brief §2 `submit` / `settlements.record` / `reject` / `writeOff`; integer paise, every entry
 * sums to zero, deterministic idempotency keys `claim:accrue:<claimId>`, `claim:settle:<settlementId>`,
 * `claim:reject:<claimId>`, `claim:writeoff:<claimId>`):
 *
 *   accrual at submit     scheme, rate_difference → Dr SCHEME_RECEIVABLE (party supplier) / Cr SCHEME_EXPENSE
 *                         damage, expiry, shortage, other → Dr CLAIMS_RECEIVABLE / Cr DAMAGES
 *   settlement            credit_note → Dr AP · bank_receipt → Dr BANK · cheque → Dr CHEQUES ·
 *                         goods_replacement → Dr PURCHASES (the linked GRN must have been posted from a
 *                         zero-value supplier invoice, else the stock is counted twice) · adjustment →
 *                         Dr AP — each / Cr the receivable
 *   reject / write-off    Dr the expense (SCHEME_EXPENSE or DAMAGES) / Cr the receivable
 *   brand_dms channel     NO JOURNAL ENTRY, EVER (Too Yumm on FieldAssist settles inside the brand's own
 *                         DMS — docs/17 A1, ADR 0014, never-list 5): the claim is tracked, numbered,
 *                         built and exported as a record, and `ageing` reports it in its own group and
 *                         outside `totals.outstandingPaise`
 *
 * Claims carry NO GST (commercial claims, not tax documents): a brand credit note with GST is booked in AP
 * by the accountant and only its taxable base matches the claim (brief §4.19). The claim sheet the brand is
 * sent is rendered by the worker from `claim_statements.payload` under the DISTRIBUTOR'S OWN name and logo
 * (`tenant_settings` branding keys, docs/17 §D6) — never "Distribution OS"; the file is reached through
 * `integrations.exports.downloadUrl(exportJobId)` or `files.readUrl(objectKey)`, never streamed here.
 *
 * Dates are IST business dates (`businessDate()`); `periodFrom` / `periodTo` are inclusive, a period is at
 * most `MAX_CLAIM_PERIOD_DAYS` wide; ageing days = days between the submit date and `asOf`. Ids are
 * client-generated UUIDv7: the URL's `{id}` is always the CLAIM, and the client id of a child row it
 * creates travels under its own name (`lineId`, `evidenceId`, `settlementId`, `statementId`) — the
 * `AddStopInput` / `AddPageInput` convention. Every list caps `limit` (200 for claims, 500 for lines, 50
 * for statements) and pages on `cursor` = the last row's id. Bounded work everywhere (docs/20): a build
 * stops at `MAX_CLAIM_BUILD_LINES` and says `truncated`, `periods.list` at 24 periods × brands ≤ 500 rows,
 * `reconcile.suggest` at the 20 most recent open claims and subsets of at most 3, `ageing` and `register`
 * aggregate over the small `claims` table only, never over `claim_lines`.
 *
 * ROUTES: `/claims/policies`, `/claims/periods`, `/claims/ageing`, `/claims/register` and
 * `/claims/reconcile` are static siblings of `GET /claims/{id}`. Fastify's router matches a static segment
 * before a parametric one, and the router below declares them first so the controller keeps the same order.
 */

const IsoDateSchema = z.iso.date()
const IsoDateTimeSchema = z.iso.datetime({ offset: true })
const CursorInput = {
  limit: QueryIntSchema.min(1).max(200).default(50),
  cursor: z.string().optional(),
}

/** A claim period (inclusive IST dates) is at most this wide — a quarter plus the slack of a late cut-off. */
export const MAX_CLAIM_PERIOD_DAYS = 400
/** `build` inserts at most this many lines per call and reports `truncated: true`; call again to continue. */
export const MAX_CLAIM_BUILD_LINES = 2_000
/** `claims.get` embeds the first page of lines; the rest come from `lines.list`. */
export const CLAIM_DETAIL_LINES = 200
/** `periods.list` walks at most this many periods back per brand. */
export const MAX_CLAIM_PERIODS = 24
/** `reconcile.suggest` considers the N most recent open claims of the supplier and subsets of at most M. */
export const RECONCILE_MAX_CLAIMS = 20
export const RECONCILE_MAX_SUBSET = 3
/** `register` window cap: a financial year plus a day (the same as an export window). */
export const MAX_CLAIM_REGISTER_WINDOW_DAYS = 366
/** `dueDate = submittedOn + settlementDays` when the brand's policy sets none. */
export const DEFAULT_CLAIM_SETTLEMENT_DAYS = 30
/** The `export_jobs.kind` claims registers on the single `exports.render` queue (coordination §3.5). */
export const CLAIM_SHEET_EXPORT_KIND = 'claim_sheet'
/** The claim sheet column set used when the brand's policy names none. */
export const DEFAULT_CLAIM_SHEET_FORMAT = 'generic_xlsx'

// ---------------------------------------------------------------------------------------------------------------
// enums

/** What is being recovered from the brand. `brandId` is required for `scheme`, `damage` and `expiry`. */
export const ClaimKindSchema = z.enum([
  'scheme',
  'damage',
  'expiry',
  'shortage',
  'rate_difference',
  'other',
])
export type ClaimKind = z.infer<typeof ClaimKindSchema>

/**
 * `draft` (no number, no journal) → `submitted` (numbered, accrued) → `acknowledged` (the brand's reference)
 * → `partially_settled` → `settled`. `rejected` (the brand refused; accrual reversed, sources freed),
 * `written_off` (the remainder accepted as a loss) and `cancelled` (a draft discarded) are terminal. A
 * rejected or written-off claim KEEPS its number; a cancelled draft never had one.
 */
export const ClaimStatusSchema = z.enum([
  'draft',
  'submitted',
  'acknowledged',
  'partially_settled',
  'settled',
  'rejected',
  'written_off',
  'cancelled',
])
export type ClaimStatus = z.infer<typeof ClaimStatusSchema>

/** Where a line came from; `manual` lines carry their own id as `sourceId`. A source is claimable exactly once. */
export const ClaimLineSourceTypeSchema = z.enum([
  'invoice',
  'credit_note',
  'stock_ledger',
  'inbound_discrepancy',
  'manual',
])
export type ClaimLineSourceType = z.infer<typeof ClaimLineSourceTypeSchema>

/** The sources `build` may read; the default set is implied by the claim's kind (header). */
export const ClaimBuildSourceSchema = z.enum([
  'invoice',
  'credit_note',
  'stock_ledger',
  'inbound_discrepancy',
])
export type ClaimBuildSource = z.infer<typeof ClaimBuildSourceSchema>

/**
 * `open` (draft) → `claimed` (at submit) → `settled` (fully covered by settlements). `rejected` = excluded
 * from this claim (out of window, adjusted out by the desk, or the whole claim rejected): its source is
 * free for a later claim. `written_off` = the claim was written off with this line unrecovered.
 */
export const ClaimLineStatusSchema = z.enum([
  'open',
  'claimed',
  'settled',
  'rejected',
  'written_off',
])
export type ClaimLineStatus = z.infer<typeof ClaimLineStatusSchema>

/**
 * What `ratePaise` on a line is: `ptd` / `landed_cost` from `tenant_product_costs` (purchase cost — the
 * reason this whole contract is back office), `mrp` only when a brand's policy says so, `invoice_rate`
 * for a rate-difference letter, `scheme_amount` for a reward claimed at the exact paise given away.
 */
export const ClaimValueBasisSchema = z.enum([
  'ptd',
  'landed_cost',
  'mrp',
  'invoice_rate',
  'scheme_amount',
])
export type ClaimValueBasis = z.infer<typeof ClaimValueBasisSchema>

/** How often a brand is claimed; `adhoc` brands get no computed periods, only what the desk opens. */
export const ClaimPeriodKindSchema = z.enum(['monthly', 'fortnightly', 'quarterly', 'adhoc'])
export type ClaimPeriodKind = z.infer<typeof ClaimPeriodKindSchema>

/**
 * How the brand paid. `credit_note` and `adjustment` land in AP (netted against what we owe the supplier),
 * `bank_receipt` in BANK, `cheque` in CHEQUES in hand, `goods_replacement` in PURCHASES against the GRN
 * of the replacement stock (`grnId` required).
 */
export const ClaimSettlementModeSchema = z.enum([
  'credit_note',
  'bank_receipt',
  'cheque',
  'goods_replacement',
  'adjustment',
])
export type ClaimSettlementMode = z.infer<typeof ClaimSettlementModeSchema>

export const ClaimEvidenceKindSchema = z.enum([
  'damage_photo',
  'claim_sheet',
  'brand_credit_note',
  'email',
  'other',
])
export type ClaimEvidenceKind = z.infer<typeof ClaimEvidenceKindSchema>

/** `supplier` for the money desk (who pays us), `brand` for the owner's graphs (who funds what). */
export const ClaimAgeingGroupBySchema = z.enum(['supplier', 'brand'])
export type ClaimAgeingGroupBy = z.infer<typeof ClaimAgeingGroupBySchema>

export const ClaimRegisterGroupBySchema = z.enum(['supplier', 'brand', 'kind', 'status', 'month'])
export type ClaimRegisterGroupBy = z.infer<typeof ClaimRegisterGroupBySchema>

/** A claim sheet column set: `reliance_xlsx`, `guru_kripa_xlsx`, `mom_foods_email`, `field_assist`, or the `generic_xlsx` fallback. */
export const ClaimSheetFormatSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9_]+$/, 'lowercase letters, digits and underscores')

// ---------------------------------------------------------------------------------------------------------------
// output shapes

/**
 * One brand's claim policy for this distributor: `return_policies` joined with `tenant_brands.claimChannel`.
 * A brand with no policy row is still listed (`id` null, every claim flag false, the channel from
 * `tenant_brands`) so the owner sees what is NOT yet configured.
 */
export const ClaimPolicySchema = z.object({
  /** Null until the owner saves a policy for the brand. */
  id: IdSchema.nullable(),
  brandId: IdSchema,
  brandName: z.string(),
  /** Who is claimed for this brand (a super-stockist may pay for a manufacturer's schemes). */
  claimSupplierId: IdSchema.nullable(),
  claimSupplierName: z.string().nullable(),
  damageClaimable: z.boolean(),
  expiryClaimable: z.boolean(),
  /** Days after which a source is too old to claim; null = no window. `min()` with the scheme's own. */
  claimWindowDays: z.number().int().nullable(),
  claimSheetFormat: z.string().nullable(),
  claimPeriodKind: ClaimPeriodKindSchema,
  /** Day of the month the period closes (1–28); null = the 1st. */
  claimCutoffDay: z.number().int().nullable(),
  /** Days the brand takes to settle; drives `dueDate` and the ageing buckets only. */
  settlementDays: z.number().int().nullable(),
  damageValueBasis: ClaimValueBasisSchema,
  expiryValueBasis: ClaimValueBasisSchema,
  claimChannel: ClaimChannelSchema,
  saleableReturnDays: z.number().int(),
  notes: z.string().nullable(),
})
export type ClaimPolicy = z.infer<typeof ClaimPolicySchema>

/** One brand × kind × period window `periods.list` computed, with what is already claimed for it. */
export const ClaimPeriodSchema = z.object({
  brandId: IdSchema,
  brandName: z.string(),
  /** The policy's `claimSupplierId`; null when the brand has no claim supplier configured yet. */
  supplierId: IdSchema.nullable(),
  supplierName: z.string().nullable(),
  kind: ClaimKindSchema,
  periodFrom: IsoDateSchema,
  periodTo: IsoDateSchema,
  /** The day the period closes for claiming (`claimCutoffDay` after `periodTo`). */
  cutoffDate: IsoDateSchema,
  /** A non-rejected, non-cancelled claim already covering exactly this window, if any. */
  existingClaimId: IdSchema.nullable(),
  existingStatus: ClaimStatusSchema.nullable(),
  /** Unclaimed sources in the window: a COUNT and a SUM, never the lines themselves. */
  estimatedSourceCount: z.number().int().nonnegative(),
  estimatedClaimablePaise: PaiseSchema,
})
export type ClaimPeriod = z.infer<typeof ClaimPeriodSchema>

/**
 * What `build` recorded about the source, so a sheet can print "INV/0042, 12 + 1 free" and the desk can see
 * why a line was rejected. Loose on purpose: the keys below are the ones every renderer may rely on.
 */
export const ClaimLineDetailSchema = z.looseObject({
  invoiceNo: z.string().optional(),
  creditNoteNo: z.string().optional(),
  ruleKind: z.string().optional(),
  rewardKind: z.string().optional(),
  appliedRule: AppliedRuleSchema.optional(),
  /** `stock_ledger` idempotency key or `inbound_discrepancies` reference behind a damage / shortage line. */
  ledgerRef: z.string().optional(),
  /** `out_of_window` (build), `excluded` (lines.adjust), `claim_rejected` (reject). */
  reason: z.string().optional(),
  note: z.string().optional(),
})
export type ClaimLineDetail = z.infer<typeof ClaimLineDetailSchema>

/** BACK OFFICE ONLY: `ratePaise` on a damage / expiry line is purchase cost (`basis = ptd | landed_cost`). */
export const ClaimLineSchema = z.object({
  id: IdSchema,
  claimId: IdSchema,
  lineNo: z.number().int(),
  status: ClaimLineStatusSchema,
  sourceType: ClaimLineSourceTypeSchema,
  sourceId: z.string(),
  schemeId: IdSchema.nullable(),
  retailerId: IdSchema.nullable(),
  variantId: IdSchema.nullable(),
  lotId: IdSchema.nullable(),
  batchNo: z.string().nullable(),
  expiryDate: IsoDateSchema.nullable(),
  mrpPaise: PaiseSchema.nullable(),
  qtyPcs: PiecesSchema,
  /** The lot's own case size for damage / expiry, the sell-side size for scheme lines (docs/17 A2, §B). */
  caseSize: z.number().int().positive().nullable(),
  ratePaise: PaiseSchema.nullable(),
  basis: ClaimValueBasisSchema.nullable(),
  amountPaise: PaiseSchema,
  settledPaise: PaiseSchema,
  detail: ClaimLineDetailSchema,
  createdAt: IsoDateTimeSchema,
})
export type ClaimLine = z.infer<typeof ClaimLineSchema>

export const ClaimEvidenceSchema = z.object({
  id: IdSchema,
  claimId: IdSchema,
  kind: ClaimEvidenceKindSchema,
  /** A docint document (`kind in claim_sheet | other | supplier_invoice`) of this tenant, or… */
  documentId: IdSchema.nullable(),
  /** …an object uploaded through `files.uploadUrl` (`domain: 'claim'`); read it with `files.readUrl`. */
  objectKey: z.string().nullable(),
  caption: z.string().nullable(),
  uploadedBy: IdSchema.nullable(),
  createdAt: IsoDateTimeSchema,
})
export type ClaimEvidence = z.infer<typeof ClaimEvidenceSchema>

/**
 * A claim sheet snapshot. `objectKey`, `rowCount` and `generatedAt` are null until the worker's
 * `claim_sheet` renderer has written the file; `ready = objectKey IS NOT NULL`. The bytes are reached
 * through `integrations.exports.downloadUrl(exportJobId)` or `files.readUrl(objectKey)`, never here.
 */
export const ClaimStatementSchema = z.object({
  id: IdSchema,
  claimId: IdSchema,
  format: z.string(),
  objectKey: z.string().nullable(),
  rowCount: z.number().int().nonnegative().nullable(),
  exportJobId: IdSchema.nullable(),
  generatedAt: IsoDateTimeSchema.nullable(),
  ready: z.boolean(),
})
export type ClaimStatement = z.infer<typeof ClaimStatementSchema>

export const ClaimSettlementSchema = z.object({
  id: IdSchema,
  claimId: IdSchema,
  settledOn: IsoDateSchema,
  amountPaise: PaiseSchema,
  mode: ClaimSettlementModeSchema,
  /** The brand's credit note number, the UTR, the cheque number. */
  externalRef: z.string().nullable(),
  documentId: IdSchema.nullable(),
  /** The GRN of the replacement stock (`goods_replacement`). */
  grnId: IdSchema.nullable(),
  /** Null for a `brand_dms` claim — no entry is ever posted for one. */
  journalEntryId: IdSchema.nullable(),
  note: z.string().nullable(),
  recordedBy: IdSchema.nullable(),
  createdAt: IsoDateTimeSchema,
})
export type ClaimSettlement = z.infer<typeof ClaimSettlementSchema>

/** The register row. `outstandingPaise = claimedPaise − settledPaise − writtenOffPaise`; `overdue` is computed, never stored. */
export const ClaimSummarySchema = z.object({
  id: IdSchema,
  /** From the CLAIM series at submit, never at draft. Kept on a rejected or written-off claim. */
  claimNo: z.string().nullable(),
  supplierId: IdSchema,
  supplierName: z.string(),
  brandId: IdSchema.nullable(),
  brandName: z.string().nullable(),
  kind: ClaimKindSchema,
  status: ClaimStatusSchema,
  /** Frozen at open from `tenant_brands.claimChannel`. `brand_dms` = tracked and exported, never journalled. */
  claimChannel: ClaimChannelSchema,
  periodFrom: IsoDateSchema,
  periodTo: IsoDateSchema,
  /** Σ `amountPaise` of the non-rejected lines; recomputed after every line mutation, never incremented. */
  claimedPaise: PaiseSchema,
  settledPaise: PaiseSchema,
  writtenOffPaise: PaiseSchema,
  outstandingPaise: PaiseSchema,
  lineCount: z.number().int().nonnegative(),
  /** The brand's own claim reference (from `acknowledge`) or the settlement reference. */
  externalRef: z.string().nullable(),
  submittedAt: IsoDateTimeSchema.nullable(),
  acknowledgedAt: IsoDateTimeSchema.nullable(),
  /** `submittedOn + settlementDays`; null on a draft. */
  dueDate: IsoDateSchema.nullable(),
  overdue: z.boolean(),
  settledAt: IsoDateTimeSchema.nullable(),
  rejectedAt: IsoDateTimeSchema.nullable(),
  rejectionReason: z.string().nullable(),
  /** When the accrual was posted; always null for a `brand_dms` claim. */
  accruedAt: IsoDateTimeSchema.nullable(),
  note: z.string().nullable(),
  createdBy: IdSchema.nullable(),
  submittedBy: IdSchema.nullable(),
  createdAt: IsoDateTimeSchema,
})
export type ClaimSummary = z.infer<typeof ClaimSummarySchema>

/** `lines` is the first `CLAIM_DETAIL_LINES`; `linesNextCursor` continues through `lines.list`. */
export const ClaimDetailSchema = ClaimSummarySchema.extend({
  lines: z.array(ClaimLineSchema),
  linesNextCursor: z.string().nullable(),
  evidence: z.array(ClaimEvidenceSchema),
  statements: z.array(ClaimStatementSchema),
  settlements: z.array(ClaimSettlementSchema),
  /** The brand's policy as it stands now (null for a claim with no brand). */
  policy: ClaimPolicySchema.nullable(),
})
export type ClaimDetail = z.infer<typeof ClaimDetailSchema>

const ClaimItemOutput = z.object({ item: ClaimDetailSchema })

/** Days since submit, against `asOf`. Coarser than the retailer buckets: brands settle in weeks, not days. */
export const ClaimAgeingBucketsSchema = z.object({
  b0_30: PaiseSchema,
  b31_60: PaiseSchema,
  b61_90: PaiseSchema,
  b90plus: PaiseSchema,
})
export type ClaimAgeingBuckets = z.infer<typeof ClaimAgeingBucketsSchema>

const claimAgeingFigures = {
  /** Open claims on OUR books (`dos` channel): submitted, acknowledged or partially settled. */
  outstandingPaise: PaiseSchema,
  /** Drafts not yet submitted — money identified but not yet asked for. */
  notSubmittedPaise: PaiseSchema,
  buckets: ClaimAgeingBucketsSchema,
  openClaims: z.number().int().nonnegative(),
}

export const ClaimAgeingTotalsSchema = z.object(claimAgeingFigures)
export type ClaimAgeingTotals = z.infer<typeof ClaimAgeingTotalsSchema>

/**
 * One supplier or brand. A `brand_dms` group is listed with its own figures but contributes NOTHING to
 * `totals.outstandingPaise` — those claims are not on our books (ADR 0014).
 */
export const ClaimAgeingGroupSchema = z.object({
  /** The supplier id or the brand id (`none` for a kind with no brand when grouped by brand). */
  key: z.string(),
  name: z.string(),
  claimChannel: ClaimChannelSchema,
  ...claimAgeingFigures,
  oldestSubmittedAt: IsoDateTimeSchema.nullable(),
  oldestClaimNo: z.string().nullable(),
})
export type ClaimAgeingGroup = z.infer<typeof ClaimAgeingGroupSchema>

const claimRegisterFigures = {
  claims: z.number().int().nonnegative(),
  claimedPaise: PaiseSchema,
  settledPaise: PaiseSchema,
  writtenOffPaise: PaiseSchema,
  outstandingPaise: PaiseSchema,
  /** `settledPaise / claimedPaise` in basis points; 0 when nothing was claimed. The owner's recovery graph. */
  recoveryBps: z.number().int().min(0).max(10_000),
}

export const ClaimRegisterTotalsSchema = z.object(claimRegisterFigures)
export type ClaimRegisterTotals = z.infer<typeof ClaimRegisterTotalsSchema>

/** `key` is the supplier / brand id, the kind, the status, or `YYYY-MM` of `periodTo` when grouped by month. */
export const ClaimRegisterRowSchema = z.object({
  key: z.string(),
  name: z.string(),
  ...claimRegisterFigures,
})
export type ClaimRegisterRow = z.infer<typeof ClaimRegisterRowSchema>

/** A set of open claims a brand payment could be settling; `differencePaise = totalPaise − amountPaise`. */
export const ClaimReconcileCandidateSchema = z.object({
  claimIds: z.array(IdSchema).min(1).max(RECONCILE_MAX_SUBSET),
  claimNos: z.array(z.string()).min(1).max(RECONCILE_MAX_SUBSET),
  /** Σ outstanding of the claims in the set. */
  totalPaise: PaiseSchema,
  differencePaise: PaiseSchema,
  exact: z.boolean(),
})
export type ClaimReconcileCandidate = z.infer<typeof ClaimReconcileCandidateSchema>

// ---------------------------------------------------------------------------------------------------------------
// inputs — policies and periods

export const ClaimPoliciesListInput = z.object({
  brandId: IdSchema.optional(),
  ...CursorInput,
})
export const ClaimPoliciesListOutput = z.object({
  items: z.array(ClaimPolicySchema),
  nextCursor: z.string().nullable(),
})

/**
 * Upserts the `return_policies` row for `(tenant, brand)` — `id` is the row's client id on first insert,
 * `brandId` the natural key. Owner only: it changes what money the business believes it can recover.
 * Audited (`claims.policy.upsert`, before / after). No state, no journal.
 */
export const UpsertClaimPolicyInput = MutationBase.extend({
  id: IdSchema,
  brandId: IdSchema,
  claimSupplierId: IdSchema.nullable().optional(),
  damageClaimable: z.boolean().default(false),
  expiryClaimable: z.boolean().default(false),
  claimWindowDays: z.number().int().min(1).max(365).nullable().optional(),
  claimSheetFormat: ClaimSheetFormatSchema.nullable().optional(),
  claimPeriodKind: ClaimPeriodKindSchema.default('monthly'),
  claimCutoffDay: z.number().int().min(1).max(28).nullable().optional(),
  settlementDays: z.number().int().min(1).max(180).nullable().optional(),
  damageValueBasis: ClaimValueBasisSchema.default('ptd'),
  expiryValueBasis: ClaimValueBasisSchema.default('ptd'),
  saleableReturnDays: z.number().int().min(0).max(365).optional(),
  notes: z.string().trim().max(400).nullable().optional(),
})
export const UpsertClaimPolicyOutput = z.object({ item: ClaimPolicySchema })

/**
 * Pure computation: each brand's `claimPeriodKind` / `claimCutoffDay` expanded backwards from today (IST)
 * for `periods` periods, left-joined with the claims that already cover each window, plus a cheap count of
 * unclaimed sources. Hard cap 24 periods × brands ≤ 500 rows. No writes.
 */
export const ClaimPeriodsListInput = z.object({
  brandId: IdSchema.optional(),
  supplierId: IdSchema.optional(),
  kind: ClaimKindSchema.optional(),
  periods: QueryIntSchema.min(1).max(MAX_CLAIM_PERIODS).default(6),
})
export const ClaimPeriodsListOutput = z.object({
  /** The IST business date the periods were expanded from. */
  asOf: IsoDateSchema,
  items: z.array(ClaimPeriodSchema).max(500),
})

// ---------------------------------------------------------------------------------------------------------------
// inputs — the claim

/**
 * A draft: no number, no journal, `claimChannel` frozen from `tenant_brands` (fallback `dos`). 409 when a
 * claim that is not rejected or cancelled already covers the same (supplier, brand, kind, periodFrom,
 * periodTo) — the partial unique index is the guarantee.
 */
export const OpenClaimInput = MutationBase.extend({
  id: IdSchema,
  supplierId: IdSchema,
  brandId: IdSchema.nullable().optional(),
  kind: ClaimKindSchema,
  periodFrom: IsoDateSchema,
  periodTo: IsoDateSchema,
  note: z.string().trim().max(400).nullable().optional(),
}).superRefine((c, ctx) => {
  if ((c.kind === 'scheme' || c.kind === 'damage' || c.kind === 'expiry') && !c.brandId) {
    ctx.addIssue({
      code: 'custom',
      path: ['brandId'],
      message: `brandId is required for a ${c.kind} claim`,
    })
  }
  const from = Date.parse(c.periodFrom)
  const to = Date.parse(c.periodTo)
  if (to < from) {
    ctx.addIssue({ code: 'custom', path: ['periodTo'], message: 'periodTo is before periodFrom' })
  } else if ((to - from) / 86_400_000 > MAX_CLAIM_PERIOD_DAYS) {
    ctx.addIssue({
      code: 'custom',
      path: ['periodTo'],
      message: `the period is longer than ${MAX_CLAIM_PERIOD_DAYS} days`,
    })
  }
})
export const OpenClaimOutput = ClaimItemOutput

/**
 * Draft only (409 otherwise). Re-runnable: existing lines are left alone, `open` lines whose source
 * disappeared are deleted, `claimedPaise` is recomputed. `sources` defaults to the set the kind implies.
 */
export const BuildClaimInput = MutationBase.extend({
  id: IdSchema,
  sources: z.array(ClaimBuildSourceSchema).min(1).max(4).optional(),
  limit: z.number().int().min(1).max(MAX_CLAIM_BUILD_LINES).default(MAX_CLAIM_BUILD_LINES),
})
export const BuildClaimOutput = z.object({
  item: ClaimDetailSchema,
  /** Lines inserted by this call (out-of-window ones included — they are inserted `rejected`). */
  added: z.number().int().nonnegative(),
  /** Sources already carried by a non-rejected line of any claim. */
  skipped: z.number().int().nonnegative(),
  /** Of `added`, the ones inserted `rejected` with `detail.reason = 'out_of_window'`. */
  outOfWindow: z.number().int().nonnegative(),
  /** `limit` was reached; call again with a fresh key to continue. */
  truncated: z.boolean(),
})

export const ClaimLinesListInput = z.object({
  /** The claim. */
  id: IdSchema,
  status: ClaimLineStatusSchema.optional(),
  sourceType: ClaimLineSourceTypeSchema.optional(),
  limit: QueryIntSchema.min(1).max(500).default(100),
  cursor: z.string().optional(),
})
export const ClaimLinesListOutput = z.object({
  items: z.array(ClaimLineSchema),
  nextCursor: z.string().nullable(),
})

/**
 * A manual line the sources cannot reconstruct (a brand's rate-difference letter, a negotiated damage lump
 * sum): `sourceType = 'manual'`, `sourceId = lineId`. Draft only. Recomputes `claimedPaise`. Audited.
 */
export const AddClaimLineInput = MutationBase.extend({
  /** The claim. */
  id: IdSchema,
  /** Client id of the new line. */
  lineId: IdSchema,
  variantId: IdSchema.nullable().optional(),
  retailerId: IdSchema.nullable().optional(),
  schemeId: IdSchema.nullable().optional(),
  qtyPcs: PiecesSchema.default(0),
  ratePaise: PaiseSchema.nonnegative().nullable().optional(),
  basis: ClaimValueBasisSchema.default('scheme_amount'),
  amountPaise: PaiseSchema.positive(),
  note: z.string().trim().max(200).nullable().optional(),
})
export const AddClaimLineOutput = z.object({ item: ClaimDetailSchema, line: ClaimLineSchema })

/**
 * The desk's review of a built line, draft only: change its money (`qtyPcs` / `ratePaise` / `amountPaise`
 * — `amountPaise` wins when given, else `qtyPcs × ratePaise`), or EXCLUDE it (`exclude: true` → `status =
 * 'rejected'`, `detail.reason = 'excluded'`; its source is free for a later claim), or bring an excluded /
 * out-of-window line back (`exclude: false` → `open`; 409 when its source was claimed elsewhere meanwhile).
 * Recomputes `claimedPaise`. Audited with the before image. 409 on a line with `settledPaise > 0`.
 */
export const AdjustClaimLineInput = MutationBase.extend({
  /** The claim. */
  id: IdSchema,
  lineId: IdSchema,
  qtyPcs: PiecesSchema.optional(),
  ratePaise: PaiseSchema.nonnegative().optional(),
  amountPaise: PaiseSchema.positive().optional(),
  exclude: z.boolean().optional(),
  reason: z.string().trim().max(200).optional(),
}).refine(
  (a) =>
    a.qtyPcs !== undefined ||
    a.ratePaise !== undefined ||
    a.amountPaise !== undefined ||
    a.exclude !== undefined,
  'nothing to adjust: give a quantity, a rate, an amount or exclude',
)
export const AdjustClaimLineOutput = z.object({ item: ClaimDetailSchema, line: ClaimLineSchema })

/** Hard delete from a DRAFT (`claim_lines` is not a ledger); 409 otherwise or when `settledPaise > 0`. Audited with the before image. */
export const RemoveClaimLineInput = MutationBase.extend({
  /** The claim. */
  id: IdSchema,
  lineId: IdSchema,
  reason: z.string().trim().max(200).optional(),
})
export const RemoveClaimLineOutput = ClaimItemOutput

/**
 * Exactly one of `documentId` (a docint document of this tenant, `kind in claim_sheet | other |
 * supplier_invoice`) or `objectKey` (uploaded through `files.uploadUrl`, `domain: 'claim'`, `entityId` =
 * the claim id). No bytes ever pass through the API (docs/20 rule 15). Any non-terminal status.
 */
export const AttachClaimEvidenceInput = MutationBase.extend({
  /** The claim. */
  id: IdSchema,
  /** Client id of the new evidence row. */
  evidenceId: IdSchema,
  documentId: IdSchema.optional(),
  objectKey: z.string().trim().min(1).max(400).optional(),
  kind: ClaimEvidenceKindSchema.default('other'),
  caption: z.string().trim().max(200).nullable().optional(),
}).refine(
  (e) => (e.documentId === undefined) !== (e.objectKey === undefined),
  'give exactly one of documentId or objectKey',
)
export const AttachClaimEvidenceOutput = z.object({
  item: ClaimDetailSchema,
  evidence: ClaimEvidenceSchema,
})

/** What `submit` and `statements.generate` snapshot: the claim sheet's client id and its column set. */
export const ClaimStatementRequestInput = z.object({
  /** Client id of the new `claim_statements` row. */
  id: IdSchema,
  /** Defaults to the brand's `claimSheetFormat`, else `generic_xlsx`. */
  format: ClaimSheetFormatSchema.optional(),
})

/**
 * `draft → submitted`: the number, the due date, the lines to `claimed`, the accrual (never for
 * `brand_dms`), the source discrepancies to `claimed`, the `ClaimSubmitted` event — and, with `statement`,
 * the claim sheet snapshot plus its `claim_sheet` export job in the same transaction. Idempotent replay
 * returns the stored response and allocates exactly one number. Audited.
 */
export const SubmitClaimInput = MutationBase.extend({
  id: IdSchema,
  /** Defaults to today (IST). `dueDate = submittedOn + settlementDays`. */
  submittedOn: IsoDateSchema.optional(),
  statement: ClaimStatementRequestInput.optional(),
})
export const SubmitClaimOutput = z.object({
  item: ClaimDetailSchema,
  /** Null when no `statement` was asked for. */
  statement: ClaimStatementSchema.nullable(),
  exportJobId: IdSchema.nullable(),
})

/** `submitted → acknowledged` with the brand's own claim reference. No journal, no event. */
export const AcknowledgeClaimInput = MutationBase.extend({
  id: IdSchema,
  externalRef: z.string().trim().min(1).max(60),
  acknowledgedOn: IsoDateSchema.optional(),
})
export const AcknowledgeClaimOutput = ClaimItemOutput

export const ClaimLineAllocationInput = z.object({
  claimLineId: IdSchema,
  amountPaise: PaiseSchema.positive(),
})

/**
 * The brand paid. 409 when `settledPaise + amountPaise + writtenOffPaise` would exceed `claimedPaise` (a
 * database check is the backstop). `lineAllocations`, when given, must sum to `amountPaise` and name each
 * line once; otherwise `allocate()` spreads it across `claimed` lines in `lineNo` order, never past a
 * line's `amountPaise`. Journal per `mode` (header); none for a `brand_dms` claim. Emits `ClaimSettled`. Audited.
 */
export const RecordClaimSettlementInput = MutationBase.extend({
  /** The claim. */
  id: IdSchema,
  /** Client id of the new settlement row. */
  settlementId: IdSchema,
  settledOn: IsoDateSchema,
  amountPaise: PaiseSchema.positive(),
  mode: ClaimSettlementModeSchema,
  /** The brand's credit note number, the UTR, the cheque number. Unique per claim when given. */
  externalRef: z.string().trim().min(1).max(60).nullable().optional(),
  documentId: IdSchema.nullable().optional(),
  /** Required for `goods_replacement`: the GRN of the replacement stock. */
  grnId: IdSchema.nullable().optional(),
  lineAllocations: z.array(ClaimLineAllocationInput).min(1).max(500).optional(),
  note: z.string().trim().max(200).nullable().optional(),
}).superRefine((s, ctx) => {
  if (s.mode === 'goods_replacement' && !s.grnId) {
    ctx.addIssue({
      code: 'custom',
      path: ['grnId'],
      message: 'grnId is required for a goods_replacement settlement',
    })
  }
  if (s.lineAllocations) {
    const sum = s.lineAllocations.reduce((acc, a) => acc + a.amountPaise, 0)
    if (sum !== s.amountPaise) {
      ctx.addIssue({
        code: 'custom',
        path: ['lineAllocations'],
        message: `line allocations sum to ${sum} paise, not the settlement's ${s.amountPaise}`,
      })
    }
    if (new Set(s.lineAllocations.map((a) => a.claimLineId)).size !== s.lineAllocations.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['lineAllocations'],
        message: 'a line is allocated twice',
      })
    }
  }
})
export const RecordClaimSettlementOutput = z.object({
  item: ClaimDetailSchema,
  settlement: ClaimSettlementSchema,
})

/**
 * `submitted | acknowledged → rejected`. The accrual is reversed by a NEW entry (`reversedByEntryId` set on
 * the original; nothing is deleted from the books); every non-settled line becomes `rejected` and its
 * source claimable again. 409 once any settlement exists. Emits `ClaimRejected`. Audited.
 */
export const RejectClaimInput = MutationBase.extend({
  id: IdSchema,
  reason: z.string().trim().min(1).max(400),
  rejectedOn: IsoDateSchema.optional(),
})
export const RejectClaimOutput = ClaimItemOutput

/**
 * `submitted | acknowledged | partially_settled → written_off` for the unrecovered remainder
 * `claimedPaise − settledPaise`; the remaining lines become `written_off`. Journal: Dr SCHEME_EXPENSE or
 * DAMAGES / Cr the receivable. Owner or accountant — accepting a loss is not the manager's call. Emits
 * `ClaimWrittenOff`. Audited.
 */
export const WriteOffClaimInput = MutationBase.extend({
  id: IdSchema,
  reason: z.string().trim().min(1).max(400),
  writtenOffOn: IsoDateSchema.optional(),
})
export const WriteOffClaimOutput = ClaimItemOutput

/** `draft → cancelled`: the lines are deleted, their sources freed; a draft has no number and no journal. Audited. */
export const CancelClaimInput = MutationBase.extend({
  id: IdSchema,
  reason: z.string().trim().min(1).max(200),
})
export const CancelClaimOutput = ClaimItemOutput

export const ClaimsListInput = z.object({
  status: ClaimStatusSchema.optional(),
  /** Several statuses in one call (bracket notation on the query string). */
  statuses: z.array(ClaimStatusSchema).max(8).optional(),
  /** On our side of the table still: submitted, acknowledged or partially settled. */
  openOnly: QueryBoolSchema.optional(),
  /** `openOnly` narrowed to `dueDate < today` (IST). */
  overdueOnly: QueryBoolSchema.optional(),
  kind: ClaimKindSchema.optional(),
  supplierId: IdSchema.optional(),
  brandId: IdSchema.optional(),
  claimChannel: ClaimChannelSchema.optional(),
  /** Claims whose period overlaps `periodFrom..periodTo`. */
  periodFrom: IsoDateSchema.optional(),
  periodTo: IsoDateSchema.optional(),
  /** Matches the claim number or the brand's reference. */
  q: z.string().trim().min(1).max(60).optional(),
  ...CursorInput,
})
export const ClaimsListOutput = z.object({
  items: z.array(ClaimSummarySchema),
  nextCursor: z.string().nullable(),
})

export const ClaimGetInput = z.object({ id: IdSchema })
export const ClaimGetOutput = ClaimItemOutput

// ---------------------------------------------------------------------------------------------------------------
// inputs — statements

/**
 * Snapshots the current lines in the brand's column set into `claim_statements.payload` and enqueues ONE
 * `export_jobs` row (`kind = 'claim_sheet'`, `params = { claimId, statementId, format }`) through
 * `IntegrationsService.enqueueExport`. Rendering never happens on the request path (docs/20 rule 3); the
 * worker fills `objectKey` / `rowCount` / `generatedAt`. Allowed in draft, submitted, acknowledged. Emits
 * `ClaimStatementRequested`.
 */
export const GenerateClaimStatementInput = MutationBase.extend({
  /** The claim. */
  id: IdSchema,
  /** Client id of the new `claim_statements` row. */
  statementId: IdSchema,
  format: ClaimSheetFormatSchema.optional(),
})
export const GenerateClaimStatementOutput = z.object({
  item: ClaimStatementSchema,
  exportJobId: IdSchema,
})

export const ClaimStatementsListInput = z.object({
  /** The claim. */
  id: IdSchema,
  limit: QueryIntSchema.min(1).max(50).default(20),
  cursor: z.string().optional(),
})
export const ClaimStatementsListOutput = z.object({
  items: z.array(ClaimStatementSchema),
  nextCursor: z.string().nullable(),
})

// ---------------------------------------------------------------------------------------------------------------
// inputs — ageing, the register, reconciliation

/**
 * Ageing of CLAIMS RECEIVABLE: outstanding per claim for `submitted | acknowledged | partially_settled`,
 * bucketed by days between the submit date (IST) and `asOf`; drafts land in `notSubmittedPaise`.
 * Aggregated over the small `claims` table only. `brand_dms` groups are listed and excluded from `totals`.
 */
export const ClaimAgeingInput = z.object({
  /** Defaults to today (IST). */
  asOf: IsoDateSchema.optional(),
  supplierId: IdSchema.optional(),
  brandId: IdSchema.optional(),
  kind: ClaimKindSchema.optional(),
  groupBy: ClaimAgeingGroupBySchema.default('supplier'),
  limit: QueryIntSchema.min(1).max(500).default(100),
})
export const ClaimAgeingOutput = z.object({
  asOf: IsoDateSchema,
  groupBy: ClaimAgeingGroupBySchema,
  /** `dos` channel only. */
  totals: ClaimAgeingTotalsSchema,
  groups: z.array(ClaimAgeingGroupSchema).max(500),
})

/**
 * The claims register, chart-ready for the owner (docs/22: graphs wherever possible — recovery by brand,
 * claims by month): every claim whose `periodTo` falls in `from..to` (cancelled ones excluded), grouped and
 * summed over the small `claims` table by ONE grouped query. Window ≤ `MAX_CLAIM_REGISTER_WINDOW_DAYS`.
 */
export const ClaimRegisterInput = z.object({
  from: IsoDateSchema,
  to: IsoDateSchema,
  groupBy: ClaimRegisterGroupBySchema.default('brand'),
  supplierId: IdSchema.optional(),
  brandId: IdSchema.optional(),
  kind: ClaimKindSchema.optional(),
  claimChannel: ClaimChannelSchema.optional(),
  limit: QueryIntSchema.min(1).max(500).default(100),
})
export const ClaimRegisterOutput = z.object({
  from: IsoDateSchema,
  to: IsoDateSchema,
  groupBy: ClaimRegisterGroupBySchema,
  /** Over every claim the filter matches, not the page. */
  totals: ClaimRegisterTotalsSchema,
  rows: z.array(ClaimRegisterRowSchema).max(500),
})

/**
 * The accountant keys the brand's credit note and gets which open claims it settles: exact single-claim
 * matches first, then subsets of at most `RECONCILE_MAX_SUBSET` claims within `tolerancePaise`, over at most
 * the `RECONCILE_MAX_CLAIMS` most recent open claims of the supplier. Read only — the desk then calls
 * `settlements.record`, once per claim.
 */
export const ClaimReconcileInput = z.object({
  supplierId: IdSchema,
  amountPaise: QueryIntSchema.positive(),
  tolerancePaise: QueryIntSchema.min(0).default(100),
  /** Only claims submitted inside this window. */
  fromDate: IsoDateSchema.optional(),
  toDate: IsoDateSchema.optional(),
})
export const ClaimReconcileOutput = z.object({
  /** How many open claims were considered (≤ `RECONCILE_MAX_CLAIMS`). */
  consideredClaims: z.number().int().nonnegative(),
  candidates: z.array(ClaimReconcileCandidateSchema).max(20),
})

// ---------------------------------------------------------------------------------------------------------------
// the router: mount as `claims: claimsContract` in contract.ts (owner-service and manager-service only)

export const claimsContract = {
  policies: {
    list: oc
      .route({
        method: 'GET',
        path: '/claims/policies',
        summary: "Every brand's claim policy for this distributor (unconfigured brands included)",
      })
      .input(ClaimPoliciesListInput)
      .output(ClaimPoliciesListOutput),
    upsert: oc
      .route({
        method: 'POST',
        path: '/claims/policies',
        summary:
          "Set a brand's claim policy: what is claimable, the cadence, the valuation (owner only)",
      })
      .input(UpsertClaimPolicyInput)
      .output(UpsertClaimPolicyOutput),
  },
  periods: {
    list: oc
      .route({
        method: 'GET',
        path: '/claims/periods',
        summary: 'Claim periods per brand: what is due, what is already claimed, what it is worth',
      })
      .input(ClaimPeriodsListInput)
      .output(ClaimPeriodsListOutput),
  },
  ageing: oc
    .route({
      method: 'GET',
      path: '/claims/ageing',
      summary: 'Ageing of claims receivable by supplier or brand (brand-DMS claims listed apart)',
    })
    .input(ClaimAgeingInput)
    .output(ClaimAgeingOutput),
  register: oc
    .route({
      method: 'GET',
      path: '/claims/register',
      summary: 'The claims register: claimed, settled, written off and recovery rate, grouped',
    })
    .input(ClaimRegisterInput)
    .output(ClaimRegisterOutput),
  reconcile: {
    suggest: oc
      .route({
        method: 'GET',
        path: '/claims/reconcile',
        summary: 'Which open claims a brand payment of this amount settles',
      })
      .input(ClaimReconcileInput)
      .output(ClaimReconcileOutput),
  },
  open: oc
    .route({
      method: 'POST',
      path: '/claims',
      summary: 'Open a draft claim on a supplier for a brand, kind and period',
    })
    .input(OpenClaimInput)
    .output(OpenClaimOutput),
  list: oc
    .route({ method: 'GET', path: '/claims', summary: 'Claims, newest first, with their money' })
    .input(ClaimsListInput)
    .output(ClaimsListOutput),
  get: oc
    .route({
      method: 'GET',
      path: '/claims/{id}',
      summary: 'One claim with its lines, evidence, statements, settlements and policy',
    })
    .input(ClaimGetInput)
    .output(ClaimGetOutput),
  build: oc
    .route({
      method: 'POST',
      path: '/claims/{id}/build',
      summary:
        'Reconstruct the lines of a draft from invoices, credit notes, the stock ledger and discrepancies',
    })
    .input(BuildClaimInput)
    .output(BuildClaimOutput),
  lines: {
    list: oc
      .route({
        method: 'GET',
        path: '/claims/{id}/lines',
        summary: 'The lines of a claim (back office: a damage line carries purchase cost)',
      })
      .input(ClaimLinesListInput)
      .output(ClaimLinesListOutput),
    add: oc
      .route({
        method: 'POST',
        path: '/claims/{id}/lines',
        summary: 'Add a manual line to a draft claim',
      })
      .input(AddClaimLineInput)
      .output(AddClaimLineOutput),
    adjust: oc
      .route({
        method: 'POST',
        path: '/claims/{id}/lines/{lineId}/adjust',
        summary: 'Review a built line: change its money, exclude it, or bring it back (draft only)',
      })
      .input(AdjustClaimLineInput)
      .output(AdjustClaimLineOutput),
    remove: oc
      .route({
        method: 'POST',
        path: '/claims/{id}/lines/{lineId}/remove',
        summary: 'Remove a line from a draft claim',
      })
      .input(RemoveClaimLineInput)
      .output(RemoveClaimLineOutput),
  },
  evidence: {
    attach: oc
      .route({
        method: 'POST',
        path: '/claims/{id}/evidence',
        summary:
          "Attach a damage photo, the brand's mail or credit note (an uploaded object or a document)",
      })
      .input(AttachClaimEvidenceInput)
      .output(AttachClaimEvidenceOutput),
  },
  submit: oc
    .route({
      method: 'POST',
      path: '/claims/{id}/submit',
      summary:
        'Submit: allocate the claim number, accrue the receivable and, optionally, queue the claim sheet',
    })
    .input(SubmitClaimInput)
    .output(SubmitClaimOutput),
  acknowledge: oc
    .route({
      method: 'POST',
      path: '/claims/{id}/acknowledge',
      summary: "Record the brand's acknowledgement and its claim reference",
    })
    .input(AcknowledgeClaimInput)
    .output(AcknowledgeClaimOutput),
  settlements: {
    record: oc
      .route({
        method: 'POST',
        path: '/claims/{id}/settlements',
        summary:
          "Record the brand's settlement: credit note, bank receipt, cheque, goods or adjustment",
      })
      .input(RecordClaimSettlementInput)
      .output(RecordClaimSettlementOutput),
  },
  reject: oc
    .route({
      method: 'POST',
      path: '/claims/{id}/reject',
      summary: 'The brand refused: reverse the accrual and free the sources',
    })
    .input(RejectClaimInput)
    .output(RejectClaimOutput),
  writeOff: oc
    .route({
      method: 'POST',
      path: '/claims/{id}/write-off',
      summary: 'Write off the unrecovered balance (owner or accountant)',
    })
    .input(WriteOffClaimInput)
    .output(WriteOffClaimOutput),
  cancel: oc
    .route({
      method: 'POST',
      path: '/claims/{id}/cancel',
      summary: 'Discard a draft claim (never a numbered one)',
    })
    .input(CancelClaimInput)
    .output(CancelClaimOutput),
  statements: {
    generate: oc
      .route({
        method: 'POST',
        path: '/claims/{id}/statements',
        summary:
          "Queue the claim sheet in the brand's format (rendered by the worker, never inline)",
      })
      .input(GenerateClaimStatementInput)
      .output(GenerateClaimStatementOutput),
    list: oc
      .route({
        method: 'GET',
        path: '/claims/{id}/statements',
        summary: 'Claim sheets requested for a claim and whether each is ready',
      })
      .input(ClaimStatementsListInput)
      .output(ClaimStatementsListOutput),
  },
}
