// Phase 8 — does a lot-split bill claim a company-funded scheme once? (applied_rules are copied whole to every lot line)
import { writeFileSync } from 'node:fs'
import * as L from './lib.mjs'
L.wireTo('claim-probe')
const owner = await L.as('owner')
const today = L.today()
const GODAVARI = '779361b4-0399-7c3c-abde-7675e66c031c'
const SUPPLIER = 'f1628129-b97c-78f4-9493-252df802df40'
const c = L.mk()
const open = await L.tryCall(owner.claims.open({ ...c, supplierId: SUPPLIER, brandId: GODAVARI, kind: 'scheme', periodFrom: today, periodTo: today, note: 'QA p8 lot-split claim probe' }))
const build = await L.tryCall(owner.claims.build({ ...L.key(), id: c.id }))
const lines = L.q(`select cl.source_id, cl.qty_pcs, cl.amount_paise, cl.status::text, cl.detail->>'invoiceNo' inv from claim_lines cl where cl.claim_id='${c.id}' order by 5, 1`)
// what the shop was actually given on those bills, by invoice, from the bill lines themselves
const given = L.q(`select i.invoice_no inv, count(*)::int lot_lines, sum(il.discount_paise)::bigint given
                     from invoice_lines il join invoices i on i.id=il.invoice_id join product_variants v on v.id=il.variant_id join products p on p.id=v.product_id
                    where i.tenant_id='${L.T}' and i.invoice_date='${today}' and p.brand_id='${GODAVARI}' and il.discount_paise > 0 and i.state not in ('draft','cancelled') group by 1 order by 1`)
const byInv = {}
for (const l of lines) (byInv[l.inv] ??= { claimLines: 0, claimed: 0 }), (byInv[l.inv].claimLines += 1), (byInv[l.inv].claimed += Number(l.amount_paise))
const cmp = given.map((g) => ({ ...g, ...(byInv[g.inv] ?? { claimLines: 0, claimed: 0 }), over: (byInv[g.inv]?.claimed ?? 0) - Number(g.given) }))
const out = { open: open.ok ? 'ok' : `${open.status} ${open.message}`, build: build.ok ? { added: build.value.added, skipped: build.value.skipped, total: build.value.item?.claimedPaise ?? build.value.item?.amountPaise ?? null } : `${build.status} ${build.message} ${JSON.stringify(build.data ?? '').slice(0, 300)}`, compare: cmp }
writeFileSync(`${L.EV}claim-probe.json`, JSON.stringify(out, null, 1))
console.log(JSON.stringify(out, null, 1))
