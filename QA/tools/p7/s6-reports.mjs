// Phase 7 · S6 — reports for the period driven (today): the owner's dashboard, the collections register, the outstanding /
// ageing register, the sales register, the GST register and the trial balance, each against the documents in SQL.
import { writeFileSync } from 'node:fs'
import { begin, step, obs, expect, recon, save, L, F } from './scenario-kit.mjs'

const owner = await L.as('owner')
const acc = await L.as('accountant')
const today = F.today()
const T = L.T
const n = (x) => Number(x ?? 0)
const diffs = []
function cmp(report, figure, served, sql, note = '') {
  const d = served === null || served === undefined ? null : n(served) - n(sql)
  const row = { report, figure, served, sql, diff: d, note }
  diffs.push(row)
  console.log(`  ${d === 0 ? '=' : '≠'} ${report} · ${figure}: served ${served} sql ${sql}${d ? ` (diff ${d})` : ''}${note ? ` — ${note}` : ''}`)
  return d === 0
}

begin('S6-wait', 'Wait for the 15-minute rollup to run after the last document of the day')
const lastDoc = L.q1(`select greatest((select max(updated_at) from invoices where tenant_id = '${T}'), (select max(updated_at) from receipts where tenant_id = '${T}'), (select max(updated_at) from credit_notes where tenant_id = '${T}')) last_doc`).last_doc
let computed
for (let i = 0; i < 40; i++) {
  const row = L.q1(`select computed_at, computed_at > '${lastDoc}'::timestamptz fresh from daily_tenant_stats where tenant_id = '${T}' and day = '${today}'`)
  computed = row?.computed_at
  if (row?.fresh) break // compared in SQL: JS Date cannot parse Postgres' microsecond timestamps
  await new Promise((r) => setTimeout(r, 30_000))
}
step('last document change / rollup computed', { lastDoc, computed })

// ---- owner dashboard -------------------------------------------------------------------------------------------------
begin('S6-dashboard', 'Owner dashboard (home) against the documents')
const dash = await L.must(owner.reporting.dashboard.owner({}), 'dashboard')
writeFileSync(`${L.EV}s6-dashboard.json`, JSON.stringify(dash, null, 2))
const start = `'${today} 00:00:00+05:30'`
const endD = `'${today} 00:00:00+05:30'::timestamptz + interval '1 day'`
const sqlD = L.q1(`
  select (select coalesce(sum(total_paise), 0) from invoices where tenant_id = '${T}' and invoice_date = '${today}' and state not in ('draft', 'cancelled')) invoiced,
         (select coalesce(sum(total_paise), 0) from credit_notes where tenant_id = '${T}' and note_date = '${today}' and state in ('issued', 'applied')) credited,
         (select coalesce(sum(amount_paise), 0) from receipts where tenant_id = '${T}' and status in ('collected', 'deposited') and received_at >= ${start} and received_at < ${endD}) collected_live,
         (select coalesce(sum(amount_paise), 0) from receipts where tenant_id = '${T}' and received_at >= ${start} and received_at < ${endD}) collected_net_of_reversals,
         (select count(*) from sales_orders where tenant_id = '${T}' and state not in ('draft', 'cancelled') and created_at >= ${start} and created_at < ${endD}) orders,
         (select coalesce(sum(outstanding_paise), 0) from retailer_outstanding_summary where tenant_id = '${T}') outstanding,
         (select coalesce(sum(overdue_paise), 0) from retailer_outstanding_summary where tenant_id = '${T}') overdue,
         (select coalesce(sum(unallocated_credit_paise), 0) from retailer_outstanding_summary where tenant_id = '${T}') on_account,
         (select coalesce(sum(l.amount_paise), 0) from journal_lines l join accounts a on a.id = l.account_id where a.code = 'CASH_VAN' and l.tenant_id = '${T}') cash_van,
         (select coalesce(sum(l.amount_paise), 0) from journal_lines l join accounts a on a.id = l.account_id where a.code = 'AR' and l.tenant_id = '${T}') ar,
         (select coalesce(sum(total_paise), 0) from invoices where tenant_id = '${T}' and invoice_date >= date_trunc('month', '${today}'::date) and invoice_date <= '${today}' and state not in ('draft', 'cancelled')) mtd_invoiced,
         (select coalesce(sum(total_paise), 0) from credit_notes where tenant_id = '${T}' and note_date >= date_trunc('month', '${today}'::date) and note_date <= '${today}' and state in ('issued', 'applied')) mtd_credited,
         (select coalesce(sum(taxable_paise), 0) from invoices where tenant_id = '${T}' and invoice_date >= date_trunc('month', '${today}'::date) and invoice_date <= '${today}' and state not in ('draft', 'cancelled')) mtd_taxable,
         (select count(*) from approvals where tenant_id = '${T}' and status = 'pending') approvals,
         (select count(*) from trips where tenant_id = '${T}' and state in ('loading', 'active', 'closing')) active_trips`)
