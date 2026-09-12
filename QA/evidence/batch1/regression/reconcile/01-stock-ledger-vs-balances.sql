\pset footer on
\echo '#### CHECK 01 - stock_ledger vs stock_balances, every tenant, one REPEATABLE READ READ ONLY snapshot'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
select now() as snapshot_at, (now() at time zone 'Asia/Kolkata') as snapshot_ist;

\echo '== 01a. per tenant: (lot, location) pairs, on_hand <> SUM(qty_delta), ledger pairs with no balance row, non-zero balance rows with no ledger'
with l as (
  select tenant_id, lot_id, location_id, sum(qty_delta)::bigint as ledger_sum, count(*) as ledger_rows
    from stock_ledger group by tenant_id, lot_id, location_id
), j as (
  select tenant_id, lot_id, location_id, l.ledger_sum, l.ledger_rows, b.on_hand::bigint as on_hand
    from l full join stock_balances b using (tenant_id, lot_id, location_id)
)
select t.slug,
       count(*) as pairs,
       count(*) filter (where coalesce(j.ledger_sum, 0) <> coalesce(j.on_hand, 0)) as on_hand_ne_ledger,
       count(*) filter (where j.on_hand is null) as ledger_without_balance_row,
       count(*) filter (where j.ledger_rows is null and j.on_hand <> 0) as balance_nonzero_without_ledger,
       sum(j.ledger_sum) as ledger_total_pcs,
       sum(j.on_hand) as on_hand_total_pcs
  from j join tenants t on t.id = j.tenant_id
 group by t.slug order by t.slug;

\echo '== 01b. examples of on_hand <> SUM(qty_delta) (up to 10)'
with l as (
  select tenant_id, lot_id, location_id, sum(qty_delta)::bigint as ledger_sum
    from stock_ledger group by tenant_id, lot_id, location_id
), j as (
  select tenant_id, lot_id, location_id, l.ledger_sum, b.on_hand::bigint as on_hand
    from l full join stock_balances b using (tenant_id, lot_id, location_id)
)
select t.slug, j.lot_id, loc.name as location, j.ledger_sum, j.on_hand
  from j join tenants t on t.id = j.tenant_id left join locations loc on loc.id = j.location_id
 where coalesce(j.ledger_sum, 0) <> coalesce(j.on_hand, 0)
 order by t.slug limit 10;

\echo '== 01c. negative on_hand by tenant and location kind (selling locations must never be negative; the damaged bin may be)'
select t.slug, loc.kind, loc.negative_allowed as location_allows_negative, b.negative_allowed as balance_allows_negative,
       count(*) as negative_rows, min(b.on_hand) as most_negative,
       (array_agg(b.lot_id order by b.on_hand))[1:5] as example_lots
  from stock_balances b join locations loc on loc.id = b.location_id join tenants t on t.id = b.tenant_id
 where b.on_hand < 0
 group by 1, 2, 3, 4 order by 1, 2;
select count(*) as negative_on_hand_at_selling_locations
  from stock_balances b join locations loc on loc.id = b.location_id
 where b.on_hand < 0 and loc.kind <> 'damaged';

\echo '== 01d. balance rows flagged negative_allowed at a selling location (the non-negative CHECK then protects nothing)'
select t.slug, loc.kind, count(*) as rows
  from stock_balances b join locations loc on loc.id = b.location_id join tenants t on t.id = b.tenant_id
 where b.negative_allowed and loc.kind <> 'damaged'
 group by 1, 2 order by 1, 2;

\echo '== 01e. duplicate (tenant_id, idempotency_key) in stock_ledger, and the guarantees that should make it impossible'
select count(*) as duplicate_key_groups
  from (select 1 from stock_ledger group by tenant_id, idempotency_key having count(*) > 1) d;
select indexname, indexdef from pg_indexes where tablename = 'stock_ledger' and indexdef ilike '%unique%';
select tgname from pg_trigger where tgrelid = 'stock_ledger'::regclass and not tgisinternal;

\echo '== 01f. activity context: ledger rows per tenant, rows written since the batch-1 merge (2026-09-13 00:51:23 IST)'
select t.slug, count(*) as rows,
       count(*) filter (where sl.created_at >= timestamptz '2026-09-13 00:51:23+05:30') as since_merge,
       max(sl.created_at) as latest
  from stock_ledger sl join tenants t on t.id = sl.tenant_id group by 1 order by 1;
COMMIT;
