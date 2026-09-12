/**
 * Orders -> invoices -> receipts -> journal (ADR 0001/0004/0008) over `historyDays` calendar days,
 * plus the beat visits behind the orders and the stock every sold line left the rack from.
 *
 * The order book is the BEAT PLAN: every working day the reps walk the beats scheduled for that
 * weekday, call on most of the shops, and six calls in ten end in an order — the kiranas in cases,
 * inners and loose pieces, the supermarkets in cases, with the brand mix a Kalyan distributorship
 * actually has (the beverage flagship first, a long tail behind it). On top ride the retailer-app
 * orders of the two shops that use it, the phone and WhatsApp orders the manager keys in, the
 * manufacturer rep's Too Yumm-only calls and the odd van sale.
 *
 * Today is live (drafts on a rep's phone, two orders held on a pending approval, two in the godown
 * being picked), yesterday's loads are on the road, and everything older has been delivered,
 * part-delivered, sent back or cancelled — `closed` is never written, no app action can reach it.
 * Every shop behaves like its archetype: kiranas pay on terms, the cash-and-carry shops pay at the
 * door, the stopped accounts sit at their limit and no further, the brand-new ones have never
 * ordered, and the shop near its limit sits at ~92 % of it.
 *
 * Pricing is the engine's shape in miniature: tier rate, a negotiated override (a `final` one blocks
 * schemes), an approved bargain, then the schemes in priority order — free goods on the line's own
 * SKU, percentage and slab discounts, a flat amount per case, the exclusive scheme alone, the launch
 * offer on every line of the brand, the order-level percentages allocated to the lines they were
 * earned on — every one recorded in `applied_rules` so the bill prints what happened.
 *
 * Stock: the order book is built first, `planStock()` receives what was sold on each house's cadence
 * and replays every line FEFO, and the pieces leave the godown as `sale` rows at pack — one row per
 * (order, line, batch), exactly as `InventoryService.postPick` keys them.
 */
import { allocate, paise, percentOf, roundToRupee } from '@dos/domain'
import { eq, sql } from 'drizzle-orm'
import type { stockLedger } from '../schema/index.js'
import {
  accounts,
  allocations,
  cashDiscountConditions,
  creditNoteLines,
  creditNotes,
  invoiceLines,
  invoices,
  journalEntries,
  journalLines,
  numberingSeries,
  orderStateTransitions,
  receipts,
  salesOrderLines,
  salesOrders,
  tenants,
} from '../schema/index.js'
import type { Db } from '../client.js'
import type { AppliedRule } from '../schema/orders.js'
import { brandId, innerPackOf, type VariantRow } from './catalog.js'
import { insertMany, postLedger, seriesPrefix } from './db-helpers.js'
import { demoId } from './ids.js'
import type { PeopleResult, PersonRef } from './people.js'
import type { PricingResult, SchemeRow } from './pricing.js'
import { planOpeningBills } from './receivables.js'
import {
  byArchetype,
  TRADING_ARCHETYPES,
  type ArchetypeKey,
  type RetailerRow,
  type RetailersResult,
} from './retailers.js'
import { lotProfilesFor, planStock, type DemandLine, type StockPlan } from './stock-plan.js'
import { CANCELLED_BILL_CASES, flagshipVariant, VAN_SALE_PCS } from './billing.js'
import type { StockResult } from './stock.js'
import {
  atIstTime,
  daysAgo,
  FY,
  hashMod,
  isoDate,
  isPreviousWorkingDay,
  isWorkingDay,
  makeRng,
  nth,
  occurred,
  pick,
  pickWeighted,
  randInt,
  TODAY,
  workingDaysBack,
} from './util.js'

export type FinalOrderState =
  | 'draft'
  | 'submitted'
  | 'confirmed'
  | 'picking'
  | 'packed'
  | 'dispatched'
  | 'delivered'
  | 'partially_delivered'
  | 'cancelled'

const INVOICE_ELIGIBLE = new Set<FinalOrderState>([
  'packed',
  'dispatched',
  'delivered',
  'partially_delivered',
])

/** What happened at the door, for the delivery seed to write the stop that says so. */
export type StopOutcome = 'delivered' | 'partial' | 'failed' | 'on_road'

/** One attempt at the door: a failed first attempt is followed by a delivery two days later. */
export interface PlannedStop {
  day: Date
  outcome: StopOutcome
}

export interface OrderRecord {
  id: string
  orderNo: string | null
  retailerId: string
  retailerCode: string
  archetype: ArchetypeKey
  beatIndex: number
  salespersonId: string | null
  createdBy: string
  source: 'salesperson' | 'retailer_app' | 'van_sale' | 'phone' | 'whatsapp'
  state: FinalOrderState
  /** The outcome of the LAST attempt at the door; null for an order that never rode a vehicle. */
  stopOutcome: StopOutcome | null
  /** Every attempt, in order. */
  stops: PlannedStop[]
  day: Date
  subtotalPaise: number
  discountPaise: number
  taxPaise: number
  roundOffPaise: number
  totalPaise: number
  lineCount: number
  cancelReason: string | null
  /** Where in the machine the cancellation happened. */
  cancelledAt: 'submitted' | 'confirmed' | null
}

function ageDaysOf(day: Date): number {
  return Math.round((TODAY.getTime() - day.getTime()) / 86_400_000)
}

export interface DoorReceipt {
  receiptId: string
  mode: 'cash' | 'upi'
  amountPaise: number
}

export interface InvoiceLineRecord {
  invoiceLineId: string
  orderLineId: string
  variantId: string
  qtyPcs: number
  freeQtyPcs: number
  pickedQtyPcs: number
  ratePaise: number
  taxablePaise: number
  /** The batch the line left from, what FEFO suggested, and whether the picker overrode it. */
  lotId: string | null
  suggestedLotId: string | null
  fefoOverride: boolean
}

export interface InvoiceRecord {
  id: string
  invoiceNo: string
  orderId: string
  retailerId: string
  retailerCode: string
  beatIndex: number
  invoiceDate: Date
  ageDays: number
  totalPaise: number
  state: 'issued' | 'partially_paid' | 'paid'
  /** A receipt the crew took at the door (delivery links it to the trip). */
  doorReceipt: DoorReceipt | null
  lines: InvoiceLineRecord[]
}

export interface RetailerOutstanding {
  outstandingPaise: number
  openBills: number
  oldestDueDate: string | null
  items: { outstandingPaise: number; dueDate: string }[]
}

export interface ShortDelivery {
  invoiceId: string
  /** The invoice line that came up short and by how much. */
  invoiceLineId: string
  shortPcs: number
}

export interface ApprovalCase {
  key: string
  kind: 'credit_limit' | 'bargain' | 'below_floor'
  status: 'pending' | 'approved' | 'rejected'
  orderId: string
  retailerId: string
  ageDays: number
  /** The bargain the case decides, when it is a bargain. */
  bargainId: string | null
}

/** One call a rep made on a beat: the visit row behind an order, or the reason there was none. */
export interface VisitPlan {
  key: string
  retailerId: string
  userId: string
  beatIndex: number
  day: Date
  startedAt: Date
  endedAt: Date
  outcome: 'ordered' | 'no_order' | 'closed' | 'not_found' | 'payment_only'
  reason: string | null
  orderId: string | null
}

export interface SalesResult {
  orders: OrderRecord[]
  invoices: InvoiceRecord[]
  outstandingByRetailer: Map<string, RetailerOutstanding>
  shortDeliveries: ShortDelivery[]
  approvalCases: ApprovalCase[]
  visits: VisitPlan[]
  /** Shops whose dues are part of the story and must not be settled by any later seed. */
  protectedRetailerIds: Set<string>
  /** The godown as written from the plan the order book produced. */
  stock: StockResult
}

export interface SeedSalesOptions {
  /** Calendar days of history (default 90). */
  historyDays?: number
  /** Writes the stock plan the order book needs and returns the godown; called before any sale is written. */
  commitStock: (plan: StockPlan) => Promise<StockResult>
}

const SELLER_FSSAI = '11525012000456'

type Outcome =
  | 'delivered'
  | 'delivered_today'
  | 'partial'
  | 'failed'
  | 'packed'
  | 'cancelled'
  | 'dispatched'
  | 'confirmed'
  | 'picking'

/** Outcome mix by age (spec §2.9), the live week laid out positionally below. */
function mixFor(ageDays: number): readonly (readonly [number, Outcome])[] {
  if (ageDays <= 6)
    return [
      [78, 'delivered'],
      [10, 'partial'],
      [5, 'failed'],
      [2, 'packed'],
      [5, 'cancelled'],
    ]
  if (ageDays <= 20)
    return [
      [84, 'delivered'],
      [8, 'partial'],
      [5, 'failed'],
      [3, 'cancelled'],
    ]
  return [
    [86, 'delivered'],
    [6, 'partial'],
    [5, 'failed'],
    [3, 'cancelled'],
  ]
}

/**
 * Today and "yesterday" — the previous WORKING day, Saturday on a Monday — positionally: the live
 * states the spec asks for lead, the rest follow.
 */
const TODAY_CYCLE: readonly Outcome[] = [
  'confirmed',
  'picking',
  'packed',
  'packed',
  'confirmed',
  'picking',
  'packed',
  'packed',
  'confirmed',
  'packed',
]
const TODAY_TAIL: readonly Outcome[] = ['packed', 'confirmed']
/**
 * Yesterday's book: three already delivered this morning, six on the road, one packed, one cancelled
 * — a tempo's round, not a scooter's (2026-09-08 review: trips averaged five stops).
 */
const YESTERDAY_CYCLE: readonly Outcome[] = [
  'delivered_today',
  'delivered_today',
  'delivered_today',
  'dispatched',
  'dispatched',
  'dispatched',
  'dispatched',
  'dispatched',
  'dispatched',
  'packed',
  'cancelled',
]

/**
 * How many orders a day may hold. The live day and the previous working day are laid out
 * positionally (the cycles above); every older day takes whatever the beats produce — the reps call
 * on every shop scheduled that day and the strike rate decides the count, so the book runs at the
 * beat plan's scale rather than a quota's (2026-09-08 review: six visits a day across a five-rep
 * firm was a tenth of the beat schedule the same seed wrote).
 */
function quotaFor(ageDays: number, yesterday: boolean): number {
  if (ageDays === 0) return TODAY_CYCLE.length
  if (yesterday) return YESTERDAY_CYCLE.length + 1
  return 60
}

/** Basket shape per archetype: how many lines, how many cases each, and the biggest bill they get. */
const BASKET: Readonly<
  Record<
    ArchetypeKey,
    { lines: [number, number]; cases: [number, number]; maxOrderPaise: number; strike: number }
  >
> = {
  kirana_small: { lines: [2, 5], cases: [1, 3], maxOrderPaise: 1_300_000, strike: 0.52 },
  grocery_medium: { lines: [3, 7], cases: [2, 6], maxOrderPaise: 3_000_000, strike: 0.62 },
  supermarket: { lines: [5, 9], cases: [3, 10], maxOrderPaise: 8_000_000, strike: 0.72 },
  high_volume: { lines: [6, 10], cases: [5, 14], maxOrderPaise: 12_000_000, strike: 0.78 },
  cash_only: { lines: [2, 4], cases: [1, 3], maxOrderPaise: 900_000, strike: 0.5 },
  prepaid: { lines: [2, 4], cases: [1, 3], maxOrderPaise: 900_000, strike: 0.45 },
  new_shop: { lines: [0, 0], cases: [0, 0], maxOrderPaise: 0, strike: 0 },
  credit_near_limit: { lines: [3, 5], cases: [2, 5], maxOrderPaise: 2_500_000, strike: 0.55 },
  overdue_mild: { lines: [2, 4], cases: [1, 3], maxOrderPaise: 1_000_000, strike: 0.45 },
  overdue_hard: { lines: [2, 4], cases: [1, 3], maxOrderPaise: 1_100_000, strike: 0.55 },
  bad_debt: { lines: [2, 3], cases: [1, 2], maxOrderPaise: 700_000, strike: 0.65 },
  blocked_link: { lines: [2, 4], cases: [1, 3], maxOrderPaise: 800_000, strike: 0.5 },
  closed_shop: { lines: [2, 3], cases: [1, 2], maxOrderPaise: 500_000, strike: 0.4 },
}

/**
 * The share of the shelf each brand takes in a basket line: the beverage flagship first, then the
 * snack and biscuit houses, then the staples and dairy, with personal care and household a long
 * tail. Divided by the brand's SKU count so a house with twenty variants is not twenty times as
 * likely as one with three.
 */
const BRAND_PULL: Readonly<Record<string, number>> = {
  campa: 30,
  balaji: 12,
  sunbake: 12,
  annapurna: 12,
  godavari: 10,
  rajwadi: 10,
  tooyumm: 9,
  neelam: 6,
  chamak: 6,
  konkancrunch: 5,
  independence: 3,
  mommakhana: 2,
  mastioye: 2,
}

/**
 * When the frozen and dead accounts stopped trading, in days before today: two months ago for the
 * pilot's ninety-day book, proportionally sooner for a shorter history, so every distributor's bad
 * debt has a trail of orders, visits and receipts behind it (2026-09-08 review: a 90+ debtor with
 * no trading history at all is not a bad debt, it is a typo).
 */
function archetypeStops(historyDays: number): {
  badDebt: number
  closed: number
  overdueHard: number
  blockedFrom: number
  blockedTo: number
} {
  return {
    badDebt: Math.min(62, Math.max(20, historyDays - 22)),
    closed: Math.min(75, Math.max(25, historyDays - 12)),
    overdueHard: Math.min(40, Math.max(15, historyDays - 22)),
    blockedFrom: Math.min(40, Math.max(15, historyDays - 22)),
    blockedTo: Math.min(60, historyDays - 5),
  }
}

/** Which archetypes order at a given age: the frozen and dead accounts only have old history. */
function ordersAt(archetype: ArchetypeKey, ageDays: number, historyDays: number): boolean {
  const stop = archetypeStops(historyDays)
  switch (archetype) {
    case 'new_shop':
      return false
    case 'blocked_link':
      return ageDays >= stop.blockedFrom && ageDays <= stop.blockedTo
    case 'bad_debt':
      // bought until it was put on stop, then never again
      return ageDays >= stop.badDebt
    case 'closed_shop':
      return ageDays >= stop.closed
    case 'overdue_hard':
      return ageDays >= stop.overdueHard
    case 'credit_near_limit':
      // the live dues are written by hand (see `nearLimitOrders`); older trade is ordinary
      return ageDays > 30
    default:
      return true
  }
}

/** `next_no` only ever moves forward: another seed module, the app or the smoke harness may be ahead. */
async function bumpSeries(
  db: Db,
  tenantId: string,
  seriesCode: string,
  prefix: string,
  nextNo: number,
): Promise<void> {
  await db
    .insert(numberingSeries)
    .values({ tenantId, seriesCode, fy: FY, prefix, nextNo })
    .onConflictDoUpdate({
      target: [numberingSeries.tenantId, numberingSeries.seriesCode, numberingSeries.fy],
      set: { nextNo: sql`greatest(${numberingSeries.nextNo}, ${nextNo})` },
    })
}

