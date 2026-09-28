// S2 — the whole lifecycle with our own batches: reserve → pick (full, short, zero) → pack/bill → load-out → depart →
// door (full, part, refused, damaged return) → check-in → dock → out again → delivered.
import { readFileSync, writeFileSync } from 'node:fs'
import * as K from './kit.mjs'
const { L, F } = K
const FX = JSON.parse(readFileSync(`${L.EV}fixture.json`, 'utf8'))
const { V } = FX
const LOT = FX.lots
const bal = (lot, loc = L.GODOWN) => L.q1(`select on_hand, reserved from stock_balances where lot_id = '${lot}' and location_id = '${loc}'`) ?? { on_hand: 0, reserved: 0 }
const places = (lot) => Object.fromEntries(L.lotPlaces(lot).filter((p) => p.on_hand !== 0 || p.reserved !== 0).map((p) => [`${p.kind}:${p.name}`, `${p.on_hand}/${p.reserved}`]))

// ---------------------------------------------------------------------------------------------------------------
K.begin('S2a', 'four shops order; confirm reserves FEFO at the godown')
const shops = []
for (const n of [1, 2, 3, 4]) shops.push(await F.createShop(`QA P10 Shop ${n} ${Date.now() % 100000}`))
const before = { A: bal(LOT['P10-A1']), C: bal(LOT['P10-C1']), G: bal(LOT['P10-G1']) }
const o1 = await F.placeOrder(shops[0].id, [{ variantId: V.A, qty: 100 }, { variantId: V.G, qty: 48 }])
const o2 = await F.placeOrder(shops[1].id, [{ variantId: V.A, qty: 60 }, { variantId: V.C, qty: 48 }])
const o3 = await F.placeOrder(shops[2].id, [{ variantId: V.A, qty: 40 }, { variantId: V.C, qty: 24 }])
const o4 = await F.placeOrder(shops[3].id, [{ variantId: V.C, qty: 48 }])
for (const o of [o1, o2, o3, o4]) {
  K.step(`order ${o.orderId.slice(0, 8)}`, { created: L.brief(o.created), submitted: o.submitted ? L.brief(o.submitted) : null })
  await F.ensureConfirmed(o.orderId)
}
const states = [o1, o2, o3, o4].map((o) => F.orderRow(o.orderId))
K.step('order states', states.map((s) => `${s.order_no}:${s.state}`))
K.check('all four orders confirmed', states.every((s) => s.state === 'confirmed'))
const afterRes = { A: bal(LOT['P10-A1']), C: bal(LOT['P10-C1']), G: bal(LOT['P10-G1']) }
K.step('godown reserved before → after confirm', { before, afterRes })
K.check('A reserved +200, C +120, G +48, on hand unchanged', afterRes.A.reserved - before.A.reserved === 200 && afterRes.C.reserved - before.C.reserved === 120 && afterRes.G.reserved - before.G.reserved === 48 && afterRes.A.on_hand === before.A.on_hand)
K.ledger()
K.recon()

// ---------------------------------------------------------------------------------------------------------------
K.begin('S2b', 'one wave: order 1 full pick, order 2 short (A 60 → 40), order 3 zero pick on C; pack + bill each')
const w = await F.wave([o1.orderId, o2.orderId, o3.orderId, o4.orderId])
const ol2 = F.orderLines(o2.orderId)
const ol3 = F.orderLines(o3.orderId)
const shortLine = ol2.find((l) => l.variant_id === V.A).id
const zeroLine = ol3.find((l) => l.variant_id === V.C).id
K.step('sheet lines', w.sheet.lines.map((l) => `${l.orderLineId.slice(0, 8)} req ${l.requestedQtyPcs} lot ${l.suggestedLotId?.slice(0, 8)}`))
const picked = await F.pick(w.picklistId, w.sheet, (l) => (l.orderLineId === shortLine ? { pcs: 40, reason: 'only 2 cases found' } : l.orderLineId === zeroLine ? { pcs: 0, reason: 'none on the shelf' } : undefined))
K.step('pick', L.brief(picked))
const pk = {}
for (const [name, o] of Object.entries({ o1, o2, o3, o4 })) {
  pk[name] = await F.pack(o.orderId)
  K.step(`pack ${name}`, { result: L.brief(pk[name]), invoice: pk[name].invoice })
}
const billed3 = L.q(`select il.variant_id, il.qty_pcs, il.free_qty_pcs, il.lot_id from invoice_lines il where il.invoice_id = '${pk.o3.invoice.id}'`)
K.check('DOS-252 regression: a line picked 0 is not billed', !billed3.some((l) => l.variant_id === V.C && l.qty_pcs + l.free_qty_pcs > 0), billed3)
const billed2 = L.q(`select il.variant_id, il.qty_pcs + il.free_qty_pcs pcs from invoice_lines il where il.invoice_id = '${pk.o2.invoice.id}'`)
K.check('short pick: order 2 billed A 40, not 60', billed2.find((l) => l.variant_id === V.A)?.pcs === 40, billed2)
const rows = K.ledger()
const cOut = rows.filter((r) => r.lot_id === LOT['P10-C1'] && r.kind === 'warehouse').reduce((n, r) => n + r.qty_delta, 0)
K.check('DOS-252 regression: C left the godown only for what was picked (48 + 48 = 96)', cOut === -96, `godown C moved ${cOut}`)
K.step('places A', places(LOT['P10-A1']))
K.step('places C', places(LOT['P10-C1']))
K.step('holds', { o1: F.holdsOf(o1.orderId), o3: F.holdsOf(o3.orderId) })
const cAfterPack = bal(LOT['P10-C1'])
K.check('zero-picked C for order 3: godown reserve released (reserved back to 0)', cAfterPack.reserved === 0, cAfterPack)
K.recon()

