// Phase 10 — the purchase-to-cash chain, step by step, through the product's own API as the right person at each hop.
// Patterns copied from QA/tools/p7/flow.mjs (read only) and extended for stock: own receipts with batch + expiry,
// short / zero picks, failed doors, check-in, van-returns unload.
import * as L from './lib.mjs'

const { as, must, tryCall, mk, key, uuidv7, q, q1, inList } = L
export const SUPPLIER = 'e428e2c5-8fb1-7f24-a1ff-d22ab81f9830' // Guru Kripa Agencies (test copy)

let phoneSeq = Number(String(Date.now()).slice(-7))
export function phone() {
  phoneSeq += 1
  return `+9197${String(phoneSeq).padStart(8, '0').slice(-8)}`
}

/**
 * Purchase order → supplier invoice (manual, every line matched) → GRN open (owner) → blind count (godown) → post (owner).
 * lines: [{ variantId, batchNo, expiryDate, mrpPaise, qtyPcs, damaged?, counted?, ratePaise? }]
 */
export async function receive(tag, lines, opts = {}) {
  const owner = await as('owner')
  const wh = await as('wh')
  const po = mk()
  const poR = await tryCall(owner.procurement.purchaseOrders.upsert({ ...po, supplierId: SUPPLIER, status: 'sent', expectedOn: L.todayIst(), lines: lines.map((l) => ({ variantId: l.variantId, qtyPcs: l.qtyPcs, ratePaise: l.ratePaise ?? 1000 })), note: `QA p10 ${tag}` }))
  const invLines = lines.map((l, i) => {
    const rate = l.ratePaise ?? 1000
    const taxable = rate * l.qtyPcs
    const tax = Math.round((taxable * 1200) / 10000)
    return { id: uuidv7(), lineNo: i + 1, description: `QA p10 ${tag} line ${i + 1}`, variantId: l.variantId, hsnCode: '19059020', batchNo: l.batchNo ?? null, mfgDate: null, expiryDate: l.expiryDate ?? null, mrpPaise: l.mrpPaise, printedQty: l.qtyPcs, printedUnit: 'pcs', qtyPcs: l.qtyPcs, freeQtyPcs: 0, ratePaise: rate, rateBasis: 'piece', basisQty: 1, discountBps: 0, discountPaise: 0, gstBps: 1200, cessBps: 0, taxablePaise: taxable, taxPaise: tax, lineTotalPaise: taxable + tax }
  })
  const subtotal = invLines.reduce((n, l) => n + l.taxablePaise, 0)
  const tax = invLines.reduce((n, l) => n + l.taxPaise, 0)
  const si = mk()
  await must(
    owner.procurement.supplierInvoices.create({ ...si, supplierId: SUPPLIER, purchaseOrderId: poR.ok ? po.id : null, source: 'manual', invoiceNo: `QA-P10-${tag}-${Date.now()}`, invoiceDate: L.todayIst(), supplierGstin: null, placeOfSupplyState: '27', subtotalPaise: subtotal, discountPaise: 0, cgstPaise: tax / 2, sgstPaise: tax / 2, igstPaise: 0, cessPaise: 0, freightPaise: 0, roundOffPaise: 0, totalPaise: subtotal + tax, dueDate: null, lines: invLines }),
    `supplier invoice ${tag}`,
  )
  const g = mk()
  const opened = await must(owner.procurement.grns.open({ ...g, supplierInvoiceId: si.id, locationId: opts.locationId ?? L.GODOWN, note: `QA p10 ${tag}` }), `grn open ${tag}`)
  const gl = opened.item.lines
  const counted = await must(
    wh.procurement.grns.count({ ...key(), id: g.id, lines: gl.map((row, i) => ({ grnLineId: row.id, countedQtyPcs: lines[i].counted ?? lines[i].qtyPcs - (lines[i].damaged ?? 0), damagedQtyPcs: lines[i].damaged ?? 0 })) }),
    `grn count ${tag}`,
  )
  const posted = await must(owner.procurement.grns.post({ ...key(), id: g.id }), `grn post ${tag}`)
  const lots = q(`select gl.id grn_line_id, gl.lot_id, gl.variant_id, l.batch_no, l.expiry_date, gl.counted_qty_pcs, gl.damaged_qty_pcs from grn_lines gl join stock_lots l on l.id = gl.lot_id where gl.grn_id = '${g.id}' order by gl.created_at, gl.id`)
  return { poId: poR.ok ? po.id : null, poResult: L.brief(poR), supplierInvoiceId: si.id, grnId: g.id, grnNo: posted.item?.grnNo, lots, counted }
}