function rateForRetailer(
  tier: RetailerRow['tier'],
  rates: PricingResult['ratesByVariantId'],
  variantId: string,
): number {
  const r = rates.get(variantId)
  if (!r) throw new Error(`no price for variant ${variantId}`)
  if (tier === 'A') return r.aPaise
  if (tier === 'B') return r.bPaise
  if (tier === 'C') return r.cPaise
  return r.defaultPaise
}

/** The last working day on or before `TODAY − ageDays`. */
function workingDayAgo(ageDays: number): Date {
  let d = daysAgo(ageDays)
  while (!isWorkingDay(d)) d = new Date(d.getTime() - 86_400_000)
  return d
}

/** The first working day after `day` plus `gap` calendar days. */
function workingDayAfter(day: Date, gap: number): Date {
  let d = new Date(day.getTime() + gap * 86_400_000)
  while (!isWorkingDay(d)) d = new Date(d.getTime() + 86_400_000)
  return d
}

/**
 * The day money that "would have come on a Sunday" actually comes: the Saturday before it, when
 * the rep was last at the counter — never Monday, or every Monday would carry two days' takings.
 */
function collectionDay(invoiceDate: Date, after: number): Date {
  const d = new Date(invoiceDate.getTime() + after * 86_400_000)
  if (isWorkingDay(d)) return d
  const before = new Date(d.getTime() - 86_400_000)
  return before.getTime() >= invoiceDate.getTime() ? before : workingDayAfter(d, 0)
}

/** Half-and-half GST plus cess, the way the invoice prints it: the order line uses the SAME split. */
function taxOn(taxable: number, gstBps: number, cessBps: number): number {
  const half = percentOf(paise(taxable), gstBps / 2)
  return half + half + percentOf(paise(taxable), cessBps)
}

