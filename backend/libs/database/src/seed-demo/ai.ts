/**
 * AI demo data (module 12, founder decision 2026-09-05 in docs/22 §8): the four assistive surfaces
 * with something real on each, so every `ai.*` endpoint answers a row rather than an empty list and
 * `/docs` "Try it out" reproduces what the screen shows.
 *
 * Written for EVERY distributor in the database, not only the pilot (founder requirement, docs/22 §8
 * 2026-09-04: three distributors). It therefore never assumes the pilot's shelf, the pilot's brands or
 * the modules that only the pilot seeds: a distributor that does not list MOM Makhana gets its voice
 * note read against a SKU it does carry, and a distributor with no `inbound_messages` row (those are
 * `seedNotifications`, which is the pilot's alone) gets the same WhatsApp draft filed against the shop
 * directly. What must never happen is a draft naming a variant the distributor does not sell — the
 * matcher would never have proposed one.
 *
 * WHAT IT CONTAINS, per distributor:
 *   - SIX DRAFT ORDERS covering EVERY status the enum has, because a queue screen, a review screen and
 *     a history screen each need their own row: `needs_review` (the shop's WhatsApp sentence, with an
 *     AMBIGUOUS line and its candidates — a review screen that never has anything to review proves
 *     nothing), `parsed` twice (a rep's typed capture and a voice note), `confirmed` (a voice note that
 *     BECAME one of this distributor's real orders — `created_order_id` points at it and a person is
 *     named on it, which is the rule the database enforces), `rejected` (the desk threw it away, with
 *     the reason) and `expired` (nobody answered it and the sweep closed it).
 *   - REORDER SUGGESTIONS for every variant the godown holds or has served, computed from THE ORDERS
 *     THIS DISTRIBUTOR ACTUALLY TOOK — pieces per business day, no rupees anywhere, which is what lets
 *     the warehouse role read the list at all (docs/22 §9 rule 1). The estimator is the one in
 *     `@dos/core`'s `estimateDemand()`, branch for branch (Croston under a third of the days, moving
 *     average above it), minus its day-of-week shape, which is the refinement the worker's pass adds.
 *     Note WHY the demand is read from the orders and not from `stock_ledger`, which is what the live
 *     pass reads: the seeded month of trade records its movement as load-sheet transfers godown →
 *     vehicle and never posts the pack-time `sale` row that the product itself writes at
 *     `warehouse.packs.confirm`. Those two describe the same pieces leaving the same godown; the
 *     ledger is simply not where this dataset put them. On a database that has been packed through
 *     the API the pass sees the same story from its own source.
 *   - ONE ROUTE PLAN PER TRIP THAT CAN STILL BE PLANNED (planned / loading / active), computed with
 *     `planRoute()` from `@dos/domain` over the trip's OPEN stops and numbered into their own slots —
 *     exactly what `ai.routing.plan` would write — and left UNAPPLIED, so the founder can press
 *     "apply" and watch the stops move.
 *
 * Idempotent: every id is `demoId(...)`, drafts and plans are `onConflictDoNothing()`, and the
 * forecasts are UPSERT on their own unique key `(tenant, variant, location, horizon)` because the table
 * is a cache of a computation and the module itself rewrites it that way — the row count never moves,
 * the numbers are brought up to what this seed computes. Runs on the owner (BYPASSRLS) connection.
 *
 * Nothing here is a decision the model took on its own: the confirmed draft names the person who
 * confirmed it, no suggestion is a purchase order, and no route plan has been applied.
 */
import { and, asc, eq, sql } from 'drizzle-orm'
import { planRoute, type RouteStopInput } from '@dos/domain'
import type { Db } from '../client.js'
import { insertMany, upsertMany } from './db-helpers.js'
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
import { demoId } from './ids.js'
import type { PeopleResult } from './people.js'
import type { RetailersResult } from './retailers.js'
import type { OrderRecord, SalesResult } from './sales.js'
import type { StockResult } from './stock.js'
import { atIstTime, daysAgo, isoDate, occurred, TODAY } from './util.js'

