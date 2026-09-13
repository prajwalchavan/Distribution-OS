#!/bin/bash
# QA batch 2 — sync role probe AFTER the DOS-166 merge: what one probe left in dos_qa.
# Copied from ../db.sh (original unchanged). Queries 1-6 are the originals (query 1 also shows pdf_object_key);
# added: section 0 = tenant-wide counts taken BEFORE the probe (file from counts.sh), section 7 = the same counts AFTER.
# usage: bash db.sh <NN-role-table> <receiptId> <opId or -> <before-counts-file>
set -u
export PATH=/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/bin:$PATH
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/$1-db.txt"
{
  echo "# dos_qa check for $1   receipt id: $2   opId: $3   run at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "== 0. tenant-wide counts BEFORE the probe (counts.sh, run immediately before the request)"
  cat "$4"
  echo
  psql -h 127.0.0.1 -p 5439 -U dos -d dos_qa -X -a -v rid="$2" -v op="$3" <<'SQL'
\echo == 1. receipt row: exists? amount, who recorded it (received_by -> user, role in that tenant), rendered PDF key
select r.id, t.slug as tenant, r.tenant_id, r.receipt_no, r.series_code, r.retailer_id, r.mode, r.amount_paise, r.status,
       r.received_by, u.username as received_by_username, m.role as received_by_role,
       r.device_id, r.trip_id, r.idempotency_key, r.note, r.pdf_object_key, r.created_at
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
\echo == 2b. journal balance for the receipt entry (sum of lines must be 0)
select e.id as entry_id, count(l.id) as lines, sum(l.amount_paise) as sum_paise
  from journal_entries e join journal_lines l on l.entry_id = e.id
 where e.ref_type = 'receipt' and e.ref_id = :'rid'
 group by e.id;
\echo == 3. allocations the receipt made, and the state of each bill now
select al.id, al.invoice_id, al.amount_paise, al.allocated_by, i.state as invoice_state_now
  from allocations al
  left join invoices i on i.id = al.invoice_id
 where al.receipt_id = :'rid';
\echo == 4. sync_ops row for the opId (outcome)
select tenant_id, device_id, op_id, outcome, created_at from sync_ops where op_id = :'op';
\echo == 5. sync_errors row for the opId
select se.id, se.user_id, u.username, se.device_id, se.table_name, se.row_id, se.code, se.message_en, se.created_at
  from sync_errors se left join users u on u.id = se.user_id
 where se.op_id = :'op';
\echo == 6. outbox events carrying the receipt id (row text match)
select left(o::text, 600) as outbox_row from outbox_events o where o::text like '%' || :'rid' || '%';
SQL
  echo
  echo "== 7. tenant-wide counts AFTER the probe"
  bash "$HERE/counts.sh"
} > "$OUT" 2>&1
echo "$OUT"