/** A fresh shop on rahul.deshmukh's beat, generous credit, so no credit hold gets in the way unless asked. */
export async function createShop(name, terms = {}) {
  const owner = await as('owner')
  const m = mk()
  const shop = await must(
    owner.retailers.upsert({ ...m, name, ownerName: `${name} owner`, phone: phone(), beatId: L.BEAT_RAHUL, stateCode: '27', gstRegType: 'unregistered', paymentTerms: 'POST_FULFILLMENT', cashDiscountBps: 0, cashDiscountDays: 0, address: { line1: 'QA p10 test shop', city: 'Kalyan', pincode: '421301' } }),
    `create shop ${name}`,
  )
  const id = shop.item?.id ?? m.id
  await must(owner.retailers.setCredit({ ...key(), id, tier: 'B', creditLimitPaise: terms.creditLimitPaise ?? 50_00_000_00, creditLimitBills: 0, creditDays: 0, creditMode: terms.creditMode ?? 'indicate', paymentTerms: 'POST_FULFILLMENT' }), 'setCredit')
  return { id, name }
}

/** Draft + submit. lines: [{ variantId, qty, unit? }]. */
export async function placeOrder(shopId, lines, who = 'rep') {
  const c = await as(who)
  const m = mk()
  const lineIds = lines.map(() => uuidv7())
  const created = await tryCall(c.orders.create({ ...m, retailerId: shopId, source: who === 'rep' ? 'salesperson' : 'phone', lines: lines.map((l, i) => ({ id: lineIds[i], variantId: l.variantId, enteredQty: l.qty, enteredUnit: l.unit ?? 'piece' })) }))
  if (!created.ok) return { orderId: m.id, created, submitted: null }
  const submitted = await tryCall(c.orders.submit({ ...key(), id: m.id }))
  return { orderId: m.id, created, submitted, lineIds }
}
export const orderRow = (orderId) => q1(`select id, order_no, state::text state, total_paise from sales_orders where id = '${orderId}'`)
export const orderLines = (orderId) => q(`select id, line_no, variant_id, qty_pcs, free_qty_pcs, picked_qty_pcs, delivered_qty_pcs from sales_order_lines where order_id = '${orderId}' order by line_no`)
export const holdsOf = (orderId) => q(`select r.state::text state, loc.kind::text kind, r.lot_id, r.qty from reservations r join locations loc on loc.id = r.location_id join sales_order_lines ol on ol.id = r.order_line_id where ol.order_id = '${orderId}' order by r.created_at`)

export async function approveAll(orderId, who = 'owner', decision = 'approve') {
  const c = await as(who)
  const list = await must(c.orders.approvals.list({ orderId, status: 'pending' }), 'approvals.list')
  const out = []
  for (const a of list.items ?? list) out.push(await tryCall(c.orders.approvals.decide({ ...key(), id: a.id, decision, note: 'QA p10' })))
  return out
}

/** Make sure a submitted order ends up confirmed (approve anything pending). */
export async function ensureConfirmed(orderId) {
  let o = orderRow(orderId)
  if (o.state === 'submitted') {
    await approveAll(orderId)
    o = orderRow(orderId)
  }
  return o
}

/** Wave + start. Returns { picklistId, sheet }. */
export async function wave(orderIds) {
  const wh = await as('wh')
  const pm = mk()
  await must(wh.warehouse.picklists.create({ ...pm, orderIds, locationId: L.GODOWN }), 'picklists.create')
  await must(wh.warehouse.picklists.start({ ...key(), id: pm.id }), 'picklists.start')
  const sheet = await must(wh.warehouse.picklists.get({ id: pm.id }), 'picklists.get')
  return { picklistId: pm.id, sheet: sheet.item ?? sheet }
}

