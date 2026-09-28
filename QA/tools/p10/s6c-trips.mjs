// S6c — DOS-251 regression (cancel a packed bill whose pieces are off the dock), hand-moving held dock pieces, delivery on
// a closing trip, and the code-map leads: trip cancelled after load-out, unbilled pack dispatched, mid-trip van unload,
// picks edited after pack, two credit drafts on one line.
import { readFileSync, writeFileSync } from 'node:fs'
import * as K from './kit.mjs'
const { L, F } = K
const FX = JSON.parse(readFileSync(`${L.EV}fixture.json`, 'utf8'))
const S6 = JSON.parse(readFileSync(`${L.EV}fixture-s6.json`, 'utf8'))
const { V } = FX
const LOT = FX.lots
const owner = await L.as('owner')
const mgr = await L.as('manager')
const wh = await L.as('wh')
const table = JSON.parse(readFileSync(`${L.EV}s6-forbidden-table.json`, 'utf8'))
function attempt(move, role, r, expectRefusal = true) {
  const row = { move, role, status: r.ok ? 200 : r.status, code: r.ok ? null : r.code, message: r.ok ? 'accepted' : String(r.message).slice(0, 220), dataCode: r.data?.code ?? null, verdict: expectRefusal ? (r.ok ? 'ACCEPTED (finding)' : r.status >= 500 ? '500 (P2)' : 'refused') : r.ok ? 'accepted (expected)' : 'refused' }
  table.push(row)
  K.step(`${move} [${role}]`, `${row.status} ${row.code ?? ''} ${row.message}`)
  return r
}
const places = (lot) => Object.fromEntries(L.lotPlaces(lot).filter((p) => p.on_hand !== 0 || p.reserved !== 0).map((p) => [`${p.kind}:${p.name.slice(0, 22)}`, `${p.on_hand}/${p.reserved}`]))
const billOf = (orderNo) => L.q1(`select i.id, i.invoice_no, i.retailer_id, i.order_id from invoices i join sales_orders o on o.id = i.order_id where o.order_no = '${orderNo}' and i.state <> 'cancelled'`)
const out = {}