step('SQL for the same figures', sqlD)
cmp('dashboard', 'today invoiced', dash.todayInvoicedPaise, sqlD.invoiced)
cmp('dashboard', 'today credited', dash.todayCreditedPaise, sqlD.credited)
cmp('dashboard', 'today collected (receipts not undone)', dash.todayCollectedPaise, sqlD.collected_live)
cmp('dashboard', 'today orders', dash.todayOrdersCount, sqlD.orders)
cmp('dashboard', 'total outstanding (open bills)', dash.totalOutstandingPaise, sqlD.outstanding)
cmp('dashboard', 'overdue', dash.overduePaise, sqlD.overdue)
cmp('dashboard', 'money on account', dash.onAccountPaise, sqlD.on_account)
cmp('dashboard', 'outstanding − on account vs Sundry Debtors', n(dash.totalOutstandingPaise) - n(dash.onAccountPaise), n(sqlD.ar) - L.q1(`select coalesce(sum(undelivered_paise), 0) s from retailer_outstanding_summary where tenant_id = '${T}'`).s, 'AR less bills on vans')
cmp('dashboard', 'cash in transit vs Cash with delivery crews (book)', dash.cashInTransitPaise, sqlD.cash_van, 'UX-O-14 known: the two can differ')
cmp('dashboard', 'MTD sales', dash.mtdSalesPaise, sqlD.mtd_invoiced, 'invoice totals incl. GST, month to date')
const mtdRoll = L.q1(`select coalesce(sum(invoiced_paise), 0) inv, coalesce(sum(credited_paise), 0) cn from daily_tenant_stats where tenant_id = '${T}' and day >= date_trunc('month', '${today}'::date) and day <= '${today}'`)
cmp('dashboard', 'MTD sales vs Σ daily_tenant_stats.invoiced this month (the rollup it reads)', dash.mtdSalesPaise, mtdRoll.inv)
const mtdDays = L.q(`with d as (select day, invoiced_paise from daily_tenant_stats where tenant_id = '${T}' and day >= date_trunc('month', '${today}'::date) and day <= '${today}'),
  i as (select invoice_date as day, sum(total_paise) q from invoices where tenant_id = '${T}' and invoice_date >= date_trunc('month', '${today}'::date) and invoice_date <= '${today}' and state not in ('draft', 'cancelled') group by 1)
  select coalesce(d.day, i.day)::text as day, d.invoiced_paise rollup, coalesce(i.q, 0) docs from d full join i on i.day = d.day where coalesce(d.invoiced_paise, -1) <> coalesce(i.q, 0) order by 1`)
step('days this month where the rollup differs from the bills', mtdDays)
cmp('dashboard', 'MTD credited', dash.mtdCreditedPaise, sqlD.mtd_credited)
cmp('dashboard', 'pending approvals', dash.pendingApprovals, sqlD.approvals)
cmp('dashboard', 'active trips', dash.activeTrips, sqlD.active_trips)
const buckets = L.q1(`select sum(bucket_0_7_paise) b0, sum(bucket_8_15_paise) b8, sum(bucket_16_30_paise) b16, sum(bucket_31_60_paise) b31, sum(bucket_61_90_paise) b61, sum(bucket_90_plus_paise) b90 from retailer_outstanding_summary where tenant_id = '${T}'`)
for (const [k, v] of Object.entries({ b0_7: 'b0', b8_15: 'b8', b16_30: 'b16', b31_60: 'b31', b61_90: 'b61', b90plus: 'b90' })) cmp('dashboard', `ageing ${k}`, dash.ageing?.[k], buckets[v])
const todayBucket = (dash.last7Days ?? []).find((d) => String(d.bucket).startsWith(today))
if (todayBucket) {
  cmp('dashboard', 'sparkline today invoiced', todayBucket.invoicedPaise, sqlD.invoiced)
  cmp('dashboard', 'sparkline today collected', todayBucket.collectedPaise, sqlD.collected_live)
}
recon('S6-01-dashboard')

