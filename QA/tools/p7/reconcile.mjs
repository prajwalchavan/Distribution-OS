#!/usr/bin/env node
// Phase 7 money reconciliation — recomputes one tenant's money from SQL and compares every stored/derived figure.
//
//   node QA/tools/p7/reconcile.mjs [--tenant tarsun] [--label baseline] [--db postgres://…/dos_test_p7_money] [--since YYYY-MM-DD] [--strict]
//
// Rows listed verbatim in QA/tools/p7/recon-known.txt (the seed's own defects, and rows of findings already filed, tagged
// 'DOS-nnn|<row>') are printed as KNOWN and do not fail the run; --strict ignores that list.
//
// Exit 0 = every invariant holds · 1 = at least one difference (each named, with its rows) · 2 = could not run.
// Writes QA/evidence/p7/recon-<label>.txt (the full printout) when --label is given.
//
// Invariants (all computed from documents, never from the API):
//  R1 per invoice      total = receipts allocated (cash + realised cash discount) + credit notes applied + write-offs + open;
//                      open >= 0; the stored payment state agrees with open; a cancelled bill holds no money.
//  R2 per shop         open bills (dues) + bills on the van − money on account (receipts + credit notes unmatched)
//                      = Sundry Debtors (AR journal lines for that party) = the stored retailer_outstanding_summary net;
//                      every stored summary field (dues, undelivered, on account, open bills, buckets, overdue) = documents.
//  R3 aggregate        Σ shops = the AR account; no AR line without a party.
//  R4 journal          every entry balances; every document has exactly its entry and the entry carries its header figures.
//  R5 receipts         amount + cash discount = allocated + on account (>= 0) — or the receipt is reversed by an exact mirror
//                      whose allocations undo the original's bill by bill; bounced/cancelled only with a mirror; deposits.
//  R6 crews' cash      per trip: CASH_VAN lines (receipts on the trip, their reversals, the settlement) net to zero once
//                      settled; the settlement's expected cash = float + cash collected − expenses, variance = handed − expected.
//  R7 rollups          daily_tenant_stats / daily_retailer_stats / owner_summary = the documents for the days they cover
//                      (reported separately: STALE when the row was computed before the documents it should count changed).
//  R8 arithmetic       invoice and credit-note headers: taxable + taxes + round-off = total; lines + round-off = total;
//                      |round-off| <= 50 paise; total in whole rupees.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : dflt
}
const SLUG = arg('tenant', 'tarsun')
const LABEL = arg('label', null)
const SINCE = arg('since', '2026-09-28') // R7 judges only the days this run's product code computed; older seeded rollups are counted, not judged
const DB = arg('db', process.env.P7_DB ?? 'postgres://dos:dos@127.0.0.1:5439/dos_test_p7_money')
const dbName = new URL(DB).pathname.slice(1)
if (!/test/.test(dbName)) {
  console.error(`refusing to read ${dbName}: not a test database`)
  process.exit(2)
}
const PSQL = '/opt/homebrew/opt/postgresql@17/bin/psql'
const EV = fileURLToPath(new URL('../../evidence/p7/', import.meta.url))

function q(sql) {
  const out = execFileSync(PSQL, [DB, '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', `select coalesce(json_agg(t), '[]'::json) from (${sql}) t`], {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  })
  return JSON.parse(out.trim() || '[]')
}

const lines = []
const say = (s = '') => lines.push(s)
const failures = []
const stale = []
// Rows already broken on the fresh seed (baseline), listed verbatim in QA/tools/p7/recon-known.txt: shown as KNOWN, never hidden.
// A line may carry a tag before a '|': 'DOS-312|<row text>' names the finding a known row belongs to.
const STRICT = process.argv.includes('--strict') // --strict: ignore recon-known.txt, every broken row fails
const KNOWN_TAG = new Map((!STRICT && existsSync(new URL('./recon-known.txt', import.meta.url)) ? readFileSync(new URL('./recon-known.txt', import.meta.url), 'utf8').split('\n') : []).map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf('|'); return i > 0 && /^[A-Za-z0-9 -]+$/.test(l.slice(0, i)) ? [l.slice(i + 1).trim(), l.slice(0, i)] : [l, 'seed baseline'] }))
const KNOWN = new Set(KNOWN_TAG.keys())
const known = []
function check(id, title, bad, fmt, { soft = false } = {}) {
  const rows = bad.map(fmt)
  const fresh = rows.filter((t) => !KNOWN.has(t.trim()))
  const status = bad.length === 0 ? 'PASS' : fresh.length === 0 ? 'KNOWN' : soft ? 'STALE' : 'FAIL'
  say(`[${status}] ${id} ${title}${bad.length ? ` — ${bad.length} row(s)${fresh.length !== bad.length ? `, ${bad.length - fresh.length} known (seed baseline or a filed finding)` : ''}` : ''}`)
  for (const t of rows.slice(0, 60)) say(`        ${KNOWN.has(t.trim()) ? `(known: ${KNOWN_TAG.get(t.trim())}) ` : ''}${t}`)
  if (rows.length > 60) say(`        … ${rows.length - 60} more`)
  if (fresh.length) (soft ? stale : failures).push(`${id} ${title} (${fresh.length})`)
  else if (bad.length) known.push(`${id} (${bad.length})`)
}
const r = (p) => (p === null || p === undefined ? '—' : (Number(p) / 100).toFixed(2))