// close T3 first so vehicle C is free
const t3 = await F.checkInAndSettle(S6.T3)
K.begin('S6c', 'DOS-251: a packed bill whose pieces are on a returning van cannot be cancelled; held dock pieces cannot be hand-moved')
K.step('T3 closed', { ret: L.brief(t3.ret), settle: L.brief(t3.settle) })
const X = billOf('SO-0890') // D 180 on the dock
const Y = billOf('SO-0891') // D 60 on the dock
K.step('bills on the dock', { X: X.invoice_no, Y: Y.invoice_no, D1: places(LOT['P10-D1']) })
attempt('hand-move dock pieces held for bill Y (transfer dock → godown, 60)', 'warehouse', await L.tryCall(wh.inventory.stock.transfer({ ...L.key(), lotId: LOT['P10-D1'], fromLocationId: L.DOCK, toLocationId: L.GODOWN, qtyPcs: 60, note: 'QA p10' })))
attempt('write off dock pieces held for bills (adjust −10 at the dock)', 'owner', await L.tryCall(owner.inventory.stock.adjust({ ...L.key(), lotId: LOT['P10-D1'], locationId: L.DOCK, qtyDelta: -10, reason: 'damage', note: 'QA p10' })))
const T4 = await F.tripOut([{ retailerId: X.retailer_id, invoiceIds: [X.id] }], { vehicle: 'A', driver: 'driver4' })
K.step('T4 out with bill X', { failedAt: T4.failedAt ?? null, r: T4.result ? L.brief(T4.result) : 'departed', D1: places(LOT['P10-D1']) })
attempt('cancel bill X while it is out on the van (dispatched)', 'owner', await F.cancelBill(X.id))
K.step('fail the stop', L.brief(await F.failStop(T4, T4.stops[0], 'shop_closed')))
const ret = await F.checkInAndSettle(T4, { noSettle: true })
K.step('T4 returns (closing): order back to packed, pieces still on the van', { ret: L.brief(ret.ret), order: F.orderRow(X.order_id).state, D1: places(LOT['P10-D1']) })
const drv4 = await L.as('driver4')
attempt('record a delivery for bill X on the closing trip', 'delivery', await L.tryCall(drv4.delivery.deliveries.record({ ...L.mk(), tripId: T4.tripId, stopId: T4.stops[0].id, invoiceId: X.id, receiverName: 'x', lines: L.q(`select id, qty_pcs from invoice_lines where invoice_id = '${X.id}'`).map((l) => ({ id: L.uuidv7(), invoiceLineId: l.id, deliveredQtyPcs: l.qty_pcs, returnedQtyPcs: 0, returnedSaleable: true })), pod: [{ id: L.uuidv7(), kind: 'signature', inline: { mimeType: 'image/png', contentBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' } }] })))
const beforeCancel = places(LOT['P10-D1'])
const dos251 = attempt('DOS-251: cancel packed bill X whose pieces are on the van, not the dock', 'owner', await F.cancelBill(X.id))
K.check('DOS-251 regression: refused, and no piece moved', !dos251.ok && JSON.stringify(places(LOT['P10-D1'])) === JSON.stringify(beforeCancel), { before: beforeCancel, after: places(LOT['P10-D1']) })
const st = await F.checkInAndSettle(T4, {})
K.step('T4 settles: the pieces go van → dock for bill X', { settle: L.brief(st.settle), D1: places(LOT['P10-D1']) })
const c2 = attempt('cancel bill X now its pieces are back on the dock', 'owner', await F.cancelBill(X.id), false)
K.step('after cancel', { bill: L.q1(`select invoice_no, state::text from invoices where id = '${X.id}'`), order: F.orderRow(X.order_id).state, D1: places(LOT['P10-D1']) })
const net = L.q1(`select coalesce(sum(qty_delta), 0) net from stock_ledger l join locations loc on loc.id = l.location_id where l.ref_id in ('${X.id}', '${X.order_id}') and loc.kind in ('warehouse', 'in_transit')`)
K.step('net stock of bill X over pack + cancel refs at godown + dock (should be 0)', net)
K.ledger()
K.recon()

// ---------------------------------------------------------------------------------------------------------------
K.begin('S6d', 'lead: a trip cancelled after its load sheet was confirmed')
const T5 = await F.tripOut([{ retailerId: Y.retailer_id, invoiceIds: [Y.id] }], { vehicle: 'B', driver: 'driver5', noDepart: true })
K.step('T5 loaded (load sheet confirmed), not departed', { failedAt: T5.failedAt ?? null, trip: L.q1(`select state::text from trips where id = '${T5.tripId}'`).state, order: F.orderRow(Y.order_id).state, D1: places(LOT['P10-D1']) })
const tc = attempt('cancel the trip after its load-out (trips.cancel from loading)', 'manager', await L.tryCall(mgr.delivery.trips.cancel({ ...L.key(), id: T5.tripId, reason: 'QA p10 van broke down' })))
const after5 = { trip: L.q1(`select state::text from trips where id = '${T5.tripId}'`).state, order: F.orderRow(Y.order_id).state, bill: L.q1(`select invoice_no, state::text, undelivered_at from invoices where id = '${Y.id}'`), D1: places(LOT['P10-D1']), sheet: L.q1(`select status::text from load_sheets where id = '${T5.loadSheetId}'`) }
K.step('after the cancel', after5)
if (tc.ok) {
  attempt('cancel bill Y (order dispatched on a cancelled trip)', 'owner', await F.cancelBill(Y.id))
  attempt('plan bill Y on a new trip', 'manager', await L.tryCall(mgr.delivery.trips.create({ ...L.mk(), tripDate: L.todayIst(), vehicleId: L.VEHICLES.C.id, driverId: L.q1(`select id from users where username = 'tanaji.bhosale'`).id, openingCashPaise: 0, stops: [{ id: L.uuidv7(), sequence: 1, retailerId: Y.retailer_id, invoiceIds: [Y.id] }] })))
  const drv5 = await L.as('driver5')
  attempt('return (check in) the cancelled trip', 'delivery', await L.tryCall(drv5.delivery.trips.return({ ...L.key(), id: T5.tripId })))
  attempt('settle the cancelled trip', 'manager', await L.tryCall(mgr.delivery.trips.settle({ ...L.mk(), tripId: T5.tripId, handedOverCashPaise: 0, counted: [], acceptVariance: true, note: 'QA p10' })))
}
out.T5 = T5
out.Y = Y
K.ledger()
K.recon()

// ---------------------------------------------------------------------------------------------------------------
K.begin('S6e', 'lead: packed without a bill (issueInvoice false), then loaded and dispatched')
const shopU = await F.createShop(`QA P10 Unbilled ${Date.now() % 100000}`)
const ou = await F.placeOrder(shopU.id, [{ variantId: V.G, qty: 12 }])
await F.ensureConfirmed(ou.orderId)
const wu = await F.wave([ou.orderId])
await F.pick(wu.picklistId, wu.sheet)
const pu = await F.pack(ou.orderId, { issueInvoice: false })
K.step('pack with issueInvoice false', { r: L.brief(pu), order: F.orderRow(ou.orderId).state, bill: pu.invoice })
attempt('orders.cancel on the packed, unbilled order', 'owner', await L.tryCall(owner.orders.cancel({ ...L.key(), id: ou.orderId, reason: 'QA p10' })))
const lsU = L.mk()
const cU = attempt('load sheet for the unbilled packed order (no trip)', 'warehouse', await L.tryCall(wh.warehouse.loadSheets.create({ ...lsU, toLocationId: L.VEHICLES.C.loc, fromLocationId: L.GODOWN, orderIds: [ou.orderId] })))
if (cU.ok) {
  attempt('manager approves it', 'manager', await L.tryCall(mgr.warehouse.loadSheets.approve({ ...L.key(), id: lsU.id, note: 'QA p10' })), false)
  const sh = await L.must(wh.warehouse.loadSheets.get({ id: lsU.id }), 'ls get')
  attempt('confirm (count out) the unbilled order onto van C', 'warehouse', await L.tryCall(wh.warehouse.loadSheets.confirm({ ...L.key(), id: lsU.id, countedPackages: sh.item?.expectedPackages ?? 1, challanId: L.uuidv7() })))
  K.step('after', { order: F.orderRow(ou.orderId).state, bills: L.q(`select invoice_no, state::text from invoices where order_id = '${ou.orderId}'`), G: places(LOT['P10-G1']), challan: L.q1(`select challan_no, status::text from load_sheets where id = '${lsU.id}'`) })
}
out.unbilledOrder = ou.orderId
K.ledger()
K.recon()

// ---------------------------------------------------------------------------------------------------------------
K.begin('S6f', 'lead: van unload by hand while the trip is still out with the bill on board')
const npBill = S6.npBill // INV/9016, packed on the dock, shop = S6.shop
const T6 = await F.tripOut([{ retailerId: S6.shop.id, invoiceIds: [npBill.id] }], { vehicle: 'C', driver: 'driver6' })
K.step('T6 out with the never-picked bill', { failedAt: T6.failedAt ?? null, r: T6.result ? L.brief(T6.result) : 'departed', G: places(LOT['P10-G1']) })
const un = attempt('unload the bill\'s 24 pieces off van C to the godown mid-trip (trips.unload)', 'warehouse', await L.tryCall(wh.delivery.trips.unload({ ...L.mk(), vehicleLocationId: L.VEHICLES.C.loc, lotId: LOT['P10-G1'], qtyPcs: 24 })))
K.step('after unload', { G: places(LOT['P10-G1']), trip: L.q1(`select state::text from trips where id = '${T6.tripId}'`).state })
const dl = await F.deliver(T6, T6.stops[0], npBill.id)
K.step('crew then delivers the bill', { r: L.brief(dl), G: places(LOT['P10-G1']) })
if (un.ok) K.check('mid-trip unload must not leave the bill undeliverable or the pieces in two places', dl.ok, L.brief(dl))
const t6 = await F.checkInAndSettle(T6, {})
K.step('T6 check-in / settle', { ret: L.brief(t6.ret), settle: L.brief(t6.settle), G: places(LOT['P10-G1']) })
out.T6 = T6
K.ledger()
K.recon()

// ---------------------------------------------------------------------------------------------------------------
K.begin('S6g', 'lead: picks edited after the order was packed; two credit drafts on one line')
const shopP = await F.createShop(`QA P10 Repick ${Date.now() % 100000}`)
const pa = await F.placeOrder(shopP.id, [{ variantId: V.G, qty: 12 }])
const pb = await F.placeOrder(shopP.id, [{ variantId: V.G, qty: 12 }])
await F.ensureConfirmed(pa.orderId)
await F.ensureConfirmed(pb.orderId)
const wv = await F.wave([pa.orderId, pb.orderId])
await F.pick(wv.picklistId, wv.sheet)
const pka = await F.pack(pa.orderId)
K.step('order A packed (B not yet)', { r: L.brief(pka), bill: pka.invoice?.invoice_no, sheet: L.q1(`select status::text from picklists where id = '${wv.picklistId}'`).status })
const rowA = L.q1(`select id, order_line_id, lot_id, picked_qty_pcs from pick_lines where order_id = '${pa.orderId}'`)
const rp = attempt('re-pick packed order A\'s line down to 5 (picklists.pick)', 'warehouse', await L.tryCall(wh.warehouse.picklists.pick({ ...L.key(), id: wv.picklistId, lines: [{ id: rowA.id, orderLineId: rowA.order_line_id, lotId: rowA.lot_id, pickedQtyPcs: 5, shortReason: 'QA p10 edit after pack' }] })))
K.step('after the edit', { pickRow: L.q1(`select picked_qty_pcs from pick_lines where id = '${rowA.id}'`), billed: L.q1(`select sum(qty_pcs) pcs from invoice_lines where invoice_id = '${pka.invoice.id}'`).pcs, orderLinePicked: L.q1(`select picked_qty_pcs from sales_order_lines where id = '${rowA.order_line_id}'`).picked_qty_pcs })
await F.pack(pb.orderId)
// two credit drafts on the same line of a delivered bill (bill2 of S6b, G 24 delivered)
const bill2 = S6.bill2
const g24 = L.q1(`select id, qty_pcs from invoice_lines where invoice_id = '${bill2.id}' and variant_id = '${V.G}'`)
const cn1 = L.mk()
const cn2 = L.mk()
attempt('credit draft 1: G 24 saleable', 'owner', await L.tryCall(owner.billing.creditNotes.create({ ...cn1, invoiceId: bill2.id, reason: 'return_saleable', autoIssue: false, lines: [{ id: L.uuidv7(), invoiceLineId: g24.id, qtyPcs: 24, saleable: true }] })), false)
attempt('credit draft 2: the same 24 again', 'manager', await L.tryCall(mgr.billing.creditNotes.create({ ...cn2, invoiceId: bill2.id, reason: 'return_saleable', autoIssue: false, lines: [{ id: L.uuidv7(), invoiceLineId: g24.id, qtyPcs: 24, saleable: true }] })))
attempt('cancel draft 1', 'owner', await L.tryCall(owner.billing.creditNotes.cancel({ ...L.key(), id: cn1.id, reason: 'QA p10' })), false)
K.ledger()
K.recon()

writeFileSync(`${L.EV}fixture-s6c.json`, JSON.stringify(out, null, 1))
writeFileSync(`${L.EV}s6-forbidden-table.json`, JSON.stringify(table, null, 1))
K.save('s6c-trips.json')
