-- DOS-257 guard: a cancelled bill must net to zero stock (deferred trigger dos_invoice_cancel_leaves_nothing, migration 0071).
-- Insert an extra invoice_cancel row that would "return" 12 more pieces of the cancelled INV/9012 than it ever took, fire the
-- deferred trigger now, and ROLL BACK whatever happens. Database dos_test_p10_stock only.
\set ON_ERROR_STOP off
select id as inv from invoices where invoice_no = 'INV/9012' \gset
select lot_id as lot from invoice_lines where invoice_id = :'inv' limit 1 \gset
begin;
set local role app_rw;
select set_config('app.tenant_id', '01a0999a-28c3-7341-93f5-e0e84b0189a1', true), set_config('app.actor_role', 'owner', true), set_config('app.actor_id', 'qa-p10', true);
insert into stock_ledger (id, tenant_id, lot_id, location_id, qty_delta, reason, ref_type, ref_id, actor_id, idempotency_key, note)
values ('qa-p10-257-probe', '01a0999a-28c3-7341-93f5-e0e84b0189a1', :'lot', '01a0999a-28e0-7224-8c93-c81b22069a0d', 12, 'adjustment', 'invoice_cancel', :'inv', 'qa-p10', 'qa-p10-257-probe', 'QA p10 DOS-257 probe');
set constraints all immediate;
select 'NOT REFUSED: invented stock accepted' outcome;
rollback;
select count(*) probe_rows_left from stock_ledger where id = 'qa-p10-257-probe';
