\pset footer on
\echo '#### FOLLOW-UP to 08: did the 00:20 IST nightly finalize run on 13 Sep, and was the worker up at that minute?'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
select now() as snapshot_at;
\echo '== f08d. pg-boss version and schedules'
select * from pgboss.version;
select name, cron, timezone, created_on, updated_on from pgboss.schedule order by name;
\echo '== f08e. reporting jobs created between 23:30 IST 12 Sep and 01:30 IST 13 Sep (the 15-minute fan-out proves the worker was polling)'
select name, state, created_on, started_on, completed_on
  from pgboss.job
 where name in ('reporting.rollup.schedule', 'reporting.rollup.finalize')
   and created_on between timestamptz '2026-09-12 23:30:00+05:30' and timestamptz '2026-09-13 01:30:00+05:30'
 order by created_on;
\echo '== f08f. cron sender jobs around the 00:20 IST slot'
select name, state, created_on, completed_on, left(data::text, 120) as data
  from pgboss.job
 where name like '__pgboss__%'
   and created_on between timestamptz '2026-09-13 00:15:00+05:30' and timestamptz '2026-09-13 00:25:00+05:30'
 order by created_on;
\echo '== f08g. every job name ever created, with first and last creation'
select name, count(*), min(created_on), max(created_on) from pgboss.job group by 1 order by 1;
COMMIT;
