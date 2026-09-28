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
 *   trip-cancelled-loaded    a trip cancelled after its load-out was confirmed, with the bills on that sheet
 *                            (QA DOS-354: a loaded trip is checked in, not cancelled)
 *   pick-edited-after-pack   a packed order line whose recorded pick no longer equals what its pack moved off
 *                            the rack (QA DOS-361: a packed order's pick is not edited)
 *   bill-of-expired-batch    a live bill carrying a batch whose expiry date is before the bill's own date
 *                            (QA DOS-351: expired goods are never billed)
 *   batch-over-held          a batch at a godown holding more pieces for orders than stand there, with the orders
 *                            that hold them (QA DOS-353: a pick takes only its own held pieces plus free ones; a
 *                            count or a write-off of held pieces leaves the same, and needs the same look)
 *
 * Reads every tenant of `DATABASE_URL` (loaded through `loadDotenv()` like every script here, a real env var
 * wins) as the connection's own role, so run it with the migration owner, like `pnpm check:stock-cancels`.
 * `--json` prints the rows instead of sentences. Exit code 1 while anything is listed, 0 otherwise.
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
         where l.ref_type = 'pack' and l.qty_delta < 0 and l.idempotency_key like 'pack:%'
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
             'dated ' || i.invoice_date || ': ' || (il.qty_pcs + il.free_qty_pcs) || ' pc of ' || il.description ||
             ' batch ' || coalesce(nullif(il.batch_no, ''), '(none)') || ' expired on ' || il.expiry_date as detail
        from invoices i join invoice_lines il on il.invoice_id = i.id join tenants t on t.id = i.tenant_id
       where i.state not in ('cancelled', 'draft') and il.expiry_date is not null
         and il.expiry_date < i.invoice_date
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
]

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
      findings.push({ kind: check.kind, tenant: r.tenant, document: r.document, detail: r.detail })
  }
  if (process.argv.includes('--json')) {
    say(JSON.stringify(findings, null, 2))
  } else if (findings.length === 0) {
    say(
      'no stranded document: every order, bill, trip and pick is in a state the product can reach',
    )
  } else {
    for (const f of findings) say(`${f.kind.padEnd(24)} ${f.tenant}  ${f.document}: ${f.detail}`)
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
