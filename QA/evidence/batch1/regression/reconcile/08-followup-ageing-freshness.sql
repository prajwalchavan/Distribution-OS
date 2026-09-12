\pset footer on
\echo '#### FOLLOW-UP to 07c / 08c: the dues rollup behind the owner report, freshness after midnight IST'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
select now() as snapshot_at, (now() at time zone 'Asia/Kolkata')::date as business_date_ist;
\echo '== f08a. retailer_outstanding_summary rows by as_of per tenant'
select t.slug, s.as_of, count(*) as rows, max(s.updated_at) as latest_update
  from retailer_outstanding_summary s join tenants t on t.id = s.tenant_id
 where t.slug in ('tarsun', 'sai-distributors', 'kalyan-agencies') group by 1, 2 order by 1, 2;
\echo '== f08b. owner report ageing + overdue vs live recompute as of today (expanded)'
\x on
with alloc as (select tenant_id, invoice_id, sum(amount_paise)::bigint as allocated from allocations group by 1, 2),
bills as (
  select i.tenant_id, i.retailer_id, greatest(i.total_paise - coalesce(al.allocated, 0), 0)::bigint as open,
         coalesce(i.due_date, i.invoice_date + r.credit_days) as due
    from invoices i join retailers r on r.id = i.retailer_id and r.tenant_id = i.tenant_id
    left join alloc al on al.tenant_id = i.tenant_id and al.invoice_id = i.id
   where i.state in ('issued', 'partially_paid')
), live as (
  select b.tenant_id,
         coalesce(sum(b.open) filter (where x.d - b.due <= 7), 0) as b0_7,
         coalesce(sum(b.open) filter (where x.d - b.due between 8 and 15), 0) as b8_15,
         coalesce(sum(b.open) filter (where x.d - b.due between 16 and 30), 0) as b16_30,
         coalesce(sum(b.open) filter (where x.d - b.due between 31 and 60), 0) as b31_60,
         coalesce(sum(b.open) filter (where x.d - b.due between 61 and 90), 0) as b61_90,
         coalesce(sum(b.open) filter (where x.d - b.due > 90), 0) as b90plus,
         coalesce(sum(b.open) filter (where b.due < x.d), 0) as overdue,
         coalesce(sum(b.open) filter (where b.due = x.d - 1), 0) as open_due_yesterday
    from bills b cross join (select (now() at time zone 'Asia/Kolkata')::date as d) x
   where b.open > 0 group by 1
)
select t.slug, os.as_of,
       os.overdue_paise as report_overdue, l.overdue as live_overdue_today, l.overdue - os.overdue_paise as overdue_understated_by,
       l.open_due_yesterday as open_on_bills_due_yesterday,
       (os.detail->>'ageingB0_7')::bigint as report_b0_7, l.b0_7 as live_b0_7,
       (os.detail->>'ageingB8_15')::bigint as report_b8_15, l.b8_15 as live_b8_15,
       (os.detail->>'ageingB16_30')::bigint as report_b16_30, l.b16_30 as live_b16_30,
       (os.detail->>'ageingB31_60')::bigint as report_b31_60, l.b31_60 as live_b31_60,
       (os.detail->>'ageingB61_90')::bigint as report_b61_90, l.b61_90 as live_b61_90,
       (os.detail->>'ageingB90plus')::bigint as report_b90plus, l.b90plus as live_b90plus
  from owner_summary os join live l on l.tenant_id = os.tenant_id join tenants t on t.id = os.tenant_id
 where t.slug in ('tarsun', 'sai-distributors', 'kalyan-agencies') order by t.created_at;
\x off
\echo '== f08c. pg-boss: any ageing / finalize job ever created'
select name, state, count(*) from pgboss.job where name ilike '%ageing%' or name ilike '%finalize%' or name ilike '%outstanding%' group by 1, 2;
COMMIT;
