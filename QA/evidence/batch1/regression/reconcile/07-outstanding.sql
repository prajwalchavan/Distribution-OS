\pset footer on
\echo '#### CHECK 07 - retailer outstanding three ways, and ageing buckets'
\echo '   A books     = SUM(journal_lines on account AR, party_type retailer, party_id = shop)'
\echo '   B documents = invoices (not draft/cancelled) - receipts (amount + cash discount, reversals negative) - credit notes (issued/applied) - write-offs'
\echo '   C product   = retailer_outstanding_summary.outstanding_paise - unallocated_credit_paise (identity stated in receivables/outstanding.ts)'
\echo '   L live      = open bills now: SUM(max(total - allocations, 0)) over invoices in issued/partially_paid (the product''s own definition)'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
select now() as snapshot_at, (now() at time zone 'Asia/Kolkata')::date as business_date_ist;

\echo '== 07a. per tenant: shops with money, and how many disagree on each comparison'
with
inv as (select tenant_id, retailer_id, sum(total_paise)::bigint as invoiced from invoices where state not in ('draft', 'cancelled') group by 1, 2),
rc as (select tenant_id, retailer_id, sum(amount_paise + cash_discount_paise)::bigint as received from receipts group by 1, 2),
cn as (select tenant_id, retailer_id, sum(total_paise)::bigint as credited from credit_notes where state in ('issued', 'applied') group by 1, 2),
wo as (select tenant_id, retailer_id, sum(amount_paise)::bigint as written_off from write_offs group by 1, 2),
ar as (
  select jl.tenant_id, jl.party_id as retailer_id, sum(jl.amount_paise)::bigint as ar
    from journal_lines jl join accounts a on a.id = jl.account_id and a.tenant_id = jl.tenant_id
   where a.code = 'AR' and jl.party_type = 'retailer' group by 1, 2
),
alloc as (select tenant_id, invoice_id, sum(amount_paise)::bigint as allocated from allocations group by 1, 2),
openb as (
  select i.tenant_id, i.retailer_id,
         sum(greatest(i.total_paise - coalesce(al.allocated, 0), 0))::bigint as open_gross,
         count(*) filter (where i.total_paise - coalesce(al.allocated, 0) > 0) as open_bills
    from invoices i left join alloc al on al.tenant_id = i.tenant_id and al.invoice_id = i.id
   where i.state in ('issued', 'partially_paid') group by 1, 2
),
ra as (select r.tenant_id, r.retailer_id, sum(a.amount_paise)::bigint as allocated
         from allocations a join receipts r on r.id = a.receipt_id and r.tenant_id = a.tenant_id group by 1, 2),
ca as (select c.tenant_id, c.retailer_id, sum(a.amount_paise)::bigint as allocated
         from allocations a join credit_notes c on c.id = a.credit_note_id and c.tenant_id = a.tenant_id
        where c.state in ('issued', 'applied') group by 1, 2),
per as (
  select r.tenant_id, r.id as retailer_id, r.name as shop,
         coalesce(ar.ar, 0) as a_books,
         coalesce(inv.invoiced, 0) - coalesce(rc.received, 0) - coalesce(cn.credited, 0) - coalesce(wo.written_off, 0) as b_documents,
         s.retailer_id is not null as has_summary,
         s.outstanding_paise::bigint as s_outstanding, s.unallocated_credit_paise::bigint as s_unallocated, s.open_bills as s_open_bills,
         (s.outstanding_paise - s.unallocated_credit_paise)::bigint as c_product,
         coalesce(ob.open_gross, 0) as l_open_gross, coalesce(ob.open_bills, 0) as l_open_bills,
         coalesce(rc.received, 0) - coalesce(ra.allocated, 0) as l_unallocated_receipts,
         coalesce(cn.credited, 0) - coalesce(ca.allocated, 0) as l_unallocated_credit_notes
    from retailers r
    left join inv on inv.tenant_id = r.tenant_id and inv.retailer_id = r.id
    left join rc on rc.tenant_id = r.tenant_id and rc.retailer_id = r.id
    left join cn on cn.tenant_id = r.tenant_id and cn.retailer_id = r.id
    left join wo on wo.tenant_id = r.tenant_id and wo.retailer_id = r.id
    left join ar on ar.tenant_id = r.tenant_id and ar.retailer_id = r.id
    left join openb ob on ob.tenant_id = r.tenant_id and ob.retailer_id = r.id
    left join ra on ra.tenant_id = r.tenant_id and ra.retailer_id = r.id
    left join ca on ca.tenant_id = r.tenant_id and ca.retailer_id = r.id
    left join retailer_outstanding_summary s on s.tenant_id = r.tenant_id and s.retailer_id = r.id
)
select t.slug,
       count(*) filter (where a_books <> 0 or b_documents <> 0 or l_open_gross <> 0 or coalesce(s_outstanding, 0) <> 0 or coalesce(s_unallocated, 0) <> 0) as shops_with_money,
       count(*) filter (where a_books <> b_documents) as books_ne_documents,
       count(*) filter (where has_summary and a_books <> c_product) as books_ne_product_identity,
       count(*) filter (where has_summary and a_books <> c_product - l_unallocated_credit_notes) as books_ne_identity_after_unallocated_cn,
       count(*) filter (where not has_summary and (l_open_gross <> 0 or a_books <> 0)) as money_but_no_summary_row,
       count(*) filter (where has_summary and s_outstanding <> l_open_gross) as stored_outstanding_ne_live,
       count(*) filter (where has_summary and s_unallocated <> l_unallocated_receipts) as stored_unallocated_ne_live,
       count(*) filter (where has_summary and s_open_bills <> l_open_bills) as stored_open_bills_ne_live,
       sum(a_books) as a_books, sum(b_documents) as b_documents, sum(c_product) as c_product,
       sum(s_outstanding) as s_outstanding, sum(l_open_gross) as l_open_gross,
       sum(l_unallocated_receipts) as l_unallocated_receipts, sum(l_unallocated_credit_notes) as l_unallocated_cn
  from per join tenants t on t.id = per.tenant_id
 group by 1 order by 1;

