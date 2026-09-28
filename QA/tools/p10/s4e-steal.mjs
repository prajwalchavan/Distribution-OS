// S4e — can a short-confirmed order take, at pick, pieces the godown holds for ANOTHER confirmed order?
// Item E (P10-E1): order X2 fully held; order Y2 confirmed short; the picker records Y2's short part on a split row.
import { readFileSync } from 'node:fs'
import * as K from './kit.mjs'
const { L, F } = K
const FX = JSON.parse(readFileSync(`${L.EV}fixture.json`, 'utf8'))
const { V } = FX
const E1 = FX.lots['P10-E1']
const bal = (loc = L.GODOWN) => L.q1(`select on_hand, reserved from stock_balances where lot_id = '${E1}' and location_id = '${loc}'`) ?? { on_hand: 0, reserved: 0 }
const wh = await L.as('wh')
const shop = await F.createShop(`QA P10 Steal Shop ${Date.now() % 100000}`)

K.begin('S4e', 'short-confirmed order Y2 picks its shortfall from pieces held for X2 (split pick row)')
const start = bal()
K.step('E1 godown', start)
const x2 = await F.placeOrder(shop.id, [{ variantId: V.E, qty: start.on_hand - start.reserved - 52 }])
await F.ensureConfirmed(x2.orderId)
const y2 = await F.placeOrder(shop.id, [{ variantId: V.E, qty: 100 }])
await F.ensureConfirmed(y2.orderId)
K.step('X2 and Y2 confirmed', { X2: F.orderRow(x2.orderId), Y2: F.orderRow(y2.orderId), Y2short: L.q1(`select stock_shortages from sales_orders where id = '${y2.orderId}'`).stock_shortages, E1: bal() })
const w = await F.wave([y2.orderId])
K.step('Y2 sheet', w.sheet.lines.map((l) => ({ id: l.id, req: l.requestedQtyPcs, lot: l.suggestedLotId ?? l.lotId })))
const lines = []
for (const l of w.sheet.lines) {
  if (l.suggestedLotId || l.lotId) lines.push({ id: l.id, orderLineId: l.orderLineId, lotId: l.suggestedLotId ?? l.lotId, pickedQtyPcs: l.requestedQtyPcs })
  else lines.push({ id: L.uuidv7(), orderLineId: l.orderLineId, lotId: E1, pickedQtyPcs: l.requestedQtyPcs })
}
const pick = await L.tryCall(wh.warehouse.picklists.pick({ ...L.key(), id: w.picklistId, lines }))
K.step('picker records the held part on its row and the short part as a split row on E1', { lines: lines.map((x) => x.pickedQtyPcs), r: L.brief(pick) })
const pk = await F.pack(y2.orderId)
const billed = pk.invoice ? Number(L.q1(`select sum(qty_pcs + free_qty_pcs) pcs from invoice_lines where invoice_id = '${pk.invoice.id}'`).pcs) : null
K.step('pack + bill Y2', { r: L.brief(pk), invoice: pk.invoice?.invoice_no, billed })
const after = bal()
K.step('E1 godown after Y2 packed', after)
K.check('reserved never exceeds on hand (X2 keeps its pieces)', after.reserved <= after.on_hand, after)
const wx = await F.wave([x2.orderId])
await F.pick(wx.picklistId, wx.sheet)
const pkx = await F.pack(x2.orderId)
K.step('X2 picks + packs its held quantity', { r: L.brief(pkx), E1: bal() })
K.check('X2, confirmed with its full hold, packs in full', pkx.ok, L.brief(pkx))
K.ledger()
K.recon()
K.save('s4e-steal.json')
