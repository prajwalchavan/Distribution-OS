import { ORPCError } from '@orpc/server'
import { and, asc, eq, inArray, lte, sql, type SQL } from 'drizzle-orm'
import { gte } from 'drizzle-orm'
import type { PodPolicy, StopState, TripPolicy, TripState } from '@dos/contracts'
import {
  stopMachine,
  TransitionError,
  tripMachine,
  uuidv7,
  type StopEvent,
  type StopState as MachineStopState,
  type TripEvent,
} from '@dos/domain'
import {
  DEFAULT_GEOFENCE_METRES,
  DEFAULT_GPS_RETENTION_DAYS,
  DEFAULT_POD_REQUIRED,
  DEFAULT_SETTLEMENT_TOLERANCE_PAISE,
  featureFlags,
  fileObjects,
  locationConsents,
  outboxEvents,
  POD_REQUIRED_MODES,
  receipts,
  retailers,
  stockLots,
  TENANT_SETTING_KEYS,
  trips,
  tripStops,
  vehicles,
  type ActorRole,
  type Db,
} from '@dos/db'
import { currentTenant } from '../../platform/index.js'
import {
  ALLOWED_CONTENT_TYPES,
  assertTenantKey,
  createObjectStorage,
  objectKey,
  ObjectStorageError,
  parseObjectKey,
  type ObjectDomain,
} from '../../platform/object-storage.js'
import { loadSettings } from '../tenancy/index.js'

/**
 * The plumbing every delivery procedure shares: who may call what, the two state machines wrapped
 * into 409s, the crew check, the tenant's delivery policy, the vehicle and its location, the proof
 * bytes on the local storage driver, and the audit/outbox writers.
 *
 * NOTHING HERE READS MONEY except what a delivery crew is allowed to hand over: a bill's sale total
 * and the cash it collected. `tenant_product_costs` is never imported in this module — the delivery
 * role is one of the roles the ADR 0002 test dumps and greps.
 */

// ---------------------------------------------------------------------------------------------------------------
// who may call what (the tuples in `contracts/permissions.ts`, plus `system` for the worker)

/** The desk that runs the day and the godown that fills the van, plus the crew opening its own trip. */
export const TRIP_PLANNERS: readonly ActorRole[] = [
  'owner',
  'manager',
  'warehouse',
  'delivery',
  'system',
]
/** Everyone who holds stock somewhere or is handed the paperwork for it (a van counts). */
export const STOCK_VIEWERS: readonly ActorRole[] = [
  'owner',
  'manager',
  'accountant',
  'warehouse',
  'delivery',
  'system',
]
/** Who touches a doorstep record: the desk that corrects one and the crew at the door. */
export const DOORSTEP: readonly ActorRole[] = ['owner', 'manager', 'delivery', 'system']
/** Who takes money from a shopkeeper: the desk and the crew. NEVER the salesperson (docs/17 §D4). */
export const MONEY_COLLECTORS: readonly ActorRole[] = [
  'owner',
  'manager',
  'accountant',
  'delivery',
  'system',
]
/** Who looks at a shop's delivery status, the shop itself included (RLS narrows it to its own). */
export const MONEY_READERS: readonly ActorRole[] = [...MONEY_COLLECTORS, 'retailer']
/** The manager's-PIN steps and the DPDP-audited reads: the owner and the manager. */
export const PIN_HOLDERS: readonly ActorRole[] = ['owner', 'manager', 'system']

// ---------------------------------------------------------------------------------------------------------------
// state machines → 409

export function tripTransition(from: TripState, event: TripEvent): TripState {
  try {
    return tripMachine.next(from, event)
  } catch (error) {
    if (error instanceof TransitionError)
      throw new ORPCError('CONFLICT', { message: error.message, data: { from, event } })
    throw error
  }
}

export function stopTransition(from: MachineStopState, event: StopEvent): MachineStopState {
  try {
    return stopMachine.next(from, event)
  } catch (error) {
    if (error instanceof TransitionError)
      throw new ORPCError('CONFLICT', { message: error.message, data: { from, event } })
    throw error
  }
}

