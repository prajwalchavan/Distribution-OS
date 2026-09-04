import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { id, paise, pieces, tenantPolicy, timestamps, tz } from './columns.js'
import { productVariants } from './catalog.js'
import { tenantRef } from './platform.js'

/** ADR 0003: append-only stock ledger in pieces, balances derived, MRP and expiry are lot attributes. */

export const locationKind = pgEnum('location_kind', [
  'warehouse',
  'vehicle',
  'damaged',
  'in_transit',
  'customer',
])

/** Every place stock can be: the godown, each delivery vehicle (van sales), the damaged bin, goods in transit. */
export const locations = pgTable(
  'locations',
  {
    id: id(),
    tenantId: tenantRef(),
    kind: locationKind('kind').notNull(),
    name: text('name').notNull(),
    /** For kind = vehicle: the delivery.vehicles id (plain id, delivery is downstream). */
    vehicleId: text('vehicle_id'),
    /** Damaged/expiry bins may go negative during a claim cycle; selling locations never do. */
    negativeAllowed: boolean('negative_allowed').notNull().default(false),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('locations_tenant_name_idx').on(t.tenantId, t.name),
    tenantPolicy('locations_tenant'),
  ],
).enableRLS()

/** A batch of a variant at one MRP with one expiry. UNIQUE(tenant, variant, batch, mrp) per ADR 0003. */
export const stockLots = pgTable(
  'stock_lots',
  {
    id: id(),
    tenantId: tenantRef(),
    variantId: text('variant_id')
      .notNull()
      .references(() => productVariants.id),
    batchNo: text('batch_no').notNull().default(''),
    mrpPaise: paise('mrp_paise').notNull(),
    mfgDate: date('mfg_date', { mode: 'string' }),
    expiryDate: date('expiry_date', { mode: 'string' }),
    /** Pieces per case for THIS batch (promo packs differ), copied from the GRN line — docs/17 A2. */
    caseSize: integer('case_size'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('stock_lots_identity_idx').on(t.tenantId, t.variantId, t.batchNo, t.mrpPaise),
    index('stock_lots_expiry_idx').on(t.tenantId, t.expiryDate),
    tenantPolicy('stock_lots_tenant'),
  ],
).enableRLS()

export const stockReason = pgEnum('stock_reason', [
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

/**
 * Append-only. Never UPDATE or DELETE a row; corrections are compensating rows. `UNIQUE(tenant_id, idempotency_key)`
 * makes offline replays harmless. Leading (tenant_id, occurred_at) so monthly partitioning later is a data move.
 */
export const stockLedger = pgTable(
  'stock_ledger',
  {
    id: id(),
    tenantId: tenantRef(),
    occurredAt: tz('occurred_at').notNull().defaultNow(),
    lotId: text('lot_id')
      .notNull()
      .references(() => stockLots.id),
    locationId: text('location_id')
      .notNull()
      .references(() => locations.id),
    qtyDelta: pieces('qty_delta').notNull(),
    reason: stockReason('reason').notNull(),
    refType: text('ref_type'),
    refId: text('ref_id'),
    actorId: text('actor_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    note: text('note'),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('stock_ledger_idempotency_idx').on(t.tenantId, t.idempotencyKey),
    index('stock_ledger_time_idx').on(t.tenantId, t.occurredAt),
    index('stock_ledger_lot_location_idx').on(t.tenantId, t.lotId, t.locationId),
    index('stock_ledger_ref_idx').on(t.tenantId, t.refType, t.refId),
    check('stock_ledger_qty_nonzero', sql`qty_delta <> 0`),
    tenantPolicy('stock_ledger_tenant'),
  ],
).enableRLS()

/** Derived balance, updated in the same transaction as the ledger row with RETURNING; re-derived nightly. */
export const stockBalances = pgTable(
  'stock_balances',
  {
    tenantId: tenantRef(),
    lotId: text('lot_id')
      .notNull()
      .references(() => stockLots.id),
    locationId: text('location_id')
      .notNull()
      .references(() => locations.id),
    onHand: pieces('on_hand').notNull().default(0),
    reserved: pieces('reserved').notNull().default(0),
    negativeAllowed: boolean('negative_allowed').notNull().default(false),
    version: integer('version').notNull().default(0),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.lotId, t.locationId] }),
    index('stock_balances_location_idx').on(t.tenantId, t.locationId),
    check('stock_balances_on_hand_nonneg', sql`on_hand >= 0 OR negative_allowed`),
    check('stock_balances_reserved_nonneg', sql`reserved >= 0`),
    tenantPolicy('stock_balances_tenant'),
  ],
).enableRLS()

export const reservationState = pgEnum('reservation_state', ['pending', 'posted', 'voided'])

/** Pieces held for a confirmed order line until pick posts the sale (ATP = on_hand - reserved). */
export const reservations = pgTable(
  'reservations',
  {
    id: id(),
    tenantId: tenantRef(),
    /** Plain id: orders is downstream of inventory. */
    orderLineId: text('order_line_id').notNull(),
    variantId: text('variant_id')
      .notNull()
      .references(() => productVariants.id),
    lotId: text('lot_id').references(() => stockLots.id),
    locationId: text('location_id')
      .notNull()
      .references(() => locations.id),
    qty: pieces('qty').notNull(),
    state: reservationState('state').notNull().default('pending'),
    ...timestamps,
  },
  (t) => [
    index('reservations_order_line_idx').on(t.tenantId, t.orderLineId),
    index('reservations_state_idx').on(t.tenantId, t.state),
    tenantPolicy('reservations_tenant'),
  ],
).enableRLS()

export const cycleCountStatus = pgEnum('cycle_count_status', [
  'open',
  'counted',
  'posted',
  'cancelled',
])

/** A physical count of one location; posting writes `cycle_count` ledger rows for the differences. */
export const cycleCounts = pgTable(
  'cycle_counts',
  {
    id: id(),
    tenantId: tenantRef(),
    locationId: text('location_id')
      .notNull()
      .references(() => locations.id),
    status: cycleCountStatus('status').notNull().default('open'),
    countedBy: text('counted_by'),
    countedAt: tz('counted_at'),
    postedAt: tz('posted_at'),
    note: text('note'),
    ...timestamps,
  },
  (t) => [
    index('cycle_counts_location_idx').on(t.tenantId, t.locationId, t.createdAt),
    tenantPolicy('cycle_counts_tenant'),
  ],
).enableRLS()

export const cycleCountLines = pgTable(
  'cycle_count_lines',
  {
    id: id(),
    tenantId: tenantRef(),
    cycleCountId: text('cycle_count_id')
      .notNull()
      .references(() => cycleCounts.id),
    lotId: text('lot_id')
      .notNull()
      .references(() => stockLots.id),
    expectedQty: pieces('expected_qty').notNull(),
    countedQty: pieces('counted_qty'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('cycle_count_lines_idx').on(t.tenantId, t.cycleCountId, t.lotId),
    tenantPolicy('cycle_count_lines_tenant'),
  ],
).enableRLS()
