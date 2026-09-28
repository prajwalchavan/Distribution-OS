// Phase 7 — the order-to-cash chain, step by step, through the product's own API as the right person at each hop.
import * as L from './lib.mjs'

const { as, must, tryCall, mk, key, uuidv7, q, q1, esc, note } = L
const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10) // IST business date

let phoneSeq = Number(String(Date.now()).slice(-7))
export function phone() {
  phoneSeq += 1
  return `+9198${String(phoneSeq).padStart(8, '0').slice(-8)}`
}

/** A fresh shop on rahul.deshmukh's beat, created by the owner, with the credit terms asked for. */
export async function createShop(name, terms = {}) {
  const owner = await as('owner')
  const m = mk()
  const input = {
    ...m,
    name,
    ownerName: `${name} owner`,
    phone: phone(),
    beatId: L.BEAT_RAHUL,
    stateCode: terms.stateCode ?? '27',
    gstRegType: terms.gstin ? 'regular' : 'unregistered',
    ...(terms.gstin ? { gstin: terms.gstin } : {}),
    paymentTerms: terms.paymentTerms ?? 'POST_FULFILLMENT',
    cashDiscountBps: terms.cashDiscountBps ?? 0,
    cashDiscountDays: terms.cashDiscountDays ?? 0,
    address: { line1: 'QA p7 test shop', city: 'Kalyan', pincode: '421301' },
  }
  const shop = await must(owner.retailers.upsert(input), `create shop ${name}`)
  const id = shop.item?.id ?? shop.id ?? m.id
  await setCredit(id, {
    tier: terms.tier ?? 'B',
    creditLimitPaise: terms.creditLimitPaise ?? 100_000_00,
    creditLimitBills: terms.creditLimitBills ?? 0,
    creditDays: terms.creditDays ?? 0,
    creditMode: terms.creditMode ?? 'indicate',
    paymentTerms: terms.paymentTerms ?? 'POST_FULFILLMENT',
  })
  return { id, name, ...q1(`select code from retailers where id = '${id}'`) }
}

export async function setCredit(retailerId, terms, who = 'owner') {
  const c = await as(who)
  return must(c.retailers.setCredit({ ...key(), id: retailerId, ...terms }), 'setCredit')
}

/** Draft + submit an order. lines: [{ variantId, qty, unit? }]. Returns the submitted order (item). */
export async function placeOrder(shopId, lines, who = 'rep', opts = {}) {
  const c = await as(who)
  const m = mk()
  const created = await must(
    c.orders.create({
      ...m,
      retailerId: shopId,
      source: who === 'rep' ? 'salesperson' : 'phone',
      lines: lines.map((l) => ({ id: uuidv7(), variantId: l.variantId, enteredQty: l.qty, enteredUnit: l.unit ?? 'piece' })),
      ...(opts.paymentTerms ? { paymentTerms: opts.paymentTerms } : {}),
    }),
    'orders.create',
  )
  const orderId = created.item?.id ?? m.id
  const submitted = await tryCall(c.orders.submit({ ...key(), id: orderId }))
  return { orderId, created, submitted }
}

export async function orderRow(orderId) {
  return q1(`select id, order_no, state::text state, total_paise, subtotal_paise, retailer_id from sales_orders where id = '${orderId}'`)
}

/** Approve every pending approval of an order, as the owner. */
export async function approveAll(orderId, who = 'owner', decision = 'approve') {
  const c = await as(who)
  const list = await must(c.orders.approvals.list({ orderId, status: 'pending' }), 'approvals.list')
  const out = []
  for (const a of list.items ?? list) {
    out.push(await tryCall(c.orders.approvals.decide({ ...key(), id: a.id, decision, note: 'QA p7' })))
  }
  return out
}

/**
 * Pick and pack a set of confirmed orders as the godown: one wave, every line picked from its suggested lots
 * (shorts: { orderLineId: pcs } picks that many pieces fewer). Returns { picklistId, invoices: [{orderId, invoiceId}] }.
 */
