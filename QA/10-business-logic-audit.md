# 10 — Business-logic audit: money, credit and returns (Phase 7, money lane)

Run 2026-09-28 (IST) on the test database `dos_test_p7_money` (copy of `dos_test_batch2b_template`, `pnpm db:migrate` +
`pnpm db:seed`, both exit 0) against the all-in-one API on :3630 with the worker in process (`DOS_MODE=all
WORKER_INLINE=1`; the first start without `DOS_MODE=all` ran no worker, so it was restarted before any scenario). Every step
went through the product's own oRPC contract client as the person who does it; nothing was written to the database by
hand. After every scenario `QA/tools/p7/reconcile.mjs` recomputed the tenant's money from SQL
(`QA/evidence/p7/recon-<scenario>.txt`).

**The invariant proved after every scenario** (the reconciliation, R1–R8): per bill, total = receipts + cash discount +
credit notes + write-offs + open, never over-allocated, state agrees; per shop, open bills + bills on vans − money on account
= Sundry Debtors in the journal = the stored summary (every field, ageing buckets aged to today); in aggregate the same;
every journal entry balances and every document carries exactly its entry; every receipt is allocated + on account or
reversed by an exact mirror; crew cash nets to zero per settled trip and banked trip cash never exceeds what was handed
over; rollups equal the documents for the days the product computed; header arithmetic and round-off.

**Result.** Baseline (fresh seed) and final (`recon-99-final.txt`) both RECONCILED except rows that are known: the seed's
own TRIP-20260615-1 (DOS-319), two duplicate instruments (DOS-310) and a short settlement banked at face value (DOS-258,
known, measured). `--strict` names them (`recon-99-final-strict.txt`, exit 1). Every screen-facing figure of every shop
touched agreed with SQL and with the journal at every snapshot (`QA/18-data-consistency-report.md`). The money that goes
wrong is money the product accepts twice (DOS-310), attributes to the wrong thing (DOS-311), counts once per batch instead
of once per line (scheme spend and brand claims, DOS-322; a ₹1 order-vs-bill rounding flip, DOS-323) or does not count
where it should (DOS-312, DOS-313). The bill, GST, journal and receipt arithmetic itself held to the paisa on 132 bills.

Findings: `QA/findings/15-money.md` — P0 4 · P1 3 · P2 3 · P3 4.

## Scenarios

`Recon` is the reconciliation right after the scenario. "RECONCILED*" = reconciled apart from rows already known at that
moment. Reconciliation checks R5c (duplicate instruments), R6b (settlements followed by a later undo), R6d (banked vs
handed over) were sharpened during the run; the four `recon-S2-*` files that show "BROKEN" (A8b, A9, A12, A13) were run before those
refinements: R5c there is DOS-310 itself, R6b was the checker counting a receipt reversed after settlement against that
settlement (corrected; every later run passes it).

### A. Payments