const [tenant] = q(`select id, slug from tenants where slug = '${SLUG.replace(/'/g, "''")}'`)
if (!tenant) {
  console.error(`no tenant ${SLUG}`)
  process.exit(2)
}
const T = `'${tenant.id}'`
const today = q(`select to_char((now() at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD') d`)[0].d
say(`Phase 7 reconciliation · db ${dbName} · tenant ${SLUG} (${tenant.id}) · run ${new Date().toISOString()} · IST business date ${today}${LABEL ? ` · label ${LABEL}` : ''}`)
say('')

// ---------- R1 per invoice ----------------------------------------------------------------------------------
const inv = q(`
  with a as (
    select invoice_id,
           coalesce(sum(amount_paise) filter (where receipt_id is not null), 0) rc,
           coalesce(sum(amount_paise) filter (where credit_note_id is not null), 0) cn,
           coalesce(sum(amount_paise) filter (where write_off_id is not null), 0) wo,
           count(*) filter (where num_nonnulls(receipt_id, credit_note_id, write_off_id) <> 1) bad_src
      from allocations where tenant_id = ${T} group by 1),
  cd as (select invoice_id, coalesce(sum(realised_paise), 0) cd from cash_discount_conditions where tenant_id = ${T} and status = 'realised' group by 1)
  select i.id, i.invoice_no, i.state::text state, i.total_paise total, (i.undelivered_at is not null) undelivered,
         coalesce(a.rc, 0) - coalesce(cd.cd, 0) rcpt_cash, coalesce(cd.cd, 0) cash_disc, coalesce(a.cn, 0) cn, coalesce(a.wo, 0) wo,
         i.total_paise - coalesce(a.rc, 0) - coalesce(a.cn, 0) - coalesce(a.wo, 0) open, coalesce(a.bad_src, 0) bad_src
    from invoices i left join a on a.invoice_id = i.id left join cd on cd.invoice_id = i.id
   where i.tenant_id = ${T} and i.state <> 'draft'`)
say(`R1 invoices: ${inv.length} (by state: ${Object.entries(inv.reduce((m, x) => ((m[x.state] = (m[x.state] ?? 0) + 1), m), {})).map(([k, v]) => `${k} ${v}`).join(', ')})`)
const allocated = (x) => x.rcpt_cash + x.cash_disc + x.cn + x.wo
check('R1a', 'invoice total = receipts + cash discount + credit notes + write-offs + open, open >= 0 (no over-allocation)', inv.filter((x) => x.open < 0), (x) => `${x.invoice_no} total ${r(x.total)} = rcpt ${r(x.rcpt_cash)} + cd ${r(x.cash_disc)} + cn ${r(x.cn)} + wo ${r(x.wo)} + open ${r(x.open)} (OVER-ALLOCATED)`)
check('R1b', 'stored payment state agrees with the money on the bill', inv.filter((x) => {
  const al = allocated(x)
  if (x.state === 'paid') return x.open !== 0
  if (x.state === 'issued') return al !== 0
  if (x.state === 'partially_paid') return !(al > 0 && x.open > 0)
  if (x.state === 'written_off') return x.open !== 0
  if (x.state === 'cancelled') return al !== 0
  return false
}), (x) => `${x.invoice_no} state ${x.state} total ${r(x.total)} allocated ${r(allocated(x))} open ${r(x.open)}`)
check('R1c', 'every allocation names exactly one source (receipt | credit note | write-off)', inv.filter((x) => x.bad_src > 0), (x) => `${x.invoice_no} has ${x.bad_src} allocation(s) with ambiguous source`)
const badAllocSrc = q(`
  select a.id, i.invoice_no, a.amount_paise, c.credit_note_no, c.state::text cn_state
    from allocations a join invoices i on i.id = a.invoice_id left join credit_notes c on c.id = a.credit_note_id
   where a.tenant_id = ${T} and a.credit_note_id is not null and c.state not in ('issued', 'applied')`)
check('R1d', 'no money allocated from a draft or cancelled credit note', badAllocSrc, (x) => `${x.invoice_no} ← ${x.credit_note_no ?? 'draft'} (${x.cn_state}) ${r(x.amount_paise)}`)
const cnOver = q(`
  select c.credit_note_no, c.total_paise, coalesce(sum(a.amount_paise), 0) alloc from credit_notes c left join allocations a on a.credit_note_id = c.id
   where c.tenant_id = ${T} group by 1, 2 having coalesce(sum(a.amount_paise), 0) > c.total_paise or coalesce(sum(a.amount_paise), 0) < 0`)
check('R1e', 'a credit note is never allocated beyond its value', cnOver, (x) => `${x.credit_note_no} total ${r(x.total_paise)} allocated ${r(x.alloc)}`)
const woBad = q(`
  select w.id, i.invoice_no, w.amount_paise, coalesce(sum(a.amount_paise), 0) alloc from write_offs w join invoices i on i.id = w.invoice_id
    left join allocations a on a.write_off_id = w.id where w.tenant_id = ${T} group by 1, 2, 3 having coalesce(sum(a.amount_paise), 0) <> w.amount_paise`)
check('R1f', 'a write-off settles exactly its amount on its bill', woBad, (x) => `${x.invoice_no} write-off ${r(x.amount_paise)} allocated ${r(x.alloc)}`)
say('')

