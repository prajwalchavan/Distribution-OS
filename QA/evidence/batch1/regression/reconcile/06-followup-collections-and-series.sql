\pset footer on
\echo '#### FOLLOW-UP to 06e / 11a: trip collections whose receipt_id resolves to no receipt; RCPT series headroom'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
select now() as snapshot_at;
\echo '== f06a. the dangling collections'
select t.slug, left(c.id, 8) as collection, left(c.receipt_id, 8) as receipt_id, c.mode, c.amount_paise, c.collected_at, tr.trip_no, tr.state as trip_state, r.name as shop,
       (select string_agg(x.receipt_no, ',') from receipts x where x.tenant_id = c.tenant_id and x.trip_id = c.trip_id and x.retailer_id = c.retailer_id and x.amount_paise = c.amount_paise) as receipts_same_trip_shop_amount,
       (select count(*) from journal_entries je where je.tenant_id = c.tenant_id and je.ref_id = c.receipt_id) as journal_entries_on_receipt_id,
       (select count(*) from allocations a where a.receipt_id = c.receipt_id) as allocations_on_receipt_id
  from collections c
  join tenants t on t.id = c.tenant_id
  left join trips tr on tr.id = c.trip_id
  left join retailers r on r.id = c.retailer_id
 where not exists (select 1 from receipts x where x.id = c.receipt_id)
 order by 1, c.collected_at;
\echo '== f06b. those trips: cash per collections vs cash per receipts vs the settlement'
select t.slug, tr.trip_no, tr.state, tr.trip_date,
       (select coalesce(sum(c.amount_paise), 0) from collections c where c.trip_id = tr.id and c.mode = 'cash') as collections_cash,
       (select coalesce(sum(x.amount_paise), 0) from receipts x where x.trip_id = tr.id and x.mode = 'cash' and x.status in ('collected', 'deposited')) as receipts_cash,
       ts.expected_cash_paise, ts.handed_over_cash_paise, ts.cash_variance_paise, ts.expenses_paise, tr.opening_cash_paise, ts.settled_at
  from trips tr join tenants t on t.id = tr.tenant_id left join trip_settlements ts on ts.trip_id = tr.id and ts.tenant_id = tr.tenant_id
 where tr.id in (select c.trip_id from collections c where not exists (select 1 from receipts x where x.id = c.receipt_id))
 order by 1, 2;
\echo '== f06c. RCPT series: next_no, highest regular number below 9000, numbers at or above 9000 and when they were written'
select t.slug, ns.next_no,
       (select max(substring(r.receipt_no from '([0-9]+)$')::int) from receipts r where r.tenant_id = ns.tenant_id and r.receipt_no ~ '^RCPT-[0-9]+$' and substring(r.receipt_no from '([0-9]+)$')::int < 9000) as highest_below_9000,
       (select string_agg(r.receipt_no || ' ' || to_char(r.created_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI'), ', ' order by r.receipt_no) from receipts r where r.tenant_id = ns.tenant_id and r.receipt_no ~ '^RCPT-9[0-9]{3}$') as numbers_9xxx
  from numbering_series ns join tenants t on t.id = ns.tenant_id
 where ns.series_code = 'RCPT' and t.slug in ('tarsun', 'sai-distributors', 'kalyan-agencies') order by 1;
COMMIT;
