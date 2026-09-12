# Batch 1 reconciliation of dos_qa (Charter A.12 item 4)

Read-only SQL, each file one repeatable-read snapshot on `dos_qa`, 2026-09-13 01:50–01:58 IST, by an Opus auditor while the web
walkers were mutating data through the product. Verdicts cover the three pilot tenants; the RLS fixture tenants a-0bb6e38a / b-0bb6e38a
(raw SQL from `rls.test.ts`, 12 Sep 20:36) break checks 1, 4–7, 9, 10 by construction and are listed, not graded; check 11 includes them.
Every check has its `.sql` and `.out` in this folder (12 checks + 7 follow-ups).

| # | Check | Status | Count / detail | Evidence |
|---|---|---|---|---|
| 1 | Stock ledger vs balances | PASS | 2 166 (lot, location) pairs: 0 on_hand ≠ SUM(qty_delta), 0 negative, 0 duplicate idempotency keys | 01-stock-ledger-vs-balances |
| 2 | Load-out moved stock once (DOS-039) | PASS | 0 `load_sheet` ledger rows; sheet 374f2089 confirmed after the merge (01:07:22, no van stock); its 5 orders dispatched; pack sale pieces = billed pieces (151/209/4 283/880/403); no second godown deduction | 02-loadout-once, 02-followup-seed-edge-orders |
| 3 | Reservations | PASS | 58 pending = 1 044 pcs = `stock_balances.reserved` on all 56 lot-locations; 0 pending on cancelled/closed orders; 0 reserved > on_hand; DOS-115 probe cancels SO-0889/0891 voided | 03-reservations |
| 4 | Journals | PASS | 2 974 entries / 12 703 lines: 0 unbalanced, trial balance 0 per tenant, 0 orphan or cross-tenant lines; every bill, cancellation, credit note, receipt, write-off posted once with the right AR. Note: 11 seeded reversals posted as ref_type `receipt`, not `receipt_reversal` | 04-journals, 04-followup-reversal-postings |
| 5 | Invoices | PASS | 1 473 non-import bills: header = lines on every column; payment state matches allocations on all 1 503; 3 cancelled bills keep numbers, 0 allocations, restocked, reversed | 05-invoices |
| 6 | Receipts | KNOWN (DOS-032/059) | 0 over-allocated; 11 reversals net to 0; 0 cross-tenant/shop allocations. Duplicates: 4 pairs in tarsun, not grown. **Latent:** Kalyan's counter at 102 with 0102–0105 issued, Sai's at 277 with 0277–0280 — each tenant's next 4 receipts will repeat a number | 06-receipts, 06-followup-series-headroom |
| 7 | Retailer outstanding and ageing buckets | PASS | 115 shops agree three ways (AR books = bills − receipts − credit notes − write-offs = outstanding − unallocated); Tarsun AR ₹43,63,211 = open ₹43,98,291 − unallocated ₹35,080 | 07-outstanding |
| 8 | Owner report vs live (DOS-001) | **FAIL** → DOS-117 | DOS-001 part PASSES: invoiced ₹667, collected ₹2,853, outstanding ₹43,98,291, 90+ ₹25,962 equal live; key stored `ageingB90plus`. FAILS on overdue/ageing: 120/124 dues rows dated 12 Sep; overdue understated ₹1,01,921 (Tarsun), ₹1,09,585 (Sai), ₹8,109 (Kalyan) across 18 shops | 08-owner-report, 08-followup-* |
| 9 | Returns and credit notes (DOS-058) | KNOWN (DOS-116) | 118 restocking lines have their ledger row; 12 non-saleable lines to the damaged bin. DOS-058 confirmed on real data: doorstep "damaged" → CN/9004 return_damaged, +72 pcs damaged bin. Exceptions: CN/9005 desk line to saleable (DOS-116), CN/9003 pre-fix doorstep line | 09-returns-credit-notes |
| 10 | Orders | PASS | 1 562 orders header = lines; 8 981 transitions: every chain starts at draft, legal moves only, ends at current state (seed SO-9001..9006 have none) | 10-orders |
| 11 | Cross-tenant integrity | PASS | 60 parent-child relations, 0 tenant mismatches (3 unresolved refs in fixture tenant) | 11-cross-tenant |
| 12a | Goods out without a bill | PASS | 0 product orders | 12-auditor-extras |
| 12b | Bills paid with bounced/cancelled money | PASS | 0 of 1 042 | 12-auditor-extras |
| 12c | Dispatched but the vehicle never left | PASS | 0 (TRIP-NEXT went active 10 h before its sheet was confirmed — pre-fix DOS-039 side effect) | 12-auditor-extras |

**What the check 8 failure means for the business.** A shop's overdue figure and ageing buckets are recomputed only when that shop gets a
posting; nothing re-dates them at the start of the day, so the owner's Today overdue understates what is really overdue by more every
quiet day, the ageing trend has no points after 12 Sep, and the 09:00 dues reminder (which selects on the stored overdue) skips newly
overdue shops. Credit checks are not affected.

**Environment note (QA's own doing):** the worker was stopped by QA from about 22:45 to 00:57 to free memory during the merge, so the
00:20 IST `reporting.rollup.finalize` slot on 13 Sep did not run and pg-boss did not backfill it. That is NOT the cause of DOS-117 — no
ageing job is scheduled at all (08-followup-worker-schedule) — but it is why the 12 Sep daily totals were not finalised overnight.

**Seed-fixture observations (feed the Q5 rebuild of dos_qa, not product findings):** SO-9004/9005/9006 in each tenant were billed without
a pack ledger row, leaving phantom godown pieces (Tarsun 1 524, Sai 748, Kalyan 738); the seed pushed invoice and credit-note counters past
its 9xxx fixtures, so new bills are INV/9007+ while the regular series ended at INV/0840 (Tarsun), 0440 (Sai), 0173 (Kalyan) — a gap of
~8 000 numbers.
