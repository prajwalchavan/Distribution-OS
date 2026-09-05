import { sql } from 'drizzle-orm'
import {
  BACK_OFFICE_ROLES,
  bps,
  id,
  INBOUND_ROLES,
  paise,
  pieces,
  roleWritePolicies,
  staffReadPolicy,
  tenantRolePolicy,
  timestamps,
  tz,
} from './columns.js'
import {
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { productVariants } from './catalog.js'
import { locations, stockLots } from './inventory.js'
import { tenantRef } from './platform.js'
import { suppliers } from './tenant-catalog.js'
import { users } from './tenancy.js'

/**
 * Inbound side: PO (optional) → supplier invoice (from the docint pipeline or a brand-DMS export) → LR →
 * GRN with a blind gate count → stock ledger `grn` rows. Purchase rates are back-office only (same rule as
 * tenant_product_costs), so supplier_invoice_lines and grn_lines carry a role predicate.
 *
 * RLS (migration 0012): the priced documents (PO, supplier invoice and its lines) stay `BACK_OFFICE_ROLES`.
 * The unpriced paperwork of receiving — the GRN, its pieces-only lines, the lorry receipt and the
 * discrepancy — is read by every staff role and written by `INBOUND_ROLES` (the desk plus the floor
 * that counts). The old FOR ALL policies let a shopkeeper token read and write a GRN.
 */

export const purchaseOrderStatus = pgEnum('purchase_order_status', [
  'draft',
  'sent',
  'partially_received',
  'received',
  'cancelled',
])

export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: id(),
    tenantId: tenantRef(),
    poNo: text('po_no'),
    supplierId: text('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    status: purchaseOrderStatus('status').notNull().default('draft'),
    expectedOn: date('expected_on', { mode: 'string' }),
    lines: jsonb('lines')
      .$type<{ variantId: string; qtyPcs: number; ratePaise?: number }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    totalPaise: paise('total_paise'),
    createdBy: text('created_by').references(() => users.id),
    note: text('note'),
    ...timestamps,
  },
  (t) => [
    index('purchase_orders_supplier_idx').on(t.tenantId, t.supplierId, t.createdAt),
    tenantRolePolicy('purchase_orders_back_office', BACK_OFFICE_ROLES),
  ],
).enableRLS()

export const rateBasis = pgEnum('rate_basis', ['piece', 'case'])
export const supplierInvoiceSource = pgEnum('supplier_invoice_source', [
  'docint',
  'irn_pull',
  'brand_dms_import',
  'manual',
  'import',
])
export const supplierInvoiceStatus = pgEnum('supplier_invoice_status', [
  'extracted',
  'in_review',
  'approved',
  'received',
  'disputed',
  'cancelled',
])

