\pset footer on
\echo '#### CHECK 08 - owner report (owner_summary, fix DOS-001) vs live'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
select now() as snapshot_at, (now() at time zone 'Asia/Kolkata')::date as business_date_ist;

\echo '== 08a. owner_summary rows: written when, which detail keys are stored'
select t.slug, t.created_at as tenant_seeded_at, os.as_of,
       (os.as_of at time zone 'Asia/Kolkata')::date as as_of_business_date,
       (select string_agg(k, ', ' order by k) from jsonb_object_keys(os.detail) k) as detail_keys,
       os.detail ? 'ageingB90plus' as has_ageingB90plus,
       os.detail ? 'ageingB90Plus' as has_ageingB90Plus_capital_p,
       os.as_of > t.created_at + interval '10 minutes' as rewritten_after_seed
  from owner_summary os join tenants t on t.id = os.tenant_id order by t.created_at;

\echo '== 08b. worker job history (pg-boss) and schedules'
select name, state, count(*) as jobs, min(created_on) as first_created, max(completed_on) as last_completed
  from pgboss.job group by 1, 2 order by 1, 2;
select * from pgboss.schedule;

\echo '== 08c. owner_summary tiles vs live (expanded). live_* recomputed now from documents; *_after_as_of counts the activity that legitimately moves a number after the rollup ran'
\x on
with os as (
  select os.*, (os.as_of at time zone 'Asia/Kolkata')::date as d from owner_summary os
), alloc as (select tenant_id, invoice_id, sum(amount_paise)::bigint as allocated from allocations group by 1, 2),
bills as (
  select i.tenant_id, greatest(i.total_paise - coalesce(al.allocated, 0), 0)::bigint as open,
         coalesce(i.due_date, i.invoice_date + r.credit_days) as due
    from invoices i join retailers r on r.id = i.retailer_id and r.tenant_id = i.tenant_id
    left join alloc al on al.tenant_id = i.tenant_id and al.invoice_id = i.id
   where i.state in ('issued', 'partially_paid')
)
select t.slug, os.as_of, os.d as report_business_date,
       os.today_invoiced_paise as report_today_invoiced,
       (select coalesce(sum(i.total_paise), 0) from invoices i where i.tenant_id = os.tenant_id and i.invoice_date = os.d and i.state not in ('draft', 'cancelled')) as live_invoiced_on_report_date,
       (select coalesce(sum(i.total_paise), 0) from invoices i where i.tenant_id = os.tenant_id and i.invoice_date = os.d and i.state not in ('draft', 'cancelled') and i.created_at <= os.as_of) as live_invoiced_created_by_as_of,
       os.today_collected_paise as report_today_collected,
       (select coalesce(sum(r.amount_paise), 0) from receipts r where r.tenant_id = os.tenant_id and r.status in ('collected', 'deposited') and (r.received_at at time zone 'Asia/Kolkata')::date = os.d) as live_collected_on_report_date,
       (select coalesce(sum(r.amount_paise), 0) from receipts r where r.tenant_id = os.tenant_id and r.status in ('collected', 'deposited') and (r.received_at at time zone 'Asia/Kolkata')::date = os.d and r.created_at <= os.as_of) as live_collected_created_by_as_of,
       os.total_outstanding_paise as report_outstanding,
       (select coalesce(sum(s.outstanding_paise), 0) from retailer_outstanding_summary s where s.tenant_id = os.tenant_id) as rollup_outstanding_now,
       (select coalesce(sum(b.open), 0) from bills b where b.tenant_id = os.tenant_id) as live_outstanding_now,
       os.overdue_paise as report_overdue,
       (select coalesce(sum(s.overdue_paise), 0) from retailer_outstanding_summary s where s.tenant_id = os.tenant_id) as rollup_overdue_now,
       (select coalesce(sum(b.open) filter (where b.due < os.d), 0) from bills b where b.tenant_id = os.tenant_id) as live_overdue_at_report_date,
       (os.detail->>'ageingB90plus')::bigint as report_90plus,
       (select coalesce(sum(s.bucket_90_plus_paise), 0) from retailer_outstanding_summary s where s.tenant_id = os.tenant_id) as rollup_90plus_now,
       (select coalesce(sum(b.open) filter (where os.d - b.due > 90), 0) from bills b where b.tenant_id = os.tenant_id) as live_90plus_at_report_date,
       ((os.detail->>'ageingB0_7')::bigint + (os.detail->>'ageingB8_15')::bigint + (os.detail->>'ageingB16_30')::bigint
        + (os.detail->>'ageingB31_60')::bigint + (os.detail->>'ageingB61_90')::bigint + (os.detail->>'ageingB90plus')::bigint) as report_bucket_sum,
       (select count(*) from invoices i where i.tenant_id = os.tenant_id and i.updated_at > os.as_of) as invoices_touched_after_as_of,
       (select count(*) from receipts r where r.tenant_id = os.tenant_id and r.created_at > os.as_of) as receipts_after_as_of,
       (select count(*) from allocations a where a.tenant_id = os.tenant_id and a.allocated_at > os.as_of) as allocations_after_as_of,
       (select count(*) from credit_notes c where c.tenant_id = os.tenant_id and c.created_at > os.as_of) as credit_notes_after_as_of,
       (select max(s.updated_at) from retailer_outstanding_summary s where s.tenant_id = os.tenant_id) as rollup_latest_update
  from os join tenants t on t.id = os.tenant_id
 where t.slug in ('tarsun', 'sai-distributors', 'kalyan-agencies')
 order by t.created_at;
\x off

\echo '== 08d. daily_tenant_stats (the revenue and collections register behind the report) vs live, last three business days'
select t.slug, d.day, d.computed_at,
       d.invoiced_paise as stored_invoiced,
       (select coalesce(sum(i.total_paise), 0) from invoices i where i.tenant_id = d.tenant_id and i.invoice_date = d.day and i.state not in ('draft', 'cancelled')) as live_invoiced,
       (select count(*) from invoices i where i.tenant_id = d.tenant_id and i.invoice_date = d.day and i.updated_at > d.computed_at) as invoices_changed_after_compute,
       d.collected_paise as stored_collected,
       (select coalesce(sum(r.amount_paise), 0) from receipts r where r.tenant_id = d.tenant_id and r.status in ('collected', 'deposited') and (r.received_at at time zone 'Asia/Kolkata')::date = d.day) as live_collected,
       (select count(*) from receipts r where r.tenant_id = d.tenant_id and (r.received_at at time zone 'Asia/Kolkata')::date = d.day and r.updated_at > d.computed_at) as receipts_changed_after_compute,
       d.outstanding_paise as stored_outstanding
  from daily_tenant_stats d join tenants t on t.id = d.tenant_id
 where t.slug in ('tarsun', 'sai-distributors', 'kalyan-agencies')
   and d.day >= (now() at time zone 'Asia/Kolkata')::date - 2
 order by 1, 2;
COMMIT;
