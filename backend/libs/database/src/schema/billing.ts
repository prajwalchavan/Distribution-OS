import { sql } from 'drizzle-orm'
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import {
  bps,
  id,
  paise,
  pieces,
  staffWritePolicy,
  tenantOrOwnRetailerPolicy,
  timestamps,
  tz,
} from './columns.js'
import { productVariants } from './catalog.js'
import { stockLots } from './inventory.js'
import { type AppliedRule, enteredUnit, salesOrders } from './orders.js'
import { tenantRef } from './platform.js'
import { retailers } from './retailers.js'
import { appRw } from './roles.js'
import { users } from './tenancy.js'

/**
 * An issued GST invoice is immutable (§4.4). Payment state lives in receivables (allocations), never here;
 * `state` is a derived cache maintained by the receivables service. Corrections are credit notes.
 */

export const invoiceState = pgEnum('invoice_state', [
  'draft',
  'issued',
  'partially_paid',
  'paid',
  'written_off',
  'cancelled',
])
export const invoiceSource = pgEnum('invoice_source', [
  'pack',
  'van_sale',
  'brand_dms_import',
  'import',
])
export const supplyType = pgEnum('supply_type', ['B2B', 'B2C'])

export const invoices = pgTable(
  'invoices',
  {
    id: id(),
    tenantId: tenantRef(),
    /** Series + FY number from numbering_series, e.g. GL/1686; <= 16 chars, IRN-ready (ADR 0001). */
    invoiceNo: text('invoice_no'),
    seriesCode: text('series_code').notNull().default('INV'),
    fy: text('fy').notNull(),
    invoiceDate: date('invoice_date', { mode: 'string' }).notNull(),
    orderId: text('order_id').references(() => salesOrders.id),
    retailerId: text('retailer_id')
      .notNull()
      .references(() => retailers.id),
    source: invoiceSource('source').notNull().default('pack'),
    /** Brand-DMS invoice number when source = brand_dms_import — we never issue a second legal invoice. */
    externalInvoiceNo: text('external_invoice_no'),
    state: invoiceState('state').notNull().default('draft'),
    supplyType: supplyType('supply_type').notNull().default('B2C'),
    sellerGstin: text('seller_gstin'),
    buyerGstin: text('buyer_gstin'),
    buyerName: text('buyer_name').notNull(),
    buyerAddress: jsonb('buyer_address'),
    placeOfSupplyState: text('place_of_supply_state').notNull(),
    /** Snapshot of the retailer's FSSAI licence for food invoices. */
    buyerFssai: text('buyer_fssai'),
    sellerFssai: text('seller_fssai'),
    isInterState: boolean('is_inter_state').notNull().default(false),
    subtotalPaise: paise('subtotal_paise').notNull().default(0),
    discountPaise: paise('discount_paise').notNull().default(0),
    taxablePaise: paise('taxable_paise').notNull().default(0),
    cgstPaise: paise('cgst_paise').notNull().default(0),
    sgstPaise: paise('sgst_paise').notNull().default(0),
    igstPaise: paise('igst_paise').notNull().default(0),
    cessPaise: paise('cess_paise').notNull().default(0),
    roundOffPaise: paise('round_off_paise').notNull().default(0),
    totalPaise: paise('total_paise').notNull().default(0),
    /** Cash-discount offer printed on the bill; realised only at receipt within the window (ADR 0004). */
    cashDiscountBps: bps('cash_discount_bps').notNull().default(0),
    cashDiscountUntil: date('cash_discount_until', { mode: 'string' }),
    dueDate: date('due_date', { mode: 'string' }),
    /** e-invoice fields (populated only if the tenant crosses the threshold). */
    irn: text('irn'),
    ackNo: text('ack_no'),
    ackDate: tz('ack_date'),
    signedQr: text('signed_qr'),
    ewayBillNo: text('eway_bill_no'),
    ewayBillValidUntil: tz('eway_bill_valid_until'),
    transportMode: text('transport_mode'),
    vehicleNo: text('vehicle_no'),
    /** UPI intent payload printed as a QR on the bill (pa, pn, am, tr). */
    upiQrPayload: text('upi_qr_payload'),
    pdfObjectKey: text('pdf_object_key'),
    issuedBy: text('issued_by').references(() => users.id),
    issuedAt: tz('issued_at'),
    cancelledAt: tz('cancelled_at'),
    cancelReason: text('cancel_reason'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('invoices_no_idx')
      .on(t.tenantId, t.seriesCode, t.fy, t.invoiceNo)
      .where(sql`invoice_no IS NOT NULL`),
    index('invoices_retailer_idx').on(t.tenantId, t.retailerId, t.invoiceDate),
    index('invoices_order_idx').on(t.tenantId, t.orderId),
    index('invoices_state_idx').on(t.tenantId, t.state, t.dueDate),
    /**
     * One LIVE invoice per order. A cancelled invoice keeps its number (ADR 0001) and drops out of the
     * predicate, so the order can be billed again; `invoices_order_idx` stays for lookups that want the
     * cancelled ones too (docs/plans/00-coordination.md §5.4).
     */
    uniqueIndex('invoices_order_active_idx')
      .on(t.tenantId, t.orderId)
      .where(sql`order_id IS NOT NULL AND state <> 'cancelled'`),
    /** A brand-DMS invoice can never be imported twice (docs/17 item 1). */
    uniqueIndex('invoices_external_no_idx')
      .on(t.tenantId, t.externalInvoiceNo)
      .where(sql`external_invoice_no IS NOT NULL`),
    /** Register filters and the per-source Tally split (van_sale vs pack vs brand_dms_import). */
    index('invoices_source_date_idx').on(t.tenantId, t.source, t.invoiceDate),
    tenantOrOwnRetailerPolicy('invoices_read', 'retailer_id'),
    ...staffWritePolicy('invoices_write'),
  ],
).enableRLS()

export const invoiceLines = pgTable(
  'invoice_lines',
  {
    id: id(),
    tenantId: tenantRef(),
    invoiceId: text('invoice_id')
      .notNull()
      .references(() => invoices.id),
    lineNo: integer('line_no').notNull(),
    orderLineId: text('order_line_id'),
    variantId: text('variant_id')
      .notNull()
      .references(() => productVariants.id),
    lotId: text('lot_id').references(() => stockLots.id),
    description: text('description').notNull(),
    hsnCode: text('hsn_code').notNull(),
    batchNo: text('batch_no'),
    expiryDate: date('expiry_date', { mode: 'string' }),
    mrpPaise: paise('mrp_paise'),
    qtyPcs: pieces('qty_pcs').notNull(),
    freeQtyPcs: pieces('free_qty_pcs').notNull().default(0),
    /** As entered and the pack size that applied, frozen so "2 cs + 3 pcs" reprints after a case-size change (docs/17 A3). */
    enteredQty: integer('entered_qty'),
    enteredUnit: enteredUnit('entered_unit').notNull().default('piece'),
    packSizeAtEntry: integer('pack_size_at_entry'),
    /** Display: cases + loose derived from case size at issue time, frozen on the bill. */
    caseSize: integer('case_size'),
    ratePaise: paise('rate_paise').notNull(),
    discountBps: bps('discount_bps').notNull().default(0),
    discountPaise: paise('discount_paise').notNull().default(0),
    taxablePaise: paise('taxable_paise').notNull(),
    gstBps: bps('gst_bps').notNull(),
    cgstPaise: paise('cgst_paise').notNull().default(0),
    sgstPaise: paise('sgst_paise').notNull().default(0),
    igstPaise: paise('igst_paise').notNull().default(0),
    cessBps: bps('cess_bps').notNull().default(0),
    cessPaise: paise('cess_paise').notNull().default(0),
    lineTotalPaise: paise('line_total_paise').notNull(),
    appliedRules: jsonb('applied_rules')
      .$type<AppliedRule[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    ...timestamps,
  },
  (t) => [
    index('invoice_lines_invoice_idx').on(t.tenantId, t.invoiceId, t.lineNo),
    pgPolicy('invoice_lines_read', {
      for: 'select',
      to: appRw,
      using: sql`tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        (SELECT current_setting('app.actor_role', true)) <> 'retailer'
        OR EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_lines.invoice_id)
      )`,
    }),
    ...staffWritePolicy('invoice_lines_write'),
  ],
).enableRLS()

export const creditNoteReason = pgEnum('credit_note_reason', [
  'short_delivery',
  'return_saleable',
  'return_damaged',
  'rate_difference',
  'scheme_settlement',
  'cancellation',
  'other',
])
export const creditNoteState = pgEnum('credit_note_state', [
  'draft',
  'issued',
  'applied',
  'cancelled',
])

/** Reverses part of an issued invoice at the original rate; posts stock back where applicable. */
export const creditNotes = pgTable(
  'credit_notes',
  {
    id: id(),
    tenantId: tenantRef(),
    creditNoteNo: text('credit_note_no'),
    seriesCode: text('series_code').notNull().default('CN'),
    fy: text('fy').notNull(),
    noteDate: date('note_date', { mode: 'string' }).notNull(),
    invoiceId: text('invoice_id')
      .notNull()
      .references(() => invoices.id),
    retailerId: text('retailer_id')
      .notNull()
      .references(() => retailers.id),
    reason: creditNoteReason('reason').notNull(),
    state: creditNoteState('state').notNull().default('draft'),
    /** delivery.deliveries id when raised at the doorstep (plain id). */
    deliveryId: text('delivery_id'),
    taxablePaise: paise('taxable_paise').notNull().default(0),
    cgstPaise: paise('cgst_paise').notNull().default(0),
    sgstPaise: paise('sgst_paise').notNull().default(0),
    igstPaise: paise('igst_paise').notNull().default(0),
    cessPaise: paise('cess_paise').notNull().default(0),
    roundOffPaise: paise('round_off_paise').notNull().default(0),
    totalPaise: paise('total_paise').notNull().default(0),
    irn: text('irn'),
    issuedBy: text('issued_by').references(() => users.id),
    issuedAt: tz('issued_at'),
    note: text('note'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('credit_notes_no_idx')
      .on(t.tenantId, t.seriesCode, t.fy, t.creditNoteNo)
      .where(sql`credit_note_no IS NOT NULL`),
    index('credit_notes_invoice_idx').on(t.tenantId, t.invoiceId),
    /** The retailer's credits tab and the ageing recompute, which walk credits by party and date. */
    index('credit_notes_retailer_idx').on(t.tenantId, t.retailerId, t.noteDate),
    tenantOrOwnRetailerPolicy('credit_notes_read', 'retailer_id'),
    ...staffWritePolicy('credit_notes_write'),
  ],
).enableRLS()

export const creditNoteLines = pgTable(
  'credit_note_lines',
  {
    id: id(),
    tenantId: tenantRef(),
    creditNoteId: text('credit_note_id')
      .notNull()
      .references(() => creditNotes.id),
    invoiceLineId: text('invoice_line_id')
      .notNull()
      .references(() => invoiceLines.id),
    qtyPcs: pieces('qty_pcs').notNull(),
    /** Whether returned pieces go back to saleable stock or the damaged bin. */
    saleable: boolean('saleable').notNull().default(true),
    ratePaise: paise('rate_paise').notNull(),
    taxablePaise: paise('taxable_paise').notNull(),
    gstBps: bps('gst_bps').notNull(),
    taxPaise: paise('tax_paise').notNull(),
    lineTotalPaise: paise('line_total_paise').notNull(),
    ...timestamps,
  },
  (t) => [
    index('credit_note_lines_note_idx').on(t.tenantId, t.creditNoteId),
    pgPolicy('credit_note_lines_read', {
      for: 'select',
      to: appRw,
      using: sql`tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        (SELECT current_setting('app.actor_role', true)) <> 'retailer'
        OR EXISTS (SELECT 1 FROM credit_notes c WHERE c.id = credit_note_lines.credit_note_id)
      )`,
    }),
    ...staffWritePolicy('credit_note_lines_write'),
  ],
).enableRLS()
