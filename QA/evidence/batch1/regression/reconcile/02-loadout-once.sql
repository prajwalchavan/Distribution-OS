\pset footer on
\echo '#### CHECK 02 - load-out moved stock once (fix DOS-039). Pack books the sale (ref_type pack, reason sale); load-out may move ONLY counted van stock (ref_type load_sheet, transfer_out/transfer_in).'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
select now() as snapshot_at;

\echo '== 02a. load sheets by tenant and status; confirmed since the batch-1 merge; sheets carrying van stock; ledger rows with ref_type load_sheet'
select t.slug, ls.status, count(*) as sheets,
       count(*) filter (where ls.confirmed_at >= timestamptz '2026-09-13 00:51:23+05:30') as confirmed_since_merge,
       count(*) filter (where jsonb_array_length(ls.van_stock) > 0) as with_van_stock,
       (select count(*) from stock_ledger sl where sl.tenant_id = t.id and sl.ref_type = 'load_sheet') as load_sheet_ledger_rows_in_tenant
  from load_sheets ls join tenants t on t.id = ls.tenant_id
 group by t.slug, t.id, ls.status order by 1, 2;

\echo '== 02b. VIOLATION: a load_sheet ledger row on a lot that one of the sheet''s own orders already took as sale at pack'
select t.slug, sl.ref_id as sheet_id, sl.lot_id, sl.reason, sl.qty_delta, o.order_id, pk.pack_sale_pcs
  from stock_ledger sl
  join load_sheets ls on ls.id = sl.ref_id and ls.tenant_id = sl.tenant_id
  cross join lateral jsonb_array_elements_text(ls.order_ids) as o(order_id)
  cross join lateral (
    select sum(-p.qty_delta) as pack_sale_pcs from stock_ledger p
     where p.tenant_id = sl.tenant_id and p.ref_type = 'pack' and p.ref_id = o.order_id
       and p.lot_id = sl.lot_id and p.reason = 'sale') pk
  join tenants t on t.id = sl.tenant_id
 where sl.ref_type = 'load_sheet' and pk.pack_sale_pcs is not null;

\echo '== 02c. load_sheet transfer_out per (sheet, lot) vs the sheet van_stock for that lot; transfer_in must mirror transfer_out (sheets with ledger rows, or confirmed since the merge)'
with outs as (
  select tenant_id, ref_id as sheet_id, lot_id,
         coalesce(sum(-qty_delta) filter (where reason = 'transfer_out'), 0) as out_pcs,
         coalesce(sum(qty_delta) filter (where reason = 'transfer_in'), 0) as in_pcs
    from stock_ledger where ref_type = 'load_sheet' group by 1, 2, 3
), van as (
  select ls.tenant_id, ls.id as sheet_id, v->>'lotId' as lot_id, sum((v->>'qtyPcs')::int) as van_pcs
    from load_sheets ls cross join lateral jsonb_array_elements(ls.van_stock) v group by 1, 2, 3
)
select t.slug, sheet_id, lot_id, coalesce(outs.out_pcs, 0) as out_pcs, coalesce(outs.in_pcs, 0) as in_pcs, coalesce(van.van_pcs, 0) as van_pcs
  from outs full join van using (tenant_id, sheet_id, lot_id)
  join load_sheets ls on ls.id = sheet_id
  join tenants t on t.id = ls.tenant_id
 where (coalesce(outs.out_pcs, 0) <> coalesce(van.van_pcs, 0) or coalesce(outs.in_pcs, 0) <> coalesce(outs.out_pcs, 0))
   and (outs.sheet_id is not null or ls.confirmed_at >= timestamptz '2026-09-13 00:51:23+05:30')
 limit 20;

\echo '== 02d. the DOS-039 sheet 374f2089 (confirmed after the merge): header'
select t.slug, ls.id, ls.status, ls.confirmed_at, ls.expected_packages, ls.counted_packages, ls.van_stock, ls.challan_no, ls.trip_id, ls.approved_by is not null as approved
  from load_sheets ls join tenants t on t.id = ls.tenant_id
 where ls.id = '374f2089-b8fd-720e-907c-8380307948ab';
