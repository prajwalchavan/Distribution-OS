// S9 — stock reports against SQL at the same moment (no write in between): owner home stock at cost, the stock-value
// register, stock by item and batch, the godown's live stock list, the expiring-soon list, the rep's availability.
import { readFileSync, writeFileSync } from 'node:fs'
import * as K from './kit.mjs'
const { L } = K
const FX = JSON.parse(readFileSync(`${L.EV}fixture.json`, 'utf8'))
const owner = await L.as('owner')
const wh = await L.as('wh')
const rep = await L.as('rep')
const T = `'${L.T}'`
const today = L.todayIst()
const COST = `with lot_cost as (select distinct on (lot_id) lot_id, case when landed_cost_paise > 0 then landed_cost_paise else purchase_rate_paise end unit_cost from tenant_product_costs where tenant_id = ${T} and lot_id is not null order by lot_id, effective_from desc),
  cost as (select distinct on (variant_id) variant_id, case when landed_cost_paise > 0 then landed_cost_paise else purchase_rate_paise end unit_cost from tenant_product_costs where tenant_id = ${T} order by variant_id, (lot_id is null) desc, effective_from desc)`
async function all(fn) {
  const items = []
  let cursor
  for (let i = 0; i < 200; i++) {
    const page = await fn(cursor)
    items.push(...page.items)
    if (!page.nextCursor) break
    cursor = page.nextCursor
  }
  return items
}

K.begin('S9', 'stock reports = SQL at the same moment')
// ---- API reads
const dash = await L.must(owner.reporting.dashboard.owner({}), 'dashboard')
const reg = await L.must(owner.reporting.registers.stockValue({ nearExpiryDays: 90, limit: 200 }), 'stockValue')
const byItem = await all((cursor) => owner.inventory.stock.balances({ q: 'P10-', sort: 'item', limit: 200, ...(cursor ? { cursor } : {}) }))
const godownList = await all((cursor) => wh.inventory.stock.balances({ locationId: L.GODOWN, nonZero: true, sort: 'item', limit: 500, ...(cursor ? { cursor } : {}) }))
const nearExp = await all((cursor) => owner.inventory.stock.balances({ nearExpiryOnly: true, limit: 500, ...(cursor ? { cursor } : {}) }))
const avail = await rep.inventory.stock.availability({ limit: 500 })
// ---- SQL at the same moment
const sqlAll = L.q1(`${COST} select coalesce(sum(b.on_hand * coalesce(lc.unit_cost, c.unit_cost, 0)), 0)::bigint value_pos,
  coalesce(sum(b.on_hand), 0)::bigint pcs_pos,
  (select coalesce(sum(b2.on_hand), 0) from stock_balances b2 where b2.tenant_id = ${T} and b2.on_hand < 0)::bigint pcs_negative,
  (select coalesce(sum(b2.on_hand * coalesce(lc2.unit_cost, c2.unit_cost, 0)), 0) from stock_balances b2 join stock_lots l2 on l2.id = b2.lot_id left join lot_cost lc2 on lc2.lot_id = b2.lot_id left join cost c2 on c2.variant_id = l2.variant_id where b2.tenant_id = ${T} and b2.on_hand < 0)::bigint value_negative,
  coalesce(sum(case when lo.expiry_date is not null and lo.expiry_date <= '${L.addDays(today, 90)}' then b.on_hand * coalesce(lc.unit_cost, c.unit_cost, 0) else 0 end), 0)::bigint near90_value,
  coalesce(sum(case when lo.expiry_date is not null and lo.expiry_date < '${today}' then b.on_hand * coalesce(lc.unit_cost, c.unit_cost, 0) else 0 end), 0)::bigint expired_value,
  coalesce(sum(case when loc.kind = 'damaged' then b.on_hand * coalesce(lc.unit_cost, c.unit_cost, 0) else 0 end), 0)::bigint damaged_value
  from stock_balances b join stock_lots lo on lo.id = b.lot_id join locations loc on loc.id = b.location_id left join lot_cost lc on lc.lot_id = b.lot_id left join cost c on c.variant_id = lo.variant_id
  where b.tenant_id = ${T} and b.on_hand > 0`)
const summary = L.q1(`select as_of, stock_value_paise, near_expiry_value_paise from owner_summary where tenant_id = ${T}`) ?? L.q1(`select * from daily_owner_stats where tenant_id = ${T} and day = '${today}'`)
const sqlByItem = L.q(`select b.lot_id, b.location_id, b.on_hand, b.reserved from stock_balances b join stock_lots l on l.id = b.lot_id where b.tenant_id = ${T} and l.batch_no ilike '%P10-%' order by 1, 2`)
const sqlGodown = L.q1(`select count(*) n, coalesce(sum(on_hand), 0) pcs, coalesce(sum(reserved), 0) reserved from stock_balances where tenant_id = ${T} and location_id = '${L.GODOWN}' and on_hand <> 0`)
const sqlNear = L.q(`select b.lot_id, b.location_id, b.on_hand, l.expiry_date, loc.kind::text kind from stock_balances b join stock_lots l on l.id = b.lot_id join locations loc on loc.id = b.location_id where b.tenant_id = ${T} and l.expiry_date is not null and l.expiry_date <= '${L.addDays(today, 60)}' order by 1, 2`)
const sqlAvail = L.q(`select variant_id, sum(available)::int available from sellable_stock where tenant_id = ${T} and location_id = '${L.GODOWN}' group by 1 order by 1`)

