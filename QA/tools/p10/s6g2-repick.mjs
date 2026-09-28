// S6g2 — edit, after its order was packed, the pick row that actually carried the pieces (the split row F.pick wrote).
import * as K from './kit.mjs'
const { L } = K
const wh = await L.as('wh')
K.begin('S6g2', 're-pick a packed order\'s recorded pick row while the wave is still open')
const bill = L.q1(`select id, order_id from invoices where invoice_no = 'INV/9019'`)
const row = L.q1(`select pl.id, pl.picklist_id, pl.order_line_id, pl.lot_id, pl.picked_qty_pcs, p.status::text sheet from pick_lines pl join picklists p on p.id = pl.picklist_id where pl.order_id = '${bill.order_id}' and pl.picked_qty_pcs > 0`)
K.step('the row that carried order A\'s pieces', row)
const r = await L.tryCall(wh.warehouse.picklists.pick({ ...L.key(), id: row.picklist_id, lines: [{ id: row.id, orderLineId: row.order_line_id, lotId: row.lot_id, pickedQtyPcs: 5, shortReason: 'QA p10 edit after pack' }] }))
K.step('re-pick it down to 5', L.brief(r))
const after = { pickRow: L.q1(`select picked_qty_pcs from pick_lines where id = '${row.id}'`).picked_qty_pcs, billed: L.q1(`select sum(qty_pcs) pcs from invoice_lines where invoice_id = '${bill.id}'`).pcs, orderLinePicked: L.q1(`select picked_qty_pcs from sales_order_lines where id = '${row.order_line_id}'`).picked_qty_pcs, moved: L.q1(`select -sum(qty_delta) n from stock_ledger l join locations loc on loc.id = l.location_id where l.ref_id = '${bill.order_id}' and l.ref_type = 'pack' and loc.kind = 'warehouse'`).n }
K.step('after', after)
K.check('a packed order\'s pick cannot be edited (or, if it can, bill and stock still agree with it)', !r.ok || (after.pickRow === after.billed), after)
K.save('s6g2-repick.json')
