/**
 * AI demo data (module 12, founder decision 2026-09-05 in docs/22 §8): the four assistive surfaces
 * with something real on each, so every `ai.*` endpoint answers a row rather than an empty list and
 * `/docs` "Try it out" reproduces what the screen shows.
 *
 * WHAT IT CONTAINS, per distributor:
 *   - FOUR DRAFT ORDERS covering every state a queue actually shows: a WhatsApp message the shop
 *     really sent (the `inbound_messages` row the notifications seed wrote — one draft per message,
 *     ever), a rep's typed capture that parsed cleanly, a voice note with its transcript, and one
 *     the desk threw away with a reason. A `needs_review` draft deliberately carries an AMBIGUOUS
 *     line with candidates, because a review screen that never has anything to review proves nothing.
 *   - REORDER SUGGESTIONS for every variant the godown holds, computed FROM THE STOCK LEDGER the
 *     earlier seeds wrote — the same sources `runForecastPass` reads, so the seeded numbers and a
 *     real pass tell the same story (the worker's pass refines them with a day-of-week shape; this
 *     is the flat moving average underneath it). Some are below cover on purpose: a buyer's working
 *     list with nothing on it is not a demo.
 *   - ONE ROUTE PLAN for the open trip, computed with `planRoute()` from `@dos/domain` — the very
 *     function the API calls — so the demo plan is exactly what pressing "plan" would produce, and
 *     it is left UNAPPLIED so the founder can press "apply" and watch the stops move.
 *
 * Idempotent: every id is `demoId(...)` and every insert is `onConflictDoNothing()`, so `pnpm db:seed`
 * twice adds nothing. Runs on the owner (BYPASSRLS) connection like every other seed.
 *
 * Nothing here is a decision: no draft is confirmed into an order, no suggestion is a purchase order,
 * and the route plan has not been applied. That is the module's whole rule, seeded as data.
 */
import { and, asc, eq, sql } from 'drizzle-orm'
import { planRoute, type RouteStopInput } from '@dos/domain'
import type { Db } from '../client.js'
import { insertMany } from './db-helpers.js'
import {
  aiForecasts,
  aiOrderDrafts,
  inboundMessages,
  retailers,
  routePlans,
  tripStops,
  type AiOrderDraftLine,
  type RoutePlanStop,
} from '../schema/index.js'
import type { VariantRow } from './catalog.js'
import type { DeliveryResult } from './delivery.js'
import { demoId } from './ids.js'
import type { PeopleResult } from './people.js'
import type { RetailersResult } from './retailers.js'
import type { StockResult } from './stock.js'
import { atIstTime, daysAgo, TODAY } from './util.js'

/** Horizon the demo rows are computed for; the contract's own default (`AI_DEFAULT_HORIZON_DAYS`). */
const HORIZON_DAYS = 14
/** Days of history the flat average reads — the same window `runForecastPass` defaults to. */
const LOOKBACK_DAYS = 90

const bps = (fraction: number): number =>
  Math.min(10_000, Math.max(0, Math.round(fraction * 10_000)))

export async function seedAi(
  db: Db,
  tenantId: string,
  variants: VariantRow[],
  retailersRes: RetailersResult,
  stock: StockResult,
  delivery: DeliveryResult,
  people: PeopleResult,
): Promise<void> {
  await seedDrafts(db, tenantId, variants, retailersRes, people)
  await seedForecasts(db, tenantId, stock)
  await seedRoutePlan(db, tenantId, delivery)
}

// ---------------------------------------------------------------------------------------------------------------
// drafts

