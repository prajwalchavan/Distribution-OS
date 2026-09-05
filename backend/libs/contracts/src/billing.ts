import { oc } from '@orpc/contract'
import { z } from 'zod'
import {
  BpsSchema,
  DocumentRenderOutput,
  GstinSchema,
  IdSchema,
  MutationBase,
  PaiseSchema,
  PiecesSchema,
  QueryBoolSchema,
  QueryIntSchema,
  StateCodeSchema,
} from './common.js'
import { EnteredUnitSchema, OrderStateSchema } from './orders.js'
import { AppliedRuleSchema } from './pricing.js'
import { InvoicePaymentStateSchema } from './receivables.js'
import { AddressSchema } from './retailers.js'
import { SellerBrandingSchema } from './tenancy.js'

/**
 * Billing — the tax document. It owns `invoices`, `invoice_lines`, `credit_notes`, `credit_note_lines`
 * and nothing else: every rupee it moves is posted through `ReceivablesService`, every piece it moves
 * through `InventoryService`, every order state through `OrdersService`. An issued invoice is immutable
 * (database triggers); a correction is a credit note, and a cancelled invoice keeps its number.
 *
 * WHICH SERVICES MOUNT `billing` (docs/plans/00-coordination.md §6 table):
 *
 *   owner :3001      YES — the whole surface: issue, cancel, credit notes, the registers
 *   manager :3002    YES — manager + accountant: the billing desk, credit notes, the registers
 *   sales :3003      YES — READ ONLY in practice. The rep's "pending bills" chip and the shop's bill on
 *                    the visit screen need `invoices.get/list/pdf` and `creditNotes.get/list`
 *                    (ANY_MEMBER). Every write and every register refuses the salesperson in
 *                    PERMISSIONS, so mounting the key exposes no money surface: a rep may see THAT a
 *                    bill exists for a shop it serves and never the registers, never a cost
 *   warehouse :3004  YES — the warehouse desk bills at pack and reads what it billed: `invoices.queue`,
 *                    `invoices.issueForPack` (a pack that was parked with `issueInvoice: false`),
 *                    `invoices.setEwayBill`, `invoices.get/list/pdf`. The document for a normal pack is
 *                    issued by `warehouse.packs.confirm` calling `BillingService.issueForPack`
 *                    (coordination §4 step 3); the warehouse may never cancel a bill
 *   delivery :3005   YES — the doorstep set: `invoices.issueVanSale`, the short-delivery credit note,
 *                    the bill and its UPI QR at the shop door
 *   retailer :3006   YES — its own bills only. RLS (`invoices_read` / `credit_notes_read` through the
 *                    denormalised `retailer_links.user_id`) narrows `get`/`list`/`pdf`/`upiQr` to the
 *                    shop; anything else is NOT_FOUND, never a leak. A shop writes nothing here
 *
 * FOUNDER ANSWERS (docs/17 §D) THAT SHAPE THIS FILE — they override the module brief:
 *
 *  1. The invoice series is PER-TENANT CONFIGURATION (§D1). Nothing here names `INV`, `V1` or a starting
 *     number: the number comes from the tenant's `numbering_series` row (prefix + starting_no), settable
 *     during onboarding and changeable until the first invoice is issued. No procedure takes a series
 *     code except `invoices.importBrandDms`, and there it is optional and means "the tenant's external
 *     series", because those numbers are printed by the brand's own system.
 *  2. Cash discount is REPORTED on the invoice and realised at receipt as a financial credit note (§D2).
 *     `cashDiscountBps` / `cashDiscountUntil` are printed on the bill; NOTHING is deducted from it, and
 *     there is deliberately no on-invoice discount input anywhere below.
 *  3. Shops ARE GST-registered (§D3), so the B2B tax invoice carrying the buyer's GSTIN is the PRIMARY
 *     document: `supplyType`, `buyerGstin` and `placeOfSupplyState` are first-class, and the registers
 *     are GSTR-1-shaped. The B2C path stays working for a small kirana with no GSTIN.
 *  4. A van sale uses the TENANT'S NORMAL SERIES (§D5) — no per-vehicle series and no device-allocated
 *     numbers. `invoices.source = 'van_sale'` is the only thing that distinguishes it, so the offline
 *     numbering complexity the brief described does not exist.
 *  5. The product is WHITE-LABELLED (§D6). Every document a shopkeeper sees carries the DISTRIBUTOR's own
 *     name and logo, never "Distribution OS": `InvoiceDetail.seller` and `CreditNoteDetail.seller` carry
 *     it. The block itself, `SellerBrandingSchema`, is declared in `tenancy.ts` (it is the tenant's
 *     identity, shared with the challan, the receipt and every app's chrome through
 *     `tenancy.branding.get`) and read from `TENANT_SETTING_KEYS` with `tenants.legal_name` as the
 *     fallback, which is also what the UPI QR's payee name is built from.
 *
 * Money is integer paise, quantities integer pieces, percentages basis points; `invoiceDate`/`noteDate`
 * and `fy` are IST (`businessDate()`, `financialYear()`); ids are client-generated UUIDv7. No output
 * shape in this file carries a purchase cost, landed cost, PTD or margin — an invoice never does.
 *
 * The e-invoice columns (`irn`, `ackNo`, `ackDate`, `signedQr`) stay on the schema, but generation is a
 * deterministic LOCAL STUB behind the existing `e_invoicing` feature flag: `invoices.requestIrn` never
 * calls an external service (see `IrnRequestOutput`).
 */

