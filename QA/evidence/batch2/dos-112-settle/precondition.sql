-- DOS-112 settle probe, step 2 precondition (read-only, dos_qa). The Day-end screen lists
-- delivery.trips.list({limit:50}) (ORDER BY id DESC) filtered to state = 'closing'; settle needs
-- state = 'closing' and no trip_settlements row for the trip.
\echo '== now (IST) and database'
select now() at time zone 'Asia/Kolkata' as now_ist, current_database();
\echo '== A. Tarsun trips by state, with settlement rows'
select tr.state, count(*) as trips, count(s.id) as with_settlement
  from trips tr join tenants t on t.id = tr.tenant_id
  left join trip_settlements s on s.tenant_id = tr.tenant_id and s.trip_id = tr.id
 where t.slug = 'tarsun' group by tr.state order by tr.state;
\echo '== B. Tarsun trips the Day-end screen would offer to settle (first 50 by id desc, closing, unsettled)'
with page as (
  select tr.* from trips tr join tenants t on t.id = tr.tenant_id
   where t.slug = 'tarsun' order by tr.id desc limit 50
)
select p.id, p.trip_no, p.trip_date, p.state, p.opening_cash_paise
  from page p left join trip_settlements s on s.tenant_id = p.tenant_id and s.trip_id = p.id
 where p.state = 'closing' and s.id is null;
\echo '== C. Any Tarsun trip in closing at all (any page), unsettled'
select tr.id, tr.trip_no, tr.trip_date, tr.state
  from trips tr join tenants t on t.id = tr.tenant_id
  left join trip_settlements s on s.tenant_id = tr.tenant_id and s.trip_id = tr.id
 where t.slug = 'tarsun' and tr.state = 'closing' and s.id is null;
\echo '== D. Tarsun trips not yet settled (the ones that could become closing)'
select tr.id, tr.trip_no, tr.trip_date, tr.state, tr.planned_stops, tr.opening_cash_paise, tr.started_at, tr.ended_at
  from trips tr join tenants t on t.id = tr.tenant_id
 where t.slug = 'tarsun' and tr.state not in ('settled','settled_with_variance','cancelled')
 order by tr.id desc;
\echo '== E. All tenants: closing trips'
select t.slug, count(*) filter (where tr.state = 'closing') as closing
  from trips tr join tenants t on t.id = tr.tenant_id group by t.slug order by t.slug;
\echo '== F. Newest Tarsun settlement rows (last 3)'
select s.id, tr.trip_no, s.settled_at at time zone 'Asia/Kolkata' as settled_at_ist, s.has_variance
  from trip_settlements s join trips tr on tr.id = s.trip_id join tenants t on t.id = s.tenant_id
 where t.slug = 'tarsun' order by s.settled_at desc limit 3;
