#!/bin/bash
# QA batch 2 — DOS-115 post-merge probe: database proof in dos_qa (read-only).
# usage: bash db115.sh snap                                   -> prints the snapshot of the three real orders (stdout)
#        bash db115.sh check <NN> <before-file> <since-iso> <ids,comma,separated> [created-order-id] [device-id]
#          -> writes <NN>-db.txt next to this file: before snapshot, after snapshot, and the "nothing written" checks
set -u
export PATH=/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/bin:$PATH
HERE="$(cd "$(dirname "$0")" && pwd)"
T=01a09a5b-3c58-71c1-a34d-b93c569b0099
PSQL=(psql -h 127.0.0.1 -p 5439 -U dos -d dos_qa -X -a)

snap() {
  echo "-- snapshot at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  "${PSQL[@]}" -v t="$T" <<'SQL'
select o.id, o.order_no, o.state, o.source, o.total_paise, o.updated_at, o.cancelled_at,
       (select count(*) from sales_order_lines l where l.order_id = o.id) as lines,
       (select count(*) from order_state_transitions s where s.order_id = o.id) as transitions,
       (select string_agg(r.state::text || ':' || r.qty, ',' order by r.id)
          from reservations r join sales_order_lines l on l.id = r.order_line_id where l.order_id = o.id) as reservations,
       (select count(*) from outbox_events e where e.aggregate_id = o.id) as outbox_events
  from sales_orders o
 where o.id in ('876d0028-e59c-77b8-9c0f-afae52c229cc', '3efdbf77-02ab-745b-92d0-a175744f6761', 'ce2350c7-770c-78dd-901b-3206d37d6182')
 order by o.state, o.id;
select (select count(*) from sales_orders where tenant_id = :'t') as sales_orders_tenant,
       (select count(*) from sales_order_lines where tenant_id = :'t') as sales_order_lines_tenant,
       (select count(*) from order_state_transitions where tenant_id = :'t') as order_state_transitions_tenant,
       (select count(*) from outbox_events where tenant_id = :'t' and aggregate_type = 'order') as outbox_order_events_tenant;
SQL
}

if [ "$1" = "snap" ]; then
  snap
  exit 0
fi

NN=$2; BEFORE=$3; SINCE=$4; IDS=$5; CREATED=${6:--}; DEVICE=${7:--}
OUT="$HERE/$NN-db.txt"
{
  echo "# dos_qa DOS-115 check for step $NN   since: $SINCE   attempted new order ids: $IDS   created: $CREATED   device: $DEVICE   run at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "== 0. BEFORE: the three real orders (draft 876d0028 R-0008, submitted SO-0868, confirmed SO-0877) and tenant counts"
  cat "$BEFORE"
  echo
  echo "== 1. AFTER: the same snapshot"
  snap
  echo
  "${PSQL[@]}" -v t="$T" -v ids="$IDS" -v since="$SINCE" -v created="$CREATED" -v dev="$DEVICE" <<'SQL'
\echo == 2. sales_orders rows for the attempted (refused) new ids: expect 0 rows
select id, order_no, state, source, created_by, created_at from sales_orders where id = any(string_to_array(:'ids', ','));
\echo == 3. order_state_transitions since the probe started by dinesh.patil (5b6fbe87) / ganesh.more (7b2db500) / amol.vaidya (9be27e0e): expect 0 rows
select s.id, s.order_id, s.event, s.from_state, s.to_state, u.username, s.occurred_at
  from order_state_transitions s left join users u on u.id = s.actor_id
 where s.tenant_id = :'t' and s.occurred_at >= :'since'::timestamptz
   and s.actor_id in ('5b6fbe87-cb70-7195-8de1-a4f5046c3675', '7b2db500-02d5-7aa7-a1dc-005a3e89ff63', '9be27e0e-9211-7be6-9497-4bee998843a3');
\echo == 4. every order outbox event since the probe started (tenant tarsun)
select id, aggregate_id, event_type, created_at from outbox_events
 where tenant_id = :'t' and aggregate_type = 'order' and created_at >= :'since'::timestamptz order by created_at;
\echo == 5. the control order created by the salesperson (step 10 only): header, lines, transitions
select o.id, o.order_no, o.state, o.source, o.retailer_id, r.code as retailer_code, o.salesperson_id, u.username as created_by, o.total_paise, o.note, o.created_at
  from sales_orders o join retailers r on r.id = o.retailer_id left join users u on u.id = o.created_by
 where o.id = :'created';
select l.id, l.variant_id, l.entered_qty, l.entered_unit from sales_order_lines l where l.order_id = :'created';
select s.event, s.from_state, s.to_state, u.username, s.occurred_at from order_state_transitions s left join users u on u.id = s.actor_id where s.order_id = :'created';
\echo == 6. sync_ops and sync_errors for the probe device (step 11 only)
select tenant_id, device_id, op_id, outcome, created_at from sync_ops where device_id = :'dev' order by created_at;
select se.id, se.user_id, u.username, se.device_id, se.op_id, se.table_name, se.row_id, se.code, se.message_en, se.created_at
  from sync_errors se left join users u on u.id = se.user_id where se.device_id = :'dev' order by se.created_at;
\echo == 7. sales_order_lines rows for the attempted line ids (step 11 only): expect 0 rows
select id, order_id from sales_order_lines where id = any(string_to_array(:'ids', ','));
SQL
} > "$OUT" 2>&1
echo "$OUT"
