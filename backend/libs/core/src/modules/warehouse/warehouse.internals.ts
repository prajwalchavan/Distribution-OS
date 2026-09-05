import { ORPCError } from '@orpc/server'
import { and, asc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm'
import { paise, percentOf, uuidv7 } from '@dos/domain'
import {
  auditLog,
  DEFAULT_EWB_INTRA_STATE_THRESHOLD_PAISE,
  hsnRates,
  locations,
  memberships,
  outboxEvents,
  stockLots,
  tenantSettings,
  TENANT_SETTING_KEYS,
  vehicles,
  type ActorRole,
  type Db,
} from '@dos/db'
import { currentTenant } from '../../platform/index.js'

/**
 * The plumbing every warehouse procedure shares: who may call what, the two numbering series, the
 * catalogue lookups a picking sheet needs, the FEFO candidate list, the e-way-bill threshold and the
 * audit/outbox writers.
 *
 * NOTHING HERE READS MONEY except the two places the module is allowed to (warehouse §4.9): a lot's MRP,
 * which is the declared value of van stock on a Rule 55 challan, and the GST rate that goes beside it.
 * `tenant_product_costs` is not imported anywhere in this module and must never be — a picker who can
 * back a purchase rate out of a screen is the failure ADR 0002 exists to prevent.
 */

// ---------------------------------------------------------------------------------------------------------------
// who may call what (the tuples in `contracts/permissions.ts`, plus `system` for the worker)

/** The godown floor and the desk above it. A rep or a shopkeeper is never here. */
export const WAREHOUSE_DESK: readonly ActorRole[] = ['owner', 'manager', 'warehouse', 'system']

/** Reads a crew needs on the road, plus the accountant who reconciles the paperwork. */
export const FULFILMENT_READERS: readonly ActorRole[] = [
  'owner',
  'manager',
  'accountant',
  'warehouse',
  'delivery',
  'system',
]

/**
 * The manager's-PIN steps: load-out, picklist cancel. Holding an owner/manager token IS the PIN — no
 * separate four-digit code is stored (coordination §7 question 15; a real step-up factor belongs to the
 * auth module, not here).
 */
export const PIN_HOLDERS: readonly ActorRole[] = ['owner', 'manager', 'system']

// ---------------------------------------------------------------------------------------------------------------
// numbering, dates and bounds

/** Internal paper, allocated at picklist create. */
export const PICK_SERIES = 'PICK'
/** The Rule 55 delivery challan, allocated only inside `loadSheets.confirm` — never at draft (ADR 0001). */
export const DC_SERIES = 'DC'

/** docs/20 rule 3: bounded work per request. A wave is 200 orders and at most this many pick rows. */
export const MAX_PICK_ROWS = 2_000

export const istDayStart = (date: string): Date => new Date(`${date}T00:00:00.000+05:30`)
export const istDayEnd = (date: string): Date => new Date(`${date}T23:59:59.999+05:30`)

/**
 * Display-only pack maths (warehouse §4.1). Pieces are the only quantity stored; a case count is
 * computed at the edge from the case size that applies to THOSE pieces — the lot's own where it has one
 * (a promo batch changes it per batch, docs/17 A2), the sell-side pack otherwise. A lot with no case
 * size at all shows every piece loose rather than inventing a pack.
 */
export function casesAndLoose(
  qtyPcs: number,
  caseSize: number | null,
): { cases: number; loosePcs: number } {
  if (caseSize === null || caseSize <= 0) return { cases: 0, loosePcs: qtyPcs }
  return { cases: Math.floor(qtyPcs / caseSize), loosePcs: qtyPcs % caseSize }
}

// ---------------------------------------------------------------------------------------------------------------
// catalogue

export interface VariantInfo {
  variantName: string
  productName: string
  hsnCode: string
  /** `coalesce(tenant_products.case_size_override, product_variants.default_case_size)`. */
  sellCaseSize: number | null
}

/** Names and the HSN for the picking sheet and the challan. Never a rate, never a cost. */
export async function loadVariantInfo(
  tx: Db,
  variantIds: readonly string[],
): Promise<Map<string, VariantInfo>> {
  const ids = [...new Set(variantIds)].filter((v) => v.length > 0)
  if (ids.length === 0) return new Map()
  const { tenantId } = currentTenant()
  const rows = await tx.execute(sql`
    select v.id as variant_id, v.name as variant_name, p.name as product_name, v.hsn_code,
           coalesce(tp.case_size_override, v.default_case_size) as case_size
      from product_variants v
      join products p on p.id = v.product_id
      left join tenant_products tp on tp.variant_id = v.id and tp.tenant_id = ${tenantId}
     where v.id in (${sql.join(
       ids.map((i) => sql`${i}`),
       sql`, `,
     )})`)
  const raw = rows.rows as {
    variant_id: string
    variant_name: string
    product_name: string
    hsn_code: string
    case_size: number | string | null
  }[]
  return new Map(
    raw.map((r) => [
      r.variant_id,
      {
        variantName: r.variant_name,
        productName: r.product_name,
        hsnCode: r.hsn_code,
        sellCaseSize: r.case_size === null ? null : Number(r.case_size),
      },
    ]),
  )
}

export type LotRow = typeof stockLots.$inferSelect

export async function loadLots(tx: Db, lotIds: readonly string[]): Promise<Map<string, LotRow>> {
  const ids = [...new Set(lotIds)].filter((id) => id.length > 0)
  if (ids.length === 0) return new Map()
  const rows = await tx.select().from(stockLots).where(inArray(stockLots.id, ids))
  return new Map(rows.map((r) => [r.id, r]))
}

/** The GST rate that applied to each HSN on a given date; a missing rate is a 400 naming the HSN. */
export async function loadGstBps(
  tx: Db,
  hsnCodes: readonly string[],
  on: string,
): Promise<Map<string, number>> {
  const wanted = [...new Set(hsnCodes)].filter((c) => c.length > 0)
  if (wanted.length === 0) return new Map()
  const rows = await tx
    .select({
      hsnCode: hsnRates.hsnCode,
      gstBps: hsnRates.gstBps,
      effectiveFrom: hsnRates.effectiveFrom,
      effectiveTo: hsnRates.effectiveTo,
    })
    .from(hsnRates)
    .where(and(inArray(hsnRates.hsnCode, wanted), lte(hsnRates.effectiveFrom, on)))
    .orderBy(hsnRates.hsnCode, hsnRates.effectiveFrom)
  const map = new Map<string, number>()
  for (const row of rows) {
    if (row.effectiveTo !== null && row.effectiveTo < on) continue
    map.set(row.hsnCode, row.gstBps)
  }
  const missing = wanted.filter((code) => !map.has(code))
  if (missing.length > 0)
    throw new ORPCError('BAD_REQUEST', {
      message: `no GST rate for HSN ${missing.join(', ')} on ${on}; add an hsn_rates row`,
      data: { hsnCodes: missing, on },
    })
  return map
}

/** Tax on a declared challan value, at the line's own rate. */
export const gstOn = (taxableValuePaise: number, gstBps: number): number =>
  percentOf(paise(taxableValuePaise), gstBps)

// ---------------------------------------------------------------------------------------------------------------
// FEFO

export interface FefoCandidate {
  lotId: string
  expiryDate: string | null
  available: number
}

/**
 * Sellable lots of one variant at one location, EARLIEST EXPIRY FIRST then oldest lot (a UUIDv7 lot id
 * orders by the moment the batch was created, which is its received date). Read through the
 * `sellable_stock` view, so it is `on_hand - reserved` — pieces already held for someone else are not
 * offered to this picker.
 *
 * FEFO WARNS, IT NEVER BLOCKS (warehouse §4.3, docs/design R03): this list is a suggestion. What the
 * picker actually took is recorded either way, with `fefo_override` and a warning when it is not the
 * batch the server proposed.
 */
export async function fefoLots(
  tx: Db,
  variantId: string,
  locationId: string,
): Promise<FefoCandidate[]> {
  const { tenantId } = currentTenant()
  const rows = await tx.execute(sql`
    select lot_id, expiry_date, available from sellable_stock
     where tenant_id = ${tenantId} and variant_id = ${variantId} and location_id = ${locationId}
     order by expiry_date asc nulls last, lot_id asc`)
  return (rows.rows as { lot_id: string; expiry_date: string | null; available: number | string }[])
    .map((r) => ({
      lotId: r.lot_id,
      expiryDate: r.expiry_date,
      available: Number(r.available),
    }))
    .filter((r) => r.available > 0)
}

// ---------------------------------------------------------------------------------------------------------------
// locations

export interface VehicleLocation {
  id: string
  name: string
  /** The registration plate printed on the challan (Rule 55), or null when no vehicle row names it. */
  regNo: string | null
}

/** Where a load leaves from when the caller names no location of its own. */
export async function activeWarehouseLocation(tx: Db): Promise<string> {
  const { tenantId } = currentTenant()
  const [row] = await tx
    .select({ id: locations.id })
    .from(locations)
    .where(
      and(
        eq(locations.tenantId, tenantId),
        eq(locations.kind, 'warehouse'),
        eq(locations.active, true),
      ),
    )
    .orderBy(asc(locations.id))
    .limit(1)
  if (!row)
    throw new ORPCError('BAD_REQUEST', {
      message: 'this distributor has no active warehouse location (bootstrap it first)',
    })
  return row.id
}

/**
 * The vehicle a load goes onto, with the registration number the challan must print.
 *
 * // module-boundary: `vehicles` is DELIVERY's table (coordination §4 lists no warehouse → delivery
 * edge) and delivery is built after this slice, so there is no service to ask. What is read is one
 * display column — the plate — of the very location the stock is moving to, because GST Rule 55(1)(f)
 * requires it on the challan. It is a LEFT JOIN and a null is tolerated (the location's own name is
 * shown instead), so warehouse still works on a tenant with no `vehicles` row at all. Replace this with
 * `DeliveryService.vehicleForLocation(tx, id)` when the delivery slice lands.
 */
export async function vehicleLocation(tx: Db, locationId: string): Promise<VehicleLocation> {
  const { tenantId } = currentTenant()
  const [row] = await tx
    .select({
      id: locations.id,
      name: locations.name,
      kind: locations.kind,
      active: locations.active,
      regNo: vehicles.regNo,
    })
    .from(locations)
    .leftJoin(vehicles, eq(vehicles.locationId, locations.id))
    .where(and(eq(locations.tenantId, tenantId), eq(locations.id, locationId)))
    .limit(1)
  if (!row) throw new ORPCError('NOT_FOUND', { message: `location ${locationId} not found` })
  if (row.kind !== 'vehicle')
    throw new ORPCError('BAD_REQUEST', {
      message: `location ${locationId} is a ${row.kind}; a load sheet goes onto a vehicle`,
    })
  if (!row.active)
    throw new ORPCError('BAD_REQUEST', { message: `vehicle location ${locationId} is not active` })
  return { id: row.id, name: row.name, regNo: row.regNo }
}

/** The plate for a sheet already built, without re-validating the location. Null when unknown. */
export async function vehicleRegNos(
  tx: Db,
  locationIds: readonly string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(locationIds)].filter((id) => id.length > 0)
  if (ids.length === 0) return new Map()
  const { tenantId } = currentTenant()
  const rows = await tx
    .select({ locationId: vehicles.locationId, regNo: vehicles.regNo })
    .from(vehicles)
    .where(and(eq(vehicles.tenantId, tenantId), inArray(vehicles.locationId, ids)))
  return new Map(rows.map((r) => [r.locationId, r.regNo]))
}

