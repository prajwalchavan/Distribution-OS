# Phase 7 — money lane findings (financial reconciliation, credit, returns)

Run 2026-09-28 on `dos_test_p7_money` (copy of `dos_test_batch2b_template`, migrated + `pnpm db:seed`), all-in-one API on
:3630 (`DOS_MODE=all WORKER_INLINE=1`, current `backend/all-in-one/dist`). Everything was driven through the product's own
oRPC contract client as the person who does the work (owner `sunil.tarsun`, manager `vikas.kadam`, accountant
`amol.vaidya`, rep `rahul.deshmukh`, godown `kavita.sawant`, crews `ganesh.more` / `iqbal.shaikh` / `mahesh.sutar`, shop
`ramesh.gupta`) and checked in SQL after every scenario with `QA/tools/p7/reconcile.mjs` (outputs `QA/evidence/p7/recon-*.txt`).
Every HTTP request/response pair is in `QA/evidence/p7/<scenario>.wire.jsonl`; the scenario verdicts, steps and the
screen-facing figures are in `QA/evidence/p7/results-s1…s6.json`.

Ids DOS-310 … DOS-323. Known findings touched and measured (not re-filed): DOS-225, DOS-249, DOS-256, DOS-258, UX-O-14 —
see `QA/10-business-logic-audit.md`.

| Id | Priority | Category | One line |
| --- | --- | --- | --- |
| DOS-310 | P0 | business-logic | The same cheque number / the same UPI UTR is accepted again as a new receipt — money credited twice |
| DOS-311 | P0 | business-logic | Money paid after a bad-debt write-off is parked as the shop's credit; the write-off is never recovered |
| DOS-322 | P0 | bug | A scheme line picked from several batches carries the whole scheme on every batch line: scheme spend and the brand claim are multiplied |
| DOS-323 | P0 | bug | Splitting a line across batches re-rounds its GST per batch: the bill can differ from the order the shop agreed (₹1 here) |
| DOS-312 | P1 | business-logic | Money on account is never applied to later bills; the credit gate and ageing count the gross bills, so a shop in credit is held |
| DOS-313 | P1 | business-logic | The credit gate ignores confirmed orders that are not billed yet: two orders together pass a strict limit with no approval |
| DOS-314 | P1 | business-logic | Credit mode "stop" behaves exactly like "strict": a manager approves credit to a stopped shop |
| DOS-315 | P2 | business-logic | A deactivated shop can still be ordered for, confirmed and billed on credit |
| DOS-316 | P2 | missing-feature | No refund, payout or debit note: money on account cannot be returned; a bounced cheque's bank charge cannot be recovered |
| DOS-317 | P2 | bug | GST summary / GSTR-1 register under-counts documents (max per row instead of distinct) |
| DOS-318 | P3 | missing-feature | No replacement document (goods for goods): a credit note plus a new order and bill is the only way |
| DOS-319 | P3 | bug | Demo seed leaves ₹1,52,536 "Cash with delivery crews" on a settled trip (TRIP-20260615-1) |
| DOS-320 | P3 | ux | A bill closed by a credit note (refused, never paid) shows state "paid" |
| DOS-321 | P3 | bug | The daily sales register carries no credit notes although the rollup has them |

---

> **Judged by the main session, 2026-09-28.** DOS-310 is CONFIRMED in SQL on `dos_test_p7_money`: UPI reference UTR1790564510946 stands on three collected receipts across two shops (₹315.00), cheque CHQ088789 on two for one shop (₹1,190.00). DOS-322 = DOS-330 and DOS-323 = DOS-332 of the pricing phase (`QA/findings/16-pricing-tax.md`), found independently by both lanes; each is fixed once. DOS-317 is raised to P1 (a CA copies the document counts into the return). The other findings were read, not re-run. Rulings: docs/22 §8, row "Architect rulings, money and credit". Nothing is fixed yet.

