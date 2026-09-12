\pset footer on
\echo '#### FOLLOW-UP to 08: shops whose stored dues row is dated before today, and how far their overdue has drifted from live'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
select now() as snapshot_at, (now() at time zone 'Asia/Kolkata')::date as business_date_ist;
with alloc as (select tenant_id, invoice_id, sum(amount_paise)::bigint as allocated from allocations group by 1, 2),
bills as (
  select i.tenant_id, i.retailer_id, greatest(i.total_paise - coalesce(al.allocated, 0), 0)::bigint as open,
         coalesce(i.due_date, i.invoice_date + r.credit_days) as due
    from invoices i join retailers r on r.id = i.retailer_id and r.tenant_id = i.tenant_id
    left join alloc al on al.tenant_id = i.tenant_id and al.invoice_id = i.id
   where i.state in ('issued', 'partially_paid')
), per as (
  select s.tenant_id, s.retailer_id, r.name as shop, s.as_of, s.updated_at, s.overdue_paise::bigint as stored_overdue,
         x.live_overdue_today, x.live_overdue_today - s.overdue_paise as drift
    from retailer_outstanding_summary s
    join retailers r on r.id = s.retailer_id and r.tenant_id = s.tenant_id
    cross join lateral (
      select coalesce(sum(b.open) filter (where b.due < (now() at time zone 'Asia/Kolkata')::date), 0)::bigint as live_overdue_today
        from bills b where b.tenant_id = s.tenant_id and b.retailer_id = s.retailer_id and b.open > 0) x
)
select t.slug, count(*) as summary_rows, count(*) filter (where per.as_of < (now() at time zone 'Asia/Kolkata')::date) as rows_dated_before_today,
       count(*) filter (where per.drift <> 0) as shops_overdue_drifted, sum(per.drift) as total_drift_paise
  from per join tenants t on t.id = per.tenant_id
 where t.slug in ('tarsun', 'sai-distributors', 'kalyan-agencies') group by 1 order by 1;
\echo '== top 8 shops by drift'
with alloc as (select tenant_id, invoice_id, sum(amount_paise)::bigint as allocated from allocations group by 1, 2),
bills as (
  select i.tenant_id, i.retailer_id, i.invoice_no, greatest(i.total_paise - coalesce(al.allocated, 0), 0)::bigint as open,
         coalesce(i.due_date, i.invoice_date + r.credit_days) as due
    from invoices i join retailers r on r.id = i.retailer_id and r.tenant_id = i.tenant_id
    left join alloc al on al.tenant_id = i.tenant_id and al.invoice_id = i.id
   where i.state in ('issued', 'partially_paid')
)
select t.slug, r.name as shop, s.as_of, s.overdue_paise as stored_overdue, x.live_overdue_today, x.live_overdue_today - s.overdue_paise as drift, x.bills_that_fell_due
  from retailer_outstanding_summary s
  join retailers r on r.id = s.retailer_id and r.tenant_id = s.tenant_id
  join tenants t on t.id = s.tenant_id
  cross join lateral (
    select coalesce(sum(b.open) filter (where b.due < (now() at time zone 'Asia/Kolkata')::date), 0)::bigint as live_overdue_today,
           string_agg(b.invoice_no || ' due ' || b.due, ', ') filter (where b.due >= s.as_of and b.due < (now() at time zone 'Asia/Kolkata')::date) as bills_that_fell_due
      from bills b where b.tenant_id = s.tenant_id and b.retailer_id = s.retailer_id and b.open > 0) x
 where t.slug in ('tarsun', 'sai-distributors', 'kalyan-agencies') and x.live_overdue_today <> s.overdue_paise
 order by x.live_overdue_today - s.overdue_paise desc limit 8;
\echo '== ageing_snapshots: latest as_of per tenant (the ageing history the owner trend reads)'
select t.slug, max(a.as_of) as latest_snapshot, count(*) filter (where a.as_of = (select max(as_of) from ageing_snapshots x where x.tenant_id = a.tenant_id)) as rows_on_latest
  from ageing_snapshots a join tenants t on t.id = a.tenant_id where t.slug in ('tarsun', 'sai-distributors', 'kalyan-agencies') group by 1 order by 1;
\echo '== invoice and credit-note numbers the product issued after the seed (numbering continuity)'
select t.slug, 'invoice' as doc, i.invoice_no as number, i.source::text, i.created_at from invoices i join tenants t on t.id = i.tenant_id
 where i.created_at >= timestamptz '2026-09-12 12:52:00+05:30' and t.slug in ('tarsun', 'sai-distributors', 'kalyan-agencies')
union all
select t.slug, 'credit_note', c.credit_note_no, c.reason::text, c.created_at from credit_notes c join tenants t on t.id = c.tenant_id
 where c.created_at >= timestamptz '2026-09-12 12:52:00+05:30' and t.slug in ('tarsun', 'sai-distributors', 'kalyan-agencies')
order by 1, 2, 5;
select t.slug, max(substring(i.invoice_no from '([0-9]+)$')::int) filter (where substring(i.invoice_no from '([0-9]+)$')::int < 9000) as highest_regular_invoice,
       min(substring(i.invoice_no from '([0-9]+)$')::int) filter (where substring(i.invoice_no from '([0-9]+)$')::int >= 9000) as lowest_9xxx
  from invoices i join tenants t on t.id = i.tenant_id
 where i.series_code = 'INV' and i.fy = '2026-27' and t.slug in ('tarsun', 'sai-distributors', 'kalyan-agencies') group by 1 order by 1;
\echo '== shops the 09:00 IST dues reminder (worker/src/jobs/notifications.ts, overdue_paise > 0) would skip: stored overdue 0, live overdue today > 0'
with alloc as (select tenant_id, invoice_id, sum(amount_paise)::bigint as allocated from allocations group by 1, 2),
bills as (
  select i.tenant_id, i.retailer_id, greatest(i.total_paise - coalesce(al.allocated, 0), 0)::bigint as open,
         coalesce(i.due_date, i.invoice_date + r.credit_days) as due
    from invoices i join retailers r on r.id = i.retailer_id and r.tenant_id = i.tenant_id
    left join alloc al on al.tenant_id = i.tenant_id and al.invoice_id = i.id
   where i.state in ('issued', 'partially_paid')
)
select t.slug, count(*) as shops_skipped, sum(x.live) as live_overdue_paise, (array_agg(r.name))[1:5] as examples
  from retailer_outstanding_summary s
  join retailers r on r.id = s.retailer_id and r.tenant_id = s.tenant_id
  join tenants t on t.id = s.tenant_id
  cross join lateral (
    select coalesce(sum(b.open) filter (where b.due < (now() at time zone 'Asia/Kolkata')::date), 0)::bigint as live
      from bills b where b.tenant_id = s.tenant_id and b.retailer_id = s.retailer_id and b.open > 0) x
 where s.overdue_paise = 0 and x.live > 0 and t.slug in ('tarsun', 'sai-distributors', 'kalyan-agencies')
 group by 1 order by 1;
COMMIT;