/** Record picks. plan: (sheetLine) => pickedQtyPcs | { pcs, lotId, reason }. Default: full, suggested lot. */
export async function pick(picklistId, sheet, plan = () => undefined) {
  const wh = await as('wh')
  const lines = (sheet.lines ?? []).map((l) => {
    const p = plan(l)
    const pcs = typeof p === 'number' ? p : p?.pcs ?? l.requestedQtyPcs
    const lotId = (typeof p === 'object' && p?.lotId) || l.suggestedLotId || l.lotId
    const short = pcs < l.requestedQtyPcs
    return { id: uuidv7(), orderLineId: l.orderLineId, lotId, pickedQtyPcs: pcs, ...(short ? { shortReason: (typeof p === 'object' && p?.reason) || 'QA p10 short' } : {}) }
  })
  return tryCall(wh.warehouse.picklists.pick({ ...key(), id: picklistId, lines }))
}

export async function pack(orderId, opts = {}) {
  const wh = await as('wh')
  const m = mk()
  const r = await tryCall(wh.warehouse.packs.confirm({ ...m, orderId, packages: opts.packages ?? 1, issueInvoice: opts.issueInvoice ?? true }))
  const inv = q1(`select id, invoice_no, state::text state, total_paise from invoices where order_id = '${orderId}' and state <> 'cancelled' order by created_at desc limit 1`)
  return { ...r, packId: m.id, invoice: inv }
}

export async function pickAndPack(orderIds, plan) {
  const w = await wave(orderIds)
  const picked = await pick(w.picklistId, w.sheet, plan)
  if (!picked.ok) throw new Error(`pick: ${L.brief(picked)}`)
  const packs = []
  for (const id of orderIds) packs.push(await pack(id))
  return { ...w, picked, packs }
}

