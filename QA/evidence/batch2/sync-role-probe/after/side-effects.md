# Side effects — QA batch 2 P0 regression probe AFTER the merge (DOS-166 steps 01-08, DOS-115 steps 09-11)

Database `dos_qa` (rebuilt 16:11 IST from the fixed seed), tenant `tarsun` `01a09a5b-3c58-71c1-a34d-b93c569b0099`, run 2026-09-13 16:19-16:24 IST.
Every row below was read back with SQL: `side-effects-db.txt` (this folder). Nothing was reversed or deleted. The receipt, allocation and journal rows
are money ledger rows (append-only), and reversing them is the founder's call (desk: `receivables.receipts.reverse`).

## Rows written by step 01 (the legitimate crew path, accepted)

| # | Table | Id | Created by | Amount | Note |
|---|-------|----|-----------|--------|------|
| 1 | receipts | `01a09a63-1f2a-75be-b38f-e7e21930e147` (RCPT-9005, series RCPT, FY 2026-27) | ganesh.more (delivery), device `qa-b2-syncprobe-after-delivery-01` | 100 paise cash | shop Prerna Super Market R-0031 `8ddf5b3f-0540-7deb-a8c9-bc311b31b4a8`; note `QA batch2 sync-role-probe AFTER 01 delivery`; idempotency key `sync:receipt:01a09a63-1f2a-745c-b2bb-9f39dff042d0` |
| 2 | allocations | `01a09a63-1f7c-75e7-a1cc-9e97e40aafe6` | ganesh.more | 100 paise | receipt RCPT-9005 → bill INV/0244 `52c9311a-af62-7a65-bdd3-27f4b771fee4`; bill allocated 1 601 000 → 1 620 100 paise, state `partially_paid` |
| 3 | journal_entries | `01a09a63-1f8f-7451-8f5a-666cfaafbbd2` (narration `receipt RCPT-9005`) | ganesh.more | balance 0 | |
| 4 | journal_lines | `01a09a63-1f92-760c-a0c3-8a7bafcd15cd` CASH +100, `01a09a63-1f92-760d-a787-71d73ff4ed48` AR −100 (party retailer R-0031) | — | ±100 paise | |
| 5 | outbox_events | `01a09a63-1fa9-761b-b5c7-6b08f1024fd5` ReceiptRecorded, `01a09a63-1fac-7367-82a5-03be4cc6ee51` DocumentRenderRequested | — | — | both published by the worker relay at 16:20:08 IST, 0 attempts failed |
| 6 | receipts.pdf_object_key (worker render) | `tenant/01a09a5b-3c58-71c1-a34d-b93c569b0099/documents/receipt/01a09a63-1f2a-75be-b38f-e7e21930e147.pdf` | worker | — | printable receipt produced |
| 7 | numbering_series RCPT 2026-27 | next_no 9005 → 9006 | — | — | one number consumed (RCPT-9005) |
| 8 | retailer_outstanding_summary (re-derived, not appended) | retailer `8ddf5b3f-0540-7deb-a8c9-bc311b31b4a8` | — | — | `last_receipt_at` 16:19:42 IST, `last_receipt_paise` 100, outstanding now 39 433 400 paise |
| 9 | sync_ops | device `qa-b2-syncprobe-after-delivery-01` op `01a09a63-1f2a-745c-b2bb-9f39dff042d0` = `{ok:true}` | — | — | |

## Rejection records (refused ops are durable by design; nothing else was written for them)

| # | Table | Id | User | Device | Table refused | Code |
|---|-------|----|------|--------|---------------|------|
| 10 | sync_ops + sync_errors | op `01a09a65-4497-7036-a200-0b5a0852f8ab`, error `01a09a65-44b8-7252-b3ba-4d9e2acbe926` | rahul.deshmukh | `qa-b2-syncprobe-after-salesperson-02` | receipts | role_not_allowed |
| 11 | sync_ops + sync_errors | op `01a09a65-45b8-7b64-bfde-a655d1504f44`, error `01a09a65-45dc-700e-8c23-fa88183273ee` | dinesh.patil | `qa-b2-syncprobe-after-warehouse-03` | receipts | role_not_allowed |
| 12 | sync_ops + sync_errors | op `01a09a65-48e1-707e-9a04-4b456331d9dd`, error `01a09a65-48e5-7327-b975-ff700cc48912` | rahul.deshmukh | `qa-b2-syncprobe-after-salesperson-06` | trip_expenses | role_not_allowed |
| 13 | sync_ops + sync_errors | op `01a09a66-064c-741f-b069-f07a801d742e`, error `01a09a66-0655-7442-b627-efe57ae16c6c` | dinesh.patil | `qa-b2-dos115-after-warehouse-11` | sales_orders | role_not_allowed |
| 14 | sync_ops + sync_errors | op `01a09a66-064c-732f-ad21-6550462fde60`, error `01a09a66-065c-74d3-9c50-84dc9242fe58` | dinesh.patil | `qa-b2-dos115-after-warehouse-11` | sales_order_lines | role_not_allowed |