### DOS-310 — The same cheque number / the same UPI UTR is accepted again as a new receipt — money credited twice
Category: business-logic | Priority: P0 | Role: Accountant (also Manager, Owner, Delivery — same endpoint) | Platform: API

```
User: Accountant (amol.vaidya) via manager-service /manager/receipts
Platform: API (all-in-one :3630), db dos_test_p7_money
Environment: local test, demo seed + QA p7 shops
Steps:
  1. Shop R-9036 (QA P7 PB5) has bill INV/9018 for ₹595.00.
  2. POST /manager/receipts {mode: cheque, reference: CHQ088789, bankName: Cosmos Bank, amountPaise: 59500} → 200 RCPT-9021,
     allocated to the bill, bill paid.
  3. Same body again with a NEW id and idempotencyKey (what a second desk, or the desk after the crew already recorded
     the cheque, sends) → 200 RCPT-9022, ₹595.00 unallocated, on the shop's account.
  4. Shop R-9068 (QA P7 PB7): POST /manager/receipts {mode: upi, reference: UTR1790564510946, ₹105.00} → RCPT-9103;
     the same UTR again → RCPT-9104 (200); the same UTR against a DIFFERENT shop R-9036 → RCPT-9105 (200).
Expected: a cheque number already recorded live for that shop, and a UPI/NEFT reference (UTR — unique per bank transfer)
  already recorded anywhere in the distributor, is refused (409 naming the first receipt) or at least held for the desk.
Actual: all accepted. Same-key replays are handled correctly (identical body → same RCPT-9028, QA/evidence/p7/A9-replay.json;
  a paper slip with the same deviceId + clientReceiptNo → same RCPT-9023), but a new key with the same instrument creates
  new money. Reconciliation R5c flags: "cheque CHQ088789 recorded 2× (RCPT-9021,RCPT-9022)", "upi UTR1790564510946
  recorded 3× across 2 shop(s) (RCPT-9103,RCPT-9104,RCPT-9105)".
Business impact: ₹595.00 (cheque) + ₹210.00 (two extra UPI) of money that was received once is booked twice/three times:
  Cheques in hand and UPI clearing are overstated by ₹805.00; R-9036 shows ₹750.00 on account of which ₹700.00 (the
  cheque ₹595.00 + the UTR ₹105.00) was never paid, R-9068 ₹105.00 — and that credit will silently pay their next bills.
  Every duplicate is the full receipt amount.
Evidence: QA/evidence/p7/A9.wire.jsonl (4 POSTs: 200 RCPT-9021, 409, 409, 200 RCPT-9022), QA/evidence/p7/A9b.wire.jsonl,
  QA/evidence/p7/results-s2.json (A9, A9b), QA/evidence/p7/recon-S2-A9-duplicates.txt, recon-S2-A9b-utr.txt (R5c)
Suggested fix: in receivables.recordReceipt refuse (409 `instrument_already_recorded`, naming the receipt) a live receipt
  (not reversed/bounced) with the same (mode = cheque, retailer, reference, bank) or the same (mode in upi/bank_transfer,
  reference) in the tenant; back it with a partial unique index on receipts for live rows. The offline upload door gets
  the same check as a recorded sync rejection.
```

### DOS-311 — Money paid after a bad-debt write-off is parked as the shop's credit; the write-off is never recovered
Category: business-logic | Priority: P0 | Role: Owner / Accountant | Platform: API

