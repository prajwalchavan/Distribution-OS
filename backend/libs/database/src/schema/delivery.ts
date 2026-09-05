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
  BACK_OFFICE_ROLES,
  id,
  MANAGEMENT_ROLES,
  paise,
  pieces,
  roleReadPolicy,
  roleWritePolicies,
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
 *
 * WHO SEES WHAT (migration 0014, docs/plans/00-coordination.md §5.3, docs/plans/delivery.md §3.8, tightened
 * by the founder's rules in docs/22 §6 and §9):
 *
 *   - the DESK (owner, manager, accountant, system) reads every row of every table here; the accountant
 *     writes only the money rows it reconciles (collections, expenses, the settlement);
 *   - the GODOWN (warehouse) plans and loads: it reads vehicles and trips and writes trips and stops;
 *   - the CREW (delivery) reads and writes ONLY the rows of a trip it is the driver or the helper of —
 *     `crewOfTrip()` below — never another crew's trip, its cash or its stops;
 *   - the SHOP (retailer) sees the delivery status of its own bills — its stops, its deliveries, their
 *     lines and proof — and nothing else: no trip, no vehicle, no cash, no coordinates;
 *   - the REP (salesperson) sees the stop status of its shops (`trip_stops_read`, every stop as before)
 *     and NOTHING else in this module; a rep never collects money (docs/17 §D4) and never rides the van.
 *
 * GPS breadcrumbs (`trip_points`) and the live map (`vehicle_positions`) are personal data under the DPDP
 * Act: read by the owner and the manager only (every read is audited, docs/17 A12), written by the crew
 * of the active trip, never updated, never deleted through the app — the worker's retention sweep runs as
 * app_worker and is what removes them after `dpdp.gps_retention_days`.
 */

const tenantMatch = `tenant_id = (SELECT current_setting('app.tenant_id', true))`
const actor = `(SELECT current_setting('app.actor_id', true))`
const role = `(SELECT current_setting('app.actor_role', true))`
const roleIn = (roles: readonly string[]) => `${role} IN (${roles.map((r) => `'${r}'`).join(', ')})`

/** Who plans a trip and loads the van: the desk that runs the day and the godown that fills it. */
export const TRIP_PLANNER_ROLES = ['owner', 'manager', 'warehouse', 'system'] as const
/** Who reads the trip board: the desk, the godown, and the crew (its own trips only, see `crewOfTrip`). */
const TRIP_READER_ROLES = ['owner', 'manager', 'accountant', 'warehouse', 'system'] as const
/** Who writes a doorstep record: the desk that corrects one, and the crew at the door. Never the accountant. */
const DOORSTEP_DESK_ROLES = ['owner', 'manager', 'system'] as const
/** Who reads raw GPS and the live map (DPDP: the fewest people that can run the day). */
const GPS_READER_ROLES = ['owner', 'manager', 'system'] as const

/**
 * The delivery actor is the driver or the helper of the trip the row hangs off. The sub-select runs under
 * `trips`' own policy, so a crew member can only ever match a trip it is on; a policy that mentions this
 * predicate never needs to repeat the crew check on `trips`.
 */
const crewOfTrip = (tripColumn: string) =>
  `(${role} = 'delivery' AND EXISTS (
        SELECT 1 FROM trips t
        WHERE t.id = ${tripColumn} AND (t.driver_id = ${actor} OR t.helper_id = ${actor})
      ))`

/** The shop whose bill this row is about, through the denormalised link (never `retailer_identities`, 42P17). */
const ownShop = (retailerColumn: string) =>
  `(${role} = 'retailer' AND ${retailerColumn} IN (
        SELECT l.retailer_id FROM retailer_links l
        WHERE l.tenant_id = (SELECT current_setting('app.tenant_id', true))
          AND l.user_id = ${actor}
          AND l.status = 'active'
      ))`

/** A row is reachable when the delivery it belongs to is: leans on `deliveries`' own read policy. */
const throughDelivery = (deliveryColumn: string) =>
  `(${role} IN ('delivery', 'retailer') AND EXISTS (SELECT 1 FROM deliveries d WHERE d.id = ${deliveryColumn}))`

/**
 * The delivery actor is crew on a trip of this vehicle that is out right now (loading, active or closing).
 * Keyed on the vehicle, not the position row's `trip_id`, so the first upsert of a new trip may overwrite
 * a row still stamped with yesterday's trip by another crew.
 */
const crewOfVehicleOnTheRoad = (vehicleColumn: string) =>
  `(${role} = 'delivery' AND EXISTS (
        SELECT 1 FROM trips t
        WHERE t.vehicle_id = ${vehicleColumn}
          AND (t.driver_id = ${actor} OR t.helper_id = ${actor})
          AND t.state IN ('loading', 'active', 'closing')
      ))`

/** On `trips` itself the crew check needs no sub-select: the columns are on the row. */
const crewOfThisTrip = `(${role} = 'delivery' AND (driver_id = ${actor} OR helper_id = ${actor}))`

/** The crew may write a line or a proof only on a delivery of its own trip. */
const crewOfDelivery = (deliveryColumn: string) =>
  `(${role} = 'delivery' AND EXISTS (
        SELECT 1 FROM deliveries d JOIN trips t ON t.id = d.trip_id
        WHERE d.id = ${deliveryColumn} AND (t.driver_id = ${actor} OR t.helper_id = ${actor})
      ))`

const readPolicy = (name: string, predicate: string) =>
  pgPolicy(name, { for: 'select', to: appRw, using: sql.raw(`${tenantMatch} AND (${predicate})`) })

/** INSERT + UPDATE under one predicate (no DELETE implied), for rows the crew appends to its own trip. */
const insertUpdatePolicies = (name: string, predicate: string) => {
  const p = sql.raw(`${tenantMatch} AND (${predicate})`)
  return [
    pgPolicy(`${name}_insert`, { for: 'insert', to: appRw, withCheck: p }),
    pgPolicy(`${name}_update`, { for: 'update', to: appRw, using: p, withCheck: p }),
  ]
}

const deletePolicy = (name: string, roles: readonly string[]) =>
  pgPolicy(name, {
    for: 'delete',
    to: appRw,
    using: sql.raw(`${tenantMatch} AND ${roleIn(roles)}`),
  })

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
  (t) => [
    /** Delta pull for the offline device: rows changed since its cursor (own sync, docs/22 §8). */
    index('vehicles_updated_idx').on(t.tenantId, t.updatedAt),
    uniqueIndex('vehicles_reg_idx').on(t.tenantId, t.regNo),
    // the fleet is read by everyone who loads, drives or accounts for it; only the owner/manager add to it
    roleReadPolicy('vehicles_read', [...TRIP_READER_ROLES, 'delivery']),
    ...roleWritePolicies('vehicles_write', MANAGEMENT_ROLES),
  ],
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
    /** Delta pull for the offline device: rows changed since its cursor (own sync, docs/22 §8). */
    index('trips_updated_idx').on(t.tenantId, t.updatedAt),
    index('trips_date_idx').on(t.tenantId, t.tripDate),
    index('trips_state_idx').on(t.tenantId, t.state),
    index('trips_driver_idx').on(t.tenantId, t.driverId, t.tripDate),
    // the desk and the godown see the board; the crew sees the trips it is on; a shop and a rep see none
    readPolicy('trips_read', `${roleIn(TRIP_READER_ROLES)} OR ${crewOfThisTrip}`),
    // planners create; the crew may open a trip only with itself on it (and never hand it to someone else)
    pgPolicy('trips_insert', {
      for: 'insert',
      to: appRw,
      withCheck: sql.raw(`${tenantMatch} AND (${roleIn(TRIP_PLANNER_ROLES)} OR ${crewOfThisTrip})`),
    }),
    // depart/return by the crew, cancel by the desk, settle by the money desk (accountant included)
    pgPolicy('trips_update', {
      for: 'update',
      to: appRw,
      using: sql.raw(`${tenantMatch} AND (${roleIn(TRIP_READER_ROLES)} OR ${crewOfThisTrip})`),
      withCheck: sql.raw(`${tenantMatch} AND (${roleIn(TRIP_READER_ROLES)} OR ${crewOfThisTrip})`),
    }),
    deletePolicy('trips_delete', MANAGEMENT_ROLES),
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
    /** Delta pull for the offline device: rows changed since its cursor (own sync, docs/22 §8). */
    index('trip_stops_updated_idx').on(t.tenantId, t.updatedAt),
    uniqueIndex('trip_stops_sequence_idx').on(t.tenantId, t.tripId, t.sequence),
    index('trip_stops_retailer_idx').on(t.tenantId, t.retailerId),
    // the desk, the godown and the rep see every stop ("where is my shop's order"); the crew sees the
    // stops of its own trips; the retailer sees its own shop's stops (the ETA in its app)
    readPolicy(
      'trip_stops_read',
      `${role} NOT IN ('delivery', 'retailer') OR ${crewOfTrip('trip_stops.trip_id')} OR ${ownShop('trip_stops.retailer_id')}`,
    ),
    // planners add and reorder; the crew starts, arrives at and fails the stops of its own trip
    ...insertUpdatePolicies(
      'trip_stops_write',
      `${roleIn(TRIP_PLANNER_ROLES)} OR ${crewOfTrip('trip_stops.trip_id')}`,
    ),
    deletePolicy('trip_stops_delete', MANAGEMENT_ROLES),
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
    /**
     * The shop, copied from the stop (migration 0014/0015): the column the retailer's read policy and the
     * shop's proof-of-delivery list key on. `dos_deliveries_retailer_guard` keeps it equal to the stop's.
     */
    retailerId: text('retailer_id')
      .notNull()
      .references(() => retailers.id),
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
    /** Which phone recorded the doorstep write (audit, and the "where is my order" answer). */
    deviceId: text('device_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    ...timestamps,
  },
  (t) => [
    /** Delta pull for the offline device: rows changed since its cursor (own sync, docs/22 §8). */
    index('deliveries_updated_idx').on(t.tenantId, t.updatedAt),
    uniqueIndex('deliveries_idempotency_idx').on(t.tenantId, t.idempotencyKey),
    /** One invoice is delivered at most once per stop; a second attempt is a new stop. */
    uniqueIndex('deliveries_stop_invoice_idx').on(t.tenantId, t.stopId, t.invoiceId),
    index('deliveries_invoice_idx').on(t.tenantId, t.invoiceId),
    index('deliveries_trip_idx').on(t.tenantId, t.tripId),
    /** The shop's proof-of-delivery list, newest first. */
    index('deliveries_retailer_idx').on(t.tenantId, t.retailerId, t.deliveredAt),
    // the desk reads all; the crew its own trip's; the shop its own bills'; the rep and the godown none
    readPolicy(
      'deliveries_read',
      `${roleIn(BACK_OFFICE_ROLES)} OR ${crewOfTrip('deliveries.trip_id')} OR ${ownShop('deliveries.retailer_id')}`,
    ),
    // recorded at the door by the crew, corrected by the owner or manager; never by the accountant or a shop
    ...insertUpdatePolicies(
      'deliveries_write',
      `${roleIn(DOORSTEP_DESK_ROLES)} OR ${crewOfTrip('deliveries.trip_id')}`,
    ),
    deletePolicy('deliveries_delete', MANAGEMENT_ROLES),
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
    /** Delta pull for the offline device: rows changed since its cursor (own sync, docs/22 §8). */
    index('delivery_lines_updated_idx').on(t.tenantId, t.updatedAt),
    index('delivery_lines_delivery_idx').on(t.tenantId, t.deliveryId),
    // reachable exactly when the delivery is (its policy scopes the crew and the shop)
    readPolicy(
      'delivery_lines_read',
      `${roleIn(BACK_OFFICE_ROLES)} OR ${throughDelivery('delivery_lines.delivery_id')}`,
    ),
    ...insertUpdatePolicies(
      'delivery_lines_write',
      `${roleIn(DOORSTEP_DESK_ROLES)} OR ${crewOfDelivery('delivery_lines.delivery_id')}`,
    ),
    deletePolicy('delivery_lines_delete', MANAGEMENT_ROLES),
  ],
).enableRLS()

