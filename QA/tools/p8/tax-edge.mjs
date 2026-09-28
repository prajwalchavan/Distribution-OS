// Phase 8 — tax edge cases: returns of scheme lines at the door (credit notes), an HSN with no rate, a rate request filed by
// a non-sales role that the desk then clears on the order gate, the GST registers against the documents, and the HSN rates
// the database and the seed carry.
import { readFileSync, writeFileSync } from 'node:fs'
import * as L from './lib.mjs'
import { rdiv } from './oracle.mjs'

L.wireTo('tax-edge')
const today = L.today()
const owner = await L.as('owner')
const mgr = await L.as('manager')
const wh = await L.as('wh')
const out = { at: new Date().toISOString() }
const runs = JSON.parse(readFileSync(`${L.EV}orders-all.json`, 'utf8')).results

// ================= A. partial delivery of scheme lines → credit notes at the billed value
const pickCases = ['L01', 'G04', 'F04', 'K03', 'X04', 'F02']
const bills = pickCases.map((id) => runs.find((r) => r.id === id)).filter((r) => r?.invoice?.id)
const VEH = { id: '99498089-d54e-7b50-b33e-61fd2733f05d', loc: '2c7b4801-3f88-77d1-8a25-7e903891f265' }
const DRIVER = 'mahesh.sutar'
const driverId = L.q1(`select id from users where username='${DRIVER}'`).id
const stops = bills.map((b, i) => ({ id: L.uuidv7(), sequence: i + 1, retailerId: b.shop.id, invoiceIds: [b.invoice.id] }))
const tm = L.mk()
const trip = { steps: [] }
const step = async (label, p) => {
  const r = await L.tryCall(p)
  trip.steps.push(`${label}: ${r.ok ? 'ok' : `${r.status} ${r.message} ${JSON.stringify(r.data ?? '').slice(0, 200)}`}`)
  console.log(trip.steps.at(-1))
  return r
}
await step('trips.create', mgr.delivery.trips.create({ ...tm, tripDate: today, vehicleId: VEH.id, driverId, openingCashPaise: 0, stops }))
await step('trips.startLoading', wh.delivery.trips.startLoading({ ...L.key(), id: tm.id }))
const sm = L.mk()
await step('loadSheets.create', wh.warehouse.loadSheets.create({ ...sm, toLocationId: VEH.loc, fromLocationId: L.GODOWN, tripId: tm.id, orderIds: bills.map((b) => b.order.id) }))
await step('loadSheets.approve', mgr.warehouse.loadSheets.approve({ ...L.key(), id: sm.id, note: 'QA p8' }))
const sheet = await L.tryCall(wh.warehouse.loadSheets.get({ id: sm.id }))
const packages = sheet.ok ? (sheet.value.item?.expectedPackages ?? sheet.value.expectedPackages ?? bills.length) : bills.length
await step('loadSheets.confirm', wh.warehouse.loadSheets.confirm({ ...L.key(), id: sm.id, countedPackages: packages, challanId: L.uuidv7() }))
const drv = await L.as(DRIVER, { svc: 'delivery' })
await L.tryCall(drv.delivery.consents.grant({ ...L.mk(), granted: true, noticeVersion: 'gps-notice-2026-09', locale: 'en-IN' }))
await step('trips.depart', drv.delivery.trips.depart({ ...L.key(), id: tm.id }))
const cn = []
for (const [i, b] of bills.entries()) {
  const stop = stops[i]
  await L.tryCall(drv.delivery.stops.start({ ...L.key(), id: stop.id }))
  await L.tryCall(drv.delivery.stops.arrive({ ...L.key(), id: stop.id }))
  const ils = L.q(`select id, line_no, variant_id, qty_pcs, free_qty_pcs, taxable_paise, discount_paise, rate_paise, gst_bps, cgst_paise, sgst_paise, igst_paise, cess_bps, cess_paise from invoice_lines where invoice_id='${b.invoice.id}' order by line_no`)
  // return a third (at least one piece) of every sold line; free pieces of the line come back in the same proportion
  const lines = ils.map((l) => {
    const back = l.qty_pcs > 0 ? Math.max(1, Math.floor(l.qty_pcs / 3)) : 0
    const freeBack = l.qty_pcs > 0 ? Math.floor((l.free_qty_pcs * back) / l.qty_pcs) : 0
    const all = l.qty_pcs + l.free_qty_pcs
    return { id: L.uuidv7(), invoiceLineId: l.id, deliveredQtyPcs: all - back - freeBack, returnedQtyPcs: back + freeBack, returnedSaleable: true, reason: 'refused' }
  })
  const dm = L.mk()
  const r = await L.tryCall(drv.delivery.deliveries.record({ ...dm, tripId: tm.id, stopId: stop.id, invoiceId: b.invoice.id, receiverName: 'Shop owner', lines, pod: [{ id: L.uuidv7(), kind: 'signature', inline: { mimeType: 'image/png', contentBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' } }] }))
  const note = r.ok && r.value.creditNoteId ? L.q1(`select id, credit_note_no, state::text, taxable_paise, cgst_paise, sgst_paise, igst_paise, cess_paise, round_off_paise, total_paise from credit_notes where id='${r.value.creditNoteId}'`) : null
  const cls = note ? L.q(`select invoice_line_id, qty_pcs, rate_paise, taxable_paise, gst_bps, tax_paise, line_total_paise from credit_note_lines where credit_note_id='${note.id}'`) : []
  const rows = []
  for (const l of ils) {
    const d = lines.find((x) => x.invoiceLineId === l.id)
    const c = cls.find((x) => x.invoice_line_id === l.id)
    const soldBack = l.qty_pcs > 0 ? Math.max(1, Math.floor(l.qty_pcs / 3)) : 0
    // expected: what the shop paid per piece (the line's taxable after every scheme) × pieces returned, tax at the line's own rates
    const expTaxable = l.qty_pcs > 0 ? rdiv(l.taxable_paise * soldBack, l.qty_pcs) : 0
    const inter = l.igst_paise > 0 || (l.cgst_paise === 0 && l.sgst_paise === 0 && l.gst_bps > 0 && l.taxable_paise > 0)
    const expGst = inter ? rdiv(expTaxable * l.gst_bps, 10000) : 2 * rdiv(expTaxable * l.gst_bps, 20000)
    const expCess = rdiv(expTaxable * l.cess_bps, 10000)
    rows.push({ line: l.line_no, qty: l.qty_pcs, free: l.free_qty_pcs, returned: d.returnedQtyPcs, soldBack, billTaxable: l.taxable_paise, billDisc: l.discount_paise, cnQty: c?.qty_pcs ?? null, cnTaxable: c?.taxable_paise ?? null, expTaxable, cnTax: c?.tax_paise ?? null, expTax: expGst + expCess, cnRate: c?.rate_paise ?? null, billRate: l.rate_paise, gstBps: l.gst_bps, cnGstBps: c?.gst_bps ?? null })
  }
  cn.push({ case: b.id, invoiceNo: b.invoice.no, inter: b.invoice.inter, delivery: r.ok ? 'ok' : `${r.status} ${r.message} ${JSON.stringify(r.data ?? '').slice(0, 200)}`, note, rows })
  console.log(JSON.stringify(cn.at(-1)).slice(0, 900))
}
out.trip = { tripId: tm.id, steps: trip.steps }
out.creditNotes = cn

// ================= B. an item whose HSN has no rate row
{
  const pid = L.uuidv7()
  const vid = L.uuidv7()
  const mfr = L.q1(`select id from manufacturers limit 1`).id
  const b = { steps: [] }
  const s = async (label, p) => {
    const r = await L.tryCall(p)
    b.steps.push(`${label}: ${r.ok ? 'ok' : `${r.status} ${r.code} ${r.message} ${JSON.stringify(r.data ?? '').slice(0, 300)}`}`)
    console.log(b.steps.at(-1))
    return r
  }
  await s('catalog.propose HSN 09011110 (no rate row, no 0901 heading)', owner.catalog.propose({ ...L.key(), productId: pid, variantId: vid, manufacturerId: mfr, productName: 'QA P8 Filter Coffee', variantName: 'QA P8 Filter Coffee 200 g', netQty: 200, netUnit: 'g', defaultCaseSize: 24, hsnCode: '09011110', mrpPaise: 25000 }))
  await s('catalog.hsnRates 09011110', owner.catalog.hsnRates({ codes: '09011110' }))
  await s('tenantCatalog.upsertListing', owner.tenantCatalog.upsertListing({ ...L.mk(), variantId: vid, listed: true }))
  const listB = L.q1(`select id from price_lists where tenant_id='${L.T}' and tier='B'`).id
  await s('priceLists.setItems Tier B ₹180', owner.pricing.priceLists.setItems({ ...L.key(), priceListId: listB, items: [{ id: L.uuidv7(), variantId: vid, ratePaise: 18000, inclusiveOfGst: false }] }))
  const shop = await L.createShop('QA P8 HSN no rate', { tier: 'B', gstin: L.gstin('27', 'AQPHN4321K') })
  const rep = await L.as('rep')
  await s('pricing.quote', rep.pricing.quote({ retailerId: shop.id, lines: [{ lineId: 'a', variantId: vid, qtyPcs: 2 }] }))
  const o = await L.placeOrder(shop.id, [{ variantId: vid, qty: 2 }], 'rep')
  b.steps.push(`orders.create: ${o.created.ok ? `ok (line gst ${JSON.stringify(L.q(`select gst_bps, tax_paise from sales_order_lines where order_id='${o.orderId}'`))})` : `${o.created.status} ${o.created.message} ${JSON.stringify(o.created.data ?? '').slice(0, 200)}`}`)
  b.steps.push(`orders.submit: ${o.submitted ? (o.submitted.ok ? o.submitted.value.item.state : `${o.submitted.status} ${o.submitted.message}`) : 'not reached'}`)
  console.log(b.steps.slice(-2).join('\n'))
  out.hsnNoRate = b
}

// ================= C. a rate request filed by the DELIVERY crew, cleared by the owner on the order's gate
{
  const W = '5370bbc0-2819-7d3f-af0d-4e596dcfaf2a' // Chamak Dishwash 300 g (in-flight lane variant, tier B here)
  const shop = await L.createShop('QA P8 crew rate request', { tier: 'B' })
  const tierB = Number(L.q1(`select i.rate_paise r from price_list_items i join price_lists l on l.id=i.price_list_id where l.tenant_id='${L.T}' and l.tier='B' and i.variant_id='${W}'`).r)
  const crew = await L.as('driver')
  const br = await L.tryCall(crew.pricing.bargains.request({ ...L.mk(), retailerId: shop.id, variantId: W, askedRatePaise: Math.round(tierB * 0.6), note: 'QA p8: crew asks 40 % off' }))
  const o = await L.placeOrder(shop.id, [{ variantId: W, qty: 10 }], 'rep')
  const held = o.submitted.ok ? { state: o.submitted.value.item.state, flags: o.submitted.value.item.approvalFlags } : `${o.submitted.status} ${o.submitted.message}`
  const queue = await L.must(owner.orders.approvals.list({ orderId: o.orderId, status: 'pending' }), 'approvals')
  const gate = (queue.items ?? []).map((a) => ({ kind: a.kind, payload: a.payload, requestedBy: L.q1(`select username from users where id='${a.requestedBy}'`)?.username }))
  const dec = await L.approveAll(o.orderId)
  const line = L.q1(`select list_rate_paise, rate_paise, discount_paise, line_total_paise, applied_rules from sales_order_lines where order_id='${o.orderId}'`)
  out.crewRateRequest = { tierB, asked: Math.round(tierB * 0.6), request: br.ok ? br.value.item.status : `${br.status} ${br.message}`, held, gate, decisions: dec.map((d) => `${d.kind}:${d.r.ok ? 'approved' : d.r.status}`), orderLine: line }
  console.log(JSON.stringify(out.crewRateRequest).slice(0, 1200))
}

// ================= D. the GST registers of the day against the documents (SQL over invoice and credit-note lines)
{
  const sum = L.q1(`select coalesce(sum(il.taxable_paise),0)::bigint taxable, coalesce(sum(il.cgst_paise),0)::bigint cgst, coalesce(sum(il.sgst_paise),0)::bigint sgst, coalesce(sum(il.igst_paise),0)::bigint igst, coalesce(sum(il.cess_paise),0)::bigint cess, count(distinct i.id)::int docs
                      from invoice_lines il join invoices i on i.id=il.invoice_id where i.tenant_id='${L.T}' and i.invoice_date='${today}' and i.state not in ('draft','cancelled')`)
  const byRate = L.q(`select il.gst_bps, sum(il.taxable_paise)::bigint taxable, sum(il.cgst_paise+il.sgst_paise+il.igst_paise)::bigint gst, sum(il.cess_paise)::bigint cess from invoice_lines il join invoices i on i.id=il.invoice_id
                        where i.tenant_id='${L.T}' and i.invoice_date='${today}' and i.state not in ('draft','cancelled') group by 1 order by 1`)
  const g = await L.tryCall(owner.billing.registers.gstSummary({ from: today, to: today, groupBy: 'rate' }))
  const gh = await L.tryCall(owner.billing.registers.gstSummary({ from: today, to: today, groupBy: 'hsn' }))
  const rg = await L.tryCall(owner.reporting.registers.gstSalesRegister({ from: today, to: today, groupBy: 'rate' }))
  const acc = await L.as('accountant')
  const ga = await L.tryCall(acc.billing.registers.gstSummary({ from: today, to: today, groupBy: 'rate' }))
  const cmp = (t) => (t ? { taxable: Number(t.taxablePaise) - Number(sum.taxable), cgst: Number(t.cgstPaise) - Number(sum.cgst), sgst: Number(t.sgstPaise) - Number(sum.sgst), igst: Number(t.igstPaise) - Number(sum.igst), cess: Number(t.cessPaise) - Number(sum.cess), docs: t.documentCount - sum.docs } : null)
  out.registers = {
    sql: sum,
    sqlByRate: byRate,
    gstSummaryRate: g.ok ? { totals: g.value.totals, diff: cmp(g.value.totals), rows: g.value.rows.map((r) => ({ gstBps: r.gstBps, cessBps: r.cessBps, taxable: r.taxablePaise, cgst: r.cgstPaise, sgst: r.sgstPaise, igst: r.igstPaise, cess: r.cessPaise, free: r.freeQtyPcs })) } : `${g.status} ${g.message}`,
    gstSummaryHsnTotalsDiff: gh.ok ? cmp(gh.value.totals) : `${gh.status} ${gh.message}`,
    reportingGstSalesRegisterDiff: rg.ok ? cmp(rg.value.totals) : `${rg.status} ${rg.message}`,
    accountantGstSummaryDiff: ga.ok ? cmp(ga.value.totals) : `${ga.status} ${ga.message}`,
    creditNoteTotals: g.ok ? g.value.creditNoteTotals : null,
    creditNotesSql: L.q1(`select coalesce(sum(taxable_paise),0)::bigint taxable, coalesce(sum(cgst_paise),0)::bigint cgst, coalesce(sum(sgst_paise),0)::bigint sgst, coalesce(sum(igst_paise),0)::bigint igst, coalesce(sum(cess_paise),0)::bigint cess, count(*)::int n from credit_notes where tenant_id='${L.T}' and note_date='${today}' and state in ('issued','applied')`),
  }
  console.log(JSON.stringify(out.registers).slice(0, 2000))
}

// ================= E. the HSN rates the database and the seed carry (evidence for the GST-rate question)
{
  out.hsnRatesDb = L.q(`select hsn_code, gst_bps, cess_bps, effective_from::text, effective_to::text, description from hsn_rates where hsn_code in ('1905','2106','21069099','2201','2202','22029920','3401','3305','3306','0405','04063000','1904','2008') order by hsn_code, effective_from`)
  const seed = readFileSync(`${L.ROOT}backend/libs/database/src/seed-demo/catalog.ts`, 'utf8').split('\n')
  out.hsnRatesSeedLines = seed.map((t, i) => ({ n: i + 1, t: t.trim() })).filter((x) => /key: 'hsn-|gstBps|cessBps|effectiveFrom|2017-07-01/.test(x.t)).slice(0, 60)
  out.billsTodayByHsn = L.q(`select il.hsn_code, il.gst_bps, il.cess_bps, count(*)::int lines, sum(il.taxable_paise)::bigint taxable, sum(il.cgst_paise+il.sgst_paise+il.igst_paise+il.cess_paise)::bigint tax
                              from invoice_lines il join invoices i on i.id=il.invoice_id where i.tenant_id='${L.T}' and i.invoice_date='${today}' and i.state not in ('draft','cancelled') group by 1,2,3 order by 1`)
}
writeFileSync(`${L.EV}tax-edge.json`, JSON.stringify(out, null, 1))
console.log('done')
