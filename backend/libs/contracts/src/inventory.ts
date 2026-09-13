import { oc } from '@orpc/contract'
import { z } from 'zod'
import {
  IdSchema,
  MutationBase,
  PaiseSchema,
  PiecesSchema,
  QueryBoolSchema,
  QueryIntSchema,
} from './common.js'

/**
 * Inventory (ADR 0003): append-only stock ledger in pieces, derived balances, lots carry batch/MRP/expiry.
 * Nothing here carries cost. Reps and retailers see two stock reads and nothing else: `stock.availability`
 * (one ATP total per item at the godown orders reserve from — the order screens' stock hint) and
 * `stock.sellable` (ATP = on_hand - reserved, per lot per location); per-lot balances, adjustments, transfers
 * and the ledger are for the people who keep the stock.
 *
 * WHICH SERVICES MOUNT `inventory`: all six (`stock.availability` is the shop's and the rep's ATP hint). A cycle count
 * (`cycleCounts.*`, docs/23 §8.18) is the godown's paperwork: the stock keepers open and count it, the
 * desk posts the differences as `cycle_count` ledger rows — one lot at a time through `stock.adjust`
 * was the only way before.
 */

export const LocationKindSchema = z.enum([
  'warehouse',
  'vehicle',
  'damaged',
  'in_transit',
  'customer',
])
export type LocationKind = z.infer<typeof LocationKindSchema>

export const LocationSchema = z.object({
  id: IdSchema,
  kind: LocationKindSchema,
  name: z.string(),
  vehicleId: IdSchema.nullable(),
  negativeAllowed: z.boolean(),
  active: z.boolean(),
})
export type Location = z.infer<typeof LocationSchema>

export const LocationsListInput = z.object({
  kind: LocationKindSchema.optional(),
  activeOnly: QueryBoolSchema.default(true),
})
export const LocationsListOutput = z.object({ items: z.array(LocationSchema) })

export const UpsertLocationInput = MutationBase.extend({
  id: IdSchema,
  kind: LocationKindSchema,
  name: z.string().trim().min(1).max(80),
  vehicleId: IdSchema.nullable().optional(),
  negativeAllowed: z.boolean().default(false),
  active: z.boolean().default(true),
})
export const UpsertLocationOutput = z.object({ item: LocationSchema })

/** Every ledger reason (ADR 0003). Modules post most of these; only the adjustment subset is reachable over the API. */
export const StockReasonSchema = z.enum([
  'opening',
  'grn',
  'sale',
  'sale_return_saleable',
  'sale_return_damaged',
  'damage',
  'expiry_writeoff',
  'transfer_out',
  'transfer_in',
  'van_load',
  'van_unload',
  'adjustment',
  'cycle_count',
])
export type StockReason = z.infer<typeof StockReasonSchema>
export const AdjustmentReasonSchema = z.enum([
  'adjustment',
  'damage',
  'expiry_writeoff',
  'opening',
  'cycle_count',
])

export const StockLotSchema = z.object({
  id: IdSchema,
  variantId: IdSchema,
  batchNo: z.string(),
  mrpPaise: PaiseSchema,
  mfgDate: z.string().nullable(),
  expiryDate: z.string().nullable(),
})
export type StockLot = z.infer<typeof StockLotSchema>

export const UpsertLotInput = MutationBase.extend({
  id: IdSchema,
  variantId: IdSchema,
  batchNo: z.string().trim().max(40).default(''),
  mrpPaise: PaiseSchema.nonnegative(),
  mfgDate: z.iso.date().nullable().optional(),
  expiryDate: z.iso.date().nullable().optional(),
})
export const UpsertLotOutput = z.object({ item: StockLotSchema, created: z.boolean() })

