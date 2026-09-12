\pset footer on
\echo '#### FOLLOW-UP to 02e / 10c / 12a / 12c / 11b: the SO-9001..SO-9006 orders and the other rows that break checks, who wrote them and when'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
select now() as snapshot_at;
\echo '== f02a. SO-90xx orders: header, transitions, pack confirmation, invoices, deliveries, load sheets, pack ledger rows'
select t.slug, o.order_no, o.source, o.state, o.created_at,
       (select count(*) from order_state_transitions x where x.order_id = o.id) as transitions,
       (select count(*) from pack_confirmations pc where pc.order_id = o.id) as packs,
       (select string_agg(i.invoice_no || ' ' || i.source || ' ' || i.state, ', ') from invoices i where i.order_id = o.id) as invoices,
       (select count(*) from deliveries d where d.order_id = o.id) as deliveries,
       (select count(*) from load_sheets ls where ls.order_ids ? o.id) as sheets,
       (select count(*) from stock_ledger sl where sl.ref_type = 'pack' and sl.ref_id = o.id) as pack_rows
  from sales_orders o join tenants t on t.id = o.tenant_id
 where o.order_no like 'SO-90%' order by 1, 2;
\echo '== f02b. SO-9004..9006: pack sale pieces vs billed pieces per lot'
with o as (select id, tenant_id, order_no from sales_orders where order_no in ('SO-9004', 'SO-9005', 'SO-9006'))
select t.slug, o.order_no, left(x.lot_id, 8) as lot,
       (select sum(-sl.qty_delta) from stock_ledger sl where sl.tenant_id = o.tenant_id and sl.ref_type = 'pack' and sl.ref_id = o.id and sl.reason = 'sale' and sl.lot_id is not distinct from x.lot_id) as sale_pcs,
       (select sum(il.qty_pcs + il.free_qty_pcs) from invoice_lines il join invoices i on i.id = il.invoice_id where i.tenant_id = o.tenant_id and i.order_id = o.id and i.source = 'pack' and i.state <> 'cancelled' and il.lot_id is not distinct from x.lot_id) as billed_pcs,
       (select string_agg(distinct i.invoice_no || ':' || i.state, ',') from invoice_lines il join invoices i on i.id = il.invoice_id where i.order_id = o.id and il.lot_id is not distinct from x.lot_id) as invoices
  from o join tenants t on t.id = o.tenant_id
  cross join lateral (
    select sl.lot_id from stock_ledger sl where sl.tenant_id = o.tenant_id and sl.ref_type = 'pack' and sl.ref_id = o.id
    union select il.lot_id from invoice_lines il join invoices i on i.id = il.invoice_id where i.tenant_id = o.tenant_id and i.order_id = o.id) x
 order by 1, 2, 3;
\echo '== f02c. delivered orders with no pack confirmation (12a): which orders, when created'
select t.slug, o.order_no, o.source, o.state, o.created_at,
       (select string_agg(i.invoice_no || ' ' || i.source, ', ') from invoices i where i.order_id = o.id) as invoices
  from sales_orders o join tenants t on t.id = o.tenant_id
 where o.state in ('delivered', 'partially_delivered', 'closed')
   and not exists (select 1 from pack_confirmations pc where pc.tenant_id = o.tenant_id and pc.order_id = o.id)
 order by 1, 2;
\echo '== f02d. were any of these written after the seed finished (2026-09-12 12:52 IST)?'
select count(*) as so90xx_orders, count(*) filter (where created_at >= timestamptz '2026-09-12 12:52:00+05:30') as created_after_seed from sales_orders where order_no like 'SO-90%';
select count(*) as invoices_90xx, count(*) filter (where created_at >= timestamptz '2026-09-12 12:52:00+05:30') as created_after_seed from invoices where invoice_no ~ '/90[0-9][0-9]$' and source = 'pack';
\echo '== f02e. the delivery whose order differs from its bill order (11b)'
select t.slug, d.id, d.order_id, i.order_id as bill_order_id, i.invoice_no, d.created_at
  from deliveries d join invoices i on i.id = d.invoice_id join tenants t on t.id = d.tenant_id
 where d.order_id is not null and d.order_id is distinct from i.order_id;
COMMIT;