const IsoDateSchema = z.iso.date()
const IsoDateTimeSchema = z.iso.datetime({ offset: true })
/** The device that produced the document; stored for "which tab billed this" and offline dedupe. */
const DeviceIdSchema = z.string().trim().min(1).max(128)
const HsnCodeSchema = z.string().regex(/^\d{4,8}$/, 'HSN is 4 to 8 digits')
const CursorInput = {
  limit: QueryIntSchema.min(1).max(200).default(50),
  cursor: z.string().optional(),
}

// ---------------------------------------------------------------------------------------------------------------
// enums

/**
 * The invoice state. Receivables owns the derived payment part of it and writes the column directly
 * (coordination §3.2), so the enum is declared once, there, and re-used here rather than duplicated.
 */
export const InvoiceStateSchema = InvoicePaymentStateSchema
export type InvoiceState = z.infer<typeof InvoiceStateSchema>

/** `pack` is the normal sale, `van_sale` the doorstep one (same series, §D5), the last two are imports. */
export const InvoiceSourceSchema = z.enum(['pack', 'van_sale', 'brand_dms_import', 'import'])
export type InvoiceSource = z.infer<typeof InvoiceSourceSchema>

/** B2B when the shop is GST-registered and its GSTIN is on the bill — the primary case (§D3). */
export const SupplyTypeSchema = z.enum(['B2B', 'B2C'])
export type SupplyType = z.infer<typeof SupplyTypeSchema>

export const CreditNoteReasonSchema = z.enum([
  'short_delivery',
  'return_saleable',
  'return_damaged',
  'rate_difference',
  'scheme_settlement',
  'cancellation',
  'other',
])
export type CreditNoteReason = z.infer<typeof CreditNoteReasonSchema>

/** `applied` is set by receivables when the note has been allocated in full; billing never writes it. */
export const CreditNoteStateSchema = z.enum(['draft', 'issued', 'applied', 'cancelled'])
export type CreditNoteState = z.infer<typeof CreditNoteStateSchema>

/** Printed on the sheet. The GST rules want three copies of a goods invoice. */
export const InvoiceCopySchema = z.enum(['original', 'duplicate', 'triplicate'])
export const InvoiceFormatSchema = z.enum(['a4', 'thermal80'])

/** `skipped` = the tenant has e-invoicing off; `stubbed` = the local deterministic placeholder. */
export const IrnStatusSchema = z.enum(['skipped', 'stubbed', 'ready'])
export type IrnStatus = z.infer<typeof IrnStatusSchema>

/** How the GST summary is grouped: HSN-wise (GSTR-1 Table 12) or rate-wise (the owner's tax view). */
export const GstSummaryGroupBySchema = z.enum(['hsn', 'rate'])

// ---------------------------------------------------------------------------------------------------------------
// output shapes

// The distributor's own identity on every document (§D6) is `SellerBrandingSchema` from `./tenancy.js`
// — `InvoiceDetail.seller` and `CreditNoteDetail.seller` below use it; it is not declared here.

/**
 * One printed line. Everything except quantity and tax is copied verbatim from the order line: the
 * invoice never re-prices (ADR 0004). `caseSize` is sell-side and frozen at issue, `lotId`/`batchNo`/
 * `expiryDate`/`mrpPaise` come from the lot the pieces actually left, so one order line can become
 * several invoice lines.
 */
export const InvoiceLineSchema = z.object({
  id: IdSchema,
  lineNo: z.number().int(),
  orderLineId: IdSchema.nullable(),
  variantId: IdSchema,
  lotId: IdSchema.nullable(),
  description: z.string(),
  hsnCode: z.string(),
  batchNo: z.string().nullable(),
  expiryDate: z.string().nullable(),
  mrpPaise: PaiseSchema.nullable(),
  qtyPcs: PiecesSchema,
  /** Free goods print as quantity with no value: excluded from `taxablePaise`, counted in the HSN summary. */
  freeQtyPcs: PiecesSchema,
  /** What was typed and the pack size that applied, so "2 cs + 3 pcs" reprints for ever (docs/17 A3). */
  enteredQty: z.number().int().nullable(),
  enteredUnit: EnteredUnitSchema,
  packSizeAtEntry: z.number().int().nullable(),
  caseSize: z.number().int().nullable(),
  ratePaise: PaiseSchema,
  discountBps: BpsSchema,
  discountPaise: PaiseSchema,
  taxablePaise: PaiseSchema,
  gstBps: BpsSchema,
  cgstPaise: PaiseSchema,
  sgstPaise: PaiseSchema,
  igstPaise: PaiseSchema,
  cessBps: BpsSchema,
  cessPaise: PaiseSchema,
  lineTotalPaise: PaiseSchema,
  /** Which price rules made this rate — the claim source and the "why this price" answer. */
  appliedRules: z.array(AppliedRuleSchema),
})
export type InvoiceLine = z.infer<typeof InvoiceLineSchema>

