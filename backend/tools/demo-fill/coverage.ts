import { contract } from '@dos/contracts'
import type { Api, Session } from './client.js'
import { maybe } from './helpers.js'
import { addDays, demoId, isDemoId, todayIst, tripIdOf } from './ids.js'
import type { TesterKey } from './people.js'
import { SLOT_DOORS } from './plan.js'
import type { Row } from './summary.js'

/**
 * WHAT EACH ROLE OPENS ON, read through the API with the procedures its screens use. One function per row of
 * the brief's table; each answers its features with yes / no and a detail made of counts only. Where the tool
 * is the one that makes a thing (an order held for credit, a wave to pick, a van on the road), the feature
 * holds only when at least one of them is the TOOL's — so on a database that already has activity the check
 * still proves the tool, not the seed. `check:demo-coverage` calls these signed in as every tester login;
 * `fill:demo` calls them as the owner at the end of a run to say what it left behind.
 */
export interface Seen {
  row: Row
  feature: string
  ok: boolean
  detail: string
}

export interface CoverageSessions {
  owner: Session
  manager?: Session | undefined
  accountant?: Session | undefined
  sales1?: Session | undefined
  sales2?: Session | undefined
  godown?: Session | undefined
  driver1?: Session | undefined
  driver2?: Session | undefined
  /**
   * The testers' user ids, for a read as the owner (the tool's own read-back, which signs no tester in): a rep's
   * orders are found by its id, and a van's trip of the day carries its driver's id (`tripIdOf`).
   */
  userIds?: Partial<Record<TesterKey, string>> | undefined
}

/** The user id of a tester: its session's, else the one the caller named. */
function userIdOf(s: CoverageSessions, key: 'sales1' | 'sales2' | 'driver1' | 'driver2') {
  return s[key]?.userId ?? s.userIds?.[key]
}

/** A van's trip of `date`, by its driver (null when that driver is unknown or the trip is not there). */
function dayTrip(api: Api, s: CoverageSessions, session: Session, date: string, van: 'driver1' | 'driver2') {
  const driver = userIdOf(s, van)
  return driver
    ? tripOf(api, session, tripIdOf(s.owner.tenantId, date, van, driver))
    : Promise.resolve(null)
}

function seen(row: Row, feature: string, ok: boolean, detail: string): Seen {
  return { row, feature, ok, detail }
}

/** `n of them the tool's`: the detail every "is there work" feature prints. */
function mine(total: number, ours: number, what: string): string {
  return `${String(total)} ${what} (${String(ours)} made by the tool)`
}

function tripOf(api: Api, s: Session, id: string) {
  return maybe(api.call(s, contract.delivery.trips.get, { id })).then((r) => r?.item ?? null)
}

// ------------------------------------------------------------------------------------------- shopkeeper

/**
 * The shopkeeper row, read as the owner for the three shops that stand for `shop1…3` (no shopkeeper login can
 * be made through the API: DOS-400). Which shops they are is read off today's vans: the doors the
 * plan gives them (`SLOT_DOORS`).
 */
export async function shopkeeperRow(api: Api, s: CoverageSessions, date: string): Promise<Seen[]> {
  const out: Seen[] = [
    seen('shopkeeper', 'login', false, 'no shopkeeper login can be made through the API (DOS-400)'),
  ]
  const trips = {
    driver1: await dayTrip(api, s, s.owner, date, 'driver1'),
    driver2: await dayTrip(api, s, s.owner, date, 'driver2'),
  }
  const stopAt = (driver: 'driver1' | 'driver2', index: number) =>
    trips[driver]?.stops.find((x) => x.sequence === index + 1) ?? null
  const schemes = await api.call(s.owner, contract.pricing.schemes.list, {
    activeOnly: true,
    on: date,
    limit: 200,
  })
  let onWay = 0
  let delivered = 0
  let dues = 0
  let again = 0
  let offer = 0
  for (const slot of SLOT_DOORS) {
    const d = stopAt(...slot.delivered)
    const w = stopAt(...slot.onTheWay)
    const shopId = d?.retailerId ?? w?.retailerId
    if (!shopId) continue
    if (
      w &&
      w.retailerId === shopId &&
      (w.state === 'pending' || w.state === 'started' || w.state === 'arrived')
    )
      onWay++
    if (
      d &&
      d.retailerId === shopId &&
      (d.state === 'delivered' || d.state === 'partial') &&
      d.deliveries.some((x) => x.invoiceNo !== null)
    )
      delivered++
    const owes = await maybe(
      api.call(s.owner, contract.receivables.outstanding.get, {
        retailerId: shopId,
        includeBills: false,
      }),
    )
    if ((owes?.outstandingPaise ?? 0) > 0) dues++
    const last = await api.call(s.owner, contract.orders.lastPlaced, { retailerId: shopId })
    if (last.item) again++
    const applies = schemes.items.some((x) => {
      const ids = x.applicability.retailerIds ?? []
      return isDemoId(x.id) && (ids.length === 0 || ids.includes(shopId))
    })
    if (applies) offer++
  }
  const of3 = (n: number, what: string) => `${String(n)}/3 stand-in shops ${what}`
  out.push(
    seen('shopkeeper', 'on-the-way', onWay === 3, of3(onWay, 'have a bill on a van still to come')),
    seen('shopkeeper', 'delivered-bill', delivered === 3, of3(delivered, 'had a bill delivered')),
    seen('shopkeeper', 'dues', dues === 3, of3(dues, 'owe money')),
    seen('shopkeeper', 'offer', offer === 3, of3(offer, "have the tool's offer on")),
    seen('shopkeeper', 'order-again', again === 3, of3(again, 'have a last order to repeat')),
  )
  return out
}

