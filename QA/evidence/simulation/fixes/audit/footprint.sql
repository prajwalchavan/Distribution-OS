-- Every invoice_cancel ledger row, with the bill's own `invoice` rows beside it: per bill per lot the net must be 0.
select t.slug, i.invoice_no, i.source, v.name variant, sl.batch_no, s.lot_id,
       sum(s.qty_delta) filter (where s.ref_type = 'invoice') bill_rows,
       sum(s.qty_delta) filter (where s.ref_type = 'invoice_cancel') cancel_rows,
       string_agg(distinct s.reason::text || '@' || loc.name || ' ' || s.qty_delta, ', ') filter (where s.ref_type = 'invoice_cancel') cancel_detail,
       sum(s.qty_delta) footprint
from stock_ledger s
join invoices i on i.id = s.ref_id and i.tenant_id = s.tenant_id
join tenants t on t.id = s.tenant_id
join stock_lots sl on sl.id = s.lot_id
join product_variants v on v.id = sl.variant_id
join locations loc on loc.id = s.location_id
where s.ref_type in ('invoice', 'invoice_cancel')
  and i.id in (select ref_id from stock_ledger where ref_type = 'invoice_cancel')
group by 1, 2, 3, 4, 5, 6
order by 1, 2;