| Id | What was done (as whom) | Invariant / result | Finding |
| --- | --- | --- | --- |
| S1-setup | 6 shops (owner), 6 orders (rep) auto-confirmed, one wave picked/packed (godown) → 6 bills of ₹595.00, one trip (manager plans, godown loads, manager approves the sheet, godown confirms, crew departs with ₹1,000 float); all delivered in full with POD | order total = bill total (₹595.00); RECONCILED* | — |
| A1 | Payment in full, cash at the door (crew) | receipt RCPT-9006 allocated ₹595.00, bill paid, 5 screens = SQL = AR; RECONCILED* | — |
| A2 | Part payment ₹200 at the door | bill partially_paid, open ₹395.00 everywhere; RECONCILED* | — |
| A3 | Over-payment: bill + ₹105 at the door | bill paid, ₹105.00 on account, net −₹105.00 = AR on every screen; RECONCILED* | (refund: DOS-316) |
| A11 | UPI at the door with UTR | Dr UPI clearing / Cr AR, never the crew's cash; settlement lists it apart; UPI cannot be banked (409) — DOS-256 known, measured: UPI clearing ₹30,06,213.85 at the S6 read (seed ₹30,02,293.85 + today's ₹3,920.00), none of it ever reaches Bank | DOS-256 (known) |
| A7a | Cheque at the door | Dr Cheques in hand; bill paid; RECONCILED* | — |
| A10 | Cash discount 2 %/7 days: shop pays ₹583.10 on a ₹595.00 bill inside the window | discount ₹11.90 realised on the receipt (Dr Cash discount allowed), bill paid, nothing on account. Realised as a journal line, not a credit note (docs/22 §6 draws a credit note; the 2026-09-04 ruling says "realised at receipt only") — no money error | — |
| A7b | Check-in + settle (manager) at the preview's expected cash; bank the cash and the cheque (accountant) | expected cash = float ₹1,000 + every cash receipt = ₹3,078.10 exactly; deposit ₹2,673.10; RECONCILED* | — |
| A7c | The banked cheque bounces with ₹250 bank charge | bill reopened in full (₹595.00), AR restored, Bank −₹595.00 −₹250.00, charge borne by the distributor (no debit note) | DOS-316 |
| A7d | Short settlement: ₹595 collected, ₹545 handed over (inside tolerance), receipt banked at face value | DOS-258 (known) measured: Cash in hand −₹50.00 net, Bank +₹595.00 for ₹545.00 of notes; reconciliation R6d names TRIP-0006 | DOS-258 (known) |
| A7e | Late cash for a settled trip at the door; the cashier records it | door refuses (409 "trip … is settled"), desk records it with no trip; RECONCILED* | — |
| A4a | Desk cash against outstanding, no bill named (seeded R-0020, 6 open bills) | FIFO by due date: INV/0571 and INV/0598 in full, INV/0701 in part, nothing else; RECONCILED* | — |
| A4b | Desk NEFT hand-picked to the newest and a middle bill (R-0015) | exactly the two named bills; a line above what a bill owes → 409; a split above the receipt → 409; RECONCILED* | — |
| A6 | Receipt kept on account (strategy none), then allocated by the accountant, then the allocation removed | on account → allocated → back on account, no journal; over-allocation → 409; RECONCILED* | — |
| A5a | Payment before delivery: bill packed, UPI at the office, then trip + delivery + settle | bill paid in the godown; settlement carries no cash/UPI for it. The crew's stop list still shows "to collect ₹595.00" (plannedCollectionPaise is static) — same root as DOS-249 (known), measured ₹595.00 | DOS-249 (known) |
| A5b | Advance ₹1,000 before any order; ₹595 order billed | advance NOT applied to the new bill; dues ₹595.00 beside ₹1,000.00 on account; credit gate breached (headroom −₹190.00) though the shop is ₹405.00 in credit | **DOS-312** |
| A8 | Desk cash across 2 bills, then reversed | both bills reopened, Cash in hand −₹798.00 exactly, second reversal → 409; RECONCILED* | — |
| A8b | Reverse S1's settled AND banked cash receipt | the undo takes the money from Bank (Dr AR / Cr Bank), not from the van; RECONCILED after the R6b correction | — |
| A9 | Same receipt: same key + identical body; same key + different body; new key + same cheque number; same paper slip twice | identical replay → same receipt (A9-replay.json); changed body → 409; paper slip (device + book no.) → one receipt; **same cheque number with a new key → accepted, ₹595.00 credited twice** | **DOS-310** |
| A9b | Same UPI UTR twice for one shop, then for another shop | both accepted (₹210.00 duplicated) | **DOS-310** |
| A12 | Refund of ₹105 on account | no refund / payout / debit-note endpoint; −₹105 → 400; mode "adjustment" adds credit (reversed) | **DOS-316** |
| A13 | ₹200 paid, ₹10 + ₹385 written off (owner), then the shop pays ₹395 | the ₹395.00 is parked on account, the bill stays written_off, Bad debts unchanged, allocation to the written-off bill → 409; next bill shows net ₹200.00 owed | **DOS-311** |
| A13 (roles) | write-off by accountant / by rep | accountant accepted (docs/22 2026-09-05 allows; the contract summary still says "owner only" — text drift), rep 403 | — |

### B. Credit

| Id | What was done | Invariant / result | Finding |
| --- | --- | --- | --- |
| C1 | Warn-only (indicate) shop, ₹595 order on a ₹500 limit | confirmed with a credit notice (DOS-081 as ruled) | — |
| C2 | Strict shop: limit = order + ₹0.01, = order, = order − ₹0.01 | under → confirmed; exactly at → confirmed; over by ₹0.01 → held (credit_limit); owner approves → confirmed, limit unchanged (DOS-006) | — |
| C3 | Strict ₹1,000 limit, two ₹595 orders before either is billed | both confirmed; ₹1,190.00 billed on a ₹1,000.00 strict limit with no approval | **DOS-313** |
| C4 | Stop shop over its limit; manager decides; shop switched to warn-only; deactivated/reactivated via a partial upsert | manager approval accepted (confirmed); rep 403; the held order is not re-evaluated when the mode changes; a partial upsert of the shop record clears its beat (the rep then gets 403 on its dues — client-side cause, noted) | **DOS-314** |
| C4b | Shop deactivated with its full record; rep order | confirmed and billed (INV/9025 ₹384.00) on an inactive shop | **DOS-315** |
| C5 | Pay-on-delivery (terms ON), strict, limit 0 | held for credit — DOS-225 (known, ruling pending) | DOS-225 (known) |
| C6 | Seeded R-0017: 6-bill cap / 7 credit days, then 5-bill cap | overdue_days_exceeded (62 days) and bill_count_exceeded reported as configured | — |
| C7 | Limit lowered to ₹200 on ₹1,190 owed | headroom −₹991.00 for a ₹1 order; next order held | — |
| C8 | Seeded R-0001 with its own login (ramesh.gupta, 3 distributors) | owner, accountant, rep, crew and the shop app show ₹35,843.00 = SQL = AR; the shop's card carries no limit/mode (DOS-100 holds); rep order held for overdue days (53) | — |
| C9 | Seeded R-0047: ₹5,000 on account beside one ₹867 overdue bill | gate breached (overdue_days_exceeded), rep order SO-0995 held though the shop is ₹4,133.00 in credit; 14 seeded shops like it (₹35,380.00 on account beside overdue bills). Also seen: the rep could create and submit an order for R-0047, which is not on his beat, while credit-check for it answers 403 — for the access lane (Phase 12) | **DOS-312** |