// ------------------------------------------------------------------------------------------------ reps

export async function salesRow(api: Api, s: CoverageSessions, date: string): Promise<Seen[]> {
  const out: Seen[] = []
  for (const rep of ['sales1', 'sales2'] as const) {
    const session = s[rep] ?? s.owner
    const as = s[rep] ? '' : ' (read as the owner: no rep signed in)'
    const userId = userIdOf(s, rep)
    const assignments = await api.call(session, contract.retailers.beats.assignments.list, {
      on: date,
      currentOnly: true,
      ...(userId ? { userId } : {}),
    })
    const beatId = assignments.items[0]?.beatId ?? null
    out.push(
      seen(
        'sales',
        'beat-today',
        beatId !== null,
        `${rep}: ${String(assignments.items.length)} beat(s) on ${date}${as}`,
      ),
    )
    const slots = rep === 'sales1' ? ['h1', 'w1'] : ['h2', 'w2']
    const wanted = new Set(slots.map((slot) => demoId(s.owner.tenantId, date, 'order', slot)))
    const orders = await api.call(session, contract.orders.list, {
      ...(userId ? { salespersonId: userId } : {}),
      limit: 200,
    })
    const taken = orders.items.filter((o) => wanted.has(o.id))
    out.push(
      seen(
        'sales',
        'two-orders',
        taken.length >= 2,
        `${rep}: ${String(taken.length)} of the day's orders taken`,
      ),
    )
    let over = 0
    let shops = 0
    if (beatId) {
      const list = await api.call(session, contract.retailers.list, { beatId, limit: 500 })
      shops = list.items.length
      for (const shop of list.items) {
        const c = await maybe(
          api.call(session, contract.receivables.creditCheck, {
            retailerId: shop.id,
            orderTotalPaise: 0,
          }),
        )
        if (
          c &&
          c.creditLimitPaise > 0 &&
          c.outstandingPaise + c.undeliveredPaise > c.creditLimitPaise
        )
          over++
      }
    }
    out.push(
      seen(
        'sales',
        'over-limit-shop',
        over >= 1,
        `${rep}: ${String(over)} of ${String(shops)} shop(s) on the beat over the credit limit`,
      ),
    )
  }
  return out
}

// ------------------------------------------------------------------------------------------- manager

export async function managerRow(api: Api, s: CoverageSessions): Promise<Seen[]> {
  const m = s.manager ?? s.owner
  const pending = await api.call(m, contract.orders.approvals.list, {
    status: 'pending',
    limit: 200,
  })
  const ours = pending.items.filter((a) => isDemoId(a.orderId))
  const credit = ours.filter((a) => a.kind === 'credit_limit')
  const drafts = await api.call(m, contract.warehouse.loadSheets.list, {
    status: 'draft',
    limit: 200,
  })
  const toSign = drafts.items.filter((d) => d.approvedAt === null)
  const review = await api.call(m, contract.procurement.supplierInvoices.list, {
    status: 'in_review',
    limit: 200,
  })
  const returns = await api.call(m, contract.billing.creditNotes.list, {
    state: 'draft',
    limit: 200,
  })
  const count = <T extends { id: string }>(items: readonly T[]) =>
    items.filter((x) => isDemoId(x.id)).length
  return [
    seen(
      'manager',
      'approvals-waiting',
      ours.length > 0,
      mine(pending.items.length, ours.length, 'approval(s) pending'),
    ),
    seen(
      'manager',
      'held-for-credit',
      credit.length > 0,
      `${String(credit.length)} held for credit`,
    ),
    seen(
      'manager',
      'load-sheet-to-sign',
      count(toSign) > 0,
      mine(toSign.length, count(toSign), 'load sheet(s) to sign off'),
    ),
    seen(
      'manager',
      'supplier-bill-review',
      count(review.items) > 0,
      mine(review.items.length, count(review.items), 'supplier bill(s) in review'),
    ),
    seen(
      'manager',
      'return-to-approve',
      count(returns.items) > 0,
      mine(returns.items.length, count(returns.items), 'return(s) waiting to be issued'),
    ),
  ]
}