// ---- collections register ------------------------------------------------------------------------------------------------
begin('S6-collections', 'Collections register (day and collector) against receipts')
const colDay = await L.must(owner.reporting.registers.collections({ from: today, to: today, groupBy: 'day' }), 'collections day')
const colWho = await L.must(owner.reporting.registers.collections({ from: today, to: today, groupBy: 'collector' }), 'collections collector')
writeFileSync(`${L.EV}s6-collections.json`, JSON.stringify({ colDay, colWho }, null, 2))
step('register (day) as served', JSON.stringify(colDay).slice(0, 1500))
const byMode = L.q(`select mode::text, coalesce(sum(amount_paise) filter (where status in ('collected', 'deposited')), 0) live, coalesce(sum(amount_paise), 0) net, count(*) filter (where reverses_receipt_id is null) n
  from receipts where tenant_id = '${T}' and received_at >= ${start} and received_at < ${endD} group by 1 order by 1`)
step('SQL receipts today by mode (live = not undone; net = incl. reversal mirrors)', byMode)
const row = (colDay.items ?? colDay.rows ?? [])[0] ?? {}
const modeKey = { cash: 'cashPaise', upi: 'upiPaise', bank_transfer: 'bankTransferPaise', cheque: 'chequePaise', adjustment: 'adjustmentPaise' }
for (const m of byMode) cmp('collections', `today ${m.mode}`, row[modeKey[m.mode]], m.live)
cmp('collections', 'receipt count', row.receiptCount, L.q1(`select count(*) n from receipts where tenant_id = '${T}' and status in ('collected', 'deposited') and received_at >= ${start} and received_at < ${endD}`).n)
cmp('collections', 'today total', row.totalPaise ?? row.collectedPaise, byMode.reduce((s, m) => s + n(m.live), 0))
const whoSql = L.q(`select u.username, coalesce(sum(r.amount_paise) filter (where r.status in ('collected', 'deposited')), 0) live from receipts r join users u on u.id = r.received_by where r.tenant_id = '${T}' and r.received_at >= ${start} and r.received_at < ${endD} group by 1 order by 1`)
step('SQL by collector', whoSql)
for (const w of colWho.items ?? colWho.rows ?? []) {
  const name = w.bucketName
  const uid = w.bucket
  const u = L.q1(`select username from users where id = '${uid}'`)
  const s = whoSql.find((x) => x.username === u?.username)
  cmp('collections', `collector ${u?.username ?? name}`, w.totalPaise ?? w.collectedPaise, s?.live ?? 0)
}
recon('S6-02-collections')

// ---- outstanding / ageing register -----------------------------------------------------------------------------------------
begin('S6-ageing', 'Outstanding / ageing register (all shops) against the documents')
const regRows = []
let cursor
do {
  const r = await L.must(acc.receivables.outstanding.list({ limit: 200, ...(cursor ? { cursor } : {}) }), 'outstanding.list')
  regRows.push(...(r.items ?? []))
  cursor = r.nextCursor ?? null
} while (cursor)
step('ageing register rows', regRows.length)
step('a row (keys)', Object.keys(regRows[0] ?? {}))
const docsOut = L.q(`
  with b as (select i.retailer_id, sum(greatest(0, i.total_paise - coalesce((select sum(amount_paise) from allocations a where a.invoice_id = i.id), 0))) filter (where i.undelivered_at is null) dues
               from invoices i where i.tenant_id = '${T}' and i.state in ('issued', 'partially_paid') group by 1)
  select r.id, r.code, coalesce(b.dues, 0) dues from retailers r left join b on b.retailer_id = r.id where r.tenant_id = '${T}'`)
