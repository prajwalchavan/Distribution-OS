// S6 — forbidden moves through the API with a role otherwise allowed to act on the document; DOS-251 regression;
// and the leads from the code map (trip cancelled after load-out, unbilled pack dispatched, mid-trip unload,
// delivery on a closing trip, picks edited after pack, two credit drafts on one line).
import { readFileSync, writeFileSync } from 'node:fs'
import * as K from './kit.mjs'
const { L, F } = K
const FX = JSON.parse(readFileSync(`${L.EV}fixture.json`, 'utf8'))
const S2 = JSON.parse(readFileSync(`${L.EV}fixture-s2.json`, 'utf8'))
const { V } = FX
const LOT = FX.lots
const owner = await L.as('owner')
const mgr = await L.as('manager')
const wh = await L.as('wh')
const rep = await L.as('rep')
const acct = await L.as('accountant')
const table = []
function attempt(move, role, r, expectRefusal = true) {
  const accepted = r.ok
  const row = { move, role, status: r.ok ? 200 : r.status, code: r.ok ? null : r.code, message: r.ok ? 'accepted' : String(r.message).slice(0, 220), dataCode: r.data?.code ?? null, verdict: expectRefusal ? (accepted ? 'ACCEPTED (finding)' : r.status >= 500 ? '500 (P2)' : 'refused') : accepted ? 'accepted (expected)' : 'refused' }
  table.push(row)
  K.step(`${move} [${role}]`, `${row.status} ${row.code ?? ''} ${row.message}`)
  return r
}
const places = (lot) => Object.fromEntries(L.lotPlaces(lot).filter((p) => p.on_hand !== 0 || p.reserved !== 0).map((p) => [`${p.kind}:${p.name.slice(0, 22)}`, `${p.on_hand}/${p.reserved}`]))
const shop = await F.createShop(`QA P10 State Shop ${Date.now() % 100000}`)
const shop2 = await F.createShop(`QA P10 State Shop B ${Date.now() % 100000}`)
const out = { shop, shop2 }

// ---------------------------------------------------------------------------------------------------------------
K.begin('S6a', 'forbidden moves on delivered, cancelled and rejected documents')
const delivered = { order: S2.orders.o1.orderId, bill: S2.inv.o1 }
attempt('delivered → submitted (orders.submit on a delivered order)', 'owner', await L.tryCall(owner.orders.submit({ ...L.key(), id: delivered.order })))
attempt('delivered → confirmed (orders.confirm)', 'owner', await L.tryCall(owner.orders.confirm({ ...L.key(), id: delivered.order })))
attempt('delivered → cancelled (orders.cancel)', 'owner', await L.tryCall(owner.orders.cancel({ ...L.key(), id: delivered.order, reason: 'QA p10' })))
attempt('delivered bill → cancelled (invoices.cancel)', 'owner', await L.tryCall(owner.billing.invoices.cancel({ ...L.key(), id: delivered.bill, reason: 'QA p10' })))
attempt('delivered → packed again (packs.confirm)', 'warehouse', await L.tryCall(wh.warehouse.packs.confirm({ ...L.mk(), orderId: delivered.order, packages: 1, issueInvoice: true })))
const cancelledBill = L.q1(`select i.id, i.order_id from invoices i where i.invoice_no = 'INV/9012'`)
attempt('cancelled order → confirmed (orders.confirm)', 'owner', await L.tryCall(owner.orders.confirm({ ...L.key(), id: cancelledBill.order_id })))
attempt('cancelled order → packed (packs.confirm)', 'warehouse', await L.tryCall(wh.warehouse.packs.confirm({ ...L.mk(), orderId: cancelledBill.order_id, packages: 1, issueInvoice: true })))
attempt('cancelled bill → planned on a trip (trips.create)', 'manager', await L.tryCall(mgr.delivery.trips.create({ ...L.mk(), tripDate: L.todayIst(), vehicleId: L.VEHICLES.C.id, driverId: L.q1(`select id from users where username = 'mahesh.sutar'`).id, openingCashPaise: 0, stops: [{ id: L.uuidv7(), sequence: 1, retailerId: L.q1(`select retailer_id from invoices where id = '${cancelledBill.id}'`).retailer_id, invoiceIds: [cancelledBill.id] }] })))
const rejected = L.q1(`select id from sales_orders where order_no = 'SO-0885'`)
attempt('rejected order → confirmed (orders.confirm)', 'owner', await L.tryCall(owner.orders.confirm({ ...L.key(), id: rejected.id })))
attempt('rejected order → packed (packs.confirm)', 'warehouse', await L.tryCall(wh.warehouse.packs.confirm({ ...L.mk(), orderId: rejected.id, packages: 1, issueInvoice: true })))
attempt('rejected order → re-submitted (orders.submit)', 'rep', await L.tryCall(rep.orders.submit({ ...L.key(), id: rejected.id })))
// approve twice
const strict = await F.createShop(`QA P10 Strict2 ${Date.now() % 100000}`, { creditMode: 'strict', creditLimitPaise: 100 })
const held = await F.placeOrder(strict.id, [{ variantId: V.G, qty: 48 }])
const gate = L.q1(`select id from approvals where order_id = '${held.orderId}' and status = 'pending'`)
const g0 = L.q1(`select reserved from stock_balances where lot_id = '${LOT['P10-G1']}' and location_id = '${L.GODOWN}'`).reserved
attempt('approve (first)', 'owner', await L.tryCall(owner.orders.approvals.decide({ ...L.key(), id: gate.id, decision: 'approve', note: 'QA p10 first' })), false)
attempt('approve twice (same gate, new key)', 'manager', await L.tryCall(mgr.orders.approvals.decide({ ...L.key(), id: gate.id, decision: 'approve', note: 'QA p10 second' })))
attempt('confirm again after the approval confirmed it', 'owner', await L.tryCall(owner.orders.confirm({ ...L.key(), id: held.orderId })))
const g1 = L.q1(`select reserved from stock_balances where lot_id = '${LOT['P10-G1']}' and location_id = '${L.GODOWN}'`).reserved
K.check('the second approval / confirm did not hold the pieces twice (+48 only)', g1 - g0 === 48, { before: g0, after: g1 })
attempt('reject after approve (same gate)', 'owner', await L.tryCall(owner.orders.approvals.decide({ ...L.key(), id: gate.id, decision: 'reject', note: 'QA p10 late reject' })))
out.heldOrder = held.orderId
K.ledger()
K.recon()

