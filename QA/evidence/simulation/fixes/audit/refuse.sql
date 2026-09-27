-- dos_test_dos257 only: after migration 0071, the pre-DOS-251 phantom is refused at COMMIT.
select tgname, tginitdeferred from pg_trigger where tgname = 'stock_ledger_invoice_cancel_leaves_nothing';
begin;
insert into stock_ledger (id, tenant_id, lot_id, location_id, qty_delta, reason, ref_type, ref_id, actor_id, idempotency_key, note)
select gen_random_uuid()::text, i.tenant_id, '34f8d8ff-f1f3-7cdb-b6a0-d6ec8b936c29', '01a0999a-28e0-7224-8c93-c81b22069a0d', 12,
       'adjustment', 'invoice_cancel', i.id, 'probe', 'probe-dos257-' || gen_random_uuid(), 'cancelled invoice INV/9002 (probe)'
  from invoices i join tenants t on t.id = i.tenant_id and t.slug = 'tarsun' where i.invoice_no = 'INV/9002';
commit;
select count(*) as probe_rows from stock_ledger where idempotency_key like 'probe-dos257-%';
select on_hand from stock_balances where lot_id = '34f8d8ff-f1f3-7cdb-b6a0-d6ec8b936c29' and location_id = '01a0999a-28e0-7224-8c93-c81b22069a0d';
select occurred_at, qty_delta, reason, ref_type, note from stock_ledger
 where lot_id = '34f8d8ff-f1f3-7cdb-b6a0-d6ec8b936c29' and location_id = '01a0999a-28e0-7224-8c93-c81b22069a0d'
 order by occurred_at desc, id desc limit 6;
