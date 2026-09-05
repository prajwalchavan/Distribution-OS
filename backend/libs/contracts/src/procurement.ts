import { oc } from '@orpc/contract'
import { z } from 'zod'
import {
  BpsSchema,
  IdSchema,
  MutationBase,
  PaiseSchema,
  PiecesSchema,
  QueryIntSchema,
} from './common.js'

/**
 * Procurement: supplier invoice (already reviewed by docint or typed for a small supplier) → GRN with a blind
 * gate count → posting writes `grn` stock-ledger rows and per-lot purchase cost. Supplier invoices and purchase
 * orders carry rates and are back-office only (RLS + guard). GRN shapes carry pieces only: warehouse staff
 * count without ever seeing a rate.
 *
 * WHICH SERVICES MOUNT `procurement`: owner, manager, warehouse. The desk (`supplierInvoices.*`,
 * `grns.open/post`, `purchaseOrders.*`, `supplierInvoices.dispute/cancel`) is BACK_OFFICE; resolving a
 * gate-count discrepancy (`discrepancies.resolve`) sits in the owner's approvals queue (docs/23 O3 "GRN
 * exceptions") and is therefore the owner's and the manager's, never the accountant's (docs/22
 * 2026-09-05). The gate (`grns.count`) is the stock keepers.
 */

export const SupplierInvoiceSourceSchema = z.enum([
  'docint',
  'irn_pull',
  'brand_dms_import',
  'manual',
  'import',
])
export const SupplierInvoiceStatusSchema = z.enum([
  'extracted',
  'in_review',
  'approved',
  'received',
  'disputed',
  'cancelled',
])
export type SupplierInvoiceStatus = z.infer<typeof SupplierInvoiceStatusSchema>

export const SupplierInvoiceLineInput = z.object({
  id: IdSchema,
  lineNo: z.number().int().positive(),
  /** Exactly as printed; the match to a variant may still be pending. */
  description: z.string().trim().min(1).max(200),
  supplierCode: z.string().trim().max(40).nullable().optional(),
  variantId: IdSchema.nullable().optional(),
  hsnCode: z
    .string()
    .regex(/^\d{4,8}$/)
    .nullable()
    .optional(),
  batchNo: z.string().trim().max(40).nullable().optional(),
  mfgDate: z.iso.date().nullable().optional(),
  expiryDate: z.iso.date().nullable().optional(),
  mrpPaise: PaiseSchema.nonnegative().nullable().optional(),
  printedQty: z.number().int().nonnegative(),
  /** Unit as printed: pcs, cs, case, box… Pieces are derived before this call (pack config). */
  printedUnit: z.string().trim().max(16).default('pcs'),
  qtyPcs: PiecesSchema,
  freeQtyPcs: PiecesSchema.default(0),
  ratePaise: PaiseSchema.nonnegative(),
  discountBps: BpsSchema.default(0),
  discountPaise: PaiseSchema.nonnegative().default(0),
  gstBps: BpsSchema.default(0),
  cessBps: BpsSchema.default(0),
  taxablePaise: PaiseSchema.nonnegative(),
  taxPaise: PaiseSchema.nonnegative(),
  lineTotalPaise: PaiseSchema.nonnegative(),
})

