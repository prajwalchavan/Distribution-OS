\pset footer on
\echo '#### CHECK 11 - cross-tenant integrity: child.tenant_id must equal parent.tenant_id; plain-id references must resolve. Every tenant, fixtures included.'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
select now() as snapshot_at;

\echo '== 11a. per relation: rows with a reference, references that do not resolve (plain ids only; FK columns cannot dangle), tenant mismatches'
select * from (
  select 'invoices.order_id -> sales_orders' as relation, count(*) as checked, count(*) filter (where p.id is null) as dangling, count(*) filter (where p.tenant_id <> c.tenant_id) as tenant_mismatch, (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3] as examples
    from invoices c left join sales_orders p on p.id = c.order_id where c.order_id is not null
  union all select 'invoices.retailer_id -> retailers', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from invoices c left join retailers p on p.id = c.retailer_id
  union all select 'invoice_lines.invoice_id -> invoices', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from invoice_lines c left join invoices p on p.id = c.invoice_id
  union all select 'invoice_lines.lot_id -> stock_lots', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from invoice_lines c left join stock_lots p on p.id = c.lot_id where c.lot_id is not null
  union all select 'invoice_lines.order_line_id -> sales_order_lines (plain id)', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from invoice_lines c left join sales_order_lines p on p.id = c.order_line_id where c.order_line_id is not null
  union all select 'sales_order_lines.order_id -> sales_orders', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from sales_order_lines c left join sales_orders p on p.id = c.order_id
  union all select 'sales_orders.retailer_id -> retailers', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from sales_orders c left join retailers p on p.id = c.retailer_id
  union all select 'order_state_transitions.order_id -> sales_orders', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from order_state_transitions c left join sales_orders p on p.id = c.order_id
  union all select 'approvals.order_id -> sales_orders', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from approvals c left join sales_orders p on p.id = c.order_id where c.order_id is not null
  union all select 'allocations.invoice_id -> invoices', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from allocations c left join invoices p on p.id = c.invoice_id
  union all select 'allocations.receipt_id -> receipts', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from allocations c left join receipts p on p.id = c.receipt_id where c.receipt_id is not null
  union all select 'allocations.credit_note_id -> credit_notes', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from allocations c left join credit_notes p on p.id = c.credit_note_id where c.credit_note_id is not null
  union all select 'allocations.write_off_id -> write_offs', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from allocations c left join write_offs p on p.id = c.write_off_id where c.write_off_id is not null
  union all select 'receipts.retailer_id -> retailers', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from receipts c left join retailers p on p.id = c.retailer_id
  union all select 'receipts.trip_id -> trips (plain id)', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from receipts c left join trips p on p.id = c.trip_id where c.trip_id is not null
  union all select 'receipts.reverses_receipt_id -> receipts', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from receipts c left join receipts p on p.id = c.reverses_receipt_id where c.reverses_receipt_id is not null
  union all select 'credit_notes.invoice_id -> invoices', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from credit_notes c left join invoices p on p.id = c.invoice_id
  union all select 'credit_notes.retailer_id -> retailers', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from credit_notes c left join retailers p on p.id = c.retailer_id
  union all select 'credit_notes.delivery_id -> deliveries (plain id)', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from credit_notes c left join deliveries p on p.id = c.delivery_id where c.delivery_id is not null
  union all select 'credit_note_lines.credit_note_id -> credit_notes', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from credit_note_lines c left join credit_notes p on p.id = c.credit_note_id
  union all select 'credit_note_lines.invoice_line_id -> invoice_lines', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from credit_note_lines c left join invoice_lines p on p.id = c.invoice_line_id
  union all select 'write_offs.invoice_id -> invoices', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from write_offs c left join invoices p on p.id = c.invoice_id
  union all select 'write_offs.journal_entry_id -> journal_entries', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from write_offs c left join journal_entries p on p.id = c.journal_entry_id where c.journal_entry_id is not null
  union all select 'cash_discount_conditions.invoice_id -> invoices', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from cash_discount_conditions c left join invoices p on p.id = c.invoice_id
  union all select 'stock_ledger.lot_id -> stock_lots', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from stock_ledger c left join stock_lots p on p.id = c.lot_id
  union all select 'stock_ledger.location_id -> locations', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from stock_ledger c left join locations p on p.id = c.location_id
  union all select 'stock_ledger.ref_id (pack) -> sales_orders (plain id)', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from stock_ledger c left join sales_orders p on p.id = c.ref_id where c.ref_type = 'pack'
  union all select 'stock_ledger.ref_id (credit_note) -> credit_notes (plain id)', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from stock_ledger c left join credit_notes p on p.id = c.ref_id where c.ref_type = 'credit_note'
  union all select 'stock_ledger.ref_id (load_sheet) -> load_sheets (plain id)', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from stock_ledger c left join load_sheets p on p.id = c.ref_id where c.ref_type = 'load_sheet'
  union all select 'stock_ledger.ref_id (invoice_cancel) -> invoices (plain id)', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from stock_ledger c left join invoices p on p.id = c.ref_id where c.ref_type = 'invoice_cancel'
  union all select 'stock_ledger.ref_id (grn) -> grns (plain id)', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from stock_ledger c left join grns p on p.id = c.ref_id where c.ref_type = 'grn'
  union all select 'stock_balances.lot_id -> stock_lots', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), null::text[]
    from stock_balances c left join stock_lots p on p.id = c.lot_id
  union all select 'stock_balances.location_id -> locations', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), null::text[]
    from stock_balances c left join locations p on p.id = c.location_id
  union all select 'reservations.lot_id -> stock_lots', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from reservations c left join stock_lots p on p.id = c.lot_id where c.lot_id is not null
  union all select 'reservations.location_id -> locations', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from reservations c left join locations p on p.id = c.location_id
  union all select 'reservations.order_line_id -> sales_order_lines (plain id)', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from reservations c left join sales_order_lines p on p.id = c.order_line_id
  union all select 'trips.vehicle_id -> vehicles', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from trips c left join vehicles p on p.id = c.vehicle_id
  union all select 'vehicles.location_id -> locations', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from vehicles c left join locations p on p.id = c.location_id
  union all select 'trip_stops.trip_id -> trips', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from trip_stops c left join trips p on p.id = c.trip_id
  union all select 'trip_stops.retailer_id -> retailers', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from trip_stops c left join retailers p on p.id = c.retailer_id
  union all select 'deliveries.stop_id -> trip_stops', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from deliveries c left join trip_stops p on p.id = c.stop_id
  union all select 'deliveries.trip_id -> trips', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from deliveries c left join trips p on p.id = c.trip_id
  union all select 'deliveries.order_id -> sales_orders', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from deliveries c left join sales_orders p on p.id = c.order_id where c.order_id is not null
  union all select 'deliveries.invoice_id -> invoices', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from deliveries c left join invoices p on p.id = c.invoice_id
  union all select 'delivery_lines.delivery_id -> deliveries', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from delivery_lines c left join deliveries p on p.id = c.delivery_id
  union all select 'delivery_lines.invoice_line_id -> invoice_lines', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from delivery_lines c left join invoice_lines p on p.id = c.invoice_line_id
  union all select 'collections.trip_id -> trips', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from collections c left join trips p on p.id = c.trip_id
  union all select 'collections.receipt_id -> receipts (plain id)', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from collections c left join receipts p on p.id = c.receipt_id
  union all select 'journal_lines.entry_id -> journal_entries', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from journal_lines c left join journal_entries p on p.id = c.entry_id
  union all select 'journal_lines.account_id -> accounts', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from journal_lines c left join accounts p on p.id = c.account_id
  union all select 'pack_confirmations.order_id -> sales_orders', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from pack_confirmations c left join sales_orders p on p.id = c.order_id
  union all select 'pack_confirmations.invoice_id -> invoices (plain id)', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from pack_confirmations c left join invoices p on p.id = c.invoice_id where c.invoice_id is not null
  union all select 'pick_lines.picklist_id -> picklists', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from pick_lines c left join picklists p on p.id = c.picklist_id
  union all select 'pick_lines.order_line_id -> sales_order_lines', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from pick_lines c left join sales_order_lines p on p.id = c.order_line_id
  union all select 'load_sheets.from_location_id -> locations', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from load_sheets c left join locations p on p.id = c.from_location_id
  union all select 'load_sheets.to_location_id -> locations', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from load_sheets c left join locations p on p.id = c.to_location_id
  union all select 'load_sheets.trip_id -> trips (plain id)', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from load_sheets c left join trips p on p.id = c.trip_id where c.trip_id is not null
  union all select 'load_sheets.order_ids[] -> sales_orders (plain ids)', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from load_sheets c cross join lateral jsonb_array_elements_text(c.order_ids) as o(order_id) left join sales_orders p on p.id = o.order_id
  union all select 'delivery_challans.load_sheet_id -> load_sheets', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), (array_agg(c.id) filter (where p.tenant_id <> c.tenant_id))[1:3]
    from delivery_challans c left join load_sheets p on p.id = c.load_sheet_id where c.load_sheet_id is not null
  union all select 'retailer_outstanding_summary.retailer_id -> retailers', count(*), count(*) filter (where p.id is null), count(*) filter (where p.tenant_id <> c.tenant_id), null::text[]
    from retailer_outstanding_summary c left join retailers p on p.id = c.retailer_id
) x order by tenant_mismatch desc, dangling desc, relation;