/**
 * The invoice header. `invoiceNo` is null only while the row is a draft: the number is allocated from
 * the tenant's configured series inside the issuing transaction and never re-used, not even after
 * cancellation (GSTR-1 Table 13). Once `state <> 'draft'` the database refuses every change except
 * the payment state, the cancellation pair, and the document keys (PDF, IRN, e-way bill).
 */
export const InvoiceSchema = z.object({
  id: IdSchema,
  invoiceNo: z.string().nullable(),
  /** The tenant's own series code — configuration, never a constant in the code (§D1). */
  seriesCode: z.string(),
  fy: z.string(),
  invoiceDate: z.string(),
  orderId: IdSchema.nullable(),
  retailerId: IdSchema,
  source: InvoiceSourceSchema,
  /** The brand DMS's own number when `source = 'brand_dms_import'`; we never issue a second document. */
  externalInvoiceNo: z.string().nullable(),
  state: InvoiceStateSchema,
  supplyType: SupplyTypeSchema,
  sellerGstin: z.string().nullable(),
  buyerGstin: z.string().nullable(),
  buyerName: z.string(),
  buyerAddress: AddressSchema.nullable(),
  placeOfSupplyState: StateCodeSchema,
  buyerFssai: z.string().nullable(),
  sellerFssai: z.string().nullable(),
  isInterState: z.boolean(),
  subtotalPaise: PaiseSchema,
  discountPaise: PaiseSchema,
  taxablePaise: PaiseSchema,
  cgstPaise: PaiseSchema,
  sgstPaise: PaiseSchema,
  igstPaise: PaiseSchema,
  cessPaise: PaiseSchema,
  roundOffPaise: PaiseSchema,
  totalPaise: PaiseSchema,
  /** The offer printed on the bill. Nothing is deducted here; it is realised at receipt (§D2). */
  cashDiscountBps: BpsSchema,
  cashDiscountUntil: z.string().nullable(),
  dueDate: z.string().nullable(),
  irn: z.string().nullable(),
  ackNo: z.string().nullable(),
  ackDate: z.string().nullable(),
  signedQr: z.string().nullable(),
  ewayBillNo: z.string().nullable(),
  ewayBillValidUntil: z.string().nullable(),
  transportMode: z.string().nullable(),
  vehicleNo: z.string().nullable(),
  /** The UPI intent as it was printed. The live figure comes from `invoices.upiQr`. */
  upiQrPayload: z.string().nullable(),
  pdfObjectKey: z.string().nullable(),
  issuedBy: IdSchema.nullable(),
  issuedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  createdAt: z.string(),
})
export type Invoice = z.infer<typeof InvoiceSchema>

/** A credit note as it appears on the invoice it corrects. */
export const InvoiceCreditNoteRefSchema = z.object({
  id: IdSchema,
  creditNoteNo: z.string().nullable(),
  noteDate: z.string(),
  reason: CreditNoteReasonSchema,
  state: CreditNoteStateSchema,
  totalPaise: PaiseSchema,
})
export type InvoiceCreditNoteRef = z.infer<typeof InvoiceCreditNoteRefSchema>

/**
 * Everything the bill screen and the print template need in one call. `amountDuePaise` is
 * `ReceivablesService.invoiceOutstandingPaise()` — billing never derives it from its own tables.
 */
export const InvoiceDetailSchema = InvoiceSchema.extend({
  lines: z.array(InvoiceLineSchema),
  creditNotes: z.array(InvoiceCreditNoteRefSchema),
  amountDuePaise: PaiseSchema,
  seller: SellerBrandingSchema,
})
export type InvoiceDetail = z.infer<typeof InvoiceDetailSchema>

const InvoiceItemOutput = z.object({ item: InvoiceDetailSchema })

/** The register row: the manager's billing desk, the owner's register, the shop's "my bills" tab. */
export const InvoiceListItemSchema = z.object({
  id: IdSchema,
  invoiceNo: z.string().nullable(),
  externalInvoiceNo: z.string().nullable(),
  seriesCode: z.string(),
  fy: z.string(),
  invoiceDate: z.string(),
  source: InvoiceSourceSchema,
  state: InvoiceStateSchema,
  orderId: IdSchema.nullable(),
  retailerId: IdSchema,
  buyerName: z.string(),
  supplyType: SupplyTypeSchema,
  taxablePaise: PaiseSchema,
  cgstPaise: PaiseSchema,
  sgstPaise: PaiseSchema,
  igstPaise: PaiseSchema,
  cessPaise: PaiseSchema,
  roundOffPaise: PaiseSchema,
  totalPaise: PaiseSchema,
  dueDate: z.string().nullable(),
  amountDuePaise: PaiseSchema,
  hasIrn: z.boolean(),
  hasPdf: z.boolean(),
})
export type InvoiceListItem = z.infer<typeof InvoiceListItemSchema>

