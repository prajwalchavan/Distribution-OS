// S4 first attempt stopped at picking (the driver asked for free pieces twice); the desk cancels those orders (DOS-138).
import * as L from './lib.mjs'
L.wireTo('S4-cleanup')
const mgr = await L.as('manager')
const rows = L.q(`select o.id, o.order_no, o.state::text from sales_orders o join retailers r on r.id = o.retailer_id where r.name like 'QA P7 RT%' and o.state = 'picking'`)
for (const o of rows) {
  const r = await L.tryCall(mgr.orders.cancel({ ...L.key(), id: o.id, reason: 'QA p7: test run stopped at picking' }))
  console.log(o.order_no, r.ok ? 'cancelled' : `${r.status} ${r.message}`)
}
console.log(L.q(`select state::text, count(*) from sales_orders o join retailers r on r.id = o.retailer_id where r.name like 'QA P7 RT%' group by 1`))
console.log(L.q(`select status::text, count(*) from picklists where id in (select distinct picklist_id from pick_lines pl join sales_order_lines sl on sl.id = pl.order_line_id join sales_orders o on o.id = sl.order_id join retailers r on r.id = o.retailer_id where r.name like 'QA P7 RT%') group by 1`))
