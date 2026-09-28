// Phase 8 — read every layer of one order/bill and compare them to the paisa (against the oracle AND against each other).
import { existsSync, readFileSync } from 'node:fs'
import zlib from 'node:zlib'
import * as L from './lib.mjs'

export const dist = {} // "check" -> { diffPaise: count }
export const diffRows = [] // only the rows that differ
export function bump(check, d, ctx) {
  dist[check] ??= {}
  const k = String(d)
  dist[check][k] = (dist[check][k] ?? 0) + 1
  if (d !== 0 && d !== '0' && ctx) diffRows.push({ check, diff: d, ...ctx })
}

/** the order as saved (API, as owner) */
export async function orderLayer(orderId) {
  const owner = await L.as('owner')
  const o = await L.must(owner.orders.get({ id: orderId }), 'orders.get')
  return o.item
}
/** the invoice as issued (API, as owner) */
export async function invoiceLayer(invoiceId) {
  const owner = await L.as('owner')
  const r = await L.must(owner.billing.invoices.get({ id: invoiceId }), 'invoices.get')
  return r.item
}
/** journal lines of the bill's own entry, by account code (SQL) */
export function journalLayer(invoiceId) {
  const rows = L.q(`select a.code, sum(l.amount_paise)::bigint amt, count(*) n
                      from journal_entries e join journal_lines l on l.entry_id = e.id join accounts a on a.id = l.account_id
                     where e.tenant_id = '${L.T}' and e.ref_id = '${invoiceId}' and e.ref_type in ('invoice', 'sales_invoice', 'invoice_issue')
                     group by a.code`)
  const by = Object.fromEntries(rows.map((r) => [r.code, Number(r.amt)]))
  const refTypes = L.q(`select distinct ref_type from journal_entries where tenant_id = '${L.T}' and ref_id = '${invoiceId}'`).map((r) => r.ref_type)
  return { by, refTypes, balance: rows.reduce((t, r) => t + Number(r.amt), 0) }
}
export function pdfText(key) {
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
    try {
      if (hdr.includes('FlateDecode')) body = zlib.inflateSync(body)
    } catch {
      continue
    }
    for (const t of body.toString('latin1').matchAll(/\((.*?)(?<!\\)\)\s*Tj/g)) out.push(t[1])
  }
  return out
}
export const rupeesToPaise = (s) => (s == null ? null : Math.round(Number(String(s).replace(/[^0-9.-]/g, '')) * 100))

/** Compare one quote reply with the oracle, line by line. */
export function quoteVsOracle(caseId, quote, orc) {
  for (const ol of orc.lines) {
    const ql = quote.lines.find((x) => x.lineId === ol.lineId)
    if (!ql) {
      bump('quote↔oracle line present', 'missing', { caseId, lineId: ol.lineId })
      continue
    }
    const ctx = { caseId, lineId: ol.lineId, variantId: ol.variantId }
    bump('quote↔oracle rate', ql.ratePaise - ol.rate, { ...ctx, quote: ql.ratePaise, oracle: ol.rate })
    bump('quote↔oracle gross', ql.grossPaise - ol.gross, { ...ctx, quote: ql.grossPaise, oracle: ol.gross })
    bump('quote↔oracle scheme discount', ql.discountPaise - ol.discount, { ...ctx, quote: ql.discountPaise, oracle: ol.discount, qRules: ql.appliedRules, oRules: ol.rules })
    bump('quote↔oracle bargain', ql.bargainPaise - ol.bargain, { ...ctx, quote: ql.bargainPaise, oracle: ol.bargain })
    bump('quote↔oracle line net', ql.lineNetPaise - ol.net, { ...ctx, quote: ql.lineNetPaise, oracle: ol.net })
    bump('quote↔oracle free qty (same item)', ql.freeQtyPcs - ol.freeQty, { ...ctx, quote: ql.freeQtyPcs, oracle: ol.freeQty })
    bump('quote↔oracle gst rate', ql.gstBps - ol.gstBps, { ...ctx, quote: ql.gstBps, oracle: ol.gstBps })
    // the quote carries GST+cess as one figure computed on the combined rate
    bump('quote↔oracle line tax (combined-rate GST + cess)', ql.taxPaise - (ol.gstCombined + ol.cess), { ...ctx, quote: ql.taxPaise, oracle: ol.gstCombined + ol.cess })
    bump('quote↔oracle cess', ql.cessPaise - ol.cess, { ...ctx, quote: ql.cessPaise, oracle: ol.cess })
    const qFree = (ql.freeItems ?? []).filter((f) => f.variantId !== ol.variantId).reduce((t, f) => t + f.qtyPcs, 0)
    const oFree = ol.free.filter((f) => f.variantId !== ol.variantId).reduce((t, f) => t + f.qty, 0)
    bump('quote↔oracle free goods of another item', qFree - oFree, { ...ctx, quote: qFree, oracle: oFree })
  }
  const ctx = { caseId }
  bump('quote↔oracle total net', quote.totals.netPaise - orc.totals.net, { ...ctx, quote: quote.totals.netPaise, oracle: orc.totals.net })
  bump('quote↔oracle total (payable)', quote.totals.totalPaise - orc.totals.total, { ...ctx, quote: quote.totals.totalPaise, oracle: orc.totals.total })
  bump('quote↔oracle cash discount paise', quote.cashDiscountPaise - orc.cashDiscount.paise, { ...ctx, quote: quote.cashDiscountPaise, oracle: orc.cashDiscount.paise, qBps: quote.cashDiscountBps, oBps: orc.cashDiscount.bps })
}

