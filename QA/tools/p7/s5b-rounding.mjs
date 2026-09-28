// Phase 7 · S5 — rounding: 66 bills with awkward shop rates, odd quantities, schemes (free goods, %, per-unit, order %),
// intra-state (CGST+SGST) and inter-state (IGST). Compared to the paisa: order total, invoice total, tax lines, round-off,
// an independent recomputation, the printed PDF, the receipt, the journal, the sales register and the GST summary.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import zlib from 'node:zlib'
import { pathToFileURL } from 'node:url'
import { begin, step, obs, expect, recon, save, L, F } from './scenario-kit.mjs'

const { isValidGstin } = await import(pathToFileURL(`${L.ROOT}backend/libs/domain/dist/index.js`).href)
const owner = await L.as('owner')
const acc = await L.as('accountant')
const gstin = (state, pan) => {
  for (const c of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (isValidGstin(`${state}${pan}1Z${c}`)) return `${state}${pan}1Z${c}`
  throw new Error('no checksum')
}

// variants: 5 %, 12 %, 18 %, 28 % + 12 % cess
const P = [
  { v: '270b32e6-1ea8-78b4-9530-1a2794812922', n: 'Garam Masala 100g 5%', rate: 7137 },
  { v: '58afb7ca-da10-7dec-a6c3-791732c66266', n: 'Makhana 20g 5%', rate: 1999 },
  { v: '1ce9637c-763c-73d4-be1a-98ec7ff5ae36', n: 'Aloo Bhujia 200g 12%', rate: 3833 },
  { v: '4dd6ed7f-f57b-7119-bf78-900af511f02f', n: 'Table Butter 12%', rate: 4717 },
  { v: 'af45e021-a167-7d3f-a8f0-60ab037214cb', n: 'Glucose 55g 18%', rate: 777 },
  { v: '8549cf4f-2489-772a-9691-7eeda70e8bdc', n: 'Sandal Soap 18%', rate: 2911 },
  { v: '3cb5e1c4-c6b4-70ec-9af7-17287907a43a', n: 'Marie 150g 18%', rate: 2337 },
  { v: '3db7acf2-cffb-7ad1-8e35-42fa3cd608b5', n: 'Butter Cookies 75g 18%', rate: 1783 },
  { v: 'bd18c9a9-4520-79fe-817f-2aa434cf0745', n: 'Tooth Brush 18%', rate: 1501 },
  { v: 'f71bf137-50de-7182-a0d9-c83f1a613a57', n: 'Campa Cola 750 28%+12%', rate: 2263 },
  { v: '607a16c3-da8c-7f06-b5b7-619de2776557', n: 'Campa Lemon 750 28%+12%', rate: 2291 },
  { v: 'c67a8c31-c125-7d98-9010-8277027eff37', n: 'Glucose 32g 18%', rate: 433 },
]

begin('S5b-setup', 'Second rounding batch on the same three shops (their shop rates and four schemes stay): a proper random generator this time')
const S5 = JSON.parse(readFileSync(`${L.EV}s5-context.json`, 'utf8'))
const shops = S5.shops
step('shops reused', Object.fromEntries(Object.entries(shops).map(([k, s]) => [k, s.code])))
const schemeRows = L.q(`select id, name, reward_kind::text, reward_value, trigger_min from schemes where tenant_id = '${L.T}' and name like 'QA P7 RND%' and active`)
step('schemes in force', schemeRows.map((r) => `${r.name} (${r.reward_kind} ${r.reward_value})`))
// deterministic pseudo-random baskets
// mulberry32: the first batch used an LCG's low bits and drew only 3 products and one quantity (see the audit)
let seed = 0x9e3779b9
const rand = () => {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const rnd = (n) => Math.floor(rand() * n)
const plans = []
for (let i = 0; i < 66; i++) {
  const shop = ['IN', 'OUT', 'B2C'][i % 3]
  const nLines = 1 + rnd(4)
  const used = new Set()
  const lines = []
  while (lines.length < nLines) {
    const p = P[rnd(P.length)]
    if (used.has(p.v)) continue
    used.add(p.v)
    lines.push({ variantId: p.v, qty: [1, 3, 7, 11, 13, 5, 9, 17][rnd(8)] })
  }
  plans.push({ i, shop, lines })
}
const orders = []
for (const p of plans) {
  const o = await F.placeOrder(shops[p.shop].id, p.lines)
  if (!o.submitted.ok) { step(`order ${p.i} refused`, `${o.submitted.status} ${o.submitted.message}`); continue }
  if (o.submitted.value.item.state !== 'confirmed') await F.approveAll(o.orderId)
  orders.push({ ...p, orderId: o.orderId, orderTotal: o.submitted.value.item.totalPaise, orderNo: o.submitted.value.item.orderNo })
}
step(`orders placed: ${orders.length}`)
const bills = []
for (let k = 0; k < orders.length; k += 11) {
  const wave = orders.slice(k, k + 11)
  const pp = await F.pickAndPack(wave.map((o) => o.orderId))
  for (const inv of pp.invoices) bills.push({ ...wave.find((o) => o.orderId === inv.orderId), invoiceId: inv.invoiceId, invoiceNo: inv.invoiceNo, invoiceTotal: inv.totalPaise })
}
step(`bills issued: ${bills.length}`)
recon('S5b-00-billed')
save('results-s5.json')

// ---- the comparison ------------------------------------------------------------------------------------------------
begin('S5b-compare', 'Order vs bill vs independent recomputation vs PDF vs receipt vs journal vs registers, to the paisa')
const half = (x) => (x < 0 ? -Math.round(-x) : Math.round(x))
const pct = (amt, bps) => half((amt * bps) / 10000)
const rows = []
const dist = { orderVsBill: {}, recomputeTotal: {}, recomputeTax: {}, pdfTotal: {}, headerVsLines: {}, roundOff: {} }
const bump = (m, d) => (m[d] = (m[d] ?? 0) + 1)
function pdfText(key) {
  const p = `${L.ROOT}backend/.storage/${key}`
  if (!key || !existsSync(p)) return null
  const b = readFileSync(p)
  const out = []
  const re = /<<([^>]*?)\/Length (\d+)([^>]*)>>\s*stream\r?\n/g
  const s = b.toString('latin1')
  let m
  while ((m = re.exec(s))) {
    const hdr = m[1] + m[3]
    if (hdr.includes('Image')) continue
    let body = b.subarray(m.index + m[0].length, m.index + m[0].length + Number(m[2]))
    if (hdr.includes('FlateDecode')) body = zlib.inflateSync(body)
    for (const t of body.toString('latin1').matchAll(/\((.*?)(?<!\\)\)\s*Tj/g)) out.push(t[1])
  }
  return out
}
// give the worker a moment to render the last PDFs
await new Promise((r) => setTimeout(r, 70_000))
for (const b of bills) {
  const h = L.q1(`select i.invoice_no, i.total_paise, i.subtotal_paise, i.discount_paise, i.taxable_paise, i.cgst_paise, i.sgst_paise, i.igst_paise, i.cess_paise, i.round_off_paise, i.is_inter_state, i.place_of_supply_state, i.pdf_object_key from invoices i where i.id = '${b.invoiceId}'`)
  const ls = L.q(`select qty_pcs, free_qty_pcs, rate_paise, discount_paise, taxable_paise, gst_bps, cgst_paise, sgst_paise, igst_paise, cess_bps, cess_paise, line_total_paise from invoice_lines where invoice_id = '${b.invoiceId}' order by line_no`)
  // independent recomputation from rate, qty, the line's own discount and the rates
  let rTaxable = 0, rTax = 0, rCess = 0, rLines = 0
  for (const l of ls) {
    const taxable = l.rate_paise * l.qty_pcs - l.discount_paise
    const tax = h.is_inter_state ? pct(taxable, l.gst_bps) : 2 * pct(taxable, l.gst_bps / 2)
    const cess = pct(taxable, l.cess_bps)
    rTaxable += taxable
    rTax += tax
    rCess += cess
    rLines += taxable + tax + cess
  }
  const rTotal = half(rLines / 100) * 100
  const hdrTax = h.cgst_paise + h.sgst_paise + h.igst_paise
  const lineSum = ls.reduce((s, l) => s + l.line_total_paise, 0)
  const pdf = pdfText(h.pdf_object_key)
  const pdfTotalStr = pdf ? pdf[pdf.indexOf('TOTAL') + 1] : null
  const pdfTotal = pdfTotalStr ? Math.round(Number(pdfTotalStr.replace(/[^0-9.]/g, '')) * 100) : null
  const pdfRo = pdf ? pdf[pdf.indexOf('Round off') + 1] : null
  const row = {
    invoiceNo: h.invoice_no, shop: b.shop, lines: ls.length, orderTotal: b.orderTotal, invoiceTotal: h.total_paise, recomputedTotal: rTotal,
    taxable: h.taxable_paise, recomputedTaxable: rTaxable, tax: hdrTax, recomputedTax: rTax, cess: h.cess_paise, recomputedCess: rCess,
    roundOff: h.round_off_paise, lineSumPlusRo: lineSum + h.round_off_paise, pdfTotal, pdfRoundOff: pdfRo, inter: h.is_inter_state,
    cgstEqSgst: h.cgst_paise === h.sgst_paise,
  }
  // independent scheme arithmetic from applied_rules: line % and per-unit amounts, free pieces, order % allocation
  const lr = L.q(`select il.variant_id, il.qty_pcs, il.free_qty_pcs, il.rate_paise, il.discount_paise, il.applied_rules from invoice_lines il where il.invoice_id = '${b.invoiceId}' order by il.line_no`)
  let schemeBad = 0, orderPct = 0, orderBasis = 0
  for (const l of lr) {
    const rules = l.applied_rules ?? []
    const byKind = (k) => rules.filter((r) => r.rewardKind === k).reduce((s2, r) => s2 + (r.amountPaise ?? 0), 0)
    const gross = l.rate_paise * l.qty_pcs
    if (l.variant_id === P[6].v && byKind('line_pct') !== pct(gross, 750)) schemeBad++
    if (l.variant_id === P[5].v && byKind('per_unit_amount') !== (l.qty_pcs >= 3 ? 37 * l.qty_pcs : 0)) schemeBad++
    if (l.variant_id === P[4].v && l.free_qty_pcs !== (l.qty_pcs >= 7 ? Math.floor(l.qty_pcs / 7) : 0)) schemeBad++
    const lineSchemes = rules.filter((r) => r.kind === 'scheme' && r.rewardKind !== 'order_pct').reduce((s2, r) => s2 + (r.amountPaise ?? 0), 0)
    orderPct += byKind('order_pct')
    orderBasis += gross - lineSchemes
    if (l.discount_paise !== lineSchemes + byKind('order_pct')) schemeBad++
  }
  const expectOrderPct = orderBasis >= 50000 ? pct(orderBasis, 333) : 0
  row.schemeLinesBad = schemeBad
  row.orderPct = orderPct
  row.expectOrderPct = expectOrderPct
  bump(dist.schemes ??= {}, schemeBad === 0 ? 'lines ok' : `${schemeBad} line(s) off`)
  bump(dist.orderPct ??= {}, orderPct - expectOrderPct)
  rows.push(row)
  bump(dist.orderVsBill, row.invoiceTotal - row.orderTotal)
  bump(dist.recomputeTotal, row.invoiceTotal - row.recomputedTotal)
  bump(dist.recomputeTax, row.tax + row.cess - row.recomputedTax - row.recomputedCess)
  bump(dist.pdfTotal, row.pdfTotal === null ? 'no pdf' : row.pdfTotal - row.invoiceTotal)
  bump(dist.headerVsLines, row.lineSumPlusRo - row.invoiceTotal)
  bump(dist.roundOff, Math.abs(row.roundOff) <= 50 ? 'within ±50' : 'OVER 50')
}
step('distribution of differences (paise → count of bills)', dist)
step('coverage', L.q1(`select count(distinct il.variant_id) variants, count(distinct il.gst_bps || '/' || il.cess_bps) rates, count(distinct il.qty_pcs) qtys, count(*) lines, count(*) filter (where il.discount_paise > 0) discounted_lines, count(*) filter (where il.free_qty_pcs > 0) free_lines, count(distinct i.id) filter (where i.is_inter_state) inter_bills, count(distinct i.id) bills from invoice_lines il join invoices i on i.id = il.invoice_id where i.id in (${bills.map((b) => `'${b.invoiceId}'`).join(',')})`))
expect('scheme amounts (7.5 % line, ₹0.37/pc, 7+1 free) and discount = Σ rule amounts on every line', Object.keys(dist.schemes ?? {}).every((d) => d === 'lines ok'), JSON.stringify(dist.schemes))
expect('order 3.33 % on ₹500+ = 3.33 % of the order net of line schemes (paise difference → bills)', Object.keys(dist.orderPct ?? {}).every((d) => d === '0'), JSON.stringify(dist.orderPct))
expect('order total = bill total on every bill', Object.keys(dist.orderVsBill).every((d) => d === '0'), JSON.stringify(dist.orderVsBill))
expect('independent recomputation = bill total', Object.keys(dist.recomputeTotal).every((d) => d === '0'), JSON.stringify(dist.recomputeTotal))
expect('independent tax + cess = header tax + cess', Object.keys(dist.recomputeTax).every((d) => d === '0'), JSON.stringify(dist.recomputeTax))
expect('printed PDF total = bill total', Object.keys(dist.pdfTotal).every((d) => d === '0'), JSON.stringify(dist.pdfTotal))
expect('Σ lines + round-off = header total', Object.keys(dist.headerVsLines).every((d) => d === '0'), JSON.stringify(dist.headerVsLines))
expect('intra-state bills split CGST = SGST', rows.filter((r) => !r.inter).every((r) => r.cgstEqSgst))
expect('inter-state bills carry IGST only', L.q(`select count(*) n from invoices where id in (${bills.filter((b) => b.shop === 'OUT').map((b) => `'${b.invoiceId}'`).join(',')}) and (cgst_paise <> 0 or sgst_paise <> 0 or igst_paise = 0 or not is_inter_state)`)[0].n === 0)
writeFileSync(`${L.EV}s5b-rounding-rows.json`, JSON.stringify(rows, null, 2))

// ---- receipts: pay every bill exactly ---------------------------------------------------------------------------------------
begin('S5b-pay', 'Every bill paid by UPI for exactly its total at the office')
let unpaid = 0
for (const b of bills) {
  const r = await F.deskReceipt(L.q1(`select retailer_id from invoices where id = '${b.invoiceId}'`).retailer_id, 'upi', b.invoiceTotal, { reference: `UTRRND${b.invoiceNo.replace(/\D/g, '')}`, strategy: 'explicit', allocations: [{ id: L.uuidv7(), invoiceId: b.invoiceId, amountPaise: b.invoiceTotal }] })
  if (!r.ok || r.value.item.unallocatedPaise !== 0 || L.q1(`select state::text s from invoices where id = '${b.invoiceId}'`).s !== 'paid') unpaid++
}
expect('every bill paid to the paisa, nothing left on account', unpaid === 0, `${unpaid} not settled exactly`)
recon('S5b-01-paid')

// ---- registers -----------------------------------------------------------------------------------------------------------------
begin('S5b-registers', 'Sales register and GST summary for today against the documents')
const from = F.today()
const to = F.today()
const regRows = []
let cursor
do {
  const r = await L.must(owner.billing.registers.salesRegister({ from, to, limit: 200, ...(cursor ? { cursor } : {}) }), 'salesRegister')
  regRows.push(...(r.items ?? []))
  cursor = r.nextCursor ?? null
} while (cursor)
step('sales register rows today', regRows.length)
const sample = regRows[0] ?? {}
step('a register row (keys)', Object.keys(sample))
const docs = L.q(`select id, invoice_no, state::text, total_paise, taxable_paise, cgst_paise, sgst_paise, igst_paise, cess_paise from invoices where tenant_id = '${L.T}' and invoice_date = '${from}' and state <> 'draft'`)
const byNo = new Map(docs.map((d) => [d.invoice_no, d]))
const regDiff = []
for (const r of regRows) {
  const d = byNo.get(r.invoiceNo)
  if (!d) { regDiff.push(`${r.invoiceNo} in register, not in documents`); continue }
  const tot = r.totalPaise ?? r.invoiceTotalPaise
  if (tot !== d.total_paise) regDiff.push(`${r.invoiceNo} register ${tot} vs doc ${d.total_paise}`)
  if (r.taxablePaise !== undefined && r.taxablePaise !== d.taxable_paise) regDiff.push(`${r.invoiceNo} taxable ${r.taxablePaise} vs ${d.taxable_paise}`)
}
const inReg = new Set(regRows.map((r) => r.invoiceNo))
for (const d of docs) if (!inReg.has(d.invoice_no)) regDiff.push(`${d.invoice_no} (${d.state}) missing from the register`)
step('register vs documents', regDiff.length ? regDiff.slice(0, 40) : 'identical')
const gst = await L.must(owner.billing.registers.gstSummary({ from, to, groupBy: 'rate' }), 'gstSummary')
writeFileSync(`${L.EV}s5b-gst-summary.json`, JSON.stringify(gst, null, 2))
const byRate = L.q(`
  select il.gst_bps, sum(il.taxable_paise) taxable, sum(il.cgst_paise) cgst, sum(il.sgst_paise) sgst, sum(il.igst_paise) igst, sum(il.cess_paise) cess
    from invoice_lines il join invoices i on i.id = il.invoice_id
   where i.tenant_id = '${L.T}' and i.invoice_date = '${from}' and i.state not in ('draft', 'cancelled') group by 1 order by 1`)
step('GST by rate from invoice lines (today)', byRate)
step('GST summary as served (first 3000 chars)', JSON.stringify(gst).slice(0, 3000))
const hdr = L.q1(`select sum(taxable_paise) taxable, sum(cgst_paise) cgst, sum(sgst_paise) sgst, sum(igst_paise) igst, sum(cess_paise) cess, sum(total_paise) total from invoices where tenant_id = '${L.T}' and invoice_date = '${from}' and state not in ('draft', 'cancelled')`)
const lineTot = byRate.reduce((a, r) => ({ taxable: a.taxable + Number(r.taxable), cgst: a.cgst + Number(r.cgst), sgst: a.sgst + Number(r.sgst), igst: a.igst + Number(r.igst), cess: a.cess + Number(r.cess) }), { taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0 })
step('headers vs Σ lines (today)', { headers: hdr, lines: lineTot })
expect('invoice headers = Σ their lines for taxable, CGST, SGST, IGST, cess (today)', Number(hdr.taxable) === lineTot.taxable && Number(hdr.cgst) === lineTot.cgst && Number(hdr.sgst) === lineTot.sgst && Number(hdr.igst) === lineTot.igst && Number(hdr.cess) === lineTot.cess, JSON.stringify({ hdr, lineTot }))
expect('sales register = documents for today', regDiff.length === 0, `${regDiff.length} difference(s)`)
recon('S5b-02-registers')
save('results-s5.json')
writeFileSync(`${L.EV}s5b-context.json`, JSON.stringify({ shops, bills: bills.map((b) => ({ invoiceId: b.invoiceId, invoiceNo: b.invoiceNo, shop: b.shop, total: b.invoiceTotal, order: b.orderTotal })) }, null, 2))
