// Phase 8 — can the owner set a scheme's stacking priority? (UpsertSchemeInput has no `priority` field.)
import { writeFileSync } from 'node:fs'
import * as L from './lib.mjs'
L.wireTo('priority-probe')
const today = L.today()
const shop = await L.createShop('QA P8 priority probe', { tier: 'B' })
const V = '270b32e6-1ea8-78b4-9530-1a2794812922' // Garam Masala 100 g, 5 %
const base = { scope: { variantIds: [V] }, triggerKind: 'qty', triggerMin: 1, triggerUnit: 'pcs', applicability: { retailerIds: [shop.id] }, validFrom: today, validTo: L.addDays(today, 30), fundingSource: 'distributor' }
// created first: ₹5 off every piece; created second: 10 % — the owner wants the 10 % FIRST and says so with priority
const a = L.mk()
const b = L.mk()
const ra = await L.raw('owner', 'POST', '/pricing/schemes', { ...a, name: 'QA P8 prio flat ₹5 a piece (priority 50)', ...base, rewardKind: 'per_unit_amount', rewardValue: 500, priority: 50 })
const rb = await L.raw('owner', 'POST', '/pricing/schemes', { ...b, name: 'QA P8 prio 10 % (priority 1)', ...base, rewardKind: 'line_pct', rewardValue: 1000, priority: 1 })
const stored = L.q(`select name, priority, version from schemes where id in ('${a.id}','${b.id}') order by created_at`)
const rep = await L.as('rep')
const q = await L.must(rep.pricing.quote({ retailerId: shop.id, lines: [{ lineId: 'x', variantId: V, qtyPcs: 48 }] }))
const l = q.lines[0]
const gross = l.grossPaise
const flatFirst = 48 * 500 + Math.round((gross - 48 * 500) * 0.1)
const pctFirst = Math.round(gross * 0.1) + 48 * 500
const seeded = L.q(`select priority, count(*)::int n from schemes where tenant_id='${L.T}' group by 1 order by 1`)
const out = { upsertStatus: [ra.status, rb.status], replyPriority: [ra.body?.item?.priority ?? 'absent from reply', rb.body?.item?.priority ?? 'absent from reply'], stored, quote: { gross, discount: l.discountPaise, rules: l.appliedRules.map((r) => `${r.rewardKind}:${r.amountPaise}`) }, ifFlatFirst: flatFirst, ifPctFirst: pctFirst, priorityHistogram: seeded }
writeFileSync(`${L.EV}priority-probe.json`, JSON.stringify(out, null, 1))
console.log(JSON.stringify(out, null, 1))