/** order as saved vs the quote it was written from */
export function orderVsQuote(caseId, order, quote) {
  const ctx = { caseId, orderNo: order.orderNo }
  const sell = order.lines.filter((l) => l.qtyPcs > 0)
  for (const ql of quote.lines) {
    const candidates = sell.filter((l) => l.variantId === ql.variantId && l.qtyPcs === ql.qtyPcs)
    const ln = candidates[0]
    if (!ln) {
      bump('order↔quote line present', 'missing', { ...ctx, variantId: ql.variantId })
      continue
    }
    const c = { ...ctx, variantId: ql.variantId }
    const orderNet = ln.lineTotalPaise - ln.taxPaise
    bump('order↔quote rate', ln.ratePaise - ql.ratePaise, { ...c, order: ln.ratePaise, quote: ql.ratePaise })
    bump('order↔quote list rate', ln.listRatePaise - ql.listRatePaise, { ...c, order: ln.listRatePaise, quote: ql.listRatePaise })
    bump('order↔quote line net', orderNet - ql.lineNetPaise, { ...c, order: orderNet, quote: ql.lineNetPaise })
    bump('order↔quote line tax', ln.taxPaise - ql.taxPaise, { ...c, order: ln.taxPaise, quote: ql.taxPaise })
    bump('order↔quote free qty', ln.freeQtyPcs - ql.freeQtyPcs, { ...c, order: ln.freeQtyPcs, quote: ql.freeQtyPcs })
    const sig = (rules) => JSON.stringify((rules ?? []).filter((r) => !r.reward).map((r) => [r.ruleId, r.kind, r.amountPaise ?? 0, r.freeQty ?? 0]).sort())
    bump('order↔quote applied rules', sig(ln.appliedRules) === sig(ql.appliedRules) ? 0 : 'differ', { ...c, order: ln.appliedRules, quote: ql.appliedRules })
  }
  bump('order↔quote total', order.totalPaise - quote.totals.totalPaise, { ...ctx, order: order.totalPaise, quote: quote.totals.totalPaise })
  bump('order↔quote tax', order.taxPaise - quote.totals.taxPaise, { ...ctx, order: order.taxPaise, quote: quote.totals.taxPaise })
  bump('order↔quote round-off', order.roundOffPaise - quote.totals.roundOffPaise, { ...ctx, order: order.roundOffPaise, quote: quote.totals.roundOffPaise })
  const lineSum = order.lines.reduce((t, l) => t + l.lineTotalPaise, 0)
  bump('order header total = Σ lines + round-off', order.totalPaise - (lineSum + order.roundOffPaise), { ...ctx, total: order.totalPaise, lineSum, ro: order.roundOffPaise })
}

