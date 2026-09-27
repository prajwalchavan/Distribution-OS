-- The ledger rows each cancel of the walk wrote (dos_test_l19_257).
\set T '''01a0999a-28c3-7341-93f5-e0e84b0189a1'''
SELECT i.invoice_no, i.state, l.name AS location, v.name AS item, sl.batch_no, s.reason, s.qty_delta, s.ref_type
  FROM stock_ledger s
  JOIN invoices i ON i.id = s.ref_id
  JOIN locations l ON l.id = s.location_id
  JOIN stock_lots sl ON sl.id = s.lot_id
  JOIN product_variants v ON v.id = sl.variant_id
 WHERE s.tenant_id = :T AND s.ref_type LIKE 'invoice_cancel%' AND i.invoice_no IN ('INV/0815', 'INV/0831')
 ORDER BY s.created_at, s.id;
SELECT invoice_no, state FROM invoices WHERE tenant_id = :T AND invoice_no IN ('INV/0815', 'INV/0831') ORDER BY 1;
-- Godavari Cow Ghee 200 ml B20260902 at the Godown, the lot INV/0831 carried
SELECT l.name, b.on_hand, b.reserved FROM stock_balances b JOIN locations l ON l.id = b.location_id
  JOIN stock_lots sl ON sl.id = b.lot_id JOIN product_variants v ON v.id = sl.variant_id
 WHERE b.tenant_id = :T AND v.name = 'Godavari Cow Ghee 200 ml' AND sl.batch_no = 'B20260902' ORDER BY 1;