\echo '== 02d2. its orders: state, pack sale pieces (and at which location kind), billed pieces (qty + free) on the live pack invoice, other ledger rows naming the order, its invoices or the sheet'
with sheet as (select * from load_sheets where id = '374f2089-b8fd-720e-907c-8380307948ab'),
ord as (
  select o.id, o.order_no, o.state, o.tenant_id
    from sales_orders o join sheet s on s.order_ids ? o.id and o.tenant_id = s.tenant_id
)
select ord.order_no, ord.state,
       (select sum(-p.qty_delta) from stock_ledger p
         where p.tenant_id = ord.tenant_id and p.ref_type = 'pack' and p.ref_id = ord.id and p.reason = 'sale') as pack_sale_pcs,
       (select string_agg(distinct loc.kind::text, ',') from stock_ledger p join locations loc on loc.id = p.location_id
         where p.tenant_id = ord.tenant_id and p.ref_type = 'pack' and p.ref_id = ord.id) as pack_location_kinds,
       (select sum(il.qty_pcs + il.free_qty_pcs) from invoice_lines il join invoices i on i.id = il.invoice_id
         where i.tenant_id = ord.tenant_id and i.order_id = ord.id and i.source = 'pack' and i.state <> 'cancelled') as billed_pcs,
       (select string_agg(i.invoice_no || ' ' || i.state, ', ') from invoices i where i.tenant_id = ord.tenant_id and i.order_id = ord.id) as invoices,
       (select count(*) from stock_ledger x
         where x.tenant_id = ord.tenant_id and x.ref_type <> 'pack'
           and (x.ref_id = ord.id or x.ref_id = '374f2089-b8fd-720e-907c-8380307948ab'
                or x.ref_id in (select i.id from invoices i where i.tenant_id = ord.tenant_id and i.order_id = ord.id))) as other_ledger_rows
  from ord order by ord.order_no;
\echo '== 02d3. its orders'' transitions since the merge'
select o.order_no, ost.from_state, ost.to_state, ost.event, ost.occurred_at
  from order_state_transitions ost join sales_orders o on o.id = ost.order_id and o.tenant_id = ost.tenant_id
 where ost.order_id in (select jsonb_array_elements_text(order_ids) from load_sheets where id = '374f2089-b8fd-720e-907c-8380307948ab')
   and ost.occurred_at >= timestamptz '2026-09-13 00:51:23+05:30'
 order by 1, ost.occurred_at;

\echo '== 02e. every order in dispatched or later: pieces out as sale at pack vs billed pieces (qty + free) on its live pack invoice, per lot'
with scope as (
  select id, tenant_id, state, order_no from sales_orders
   where state in ('dispatched', 'delivered', 'partially_delivered', 'closed')
), pack as (
  select sl.tenant_id, sl.ref_id as order_id, sl.lot_id, sum(-sl.qty_delta)::bigint as sale_pcs
    from stock_ledger sl where sl.ref_type = 'pack' and sl.reason = 'sale' group by 1, 2, 3
), billed as (
  select i.tenant_id, i.order_id, il.lot_id, sum(il.qty_pcs + il.free_qty_pcs)::bigint as billed_pcs
    from invoice_lines il join invoices i on i.id = il.invoice_id and i.tenant_id = il.tenant_id
   where i.source = 'pack' and i.state <> 'cancelled' group by 1, 2, 3
), k as (
  select s.tenant_id, s.id as order_id, s.order_no, s.state, x.lot_id,
         coalesce(p.sale_pcs, 0) as sale_pcs, coalesce(b.billed_pcs, 0) as billed_pcs
    from scope s
    cross join lateral (
      select pack.lot_id from pack where pack.tenant_id = s.tenant_id and pack.order_id = s.id
      union
      select billed.lot_id from billed where billed.tenant_id = s.tenant_id and billed.order_id = s.id) x
    left join pack p on p.tenant_id = s.tenant_id and p.order_id = s.id and p.lot_id is not distinct from x.lot_id
    left join billed b on b.tenant_id = s.tenant_id and b.order_id = s.id and b.lot_id is not distinct from x.lot_id
)
select t.slug,
       (select count(*) from scope s2 where s2.tenant_id = t.id) as orders_in_scope,
       count(distinct k.order_id) as orders_with_pack_or_bill_lines,
       count(*) as order_lot_rows,
       count(*) filter (where k.sale_pcs <> k.billed_pcs) as lot_rows_sale_ne_billed,
       count(distinct k.order_id) filter (where k.sale_pcs <> k.billed_pcs) as orders_sale_ne_billed,
       sum(k.sale_pcs) as sale_pcs, sum(k.billed_pcs) as billed_pcs,
       (array_agg(distinct k.order_no) filter (where k.sale_pcs <> k.billed_pcs))[1:5] as example_orders
  from k join tenants t on t.id = k.tenant_id group by t.slug, t.id order by 1;