export const STOP_TERMINAL: ReadonlySet<StopState> = new Set([
  'delivered',
  'partial',
  'failed',
  'skipped',
])
export const TRIP_TERMINAL: ReadonlySet<TripState> = new Set([
  'settled',
  'settled_with_variance',
  'cancelled',
])
/** A trip the crew is out on: the only states a doorstep write, a collection or a GPS point belong to. */
export const TRIP_ON_THE_ROAD: ReadonlySet<TripState> = new Set(['active', 'closing'])

/**
 * The events that take a stop from where it is to `target`, every one of them through
 * `stopMachine.next`. The machine is strict (`pending → started → arrived → …`) and the road is not:
 * a crew that taps "shop closed" without ever tapping "arrived", or whose offline batch lost the
 * `arrive` op, still has to land the stop somewhere. Walking the machine keeps every intermediate
 * state legal and every timestamp stamped; a stop already at `target` is a no-op and one in a
 * different terminal state is the machine's own 409.
 */
export function stopEventsTo(
  from: MachineStopState,
  target: 'started' | 'arrived' | 'delivered' | 'partial' | 'failed',
): StopEvent[] {
  if (from === target) return []
  const ladder: MachineStopState[] = ['pending', 'started', 'arrived']
  const at = ladder.indexOf(from)
  if (at < 0) {
    // a different terminal state: let the machine say why
    stopTransition(
      from,
      target === 'delivered' ? 'deliver' : target === 'partial' ? 'deliver_partial' : 'fail',
    )
    return []
  }
  const events: StopEvent[] = []
  const targetRung = target === 'started' ? 1 : target === 'arrived' ? 2 : 3
  if (at < 1 && targetRung >= 1) events.push('start')
  if (at < 2 && targetRung >= 2) events.push('arrive')
  if (targetRung === 3)
    events.push(
      target === 'delivered' ? 'deliver' : target === 'partial' ? 'deliver_partial' : 'fail',
    )
  return events
}

// ---------------------------------------------------------------------------------------------------------------
// rows

export type TripRow = typeof trips.$inferSelect
export type StopRow = typeof tripStops.$inferSelect
export type VehicleRow = typeof vehicles.$inferSelect

/** A trip the caller may see, locked for the mutation. RLS already hides another crew's trip (404). */
export async function lockTrip(tx: Db, id: string): Promise<TripRow> {
  const [row] = await tx.select().from(trips).where(eq(trips.id, id)).for('update')
  if (!row) throw new ORPCError('NOT_FOUND', { message: `trip ${id} not found` })
  return row
}

export async function findTrip(tx: Db, id: string): Promise<TripRow> {
  const [row] = await tx.select().from(trips).where(eq(trips.id, id)).limit(1)
  if (!row) throw new ORPCError('NOT_FOUND', { message: `trip ${id} not found` })
  return row
}

export async function lockStop(tx: Db, id: string): Promise<StopRow> {
  const [row] = await tx.select().from(tripStops).where(eq(tripStops.id, id)).for('update')
  if (!row) throw new ORPCError('NOT_FOUND', { message: `stop ${id} not found` })
  return row
}

/**
 * The crew of a trip is its driver or its helper. RLS already hides another crew's trip from a
 * delivery actor (`trips_read`), so this only ever fires on a row the actor can see but is not on —
 * a helper reassigned mid-day, or a desk role — and answers 403 rather than letting the write through.
 */
export function assertCrewOrDesk(trip: TripRow, desk: readonly ActorRole[]): void {
  const ctx = currentTenant()
  if (desk.includes(ctx.actorRole)) return
  if (
    ctx.actorRole === 'delivery' &&
    (trip.driverId === ctx.actorId || trip.helperId === ctx.actorId)
  )
    return
  throw new ORPCError('FORBIDDEN', {
    message: `only the driver or the helper of trip ${trip.tripNo ?? trip.id} may do this`,
  })
}

export function isCrew(trip: TripRow): boolean {
  const ctx = currentTenant()
  return trip.driverId === ctx.actorId || trip.helperId === ctx.actorId
}

