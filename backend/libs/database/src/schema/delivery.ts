import { sql } from 'drizzle-orm'
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  real,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import {
  id,
  paise,
  pieces,
  staffWritePolicy,
  tenantOrOwnRetailerPolicy,
  tenantPolicy,
  timestamps,
  tz,
} from './columns.js'
import { invoiceLines, invoices } from './billing.js'
import { locations } from './inventory.js'
import { salesOrders } from './orders.js'
import { tenantRef } from './platform.js'
import { retailers } from './retailers.js'
import { appRw } from './roles.js'
import { users } from './tenancy.js'

/**
 * ADR 0013: a vehicle is a stock location; a trip loads from the warehouse, delivers stops, sells van stock on
 * the spot, collects money, and settles pieces + cash at the end. GPS points arrive through POST /gps/points.
 */

export const vehicles = pgTable(
  'vehicles',
  {
    id: id(),
    tenantId: tenantRef(),
    regNo: text('reg_no').notNull(),
    name: text('name'),
    kind: text('kind').notNull().default('tempo'),
    capacityCases: integer('capacity_cases'),
    /** inventory.locations row of kind = vehicle that holds this vehicle's stock. */
    locationId: text('location_id')
      .notNull()
      .references(() => locations.id),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('vehicles_reg_idx').on(t.tenantId, t.regNo), tenantPolicy('vehicles_tenant')],
).enableRLS()

export const tripState = pgEnum('trip_state', [
  'planned',
  'loading',
  'active',
  'closing',
  'settled',
  'settled_with_variance',
  'cancelled',
])

export const trips = pgTable(
  'trips',
  {
    id: id(),
    tenantId: tenantRef(),
    tripNo: text('trip_no'),
    tripDate: date('trip_date', { mode: 'string' }).notNull(),
    vehicleId: text('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    driverId: text('driver_id').references(() => users.id),
    helperId: text('helper_id').references(() => users.id),
    state: tripState('state').notNull().default('planned'),
    /** Whether the crew may sell van stock on this trip (feature flag + owner toggle). */
    vanSalesEnabled: boolean('van_sales_enabled').notNull().default(false),
    plannedStops: integer('planned_stops').notNull().default(0),
    startOdometerKm: integer('start_odometer_km'),
    endOdometerKm: integer('end_odometer_km'),
    /** Cash float given to the crew at start, in paise. */
    openingCashPaise: paise('opening_cash_paise').notNull().default(0),
    startedAt: tz('started_at'),
    endedAt: tz('ended_at'),
    ...timestamps,
  },
  (t) => [
    index('trips_date_idx').on(t.tenantId, t.tripDate),
    index('trips_state_idx').on(t.tenantId, t.state),
    index('trips_driver_idx').on(t.tenantId, t.driverId, t.tripDate),
    tenantPolicy('trips_tenant'),
  ],
).enableRLS()

export const stopState = pgEnum('stop_state', [
  'pending',
  'started',
  'arrived',
  'delivered',
  'partial',
  'failed',
  'skipped',
])
export const stopFailureReason = pgEnum('stop_failure_reason', [
  'shop_closed',
  'refused',
  'no_cash',
  'wrong_address',
  'damaged_goods',
  'other',
])

export const tripStops = pgTable(
  'trip_stops',
  {
    id: id(),
    tenantId: tenantRef(),
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id),
    sequence: integer('sequence').notNull(),
    retailerId: text('retailer_id')
      .notNull()
      .references(() => retailers.id),
    state: stopState('state').notNull().default('pending'),
    failureReason: stopFailureReason('failure_reason'),
    failureNote: text('failure_note'),
    /** Amount to collect at this stop as planned (current invoice + agreed old dues). */
    plannedCollectionPaise: paise('planned_collection_paise').notNull().default(0),
    etaAt: tz('eta_at'),
    startedAt: tz('started_at'),
    arrivedAt: tz('arrived_at'),
    completedAt: tz('completed_at'),
    arrivedLat: doublePrecision('arrived_lat'),
    arrivedLng: doublePrecision('arrived_lng'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('trip_stops_sequence_idx').on(t.tenantId, t.tripId, t.sequence),
    index('trip_stops_retailer_idx').on(t.tenantId, t.retailerId),
    // staff see all; the retailer sees its own stops (for ETA in the retailer app)
    tenantOrOwnRetailerPolicy('trip_stops_read', 'retailer_id'),
    ...staffWritePolicy('trip_stops_write'),
  ],
).enableRLS()

export const deliveryOutcome = pgEnum('delivery_outcome', [
  'delivered',
  'partial',
  'returned',
  'failed',
])

/** One delivery attempt of one invoice at one stop. */
export const deliveries = pgTable(
  'deliveries',
  {
    id: id(),
    tenantId: tenantRef(),
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id),
    stopId: text('stop_id')
      .notNull()
      .references(() => tripStops.id),
    orderId: text('order_id').references(() => salesOrders.id),
    invoiceId: text('invoice_id')
      .notNull()
      .references(() => invoices.id),
    outcome: deliveryOutcome('outcome'),
    deliveredBy: text('delivered_by').references(() => users.id),
    deliveredAt: tz('delivered_at'),
    /** Receiver's name as typed by the crew (bill signed by). */
    receiverName: text('receiver_name'),
    note: text('note'),
    idempotencyKey: text('idempotency_key').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('deliveries_idempotency_idx').on(t.tenantId, t.idempotencyKey),
    index('deliveries_invoice_idx').on(t.tenantId, t.invoiceId),
    index('deliveries_trip_idx').on(t.tenantId, t.tripId),
    tenantPolicy('deliveries_tenant'),
  ],
).enableRLS()

