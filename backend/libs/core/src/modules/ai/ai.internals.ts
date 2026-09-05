import { ORPCError } from '@orpc/server'
import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  aiOrderDrafts,
  outboxEvents,
  retailerLinks,
  retailers,
  tenantSettings,
  type ActorRole,
  type Db,
} from '@dos/db'
import { uuidv7 } from '@dos/domain'
import { currentTenant } from '../../platform/index.js'

/**
 * Shared plumbing for `modules/ai`: who may call what, how a draft row is found and locked, the
 * settings the optimiser and the parser read, and the outbox events the worker listens for.
 *
 * THE RULE THIS MODULE EXISTS TO KEEP (docs/22 §8, founder 2026-09-05): nothing here decides
 * anything. A parse writes a DRAFT; a forecast writes a SUGGESTION; a route plan writes a SEQUENCE.
 * The only writes that reach an order, a purchase or a trip go through another module's exported
 * service — `OrdersService` for the order a human confirms, `TripsService` for the stops a human
 * applies — so the price engine, the credit verdict, the approval queue and the stop state machine
 * all run exactly as they do for a typed order.
 */

export type DraftRow = typeof aiOrderDrafts.$inferSelect

/** Who may capture and work a draft order (`DRAFT_ORDER_TAKERS` in permissions.ts, plus the worker). */
export const DRAFT_TAKERS: readonly ActorRole[] = [
  'owner',
  'manager',
  'salesperson',
  'retailer',
  'system',
]
/** Who queues a forecast pass: the desk that buys. */
export const FORECAST_RUNNERS: readonly ActorRole[] = ['owner', 'manager', 'accountant', 'system']
/** Who reads the suggestions: the desk and the godown. Never the field, never the shop. */
export const FORECAST_READERS: readonly ActorRole[] = [
  'owner',
  'manager',
  'accountant',
  'warehouse',
  'system',
]
/** Who sequences a trip and pushes the sequence onto it: the desk and the crew that drives it. */
export const ROUTE_OPTIMISERS: readonly ActorRole[] = ['owner', 'manager', 'delivery', 'system']
/** Who reads a plan: the above plus the godown, which loads the van in the order it will be emptied. */
export const ROUTE_READERS: readonly ActorRole[] = [
  'owner',
  'manager',
  'warehouse',
  'delivery',
  'system',
]
/** The desk, for the crew check on a routing WRITE: a `delivery` caller falls through to "own trip". */
export const ROUTE_DESK: readonly ActorRole[] = ['owner', 'manager', 'system']
/**
 * The same check for a READ. The godown is here because it loads the van in the order the van will
 * be emptied (`ai.routing.get` is TRIP_PLANNERS in the matrix, which names it); a `delivery` caller
 * still falls through to "a trip I am the driver or helper of".
 */
export const ROUTE_READ_DESK: readonly ActorRole[] = ['owner', 'manager', 'warehouse', 'system']

/** The outbox events this module publishes and consumes (the worker registers handlers for both). */
export const AI_EVENTS = {
  /**
   * A WhatsApp / SMS text arrived from a shop. The WhatsApp webhook (docs/plans/notifications.md §8)
   * writes `inbound_messages` and emits this; the worker's handler parses it into a draft, which then
   * appears in the rep's and the manager's queue. Nothing emits it yet — see the module's open issues.
   */
  inboundText: 'InboundMessageReceived',
  /** A human asked for a forecast pass. The worker computes it; the request path never does. */
  forecastRequested: 'AiForecastRequested',
  /** A draft was parsed and needs a human. Notifications may one day turn it into a nudge. */
  draftParsed: 'AiOrderDraftParsed',
  /** A human turned a draft into a real order. */
  draftConfirmed: 'AiOrderDraftConfirmed',
} as const

export type AiEventType = (typeof AI_EVENTS)[keyof typeof AI_EVENTS]