```
User: Owner (sunil.tarsun) writes off; Accountant (amol.vaidya) records the later payment
Platform: API (all-in-one :3630), db dos_test_p7_money
Steps:
  1. Shop R-9037 (QA P7 PB6), bill INV/9019 ₹595.00; ₹200.00 received (RCPT at desk).
  2. POST /owner/receivables/write-offs ₹10.00 (rounding) then ₹385.00 (bad_debt) → bill state written_off,
     Bad debts +₹395.00.
  3. The shop turns up and pays the ₹395.00 it owed: POST /manager/receipts cash ₹395.00 (FIFO) → RCPT-9027,
     allocated ₹0.00, unallocated ₹395.00.
  4. Next order billed (₹595.00): dues ₹595.00, money on account ₹395.00, net ₹200.00.
Expected: a payment against a written-off debt is a recovery — the write-off is undone (Cr Bad debts or "bad debts
  recovered"), the old bill is settled, and the shop's new bill stays owed in full. There is no way to do that: the API has
  POST /receivables/write-offs only (no reverse), and POST /allocations of RCPT-9027 to INV/9019 answers
  409 "bill INV/9019 is written_off; only an open bill takes money" (QA/evidence/p7/A13b.json).
Actual: the bill stays written_off, Bad debts stays at ₹2,443.00 (seed ₹2,047.00 + this ₹395.00 + a ₹1.00 accountant
  test write-off on INV/9017), and the recovered ₹395.00 becomes
  the shop's credit. Every screen then tells the desk and the crew the shop owes ₹200.00 net on a ₹595.00 bill.
Business impact: ₹395.00 per recovery is booked as a loss AND handed back to the shop as credit — the distributor collects
  ₹395.00 less on the next bill while the P&L still shows the bad debt. Same for every late payer after a write-off.
Evidence: QA/evidence/p7/A13.wire.jsonl, A13b.wire.jsonl, A13b.json, QA/evidence/p7/results-s2.json (A13: "shop after late payment",
  "next bill: dues and on-account side by side"), QA/evidence/p7/recon-S2-A13-writeoff.txt
Suggested fix: add receivables.writeOffs.reverse (back office, audited): a mirror journal entry (Dr AR / Cr BAD_DEBTS),
  a negative write-off allocation, invoice state re-derived; and in recordReceipt, when the shop has written-off bills and
  no open ones, offer "recover the write-off" instead of on-account (explicit allocation to a written_off bill reopens it).
```

### DOS-322 — A scheme line picked from several batches carries the whole scheme on every batch line: scheme spend and the brand claim are multiplied
Category: bug | Priority: P0 | Role: Owner / Accountant (claims), Warehouse (the pick that splits) | Platform: API

```
User: Owner (sunil.tarsun) — scheme, register, claim; Godown (kavita.sawant) — pick/pack
Platform: API (all-in-one :3630), db dos_test_p7_money
Steps:
  1. Owner creates a company-funded, claimable scheme "5 % on Sunbake Glucose 110 g" for shop R-9064 (brand Sunbake).
  2. Rep orders 60 pcs → order line: rate ₹15.10, 5 % scheme amountPaise 4530 (₹45.30), plus the shop's 3.33 % order
     scheme ₹28.66; discount ₹73.96.
  3. The godown picks FEFO from the small old batches: bill INV/9170 has 6 lines (1 + 8 + 12 + 8 + 16 + 15 pcs). The line
     discounts are split correctly (Σ ₹73.96), but EVERY batch line carries applied_rules amountPaise 4530 for the 5 %
     scheme (billing copies the order line's applied_rules verbatim — invoices.service.ts `appliedRules:
     i.orderLine.appliedRules`).
  4. GET /owner/reporting/registers/scheme-spend?schemeId=… → amountPaise 27180 (₹271.80).
  5. Sunbake claim policy set; POST /owner/claims (kind scheme, today) + POST /owner/claims/{id}/build → 6 claim lines for
     INV/9170 totalling ₹271.80.
Expected: the scheme cost and the claim on the brand are ₹45.30 — once per order line, however many batches it shipped from.
Actual: ₹271.80 = 6 × ₹45.30 in the register and in the claim; free goods likewise (the 7+1 Glucose scheme gave 6 free
  pieces on today's bills but the rule rows add up to 9). Over today's S5b bills: order 3.33 % scheme ₹1,094.06 recorded vs
  ₹907.43 given, Marie 7.5 % ₹224.25 vs ₹153.12, soap ₹0.37/pc ₹61.79 vs ₹51.06; 31 order lines were split across batches
  today, 20 of them carrying a scheme (the seed's history has none). The pieces actually given free are right (6 on the
  bill lines), and invoice totals, GST and the journal are right; the scheme money recorded is not.
Business impact: ₹226.50 over-claimed from Sunbake on ONE 60-piece bill (6×); a company claim built from a month of
  split lines asks the brand for money that was never given — the brand's audit rejects it or the distributor keeps money it
  is not owed; the distributor-funded scheme spend and the owner's margin view are overstated the same way (₹268.49 +
  3 free pieces on today's RND bills alone).
Evidence: QA/evidence/p7/S5c.wire.jsonl, s5c-scheme-spend.json, s5c-claim-lines.json, results-s5.json (S5c),
  s5d-scheme-check.json (per ORDER line the engine is right: 160/160), s5b-rounding-rows.json
Suggested fix: when billing splits an order line into batch lines, split each applied rule's amountPaise / freeQty by the
  same allocation used for discount_paise (largest remainder), or keep the rules on the first batch line only and mark the
  others as a continuation; the scheme-spend and claim queries then sum correctly. Add a guard test: Σ rule amounts over a
  bill's lines = Σ discount_paise.
```