// ---------- R2 per shop ---------------------------------------------------------------------------------------
const shops = q(`
  with bills as (
    select i.retailer_id, i.id, i.undelivered_at is not null undelivered, i.invoice_date,
           coalesce(i.due_date, i.invoice_date + make_interval(days => r.credit_days))::date due,
           greatest(0, i.total_paise - coalesce((select sum(amount_paise) from allocations a where a.invoice_id = i.id), 0)) open
      from invoices i join retailers r on r.id = i.retailer_id
     where i.tenant_id = ${T} and i.state in ('issued', 'partially_paid')),
  b as (
    select retailer_id,
           coalesce(sum(open) filter (where not undelivered), 0) dues,
           coalesce(sum(open) filter (where undelivered), 0) undeliv,
           count(*) filter (where not undelivered and open > 0) open_bills,
           coalesce(sum(open) filter (where not undelivered and due < '${today}'), 0) overdue,
           coalesce(sum(open) filter (where not undelivered and ('${today}'::date - due) <= 7), 0) b0,
           coalesce(sum(open) filter (where not undelivered and ('${today}'::date - due) between 8 and 15), 0) b8,
           coalesce(sum(open) filter (where not undelivered and ('${today}'::date - due) between 16 and 30), 0) b16,
           coalesce(sum(open) filter (where not undelivered and ('${today}'::date - due) between 31 and 60), 0) b31,
           coalesce(sum(open) filter (where not undelivered and ('${today}'::date - due) between 61 and 90), 0) b61,
           coalesce(sum(open) filter (where not undelivered and ('${today}'::date - due) > 90), 0) b90,
           min(due) filter (where not undelivered and open > 0) oldest_due
      from bills group by 1),
  rc as (
    select r.retailer_id, sum(r.amount_paise + r.cash_discount_paise) - coalesce(sum(al.x), 0) free, sum(r.amount_paise) net_rcpt, sum(r.cash_discount_paise) cd
      from receipts r left join lateral (select sum(amount_paise) x from allocations a where a.receipt_id = r.id) al on true
     where r.tenant_id = ${T} group by 1),
  cn as (
    select c.retailer_id, sum(c.total_paise - coalesce(al.x, 0)) free, sum(c.total_paise) total
      from credit_notes c left join lateral (select sum(amount_paise) x from allocations a where a.credit_note_id = c.id) al on true
     where c.tenant_id = ${T} and c.state in ('issued', 'applied') group by 1),
  iv as (select retailer_id, sum(total_paise) q from invoices where tenant_id = ${T} and state not in ('draft', 'cancelled') group by 1),
  wo as (select retailer_id, sum(amount_paise) q from write_offs where tenant_id = ${T} group by 1),
  ar as (
    select l.party_id retailer_id, sum(l.amount_paise) q from journal_lines l join accounts a on a.id = l.account_id
     where l.tenant_id = ${T} and a.code = 'AR' group by 1)
  select r.id, r.code, r.name,
         coalesce(b.dues, 0) dues, coalesce(b.undeliv, 0) undeliv, coalesce(b.open_bills, 0) open_bills, coalesce(b.overdue, 0) overdue,
         coalesce(b.b0, 0) b0, coalesce(b.b8, 0) b8, coalesce(b.b16, 0) b16, coalesce(b.b31, 0) b31, coalesce(b.b61, 0) b61, coalesce(b.b90, 0) b90,
         b.oldest_due, coalesce(rc.free, 0) + coalesce(cn.free, 0) on_acct, coalesce(rc.free, 0) rc_free, coalesce(cn.free, 0) cn_free,
         coalesce(iv.q, 0) invoiced, coalesce(cn.total, 0) cn_total, coalesce(rc.net_rcpt, 0) receipts_net, coalesce(rc.cd, 0) cash_disc, coalesce(wo.q, 0) wo,
         coalesce(ar.q, 0) ar,
         s.retailer_id is not null has_summary, s.outstanding_paise s_out, s.undelivered_paise s_und, s.unallocated_credit_paise s_unalloc,
         s.open_bills s_open, s.overdue_paise s_overdue, s.as_of s_as_of,
         s.bucket_0_7_paise s_b0, s.bucket_8_15_paise s_b8, s.bucket_16_30_paise s_b16, s.bucket_31_60_paise s_b31, s.bucket_61_90_paise s_b61, s.bucket_90_plus_paise s_b90
    from retailers r left join b on b.retailer_id = r.id left join rc on rc.retailer_id = r.id left join cn on cn.retailer_id = r.id
    left join iv on iv.retailer_id = r.id left join wo on wo.retailer_id = r.id left join ar on ar.retailer_id = r.id
    left join retailer_outstanding_summary s on s.retailer_id = r.id and s.tenant_id = r.tenant_id
   where r.tenant_id = ${T}`)
for (const s of shops) s.net = s.dues + s.undeliv - s.on_acct
const touched = shops.filter((s) => s.invoiced || s.receipts_net || s.cn_total || s.ar || s.has_summary)
say(`R2 shops: ${shops.length} (${touched.length} with money)`)
check('R2a', 'open bills + bills on the van − money on account = Sundry Debtors (AR) for the shop', shops.filter((s) => s.net !== s.ar), (s) => `${s.code} ${s.name}: dues ${r(s.dues)} + van ${r(s.undeliv)} − on acct ${r(s.on_acct)} = ${r(s.net)} ≠ AR ${r(s.ar)} (diff ${r(s.net - s.ar)})`)
check('R2b', 'documents: invoiced − credit notes − receipts(net) − cash discount − write-offs = net dues', shops.filter((s) => s.invoiced - s.cn_total - s.receipts_net - s.cash_disc - s.wo !== s.net), (s) => `${s.code}: ${r(s.invoiced)} − ${r(s.cn_total)} − ${r(s.receipts_net)} − ${r(s.cash_disc)} − ${r(s.wo)} = ${r(s.invoiced - s.cn_total - s.receipts_net - s.cash_disc - s.wo)} ≠ net ${r(s.net)}`)
check('R2c', 'money on account is never negative (receipts and credit notes not over-allocated)', shops.filter((s) => s.rc_free < 0 || s.cn_free < 0), (s) => `${s.code}: receipts free ${r(s.rc_free)} credit notes free ${r(s.cn_free)}`)
check('R2d', 'stored summary: dues, bills on the van, money on account and open-bill count = documents', touched.filter((s) => !s.has_summary ? (s.dues || s.undeliv || s.on_acct) : s.s_out !== s.dues || s.s_und !== s.undeliv || s.s_unalloc !== s.on_acct || s.s_open !== s.open_bills), (s) => `${s.code} ${s.name}: stored dues ${r(s.s_out)} van ${r(s.s_und)} on acct ${r(s.s_unalloc)} bills ${s.s_open} | docs ${r(s.dues)} / ${r(s.undeliv)} / ${r(s.on_acct)} / ${s.open_bills}`)
check('R2e', 'stored summary: overdue and the six ageing buckets = documents aged to today', touched.filter((s) => s.has_summary && (s.s_overdue !== s.overdue || s.s_b0 !== s.b0 || s.s_b8 !== s.b8 || s.s_b16 !== s.b16 || s.s_b31 !== s.b31 || s.s_b61 !== s.b61 || s.s_b90 !== s.b90)), (s) => `${s.code}: stored as of ${s.s_as_of} overdue ${r(s.s_overdue)} [${[s.s_b0, s.s_b8, s.s_b16, s.s_b31, s.s_b61, s.s_b90].map(r).join(' ')}] | today ${r(s.overdue)} [${[s.b0, s.b8, s.b16, s.b31, s.b61, s.b90].map(r).join(' ')}]`, { soft: true })
say('')

