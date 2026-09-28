// Phase 8 — the owner's scheme-spend register for today against the bills (DOS-185: a gift counted once).
import { writeFileSync } from 'node:fs'
import * as L from './lib.mjs'
L.wireTo(null)
const owner = await L.as('owner')
const today = L.today()
const r = await L.tryCall(owner.reporting.registers.schemeSpend({ from: today, to: today }))
const mine = L.q(`select s.id, s.name from schemes s where s.tenant_id='${L.T}' and s.name like 'QA P8 F0%'`)
const bills = L.q(`select r->>'ruleId' rule, sum(il.free_qty_pcs)::int free_on_lines, sum(coalesce((r->>'freeQty')::int,0))::int free_in_rules, sum(coalesce((r->>'amountPaise')::int,0))::int amount
                    from invoice_lines il join invoices i on i.id=il.invoice_id, jsonb_array_elements(il.applied_rules) r
                   where i.tenant_id='${L.T}' and i.invoice_date='${today}' and i.state not in ('draft','cancelled') and r->>'ruleId' in (${L.inList(mine.map((m) => m.id))}) group by 1`)
const rows = r.ok ? (r.value.items ?? r.value.rows ?? []) : []
const out = mine.map((m) => ({ scheme: m.name, bills: bills.find((b) => b.rule === m.id) ?? null, register: rows.filter((x) => JSON.stringify(x).includes(m.id)).map((x) => x) }))
writeFileSync(`${L.EV}scheme-spend.json`, JSON.stringify({ status: r.ok ? 200 : `${r.status} ${r.message}`, keys: r.ok ? Object.keys(r.value) : null, sampleRow: rows[0] ?? null, out }, null, 1))
console.log(r.ok ? Object.keys(r.value) : `${r.status} ${r.message}`, JSON.stringify(rows[0] ?? null).slice(0, 400))
for (const o of out) console.log(JSON.stringify(o).slice(0, 500))
