// The first probe's order stopped at picking; the desk cancels it (DOS-138) so it holds no stock.
import * as L from './lib.mjs'
L.wireTo('probe1-cleanup')
const mgr = await L.as('manager')
const o = L.q1(`select id, order_no, state::text from sales_orders where order_no = 'SO-0879' and tenant_id = '${L.T}'`)
const r = await L.tryCall(mgr.orders.cancel({ ...L.key(), id: o.id, reason: 'QA p7 probe stopped at picking' }))
console.log(o.order_no, o.state, '→', r.ok ? 'cancelled' : `${r.status} ${r.message}`)