export async function pickAndPack(orderIds, opts = {}) {
  const wh = await as('wh')
  const pm = mk()
  const pl = await must(wh.warehouse.picklists.create({ ...pm, orderIds, locationId: L.GODOWN }), 'picklists.create')
  const picklistId = pl.item?.id ?? pm.id
  await must(wh.warehouse.picklists.start({ ...key(), id: picklistId }), 'picklists.start')
  const sheet = await must(wh.warehouse.picklists.get({ id: picklistId }), 'picklists.get')
  const rows = sheet.item?.lines ?? sheet.lines ?? []
  // shorts: { orderLineId: pcs } — taken off the last lot rows of that order line first
  const left = { ...(opts.shorts ?? {}) }
  const lines = [...rows].reverse().map((l) => {
    const want = l.requestedQtyPcs // requestedQtyPcs already includes the free pieces of the line
    const cut = Math.min(want, left[l.orderLineId] ?? 0)
    if (cut) left[l.orderLineId] -= cut
    return { id: uuidv7(), orderLineId: l.orderLineId, lotId: l.suggestedLotId ?? l.lotId, pickedQtyPcs: want - cut, ...(cut ? { shortReason: 'QA short pick' } : {}) }
  }).reverse()
  await must(wh.warehouse.picklists.pick({ ...key(), id: picklistId, lines }), 'picklists.pick')
  const invoices = []
  for (const orderId of orderIds) {
    const packed = await must(wh.warehouse.packs.confirm({ ...mk(), orderId, packages: 1, issueInvoice: true }), `pack ${orderId}`)
    const inv = q1(`select id, invoice_no, total_paise from invoices where order_id = '${orderId}' and state <> 'cancelled' order by created_at desc limit 1`)
    invoices.push({ orderId, invoiceId: inv?.id, invoiceNo: inv?.invoice_no, totalPaise: inv?.total_paise, packed })
  }
  return { picklistId, sheet, invoices }
}

/** The whole doorstep chain up to a departed trip. stops: [{ retailerId, invoiceIds }]. */
export async function tripOut(stops, opts = {}) {
  const mgr = await as('manager')
  const vehicle = L.VEHICLES[opts.vehicle ?? 'A']
  const driverWho = opts.driver ?? 'driver'
  const driverId = q1(`select id from users where username = '${L.USERS[driverWho]}'`).id
  const tm = mk()
  const tripStops = stops.map((s, i) => ({ id: uuidv7(), sequence: i + 1, retailerId: s.retailerId, invoiceIds: s.invoiceIds }))
  await must(
    mgr.delivery.trips.create({ ...tm, tripDate: today(), vehicleId: vehicle.id, driverId, openingCashPaise: opts.floatPaise ?? 0, stops: tripStops }),
    'trips.create',
  )
  const tripId = tm.id
  const wh = await as('wh')
  await must(wh.delivery.trips.startLoading({ ...key(), id: tripId }), 'trips.startLoading')
  const orderIds = q(`select order_id from invoices where id in (${stops.flatMap((s) => s.invoiceIds).map((i) => `'${i}'`).join(',')})`).map((r) => r.order_id)
  const sm = mk()
  await must(wh.warehouse.loadSheets.create({ ...sm, toLocationId: vehicle.loc, fromLocationId: L.GODOWN, tripId, orderIds }), 'loadSheets.create')
  await must(mgr.warehouse.loadSheets.approve({ ...key(), id: sm.id, note: 'QA p7' }), 'loadSheets.approve')
  const sheet = await must(wh.warehouse.loadSheets.get({ id: sm.id }), 'loadSheets.get')
  const packages = sheet.item?.expectedPackages ?? sheet.expectedPackages ?? sheet.item?.packages ?? orderIds.length
  const conf = await tryCall(wh.warehouse.loadSheets.confirm({ ...key(), id: sm.id, countedPackages: packages, challanId: uuidv7() }))
  if (!conf.ok) throw new Error(`loadSheets.confirm: ${conf.status} ${conf.message} ${JSON.stringify(conf.data ?? '')} sheet=${JSON.stringify(sheet).slice(0, 800)}`)
  const drv = await as(driverWho)
  await tryCall(drv.delivery.consents.grant({ ...mk(), granted: true, noticeVersion: 'gps-notice-2026-09', locale: 'en-IN' }))
  const dep = await tryCall(drv.delivery.trips.depart({ ...key(), id: tripId, ...(opts.floatPaise !== undefined ? { openingCashPaise: opts.floatPaise } : {}) }))
  if (!dep.ok) throw new Error(`depart: ${dep.status} ${dep.message}`)
  return { tripId, stops: tripStops, loadSheetId: sm.id, driverWho }
}

