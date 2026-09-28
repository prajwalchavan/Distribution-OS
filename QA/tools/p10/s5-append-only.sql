-- S5 — append-only: stock_ledger and journal_lines, as the owner role `dos` and as `app_rw` inside a tenant context.
-- Every attempt runs in its own transaction and is ROLLED BACK whatever happens; ON_ERROR_STOP is off so every
-- attempt reports its own error. Database dos_test_p10_stock ONLY.
\set ON_ERROR_STOP off
\echo '=== as dos (owner, BYPASSRLS) ==='
select current_user, (select rolbypassrls from pg_roles where rolname = current_user) bypassrls;
select id as ledger_id from stock_ledger where tenant_id = '01a0999a-28c3-7341-93f5-e0e84b0189a1' order by created_at desc limit 1 \gset
select id as jline_id from journal_lines where tenant_id = '01a0999a-28c3-7341-93f5-e0e84b0189a1' limit 1 \gset
\echo '--- dos: UPDATE stock_ledger qty_delta'
begin; update stock_ledger set qty_delta = qty_delta + 1 where id = :'ledger_id'; rollback;
\echo '--- dos: DELETE stock_ledger row'
begin; delete from stock_ledger where id = :'ledger_id'; rollback;
\echo '--- dos: TRUNCATE stock_ledger (rolled back)'
begin; truncate stock_ledger cascade; select count(*) rows_left_inside_txn from stock_ledger; rollback;
\echo '--- dos: UPDATE journal_lines amount'
begin; update journal_lines set amount_paise = amount_paise + 1 where id = :'jline_id'; rollback;
\echo '--- dos: DELETE journal_lines row'
begin; delete from journal_lines where id = :'jline_id'; rollback;
\echo '--- dos: TRUNCATE journal_lines (rolled back)'
begin; truncate journal_lines cascade; select count(*) rows_left_inside_txn from journal_lines; rollback;
\echo '--- dos: ALTER TABLE stock_ledger DISABLE TRIGGER USER then UPDATE (rolled back)'
begin; alter table stock_ledger disable trigger user; update stock_ledger set qty_delta = qty_delta + 1 where id = :'ledger_id'; select 'updated with trigger disabled' outcome; rollback;
\echo '--- dos: session_replication_role = replica then DELETE (rolled back)'
begin; set local session_replication_role = replica; delete from stock_ledger where id = :'ledger_id'; select 'deleted under replica role' outcome; rollback;

\echo '=== as app_rw inside a tenant context (what the API runs as) ==='
\echo '--- app_rw: UPDATE stock_ledger'
begin; set local role app_rw; select set_config('app.tenant_id', '01a0999a-28c3-7341-93f5-e0e84b0189a1', true), set_config('app.actor_role', 'owner', true), set_config('app.actor_id', 'qa-p10', true);
update stock_ledger set qty_delta = qty_delta + 1 where id = :'ledger_id'; rollback;
\echo '--- app_rw: DELETE stock_ledger'
begin; set local role app_rw; select set_config('app.tenant_id', '01a0999a-28c3-7341-93f5-e0e84b0189a1', true), set_config('app.actor_role', 'owner', true);
delete from stock_ledger where id = :'ledger_id'; rollback;
\echo '--- app_rw: TRUNCATE stock_ledger'
begin; set local role app_rw; truncate stock_ledger; rollback;
\echo '--- app_rw: UPDATE journal_lines'
begin; set local role app_rw; select set_config('app.tenant_id', '01a0999a-28c3-7341-93f5-e0e84b0189a1', true), set_config('app.actor_role', 'owner', true);
update journal_lines set amount_paise = amount_paise + 1 where id = :'jline_id'; rollback;
\echo '--- app_rw: DELETE journal_lines'
begin; set local role app_rw; select set_config('app.tenant_id', '01a0999a-28c3-7341-93f5-e0e84b0189a1', true), set_config('app.actor_role', 'owner', true);
delete from journal_lines where id = :'jline_id'; rollback;
\echo '--- app_rw: TRUNCATE journal_lines'
begin; set local role app_rw; truncate journal_lines; rollback;
\echo '--- app_rw: UPDATE stock_balances.on_hand directly (derived balance, no ledger row)'
begin; set local role app_rw; select set_config('app.tenant_id', '01a0999a-28c3-7341-93f5-e0e84b0189a1', true), set_config('app.actor_role', 'warehouse', true);
update stock_balances set on_hand = on_hand + 1000 where tenant_id = '01a0999a-28c3-7341-93f5-e0e84b0189a1' and lot_id = (select id from stock_lots where batch_no = 'P10-G1') and location_id = '01a0999a-28e0-7224-8c93-c81b22069a0d' returning on_hand; rollback;
\echo '--- app_worker: UPDATE stock_ledger'
begin; set local role app_worker; update stock_ledger set qty_delta = qty_delta + 1 where id = :'ledger_id'; rollback;
\echo '--- privileges on the ledgers'
select grantee, table_name, string_agg(privilege_type, ',' order by privilege_type) privs from information_schema.role_table_grants where table_name in ('stock_ledger', 'journal_lines', 'stock_balances') and grantee in ('app_rw', 'app_worker') group by 1, 2 order by 2, 1;
\echo '--- triggers on the ledgers'
select event_object_table, trigger_name, action_timing, string_agg(event_manipulation, ',') events, action_orientation from information_schema.triggers where event_object_table in ('stock_ledger', 'journal_lines', 'stock_balances') group by 1, 2, 3, 5 order by 1, 2;
select tgrelid::regclass, tgname, tgtype from pg_trigger where tgrelid in ('stock_ledger'::regclass, 'journal_lines'::regclass) and not tgisinternal order by 1, 2;