/** the invoice vs the order it was issued from, and the invoice header vs its own lines */
export function invoiceVsOrder(caseId, inv, order) {
  const ctx = { caseId, invoiceNo: inv.invoiceNo, orderNo: order.orderNo }
  for (const ol of order.lines) {
    const ils = inv.lines.filter((x) => x.orderLineId === ol.id)
    const c = { ...ctx, variantId: ol.variantId, orderLineId: ol.id }
    if (!ils.length) {
      bump('invoice↔order line present', 'missing', c)
      continue
    }
    const sum = (k) => ils.reduce((t, x) => t + x[k], 0)
    const orderNet = ol.lineTotalPaise - ol.taxPaise
    bump('invoice↔order qty', sum('qtyPcs') - ol.qtyPcs, { ...c, invoice: sum('qtyPcs'), order: ol.qtyPcs })
    bump('invoice↔order free qty', sum('freeQtyPcs') - ol.freeQtyPcs, { ...c, invoice: sum('freeQtyPcs'), order: ol.freeQtyPcs })
    bump('invoice↔order taxable (line)', sum('taxablePaise') - orderNet, { ...c, invoice: sum('taxablePaise'), order: orderNet, lots: ils.length })
    const iTax = sum('cgstPaise') + sum('sgstPaise') + sum('igstPaise') + sum('cessPaise')
    bump('invoice↔order tax (line)', iTax - ol.taxPaise, { ...c, invoice: iTax, order: ol.taxPaise, lots: ils.length })
    bump('invoice↔order line total', sum('lineTotalPaise') - ol.lineTotalPaise, { ...c, invoice: sum('lineTotalPaise'), order: ol.lineTotalPaise, lots: ils.length })
    bump('invoice↔order rate', ils.every((x) => x.ratePaise === ol.ratePaise) ? 0 : 'differ', { ...c, invoice: ils.map((x) => x.ratePaise), order: ol.ratePaise })
    bump('invoice↔order gst rate', ils.every((x) => x.gstBps === ol.gstBps) ? 0 : 'differ', { ...c, invoice: ils.map((x) => x.gstBps), order: ol.gstBps })
  }
  const sum = (k) => inv.lines.reduce((t, x) => t + x[k], 0)
  for (const [h, k] of [['taxablePaise', 'taxablePaise'], ['cgstPaise', 'cgstPaise'], ['sgstPaise', 'sgstPaise'], ['igstPaise', 'igstPaise'], ['cessPaise', 'cessPaise']]) bump(`invoice header ${h} = Σ lines`, inv[h] - sum(k), { ...ctx, header: inv[h], lines: sum(k) })
  const exact = inv.taxablePaise + inv.cgstPaise + inv.sgstPaise + inv.igstPaise + inv.cessPaise
  bump('invoice total = taxable + taxes + round-off', inv.totalPaise - (exact + inv.roundOffPaise), { ...ctx, total: inv.totalPaise, exact, ro: inv.roundOffPaise })
  bump('invoice total is whole rupees', inv.totalPaise % 100, { ...ctx, total: inv.totalPaise })
  bump('invoice↔order total', inv.totalPaise - order.totalPaise, { ...ctx, invoice: inv.totalPaise, order: order.totalPaise })
  bump('invoice↔order tax', inv.cgstPaise + inv.sgstPaise + inv.igstPaise + inv.cessPaise - order.taxPaise, { ...ctx, invoice: inv.cgstPaise + inv.sgstPaise + inv.igstPaise + inv.cessPaise, order: order.taxPaise })
  if (!inv.isInterState) bump('invoice CGST = SGST', inv.cgstPaise - inv.sgstPaise, { ...ctx, cgst: inv.cgstPaise, sgst: inv.sgstPaise })
  for (const x of inv.lines) if (!inv.isInterState) bump('invoice line CGST = SGST', x.cgstPaise - x.sgstPaise, { ...ctx, line: x.lineNo, cgst: x.cgstPaise, sgst: x.sgstPaise, taxable: x.taxablePaise, gstBps: x.gstBps })
}