### DOS-323 — Splitting a line across batches re-rounds its GST per batch: the bill can differ from the order the shop agreed (₹1 here)
Category: bug | Priority: P0 (lane rule: money wrongly rounded is P0; the amount is at most ₹1 a bill) | Role: Salesperson / Shop / Warehouse | Platform: API

```
User: Rep places, godown packs
Platform: API (all-in-one :3630)
Steps:
  1. Inter-state shop R-9065: order SO-1021 priced at ₹718.00 (line 2: 9 × ₹7.90 − ₹2.37 = ₹68.73 taxable, IGST 18 %
     ₹12.37; Σ lines ₹718.49 → round-off −₹0.49).
  2. The godown picks line 2 from two batches (1 + 8 pcs). The bill INV/9129 taxes each batch line separately: ₹7.64 → ₹1.38,
     ₹61.09 → ₹11.00 = ₹12.38 (one paisa more); Σ lines ₹718.50 → rounds UP to ₹719.00 (round-off +₹0.50).
Expected: the bill equals the priced order (GST per order line, or the batch lines' tax allocated from the order line's
  tax so they sum to it).
Actual: 1 of 66 varied bills (S5b) is ₹1.00 more than its order; the tax on it is 1 paisa more. 31 order lines were split
  across batches today; any of them can move tax by ±1 paisa and, at a .50 boundary, the bill by ₹1.
Business impact: ₹1.00 on INV/9129; the shop, the rep's order screen and the credit check saw ₹718.00. Small per bill, but
  the order and the bill disagree, which is exactly what the shop disputes at the door.
Evidence: QA/evidence/p7/s5b-rounding-rows.json (INV/9129: orderTotal 71800, invoiceTotal 71900), s5b-run.log
  ("orderVsBill":{"0":65,"100":1}), SQL of the order and invoice lines in QA/18-data-consistency-report.md §4
Suggested fix: in billing, allocate the order line's taxable, GST and cess to its batch lines (largest remainder) instead of
  recomputing them per batch; assert invoice total = order total for a fully packed order.
```

### DOS-312 — Money on account is never applied to later bills; the credit gate and ageing count the gross bills, so a shop in credit is held
Category: business-logic | Priority: P1 | Role: Salesperson / Owner / Accountant | Platform: API

