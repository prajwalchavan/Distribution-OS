import { contract } from '@dos/contracts'
import type { Api, Session } from './client.js'
import { maybe } from './helpers.js'
import { addDays, demoId, isDemoId, todayIst } from './ids.js'
import { SLOT_DOORS } from './plan.js'
import type { Row } from './summary.js'

/**
 * WHAT EACH ROLE OPENS ON, read through the API the way its landing page reads it. One function per row of
 * the brief's table; each answers a list of features with a yes / no and a detail made of counts and ids
 * only. `check:demo-coverage` calls them signed in as every tester login; `fill:demo` calls them as the
 * owner at the end of a run to say what it left behind.
 */
export interface Seen {
  row: Row
  feature: string
  ok: boolean
  detail: string
}

export interface CoverageSessions {
  owner: Session
  manager?: Session
  accountant?: Session
  sales1?: Session
  sales2?: Session
  godown?: Session
  driver1?: Session
  driver2?: Session
}

type Reader = <T>(p: Promise<T>) => Promise<T>

function seen(row: Row, feature: string, ok: boolean, detail: string): Seen {
  return { row, feature, ok, detail }
}

/** Today's two vans, read as the owner: the stops by route position. */
async function vans(api: Api, owner: Session, date: string) {
  const out: Partial<Record<'driver1' | 'driver2', Awaited<ReturnType<typeof tripOf>>>> = {}
  for (const driver of ['driver1', 'driver2'] as const) out[driver] = await tripOf(api, owner, demoId(date, 'trip', driver))
  return out
}
function tripOf(api: Api, s: Session, id: string) {
  return maybe(api.call(s, contract.delivery.trips.get, { id })).then((r) => r?.item ?? null)
}

// ------------------------------------------------------------------------------------------- shopkeeper

/**
 * The shopkeeper row, read as the owner for the three shops that stand for `tester.shop1…3` (no login can be
 * made through the API: DOS-400). Which shops they are is read off today's vans: the doors the plan gives them.
 */
export async function shopkeeperRow(api: Api, s: CoverageSessions, date: string): Promise<Seen[]> {
  const out: Seen[] = [seen('shopkeeper', 'login', false, 'no shopkeeper login can be made through the API (DOS-400)')]
  const trips = await vans(api, s.owner, date)
  const stopAt = (driver: 'driver1' | 'driver2', index: number) =>
    trips[driver]?.stops.find((x) => x.sequence === index + 1) ?? null
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
    if (w && w.retailerId === shopId && (w.state === 'pending' || w.state === 'started' || w.state === 'arrived')) onWay++
    if (d && (d.state === 'delivered' || d.state === 'partial') && d.deliveries.some((x) => x.invoiceNo !== null)) delivered++
    const owes = await maybe(api.call(s.owner, contract.receivables.outstanding.get, { retailerId: shopId, includeBills: false }))
    if ((owes?.outstandingPaise ?? 0) > 0) dues++
    const last = await api.call(s.owner, contract.orders.lastPlaced, { retailerId: shopId })
    if (last.item) again++
    const schemes = await api.call(s.owner, contract.pricing.schemes.list, { activeOnly: true, on: date, limit: 200 })
    const applies = schemes.items.some((x) => {
      const a = x.applicability
      return (
        (a.retailerIds?.length ?? 0) === 0 ||
        (a.retailerIds ?? []).includes(shopId)
      )
    })
    if (applies) offer++
  }
  out.push(seen('shopkeeper', 'on-the-way', onWay === 3, `${String(onWay)}/3 stand-in shops have a bill on a van still to come`))
  out.push(seen('shopkeeper', 'delivered-bill', delivered === 3, `${String(delivered)}/3 have a bill delivered today`))
  out.push(seen('shopkeeper', 'dues', dues === 3, `${String(dues)}/3 owe money`))
  out.push(seen('shopkeeper', 'offer', offer === 3, `${String(offer)}/3 have an offer on`))
  out.push(seen('shopkeeper', 'order-again', again === 3, `${String(again)}/3 have a last order to repeat`))
  return out
}

// ------------------------------------------------------------------------------------------------ reps

