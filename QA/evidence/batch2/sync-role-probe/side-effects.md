# Side effects — QA batch 2 sync-role-probe (DOS-166)

All rows are in database `dos_qa`, tenant `tarsun` (`01a0947d-7a79-75d2-bfff-97e499a58d49`). Every amount is 100 paise (₹1). Ledgers are append-only (triggers `journal_lines_append_only`, `journal_entries_no_delete`, `receipts` has no delete path from a device) — nothing was or can be deleted here. Left in place for the founder to reverse from the desk if desired (`receivables.receipts.reverse`).

| # | Table | Id | Created by | Amount | Note |
|---|-------|----|-----------|--------|------|
| 1 | receipts | `01a09919-ed3d-7388-be23-0d84e98b21b5` (RCPT-0707) | ganesh.more (delivery) | 100 paise | Probe 01 CONTROL — legitimate path |
| 2 | receipts | `01a0991a-2d76-76c5-b612-dc8f51e30adf` (RCPT-0708) | **rahul.deshmukh (salesperson)** | 100 paise | Probe 02 — THE FINDING: a salesperson recorded money |
| 3 | allocations | `01a09919-edb9-70d1-9d68-cb14e09b04fc` | delivery | 100 paise | receipt 0707 → invoice 52c9311a |
| 4 | allocations | `01a0991a-2de3-7645-9e05-48d1d4c0cc64` | salesperson | 100 paise | receipt 0708 → invoice 52c9311a |
| 5 | journal_entries + 2 journal_lines | entry `01a09919-edc9-76d8-86e1-7c013d14613d` | delivery | CASH +100 / AR −100 | receipt 0707 |
| 6 | journal_entries + 2 journal_lines | entry `01a0991a-2ded-7411-8281-62781f8b3a7d` | salesperson | CASH +100 / AR −100 | receipt 0708 |
| 7 | outbox_events | `01a09919-edec-…` (ReceiptRecorded), `01a09919-edf3-…` (DocumentRenderRequested) | — | — | for receipt 0707 |
| 8 | outbox_events | `01a0991a-2e05-…` (ReceiptRecorded), `01a0991a-2e0a-…` (DocumentRenderRequested) | — | — | for receipt 0708 (salesperson) |
| 9 | receipts.pdf_object_key (worker render) | on both 0707 and 0708 | worker | — | `tenant/…/documents/receipt/<id>.pdf` — the worker already produced a printable receipt for the salesperson's money |
| 10 | retailer_outstanding_summary (re-derived, not appended) | retailer `8ddf5b3f-0540-7deb-a8c9-bc311b31b4a8` | — | — | `last_receipt_at` now points at the salesperson receipt; derived row, refreshes on its own |
| 11 | sync_ops | device `qa-b2-syncprobe-delivery-01` op `01a09919-ed3d-78f5-908d-3b90b761a56e` = `{ok:true}` | — | — | |
| 12 | sync_ops | device `qa-b2-syncprobe-salesperson-02` op `01a0991a-2d76-76f1-b76d-81c393cdac5b` = `{ok:true}` | — | — | |
| 13 | sync_ops | device `qa-b2-syncprobe-salesperson-06` op `01a0991c-6c21-7c59-8a01-1eb99176baa2` = `{ok:false, not_found}` | — | — | trip_expenses rejection |
| 14 | sync_errors | `01a0991c-6c4d-76d2-a03d-aee63c4d6d64` (salesperson-06, trip_expenses, not_found) | — | — | the one tray row written |

Not created (refused or failed before any write):
- Probe 03 warehouse receipt — 500, whole transaction rolled back; no receipts / sync_ops / sync_errors / journal / outbox row exists for its ids. Receipt number RCPT-0709 was drawn inside that rolled-back transaction; only 0707 and 0708 exist in the table (0709 appears consumed/skipped, not reused).
- Probe 04 retailer receipt — 403 at the permission gate; nothing written.
- Probe 05 salesperson HTTP POST /receipts — 403 at the permission gate; nothing written.
- Probe 06 salesperson trip_expenses — rejected `not_found` (trips RLS hides the trip); no trip_expenses row.