export const podKind = pgEnum('pod_kind', ['photo', 'signature', 'otp', 'geo'])

/**
 * Proof of delivery: photo of the signed bill, signature, OTP, or the geo-fence check. Append-only through
 * the app: no DELETE policy at all (docs/plans/delivery.md §4 rule 20); it stays with the invoice forever.
 */
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
    readPolicy(
      'pod_evidence_read',
      `${roleIn(BACK_OFFICE_ROLES)} OR ${throughDelivery('pod_evidence.delivery_id')}`,
    ),
    ...insertUpdatePolicies(
      'pod_evidence_write',
      `${roleIn(DOORSTEP_DESK_ROLES)} OR ${crewOfDelivery('pod_evidence.delivery_id')}`,
    ),
  ],
).enableRLS()

/**
 * A collection event on a trip (what the crew handed over). The money itself is a receivables.receipts row
 * (created by the same command); this row exists for the trip settlement and the crew's day summary.
 * Money on the trip: the money desk and the crew that took it, never a rep, a shop or the godown.
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
    readPolicy(
      'collections_read',
      `${roleIn(BACK_OFFICE_ROLES)} OR ${crewOfTrip('collections.trip_id')}`,
    ),
    ...insertUpdatePolicies(
      'collections_write',
      `${roleIn(BACK_OFFICE_ROLES)} OR ${crewOfTrip('collections.trip_id')}`,
    ),
    deletePolicy('collections_delete', MANAGEMENT_ROLES),
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
    readPolicy(
      'trip_expenses_read',
      `${roleIn(BACK_OFFICE_ROLES)} OR ${crewOfTrip('trip_expenses.trip_id')}`,
    ),
    ...insertUpdatePolicies(
      'trip_expenses_write',
      `${roleIn(BACK_OFFICE_ROLES)} OR ${crewOfTrip('trip_expenses.trip_id')}`,
    ),
    deletePolicy('trip_expenses_delete', MANAGEMENT_ROLES),
  ],
).enableRLS()

/**
 * End-of-trip reconciliation: pieces (loaded − delivered − sold − returned = on van) and cash (collected −
 * expenses = handed over). Written by the money desk only; the crew reads its own (the check-in cockpit).
 * A red settlement (`has_variance`) carries the owner's approval — `dos_trip_settlement_guard` (0015).
 */
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
    /** The owner who accepted a variance outside tolerance — separate from who keyed the settlement. */
    approvedBy: text('approved_by').references(() => users.id),
    approvedAt: tz('approved_at'),
    note: text('note'),
  },
  (t) => [
    uniqueIndex('trip_settlements_trip_idx').on(t.tenantId, t.tripId),
    readPolicy(
      'trip_settlements_read',
      `${roleIn(BACK_OFFICE_ROLES)} OR ${crewOfTrip('trip_settlements.trip_id')}`,
    ),
    ...insertUpdatePolicies('trip_settlements_write', roleIn(BACK_OFFICE_ROLES)),
    deletePolicy('trip_settlements_delete', MANAGEMENT_ROLES),
  ],
).enableRLS()

