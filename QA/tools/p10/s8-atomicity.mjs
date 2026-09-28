// S8 — atomicity by late failure: each request below fails AFTER some of its work would have been written. Afterwards
// nothing of it may be left: no ledger row, no hold, no state move, no document, no number consumed.
import { readFileSync } from 'node:fs'
import * as K from './kit.mjs'
const { L, F } = K
const FX = JSON.parse(readFileSync(`${L.EV}fixture.json`, 'utf8'))
const S6 = JSON.parse(readFileSync(`${L.EV}fixture-s6.json`, 'utf8'))
const { V } = FX
const LOT = FX.lots
const owner = await L.as('owner')
const mgr = await L.as('manager')
const wh = await L.as('wh')
const series = () => Object.fromEntries(L.q(`select series_code, fy, next_no from numbering_series where tenant_id = '${L.T}' order by 1, 2`).map((r) => [`${r.series_code}/${r.fy}`, Number(r.next_no)]))
const counts = () => L.q1(`select (select count(*) from stock_ledger where tenant_id = '${L.T}') ledger, (select count(*) from reservations where tenant_id = '${L.T}') holds,
  (select coalesce(sum(reserved), 0) from stock_balances where tenant_id = '${L.T}') reserved, (select count(*) from invoices where tenant_id = '${L.T}') invoices,
  (select count(*) from credit_notes where tenant_id = '${L.T}') credit_notes, (select count(*) from pack_confirmations where tenant_id = '${L.T}') packs,
  (select count(*) from journal_entries where tenant_id = '${L.T}') journal, (select count(*) from outbox_events where tenant_id = '${L.T}') outbox,
  (select count(*) from delivery_challans where tenant_id = '${L.T}') challans, (select count(*) from order_state_transitions where tenant_id = '${L.T}') transitions`)
const diff = (a, b) => Object.fromEntries(Object.keys(b).filter((k) => a[k] !== b[k]).map((k) => [k, `${a[k]} → ${b[k]}`]))
function probe(label, before, beforeSeries) {
  const after = counts()
  const s = series()
  const d = { ...diff(before, after), ...diff(beforeSeries, s) }
  K.step(`${label}: what changed`, Object.keys(d).length ? d : 'nothing')
  return d
}

K.begin('S8a', 'pack with one good line and one impossible line (picked from a batch the godown does not hold)')
const shop = await F.createShop(`QA P10 Atomic ${Date.now() % 100000}`)
const o = await F.placeOrder(shop.id, [{ variantId: V.G, qty: 12 }, { variantId: V.F, qty: 12 }])
await F.ensureConfirmed(o.orderId)
const w = await F.wave([o.orderId])
const emptyF = L.q1(`select l.id, l.batch_no, coalesce(b.on_hand, 0) on_hand from stock_lots l left join stock_balances b on b.lot_id = l.id and b.location_id = '${L.GODOWN}' where l.variant_id = '${V.F}' and l.tenant_id = '${L.T}' and coalesce(b.on_hand, 0) = 0 limit 1`)
K.step('F batch with nothing in the godown', emptyF)
const lineF = F.orderLines(o.orderId).find((l) => l.variant_id === V.F).id
const pk = await F.pick(w.picklistId, w.sheet, (l) => (l.orderLineId === lineF ? { pcs: l.requestedQtyPcs, lotId: emptyF.id } : undefined))
K.step('pick: G from its batch, F from the empty batch', L.brief(pk))
let b0 = counts()
let s0 = series()
const st0 = F.orderRow(o.orderId).state
const pack = await F.pack(o.orderId)
K.step('pack + bill', L.brief(pack))
const d1 = probe('after the refused pack', b0, s0)
K.check('refused pack left nothing behind (no ledger, hold, bill, pack, journal, number)', !pack.ok && Object.keys(d1).length === 0 && F.orderRow(o.orderId).state === st0, d1)
K.recon()