```
User: Rep (rahul.deshmukh) placing orders; Owner/Accountant reading the shop
Platform: API (all-in-one :3630), db dos_test_p7_money
Steps:
  1. New strict shop R-9034 (QA P7 PB3), limit ₹1,000.00. Accountant records an advance of ₹1,000.00 (RCPT, on account).
  2. Rep orders ₹595.00 → confirmed, picked, packed, billed INV/9015 ₹595.00.
  3. GET /owner/receivables/outstanding/{id}: outstanding ₹595.00, unallocatedCredit ₹1,000.00 (net −₹405.00, the shop
     is in credit). GET /owner/receivables/credit-check?orderTotalPaise=59500 → breached: true, reasons [limit_exceeded],
     headroom −₹190.00.
  4. Seeded R-0047 Mangal Traders (strict, 7 credit days): ₹5,000.00 on account, one ₹867.00 bill 20 days overdue.
     credit-check → breached: true [overdue_days_exceeded]; the rep's ₹106.00 order SO-0995 is held for a credit approval.
     14 seeded Tarsun shops are in this state (on account beside overdue bills, ₹35,380.00 in all), e.g. R-0037 ₹4,800.00
     on account beside ₹32,464.00 overdue.
Expected: money the shop has already paid settles its oldest open bill (FIFO) when the bill is issued (or at least the
  credit gate, overdue days and ageing use dues net of money on account — docs/22 2026-09-13 DOS-016 says the net dues are
  what match the books).
Actual: on-account money waits for an accountant to allocate it by hand (POST /allocations works — A5b); until then the
  bill ages, counts as overdue (dues reminders, overdue-days breach) and counts in full against the limit
  (checkCredit exposure = outstanding + undelivered, never less on-account).
Business impact: shops that have prepaid are held for credit and chased for money they do not owe — R-9034 is ₹405.00 in
  credit yet breached by ₹190.00; R-0047 is ₹4,133.00 in credit yet every order waits for the owner. Across the seed,
  ₹35,380.00 of on-account money sits beside overdue bills in 14 shops.
Evidence: QA/evidence/p7/A5b.wire.jsonl, results-s2.json (A5b), QA/evidence/p7/C9.wire.jsonl, results-s3.json (C9),
  recon-S3-C9-in-credit.txt
Suggested fix: (a) at bill issue (billing → receivables.postInvoiceIssued) apply the shop's unallocated receipts and credit
  notes FIFO to the new bill; (b) in checkCredit use max(0, outstanding − unallocatedCredit) + undelivered for the limit and
  ignore overdue days while the shop's net is ≤ 0.
```

### DOS-313 — The credit gate ignores confirmed orders that are not billed yet: two orders together pass a strict limit with no approval
Category: business-logic | Priority: P1 | Role: Salesperson | Platform: API

```
User: Rep (rahul.deshmukh)
Platform: API (all-in-one :3630)
Steps:
  1. New strict shop R-9040 (QA P7 CR3), limit ₹1,000.00, nothing owed.
  2. Rep orders ₹595.00 → SO-0898 confirmed (not billed).
  3. GET /sales/receivables/credit-check?orderTotalPaise=59500 → headroom ₹405.00, breached false.
  4. Rep orders another ₹595.00 → SO-0899 confirmed, no approval.
  5. Both picked, packed and billed → outstanding ₹1,190.00 on a ₹1,000.00 strict limit (headroom −₹190.00).
Expected: exposure = dues + bills on vans + confirmed/picking/packed-but-unbilled orders; the second order is held for a
  credit approval.
Actual: checkCredit reads only billed dues (retailer_outstanding_summary), so any number of orders placed before billing
  each see the full headroom.
Business impact: ₹190.00 over the limit in this run with no approval ever raised; unbounded in practice (a rep can place N
  orders in a morning before the godown bills them). The strict/stop modes do not hold.
Evidence: QA/evidence/p7/C3.wire.jsonl, results-s3.json (C3), recon-S3-C3-two-orders.txt
Suggested fix: add the value of the shop's confirmed/picking/packed orders that have no issued bill to the exposure in
  checkCredit (and to the rep's credit-check reply as "orders in hand").
```