// ---------- R3 aggregate ------------------------------------------------------------------------------------
const agg = q(`
  select coalesce(sum(l.amount_paise), 0) ar_total, coalesce(sum(l.amount_paise) filter (where l.party_id is null), 0) ar_no_party,
         count(*) filter (where l.party_id is null) lines_no_party
    from journal_lines l join accounts a on a.id = l.account_id where l.tenant_id = ${T} and a.code = 'AR'`)[0]
const sum = (k) => shops.reduce((s, x) => s + Number(x[k] ?? 0), 0)
say(`R3 aggregate: invoiced ${r(sum('invoiced'))} − credit notes ${r(sum('cn_total'))} − receipts(net) ${r(sum('receipts_net'))} − cash discount ${r(sum('cash_disc'))} − write-offs ${r(sum('wo'))}`)
say(`             = dues ${r(sum('dues'))} + on the van ${r(sum('undeliv'))} − on account ${r(sum('on_acct'))} = ${r(sum('net'))}; AR account ${r(agg.ar_total)} (lines without a shop ${agg.lines_no_party}, ${r(agg.ar_no_party)})`)
check('R3a', 'Σ shops net = AR account balance, and every AR line names its shop', sum('net') !== Number(agg.ar_total) || Number(agg.lines_no_party) > 0 ? [agg] : [], (x) => `Σ net ${r(sum('net'))} vs AR ${r(x.ar_total)}; lines without party ${x.lines_no_party}`)
say('')

// ---------- R4 journal --------------------------------------------------------------------------------------
const unbalanced = q(`select e.id, e.ref_type, e.ref_id, sum(l.amount_paise) s from journal_entries e join journal_lines l on l.entry_id = e.id where e.tenant_id = ${T} group by 1, 2, 3 having sum(l.amount_paise) <> 0`)
const empty = q(`select e.id, e.ref_type, e.ref_id from journal_entries e where e.tenant_id = ${T} and not exists (select 1 from journal_lines l where l.entry_id = e.id)`)
const tb = q(`select coalesce(sum(amount_paise), 0) s, count(*) n from journal_lines where tenant_id = ${T}`)[0]
say(`R4 journal: ${tb.n} lines, trial balance total ${r(tb.s)}`)
check('R4a', 'every journal entry balances and has lines; trial balance totals 0', [...unbalanced, ...empty, ...(Number(tb.s) !== 0 ? [{ id: 'TRIAL BALANCE', ref_type: '', s: tb.s }] : [])], (x) => `${x.id} ${x.ref_type}:${x.ref_id ?? ''} sum ${r(x.s ?? 0)}`)
const invJ = q(`
  select i.invoice_no, i.state::text state, i.total_paise, i.subtotal_paise, i.discount_paise, i.cgst_paise, i.sgst_paise, i.igst_paise, i.cess_paise, i.round_off_paise, i.source::text source,
         (select count(*) from journal_entries e where e.ref_id = i.id and e.ref_type in ('invoice', 'opening')) n_entries,
         (select coalesce(sum(l.amount_paise), 0) from journal_entries e join journal_lines l on l.entry_id = e.id join accounts a on a.id = l.account_id where e.ref_id = i.id and e.ref_type in ('invoice', 'opening') and a.code = 'AR' and l.party_id = i.retailer_id) ar,
         (select coalesce(sum(l.amount_paise), 0) from journal_entries e join journal_lines l on l.entry_id = e.id join accounts a on a.id = l.account_id where e.ref_id = i.id and e.ref_type = 'invoice' and a.code = 'SALES') sales,
         (select coalesce(sum(l.amount_paise), 0) from journal_entries e join journal_lines l on l.entry_id = e.id join accounts a on a.id = l.account_id where e.ref_id = i.id and e.ref_type = 'invoice' and a.code = 'DISCOUNTS') disc,
         (select coalesce(sum(l.amount_paise), 0) from journal_entries e join journal_lines l on l.entry_id = e.id join accounts a on a.id = l.account_id where e.ref_id = i.id and e.ref_type = 'invoice' and a.code in ('OUTPUT_CGST','OUTPUT_SGST','OUTPUT_IGST','OUTPUT_CESS')) tax,
         (select coalesce(sum(l.amount_paise), 0) from journal_entries e join journal_lines l on l.entry_id = e.id join accounts a on a.id = l.account_id where e.ref_id = i.id and e.ref_type in ('invoice_cancel', 'invoice_reversal') and a.code = 'AR') ar_cancel
    from invoices i where i.tenant_id = ${T} and i.state <> 'draft'`)
