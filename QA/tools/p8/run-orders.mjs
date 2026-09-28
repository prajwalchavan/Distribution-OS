// Phase 8 — the generated orders: plan → quote → oracle → order → invoice → journal → registers → outstanding → PDF, to the paisa.
// usage: node run-orders.mjs [caseIdPrefix…]   (no args = every case in cases.mjs)
import { writeFileSync } from 'node:fs'
import * as L from './lib.mjs'
import * as I from './inputs.mjs'
import * as C from './layers.mjs'
import { oracle } from './oracle.mjs'
import { CASES } from './cases.mjs'

const only = process.argv.slice(2)
const cases = only.length ? CASES.filter((c) => only.some((p) => c.id.startsWith(p))) : CASES
const tag = only.length ? only.join('_') : 'all'
L.wireTo(`orders-${tag}`)
const owner = await L.as('owner')
const rep = await L.as('rep')
const today = L.today()
let panSeq = Number(String(Date.now()).slice(-4))
const nextPan = () => {
  panSeq += 1
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  return `AQP${letters[panSeq % 24]}${letters[Math.floor(panSeq / 24) % 24]}${String(panSeq % 10000).padStart(4, '0')}K`
}

// ---- stock: top the godown up where the plan needs more than is sellable (owner adjustment, reason 'adjustment')
function piecesOf(c) {
  const vs = I.variants([...new Set(c.lines.map((l) => l.v))], today)
  return c.lines.map((l) => ({ v: l.v, pcs: l.qty * (l.unit === 'case' ? vs[l.v].caseSize : 1) }))
}
const need = {}
for (const c of cases) for (const p of piecesOf(c)) need[p.v] = (need[p.v] ?? 0) + Math.ceil(p.pcs * 1.2) + 20
for (const [v, pcs] of Object.entries(need)) {
  const atp = Number(L.q1(`select coalesce(sum(available),0) a from sellable_stock where tenant_id='${L.T}' and variant_id='${v}' and location_id='${L.GODOWN}'`).a)
  if (atp >= pcs) continue
  const lot = L.q1(`select l.id from stock_lots l where l.tenant_id='${L.T}' and l.variant_id='${v}' order by l.expiry_date desc nulls first limit 1`)
  const r = await L.tryCall(owner.inventory.stock.adjust({ ...L.key(), lotId: lot.id, locationId: L.GODOWN, qtyDelta: pcs - atp + 50, reason: 'adjustment', note: 'QA p8 pricing lane top-up' }))
  console.log(`stock top-up ${v.slice(0, 8)} ${atp} → +${pcs - atp + 50}: ${r.ok ? 'ok' : `${r.status} ${r.message}`}`)
}