### DOS-314 — Credit mode "stop" behaves exactly like "strict": a manager approves credit to a stopped shop
Category: business-logic | Priority: P1 | Role: Manager | Platform: API

```
User: Manager (vikas.kadam)
Platform: API (all-in-one :3630)
Steps:
  1. Owner sets new shop R-9041 (QA P7 CR4) to credit mode "stop", limit ₹500.00.
  2. Rep orders ₹595.00 → SO-0900 held, approval kind credit_limit.
  3. POST /manager/approvals/{id}/decide {decision: approve} as the manager → 200; SO-0900 confirmed.
Expected: "stop" is stronger than "strict": docs/plans/receivables.md §14 says the two modes raise the same approval and
  "the difference is what the owner may do with it"; the code comment on checkCredit says "stop blocks without an owner
  override". A manager should not be able to release credit on a stopped shop (owner only, or cash-only).
Actual: orders.approvals.decide has no stop-specific rule (PERMISSIONS: MANAGEMENT); a manager approves it like any strict
  hold. The only difference the mode makes today is the "Credit stopped" chip at the door (DOS-066).
Business impact: a ₹595.00 order was confirmed and its stock reserved on credit for a shop the owner had stopped, without
  the owner; from there it bills and ships like any other order.
Evidence: QA/evidence/p7/C4.wire.jsonl (POST /manager/approvals/01a0e5c5-0819-…/decide → 200), results-s3.json (C4)
Suggested fix: in approvals.decide, a credit_limit approval on an order of a creditMode = 'stop' shop may be approved
  by the owner only (403 for manager with a message), or only after the order is switched to pay-on-delivery/cash.
  Needs a founder ruling on what "stop" means.
```

### DOS-315 — A deactivated shop can still be ordered for, confirmed and billed on credit
Category: business-logic | Priority: P2 | Role: Salesperson | Platform: API

```
User: Rep (rahul.deshmukh); Owner deactivates
Steps:
  1. Owner POST /owner/retailers with the shop's full record and active: false → R-9043 (QA P7 CR4b) active = false.
  2. Rep creates and submits a ₹384.00 order → SO-0906 confirmed; credit-check → breached false.
  3. Godown picks and packs → INV/9025 ₹384.00 issued to the inactive shop.
Expected: an inactive shop is refused at order create/submit (or at least held), and cannot be billed.
Actual: `active` has no effect on ordering, the credit gate or billing.
Business impact: credit keeps flowing to shops the owner has closed (₹384.00 here).
Workaround: set credit mode stop (but see DOS-314).
Evidence: QA/evidence/p7/C4b.wire.jsonl, results-s3.json (C4b)
Suggested fix: orders.create/submit and repeatLast refuse a retailer with active = false (409 "shop is inactive").
```

### DOS-316 — No refund, payout or debit note: money on account cannot be returned; a bounced cheque's bank charge cannot be recovered
Category: missing-feature | Priority: P2 | Role: Accountant | Platform: API

```
User: Accountant (amol.vaidya)
Steps:
  1. Shop R-9029 (QA P7 PA3) over-paid ₹105.00 at the door (A3) → ₹105.00 on account.
  2. Look for a way to pay it back: no refund/payout/debit-note path in the owner or manager API (openapi paths scanned);
     POST /receipts with −₹105.00 → 400; mode "adjustment" ₹105.00 → accepted as RCPT-9024 but it ADDS ₹105.00 more
     credit (Dr Round off, Cr AR) — reversed at once.
  3. Cheque bounce (A7c, RCPT-9010 → RCPT-9012) with bankChargesPaise 25000: Dr Bank charges ₹250.00 / Cr Bank; nothing
     reaches the shop's dues and no debit note can be raised.
Expected: a refund (money out, Dr AR / Cr Cash|Bank, against on-account money only) and a debit note (bank charges,
  interest) exist for the back office.
Actual: neither exists; the only "money out" is reversing a whole receipt, which reopens bills the shop did pay.
Business impact: every over-payment stays a liability to the shop forever (6 QA shops hold only credit after this run,
  ₹1,759.00; 14 seeded shops hold ₹35,380.00 on account beside overdue bills);
  a cash refund handed over the counter cannot be booked, so the cash drawer and the book disagree by that amount;
  ₹250.00 per bounced cheque is absorbed by the distributor.
Evidence: QA/evidence/p7/A12.wire.jsonl, A7c.wire.jsonl, results-s1.json (A7c), results-s2.json (A12)
Suggested fix: receivables.refunds.create (back office, from on-account only, cash/bank/UPI) and billing.debitNotes
  (a charge on the shop, allocatable like a bill).
```