async function seedDrafts(
  db: Db,
  tenantId: string,
  variants: VariantRow[],
  retailersRes: RetailersResult,
  people: PeopleResult,
): Promise<void> {
  const byKey = new Map(variants.map((v) => [v.key, v]))
  const cola1L = byKey.get('campa-cola-1000ml')
  const cola750 = byKey.get('campa-cola-750ml')
  const karare = byKey.get('too-yumm-karare-60g')
  const makhana = byKey.get('mom-makhana-peri-peri-60g')
  // A distributor that lists none of these brands gets no drafts rather than drafts pointing at
  // variants it does not sell — the matcher would never have proposed one.
  if (!cola1L || !karare) return

  const label = (v: VariantRow, product: string): string => `${product} ${v.name}`
  const shops = retailersRes.retailers
  // The shops that have a LOGIN of their own get the typed and the spoken draft, so the retailer app
  // has something in its queue and its `/docs` examples name a draft its own token may read. A draft
  // on a shop nobody can sign in as would be invisible in exactly the app that most needs to show one.
  // Sorted by CODE, because that is how the docs pick which linked shop the retailer document is
  // written for (`collectRetailerLogin`: the active link with the lowest retailer code). Keeping the
  // two in step is what makes the shopkeeper's published example name a draft its own token can read.
  const linked = retailersRes.linkedRetailerCodes
    .map((code) => shops.find((shop) => shop.code === code))
    .filter((shop): shop is (typeof shops)[number] => shop !== undefined)
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
  const rep = people.salespeople.rahul
  const desk = people.manager

  // The shop that actually texted: the `inbound_messages` row the notifications seed wrote. One
  // draft per message ever (partial unique index), so this is keyed off the message itself.
  const [inbound] = await db
    .select({
      id: inboundMessages.id,
      retailerId: inboundMessages.retailerId,
      body: inboundMessages.body,
      receivedAt: inboundMessages.receivedAt,
    })
    .from(inboundMessages)
    .where(
      and(
        eq(inboundMessages.tenantId, tenantId),
        eq(inboundMessages.channel, 'whatsapp'),
        eq(inboundMessages.handled, false),
      ),
    )
    .orderBy(asc(inboundMessages.id))
    .limit(1)

  const rows: (typeof aiOrderDrafts.$inferInsert)[] = []

  if (inbound?.body && inbound.retailerId) {
    // "bhai 2 case campa 1L kal bhej dena" — one clean line, and a second the parser could not place,
    // which is what puts the draft in `needs_review` and gives the review screen something to do.
    const lines: AiOrderDraftLine[] = [
      {
        text: '2 case campa 1L',
        variantId: cola1L.id,
        qtyPcs: 2 * cola1L.defaultCaseSize,
        cases: 2,
        unit: 'case',
        confidenceBps: 9_100,
        candidates: [
          { variantId: cola1L.id, label: label(cola1L, 'Campa Campa Cola'), scoreBps: 9_100 },
          ...(cola750
            ? [
                {
                  variantId: cola750.id,
                  label: label(cola750, 'Campa Campa Cola'),
                  scoreBps: 6_400,
                },
              ]
            : []),
        ],
      },
      {
        text: 'aur wo naya wala chips',
        variantId: null,
        qtyPcs: 0,
        cases: null,
        unit: 'piece',
        confidenceBps: 3_100,
        candidates: [
          {
            variantId: karare.id,
            label: label(karare, 'Too Yumm Too Yumm Karare'),
            scoreBps: 3_100,
          },
        ],
      },
    ]
    rows.push({
      id: demoId('ai-draft', 'whatsapp'),
      tenantId,
      source: 'whatsapp',
      retailerId: inbound.retailerId,
      inboundMessageId: inbound.id,
      rawText: `${inbound.body} aur wo naya wala chips`,
      parsedLines: lines,
      matchConfidenceBps: bps((0.91 + 0.31) / 2),
      status: 'needs_review',
      createdBy: null,
      provider: 'deterministic',
      model: 'rules/1.0.0',
      idempotencyKey: `inbound:${inbound.id}`,
      createdAt: atIstTime(daysAgo(0), 8, 40),
      updatedAt: atIstTime(daysAgo(0), 8, 40),
    })
  }

  // A rep reading a shopkeeper's chit into the sales app: every line matched, one tap to confirm.
  const chitShop = linked[0] ?? shops[2] ?? shops[0]
  if (chitShop) {
    const lines: AiOrderDraftLine[] = [
      {
        text: '3 case campa cola 750ml',
        variantId: (cola750 ?? cola1L).id,
        qtyPcs: 3 * (cola750 ?? cola1L).defaultCaseSize,
        cases: 3,
        unit: 'case',
        confidenceBps: 9_400,
        candidates: [
          {
            variantId: (cola750 ?? cola1L).id,
            label: label(cola750 ?? cola1L, 'Campa Campa Cola'),
            scoreBps: 9_400,
          },
        ],
      },
      {
        text: '10 pc too yumm karare',
        variantId: karare.id,
        qtyPcs: 10,
        cases: null,
        unit: 'piece',
        confidenceBps: 8_800,
        candidates: [
          {
            variantId: karare.id,
            label: label(karare, 'Too Yumm Too Yumm Karare'),
            scoreBps: 8_800,
          },
        ],
      },
    ]
    rows.push({
      id: demoId('ai-draft', 'text'),
      tenantId,
      source: 'text',
      retailerId: chitShop.id,
      rawText: '3 case campa cola 750ml, 10 pc too yumm karare',
      parsedLines: lines,
      matchConfidenceBps: bps((0.94 + 0.88) / 2),
      status: 'parsed',
      createdBy: rep.id,
      provider: 'deterministic',
      model: 'rules/1.0.0',
      idempotencyKey: demoId('ai-draft-key', 'text'),
      createdAt: atIstTime(daysAgo(0), 10, 15),
      updatedAt: atIstTime(daysAgo(0), 10, 15),
    })
  }

  // A voice note the rep recorded at the door. The object key is canonical; nothing has been uploaded
  // to it, and the deterministic transcriber is what read it (docs/22 §8: stub drivers for now).
  const voiceShop = linked[1] ?? linked[0] ?? shops[4] ?? shops[0]
  if (voiceShop && makhana) {
    const lines: AiOrderDraftLine[] = [
      {
        text: 'do case mom makhana peri peri',
        variantId: makhana.id,
        qtyPcs: 2 * makhana.defaultCaseSize,
        cases: 2,
        unit: 'case',
        confidenceBps: 8_600,
        candidates: [
          {
            variantId: makhana.id,
            label: label(makhana, 'MOM Makhana MOM Makhana Peri Peri'),
            scoreBps: 8_600,
          },
        ],
      },
    ]
    rows.push({
      id: demoId('ai-draft', 'voice'),
      tenantId,
      source: 'voice',
      retailerId: voiceShop.id,
      audioObjectKey: `tenant/${tenantId}/voice/${demoId('ai-draft', 'voice')}/note.m4a`,
      transcript: 'do case mom makhana peri peri bhej dena',
      parsedLines: lines,
      matchConfidenceBps: 8_600,
      status: 'parsed',
      createdBy: rep.id,
      provider: 'deterministic',
      model: 'rules/1.0.0',
      idempotencyKey: demoId('ai-draft-key', 'voice'),
      createdAt: atIstTime(daysAgo(1), 16, 30),
      updatedAt: atIstTime(daysAgo(1), 16, 30),
    })
  }

  // One the desk threw away, with the reason: a rejected draft is the training signal that matters
  // most, and a queue that has never rejected anything hides the button that does it.
  const junkShop = shops[6] ?? shops[0]
  if (junkShop) {
    rows.push({
      id: demoId('ai-draft', 'rejected'),
      tenantId,
      source: 'whatsapp',
      retailerId: junkShop.id,
      rawText: 'kal ka bill bhejo aur payment ka status batao',
      parsedLines: [],
      matchConfidenceBps: 0,
      status: 'rejected',
      createdBy: null,
      reviewedBy: desk.id,
      reviewedAt: atIstTime(daysAgo(2), 11, 5),
      rejectReason: 'Not an order — the shop asked for a bill copy',
      provider: 'deterministic',
      model: 'rules/1.0.0',
      idempotencyKey: demoId('ai-draft-key', 'rejected'),
      createdAt: atIstTime(daysAgo(2), 10, 55),
      updatedAt: atIstTime(daysAgo(2), 11, 5),
    })
  }

  await insertMany(db, aiOrderDrafts, rows)
}

