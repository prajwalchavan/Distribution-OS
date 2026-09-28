#!/usr/bin/env node
// Phase 10 stock reconcile — one tenant, every lot at every location, from SQL only (trusts no stored total).
// usage: node stock-reconcile.mjs [--label name] [--tenant <id>] [--quiet]
// Exit 0 = every check agrees; exit 1 = at least one difference (the offending rows are printed and saved).
//
// Checks
//  C1 on hand: sum(stock_ledger.qty_delta) per (lot, location) = stock_balances.on_hand (both directions: a ledger
//     group with no balance row, a balance row with no ledger).
//  C2 reserved: stock_balances.reserved = sum(pending reservations.qty) per (lot, location); pending rows with no lot.
//  C3 no negative: on_hand < 0 (ANY location, the damaged bin included even though it allows it), reserved < 0,
//     reserved > on_hand.
//  C4 sellable_stock = on_hand − reserved for warehouse and vehicle places only (and > 0), and nothing else in it.
//  C5 references: every ledger row's lot and location exist and are this tenant's; its ref names a real document
//     for the ref types that name one (grn, pack→order, load_sheet, delivery, invoice, invoice_cancel, credit_note,
//     trip_settlement, trip_checkin→trip, cycle_count); unknown ref types are listed.
//  C6 per bill: for every issued (not cancelled) bill, per lot, pieces billed (qty + free) = pieces its pack took
//     out of the godown (pack bills) or out of the van (van-sale bills).
//  C7 per delivery: pieces recorded delivered = pieces sold off the vehicle for that delivery.
//  C8 holds belong to live documents: a pending hold at the godown only for an order confirmed/picking; a pending
//     hold on the dock only for an order that is packed with a live bill.
//  C9 journal: every journal entry balances (sum of lines = 0).
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const arg = (n, d) => {
  const i = args.indexOf(n)
  return i >= 0 ? args[i + 1] : d
}
const TENANT = arg('--tenant', '01a0999a-28c3-7341-93f5-e0e84b0189a1')
const LABEL = arg('--label', `adhoc-${Date.now()}`)
const DB = process.env.P10_DB ?? 'postgres://dos:dos@127.0.0.1:5439/dos_test_p10_stock'
if (!/dos_test_p10_stock$/.test(DB)) throw new Error('refusing: not the p10 test database')
const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const OUT = `${ROOT}QA/evidence/p10/recon/`
mkdirSync(OUT, { recursive: true })

const PSQL = '/opt/homebrew/opt/postgresql@17/bin/psql'
function q(sql) {
  const out = execFileSync(PSQL, [DB, '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', `select coalesce(json_agg(t), '[]'::json) from (${sql}) t`], { encoding: 'utf8', maxBuffer: 1 << 28 }).trim()
  return JSON.parse(out || '[]')
}
const T = `'${TENANT}'`

