import { sql } from 'drizzle-orm'
import {
  boolean,
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
import {
  id,
  paise,
  pieces,
  roleWritePolicies,
  staffReadPolicy,
  STOCK_KEEPER_ROLES,
  timestamps,
  tz,
} from './columns.js'
import { locations, stockLots } from './inventory.js'
import { salesOrderLines, salesOrders } from './orders.js'
import { tenantRef } from './platform.js'
import { beats } from './retailers.js'
import { users } from './tenancy.js'

/**
 * Pick → pack (invoice issued here) → load sheet → delivery challan.
 *
 * RLS (coordination §5.3, migration 0010): all five tables carry `staffReadPolicy` + `roleWritePolicies(
 * STOCK_KEEPER_ROLES)` and NOT the wide `tenantPolicy` they had from 0002. A shopkeeper has no business
 * reading the godown's day sheet — it names every other shop on the same van — and only the floor and the
 * desk above it may write the paperwork that moves stock and issues a numbered challan.
 *
 * A business date on these tables (`pick_date`, `sheet_date`) defaults to the IST day, not `current_date`:
 * the cluster runs in UTC, so between 00:00 and 05:30 IST `current_date` is still yesterday and a picklist
 * raised at 1 am would be filed on the wrong day. Services pass `businessDate()` explicitly (docs/17 B);
 * the default only catches a direct insert.
 */

const istToday = sql`(now() AT TIME ZONE 'Asia/Kolkata')::date`

export const picklistStatus = pgEnum('picklist_status', [
  'open',
  'picking',
  'picked',
  'packed',
  'cancelled',
])

/** draft = built but nothing has moved; confirmed = counted out, stock transferred, challan issued. */
export const loadSheetStatus = pgEnum('load_sheet_status', ['draft', 'confirmed', 'cancelled'])

export const picklists = pgTable(
  'picklists',
  {
    id: id(),
    tenantId: tenantRef(),
    picklistNo: text('picklist_no'),
    locationId: text('location_id')
      .notNull()
      .references(() => locations.id),
    status: picklistStatus('status').notNull().default('open'),
    /** Orders grouped into this picklist (wave), usually one beat or one trip. */
    orderIds: jsonb('order_ids')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** IST business date the wave is picked for. */
    pickDate: date('pick_date', { mode: 'string' }).notNull().default(istToday),
    /** delivery.trips id — a plain label, delivery is downstream and may not exist yet. */
    tripId: text('trip_id'),
    beatId: text('beat_id').references(() => beats.id),
    note: text('note'),
    assignedTo: text('assigned_to').references(() => users.id),
    startedAt: tz('started_at'),
    completedAt: tz('completed_at'),
    cancelledAt: tz('cancelled_at'),
    cancelReason: text('cancel_reason'),
    ...timestamps,
  },
  (t) => [
    index('picklists_status_idx').on(t.tenantId, t.status, t.createdAt),
    uniqueIndex('picklists_no_idx')
      .on(t.tenantId, t.picklistNo)
      .where(sql`picklist_no IS NOT NULL`),
    index('picklists_trip_idx').on(t.tenantId, t.tripId),
    staffReadPolicy('picklists_read'),
    ...roleWritePolicies('picklists_write', STOCK_KEEPER_ROLES),
  ],
).enableRLS()

/**
 * One row per order line per lot. Picking writes paper only — the pieces leave the godown as `sale`
 * ledger rows inside `warehouse.packs.confirm`, so an abandoned half-picked wave touches no ledger.
 */
export const pickLines = pgTable(
  'pick_lines',
  {
    id: id(),
    tenantId: tenantRef(),
    picklistId: text('picklist_id')
      .notNull()
      .references(() => picklists.id),
    orderId: text('order_id')
      .notNull()
      .references(() => salesOrders.id),
    orderLineId: text('order_line_id')
      .notNull()
      .references(() => salesOrderLines.id),
    /** Denormalised from the order line so the picking sheet consolidates by SKU without reading orders. */
    variantId: text('variant_id')
      .notNull()
      .references(() => productVariants.id),
    lineNo: integer('line_no').notNull().default(0),
    lotId: text('lot_id').references(() => stockLots.id),
    /** The FEFO lot the server proposed; `lot_id` is what the picker actually took. */
    suggestedLotId: text('suggested_lot_id').references(() => stockLots.id),
    requestedQtyPcs: pieces('requested_qty_pcs').notNull(),
    pickedQtyPcs: pieces('picked_qty_pcs').notNull().default(0),
    freeQtyPcs: pieces('free_qty_pcs').notNull().default(0),
    /** The LOT's case size frozen at picklist creation (promo packs differ per batch, docs/17 A2). */
    caseSize: integer('case_size'),
    /** True when a later-expiry lot was taken while an earlier one still had stock: warn, never block. */
    fefoOverride: boolean('fefo_override').notNull().default(false),
    shortReason: text('short_reason'),
    pickedBy: text('picked_by'),
    pickedAt: tz('picked_at'),
    ...timestamps,
  },
  (t) => [
    index('pick_lines_picklist_idx').on(t.tenantId, t.picklistId),
    index('pick_lines_order_idx').on(t.tenantId, t.orderId),
    index('pick_lines_variant_idx').on(t.tenantId, t.picklistId, t.variantId),
    index('pick_lines_order_line_idx').on(t.tenantId, t.orderLineId),
    staffReadPolicy('pick_lines_read'),
    ...roleWritePolicies('pick_lines_write', STOCK_KEEPER_ROLES),
  ],
).enableRLS()

/** The moment an order becomes physical cartons: package count, weight, who packed, and the invoice issued. */
export const packConfirmations = pgTable(
  'pack_confirmations',
  {
    id: id(),
    tenantId: tenantRef(),
    orderId: text('order_id')
      .notNull()
      .references(() => salesOrders.id),
    picklistId: text('picklist_id').references(() => picklists.id),
    packages: integer('packages').notNull().default(1),
    weightGrams: integer('weight_grams'),
    /** Less was packed than ordered. The invoice is simply smaller; the order line is never edited. */
    shortPacked: boolean('short_packed').notNull().default(false),
    /** billing.invoices id issued at pack (plain id, billing is downstream). */
    invoiceId: text('invoice_id'),
    packedBy: text('packed_by').references(() => users.id),
    packedAt: tz('packed_at').notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    // ONE pack confirmation per order for all time — this is what makes "the invoice is issued once" a
    // database guarantee rather than a code convention. It subsumes the plain `pack_confirmations_order_idx`
    // that 0002 created, which 0010 drops in the same migration (coordination §5.4).
    uniqueIndex('pack_confirmations_order_uniq').on(t.tenantId, t.orderId),
    staffReadPolicy('pack_confirmations_read'),
    ...roleWritePolicies('pack_confirmations_write', STOCK_KEEPER_ROLES),
  ],
).enableRLS()

/**
 * What goes onto a vehicle: packed orders plus van-sale stock, by lot. Confirming the sheet posts the
 * `transfer_out`/`transfer_in` pair godown → vehicle, issues the Rule 55 challan and dispatches the orders.
 */
export const loadSheets = pgTable(
  'load_sheets',
  {
    id: id(),
    tenantId: tenantRef(),
    /**
     * delivery.trips id (plain id, delivery is downstream). NULLABLE since 0010: the warehouse builds the
     * sheet for a VEHICLE and delivery attaches the trip afterwards (coordination §5, warehouse §3).
     */
    tripId: text('trip_id'),
    status: loadSheetStatus('status').notNull().default('draft'),
    /** IST business date the load goes out on. */
    sheetDate: date('sheet_date', { mode: 'string' }).notNull().default(istToday),
    fromLocationId: text('from_location_id')
      .notNull()
      .references(() => locations.id),
    toLocationId: text('to_location_id')
      .notNull()
      .references(() => locations.id),
    orderIds: jsonb('order_ids')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    vanStock: jsonb('van_stock')
      .$type<{ lotId: string; qtyPcs: number }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Σ pack_confirmations.packages, against the crew's blind count at check-out. */
    expectedPackages: integer('expected_packages').notNull().default(0),
    countedPackages: integer('counted_packages'),
    /** A count that differs from the expectation needs a reason AND an owner/manager token. */
    varianceNote: text('variance_note'),
    pinVerifiedBy: text('pin_verified_by').references(() => users.id),
    /** Rule 55 delivery challan value and the e-way bill recorded when the load crosses the threshold (docs/17 A8). */
    loadValuePaise: paise('load_value_paise'),
    ewbRequired: boolean('ewb_required').notNull().default(false),
    ewbNo: text('ewb_no'),
    challanNo: text('challan_no'),
    confirmedBy: text('confirmed_by').references(() => users.id),
    confirmedAt: tz('confirmed_at'),
    cancelledAt: tz('cancelled_at'),
    cancelReason: text('cancel_reason'),
    ...timestamps,
  },
  (t) => [
    index('load_sheets_trip_idx').on(t.tenantId, t.tripId),
    index('load_sheets_status_idx').on(t.tenantId, t.status, t.sheetDate),
    index('load_sheets_to_location_idx').on(t.tenantId, t.toLocationId),
    staffReadPolicy('load_sheets_read'),
    ...roleWritePolicies('load_sheets_write', STOCK_KEEPER_ROLES),
  ],
).enableRLS()

/** Delivery challan (GST Rule 55) for goods moving without an invoice: van loads and godown transfers — docs/17 A8. */
export const deliveryChallans = pgTable(
  'delivery_challans',
  {
    id: id(),
    tenantId: tenantRef(),
    /** Numbering series the challan number came from; `DC` for a load-out (tenant-bootstrap). */
    seriesCode: text('series_code').notNull().default('DC'),
    challanNo: text('challan_no'),
    fy: text('fy').notNull(),
    challanDate: text('challan_date').notNull(),
    loadSheetId: text('load_sheet_id').references(() => loadSheets.id),
    fromLocationId: text('from_location_id')
      .notNull()
      .references(() => locations.id),
    toLocationId: text('to_location_id')
      .notNull()
      .references(() => locations.id),
    vehicleNo: text('vehicle_no'),
    lines: jsonb('lines')
      .$type<
        {
          variantId: string
          lotId: string
          qtyPcs: number
          taxableValuePaise: number
          gstBps: number
        }[]
      >()
      .notNull(),
    valuePaise: paise('value_paise').notNull(),
    /** GST on the declared value, printed on the challan beside it (Rule 55(1)(e)). */
    loadValueGstPaise: paise('load_value_gst_paise').notNull().default(0),
    ewbNo: text('ewb_no'),
    pdfObjectKey: text('pdf_object_key'),
    issuedBy: text('issued_by').references(() => users.id),
    issuedAt: tz('issued_at').notNull().defaultNow(),
  },
  (t) => [
    index('delivery_challans_load_sheet_idx').on(t.tenantId, t.loadSheetId),
    uniqueIndex('delivery_challans_no_idx')
      .on(t.tenantId, t.seriesCode, t.fy, t.challanNo)
      .where(sql`challan_no IS NOT NULL`),
    staffReadPolicy('delivery_challans_read'),
    ...roleWritePolicies('delivery_challans_write', STOCK_KEEPER_ROLES),
  ],
).enableRLS()
