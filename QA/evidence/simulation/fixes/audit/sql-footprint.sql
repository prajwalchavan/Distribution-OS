-- DOS-257: per cancelled bill and lot, what the bill (and a pack bill's order) moved plus what its cancel
-- moved. Zero is a cancel that undid the bill; anything else is stock a cancel invented (or lost).
\set T '''01a0999a-28c3-7341-93f5-e0e84b0189a1'''
SELECT i.invoice_no, v.name AS item, sl.batch_no,
       (SELECT coalesce(sum(s.qty_delta), 0) FROM stock_ledger s WHERE s.tenant_id = :T AND s.lot_id = x.lot_id AND s.ref_type = 'pack' AND s.ref_id = i.order_id) AS pack_rows,
       (SELECT coalesce(sum(s.qty_delta), 0) FROM stock_ledger s WHERE s.tenant_id = :T AND s.lot_id = x.lot_id AND s.ref_type = 'invoice' AND s.ref_id = i.id) AS bill_rows,
       (SELECT coalesce(sum(s.qty_delta), 0) FROM stock_ledger s WHERE s.tenant_id = :T AND s.lot_id = x.lot_id AND s.ref_type = 'invoice_cancel' AND s.ref_id = i.id) AS cancel_rows,
       (SELECT coalesce(sum(s.qty_delta), 0) FROM stock_ledger s WHERE s.tenant_id = :T AND s.lot_id = x.lot_id AND s.ref_type = 'invoice_cancel_writeoff' AND s.ref_id = i.id) AS writeoff_rows
  FROM (SELECT DISTINCT ref_id, lot_id FROM stock_ledger WHERE tenant_id = :T AND ref_type = 'invoice_cancel') x
  JOIN invoices i ON i.id = x.ref_id JOIN stock_lots sl ON sl.id = x.lot_id JOIN product_variants v ON v.id = sl.variant_id
 ORDER BY 1, 2;
SELECT l.name, b.on_hand FROM stock_balances b JOIN locations l ON l.id = b.location_id
  JOIN stock_lots sl ON sl.id = b.lot_id JOIN product_variants v ON v.id = sl.variant_id
 WHERE b.tenant_id = :T AND v.name = 'Godavari Cow Ghee 200 ml' AND sl.batch_no = 'B20260902' AND l.name = 'Godown';
SELECT s.created_at::timestamp(0), l.name, s.reason, s.qty_delta, s.ref_type, s.note
  FROM stock_ledger s JOIN locations l ON l.id = s.location_id JOIN stock_lots sl ON sl.id = s.lot_id JOIN product_variants v ON v.id = sl.variant_id
 WHERE s.tenant_id = :T AND v.name = 'Godavari Cow Ghee 200 ml' AND sl.batch_no = 'B20260902' AND l.name = 'Godown'
 ORDER BY s.created_at DESC, s.id DESC LIMIT 4;