/** `qtyPcs`, `saleable`, the rate and the tax are frozen from the invoice line being corrected. */
export const CreditNoteLineSchema = z.object({
  id: IdSchema,
  invoiceLineId: IdSchema,
  /** Copied from the invoice line so the note prints the item without a second query. */
  variantId: IdSchema,
  description: z.string(),
  hsnCode: z.string(),
  qtyPcs: PiecesSchema,
  /** False sends the pieces to the damaged bin instead of back to saleable stock. */
  saleable: z.boolean(),
  ratePaise: PaiseSchema,
  taxablePaise: PaiseSchema,
  gstBps: BpsSchema,
  taxPaise: PaiseSchema,
  lineTotalPaise: PaiseSchema,
})
export type CreditNoteLine = z.infer<typeof CreditNoteLineSchema>

export const CreditNoteSchema = z.object({
  id: IdSchema,
  /** Null while draft; allocated from the tenant's configured credit-note series at issue. */
  creditNoteNo: z.string().nullable(),
  seriesCode: z.string(),
  fy: z.string(),
  noteDate: z.string(),
  invoiceId: IdSchema,
  invoiceNo: z.string().nullable(),
  retailerId: IdSchema,
  reason: CreditNoteReasonSchema,
  state: CreditNoteStateSchema,
  /** The doorstep record it was raised from, when the crew raised it at the shop. */
  deliveryId: IdSchema.nullable(),
  isInterState: z.boolean(),
  taxablePaise: PaiseSchema,
  cgstPaise: PaiseSchema,
  sgstPaise: PaiseSchema,
  igstPaise: PaiseSchema,
  cessPaise: PaiseSchema,
  roundOffPaise: PaiseSchema,
  totalPaise: PaiseSchema,
  irn: z.string().nullable(),
  /** The rendered note (`tenant/{tenantId}/documents/credit_note/{id}.pdf`), null until the worker has written it; open it with `files.readUrl`. */
  pdfObjectKey: z.string().nullable(),
  issuedBy: IdSchema.nullable(),
  issuedAt: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
})
export type CreditNote = z.infer<typeof CreditNoteSchema>

export const CreditNoteDetailSchema = CreditNoteSchema.extend({
  lines: z.array(CreditNoteLineSchema),
  seller: SellerBrandingSchema,
})
export type CreditNoteDetail = z.infer<typeof CreditNoteDetailSchema>

const CreditNoteItemOutput = z.object({ item: CreditNoteDetailSchema })

export const CreditNoteListItemSchema = z.object({
  id: IdSchema,
  creditNoteNo: z.string().nullable(),
  noteDate: z.string(),
  invoiceId: IdSchema,
  invoiceNo: z.string().nullable(),
  retailerId: IdSchema,
  reason: CreditNoteReasonSchema,
  state: CreditNoteStateSchema,
  taxablePaise: PaiseSchema,
  cgstPaise: PaiseSchema,
  sgstPaise: PaiseSchema,
  igstPaise: PaiseSchema,
  cessPaise: PaiseSchema,
  totalPaise: PaiseSchema,
})
export type CreditNoteListItem = z.infer<typeof CreditNoteListItemSchema>

// ---------------------------------------------------------------------------------------------------------------
// invoices — the billing queue

/** One order waiting to be billed. Carries no cost: the warehouse and the desk both read this list. */
export const BillingQueueItemSchema = z.object({
  orderId: IdSchema,
  orderNo: z.string().nullable(),
  retailerId: IdSchema,
  retailerName: z.string(),
  state: OrderStateSchema,
  lineCount: z.number().int(),
  orderTotalPaise: PaiseSchema,
  expectedDeliveryDate: z.string().nullable(),
  /** True when a draft invoice already exists for the order and only needs issuing. */
  hasDraftInvoice: z.boolean(),
})
export type BillingQueueItem = z.infer<typeof BillingQueueItemSchema>

export const BillingQueueInput = z.object({
  locationId: IdSchema.optional(),
  retailerId: IdSchema.optional(),
  ...CursorInput,
})
export const BillingQueueOutput = z.object({
  items: z.array(BillingQueueItemSchema),
  nextCursor: z.string().nullable(),
})

// ---------------------------------------------------------------------------------------------------------------
// invoices — issuing
//
// THERE IS NO `invoices.issue` PROCEDURE, AND ADDING ONE BACK WOULD BE A BUG.
//
// It existed as a temporary caller while the warehouse module did not, and was removed at coordination
// §4 step 3 together with `IssueInvoiceInput` / `IssueInvoiceOutput` / `IssueInvoiceLineInput` and its
// `PERMISSIONS` row. `warehouse.packs.confirm` now does the stock-and-state half — `postPick`,
// `recordPick`, `applyFulfilmentEvent('pack')` — and calls `BillingService.issueForPack()` in the same
// transaction. Two HTTP callers would post `sale` rows twice for one order; one caller is the guarantee.
//
// `invoices.issueForPack` BELOW IS NOT THAT PROCEDURE. It bills a pack that `packs.confirm` PARKED with
// `issueInvoice: false` (docs/23 §8.2): the stock has already left and the order is already `packed`, so
// the handler calls the SAME exported `BillingService.issueForPack(tx, pack)` for the document alone and
// never posts a piece of stock. A pack that already has a live invoice is 409 `already_invoiced`; a
// replay returns the stored response. One pack, one invoice, whichever of the two callers reached it.

