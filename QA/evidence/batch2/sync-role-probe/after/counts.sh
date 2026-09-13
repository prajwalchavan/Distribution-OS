#!/bin/bash
# QA batch 2 — sync role probe AFTER: tenant-wide counts that a receipt write would move (tarsun, dos_qa). Read-only.
# usage: bash counts.sh            (prints the query and its one-row result to stdout)
set -u
export PATH=/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/bin:$PATH
echo "-- counts taken at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
psql -h 127.0.0.1 -p 5439 -U dos -d dos_qa -X -a -v t=01a09a5b-3c58-71c1-a34d-b93c569b0099 <<'SQL'
select
  (select count(*) from receipts        where tenant_id = :'t') as receipts,
  (select count(*) from journal_entries where tenant_id = :'t') as journal_entries,
  (select count(*) from journal_lines   where tenant_id = :'t') as journal_lines,
  (select count(*) from allocations     where tenant_id = :'t') as allocations,
  (select count(*) from outbox_events   where tenant_id = :'t' and event_type = 'ReceiptRecorded') as outbox_receipt_recorded,
  (select count(*) from outbox_events   where tenant_id = :'t' and event_type = 'DocumentRenderRequested' and aggregate_id like 'receipt:%') as outbox_receipt_pdf_requests,
  (select next_no from numbering_series where tenant_id = :'t' and series_code = 'RCPT' and fy = '2026-27') as rcpt_next_no,
  (select count(*) from sync_ops    where tenant_id = :'t') as sync_ops,
  (select count(*) from sync_errors where tenant_id = :'t') as sync_errors;
SQL