/** the invoice vs the oracle */
export function invoiceVsOracle(caseId, inv, orc) {
  const ctx = { caseId, invoiceNo: inv.invoiceNo }
  bump('invoice↔oracle inter-state', (inv.isInterState ? 1 : 0) - (orc.interState ? 1 : 0), { ...ctx, invoice: inv.isInterState, oracle: orc.interState })
  bump('invoice↔oracle taxable', inv.taxablePaise - orc.totals.net, { ...ctx, invoice: inv.taxablePaise, oracle: orc.totals.net })
  bump('invoice↔oracle CGST', inv.cgstPaise - orc.totals.cgst, { ...ctx, invoice: inv.cgstPaise, oracle: orc.totals.cgst })
  bump('invoice↔oracle SGST', inv.sgstPaise - orc.totals.sgst, { ...ctx, invoice: inv.sgstPaise, oracle: orc.totals.sgst })
  bump('invoice↔oracle IGST', inv.igstPaise - orc.totals.igst, { ...ctx, invoice: inv.igstPaise, oracle: orc.totals.igst })
  bump('invoice↔oracle cess', inv.cessPaise - orc.totals.cess, { ...ctx, invoice: inv.cessPaise, oracle: orc.totals.cess })
  bump('invoice↔oracle round-off', inv.roundOffPaise - orc.totals.roundOff, { ...ctx, invoice: inv.roundOffPaise, oracle: orc.totals.roundOff })
  bump('invoice↔oracle total', inv.totalPaise - orc.totals.total, { ...ctx, invoice: inv.totalPaise, oracle: orc.totals.total })
}

export function journalVsInvoice(caseId, j, inv) {
  const ctx = { caseId, invoiceNo: inv.invoiceNo, refTypes: j.refTypes }
  const by = j.by
  bump('journal balances', j.balance, { ...ctx, by })
  bump('journal AR = bill total', (by.AR ?? 0) - inv.totalPaise, { ...ctx, journal: by.AR ?? 0, invoice: inv.totalPaise })
  // SALES is posted at the gross and the scheme discount beside it on DISCOUNTS (first run): net sales = SALES + DISCOUNTS
  bump('journal SALES + DISCOUNTS = −taxable', -(by.SALES ?? 0) - (by.DISCOUNTS ?? 0) - inv.taxablePaise, { ...ctx, sales: by.SALES ?? 0, discounts: by.DISCOUNTS ?? 0, invoice: inv.taxablePaise, by })
  bump('journal SALES = −(taxable + scheme discount on the bill)', -(by.SALES ?? 0) - (inv.taxablePaise + inv.lines.reduce((t, x) => t + x.discountPaise, 0)), { ...ctx, sales: by.SALES ?? 0, invoice: inv.taxablePaise })
  bump('journal OUTPUT_CGST = −cgst', -(by.OUTPUT_CGST ?? 0) - inv.cgstPaise, { ...ctx, journal: by.OUTPUT_CGST ?? 0, invoice: inv.cgstPaise })
  bump('journal OUTPUT_SGST = −sgst', -(by.OUTPUT_SGST ?? 0) - inv.sgstPaise, { ...ctx, journal: by.OUTPUT_SGST ?? 0, invoice: inv.sgstPaise })
  bump('journal OUTPUT_IGST = −igst', -(by.OUTPUT_IGST ?? 0) - inv.igstPaise, { ...ctx, journal: by.OUTPUT_IGST ?? 0, invoice: inv.igstPaise })
  bump('journal OUTPUT_CESS = −cess', -(by.OUTPUT_CESS ?? 0) - inv.cessPaise, { ...ctx, journal: by.OUTPUT_CESS ?? 0, invoice: inv.cessPaise })
  bump('journal ROUND_OFF = −round-off', -(by.ROUND_OFF ?? 0) - inv.roundOffPaise, { ...ctx, journal: by.ROUND_OFF ?? 0, invoice: inv.roundOffPaise })
}

export function registerVsInvoice(caseId, row, inv) {
  const ctx = { caseId, invoiceNo: inv.invoiceNo }
  if (!row) return bump('sales register row present', 'missing', ctx)
  for (const k of ['taxablePaise', 'cgstPaise', 'sgstPaise', 'igstPaise', 'cessPaise', 'roundOffPaise', 'totalPaise']) bump(`sales register ${k} = invoice`, row[k] - inv[k], { ...ctx, register: row[k], invoice: inv[k] })
  bump('sales register inter-state = invoice', row.isInterState === inv.isInterState ? 0 : 'differ', { ...ctx, register: row.isInterState, invoice: inv.isInterState })
  bump('sales register supply type = invoice', row.supplyType === inv.supplyType ? 0 : 'differ', { ...ctx, register: row.supplyType, invoice: inv.supplyType })
}