export async function salesRow(api: Api, s: CoverageSessions, date: string): Promise<Seen[]> {
  const out: Seen[] = []
  for (const rep of ['sales1', 'sales2'] as const) {
    const session = s[rep] ?? s.owner
    const as = s[rep] ? '' : ' (read as the owner)'
    const userId = s[rep]?.userId
    const assignments = await api.call(session, contract.retailers.beats.assignments.list, {
      on: date,
      currentOnly: true,
      ...(userId ? { userId } : {}),
    })
    const beatId = assignments.items[0]?.beatId ?? null
    out.push(seen('sales', 'beat-today', beatId !== null, `${rep}: ${String(assignments.items.length)} beat(s) on ${date}${as}`))
    const orders = await api.call(session, contract.orders.list, {
      ...(userId ? { salespersonId: userId } : {}),
      limit: 200,
    })
    const mine = orders.items.filter(
      (o) => isDemoId(o.id) && (o.id === demoId(date, 'order', rep === 'sales1' ? 'h1' : 'h2') || o.id === demoId(date, 'order', rep === 'sales1' ? 'w1' : 'w2')),
    )
    out.push(seen('sales', 'two-orders', mine.length >= 2, `${rep}: ${String(mine.length)} order(s) taken for ${date}`))
    let over = 0
    if (beatId) {
      const shops = await api.call(session, contract.retailers.list, { beatId, limit: 500 })
      for (const shop of shops.items) {
        const c = await maybe(api.call(session, contract.receivables.creditCheck, { retailerId: shop.id, orderTotalPaise: 0 }))
        if (c && c.creditLimitPaise > 0 && c.outstandingPaise + c.undeliveredPaise > c.creditLimitPaise) over++
      }
    }
    out.push(seen('sales', 'over-limit-shop', over >= 1, `${rep}: ${String(over)} shop(s) on the beat over the credit limit`))
  }
  return out
}

// ------------------------------------------------------------------------------------------- manager

export async function managerRow(api: Api, s: CoverageSessions): Promise<Seen[]> {
  const m = s.manager ?? s.owner
  const pending = await api.call(m, contract.orders.approvals.list, { status: 'pending', limit: 200 })
  const credit = pending.items.filter((a) => a.kind === 'credit_limit')
  const drafts = await api.call(m, contract.warehouse.loadSheets.list, { status: 'draft', limit: 200 })
  const toSign = drafts.items.filter((d) => d.approvedAt === null)
  const review = await api.call(m, contract.procurement.supplierInvoices.list, { status: 'in_review', limit: 200 })
  const returns = await api.call(m, contract.billing.creditNotes.list, { state: 'draft', limit: 200 })
  return [
    seen('manager', 'approvals-waiting', pending.items.length > 0, `${String(pending.items.length)} approval(s) pending`),
    seen('manager', 'held-for-credit', credit.length > 0, `${String(credit.length)} held for credit`),
    seen('manager', 'load-sheet-to-sign', toSign.length > 0, `${String(toSign.length)} load sheet(s) to sign off`),
    seen('manager', 'supplier-bill-review', review.items.length > 0, `${String(review.items.length)} supplier bill(s) in review`),
    seen('manager', 'return-to-approve', returns.items.length > 0, `${String(returns.items.length)} return(s) waiting to be issued`),
  ]
}

// -------------------------------------------------------------------------------------------- godown

export async function godownRow(api: Api, s: CoverageSessions): Promise<Seen[]> {
  const g = s.godown ?? s.owner
  const gate = await api.call(g, contract.procurement.grns.list, { status: 'counting', limit: 50 })
  const open = await api.call(g, contract.warehouse.picklists.list, { status: 'open', limit: 50 })
  const picked = await api.call(g, contract.warehouse.picklists.list, { status: 'picked', limit: 50 })
  const sheets = await api.call(g, contract.warehouse.loadSheets.list, { status: 'draft', limit: 50 })
  return [
    seen('godown', 'gate-to-count', gate.items.length > 0, `${String(gate.items.length)} receipt(s) at the gate`),
    seen('godown', 'wave-to-pick', open.items.length > 0, `${String(open.items.length)} wave(s) to pick`),
    seen('godown', 'packs-to-make', picked.items.length > 0, `${String(picked.items.length)} picked wave(s) to pack`),
    seen('godown', 'van-to-load', sheets.items.length > 0, `${String(sheets.items.length)} van load(s) waiting`),
  ]
}

// -------------------------------------------------------------------------------------------- driver