export async function emitAiEvent(
  tx: Db,
  aggregateType: 'ai_order_draft' | 'ai_forecast' | 'route_plan',
  aggregateId: string,
  eventType: AiEventType,
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

/**
 * Run `fn` with `app.actor_role = 'system'` for the rest of this transaction, then put the caller's
 * role back. The same sanctioned escalation `modules/orders` uses to auto-confirm a shop's own order:
 * `ai_forecasts` is `system`-write by policy, so an inline pass (specs, a local demo) writes through
 * this and through nothing else. `actor_id` is untouched, so the audit still names the human.
 */
const escalated = new WeakSet<object>()

export async function asSystem<T>(tx: Db, fn: () => Promise<T>): Promise<T> {
  const ctx = currentTenant()
  if (ctx.actorRole === 'system' || escalated.has(tx)) return fn()
  escalated.add(tx)
  try {
    await tx.execute(sql`select set_config('app.actor_role', 'system', true)`)
    return await fn()
  } finally {
    escalated.delete(tx)
    await tx
      .execute(sql`select set_config('app.actor_role', ${ctx.actorRole}, true)`)
      .catch(() => undefined)
  }
}

export function notFound(what: string, id: string): ORPCError<'NOT_FOUND', undefined> {
  return new ORPCError('NOT_FOUND', { message: `${what} ${id} not found` })
}

/** A draft the caller may see, locked for the mutation. RLS already hid another rep's or shop's (404). */
export async function lockDraft(tx: Db, id: string): Promise<DraftRow> {
  const [row] = await tx.select().from(aiOrderDrafts).where(eq(aiOrderDrafts.id, id)).for('update')
  if (!row) throw notFound('draft', id)
  return row
}

export async function findDraft(tx: Db, id: string): Promise<DraftRow> {
  const [row] = await tx.select().from(aiOrderDrafts).where(eq(aiOrderDrafts.id, id)).limit(1)
  if (!row) throw notFound('draft', id)
  return row
}

/** Terminal states: a draft that has been answered is never re-answered (409, never a silent no-op). */
export const DRAFT_TERMINAL: ReadonlySet<string> = new Set(['confirmed', 'rejected', 'expired'])

/**
 * The shop a `retailer` caller is allowed to speak for. Forced, never taken from the wire: a
 * shopkeeper's draft is always its own shop's, whatever the request says.
 */
export async function ownShopId(tx: Db): Promise<string | null> {
  const ctx = currentTenant()
  if (ctx.actorRole !== 'retailer') return null
  const [row] = await tx
    .select({ retailerId: retailerLinks.retailerId })
    .from(retailerLinks)
    .where(and(eq(retailerLinks.userId, ctx.actorId), eq(retailerLinks.status, 'active')))
    .limit(1)
  return row?.retailerId ?? null
}

/**
 * The shop this call names, resolved for the caller's role:
 *  - a `retailer` gets its own shop whatever it asked for, and a 403 when it asked for another's;
 *  - anyone else gets the shop they named, once it exists in this tenant (RLS decides "exists").
 */
export async function resolveRetailer(
  tx: Db,
  requested: string | null | undefined,
): Promise<string | null> {
  const own = await ownShopId(tx)
  if (own) {
    if (requested && requested !== own)
      throw new ORPCError('FORBIDDEN', {
        message: 'a shop may only capture an order for itself',
        data: { code: 'not_your_shop' },
      })
    return own
  }
  if (!requested) return null
  const [row] = await tx
    .select({ id: retailers.id })
    .from(retailers)
    .where(eq(retailers.id, requested))
    .limit(1)
  if (!row) throw notFound('retailer', requested)
  return row.id
}

// ---------------------------------------------------------------------------------------------------------------
// settings

/** Tuning that belongs to the distributor, never to a client (`tenant_settings`). */
export const AI_SETTING_KEYS = {
  routingAvgSpeedKmph: 'ai.routing.avg_speed_kmph',
  routingServiceMinutes: 'ai.routing.service_minutes',
  routingRoadFactorBps: 'ai.routing.road_factor_bps',
  routingDepotLat: 'ai.routing.depot_lat',
  routingDepotLng: 'ai.routing.depot_lng',
  forecastLookbackDays: 'ai.forecast.lookback_days',
  forecastCoverDays: 'ai.forecast.cover_days',
} as const

export async function readSettings(tx: Db, keys: readonly string[]): Promise<Map<string, unknown>> {
  if (keys.length === 0) return new Map()
  const rows = await tx
    .select({ key: tenantSettings.key, value: tenantSettings.value })
    .from(tenantSettings)
    .where(
      and(
        eq(tenantSettings.tenantId, currentTenant().tenantId),
        // One bound parameter, never an interpolated list: `inArray` and `sql.raw` string-building
        // are the two ways to write this, and only one of them stays safe when the values stop
        // being compile-time constants.
        inArray(tenantSettings.key, [...keys]),
      ),
    )
  return new Map(rows.map((r): [string, unknown] => [r.key, r.value]))
}

/**
 * `tenant_settings.value` is jsonb, so a number may arrive as a JSON number or as a JSON string the
 * owner typed into a settings screen. Both are accepted; anything else falls back.
 */
export function numberSetting(
  settings: ReadonlyMap<string, unknown>,
  key: string,
  fallback: number,
): number {
  const n = asNumber(settings.get(key))
  return n === null ? fallback : n
}

export function optionalNumberSetting(
  settings: ReadonlyMap<string, unknown>,
  key: string,
): number | null {
  return asNumber(settings.get(key))
}

function asNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  }
  return null
}

// ---------------------------------------------------------------------------------------------------------------
// units

/** Basis points, clamped to the 0–10000 the column and `BpsSchema` both insist on. */
export function clampBps(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(10_000, Math.max(0, Math.round(value)))
}

/** A 0–1 similarity as basis points, so nothing in this module ever stores a float. */
export const toBps = (score: number): number => clampBps(score * 10_000)

/** The first 120 characters of a message, for a queue row that must not carry whole conversations. */
export function previewOf(text: string | null): string {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length <= 120 ? flat : `${flat.slice(0, 119)}…`
}