/** The manufacturer's invoice as we understood it (after review). Never edited after `received`; disputes are separate rows. */
export const supplierInvoices = pgTable(
  'supplier_invoices',
  {
    id: id(),
    tenantId: tenantRef(),
    supplierId: text('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    purchaseOrderId: text('purchase_order_id').references(() => purchaseOrders.id),
    /** docint.documents id the extraction came from (plain id, docint is downstream). */
    documentId: text('document_id'),
    source: supplierInvoiceSource('source').notNull(),
    status: supplierInvoiceStatus('status').notNull().default('extracted'),
    invoiceNo: text('invoice_no').notNull(),
    invoiceDate: date('invoice_date', { mode: 'string' }).notNull(),
    irn: text('irn'),
    ackNo: text('ack_no'),
    ackDate: tz('ack_date'),
    /** Signed QR payload / e-invoice JSON when verified (R05). */
    eInvoiceVerified: jsonb('e_invoice_verified'),
    ewayBillNo: text('eway_bill_no'),
    supplierGstin: text('supplier_gstin'),
    placeOfSupplyState: text('place_of_supply_state'),
    subtotalPaise: paise('subtotal_paise').notNull().default(0),
    discountPaise: paise('discount_paise').notNull().default(0),
    cgstPaise: paise('cgst_paise').notNull().default(0),
    sgstPaise: paise('sgst_paise').notNull().default(0),
    igstPaise: paise('igst_paise').notNull().default(0),
    cessPaise: paise('cess_paise').notNull().default(0),
    freightPaise: paise('freight_paise').notNull().default(0),
    roundOffPaise: paise('round_off_paise').notNull().default(0),
    totalPaise: paise('total_paise').notNull().default(0),
    dueDate: date('due_date', { mode: 'string' }),
    approvedBy: text('approved_by').references(() => users.id),
    approvedAt: tz('approved_at'),
    /** `procurement.supplierInvoices.dispute` / `.cancel` (docs/23 §8.19): the statuses were unreachable before. */
    disputedAt: tz('disputed_at'),
    disputeReason: text('dispute_reason'),
    cancelledAt: tz('cancelled_at'),
    cancelReason: text('cancel_reason'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('supplier_invoices_no_idx').on(
      t.tenantId,
      t.supplierId,
      t.invoiceNo,
      t.invoiceDate,
    ),
    uniqueIndex('supplier_invoices_irn_idx')
      .on(t.tenantId, t.irn)
      .where(sql`irn IS NOT NULL`),
    index('supplier_invoices_status_idx').on(t.tenantId, t.status, t.invoiceDate),
    tenantRolePolicy('supplier_invoices_back_office', BACK_OFFICE_ROLES),
  ],
).enableRLS()

export const supplierInvoiceLines = pgTable(
  'supplier_invoice_lines',
  {
    id: id(),
    tenantId: tenantRef(),
    supplierInvoiceId: text('supplier_invoice_id')
      .notNull()
      .references(() => supplierInvoices.id),
    lineNo: integer('line_no').notNull(),
    /** Description exactly as printed; the match to a variant may still be pending review. */
    description: text('description').notNull(),
    supplierCode: text('supplier_code'),
    variantId: text('variant_id').references(() => productVariants.id),
    hsnCode: text('hsn_code'),
    batchNo: text('batch_no'),
    mfgDate: date('mfg_date', { mode: 'string' }),
    expiryDate: date('expiry_date', { mode: 'string' }),
    mrpPaise: paise('mrp_paise'),
    /** Quantity as printed (cases/pcs) and the derived pieces after pack config. */
    printedQty: integer('printed_qty').notNull(),
    printedUnit: text('printed_unit').notNull().default('pcs'),
    qtyPcs: pieces('qty_pcs').notNull(),
    freeQtyPcs: pieces('free_qty_pcs').notNull().default(0),
    /** Rate exactly as printed: per piece or per case of `basis_qty` pieces (docs/17 A4). */
    ratePaise: paise('rate_paise').notNull(),
    rateBasis: rateBasis('rate_basis').notNull().default('piece'),
    basisQty: integer('basis_qty').notNull().default(1),
    discountBps: bps('discount_bps').notNull().default(0),
    discountPaise: paise('discount_paise').notNull().default(0),
    gstBps: bps('gst_bps').notNull().default(0),
    cessBps: bps('cess_bps').notNull().default(0),
    taxablePaise: paise('taxable_paise').notNull().default(0),
    taxPaise: paise('tax_paise').notNull().default(0),
    lineTotalPaise: paise('line_total_paise').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index('supplier_invoice_lines_invoice_idx').on(t.tenantId, t.supplierInvoiceId, t.lineNo),
    tenantRolePolicy('supplier_invoice_lines_back_office', BACK_OFFICE_ROLES),
  ],
).enableRLS()

/** Transport receipt (LR / bilty) for a consignment — its own document type per the Aug decisions. */
export const lorryReceipts = pgTable(
  'lorry_receipts',
  {
    id: id(),
    tenantId: tenantRef(),
    supplierInvoiceId: text('supplier_invoice_id').references(() => supplierInvoices.id),
    lrNo: text('lr_no').notNull(),
    lrDate: date('lr_date', { mode: 'string' }),
    transporterName: text('transporter_name'),
    transporterGstin: text('transporter_gstin'),
    vehicleNo: text('vehicle_no'),
    packages: integer('packages'),
    freightPaise: paise('freight_paise'),
    documentId: text('document_id'),
    ...timestamps,
  },
  (t) => [
    index('lorry_receipts_invoice_idx').on(t.tenantId, t.supplierInvoiceId),
    staffReadPolicy('lorry_receipts_read'),
    ...roleWritePolicies('lorry_receipts_write', INBOUND_ROLES),
  ],
).enableRLS()

export const grnStatus = pgEnum('grn_status', ['counting', 'reconciled', 'posted', 'cancelled'])

/** Goods receipt: the blind gate count against the (already reviewed) supplier invoice; posting writes `grn` ledger rows. */
export const grns = pgTable(
  'grns',
  {
    id: id(),
    tenantId: tenantRef(),
    grnNo: text('grn_no'),
    supplierInvoiceId: text('supplier_invoice_id')
      .notNull()
      .references(() => supplierInvoices.id),
    locationId: text('location_id')
      .notNull()
      .references(() => locations.id),
    status: grnStatus('status').notNull().default('counting'),
    countedBy: text('counted_by').references(() => users.id),
    countedAt: tz('counted_at'),
    postedBy: text('posted_by').references(() => users.id),
    postedAt: tz('posted_at'),
    note: text('note'),
    ...timestamps,
  },
  (t) => [
    index('grns_invoice_idx').on(t.tenantId, t.supplierInvoiceId),
    index('grns_status_idx').on(t.tenantId, t.status),
    staffReadPolicy('grns_read'),
    ...roleWritePolicies('grns_write', INBOUND_ROLES),
  ],
).enableRLS()

/** No rates here: warehouse staff see pieces only. */
export const grnLines = pgTable(
  'grn_lines',
  {
    id: id(),
    tenantId: tenantRef(),
    grnId: text('grn_id')
      .notNull()
      .references(() => grns.id),
    supplierInvoiceLineId: text('supplier_invoice_line_id').references(
      () => supplierInvoiceLines.id,
    ),
    variantId: text('variant_id')
      .notNull()
      .references(() => productVariants.id),
    lotId: text('lot_id').references(() => stockLots.id),
    expectedQtyPcs: pieces('expected_qty_pcs').notNull(),
    countedQtyPcs: pieces('counted_qty_pcs'),
    damagedQtyPcs: pieces('damaged_qty_pcs').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index('grn_lines_grn_idx').on(t.tenantId, t.grnId),
    staffReadPolicy('grn_lines_read'),
    ...roleWritePolicies('grn_lines_write', INBOUND_ROLES),
  ],
).enableRLS()

export const discrepancyKind = pgEnum('discrepancy_kind', [
  'short',
  'excess',
  'damaged',
  'wrong_item',
  'price_mismatch',
  'expiry_near',
])
export const discrepancyStatus = pgEnum('discrepancy_status', [
  'open',
  'claimed',
  'credited',
  'accepted',
  'written_off',
])

/** Count vs invoice differences; feeds supplier claims and the damage bin. */
export const inboundDiscrepancies = pgTable(
  'inbound_discrepancies',
  {
    id: id(),
    tenantId: tenantRef(),
    grnId: text('grn_id')
      .notNull()
      .references(() => grns.id),
    grnLineId: text('grn_line_id').references(() => grnLines.id),
    kind: discrepancyKind('kind').notNull(),
    qtyPcs: pieces('qty_pcs').notNull().default(0),
    amountPaise: paise('amount_paise'),
    status: discrepancyStatus('status').notNull().default('open'),
    evidenceDocumentIds: jsonb('evidence_document_ids')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    note: text('note'),
    /** `procurement.discrepancies.resolve` (docs/23 §8.19): who closed it as accepted / written off. */
    resolvedBy: text('resolved_by').references(() => users.id),
    resolvedAt: tz('resolved_at'),
    ...timestamps,
  },
  (t) => [
    index('inbound_discrepancies_status_idx').on(t.tenantId, t.status),
    staffReadPolicy('inbound_discrepancies_read'),
    ...roleWritePolicies('inbound_discrepancies_write', INBOUND_ROLES),
  ],
).enableRLS()