export async function loadVehicle(tx: Db, id: string): Promise<VehicleRow> {
  const [row] = await tx.select().from(vehicles).where(eq(vehicles.id, id)).limit(1)
  if (!row) throw new ORPCError('NOT_FOUND', { message: `vehicle ${id} not found` })
  return row
}

export async function loadVehicles(
  tx: Db,
  ids: readonly string[],
): Promise<Map<string, VehicleRow>> {
  const wanted = [...new Set(ids)]
  if (wanted.length === 0) return new Map()
  const rows = await tx.select().from(vehicles).where(inArray(vehicles.id, wanted))
  return new Map(rows.map((r) => [r.id, r]))
}

/** Shop names for the stop cards. `retailers` is upstream of delivery; a name is display, never credit. */
export async function retailerNames(tx: Db, ids: readonly string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids)]
  if (wanted.length === 0) return new Map()
  const rows = await tx
    .select({ id: retailers.id, name: retailers.name })
    .from(retailers)
    .where(inArray(retailers.id, wanted))
  return new Map(rows.map((r) => [r.id, r.name]))
}

export type RetailerRow = typeof retailers.$inferSelect

export async function findRetailer(tx: Db, id: string): Promise<RetailerRow> {
  const [row] = await tx.select().from(retailers).where(eq(retailers.id, id)).limit(1)
  if (!row) throw new ORPCError('NOT_FOUND', { message: `retailer ${id} not found` })
  return row
}

/**
 * The receipt number and the UTR / cheque number beside a collection. `collections.receipt_id` is a
 * plain id (receivables is upstream, `receipts.trip_id` points back).
 * // module-boundary: two DISPLAY columns of receivables' `receipts` are read here, the way warehouse
 * reads `vehicles.reg_no` for the challan (docs/plans/00-coordination.md §4). Nothing is written and no
 * amount is derived from it — the amount is the collection's own. Replace with a `ReceivablesService`
 * read helper if one is ever added; §3.1 sanctions no new receivables method for this slice.
 */
export async function receiptRefs(
  tx: Db,
  ids: readonly string[],
): Promise<Map<string, { receiptNo: string | null; reference: string | null }>> {
  const wanted = [...new Set(ids)]
  if (wanted.length === 0) return new Map()
  const rows = await tx
    .select({ id: receipts.id, receiptNo: receipts.receiptNo, reference: receipts.reference })
    .from(receipts)
    .where(inArray(receipts.id, wanted))
  return new Map(rows.map((r) => [r.id, { receiptNo: r.receiptNo, reference: r.reference }]))
}

export type LotRow = typeof stockLots.$inferSelect

export async function loadLots(tx: Db, ids: readonly string[]): Promise<Map<string, LotRow>> {
  const wanted = [...new Set(ids)]
  if (wanted.length === 0) return new Map()
  const rows = await tx.select().from(stockLots).where(inArray(stockLots.id, wanted))
  return new Map(rows.map((r) => [r.id, r]))
}

/** Variant names for the van-stock count; the lot's OWN case size wins over the sell-side pack (docs/17 A2). */
export async function variantNames(
  tx: Db,
  variantIds: readonly string[],
): Promise<Map<string, { name: string; sellCaseSize: number | null }>> {
  const ids = [...new Set(variantIds)]
  if (ids.length === 0) return new Map()
  const { tenantId } = currentTenant()
  const rows = await tx.execute(sql`
    select v.id as variant_id, v.name as variant_name,
           coalesce(tp.case_size_override, v.default_case_size) as case_size
      from product_variants v
      left join tenant_products tp on tp.variant_id = v.id and tp.tenant_id = ${tenantId}
     where v.id in (${sql.join(
       ids.map((i) => sql`${i}`),
       sql`, `,
     )})`)
  const raw = rows.rows as {
    variant_id: string
    variant_name: string
    case_size: number | string | null
  }[]
  return new Map(
    raw.map((r) => [
      r.variant_id,
      { name: r.variant_name, sellCaseSize: r.case_size === null ? null : Number(r.case_size) },
    ]),
  )
}