/** Per-line delivered vs returned pieces; shortfalls create credit notes at the original rate (§4.4). */
export const deliveryLines = pgTable(
  'delivery_lines',
  {
    id: id(),
    tenantId: tenantRef(),
    deliveryId: text('delivery_id')
      .notNull()
      .references(() => deliveries.id),
    invoiceLineId: text('invoice_line_id')
      .notNull()
      .references(() => invoiceLines.id),
    deliveredQtyPcs: pieces('delivered_qty_pcs').notNull(),
    returnedQtyPcs: pieces('returned_qty_pcs').notNull().default(0),
    returnedSaleable: boolean('returned_saleable').notNull().default(true),
    reason: text('reason'),
    ...timestamps,
  },
  (t) => [
    index('delivery_lines_delivery_idx').on(t.tenantId, t.deliveryId),
    tenantPolicy('delivery_lines_tenant'),
  ],
).enableRLS()

export const podKind = pgEnum('pod_kind', ['photo', 'signature', 'otp', 'geo'])

/** Proof of delivery: photo of the signed bill, signature, OTP, or the geo-fence check. */
export const podEvidence = pgTable(
  'pod_evidence',
  {
    id: id(),
    tenantId: tenantRef(),
    deliveryId: text('delivery_id')
      .notNull()
      .references(() => deliveries.id),
    kind: podKind('kind').notNull(),
    objectKey: text('object_key'),
    payload: jsonb('payload'),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    capturedAt: tz('captured_at').notNull().defaultNow(),
  },
  (t) => [
    index('pod_evidence_delivery_idx').on(t.tenantId, t.deliveryId),
    tenantPolicy('pod_evidence_tenant'),
  ],
).enableRLS()

/**
 * A collection event on a trip (what the crew handed over). The money itself is a receivables.receipts row
 * (created by the same command); this row exists for the trip settlement and the crew's day summary.
 */