### C. Returns, damage, cancellation

| Id | What was done | Stock consequence | Money consequence | Finding |
| --- | --- | --- | --- | --- |
| S4-setup | 10 shops, a free-goods (12+2) and a 10 % scheme for one shop, one wave, one trip (8 bills) | — | bills ₹529.00–₹595.00; first attempt stopped at picking (free pieces asked twice by the test driver), those 10 orders cancelled by the desk while picking (S4-cleanup) | — |
| R1 | Full refusal recorded at the door (delivered 0, all returned) | stays on the van; at check-in staged on the dock for the bill (in_transit) | no credit note: the bill is "undelivered" (DOS-197): out of dues (₹0.00), in `undeliveredPaise` ₹595.00, still counted by the credit gate — as ruled | — |
| R1b | Stop failed "refused" | same as R1 | same as R1 | — |
| R1c | Desk credits the whole came-back bill (CN/9010, reason cancellation) | dock → godown (lot 43e143 +12, f5e205 +24) | CN = ₹595.00 incl. GST; dues 0, AR 0; the bill's state reads "paid" | DOS-320 |
| R1d | The other refused bill re-planned on a new trip, delivered, paid cash, settled | dock → van → shop | paid; settlement expected ₹595.00 = handed over; RECONCILED* | — |
| R2 | Part return at the door: 6 of 24 Glucose, saleable | +6 to the van (sale_return_saleable), unloaded to the godown at settlement | CN/9003 ₹53.00 (₹52.68 + ₹0.32 round-off); bill partially_paid, open ₹542.00 | — |
| R3 | Wrong item: 2 Cola back, saleable | +2 to the van, then godown | CN/9004 ₹64.00 incl. 28 % GST + 12 % cess (reason stored as return_saleable; "wrong_item" survives only on the delivery line) | — |
| R4 | 3 Marie damaged + 2 Glucose expired at the door | straight to the damaged bin (+3, +2), never the van or godown (DOS-116 holds) | CN/9005 ₹97.00, reason return_damaged | — |
| R6 | Return after delivery at the desk (accountant): 6 Glucose saleable | +6 godown (sale_return_saleable) | CN/9006 ₹53.00; returning more than is left → 400 "only 18 pcs … left to credit" | — |
| R7 | Return after payment: RT7 paid ₹595 at the door, returns 12 Cola | +12 godown | CN ₹384.00 sits on the shop's account (DOS-245 holds); net −₹384.00 = AR | (refund: DOS-316) |
| R8 | Scheme lines returned: 12 of 24 (+4 free) Glucose and 6 of 12 soap (10 % off) | +12, +6 godown | soap credited at the billed net rate (₹154.49 taxable, DOS-242 holds); Glucose credited at ₹6.38/pc = line value spread over 28 pieces incl. free (pro-rata claw-back of free goods); the rest of the line later credited ₹120.00 ≤ ₹120.40 left | — |
| R9 | Replacement | — | no replacement document; CN + new order + new bill | DOS-318 |
| R10 | Bill cancelled before dispatch (packed, never loaded) | dock → godown (e.g. lot 43e143: dock 816 → 804, godown 5,898 → 5,910) | order cancelled with it (DOS-139), invoice_cancel entry reverses AR ₹595.00; dues 0 | — |
| R11 | Bill paid (UPI) at the office, then cancel | cancel refused 409, message points to "credit the whole bill" | nothing lost: bill paid, AR 0 | — |
| S4-settle | Check-in + settlement of the returns trip | saleable returns → godown, came-back bill → dock, damaged never back to saleable | settlement ₹0 cash; RECONCILED* | — |

### D. Rounding (S5)