export function casesAndLoose(
  qtyPcs: number,
  caseSize: number | null,
): { cases: number; loosePcs: number } {
  if (caseSize === null || caseSize <= 0) return { cases: 0, loosePcs: qtyPcs }
  return { cases: Math.floor(qtyPcs / caseSize), loosePcs: qtyPcs % caseSize }
}

// ---------------------------------------------------------------------------------------------------------------
// the one documented escalation

/**
 * Run `fn` with `app.actor_role = 'system'` for the statements inside it, restoring the caller's role
 * afterwards inside the same transaction — the escalation pattern `modules/orders`' `recordTransition`
 * established, used here for exactly three DERIVED writes and reads whose policies are narrower than
 * the procedure's own role: the planned `deliveries` rows a WAREHOUSE planner's stop creates (the
 * doorstep write policy is the crew's and the desk's), the driver's consent a HELPER reads at depart
 * (a consent row is its owner's), and the crew's own GPS batch (`trip_points` is readable by the
 * owner and the manager only, and PostgreSQL applies the SELECT policy to the rows an
 * `INSERT … ON CONFLICT … RETURNING` proposes). `actor_id` never changes, so every row still records
 * who did it; nothing is widened beyond the statement.
 */
export async function asSystemRole<T>(tx: Db, fn: () => Promise<T>): Promise<T> {
  const ctx = currentTenant()
  if (ctx.actorRole === 'system') return fn()
  try {
    await tx.execute(sql`select set_config('app.actor_role', 'system', true)`)
    return await fn()
  } finally {
    await tx
      .execute(sql`select set_config('app.actor_role', ${ctx.actorRole}, true)`)
      .catch(() => undefined)
  }
}

// ---------------------------------------------------------------------------------------------------------------
// tenant policy

/**
 * The four `delivery.*` / `dpdp.*` settings, with the bootstrap defaults when a row is absent or
 * malformed. Read through tenancy's `loadSettings` (every staff role may read them since migration
 * 0009; a retailer never asks for a trip's policy). Copied onto every `TripDetail` so the offline
 * device carries the rules it must apply (docs/23 §8.4).
 */
export async function loadTripPolicy(tx: Db): Promise<TripPolicy> {
  const settings = await loadSettings(tx, [
    TENANT_SETTING_KEYS.deliverySettlementTolerancePaise,
    TENANT_SETTING_KEYS.deliveryPodRequired,
    TENANT_SETTING_KEYS.deliveryGeofenceMetres,
    TENANT_SETTING_KEYS.dpdpGpsRetentionDays,
  ])
  const int = (value: unknown, fallback: number, min = 0): number => {
    const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
    return Number.isSafeInteger(n) && n >= min ? n : fallback
  }
  const pod = settings.get(TENANT_SETTING_KEYS.deliveryPodRequired)
  const podRequired: PodPolicy =
    typeof pod === 'string' && (POD_REQUIRED_MODES as readonly string[]).includes(pod)
      ? (pod as PodPolicy)
      : DEFAULT_POD_REQUIRED
  return {
    settlementTolerancePaise: int(
      settings.get(TENANT_SETTING_KEYS.deliverySettlementTolerancePaise),
      DEFAULT_SETTLEMENT_TOLERANCE_PAISE,
    ),
    podRequired,
    geofenceMetres: int(
      settings.get(TENANT_SETTING_KEYS.deliveryGeofenceMetres),
      DEFAULT_GEOFENCE_METRES,
    ),
    gpsRetentionDays: int(
      settings.get(TENANT_SETTING_KEYS.dpdpGpsRetentionDays),
      DEFAULT_GPS_RETENTION_DAYS,
      1,
    ),
  }
}

/** `feature_flags.van_sales` — whether this distributor sells off the van at all (ADR 0013). */
export async function vanSalesFlag(tx: Db): Promise<boolean> {
  const { tenantId } = currentTenant()
  const [row] = await tx
    .select({ enabled: featureFlags.enabled })
    .from(featureFlags)
    .where(and(eq(featureFlags.tenantId, tenantId), eq(featureFlags.flag, 'van_sales')))
    .limit(1)
  return row?.enabled ?? false
}

