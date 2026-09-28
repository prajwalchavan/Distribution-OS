// S4c/S4d continuation — the same orders X (SO-0890, D 180, fully held) and Y (SO-0891, D 61, 60 held + 1 short,
// already waved and picking) that s4-reservations.mjs created before it stopped; then FEFO across batches of B.
import { readFileSync, writeFileSync } from 'node:fs'
import * as K from './kit.mjs'
const { L, F } = K
const FX = JSON.parse(readFileSync(`${L.EV}fixture.json`, 'utf8'))
const { V } = FX
const LOT = FX.lots
const D1 = LOT['P10-D1']
const bal = (lot, loc = L.GODOWN) => L.q1(`select on_hand, reserved from stock_balances where lot_id = '${lot}' and location_id = '${loc}'`) ?? { on_hand: 0, reserved: 0 }
const lotName = (id) => (id ? Object.entries(LOT).find(([, v]) => v === id)?.[0] ?? id.slice(0, 8) : 'none')
const owner = await L.as('owner')
const wh = await L.as('wh')
const X = L.q1(`select id, order_no from sales_orders where order_no = 'SO-0890'`)
const Y = L.q1(`select id, order_no from sales_orders where order_no = 'SO-0891'`)
const shopId = L.q1(`select retailer_id from sales_orders where id = '${X.id}'`).retailer_id

K.begin('S4c', 'a short-confirmed order (Y: 61 asked, 60 held) is picked in full from the rack: whose pieces does it take?')
K.step('D1 godown now', bal(D1))
const pl = L.q1(`select id, status from picklists where order_ids ? '${Y.id}' and status <> 'cancelled' order by created_at desc limit 1`)
const sheet = (await L.must(wh.warehouse.picklists.get({ id: pl.id }), 'sheet')).item
K.step('Y pick sheet asks', sheet.lines.map((l) => `${l.requestedQtyPcs} from ${lotName(l.suggestedLotId ?? l.lotId)}`))
const pickY = await L.tryCall(wh.warehouse.picklists.pick({ ...L.key(), id: pl.id, lines: sheet.lines.map((l) => ({ id: l.id, orderLineId: l.orderLineId, lotId: D1, pickedQtyPcs: 61 })) }))
K.step('picker records 61 for Y from D1 (the rack physically holds 240)', L.brief(pickY))
const pkY = await F.pack(Y.id)
const billedY = pkY.invoice ? L.q1(`select sum(qty_pcs + free_qty_pcs) pcs from invoice_lines where invoice_id = '${pkY.invoice.id}'`).pcs : null
K.step('pack + bill Y', { r: L.brief(pkY), invoice: pkY.invoice?.invoice_no, billedPcs: billedY })
const afterY = bal(D1)
K.step('D1 godown after Y packed', afterY)
K.check('pieces held for order X are not handed to order Y (reserved ≤ on hand)', afterY.reserved <= afterY.on_hand, afterY)
const wx = await F.wave([X.id])
K.step('X pick sheet asks', wx.sheet.lines.map((l) => `${l.requestedQtyPcs} from ${lotName(l.suggestedLotId ?? l.lotId)}`))
const pickX = await F.pick(wx.picklistId, wx.sheet)
const pkX = await F.pack(X.id)
K.step('X picks and packs its full reserved quantity (180)', { pick: L.brief(pickX), pack: L.brief(pkX), D1: bal(D1) })
K.check('the order that was confirmed with its full hold can still be packed in full', pkX.ok, L.brief(pkX))
if (!pkX.ok) {
  // X can only go short now: pick what is left
  const left = bal(D1).on_hand
  const pickX2 = await F.pick(wx.picklistId, wx.sheet, () => ({ pcs: Math.min(180, left), reason: 'rack empty — pieces went to another order' }))
  const pkX2 = await F.pack(X.id)
  K.step(`X re-picks ${Math.min(180, left)} (what the rack has left) and packs`, { pick: L.brief(pickX2), pack: L.brief(pkX2), invoice: pkX2.invoice?.invoice_no, billed: pkX2.invoice ? L.q1(`select sum(qty_pcs) pcs from invoice_lines where invoice_id = '${pkX2.invoice.id}'`).pcs : null, D1: bal(D1) })
}
K.ledger()
K.recon()

K.begin('S4d', 'FEFO across batches of B: in-date earliest first, short-dated only when in-date runs out, expired never')
const bRows = L.q(`select l.batch_no, l.expiry_date, b.on_hand, b.reserved from stock_balances b join stock_lots l on l.id = b.lot_id where l.variant_id = '${V.B}' and b.location_id = '${L.GODOWN}' and b.on_hand <> 0 order by l.expiry_date`)
K.step('B at the godown', bRows)
const f1 = await F.placeOrder(shopId, [{ variantId: V.B, qty: 150 }])
await F.ensureConfirmed(f1.orderId)
const h1 = F.holdsOf(f1.orderId)
K.step('order B 150 holds', h1.map((h) => `${lotName(h.lot_id)}:${h.qty}`))
const g1 = bRows.find((b) => b.batch_no === 'P10-B-G1')
K.check('150 held on in-date batches, earliest expiry first (G1 in full, then G2)', h1.every((h) => [LOT['P10-B-G1'], LOT['P10-B-G2']].includes(h.lot_id)) && h1.find((h) => h.lot_id === LOT['P10-B-G1'])?.qty === g1.on_hand - g1.reserved)
const inDateLeft = Number(L.q1(`select coalesce(sum(b.on_hand - b.reserved), 0) n from stock_balances b join stock_lots l on l.id = b.lot_id where l.variant_id = '${V.B}' and b.location_id = '${L.GODOWN}' and l.expiry_date >= '${L.addDays(L.todayIst(), 30)}'`).n)
const f2 = await F.placeOrder(shopId, [{ variantId: V.B, qty: inDateLeft + 20 }])
await F.ensureConfirmed(f2.orderId)
const h2 = F.holdsOf(f2.orderId)
K.step(`order B ${inDateLeft + 20} (in-date still free ${inDateLeft})`, h2.map((h) => `${lotName(h.lot_id)}:${h.qty}`))
K.check('the short-dated batch covers only what in-date stock cannot', h2.find((h) => h.lot_id === LOT['P10-B-SHORT'])?.qty === 20)
K.check('no expired batch held', ![...h1, ...h2].some((h) => h.lot_id === LOT['P10-B-EXP']))
for (const o of [f1, f2]) K.step('owner cancels the probe order', L.brief(await L.tryCall(owner.orders.cancel({ ...L.key(), id: o.orderId, reason: 'QA p10 FEFO probe done' }))))
const bAfter = L.q(`select l.batch_no, b.on_hand, b.reserved from stock_balances b join stock_lots l on l.id = b.lot_id where l.variant_id = '${V.B}' and b.location_id = '${L.GODOWN}' and b.on_hand <> 0 order by l.expiry_date`)
K.check('B holds back to what they were', bAfter.every((b) => bRows.find((x) => x.batch_no === b.batch_no)?.reserved === b.reserved), bAfter)
K.recon()

writeFileSync(`${L.EV}fixture-s4.json`, JSON.stringify({ X, Y, shopId }, null, 1))
K.save('s4cd-reservations.json')