\echo '== 07b. examples: shops where any comparison disagrees (up to 15)'
with
inv as (select tenant_id, retailer_id, sum(total_paise)::bigint as invoiced from invoices where state not in ('draft', 'cancelled') group by 1, 2),
rc as (select tenant_id, retailer_id, sum(amount_paise + cash_discount_paise)::bigint as received from receipts group by 1, 2),
cn as (select tenant_id, retailer_id, sum(total_paise)::bigint as credited from credit_notes where state in ('issued', 'applied') group by 1, 2),
wo as (select tenant_id, retailer_id, sum(amount_paise)::bigint as written_off from write_offs group by 1, 2),
ar as (
  select jl.tenant_id, jl.party_id as retailer_id, sum(jl.amount_paise)::bigint as ar
    from journal_lines jl join accounts a on a.id = jl.account_id and a.tenant_id = jl.tenant_id
   where a.code = 'AR' and jl.party_type = 'retailer' group by 1, 2
),
alloc as (select tenant_id, invoice_id, sum(amount_paise)::bigint as allocated from allocations group by 1, 2),
openb as (
  select i.tenant_id, i.retailer_id,
         sum(greatest(i.total_paise - coalesce(al.allocated, 0), 0))::bigint as open_gross,
         count(*) filter (where i.total_paise - coalesce(al.allocated, 0) > 0) as open_bills
    from invoices i left join alloc al on al.tenant_id = i.tenant_id and al.invoice_id = i.id
   where i.state in ('issued', 'partially_paid') group by 1, 2
),
ra as (select r.tenant_id, r.retailer_id, sum(a.amount_paise)::bigint as allocated
         from allocations a join receipts r on r.id = a.receipt_id and r.tenant_id = a.tenant_id group by 1, 2),
ca as (select c.tenant_id, c.retailer_id, sum(a.amount_paise)::bigint as allocated
         from allocations a join credit_notes c on c.id = a.credit_note_id and c.tenant_id = a.tenant_id
        where c.state in ('issued', 'applied') group by 1, 2),