check('R4b', 'each bill has one entry: AR = total, Sales = subtotal, Discounts = discount, output taxes = header taxes', invJ.filter((x) => Number(x.n_entries) !== 1 || Number(x.ar) !== Number(x.total_paise) || (x.source !== 'import' && (Number(x.sales) !== -Number(x.subtotal_paise) || Number(x.disc) !== Number(x.discount_paise) || Number(x.tax) !== -(Number(x.cgst_paise) + Number(x.sgst_paise) + Number(x.igst_paise) + Number(x.cess_paise))))), (x) => `${x.invoice_no} (${x.source}) entries ${x.n_entries} AR ${r(x.ar)} vs total ${r(x.total_paise)}; sales ${r(x.sales)} vs ${r(-x.subtotal_paise)}; disc ${r(x.disc)} vs ${r(x.discount_paise)}; tax ${r(x.tax)} vs ${r(-(Number(x.cgst_paise) + Number(x.sgst_paise) + Number(x.igst_paise) + Number(x.cess_paise)))}`)
check('R4c', 'a cancelled bill has its AR taken back in full; a live bill has none taken back', invJ.filter((x) => (x.state === 'cancelled' ? Number(x.ar_cancel) !== -Number(x.total_paise) : Number(x.ar_cancel) !== 0)), (x) => `${x.invoice_no} ${x.state} AR reversed ${r(x.ar_cancel)} total ${r(x.total_paise)}`)
const cnJ = q(`
  select c.credit_note_no, c.state::text state, c.total_paise, c.taxable_paise,
         (select count(*) from journal_entries e where e.ref_id = c.id and e.ref_type = 'credit_note') n,
         (select coalesce(sum(l.amount_paise), 0) from journal_entries e join journal_lines l on l.entry_id = e.id join accounts a on a.id = l.account_id where e.ref_id = c.id and e.ref_type = 'credit_note' and a.code = 'AR' and l.party_id = c.retailer_id) ar
    from credit_notes c where c.tenant_id = ${T}`)
check('R4d', 'each issued credit note has one entry with AR = −total; a draft or cancelled note has none', cnJ.filter((x) => (['issued', 'applied'].includes(x.state) ? Number(x.n) !== 1 || Number(x.ar) !== -Number(x.total_paise) : Number(x.n) !== 0)), (x) => `${x.credit_note_no ?? '(draft)'} ${x.state} entries ${x.n} AR ${r(x.ar)} total ${r(x.total_paise)}`)
const woJ = q(`
  select w.id, i.invoice_no, w.amount_paise, (select coalesce(sum(l.amount_paise), 0) from journal_lines l join accounts a on a.id = l.account_id where l.entry_id = w.journal_entry_id and a.code = 'AR' and l.party_id = w.retailer_id) ar,
         (select coalesce(sum(l.amount_paise), 0) from journal_lines l join accounts a on a.id = l.account_id where l.entry_id = w.journal_entry_id and a.code = 'BAD_DEBTS') bd
    from write_offs w join invoices i on i.id = w.invoice_id where w.tenant_id = ${T}`)
check('R4e', 'each write-off: AR −amount, Bad debts +amount', woJ.filter((x) => Number(x.ar) !== -Number(x.amount_paise) || Number(x.bd) !== Number(x.amount_paise)), (x) => `${x.invoice_no} write-off ${r(x.amount_paise)} AR ${r(x.ar)} bad debts ${r(x.bd)}`)
say('')

// ---------- R5 receipts --------------------------------------------------------------------------------------
const rc = q(`
  select r.id, r.receipt_no, r.mode::text mode, r.status::text status, r.amount_paise amt, r.cash_discount_paise cd, r.trip_id, r.deposited_at, r.reverses_receipt_id rev_of,
         coalesce((select sum(amount_paise) from allocations a where a.receipt_id = r.id), 0) alloc,
         (select count(*) from journal_entries e where e.ref_id = r.id and e.ref_type in ('receipt', 'receipt_reversal')) n_entries,
         (select coalesce(sum(l.amount_paise), 0) from journal_entries e join journal_lines l on l.entry_id = e.id join accounts a on a.id = l.account_id where e.ref_id = r.id and e.ref_type in ('receipt', 'receipt_reversal') and a.code = 'AR' and l.party_id = r.retailer_id) ar
    from receipts r where r.tenant_id = ${T}`)