export async function driverRow(api: Api, s: CoverageSessions, date: string): Promise<Seen[]> {
  const out: Seen[] = []
  for (const driver of ['driver1', 'driver2'] as const) {
    const session = s[driver] ?? s.owner
    const list = await api.call(session, contract.delivery.trips.list, {
      from: date,
      to: date,
      ...(s[driver] ? { mine: true } : {}),
      limit: 20,
    })
    const tripId = demoId(date, 'trip', driver)
    const row = list.items.find((t) => (s[driver] ? true : t.id === tripId) && t.state === 'active')
    const trip = row ? await tripOf(api, session, row.id) : null
    const stops = trip?.stops ?? []
    const modes = new Set((trip?.collections ?? []).map((c) => c.mode))
    const doors = stops.length
    const refused = stops.filter((x) => x.deliveries.some((d) => d.outcome === 'returned' || d.outcome === 'failed')).length
    out.push(seen('driver', 'trip-today', !!trip && doors >= 6 && doors <= 8, `${driver}: trip on ${date} ${trip ? `${trip.state}, ${String(doors)} doors` : 'not found'}`))
    out.push(seen('driver', 'doors-paid', modes.has('cash') && modes.has('upi') && modes.has('cheque'), `${driver}: paid by ${[...modes].sort().join(', ') || 'nothing'}`))
    out.push(seen('driver', 'door-part', stops.some((x) => x.state === 'partial'), `${driver}: ${String(stops.filter((x) => x.state === 'partial').length)} part delivered`))
    out.push(seen('driver', 'door-refused', refused > 0, `${driver}: ${String(refused)} refused`))
    out.push(seen('driver', 'doors-to-do', stops.some((x) => x.state === 'pending'), `${driver}: ${String(stops.filter((x) => x.state === 'pending').length)} still to do`))
  }
  return out
}

// ---------------------------------------------------------------------------------------- accountant

export async function accountantRow(api: Api, s: CoverageSessions, date: string): Promise<Seen[]> {
  const a = s.accountant ?? s.owner
  const toMatch = await api.call(a, contract.receivables.receipts.list, { unallocatedOnly: true, limit: 50 })
  const cheques = await api.call(a, contract.receivables.receipts.list, { status: 'collected', mode: 'cheque', withCrew: false, limit: 50 })
  const yesterday = addDays(date, -1)
  const settled = await api.call(a, contract.delivery.trips.list, { states: ['settled', 'settled_with_variance'], from: yesterday, to: yesterday, limit: 20 })
  const dues = await api.call(a, contract.receivables.outstanding.list, { limit: 1 })
  const buckets = Object.values(dues.totals.buckets).filter((v) => v > 0).length
  return [
    seen('accountant', 'collections-to-match', toMatch.items.length > 0, `${String(toMatch.items.length)} payment(s) on account to match`),
    seen('accountant', 'cheques-to-deposit', cheques.items.length > 0, `${String(cheques.items.length)} cheque(s) in the office`),
    seen('accountant', 'yesterday-settled', settled.items.length > 0, `${String(settled.items.length)} trip(s) of ${yesterday} settled`),
    seen('accountant', 'dues-by-age', dues.totals.outstandingPaise > 0 && buckets > 0, `dues in ${String(buckets)} age bucket(s)`),
  ]
}

// --------------------------------------------------------------------------------------------- owner

/**
 * The owner's landing figures. `reporting.dashboard.owner` is a rollup the worker refreshes every fifteen
 * minutes; a figure it still shows as zero is taken from the live register behind it and the note says so.
 */
export async function ownerRow(api: Api, s: CoverageSessions): Promise<{ seen: Seen[]; notes: string[] }> {
  const o = s.owner
  const d = await api.call(o, contract.reporting.dashboard.owner, {})
  const notes: string[] = []
  const today = todayIst()
  const live = {
    sales: async () => (await api.call(o, contract.billing.invoices.list, { from: today, to: today, limit: 1 })).items.length,
    collections: async () => (await api.call(o, contract.receivables.receipts.list, { from: today, to: today, limit: 1 })).totals.countedPaise,
    dues: async () => (await api.call(o, contract.receivables.outstanding.list, { limit: 1 })).totals.outstandingPaise,
    stock: async () => (await api.call(o, contract.inventory.stock.sellable, { limit: 1 })).items.length,
    approvals: async () => (await api.call(o, contract.orders.approvals.list, { status: 'pending', limit: 1 })).items.length,
  }
  const figure = async (name: keyof typeof live, value: number, feature: string): Promise<Seen> => {
    if (value > 0) return seen('owner', feature, true, `dashboard ${name} > 0`)
    const now = await live[name]()
    if (now > 0) notes.push(`owner dashboard (as of ${d.asOf}) still shows ${name} as zero; the live register has it — the rollup refreshes every 15 minutes`)
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
  read: Reader = (p) => p,
): Promise<{ seen: Seen[]; notes: string[] }> {
  const owner = await read(ownerRow(api, s))
  const seenAll = [
    ...(await read(shopkeeperRow(api, s, date))),
    ...(await read(salesRow(api, s, date))),
    ...(await read(managerRow(api, s))),
    ...(await read(godownRow(api, s))),
    ...(await read(driverRow(api, s, date))),
    ...(await read(accountantRow(api, s, date))),
    ...owner.seen,
  ]
  return { seen: seenAll, notes: owner.notes }
}
