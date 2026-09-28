// S5b re-check of the scheme arithmetic per ORDER line (invoice lines of one order line grouped back together, because
// a batch split copies the order line's applied_rules onto every batch line — DOS-322).
import { readFileSync, writeFileSync } from 'node:fs'
import * as L from './lib.mjs'
const C = JSON.parse(readFileSync(`${L.EV}s5b-context.json`, 'utf8'))
const half = (x) => (x < 0 ? -Math.round(-x) : Math.round(x))
const pct = (a, b) => half((a * b) / 10000)
const V = { marie: '3cb5e1c4-c6b4-70ec-9af7-17287907a43a', soap: '8549cf4f-2489-772a-9691-7eeda70e8bdc', glucose: 'af45e021-a167-7d3f-a8f0-60ab037214cb' }
const dist = { lineSchemes: {}, orderPctTotal: {}, discountSplit: {} }
const bump = (m, k) => (m[k] = (m[k] ?? 0) + 1)
const detail = []
for (const b of C.bills) {
  const ol = L.q(`select sl.id, sl.variant_id, sl.qty_pcs, sl.free_qty_pcs, sl.rate_paise, sl.discount_paise, sl.applied_rules,
                         (select coalesce(sum(il.discount_paise), 0) from invoice_lines il where il.order_line_id = sl.id and il.invoice_id = '${b.invoiceId}') inv_disc,
                         (select coalesce(sum(il.qty_pcs), 0) from invoice_lines il where il.order_line_id = sl.id and il.invoice_id = '${b.invoiceId}') inv_qty
                    from sales_order_lines sl join invoices i on i.order_id = sl.order_id where i.id = '${b.invoiceId}' order by sl.line_no`)
  let basis = 0, orderPct = 0
  for (const l of ol) {
    const rules = l.applied_rules ?? []
    const amt = (k) => rules.filter((r) => r.rewardKind === k).reduce((s, r) => s + (r.amountPaise ?? 0), 0)
    const gross = l.rate_paise * l.qty_pcs
    let ok = true
    if (l.variant_id === V.marie && amt('line_pct') !== pct(gross, 750)) ok = false
    if (l.variant_id === V.soap && amt('per_unit_amount') !== (l.qty_pcs >= 3 ? 37 * l.qty_pcs : 0)) ok = false
    if (l.variant_id === V.glucose && l.free_qty_pcs !== (l.qty_pcs >= 7 ? Math.floor(l.qty_pcs / 7) : 0)) ok = false
    if (l.discount_paise !== amt('line_pct') + amt('per_unit_amount') + amt('order_pct')) ok = false
    bump(dist.lineSchemes, ok ? 'ok' : 'off')
    if (!ok) detail.push({ bill: b.invoiceNo, variant: l.variant_id, qty: l.qty_pcs, free: l.free_qty_pcs, gross, disc: l.discount_paise, rules })
    bump(dist.discountSplit, Number(l.inv_disc) === l.discount_paise && Number(l.inv_qty) === l.qty_pcs ? 'bill = order line' : `bill ${l.inv_disc} vs order ${l.discount_paise}`)
    basis += gross - amt('line_pct') - amt('per_unit_amount')
    orderPct += amt('order_pct')
  }
  const expect = basis >= 50000 ? pct(basis, 333) : 0
  bump(dist.orderPctTotal, orderPct - expect)
  if (orderPct !== expect) detail.push({ bill: b.invoiceNo, basis, orderPct, expect })
}
console.log(JSON.stringify(dist))
console.log(JSON.stringify(detail.slice(0, 6)))
writeFileSync(`${L.EV}s5d-scheme-check.json`, JSON.stringify({ dist, detail }, null, 2))