/**
 * The driver's current answer to the location notice. `location_consents` is readable by its own
 * user and by the owner/manager; a HELPER departing the trip cannot see the driver's row, so the read
 * runs under the system role for that one statement — the same escalation pattern as
 * `modules/orders`' `recordTransition` — and the caller's role is restored inside the transaction.
 */
export async function driverConsentGranted(tx: Db, driverId: string): Promise<boolean> {
  const ctx = currentTenant()
  const read = async (): Promise<boolean> => {
    const [row] = await tx
      .select({ granted: locationConsents.granted, withdrawnAt: locationConsents.withdrawnAt })
      .from(locationConsents)
      .where(
        and(eq(locationConsents.tenantId, ctx.tenantId), eq(locationConsents.userId, driverId)),
      )
      .orderBy(sql`${locationConsents.grantedAt} desc`)
      .limit(1)
    return row !== undefined && row.granted && row.withdrawnAt === null
  }
  if (ctx.actorRole === 'system' || ctx.actorRole === 'owner' || ctx.actorRole === 'manager')
    return read()
  if (ctx.actorId === driverId) return read()
  return asSystemRole(tx, read)
}

// ---------------------------------------------------------------------------------------------------------------
// proof bytes (the local object-storage driver: `files.uploadUrl` answered `inline: true`)

const STORED_DOMAINS: readonly ObjectDomain[] = ['pod', 'expense']

/**
 * Store the bytes a device sent inline and register them in `file_objects` as `uploaded`, returning
 * the key `files.readUrl` will later sign. The key is the server's (`objectKey()`), never the client's.
 * On S3 the app has already PUT the bytes to the pre-signed URL and sends `objectKey` alone; that path
 * goes through `acceptObjectKey` below. Nothing else binary ever passes through the service.
 */
export async function storeInline(
  tx: Db,
  i: {
    domain: 'pod' | 'expense'
    entityId: string
    fileId: string
    mimeType: string
    contentBase64: string
  },
): Promise<string> {
  const ctx = currentTenant()
  const bytes = Buffer.from(i.contentBase64, 'base64')
  const ext = ALLOWED_CONTENT_TYPES[i.mimeType]?.extensions[0]
  if (!ext || bytes.length === 0)
    throw new ORPCError('BAD_REQUEST', { message: `${i.mimeType} is not a storable proof` })
  let key: string
  try {
    key = objectKey({
      tenantId: ctx.tenantId,
      domain: i.domain,
      entityId: i.entityId,
      name: i.fileId,
      ext,
    })
    await createObjectStorage().put(key, bytes, i.mimeType)
  } catch (error) {
    throw storageError(error)
  }
  await tx
    .insert(fileObjects)
    .values({
      id: i.fileId,
      tenantId: ctx.tenantId,
      domain: i.domain,
      entityId: i.entityId,
      objectKey: key,
      mimeType: i.mimeType,
      bytes: bytes.length,
      status: 'uploaded',
      uploadedBy: ctx.actorId,
      uploadedAt: new Date(),
    })
    .onConflictDoNothing()
  return key
}

/**
 * A key the app obtained from `files.uploadUrl` and PUT its bytes to: anchored at the caller's tenant
 * (another distributor's key is `invalid_key`, never their bytes), of the domain this row is about,
 * and — when it was registered — flipped to `uploaded` so the sweep never deletes it.
 */
export async function acceptObjectKey(
  tx: Db,
  key: string,
  domain: 'pod' | 'expense',
): Promise<string> {
  const ctx = currentTenant()
  try {
    assertTenantKey(key, ctx.tenantId)
  } catch (error) {
    throw storageError(error)
  }
  const parsed = parseObjectKey(key)
  if (!parsed || !STORED_DOMAINS.includes(parsed.domain) || parsed.domain !== domain)
    throw new ORPCError('BAD_REQUEST', {
      message: `objectKey must be a ${domain} key minted by files.uploadUrl`,
    })
  await tx
    .update(fileObjects)
    .set({ status: 'uploaded', uploadedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(fileObjects.tenantId, ctx.tenantId),
        eq(fileObjects.objectKey, key),
        eq(fileObjects.status, 'pending'),
      ),
    )
  return key
}

