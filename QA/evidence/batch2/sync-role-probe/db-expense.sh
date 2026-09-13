#!/bin/bash
# QA batch 2 — sync role probe: what one trip_expenses probe left in dos_qa.
# usage: bash db-expense.sh <NN-role-table> <expenseId> <opId> <tripId>
set -u
export PATH=/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/bin:$PATH
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/$1-db.txt"
{
  echo "# dos_qa check for $1   expense id: $2   opId: $3   trip: $4   run at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  psql -h 127.0.0.1 -p 5439 -U dos -d dos_qa -X -a -v eid="$2" -v op="$3" -v trip="$4" <<'SQL'
\echo == 1. the trip probed: state and crew (is the caller driver or helper?)
select t.id, t.trip_no, t.state, d.username as driver, h.username as helper
  from trips t left join users d on d.id = t.driver_id left join users h on h.id = t.helper_id
 where t.id = :'trip';
\echo == 2. trip_expenses row: exists? amount, who recorded it
select e.id, e.tenant_id, e.trip_id, e.kind, e.amount_paise, e.recorded_by, u.username as recorded_by_username, e.note, e.created_at
  from trip_expenses e left join users u on u.id = e.recorded_by
 where e.id = :'eid';
\echo == 3. sync_ops row for the opId (outcome)
select tenant_id, device_id, op_id, outcome, created_at from sync_ops where op_id = :'op';
\echo == 4. sync_errors row for the opId
select id, user_id, device_id, table_name, row_id, code, message_en, created_at from sync_errors where op_id = :'op';
SQL
} > "$OUT" 2>&1
echo "$OUT"