The five `sync_errors` rows are unresolved (`resolved_at` null), so they appear in `GET /sync/errors` (the "Needs attention" tray) for
rahul.deshmukh and dinesh.patil until someone resolves them.

## Row written by step 10 (DOS-115 control)

| # | Table | Id | Created by | Amount | Note |
|---|-------|----|-----------|--------|------|
| 15 | sales_orders | `01a09a66-049d-7917-a8f6-0fbc8d84a115` (draft, no order number) | rahul.deshmukh (salesperson) | total 30 500 paise | shop R-0008 Krishna Kirana Stores `75659f5a-19d1-7d52-8b43-4c3d6777a33c` (beat Station Road); note `QA batch2 DOS-115 after-probe 10 control (salesperson draft)`; no reservation, no transition and no outbox event (a draft) |
| 16 | sales_order_lines | `01a09a66-049d-7e5c-ad4f-751c34970856` | rahul.deshmukh | 1 piece of variant `677c774f-86aa-79c6-b755-702a61b92ca2` | |

## Sign-in sessions

| # | Table | Count | Note |
|---|-------|-------|------|
| 17 | auth_sessions (+ their auth_events) | 14 since 16:19 IST: rahul.deshmukh 5, ganesh.more 3, dinesh.patil 3, amol.vaidya 2, ramesh.gupta 1 | one per probe login (01, 02, 03, 04, 05, 06, 07×3, 09×2, 10×2, 11); not revoked, they expire on their own |

## Not created

- Step 02 (salesperson receipt), 03 (warehouse receipt): no receipts, journal, allocation or outbox row, and the RCPT counter stayed at 9006 (counts before = after in `02-…-db.txt` / `03-…-db.txt`).
- Step 04 (retailer upload) and 05 (salesperson `POST /receipts`): 403 at the gate. No sync_ops, sync_errors or receipt row.
- Step 06: no trip_expenses row.
- Step 08: both inserts were inside `BEGIN … ROLLBACK`; 0 rows with either id before and after (`08-rls-receipts-insert-db.txt`).
- Step 09: 14 refused writes. The three real orders are unchanged: draft `876d0028`, SO-0868, SO-0877. No sales_orders row exists for the 4 attempted ids, no transition and no order outbox event (`p0-probe-dos115/09-db.txt`).
- Step 10 accountant `POST /orders`: 403, no row for `01a09a66-049d-7f07-bfc3-00207245c16e`.
- Step 11: no sales_orders row for `01a09a66-064c-7170-b7d2-16feef5d4d3d`, no sales_order_lines row for `01a09a66-064c-78fd-aa40-8d7e1d53796e`.

## Earlier (pre-fix) probe rows

The pre-fix probe's rows are no longer in `dos_qa`: RCPT-0707 `01a09919-ed3d-…` and the salesperson's RCPT-0708 `01a0991a-2d76-…`, with their allocations,
journals, outbox events and sync rows (`../side-effects.md`). The 16:11 rebuild removed them. Section 1 of `side-effects-db.txt` searches for both ids and the
probe note tag and finds only today's RCPT-9005. The earlier founder's-call item about reversing RCPT-0708 therefore no longer applies to `dos_qa`.

## Outside the database

Temporary before-count snapshots and id JSON went to the session scratchpad
(`/private/tmp/claude-501/-Users-prajwalchavan-Desktop-Distribution-OS/682f4d7a-4374-4d97-b41b-5f986fb5fa07/scratchpad/`). Their content is copied into the
`*-db.txt` files. No product code, service, worker, build or worktree was touched.