/** One row of the `sellable_stock` view with names flattened. No on-hand/reserved split, no cost. */
export const SellableStockRowSchema = z.object({
  variantId: IdSchema,
  locationId: IdSchema,
  lotId: IdSchema,
  batchNo: z.string(),
  mrpPaise: PaiseSchema,
  expiryDate: z.string().nullable(),
  available: PiecesSchema,
  variantName: z.string(),
  productName: z.string(),
  brandName: z.string().nullable(),
})
export type SellableStockRow = z.infer<typeof SellableStockRowSchema>

export const SellableStockInput = z.object({
  variantId: IdSchema.optional(),
  locationId: IdSchema.optional(),
  q: z.string().trim().max(80).optional(),
  limit: QueryIntSchema.min(1).max(500).default(200),
  /** `${lotId}:${locationId}` of the last row. */
  cursor: z.string().optional(),
})
export const SellableStockOutput = z.object({
  items: z.array(SellableStockRowSchema),
  nextCursor: z.string().nullable(),
})

/**
 * One item's available-to-promise at the godown orders reserve from (the first active warehouse by id): the
 * order screens' stock hint (DOS-074, DOS-097). Pieces only — no lot, batch, MRP, expiry, location,
 * on-hand/reserved split or cost. An item with nothing left to promise there has no row.
 */
export const StockAvailabilityRowSchema = z.object({
  variantId: IdSchema,
  available: PiecesSchema,
})
export type StockAvailabilityRow = z.infer<typeof StockAvailabilityRowSchema>

export const StockAvailabilityInput = z.object({
  variantId: IdSchema.optional(),
  limit: QueryIntSchema.min(1).max(500).default(500),
  /** `variantId` of the last row. */
  cursor: IdSchema.optional(),
})
export const StockAvailabilityOutput = z.object({
  items: z.array(StockAvailabilityRowSchema),
  nextCursor: z.string().nullable(),
})

/** Per lot per location: what the godown actually holds and what is promised to confirmed orders. */
export const StockBalanceRowSchema = z.object({
  lotId: IdSchema,
  variantId: IdSchema,
  locationId: IdSchema,
  batchNo: z.string(),
  mrpPaise: PaiseSchema,
  expiryDate: z.string().nullable(),
  onHand: z.number().int(),
  reserved: PiecesSchema,
  version: z.number().int(),
  variantName: z.string(),
  productName: z.string(),
})
export type StockBalanceRow = z.infer<typeof StockBalanceRowSchema>

export const StockBalancesInput = z.object({
  variantId: IdSchema.optional(),
  locationId: IdSchema.optional(),
  lotId: IdSchema.optional(),
  /** Lots whose expiry is on or before this IST date (the near-expiry list, docs/23 §8.18). */
  expiringBefore: z.iso.date().optional(),
  /** Lots expiring within the tenant's near-expiry window (default 60 days); lots with no expiry are excluded. */
  nearExpiryOnly: QueryBoolSchema.optional(),
  limit: QueryIntSchema.min(1).max(500).default(200),
  /** `${lotId}:${locationId}` of the last row. */
  cursor: z.string().optional(),
})
export const StockBalancesOutput = z.object({
  items: z.array(StockBalanceRowSchema),
  nextCursor: z.string().nullable(),
})

export const LedgerEntrySchema = z.object({
  id: IdSchema,
  occurredAt: z.string(),
  lotId: IdSchema,
  locationId: IdSchema,
  qtyDelta: z.number().int(),
  reason: StockReasonSchema,
  refType: z.string().nullable(),
  refId: z.string().nullable(),
  actorId: z.string(),
  note: z.string().nullable(),
})
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>

/** Balance after a posting, without names (the caller already knows the lot). */
export const BalanceSnapshotSchema = z.object({
  lotId: IdSchema,
  locationId: IdSchema,
  onHand: z.number().int(),
  reserved: PiecesSchema,
  version: z.number().int(),
})
export type BalanceSnapshot = z.infer<typeof BalanceSnapshotSchema>

export const AdjustStockInput = MutationBase.extend({
  lotId: IdSchema,
  locationId: IdSchema,
  qtyDelta: z
    .number()
    .int()
    .refine((n) => n !== 0, 'qtyDelta must not be zero'),
  reason: AdjustmentReasonSchema,
  note: z.string().trim().max(200).optional(),
})
export const AdjustStockOutput = z.object({
  entry: LedgerEntrySchema,
  balance: BalanceSnapshotSchema,
})