export const collections = pgTable(
  'collections',
  {
    id: id(),
    tenantId: tenantRef(),
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id),
    stopId: text('stop_id').references(() => tripStops.id),
    retailerId: text('retailer_id')
      .notNull()
      .references(() => retailers.id),
    /** receivables.receipts id (plain id: receivables is upstream; receipts.trip_id points back). */
    receiptId: text('receipt_id').notNull(),
    mode: text('mode').notNull(),
    amountPaise: paise('amount_paise').notNull(),
    collectedBy: text('collected_by').references(() => users.id),
    collectedAt: tz('collected_at').notNull().defaultNow(),
  },
  (t) => [
    index('collections_trip_idx').on(t.tenantId, t.tripId),
    uniqueIndex('collections_receipt_idx').on(t.tenantId, t.receiptId),
    tenantPolicy('collections_tenant'),
  ],
).enableRLS()

export const tripExpenses = pgTable(
  'trip_expenses',
  {
    id: id(),
    tenantId: tenantRef(),
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id),
    kind: text('kind').notNull(),
    amountPaise: paise('amount_paise').notNull(),
    proofObjectKey: text('proof_object_key'),
    note: text('note'),
    recordedBy: text('recorded_by').references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index('trip_expenses_trip_idx').on(t.tenantId, t.tripId),
    tenantPolicy('trip_expenses_tenant'),
  ],
).enableRLS()

/** End-of-trip reconciliation: pieces (loaded − delivered − sold − returned = on van) and cash (collected − expenses = handed over). */
export const tripSettlements = pgTable(
  'trip_settlements',
  {
    id: id(),
    tenantId: tenantRef(),
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id),
    expectedCashPaise: paise('expected_cash_paise').notNull(),
    handedOverCashPaise: paise('handed_over_cash_paise').notNull(),
    cashVariancePaise: paise('cash_variance_paise').notNull(),
    upiCollectedPaise: paise('upi_collected_paise').notNull().default(0),
    expensesPaise: paise('expenses_paise').notNull().default(0),
    /** [{lotId, expectedPcs, countedPcs}] — the van's remaining stock count; differences write ledger rows. */
    stockVariance: jsonb('stock_variance')
      .$type<{ lotId: string; expectedPcs: number; countedPcs: number }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    hasVariance: boolean('has_variance').notNull().default(false),
    settledBy: text('settled_by').references(() => users.id),
    settledAt: tz('settled_at').notNull().defaultNow(),
    note: text('note'),
  },
  (t) => [
    uniqueIndex('trip_settlements_trip_idx').on(t.tenantId, t.tripId),
    tenantPolicy('trip_settlements_tenant'),
  ],
).enableRLS()

/** Raw GPS breadcrumbs while a trip is active (trip-scoped consent, DPDP). Bypasses the sync queue. */
export const tripPoints = pgTable(
  'trip_points',
  {
    id: id(),
    tenantId: tenantRef(),
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id),
    userId: text('user_id').notNull(),
    recordedAt: tz('recorded_at').notNull(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    accuracyM: real('accuracy_m'),
    speedMps: real('speed_mps'),
    heading: real('heading'),
    battery: integer('battery'),
  },
  (t) => [
    index('trip_points_trip_time_idx').on(t.tenantId, t.tripId, t.recordedAt),
    // delivery staff insert their own points; owner/manager read
    pgPolicy('trip_points_read', {
      for: 'select',
      to: appRw,
      using: sql`tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system')`,
    }),
    pgPolicy('trip_points_insert', {
      for: 'insert',
      to: appRw,
      withCheck: sql`tenant_id = (SELECT current_setting('app.tenant_id', true)) AND user_id = (SELECT current_setting('app.actor_id', true))`,
    }),
  ],
).enableRLS()

/** One row per vehicle: latest position for the owner's live map (upserted from trip_points). */
export const vehiclePositions = pgTable(
  'vehicle_positions',
  {
    tenantId: tenantRef(),
    vehicleId: text('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    tripId: text('trip_id'),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    recordedAt: tz('recorded_at').notNull(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('vehicle_positions_vehicle_idx').on(t.tenantId, t.vehicleId),
    tenantPolicy('vehicle_positions_tenant'),
  ],
).enableRLS()