per as (
  select r.tenant_id, r.id as retailer_id, r.name as shop,
         coalesce(ar.ar, 0) as a_books,
         coalesce(inv.invoiced, 0) - coalesce(rc.received, 0) - coalesce(cn.credited, 0) - coalesce(wo.written_off, 0) as b_documents,
         s.retailer_id is not null as has_summary, s.as_of, s.updated_at,
         s.outstanding_paise::bigint as s_outstanding, s.unallocated_credit_paise::bigint as s_unallocated, s.open_bills as s_open_bills,
         (s.outstanding_paise - s.unallocated_credit_paise)::bigint as c_product,
         coalesce(ob.open_gross, 0) as l_open_gross, coalesce(ob.open_bills, 0) as l_open_bills,
         coalesce(rc.received, 0) - coalesce(ra.allocated, 0) as l_unallocated_receipts,
         coalesce(cn.credited, 0) - coalesce(ca.allocated, 0) as l_unallocated_credit_notes
    from retailers r
    left join inv on inv.tenant_id = r.tenant_id and inv.retailer_id = r.id
    left join rc on rc.tenant_id = r.tenant_id and rc.retailer_id = r.id
    left join cn on cn.tenant_id = r.tenant_id and cn.retailer_id = r.id
    left join wo on wo.tenant_id = r.tenant_id and wo.retailer_id = r.id
    left join ar on ar.tenant_id = r.tenant_id and ar.retailer_id = r.id
    left join openb ob on ob.tenant_id = r.tenant_id and ob.retailer_id = r.id
    left join ra on ra.tenant_id = r.tenant_id and ra.retailer_id = r.id
    left join ca on ca.tenant_id = r.tenant_id and ca.retailer_id = r.id
    left join retailer_outstanding_summary s on s.tenant_id = r.tenant_id and s.retailer_id = r.id
)
select t.slug, left(per.retailer_id, 8) as shop_id, per.shop, per.a_books, per.b_documents, per.c_product,
       per.s_outstanding, per.l_open_gross, per.s_unallocated, per.l_unallocated_receipts, per.l_unallocated_credit_notes,
       per.s_open_bills, per.l_open_bills, per.has_summary, per.updated_at
  from per join tenants t on t.id = per.tenant_id
 where per.a_books <> per.b_documents
    or (per.has_summary and (per.s_outstanding <> per.l_open_gross or per.s_unallocated <> per.l_unallocated_receipts
                             or per.s_open_bills <> per.l_open_bills or per.a_books <> per.c_product - per.l_unallocated_credit_notes))
    or (not per.has_summary and (per.l_open_gross <> 0 or per.a_books <> 0))
 order by 1, 4 desc limit 15;

\echo '== 07c. ageing: stored buckets sum to stored outstanding; stored buckets and overdue vs a live recompute AS OF each row''s own as_of; rows not refreshed today'
with alloc as (select tenant_id, invoice_id, sum(amount_paise)::bigint as allocated from allocations group by 1, 2),
bills as (
  select i.tenant_id, i.retailer_id, i.id,
         greatest(i.total_paise - coalesce(al.allocated, 0), 0)::bigint as open,
         coalesce(i.due_date, i.invoice_date + r.credit_days) as due
    from invoices i
    join retailers r on r.id = i.retailer_id and r.tenant_id = i.tenant_id
    left join alloc al on al.tenant_id = i.tenant_id and al.invoice_id = i.id
   where i.state in ('issued', 'partially_paid')
),
rows_ as (
  select s.tenant_id, s.retailer_id, s.as_of, s.outstanding_paise::bigint as outstanding, s.overdue_paise::bigint as overdue,
         array[s.bucket_0_7_paise, s.bucket_8_15_paise, s.bucket_16_30_paise, s.bucket_31_60_paise, s.bucket_61_90_paise, s.bucket_90_plus_paise]::bigint[] as stored,
         x.*
    from retailer_outstanding_summary s
    cross join lateral (
      select array[
               coalesce(sum(b.open) filter (where s.as_of - b.due <= 7), 0),
               coalesce(sum(b.open) filter (where s.as_of - b.due between 8 and 15), 0),
               coalesce(sum(b.open) filter (where s.as_of - b.due between 16 and 30), 0),
               coalesce(sum(b.open) filter (where s.as_of - b.due between 31 and 60), 0),
               coalesce(sum(b.open) filter (where s.as_of - b.due between 61 and 90), 0),
               coalesce(sum(b.open) filter (where s.as_of - b.due > 90), 0)]::bigint[] as live_at_as_of,
             array[
               coalesce(sum(b.open) filter (where (now() at time zone 'Asia/Kolkata')::date - b.due <= 7), 0),
               coalesce(sum(b.open) filter (where (now() at time zone 'Asia/Kolkata')::date - b.due between 8 and 15), 0),
               coalesce(sum(b.open) filter (where (now() at time zone 'Asia/Kolkata')::date - b.due between 16 and 30), 0),
               coalesce(sum(b.open) filter (where (now() at time zone 'Asia/Kolkata')::date - b.due between 31 and 60), 0),
               coalesce(sum(b.open) filter (where (now() at time zone 'Asia/Kolkata')::date - b.due between 61 and 90), 0),
               coalesce(sum(b.open) filter (where (now() at time zone 'Asia/Kolkata')::date - b.due > 90), 0)]::bigint[] as live_today,
             coalesce(sum(b.open) filter (where b.due < s.as_of), 0)::bigint as live_overdue_at_as_of
        from bills b where b.tenant_id = s.tenant_id and b.retailer_id = s.retailer_id and b.open > 0) x
)
select t.slug, count(*) as summary_rows,
       count(*) filter (where stored[1] + stored[2] + stored[3] + stored[4] + stored[5] + stored[6] <> outstanding) as stored_buckets_ne_stored_outstanding,
       count(*) filter (where stored <> live_at_as_of) as stored_buckets_ne_live_at_as_of,
       count(*) filter (where overdue <> live_overdue_at_as_of) as stored_overdue_ne_live_at_as_of,
       count(*) filter (where as_of < (now() at time zone 'Asia/Kolkata')::date) as rows_as_of_before_today,
       min(as_of) as oldest_as_of, max(as_of) as newest_as_of,
       sum(stored[6]) as stored_90plus, sum(live_at_as_of[6]) as live_90plus_at_as_of, sum(live_today[6]) as live_90plus_today,
       sum(outstanding) as stored_outstanding
  from rows_ join tenants t on t.id = rows_.tenant_id
 group by 1 order by 1;