export const TransferStockInput = MutationBase.extend({
  lotId: IdSchema,
  fromLocationId: IdSchema,
  toLocationId: IdSchema,
  qtyPcs: PiecesSchema.positive(),
  note: z.string().trim().max(200).optional(),
})
export const TransferStockOutput = z.object({
  out: LedgerEntrySchema,
  in: LedgerEntrySchema,
  from: BalanceSnapshotSchema,
  to: BalanceSnapshotSchema,
})

export const LedgerListInput = z.object({
  lotId: IdSchema.optional(),
  locationId: IdSchema.optional(),
  /** ISO timestamps; inclusive lower bound, exclusive upper bound on occurred_at. */
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  limit: QueryIntSchema.min(1).max(500).default(100),
  cursor: z.string().optional(),
})
export const LedgerListOutput = z.object({
  items: z.array(LedgerEntrySchema),
  nextCursor: z.string().nullable(),
})

// ---------------------------------------------------------------------------------------------------------------
// cycle counts — a physical count of one location, posted as `cycle_count` ledger rows for the differences

export const CycleCountStatusSchema = z.enum(['open', 'counted', 'posted', 'cancelled'])
export type CycleCountStatus = z.infer<typeof CycleCountStatusSchema>

/** One lot of the counted location: what the ledger says, what the floor found. Pieces only, never a cost. */
export const CycleCountLineSchema = z.object({
  id: IdSchema,
  lotId: IdSchema,
  variantId: IdSchema,
  batchNo: z.string(),
  expiryDate: z.string().nullable(),
  /** On-hand at the moment the count was opened. */
  expectedPcs: PiecesSchema,
  countedPcs: PiecesSchema.nullable(),
  /** `countedPcs − expectedPcs`; null until counted. */
  variancePcs: z.number().int().nullable(),
})
export type CycleCountLine = z.infer<typeof CycleCountLineSchema>

export const CycleCountSchema = z.object({
  id: IdSchema,
  locationId: IdSchema,
  status: CycleCountStatusSchema,
  lineCount: z.number().int(),
  countedBy: IdSchema.nullable(),
  countedAt: z.string().nullable(),
  postedBy: IdSchema.nullable(),
  postedAt: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
})
export type CycleCount = z.infer<typeof CycleCountSchema>

export const CycleCountDetailSchema = CycleCountSchema.extend({
  lines: z.array(CycleCountLineSchema),
})
export type CycleCountDetail = z.infer<typeof CycleCountDetailSchema>

const CycleCountItemOutput = z.object({ item: CycleCountDetailSchema })

/**
 * Opens a count: one line per lot with a balance at the location (or only `lotIds`), `expectedPcs`
 * frozen from `stock_balances` at that moment. Lines are server-created — the client cannot know the
 * lots in advance — under the count's client-generated id.
 */
export const OpenCycleCountInput = MutationBase.extend({
  id: IdSchema,
  locationId: IdSchema,
  lotIds: z.array(IdSchema).max(500).optional(),
  note: z.string().trim().max(200).optional(),
})
export const OpenCycleCountOutput = CycleCountItemOutput

/** The blind count. Every line must be counted before posting; lines may be sent in several calls. */
export const CountCycleCountInput = MutationBase.extend({
  id: IdSchema,
  lines: z
    .array(z.object({ lotId: IdSchema, countedPcs: PiecesSchema }))
    .min(1)
    .max(500),
})
export const CountCycleCountOutput = CycleCountItemOutput

/** Posts one `cycle_count` ledger row per line whose variance is not zero; `open → counted → posted`. */
export const PostCycleCountInput = MutationBase.extend({ id: IdSchema })
export const PostCycleCountOutput = z.object({
  item: CycleCountDetailSchema,
  entries: z.array(LedgerEntrySchema),
})