export const CreateSupplierInvoiceInput = MutationBase.extend({
  id: IdSchema,
  supplierId: IdSchema,
  purchaseOrderId: IdSchema.nullable().optional(),
  documentId: IdSchema.nullable().optional(),
  source: SupplierInvoiceSourceSchema,
  invoiceNo: z.string().trim().min(1).max(40),
  invoiceDate: z.iso.date(),
  irn: z
    .string()
    .regex(/^[0-9a-f]{64}$/i)
    .nullable()
    .optional(),
  ackNo: z.string().trim().max(40).nullable().optional(),
  ewayBillNo: z
    .string()
    .regex(/^\d{12}$/)
    .nullable()
    .optional(),
  supplierGstin: z.string().trim().max(15).nullable().optional(),
  placeOfSupplyState: z
    .string()
    .regex(/^\d{2}$/)
    .nullable()
    .optional(),
  subtotalPaise: PaiseSchema.nonnegative(),
  discountPaise: PaiseSchema.nonnegative().default(0),
  cgstPaise: PaiseSchema.nonnegative().default(0),
  sgstPaise: PaiseSchema.nonnegative().default(0),
  igstPaise: PaiseSchema.nonnegative().default(0),
  cessPaise: PaiseSchema.nonnegative().default(0),
  freightPaise: PaiseSchema.nonnegative().default(0),
  roundOffPaise: PaiseSchema.default(0),
  totalPaise: PaiseSchema.nonnegative(),
  dueDate: z.iso.date().nullable().optional(),
  lines: z.array(SupplierInvoiceLineInput).min(1).max(500),
})

export const SupplierInvoiceLineSchema = z.object({
  id: IdSchema,
  lineNo: z.number().int(),
  description: z.string(),
  supplierCode: z.string().nullable(),
  variantId: IdSchema.nullable(),
  hsnCode: z.string().nullable(),
  batchNo: z.string().nullable(),
  mfgDate: z.string().nullable(),
  expiryDate: z.string().nullable(),
  mrpPaise: PaiseSchema.nullable(),
  printedQty: z.number().int(),
  printedUnit: z.string(),
  qtyPcs: PiecesSchema,
  freeQtyPcs: PiecesSchema,
  ratePaise: PaiseSchema,
  discountBps: BpsSchema,
  discountPaise: PaiseSchema,
  gstBps: BpsSchema,
  cessBps: BpsSchema,
  taxablePaise: PaiseSchema,
  taxPaise: PaiseSchema,
  lineTotalPaise: PaiseSchema,
})
export type SupplierInvoiceLine = z.infer<typeof SupplierInvoiceLineSchema>

export const SupplierInvoiceSchema = z.object({
  id: IdSchema,
  supplierId: IdSchema,
  purchaseOrderId: IdSchema.nullable(),
  documentId: z.string().nullable(),
  source: SupplierInvoiceSourceSchema,
  status: SupplierInvoiceStatusSchema,
  invoiceNo: z.string(),
  invoiceDate: z.string(),
  irn: z.string().nullable(),
  ackNo: z.string().nullable(),
  ewayBillNo: z.string().nullable(),
  supplierGstin: z.string().nullable(),
  placeOfSupplyState: z.string().nullable(),
  subtotalPaise: PaiseSchema,
  discountPaise: PaiseSchema,
  cgstPaise: PaiseSchema,
  sgstPaise: PaiseSchema,
  igstPaise: PaiseSchema,
  cessPaise: PaiseSchema,
  freightPaise: PaiseSchema,
  roundOffPaise: PaiseSchema,
  totalPaise: PaiseSchema,
  dueDate: z.string().nullable(),
  approvedBy: z.string().nullable(),
  approvedAt: z.string().nullable(),
  /** Set by `supplierInvoices.dispute` / `.cancel`; null otherwise. */
  disputedAt: z.string().nullable(),
  disputeReason: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  createdAt: z.string(),
})
export type SupplierInvoice = z.infer<typeof SupplierInvoiceSchema>
export const SupplierInvoiceWithLinesSchema = SupplierInvoiceSchema.extend({
  lines: z.array(SupplierInvoiceLineSchema),
})
export type SupplierInvoiceWithLines = z.infer<typeof SupplierInvoiceWithLinesSchema>

export const CreateSupplierInvoiceOutput = z.object({ item: SupplierInvoiceWithLinesSchema })
export const SupplierInvoicesListInput = z.object({
  status: SupplierInvoiceStatusSchema.optional(),
  supplierId: IdSchema.optional(),
  limit: QueryIntSchema.min(1).max(200).default(50),
  cursor: z.string().optional(),
})
export const SupplierInvoicesListOutput = z.object({
  items: z.array(SupplierInvoiceSchema),
  nextCursor: z.string().nullable(),
})
export const SupplierInvoiceGetInput = z.object({ id: IdSchema })
export const SupplierInvoiceGetOutput = z.object({ item: SupplierInvoiceWithLinesSchema })

