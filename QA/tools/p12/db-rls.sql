\set SAI '82f5c562-b7eb-7521-8e19-4aa6befc64f8'
\set TAR '01a0999a-28c3-7341-93f5-e0e84b0189a1'
\set TAROWNER 'a66bacc8-4212-73e1-b75f-405af2960e36'
\pset pager off

-- 1) Baseline as dos (BYPASSRLS): how many SAI rows exist in each table (proves the rows are there).
\echo '### BASELINE (dos / BYPASSRLS): count of SAI rows that actually exist'
SELECT 'sales_orders' t, count(*) FROM sales_orders WHERE tenant_id = :'SAI'
UNION ALL SELECT 'invoices', count(*) FROM invoices WHERE tenant_id = :'SAI'
UNION ALL SELECT 'receipts', count(*) FROM receipts WHERE tenant_id = :'SAI'
UNION ALL SELECT 'retailers', count(*) FROM retailers WHERE tenant_id = :'SAI'
UNION ALL SELECT 'tenant_products', count(*) FROM tenant_products WHERE tenant_id = :'SAI'
UNION ALL SELECT 'tenant_product_costs', count(*) FROM tenant_product_costs WHERE tenant_id = :'SAI'
UNION ALL SELECT 'price_lists', count(*) FROM price_lists WHERE tenant_id = :'SAI'
UNION ALL SELECT 'schemes', count(*) FROM schemes WHERE tenant_id = :'SAI'
UNION ALL SELECT 'stock_lots', count(*) FROM stock_lots WHERE tenant_id = :'SAI'
UNION ALL SELECT 'stock_ledger', count(*) FROM stock_ledger WHERE tenant_id = :'SAI'
UNION ALL SELECT 'journal_lines', count(*) FROM journal_lines WHERE tenant_id = :'SAI'
UNION ALL SELECT 'journal_entries', count(*) FROM journal_entries WHERE tenant_id = :'SAI'
UNION ALL SELECT 'trips', count(*) FROM trips WHERE tenant_id = :'SAI'
UNION ALL SELECT 'load_sheets', count(*) FROM load_sheets WHERE tenant_id = :'SAI'
UNION ALL SELECT 'grns', count(*) FROM grns WHERE tenant_id = :'SAI'
UNION ALL SELECT 'credit_notes', count(*) FROM credit_notes WHERE tenant_id = :'SAI'
UNION ALL SELECT 'memberships', count(*) FROM memberships WHERE tenant_id = :'SAI'
UNION ALL SELECT 'accounts', count(*) FROM accounts WHERE tenant_id = :'SAI'
UNION ALL SELECT 'retailer_outstanding_summary', count(*) FROM retailer_outstanding_summary WHERE tenant_id = :'SAI'
UNION ALL SELECT 'picklists', count(*) FROM picklists WHERE tenant_id = :'SAI'
UNION ALL SELECT 'invoice_lines', count(*) FROM invoice_lines WHERE tenant_id = :'SAI'
UNION ALL SELECT 'sales_order_lines', count(*) FROM sales_order_lines WHERE tenant_id = :'SAI'
UNION ALL SELECT 'reservations', count(*) FROM reservations WHERE tenant_id = :'SAI'
UNION ALL SELECT 'stock_balances', count(*) FROM stock_balances WHERE tenant_id = :'SAI'
UNION ALL SELECT 'beats', count(*) FROM beats WHERE tenant_id = :'SAI'
UNION ALL SELECT 'audit_log', count(*) FROM audit_log WHERE tenant_id = :'SAI'
ORDER BY 1;