/** Horizon the demo rows are computed for; the contract's own default (`AI_DEFAULT_HORIZON_DAYS`). */
const HORIZON_DAYS = 14
/** Days of history the estimator reads — the same window `runForecastPass` defaults to. */
const LOOKBACK_DAYS = 90
/** Below this share of selling days a SKU is intermittent and Croston is the honest estimator. */
const INTERMITTENT_DENSITY = 1 / 3

/** The order states whose lines are pieces this distributor actually served out of the godown. */
const SERVED_ORDER_STATES = [
  'confirmed',
  'picking',
  'packed',
  'dispatched',
  'delivered',
  'partially_delivered',
  'closed',
] as const

const bps = (fraction: number): number =>
  Math.min(10_000, Math.max(0, Math.round(fraction * 10_000)))

/** `Brand Product Variant`, the label a reviewer reads on a candidate line. */
type LabelMap = Map<string, string>

export async function seedAi(
  db: Db,
  tenantId: string,
  variants: VariantRow[],
  retailersRes: RetailersResult,
  stock: StockResult,
  sales: SalesResult,
  people: PeopleResult,
): Promise<void> {
  const labels = await variantLabels(db, tenantId)
  await seedDrafts(db, tenantId, variants, retailersRes, sales, people, labels)
  await seedForecasts(db, tenantId, stock)
  await seedRoutePlans(db, tenantId)
}

/**
 * The name the review screen shows for a candidate SKU, read from the curated catalog rather than
 * written out here — a distributor's own listing is what the matcher proposes from, and hard-coded
 * labels would drift from it the first time a product is renamed.
 */
async function variantLabels(db: Db, tenantId: string): Promise<LabelMap> {
  const result = await db.execute(sql`
    select v.id as id,
           coalesce(b.name, '') as brand,
           p.name as product,
           v.name as variant
      from tenant_products tp
      join product_variants v on v.id = tp.variant_id
      join products p on p.id = v.product_id
      left join brands b on b.id = p.brand_id
     where tp.tenant_id = ${tenantId}
  `)
  const out: LabelMap = new Map()
  for (const raw of result.rows) {
    out.set(
      String(raw.id),
      composeLabel(String(raw.brand), String(raw.product), String(raw.variant)),
    )
  }
  return out
}

/**
 * Brand, product and variant into ONE name a shopkeeper would recognise. The three overlap in the
 * curated catalog — `Campa` / `Campa Cola` / `Campa Cola 750 ml` is a real row — so a plain
 * concatenation gives "Campa Campa Cola Campa Cola 750 ml", which reads as a bug on the review screen
 * it is meant to explain. Each part is prepended only when the name does not already begin with it.
 *
 * THE TWIN OF `variantLabelSql` in `@dos/core`'s `modules/ai/ai.internals.ts`, which is what the API
 * renders for the same variant on the review screen and on the godown's reorder list. The two must
 * agree branch for branch, or a seeded draft stores one name and the screen shows another. Written
 * twice rather than shared because `@dos/db` sits BELOW `@dos/core` and must never reach up into it.
 */
function composeLabel(brand: string, product: string, variant: string): string {
  const startsWith = (text: string, prefix: string): boolean =>
    prefix.length > 0 && text.toLowerCase().startsWith(prefix.toLowerCase())
  let out = variant.trim()
  if (!startsWith(out, product.trim())) out = `${product.trim()} ${out}`.trim()
  if (!startsWith(out, brand.trim())) out = `${brand.trim()} ${out}`.trim()
  return out
}

// ---------------------------------------------------------------------------------------------------------------
// drafts