// ---------------------------------------------------------------------------------------------------------------
// settings

/**
 * The value a vehicle load may not exceed without an e-way bill, in paise. Read from `tenant_settings`
 * — readable by every staff role since migration 0009 — and NEVER hard-coded at the call site: the
 * founder changes the row after confirming Maharashtra's figure with the CA (docs/17 A8). An absent or
 * malformed row falls back to the ₹1,00,000 default `bootstrapTenant` seeds.
 */
export async function ewbThresholdPaise(tx: Db): Promise<number> {
  const { tenantId } = currentTenant()
  const [row] = await tx
    .select({ value: tenantSettings.value })
    .from(tenantSettings)
    .where(
      and(
        eq(tenantSettings.tenantId, tenantId),
        eq(tenantSettings.key, TENANT_SETTING_KEYS.ewbIntraStateThreshold),
      ),
    )
    .limit(1)
  const raw = row?.value
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_EWB_INTRA_STATE_THRESHOLD_PAISE
}

/**
 * The person a wave is handed to must actually work here. Without this the foreign key answers with a
 * 500 and the picker is told nothing; with it the app is told which id it invented.
 */
export async function assertTenantMember(tx: Db, userId: string): Promise<void> {
  const { tenantId } = currentTenant()
  const [row] = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        eq(memberships.userId, userId),
        eq(memberships.status, 'active'),
      ),
    )
    .limit(1)
  if (!row)
    throw new ORPCError('BAD_REQUEST', {
      message: `user ${userId} is not an active member of this distributor`,
    })
}