const results = []
for (const c of cases) {
  const rec = { id: c.id, area: c.area, title: c.title, notes: [] }
  results.push(rec)
  try {
    // shop
    const terms = { ...c.shop }
    if (terms.gstin === true) terms.gstin = L.gstin(terms.stateCode ?? '27', nextPan())
    else delete terms.gstin
    const shop = await L.createShop(`QA P8 ${c.id} ${c.title.slice(0, 40)}`, terms)
    rec.shop = { id: shop.id, code: shop.code, tier: shop.tier, state: shop.state_code, gstin: shop.gstin }
    // lines in pieces
    const vs = I.variants([...new Set(c.lines.map((l) => l.v))], today)
    const lines = c.lines.map((l) => ({ lineId: L.uuidv7(), variantId: l.v, qtyPcs: l.qty * (l.unit === 'case' ? vs[l.v].caseSize : 1), enteredQty: l.qty, enteredUnit: l.unit ?? 'piece' }))
    const orderId = L.uuidv7()
    // overrides
    for (const o of c.overrides ?? []) {
      const r = await L.tryCall(owner.pricing.overrides.upsert({ ...L.mk(), retailerId: shop.id, variantId: o.v, ratePaise: o.rate, final: o.final, validFrom: o.validFrom ?? today, ...(o.validTo ? { validTo: o.validTo } : {}), note: `QA p8 ${c.id}` }))
      if (!r.ok) rec.notes.push(`override refused ${r.status} ${r.message}`)
    }
    // schemes (applicability = this shop only)
    for (const s of c.schemes ?? []) {
      let triggerMin = s.triggerMin
      if (typeof triggerMin === 'string') {
        const tp = I.tierPrices(shop.tier, today, lines.map((l) => l.variantId))
        const gross = lines.reduce((t, l) => t + tp[l.variantId] * l.qtyPcs, 0)
        triggerMin = triggerMin === 'GROSS' ? gross : gross + 1
        rec.notes.push(`bill gross ${gross} → triggerMin ${triggerMin}`)
      }
      const input = { ...L.mk(), fundingSource: 'distributor', validFrom: L.addDays(today, -30), validTo: L.addDays(today, 60), stackable: true, final: false, ...s, triggerMin, applicability: { retailerIds: [shop.id] } }
      const r = await L.tryCall(owner.pricing.schemes.upsert(input))
      if (!r.ok) rec.notes.push(`scheme ${s.name} refused ${r.status} ${r.message} ${JSON.stringify(r.data ?? '')}`)
    }
    // bargains (asked by the rep; decided by the owner when the plan says so)
    rec.bargains = []
    for (const b of c.bargains ?? []) {
      const qty = lines.find((l) => l.variantId === b.v)?.qtyPcs
      const r = await L.tryCall(rep.pricing.bargains.request({ ...L.mk(), retailerId: shop.id, variantId: b.v, askedRatePaise: b.ask, qtyPcs: qty, ...(b.scope === 'order' ? { orderId } : {}), note: `QA p8 ${c.id}` }))
      const bb = { ask: b.ask, request: r.ok ? { status: r.value.item.status, id: r.value.item.id, list: r.value.item.listRatePaise } : { error: `${r.status} ${r.message}` } }
      if (r.ok && b.decide && r.value.item.status === 'requested') {
        const d = await L.tryCall(owner.pricing.bargains.decide({ ...L.key(), id: r.value.item.id, decision: b.decide, ...(b.approvedRate ? { approvedRatePaise: b.approvedRate } : {}), note: `QA p8 ${c.id}` }))
        bb.decision = d.ok ? { status: d.value.item.status, approved: d.value.item.approvedRatePaise } : { error: `${d.status} ${d.message} ${JSON.stringify(d.data ?? '')}` }
      }
      rec.bargains.push(bb)
    }
    // quote (as the rep, the way the app prices) and the oracle, from the same moment's inputs
    const qIn = { retailerId: shop.id, lines: lines.map((l) => ({ lineId: l.lineId, variantId: l.variantId, qtyPcs: l.qtyPcs })), ...(c.deliveryDate ? { deliveryDate: c.deliveryDate } : {}), orderId }
    const quote = await L.tryCall(rep.pricing.quote(qIn))
    const inp = I.load(shop.id, qIn.lines, { deliveryDate: c.deliveryDate, orderId })
    const orc = oracle(inp)
    rec.oracle = { net: orc.totals.net, cgst: orc.totals.cgst, sgst: orc.totals.sgst, igst: orc.totals.igst, cess: orc.totals.cess, roundOff: orc.totals.roundOff, total: orc.totals.total, cd: orc.cashDiscount, lines: orc.lines.map((l) => ({ v: l.variantId.slice(0, 8), qty: l.qtyPcs, rate: l.rate, gross: l.gross, disc: l.discount, share: l.orderShare, barg: l.bargain, net: l.net, free: l.free.map((f) => `${f.qty}×${f.variantId.slice(0, 8)}`), excl: l.exclusive ? 1 : 0 })) }
    if (!quote.ok) {
      rec.quoteError = `${quote.status} ${quote.message} ${JSON.stringify(quote.data ?? '')}`
      continue
    }
    rec.quote = { net: quote.value.totals.netPaise, tax: quote.value.totals.taxPaise, roundOff: quote.value.totals.roundOffPaise, total: quote.value.totals.totalPaise, cdBps: quote.value.cashDiscountBps, cdPaise: quote.value.cashDiscountPaise, orderRules: quote.value.orderRules.map((r) => `${r.rewardKind}:${r.amountPaise}`) }
    // the order, placed by the rep
    const created = await L.tryCall(rep.orders.create({ id: orderId, idempotencyKey: L.uuidv7(), retailerId: shop.id, source: 'salesperson', ...(c.deliveryDate ? { pricingDateMode: 'delivery', expectedDeliveryDate: c.deliveryDate } : {}), lines: lines.map((l) => ({ id: l.lineId, variantId: l.variantId, enteredQty: l.enteredQty, enteredUnit: l.enteredUnit })) }))
    if (!created.ok) {
      rec.orderError = `create ${created.status} ${created.message} ${JSON.stringify(created.data ?? '')}`
      continue
    }
    const sub = await L.tryCall(rep.orders.submit({ ...L.key(), id: orderId }))
    if (!sub.ok) {
      rec.orderError = `submit ${sub.status} ${sub.message}`
      continue
    }
    rec.submitState = sub.value.item.state
    rec.flags = sub.value.item.approvalFlags
    if (sub.value.item.state === 'submitted') {
      const decided = await L.approveAll(orderId)
      rec.approvals = decided.map((d) => `${d.kind}:${d.r.ok ? 'approved' : `${d.r.status} ${d.r.message}`}`)
      const st = L.q1(`select state::text s from sales_orders where id='${orderId}'`).s
      if (st === 'submitted') {
        const cf = await L.tryCall(owner.orders.confirm({ ...L.key(), id: orderId }))
        rec.approvals.push(`confirm:${cf.ok ? 'ok' : `${cf.status} ${cf.message}`}`)
      }
    }
    // after the gates: the basket priced again (a held order confirms with the rates approved since it was drafted —
    // docs/22 2026-09-13), and the oracle from the inputs as they stand now
    const quote2 = await L.tryCall(rep.pricing.quote(qIn))
    const orc2 = oracle(I.load(shop.id, qIn.lines, { deliveryDate: c.deliveryDate, orderId }))
    if (quote2.ok && quote2.value.totals.totalPaise !== quote.value.totals.totalPaise) rec.notes.push(`re-quote after the gates: ${quote.value.totals.totalPaise} → ${quote2.value.totals.totalPaise}`)
    const qFinal = quote2.ok ? quote2.value : quote.value
    C.quoteVsOracle(c.id, qFinal, orc2)
    const order = await C.orderLayer(orderId)
    rec.order = { id: orderId, no: order.orderNo, state: order.state, subtotal: order.subtotalPaise, discount: order.discountPaise, tax: order.taxPaise, roundOff: order.roundOffPaise, total: order.totalPaise, rewardLines: order.lines.filter((l) => l.qtyPcs === 0).map((l) => ({ v: l.variantId.slice(0, 8), free: l.freeQtyPcs, rate: l.ratePaise, tax: l.taxPaise, rules: l.appliedRules })) }
    // if the order was re-priced at confirm (held orders), compare with a fresh quote of the same basket
    C.orderVsQuote(c.id, order, qFinal)
    rec._orc = orc2
    rec.oracleAfterGates = orc2.totals.total
  } catch (e) {
    rec.error = String(e?.stack ?? e).slice(0, 500)
    console.log(`  ! ${c.id} error ${rec.error}`)
  }
  console.log(`${c.id} ${rec.quote ? `quote ${rec.quote.total} oracle ${rec.oracle?.total}` : rec.quoteError ?? rec.error ?? ''} order ${rec.order?.no ?? rec.orderError ?? '-'} ${rec.order?.state ?? ''} ${rec.order?.total ?? ''}`)
}