K.begin('S8b', 'load-out of a bill whose pieces are not on the dock (INV/9016 after the mid-trip unload) — 409 dock_short expected')
const bill = S6.npBill
const T7 = L.mk()
const driverId = L.q1(`select id from users where username = 'iqbal.shaikh'`).id
const tc = await L.tryCall(mgr.delivery.trips.create({ ...T7, tripDate: L.todayIst(), vehicleId: L.VEHICLES.A.id, driverId, openingCashPaise: 0, stops: [{ id: L.uuidv7(), sequence: 1, retailerId: S6.shop.id, invoiceIds: [bill.id] }] }))
K.step('plan INV/9016 on a new trip', L.brief(tc))
await L.tryCall(wh.delivery.trips.startLoading({ ...L.key(), id: T7.id }))
const ls = L.mk()
const lc = await L.tryCall(wh.warehouse.loadSheets.create({ ...ls, toLocationId: L.VEHICLES.A.loc, fromLocationId: L.GODOWN, tripId: T7.id, orderIds: [bill.order_id ?? L.q1(`select order_id from invoices where id = '${bill.id}'`).order_id] }))
K.step('load sheet', L.brief(lc))
K.step('approve', L.brief(await L.tryCall(mgr.warehouse.loadSheets.approve({ ...L.key(), id: ls.id, note: 'QA p10' }))))
b0 = counts()
s0 = series()
const conf = await L.tryCall(wh.warehouse.loadSheets.confirm({ ...L.key(), id: ls.id, countedPackages: 1, challanId: L.uuidv7() }))
K.step('confirm (count out)', L.brief(conf))
const d2 = probe('after the refused load-out', b0, s0)
K.check('refused load-out left nothing behind (no challan, no number, no move, no dispatch)', !conf.ok && Object.keys(d2).length === 0, d2)
// clean: stage from the godown and load it properly, then drop — or leave planned; record what stage-dock does
const sd = await L.tryCall(wh.warehouse.loadSheets.stageDock({ ...L.key(), id: ls.id }))
K.step('stage-dock (bring the missing pieces from the godown)', L.brief(sd))
K.ledger()
K.recon()