// ---------------------------------------------------------------------------------------------------------------
// audit and outbox

/**
 * Other modules react to the godown through these events, never by reading its five tables (docs/16 §2).
 * `OrderPicking` / `OrderPacked` / `OrderDispatched` are NOT emitted here — `applyFulfilmentEvent`
 * writes them beside the order's own transition row, which is the point of going through it.
 */
export type WarehouseEventType =
  'PicklistStarted' | 'LoadSheetApproved' | 'LoadSheetConfirmed' | 'DeliveryChallanIssued'

export async function emitWarehouseEvent(
  tx: Db,
  aggregateType: 'picklist' | 'load_sheet' | 'delivery_challan',
  aggregateId: string,
  eventType: WarehouseEventType,
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

/** The two steps that need a named trail: freeing someone's stock, and typing in an e-way bill number. */
export async function writeAudit(
  tx: Db,
  entry: {
    action: string
    entityType: string
    entityId: string
    before?: Record<string, unknown> | null
    after?: Record<string, unknown> | null
    deviceId?: string | null
  },
): Promise<void> {
  const ctx = currentTenant()
  await tx.insert(auditLog).values({
    id: uuidv7(),
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    actorRole: ctx.actorRole,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    before: entry.before ?? null,
    after: entry.after ?? null,
    deviceId: entry.deviceId ?? null,
  })
}

// ---------------------------------------------------------------------------------------------------------------
// small shared bits

/**
 * A client-supplied id that names no row is the CLIENT's mistake, not a server fault: `assigned_to`,
 * `beat_id` and `location_id` are all real foreign keys, and an app (or a docs example) that invents
 * one must get a 400 saying so rather than a 500 from Postgres. 23503 = foreign_key_violation.
 */
export function isForeignKeyViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } }
  return e.code === '23503' || e.cause?.code === '23503'
}

/** Drizzle wraps driver errors; the SQLSTATE is on `cause.code`. 23505 = unique_violation. */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } }
  return e.code === '23505' || e.cause?.code === '23505'
}

export function pgConstraint(err: unknown): string | undefined {
  const e = err as { constraint?: string; cause?: { constraint?: string } }
  return e.cause?.constraint ?? e.constraint
}

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