/**
 * Raw GPS breadcrumbs while a trip is active (trip-scoped consent, DPDP). Bypasses the sync queue; deduped
 * by `trip_points_dedupe_idx` (a two-person crew carries two phones, ADR 0012) instead of idempotency rows.
 * Owner/manager read (audited), the crew of the trip inserts under its own user id, nobody updates or
 * deletes through the app — the worker's retention sweep (app_worker) prunes them.
 */
export const tripPoints = pgTable(
  'trip_points',
  {
    id: id(),
    tenantId: tenantRef(),
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id),
    userId: text('user_id').notNull(),
    /** The phone that recorded the point: driver and helper each carry one. */
    deviceId: text('device_id').notNull(),
    recordedAt: tz('recorded_at').notNull(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    accuracyM: real('accuracy_m'),
    speedMps: real('speed_mps'),
    heading: real('heading'),
    battery: integer('battery'),
  },
  (t) => [
    /** Time-range scans within a trip (trace replay, retention); kept beside the dedupe index (§5.4). */
    index('trip_points_trip_time_idx').on(t.tenantId, t.tripId, t.recordedAt),
    /** Replay of an offline batch is free: `onConflictDoNothing` on this key. */
    uniqueIndex('trip_points_dedupe_idx').on(t.tenantId, t.tripId, t.deviceId, t.recordedAt),
    readPolicy('trip_points_read', roleIn(GPS_READER_ROLES)),
    pgPolicy('trip_points_insert', {
      for: 'insert',
      to: appRw,
      withCheck: sql.raw(
        `${tenantMatch} AND user_id = ${actor} AND (${role} = 'system' OR ${crewOfTrip('trip_points.trip_id')})`,
      ),
    }),
  ],
).enableRLS()

/**
 * One row per vehicle: latest position for the owner's live map (upserted from trip_points). The crew of
 * the vehicle's current trip upserts it; the owner and the manager read it.
 */
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
    readPolicy(
      'vehicle_positions_read',
      `${roleIn(GPS_READER_ROLES)} OR ${crewOfVehicleOnTheRoad('vehicle_positions.vehicle_id')}`,
    ),
    ...insertUpdatePolicies(
      'vehicle_positions_write',
      `${roleIn(GPS_READER_ROLES)} OR ${crewOfVehicleOnTheRoad('vehicle_positions.vehicle_id')}`,
    ),
    deletePolicy('vehicle_positions_delete', MANAGEMENT_ROLES),
  ],
).enableRLS()