const byId = new Map(rc.map((x) => [x.id, x]))
const mirrors = new Map()
for (const x of rc) if (x.rev_of) mirrors.set(x.rev_of, [...(mirrors.get(x.rev_of) ?? []), x])
const originals = rc.filter((x) => !x.rev_of)
const cat = { allocated: 0, on_account: 0, part: 0, reversed: 0 }
const bad5 = []
for (const x of originals) {
  const free = x.amt + x.cd - x.alloc
  const m = mirrors.get(x.id) ?? []
  if (m.length > 1) bad5.push(`${x.receipt_no} reversed ${m.length} times`)
  if (m.length === 1) {
    cat.reversed++
    const y = m[0]
    if (y.amt !== -x.amt || y.cd !== -x.cd) bad5.push(`${x.receipt_no} mirror ${y.receipt_no} amount ${r(y.amt)} cd ${r(y.cd)} ≠ −(${r(x.amt)}, ${r(x.cd)})`)
    if (x.alloc + y.alloc !== 0) bad5.push(`${x.receipt_no} + mirror ${y.receipt_no} leave ${r(x.alloc + y.alloc)} allocated to bills`)
    if (!['cancelled', 'bounced'].includes(x.status)) bad5.push(`${x.receipt_no} reversed but status ${x.status}`)
  } else {
    if (['cancelled', 'bounced'].includes(x.status)) bad5.push(`${x.receipt_no} is ${x.status} with no mirror receipt`)
    if (free < 0) bad5.push(`${x.receipt_no} over-allocated: ${r(x.amt)} + cd ${r(x.cd)} − allocated ${r(x.alloc)} = ${r(free)}`)
    if (free === 0) cat.allocated++
    else if (x.alloc === 0) cat.on_account++
    else cat.part++
  }
  if (x.amt <= 0) bad5.push(`${x.receipt_no} original with non-positive amount ${r(x.amt)}`)
  if (Number(x.n_entries) !== 1 || x.ar !== -(x.amt + x.cd)) bad5.push(`${x.receipt_no} journal entries ${x.n_entries}, AR ${r(x.ar)} ≠ −(amount + cd) ${r(-(x.amt + x.cd))}`)
}
for (const y of rc.filter((x) => x.rev_of)) {
  if (!byId.has(y.rev_of)) bad5.push(`mirror ${y.receipt_no} points at a missing receipt`)
  if (Number(y.n_entries) !== 1 || y.ar !== -(y.amt + y.cd)) bad5.push(`mirror ${y.receipt_no} journal entries ${y.n_entries}, AR ${r(y.ar)} ≠ ${r(-(y.amt + y.cd))}`)
}
say(`R5 receipts: ${originals.length} originals (fully allocated ${cat.allocated}, wholly on account ${cat.on_account}, part allocated + part on account ${cat.part}, reversed ${cat.reversed}); ${rc.length - originals.length} mirrors`)
check('R5a', 'every receipt is fully accounted: allocated + on account (>= 0), or reversed by one exact mirror; one entry each with AR = −(amount + cash discount)', bad5, (s) => s)
const dep = q(`
  select (select coalesce(sum(l.amount_paise), 0) from journal_entries e join journal_lines l on l.entry_id = e.id join accounts a on a.id = l.account_id where e.tenant_id = ${T} and e.ref_type = 'deposit' and a.code = 'BANK') bank_in,
         (select coalesce(sum(amount_paise), 0) from receipts where tenant_id = ${T} and deposited_at is not null and reverses_receipt_id is null) receipts_banked,
         (select count(*) from receipts where tenant_id = ${T} and status = 'deposited' and deposited_at is null) no_date,
         (select count(*) from receipts where tenant_id = ${T} and deposited_at is not null and mode not in ('cash', 'cheque')) wrong_mode`)[0]
check('R5b', 'deposits: Bank debited by deposits = Σ receipts marked banked; only cash/cheque banked', Number(dep.bank_in) !== Number(dep.receipts_banked) || Number(dep.no_date) > 0 || Number(dep.wrong_mode) > 0 ? [dep] : [], (x) => `bank in ${r(x.bank_in)} vs receipts banked ${r(x.receipts_banked)}; deposited without date ${x.no_date}; non cash/cheque banked ${x.wrong_mode}`)
const dupe = q(`
  select mode::text mode, reference, count(*) n, count(distinct retailer_id) shops, string_agg(receipt_no, ',' order by receipt_no) nos from receipts
   where tenant_id = ${T} and reverses_receipt_id is null and status <> 'cancelled' and reference is not null and mode in ('upi', 'bank_transfer')
   group by 1, 2 having count(*) > 1
  union all
  select mode::text, reference, count(*), count(distinct retailer_id), string_agg(receipt_no, ',' order by receipt_no) from receipts
   where tenant_id = ${T} and reverses_receipt_id is null and status <> 'cancelled' and reference is not null and mode = 'cheque'
   group by 1, 2, retailer_id having count(*) > 1`)
check('R5c', 'no live UPI / transfer reference (UTR) used twice anywhere, no cheque number recorded twice for one shop', dupe, (x) => `${x.mode} ${x.reference} recorded ${x.n}× across ${x.shops} shop(s) (${x.nos})`)
say('')

// ---------- R6 crews' cash per trip ----------------------------------------------------------------------------
const trips = q(`
  with cv as (
    select l.amount_paise, e.ref_type, coalesce(r.trip_id, ts.trip_id) trip_id
      from journal_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id
      left join receipts r on e.ref_type in ('receipt', 'receipt_reversal') and r.id = e.ref_id
      left join trip_settlements ts on e.ref_type = 'trip_settlement' and ts.id = e.ref_id
     where l.tenant_id = ${T} and a.code = 'CASH_VAN'),
  per as (select trip_id, sum(amount_paise) net, sum(amount_paise) filter (where ref_type <> 'trip_settlement') into_van, count(*) n from cv group by 1),
  money as (
    -- what the trip held AT ITS SETTLEMENT: originals, less those whose undo was recorded before the settlement
    select r.trip_id,
           coalesce(sum(r.amount_paise) filter (where r.mode = 'cash' and (m.id is null or m.created_at > coalesce(ts.settled_at, 'infinity'))), 0) cash_live,
           coalesce(sum(r.amount_paise) filter (where r.mode = 'upi' and (m.id is null or m.created_at > coalesce(ts.settled_at, 'infinity'))), 0) upi_live
      from receipts r left join receipts m on m.reverses_receipt_id = r.id left join trip_settlements ts on ts.trip_id = r.trip_id
     where r.tenant_id = ${T} and r.trip_id is not null and r.reverses_receipt_id is null group by 1),
  ex as (select trip_id, sum(amount_paise) x from trip_expenses where tenant_id = ${T} group by 1)
  select t.id, t.trip_no, t.state::text state, t.opening_cash_paise float, coalesce(per.net, 0) van_net, coalesce(per.into_van, 0) into_van, coalesce(per.n, 0) n,
         coalesce(m.cash_live, 0) cash_live, coalesce(m.upi_live, 0) upi_live, coalesce(ex.x, 0) expenses,
         s.expected_cash_paise s_exp, s.handed_over_cash_paise s_hand, s.cash_variance_paise s_var, s.upi_collected_paise s_upi, s.expenses_paise s_ex
    from trips t left join per on per.trip_id = t.id left join money m on m.trip_id = t.id left join ex on ex.trip_id = t.id
    left join trip_settlements s on s.trip_id = t.id
   where t.tenant_id = ${T} and (per.trip_id is not null or s.id is not null or m.trip_id is not null)`)
