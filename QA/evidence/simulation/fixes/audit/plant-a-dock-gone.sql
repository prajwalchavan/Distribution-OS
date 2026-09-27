-- DOS-257 walk, failure-path setup (dos_test_l19_257 only): "another sheet loaded them".
-- INV/0815's Rajwadi Jeera Masala Soda (batch RJ20260830) leaves the dock for the van, as a load-sheet
-- transfer would move it, so the dock no longer holds the bill's pieces — the exact state INV/9034 was in
-- when the pre-DOS-251 cancel invented 12 toor in the godown.
\set T '''01a0999a-28c3-7341-93f5-e0e84b0189a1'''
BEGIN;
CREATE TEMP TABLE plant ON COMMIT DROP AS
SELECT b.lot_id, b.location_id AS dock_id, b.on_hand AS qty,
       (SELECT l.id FROM locations l WHERE l.tenant_id = :T AND l.kind = 'vehicle' AND l.name LIKE '%MH-05-AB-1234%' LIMIT 1) AS van_id,
       (SELECT actor_id FROM stock_ledger s WHERE s.tenant_id = :T AND s.lot_id = b.lot_id ORDER BY created_at LIMIT 1) AS actor_id
  FROM stock_balances b
  JOIN locations d ON d.id = b.location_id AND d.kind = 'in_transit'
  JOIN invoice_lines il ON il.lot_id = b.lot_id
  JOIN invoices i ON i.id = il.invoice_id AND i.invoice_no = 'INV/0815' AND i.tenant_id = :T
  JOIN stock_lots sl ON sl.id = b.lot_id AND sl.batch_no = 'RJ20260830'
 WHERE b.tenant_id = :T AND b.on_hand > 0;
SELECT * FROM plant;
INSERT INTO stock_ledger (id, tenant_id, lot_id, location_id, qty_delta, reason, ref_type, ref_id, actor_id, idempotency_key, note)
SELECT gen_random_uuid()::text, :T, lot_id, dock_id, -qty, 'transfer_out'::stock_reason, 'load_sheet', 'dos257-walk-sheet', actor_id, 'dos257-walk:' || lot_id || ':out', 'DOS-257 walk: another sheet loaded them' FROM plant
UNION ALL
SELECT gen_random_uuid()::text, :T, lot_id, van_id, qty, 'transfer_in'::stock_reason, 'load_sheet', 'dos257-walk-sheet', actor_id, 'dos257-walk:' || lot_id || ':in', 'DOS-257 walk: another sheet loaded them' FROM plant;
UPDATE stock_balances b SET on_hand = b.on_hand - p.qty, version = version + 1, updated_at = now() FROM plant p
 WHERE b.tenant_id = :T AND b.lot_id = p.lot_id AND b.location_id = p.dock_id;
INSERT INTO stock_balances (tenant_id, lot_id, location_id, on_hand, reserved, negative_allowed)
SELECT :T, p.lot_id, p.van_id, p.qty, 0, false FROM plant p
ON CONFLICT (tenant_id, lot_id, location_id) DO UPDATE SET on_hand = stock_balances.on_hand + EXCLUDED.on_hand, version = stock_balances.version + 1, updated_at = now();
COMMIT;