/**
 * Bill a parked pack: the warehouse confirmed the cartons with `issueInvoice: false` (a shop whose
 * GSTIN was being checked, a bill the desk wanted to eyeball first) and the order sits in
 * `packs.list?invoiced=false` / `invoices.queue` with `hasDraftInvoice`. Quantities are the PACKED
 * quantities; `invoiceDate` defaults to today in IST and may not precede the pack date.
 */
export const IssueForPackInput = MutationBase.extend({
  /** Client-generated id of the invoice this call issues. */
  id: IdSchema,
  packId: IdSchema,
  invoiceDate: IsoDateSchema.optional(),
  deviceId: DeviceIdSchema.optional(),
})
export const IssueForPackOutput = InvoiceItemOutput

/**
 * A sale made off the van. Same tenant series as any other bill and no device-allocated number
 * (§D5): `source = 'van_sale'` is the whole difference. The pieces leave the vehicle location, so the
 * van being short is a 400, never a negative balance.
 */
export const IssueVanSaleInvoiceInput = MutationBase.extend({
  id: IdSchema,
  /** Must be a `van_sale` order fulfilled from `vehicleLocationId`. */
  orderId: IdSchema,
  vehicleLocationId: IdSchema,
  invoiceDate: IsoDateSchema.optional(),
  deviceId: DeviceIdSchema.optional(),
})
export const IssueVanSaleInvoiceOutput = InvoiceItemOutput

/** One line of a brand-DMS invoice, exactly as the brand's system printed it. */
export const BrandDmsInvoiceLineInput = z.object({
  id: IdSchema,
  variantId: IdSchema,
  description: z.string().trim().min(1).max(200),
  hsnCode: HsnCodeSchema,
  qtyPcs: PiecesSchema,
  freeQtyPcs: PiecesSchema.default(0),
  ratePaise: PaiseSchema.nonnegative(),
  discountPaise: PaiseSchema.nonnegative().default(0),
  gstBps: BpsSchema,
  cessBps: BpsSchema.default(0),
  batchNo: z.string().trim().max(40).optional(),
  expiryDate: IsoDateSchema.optional(),
  mrpPaise: PaiseSchema.nonnegative().optional(),
  enteredQty: z.number().int().positive().optional(),
  enteredUnit: EnteredUnitSchema.default('piece'),
  packSizeAtEntry: z.number().int().positive().optional(),
})

/**
 * The brand's DMS already issued the legal invoice (ADR 0014, docs/17 item 1), so we store it verbatim
 * and NEVER create a second one: `invoiceNo = externalInvoiceNo`, the tenant's own counter is not
 * touched, and no stock moves (the goods arrive on the brand's own documents, through the GRN). The AR
 * is posted normally, because the distributor still collects the money.
 */
export const ImportBrandDmsInvoiceInput = MutationBase.extend({
  id: IdSchema,
  orderId: IdSchema.optional(),
  retailerId: IdSchema,
  externalInvoiceNo: z.string().trim().min(1).max(32),
  /**
   * Omit to use the tenant's configured external series (`numbering_series.allocation_mode =
   * 'external'`). Never the normal invoice series, whose counter this call must not advance (§D1).
   */
  seriesCode: z.string().trim().min(1).max(8).optional(),
  invoiceDate: IsoDateSchema,
  buyerGstin: GstinSchema.optional(),
  placeOfSupplyState: StateCodeSchema,
  roundOffPaise: PaiseSchema.default(0),
  lines: z.array(BrandDmsInvoiceLineInput).min(1).max(200),
})
export const ImportBrandDmsInvoiceOutput = InvoiceItemOutput

/**
 * Cancellation before dispatch only (docs/17 item 26). The NUMBER SURVIVES — GSTR-1 Table 13 wants the
 * series visibly consecutive — the goods come back on compensating ledger rows and the money on a
 * reversing journal entry. Refused once the order has left, once any payment is allocated to the bill,
 * or once a credit note stands against it; after that the only correction is a credit note.
 */
export const CancelInvoiceInput = MutationBase.extend({
  id: IdSchema,
  reason: z.string().trim().min(1).max(200),
  /** Where the pieces go back; defaults to the order's fulfilment location. */
  restockLocationId: IdSchema.optional(),
  deviceId: DeviceIdSchema.optional(),
})
export const CancelInvoiceOutput = InvoiceItemOutput

// ---------------------------------------------------------------------------------------------------------------
// invoices — reading

export const InvoiceGetInput = z.object({ id: IdSchema })
export const InvoiceGetOutput = InvoiceItemOutput

export const InvoicesListInput = z.object({
  retailerId: IdSchema.optional(),
  orderId: IdSchema.optional(),
  state: InvoiceStateSchema.optional(),
  source: InvoiceSourceSchema.optional(),
  /** On `invoice_date`, IST calendar dates. */
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  /** Issued or partially paid — the shop's pending bills. */
  openOnly: QueryBoolSchema.optional(),
  /** Open and past its due date. */
  overdueOnly: QueryBoolSchema.optional(),
  /** Matches the invoice number, the external number or the buyer name. */
  q: z.string().trim().min(1).max(60).optional(),
  ...CursorInput,
})
export const InvoicesListOutput = z.object({
  items: z.array(InvoiceListItemSchema),
  nextCursor: z.string().nullable(),
})