const orphan = q(`
  select e.ref_type, e.ref_id, l.amount_paise from journal_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id
    left join receipts r on e.ref_type in ('receipt', 'receipt_reversal') and r.id = e.ref_id left join trip_settlements ts on e.ref_type = 'trip_settlement' and ts.id = e.ref_id
   where l.tenant_id = ${T} and a.code = 'CASH_VAN' and coalesce(r.trip_id, ts.trip_id) is null`)
say(`R6 trips with money: ${trips.length} (${trips.filter((t) => t.state.startsWith('settled')).length} settled)`)
check('R6a', 'cash with crews nets to zero on every settled trip; nothing left on a trip that has no settlement row', trips.filter((t) => (t.state.startsWith('settled') ? t.van_net !== 0 : false)), (t) => `${t.trip_no} ${t.state}: CASH_VAN net ${r(t.van_net)} (into van ${r(t.into_van)})`)
check('R6b', 'settlement: expected = float + cash collected − expenses; variance = handed over − expected; UPI = UPI collected', trips.filter((t) => t.s_exp !== null && (t.s_exp !== t.float + t.cash_live - t.s_ex || t.s_var !== t.s_hand - t.s_exp || t.s_upi !== t.upi_live)), (t) => `${t.trip_no}: stored expected ${r(t.s_exp)} vs float ${r(t.float)} + cash ${r(t.cash_live)} − exp ${r(t.s_ex)} = ${r(t.float + t.cash_live - t.s_ex)}; variance ${r(t.s_var)} vs ${r(t.s_hand - t.s_exp)}; UPI ${r(t.s_upi)} vs ${r(t.upi_live)}`)
check('R6c', 'every CASH_VAN line belongs to a trip', orphan, (x) => `${x.ref_type}:${x.ref_id} ${r(x.amount_paise)}`)
const banked = q(`
  select t.trip_no, s.handed_over_cash_paise - t.opening_cash_paise office_in, coalesce(sum(r.amount_paise) filter (where r.deposited_at is not null), 0) banked,
         count(*) filter (where r.deposited_at is not null) n_banked, count(*) filter (where r.mode = 'cash' and r.deposited_at is null and r.status = 'collected') n_unbanked
    from trips t join trip_settlements s on s.trip_id = t.id join receipts r on r.trip_id = t.id and r.mode = 'cash' and r.reverses_receipt_id is null
   where t.tenant_id = ${T} group by 1, 2 having coalesce(sum(r.amount_paise) filter (where r.deposited_at is not null), 0) > s.handed_over_cash_paise - t.opening_cash_paise`)
check('R6d', 'a trip\'s banked cash never exceeds the cash its crew handed over (net of the float)', banked, (x) => `${x.trip_no}: handed over (net of float) ${r(x.office_in)} but banked ${r(x.banked)} from ${x.n_banked} receipt(s) — ${r(x.banked - x.office_in)} more than the till received`)
const openTrips = trips.filter((t) => !t.state.startsWith('settled') && t.van_net !== 0)
say(`        (open trips still carrying cash: ${openTrips.map((t) => `${t.trip_no} ${t.state} ${r(t.van_net)}`).join('; ') || 'none'})`)
say('')

// ---------- R7 rollups ----------------------------------------------------------------------------------------
const days = q(`
  with d as (select day, invoiced_paise, collected_paise, credited_paise, computed_at from daily_tenant_stats where tenant_id = ${T}),
  iv as (select invoice_date as day, sum(total_paise) q, max(greatest(created_at, updated_at)) last from invoices where tenant_id = ${T} and state not in ('draft', 'cancelled') group by 1),
  cn as (select note_date as day, sum(total_paise) q, max(greatest(created_at, updated_at)) last from credit_notes where tenant_id = ${T} and state in ('issued', 'applied') group by 1),
  rc as (select (received_at at time zone 'Asia/Kolkata')::date as day, sum(amount_paise) q, max(greatest(created_at, updated_at)) last from receipts where tenant_id = ${T} and status in ('collected', 'deposited') group by 1)
  select coalesce(d.day, iv.day, cn.day, rc.day)::text as day, d.invoiced_paise d_inv, coalesce(iv.q, 0) inv, d.credited_paise d_cn, coalesce(cn.q, 0) cn,
         d.collected_paise d_rc, coalesce(rc.q, 0) rc, d.computed_at, greatest(iv.last, cn.last, rc.last) docs_last
    from d full join iv on iv.day = d.day full join cn on cn.day = coalesce(d.day, iv.day) full join rc on rc.day = coalesce(d.day, iv.day, cn.day)`)