// ---------------------------------------------------------------------------------------------------------------
K.begin('S2c', 'trip 1: load-out approval → dispatch; doors: full (1), part with saleable return (2), refused (3), damaged return (4)')
const inv = Object.fromEntries(Object.entries(pk).map(([k, v]) => [k, v.invoice.id]))
const trip = await F.tripOut([
  { retailerId: shops[0].id, invoiceIds: [inv.o1] },
  { retailerId: shops[1].id, invoiceIds: [inv.o2] },
  { retailerId: shops[2].id, invoiceIds: [inv.o3] },
  { retailerId: shops[3].id, invoiceIds: [inv.o4] },
])
K.step('trip', { failedAt: trip.failedAt ?? null, result: trip.result ? L.brief(trip.result) : 'departed' })
K.step('after load-out: places A / C / G', { A: places(LOT['P10-A1']), C: places(LOT['P10-C1']), G: places(LOT['P10-G1']) })
K.step('order states', [o1, o2, o3, o4].map((o) => F.orderRow(o.orderId).state))
const d1 = await F.deliver(trip, trip.stops[0], inv.o1)
K.step('door 1 full', L.brief(d1))
const il2 = L.q(`select id, variant_id, qty_pcs + free_qty_pcs pcs from invoice_lines where invoice_id = '${inv.o2}'`)
const d2 = await F.deliver(trip, trip.stops[1], inv.o2, (l) => (il2.find((x) => x.id === l.id)?.variant_id === V.A ? { delivered: 30, returned: 10, saleable: true, reason: 'refused' } : undefined))
K.step('door 2 part (A 30 of 40, 10 back saleable)', L.brief(d2))
const f3 = await F.failStop(trip, trip.stops[2], 'refused')
K.step('door 3 refused (stop fail)', L.brief(f3))
const d4 = await F.deliver(trip, trip.stops[3], inv.o4, () => ({ delivered: 36, returned: 12, saleable: false, reason: 'damaged' }))
K.step('door 4 part (C 36 of 48, 12 back damaged)', L.brief(d4))
K.ledger()
K.step('places A / C / G', { A: places(LOT['P10-A1']), C: places(LOT['P10-C1']), G: places(LOT['P10-G1']) })
K.step('order states', [o1, o2, o3, o4].map((o) => `${F.orderRow(o.orderId).order_no}:${F.orderRow(o.orderId).state}`))
K.recon()

// ---------------------------------------------------------------------------------------------------------------
K.begin('S2d', 'check-in + settle trip 1: undelivered bill 3 van → dock, free van stock van → godown')
const ci = await F.checkInAndSettle(trip)
K.step('return', L.brief(ci.ret))
K.step('preview expected van stock', (ci.preview?.expectedVanStock ?? []).map((v) => `${v.lotId.slice(0, 8)} ${v.expectedPcs ?? v.qtyPcs}`))
K.step('settle', L.brief(ci.settle))
K.ledger()
K.step('places A / C', { A: places(LOT['P10-A1']), C: places(LOT['P10-C1']) })
const vanLeft = L.q(`select b.lot_id, b.on_hand from stock_balances b where b.location_id = '${L.VEHICLES.A.loc}' and b.on_hand <> 0 and b.lot_id in (${L.inList(Object.values(LOT))})`)
K.check('van A holds none of our lots after settlement', vanLeft.length === 0, vanLeft)
K.step('order 3 + bill 3', { order: F.orderRow(o3.orderId), bill: L.q1(`select invoice_no, state::text, undelivered_at from invoices where id = '${inv.o3}'`), holds: F.holdsOf(o3.orderId) })
K.recon()

// ---------------------------------------------------------------------------------------------------------------
K.begin('S2e', 'bill 3 out again on trip 2 from the dock, delivered in full')
const trip2 = await F.tripOut([{ retailerId: shops[2].id, invoiceIds: [inv.o3] }], { vehicle: 'B', driver: 'driver2' })
K.step('trip 2', { failedAt: trip2.failedAt ?? null, result: trip2.result ? L.brief(trip2.result) : 'departed' })
const d3 = await F.deliver(trip2, trip2.stops[0], inv.o3)
K.step('door 3 second attempt, full', L.brief(d3))
const ci2 = await F.checkInAndSettle(trip2)
K.step('trip 2 check-in / settle', { ret: L.brief(ci2.ret), settle: L.brief(ci2.settle) })
K.ledger()
K.step('places A / C', { A: places(LOT['P10-A1']), C: places(LOT['P10-C1']) })
K.step('orders', [o1, o2, o3, o4].map((o) => `${F.orderRow(o.orderId).order_no}:${F.orderRow(o.orderId).state}`))
K.recon()

writeFileSync(`${L.EV}fixture-s2.json`, JSON.stringify({ shops, orders: { o1, o2, o3, o4 }, inv, trip, trip2 }, null, 1))
K.save('s2-lifecycle.json')
