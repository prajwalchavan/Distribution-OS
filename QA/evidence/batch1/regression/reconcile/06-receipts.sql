\pset footer on
\echo '#### CHECK 06 - receipts. Identity (receivables.mappers toReceipt): amount + cash_discount = SUM(allocations) + unallocated, 0 <= unallocated.'
\echo '#### A reversal (bounce / cancel) is a second receipt with negative amount and negative mirror allocations.'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
select now() as snapshot_at;

\echo '== 06a. per tenant, sign and status: amount, cash discount, allocated, unallocated; over-allocated receipts'
with al as (
  select tenant_id, receipt_id, sum(amount_paise)::bigint as allocated, count(*) as n
    from allocations where receipt_id is not null group by 1, 2
)
select t.slug, case when r.amount_paise > 0 then 'receipt' else 'reversal' end as kind, r.status,
       count(*) as receipts, sum(r.amount_paise)::bigint as amount, sum(r.cash_discount_paise)::bigint as cash_discount,
       sum(coalesce(al.allocated, 0))::bigint as allocated,
       sum(r.amount_paise + r.cash_discount_paise - coalesce(al.allocated, 0))::bigint as unallocated,
       count(*) filter (where r.amount_paise > 0 and r.amount_paise + r.cash_discount_paise - coalesce(al.allocated, 0) < 0) as over_allocated,
       count(*) filter (where r.amount_paise < 0 and r.amount_paise + r.cash_discount_paise - coalesce(al.allocated, 0) > 0) as reversal_mirrors_exceed,
       count(*) filter (where r.receipt_no is null) as without_number
  from receipts r
  left join al on al.tenant_id = r.tenant_id and al.receipt_id = r.id
  join tenants t on t.id = r.tenant_id
 group by 1, 2, 3 order by 1, 2, 3;

\echo '== 06b. reversals: each bounced/cancelled original has exactly one reversal of the opposite amount and cash discount, and original + mirror allocations net every bill to zero'
with orig as (
  select * from receipts where status in ('bounced', 'cancelled') and reverses_receipt_id is null
), rv as (
  select reverses_receipt_id, count(*) as n, sum(amount_paise)::bigint as amt, sum(cash_discount_paise)::bigint as cd
    from receipts where reverses_receipt_id is not null group by 1
), net as (
  select o.id as original_id, a.invoice_id, sum(a.amount_paise) as net
    from orig o
    join allocations a on a.tenant_id = o.tenant_id
     and (a.receipt_id = o.id or a.receipt_id in (select r2.id from receipts r2 where r2.reverses_receipt_id = o.id))
   group by 1, 2 having sum(a.amount_paise) <> 0
)
select t.slug, o.status, o.mode, count(*) as originals,
       count(*) filter (where coalesce(rv.n, 0) <> 1) as not_exactly_one_reversal,
       count(*) filter (where rv.amt <> -o.amount_paise or rv.cd <> -o.cash_discount_paise) as reversal_amount_wrong,
       count(*) filter (where exists (select 1 from net where net.original_id = o.id)) as allocations_not_netting
  from orig o left join rv on rv.reverses_receipt_id = o.id join tenants t on t.id = o.tenant_id
 group by 1, 2, 3 order by 1, 2, 3;
select count(*) as reversals_whose_original_is_still_live
  from receipts rv join receipts o on o.id = rv.reverses_receipt_id
 where o.status in ('collected', 'deposited');

\echo '== 06c. VIOLATION: allocation to another tenant''s or another retailer''s bill (receipt, credit note, write-off); allocation rows whose tenant differs from the bill'
select count(*) as allocations,
       count(*) filter (where a.tenant_id <> i.tenant_id) as allocation_tenant_ne_invoice_tenant,
       count(*) filter (where a.receipt_id is not null and r.tenant_id <> i.tenant_id) as receipt_other_tenant,
       count(*) filter (where a.receipt_id is not null and r.retailer_id <> i.retailer_id) as receipt_other_retailer,
       count(*) filter (where a.credit_note_id is not null and c.tenant_id <> i.tenant_id) as credit_note_other_tenant,
       count(*) filter (where a.credit_note_id is not null and c.retailer_id <> i.retailer_id) as credit_note_other_retailer,
       count(*) filter (where a.credit_note_id is not null and c.invoice_id <> a.invoice_id) as credit_note_applied_to_another_bill,
       count(*) filter (where a.write_off_id is not null and (w.tenant_id <> i.tenant_id or w.retailer_id <> i.retailer_id or w.invoice_id <> a.invoice_id)) as write_off_mismatch
  from allocations a
  join invoices i on i.id = a.invoice_id
  left join receipts r on r.id = a.receipt_id
  left join credit_notes c on c.id = a.credit_note_id
  left join write_offs w on w.id = a.write_off_id;
select t.slug, a.id as allocation_id, r.receipt_no, r.retailer_id as receipt_retailer, i.invoice_no, i.retailer_id as invoice_retailer, a.amount_paise
  from allocations a join invoices i on i.id = a.invoice_id join receipts r on r.id = a.receipt_id join tenants t on t.id = a.tenant_id
 where r.retailer_id <> i.retailer_id or r.tenant_id <> i.tenant_id limit 5;

\echo '== 06d. KNOWN DOS-032 / DOS-059: duplicate receipt numbers per tenant (baseline: 4 pairs in tarsun, RCPT-0696..0699)'
select t.slug, count(*) as duplicated_numbers, sum(d.n) as receipts_involved
  from (select tenant_id, receipt_no, count(*) as n from receipts where receipt_no is not null group by 1, 2 having count(*) > 1) d
  join tenants t on t.id = d.tenant_id group by 1 order by 1;
select t.slug, r.receipt_no, count(*) as n,
       string_agg(to_char(r.created_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI') || ' ' || r.mode || ' ' || r.amount_paise || 'p ' || left(r.id, 8), ' | ' order by r.created_at) as receipts
  from receipts r join tenants t on t.id = r.tenant_id
 where r.receipt_no is not null
 group by 1, 2 having count(*) > 1 order by 1, 2;
select t.slug, ns.series_code, ns.fy, ns.next_no,
       (select max(substring(r.receipt_no from '[0-9]+$')::int) from receipts r where r.tenant_id = ns.tenant_id and r.receipt_no like ns.series_code || '-%') as highest_issued
  from numbering_series ns join tenants t on t.id = ns.tenant_id
 where ns.series_code = 'RCPT' order by 1;

\echo '== 06e. trip collections tie to their receipts: same tenant, shop, amount, trip'
select count(*) as collections,
       count(*) filter (where r.id is null) as no_receipt,
       count(*) filter (where r.id is not null and r.tenant_id <> c.tenant_id) as other_tenant,
       count(*) filter (where r.id is not null and r.retailer_id <> c.retailer_id) as other_retailer,
       count(*) filter (where r.id is not null and r.amount_paise <> c.amount_paise) as amount_differs,
       count(*) filter (where r.id is not null and r.trip_id is distinct from c.trip_id) as trip_differs
  from collections c left join receipts r on r.id = c.receipt_id;
COMMIT;