const seededOld = days.filter((d) => d.day < SINCE)
const seededOldBad = seededOld.filter((d) => d.d_inv === null ? d.inv || d.cn || d.rc : d.d_inv !== d.inv || (d.d_cn ?? 0) !== d.cn || d.d_rc !== d.rc)
say(`R7 rollups judged from ${SINCE}; seeded rows before it that differ from documents (information only): ${seededOldBad.length} of ${seededOld.length} days`)
const dayBad = days.filter((d) => d.day >= SINCE).filter((d) => d.d_inv === null ? d.inv || d.cn || d.rc : d.d_inv !== d.inv || (d.d_cn ?? 0) !== d.cn || d.d_rc !== d.rc)
check('R7a', 'daily_tenant_stats (invoiced / credited / collected) = documents of that day', dayBad, (d) => `${d.day}: rollup inv ${r(d.d_inv)} cn ${r(d.d_cn)} rc ${r(d.d_rc)} | docs inv ${r(d.inv)} cn ${r(d.cn)} rc ${r(d.rc)} | computed ${d.computed_at ?? 'never'}; docs changed ${d.docs_last}`, { soft: true })
const rDays = q(`
  with d as (select retailer_id, day, invoiced_paise, collected_paise from daily_retailer_stats where tenant_id = ${T}),
  iv as (select retailer_id, invoice_date as day, sum(total_paise) q from invoices where tenant_id = ${T} and state not in ('draft', 'cancelled') group by 1, 2),
  rc as (select retailer_id, (received_at at time zone 'Asia/Kolkata')::date as day, sum(amount_paise) q from receipts where tenant_id = ${T} and status in ('collected', 'deposited') group by 1, 2)
  select r.code, d.day::text as day, d.invoiced_paise d_inv, coalesce(iv.q, 0) inv, d.collected_paise d_rc, coalesce(rc.q, 0) rc
    from d join retailers r on r.id = d.retailer_id left join iv on iv.retailer_id = d.retailer_id and iv.day = d.day left join rc on rc.retailer_id = d.retailer_id and rc.day = d.day
   where d.day >= '${SINCE}' and (d.invoiced_paise <> coalesce(iv.q, 0) or d.collected_paise <> coalesce(rc.q, 0))`)
check('R7b', 'daily_retailer_stats rows = documents of that shop and day (rows that exist)', rDays, (d) => `${d.code} ${d.day}: rollup inv ${r(d.d_inv)} rc ${r(d.d_rc)} | docs ${r(d.inv)} / ${r(d.rc)}`, { soft: true })
const os = q(`select as_of, total_outstanding_paise, overdue_paise from owner_summary where tenant_id = ${T}`)[0]
if (os) {
  const bad = Number(os.total_outstanding_paise) !== sum('dues') || Number(os.overdue_paise) !== sum('overdue') ? [os] : []
  check('R7c', 'owner_summary outstanding / overdue = Σ open bills / Σ overdue today', bad, (x) => `owner_summary as of ${x.as_of}: outstanding ${r(x.total_outstanding_paise)} overdue ${r(x.overdue_paise)} | docs ${r(sum('dues'))} / ${r(sum('overdue'))}`, { soft: true })
}
say('')

// ---------- R8 arithmetic ------------------------------------------------------------------------------------
const ar = q(`
  select i.invoice_no doc, 'invoice' kind, i.total_paise total, i.taxable_paise + i.cgst_paise + i.sgst_paise + i.igst_paise + i.cess_paise + i.round_off_paise hdr,
         i.subtotal_paise - i.discount_paise taxable_calc, i.taxable_paise, i.round_off_paise ro,
         (select coalesce(sum(line_total_paise), 0) from invoice_lines l where l.invoice_id = i.id) + i.round_off_paise lines
    from invoices i where i.tenant_id = ${T} and i.state <> 'draft' and i.source::text <> 'import'
  union all
  select c.credit_note_no, 'credit_note', c.total_paise, c.taxable_paise + c.cgst_paise + c.sgst_paise + c.igst_paise + c.cess_paise + c.round_off_paise,
         c.taxable_paise, c.taxable_paise, c.round_off_paise, (select coalesce(sum(line_total_paise), 0) from credit_note_lines l where l.credit_note_id = c.id) + c.round_off_paise
    from credit_notes c where c.tenant_id = ${T} and c.state in ('issued', 'applied')`)
check('R8a', 'headers: taxable + CGST + SGST + IGST + cess + round-off = total = Σ lines + round-off; taxable = subtotal − discount', ar.filter((x) => x.hdr !== x.total || x.lines !== x.total || x.taxable_calc !== x.taxable_paise), (x) => `${x.kind} ${x.doc}: total ${r(x.total)} header sum ${r(x.hdr)} lines+ro ${r(x.lines)} taxable ${r(x.taxable_paise)} vs subtotal−discount ${r(x.taxable_calc)}`)
check('R8b', 'round-off within ±50 paise and totals in whole rupees', ar.filter((x) => Math.abs(x.ro) > 50 || x.total % 100 !== 0), (x) => `${x.kind} ${x.doc}: total ${r(x.total)} round-off ${x.ro} paise`)
say('')

say(failures.length === 0 ? `RESULT: RECONCILED${known.length ? ` (known rows: ${known.join('; ')})` : ''}${stale.length ? ` (stale rollups: ${stale.join('; ')})` : ''}` : `RESULT: ${failures.length} INVARIANT(S) BROKEN — ${failures.join('; ')}${stale.length ? ` · stale: ${stale.join('; ')}` : ''}`)
const text = lines.join('\n')
console.log(text)
if (LABEL) writeFileSync(`${EV}recon-${LABEL}.txt`, `${text}\n`)
process.exit(failures.length === 0 ? 0 : 1)
