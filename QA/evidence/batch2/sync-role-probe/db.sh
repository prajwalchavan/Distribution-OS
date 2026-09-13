#!/bin/bash
# QA batch 2 — sync role probe: what one probe left in dos_qa.
# usage: bash db.sh <NN-role-table> <receiptId> <opId or ->
# Writes <NN-role-table>-db.txt next to this file, echoing every query above its output.
set -u
export PATH=/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/bin:$PATH
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/$1-db.txt"
{
  echo "# dos_qa check for $1   receipt id: $2   opId: $3   run at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  psql -h 127.0.0.1 -p 5439 -U dos -d dos_qa -X -a -v rid="$2" -v op="$3" <<'SQL'
\echo == 1. receipt row: exists? amount, who recorded it (received_by -> user, role in that tenant)
select r.id, t.slug as tenant, r.tenant_id, r.receipt_no, r.retailer_id, r.mode, r.amount_paise, r.status,
       r.received_by, u.username as received_by_username, m.role as received_by_role,
       r.device_id, r.trip_id, r.idempotency_key, r.note, r.created_at
  from receipts r
  join tenants t on t.id = r.tenant_id
  left join users u on u.id = r.received_by
  left join memberships m on m.user_id = r.received_by and m.tenant_id = r.tenant_id
 where r.id = :'rid';
\echo == 2. journal entry + lines for the receipt (journal_entries.ref_type = 'receipt' and ref_id = receipt id; journal_lines.entry_id)
select e.id as entry_id, e.entry_date, e.ref_type, e.ref_id, e.narration, e.posted_by,
       l.id as line_id, a.code as account, l.amount_paise, l.party_type, l.party_id
  from journal_entries e
  join journal_lines l on l.entry_id = e.id
  join accounts a on a.id = l.account_id
 where e.ref_type = 'receipt' and e.ref_id = :'rid'
 order by l.amount_paise desc;
\echo == 3. allocations the receipt made, and the state of each bill now
select al.id, al.invoice_id, al.amount_paise, al.allocated_by, i.state as invoice_state_now
  from allocations al
  left join invoices i on i.id = al.invoice_id
 where al.receipt_id = :'rid';
\echo == 4. sync_ops row for the opId (outcome)
select tenant_id, device_id, op_id, outcome, created_at from sync_ops where op_id = :'op';
\echo == 5. sync_errors row for the opId
select id, user_id, device_id, table_name, row_id, code, message_en, created_at from sync_errors where op_id = :'op';
\echo == 6. outbox events carrying the receipt id (row text match)
select left(o::text, 600) as outbox_row from outbox_events o where o::text like '%' || :'rid' || '%';
SQL
} > "$OUT" 2>&1
echo "$OUT"