K.begin('S8c', 'door with one good line and one impossible line (returned more than billed)')
const shop2 = await F.createShop(`QA P10 Atomic B ${Date.now() % 100000}`)
const o2 = await F.placeOrder(shop2.id, [{ variantId: V.G, qty: 12 }, { variantId: V.C, qty: 12 }])
await F.ensureConfirmed(o2.orderId)
const pp = await F.pickAndPack([o2.orderId])
const inv2 = pp.packs[0].invoice
const T8 = await F.tripOut([{ retailerId: shop2.id, invoiceIds: [inv2.id] }], { vehicle: 'B', driver: 'driver5' })
K.step('trip out', { failedAt: T8.failedAt ?? null, r: T8.result ? L.brief(T8.result) : 'departed' })
const drv = await L.as('driver5')
await L.tryCall(drv.delivery.stops.start({ ...L.key(), id: T8.stops[0].id }))
await L.tryCall(drv.delivery.stops.arrive({ ...L.key(), id: T8.stops[0].id }))
b0 = counts()
s0 = series()
const il = L.q(`select id, variant_id, qty_pcs from invoice_lines where invoice_id = '${inv2.id}' order by line_no`)
const bad = await L.tryCall(drv.delivery.deliveries.record({ ...L.mk(), tripId: T8.tripId, stopId: T8.stops[0].id, invoiceId: inv2.id, receiverName: 'x', lines: il.map((l, i) => (i === 0 ? { id: L.uuidv7(), invoiceLineId: l.id, deliveredQtyPcs: l.qty_pcs, returnedQtyPcs: 0, returnedSaleable: true } : { id: L.uuidv7(), invoiceLineId: l.id, deliveredQtyPcs: 6, returnedQtyPcs: 20, returnedSaleable: true, reason: 'refused' })), pod: [{ id: L.uuidv7(), kind: 'signature', inline: { mimeType: 'image/png', contentBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' } }] }))
K.step('record: line 1 in full, line 2 delivered 6 + returned 20 of 12', L.brief(bad))
const d3 = probe('after the refused door', b0, s0)
K.check('refused door left nothing behind', !bad.ok && Object.keys(d3).length === 0, d3)
const good = await F.deliver(T8, T8.stops[0], inv2.id, {}, { skipWalk: true })
K.step('then recorded properly (full)', L.brief(good))
K.recon()

K.begin('S8d', 'credit note auto-issued with one good line and one over-credit line; settle with a cash variance by the manager')
b0 = counts()
s0 = series()
const il2 = L.q(`select id, qty_pcs from invoice_lines where invoice_id = '${inv2.id}' order by line_no`)
const cn = await L.tryCall(owner.billing.creditNotes.create({ ...L.mk(), invoiceId: inv2.id, reason: 'return_saleable', autoIssue: true, lines: [{ id: L.uuidv7(), invoiceLineId: il2[0].id, qtyPcs: 2, saleable: true }, { id: L.uuidv7(), invoiceLineId: il2[1].id, qtyPcs: 99, saleable: true }] }))
K.step('credit note: 2 pcs good line + 99 pcs on a 12-pc line', L.brief(cn))
const d4 = probe('after the refused credit note', b0, s0)
K.check('refused credit note left nothing behind', !cn.ok && Object.keys(d4).length === 0, d4)
// collect cash, check in, then settle short without acceptVariance (manager)
const total = Number(L.q1(`select total_paise from invoices where id = '${inv2.id}'`).total_paise)
K.step('collect cash', L.brief(await L.tryCall(drv.delivery.collections.record({ ...L.mk(), receiptId: L.uuidv7(), tripId: T8.tripId, stopId: T8.stops[0].id, retailerId: shop2.id, mode: 'cash', amountPaise: total }))))
K.step('check in', L.brief(await L.tryCall(drv.delivery.trips.return({ ...L.key(), id: T8.tripId }))))
const pv = await L.must(mgr.delivery.trips.settlementPreview({ id: T8.tripId }), 'preview')
const appr0 = L.q1(`select count(*) n from approvals where entity_id = '${T8.tripId}' or (kind::text = 'trip_settlement' and created_at > now() - interval '1 minute')`).n
b0 = counts()
s0 = series()
const settle = await L.tryCall(mgr.delivery.trips.settle({ ...L.mk(), tripId: T8.tripId, handedOverCashPaise: pv.expectedCashPaise - 50000, counted: (pv.expectedVanStock ?? []).map((v) => ({ lotId: v.lotId, countedPcs: v.expectedPcs ?? v.qtyPcs ?? 0 })), acceptVariance: false, note: 'QA p10 ₹500 short' }))
K.step('manager settles ₹500 short without accepting the variance', L.brief(settle))
const d5 = probe('after the refused settlement', b0, s0)
const appr = L.q(`select kind::text, status::text, entity_type from approvals where kind::text = 'trip_settlement' and created_at > now() - interval '2 minutes'`)
K.step('approval rows filed', appr)
K.step('trip state', L.q1(`select state::text from trips where id = '${T8.tripId}'`).state)
const own = await L.tryCall(owner.delivery.trips.settle({ ...L.mk(), tripId: T8.tripId, handedOverCashPaise: pv.expectedCashPaise - 50000, counted: (pv.expectedVanStock ?? []).map((v) => ({ lotId: v.lotId, countedPcs: v.expectedPcs ?? v.qtyPcs ?? 0 })), acceptVariance: true, note: 'QA p10 owner accepts ₹500 short' }))
K.step('owner settles accepting the variance', L.brief(own))
K.recon()
K.save('s8-atomicity.json')