// ---------------------------------------------------------------------------------------------------------------
K.begin('S6b', 'pack never picked, bill on two trips, deliver an unplanned bill, deliver twice, settle with an open stop, cancel a bill with a receipt')
// pack an order that was never waved or picked
const np = await F.placeOrder(shop.id, [{ variantId: V.G, qty: 24 }])
await F.ensureConfirmed(np.orderId)
const npPack = attempt('pack an order never waved or picked (confirmed → packed)', 'warehouse', await L.tryCall(wh.warehouse.packs.confirm({ ...L.mk(), orderId: np.orderId, packages: 1, issueInvoice: true })))
const npBill = L.q1(`select id, invoice_no from invoices where order_id = '${np.orderId}' and state <> 'cancelled'`)
K.step('never-picked pack result', { order: F.orderRow(np.orderId).state, bill: npBill, billed: npBill ? L.q1(`select sum(qty_pcs) pcs from invoice_lines where invoice_id = '${npBill.id}'`).pcs : null, picks: L.q(`select count(*) n from pick_lines where order_id = '${np.orderId}'`)[0].n })
// a second order for trips
const o2 = await F.placeOrder(shop2.id, [{ variantId: V.G, qty: 24 }, { variantId: V.C, qty: 24 }])
await F.ensureConfirmed(o2.orderId)
const p2 = await F.pickAndPack([o2.orderId])
const bill2 = p2.packs[0].invoice
// trip T3 with shop2's bill (loads + departs)
const T3 = await F.tripOut([{ retailerId: shop2.id, invoiceIds: [bill2.id] }], { vehicle: 'C', driver: 'driver3' })
K.step('trip T3 out with bill2', { failedAt: T3.failedAt ?? null, r: T3.result ? L.brief(T3.result) : 'departed', bill: bill2.invoice_no })
attempt('plan the same bill on a second trip (trips.create)', 'manager', await L.tryCall(mgr.delivery.trips.create({ ...L.mk(), tripDate: L.todayIst(), vehicleId: L.VEHICLES.B.id, driverId: L.q1(`select id from users where username = 'iqbal.shaikh'`).id, openingCashPaise: 0, stops: [{ id: L.uuidv7(), sequence: 1, retailerId: shop2.id, invoiceIds: [bill2.id] }] })))
attempt('load the dispatched bill onto another load sheet (loadSheets.create)', 'warehouse', await L.tryCall(wh.warehouse.loadSheets.create({ ...L.mk(), toLocationId: L.VEHICLES.B.loc, fromLocationId: L.GODOWN, orderIds: [o2.orderId] })))
// deliver a bill that is packed but on no trip (the never-picked bill), at T3's stop — wrong shop and not loaded
if (npBill) {
  const drv3 = await L.as('driver3')
  attempt('deliver a bill never loaded / not on this trip (deliveries.record)', 'delivery', await L.tryCall(drv3.delivery.deliveries.record({ ...L.mk(), tripId: T3.tripId, stopId: T3.stops[0].id, invoiceId: npBill.id, receiverName: 'x', lines: L.q(`select id, qty_pcs from invoice_lines where invoice_id = '${npBill.id}'`).map((l) => ({ id: L.uuidv7(), invoiceLineId: l.id, deliveredQtyPcs: l.qty_pcs, returnedQtyPcs: 0, returnedSaleable: true })), pod: [{ id: L.uuidv7(), kind: 'signature', inline: { mimeType: 'image/png', contentBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' } }] })))
}
// settle with the stop still open (trip active)
const pv = await L.tryCall(mgr.delivery.trips.settlementPreview({ id: T3.tripId }))
attempt('settle a trip that is still out with its stop open (trips.settle on active)', 'manager', await L.tryCall(mgr.delivery.trips.settle({ ...L.mk(), tripId: T3.tripId, handedOverCashPaise: 0, counted: [], acceptVariance: true, note: 'QA p10' })))
// deliver, then deliver twice
const d1 = await F.deliver(T3, T3.stops[0], bill2.id)
K.step('deliver bill2 (first)', L.brief(d1))
const gBefore = places(LOT['P10-G1'])
const d2 = await F.deliver(T3, T3.stops[0], bill2.id, {}, { skipWalk: true })
attempt('deliver the same bill twice (new id + key)', 'delivery', d2)
K.check('deliver twice moved no more stock', JSON.stringify(places(LOT['P10-G1'])) === JSON.stringify(gBefore), { before: gBefore, after: places(LOT['P10-G1']) })
// pay twice (two collections with different keys for the bill's full amount)
const total = Number(L.q1(`select total_paise from invoices where id = '${bill2.id}'`).total_paise)
const drv = await L.as('driver3')
const c1 = await L.tryCall(drv.delivery.collections.record({ ...L.mk(), receiptId: L.uuidv7(), tripId: T3.tripId, stopId: T3.stops[0].id, retailerId: shop2.id, mode: 'cash', amountPaise: total }))
const c2 = await L.tryCall(drv.delivery.collections.record({ ...L.mk(), receiptId: L.uuidv7(), tripId: T3.tripId, stopId: T3.stops[0].id, retailerId: shop2.id, mode: 'cash', amountPaise: total }))
attempt('pay the bill once (cash at the door)', 'delivery', c1, false)
attempt('pay the same bill again (different key, same amount)', 'delivery', c2, false)
const alloc = L.q1(`select i.state::text, i.total_paise, coalesce((select sum(amount_paise) from allocations a where a.invoice_id = i.id), 0) allocated from invoices i where i.id = '${bill2.id}'`)
const onAcct = L.q1(`select coalesce(sum(r.amount_paise), 0) - coalesce((select sum(a.amount_paise) from allocations a join receipts r2 on r2.id = a.receipt_id where r2.retailer_id = '${shop2.id}'), 0) free from receipts r where r.retailer_id = '${shop2.id}'`)
K.step('bill2 after two payments', { ...alloc, moneyOnAccount: onAcct.free })
K.check('the bill is never allocated more than its total (second payment sits on account)', Number(alloc.allocated) <= Number(alloc.total_paise), alloc)
out.T3 = T3
out.bill2 = bill2
// cancel a bill that has a receipt (packed, not dispatched)
const o3 = await F.placeOrder(shop.id, [{ variantId: V.G, qty: 12 }])
await F.ensureConfirmed(o3.orderId)
const p3 = await F.pickAndPack([o3.orderId])
const bill3 = p3.packs[0].invoice
const rc = await L.tryCall(acct.receivables.receipts.create({ ...L.mk(), retailerId: shop.id, mode: 'upi', amountPaise: 1000, reference: `QA${Date.now()}`, strategy: 'explicit', allocations: [{ id: L.uuidv7(), invoiceId: bill3.id, amountPaise: 1000 }] }))
K.step('accountant records ₹10 UPI against bill3', L.brief(rc))
attempt('cancel a bill that has a receipt (invoices.cancel)', 'owner', await F.cancelBill(bill3.id, 'owner'))
out.bill3 = bill3
out.npBill = npBill
K.ledger()
K.recon()
writeFileSync(`${L.EV}fixture-s6.json`, JSON.stringify(out, null, 1))
writeFileSync(`${L.EV}s6-forbidden-table.json`, JSON.stringify(table, null, 1))
K.save('s6-forbidden.json')