\echo '== 07d. examples: stored buckets <> stored outstanding, or stored buckets <> live at as_of (up to 10)'
with alloc as (select tenant_id, invoice_id, sum(amount_paise)::bigint as allocated from allocations group by 1, 2),
bills as (
  select i.tenant_id, i.retailer_id, greatest(i.total_paise - coalesce(al.allocated, 0), 0)::bigint as open,
         coalesce(i.due_date, i.invoice_date + r.credit_days) as due
    from invoices i join retailers r on r.id = i.retailer_id and r.tenant_id = i.tenant_id
    left join alloc al on al.tenant_id = i.tenant_id and al.invoice_id = i.id
   where i.state in ('issued', 'partially_paid')
)
select t.slug, left(s.retailer_id, 8) as shop_id, s.as_of, s.updated_at, s.outstanding_paise,
       array[s.bucket_0_7_paise, s.bucket_8_15_paise, s.bucket_16_30_paise, s.bucket_31_60_paise, s.bucket_61_90_paise, s.bucket_90_plus_paise]::bigint[] as stored,
       x.live_at_as_of
  from retailer_outstanding_summary s
  join tenants t on t.id = s.tenant_id
  cross join lateral (
    select array[
             coalesce(sum(b.open) filter (where s.as_of - b.due <= 7), 0),
             coalesce(sum(b.open) filter (where s.as_of - b.due between 8 and 15), 0),
             coalesce(sum(b.open) filter (where s.as_of - b.due between 16 and 30), 0),
             coalesce(sum(b.open) filter (where s.as_of - b.due between 31 and 60), 0),
             coalesce(sum(b.open) filter (where s.as_of - b.due between 61 and 90), 0),
             coalesce(sum(b.open) filter (where s.as_of - b.due > 90), 0)]::bigint[] as live_at_as_of
      from bills b where b.tenant_id = s.tenant_id and b.retailer_id = s.retailer_id and b.open > 0) x
 where s.bucket_0_7_paise + s.bucket_8_15_paise + s.bucket_16_30_paise + s.bucket_31_60_paise + s.bucket_61_90_paise + s.bucket_90_plus_paise <> s.outstanding_paise
    or array[s.bucket_0_7_paise, s.bucket_8_15_paise, s.bucket_16_30_paise, s.bucket_31_60_paise, s.bucket_61_90_paise, s.bucket_90_plus_paise]::bigint[] <> x.live_at_as_of
 order by 1, s.updated_at desc limit 10;

\echo '== 07e. ageing_snapshots, latest as_of per tenant: buckets sum to outstanding; legacy bucket_60_plus = 61_90 + 90_plus'
select t.slug, s.as_of, count(*) as rows,
       count(*) filter (where s.bucket_0_7_paise + s.bucket_8_15_paise + s.bucket_16_30_paise + s.bucket_31_60_paise + s.bucket_61_90_paise + s.bucket_90_plus_paise <> s.outstanding_paise) as buckets_ne_outstanding,
       count(*) filter (where s.bucket_60_plus_paise <> s.bucket_61_90_paise + s.bucket_90_plus_paise) as legacy_60plus_wrong
  from ageing_snapshots s
  join (select tenant_id, max(as_of) as m from ageing_snapshots group by 1) mx on mx.tenant_id = s.tenant_id and mx.m = s.as_of
  join tenants t on t.id = s.tenant_id
 group by 1, 2 order by 1;

\echo '== 07f. retailer links per tenant (outstanding is per tenant shop; every active link points at one of these shops)'
select t.slug, count(*) as links, count(*) filter (where l.status = 'active') as active_links,
       count(*) filter (where r.id is null) as link_to_missing_shop,
       count(*) filter (where r.id is not null and r.tenant_id <> l.tenant_id) as link_to_other_tenant_shop
  from retailer_links l left join retailers r on r.id = l.retailer_id join tenants t on t.id = l.tenant_id
 group by 1 order by 1;
COMMIT;