/**
 * The QR for the amount STILL DUE, recomputed now — `invoices.upiQrPayload` is the snapshot printed on
 * the bill and goes stale the moment a rupee is paid. `payload` is null, never a fake VPA, when the
 * tenant has not set one. `payeeName` is the distributor's own display name (§D6).
 */
export const InvoiceUpiQrInput = z.object({ id: IdSchema })
export const InvoiceUpiQrOutput = z.object({
  payload: z.string().nullable(),
  amountPaise: PaiseSchema,
  vpa: z.string().nullable(),
  payeeName: z.string(),
  invoiceNo: z.string().nullable(),
})

/**
 * Never renders inline (scale rule 3, coordination §3.4). Until the renderer slice exists every call
 * answers `{ status: 'queued', objectKey: null, url: null }` and enqueues `documents.pdf.render`; that
 * is a normal state, not an error.
 */
export const InvoicePdfInput = z.object({
  id: IdSchema,
  copy: InvoiceCopySchema.default('original'),
  format: InvoiceFormatSchema.default('a4'),
})
export const InvoicePdfOutput = DocumentRenderOutput

// ---------------------------------------------------------------------------------------------------------------
// invoices — the two document keys that may still be written after issue

/**
 * Manual entry from the government portal until a GSP is integrated (docs/17 A8). Touches only the four
 * transport columns the immutability trigger permits; refused on a cancelled invoice.
 */
export const SetEwayBillInput = MutationBase.extend({
  id: IdSchema,
  ewayBillNo: z.string().regex(/^\d{12}$/, 'a 12-digit e-way bill number'),
  validUntil: IsoDateTimeSchema,
  transportMode: z.string().trim().max(20).optional(),
  vehicleNo: z.string().trim().max(16).optional(),
})
export const SetEwayBillOutput = InvoiceItemOutput

/**
 * LOCAL STUB, no external call, ever. With the `e_invoicing` feature flag off it writes nothing and
 * answers `skipped`. With it on it writes a deterministic placeholder — `irn` = the 64-hex sha256 of
 * `<sellerGstin>:<invoiceNo>:<fy>`, `ackNo` = `STUB` + 10 digits — and answers `stubbed`, so the print
 * layout and the integrations module can be built before a GSP contract exists.
 */
export const RequestIrnInput = MutationBase.extend({ id: IdSchema })
export const RequestIrnOutput = z.object({
  status: IrnStatusSchema,
  irn: z.string().nullable(),
  ackNo: z.string().nullable(),
  ackDate: z.string().nullable(),
  signedQr: z.string().nullable(),
  reason: z.string().nullable(),
})

// ---------------------------------------------------------------------------------------------------------------
// credit notes

/**
 * `qtyPcs` may never exceed the invoiced pieces less what earlier notes already credited (cumulatively).
 * `ratePaise` defaults to the invoice line's rate and may never exceed it — a `rate_difference` note
 * passes the DIFFERENCE per piece, never today's price.
 */
export const CreditNoteLineInput = z.object({
  id: IdSchema,
  invoiceLineId: IdSchema,
  qtyPcs: PiecesSchema.positive(),
  saleable: z.boolean().default(true),
  ratePaise: PaiseSchema.nonnegative().optional(),
})

/**
 * A draft correction against an issued (or partially paid, or paid) invoice, at the ORIGINAL rate and
 * the frozen tax of the line it corrects (ADR 0004). It moves no stock and posts no journal until it is
 * issued. `autoIssue` runs `issue` in the same transaction — the crew's one-tap doorstep short delivery.
 */
export const CreateCreditNoteInput = MutationBase.extend({
  id: IdSchema,
  invoiceId: IdSchema,
  reason: CreditNoteReasonSchema,
  noteDate: IsoDateSchema.optional(),
  /** The doorstep record this was raised from. */
  deliveryId: IdSchema.optional(),
  /** Where saleable returns go back; defaults to the invoice's fulfilment location, or the van at the door. */
  restockLocationId: IdSchema.optional(),
  note: z.string().trim().max(300).optional(),
  autoIssue: z.boolean().default(false),
  lines: z.array(CreditNoteLineInput).min(1).max(200),
})
export const CreateCreditNoteOutput = CreditNoteItemOutput

/**
 * Numbers the note from the tenant's configured credit-note series, posts the returned pieces back into
 * stock (nothing moves for a `rate_difference`, `scheme_settlement` or other purely financial note),
 * posts the reversing journal entry and allocates the note against the bill through receivables. The
 * invoice row itself is never edited — its payment state is receivables' to derive.
 */
export const IssueCreditNoteInput = MutationBase.extend({
  id: IdSchema,
  deviceId: DeviceIdSchema.optional(),
})
export const IssueCreditNoteOutput = CreditNoteItemOutput

/** Only a draft may be cancelled: an issued note is a tax document and is reversed by a debit note. */
export const CancelCreditNoteInput = MutationBase.extend({
  id: IdSchema,
  reason: z.string().trim().min(1).max(200),
})
export const CancelCreditNoteOutput = CreditNoteItemOutput

export const CreditNoteGetInput = z.object({ id: IdSchema })
export const CreditNoteGetOutput = CreditNoteItemOutput