/** Walk to a stop and record a delivery: full by default, or per-line { invoiceLineId: { delivered, returned, saleable, reason } }. */
export async function deliver(trip, stop, invoiceId, perLine = {}, opts = {}) {
  const drv = await as(trip.driverWho)
  if (!opts.skipWalk) {
    await tryCall(drv.delivery.stops.start({ ...key(), id: stop.id }))
    await tryCall(drv.delivery.stops.arrive({ ...key(), id: stop.id }))
  }
  const lines = q(`select id, qty_pcs + free_qty_pcs as pcs from invoice_lines where invoice_id = '${invoiceId}' order by line_no`).map((l) => {
    const p = perLine[l.id]
    if (!p) return { id: uuidv7(), invoiceLineId: l.id, deliveredQtyPcs: l.pcs, returnedQtyPcs: 0, returnedSaleable: true }
    return { id: uuidv7(), invoiceLineId: l.id, deliveredQtyPcs: p.delivered, returnedQtyPcs: p.returned ?? l.pcs - p.delivered, returnedSaleable: p.saleable ?? true, ...(p.reason ? { reason: p.reason } : {}) }
  })
  const dm = mk()
  const r = await tryCall(
    drv.delivery.deliveries.record({
      ...dm,
      tripId: trip.tripId,
      stopId: stop.id,
      invoiceId,
      receiverName: 'Shop owner',
      lines,
      pod: [{ id: uuidv7(), kind: 'signature', inline: { mimeType: 'image/png', contentBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' } }],
    }),
  )
  return { ...r, deliveryId: dm.id, lines }
}

/** Money at the door, as the crew. */
export async function collect(trip, stop, retailerId, mode, amountPaise, extra = {}) {
  const drv = await as(trip.driverWho)
  const receiptId = uuidv7()
  const r = await tryCall(drv.delivery.collections.record({ ...mk(), receiptId, tripId: trip.tripId, stopId: stop.id, retailerId, mode, amountPaise, ...extra }))
  return { ...r, receiptId }
}

/** Money at the office (owner / manager / accountant). */
export async function deskReceipt(retailerId, mode, amountPaise, extra = {}, who = 'accountant') {
  const c = await as(who)
  const m = mk()
  const r = await tryCall(c.receivables.receipts.create({ ...m, retailerId, mode, amountPaise, receivedAt: new Date().toISOString(), ...extra }))
  return { ...r, receiptId: m.id, input: { ...m, retailerId, mode, amountPaise, ...extra } }
}

/** Check the van in and settle it at the preview's expected cash (or the amount given). */
export async function checkInAndSettle(trip, opts = {}) {
  const drv = await as(trip.driverWho)
  const ret = await tryCall(drv.delivery.trips.return({ ...key(), id: trip.tripId }))
  const mgr = await as(opts.settler ?? 'manager')
  const preview = await must(mgr.delivery.trips.settlementPreview({ id: trip.tripId }), 'settlementPreview')
  const counted = (preview.expectedVanStock ?? []).map((v) => ({ lotId: v.lotId, countedPcs: v.expectedPcs ?? v.qtyPcs ?? 0 }))
  const handed = opts.handedOverCashPaise ?? preview.expectedCashPaise
  const settle = await tryCall(mgr.delivery.trips.settle({ ...mk(), tripId: trip.tripId, handedOverCashPaise: handed, counted, acceptVariance: opts.acceptVariance ?? false, note: 'QA p7' }))
  return { ret, preview, settle }
}

export async function deposit(receiptIds, who = 'accountant') {
  const c = await as(who)
  return tryCall(c.receivables.receipts.deposit({ ...mk(), receiptIds, depositAccountCode: 'BANK', depositedAt: new Date().toISOString(), depositRef: `QA-P7-${Date.now()}` }))
}

/** Every screen-facing figure for one shop, from each service that shows it, next to SQL. */
export async function shopFigures(shopId, opts = {}) {
  const out = {}
  const pick = (o) => (o ? { outstanding: o.outstandingPaise, overdue: o.overduePaise, onAccount: o.unallocatedCreditPaise, undelivered: o.undeliveredPaise, openBills: o.openBills, net: (o.outstandingPaise ?? 0) + (o.undeliveredPaise ?? 0) - (o.unallocatedCreditPaise ?? 0) } : null)
  for (const who of ['owner', 'accountant', 'rep', 'driver']) {
    const c = await as(who)
    const r = await tryCall(c.receivables.outstanding.get({ retailerId: shopId }))
    out[who] = r.ok ? pick(r.value) : { error: `${r.status} ${r.message}` }
    if (who !== 'driver') {
      const cc = await tryCall(c.receivables.creditCheck({ retailerId: shopId, orderTotalPaise: opts.orderTotalPaise ?? 0 }))
      out[`${who}_credit`] = cc.ok ? { limit: cc.value.creditLimitPaise, headroom: cc.value.headroomPaise, outstanding: cc.value.outstandingPaise, undelivered: cc.value.undeliveredPaise, openBills: cc.value.openBills, overdueDays: cc.value.overdueDays, breached: cc.value.breached, reasons: cc.value.reasons } : { error: `${cc.status} ${cc.message}` }
    }
  }
  if (opts.retailerUser) {
    const rc = await as(opts.retailerUser, { svc: 'retailer' })
    const r = await tryCall(rc.receivables.outstanding.get({ retailerId: shopId }))
    out.retailer = r.ok ? pick(r.value) : { error: `${r.status} ${r.message}` }
  }
  const s = q1(`
    with b as (select coalesce(sum(greatest(0, i.total_paise - coalesce((select sum(amount_paise) from allocations a where a.invoice_id = i.id), 0))) filter (where i.undelivered_at is null), 0) dues,
                      coalesce(sum(greatest(0, i.total_paise - coalesce((select sum(amount_paise) from allocations a where a.invoice_id = i.id), 0))) filter (where i.undelivered_at is not null), 0) undeliv,
                      count(*) filter (where i.undelivered_at is null and i.total_paise > coalesce((select sum(amount_paise) from allocations a where a.invoice_id = i.id), 0)) bills
                 from invoices i where i.retailer_id = '${shopId}' and i.state in ('issued', 'partially_paid')),
         rc as (select coalesce(sum(r.amount_paise + r.cash_discount_paise), 0) - coalesce((select sum(a.amount_paise) from allocations a join receipts r2 on r2.id = a.receipt_id where r2.retailer_id = '${shopId}'), 0) free from receipts r where r.retailer_id = '${shopId}'),
         cn as (select coalesce(sum(c.total_paise), 0) - coalesce((select sum(a.amount_paise) from allocations a join credit_notes c2 on c2.id = a.credit_note_id where c2.retailer_id = '${shopId}' and c2.state in ('issued','applied')), 0) free from credit_notes c where c.retailer_id = '${shopId}' and c.state in ('issued', 'applied')),
         ar as (select coalesce(sum(l.amount_paise), 0) q from journal_lines l join accounts a on a.id = l.account_id where a.code = 'AR' and l.party_id = '${shopId}')
    select b.dues, b.undeliv, b.bills, rc.free + cn.free on_acct, b.dues + b.undeliv - rc.free - cn.free net, ar.q ar,
           r.credit_limit_paise lim, r.credit_mode::text mode from b, rc, cn, ar, retailers r where r.id = '${shopId}'`)
  out.sql = { outstanding: s.dues, undelivered: s.undeliv, onAccount: s.on_acct, openBills: s.bills, net: s.net, arJournal: s.ar, limit: s.lim, mode: s.mode }
  return out
}

export { today }