// ---- compare
const regTotal = reg.totals ?? reg.total ?? null
K.step('owner home (dashboard.owner)', { stockValuePaise: dash.stockValuePaise, nearExpiryValuePaise: dash.nearExpiryValuePaise, asOf: dash.asOf })
K.step('stock-value register totals', regTotal)
K.step('SQL now', sqlAll)
K.check('stock-value register total = SQL (positive balances × lot cost)', regTotal && Number(regTotal.valuePaise) === Number(sqlAll.value_pos) && Number(regTotal.onHandPcs) === Number(sqlAll.pcs_pos), { register: regTotal, sql: { value: sqlAll.value_pos, pcs: sqlAll.pcs_pos } })
K.check('owner home stock at cost = SQL now', Number(dash.stockValuePaise) === Number(sqlAll.value_pos), { home: dash.stockValuePaise, sql: sqlAll.value_pos, diff: Number(dash.stockValuePaise) - Number(sqlAll.value_pos), asOf: dash.asOf })
K.check('owner home near-expiry (90 d) = SQL now', Number(dash.nearExpiryValuePaise) === Number(sqlAll.near90_value), { home: dash.nearExpiryValuePaise, sql: sqlAll.near90_value })
K.step('stock at cost includes the damaged bin and expired batches at full cost; negative balances are left out', { damaged_value: sqlAll.damaged_value, expired_value: sqlAll.expired_value, pcs_negative: sqlAll.pcs_negative, value_negative: sqlAll.value_negative })
// by item and batch
const apiItem = new Map(byItem.map((r) => [`${r.lotId}:${r.locationId}`, `${r.onHand}/${r.reserved}`]))
const sqlItem = new Map(sqlByItem.map((r) => [`${r.lot_id}:${r.location_id}`, `${r.on_hand}/${r.reserved}`]))
const itemDiff = [...new Set([...apiItem.keys(), ...sqlItem.keys()])].filter((k) => apiItem.get(k) !== sqlItem.get(k)).map((k) => ({ k, api: apiItem.get(k) ?? null, sql: sqlItem.get(k) ?? null }))
K.check('stock by item and batch (owner, q=P10-, sort=item) = SQL, every row', itemDiff.length === 0, { rows: byItem.length, sqlRows: sqlByItem.length, differences: itemDiff.slice(0, 10) })
// godown list
const apiG = { n: godownList.length, pcs: godownList.reduce((n, r) => n + r.onHand, 0), reserved: godownList.reduce((n, r) => n + r.reserved, 0) }
K.check('godown stock list (warehouse login, nonZero, all pages) = SQL', apiG.n === Number(sqlGodown.n) && apiG.pcs === Number(sqlGodown.pcs) && apiG.reserved === Number(sqlGodown.reserved), { api: apiG, sql: sqlGodown })
// expiring soon
const apiNear = new Set(nearExp.map((r) => `${r.lotId}:${r.locationId}`))
const sqlNearSet = new Set(sqlNear.map((r) => `${r.lot_id}:${r.location_id}`))
const nearDiff = [...new Set([...apiNear, ...sqlNearSet])].filter((k) => apiNear.has(k) !== sqlNearSet.has(k))
K.check('expiring-soon list (nearExpiryOnly, 60 d) = SQL set', nearDiff.length === 0, { api: apiNear.size, sql: sqlNearSet.size, differences: nearDiff.slice(0, 10) })
const nearZero = nearExp.filter((r) => r.onHand === 0).length
const nearExpired = nearExp.filter((r) => r.expiryDate && r.expiryDate < today)
const nearKinds = [...new Set(sqlNear.filter((r) => r.on_hand !== 0).map((r) => r.kind))]
K.step('what the expiring-soon list holds', { rows: nearExp.length, withZeroOnHand: nearZero, alreadyExpiredRows: nearExpired.length, alreadyExpiredPcs: nearExpired.reduce((n, r) => n + r.onHand, 0), kindsWithStock: nearKinds, ourExpiredBatch: nearExp.filter((r) => r.lotId === FX.lots['P10-B-EXP']).map((r) => ({ loc: r.locationId, onHand: r.onHand, expiry: r.expiryDate })) })
// availability
const apiA = new Map(avail.items.map((r) => [r.variantId, r.available]))
const sqlA = new Map(sqlAvail.map((r) => [r.variant_id, r.available]))
const aDiff = [...new Set([...apiA.keys(), ...sqlA.keys()])].filter((k) => apiA.get(k) !== sqlA.get(k))
K.check('rep availability (godown ATP per item) = SQL sellable_stock at the godown', aDiff.length === 0, { items: apiA.size, differences: aDiff.slice(0, 5) })
const expiredInAvail = L.q1(`select coalesce(sum(s.available), 0) pcs from sellable_stock s where s.tenant_id = ${T} and s.location_id = '${L.GODOWN}' and s.expiry_date < '${today}'`)
K.step('pieces of already-expired batches counted in the rep\'s availability (godown)', expiredInAvail)
writeFileSync(`${L.EV}s9-reports-snapshot.json`, JSON.stringify({ at: new Date().toISOString(), dash: { stockValuePaise: dash.stockValuePaise, nearExpiryValuePaise: dash.nearExpiryValuePaise, asOf: dash.asOf }, register: regTotal, sql: sqlAll, summaryRow: summary ?? null, godown: { api: apiG, sql: sqlGodown }, itemDiff, nearDiff, aDiff }, null, 1))
K.recon()
K.save('s9-reports.json')