// -------------------------------------------------------------------------------------------- godown

export async function godownRow(api: Api, s: CoverageSessions): Promise<Seen[]> {
  const g = s.godown ?? s.owner
  const gate = await api.call(g, contract.procurement.grns.list, { status: 'counting', limit: 100 })
  const open = await api.call(g, contract.warehouse.picklists.list, { status: 'open', limit: 100 })
  const picked = await api.call(g, contract.warehouse.picklists.list, {
    status: 'picked',
    limit: 100,
  })
  const sheets = await api.call(g, contract.warehouse.loadSheets.list, {
    status: 'draft',
    limit: 100,
  })
  const count = <T extends { id: string }>(items: readonly T[]) =>
    items.filter((x) => isDemoId(x.id)).length
  return [
    seen(
      'godown',
      'gate-to-count',
      count(gate.items) > 0,
      mine(gate.items.length, count(gate.items), 'receipt(s) at the gate'),
    ),
    seen(
      'godown',
      'wave-to-pick',
      count(open.items) > 0,
      mine(open.items.length, count(open.items), 'wave(s) to pick'),
    ),
    seen(
      'godown',
      'packs-to-make',
      count(picked.items) > 0,
      mine(picked.items.length, count(picked.items), 'picked wave(s) to pack'),
    ),
    seen(
      'godown',
      'van-to-load',
      count(sheets.items) > 0,
      mine(sheets.items.length, count(sheets.items), 'van load(s) waiting'),
    ),
  ]
}

// -------------------------------------------------------------------------------------------- driver

export async function driverRow(api: Api, s: CoverageSessions, date: string): Promise<Seen[]> {
  const out: Seen[] = []
  for (const driver of ['driver1', 'driver2'] as const) {
    const own = s[driver]
    const session = own ?? s.owner
    const list = await api.call(session, contract.delivery.trips.list, {
      from: date,
      to: date,
      ...(own ? { mine: true } : {}),
      limit: 20,
    })
    const driverId = userIdOf(s, driver)
    const tripId = driverId ? tripIdOf(s.owner.tenantId, date, driver, driverId) : null
    const row = list.items.find((t) => t.id === tripId && t.state === 'active')
    const trip = row ? await tripOf(api, session, row.id) : null
    const stops = trip?.stops ?? []
    const modes = new Set((trip?.collections ?? []).map((c) => c.mode))
    const doors = stops.length
    const refused = stops.filter((x) =>
      x.deliveries.some((d) => d.outcome === 'returned' || d.outcome === 'failed'),
    ).length
    const part = stops.filter((x) => x.state === 'partial').length
    const todo = stops.filter((x) => x.state === 'pending').length
    out.push(
      seen(
        'driver',
        'trip-today',
        !!trip && doors >= 6 && doors <= 8,
        `${driver}: trip on ${date} ${trip ? `${trip.state}, ${String(doors)} doors` : 'not on the road'}`,
      ),
      seen(
        'driver',
        'doors-paid',
        modes.has('cash') && modes.has('upi') && modes.has('cheque'),
        `${driver}: paid by ${[...modes].sort().join(', ') || 'nothing'}`,
      ),
      seen('driver', 'door-part', part > 0, `${driver}: ${String(part)} part delivered`),
      seen('driver', 'door-refused', refused > 0, `${driver}: ${String(refused)} refused`),
      seen('driver', 'doors-to-do', todo > 0, `${driver}: ${String(todo)} still to do`),
    )
  }
  return out
}

// ---------------------------------------------------------------------------------------- accountant

