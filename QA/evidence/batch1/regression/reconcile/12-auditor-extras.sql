\pset footer on
\echo '#### CHECK 12 - three more things a distributor''s auditor checks: goods out without a bill, bills paid with money that is not real, dispatches whose vehicle never left'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
select now() as snapshot_at;

\echo '== 12a. goods out without a bill: orders packed or later with no live (non-cancelled) invoice or no pack confirmation; deliveries recorded against a cancelled bill; delivered orders with no delivery record'
select t.slug, o.state, o.source, count(*) as orders,
       count(*) filter (where not exists (select 1 from invoices i where i.tenant_id = o.tenant_id and i.order_id = o.id and i.state <> 'cancelled')) as without_live_invoice,
       count(*) filter (where not exists (select 1 from pack_confirmations pc where pc.tenant_id = o.tenant_id and pc.order_id = o.id)) as without_pack_confirmation,
       count(*) filter (where o.state in ('delivered', 'partially_delivered', 'closed')
                          and not exists (select 1 from deliveries d where d.tenant_id = o.tenant_id and d.order_id = o.id and d.outcome in ('delivered', 'partial'))) as delivered_without_delivery_record,
       (array_agg(o.order_no) filter (where not exists (select 1 from invoices i where i.tenant_id = o.tenant_id and i.order_id = o.id and i.state <> 'cancelled')))[1:5] as examples_without_invoice
  from sales_orders o join tenants t on t.id = o.tenant_id
 where o.state in ('packed', 'dispatched', 'delivered', 'partially_delivered', 'closed')
 group by 1, 2, 3 order by 1, 2, 3;
select t.slug, count(*) as deliveries_on_cancelled_bills, (array_agg(i.invoice_no))[1:5] as examples
  from deliveries d join invoices i on i.id = d.invoice_id and i.tenant_id = d.tenant_id join tenants t on t.id = d.tenant_id
 where i.state = 'cancelled' and d.outcome in ('delivered', 'partial')
 group by 1 order by 1;
select t.slug, count(*) as pack_invoices_without_pack_confirmation, (array_agg(i.invoice_no))[1:5] as examples
  from invoices i join tenants t on t.id = i.tenant_id
 where i.source = 'pack' and i.state <> 'draft'
   and not exists (select 1 from pack_confirmations pc where pc.tenant_id = i.tenant_id and pc.order_id = i.order_id)
 group by 1 order by 1;

\echo '== 12b. bills whose paid / partially-paid state rests on money that is not real: allocations from live receipts (collected/deposited) + credit notes + write-offs vs what the state claims'
with al as (
  select a.tenant_id, a.invoice_id,
         coalesce(sum(a.amount_paise) filter (where a.receipt_id is not null and r.status in ('collected', 'deposited')), 0)::bigint as live_receipts,
         coalesce(sum(a.amount_paise) filter (where a.receipt_id is not null and r.status not in ('collected', 'deposited')), 0)::bigint as bounced_or_cancelled_net,
         coalesce(sum(a.amount_paise) filter (where a.credit_note_id is not null), 0)::bigint as credit_notes,
         coalesce(sum(a.amount_paise) filter (where a.write_off_id is not null), 0)::bigint as write_offs
    from allocations a left join receipts r on r.id = a.receipt_id
   group by 1, 2
)
select t.slug, i.state, count(*) as bills,
       count(*) filter (where i.state = 'paid' and coalesce(al.live_receipts + al.credit_notes + al.write_offs, 0) < i.total_paise) as paid_short_of_real_money,
       count(*) filter (where i.state = 'paid' and coalesce(al.live_receipts + al.credit_notes + al.write_offs, 0) = 0) as paid_with_no_real_money,
       count(*) filter (where i.state = 'partially_paid' and coalesce(al.live_receipts + al.credit_notes + al.write_offs, 0) <= 0) as part_paid_with_no_real_money,
       count(*) filter (where coalesce(al.bounced_or_cancelled_net, 0) <> 0) as bounced_or_cancelled_money_still_applied,
       (array_agg(i.invoice_no) filter (where (i.state = 'paid' and coalesce(al.live_receipts + al.credit_notes + al.write_offs, 0) < i.total_paise)
          or coalesce(al.bounced_or_cancelled_net, 0) <> 0))[1:5] as examples
  from invoices i left join al on al.tenant_id = i.tenant_id and al.invoice_id = i.id join tenants t on t.id = i.tenant_id
 where i.state in ('paid', 'partially_paid')
 group by 1, 2 order by 1, 2;

\echo '== 12c. dispatched-or-later orders whose vehicle never left: no confirmed load sheet carries the order, the sheet has no trip, or the trip is still planned / loading / cancelled'
with sheet_of as (
  select ls.tenant_id, o.order_id, ls.id as sheet_id, ls.status, ls.trip_id, ls.confirmed_at, tr.state as trip_state
    from load_sheets ls
    cross join lateral jsonb_array_elements_text(ls.order_ids) as o(order_id)
    left join trips tr on tr.id = ls.trip_id and tr.tenant_id = ls.tenant_id
)
select t.slug, so.state, count(*) as orders,
       count(*) filter (where not exists (select 1 from sheet_of s where s.tenant_id = so.tenant_id and s.order_id = so.id and s.status = 'confirmed')) as no_confirmed_sheet,
       count(*) filter (where exists (select 1 from sheet_of s where s.tenant_id = so.tenant_id and s.order_id = so.id and s.status = 'confirmed')
                          and not exists (select 1 from sheet_of s where s.tenant_id = so.tenant_id and s.order_id = so.id and s.status = 'confirmed' and s.trip_id is not null)) as confirmed_sheet_without_trip,
       count(*) filter (where exists (select 1 from sheet_of s where s.tenant_id = so.tenant_id and s.order_id = so.id and s.status = 'confirmed' and s.trip_state in ('planned', 'loading', 'cancelled'))) as trip_not_departed,
       (array_agg(so.order_no) filter (where not exists (select 1 from sheet_of s where s.tenant_id = so.tenant_id and s.order_id = so.id and s.status = 'confirmed')
          or exists (select 1 from sheet_of s where s.tenant_id = so.tenant_id and s.order_id = so.id and s.status = 'confirmed' and s.trip_state in ('planned', 'loading', 'cancelled'))))[1:5] as examples
  from sales_orders so join tenants t on t.id = so.tenant_id
 where so.state in ('dispatched', 'delivered', 'partially_delivered', 'closed')
 group by 1, 2 order by 1, 2;
\echo '== 12c2. detail for the orders dispatched since the batch-1 merge'
select t.slug, so.order_no, so.state, ls.id as sheet_id, ls.status as sheet_status, ls.trip_id, tr.trip_no, tr.state as trip_state, tr.started_at
  from order_state_transitions ost
  join sales_orders so on so.id = ost.order_id and so.tenant_id = ost.tenant_id
  join tenants t on t.id = so.tenant_id
  left join load_sheets ls on ls.tenant_id = so.tenant_id and ls.order_ids ? so.id and ls.status = 'confirmed'
  left join trips tr on tr.id = ls.trip_id and tr.tenant_id = ls.tenant_id
 where ost.event = 'dispatch' and ost.occurred_at >= timestamptz '2026-09-13 00:51:23+05:30'
 order by 1, 2;
COMMIT;