export const CreditNotesListInput = z.object({
  invoiceId: IdSchema.optional(),
  retailerId: IdSchema.optional(),
  reason: CreditNoteReasonSchema.optional(),
  state: CreditNoteStateSchema.optional(),
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  ...CursorInput,
})
export const CreditNotesListOutput = z.object({
  items: z.array(CreditNoteListItemSchema),
  nextCursor: z.string().nullable(),
})

// ---------------------------------------------------------------------------------------------------------------
// registers
//
// These two are the HTTP face of `RegistersService`, the in-process surface reporting (slice 9) and
// claims (slice 7) consume (coordination §4). The GST arithmetic exists exactly once, here; reporting
// wraps it for `reporting.registers.gstSalesRegister` and integrations feeds the Tally sales voucher
// from `salesRegister` so the voucher and the register can never disagree. `RegistersService` also
// ships `schemeSpend`, `invoiceLinesForPeriod` and `creditNoteLinesForPeriod`, which claims needs and
// which have no HTTP face here.
//
// Both are computed by ONE grouped SQL query over a date window — never by loading a tenant's history.

/** `hsnCode` is null when the caller grouped by rate. Free pieces count in `qtyPcs`, not in the value. */
export const GstSummaryRowSchema = z.object({
  hsnCode: z.string().nullable(),
  gstBps: BpsSchema,
  cessBps: BpsSchema,
  qtyPcs: PiecesSchema,
  freeQtyPcs: PiecesSchema,
  taxablePaise: PaiseSchema,
  cgstPaise: PaiseSchema,
  sgstPaise: PaiseSchema,
  igstPaise: PaiseSchema,
  cessPaise: PaiseSchema,
  totalPaise: PaiseSchema,
  /** Distinct documents behind the row, so Table 12 ties back to the B2B table. */
  documentCount: z.number().int(),
})
export type GstSummaryRow = z.infer<typeof GstSummaryRowSchema>

export const GstSummaryTotalsSchema = z.object({
  qtyPcs: PiecesSchema,
  freeQtyPcs: PiecesSchema,
  taxablePaise: PaiseSchema,
  cgstPaise: PaiseSchema,
  sgstPaise: PaiseSchema,
  igstPaise: PaiseSchema,
  cessPaise: PaiseSchema,
  totalPaise: PaiseSchema,
  documentCount: z.number().int(),
})
export type GstSummaryTotals = z.infer<typeof GstSummaryTotalsSchema>

/**
 * GSTR-1-shaped. Issued invoices only — never a draft, never a cancelled one — inside the IST window;
 * credit notes are reported separately as their own rows and totals (they are subtracted by the filer,
 * not by us), so `rows` alone is the outward-supply value.
 */
export const GstSummaryInput = z.object({
  from: IsoDateSchema,
  to: IsoDateSchema,
  supplyType: SupplyTypeSchema.optional(),
  groupBy: GstSummaryGroupBySchema.default('hsn'),
})
export const GstSummaryOutput = z.object({
  from: z.string(),
  to: z.string(),
  supplyType: SupplyTypeSchema.nullable(),
  groupBy: GstSummaryGroupBySchema,
  rows: z.array(GstSummaryRowSchema),
  totals: GstSummaryTotalsSchema,
  creditNoteRows: z.array(GstSummaryRowSchema),
  creditNoteTotals: GstSummaryTotalsSchema,
})

/** Invoice-wise. A cancelled invoice is listed with its number and zero money, so the series reads consecutive. */
export const SalesRegisterRowSchema = z.object({
  id: IdSchema,
  invoiceNo: z.string().nullable(),
  externalInvoiceNo: z.string().nullable(),
  invoiceDate: z.string(),
  orderId: IdSchema.nullable(),
  retailerId: IdSchema,
  buyerName: z.string(),
  buyerGstin: z.string().nullable(),
  supplyType: SupplyTypeSchema,
  placeOfSupplyState: StateCodeSchema,
  isInterState: z.boolean(),
  taxablePaise: PaiseSchema,
  cgstPaise: PaiseSchema,
  sgstPaise: PaiseSchema,
  igstPaise: PaiseSchema,
  cessPaise: PaiseSchema,
  roundOffPaise: PaiseSchema,
  totalPaise: PaiseSchema,
  state: InvoiceStateSchema,
  source: InvoiceSourceSchema,
  /** The party ledger this posts to in Tally; null until the retailer is mapped. */
  tallyLedgerName: z.string().nullable(),
})
export type SalesRegisterRow = z.infer<typeof SalesRegisterRowSchema>

export const SalesRegisterInput = z.object({
  from: IsoDateSchema,
  to: IsoDateSchema,
  retailerId: IdSchema.optional(),
  source: InvoiceSourceSchema.optional(),
  /** Excludes cancelled invoices, which are otherwise listed at zero. */
  issuedOnly: QueryBoolSchema.optional(),
  limit: QueryIntSchema.min(1).max(200).default(100),
  cursor: z.string().optional(),
})
export const SalesRegisterOutput = z.object({
  items: z.array(SalesRegisterRowSchema),
  nextCursor: z.string().nullable(),
  totals: z.object({
    taxablePaise: PaiseSchema,
    cgstPaise: PaiseSchema,
    sgstPaise: PaiseSchema,
    igstPaise: PaiseSchema,
    cessPaise: PaiseSchema,
    totalPaise: PaiseSchema,
    invoiceCount: z.number().int(),
  }),
})