/** Plan a trip, build + approve + count the load sheet, depart. stops: [{ retailerId, invoiceIds }]. */
export async function tripOut(stops, opts = {}) {
  const mgr = await as('manager')
  const vehicle = L.VEHICLES[opts.vehicle ?? 'A']
  const driverWho = opts.driver ?? 'driver'
  const driverId = q1(`select id from users where username = '${L.USERS[driverWho] ?? driverWho}'`).id
  const tm = mk()
  const tripStops = stops.map((s, i) => ({ id: uuidv7(), sequence: i + 1, retailerId: s.retailerId, invoiceIds: s.invoiceIds }))
  await must(mgr.delivery.trips.create({ ...tm, tripDate: L.todayIst(), vehicleId: vehicle.id, driverId, openingCashPaise: 0, stops: tripStops }), 'trips.create')
  const wh = await as('wh')
  await must(wh.delivery.trips.startLoading({ ...key(), id: tm.id }), 'trips.startLoading')
  const orderIds = q(`select order_id from invoices where id in (${inList(stops.flatMap((s) => s.invoiceIds))})`).map((r) => r.order_id)
  const sm = mk()
  const created = await tryCall(wh.warehouse.loadSheets.create({ ...sm, toLocationId: vehicle.loc, fromLocationId: L.GODOWN, tripId: tm.id, orderIds }))
  if (!created.ok) return { tripId: tm.id, stops: tripStops, loadSheetId: sm.id, driverWho, failedAt: 'loadSheets.create', result: created }
  const appr = await tryCall(mgr.warehouse.loadSheets.approve({ ...key(), id: sm.id, note: 'QA p10' }))
  if (!appr.ok) return { tripId: tm.id, stops: tripStops, loadSheetId: sm.id, driverWho, failedAt: 'loadSheets.approve', result: appr }
  const sheet = await must(wh.warehouse.loadSheets.get({ id: sm.id }), 'loadSheets.get')
  const packages = sheet.item?.expectedPackages ?? sheet.expectedPackages ?? orderIds.length
  const conf = await tryCall(wh.warehouse.loadSheets.confirm({ ...key(), id: sm.id, countedPackages: packages, challanId: uuidv7() }))
  if (!conf.ok) return { tripId: tm.id, stops: tripStops, loadSheetId: sm.id, driverWho, failedAt: 'loadSheets.confirm', result: conf }
  if (opts.noDepart) return { tripId: tm.id, stops: tripStops, loadSheetId: sm.id, driverWho }
  const drv = await as(driverWho)
  await tryCall(drv.delivery.consents.grant({ ...mk(), granted: true, noticeVersion: 'gps-notice-2026-09', locale: 'en-IN' }))
  const dep = await tryCall(drv.delivery.trips.depart({ ...key(), id: tm.id }))
  if (!dep.ok) return { tripId: tm.id, stops: tripStops, loadSheetId: sm.id, driverWho, failedAt: 'depart', result: dep }
  return { tripId: tm.id, stops: tripStops, loadSheetId: sm.id, driverWho }
}

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
/** Record a delivery: full by default, or per invoice line { delivered, returned, saleable, reason }. */
export async function deliver(trip, stop, invoiceId, perLine = {}, opts = {}) {
  const drv = await as(trip.driverWho)
  if (!opts.skipWalk) {
    await tryCall(drv.delivery.stops.start({ ...key(), id: stop.id }))
    await tryCall(drv.delivery.stops.arrive({ ...key(), id: stop.id }))
  }
  const lines = q(`select id, qty_pcs + free_qty_pcs as pcs from invoice_lines where invoice_id = '${invoiceId}' order by line_no`).map((l) => {
    const p = typeof perLine === 'function' ? perLine(l) : perLine[l.id]
    if (!p) return { id: uuidv7(), invoiceLineId: l.id, deliveredQtyPcs: l.pcs, returnedQtyPcs: 0, returnedSaleable: true }
    return { id: uuidv7(), invoiceLineId: l.id, deliveredQtyPcs: p.delivered, returnedQtyPcs: p.returned ?? l.pcs - p.delivered, returnedSaleable: p.saleable ?? true, ...(p.reason ? { reason: p.reason } : {}) }
  })
  const dm = mk()
  const r = await tryCall(drv.delivery.deliveries.record({ ...dm, tripId: trip.tripId, stopId: stop.id, invoiceId, receiverName: 'Shop owner', lines, pod: [{ id: uuidv7(), kind: 'signature', inline: { mimeType: 'image/png', contentBase64: PNG } }] }))
  return { ...r, deliveryId: dm.id, lines }
}

export async function failStop(trip, stop, reason = 'refused') {
  const drv = await as(trip.driverWho)
  await tryCall(drv.delivery.stops.start({ ...key(), id: stop.id }))
  await tryCall(drv.delivery.stops.arrive({ ...key(), id: stop.id }))
  return tryCall(drv.delivery.stops.fail({ ...key(), id: stop.id, failureReason: reason, failureNote: 'QA p10' }))
}

/** Check in (crew) and settle at the preview's expected cash + van count (manager), unless told otherwise. */
export async function checkInAndSettle(trip, opts = {}) {
  const drv = await as(trip.driverWho)
  const ret = await tryCall(drv.delivery.trips.return({ ...key(), id: trip.tripId }))
  if (opts.noSettle) return { ret }
  const mgr = await as(opts.settler ?? 'manager')
  const preview = await must(mgr.delivery.trips.settlementPreview({ id: trip.tripId }), 'settlementPreview')
  const counted = (preview.expectedVanStock ?? []).map((v) => ({ lotId: v.lotId, countedPcs: opts.count?.(v) ?? v.expectedPcs ?? v.qtyPcs ?? 0 }))
  const settle = await tryCall(mgr.delivery.trips.settle({ ...mk(), tripId: trip.tripId, handedOverCashPaise: opts.handedOverCashPaise ?? preview.expectedCashPaise, counted, acceptVariance: opts.acceptVariance ?? true, note: 'QA p10' }))
  return { ret, preview, settle }
}

export async function cancelBill(invoiceId, who = 'owner', extra = {}) {
  const c = await as(who)
  return tryCall(c.billing.invoices.cancel({ ...key(), id: invoiceId, reason: 'QA p10 cancel', ...extra }))
}

export { L }