/** Human review resolved a printed line to a variant; the tenant remembers the supplier's code/description for next time. */
export const MatchLineInput = MutationBase.extend({
  id: IdSchema,
  lineId: IdSchema,
  variantId: IdSchema,
})
export const MatchLineOutput = z.object({ item: SupplierInvoiceWithLinesSchema })

/**
 * `extracted | in_review | approved → disputed`: the supplier's bill does not match what was agreed
 * (rate, quantity, a bill for goods never ordered). A `received` invoice cannot be disputed — the GRN
 * has posted stock and cost; the correction is a discrepancy claim or a supplier credit.
 */
export const DisputeSupplierInvoiceInput = MutationBase.extend({
  id: IdSchema,
  reason: z.string().trim().min(1).max(300),
})
export const DisputeSupplierInvoiceOutput = z.object({ item: SupplierInvoiceWithLinesSchema })

/** `extracted | in_review | approved | disputed → cancelled`; never once a GRN has been opened on it. */
export const CancelSupplierInvoiceInput = MutationBase.extend({
  id: IdSchema,
  reason: z.string().trim().min(1).max(300),
})
export const CancelSupplierInvoiceOutput = z.object({ item: SupplierInvoiceWithLinesSchema })

export const GrnStatusSchema = z.enum(['counting', 'reconciled', 'posted', 'cancelled'])
export const DiscrepancyKindSchema = z.enum([
  'short',
  'excess',
  'damaged',
  'wrong_item',
  'price_mismatch',
  'expiry_near',
])
export const DiscrepancyStatusSchema = z.enum([
  'open',
  'claimed',
  'credited',
  'accepted',
  'written_off',
])

/** Pieces only: this is what the gate sees. */
export const GrnLineSchema = z.object({
  id: IdSchema,
  supplierInvoiceLineId: IdSchema.nullable(),
  variantId: IdSchema,
  lotId: IdSchema.nullable(),
  expectedQtyPcs: PiecesSchema,
  countedQtyPcs: PiecesSchema.nullable(),
  damagedQtyPcs: PiecesSchema,
})
export type GrnLine = z.infer<typeof GrnLineSchema>

export const DiscrepancySchema = z.object({
  id: IdSchema,
  grnId: IdSchema,
  grnLineId: IdSchema.nullable(),
  kind: DiscrepancyKindSchema,
  qtyPcs: PiecesSchema,
  status: DiscrepancyStatusSchema,
  note: z.string().nullable(),
  resolvedBy: IdSchema.nullable(),
  resolvedAt: z.string().nullable(),
  createdAt: z.string(),
})
export type Discrepancy = z.infer<typeof DiscrepancySchema>

export const GrnSchema = z.object({
  id: IdSchema,
  grnNo: z.string().nullable(),
  supplierInvoiceId: IdSchema,
  locationId: IdSchema,
  status: GrnStatusSchema,
  countedBy: z.string().nullable(),
  countedAt: z.string().nullable(),
  postedBy: z.string().nullable(),
  postedAt: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
})
export type Grn = z.infer<typeof GrnSchema>
export const GrnWithLinesSchema = GrnSchema.extend({
  lines: z.array(GrnLineSchema),
  discrepancies: z.array(DiscrepancySchema),
})
export type GrnWithLines = z.infer<typeof GrnWithLinesSchema>

export const OpenGrnInput = MutationBase.extend({
  id: IdSchema,
  supplierInvoiceId: IdSchema,
  locationId: IdSchema,
  note: z.string().trim().max(200).optional(),
})
export const OpenGrnOutput = z.object({ item: GrnWithLinesSchema })