| Id | What was done | Result | Finding |
| --- | --- | --- | --- |
| S5 (batch 1) | 3 shops (intra-state registered 27AQPPR7717K1ZZ, inter-state registered 24AQPPR7717K1Z5, unregistered), awkward shop rates (₹71.37, ₹19.99, ₹7.77, ₹4.33 …, +₹0.13 for the Gujarat shop), four schemes (7.5 % line, ₹0.37/pc, 7+1 free, 3.33 % on ₹500+), 66 orders → 66 bills, each paid exactly by UPI | all differences 0 on 66/66 — but **the test's basket generator (LCG low bits) drew only 3 products, one quantity, no scheme**: narrow coverage, kept as evidence, superseded by batch 2 | — |
| S5b (batch 2) | same shops and schemes, a proper generator: 66 bills, 185 lines, 12 variants, all four GST rates (5 / 12 / 18 / 28 + 12 % cess), 15 quantities, 130 discounted lines, 6 free-goods lines, 22 inter-state bills | differences (paise → bills): order vs bill {0: 65, **100: 1**}; independent recomputation vs bill {0: 66}; tax + cess {0: 66}; printed PDF total {0: 66}; Σ lines + round-off vs header {0: 66}; round-off within ±50 p 66/66; CGST = SGST on every intra bill, IGST only on inter bills; headers = Σ lines (taxable ₹48,971.97, CGST ₹3,299.25, SGST ₹3,299.25, IGST ₹1,550.40, cess ₹1,500.15 for the day); 66/66 paid exactly by UPI, ₹0 on account. Scheme arithmetic per order line (s5d): 160/160 right; order 3.33 % right on 65/66 (INV/9130 got it on a ₹491.38 net because the trigger reads the value before line schemes — a Phase 8 question) | **DOS-323** (INV/9129 ₹1) |
| S5c | company-funded, claimable 5 % scheme; a 60-pc line picked from 6 batches; scheme-spend register; Sunbake scheme claim built from the invoices | the scheme (₹45.30) is recorded on every batch line: register and claim ₹271.80 (6×); across today's bills the RND schemes are overstated by ₹268.49 + 3 free pieces | **DOS-322** |

### E. Reports (S6, period = 2026-09-28, final read after the 09:00 IST rollup, every scenario included)

| Report | Result | Finding |
| --- | --- | --- |
| Owner dashboard | 20 figures equal SQL: today invoiced ₹59,609.00, credited ₹1,639.00, collected ₹1,14,212.10, 171 orders, outstanding ₹43,70,178.00, overdue ₹42,76,777.00, on account ₹37,534.00, outstanding − on account = Sundry Debtors less bills on vans, the six buckets, MTD credited, approvals, trips, sparkline. MTD sales ₹20,27,601.00 = invoiced ₹20,32,152.00 − credited ₹4,551.00 (net by design, DOS-254). Cash in transit ₹0 vs Cash with delivery crews ₹1,52,536.00 in the book (seed trip, DOS-319; UX-O-14 known) | DOS-319 |
| Collections register | by day and by collector (4 collectors): cash, UPI, NEFT, cheque, total ₹1,14,212.10, 157 receipts — all equal SQL | — |
| Outstanding / ageing register | 68 shops owing, Σ dues ₹43,70,178.00, on account ₹37,534.00, 6 shops holding only credit listed — equal SQL | — |
| Sales register | 164 rows incl. the cancelled bill (shown at ₹0); Σ total ₹59,609.00, taxable ₹49,804.01 — equal | — |
| GST registers (billing, reporting, by HSN) | every rupee value equal to the lines to the paisa; document counts short: 128 (HSN 87) vs 163 bills, 6 vs 8 credit notes | DOS-317 |
| Trial balance | all 31 accounts equal the journal; total 0; AR ₹43,32,644.00 = Σ shop nets | — |
| Daily sales register | invoiced and collected equal; no credited column | DOS-321 |

An earlier read at 08:30 IST (before S5b, S5c, A9b, C9; `s6-run-0830.log`, `s6-report-diffs-0830.json`) gave the same
verdicts on its own figures (GST documents 77 / 95 then).

## Not run, with the reason

- DOS-250 (the same upload sent twice at the same instant): the offline `/sync/upload` path was not in this lane's
  scenarios — NOT TESTED here.
- DOS-255 (Tally export vouchers): not touched — NOT TESTED here.
- Brand-DMS bills, claims settlements, van sales for cash: not in the Phase 7 list for this lane — NOT TESTED.
- Cash discount paid by cheque that later bounces (discount re-opened by `releaseConditionsOf`): NOT TESTED (no time box
  left for a second cheque bounce inside a cash-discount window).
- iOS / Android / web screens: API only by instruction ("Platform: API"); screen-facing numbers were read from the same
  endpoints the screens call.