// ---- pick and pack in waves; the invoice is issued at pack
const confirmed = results.filter((r) => r.order?.state === 'confirmed')
for (let i = 0; i < confirmed.length; i += 6) {
  const wave = confirmed.slice(i, i + 6)
  const r = await L.tryCall(L.pickAndPack(wave.map((w) => w.order.id)))
  if (!r.ok) {
    for (const w of wave) w.packError = `${r.status ?? ''} ${r.message}`
    console.log(`wave ${i / 6} failed: ${r.message}`)
    continue
  }
  for (const inv of r.value.invoices) {
    const w = wave.find((x) => x.order.id === inv.orderId)
    w.invoice = { id: inv.invoiceId, no: inv.invoiceNo, packErr: inv.packErr }
  }
}

// ---- every layer of every bill
for (const rec of results.filter((r) => r.invoice?.id)) {
  const inv = await C.invoiceLayer(rec.invoice.id)
  const order = await C.orderLayer(rec.order.id)
  C.invoiceVsOrder(rec.id, inv, order)
  C.invoiceVsOracle(rec.id, inv, rec._orc)
  const j = C.journalLayer(inv.id)
  C.journalVsInvoice(rec.id, j, inv)
  const reg = await L.tryCall(owner.billing.registers.salesRegister({ from: today, to: today, retailerId: rec.shop.id }))
  const row = reg.ok ? reg.value.items.find((x) => x.id === inv.id) : null
  C.registerVsInvoice(rec.id, row, inv)
  const out = await L.tryCall(owner.receivables.outstanding.get({ retailerId: rec.shop.id }))
  const outTotal = out.ok ? out.value.outstandingPaise + (out.value.undeliveredPaise ?? 0) : null
  C.bump('outstanding (dues + not yet delivered) = bill total', out.ok ? outTotal - inv.totalPaise : 'error', { caseId: rec.id, invoiceNo: inv.invoiceNo, outstanding: out.ok ? out.value.outstandingPaise : `${out.status} ${out.message}`, undelivered: out.value?.undeliveredPaise, invoice: inv.totalPaise })
  rec.invoice = { ...rec.invoice, taxable: inv.taxablePaise, cgst: inv.cgstPaise, sgst: inv.sgstPaise, igst: inv.igstPaise, cess: inv.cessPaise, roundOff: inv.roundOffPaise, total: inv.totalPaise, supply: inv.supplyType, inter: inv.isInterState, cdBps: inv.cashDiscountBps, cdUntil: inv.cashDiscountUntil, amountDue: inv.amountDuePaise, lines: inv.lines.map((x) => ({ v: x.variantId.slice(0, 8), qty: x.qtyPcs, free: x.freeQtyPcs, rate: x.ratePaise, disc: x.discountPaise, taxable: x.taxablePaise, gst: x.gstBps, cgst: x.cgstPaise, sgst: x.sgstPaise, igst: x.igstPaise, cess: x.cessPaise, total: x.lineTotalPaise, lot: x.lotId?.slice(0, 8), reward: (x.appliedRules ?? []).some((r) => r.reward) })) }
  rec.journal = j.by
  rec.register = row ? { taxable: row.taxablePaise, total: row.totalPaise } : null
  rec.outstanding = out.ok ? { dues: out.value.outstandingPaise, undelivered: out.value.undeliveredPaise } : null
  rec.pdfKey = inv.pdfObjectKey
}