export const CountGrnInput = MutationBase.extend({
  id: IdSchema,
  lines: z
    .array(
      z.object({
        grnLineId: IdSchema,
        countedQtyPcs: PiecesSchema,
        damagedQtyPcs: PiecesSchema.default(0),
      }),
    )
    .min(1)
    .max(500),
})
export const CountGrnOutput = z.object({ item: GrnWithLinesSchema })

export const PostGrnInput = MutationBase.extend({ id: IdSchema })
export const PostGrnOutput = z.object({ item: GrnWithLinesSchema })

export const GrnsListInput = z.object({
  status: GrnStatusSchema.optional(),
  supplierInvoiceId: IdSchema.optional(),
  limit: QueryIntSchema.min(1).max(200).default(50),
  cursor: z.string().optional(),
})
export const GrnsListOutput = z.object({
  items: z.array(GrnSchema),
  nextCursor: z.string().nullable(),
})
export const GrnGetInput = z.object({ id: IdSchema })
export const GrnGetOutput = z.object({ item: GrnWithLinesSchema })

export const DiscrepanciesListInput = z.object({
  grnId: IdSchema.optional(),
  status: DiscrepancyStatusSchema.optional(),
  kind: DiscrepancyKindSchema.optional(),
  limit: QueryIntSchema.min(1).max(500).default(100),
  cursor: z.string().optional(),
})
export const DiscrepanciesListOutput = z.object({
  items: z.array(DiscrepancySchema),
  nextCursor: z.string().nullable(),
})

/**
 * The desk's decision on a gate-count finding (owner's approvals queue, "GRN exceptions"): `accepted`
 * (we live with it), `claimed` (raised with the brand; claims' `build` may also set it), `credited` (the
 * supplier issued a credit), `written_off`. Only from `open` or `claimed`; audited (`discrepancy.resolve`).
 */
export const ResolveDiscrepancyInput = MutationBase.extend({
  id: IdSchema,
  status: DiscrepancyStatusSchema.exclude(['open']),
  note: z.string().trim().max(300).optional(),
})
export const ResolveDiscrepancyOutput = z.object({ item: DiscrepancySchema })

export const PurchaseOrderStatusSchema = z.enum([
  'draft',
  'sent',
  'partially_received',
  'received',
  'cancelled',
])
export const PurchaseOrderLineSchema = z.object({
  variantId: IdSchema,
  qtyPcs: PiecesSchema.positive(),
  ratePaise: PaiseSchema.nonnegative().optional(),
})
export const PurchaseOrderSchema = z.object({
  id: IdSchema,
  poNo: z.string().nullable(),
  supplierId: IdSchema,
  status: PurchaseOrderStatusSchema,
  expectedOn: z.string().nullable(),
  lines: z.array(PurchaseOrderLineSchema),
  totalPaise: PaiseSchema.nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
})
export type PurchaseOrder = z.infer<typeof PurchaseOrderSchema>

export const UpsertPurchaseOrderInput = MutationBase.extend({
  id: IdSchema,
  supplierId: IdSchema,
  status: PurchaseOrderStatusSchema.default('draft'),
  expectedOn: z.iso.date().nullable().optional(),
  lines: z.array(PurchaseOrderLineSchema).max(500).default([]),
  note: z.string().trim().max(200).nullable().optional(),
})
export const UpsertPurchaseOrderOutput = z.object({ item: PurchaseOrderSchema })
export const PurchaseOrdersListInput = z.object({
  supplierId: IdSchema.optional(),
  status: PurchaseOrderStatusSchema.optional(),
  limit: QueryIntSchema.min(1).max(200).default(50),
  cursor: z.string().optional(),
})
export const PurchaseOrdersListOutput = z.object({
  items: z.array(PurchaseOrderSchema),
  nextCursor: z.string().nullable(),
})