// ---------------------------------------------------------------------------------------------------------------
// forecasts

/**
 * The godown's reorder list, read out of the ledger the earlier seeds wrote: pieces that left as
 * `sale` rows over the lookback, and what is on hand today. No money is read and none is written —
 * that is what lets the warehouse role see this list at all (docs/22 §9).
 */
async function seedForecasts(db: Db, tenantId: string, stock: StockResult): Promise<void> {
  const result = await db.execute(sql`
    with sold as (
      select l.variant_id,
             sum(-sl.qty_delta)::int as pcs,
             count(distinct (sl.occurred_at at time zone 'Asia/Kolkata')::date)::int as days
        from stock_ledger sl
        join stock_lots l on l.id = sl.lot_id
       where sl.tenant_id = ${tenantId}
         and sl.location_id = ${stock.godownId}
         and sl.reason = 'sale'
         and sl.qty_delta < 0
         and (sl.occurred_at at time zone 'Asia/Kolkata')::date
               > (${TODAY.toISOString().slice(0, 10)}::date - ${LOOKBACK_DAYS}::int)
       group by 1
    ),
    held as (
      select l.variant_id, sum(b.on_hand)::int as on_hand
        from stock_balances b
        join stock_lots l on l.id = b.lot_id
       where b.tenant_id = ${tenantId} and b.location_id = ${stock.godownId}
       group by 1
    )
    select coalesce(sold.variant_id, held.variant_id) as variant_id,
           coalesce(sold.pcs, 0)   as pcs,
           coalesce(sold.days, 0)  as days,
           coalesce(held.on_hand, 0) as on_hand
      from sold full outer join held on held.variant_id = sold.variant_id
     order by 1
  `)

  const rows: (typeof aiForecasts.$inferInsert)[] = []
  const computedAt = atIstTime(daysAgo(0), 3, 40)
  for (const raw of result.rows) {
    const variantId = String(raw.variant_id)
    const pcs = Math.max(0, Number(raw.pcs))
    const soldDays = Math.max(0, Number(raw.days))
    const onHand = Math.max(0, Number(raw.on_hand))
    const dailyRate = pcs / LOOKBACK_DAYS
    const expected = Math.round(dailyRate * HORIZON_DAYS)
    const density = soldDays / LOOKBACK_DAYS
    rows.push({
      id: demoId('ai-forecast', `${variantId}:${HORIZON_DAYS}`),
      tenantId,
      variantId,
      locationId: stock.godownId,
      horizonDays: HORIZON_DAYS,
      expectedQtyPcs: expected,
      reorderQtyPcs: Math.max(0, expected - onHand),
      onHandPcs: onHand,
      daysCover: dailyRate > 0 ? Math.max(0, Math.floor(onHand / dailyRate)) : null,
      method: soldDays === 0 ? 'new_sku' : density < 1 / 3 ? 'croston' : 'moving_average_28',
      confidenceBps: soldDays === 0 ? 0 : bps(0.55 + 0.4 * density),
      computedAt,
    })
  }
  await insertMany(db, aiForecasts, rows)
}