const regById = new Map(regRows.map((x) => [x.retailerId ?? x.id, x]))
const missing = docsOut.filter((d) => d.dues > 0 && !regById.has(d.id))
const wrong = docsOut.filter((d) => regById.has(d.id) && n(regById.get(d.id).outstandingPaise) !== n(d.dues))
step('shops owing but missing from the register', missing.map((d) => `${d.code} ${d.dues}`))
step('shops whose register dues differ from documents', wrong.map((d) => `${d.code} reg ${regById.get(d.id).outstandingPaise} docs ${d.dues}`))
cmp('ageing register', 'Σ dues', regRows.reduce((s, x) => s + n(x.outstandingPaise), 0), docsOut.reduce((s, d) => s + n(d.dues), 0))
cmp('ageing register', 'Σ money on account', regRows.reduce((s, x) => s + n(x.unallocatedCreditPaise), 0), sqlD.on_account)
cmp('ageing register', 'shops listed with dues', regRows.filter((x) => n(x.outstandingPaise) > 0).length, docsOut.filter((d) => d.dues > 0).length)
const onAcctOnly = L.q(`select count(*) n, coalesce(sum(unallocated_credit_paise), 0) s from retailer_outstanding_summary where tenant_id = '${T}' and outstanding_paise = 0 and unallocated_credit_paise > 0`)[0]
step('shops with only money on account (owed money BY the distributor)', onAcctOnly)
const listedOnAcctOnly = regRows.filter((x) => n(x.outstandingPaise) === 0 && n(x.unallocatedCreditPaise) > 0).length
cmp('ageing register', 'shops holding only money on account, listed', listedOnAcctOnly, onAcctOnly.n, 'a shop the distributor owes')
recon('S6-03-ageing')

// ---- trial balance -----------------------------------------------------------------------------------------------------------
begin('S6-trial-balance', 'Trial balance (chart of accounts with balances) against the journal')
const tb = await L.must(acc.receivables.accounts.list({ withBalances: true }), 'accounts')
writeFileSync(`${L.EV}s6-trial-balance.json`, JSON.stringify(tb, null, 2))
const tbRows = tb.items ?? tb
const sqlTb = L.q(`select a.code, coalesce(sum(l.amount_paise), 0) bal from accounts a left join journal_lines l on l.account_id = a.id where a.tenant_id = '${T}' group by 1 order by 1`)
for (const a of sqlTb) {
  const s = tbRows.find((x) => x.code === a.code)
  cmp('trial balance', a.code, s?.balancePaise ?? s?.balance, a.bal)
}
cmp('trial balance', 'total of all balances', tbRows.reduce((s, x) => s + n(x.balancePaise ?? x.balance), 0), 0)
cmp('trial balance', 'Sundry Debtors vs Σ shop nets (docs)', tbRows.find((x) => x.code === 'AR')?.balancePaise, L.q1(`select sum(outstanding_paise + undelivered_paise - unallocated_credit_paise) s from retailer_outstanding_summary where tenant_id = '${T}'`).s)
const upi = tbRows.find((x) => x.code === 'UPI')
step('UPI clearing balance (never banked — DOS-256 known)', { upi: upi?.balancePaise, upiReceiptsToday: byMode.find((m) => m.mode === 'upi') })
recon('S6-04-trial-balance')

// ---- sales register + GST register ---------------------------------------------------------------------------------------------
begin('S6-sales-gst', 'Sales register and GST registers (billing and reporting doors) for today')
const sr = []
cursor = undefined
do {
  const r = await L.must(owner.billing.registers.salesRegister({ from: today, to: today, limit: 200, ...(cursor ? { cursor } : {}) }), 'salesRegister')
  sr.push(...(r.items ?? []))
  cursor = r.nextCursor ?? null
} while (cursor)
const srSql = L.q1(`select count(*) n, coalesce(sum(total_paise) filter (where state <> 'cancelled'), 0) total, coalesce(sum(taxable_paise) filter (where state <> 'cancelled'), 0) taxable from invoices where tenant_id = '${T}' and invoice_date = '${today}' and state <> 'draft'`)
cmp('sales register', 'rows (incl. the cancelled bill)', sr.length, srSql.n)
cmp('sales register', 'Σ total', sr.reduce((s, x) => s + n(x.totalPaise), 0), srSql.total)
cmp('sales register', 'Σ taxable', sr.reduce((s, x) => s + n(x.taxablePaise), 0), srSql.taxable)
const g1 = await L.must(owner.billing.registers.gstSummary({ from: today, to: today, groupBy: 'rate' }), 'gstSummary')
const g2 = await L.must(owner.reporting.registers.gstSalesRegister({ from: today, to: today, groupBy: 'rate' }), 'gstSalesRegister')
const h = await L.must(owner.billing.registers.gstSummary({ from: today, to: today, groupBy: 'hsn' }), 'gstSummary hsn')
writeFileSync(`${L.EV}s6-gst.json`, JSON.stringify({ billing: g1, reporting: g2, hsn: h }, null, 2))
const gl = L.q1(`select coalesce(sum(il.taxable_paise), 0) taxable, coalesce(sum(il.cgst_paise), 0) cgst, coalesce(sum(il.sgst_paise), 0) sgst, coalesce(sum(il.igst_paise), 0) igst, coalesce(sum(il.cess_paise), 0) cess, count(distinct i.id) docs
  from invoice_lines il join invoices i on i.id = il.invoice_id where i.tenant_id = '${T}' and i.invoice_date = '${today}' and i.state not in ('draft', 'cancelled')`)