const checks = {
  C1_ledger_vs_on_hand: `
    with led as (select lot_id, location_id, sum(qty_delta)::bigint s from stock_ledger where tenant_id = ${T} group by 1, 2),
         bal as (select lot_id, location_id, on_hand from stock_balances where tenant_id = ${T})
    select coalesce(led.lot_id, bal.lot_id) lot_id, coalesce(led.location_id, bal.location_id) location_id,
           led.s ledger_sum, bal.on_hand
    from led full join bal on bal.lot_id = led.lot_id and bal.location_id = led.location_id
    where coalesce(led.s, 0) <> coalesce(bal.on_hand, 0) or (bal.lot_id is null and led.s <> 0)`,
  C2_reserved_vs_holds: `
    with h as (select lot_id, location_id, sum(qty)::bigint held from reservations where tenant_id = ${T} and state = 'pending' and lot_id is not null group by 1, 2),
         bal as (select lot_id, location_id, reserved from stock_balances where tenant_id = ${T})
    select coalesce(h.lot_id, bal.lot_id) lot_id, coalesce(h.location_id, bal.location_id) location_id, h.held pending_holds, bal.reserved
    from h full join bal on bal.lot_id = h.lot_id and bal.location_id = h.location_id
    where coalesce(h.held, 0) <> coalesce(bal.reserved, 0)
    union all
    select null, location_id, sum(qty)::bigint, null from reservations where tenant_id = ${T} and state = 'pending' and lot_id is null group by location_id`,
  C3_negative_or_overheld: `
    select b.lot_id, b.location_id, loc.kind::text kind, b.on_hand, b.reserved, b.negative_allowed,
           case when b.on_hand < 0 then 'on_hand<0' when b.reserved < 0 then 'reserved<0' else 'reserved>on_hand' end problem
    from stock_balances b join locations loc on loc.id = b.location_id
    where b.tenant_id = ${T} and (b.on_hand < 0 or b.reserved < 0 or b.reserved > b.on_hand)`,
  C4_sellable_view: `
    with want as (select b.lot_id, b.location_id, b.on_hand - b.reserved avail from stock_balances b join locations loc on loc.id = b.location_id
                  where b.tenant_id = ${T} and loc.kind in ('warehouse', 'vehicle') and b.on_hand - b.reserved > 0),
         got as (select lot_id, location_id, available from sellable_stock where tenant_id = ${T})
    select coalesce(w.lot_id, g.lot_id) lot_id, coalesce(w.location_id, g.location_id) location_id, w.avail expected, g.available in_view,
           (select kind::text from locations where id = coalesce(w.location_id, g.location_id)) kind
    from want w full join got g on g.lot_id = w.lot_id and g.location_id = w.location_id
    where coalesce(w.avail, -1) <> coalesce(g.available, -1)`,
  C5_ledger_references: `
    select l.id, l.reason::text reason, l.ref_type, l.ref_id, l.lot_id, l.location_id,
      case
        when lot.id is null then 'lot missing'
        when lot.tenant_id <> l.tenant_id then 'lot of another tenant'
        when loc.id is null then 'location missing'
        when loc.tenant_id <> l.tenant_id then 'location of another tenant'
        when l.ref_type in ('grn') and not exists (select 1 from grns x where x.id = l.ref_id) then 'grn missing'
        when l.ref_type = 'pack' and not exists (select 1 from sales_orders x where x.id = l.ref_id) then 'pack order missing'
        when l.ref_type = 'load_sheet' and not exists (select 1 from load_sheets x where x.id = l.ref_id) then 'load sheet missing'
        when l.ref_type = 'delivery' and not exists (select 1 from deliveries x where x.id = l.ref_id) then 'delivery missing'
        when l.ref_type in ('invoice', 'invoice_cancel') and not exists (select 1 from invoices x where x.id = l.ref_id) then 'invoice missing'
        when l.ref_type = 'credit_note' and not exists (select 1 from credit_notes x where x.id = l.ref_id) then 'credit note missing'
        when l.ref_type = 'trip_settlement' and not exists (select 1 from trip_settlements x where x.id = l.ref_id)
             and not exists (select 1 from trips x where x.id = l.ref_id) then 'settlement/trip missing'
        when l.ref_type = 'trip_checkin' and not exists (select 1 from trips x where x.id = l.ref_id) then 'trip missing'
        when l.ref_type = 'trip' and not exists (select 1 from trips x where x.id = l.ref_id) then 'trip missing'
        when l.ref_type = 'cycle_count' and not exists (select 1 from cycle_counts x where x.id = l.ref_id) then 'cycle count missing'
        when l.ref_type is null then 'no ref'
        when l.ref_type not in ('grn','pack','load_sheet','delivery','invoice','invoice_cancel','credit_note','trip_settlement','trip_checkin','trip','cycle_count','adjustment','transfer','manual','opening')
             then 'unknown ref type'
      end problem
    from stock_ledger l left join stock_lots lot on lot.id = l.lot_id left join locations loc on loc.id = l.location_id
    where l.tenant_id = ${T}
      and (lot.id is null or loc.id is null or lot.tenant_id <> l.tenant_id or loc.tenant_id <> l.tenant_id
           or (l.ref_type = 'grn' and not exists (select 1 from grns x where x.id = l.ref_id))
           or (l.ref_type = 'pack' and not exists (select 1 from sales_orders x where x.id = l.ref_id))
           or (l.ref_type = 'load_sheet' and not exists (select 1 from load_sheets x where x.id = l.ref_id))
           or (l.ref_type = 'delivery' and not exists (select 1 from deliveries x where x.id = l.ref_id))
           or (l.ref_type in ('invoice', 'invoice_cancel') and not exists (select 1 from invoices x where x.id = l.ref_id))
           or (l.ref_type = 'credit_note' and not exists (select 1 from credit_notes x where x.id = l.ref_id))
           or (l.ref_type = 'trip_settlement' and not exists (select 1 from trip_settlements x where x.id = l.ref_id) and not exists (select 1 from trips x where x.id = l.ref_id))
           or (l.ref_type in ('trip_checkin', 'trip') and not exists (select 1 from trips x where x.id = l.ref_id))
           or (l.ref_type = 'cycle_count' and not exists (select 1 from cycle_counts x where x.id = l.ref_id))
           or l.ref_type is null
           or l.ref_type not in ('grn','pack','load_sheet','delivery','invoice','invoice_cancel','credit_note','trip_settlement','trip_checkin','trip','cycle_count','adjustment','transfer','manual','opening'))`,
  C6_billed_vs_moved: `
    with billed as (select i.id invoice_id, i.invoice_no, i.source::text source, i.order_id, il.lot_id, sum(il.qty_pcs + il.free_qty_pcs)::bigint billed
                    from invoices i join invoice_lines il on il.invoice_id = i.id
                    where i.tenant_id = ${T} and i.state <> 'cancelled' and i.source in ('pack', 'van_sale') group by 1, 2, 3, 4, 5),
         packed as (select l.ref_id order_id, l.lot_id, -sum(l.qty_delta)::bigint moved from stock_ledger l join locations loc on loc.id = l.location_id
                    where l.tenant_id = ${T} and l.ref_type = 'pack' and loc.kind = 'warehouse' group by 1, 2),
         vansold as (select l.ref_id invoice_id, l.lot_id, -sum(l.qty_delta)::bigint moved from stock_ledger l join locations loc on loc.id = l.location_id
                     where l.tenant_id = ${T} and l.ref_type = 'invoice' and l.reason = 'sale' group by 1, 2)
    select b.invoice_no, b.source, b.invoice_id, b.lot_id, b.billed, coalesce(p.moved, v.moved, 0) moved
    from billed b
    left join packed p on b.source = 'pack' and p.order_id = b.order_id and p.lot_id = b.lot_id
    left join vansold v on b.source = 'van_sale' and v.invoice_id = b.invoice_id and v.lot_id = b.lot_id
    where b.billed <> coalesce(p.moved, v.moved, 0)
    union all
    select i.invoice_no, 'pack (moved, not billed)', i.id, p.lot_id, 0, p.moved
    from packed p join invoices i on i.order_id = p.order_id and i.state <> 'cancelled' and i.source = 'pack'
    where p.moved <> 0 and not exists (select 1 from invoice_lines il where il.invoice_id = i.id and il.lot_id = p.lot_id)`,
  C7_delivered_vs_sold: `
    with rec as (select d.id delivery_id, il.lot_id, sum(dl.delivered_qty_pcs)::bigint delivered
                 from deliveries d join delivery_lines dl on dl.delivery_id = d.id join invoice_lines il on il.id = dl.invoice_line_id
                 where d.tenant_id = ${T} and d.outcome is not null group by 1, 2),
         -- the door relieves the van of the whole bill (sale), and the delivery's credit note puts what came back
         -- onto the van (saleable) or into the damaged bin: net sold = sale − those returns
         sold as (select delivery_id, lot_id, sum(q)::bigint sold from (
                    select l.ref_id delivery_id, l.lot_id, -l.qty_delta q from stock_ledger l
                    where l.tenant_id = ${T} and l.ref_type = 'delivery' and l.reason = 'sale'
                    union all
                    select d.id, l.lot_id, -l.qty_delta from stock_ledger l join credit_notes cn on cn.id = l.ref_id
                    -- the product links the note to its delivery; the demo seed's door notes carry no delivery_id,
                    -- so a note on the same bill with no delivery counts for the bill's (single) delivery
                    join deliveries d on d.id = cn.delivery_id or (cn.delivery_id is null and d.invoice_id = cn.invoice_id and d.outcome = 'partial')
                    where l.tenant_id = ${T} and l.ref_type = 'credit_note'
                      and l.reason in ('sale_return_saleable', 'sale_return_damaged')) x group by 1, 2)
    select coalesce(r.delivery_id, s.delivery_id) delivery_id, coalesce(r.lot_id, s.lot_id) lot_id, r.delivered, s.sold net_sold
    from rec r full join sold s on s.delivery_id = r.delivery_id and s.lot_id = r.lot_id
    where coalesce(r.delivered, 0) <> coalesce(s.sold, 0)`,
  C8_holds_on_dead_documents: `
    select r.id, loc.kind::text kind, r.lot_id, r.qty, o.order_no, o.state::text order_state,
           (select string_agg(i.invoice_no || ':' || i.state::text, ',') from invoices i where i.order_id = o.id) bills
    from reservations r join locations loc on loc.id = r.location_id
    join sales_order_lines ol on ol.id = r.order_line_id join sales_orders o on o.id = ol.order_id
    where r.tenant_id = ${T} and r.state = 'pending'
      and ((loc.kind = 'warehouse' and o.state not in ('confirmed', 'picking'))
        or (loc.kind = 'in_transit' and (o.state <> 'packed' or not exists (select 1 from invoices i where i.order_id = o.id and i.state not in ('cancelled', 'draft'))))
        or loc.kind not in ('warehouse', 'in_transit'))`,
  C9_journal_unbalanced: `
    select e.id, e.ref_type, e.ref_id, sum(l.amount_paise)::bigint net from journal_entries e join journal_lines l on l.entry_id = e.id
    where e.tenant_id = ${T} group by 1, 2, 3 having sum(l.amount_paise) <> 0`,
}

