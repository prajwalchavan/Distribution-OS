-- DOS-257 walk (dos_test_l19_257 only, BEFORE migration 0071): plant the row the pre-DOS-251 cancel wrote.
-- INV/9034's cancel wrote Godown +12 `adjustment` under `invoice_cancel` for pieces that were not on the dock.
-- The same row for INV/0831's Godavari Cow Ghee 200 ml B20260902 (48 pc), on top of its real dock → godown
-- return: the books then hold 48 ghee that exist nowhere, exactly the shape the audit found.
\set T '''01a0999a-28c3-7341-93f5-e0e84b0189a1'''
BEGIN;
CREATE TEMP TABLE p ON COMMIT DROP AS
SELECT s.lot_id, s.location_id, s.ref_id, s.actor_id
  FROM stock_ledger s JOIN invoices i ON i.id = s.ref_id JOIN stock_lots sl ON sl.id = s.lot_id
 WHERE s.tenant_id = :T AND i.invoice_no = 'INV/0831' AND s.ref_type = 'invoice_cancel' AND s.qty_delta > 0
   AND sl.batch_no = 'B20260902';
INSERT INTO stock_ledger (id, tenant_id, lot_id, location_id, qty_delta, reason, ref_type, ref_id, actor_id, idempotency_key, note)
SELECT gen_random_uuid()::text, :T, lot_id, location_id, 48, 'adjustment'::stock_reason, 'invoice_cancel', ref_id, actor_id,
       'invoice-cancel:' || ref_id || ':' || lot_id || ':' || location_id || ':pre-dos251-plant', 'cancelled invoice INV/0831'
  FROM p;
UPDATE stock_balances b SET on_hand = b.on_hand + 48, version = b.version + 1, updated_at = now()
  FROM p WHERE b.tenant_id = :T AND b.lot_id = p.lot_id AND b.location_id = p.location_id;
COMMIT;
SELECT l.name, b.on_hand FROM stock_balances b JOIN locations l ON l.id = b.location_id
  JOIN stock_lots sl ON sl.id = b.lot_id JOIN product_variants v ON v.id = sl.variant_id
 WHERE b.tenant_id = :T AND v.name = 'Godavari Cow Ghee 200 ml' AND sl.batch_no = 'B20260902' AND l.name = 'Godown';