const cl = L.q1(`select coalesce(sum(taxable_paise), 0) taxable, coalesce(sum(cgst_paise), 0) cgst, coalesce(sum(sgst_paise), 0) sgst, coalesce(sum(igst_paise), 0) igst, coalesce(sum(cess_paise), 0) cess, count(*) docs from credit_notes where tenant_id = '${T}' and note_date = '${today}' and state in ('issued', 'applied')`)
const docsIssued = L.q1(`select count(*) n from invoices where tenant_id = '${T}' and invoice_date = '${today}' and state <> 'draft'`).n
for (const [label, g] of [['GST (billing)', g1], ['GST (reporting)', g2], ['GST by HSN', h]]) {
  cmp(label, 'taxable', g.totals?.taxablePaise, gl.taxable)
  cmp(label, 'CGST', g.totals?.cgstPaise, gl.cgst)
  cmp(label, 'SGST', g.totals?.sgstPaise, gl.sgst)
  cmp(label, 'IGST', g.totals?.igstPaise, gl.igst)
  cmp(label, 'cess', g.totals?.cessPaise, gl.cess)
  cmp(label, 'documents (bills issued today, excl. cancelled)', g.totals?.documentCount, gl.docs)
  cmp(label, 'credit notes taxable', g.creditNoteTotals?.taxablePaise, cl.taxable)
  cmp(label, 'credit notes tax (CGST+SGST+IGST+cess)', n(g.creditNoteTotals?.cgstPaise) + n(g.creditNoteTotals?.sgstPaise) + n(g.creditNoteTotals?.igstPaise) + n(g.creditNoteTotals?.cessPaise), n(cl.cgst) + n(cl.sgst) + n(cl.igst) + n(cl.cess))
  cmp(label, 'credit notes documents', g.creditNoteTotals?.documentCount, cl.docs)
}
step('bills issued today incl. the cancelled one (GSTR-1 table 13 counts it)', docsIssued)
recon('S6-05-sales-gst')

// ---- daily sales register + series ----------------------------------------------------------------------------------------------
begin('S6-rollups', 'Daily sales register and the collections series (both read the rollups) against the documents')
const ds = await L.must(owner.reporting.dailyStats.tenant({ from: today, to: today }), 'dailySales')
const dsRow = (ds.items ?? [])[0] ?? {}
step('daily sales register today', dsRow)
cmp('daily sales register', 'invoiced', dsRow.invoicedPaise, sqlD.invoiced)
cmp('daily sales register', 'collected', dsRow.collectedPaise, sqlD.collected_live)
cmp('daily sales register', 'credited', dsRow.creditedPaise, sqlD.credited)
const series = await L.must(owner.reporting.series.collections({ from: today, to: today, grain: 'day' }), 'series collections')
step('collections series', JSON.stringify(series).slice(0, 800))
recon('S6-06-rollups')

begin('S6-summary', 'Every figure that differs')
const bad = diffs.filter((d) => d.diff !== 0)
step('figures compared', diffs.length)
step('figures that differ', bad)
writeFileSync(`${L.EV}s6-report-diffs.json`, JSON.stringify(diffs, null, 2))
save('results-s6.json')