const totals = q(`
  select (select count(*) from stock_ledger where tenant_id = ${T}) ledger_rows,
         (select count(*) from stock_balances where tenant_id = ${T}) balance_rows,
         (select count(*) from stock_balances where tenant_id = ${T} and on_hand <> 0) live_balance_rows,
         (select count(distinct lot_id) from stock_balances where tenant_id = ${T}) lots,
         (select coalesce(sum(on_hand), 0) from stock_balances where tenant_id = ${T}) on_hand_total,
         (select coalesce(sum(reserved), 0) from stock_balances where tenant_id = ${T}) reserved_total,
         (select coalesce(sum(qty_delta), 0) from stock_ledger where tenant_id = ${T}) ledger_total,
         (select count(*) from reservations where tenant_id = ${T} and state = 'pending') pending_holds,
         (select json_object_agg(kind, s) from (select loc.kind::text kind, sum(b.on_hand) s from stock_balances b join locations loc on loc.id = b.location_id where b.tenant_id = ${T} group by 1) k) on_hand_by_kind`)[0]

const result = { label: LABEL, at: new Date().toISOString(), tenant: TENANT, totals, checks: {} }
let bad = 0
for (const [name, sql] of Object.entries(checks)) {
  const rows = q(sql)
  result.checks[name] = { differences: rows.length, rows: rows.slice(0, 40) }
  bad += rows.length
}
const lines = [`STOCK RECONCILE ${LABEL} @ ${result.at}`, `totals ${JSON.stringify(totals)}`]
for (const [name, c] of Object.entries(result.checks)) {
  lines.push(`${c.differences === 0 ? 'PASS' : 'FAIL'} ${name}: ${c.differences} difference(s)`)
  for (const r of c.rows) lines.push(`    ${JSON.stringify(r)}`)
}
lines.push(`RESULT: ${bad === 0 ? 'ALL CHECKS PASS' : `${bad} DIFFERENCE ROW(S)`}`)
writeFileSync(`${OUT}${LABEL}.txt`, `${lines.join('\n')}\n`)
if (!args.includes('--quiet')) console.log(lines.join('\n'))
else console.log(lines.filter((l) => !l.startsWith('    ')).join('\n'))
process.exit(bad === 0 ? 0 : 1)
