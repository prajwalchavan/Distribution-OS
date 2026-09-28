/**
 * `pnpm check:stranded` — the release check of the stock-states lane (QA phases 10 + 9, architect rulings of
 * 2026-09-28): does any document still stand in a state the product can no longer produce, or (the last
 * check) hold stock no order can pack out of?
 *
 * The fixes refuse each of these at the moment it would happen; a database written before them (a QA lane, a
 * restored dump, a pilot distributor) may still hold one, and nothing moves it on by itself. No migration
 * rewrites them — each needs a person to look (a credit note, a count, a cancel) — so this names every one and
 * exits 1 while any is left:
 *
 *   dispatched-no-bill       an order dispatched, delivered or part-delivered with no live bill (QA DOS-355:
 *                            a pack without a bill is no longer loaded)
 *   dispatched-no-trip       an order dispatched whose bill rides no trip that is planned, loading or on the road
 *                            (QA DOS-354 / DOS-355: loaded on a sheet of no trip, or of a trip since cancelled)
 *   dispatched-off-its-trip  an order dispatched and planned on a trip that has not settled, but counted out on
 *                            no confirmed load sheet of THAT trip — its pieces went onto another load, or none
 *                            (QA DOS-354 verify: a sheet takes only its own trip's bills; the trip will not
 *                            depart with it: check that trip in and load the bill again)
 *   trip-cancelled-loaded    a trip cancelled after its load-out was confirmed, with the bills on that sheet
 *                            (QA DOS-354: a loaded trip is checked in, not cancelled)
 *   pick-edited-after-pack   a packed order line whose recorded pick no longer equals what its pack moved off
 *                            the rack (QA DOS-361: a packed order's pick is not edited)
 *   bill-of-expired-batch    a live bill carrying a batch whose expiry date is before the day the bill was
 *                            issued (IST) or its own date, whichever is later — a bill dated back to before
 *                            the expiry still sold expired goods (QA DOS-351: expired goods are never billed);
 *                            a brand-DMS import is the brand's own bill, recorded, and is not listed
 *   batch-over-held          a batch at a godown holding more pieces for orders than stand there, with the orders
 *                            that hold them (QA DOS-353: a pick takes only its own held pieces plus free ones; a
 *                            count or a write-off of held pieces leaves the same, and needs the same look)
 *   packed-unbilled-expired  a packed order with no live bill whose pack holds pieces of a batch that has expired
 *                            since (vans and trips 4: the desk Unpacks it or Cancels the order on the billing desk)
 *   trip-holds-dead-bill     a trip not yet settled that still carries a bill which cannot go out — delivered,
 *                            part-delivered, closed or cancelled (vans and trips 3: its check-in takes it off)
 *   dispatched-not-on-van    a dispatched bill riding a trip whose van holds fewer pieces of a batch than the bills
 *                            riding on it need — the pieces were swept off it (vans and trips 1 and 2)
 *   van-stock-no-trip        a van holding pieces while no trip of it is loading, out, checked in or loaded —
 *                            its last settlement left them there, or another took them for its own (van stock a
 *                            trip-less sheet counted onto the van since its last settlement is not listed: the
 *                            product accepts that sheet, and the van's next trip settles it)
 *   packed-billed-not-on-dock  a packed order with a live bill whose batch the dock holds fewer pieces of than the
 *                            packed bills waiting there need — sold off a van, or swept away while it rode another
 *                            trip's van (QA verify 3, X1); a bill that came back and still rides a van that has not
 *                            been settled is not listed
 *
 * Reads every tenant of `DATABASE_URL` (loaded through `loadDotenv()` like every script here, a real env var
 * wins) as the connection's own role, so run it with the migration owner, like `pnpm check:stock-cancels`.
 * `--tenant <slug>` looks at one distributor only (a dev database also holds every spec's own tenants, whose
 * fixtures drive the API directly). `--json` prints the rows instead of sentences. Exit code 1 while anything
 * is listed, 0 otherwise.
 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sql } from 'drizzle-orm'
import { createDb, createPool, loadDotenv } from '../libs/database/src/index.js'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
loadDotenv(root)
const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set (backend/.env or the environment)')
  process.exit(2)
}

/** stdout, one line: the report IS the output (no-console allows only warn and error). */
const say = (line: string): void => {
  process.stdout.write(`${line}\n`)
}