export const CycleCountsListInput = z.object({
  locationId: IdSchema.optional(),
  status: CycleCountStatusSchema.optional(),
  limit: QueryIntSchema.min(1).max(200).default(50),
  cursor: z.string().optional(),
})
export const CycleCountsListOutput = z.object({
  items: z.array(CycleCountSchema),
  nextCursor: z.string().nullable(),
})

export const CycleCountGetInput = z.object({ id: IdSchema })
export const CycleCountGetOutput = CycleCountItemOutput

export const inventoryContract = {
  locations: {
    list: oc
      .route({
        method: 'GET',
        path: '/inventory/locations',
        summary: 'Stock locations: godown, vehicles, damaged bin',
      })
      .input(LocationsListInput)
      .output(LocationsListOutput),
    upsert: oc
      .route({
        method: 'POST',
        path: '/inventory/locations',
        summary: 'Create or update a stock location',
      })
      .input(UpsertLocationInput)
      .output(UpsertLocationOutput),
  },
  stock: {
    sellable: oc
      .route({
        method: 'GET',
        path: '/inventory/sellable',
        summary: 'Available-to-promise stock per lot per location',
      })
      .input(SellableStockInput)
      .output(SellableStockOutput),
    availability: oc
      .route({
        method: 'GET',
        path: '/inventory/availability',
        summary:
          "Available-to-promise per item at the godown orders reserve from (the order screens' stock hint)",
      })
      .input(StockAvailabilityInput)
      .output(StockAvailabilityOutput),
    balances: oc
      .route({
        method: 'GET',
        path: '/inventory/balances',
        summary: 'On-hand and reserved per lot per location (stock keepers only)',
      })
      .input(StockBalancesInput)
      .output(StockBalancesOutput),
    adjust: oc
      .route({
        method: 'POST',
        path: '/inventory/adjustments',
        summary: 'Post an opening/adjustment/damage/expiry/cycle-count ledger row',
      })
      .input(AdjustStockInput)
      .output(AdjustStockOutput),
    transfer: oc
      .route({
        method: 'POST',
        path: '/inventory/transfers',
        summary: 'Move pieces of a lot between locations',
      })
      .input(TransferStockInput)
      .output(TransferStockOutput),
    ledger: oc
      .route({ method: 'GET', path: '/inventory/ledger', summary: 'Append-only stock ledger' })
      .input(LedgerListInput)
      .output(LedgerListOutput),
  },
  lots: {
    upsert: oc
      .route({
        method: 'POST',
        path: '/inventory/lots',
        summary: 'Find or create a lot (variant + batch + MRP)',
      })
      .input(UpsertLotInput)
      .output(UpsertLotOutput),
  },
  cycleCounts: {
    open: oc
      .route({
        method: 'POST',
        path: '/inventory/cycle-counts',
        summary: 'Open a physical count of a location (expected pieces frozen per lot)',
      })
      .input(OpenCycleCountInput)
      .output(OpenCycleCountOutput),
    count: oc
      .route({
        method: 'POST',
        path: '/inventory/cycle-counts/{id}/count',
        summary: 'Record counted pieces per lot (blind)',
      })
      .input(CountCycleCountInput)
      .output(CountCycleCountOutput),
    post: oc
      .route({
        method: 'POST',
        path: '/inventory/cycle-counts/{id}/post',
        summary: 'Post the differences as cycle_count ledger rows (back office)',
      })
      .input(PostCycleCountInput)
      .output(PostCycleCountOutput),
    list: oc
      .route({
        method: 'GET',
        path: '/inventory/cycle-counts',
        summary: 'Cycle counts by location and status',
      })
      .input(CycleCountsListInput)
      .output(CycleCountsListOutput),
    get: oc
      .route({
        method: 'GET',
        path: '/inventory/cycle-counts/{id}',
        summary: 'One cycle count with its lines',
      })
      .input(CycleCountGetInput)
      .output(CycleCountGetOutput),
  },
}
