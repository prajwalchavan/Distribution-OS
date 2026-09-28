// Phase 7 · S5 addendum (S5c) — a scheme line that the godown picks from several batches: is the scheme counted once?
// Company-funded, claimable 5 % on Sunbake Glucose 110 g for the RND intra shop; one order of 60 pcs picked FEFO across the
// small old batches; then the scheme-spend register and a Sunbake scheme claim built from the invoices.
import { readFileSync, writeFileSync } from 'node:fs'
import { begin, step, obs, expect, recon, save, L, F } from './scenario-kit.mjs'
const S5 = JSON.parse(readFileSync(`${L.EV}s5-context.json`, 'utf8'))
const owner = await L.as('owner')
const acc = await L.as('accountant')
const V = '40163e3b-6b81-78a0-bb58-369c22235acc' // Sunbake Glucose 110 g
const BRAND = 'a4ebffdb-e802-75e9-9614-d605563a9e65' // Sunbake
const SUPPLIER = '034767fe-b850-7c89-b0e8-89a93c6be516' // Shree Sai Marketing (Sunbake super-stockist)
const shop = S5.shops.IN

begin('S5c', 'A company-funded 5 % scheme line picked from several batches: scheme spend and the brand claim')
const sm = L.mk()
const sc = await L.tryCall(owner.pricing.schemes.upsert({ ...sm, name: 'QA P7 Sunbake Glucose 110g 5% (company, claimable)', brandId: BRAND, scope: { variantIds: [V] }, triggerKind: 'qty', triggerMin: 1, triggerUnit: 'pcs', rewardKind: 'line_pct', rewardValue: 500, applicability: { retailerIds: [shop.id] }, validFrom: F.today(), validTo: '2026-12-31', stackable: true, fundingSource: 'company', claimable: true, claimWindowDays: 30, active: true }))
step('scheme', sc.ok ? 'ok' : `${sc.status} ${sc.message}`)
const o = await F.placeOrder(shop.id, [{ variantId: V, qty: 60 }])
if (o.submitted.value?.item?.state !== 'confirmed') await F.approveAll(o.orderId)
const orderLine = L.q1(`select id, qty_pcs, rate_paise, discount_paise, applied_rules from sales_order_lines where order_id = '${o.orderId}'`)
step('order line as priced', orderLine)
const pp = await F.pickAndPack([o.orderId])
const inv = pp.invoices[0]
const lines = L.q(`select il.line_no, il.batch_no, il.qty_pcs, il.discount_paise, il.applied_rules from invoice_lines il where il.invoice_id = '${inv.invoiceId}' order by il.line_no`)
step(`bill ${inv.invoiceNo} lines (one per batch)`, lines.map((l) => ({ batch: l.batch_no, qty: l.qty_pcs, discount: l.discount_paise, ruleAmount: (l.applied_rules ?? []).find((r) => r.ruleId === sm.id)?.amountPaise })))
const given = lines.reduce((s, l) => s + l.discount_paise, 0)
const recorded = lines.reduce((s, l) => s + ((l.applied_rules ?? []).find((r) => r.ruleId === sm.id)?.amountPaise ?? 0), 0)
step('scheme money actually given on the bill vs Σ applied_rules amounts over its lines', { given, recorded, lines: lines.length })
expect('the scheme is recorded once: Σ rule amounts over the bill = the discount given', recorded === given, `given ₹${given / 100}, recorded ₹${recorded / 100} (${lines.length} batch lines)`)

const reg = await L.tryCall(owner.reporting.registers.schemeSpend({ from: F.today(), to: F.today(), schemeId: sm.id }))
writeFileSync(`${L.EV}s5c-scheme-spend.json`, JSON.stringify(reg, null, 2))
const regRow = reg.ok ? (reg.value.items ?? reg.value.rows ?? [])[0] : null
step('scheme-spend register for this scheme (as served)', reg.ok ? regRow ?? reg.value : `${reg.status} ${reg.message}`)

// the brand claim
const pol = await L.tryCall(owner.claims.policies.upsert({ ...L.mk(), brandId: BRAND, claimSupplierId: SUPPLIER, claimPeriodKind: 'monthly', damageClaimable: false, expiryClaimable: false }))
step('Sunbake claim policy', pol.ok ? 'ok' : `${pol.status} ${pol.message}`)
const cm = L.mk()
const claim = await L.tryCall(owner.claims.open({ ...cm, supplierId: SUPPLIER, brandId: BRAND, kind: 'scheme', periodFrom: F.today(), periodTo: F.today(), note: 'QA p7 split-batch scheme' }))
step('claim opened', claim.ok ? 'ok' : `${claim.status} ${claim.message}`)
const built = await L.tryCall(owner.claims.build({ ...L.key(), id: cm.id, sources: ['invoice'] }))
step('claim built', built.ok ? JSON.stringify(built.value).slice(0, 400) : `${built.status} ${built.message}`)
const cl = await L.tryCall(owner.claims.lines.list({ id: cm.id, limit: 200 }))
const mine = cl.ok ? (cl.value.items ?? []).filter((x) => JSON.stringify(x).includes(inv.invoiceNo)) : []
writeFileSync(`${L.EV}s5c-claim-lines.json`, JSON.stringify(cl.ok ? cl.value : cl, null, 2))
const claimed = mine.reduce((s, x) => s + (x.amountPaise ?? x.claimAmountPaise ?? 0), 0)
step(`claim lines for ${inv.invoiceNo}`, { count: mine.length, claimed, sample: mine.slice(0, 2) })
expect('the brand is claimed once for the scheme money given', claimed === given, `given ₹${given / 100}, claimed ₹${claimed / 100}`)
recon('S5c-scheme-split')
save('results-s5.json')
writeFileSync(`${L.EV}s5c-context.json`, JSON.stringify({ scheme: sm.id, order: o.orderId, invoice: inv, claim: cm.id }, null, 2))