### DOS-317 — GST summary / GSTR-1 register under-counts documents (max per row instead of distinct)
Category: bug | Priority: P2 | Role: Owner / Accountant | Platform: API

```
User: Owner (sunil.tarsun)
Steps:
  1. After the day's run (final read 09:00 IST): 164 bills dated 2026-09-28 (163 live + 1 cancelled), 8 credit notes.
  2. GET /owner/billing/gst-summary?from=2026-09-28&to=2026-09-28&groupBy=rate → totals.documentCount 128,
     creditNoteTotals.documentCount 6.
  3. GET /owner/reporting/registers/gst-sales (same) → 128 / 6. groupBy=hsn → 87 / 6.
     (An earlier read at 08:30 IST, 95 live bills: 77, HSN 50, credit notes 6 — s6-run-0830.log.)
Expected: documents = distinct bills (163; GSTR-1 table 13 "documents issued" also wants the cancelled one: 164) and
  distinct credit notes (8).
Actual: registers.service.ts computes totals.documentCount as the MAXIMUM of the per-row counts ("documentCount is a
  MAXIMUM, not a sum"), so any bill spread over several rates/HSNs makes the count wrong.
  Values are right to the paisa: taxable ₹49,804.01, CGST ₹3,374.13, SGST ₹3,374.13, IGST ₹1,550.40, cess ₹1,500.15;
  credit notes taxable ₹1,277.48, tax ₹360.69 — all equal the invoice/credit-note lines in SQL.
Business impact: the document counts a CA copies into GSTR-1 are short by 35 bills (21 %; by HSN 76, 47 %) and 2 credit
  notes (25 %) for one day.
Evidence: QA/evidence/p7/s6-gst.json, s6-report-diffs.json, s6-run.log and s6-run-0830.log ("≠ GST … documents"), s5-gst-summary.json
Suggested fix: compute count(distinct invoice_id) / count(distinct credit_note_id) for the totals in the same query, and
  add a cancelled-documents count.
```

### DOS-318 — No replacement document (goods for goods): a credit note plus a new order and bill is the only way
Category: missing-feature | Priority: P3 | Role: Manager / Delivery | Platform: API

```
Steps: owner/manager API paths scanned for replace/exchange/swap → none (results-s4.json R9).
Expected: a damaged or wrong item can be swapped for the same item without money moving.
Actual: the desk must raise a return credit note and a new order → a new bill, pick, pack and trip; the shop sees a
  credit and a new invoice for what was a swap.
Business impact: no money is lost, but every replacement doubles the paperwork and the GST documents.
Evidence: QA/evidence/p7/results-s4.json (R9)
Suggested fix: a replacement order type that ships against the credit note without a new bill (delivery challan only).
```

### DOS-319 — Demo seed leaves ₹1,52,536 "Cash with delivery crews" on a settled trip (TRIP-20260615-1)
Category: bug | Priority: P3 | Role: Owner | Platform: API (seed data only)