\echo '== 11b. same-shop and same-document consistency (a bill, its order, its credit notes, its delivery and its trip stop must name one shop)'
select * from (
  select 'invoice shop = its order shop' as rule, count(*) as checked, count(*) filter (where i.retailer_id <> o.retailer_id) as violations, (array_agg(i.invoice_no) filter (where i.retailer_id <> o.retailer_id))[1:3] as examples
    from invoices i join sales_orders o on o.id = i.order_id
  union all select 'credit note shop = its bill shop', count(*), count(*) filter (where c.retailer_id <> i.retailer_id), (array_agg(c.credit_note_no) filter (where c.retailer_id <> i.retailer_id))[1:3]
    from credit_notes c join invoices i on i.id = c.invoice_id
  union all select 'credit note line belongs to the credit note''s bill', count(*), count(*) filter (where il.invoice_id <> c.invoice_id), (array_agg(c.credit_note_no) filter (where il.invoice_id <> c.invoice_id))[1:3]
    from credit_note_lines cl join credit_notes c on c.id = cl.credit_note_id join invoice_lines il on il.id = cl.invoice_line_id
  union all select 'write-off shop = its bill shop', count(*), count(*) filter (where w.retailer_id <> i.retailer_id), (array_agg(w.id) filter (where w.retailer_id <> i.retailer_id))[1:3]
    from write_offs w join invoices i on i.id = w.invoice_id
  union all select 'delivery shop = its bill shop', count(*), count(*) filter (where d.retailer_id <> i.retailer_id), (array_agg(d.id) filter (where d.retailer_id <> i.retailer_id))[1:3]
    from deliveries d join invoices i on i.id = d.invoice_id
  union all select 'delivery shop = its trip stop shop, delivery trip = stop trip', count(*), count(*) filter (where d.retailer_id <> s.retailer_id or d.trip_id <> s.trip_id), (array_agg(d.id) filter (where d.retailer_id <> s.retailer_id or d.trip_id <> s.trip_id))[1:3]
    from deliveries d join trip_stops s on s.id = d.stop_id
  union all select 'delivery order = its bill order', count(*), count(*) filter (where d.order_id is distinct from i.order_id), (array_agg(d.id) filter (where d.order_id is distinct from i.order_id))[1:3]
    from deliveries d join invoices i on i.id = d.invoice_id where d.order_id is not null
  union all select 'delivery line belongs to the delivery''s bill', count(*), count(*) filter (where il.invoice_id <> d.invoice_id), (array_agg(dl.id) filter (where il.invoice_id <> d.invoice_id))[1:3]
    from delivery_lines dl join deliveries d on d.id = dl.delivery_id join invoice_lines il on il.id = dl.invoice_line_id
  union all select 'collection shop = its receipt shop', count(*), count(*) filter (where c.retailer_id <> r.retailer_id), (array_agg(c.id) filter (where c.retailer_id <> r.retailer_id))[1:3]
    from collections c join receipts r on r.id = c.receipt_id
  union all select 'invoice line order line belongs to the bill''s order', count(*), count(*) filter (where sol.order_id is distinct from i.order_id), (array_agg(i.invoice_no) filter (where sol.order_id is distinct from i.order_id))[1:3]
    from invoice_lines il join invoices i on i.id = il.invoice_id join sales_order_lines sol on sol.id = il.order_line_id where i.order_id is not null
  union all select 'pick line order line belongs to the pick line order', count(*), count(*) filter (where sol.order_id <> pl.order_id), (array_agg(pl.id) filter (where sol.order_id <> pl.order_id))[1:3]
    from pick_lines pl join sales_order_lines sol on sol.id = pl.order_line_id
  union all select 'pack confirmation invoice belongs to the packed order', count(*), count(*) filter (where i.order_id is distinct from pc.order_id), (array_agg(pc.id) filter (where i.order_id is distinct from pc.order_id))[1:3]
    from pack_confirmations pc join invoices i on i.id = pc.invoice_id
) x order by violations desc, rule;
COMMIT;
