\pset footer on
\echo '#### CHECK 03 - reservations. Model: reservations(order_line_id, lot_id, location_id, qty, state pending|posted|voided).'
\echo '#### A pending row adds qty to stock_balances.reserved for (lot, location); pack posts it (posted, reserved given back, sale row written); cancel / line edit voids it (reserved given back).'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
select now() as snapshot_at;

\echo '== 03a. rows by tenant and state'
select t.slug, r.state, count(*) as rows, sum(r.qty) as pcs, count(*) filter (where r.lot_id is null) as without_lot
  from reservations r join tenants t on t.id = r.tenant_id group by 1, 2 order by 1, 2;

\echo '== 03b. VIOLATION: pending reservation on a cancelled or closed order'
select t.slug, o.order_no, o.state, r.id as reservation_id, r.qty, r.lot_id, r.updated_at
  from reservations r
  join sales_order_lines l on l.id = r.order_line_id and l.tenant_id = r.tenant_id
  join sales_orders o on o.id = l.order_id and o.tenant_id = l.tenant_id
  join tenants t on t.id = r.tenant_id
 where r.state = 'pending' and o.state in ('cancelled', 'closed')
 order by 1, 2;

\echo '== 03c. reservation state x order state (pending on packed-or-later = a hold pack never closed; pending with no order line = orphan hold)'
select t.slug, r.state as reservation_state, coalesce(o.state::text, '<no order line>') as order_state, count(*) as rows, sum(r.qty) as pcs
  from reservations r
  left join sales_order_lines l on l.id = r.order_line_id and l.tenant_id = r.tenant_id
  left join sales_orders o on o.id = l.order_id and o.tenant_id = l.tenant_id
  join tenants t on t.id = r.tenant_id
 group by 1, 2, 3 order by 1, 2, 3;

\echo '== 03d. stock_balances.reserved vs SUM(pending reservations) per (tenant, lot, location)'
with p as (
  select tenant_id, lot_id, location_id, sum(qty)::bigint as pending_pcs
    from reservations where state = 'pending' and lot_id is not null group by 1, 2, 3
), j as (
  select tenant_id, lot_id, location_id, p.pending_pcs, b.reserved::bigint as reserved
    from p full join stock_balances b using (tenant_id, lot_id, location_id)
)
select t.slug,
       count(*) filter (where coalesce(j.reserved, 0) <> 0 or coalesce(j.pending_pcs, 0) <> 0) as pairs_with_holds,
       count(*) filter (where coalesce(j.reserved, 0) <> coalesce(j.pending_pcs, 0)) as reserved_ne_pending,
       sum(j.reserved) as reserved_total, sum(j.pending_pcs) as pending_total
  from j join tenants t on t.id = j.tenant_id group by 1 order by 1;
\echo '== 03e. examples reserved <> pending (up to 10)'
with p as (
  select tenant_id, lot_id, location_id, sum(qty)::bigint as pending_pcs
    from reservations where state = 'pending' and lot_id is not null group by 1, 2, 3
), j as (
  select tenant_id, lot_id, location_id, p.pending_pcs, b.reserved::bigint as reserved, b.on_hand
    from p full join stock_balances b using (tenant_id, lot_id, location_id)
)
select t.slug, j.lot_id, loc.name as location, j.on_hand, j.reserved, j.pending_pcs
  from j join tenants t on t.id = j.tenant_id left join locations loc on loc.id = j.location_id
 where coalesce(j.reserved, 0) <> coalesce(j.pending_pcs, 0)
 order by 1 limit 10;

\echo '== 03f. reserved > on_hand at a selling location (holds exceed the pieces on the rack)'
select count(*) as reserved_gt_on_hand
  from stock_balances b join locations loc on loc.id = b.location_id
 where b.reserved > b.on_hand and loc.kind <> 'damaged';
select t.slug, loc.name as location, b.lot_id, b.on_hand, b.reserved
  from stock_balances b join locations loc on loc.id = b.location_id join tenants t on t.id = b.tenant_id
 where b.reserved > b.on_hand and loc.kind <> 'damaged'
 order by 1 limit 10;

\echo '== 03g. context: open orders (confirmed / picking) and how many hold at least one pending reservation (seeded orders were never reserved)'
select t.slug, o.state, count(*) as orders,
       count(*) filter (where exists (
         select 1 from sales_order_lines l join reservations r on r.order_line_id = l.id and r.tenant_id = l.tenant_id
          where l.order_id = o.id and l.tenant_id = o.tenant_id and r.state = 'pending')) as with_pending_hold,
       count(*) filter (where o.created_at >= timestamptz '2026-09-12 12:52:00+05:30') as created_after_seed
  from sales_orders o join tenants t on t.id = o.tenant_id
 where o.state in ('confirmed', 'picking') group by 1, 2 order by 1, 2;
COMMIT;