interface Finding {
  kind: string
  tenant: string
  document: string
  detail: string
}

/** Each check: its kind, and the query whose rows are (tenant, document, detail). */
const CHECKS: { kind: string; query: ReturnType<typeof sql> }[] = [
  {
    kind: 'dispatched-no-bill',
    query: sql`
      select t.slug as tenant, coalesce(o.order_no, o.id) as document,
             'order is ' || o.state::text || ' and has no live bill' as detail
        from sales_orders o join tenants t on t.id = o.tenant_id
       where o.state in ('dispatched', 'delivered', 'partially_delivered') and o.source <> 'van_sale'
         and not exists (select 1 from invoices i
                          where i.order_id = o.id and i.state not in ('cancelled', 'draft'))
       order by t.slug, o.order_no`,
  },
  {
    kind: 'dispatched-no-trip',
    query: sql`
      select t.slug as tenant, coalesce(o.order_no, o.id) as document,
             'order is dispatched' ||
             coalesce(' (bill ' || (select string_agg(coalesce(i.invoice_no, i.id), ', ') from invoices i
                                     where i.order_id = o.id and i.state not in ('cancelled', 'draft')) || ')', '') ||
             ' but rides no trip that is planned, loading or on the road' ||
             coalesce('; last trip ' || (select tr.trip_no || ' (' || tr.state::text || ')'
                                           from deliveries d join trips tr on tr.id = d.trip_id
                                          where d.order_id = o.id order by d.created_at desc, d.id desc limit 1), '') as detail
        from sales_orders o join tenants t on t.id = o.tenant_id
       where o.state = 'dispatched'
         and not exists (select 1 from deliveries d join trips tr on tr.id = d.trip_id
                          where d.order_id = o.id and d.outcome is null
                            and tr.state in ('planned', 'loading', 'active'))
       order by t.slug, o.order_no`,
  },
  {
    kind: 'dispatched-off-its-trip',
    query: sql`
      select t.slug as tenant, coalesce(o.order_no, o.id) as document,
             'order is dispatched' ||
             coalesce(' (bill ' || (select string_agg(coalesce(i.invoice_no, i.id), ', ') from invoices i
                                     where i.order_id = o.id and i.state not in ('cancelled', 'draft')) || ')', '') ||
             ' and planned on ' || coalesce(tr.trip_no, tr.id) || ' (' || tr.state::text || '), but no confirmed load sheet of ' ||
             coalesce(tr.trip_no, tr.id) || ' carries it' ||
             coalesce('; it was counted out on ' || (select string_agg(coalesce(ls.challan_no, ls.id) ||
                                                                       coalesce(' (' || other.trip_no || ')', ' (no trip)'), ', ')
                                                      from load_sheets ls left join trips other on other.id = ls.trip_id
                                                     where ls.tenant_id = o.tenant_id and ls.status = 'confirmed'
                                                       and ls.order_ids @> jsonb_build_array(o.id)), '') as detail
        from sales_orders o join tenants t on t.id = o.tenant_id
        join deliveries d on d.order_id = o.id and d.outcome is null
        join trips tr on tr.id = d.trip_id and tr.state in ('planned', 'loading', 'active')
       where o.state = 'dispatched'
         and not exists (select 1 from load_sheets ls
                          where ls.trip_id = tr.id and ls.status = 'confirmed'
                            and ls.order_ids @> jsonb_build_array(o.id))
       order by t.slug, o.order_no`,
  },
  {
    kind: 'trip-cancelled-loaded',
    query: sql`
      select t.slug as tenant, coalesce(tr.trip_no, tr.id) as document,
             'trip cancelled after load-out ' || coalesce(ls.challan_no, ls.id) ||
             coalesce('; bills on it: ' || (select string_agg(coalesce(i.invoice_no, o.order_no, o.id) || ' (' || o.state::text || ')', ', ')
                                             from jsonb_array_elements_text(ls.order_ids) x
                                             join sales_orders o on o.id = x.value
                                             left join invoices i on i.order_id = o.id and i.state not in ('cancelled', 'draft')), '') as detail
        from trips tr join tenants t on t.id = tr.tenant_id
        join load_sheets ls on ls.trip_id = tr.id and ls.status = 'confirmed'
       where tr.state = 'cancelled'
       order by t.slug, tr.trip_no`,
  },
  {
    kind: 'pick-edited-after-pack',
    query: sql`
      with picked as (
        select pl.tenant_id, pl.order_id, pl.order_line_id, sum(pl.picked_qty_pcs)::bigint as picked
          from pick_lines pl
         where pl.cancelled_at is null and (pl.picked_at is not null or pl.picked_qty_pcs > 0)
         group by 1, 2, 3),
      moved as (
        select l.tenant_id, split_part(l.idempotency_key, ':', 2) as order_id,
               split_part(l.idempotency_key, ':', 3) as order_line_id, -sum(l.qty_delta)::bigint as moved
          from stock_ledger l
         -- the pack's rack legs, less what an unpack put back (vans and trips 4)
         where (l.ref_type = 'pack' and l.qty_delta < 0 and l.idempotency_key like 'pack:%')
            or (l.ref_type = 'unpack' and l.qty_delta > 0 and l.idempotency_key like 'unpack:%')
         group by 1, 2, 3)
      select t.slug as tenant, coalesce(o.order_no, o.id) as document,
             'line ' || ol.line_no || ': the pick records ' || p.picked || ' pc, the pack moved ' ||
             coalesce(m.moved, 0) || ' pc' || coalesce(' (bill ' || i.invoice_no || ')', '') as detail
        from picked p
        join pack_confirmations pc on pc.order_id = p.order_id
        join sales_orders o on o.id = p.order_id
        join sales_order_lines ol on ol.id = p.order_line_id
        join tenants t on t.id = o.tenant_id
        left join invoices i on i.id = pc.invoice_id
        left join moved m on m.tenant_id = p.tenant_id and m.order_id = p.order_id and m.order_line_id = p.order_line_id
       where p.picked <> coalesce(m.moved, 0)
       order by t.slug, o.order_no, ol.line_no`,
  },
  {
    kind: 'bill-of-expired-batch',
    query: sql`
      select t.slug as tenant, coalesce(i.invoice_no, i.id) as document,
             'dated ' || i.invoice_date || ', issued ' ||
             coalesce(((i.issued_at at time zone 'Asia/Kolkata')::date)::text, '(not recorded)') || ': ' ||
             (il.qty_pcs + il.free_qty_pcs) || ' pc of ' || il.description ||
             ' batch ' || coalesce(nullif(il.batch_no, ''), '(none)') || ' expired on ' || il.expiry_date as detail
        from invoices i join invoice_lines il on il.invoice_id = i.id join tenants t on t.id = i.tenant_id
       where i.state not in ('cancelled', 'draft') and il.expiry_date is not null
         and i.source <> 'brand_dms_import'
         and il.expiry_date < greatest(i.invoice_date, (i.issued_at at time zone 'Asia/Kolkata')::date)
       order by t.slug, i.invoice_no, il.line_no`,
  },
  {
    kind: 'batch-over-held',
    query: sql`
      select t.slug as tenant, v.name || ' batch ' || coalesce(nullif(lot.batch_no, ''), '(none)') || ' at ' || loc.name as document,
             b.reserved || ' pc held for orders, ' || b.on_hand || ' on hand' ||
             coalesce('; held for ' || (select string_agg(distinct coalesce(o.order_no, o.id), ', ')
                                          from reservations r
                                          join sales_order_lines ol on ol.id = r.order_line_id
                                          join sales_orders o on o.id = ol.order_id
                                         where r.lot_id = b.lot_id and r.location_id = b.location_id
                                           and r.state = 'pending'), '') as detail
        from stock_balances b
        join locations loc on loc.id = b.location_id
        join stock_lots lot on lot.id = b.lot_id
        join product_variants v on v.id = lot.variant_id
        join tenants t on t.id = b.tenant_id
       where loc.kind = 'warehouse' and b.reserved > b.on_hand
       order by t.slug, v.name`,
  },
  {
    kind: 'packed-unbilled-expired',
    query: sql`
      select t.slug as tenant, coalesce(o.order_no, o.id) as document,
             'packed with no bill, and ' || p.pcs || ' pc of ' || v.name || ' batch ' ||
             coalesce(nullif(lot.batch_no, ''), '(none)') || ' in its cartons expired on ' || lot.expiry_date ||
             ': Unpack it or Cancel the order on the billing desk' as detail
        from sales_orders o
        join tenants t on t.id = o.tenant_id
        join lateral (
          select l.lot_id,
                 -sum(l.qty_delta) filter (where (l.ref_type = 'pack' and l.qty_delta < 0)
                                             or (l.ref_type = 'unpack' and l.qty_delta > 0))::bigint as pcs
            from stock_ledger l
           where l.tenant_id = o.tenant_id and l.ref_type in ('pack', 'unpack') and l.ref_id = o.id
           group by l.lot_id) p on p.pcs > 0
        join stock_lots lot on lot.id = p.lot_id
        join product_variants v on v.id = lot.variant_id
       where o.state = 'packed'
         and not exists (select 1 from invoices i
                          where i.order_id = o.id and i.state not in ('cancelled', 'draft'))
         and lot.expiry_date < (now() at time zone 'Asia/Kolkata')::date
       order by t.slug, o.order_no`,
  },
  {
    kind: 'trip-holds-dead-bill',
    query: sql`
      select t.slug as tenant, coalesce(tr.trip_no, tr.id) as document,
             'trip is ' || tr.state::text || ' and still carries ' || coalesce(i.invoice_no, i.id) ||
             case when i.state = 'cancelled' then ', a cancelled bill'
                  else ' (order ' || coalesce(o.order_no, o.id) || ' is ' || o.state::text || ')' end ||
             ', which cannot go out: its check-in takes it off the trip' as detail
        from deliveries d
        join trips tr on tr.id = d.trip_id
        join tenants t on t.id = tr.tenant_id
        join invoices i on i.id = d.invoice_id
        left join sales_orders o on o.id = d.order_id
       where d.outcome is null and tr.state in ('planned', 'loading', 'active', 'closing')
         and (i.state in ('cancelled', 'draft')
              or o.state in ('delivered', 'partially_delivered', 'closed', 'cancelled'))
       order by t.slug, tr.trip_no`,
  },
  {
    kind: 'dispatched-not-on-van',
    query: sql`
      with riding as (
        select tr.tenant_id, v.location_id as van, v.reg_no, tr.trip_no, o.order_no, i.invoice_no,
               il.lot_id, (il.qty_pcs + il.free_qty_pcs)::bigint as pcs
          from deliveries d
          join trips tr on tr.id = d.trip_id and tr.state in ('planned', 'loading', 'active')
          join vehicles v on v.id = tr.vehicle_id
          join sales_orders o on o.id = d.order_id and o.state = 'dispatched'
          join invoices i on i.id = d.invoice_id and i.state not in ('cancelled', 'draft')
          join invoice_lines il on il.invoice_id = i.id and il.lot_id is not null
         where d.outcome is null),
      short as (
        select r.tenant_id, r.van, r.lot_id, sum(r.pcs)::bigint as need, coalesce(max(b.on_hand), 0)::bigint as have
          from riding r
          left join stock_balances b on b.tenant_id = r.tenant_id and b.location_id = r.van and b.lot_id = r.lot_id
         group by 1, 2, 3)
      select t.slug as tenant, coalesce(r.invoice_no, r.order_no) as document,
             'dispatched on ' || coalesce(r.trip_no, '(no number)') || ', but ' || r.reg_no || ' holds ' || s.have ||
             ' pc of ' || v.name || ' batch ' || coalesce(nullif(lot.batch_no, ''), '(none)') ||
             ' and the bills riding on it need ' || s.need as detail
        from short s
        join riding r on r.tenant_id = s.tenant_id and r.van = s.van and r.lot_id = s.lot_id
        join stock_lots lot on lot.id = s.lot_id
        join product_variants v on v.id = lot.variant_id
        join tenants t on t.id = s.tenant_id
       where s.have < s.need
       order by t.slug, r.invoice_no`,
  },
  {
    kind: 'van-stock-no-trip',
    query: sql`
      select t.slug as tenant, v.reg_no as document,
             sum(b.on_hand)::bigint || ' pc in ' || count(*) || ' batch(es) stand on the van and no trip of it is ' ||
             'loading, out, checked in or loaded' ||
             coalesce('; its last trip ' || (select coalesce(tr.trip_no, tr.id) || ' is ' || tr.state::text
                                              from trips tr where tr.vehicle_id = v.id
                                             order by tr.trip_date desc, tr.id desc limit 1), '') as detail
        from vehicles v
        join tenants t on t.id = v.tenant_id
        join stock_balances b on b.location_id = v.location_id and b.on_hand > 0
       where not exists (select 1 from trips tr
                          where tr.vehicle_id = v.id and tr.state in ('loading', 'active', 'closing'))
         and not exists (select 1 from trips tr join load_sheets ls on ls.trip_id = tr.id and ls.status = 'confirmed'
                          where tr.vehicle_id = v.id and tr.state = 'planned')
         -- van stock a trip-less sheet counted onto the van since its last settlement: the van's next trip takes it
         and not exists (select 1 from load_sheets ls
                          where ls.tenant_id = v.tenant_id and ls.to_location_id = v.location_id
                            and ls.status = 'confirmed' and ls.trip_id is null
                            and ls.confirmed_at > coalesce((select max(tr.updated_at) from trips tr
                                                              where tr.vehicle_id = v.id
                                                                and tr.state in ('settled', 'settled_with_variance')),
                                                           '-infinity'::timestamptz))
       group by t.slug, v.id, v.reg_no
       order by t.slug, v.reg_no`,
  },
  {
    kind: 'packed-billed-not-on-dock',
    query: sql`
      with bill as (
        select o.tenant_id, o.id as order_id, o.order_no, i.invoice_no, il.lot_id,
               sum(il.qty_pcs + il.free_qty_pcs)::bigint as need
          from sales_orders o
          join invoices i on i.order_id = o.id and i.state not in ('cancelled', 'draft') and i.source = 'pack'
          join invoice_lines il on il.invoice_id = i.id and il.lot_id is not null
         where o.state = 'packed'
           -- a bill that came back rides its van until the van check-in and the settlement stage it on the dock
           and not exists (select 1 from deliveries d join trips tr on tr.id = d.trip_id
                            where d.invoice_id = i.id and d.outcome = 'failed' and tr.state in ('active', 'closing'))
         group by 1, 2, 3, 4, 5),
      short as (
        select b.tenant_id, b.lot_id, sum(b.need)::bigint as need,
               coalesce((select sum(bal.on_hand) from stock_balances bal
                           join locations loc on loc.id = bal.location_id and loc.kind = 'in_transit'
                          where bal.tenant_id = b.tenant_id and bal.lot_id = b.lot_id), 0)::bigint as have
          from bill b
         group by 1, 2)
      select t.slug as tenant, coalesce(b.invoice_no, b.order_no, b.order_id) as document,
             'order ' || coalesce(b.order_no, b.order_id) || ' is packed and billed, but the dock holds ' || s.have ||
             ' pc of ' || v.name || ' batch ' || coalesce(nullif(lot.batch_no, ''), '(none)') ||
             ' and the packed bills waiting there need ' || s.need || ': pieces left the dock another way' as detail
        from short s
        join bill b on b.tenant_id = s.tenant_id and b.lot_id = s.lot_id
        join stock_lots lot on lot.id = s.lot_id
        join product_variants v on v.id = lot.variant_id
        join tenants t on t.id = s.tenant_id
       where s.have < s.need
       order by t.slug, b.invoice_no`,
  },
]

const tenantAt = process.argv.indexOf('--tenant')
const onlyTenant = tenantAt >= 0 ? process.argv[tenantAt + 1] : undefined

const pool = createPool(url, 1)
try {
  const db = createDb(pool)
  const findings: Finding[] = []
  for (const check of CHECKS) {
    const rows = (await db.execute(check.query)).rows as {
      tenant: string
      document: string
      detail: string
    }[]
    for (const r of rows)
      if (onlyTenant === undefined || r.tenant === onlyTenant)
        findings.push({
          kind: check.kind,
          tenant: r.tenant,
          document: r.document,
          detail: r.detail,
        })
  }
  if (process.argv.includes('--json')) {
    say(JSON.stringify(findings, null, 2))
  } else if (findings.length === 0) {
    say(
      'no stranded document: every order, bill, trip and pick is in a state the product can reach',
    )
  } else {
    for (const f of findings) say(`${f.kind.padEnd(26)} ${f.tenant}  ${f.document}: ${f.detail}`)
  }
  if (findings.length > 0) {
    console.error(
      `${String(findings.length)} stranded: each needs a person — a credit note, a count or a cancel — nothing moves them on by itself`,
    )
    process.exitCode = 1
  }
} finally {
  await pool.end()
}
