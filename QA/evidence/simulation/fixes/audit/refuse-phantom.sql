-- DOS-257 failure path at the database (dos_test_l19_257, after 0071): the row the pre-DOS-251 cancel wrote,
-- written as the app writes (SET ROLE app_rw, tenant context set) — refused at COMMIT.
\set T '''01a0999a-28c3-7341-93f5-e0e84b0189a1'''
BEGIN;
SELECT set_config('app.tenant_id', '01a0999a-28c3-7341-93f5-e0e84b0189a1', true),
       set_config('app.actor_role', 'manager', true);
SELECT s.lot_id, s.location_id, s.ref_id, s.actor_id FROM stock_ledger s JOIN invoices i ON i.id = s.ref_id
 WHERE s.tenant_id = :T AND i.invoice_no = 'INV/0831' AND s.ref_type = 'invoice_cancel' AND s.reason = 'transfer_in' LIMIT 1 \gset
SELECT set_config('app.actor_id', :'actor_id', true);
SET LOCAL ROLE app_rw;
INSERT INTO stock_ledger (id, tenant_id, lot_id, location_id, qty_delta, reason, ref_type, ref_id, actor_id, idempotency_key, note)
VALUES (gen_random_uuid()::text, :T, :'lot_id', :'location_id', 12, 'adjustment', 'invoice_cancel', :'ref_id', :'actor_id',
        'dos257-refuse-walk', 'the pre-DOS-251 cancel, again');
COMMIT;
SELECT count(*) AS rows_with_that_key FROM stock_ledger WHERE idempotency_key = 'dos257-refuse-walk';