export const procurementContract = {
  supplierInvoices: {
    create: oc
      .route({
        method: 'POST',
        path: '/procurement/supplier-invoices',
        summary: 'Record a reviewed supplier invoice with its lines (back office)',
      })
      .input(CreateSupplierInvoiceInput)
      .output(CreateSupplierInvoiceOutput),
    list: oc
      .route({
        method: 'GET',
        path: '/procurement/supplier-invoices',
        summary: 'Supplier invoices (back office)',
      })
      .input(SupplierInvoicesListInput)
      .output(SupplierInvoicesListOutput),
    get: oc
      .route({
        method: 'GET',
        path: '/procurement/supplier-invoices/{id}',
        summary: 'One supplier invoice with lines and rates (back office)',
      })
      .input(SupplierInvoiceGetInput)
      .output(SupplierInvoiceGetOutput),
    matchLine: oc
      .route({
        method: 'POST',
        path: '/procurement/supplier-invoices/{id}/lines/{lineId}/match',
        summary: 'Resolve a printed line to a catalog variant',
      })
      .input(MatchLineInput)
      .output(MatchLineOutput),
    dispute: oc
      .route({
        method: 'POST',
        path: '/procurement/supplier-invoices/{id}/dispute',
        summary: 'Mark a supplier invoice disputed before any GRN posts against it',
      })
      .input(DisputeSupplierInvoiceInput)
      .output(DisputeSupplierInvoiceOutput),
    cancel: oc
      .route({
        method: 'POST',
        path: '/procurement/supplier-invoices/{id}/cancel',
        summary: 'Cancel a supplier invoice that never became stock',
      })
      .input(CancelSupplierInvoiceInput)
      .output(CancelSupplierInvoiceOutput),
  },
  grns: {
    open: oc
      .route({
        method: 'POST',
        path: '/procurement/grns',
        summary: 'Open a GRN for an approved supplier invoice (expected pieces, no rates)',
      })
      .input(OpenGrnInput)
      .output(OpenGrnOutput),
    count: oc
      .route({
        method: 'POST',
        path: '/procurement/grns/{id}/count',
        summary: 'Blind gate count: pieces received and damaged per line',
      })
      .input(CountGrnInput)
      .output(CountGrnOutput),
    post: oc
      .route({
        method: 'POST',
        path: '/procurement/grns/{id}/post',
        summary: 'Post the GRN: lots, stock ledger, purchase cost, invoice received',
      })
      .input(PostGrnInput)
      .output(PostGrnOutput),
    list: oc
      .route({ method: 'GET', path: '/procurement/grns', summary: 'Goods receipts' })
      .input(GrnsListInput)
      .output(GrnsListOutput),
    get: oc
      .route({
        method: 'GET',
        path: '/procurement/grns/{id}',
        summary: 'One GRN with lines and discrepancies',
      })
      .input(GrnGetInput)
      .output(GrnGetOutput),
  },
  discrepancies: {
    list: oc
      .route({
        method: 'GET',
        path: '/procurement/discrepancies',
        summary: 'Short/excess/damaged findings from gate counts',
      })
      .input(DiscrepanciesListInput)
      .output(DiscrepanciesListOutput),
    resolve: oc
      .route({
        method: 'POST',
        path: '/procurement/discrepancies/{id}/resolve',
        summary:
          'Decide a gate-count finding: accepted, claimed, credited or written off (owner/manager)',
      })
      .input(ResolveDiscrepancyInput)
      .output(ResolveDiscrepancyOutput),
  },
  purchaseOrders: {
    upsert: oc
      .route({
        method: 'POST',
        path: '/procurement/purchase-orders',
        summary: 'Create or update a purchase order',
      })
      .input(UpsertPurchaseOrderInput)
      .output(UpsertPurchaseOrderOutput),
    list: oc
      .route({ method: 'GET', path: '/procurement/purchase-orders', summary: 'Purchase orders' })
      .input(PurchaseOrdersListInput)
      .output(PurchaseOrdersListOutput),
  },
}