-- 2) As app_rw with a TARSUN context: how many SAI rows are VISIBLE (must all be 0).
BEGIN;
SET LOCAL ROLE app_rw;
SELECT set_config('app.tenant_id', :'TAR', true);
SELECT set_config('app.actor_id', :'TAROWNER', true);
SELECT set_config('app.actor_role', 'owner', true);
\echo '### AS app_rw (Tarsun ctx): SAI rows VISIBLE — every count MUST be 0'
SELECT 'sales_orders' t, count(*) FROM sales_orders WHERE tenant_id = :'SAI'
UNION ALL SELECT 'invoices', count(*) FROM invoices WHERE tenant_id = :'SAI'
UNION ALL SELECT 'receipts', count(*) FROM receipts WHERE tenant_id = :'SAI'
UNION ALL SELECT 'retailers', count(*) FROM retailers WHERE tenant_id = :'SAI'
UNION ALL SELECT 'tenant_products', count(*) FROM tenant_products WHERE tenant_id = :'SAI'
UNION ALL SELECT 'tenant_product_costs', count(*) FROM tenant_product_costs WHERE tenant_id = :'SAI'
UNION ALL SELECT 'price_lists', count(*) FROM price_lists WHERE tenant_id = :'SAI'
UNION ALL SELECT 'schemes', count(*) FROM schemes WHERE tenant_id = :'SAI'
UNION ALL SELECT 'stock_lots', count(*) FROM stock_lots WHERE tenant_id = :'SAI'
UNION ALL SELECT 'stock_ledger', count(*) FROM stock_ledger WHERE tenant_id = :'SAI'
UNION ALL SELECT 'journal_lines', count(*) FROM journal_lines WHERE tenant_id = :'SAI'
UNION ALL SELECT 'journal_entries', count(*) FROM journal_entries WHERE tenant_id = :'SAI'
UNION ALL SELECT 'trips', count(*) FROM trips WHERE tenant_id = :'SAI'
UNION ALL SELECT 'load_sheets', count(*) FROM load_sheets WHERE tenant_id = :'SAI'
UNION ALL SELECT 'grns', count(*) FROM grns WHERE tenant_id = :'SAI'
UNION ALL SELECT 'credit_notes', count(*) FROM credit_notes WHERE tenant_id = :'SAI'
UNION ALL SELECT 'memberships', count(*) FROM memberships WHERE tenant_id = :'SAI'
UNION ALL SELECT 'accounts', count(*) FROM accounts WHERE tenant_id = :'SAI'
UNION ALL SELECT 'retailer_outstanding_summary', count(*) FROM retailer_outstanding_summary WHERE tenant_id = :'SAI'
UNION ALL SELECT 'picklists', count(*) FROM picklists WHERE tenant_id = :'SAI'
UNION ALL SELECT 'invoice_lines', count(*) FROM invoice_lines WHERE tenant_id = :'SAI'
UNION ALL SELECT 'sales_order_lines', count(*) FROM sales_order_lines WHERE tenant_id = :'SAI'
UNION ALL SELECT 'reservations', count(*) FROM reservations WHERE tenant_id = :'SAI'
UNION ALL SELECT 'stock_balances', count(*) FROM stock_balances WHERE tenant_id = :'SAI'
UNION ALL SELECT 'beats', count(*) FROM beats WHERE tenant_id = :'SAI'
UNION ALL SELECT 'audit_log', count(*) FROM audit_log WHERE tenant_id = :'SAI'
ORDER BY 1;

-- 3) Cross-tenant WRITE attempts as app_rw in Tarsun context (must affect 0 rows).
\echo '### AS app_rw (Tarsun ctx): cross-tenant UPDATE of SAI rows — must be UPDATE 0'
UPDATE retailers SET name = name WHERE tenant_id = :'SAI';
UPDATE sales_orders SET updated_at = updated_at WHERE tenant_id = :'SAI';
UPDATE invoices SET updated_at = updated_at WHERE tenant_id = :'SAI';
\echo '### AS app_rw (Tarsun ctx): cross-tenant DELETE of SAI rows — must be DELETE 0'
DELETE FROM reservations WHERE tenant_id = :'SAI';
DELETE FROM schemes WHERE tenant_id = :'SAI';
COMMIT;

-- 4) Append-only ledgers: UPDATE / DELETE must be refused even in-tenant.
\echo '### AS app_rw (Tarsun ctx): UPDATE/DELETE stock_ledger & journal_lines (append-only) — must ERROR'
BEGIN;
SET LOCAL ROLE app_rw;
SELECT set_config('app.tenant_id', :'TAR', true);
SELECT set_config('app.actor_id', :'TAROWNER', true);
SELECT set_config('app.actor_role', 'owner', true);
\echo '-- UPDATE stock_ledger (own tenant):'
UPDATE stock_ledger SET qty_delta = qty_delta WHERE tenant_id = :'TAR';
ROLLBACK;

BEGIN;
SET LOCAL ROLE app_rw;
SELECT set_config('app.tenant_id', :'TAR', true);
SELECT set_config('app.actor_id', :'TAROWNER', true);
SELECT set_config('app.actor_role', 'owner', true);
\echo '-- DELETE stock_ledger (own tenant):'
DELETE FROM stock_ledger WHERE tenant_id = :'TAR';
ROLLBACK;

BEGIN;
SET LOCAL ROLE app_rw;
SELECT set_config('app.tenant_id', :'TAR', true);
SELECT set_config('app.actor_id', :'TAROWNER', true);
SELECT set_config('app.actor_role', 'owner', true);
\echo '-- UPDATE journal_lines (own tenant):'
UPDATE journal_lines SET amount_paise = amount_paise WHERE tenant_id = :'TAR';
ROLLBACK;

BEGIN;
SET LOCAL ROLE app_rw;
SELECT set_config('app.tenant_id', :'TAR', true);
SELECT set_config('app.actor_id', :'TAROWNER', true);
SELECT set_config('app.actor_role', 'owner', true);
\echo '-- DELETE journal_lines (own tenant):'
DELETE FROM journal_lines WHERE tenant_id = :'TAR';
ROLLBACK;

-- 5) Insert a row with a foreign tenant_id (WITH CHECK must reject).
\echo '### AS app_rw (Tarsun ctx): INSERT a beat tagged with SAI tenant_id — WITH CHECK must reject'
BEGIN;
SET LOCAL ROLE app_rw;
SELECT set_config('app.tenant_id', :'TAR', true);
SELECT set_config('app.actor_id', :'TAROWNER', true);
SELECT set_config('app.actor_role', 'owner', true);
INSERT INTO beats (id, tenant_id, name, created_at, updated_at)
VALUES (gen_random_uuid(), :'SAI', 'p12-cross-tenant-insert', now(), now());
ROLLBACK;