// ---- PDFs (rendered by the worker off the outbox; give it time)
await new Promise((r) => setTimeout(r, 75_000))
for (const rec of results.filter((r) => r.invoice?.id)) {
  const key = rec.pdfKey ?? L.q1(`select pdf_object_key k from invoices where id='${rec.invoice.id}'`).k
  const toks = C.pdfText(key)
  if (!toks) {
    C.bump('PDF total = bill total', 'no pdf', { caseId: rec.id, invoiceNo: rec.invoice.no, key })
    continue
  }
  const after = (label) => {
    const at = toks.lastIndexOf(label)
    return at >= 0 ? C.rupeesToPaise(toks[at + 1]) : null
  }
  const pdf = { total: after('TOTAL'), taxable: after('Taxable value'), cgst: after('CGST'), sgst: after('SGST'), igst: after('IGST'), cess: after('Cess'), roundOff: after('Round off') }
  rec.pdf = { key, ...pdf, tokens: toks.length }
  const ctx = { caseId: rec.id, invoiceNo: rec.invoice.no }
  C.bump('PDF total = bill total', pdf.total === null ? 'no TOTAL' : pdf.total - rec.invoice.total, { ...ctx, pdf: pdf.total, invoice: rec.invoice.total })
  C.bump('PDF taxable = bill taxable', pdf.taxable === null ? 'not printed' : pdf.taxable - rec.invoice.taxable, { ...ctx, pdf: pdf.taxable, invoice: rec.invoice.taxable })
  for (const k of ['cgst', 'sgst', 'igst', 'cess']) if (rec.invoice[k] || pdf[k] !== null) C.bump(`PDF ${k} = bill ${k}`, pdf[k] === null ? 'not printed' : pdf[k] - rec.invoice[k], { ...ctx, pdf: pdf[k], invoice: rec.invoice[k] })
  if (rec.invoice.roundOff || pdf.roundOff !== null) C.bump('PDF round-off = bill round-off', pdf.roundOff === null ? 'not printed' : Math.abs(pdf.roundOff) - Math.abs(rec.invoice.roundOff), { ...ctx, pdf: pdf.roundOff, invoice: rec.invoice.roundOff })
  if (rec.invoice.cdBps) C.bump('PDF prints the cash-discount offer', toks.some((x) => /cash dis/i.test(x)) ? 0 : 'absent', { ...ctx, cdBps: rec.invoice.cdBps })
}

for (const r of results) {
  delete r._orc
  delete r._quote
}
const out = { at: new Date().toISOString(), date: today, cases: results.length, withInvoice: results.filter((r) => r.invoice?.id).length, distribution: C.dist, differences: C.diffRows, results }
writeFileSync(`${L.EV}orders-${tag}.json`, JSON.stringify(out, null, 1))
console.log('\nDISTRIBUTION')
for (const [k, v] of Object.entries(C.dist)) console.log(`${Object.keys(v).every((d) => d === '0') ? '  ok ' : ' DIFF'} ${k}: ${JSON.stringify(v)}`)
console.log(`differences: ${C.diffRows.length} rows; cases ${results.length}, invoices ${out.withInvoice}`)