// ---------------------------------------------------------------------------------------------------------------
// the router: mount as `billing: billingContract` in contract.ts

export const billingContract = {
  invoices: {
    queue: oc
      .route({
        method: 'GET',
        path: '/billing/queue',
        summary: 'Orders waiting to be billed, oldest first',
      })
      .input(BillingQueueInput)
      .output(BillingQueueOutput),
    // No `issue` here: `warehouse.packs.confirm` is the caller for a normal pack (coordination §4 step 3);
    // `issueForPack` bills a pack that was PARKED and never posts stock (see the note above its input).
    issueForPack: oc
      .route({
        method: 'POST',
        path: '/warehouse/packs/{packId}/invoice',
        summary: 'Bill a pack that was confirmed without an invoice (stock has already left)',
      })
      .input(IssueForPackInput)
      .output(IssueForPackOutput),
    issueVanSale: oc
      .route({
        method: 'POST',
        path: '/invoices/van-sale',
        summary: 'Bill a sale off the van, from vehicle stock and the tenant series',
      })
      .input(IssueVanSaleInvoiceInput)
      .output(IssueVanSaleInvoiceOutput),
    importBrandDms: oc
      .route({
        method: 'POST',
        path: '/invoices/brand-dms',
        summary: "Store a brand DMS's own invoice verbatim; never a second legal document",
      })
      .input(ImportBrandDmsInvoiceInput)
      .output(ImportBrandDmsInvoiceOutput),
    cancel: oc
      .route({
        method: 'POST',
        path: '/invoices/{id}/cancel',
        summary: 'Cancel before dispatch, keeping the number; stock and money come back',
      })
      .input(CancelInvoiceInput)
      .output(CancelInvoiceOutput),
    get: oc
      .route({
        method: 'GET',
        path: '/invoices/{id}',
        summary: 'One bill with its lines, its credit notes and what is still due',
      })
      .input(InvoiceGetInput)
      .output(InvoiceGetOutput),
    list: oc
      .route({
        method: 'GET',
        path: '/invoices',
        summary: 'The sales register (a shop sees only its own bills)',
      })
      .input(InvoicesListInput)
      .output(InvoicesListOutput),
    upiQr: oc
      .route({
        method: 'GET',
        path: '/invoices/{id}/upi-qr',
        summary: 'UPI intent for the amount still due on this bill',
      })
      .input(InvoiceUpiQrInput)
      .output(InvoiceUpiQrOutput),
    pdf: oc
      .route({
        method: 'GET',
        path: '/invoices/{id}/pdf',
        summary: 'Pre-signed URL for the printed bill, or queue the render',
      })
      .input(InvoicePdfInput)
      .output(InvoicePdfOutput),
    setEwayBill: oc
      .route({
        method: 'POST',
        path: '/invoices/{id}/eway-bill',
        summary: 'Record the e-way bill number typed from the government portal',
      })
      .input(SetEwayBillInput)
      .output(SetEwayBillOutput),
    requestIrn: oc
      .route({
        method: 'POST',
        path: '/invoices/{id}/irn',
        summary: 'Local e-invoice stub behind the e_invoicing flag; never an external call',
      })
      .input(RequestIrnInput)
      .output(RequestIrnOutput),
  },
  creditNotes: {
    create: oc
      .route({
        method: 'POST',
        path: '/credit-notes',
        summary: 'Draft a credit note against an issued bill, at the original rate',
      })
      .input(CreateCreditNoteInput)
      .output(CreateCreditNoteOutput),
    issue: oc
      .route({
        method: 'POST',
        path: '/credit-notes/{id}/issue',
        summary: 'Number the note, restock the pieces and credit the shop',
      })
      .input(IssueCreditNoteInput)
      .output(IssueCreditNoteOutput),
    cancel: oc
      .route({
        method: 'POST',
        path: '/credit-notes/{id}/cancel',
        summary: 'Cancel a draft note (an issued one is reversed, not cancelled)',
      })
      .input(CancelCreditNoteInput)
      .output(CancelCreditNoteOutput),
    get: oc
      .route({
        method: 'GET',
        path: '/credit-notes/{id}',
        summary: 'One credit note with its lines',
      })
      .input(CreditNoteGetInput)
      .output(CreditNoteGetOutput),
    list: oc
      .route({
        method: 'GET',
        path: '/credit-notes',
        summary: 'Credit notes (a shop sees only its own)',
      })
      .input(CreditNotesListInput)
      .output(CreditNotesListOutput),
  },
  registers: {
    gstSummary: oc
      .route({
        method: 'GET',
        path: '/billing/gst-summary',
        summary: 'GSTR-1-shaped HSN or rate summary, credit notes reported separately',
      })
      .input(GstSummaryInput)
      .output(GstSummaryOutput),
    salesRegister: oc
      .route({
        method: 'GET',
        path: '/billing/sales-register',
        summary: 'Invoice-wise sales register with running totals',
      })
      .input(SalesRegisterInput)
      .output(SalesRegisterOutput),
  },
}
