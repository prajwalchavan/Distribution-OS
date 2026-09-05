import { sql } from 'drizzle-orm'
import { index, integer, jsonb, pgEnum, pgTable, text } from 'drizzle-orm/pg-core'
import { id, paise, pieces, tenantPolicy, timestamps, tz } from './columns.js'
import { locations, stockLots } from './inventory.js'
import { salesOrderLines, salesOrders } from './orders.js'
import { tenantRef } from './platform.js'
import { users } from './tenancy.js'

/** Pick → pack (invoice issued here) → load sheet per trip. */

export const picklistStatus = pgEnum('picklist_status', [
  'open',
  'picking',
  'picked',
  'packed',
  'cancelled',
])

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
    assignedTo: text('assigned_to').references(() => users.id),
    startedAt: tz('started_at'),
    completedAt: tz('completed_at'),
    ...timestamps,
  },
  (t) => [
    index('picklists_status_idx').on(t.tenantId, t.status, t.createdAt),
    tenantPolicy('picklists_tenant'),
  ],
).enableRLS()

/** One line per order line per lot picked; posting a pick writes the `sale` ledger row and voids the reservation. */
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
    lotId: text('lot_id').references(() => stockLots.id),
    requestedQtyPcs: pieces('requested_qty_pcs').notNull(),
    pickedQtyPcs: pieces('picked_qty_pcs').notNull().default(0),
    shortReason: text('short_reason'),
    pickedBy: text('picked_by'),
    pickedAt: tz('picked_at'),
    ...timestamps,
  },
  (t) => [
    index('pick_lines_picklist_idx').on(t.tenantId, t.picklistId),
    index('pick_lines_order_idx').on(t.tenantId, t.orderId),
    tenantPolicy('pick_lines_tenant'),
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
    packages: integer('packages').notNull().default(1),
    weightGrams: integer('weight_grams'),
    /** billing.invoices id issued at pack (plain id, billing is downstream). */
    invoiceId: text('invoice_id'),
    packedBy: text('packed_by').references(() => users.id),
    packedAt: tz('packed_at').notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    index('pack_confirmations_order_idx').on(t.tenantId, t.orderId),
    tenantPolicy('pack_confirmations_tenant'),
  ],
).enableRLS()

/** What goes onto a vehicle for a trip: packed orders plus van-sale stock, by lot (writes `van_load` ledger rows). */
export const loadSheets = pgTable(
  'load_sheets',
  {
    id: id(),
    tenantId: tenantRef(),
    /** delivery.trips id (plain id, delivery is downstream). */
    tripId: text('trip_id').notNull(),
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
    /** Rule 55 delivery challan value and the e-way bill recorded when the load crosses the threshold (docs/17 A8). */
    loadValuePaise: paise('load_value_paise'),
    ewbNo: text('ewb_no'),
    challanNo: text('challan_no'),
    confirmedBy: text('confirmed_by').references(() => users.id),
    confirmedAt: tz('confirmed_at'),
    ...timestamps,
  },
  (t) => [
    index('load_sheets_trip_idx').on(t.tenantId, t.tripId),
    tenantPolicy('load_sheets_tenant'),
  ],
).enableRLS()

/** Delivery challan (GST Rule 55) for goods moving without an invoice: van loads and godown transfers — docs/17 A8. */
export const deliveryChallans = pgTable(
  'delivery_challans',
  {
    id: id(),
    tenantId: tenantRef(),
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
    ewbNo: text('ewb_no'),
    pdfObjectKey: text('pdf_object_key'),
    issuedBy: text('issued_by').references(() => users.id),
    issuedAt: tz('issued_at').notNull().defaultNow(),
  },
  (t) => [
    index('delivery_challans_load_sheet_idx').on(t.tenantId, t.loadSheetId),
    tenantPolicy('delivery_challans_tenant'),
  ],
).enableRLS()