// ---------------------------------------------------------------------------------------------------------------
// route plan

/**
 * One computed, UNAPPLIED plan for the open trip, produced by the same `planRoute()` the API calls,
 * so the demo plan is exactly what pressing "plan" would give — and the founder can press "apply"
 * and watch the stops move. `route_plans_applied_idx` allows one applied plan per trip, so leaving
 * this one unapplied also leaves that door open.
 */
async function seedRoutePlan(db: Db, tenantId: string, delivery: DeliveryResult): Promise<void> {
  // The trip worth planning is the one with the most OPEN, PINNED stops — the active trip has usually
  // delivered most of its round by now, and a plan over one remaining stop shows nothing. Ties break
  // on the trip id so the demo is the same on every machine.
  const candidates = await db.execute(sql`
    select t.id,
           t.trip_date,
           count(*) filter (
             where s.state not in ('delivered', 'partial', 'failed', 'skipped') and r.lat is not null
           )::int as open_pinned
      from trips t
      join trip_stops s on s.trip_id = t.id
      join retailers r on r.id = s.retailer_id
     where t.tenant_id = ${tenantId}
       and t.state in ('planned', 'loading', 'active')
     group by 1, 2
     order by open_pinned desc, t.id asc
     limit 1
  `)
  const chosen = candidates.rows[0]
  const tripId = chosen ? String(chosen.id) : delivery.activeTrip.id
  const tripDate = chosen ? String(chosen.trip_date) : delivery.activeTrip.tripDate

  const stops = await db
    .select({
      id: tripStops.id,
      sequence: tripStops.sequence,
      state: tripStops.state,
      lat: retailers.lat,
      lng: retailers.lng,
    })
    .from(tripStops)
    .innerJoin(retailers, eq(retailers.id, tripStops.retailerId))
    .where(and(eq(tripStops.tenantId, tenantId), eq(tripStops.tripId, tripId)))
    .orderBy(asc(tripStops.sequence))
  const open = stops.filter((s) => !['delivered', 'partial', 'failed', 'skipped'].includes(s.state))
  if (open.length < 2) return

  const startAt = atIstTime(new Date(`${tripDate.slice(0, 10)}T00:00:00.000Z`), 9, 0)
  const input: RouteStopInput[] = open.map((s) => ({ stopId: s.id, lat: s.lat, lng: s.lng }))
  const plan = planRoute(input, { startAt })
  const slots = open.map((s) => s.sequence).sort((a, b) => a - b)
  const sequence: RoutePlanStop[] = plan.order.map((entry, index) => ({
    stopId: entry.stopId,
    seq: slots[index] ?? index + 1,
    etaAt:
      entry.etaMinutes === null
        ? null
        : new Date(startAt.getTime() + entry.etaMinutes * 60_000).toISOString(),
    distanceM: entry.distanceM,
  }))

  await insertMany(db, routePlans, [
    {
      id: demoId('route-plan', tripId),
      tenantId,
      tripId,
      method: 'nearest_neighbour_2opt',
      sequence,
      totalDistanceM: plan.totalDistanceM,
      totalDurationS: plan.totalDurationS,
      computedAt: startAt,
      createdAt: startAt,
      updatedAt: startAt,
    },
  ])
}
