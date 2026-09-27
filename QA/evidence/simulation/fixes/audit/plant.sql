-- Plant the DOS-257 phantom in dos_test_dos257 ONLY, the way the pre-DOS-251 cancel wrote it: +12 into the
-- Godown under the cancelled bill's ref, with nothing taken out anywhere. Run before migration 0071 exists.
\set ON_ERROR_STOP on
begin;
with bill as (
  select i.id, i.tenant_id, i.invoice_no, s.lot_id, s.location_id
    from invoices i
    join tenants t on t.id = i.tenant_id and t.slug = 'tarsun'
    join stock_ledger s on s.ref_id = i.id and s.ref_type = 'invoice_cancel'
   where i.invoice_no = 'INV/9002'
   limit 1)
insert into stock_ledger (id, tenant_id, lot_id, location_id, qty_delta, reason, ref_type, ref_id, actor_id, idempotency_key, note)
select gen_random_uuid()::text, b.tenant_id, b.lot_id, b.location_id, 12, 'adjustment', 'invoice_cancel', b.id,
       (select user_id from memberships m where m.tenant_id = b.tenant_id and m.role = 'owner' limit 1),
       'invoice-cancel:' || b.id || ':' || b.lot_id || ':phantom-dos257', 'cancelled invoice ' || b.invoice_no
  from bill b
returning id, lot_id, location_id, qty_delta, note;
update stock_balances sb set on_hand = on_hand + 12
  from stock_ledger s
 where s.idempotency_key like '%:phantom-dos257'
   and sb.tenant_id = s.tenant_id and sb.lot_id = s.lot_id and sb.location_id = s.location_id
returning sb.lot_id, sb.location_id, sb.on_hand, sb.reserved;
commit;
