// S6c2 — continuation of s6c-trips.mjs (which stopped when TRIP-0006, the re-plan of bill Y, held driver tanaji):
// S6d2 follows that re-planned trip; S6f (mid-trip unload) runs on van A with ganesh; S6g as written.
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
const out = {}

K.begin('S6d2', 'the bill of the cancelled trip, re-planned on TRIP-0006 (van C): can it go out and be delivered?')
const Y = L.q1(`select i.id, i.invoice_no, i.retailer_id, i.order_id from invoices i where i.invoice_no = 'INV/9013'`)
const T6 = L.q1(`select t.id, t.trip_no, t.state::text state from trips t join trip_stops s on s.trip_id = t.id join deliveries d on d.stop_id = s.id where d.invoice_id = '${Y.id}' and t.state <> 'cancelled' order by t.created_at desc limit 1`)
const stop6 = L.q1(`select s.id from trip_stops s where s.trip_id = '${T6.id}' order by sequence limit 1`)
K.step('re-planned trip', { T6, D1: places(LOT['P10-D1']) })
const d6 = await L.as('driver6')
attempt('start loading TRIP-0006', 'warehouse', await L.tryCall(wh.delivery.trips.startLoading({ ...L.key(), id: T6.id })), false)
attempt('build a load sheet for bill Y\'s (dispatched) order onto van C', 'warehouse', await L.tryCall(wh.warehouse.loadSheets.create({ ...L.mk(), toLocationId: L.VEHICLES.C.loc, fromLocationId: L.GODOWN, tripId: T6.id, orderIds: [Y.order_id] })))
await L.tryCall(d6.delivery.consents.grant({ ...L.mk(), granted: true, noticeVersion: 'gps-notice-2026-09', locale: 'en-IN' }))
const dep = attempt('depart TRIP-0006 with no load sheet (bill Y already "dispatched")', 'delivery', await L.tryCall(d6.delivery.trips.depart({ ...L.key(), id: T6.id })))
const trip6 = { tripId: T6.id, driverWho: 'driver6' }
if (dep.ok) {
  const dl = await F.deliver(trip6, { id: stop6.id }, Y.id)
  attempt('deliver bill Y from van C (its 60 pieces are on van B)', 'delivery', dl, false)
  K.step('after', { D1: places(LOT['P10-D1']), order: F.orderRow(Y.order_id).state })
  const ci = await F.checkInAndSettle(trip6, {})
  K.step('TRIP-0006 check-in / settle', { ret: L.brief(ci.ret), settle: L.brief(ci.settle), D1: places(LOT['P10-D1']), order: F.orderRow(Y.order_id).state, bill: L.q1(`select state::text, undelivered_at from invoices where id = '${Y.id}'`) })
}
K.ledger()
K.recon()

// ---------------------------------------------------------------------------------------------------------------
K.begin('S6f', 'lead: van unload by hand while the trip is still out with the bill on board')
const npBill = S6.npBill // INV/9016, packed on the dock, shop = S6.shop
const T6m = await F.tripOut([{ retailerId: S6.shop.id, invoiceIds: [npBill.id] }], { vehicle: 'A', driver: 'driver' })
K.step('T6 out with the never-picked bill', { failedAt: T6m.failedAt ?? null, r: T6m.result ? L.brief(T6m.result) : 'departed', G: places(LOT['P10-G1']) })
const un = attempt('unload the bill\'s 24 pieces off van A to the godown mid-trip (trips.unload)', 'warehouse', await L.tryCall(wh.delivery.trips.unload({ ...L.mk(), vehicleLocationId: L.VEHICLES.A.loc, lotId: LOT['P10-G1'], qtyPcs: 24 })))
K.step('after unload', { G: places(LOT['P10-G1']), trip: L.q1(`select state::text from trips where id = '${T6m.tripId}'`).state })
const dl = await F.deliver(T6m, T6m.stops[0], npBill.id)
K.step('crew then delivers the bill', { r: L.brief(dl), G: places(LOT['P10-G1']) })
if (un.ok) K.check('mid-trip unload must not leave the bill undeliverable or the pieces in two places', dl.ok, L.brief(dl))
const t6 = await F.checkInAndSettle(T6m, {})
K.step('T6 check-in / settle', { ret: L.brief(t6.ret), settle: L.brief(t6.settle), G: places(LOT['P10-G1']) })
out.T6m = T6m
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

writeFileSync(`${L.EV}fixture-s6c2.json`, JSON.stringify(out, null, 1))
writeFileSync(`${L.EV}s6-forbidden-table.json`, JSON.stringify(table, null, 1))
K.save('s6c2-continue.json')