\echo '== 02f. pack sale rows posted anywhere but a warehouse location'
select t.slug, loc.kind, count(*) as rows, sum(sl.qty_delta) as pcs
  from stock_ledger sl join locations loc on loc.id = sl.location_id join tenants t on t.id = sl.tenant_id
 where sl.ref_type = 'pack' group by 1, 2 order by 1, 2;

\echo '== 02g. VIOLATION: a second godown deduction for a dispatched-or-later order - negative rows at a warehouse location, other than its pack sale, naming the order, its invoices, or a load sheet carrying it'
with neg as (
  select sl.id, sl.tenant_id, sl.ref_type, sl.ref_id, sl.reason, sl.qty_delta
    from stock_ledger sl join locations loc on loc.id = sl.location_id and loc.kind = 'warehouse'
   where sl.qty_delta < 0 and not (sl.ref_type = 'pack' and sl.reason = 'sale')
     and sl.ref_type in ('pack', 'order', 'sales_order', 'invoice', 'load_sheet')
), mapped as (
  select neg.*, neg.ref_id as order_id from neg where neg.ref_type in ('pack', 'order', 'sales_order')
  union all
  select neg.*, i.order_id from neg join invoices i on i.id = neg.ref_id and i.tenant_id = neg.tenant_id where neg.ref_type = 'invoice'
  union all
  select neg.*, o.order_id from neg join load_sheets ls on ls.id = neg.ref_id and ls.tenant_id = neg.tenant_id
         cross join lateral jsonb_array_elements_text(ls.order_ids) as o(order_id) where neg.ref_type = 'load_sheet'
)
select t.slug, m.ref_type, m.reason, count(*) as rows, sum(m.qty_delta) as pcs, (array_agg(m.id))[1:5] as example_ledger_ids
  from mapped m
  join sales_orders so on so.id = m.order_id and so.tenant_id = m.tenant_id
       and so.state in ('dispatched', 'delivered', 'partially_delivered', 'closed')
  join tenants t on t.id = m.tenant_id
 group by 1, 2, 3 order by 1, 2, 3;
select 'second_godown_deduction_rows' as metric, count(*) as value
  from stock_ledger sl
  join locations loc on loc.id = sl.location_id and loc.kind = 'warehouse'
 where sl.qty_delta < 0 and sl.ref_type = 'load_sheet';

\echo '== 02h. context: other movement families that touch vehicles (seeded van_load pairs, sale on van-sale invoices)'
select t.slug, sl.reason, sl.ref_type, loc.kind, count(*) as rows, sum(sl.qty_delta) as pcs
  from stock_ledger sl join locations loc on loc.id = sl.location_id join tenants t on t.id = sl.tenant_id
 where sl.reason in ('van_load', 'van_unload', 'transfer_out', 'transfer_in') or sl.ref_type = 'invoice'
 group by 1, 2, 3, 4 order by 1, 2, 3, 4;
COMMIT;