```
Steps: `pnpm db:seed` on a fresh copy, then QA/tools/p7/reconcile.mjs (QA/evidence/p7/recon-00-baseline.txt).
Expected: every settled trip's crew cash nets to zero; the trial balance's "Cash with delivery crews" is ₹0 when no trip
  holds cash.
Actual: TRIP-20260615-1 (settled 15-Jun, expected cash ₹4,521.04) carries four van-sale cash receipts dated 11–12 Sep
  (RCPT-VAN-0001…0004, ₹1,52,536.00) that its settlement never counted; CASH_VAN shows ₹1,52,536.00 in the trial balance
  while the owner's home says cash in transit ₹0 (s6-dashboard.json). Seeded daily_tenant_stats before Jul 2026 are
  synthetic (no bills behind them; 269 of 347 seeded days differ from documents) — August and September agree.
Business impact: the founder's demo books show ₹1.5 lakh with crews that no one holds; it also hides real drift from any
  audit that trusts "CASH_VAN = 0".
Evidence: QA/evidence/p7/recon-00-baseline.txt (R6a, R6b), recon-*.txt rows marked "(known: seed baseline)"
Suggested fix: in seed-demo attach the RCPT-VAN receipts to a September trip and settle it (or post the van-sale cash in
  that trip's settlement).
```

### DOS-320 — A bill closed by a credit note (refused, never paid) shows state "paid"
Category: ux | Priority: P3 | Role: Owner / Accountant | Platform: API

```
Steps: S4 R1/R1c — shop R-9058 refused INV/9030 at the door; the desk credited the whole came-back bill (CN/9010 ₹595.00).
Actual: invoices.state = paid (GET /invoices, the sales register row "state": "paid") although no money was ever received.
Expected: "credited" / "closed by credit note", distinct from paid.
Business impact: no money error (receipts and the collections register are right), but the owner reading the bill list
  sees a refused bill as collected.
Evidence: QA/evidence/p7/R1c.wire.jsonl, results-s4.json (R1c "bill after")
Suggested fix: derive a display status "credited" when the allocations are all credit notes.
```

### DOS-321 — The daily sales register carries no credit notes although the rollup has them
Category: bug | Priority: P3 | Role: Owner | Platform: API

```
Steps: GET /owner/reporting/registers/daily-sales?from=2026-09-28&to=2026-09-28 (reporting.dailyStats.tenant).
Actual: the row has invoicedPaise (₹59,609.00 at the final read) and no credited field (DailyTenantStatSchema has none), while
  daily_tenant_stats.credited_paise = ₹1,639.00 and the owner's home shows "credited ₹1,639.00" (DOS-254).
Expected: the register (and its CSV export) shows credited beside invoiced, like the home.
Business impact: the register overstates the day's net sales by the day's credit notes (₹1,639.00 today).
Evidence: QA/evidence/p7/s6-run.log ("daily sales register today", "≠ daily sales register · credited"), results-s6.json
Suggested fix: add creditedPaise to DailyTenantStatSchema and the register query.
```

### DOS-324 — A credit release given before the rate is decided is not measured again
Category: bug | Priority: P2 | Role: Manager / Owner | Platform: API | Found by: blind check 2 of the credit fix lane (V19), 2026-09-28

```
Steps: strict limit Rs 1,000. Order A (Rs 1,190) waits on TWO gates, credit and a bargained rate. The manager releases the
  credit gate. Order B (Rs 595) is placed and confirmed. The owner approves A's rate; A is confirmed.
Actual: Rs 1,658 confirmed on a Rs 1,000 strict limit; the desk approved A alone, never A on top of B.
Expected (architect ruling, 2026-09-28): a credit release covers what the shop owed when it was given plus the order itself.
  If what the shop owes has grown by the time the order's last gate is decided, the order goes back on hold for credit
  with a new request, and the sentence says what changed.
Business impact: needs two gates on one order and a second order in between; the amount over is at most the second order.
Status: OPEN, backlog (P2). Not fixed in the credit lane.
```