async function seedDrafts(
  db: Db,
  tenantId: string,
  variants: VariantRow[],
  retailersRes: RetailersResult,
  sales: SalesResult,
  people: PeopleResult,
  labels: LabelMap,
): Promise<void> {
  const byKey = new Map(variants.map((v) => [v.key, v]))
  /** The first of these keys this distributor actually lists, else its first listed variant. */
  const anyOf = (...keys: string[]): VariantRow | undefined => {
    for (const key of keys) {
      const found = byKey.get(key)
      if (found) return found
    }
    return variants[0]
  }
  // Every distributor lists cola and a namkeen of some kind, but not necessarily the pilot's: Kalyan
  // Agencies carries no MOM Makhana and neither of the two extra distributors carries Masti Oye.
  const cola1L = anyOf('campa-cola-1000ml', 'campa-cola-750ml')
  const cola750 = anyOf('campa-cola-750ml', 'campa-cola-1000ml')
  const snack = anyOf('too-yumm-karare-60g', 'balaji-wafers-45g', 'mom-makhana-peri-peri-60g')
  const makhana = anyOf('mom-makhana-peri-peri-60g', 'too-yumm-karare-60g', 'balaji-wafers-45g')
  if (!cola1L || !cola750 || !snack || !makhana) return

  const label = (v: VariantRow): string => labels.get(v.id) ?? v.name
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
  // draft per message ever (partial unique index), so this is keyed off the message itself. Only the
  // pilot seeds notifications; every other distributor files the same sentence against the shop.
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

  // 1. NEEDS REVIEW — "bhai 2 case campa 1L kal bhej dena": one clean line, and a second the parser
  //    could not place, which is what puts the draft in `needs_review` and gives the review screen
  //    something to do.
  const textedShop = inbound?.retailerId
    ? shops.find((shop) => shop.id === inbound.retailerId)
    : (linked[0] ?? shops[0])
  if (textedShop) {
    const lines: AiOrderDraftLine[] = [
      {
        text: '2 case campa 1L',
        variantId: cola1L.id,
        qtyPcs: 2 * cola1L.defaultCaseSize,
        cases: 2,
        unit: 'case',
        confidenceBps: 9_100,
        candidates: [
          { variantId: cola1L.id, label: label(cola1L), scoreBps: 9_100 },
          ...(cola750.id === cola1L.id
            ? []
            : [{ variantId: cola750.id, label: label(cola750), scoreBps: 6_400 }]),
        ],
      },
      {
        text: 'aur wo naya wala chips',
        variantId: null,
        qtyPcs: 0,
        cases: null,
        unit: 'piece',
        confidenceBps: 3_100,
        candidates: [{ variantId: snack.id, label: label(snack), scoreBps: 3_100 }],
      },
    ]
    const body = inbound?.body ?? 'bhai 2 case campa 1L kal bhej dena'
    rows.push({
      id: demoId('ai-draft', 'whatsapp'),
      tenantId,
      source: 'whatsapp',
      retailerId: textedShop.id,
      inboundMessageId: inbound?.id ?? null,
      rawText: `${body} aur wo naya wala chips`,
      parsedLines: lines,
      matchConfidenceBps: bps((0.91 + 0.31) / 2),
      status: 'needs_review',
      createdBy: null,
      provider: 'deterministic',
      model: 'rules/1.0.0',
      idempotencyKey: inbound ? `inbound:${inbound.id}` : demoId('ai-draft-key', 'whatsapp'),
      createdAt: occurred(atIstTime(daysAgo(0), 8, 40)),
      updatedAt: atIstTime(daysAgo(0), 8, 40),
    })
  }

  // 2. PARSED — a rep reading a shopkeeper's chit into the sales app: every line matched, one tap to
  //    confirm.
  const chitShop = linked[0] ?? shops[2] ?? shops[0]
  if (chitShop) {
    const lines: AiOrderDraftLine[] = [
      {
        text: `3 case ${label(cola750).toLowerCase()}`,
        variantId: cola750.id,
        qtyPcs: 3 * cola750.defaultCaseSize,
        cases: 3,
        unit: 'case',
        confidenceBps: 9_400,
        candidates: [{ variantId: cola750.id, label: label(cola750), scoreBps: 9_400 }],
      },
      {
        text: `10 pc ${label(snack).toLowerCase()}`,
        variantId: snack.id,
        qtyPcs: 10,
        cases: null,
        unit: 'piece',
        confidenceBps: 8_800,
        candidates: [{ variantId: snack.id, label: label(snack), scoreBps: 8_800 }],
      },
    ]
    rows.push({
      id: demoId('ai-draft', 'text'),
      tenantId,
      source: 'text',
      retailerId: chitShop.id,
      rawText: `3 case ${label(cola750).toLowerCase()}, 10 pc ${label(snack).toLowerCase()}`,
      parsedLines: lines,
      matchConfidenceBps: bps((0.94 + 0.88) / 2),
      status: 'parsed',
      createdBy: rep.id,
      provider: 'deterministic',
      model: 'rules/1.0.0',
      idempotencyKey: demoId('ai-draft-key', 'text'),
      createdAt: occurred(atIstTime(daysAgo(0), 10, 15)),
      updatedAt: atIstTime(daysAgo(0), 10, 15),
    })
  }

  // 3. PARSED (voice) — a voice note the rep recorded at the door. The object key is canonical;
  //    nothing has been uploaded to it, and the deterministic transcriber is what read it (docs/22
  //    §8: stub drivers for now).
  const voiceShop = linked[1] ?? linked[0] ?? shops[4] ?? shops[0]
  if (voiceShop) {
    const spoken = label(makhana).toLowerCase()
    const lines: AiOrderDraftLine[] = [
      {
        text: `do case ${spoken}`,
        variantId: makhana.id,
        qtyPcs: 2 * makhana.defaultCaseSize,
        cases: 2,
        unit: 'case',
        confidenceBps: 8_600,
        candidates: [{ variantId: makhana.id, label: label(makhana), scoreBps: 8_600 }],
      },
    ]
    rows.push({
      id: demoId('ai-draft', 'voice'),
      tenantId,
      source: 'voice',
      retailerId: voiceShop.id,
      audioObjectKey: `tenant/${tenantId}/voice/${demoId('ai-draft', 'voice')}/note.m4a`,
      transcript: `do case ${spoken} bhej dena`,
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

  // 4. CONFIRMED — the one that became business. A rep spoke an order at the door, read the lines
  //    back and confirmed it, and `created_order_id` points at THIS distributor's own order: the
  //    review guard in migration 0032 refuses `confirmed` without a reviewer, the moment they
  //    reviewed and the order, so this row is the human-in-the-loop rule written as data. The order
  //    it names is a `salesperson` order, which is exactly the source `orderSourceFor()` gives a
  //    rep-confirmed voice draft — the demo does not invent an order the product could not have made.
  const confirmedRow = await confirmedDraft(db, tenantId, sales, people, labels)
  if (confirmedRow) rows.push(confirmedRow)

  // 5. REJECTED — one the desk threw away, with the reason: a rejected draft is the training signal
  //    that matters most, and a queue that has never rejected anything hides the button that does it.
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

  // 6. EXPIRED — a text that arrived on a Sunday evening and that nobody ever answered. The retention
  //    sweep closes an unanswered draft rather than deleting it, so the history screen shows what was
  //    missed. Forty days back: old enough to be plainly stale, far short of the 180 days after which
  //    the worker removes the row altogether.
  const missedShop = shops[8] ?? shops[1] ?? shops[0]
  if (missedShop) {
    rows.push({
      id: demoId('ai-draft', 'expired'),
      tenantId,
      source: 'whatsapp',
      retailerId: missedShop.id,
      rawText: '1 case cola bhej dena kal subah',
      parsedLines: [
        {
          text: '1 case cola',
          variantId: cola1L.id,
          qtyPcs: cola1L.defaultCaseSize,
          cases: 1,
          unit: 'case',
          confidenceBps: 8_200,
          candidates: [{ variantId: cola1L.id, label: label(cola1L), scoreBps: 8_200 }],
        },
      ],
      matchConfidenceBps: 8_200,
      status: 'expired',
      createdBy: null,
      provider: 'deterministic',
      model: 'rules/1.0.0',
      idempotencyKey: demoId('ai-draft-key', 'expired'),
      createdAt: atIstTime(daysAgo(40), 20, 15),
      updatedAt: atIstTime(daysAgo(33), 3, 0),
    })
  }

  await insertMany(db, aiOrderDrafts, rows)
}

/**
 * The draft that became an order. The lines are read back OUT OF THE ORDER, so the draft and the
 * order it created say the same thing in the same pieces — a demo where the two disagree would teach
 * the reader that `created_order_id` means nothing.
 */
async function confirmedDraft(
  db: Db,
  tenantId: string,
  sales: SalesResult,
  people: PeopleResult,
  labels: LabelMap,
): Promise<typeof aiOrderDrafts.$inferInsert | undefined> {
  const served = new Set<string>(SERVED_ORDER_STATES)
  // The most recent order a rep took that was actually served, ties broken on the id so every
  // machine picks the same one.
  const candidates = sales.orders
    .filter((o) => o.source === 'salesperson' && o.lineCount > 0 && served.has(o.state))
    .sort((a, b) => b.day.getTime() - a.day.getTime() || (a.id < b.id ? -1 : 1))
  const order: OrderRecord | undefined = candidates[0]
  if (!order) return undefined

  const result = await db.execute(sql`
    select ol.variant_id     as variant_id,
           ol.entered_qty    as entered_qty,
           ol.entered_unit   as entered_unit,
           ol.qty_pcs        as qty_pcs
      from sales_order_lines ol
     where ol.tenant_id = ${tenantId} and ol.order_id = ${order.id}
     order by ol.line_no asc
  `)
  const lines: AiOrderDraftLine[] = []
  for (const raw of result.rows) {
    const variantId = String(raw.variant_id)
    const enteredQty = Number(raw.entered_qty)
    const enteredUnit = String(raw.entered_unit)
    const unit: AiOrderDraftLine['unit'] =
      enteredUnit === 'case' ? 'case' : enteredUnit === 'inner' ? 'inner' : 'piece'
    const name = labels.get(variantId) ?? 'the usual'
    lines.push({
      text: `${String(enteredQty)} ${unit === 'case' ? 'case' : unit === 'inner' ? 'inner' : 'pc'} ${name.toLowerCase()}`,
      variantId,
      qtyPcs: Number(raw.qty_pcs),
      cases: unit === 'case' ? enteredQty : null,
      unit,
      confidenceBps: 9_200,
      candidates: [{ variantId, label: name, scoreBps: 9_200 }],
    })
  }
  if (lines.length === 0) return undefined

  const reviewer = order.salespersonId ?? people.salespeople.rahul.id
  const spokenAt = atIstTime(order.day, 9, 50)
  return {
    id: demoId('ai-draft', 'confirmed'),
    tenantId,
    source: 'voice',
    retailerId: order.retailerId,
    audioObjectKey: `tenant/${tenantId}/voice/${demoId('ai-draft', 'confirmed')}/note.m4a`,
    transcript: lines.map((l) => l.text).join(', '),
    parsedLines: lines,
    matchConfidenceBps: 9_200,
    status: 'confirmed',
    createdOrderId: order.id,
    createdBy: reviewer,
    reviewedBy: reviewer,
    reviewedAt: atIstTime(order.day, 9, 55),
    provider: 'deterministic',
    model: 'rules/1.0.0',
    idempotencyKey: demoId('ai-draft-key', 'confirmed'),
    createdAt: spokenAt,
    updatedAt: atIstTime(order.day, 9, 55),
  }
}

// ---------------------------------------------------------------------------------------------------------------
// forecasts

interface DemandSeries {
  /** Pieces served on each business day that had any, oldest first. */
  days: number[]
  total: number
}

/**
 * The godown's reorder list. Pieces only: no rate, no value, no cost — that is what lets the
 * warehouse role read this list at all (docs/22 §9 rule 1), and it is why the demand is the ORDER
 * LINES rather than the invoice lines that sit beside them carrying money.
 */
async function seedForecasts(db: Db, tenantId: string, stock: StockResult): Promise<void> {
  const from = isoDate(daysAgo(LOOKBACK_DAYS))
  const to = isoDate(daysAgo(1))
  const states = sql.join(
    SERVED_ORDER_STATES.map((state) => sql`${state}`),
    sql`, `,
  )
  const demand = await db.execute(sql`
    select ol.variant_id as variant_id,
           to_char((coalesce(o.submitted_at, o.created_at) at time zone 'Asia/Kolkata')::date,
                   'YYYY-MM-DD') as day,
           sum(ol.qty_pcs + ol.free_qty_pcs)::int as pcs
      from sales_orders o
      join sales_order_lines ol on ol.order_id = o.id and ol.tenant_id = o.tenant_id
     where o.tenant_id = ${tenantId}
       and o.state in (${states})
       and (coalesce(o.submitted_at, o.created_at) at time zone 'Asia/Kolkata')::date
             between ${from}::date and ${to}::date
     group by 1, 2
     having sum(ol.qty_pcs + ol.free_qty_pcs) > 0
     order by 1, 2
  `)
  const byVariant = new Map<string, DemandSeries>()
  for (const raw of demand.rows) {
    const variantId = String(raw.variant_id)
    const pcs = Math.max(0, Number(raw.pcs))
    const series = byVariant.get(variantId) ?? { days: [], total: 0 }
    series.days.push(pcs)
    series.total += pcs
    byVariant.set(variantId, series)
  }

  const held = await db.execute(sql`
    select l.variant_id as variant_id, sum(b.on_hand)::int as on_hand
      from stock_balances b
      join stock_lots l on l.id = b.lot_id
     where b.tenant_id = ${tenantId} and b.location_id = ${stock.godownId}
     group by 1
  `)
  const onHandByVariant = new Map<string, number>()
  for (const raw of held.rows) {
    onHandByVariant.set(String(raw.variant_id), Math.max(0, Number(raw.on_hand)))
  }

  // A SKU that stopped selling still needs a row (its cover is enormous, which is exactly what a
  // buyer wants to see), and one that sells with nothing on the rack needs one most of all.
  const keys = new Set<string>([...byVariant.keys(), ...onHandByVariant.keys()])
  const rows: (typeof aiForecasts.$inferInsert)[] = []
  const computedAt = atIstTime(daysAgo(0), 3, 40)
  for (const variantId of [...keys].sort()) {
    const series = byVariant.get(variantId) ?? { days: [], total: 0 }
    const onHand = onHandByVariant.get(variantId) ?? 0
    const estimate = estimate14(series)
    rows.push({
      id: demoId('ai-forecast', `${variantId}:${String(HORIZON_DAYS)}`),
      tenantId,
      variantId,
      locationId: stock.godownId,
      horizonDays: HORIZON_DAYS,
      expectedQtyPcs: estimate.expectedQtyPcs,
      reorderQtyPcs: Math.max(0, estimate.expectedQtyPcs - onHand),
      onHandPcs: onHand,
      daysCover:
        estimate.dailyRate > 0 ? Math.max(0, Math.floor(onHand / estimate.dailyRate)) : null,
      method: estimate.method,
      confidenceBps: estimate.confidenceBps,
      computedAt,
    })
  }
  // The table is a CACHE of a computation, and the module writes it as an upsert on this very key, so
  // the seed does too: re-running brings a stale row up to what the demo now computes without ever
  // adding one. `pnpm db:seed` twice still moves no count.
  await upsertMany(
    db,
    aiForecasts,
    rows,
    [aiForecasts.tenantId, aiForecasts.variantId, aiForecasts.locationId, aiForecasts.horizonDays],
    [
      'expectedQtyPcs',
      'reorderQtyPcs',
      'onHandPcs',
      'daysCover',
      'method',
      'confidenceBps',
      'computedAt',
    ],
  )
}

/**
 * `estimateDemand()` from `@dos/core/modules/ai/forecast.ts`, branch for branch, minus the
 * day-of-week shape the worker's pass adds on top (this is the flat average underneath it). Kept here
 * rather than imported because `@dos/db` sits BELOW `@dos/core` in the dependency order and must
 * never reach up into it.
 */
function estimate14(series: DemandSeries): {
  expectedQtyPcs: number
  dailyRate: number
  method: 'moving_average_28' | 'croston' | 'new_sku'
  confidenceBps: number
} {
  const soldDays = series.days.filter((pcs) => pcs > 0)
  if (soldDays.length === 0)
    return { expectedQtyPcs: 0, dailyRate: 0, method: 'new_sku', confidenceBps: 0 }

  const density = soldDays.length / LOOKBACK_DAYS
  // Both branches land on the same daily rate (Croston's size ÷ interval reduces to total ÷ lookback
  // for a fixed window); what differs is the confidence, and that difference is the point — a SKU
  // that moved on six days in ninety may not present itself as a firm number.
  const dailyRate = series.total / LOOKBACK_DAYS
  const expectedQtyPcs = Math.round(dailyRate * HORIZON_DAYS)
  if (density < INTERMITTENT_DENSITY) {
    return {
      expectedQtyPcs,
      dailyRate,
      method: 'croston',
      confidenceBps: Math.min(10_000, 2_000 + Math.min(soldDays.length, 20) * 200),
    }
  }
  const mean = series.total / soldDays.length
  const variance =
    soldDays.reduce((sum, pcs) => sum + (pcs - mean) ** 2, 0) / Math.max(1, soldDays.length)
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 1
  return {
    expectedQtyPcs,
    dailyRate,
    method: 'moving_average_28',
    confidenceBps: bps((0.55 + 0.4 * density) * (1 - Math.min(0.6, cv * 0.4))),
  }
}

// ---------------------------------------------------------------------------------------------------------------
// route plans

/**
 * ONE computed, UNAPPLIED plan for every trip that can still be planned — the crew's own round for
 * today and the desk's plan for tomorrow — produced by the same `planRoute()` the API calls, over the
 * same OPEN stops and into the same slots, so the demo plan is exactly what pressing "plan" would
 * give and the founder can press "apply" and watch the stops move. `route_plans_applied_idx` allows
 * one APPLIED plan per trip, so leaving these unapplied also leaves that door open.
 */
async function seedRoutePlans(db: Db, tenantId: string): Promise<void> {
  const trips = await db.execute(sql`
    select t.id as id, t.trip_date as trip_date, t.started_at as started_at
      from trips t
     where t.tenant_id = ${tenantId} and t.state in ('planned', 'loading', 'active')
     order by t.trip_date asc, t.id asc
  `)

  const rows: (typeof routePlans.$inferInsert)[] = []
  for (const raw of trips.rows) {
    const tripId = String(raw.id)
    const tripDate = String(raw.trip_date).slice(0, 10)
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
    const open = stops.filter(
      (s) => !['delivered', 'partial', 'failed', 'skipped'].includes(s.state),
    )
    // `ai.routing.plan` refuses a trip with nothing left to sequence, and so does the seed.
    if (open.length === 0) continue

    // The same start the service uses: the moment the van actually left, else nine in the morning.
    const startAt =
      raw.started_at instanceof Date ? raw.started_at : new Date(`${tripDate}T09:00:00.000+05:30`)
    const input: RouteStopInput[] = open.map((s) => ({ stopId: s.id, lat: s.lat, lng: s.lng }))
    const plan = planRoute(input, { startAt })
    // A plan is a PERMUTATION OF THE OPEN STOPS' OWN SLOTS: a stop already delivered keeps its number,
    // so the apply can never collide with it.
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
    // the desk plans a round the evening before it leaves: tomorrow's plan was computed today,
    // today's when the van left — never at a stamp still in the future (I-58)
    const computedAt = occurred(
      startAt.getTime() > TODAY.getTime() + 86_400_000 ? atIstTime(TODAY, 17, 30) : startAt,
    )
    rows.push({
      id: demoId('route-plan', tripId),
      tenantId,
      tripId,
      method: 'nearest_neighbour_2opt',
      sequence,
      totalDistanceM: plan.totalDistanceM,
      totalDurationS: plan.totalDurationS,
      computedAt,
      createdAt: computedAt,
      updatedAt: computedAt,
    })
  }
  await insertMany(db, routePlans, rows)
}
