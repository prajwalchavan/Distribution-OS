// Phase 8 — one summary over the three order runs (all, T0 rupee-boundary, L09 mix): distribution per check, coverage per area.
import { readFileSync, writeFileSync } from 'node:fs'
import { EV } from './lib.mjs'
const runs = ['orders-all', 'orders-T0', 'orders-L09'].map((f) => JSON.parse(readFileSync(`${EV}${f}.json`, 'utf8')))
const dist = {}
const add = (k, d, n = 1) => {
  dist[k] ??= {}
  dist[k][d] = (dist[k][d] ?? 0) + n
}
for (const r of runs)
  for (const [k, v] of Object.entries(r.distribution)) {
    if (k === 'journal SALES = −taxable') continue // first-run check, replaced below (SALES is posted gross, discount on DISCOUNTS)
    for (const [d, n] of Object.entries(v)) add(k, d, n)
  }
const results = runs.flatMap((r) => r.results)
for (const r of runs[0].results) if (r.journal) add('journal SALES + DISCOUNTS = −taxable', -(r.journal.SALES ?? 0) - (r.journal.DISCOUNTS ?? 0) - r.invoice.taxable)
const areas = {}
for (const r of results) {
  const a = (areas[r.area] ??= { cases: 0, invoiced: 0, oracleVsBillTotalDiffs: 0, orderVsBillTotalDiffs: 0, orderVsBillTaxDiffs: 0, ids: [] })
  a.cases += 1
  a.ids.push(r.id)
  if (r.invoice?.total !== undefined) {
    a.invoiced += 1
    if (r.invoice.total !== r.oracleAfterGates) a.oracleVsBillTotalDiffs += 1
    if (r.invoice.total !== r.order.total) a.orderVsBillTotalDiffs += 1
    if (r.invoice.cgst + r.invoice.sgst + r.invoice.igst + r.invoice.cess !== r.order.tax) a.orderVsBillTaxDiffs += 1
  }
}
const out = { orders: results.length, invoiced: results.filter((r) => r.invoice?.total !== undefined).length, areas, distribution: dist }
writeFileSync(`${EV}summary.json`, JSON.stringify(out, null, 1))
console.log(JSON.stringify(areas, (k, v) => (k === 'ids' ? v.join(' ') : v), 1))
for (const [k, v] of Object.entries(dist)) console.log(`${Object.keys(v).every((d) => d === '0') ? '  ok ' : ' DIFF'} ${k}: ${JSON.stringify(v)}`)