export async function accountantRow(api: Api, s: CoverageSessions, date: string): Promise<Seen[]> {
  const a = s.accountant ?? s.owner
  const toMatch = await api.call(a, contract.receivables.receipts.list, {
    unallocatedOnly: true,
    limit: 200,
  })
  const cheques = await api.call(a, contract.receivables.receipts.list, {
    status: 'collected',
    mode: 'cheque',
    withCrew: false,
    limit: 200,
  })
  const yesterday = addDays(date, -1)
  const settled = await api.call(a, contract.delivery.trips.list, {
    states: ['settled', 'settled_with_variance'],
    from: yesterday,
    to: yesterday,
    limit: 20,
  })
  const dues = await api.call(a, contract.receivables.outstanding.list, { limit: 1 })
  const buckets = Object.values(dues.totals.buckets).filter((v) => v > 0).length
  const count = <T extends { id: string }>(items: readonly T[]) =>
    items.filter((x) => isDemoId(x.id)).length
  return [
    seen(
      'accountant',
      'collections-to-match',
      count(toMatch.items) > 0,
      mine(toMatch.items.length, count(toMatch.items), 'payment(s) on account to match'),
    ),
    seen(
      'accountant',
      'cheques-to-deposit',
      count(cheques.items) > 0,
      mine(cheques.items.length, count(cheques.items), 'cheque(s) in the office'),
    ),
    seen(
      'accountant',
      'yesterday-settled',
      count(settled.items) > 0,
      mine(settled.items.length, count(settled.items), `trip(s) of ${yesterday} settled`),
    ),
    seen(
      'accountant',
      'dues-by-age',
      dues.totals.outstandingPaise > 0 && buckets > 0,
      `dues in ${String(buckets)} age bucket(s)`,
    ),
  ]
}

// --------------------------------------------------------------------------------------------- owner

/**
 * The owner's landing figures. `reporting.dashboard.owner` is a rollup the worker refreshes every fifteen
 * minutes; a figure it still shows as zero is taken from the live register behind it and a note says so.
 */
export async function ownerRow(
  api: Api,
  s: CoverageSessions,
): Promise<{ seen: Seen[]; notes: string[] }> {
  const o = s.owner
  const d = await api.call(o, contract.reporting.dashboard.owner, {})
  const notes: string[] = []
  const today = todayIst()
  const live = {
    sales: async () =>
      (await api.call(o, contract.billing.invoices.list, { from: today, to: today, limit: 1 }))
        .items.length,
    collections: async () =>
      (await api.call(o, contract.receivables.receipts.list, { from: today, to: today, limit: 1 }))
        .totals.countedPaise,
    dues: async () =>
      (await api.call(o, contract.receivables.outstanding.list, { limit: 1 })).totals
        .outstandingPaise,
    stock: async () =>
      (await api.call(o, contract.inventory.stock.sellable, { limit: 1 })).items.length,
    approvals: async () =>
      (await api.call(o, contract.orders.approvals.list, { status: 'pending', limit: 1 })).items
        .length,
  }
  const figure = async (name: keyof typeof live, value: number, feature: string): Promise<Seen> => {
    if (value > 0) return seen('owner', feature, true, `dashboard ${name} > 0`)
    const now = await live[name]()
    if (now > 0)
      notes.push(
        `owner dashboard (as of ${d.asOf}) still shows ${name} as zero; the live register has it (the rollup refreshes every 15 minutes)`,
      )
    return seen('owner', feature, now > 0, `dashboard ${name} 0, live ${now > 0 ? '> 0' : '0'}`)
  }
  return {
    seen: [
      await figure('sales', d.todayInvoicedPaise, 'sales-today'),
      await figure('collections', d.todayCollectedPaise, 'collections-today'),
      await figure('dues', d.totalOutstandingPaise, 'dues'),
      await figure('stock', d.stockValuePaise, 'stock-value'),
      await figure('approvals', d.pendingApprovals, 'approvals-waiting'),
    ],
    notes,
  }
}

export async function allRows(
  api: Api,
  s: CoverageSessions,
  date: string,
): Promise<{ seen: Seen[]; notes: string[] }> {
  const owner = await ownerRow(api, s)
  const seenAll = [
    ...(await shopkeeperRow(api, s, date)),
    ...(await salesRow(api, s, date)),
    ...(await managerRow(api, s)),
    ...(await godownRow(api, s)),
    ...(await driverRow(api, s, date)),
    ...(await accountantRow(api, s, date)),
    ...owner.seen,
  ]
  return { seen: seenAll, notes: owner.notes }
}
