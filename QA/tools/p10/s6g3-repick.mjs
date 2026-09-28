// S6g3 — two orders on one wave; pack order A only; then edit A's recorded pick row while the sheet is still live.
import { readFileSync } from 'node:fs'
import * as K from './kit.mjs'
const { L, F } = K
const FX = JSON.parse(readFileSync(`${L.EV}fixture.json`, 'utf8'))
const wh = await L.as('wh')
K.begin('S6g3', 'edit a packed order\'s pick while the other order on the wave is still being picked')
const shop = await F.createShop(`QA P10 Repick2 ${Date.now() % 100000}`)
const a = await F.placeOrder(shop.id, [{ variantId: FX.V.G, qty: 12 }])
const b = await F.placeOrder(shop.id, [{ variantId: FX.V.G, qty: 12 }])
await F.ensureConfirmed(a.orderId)
await F.ensureConfirmed(b.orderId)
const w = await F.wave([a.orderId, b.orderId])
const picks = w.sheet.lines.map((l) => ({ id: l.id, orderLineId: l.orderLineId, lotId: l.suggestedLotId ?? l.lotId, pickedQtyPcs: l.requestedQtyPcs }))
K.step('pick both on the wave rows', L.brief(await L.tryCall(wh.warehouse.picklists.pick({ ...L.key(), id: w.picklistId, lines: picks }))))
const pa = await F.pack(a.orderId)
K.step('pack A only', { r: L.brief(pa), bill: pa.invoice?.invoice_no, sheet: L.q1(`select status::text from picklists where id = '${w.picklistId}'`).status })
const rowA = picks.find((p) => F.orderLines(a.orderId).some((l) => l.id === p.orderLineId))
const r = await L.tryCall(wh.warehouse.picklists.pick({ ...L.key(), id: w.picklistId, lines: [{ ...rowA, pickedQtyPcs: 5, shortReason: 'QA p10 edit after pack' }] }))
K.step('edit packed order A\'s pick row down to 5', L.brief(r))
const after = { pickRow: L.q1(`select picked_qty_pcs from pick_lines where id = '${rowA.id}'`).picked_qty_pcs, billed: Number(L.q1(`select sum(qty_pcs) pcs from invoice_lines where invoice_id = '${pa.invoice.id}'`).pcs), orderLinePicked: L.q1(`select picked_qty_pcs from sales_order_lines where id = '${rowA.orderLineId}'`).picked_qty_pcs, moved: Number(L.q1(`select -sum(qty_delta) n from stock_ledger l join locations loc on loc.id = l.location_id where l.ref_id = '${a.orderId}' and l.ref_type = 'pack' and loc.kind = 'warehouse'`).n) }
K.step('after', after)
K.check('a packed order\'s pick cannot be edited (or bill, stock and pick still agree)', !r.ok || after.pickRow === after.billed, after)
const fill = L.q1(`select sum(requested_qty_pcs) requested, sum(picked_qty_pcs) picked from pick_lines where order_id = '${a.orderId}'`)
K.step('pick rows of A now (what the fill-rate register reads)', fill)
K.step('pack B', L.brief(await F.pack(b.orderId)))
K.recon()
K.save('s6g3-repick.json')