export async function seedSales(
  db: Db,
  tenantId: string,
  variants: VariantRow[],
  retailersRes: RetailersResult,
  pricing: PricingResult,
  people: PeopleResult,
  opts: SeedSalesOptions,
): Promise<SalesResult> {
  const historyDays = opts.historyDays ?? 90
  const stops = archetypeStops(historyDays)
  const orders = (archetype: ArchetypeKey, ageDays: number): boolean =>
    ordersAt(archetype, ageDays, historyDays)
  const accountRows = await db.select().from(accounts).where(eq(accounts.tenantId, tenantId))
  const accountId = new Map(accountRows.map((a) => [a.code, a.id]))
  const acc = (code: string): string => {
    const id = accountId.get(code)
    if (!id) throw new Error(`chart of accounts missing ${code}; run bootstrapTenant first`)
    return id
  }
  const [tenant] = await db
    .select({ gstin: tenants.gstin, slug: tenants.slug, legalName: tenants.legalName })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1)
  const sellerGstin = tenant?.gstin ?? '27AAXPT9021Q1ZQ'
  const upiVpa = `${(tenant?.slug ?? 'demo').replace(/[^a-z0-9]/g, '')}@okhdfcbank`
  const sellerName = tenant?.legalName ?? 'Distributor'

  // Positional streams, one per concern, so a change to one draw never reshuffles another.
  const rng = makeRng('dos-demo:sales:history')
  const sourceRng = makeRng('dos-demo:sales:source-mix')
  const shortPickRng = makeRng('dos-demo:sales:short-pick')
  const moneyRng = makeRng('dos-demo:receipts:mix')
  const unitRng = makeRng('dos-demo:sales:units')
  const visitRng = makeRng('dos-demo:sales:visits')

  const variantById = new Map(variants.map((v) => [v.id, v]))
  /** The stock profile of every SKU on this shelf: what sells, what is short, what is sold out. */
  const profiles = lotProfilesFor(variants)
  const profileOf = (v: VariantRow) => profiles.get(v.id) ?? 'normal'
  const retailerByCode = new Map(retailersRes.retailers.map((r) => [r.code, r]))
  const appLoginCodes = retailersRes.appLoginRetailerCodes
  const shopOf = (key: ArchetypeKey, n = 0): RetailerRow | undefined => {
    try {
      return byArchetype(retailersRes.retailers, key, n)
    } catch {
      return undefined
    }
  }
  const nearLimitShop = shopOf('credit_near_limit')
  const protectedRetailerIds = new Set(
    retailersRes.retailers
      .filter((r) =>
        (
          ['credit_near_limit', 'overdue_mild', 'overdue_hard', 'bad_debt', 'blocked_link'] as const
        ).includes(r.archetype as never),
      )
      .map((r) => r.id),
  )

  // --- who sells: the rep per beat, the extra reps who share beats, the manufacturer's rep -----------
  const half = Math.ceil(retailersRes.beats.length / 2)
  const extraReps = people.extra.filter((p) => p.role === 'salesperson')
  const primaryRep = (beatIndex: number): PersonRef =>
    beatIndex < half ? people.salespeople.rahul : people.salespeople.amit
  const extraRepFor = (beatIndex: number): PersonRef | undefined =>
    extraReps.find((_, k) => {
      const n = retailersRes.beats.length
      return (k * 2) % n === beatIndex || (k * 2 + 4) % n === beatIndex
    })
  const crew = [
    people.delivery.ganesh,
    people.delivery.raju,
    people.delivery.santosh,
    people.delivery.iqbal,
  ]

  // --- what is sold: the brand pull, the SKU's own profile, its size ----------------------------------
  const brandCount = new Map<string, number>()
  for (const v of variants) brandCount.set(v.brandKey, (brandCount.get(v.brandKey) ?? 0) + 1)
  const sizeFactor = (v: VariantRow): number => {
    // the mid sizes move; the biggest packs and the tiniest sachets are slower
    if (v.brandKey === 'campa') return v.netQty >= 2000 ? 0.5 : v.netQty <= 250 ? 0.8 : 1.4
    if (v.netUnit === 'kg' && v.netQty >= 10) return 0.4
    if (v.netUnit === 'l' && v.netQty >= 5) return 0.4
    return 1
  }
  /**
   * A quarter of any list barely moves (2026-09-08 review: 169 of 174 SKUs sold in ninety days):
   * the odd size, the flavour nobody asked for, the big jar. Deterministic in the key, never on a
   * SKU whose stock story needs sales (the fast movers, the float, the sold-out ones).
   */
  const slowMover = (v: VariantRow): boolean =>
    profileOf(v) === 'normal' && hashMod(`slow:${v.key}`, 100) < 32
  const variantWeight = (v: VariantRow, ageDays: number): number => {
    if (v.status === 'discontinued' && ageDays <= 30) return 0
    if (v.status === 'proposed') return 0.3
    const pull = (BRAND_PULL[v.brandKey] ?? 1) / Math.sqrt(brandCount.get(v.brandKey) ?? 1)
    let profile: number
    if (slowMover(v)) return pull * 0.08 * sizeFactor(v)
    switch (profileOf(v)) {
      case 'float':
        profile = 3
        break
      case 'fast':
        profile = 2.2
        break
      case 'zero':
        profile = ageDays <= 6 ? 0 : 0.6
        break
      case 'low':
        profile = ageDays <= 8 ? 0 : 0.4
        break
      default:
        profile = 1
    }
    return pull * profile * sizeFactor(v)
  }
  const recentPool = variants.map((v) => [variantWeight(v, 0), v] as const).filter(([w]) => w > 0)
  const oldPool = variants.map((v) => [variantWeight(v, 40), v] as const).filter(([w]) => w > 0)
  // the SKUs a scheme or a big account is pushed on: never one the shelf is short of or out of
  const stocked = (v: VariantRow): boolean =>
    profileOf(v) !== 'zero' && profileOf(v) !== 'low' && v.status !== 'discontinued'
  const tooYummVariants = variants.filter((v) => v.brandKey === 'tooyumm' && stocked(v))
  const campa750 = variants.filter(
    (v) => v.key === 'campa-cola-750ml' || v.key === 'campa-orange-750ml',
  )
  const gheeVariants = variants.filter((v) => v.productKey === 'godavari-cow-ghee' && stocked(v))
  const glucoseBig = variants.filter(
    (v) => v.key === 'sunbake-glucose-110g' || v.key === 'sunbake-glucose-250g',
  )
  const soapVariants = variants.filter(
    (v) =>
      (v.productKey === 'neelam-sandal-soap' || v.productKey === 'neelam-rose-soap') && stocked(v),
  )
  const chamakVariants = variants.filter((v) => v.brandKey === 'chamak' && stocked(v))
  const rajwadiSodas = variants.filter(
    (v) => v.brandKey === 'rajwadi' && v.productKey.includes('soda') && stocked(v),
  )

  // --- the mini pricing engine ----------------------------------------------------------------------
  const overridesByShopVariant = new Map(
    pricing.overrides.map((o) => [`${o.retailerId}:${o.variantId}`, o]),
  )
  const approvedBargains = new Map(
    pricing.bargains
      .filter((b) => b.status === 'approved' || b.status === 'auto_approved')
      .map((b) => [`${b.retailerId}:${b.variantId}`, b]),
  )
  const inScope = (s: SchemeRow, v: VariantRow): boolean => {
    const scope = s.scope
    if (scope.variantIds && !scope.variantIds.includes(v.id)) return false
    if (scope.brandIds && !scope.brandIds.includes(brandId(v.brandKey))) return false
    if (!scope.variantIds && !scope.brandIds && !scope.all) return false
    return true
  }
  const live = (s: SchemeRow, day: string): boolean =>
    s.active !== false && s.validFrom <= day && s.validTo >= day
  const lineSchemes = [...pricing.schemes]
    .filter((s) => s.rewardKind !== 'order_pct')
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || (a.id < b.id ? -1 : 1))
  const orderSchemes = [...pricing.schemes]
    .filter((s) => s.rewardKind === 'order_pct')
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || (a.id < b.id ? -1 : 1))

  interface PricedLine {
    listRate: number
    rate: number
    /** Line-level scheme money off the gross. */
    discountPaise: number
    freeQtyPcs: number
    appliedRules: AppliedRule[]
    priceLocked: boolean
    /** The line carries the exclusive scheme: nothing else may be added to it. */
    exclusive: boolean
  }
  function priceLine(
    retailer: RetailerRow,
    v: VariantRow,
    qtyPcs: number,
    day: string,
    bargainAllowed: boolean,
  ): PricedLine {
    const cases = qtyPcs / v.defaultCaseSize
    const listRate = rateForRetailer(retailer.tier, pricing.ratesByVariantId, v.id)
    const override = overridesByShopVariant.get(`${retailer.id}:${v.id}`)
    const overrideLive =
      override &&
      override.validFrom <= day &&
      (override.validTo === null || override.validTo >= day)
    let rate = overrideLive ? override.ratePaise : listRate
    const appliedRules: AppliedRule[] = []
    let priceLocked = false
    if (overrideLive) {
      priceLocked = true
      appliedRules.push({
        ruleId: override.id,
        version: 1,
        kind: 'override',
        amountPaise: (listRate - rate) * qtyPcs,
      })
      if (override.final)
        return {
          listRate,
          rate,
          discountPaise: 0,
          freeQtyPcs: 0,
          appliedRules,
          priceLocked,
          exclusive: false,
        }
    }
    const bargain = bargainAllowed ? approvedBargains.get(`${retailer.id}:${v.id}`) : undefined
    if (bargain && bargain.askedRatePaise < rate) {
      appliedRules.push({
        ruleId: bargain.id,
        version: 1,
        kind: 'bargain',
        amountPaise: (rate - bargain.askedRatePaise) * qtyPcs,
      })
      rate = bargain.askedRatePaise
      priceLocked = true
    }
    const gross = rate * qtyPcs
    let discountPaise = 0
    let freeQtyPcs = 0
    const qualifying = lineSchemes.filter((s) => {
      if (!live(s, day) || !inScope(s, v)) return false
      if (s.triggerKind === 'value') return gross >= s.triggerMin
      const have = s.triggerUnit === 'pcs' ? qtyPcs : cases
      return have >= s.triggerMin
    })
    // the exclusive scheme applies ALONE: never on top of a negotiated rate, never with another rule
    const exclusive = appliedRules.length === 0 ? qualifying.find((s) => s.final) : undefined
    const toApply = exclusive
      ? [exclusive]
      : qualifying.filter((s) => s.stackable !== false && !s.final)
    for (const s of toApply) {
      const have = s.triggerUnit === 'pcs' ? qtyPcs : cases
      if (s.rewardKind === 'free_qty') {
        // the free pieces are the line's own SKU: that is what is picked, packed and delivered
        const free = s.rewardUnit === 'case' ? s.rewardValue * v.defaultCaseSize : s.rewardValue
        const multiples = Math.max(1, Math.floor(have / Math.max(1, s.triggerMin)))
        const freeNow = free * multiples
        freeQtyPcs += freeNow
        appliedRules.push({
          ruleId: s.id,
          version: 1,
          kind: 'scheme',
          rewardKind: 'free_qty',
          freeQty: freeNow,
          freeVariantId: v.id,
          // what the free goods were worth at the line's rate: the scheme-spend rollup sums it
          amountPaise: freeNow * rate,
        })
      } else if (s.rewardKind === 'line_pct') {
        const slab = [...(s.slabs ?? [])].reverse().find((sl) => have >= sl.min)
        const bps = slab ? slab.value : s.rewardValue
        const amount = percentOf(paise(gross - discountPaise), bps)
        discountPaise += amount
        appliedRules.push({
          ruleId: s.id,
          version: 1,
          kind: 'scheme',
          rewardKind: 'line_pct',
          amountPaise: amount,
        })
      } else if (s.rewardKind === 'net_scheme_amount') {
        // a flat amount per case
        const amount = Math.round(s.rewardValue * Math.floor(cases))
        if (amount > 0) {
          discountPaise += amount
          appliedRules.push({
            ruleId: s.id,
            version: 1,
            kind: 'scheme',
            rewardKind: 'net_scheme_amount',
            amountPaise: amount,
          })
        }
      } else if (s.rewardKind === 'cash_discount_pct') {
        // reported on the bill, realised only at receipt inside the window (ADR 0004)
        appliedRules.push({
          ruleId: s.id,
          version: 1,
          kind: 'scheme',
          rewardKind: 'cash_discount_pct',
          amountPaise: percentOf(paise(gross - discountPaise), s.rewardValue),
        })
      }
    }
    return {
      listRate,
      rate,
      discountPaise,
      freeQtyPcs,
      appliedRules,
      priceLocked,
      exclusive: exclusive !== undefined,
    }
  }

  type LineRow = typeof salesOrderLines.$inferInsert
  interface Built {
    lines: LineRow[]
    subtotal: number
    discount: number
    tax: number
  }
  /** Loose pieces, an inner, or whole cases: how the shop typed it. */
  function enteredFor(
    v: VariantRow,
    cases: number,
    archetype: ArchetypeKey,
  ): { qty: number; unit: 'piece' | 'inner' | 'case'; pack: number } {
    const inner = innerPackOf(v)
    const cs = v.defaultCaseSize
    const bigTicket = v.mrpPaise >= 15_000 || cs <= 6
    const roll = unitRng()
    const kirana =
      archetype === 'kirana_small' || archetype === 'cash_only' || archetype === 'prepaid'
    if (bigTicket && roll < 0.7)
      return { qty: Math.max(1, Math.min(cs, randInt(unitRng, 2, cs))), unit: 'piece', pack: 1 }
    if (inner && roll < (kirana ? 0.42 : 0.22))
      return {
        qty: randInt(unitRng, 2, Math.max(2, Math.min(8, Math.floor(cs / inner)))),
        unit: 'inner',
        pack: inner,
      }
    if (kirana && roll < 0.55 && cs >= 12)
      return { qty: randInt(unitRng, Math.max(3, Math.floor(cs / 4)), cs), unit: 'piece', pack: 1 }
    return { qty: cases, unit: 'case', pack: cs }
  }
  function buildOrderLines(
    orderId: string,
    retailer: RetailerRow,
    day: Date,
    ageDays: number,
    opts2: {
      pool?: readonly (readonly [number, VariantRow])[]
      force?: { variant: VariantRow; cases: number } | null
      targetPaise?: number
      bargainAllowed?: boolean
      /** Ignore the archetype's bill cap (an approved credit-limit order is meant to be large). */
      uncapped?: boolean
    },
  ): Built {
    const basket = BASKET[retailer.archetype]
    const pool = opts2.pool ?? (ageDays <= 6 ? recentPool : oldPool)
    const lineCount = Math.max(1, randInt(rng, basket.lines[0], basket.lines[1]))
    const chosen: VariantRow[] = []
    const taken = new Set<string>()
    if (opts2.force) {
      chosen.push(opts2.force.variant)
      taken.add(opts2.force.variant.id)
    }
    let guard = 0
    while (chosen.length < lineCount && guard < 40 && pool.length > 0) {
      guard += 1
      const v = pickWeighted(rng, pool)
      if (taken.has(v.id)) continue
      taken.add(v.id)
      chosen.push(v)
    }
    const dayKey = isoDate(day)
    const cap = opts2.uncapped ? Number.POSITIVE_INFINITY : basket.maxOrderPaise
    interface Draft {
      v: VariantRow
      entered: { qty: number; unit: 'piece' | 'inner' | 'case'; pack: number }
      qtyPcs: number
      priced: PricedLine
    }
    const drafts: Draft[] = []
    let running = 0
    chosen.forEach((v, i) => {
      let cases =
        opts2.force && i === 0 ? opts2.force.cases : randInt(rng, basket.cases[0], basket.cases[1])
      let entered = enteredFor(v, cases, retailer.archetype)
      if (opts2.force && i === 0) entered = { qty: cases, unit: 'case', pack: v.defaultCaseSize }
      if (opts2.targetPaise !== undefined) {
        // a bill of roughly the asked value: size the case count from the piece rate
        const perCase =
          rateForRetailer(retailer.tier, pricing.ratesByVariantId, v.id) * v.defaultCaseSize
        const withTax = perCase + Math.round((perCase * (v.gstBps + v.cessBps)) / 10_000)
        cases = Math.max(1, Math.round(opts2.targetPaise / chosen.length / withTax))
        entered = { qty: cases, unit: 'case', pack: v.defaultCaseSize }
      }
      let qtyPcs = entered.qty * entered.pack
      let priced = priceLine(retailer, v, qtyPcs, dayKey, opts2.bargainAllowed ?? false)
      let value = priced.rate * qtyPcs - priced.discountPaise
      value += taxOn(value, v.gstBps, v.cessBps)
      // the shop's bill has a ceiling: trim the line, then drop it
      if (opts2.targetPaise === undefined && running + value > cap) {
        if (drafts.length === 0 || (opts2.force && i === 0)) {
          while (running + value > cap && entered.qty > 1) {
            entered = { ...entered, qty: Math.ceil(entered.qty / 2) }
            qtyPcs = entered.qty * entered.pack
            priced = priceLine(retailer, v, qtyPcs, dayKey, opts2.bargainAllowed ?? false)
            value = priced.rate * qtyPcs - priced.discountPaise
            value += taxOn(value, v.gstBps, v.cessBps)
          }
        } else return
      }
      running += value
      drafts.push({ v, entered, qtyPcs, priced })
    })

    // order-level schemes: the percentage is earned on the lines in scope and spread over them
    const orderRules = new Map<number, AppliedRule[]>()
    const extraDiscount = new Map<number, number>()
    for (const s of orderSchemes) {
      if (!live(s, dayKey)) continue
      const members = drafts
        .map((d, i) => ({ d, i }))
        .filter(({ d }) => inScope(s, d.v) && !d.priced.exclusive)
      const base = members.reduce(
        (sum, { d, i }) =>
          sum + d.priced.rate * d.qtyPcs - d.priced.discountPaise - (extraDiscount.get(i) ?? 0),
        0,
      )
      if (members.length === 0 || base < s.triggerMin) continue
      const total = percentOf(paise(base), s.rewardValue)
      if (total <= 0) continue
      const shares = allocate(
        paise(total),
        members.map(({ d }) => Math.max(1, d.priced.rate * d.qtyPcs - d.priced.discountPaise)),
      )
      members.forEach(({ i }, k) => {
        const share = shares[k] ?? 0
        if (share <= 0) return
        extraDiscount.set(i, (extraDiscount.get(i) ?? 0) + share)
        const rules = orderRules.get(i) ?? []
        rules.push({
          ruleId: s.id,
          version: 1,
          kind: 'scheme',
          rewardKind: 'order_pct',
          amountPaise: share,
        })
        orderRules.set(i, rules)
      })
    }

    let subtotal = 0
    let discount = 0
    let tax = 0
    const lines: LineRow[] = []
    drafts.forEach(({ v, entered, qtyPcs, priced }, i) => {
      const lineDiscount = priced.discountPaise + (extraDiscount.get(i) ?? 0)
      const gross = priced.rate * qtyPcs
      const taxable = gross - lineDiscount
      const lineTax = taxOn(taxable, v.gstBps, v.cessBps)
      // A godown that always picks in full makes the fill-rate chart a flat 1.0 and teaches nobody
      // anything (docs/plans/reporting.md §6 item 2). Its own RNG stream; invoice lines bill `qtyPcs`.
      const shortPicked = priced.freeQtyPcs === 0 && qtyPcs >= 4 && shortPickRng() < 0.05
      const pickedQtyPcs = shortPicked ? Math.max(1, Math.round(qtyPcs * 0.8)) : qtyPcs
      lines.push({
        id: demoId('order-line', `${orderId}:${i}`),
        tenantId,
        orderId,
        lineNo: i + 1,
        variantId: v.id,
        enteredQty: entered.qty,
        enteredUnit: entered.unit,
        packSizeAtEntry: entered.pack,
        qtyPcs,
        freeQtyPcs: priced.freeQtyPcs,
        pickedQtyPcs,
        deliveredQtyPcs: 0,
        listRatePaise: priced.listRate,
        ratePaise: priced.rate,
        discountBps: gross > 0 ? Math.round((lineDiscount * 10_000) / gross) : 0,
        discountPaise: lineDiscount,
        gstBps: v.gstBps,
        taxPaise: lineTax,
        lineTotalPaise: taxable + lineTax,
        appliedRules: [...priced.appliedRules, ...(orderRules.get(i) ?? [])],
        priceLocked: priced.priceLocked,
      })
      subtotal += gross
      discount += lineDiscount
      tax += lineTax
    })
    return { lines, subtotal, discount, tax }
  }

  // --- the order book -------------------------------------------------------------------------------
  const workDays = workingDaysBack(historyDays)
  const ordersOut: OrderRecord[] = []
  const orderLineRows: LineRow[] = []
  const shortDeliveries: ShortDelivery[] = []
  const approvalCases: ApprovalCase[] = []
  const visits: VisitPlan[] = []
  let seq = 0
  let visitSeq = 0

  function pushOrder(
    orderId: string,
    retailer: RetailerRow,
    day: Date,
    outcome: Outcome | 'draft' | 'submitted',
    built: Built,
    who: { source: OrderRecord['source']; createdBy: string; salespersonId: string | null },
    cancelReason: string | null = null,
  ): OrderRecord {
    const { rounded: totalPaise, roundOff } = roundToRupee(
      paise(built.subtotal - built.discount + built.tax),
    )
    const ageDays = ageDaysOf(day)
    let state: FinalOrderState
    let stops: PlannedStop[] = []
    switch (outcome) {
      case 'partial':
        state = 'partially_delivered'
        stops = [{ day, outcome: 'partial' }]
        break
      case 'failed':
        if (ageDays >= 3) {
          // the crew went back two days later and the shop took the load
          state = 'delivered'
          stops = [
            { day, outcome: 'failed' },
            { day: workingDayAfter(day, 2), outcome: 'delivered' },
          ]
        } else {
          state = 'packed'
          stops = [{ day, outcome: 'failed' }]
        }
        break
      case 'delivered':
        state = 'delivered'
        stops = [{ day, outcome: 'delivered' }]
        break
      case 'delivered_today':
        state = 'delivered'
        stops = [{ day: TODAY, outcome: 'delivered' }]
        break
      case 'dispatched':
        state = 'dispatched'
        stops = [{ day, outcome: 'on_road' }]
        break
      default:
        state = outcome
    }
    const last = stops[stops.length - 1]
    orderLineRows.push(...built.lines)
    const record: OrderRecord = {
      id: orderId,
      orderNo: null,
      retailerId: retailer.id,
      retailerCode: retailer.code,
      archetype: retailer.archetype,
      beatIndex: retailer.beatIndex,
      salespersonId: who.salespersonId,
      createdBy: who.createdBy,
      source: who.source,
      state,
      stopOutcome: last?.outcome ?? null,
      stops,
      day,
      subtotalPaise: built.subtotal,
      discountPaise: built.discount,
      taxPaise: built.tax,
      roundOffPaise: roundOff,
      totalPaise,
      lineCount: built.lines.length,
      cancelReason:
        state === 'cancelled'
          ? (cancelReason ?? 'Retailer asked to cancel; ordered by mistake.')
          : null,
      cancelledAt:
        state === 'cancelled' ? (isPreviousWorkingDay(day) ? 'confirmed' : 'submitted') : null,
    }
    ordersOut.push(record)
    return record
  }

  /** The outcome of the k-th order of a day. */
  function outcomeFor(ageDays: number, k: number, yesterday: boolean): Outcome {
    if (ageDays === 0)
      return k < TODAY_CYCLE.length
        ? nth(TODAY_CYCLE, k)
        : nth(TODAY_TAIL, (k - TODAY_CYCLE.length) % TODAY_TAIL.length)
    if (yesterday) {
      // the tempo left this morning with the previous working day's bills: two are already
      // delivered, four are on the road, one is still on the dock and one was cancelled before it
      // was loaded
      return k < YESTERDAY_CYCLE.length ? nth(YESTERDAY_CYCLE, k) : pickWeighted(rng, mixFor(2))
    }
    return pickWeighted(rng, mixFor(ageDays))
  }

  const tradingShops = retailersRes.retailers.filter(
    (r) =>
      TRADING_ARCHETYPES.has(r.archetype) ||
      ['bad_debt', 'blocked_link', 'closed_shop'].includes(r.archetype),
  )
  const NO_ORDER_REASONS = [
    'Enough stock already, will order next visit',
    'Owner not available, staff could not decide',
    'Waiting for the last bill to clear before ordering',
    'Shelf full of a competitor’s scheme stock this week',
  ]
  const forcedFor = (): { variant: VariantRow; cases: number } | null => {
    if (seq % 12 === 0 && campa750.length > 0)
      return { variant: pick(rng, campa750), cases: randInt(rng, 8, 13) }
    if (seq % 13 === 6 && rajwadiSodas.length > 0)
      return { variant: pick(rng, rajwadiSodas), cases: randInt(rng, 4, 9) }
    if (seq % 17 === 0 && gheeVariants.length > 0)
      return { variant: pick(rng, gheeVariants), cases: randInt(rng, 2, 4) }
    if (seq % 23 === 0 && glucoseBig.length > 0)
      return { variant: pick(rng, glucoseBig), cases: randInt(rng, 10, 12) }
    if (seq % 29 === 0 && soapVariants.length > 0)
      return { variant: pick(rng, soapVariants), cases: 1 }
    if (seq % 31 === 0 && chamakVariants.length > 1)
      return { variant: pick(rng, chamakVariants), cases: randInt(rng, 6, 10) }
    return null
  }

  workDays.forEach((day) => {
    const ageDays = ageDaysOf(day)
    const isToday = ageDays === 0
    const yesterday = isPreviousWorkingDay(day)
    const dayKey = isoDate(day)
    const weekday = day.getUTCDay()
    const quota = quotaFor(ageDays, yesterday)
    /** The off-beat channels run at the same pace every day: a couple of orders on top of the beats. */
    const scale = 1
    const usedToday = new Set<string>()
    if (nearLimitShop && ageDays <= 30) usedToday.add(nearLimitShop.id)
    let k = 0
    /** One order for `retailer` today, from `who`, unless the shop already ordered or the day is full. */
    const placeOrder = (
      retailer: RetailerRow,
      who: { source: OrderRecord['source']; createdBy: string; salespersonId: string | null },
      pool?: readonly (readonly [number, VariantRow])[],
    ): OrderRecord | null => {
      if (k >= quota || usedToday.has(retailer.id)) return null
      usedToday.add(retailer.id)
      seq += 1
      const orderId = demoId('order', `${dayKey}:${k}`)
      const outcome = outcomeFor(ageDays, k, yesterday)
      const force = pool ? null : forcedFor()
      const built = buildOrderLines(orderId, retailer, day, ageDays, {
        ...(pool ? { pool } : {}),
        force,
        bargainAllowed: true,
      })
      if (built.lines.length === 0) return null
      k += 1
      return pushOrder(orderId, retailer, day, outcome, built, who)
    }

    // --- the orders that do not come off a beat, drawn first so the beat fills what is left:
    //     the retailer app, the phone and WhatsApp, the manufacturer's rep, the van -----------------
    interface Extra {
      shop: RetailerRow
      who: { source: OrderRecord['source']; createdBy: string; salespersonId: string | null }
      pool?: readonly (readonly [number, VariantRow])[]
      tooYumm?: boolean
    }
    const extras: Extra[] = []
    appLoginCodes.forEach((code, loginIdx) => {
      const shop = retailerByCode.get(code)
      if (!shop || !orders(shop.archetype, ageDays) || sourceRng() >= 0.3 * scale) return
      const user = people.retailerUsers[loginIdx === 1 ? 1 : 0]
      extras.push({
        shop,
        who: {
          source: 'retailer_app',
          createdBy: user.id,
          salespersonId: primaryRep(shop.beatIndex).id,
        },
      })
    })
    if (sourceRng() < 0.36 * scale) {
      const callers = tradingShops.filter(
        (r) =>
          ['grocery_medium', 'supermarket', 'high_volume'].includes(r.archetype) &&
          orders(r.archetype, ageDays),
      )
      if (callers.length > 0) {
        const shop = pick(sourceRng, callers)
        extras.push({
          shop,
          who: {
            source: sourceRng() < 0.6 ? 'phone' : 'whatsapp',
            createdBy: people.manager.id,
            salespersonId: primaryRep(shop.beatIndex).id,
          },
        })
      }
    }
    if (tooYummVariants.length > 0 && sourceRng() < 0.35 * scale) {
      const pool = tradingShops.filter(
        (r) => TRADING_ARCHETYPES.has(r.archetype) && orders(r.archetype, ageDays),
      )
      if (pool.length > 0) {
        extras.push({
          shop: pick(sourceRng, pool),
          who: {
            source: 'salesperson',
            createdBy: people.salespeople.pooja.id,
            salespersonId: people.salespeople.pooja.id,
          },
          pool: tooYummVariants.map((v) => [1, v] as const),
          tooYumm: true,
        })
      }
    }
    // a van sale: the crew sold off the tempo while delivering — one order in ten (spec §2.9)
    if (ageDays >= 1 && sourceRng() < 0.72 * scale) {
      const pool = tradingShops.filter(
        (r) =>
          (r.archetype === 'cash_only' || r.archetype === 'kirana_small') &&
          orders(r.archetype, ageDays),
      )
      if (pool.length > 0) {
        extras.push({
          shop: pick(sourceRng, pool),
          who: { source: 'van_sale', createdBy: pick(sourceRng, crew).id, salespersonId: null },
        })
      }
    }
    const reserved = new Set<string>()
    const extraList = extras.filter((e) => {
      if (reserved.has(e.shop.id) || usedToday.has(e.shop.id)) return false
      reserved.add(e.shop.id)
      return true
    })
    const beatQuota = Math.max(1, quota - extraList.length)

    // --- the beats scheduled today: every call the reps made, then which of them ended in an order.
    //     The order slots go to a random handful of the live calls, never to whoever happened to be
    //     first on the road, so every shop on the beat gets its turn over the weeks --------------------
    interface Call {
      key: string
      shop: RetailerRow
      rep: PersonRef
      beatIndex: number
      startedAt: Date
      endedAt: Date
      dead: boolean
      shuffle: number
    }
    const calls: Call[] = []
    retailersRes.beats.forEach((beat, beatIndex) => {
      if (!beat.visitDays.includes(weekday)) return
      const extra = extraRepFor(beatIndex)
      const rep = extra && visitRng() < 0.2 ? extra : primaryRep(beatIndex)
      const shops = retailersRes.retailers.filter((r) => r.beatIndex === beatIndex)
      let clock = 10 * 60 + randInt(visitRng, 0, 25)
      shops.forEach((shop) => {
        if (shop.archetype === 'new_shop') return
        // a stopped or shut account is passed by now and then; the rest are called on almost every
        // day they are due
        const dead = !orders(shop.archetype, ageDays) || !shop.active
        if (dead ? visitRng() >= 0.12 : visitRng() >= 0.86) return
        const startedAt = atIstTime(day, Math.floor(clock / 60), clock % 60)
        const minutes = randInt(visitRng, 6, 22)
        const endedAt = new Date(startedAt.getTime() + minutes * 60_000)
        clock += minutes + randInt(visitRng, 4, 12)
        visitSeq += 1
        // the big accounts are served first when the day's book is short: a supermarket that
        // orders every visit is the bulk of the value, whatever the week
        calls.push({
          key: `${dayKey}:${visitSeq}`,
          shop,
          rep,
          beatIndex,
          startedAt,
          endedAt,
          dead,
          shuffle: visitRng() * (shop.tier === 'A' ? 0.6 : 1),
        })
      })
    })
    // Every call the rep made is logged, and a Kalyan rep converts roughly half to two thirds of
    // the doors that were open (BASKET.strike): the strike decides the orders, and on the two
    // positional days (today, yesterday) the cycle's length caps them.
    const orderedByCall = new Map<string, OrderRecord>()
    for (const call of calls
      .filter((c) => !c.dead)
      .sort((a, b) => a.shuffle - b.shuffle || (a.key < b.key ? -1 : 1))) {
      if (usedToday.has(call.shop.id) || reserved.has(call.shop.id)) continue
      if (visitRng() >= BASKET[call.shop.archetype].strike) continue
      if (k >= beatQuota) continue
      const order = placeOrder(call.shop, {
        source: 'salesperson',
        createdBy: call.rep.id,
        salespersonId: call.rep.id,
      })
      if (order) orderedByCall.set(call.key, order)
    }
    for (const call of calls) {
      const order = orderedByCall.get(call.key)
      const base = {
        key: call.key,
        retailerId: call.shop.id,
        userId: call.rep.id,
        beatIndex: call.beatIndex,
        day,
        startedAt: call.startedAt,
        endedAt: call.endedAt,
      }
      if (order) {
        visits.push({ ...base, outcome: 'ordered', reason: null, orderId: order.id })
        continue
      }
      const roll = visitRng()
      const outcome: VisitPlan['outcome'] = call.dead
        ? 'no_order'
        : roll < 0.08
          ? 'closed'
          : roll < 0.1
            ? 'not_found'
            : roll < 0.2
              ? 'payment_only'
              : 'no_order'
      visits.push({
        ...base,
        outcome,
        reason:
          outcome === 'no_order'
            ? call.dead
              ? 'Account stopped; asked for the old dues, no order taken'
              : pick(visitRng, NO_ORDER_REASONS)
            : outcome === 'closed'
              ? 'Shutter down'
              : outcome === 'payment_only'
                ? 'Collected against the last bill, nothing new needed'
                : null,
        orderId: null,
      })
    }

    // --- then the off-beat orders ---------------------------------------------------------------------
    for (const e of extraList) {
      const order = placeOrder(e.shop, e.who, e.pool)
      if (order && e.tooYumm) {
        visitSeq += 1
        const startedAt = atIstTime(day, 12, randInt(visitRng, 0, 40))
        visits.push({
          key: `${dayKey}:${visitSeq}`,
          retailerId: e.shop.id,
          userId: people.salespeople.pooja.id,
          beatIndex: e.shop.beatIndex,
          day,
          startedAt,
          endedAt: new Date(startedAt.getTime() + 12 * 60_000),
          outcome: 'ordered',
          reason: null,
          orderId: order.id,
        })
        // the manufacturer's rep walks a few more doors on the same beat and mostly hears "stocked
        // up last week": her strike is a brand rep's, not a hundred per cent
        const others = tradingShops.filter(
          (r) => r.beatIndex === e.shop.beatIndex && r.id !== e.shop.id && r.active,
        )
        for (let n = 0; n < Math.min(others.length, randInt(visitRng, 2, 3)); n++) {
          const shop = pick(visitRng, others)
          visitSeq += 1
          const at = new Date(startedAt.getTime() + (n + 1) * 25 * 60_000)
          visits.push({
            key: `${dayKey}:${visitSeq}`,
            retailerId: shop.id,
            userId: people.salespeople.pooja.id,
            beatIndex: shop.beatIndex,
            day,
            startedAt: at,
            endedAt: new Date(at.getTime() + 9 * 60_000),
            outcome: 'no_order',
            reason: 'Too Yumm stocked up last week; check again on the next round',
            orderId: null,
          })
        }
      }
    }

    if (isToday) {
      // the live day always has a wave on the floor, whatever the beat calendar says: the smallest
      // distributor's one beat may fall short of it, so the phone brings the rest in
      let guard = 0
      while (k < Math.min(4, quota) && guard < 20) {
        guard += 1
        const pool = tradingShops.filter(
          (r) =>
            TRADING_ARCHETYPES.has(r.archetype) && orders(r.archetype, 0) && !usedToday.has(r.id),
        )
        if (pool.length === 0) break
        const shop = pick(sourceRng, pool)
        placeOrder(shop, {
          source: 'phone',
          createdBy: people.manager.id,
          salespersonId: primaryRep(shop.beatIndex).id,
        })
      }
      for (let d = 0; d < 3; d++) {
        seq += 1
        const pool = tradingShops.filter(
          (r) => TRADING_ARCHETYPES.has(r.archetype) && !usedToday.has(r.id),
        )
        if (pool.length === 0) break
        const retailer = pick(rng, pool)
        usedToday.add(retailer.id)
        const orderId = demoId('order', `draft:${d}`)
        const rep = primaryRep(retailer.beatIndex)
        const built = buildOrderLines(orderId, retailer, day, 0, {})
        if (built.lines.length === 0) continue
        pushOrder(orderId, retailer, day, 'draft', built, {
          source: 'salesperson',
          createdBy: rep.id,
          salespersonId: rep.id,
        })
      }
    }
  })

  // --- the shop near its limit: four live bills adding up to ~93 % of it, none paid ----------------
  if (nearLimitShop) {
    const target = Math.round(nearLimitShop.creditLimitPaise * 0.94)
    const slices = [0.34, 0.28, 0.22, 0.16]
    const days = [12, 8, 4, 1]
    slices.forEach((share, i) => {
      const day = workingDayAgo(nth(days, i))
      const orderId = demoId('order', `${isoDate(day)}:near-limit:${i}`)
      const wanted = Math.round(target * share)
      // Several passes: the first sizes the cases off the list rate, each next one corrects for the
      // schemes and the case rounding the last one met, and the closest bill to the asked value wins —
      // so the four bills really add up to ~92 % of the limit and never past it.
      let target2 = wanted
      let built = buildOrderLines(orderId, nearLimitShop, day, ageDaysOf(day), {
        targetPaise: target2,
      })
      const totalOf = (b: Built) => roundToRupee(paise(b.subtotal - b.discount + b.tax)).rounded
      let best = built
      for (let pass = 0; pass < 8; pass++) {
        const total = totalOf(built)
        if (total === 0) break
        if (Math.abs(total - wanted) < Math.abs(totalOf(best) - wanted)) best = built
        if (total <= wanted * 1.02 && total >= wanted * 0.95) break
        target2 = Math.max(1, Math.round((target2 * wanted) / total))
        built = buildOrderLines(orderId, nearLimitShop, day, ageDaysOf(day), {
          targetPaise: target2,
        })
      }
      // the closest bill to the asked value, a whisker over allowed: four of them land at 88-97 %
      // of the limit, never past it
      built = best
      if (built.lines.length === 0) return
      const rep = primaryRep(nearLimitShop.beatIndex)
      pushOrder(orderId, nearLimitShop, day, i === 3 ? 'dispatched' : 'delivered', built, {
        source: 'salesperson',
        createdBy: rep.id,
        salespersonId: rep.id,
      })
    })
  }

  // --- the approval-driven orders (spec §2.9): pending gates today, decided ones behind ------------
  interface Special {
    key: string
    kind: ApprovalCase['kind']
    status: ApprovalCase['status']
    ageDays: number
    shop: RetailerRow | undefined
    outcome: Outcome | 'submitted'
    bargainId: string | null
    cancelReason?: string
    /** An approved credit-limit order is deliberately bigger than the shop's limit. */
    overLimit?: boolean
    force?: { variant: VariantRow; cases: number } | null
  }
  const bargainOf = (status: 'approved' | 'rejected', n: number) =>
    pricing.bargains.filter((b) => b.status === status)[n]
  const shopById = new Map(retailersRes.retailers.map((r) => [r.id, r]))
  const bargainForce = (
    b: { variantId: string } | undefined,
  ): { variant: VariantRow; cases: number } | null => {
    const v = b ? variantById.get(b.variantId) : undefined
    return v ? { variant: v, cases: randInt(rng, 3, 6) } : null
  }
  const specials: Special[] = [
    {
      key: 'credit-limit-1',
      kind: 'credit_limit',
      status: 'pending',
      ageDays: 0,
      shop: nearLimitShop ?? shopOf('grocery_medium', 4),
      outcome: 'submitted',
      bargainId: null,
    },
    {
      key: 'credit-limit-2',
      kind: 'credit_limit',
      status: 'pending',
      ageDays: 0,
      shop: shopOf('overdue_hard'),
      outcome: 'submitted',
      bargainId: null,
    },
    {
      key: 'credit-limit-approved-1',
      kind: 'credit_limit',
      status: 'approved',
      ageDays: 5,
      shop: shopOf('grocery_medium', 2),
      outcome: 'delivered',
      bargainId: null,
      overLimit: true,
    },
    {
      key: 'credit-limit-approved-2',
      kind: 'credit_limit',
      status: 'approved',
      ageDays: 18,
      shop: shopOf('supermarket'),
      outcome: 'delivered',
      bargainId: null,
      overLimit: true,
    },
    {
      key: 'credit-limit-approved-3',
      kind: 'credit_limit',
      status: 'approved',
      ageDays: 40,
      shop: shopOf('kirana_small', 5),
      outcome: 'delivered',
      bargainId: null,
      overLimit: true,
    },
    {
      key: 'credit-limit-rejected-1',
      kind: 'credit_limit',
      status: 'rejected',
      ageDays: 12,
      shop: shopOf('overdue_mild'),
      outcome: 'cancelled',
      bargainId: null,
      cancelReason: 'credit_limit_rejected',
    },
    {
      key: 'bargain-approved-1',
      kind: 'bargain',
      status: 'approved',
      ageDays: 3,
      shop: shopById.get(bargainOf('approved', 0)?.retailerId ?? ''),
      outcome: 'delivered',
      bargainId: bargainOf('approved', 0)?.id ?? null,
      force: bargainForce(bargainOf('approved', 0)),
    },
    {
      key: 'bargain-approved-2',
      kind: 'bargain',
      status: 'approved',
      ageDays: 22,
      shop: shopById.get(bargainOf('approved', 1)?.retailerId ?? ''),
      outcome: 'delivered',
      bargainId: bargainOf('approved', 1)?.id ?? null,
      force: bargainForce(bargainOf('approved', 1)),
    },
    {
      key: 'bargain-rejected-1',
      kind: 'bargain',
      status: 'rejected',
      ageDays: 9,
      shop: shopById.get(bargainOf('rejected', 0)?.retailerId ?? ''),
      outcome: 'cancelled',
      bargainId: bargainOf('rejected', 0)?.id ?? null,
      cancelReason: 'bargain_rejected',
    },
    {
      key: 'below-floor-approved-1',
      kind: 'below_floor',
      status: 'approved',
      ageDays: 7,
      shop: shopOf('kirana_small', 6),
      outcome: 'delivered',
      bargainId: null,
    },
    {
      key: 'below-floor-approved-2',
      kind: 'below_floor',
      status: 'approved',
      ageDays: 26,
      shop: shopOf('grocery_medium', 3),
      outcome: 'delivered',
      bargainId: null,
    },
    {
      key: 'below-floor-rejected-1',
      kind: 'below_floor',
      status: 'rejected',
      ageDays: 15,
      shop: shopOf('kirana_small', 7),
      outcome: 'cancelled',
      bargainId: null,
      cancelReason: 'below_floor_rejected',
    },
  ]
  const pendingBelowFloorOn = 'credit-limit-2'
  for (const sp of specials) {
    if (!sp.shop || sp.ageDays >= historyDays) continue
    const day = workingDayAgo(sp.ageDays)
    const orderId = demoId('order', `${isoDate(day)}:approval:${sp.key}`)
    const rep = primaryRep(sp.shop.beatIndex)
    const built = sp.overLimit
      ? buildOrderLines(orderId, sp.shop, day, sp.ageDays, {
          // a festive stock-up worth half the limit: on top of the running dues it needed the gate
          targetPaise: Math.round(Math.max(sp.shop.creditLimitPaise, 1_500_000) * 0.5),
          uncapped: true,
        })
      : buildOrderLines(orderId, sp.shop, day, sp.ageDays, {
          force: sp.force ?? null,
          bargainAllowed: sp.kind === 'bargain' && sp.status === 'approved',
        })
    if (built.lines.length === 0) continue
    pushOrder(
      orderId,
      sp.shop,
      day,
      sp.outcome,
      built,
      { source: 'salesperson', createdBy: rep.id, salespersonId: rep.id },
      sp.cancelReason ?? null,
    )
    approvalCases.push({
      key: sp.key,
      kind: sp.kind,
      status: sp.status,
      orderId,
      retailerId: sp.shop.id,
      ageDays: sp.ageDays,
      bargainId: sp.bargainId,
    })
    if (sp.key === pendingBelowFloorOn) {
      approvalCases.push({
        key: 'below-floor-pending-1',
        kind: 'below_floor',
        status: 'pending',
        orderId,
        retailerId: sp.shop.id,
        ageDays: 0,
        bargainId: null,
      })
    }
  }

  // Chronological from here on: numbers, invoices and money all follow the calendar.
  ordersOut.sort((a, b) => a.day.getTime() - b.day.getTime() || (a.id < b.id ? -1 : 1))
  const linesByOrderId = new Map<string, LineRow[]>()
  for (const l of orderLineRows) {
    const arr = linesByOrderId.get(l.orderId) ?? []
    arr.push(l)
    linesByOrderId.set(l.orderId, arr)
  }

  // --- what the godown has to have held: every invoiced line, picked pieces plus the free ones -------
  const demand: DemandLine[] = []
  const overrideLineKeys = new Set<string>()
  let invoicedSeq = 0
  for (const order of ordersOut) {
    if (!INVOICE_ELIGIBLE.has(order.state)) continue
    invoicedSeq += 1
    for (const l of linesByOrderId.get(order.id) ?? []) {
      const pcs = (l.pickedQtyPcs ?? l.qtyPcs) + (l.freeQtyPcs ?? 0)
      if (pcs <= 0) continue
      demand.push({
        key: l.id,
        variantId: l.variantId,
        day: order.day,
        pcs,
        lotId: null,
        suggestedLotId: null,
        fefoOverride: false,
      })
      // a handful of lines are picked off the second batch on purpose (the pick sheet says so)
      if (l.lineNo === 2 && invoicedSeq % 9 === 4) overrideLineKeys.add(l.id)
    }
  }
  const flagship = flagshipVariant(variants)
  const vanLoadVariantKeys = [...variants]
    .filter((v) => (profileOf(v) === 'fast' || profileOf(v) === 'float') && v.gstBps > 0)
    .slice(0, 6)
    .map((v) => v.key)
  const stockPlan = planStock({
    variants,
    demand,
    historyDays,
    overrideLineKeys,
    vanLoadVariantKeys,
    // billing.ts sells the van sale and the cancelled bill off the flagship's oldest batch
    holdOnOldestLot: {
      [flagship.key]: VAN_SALE_PCS + CANCELLED_BILL_CASES * flagship.defaultCaseSize,
    },
    profiles,
  })
  const stock = await opts.commitStock(stockPlan)
  const pickByLineId = new Map(stockPlan.demand.map((d) => [d.key, d]))
  const lotById = new Map(stockPlan.lots.map((l) => [l.id, l]))

  // --- numbers, invoices, money -------------------------------------------------------------------------
  let soSeq = 0
  let invSeq = 0
  let receiptSeq = 0
  const invoiceLineRows: (typeof invoiceLines.$inferInsert)[] = []
  const journalEntryRows: (typeof journalEntries.$inferInsert)[] = []
  const journalLineRows: (typeof journalLines.$inferInsert)[] = []
  const receiptRows: (typeof receipts.$inferInsert)[] = []
  const allocationRows: (typeof allocations.$inferInsert)[] = []
  const cashDiscountRows: (typeof cashDiscountConditions.$inferInsert)[] = []
  const saleLedgerRows: (typeof stockLedger.$inferInsert)[] = []
  const invoices_: InvoiceRecord[] = []
  const invoiceFinancials = new Map<
    string,
    {
      subtotal: number
      discount: number
      cgst: number
      sgst: number
      cessOnly: number
      roundOff: number
    }
  >()
  const outstandingByRetailer = new Map<string, RetailerOutstanding>()
  /** Running unpaid value per shop, so no account drifts past its limit. Starts at the carried dues. */
  const unpaidByRetailer = new Map<string, number>()
  for (const bill of planOpeningBills(retailersRes.retailers)) {
    if (bill.isBadDebt) continue
    unpaidByRetailer.set(
      bill.retailerId,
      (unpaidByRetailer.get(bill.retailerId) ?? 0) + bill.totalPaise,
    )
  }

  // The document prefixes are this distributor's own configuration, not a constant.
  const soPrefix = await seriesPrefix(db, tenantId, 'SO', 'SO-')
  const invPrefix = await seriesPrefix(db, tenantId, 'INV', 'INV/')
  const cnPrefix = await seriesPrefix(db, tenantId, 'CN', 'CN/')
  const rcptPrefix = await seriesPrefix(db, tenantId, 'RCPT', 'RCPT-')

  const entry = (
    key: string,
    date: Date,
    refType: string,
    refId: string,
    narration: string,
    postedBy: string,
  ): string => {
    const id = demoId('journal-entry', key)
    journalEntryRows.push({
      id,
      tenantId,
      entryDate: isoDate(date),
      refType,
      refId,
      narration,
      idempotencyKey: `journal:${key}`,
      postedBy,
      postedAt: occurred(date),
    })
    return id
  }
  const line = (
    entryId: string,
    key: string,
    code: string,
    amountPaise: number,
    retailerId?: string,
  ): void => {
    if (amountPaise === 0) return
    journalLineRows.push({
      id: demoId('journal-line', key),
      tenantId,
      entryId,
      accountId: acc(code),
      amountPaise,
      ...(retailerId ? { partyType: 'retailer', partyId: retailerId } : {}),
    })
  }
  const accountForMode = (mode: string): string =>
    mode === 'cash'
      ? 'CASH'
      : mode === 'upi'
        ? 'UPI'
        : mode === 'bank_transfer'
          ? 'BANK'
          : mode === 'cheque'
            ? 'CHEQUES'
            : mode === 'credit_note'
              ? 'SALES_RETURNS'
              : 'DISCOUNTS'

  /** How a bill is settled once the shop pays it: in one go, in two, on account, or with change. */
  type Style = 'full' | 'partial' | 'on_account' | 'over'
  /** No ordinary account carries more than this share of its limit unpaid. */
  const CAP_SHARE = 0.8
  /** A stopped account sits at its limit and no further: the crew takes cash for anything beyond. */
  const STOP_SHARE = 0.8
  /**
   * When a shop of each kind settles a bill, in days after it (spec §2.6 "intended outstanding",
   * §2.10 the ageing profile): a kirana on seven-day terms pays some at the door, the bulk over the
   * next three weeks, and a third of its bills slip past that; a supermarket on three-week terms
   * runs its terms out and then some; every kind has a tail into the second month. A day past today
   * means the bill is simply still open — which is what fills the 8-15 and 16-30 overdue buckets
   * with a dozen and eight shops instead of the whole book paying inside a week. The cap below keeps
   * the account under its limit: with an old bill hanging, the newer ones are collected promptly,
   * which is exactly how a sticky account behaves.
   */
  const SETTLE_TABLE: Readonly<
    Partial<Record<ArchetypeKey, readonly (readonly [number, readonly [number, number]])[]>>
  > = {
    // seven-day terms, paid in a fortnight or so: the founder's stated problem is exactly this
    kirana_small: [
      [5, [0, 0]],
      [10, [2, 7]],
      [22, [8, 15]],
      [30, [16, 28]],
      [23, [29, 45]],
      [10, [46, 62]],
    ],
    // fourteen-day terms, paid in four weeks
    grocery_medium: [
      [2, [0, 0]],
      [6, [4, 10]],
      [18, [11, 18]],
      [30, [19, 30]],
      [30, [31, 45]],
      [14, [46, 62]],
    ],
    // three-week terms, paid in five
    supermarket: [
      [4, [6, 13]],
      [14, [14, 22]],
      [30, [23, 36]],
      [32, [37, 50]],
      [20, [51, 70]],
    ],
    // the wholesaler pays when its own money comes in: six weeks
    high_volume: [
      [4, [6, 13]],
      [12, [14, 22]],
      [28, [23, 38]],
      [34, [39, 54]],
      [22, [55, 75]],
    ],
  }
  /**
   * The accounts an old limit never kept up with (`RetailerRow.overLimit`): they pay like the
   * wholesaler and the owner lets them run a third past the limit before the rep is sent to collect
   * (2026-09-08 review: not one shop over its limit left the over-limit screen empty).
   */
  const overLimitShopIds = new Set(
    retailersRes.retailers.filter((r) => r.overLimit).map((r) => r.id),
  )
  /**
   * Days after the bill this shop settles it, or null for a bill nobody is going to pay inside the
   * history. The frozen and dead accounts hold their dues up to a share of their limit; the shop
   * near its limit holds its live bills by design; the rest draw from their archetype's table.
   */
  function settleAfterDays(
    retailer: RetailerRow,
    ageDays: number,
    billable: number,
  ): number | null {
    const a = retailer.archetype
    const unpaid = unpaidByRetailer.get(retailer.id) ?? 0
    /** Collected on the next call: a day or three after the bill, never past today. */
    const promptly = (): number => Math.min(ageDays, randInt(moneyRng, 1, 3))
    if (retailer.id === nearLimitShop?.id)
      return ageDays <= 30 ? null : Math.min(ageDays, randInt(moneyRng, 5, 14))
    if (a === 'cash_only' || a === 'prepaid') return 0
    if (a === 'bad_debt' || a === 'blocked_link' || a === 'overdue_hard' || a === 'closed_shop') {
      if (a === 'closed_shop' && ageDays > stops.closed + 5)
        return Math.min(ageDays, randInt(moneyRng, 3, 10))
      if (a === 'overdue_hard' && ageDays > stops.overdueHard + 35)
        return Math.min(ageDays, randInt(moneyRng, 10, 30))
      // the bad debt paid, slowly, until it was stopped; its last bills were never paid
      if (a === 'bad_debt' && ageDays > stops.badDebt + 8)
        return Math.min(ageDays, randInt(moneyRng, 8, 20))
      if (unpaid + billable > retailer.creditLimitPaise * STOP_SHARE) return promptly()
      return null
    }
    if (overLimitShopIds.has(retailer.id)) {
      const late = SETTLE_TABLE.high_volume ?? []
      const [lo, hi] = pickWeighted(moneyRng, late)
      return randInt(moneyRng, lo + 4, hi + 4)
    }
    if (a === 'overdue_mild') {
      if (ageDays > 67) return Math.min(ageDays, randInt(moneyRng, 20, 45))
      if (unpaid + billable > retailer.creditLimitPaise * 0.85) return promptly()
      if (ageDays <= 22) return randInt(moneyRng, 3, 9)
      return null
    }
    const table =
      SETTLE_TABLE[a === 'credit_near_limit' ? 'grocery_medium' : a] ?? SETTLE_TABLE.kirana_small
    if (!table) return null
    const [lo, hi] = pickWeighted(moneyRng, table)
    return randInt(moneyRng, lo, hi)
  }
  /** Seven bills in ten settled in one go, two in ten in two, one in ten on account (spec §2.9). */
  function settlementStyle(): Style {
    return pickWeighted(moneyRng, [
      [64, 'full'],
      [24, 'partial'],
      [10, 'on_account'],
      [2, 'over'],
    ] as const)
  }
  let overPaymentsLeft = 2
  let bouncesLeft = 2
  /**
   * Two bills short-paid by a few rupees the desk wrote back (`adjustment`) and two settled partly
   * against a brand credit passed on to the shop (`credit_note`), spec §2.9 — chosen by position
   * among the ordinary full settlements so every distributor gets its two of each.
   */
  let residualSeq = 0
  const RESIDUAL_MODES: Readonly<Record<number, 'adjustment' | 'credit_note'>> = {
    3: 'adjustment',
    7: 'credit_note',
    13: 'adjustment',
    19: 'credit_note',
  }
  const BOUNCE_CHARGES_PAISE = 35_000
  /** Rounded to the rupee-hundred the way a shopkeeper counts out a part payment. */
  const roundHundred = (n: number): number => Math.max(100, Math.round(n / 100) * 100)

  // --- what the shop accepted at the door, line by line: a part-delivery is one line short, and the
  //     short pieces come back on a credit note the bill is settled net of ---------------------------
  const orderById = new Map(ordersOut.map((o) => [o.id, o]))
  const shortByOrderId = new Map<string, { orderLineId: string; shortPcs: number }>()
  for (const order of ordersOut) {
    if (order.state !== 'partially_delivered') continue
    const ls = linesByOrderId.get(order.id) ?? []
    // the refused pieces come back to the rack: never on a SKU the shelf is out of or short of,
    // whose story is that nothing is on the rack
    const restockable = (l: LineRow): boolean => {
      const lv = variantById.get(l.variantId)
      return lv !== undefined && stocked(lv)
    }
    const l0 =
      ls.find((l) => (l.pickedQtyPcs ?? 0) >= 4 && restockable(l)) ??
      ls.find((l) => restockable(l)) ??
      ls.find((l) => (l.pickedQtyPcs ?? 0) >= 4) ??
      ls[0]
    const v = l0 ? variantById.get(l0.variantId) : undefined
    if (!l0 || !v) continue
    const picked = l0.pickedQtyPcs ?? l0.qtyPcs
    const shortPcs = Math.max(
      1,
      Math.min(picked - 1, Math.max(1, Math.round(v.defaultCaseSize / 4))),
    )
    shortByOrderId.set(order.id, { orderLineId: l0.id, shortPcs })
  }
  for (const l of orderLineRows) {
    const order = orderById.get(l.orderId)
    if (!order) continue
    const picked = l.pickedQtyPcs ?? 0
    const short = shortByOrderId.get(order.id)
    if (order.state === 'delivered') l.deliveredQtyPcs = picked
    else if (order.state === 'partially_delivered')
      l.deliveredQtyPcs = picked - (short && short.orderLineId === l.id ? short.shortPcs : 0)
    else l.deliveredQtyPcs = 0
    if (order.state === 'picking') l.pickedQtyPcs = 0
  }

  // --- credit notes: every short delivery, damaged and saleable returns, rate differences, the
  //     brand's cash-discount settlement ----------------------------------------------------------------
  const cnRows: (typeof creditNotes.$inferInsert)[] = []
  const cnLineRows: (typeof creditNoteLines.$inferInsert)[] = []
  const cnLedgerRows: (typeof stockLedger.$inferInsert)[] = []
  /** Money already set against each bill (receipts and notes), kept as the loop below writes them. */
  const allocatedByInvoice = new Map<string, number>()
  const allocateTo = (invoiceId: string, amountPaise: number): void =>
    void allocatedByInvoice.set(invoiceId, (allocatedByInvoice.get(invoiceId) ?? 0) + amountPaise)
  let cnSeq = 0
  /** One note per bill: two generators walk the same list and the id is keyed on the invoice. */
  const notedInvoiceIds = new Set<string>()
  type CnReason =
    | 'short_delivery'
    | 'return_damaged'
    | 'return_saleable'
    | 'rate_difference'
    | 'scheme_settlement'
    | 'other'
  function creditNote(
    inv: InvoiceRecord,
    reason: CnReason,
    qtyPcs: number,
    ratePaise: number,
    note: string,
    restock: { locationId: string; reason: 'sale_return_saleable' | 'sale_return_damaged' } | null,
    onLine: InvoiceLineRecord | undefined = inv.lines[0],
    daysLater = 0,
    /** False while the bill is still being settled in the loop: its dues are added afterwards. */
    adjustOutstanding = true,
  ): boolean {
    const l0 = onLine
    const v = l0 ? variantById.get(l0.variantId) : undefined
    if (!l0 || !v || notedInvoiceIds.has(inv.id)) return false
    const openPaise = inv.totalPaise - (allocatedByInvoice.get(inv.id) ?? 0)
    let qty = Math.min(qtyPcs, l0.qtyPcs)
    const priced = () => {
      const taxable = paise(ratePaise * qty)
      const tax = taxOn(taxable, v.gstBps, v.cessBps)
      return { taxable, tax, ...roundToRupee(paise(taxable + tax)) }
    }
    let money = priced()
    while (qty > 1 && money.rounded > openPaise) {
      qty -= 1
      money = priced()
    }
    if (money.rounded <= 0 || money.rounded > openPaise) return false
    cnSeq += 1
    notedInvoiceIds.add(inv.id)
    const cnId = demoId('credit-note', inv.id)
    const cnNo = `${cnPrefix}${String(cnSeq).padStart(4, '0')}`
    const noteDay = new Date(inv.invoiceDate.getTime() + daysLater * 86_400_000)
    const at = occurred(atIstTime(noteDay, 19, 0))
    const halfGst = percentOf(money.taxable, v.gstBps / 2)
    const cess = percentOf(money.taxable, v.cessBps)
    cnRows.push({
      id: cnId,
      tenantId,
      creditNoteNo: cnNo,
      seriesCode: 'CN',
      fy: FY,
      noteDate: isoDate(noteDay),
      invoiceId: inv.id,
      retailerId: inv.retailerId,
      reason,
      state: 'issued',
      taxablePaise: money.taxable,
      cgstPaise: halfGst,
      sgstPaise: halfGst,
      cessPaise: cess,
      roundOffPaise: money.roundOff,
      totalPaise: money.rounded,
      issuedBy: people.accountant.id,
      issuedAt: at,
      note,
      createdAt: at,
    })
    cnLineRows.push({
      id: demoId('credit-note-line', cnId),
      tenantId,
      creditNoteId: cnId,
      invoiceLineId: l0.invoiceLineId,
      qtyPcs: qty,
      saleable: restock?.reason === 'sale_return_saleable',
      ratePaise,
      taxablePaise: money.taxable,
      gstBps: v.gstBps + v.cessBps,
      taxPaise: money.tax,
      // the line is taxable + tax to the paisa; the header rounds to the rupee and says so
      lineTotalPaise: money.taxable + money.tax,
    })
    const cnEntry = entry(
      `credit-note:${cnId}`,
      at,
      'credit_note',
      cnId,
      `Credit note ${cnNo}`,
      people.accountant.id,
    )
    line(cnEntry, `${cnId}:returns`, 'SALES_RETURNS', money.taxable)
    line(cnEntry, `${cnId}:cgst`, 'OUTPUT_CGST', halfGst)
    line(cnEntry, `${cnId}:sgst`, 'OUTPUT_SGST', halfGst)
    line(cnEntry, `${cnId}:cess`, 'OUTPUT_CESS', cess)
    line(cnEntry, `${cnId}:roundoff`, 'ROUND_OFF', money.roundOff)
    line(cnEntry, `${cnId}:ar`, 'AR', 0 - money.rounded, inv.retailerId)
    allocationRows.push({
      id: demoId('allocation', `credit-note:${cnId}`),
      tenantId,
      invoiceId: inv.id,
      creditNoteId: cnId,
      amountPaise: money.rounded,
      allocatedAt: at,
    })
    allocateTo(inv.id, money.rounded)
    const o = adjustOutstanding ? outstandingByRetailer.get(inv.retailerId) : undefined
    if (o) {
      o.outstandingPaise -= money.rounded
      const item = o.items.find((it) => it.outstandingPaise >= money.rounded)
      if (item) item.outstandingPaise -= money.rounded
    }
    if (restock && l0.lotId) {
      cnLedgerRows.push({
        id: demoId('ledger', `cn:${cnId}`),
        tenantId,
        occurredAt: at,
        lotId: l0.lotId,
        locationId: restock.locationId,
        qtyDelta: qty,
        reason: restock.reason,
        refType: 'credit_note',
        refId: cnId,
        actorId: people.accountant.id,
        idempotencyKey: `credit-note:${cnId}:${l0.lotId}`,
        note: `credit note ${cnNo}`,
      })
    }
    return true
  }

  for (const order of ordersOut) {
    if (order.state === 'draft') continue
    soSeq += 1
    order.orderNo = `${soPrefix}${String(soSeq).padStart(4, '0')}`

    if (!INVOICE_ELIGIBLE.has(order.state)) continue
    invSeq += 1
    const retailer = retailerByCode.get(order.retailerCode)
    if (!retailer) continue
    const ageFromToday = ageDaysOf(order.day)

    const orderLines = linesByOrderId.get(order.id) ?? []
    const invoiceId = demoId('invoice', order.id)
    const invoiceNo = `${invPrefix}${String(invSeq).padStart(4, '0')}`
    // The bill is issued at pack for what was PICKED (`InvoicesService.moveStock`): a short-picked
    // line bills the pieces that left the godown, its discount scaled with them, so money and stock
    // never disagree on a bill. The order keeps its ordered totals; the fill-rate chart is the gap.
    const billedQty = (l: LineRow): number =>
      l.pickedQtyPcs !== undefined && l.pickedQtyPcs !== null && l.pickedQtyPcs > 0
        ? Math.min(l.pickedQtyPcs, l.qtyPcs)
        : l.qtyPcs
    const billedDiscount = (l: LineRow): number => {
      const d = l.discountPaise ?? 0
      return l.qtyPcs > 0 ? Math.round((d * billedQty(l)) / l.qtyPcs) : d
    }
    const subtotal = orderLines.reduce((s, l) => s + l.ratePaise * billedQty(l), 0)
    const discount = orderLines.reduce((s, l) => s + billedDiscount(l), 0)
    let cgst = 0
    let sgst = 0
    let cessOnly = 0
    for (const l of orderLines) {
      const v = variantById.get(l.variantId)
      if (!v) continue
      const taxable = l.ratePaise * billedQty(l) - billedDiscount(l)
      const halfGst = percentOf(paise(taxable), v.gstBps / 2)
      cgst += halfGst
      sgst += halfGst
      cessOnly += percentOf(paise(taxable), v.cessBps)
    }
    const { rounded: totalPaise, roundOff } = roundToRupee(
      paise(subtotal - discount + cgst + sgst + cessOnly),
    )
    const shortPicked = orderLines.some((l) => billedQty(l) < l.qtyPcs)
    if (!shortPicked && totalPaise !== order.totalPaise)
      throw new Error(
        `invoice ${invoiceNo} (${totalPaise}) disagrees with its order (${order.totalPaise})`,
      )
    const invoiceDate = order.day
    const dueDate = isoDate(new Date(invoiceDate.getTime() + retailer.creditDays * 86_400_000))
    const cashDiscountApplies = retailer.cashDiscountBps > 0
    const payBy = new Date(invoiceDate.getTime() + retailer.cashDiscountDays * 86_400_000)
    const packedAt = occurred(atIstTime(invoiceDate, 11, 30))

    const lineRecords: InvoiceLineRecord[] = []
    invoiceLineRows.push(
      ...orderLines.map((l, i) => {
        const v = variantById.get(l.variantId)
        const pickLine = pickByLineId.get(l.id)
        const lot = pickLine?.lotId ? lotById.get(pickLine.lotId) : undefined
        const qty = billedQty(l)
        const lineDiscount = billedDiscount(l)
        const lineTaxable = l.ratePaise * qty - lineDiscount
        const halfGst = v ? percentOf(paise(lineTaxable), v.gstBps / 2) : 0
        const lineCess = v ? percentOf(paise(lineTaxable), v.cessBps) : 0
        const invoiceLineId = demoId('invoice-line', `${invoiceId}:${i}`)
        // the rules print what they were worth on the pieces billed: the ones that make up the
        // line's discount are allocated so they still sum to it (largest remainder), the rest scale
        const DISCOUNT_RULES = new Set(['line_pct', 'net_scheme_amount', 'order_pct'])
        const isDiscountRule = (r: AppliedRule): boolean =>
          r.kind === 'scheme' && DISCOUNT_RULES.has(r.rewardKind ?? '')
        const scaled = (rules: AppliedRule[]): AppliedRule[] => {
          if (qty === l.qtyPcs) return rules
          const out = rules.map((r) =>
            r.amountPaise !== undefined && !isDiscountRule(r)
              ? { ...r, amountPaise: Math.round((r.amountPaise * qty) / l.qtyPcs) }
              : { ...r },
          )
          const discountAt = out
            .map((r, k) => ({ r, k }))
            .filter(({ r }) => isDiscountRule(r) && r.amountPaise !== undefined)
          if (discountAt.length > 0 && lineDiscount > 0) {
            const shares = allocate(
              paise(lineDiscount),
              discountAt.map(({ r }) => Math.max(1, r.amountPaise ?? 0)),
            )
            discountAt.forEach(({ k }, j) => {
              const r = out[k]
              if (r) r.amountPaise = shares[j] ?? 0
            })
          }
          return out
        }
        lineRecords.push({
          invoiceLineId,
          orderLineId: l.id,
          variantId: l.variantId,
          qtyPcs: qty,
          freeQtyPcs: l.freeQtyPcs ?? 0,
          pickedQtyPcs: l.pickedQtyPcs ?? l.qtyPcs,
          ratePaise: l.ratePaise ?? 0,
          taxablePaise: lineTaxable,
          lotId: lot?.id ?? null,
          suggestedLotId: pickLine?.suggestedLotId ?? null,
          fefoOverride: pickLine?.fefoOverride ?? false,
        })
        // the pieces leave the rack at pack, keyed exactly as `InventoryService.postPick` keys them
        if (lot && pickLine && pickLine.pcs > 0) {
          const key = `pack:${order.id}:${l.id}:${lot.id}`
          saleLedgerRows.push({
            id: demoId('ledger', key),
            tenantId,
            occurredAt: packedAt,
            lotId: lot.id,
            locationId: stock.godownId,
            qtyDelta: -pickLine.pcs,
            reason: 'sale',
            refType: 'pack',
            refId: order.id,
            actorId: people.warehouse.id,
            idempotencyKey: key,
          })
        }
        return {
          id: invoiceLineId,
          tenantId,
          invoiceId,
          lineNo: i + 1,
          orderLineId: l.id,
          variantId: l.variantId,
          lotId: lot?.id ?? null,
          description: v?.name ?? 'Item',
          hsnCode: v?.hsnCode ?? '',
          batchNo: lot?.batchNo ?? null,
          // batch AND expiry print on a food bill: the shop checks it at the door
          expiryDate: lot ? isoDate(lot.expiryDate) : null,
          mrpPaise: v?.mrpPaise ?? null,
          qtyPcs: qty,
          freeQtyPcs: l.freeQtyPcs,
          enteredQty: qty === l.qtyPcs ? l.enteredQty : qty,
          enteredUnit: qty === l.qtyPcs ? l.enteredUnit : 'piece',
          packSizeAtEntry: qty === l.qtyPcs ? l.packSizeAtEntry : 1,
          caseSize: v?.defaultCaseSize ?? null,
          ratePaise: l.ratePaise,
          discountBps: l.discountBps ?? 0,
          discountPaise: lineDiscount,
          taxablePaise: lineTaxable,
          gstBps: v?.gstBps ?? 0,
          cgstPaise: halfGst,
          sgstPaise: halfGst,
          cessBps: v?.cessBps ?? 0,
          cessPaise: lineCess,
          lineTotalPaise: lineTaxable + halfGst + halfGst + lineCess,
          appliedRules: scaled(l.appliedRules ?? []),
        }
      }),
    )

    // --- the sale itself, one balanced entry ---
    const saleEntry = entry(
      `invoice:${invoiceId}`,
      atIstTime(invoiceDate, 18, 30),
      'invoice',
      invoiceId,
      `Invoice ${invoiceNo} to ${retailer.name}`,
      people.accountant.id,
    )
    line(saleEntry, `invoice:${invoiceId}:ar`, 'AR', totalPaise, retailer.id)
    line(saleEntry, `invoice:${invoiceId}:sales`, 'SALES', -subtotal)
    line(saleEntry, `invoice:${invoiceId}:discount`, 'DISCOUNTS', discount)
    line(saleEntry, `invoice:${invoiceId}:cgst`, 'OUTPUT_CGST', -cgst)
    line(saleEntry, `invoice:${invoiceId}:sgst`, 'OUTPUT_SGST', -sgst)
    line(saleEntry, `invoice:${invoiceId}:cess`, 'OUTPUT_CESS', -cessOnly)
    line(saleEntry, `invoice:${invoiceId}:roundoff`, 'ROUND_OFF', -Number(roundOff))
    invoiceFinancials.set(invoiceId, { subtotal, discount, cgst, sgst, cessOnly, roundOff })

    const record: InvoiceRecord = {
      id: invoiceId,
      invoiceNo,
      orderId: order.id,
      retailerId: retailer.id,
      retailerCode: retailer.code,
      beatIndex: retailer.beatIndex,
      invoiceDate,
      ageDays: ageFromToday,
      totalPaise,
      state: 'issued',
      doorReceipt: null,
      lines: lineRecords,
    }
    invoices_.push(record)

    // --- a part-delivery: the short pieces come back on a credit note, and the shop settles the rest ---
    const short = shortByOrderId.get(order.id)
    const shortLine = short
      ? lineRecords.find((l) => l.orderLineId === short.orderLineId)
      : undefined
    if (short && shortLine) {
      const sv = variantById.get(shortLine.variantId)
      shortDeliveries.push({
        invoiceId,
        invoiceLineId: shortLine.invoiceLineId,
        shortPcs: short.shortPcs,
      })
      creditNote(
        record,
        'short_delivery',
        short.shortPcs,
        shortLine.ratePaise,
        `${short.shortPcs} pcs of ${sv?.name ?? 'item'} refused at the door (outer damaged); adjusted against ${invoiceNo}.`,
        { locationId: stock.godownId, reason: 'sale_return_saleable' },
        shortLine,
        0,
        false,
      )
    }
    const cnAllocated = allocatedByInvoice.get(invoiceId) ?? 0
    /** What the shop actually owes on this bill after the note. */
    const billable = totalPaise - cnAllocated

    // --- the money ---
    let state: InvoiceRecord['state'] = 'issued'
    let doorReceipt: DoorReceipt | null = null
    let allocated = 0
    const undelivered = order.stopOutcome === 'failed' || order.stopOutcome === 'on_road'
    const unpaidNow = unpaidByRetailer.get(retailer.id) ?? 0
    const capApplies =
      retailer.creditMode !== 'stop' &&
      retailer.id !== nearLimitShop?.id &&
      retailer.creditLimitPaise > 0
    // the over-limit accounts are allowed well past their (stale) limit before the rep is sent to collect
    const cap = retailer.creditLimitPaise * (overLimitShopIds.has(retailer.id) ? 1.8 : CAP_SHARE)
    // a bill still on the road is unpaid — unless the load would take the account past its room:
    // then it paid in advance, or the load would not have gone out (the shop near its limit is the
    // one account allowed to sit there)
    const paidInAdvance = undelivered && capApplies && unpaidNow + billable > cap
    /** Days after the bill the shop settles it; past today means it is still open. */
    let settleAfter: number | null
    if (billable <= 0) settleAfter = null
    else if (paidInAdvance) settleAfter = 0
    else if (undelivered) settleAfter = null
    else settleAfter = settleAfterDays(retailer, ageFromToday, billable)
    // an unpaid bill must not push an ordinary account past 70 % of its limit — the rep collected
    // it on the next call instead
    let capForced = false
    if (
      settleAfter !== null &&
      settleAfter > ageFromToday &&
      capApplies &&
      unpaidNow + billable > cap
    ) {
      settleAfter = Math.min(ageFromToday, randInt(moneyRng, 1, 3))
      capForced = true
    }
    if (settleAfter !== null && settleAfter <= ageFromToday) {
      const atDoor =
        !paidInAdvance &&
        settleAfter === 0 &&
        order.stopOutcome !== null &&
        order.stopOutcome !== 'on_road' &&
        order.stopOutcome !== 'failed'
      // a bill the shop was made to settle is settled in full: that was the point
      let style: Style = paidInAdvance || atDoor || capForced ? 'full' : settlementStyle()
      // a part payment's balance and an unmatched on-account receipt both keep the bill open on
      // the books: not on an account that has no room left for it
      if (
        (style === 'partial' || style === 'on_account') &&
        capApplies &&
        unpaidNow + billable > cap
      )
        style = 'full'
      // never on a Sunday: the depot is shut and no rep is on the road
      const payDay = atDoor ? invoiceDate : collectionDay(invoiceDate, settleAfter)
      const withinWindow =
        cashDiscountApplies && style === 'full' && payDay.getTime() <= payBy.getTime()
      const cashDiscountPaise = withinWindow
        ? percentOf(paise(billable), retailer.cashDiscountBps)
        : 0
      let receiptAmount: number
      let allocationAmount: number
      let effective: Style = style
      if (style === 'over' && overPaymentsLeft === 0) effective = 'full'
      if (effective === 'full') {
        receiptAmount = billable - cashDiscountPaise
        allocationAmount = billable
      } else if (effective === 'partial') {
        receiptAmount = Math.min(billable, roundHundred(billable * (0.4 + moneyRng() * 0.3)))
        allocationAmount = receiptAmount
      } else if (effective === 'over') {
        overPaymentsLeft -= 1
        receiptAmount = billable + 50_000
        allocationAmount = billable
      } else {
        // on account: the money arrived, nobody named the bill; the desk matches it later
        receiptAmount = billable
        allocationAmount = 0
      }

      let mode: (typeof receipts.$inferInsert)['mode']
      const receiptAge = Math.round((TODAY.getTime() - payDay.getTime()) / 86_400_000)
      const bigBill = receiptAmount >= 300_000
      if (paidInAdvance) mode = 'upi'
      else if (atDoor) mode = moneyRng() < 0.68 ? 'cash' : 'upi'
      else {
        // cash first (the crew and the reps collect), then UPI; the bigger bills by transfer and
        // cheque (spec §2.9: ~45 / 30 / 12 / 10)
        const roll = moneyRng()
        if (roll < 0.4) mode = 'cash'
        else if (roll < 0.66) mode = 'upi'
        else if (roll < 0.8) mode = bigBill ? 'bank_transfer' : 'upi'
        else if (roll < 0.96) mode = bigBill && receiptAge >= 1 ? 'cheque' : 'cash'
        else mode = 'upi'
      }
      // a residual settled other than in money: the shop's payment is short of the bill by that
      // much, and a second receipt of the other kind closes it
      let residualMode: 'adjustment' | 'credit_note' | null = null
      let residualPaise = 0
      if (
        effective === 'full' &&
        !atDoor &&
        !paidInAdvance &&
        cashDiscountPaise === 0 &&
        receiptAge >= 5 &&
        billable >= 100_000 &&
        totalPaise < 2_000_000
      ) {
        residualSeq += 1
        residualMode = RESIDUAL_MODES[residualSeq] ?? null
        if (residualMode === 'adjustment') residualPaise = 2_000 + (receiptSeq % 7) * 700
        else if (residualMode === 'credit_note')
          residualPaise = Math.max(
            1_000,
            Math.round(billable * 0.04) - (Math.round(billable * 0.04) % 1_000),
          )
        if (residualPaise >= billable) residualMode = null
        if (residualMode) {
          receiptAmount -= residualPaise
          allocationAmount -= residualPaise
          if (mode === 'cheque' || mode === 'bank_transfer') mode = 'cash'
        }
      }
      // never before the bill itself (issued at 11:35): the desk books money from half past twelve
      const receivedAt = occurred(
        atDoor ? atIstTime(invoiceDate, 17, 0) : atIstTime(payDay, 12 + (receiptSeq % 6), 30),
      )
      const receivedBy = atDoor
        ? pick(moneyRng, crew).id
        : mode === 'cash' && moneyRng() < 0.6
          ? (order.salespersonId ?? people.accountant.id)
          : people.accountant.id
      receiptSeq += 1
      const receiptId = demoId('receipt', invoiceId)
      // a cheque older than a few days has been banked; the recent ones are still in the drawer
      const chequeDeposited = mode === 'cheque' && receiptAge >= 4
      const bounced =
        mode === 'cheque' &&
        chequeDeposited &&
        bouncesLeft > 0 &&
        cashDiscountPaise === 0 &&
        receiptAge >= 6 &&
        retailer.creditMode === 'indicate' &&
        capApplies &&
        allocationAmount > 0 &&
        unpaidNow + billable <= cap
      if (bounced) bouncesLeft -= 1
      const depositedAt = chequeDeposited ? atIstTime(workingDayAfter(payDay, 2), 11, 0) : null
      receiptRows.push({
        id: receiptId,
        tenantId,
        receiptNo: `${rcptPrefix}${String(receiptSeq).padStart(4, '0')}`,
        retailerId: retailer.id,
        mode,
        amountPaise: receiptAmount,
        receivedAt,
        receivedBy,
        reference:
          mode === 'upi'
            ? `UTR${300000000 + receiptSeq}`
            : mode === 'bank_transfer'
              ? `NEFT${800000000 + receiptSeq}`
              : mode === 'cheque'
                ? `${700100 + receiptSeq}`
                : null,
        upiVpa: mode === 'upi' ? `${retailer.code.toLowerCase()}@okaxis` : null,
        bankName:
          mode === 'cheque' ? (receiptSeq % 2 === 0 ? 'Bank of Maharashtra' : 'HDFC Bank') : null,
        chequeDate: mode === 'cheque' ? isoDate(receivedAt) : null,
        status: bounced ? 'bounced' : chequeDeposited ? 'deposited' : 'collected',
        depositedAt,
        depositRef: chequeDeposited ? `DEP/2026/${String(receiptSeq).padStart(4, '0')}` : null,
        depositAccountId: chequeDeposited ? acc('BANK') : null,
        bouncedAt:
          bounced && depositedAt ? atIstTime(workingDayAfter(depositedAt, 2), 16, 0) : null,
        bounceReason: bounced ? 'insufficient funds' : null,
        bankChargesPaise: bounced ? BOUNCE_CHARGES_PAISE : 0,
        cashDiscountPaise,
        note: paidInAdvance
          ? 'Paid in advance on UPI before the load went out (account at its limit).'
          : effective === 'on_account'
            ? 'Paid on account; bill not named.'
            : effective === 'partial'
              ? 'Part payment; balance promised on the next visit.'
              : effective === 'over'
                ? 'Paid more than the bill; the difference sits on account.'
                : residualMode === 'adjustment'
                  ? `Short by ₹${(residualPaise / 100).toFixed(2)}; the balance was written back.`
                  : residualMode === 'credit_note'
                    ? `Short by ₹${(residualPaise / 100).toFixed(2)}; the balance came off a brand credit.`
                    : null,
        idempotencyKey: `receipt:${invoiceId}`,
        createdAt: receivedAt,
      })
      // on account: the desk matched it to the bill a few days later, unless that is still to come
      const matchDay =
        effective === 'on_account' ? workingDayAfter(payDay, randInt(moneyRng, 1, 5)) : payDay
      const matched =
        effective === 'on_account' ? matchDay.getTime() <= TODAY.getTime() : allocationAmount > 0
      const matchedAmount = effective === 'on_account' ? billable : allocationAmount
      if (matched && matchedAmount > 0) {
        allocationRows.push({
          id: demoId('allocation', invoiceId),
          tenantId,
          invoiceId,
          receiptId,
          amountPaise: matchedAmount,
          allocatedAt:
            effective === 'on_account' ? occurred(atIstTime(matchDay, 10, 15)) : receivedAt,
          ...(effective === 'on_account' ? { allocatedBy: people.accountant.id } : {}),
        })
        allocateTo(invoiceId, matchedAmount)
        allocated = matchedAmount
      }
      const rEntry = entry(
        `receipt:${invoiceId}`,
        receivedAt,
        'receipt',
        receiptId,
        `${effective === 'partial' ? 'Part-payment' : effective === 'on_account' ? 'On-account payment' : 'Receipt'} for ${invoiceNo} (${retailer.name})`,
        people.accountant.id,
      )
      line(rEntry, `receipt:${invoiceId}:cash`, accountForMode(mode), receiptAmount, retailer.id)
      line(rEntry, `receipt:${invoiceId}:cd`, 'CASH_DISCOUNT', cashDiscountPaise, retailer.id)
      line(
        rEntry,
        `receipt:${invoiceId}:ar`,
        'AR',
        -(receiptAmount + cashDiscountPaise),
        retailer.id,
      )
      if (atDoor && (mode === 'cash' || mode === 'upi'))
        doorReceipt = { receiptId, mode, amountPaise: receiptAmount }
      if (residualMode && residualPaise > 0) {
        const residualId = demoId('receipt', `${invoiceId}:residual`)
        const residualAt = occurred(new Date(receivedAt.getTime() + 25 * 60_000))
        receiptRows.push({
          id: residualId,
          tenantId,
          receiptNo: `${rcptPrefix}${String(receiptSeq).padStart(4, '0')}-A`,
          retailerId: retailer.id,
          mode: residualMode,
          amountPaise: residualPaise,
          receivedAt: residualAt,
          receivedBy: people.accountant.id,
          status: 'collected',
          cashDiscountPaise: 0,
          note:
            residualMode === 'adjustment'
              ? `Short-paid by ₹${(residualPaise / 100).toFixed(2)}; written back on the desk.`
              : `₹${(residualPaise / 100).toFixed(2)} settled against a brand credit passed to the shop.`,
          idempotencyKey: `receipt:${invoiceId}:residual`,
          createdAt: residualAt,
        })
        allocationRows.push({
          id: demoId('allocation', `${invoiceId}:residual`),
          tenantId,
          invoiceId,
          receiptId: residualId,
          amountPaise: residualPaise,
          allocatedAt: residualAt,
          allocatedBy: people.accountant.id,
        })
        allocateTo(invoiceId, residualPaise)
        allocated += residualPaise
        const xEntry = entry(
          `receipt:${invoiceId}:residual`,
          residualAt,
          'receipt',
          residualId,
          `${residualMode === 'adjustment' ? 'Balance written back' : 'Brand credit applied'} on ${invoiceNo} (${retailer.name})`,
          people.accountant.id,
        )
        line(
          xEntry,
          `receipt:${invoiceId}:residual:contra`,
          accountForMode(residualMode),
          residualPaise,
          retailer.id,
        )
        line(xEntry, `receipt:${invoiceId}:residual:ar`, 'AR', -residualPaise, retailer.id)
      }
      if (chequeDeposited && depositedAt) {
        const dEntry = entry(
          `deposit:${invoiceId}`,
          depositedAt,
          'deposit',
          `DEP/2026/${String(receiptSeq).padStart(4, '0')}`,
          `Cheque ${700100 + receiptSeq} banked`,
          people.accountant.id,
        )
        line(dEntry, `deposit:${invoiceId}:bank`, 'BANK', receiptAmount)
        line(dEntry, `deposit:${invoiceId}:cheques`, 'CHEQUES', -receiptAmount)
      }
      if (bounced && depositedAt) {
        // A returned cheque puts AR back exactly where it was and the bank's fee is our cost
        // (docs/plans/00-coordination.md §7 question 9): the receipt is reversed, never edited.
        const bouncedAt = atIstTime(workingDayAfter(depositedAt, 2), 16, 0)
        const reversalId = demoId('receipt', `bounce:${invoiceId}`)
        receiptRows.push({
          id: reversalId,
          tenantId,
          receiptNo: `${rcptPrefix}${String(receiptSeq).padStart(4, '0')}-R`,
          retailerId: retailer.id,
          mode: 'cheque',
          amountPaise: -receiptAmount,
          receivedAt: bouncedAt,
          receivedBy: people.accountant.id,
          reversesReceiptId: receiptId,
          status: 'cancelled',
          note: 'Reverses the returned cheque; insufficient funds.',
          idempotencyKey: `receipt:bounce:${invoiceId}`,
          createdAt: bouncedAt,
        })
        const bEntry = entry(
          `receipt-bounce:${invoiceId}`,
          bouncedAt,
          'receipt',
          reversalId,
          `Cheque ${700100 + receiptSeq} returned unpaid (${retailer.name})`,
          people.accountant.id,
        )
        line(bEntry, `receipt-bounce:${invoiceId}:ar`, 'AR', receiptAmount, retailer.id)
        line(bEntry, `receipt-bounce:${invoiceId}:bank`, 'BANK', -receiptAmount)
        line(bEntry, `receipt-bounce:${invoiceId}:charges`, 'BANK_CHARGES', BOUNCE_CHARGES_PAISE)
        line(bEntry, `receipt-bounce:${invoiceId}:charges-bank`, 'BANK', -BOUNCE_CHARGES_PAISE)
        allocationRows.push({
          id: demoId('allocation', `bounce:${invoiceId}`),
          tenantId,
          invoiceId,
          receiptId: reversalId,
          amountPaise: -allocationAmount,
          allocatedAt: bouncedAt,
        })
        allocateTo(invoiceId, -allocationAmount)
        allocated = 0
      }
      // the balance of a part payment, a week to three on — unless that day is still to come
      if (effective === 'partial') {
        const secondDay = collectionDay(payDay, randInt(moneyRng, 7, 21))
        const remainder = billable - allocationAmount
        if (secondDay.getTime() <= TODAY.getTime() && remainder > 0) {
          receiptSeq += 1
          const secondId = demoId('receipt', `${invoiceId}:2`)
          const secondAt = occurred(atIstTime(secondDay, 12 + (receiptSeq % 5), 15))
          const secondMode = moneyRng() < 0.5 ? 'cash' : 'upi'
          receiptRows.push({
            id: secondId,
            tenantId,
            receiptNo: `${rcptPrefix}${String(receiptSeq).padStart(4, '0')}`,
            retailerId: retailer.id,
            mode: secondMode,
            amountPaise: remainder,
            receivedAt: secondAt,
            receivedBy:
              secondMode === 'cash'
                ? (order.salespersonId ?? people.accountant.id)
                : people.accountant.id,
            reference: secondMode === 'upi' ? `UTR${300000000 + receiptSeq}` : null,
            upiVpa: secondMode === 'upi' ? `${retailer.code.toLowerCase()}@okaxis` : null,
            status: 'collected',
            note: 'Balance of the earlier part payment.',
            idempotencyKey: `receipt:${invoiceId}:2`,
            createdAt: secondAt,
          })
          allocationRows.push({
            id: demoId('allocation', `${invoiceId}:2`),
            tenantId,
            invoiceId,
            receiptId: secondId,
            amountPaise: remainder,
            allocatedAt: secondAt,
          })
          allocateTo(invoiceId, remainder)
          allocated += remainder
          const sEntry = entry(
            `receipt:${invoiceId}:2`,
            secondAt,
            'receipt',
            secondId,
            `Balance payment for ${invoiceNo} (${retailer.name})`,
            people.accountant.id,
          )
          line(
            sEntry,
            `receipt:${invoiceId}:2:cash`,
            accountForMode(secondMode),
            remainder,
            retailer.id,
          )
          line(sEntry, `receipt:${invoiceId}:2:ar`, 'AR', -remainder, retailer.id)
        }
      }
      state =
        allocated + cnAllocated >= totalPaise
          ? 'paid'
          : allocated + cnAllocated > 0
            ? 'partially_paid'
            : 'issued'
      if (cashDiscountApplies) {
        const realised = cashDiscountPaise > 0 && !bounced
        cashDiscountRows.push({
          id: demoId('cash-discount', invoiceId),
          tenantId,
          invoiceId,
          discountBps: retailer.cashDiscountBps,
          payBy: isoDate(payBy),
          status: realised
            ? 'realised'
            : payBy.getTime() >= TODAY.getTime() && state !== 'paid'
              ? 'open'
              : 'lapsed',
          realisedReceiptId: realised ? receiptId : null,
          realisedPaise: realised ? cashDiscountPaise : null,
        })
      }
    } else if (cashDiscountApplies) {
      cashDiscountRows.push({
        id: demoId('cash-discount', invoiceId),
        tenantId,
        invoiceId,
        discountBps: retailer.cashDiscountBps,
        payBy: isoDate(payBy),
        status: payBy.getTime() >= TODAY.getTime() ? 'open' : 'lapsed',
      })
      if (cnAllocated > 0) state = 'partially_paid'
    } else if (cnAllocated > 0) state = 'partially_paid'
    if (cnAllocated >= totalPaise) state = 'paid'
    record.state = state
    record.doorReceipt = doorReceipt

    const outstanding = totalPaise - allocated - cnAllocated
    if (outstanding > 0) {
      unpaidByRetailer.set(retailer.id, (unpaidByRetailer.get(retailer.id) ?? 0) + outstanding)
      const prev = outstandingByRetailer.get(retailer.id) ?? {
        outstandingPaise: 0,
        openBills: 0,
        oldestDueDate: null,
        items: [],
      }
      prev.outstandingPaise += outstanding
      prev.openBills += 1
      if (!prev.oldestDueDate || dueDate < prev.oldestDueDate) prev.oldestDueDate = dueDate
      prev.items.push({ outstandingPaise: outstanding, dueDate })
      outstandingByRetailer.set(retailer.id, prev)
    }
  }

  // --- write the order book -----------------------------------------------------------------------------
  await insertMany(
    db,
    salesOrders,
    ordersOut.map((o) => {
      const retailer = retailerByCode.get(o.retailerCode)
      const reached = (s: FinalOrderState) =>
        [
          'confirmed',
          'picking',
          'packed',
          'dispatched',
          'delivered',
          'partially_delivered',
        ].includes(s) ||
        (o.state === 'cancelled' && o.cancelledAt === 'confirmed')
      const createdAt = occurred(
        atIstTime(o.day, o.state === 'draft' ? 16 : 9, 40 + (o.lineCount % 15)),
      )
      return {
        id: o.id,
        tenantId,
        orderNo: o.orderNo,
        retailerId: o.retailerId,
        state: o.state,
        source: o.source,
        createdBy: o.createdBy,
        salespersonId: o.salespersonId,
        paymentTerms: retailer?.paymentTerms ?? ('POST_FULFILLMENT' as const),
        fulfilFromLocationId: stock.godownId,
        subtotalPaise: o.subtotalPaise,
        discountPaise: o.discountPaise,
        taxPaise: o.taxPaise,
        roundOffPaise: o.roundOffPaise,
        totalPaise: o.totalPaise,
        submittedAt: o.state === 'draft' ? null : occurred(atIstTime(o.day, 10, 0)),
        confirmedAt: reached(o.state) ? occurred(atIstTime(o.day, 11, 0)) : null,
        closedAt: null,
        cancelledAt: o.state === 'cancelled' ? occurred(atIstTime(o.day, 12, 0)) : null,
        cancelReason: o.cancelReason,
        createdAt,
        updatedAt: createdAt,
      }
    }),
  )
  await insertMany(db, salesOrderLines, orderLineRows)

  // A compact, plausible state-transition trail per order, following the machine's own events.
  const path: { event: string; state: FinalOrderState }[] = [
    { event: 'submit', state: 'submitted' },
    { event: 'confirm', state: 'confirmed' },
    { event: 'start_picking', state: 'picking' },
    { event: 'pack', state: 'packed' },
    { event: 'dispatch', state: 'dispatched' },
  ]
  const transitionRows: (typeof orderStateTransitions.$inferInsert)[] = []
  for (const order of ordersOut) {
    if (order.state === 'draft') continue
    let from: FinalOrderState | null = 'draft'
    let hour = 10
    let day = order.day
    const push = (event: string, to: FinalOrderState, reason?: string) => {
      transitionRows.push({
        id: demoId('order-transition', `${order.id}:${event}:${isoDate(day)}`),
        tenantId,
        orderId: order.id,
        fromState: from,
        toState: to,
        event,
        actorId: event === 'cancel' ? people.owner.id : order.createdBy,
        occurredAt: occurred(atIstTime(day, hour, 0)),
        ...(reason ? { reason } : {}),
      })
      from = to
      hour += 1
    }
    if (order.state === 'cancelled') {
      push('submit', 'submitted')
      if (order.cancelledAt === 'confirmed') push('confirm', 'confirmed')
      push('cancel', 'cancelled', order.cancelReason ?? undefined)
      continue
    }
    const rode = order.stops.length > 0
    const target: FinalOrderState = rode ? 'dispatched' : order.state
    for (const step of path) {
      push(step.event, step.state)
      if (step.state === target) break
    }
    order.stops.forEach((stop, i) => {
      if (i > 0) {
        day = stop.day
        hour = 9
        push('dispatch', 'dispatched')
      }
      if (stop.outcome === 'delivered') push('deliver_all', 'delivered')
      else if (stop.outcome === 'partial') push('deliver_partial', 'partially_delivered')
      else if (stop.outcome === 'failed')
        push('return_undelivered', 'packed', 'Stop failed; goods back on the dock')
    })
  }
  await insertMany(db, orderStateTransitions, transitionRows)

  await insertMany(
    db,
    invoices,
    invoices_.map((inv) => {
      const retailer = retailerByCode.get(inv.retailerCode)
      const fin = invoiceFinancials.get(inv.id)
      const subtotal = fin?.subtotal ?? 0
      const discount = fin?.discount ?? 0
      const cgst = fin?.cgst ?? 0
      const sgst = fin?.sgst ?? 0
      const cessOnly = fin?.cessOnly ?? 0
      const roundOff = fin?.roundOff ?? 0
      const issuedAt = occurred(atIstTime(inv.invoiceDate, 11, 35))
      return {
        id: inv.id,
        tenantId,
        invoiceNo: inv.invoiceNo,
        seriesCode: 'INV',
        fy: FY,
        invoiceDate: isoDate(inv.invoiceDate),
        orderId: inv.orderId,
        retailerId: inv.retailerId,
        source: 'pack' as const,
        state: inv.state,
        supplyType: retailer?.gstin ? ('B2B' as const) : ('B2C' as const),
        sellerGstin,
        buyerGstin: retailer?.gstin ?? null,
        buyerName: retailer?.name ?? '',
        buyerAddress: retailer?.address ?? {
          area: 'Kalyan West',
          city: 'Kalyan',
          pincode: '421301',
        },
        placeOfSupplyState: '27',
        sellerFssai: SELLER_FSSAI,
        isInterState: false,
        subtotalPaise: subtotal,
        discountPaise: discount,
        taxablePaise: subtotal - discount,
        cgstPaise: cgst,
        sgstPaise: sgst,
        cessPaise: cessOnly,
        roundOffPaise: roundOff,
        totalPaise: inv.totalPaise,
        cashDiscountBps: retailer?.cashDiscountBps ?? 0,
        cashDiscountUntil:
          retailer && retailer.cashDiscountBps > 0
            ? isoDate(new Date(inv.invoiceDate.getTime() + retailer.cashDiscountDays * 86_400_000))
            : null,
        dueDate: retailer
          ? isoDate(new Date(inv.invoiceDate.getTime() + retailer.creditDays * 86_400_000))
          : isoDate(inv.invoiceDate),
        upiQrPayload: `upi://pay?pa=${upiVpa}&pn=${encodeURIComponent(sellerName)}&am=${(inv.totalPaise / 100).toFixed(2)}&tr=${inv.invoiceNo.replace(/\//g, '-')}&cu=INR`,
        issuedBy: people.warehouse.id,
        issuedAt,
        createdAt: issuedAt,
        updatedAt: issuedAt,
      }
    }),
  )

  await insertMany(db, invoiceLines, invoiceLineRows)
  // Receipt numbers follow the day the money came in, not the bill it settled: a part payment's
  // balance and a bill paid late take their numbers where they land on the desk's register.
  {
    const originals = receiptRows
      .filter((r) => !r.reversesReceiptId)
      .sort(
        (a, b) =>
          (a.receivedAt?.getTime() ?? 0) - (b.receivedAt?.getTime() ?? 0) || (a.id < b.id ? -1 : 1),
      )
    const numberOf = new Map<string, string>()
    originals.forEach((r, i) => {
      const no = `${rcptPrefix}${String(i + 1).padStart(4, '0')}`
      r.receiptNo = no
      numberOf.set(r.id, no)
    })
    for (const r of receiptRows) {
      if (!r.reversesReceiptId) continue
      const base = numberOf.get(r.reversesReceiptId)
      if (base) r.receiptNo = `${base}-R`
    }
  }
  await insertMany(db, receipts, receiptRows)
  // (the allocations follow the credit notes below: a short-delivery note is allocated to its bill)
  // the pieces leave the rack: after the plan is written, so every batch has its balance row
  await postLedger(db, tenantId, saleLedgerRows)

  // the other notes: damaged and saleable returns, rate differences, the brand's cash-discount settlement
  // (never on a shop whose dues are the story: the account at its limit, the overdue ones)
  const delivered = invoices_.filter(
    (inv) =>
      orderById.get(inv.orderId)?.state === 'delivered' &&
      inv.ageDays >= 3 &&
      !protectedRetailerIds.has(inv.retailerId),
  )
  let returns = 0
  let saleableReturns = 0
  let rateDiffs = 0
  let schemeSettlements = 0
  delivered.forEach((inv, i) => {
    const l0 = inv.lines[0]
    const v = l0 ? variantById.get(l0.variantId) : undefined
    if (!l0 || !v) return
    if (i % 23 === 5 && returns < 4) {
      if (
        creditNote(
          inv,
          'return_damaged',
          Math.max(1, Math.round(v.defaultCaseSize / 3)),
          l0.ratePaise,
          `${v.name}: packets crushed in the shop's storeroom, taken back to the damaged bin.`,
          { locationId: stock.damagedId, reason: 'sale_return_damaged' },
          l0,
          2,
        )
      )
        returns += 1
    } else if (i % 31 === 12 && saleableReturns < 3 && stocked(v)) {
      // (never on a SKU the shelf is out of or short of: the return would restock its story)
      if (
        creditNote(
          inv,
          'return_saleable',
          v.defaultCaseSize,
          l0.ratePaise,
          `${v.name}: one case returned unopened, the shop over-ordered; back in the godown.`,
          { locationId: stock.godownId, reason: 'sale_return_saleable' },
          l0,
          3,
        )
      )
        saleableReturns += 1
    } else if (i % 29 === 7 && rateDiffs < 4) {
      // the DIFFERENCE per piece, never today's list (ADR 0004): a rupee or two a piece on the
      // biggest line of the bill
      const big = [...inv.lines].sort((a, b) => b.qtyPcs - a.qtyPcs)[0] ?? l0
      const bv = variantById.get(big.variantId) ?? v
      const diff = Math.max(100, Math.min(300, Math.round(big.ratePaise * 0.03)))
      if (
        creditNote(
          inv,
          'rate_difference',
          big.qtyPcs,
          diff,
          `Rate difference on ${bv.name}: ₹${(diff / 100).toFixed(2)} a piece agreed with the shopkeeper, the list moved after the order. No goods moved.`,
          null,
          big,
          1,
        )
      )
        rateDiffs += 1
    }
  })
  // the brand's cash discount, settled by credit note on a couple of Too Yumm bills paid in time
  delivered
    .filter((inv) => inv.lines.some((l) => variantById.get(l.variantId)?.brandKey === 'tooyumm'))
    .forEach((inv, i) => {
      if (i % 9 !== 4 || schemeSettlements >= 2) return
      const tyLine = inv.lines.find((l) => variantById.get(l.variantId)?.brandKey === 'tooyumm')
      if (!tyLine) return
      if (
        creditNote(
          inv,
          'scheme_settlement',
          tyLine.qtyPcs,
          Math.max(1, Math.round(tyLine.ratePaise * 0.02)),
          'Too Yumm 2 % cash discount settled by credit note: paid within the window, claimed from the brand on FieldAssist.',
          null,
          tyLine,
          4,
        )
      )
        schemeSettlements += 1
    })

  await insertMany(db, creditNotes, cnRows)
  await insertMany(db, creditNoteLines, cnLineRows)
  await insertMany(db, journalEntries, journalEntryRows)
  await insertMany(db, journalLines, journalLineRows)
  await insertMany(db, allocations, allocationRows)
  await insertMany(db, cashDiscountConditions, cashDiscountRows)
  await postLedger(db, tenantId, cnLedgerRows, new Set([stock.damagedId]))

  // A COUNTER NEVER GOES BACKWARDS: these bump, never set, so a series the app has taken past this
  // point keeps its lead.
  await bumpSeries(db, tenantId, 'SO', soPrefix, soSeq + 1)
  await bumpSeries(db, tenantId, 'INV', invPrefix, invSeq + 1)
  await bumpSeries(db, tenantId, 'CN', cnPrefix, cnRows.length + 1)
  await bumpSeries(db, tenantId, 'RCPT', rcptPrefix, receiptSeq + 1)

  return {
    orders: ordersOut,
    invoices: invoices_,
    outstandingByRetailer,
    shortDeliveries,
    approvalCases,
    visits,
    protectedRetailerIds,
    stock,
  }
}