/** A short-lived read URL, or null when storage is not configured: a missing photo never 500s a screen. */
export async function signedReadUrl(
  key: string,
  ttlSeconds: number,
): Promise<{ url: string; expiresAt: string } | null> {
  try {
    const url = await createObjectStorage().getUrl(key, ttlSeconds)
    return { url, expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString() }
  } catch {
    return null
  }
}

function storageError(error: unknown): ORPCError<string, unknown> {
  if (error instanceof ObjectStorageError) {
    if (error.code === 'not_configured' || error.code === 'upstream')
      return new ORPCError('INTERNAL_SERVER_ERROR', { message: error.message })
    return new ORPCError('BAD_REQUEST', { message: error.message })
  }
  if (error instanceof ORPCError) return error as ORPCError<string, unknown>
  return new ORPCError('INTERNAL_SERVER_ERROR', { message: String(error) })
}

// ---------------------------------------------------------------------------------------------------------------
// geography

/** Great-circle distance in metres between two WGS-84 points (the geofence is evidence, never a block). */
export function haversineMetres(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const r = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * r * Math.asin(Math.min(1, Math.sqrt(h))))
}

// ---------------------------------------------------------------------------------------------------------------
// dates

export const istDayStart = (date: string): Date => new Date(`${date}T00:00:00.000+05:30`)
export const istDayEnd = (date: string): Date => new Date(`${date}T23:59:59.999+05:30`)

/** `from` / `to` as an inclusive IST window over a `timestamptz` column. */
export function dayWindow(
  column: Parameters<typeof gte>[0],
  from: string | undefined,
  to: string | undefined,
): (SQL | undefined)[] {
  return [
    from ? gte(column, istDayStart(from)) : undefined,
    to ? lte(column, istDayEnd(to)) : undefined,
  ]
}

export const defined = (filters: (SQL | undefined)[]): SQL[] =>
  filters.filter((f): f is SQL => f !== undefined)

export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null)

export const whenOr = (value: string | undefined, fallback: Date): Date =>
  value ? new Date(value) : fallback

// ---------------------------------------------------------------------------------------------------------------
// audit and outbox

export type DeliveryEventType =
  | 'TripPlanned'
  | 'TripLoading'
  | 'TripDeparted'
  | 'TripReturned'
  | 'TripCancelled'
  | 'StopFailed'
  | 'DeliveryRecorded'
  | 'CollectionRecorded'
  | 'VanSaleInvoiced'
  | 'TripSettled'
  | 'TripSettlementVariance'

/** Other modules react to the road through these events, never by reading its eleven tables. */
export async function emitDeliveryEvent(
  tx: Db,
  aggregateType: 'trip' | 'delivery' | 'collection',
  aggregateId: string,
  eventType: DeliveryEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  await tx.insert(outboxEvents).values({
    id: uuidv7(),
    tenantId: currentTenant().tenantId,
    aggregateType,
    aggregateId,
    eventType,
    payload,
  })
}

export const tripEventPayload = (trip: TripRow): Record<string, unknown> => ({
  tripId: trip.id,
  tripNo: trip.tripNo,
  vehicleId: trip.vehicleId,
  driverId: trip.driverId,
  state: trip.state,
  plannedStops: trip.plannedStops,
})

/** The stops of a trip in sequence order — the one query every trip screen starts from. */
export async function stopsOf(tx: Db, tripId: string): Promise<StopRow[]> {
  return tx
    .select()
    .from(tripStops)
    .where(eq(tripStops.tripId, tripId))
    .orderBy(asc(tripStops.sequence), asc(tripStops.id))
}

/** Drizzle wraps driver errors; the SQLSTATE is on `cause.code`. 23505 = unique_violation. */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } }
  return e.code === '23505' || e.cause?.code === '23505'
}

/** 23503 = foreign_key_violation: a client-supplied id that names no row is the client's mistake. */
export function isForeignKeyViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } }
  return e.code === '23503' || e.cause?.code === '23503'
}
