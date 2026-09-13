# Batch 1 outcome and approval gate — 2026-09-13

Stage 1, Phase 4 (batch 1) is implemented and regression-tested. Nothing below this line is approved yet except the nine held plans,
which were already inside the batch-1 approval and have been reviewed by the architect (Fable) with amendments.

## 1. What batch 1 delivered

- **23 fixes merged into main:** 21 decision-free fixes (lanes merged 00:50–00:51 IST) and DOS-029 with its DOS-135 repair (merge d8ae49e,
  08:46 IST). Every fix has a test named for its id that an independent Opus verifier proved fails without the fix and passes with it.
- **CI on merged main:** backend 2 417 tests and frontend 336 tests green before DOS-029 (QA/14 §0b); frontend install, format, lint,
  typecheck and tests green again after the DOS-029 merge (build and app-server restart: see QA/14 §0c).
- **Regression (QA/14):** web and API re-walks; security probes (matrix unchanged, no leak between distributors); business reconciliation
  (stock, journals, invoices, receipts and outstanding tie out); the cross-role chain with the money sanity check PASS; Android; iOS.
- **P0s from Phase 1:** DOS-039 (stock taken twice at load-out), DOS-073 (a rep could cancel another rep's order), DOS-094 (wrong UPI amount
  and reference) — fixed and passing on every platform walked. DOS-106 (support console had super powers) is one of the nine held plans,
  approved with amendments, not implemented yet.

### Fix × platform

| Fix | Web | Android | iOS | API |
|---|---|---|---|---|
| DOS-039 | PASS desk; phone NOT TESTED (one sheet) | not walked (server-side; one real sheet only) | not walked (same) | — (reconciliation + chain confirm stock moves once) |
| DOS-040 | PASS | PASS | PASS | PASS |
| DOS-041 | PASS | PASS | PASS | PASS |
| DOS-042 | PASS | PASS | PASS | — |
| DOS-023 | PASS | PASS | PASS | — |
| DOS-025 | PASS | PASS | PASS | — |
| DOS-058 | PASS | PASS | screen PASS; recorded return BLOCKED (harness) | PASS (residual desk path → DOS-116) |
| DOS-060 | PASS | PASS | PASS | — |
| DOS-057 | PASS | PASS | PASS | — |
| DOS-099 | PASS | PASS | PASS | — |
| DOS-061 | PASS | PASS | PASS | — |
| DOS-094 | PASS | PASS | PASS | PASS |
| DOS-095 | PASS | PASS | PASS | — |
| DOS-021 | PASS | PASS | PASS | — |
| DOS-034 | PASS (scope) — trip cash = DOS-132 | PASS | page-level PASS; in-Sheet dialogs FAIL → DOS-164 | PASS |
| DOS-073 | PASS | PASS | PASS | PASS (residual warehouse/delivery → DOS-115) |
| DOS-075 | PASS | PASS | PASS | PASS |
| DOS-076 | PASS | not walked (server quote; device pricing covered by DOS-075) | not walked (same) | PASS |
| DOS-020 | PASS | PASS | owner PASS; manager FAIL → DOS-164 | PASS |
| DOS-005 | PASS | PASS | PASS | — |
| DOS-077 | PASS desk; phone clipping pre-existing (DOS-128) | PASS | PASS | — |
| DOS-001 | PASS* | PASS | PASS | — |
| DOS-029 | PASS (a–d); e → DOS-135 | PASS* a–c; d FAIL → DOS-156 (held DOS-056) | PASS* | — |
| DOS-135 | PASS (live before/after, desk + phone; unit red→green) | PASS (bundle provenance uncertain) | NOT TESTED (overlap cannot be staged) | — |

**Not fully passing:**
- **DOS-020 and DOS-034 on iOS** — dialogs opened from inside a Sheet never appear on iOS (DOS-164, a pre-existing kit defect). Web and
  Android pass; owner approvals and the Day-end page on iOS pass.
- **DOS-029 on Android** — the no-connection sentence shows a generic error on native (DOS-156); same root cause as the held DOS-056, and
  folded into it.
- **DOS-034 scope** — passes its approved text; trip cash on Day-end is the companion finding DOS-132, which DOS-034's plan asked QA to file
  at the same gate (QA missed that until the regression).

## 2. New findings from the regression — 51 (P0 2 · P1 7 · P2 20 · P3 22)

Every one near a batch-1 fix was checked against the code before the batch (QA/evidence/batch1/regression/part-b-regression-status.md,
bargain-rate-probe/): **none of the P0 or P1 was caused by batch 1.** Architect designs for the P0/P1 are in
QA/evidence/batch1/held-review-brief.md §Architect designs. Full blocks: QA/findings/10-batch1-regression.md.

### P0
- **DOS-115** (security) — Warehouse and delivery logins can cancel, re-line and submit any order in the distributorship (DOS-073 residual)
- **DOS-131** (missing-feature) — No screen in any app can create a delivery trip or add a stop, so a newly packed order can never reach a delivery crew

### P1
- **DOS-116** (business-logic) — A desk credit note for damaged goods puts the pieces back into saleable stock unless each line explicitly says saleable:false
- **DOS-117** (bug) — Overdue and ageing stop moving on days a shop has no posting: no nightly ageing rebuild is scheduled
- **DOS-126** (business-logic) — Approving a rate request on Approvals confirms the order at the old rate, not the approved one
- **DOS-132** (business-logic) — Day-end offers cash still out with a delivery crew, and trip receipts of settled trips, for banking; the deposit credits CASH_VAN for them
- **DOS-133** (bug) — Warehouse Load screen offers 50 arbitrary old packs as 'Packed orders'; today's packed orders never appear, so no load sheet can be built for them
- **DOS-146** (bug) — Trip-start 'Cash handed to you' cannot hold any amount except the planned float: typing appends to ₹3,000 and Clear snaps back
- **DOS-164** (bug) — iOS: a Dialog opened while a Sheet is open never appears (UIKit refuses the second modal) and every later dialog on that screen stays dead until the app is relaunched — the manager cannot decide an order's approvals from its panel, and the accountant cannot bank or bounce a receipt from its panel

### P2
- **DOS-121** (missing-feature) — Load-out in the warehouse app always sends countedVanStock [] and has no van-stock count, so after DOS-039 a sheet's van stock can never be moved to the vehicle from the app
- **DOS-123** (bug) — Retailer bill screen: the proof-of-delivery photo never loads on the web; the POD readUrl is service-relative and resolves against the app's own origin
- **DOS-124** (ux) — Money due → 'Pay this bill' → 'Start the payment' forgets the bill: the Pay screen opens with nothing ticked and the whole ₹35,843 prefilled
- **DOS-125** (missing-feature) — Web pay screens give a shop nothing to scan or tap: no QR image, a raw upi:// string clipped on a phone, and 'Open a UPI app' does nothing visible
- **DOS-127** (bug) — A shop's own cancellation leaves the order's approvals pending, and the owner can neither approve nor reject them
- **DOS-128** (ux) — Sales web app at phone width: catalog rows clip the item name to 4–5 letters
- **DOS-134** (bug) — Manager Pick & pack cannot record a part-case pick row after DOS-041: whole cases only, so 6 pc or 18 pc can be saved only as 0 or refused
- **DOS-135** (bug) — Documents panel drops a refusal that arrives while another write on the same panel is still in flight (DOS-029 residual)
- **DOS-136** (bug) — After a lost reply, pressing Bank it again says 'idempotencyKey was already used with a different request' and the receipt still reads Collected although it was banked
- **DOS-137** (bug) — A load sheet built in the warehouse app is never linked to its trip, so the crew app says the godown has not confirmed the load after it has
- **DOS-138** (missing-feature) — Once picking has started no one can cancel an order; the manager is offered Cancel order and gets a raw state-machine refusal
- **DOS-139** (business-logic) — Cancelling a bill before dispatch returns the stock and the money but leaves the order 'packed' and back in the billing queue
- **DOS-140** (business-logic) — The sellable-stock API offers damaged-bin lots to reps and shops as available
- **DOS-147** (ux) — Android order entry: with the stock chip shown, item names and pack sizes are clipped, so variants cannot be told apart before 'Add a case'
- **DOS-148** (ux) — Delivering a bill whose order was never dispatched fails only after the photo, with the raw message 'order: cannot apply "deliver_partial" in state "packed"'
- **DOS-152** (bug) — Android W5 Short sheet: the Short (save) button and the pad's last row sit below the sheet's scroll viewport, behind 'Close'; tapping where Short is laid out closes the sheet and discards the entry
- **DOS-156** (bug) — Android manager app: a write pressed with no connection says 'Something could not be completed. Try again.' instead of 'No connection. Check the signal, then press again.' (expo/fetch rejects with FetchError, which the api-client does not treat as network)
- **DOS-157** (ux) — Android Load-out: the 'Not out of the godown yet' row collapses its status chip to '…', so the list never says 'Waiting for your approval' or 'Approved'
- **DOS-160** (tech-debt) — An idempotent replay is re-validated against the newer contract, so any additive output field answers 500 for 24 hours after a deploy
- **DOS-161** (ux) — iOS sales order entry: the fixed header and footer leave a 267-pt scroll window, so the catalog shows about one row and a line's stepper slides under the footer

### P3
- **DOS-118** (ux) — Phone Short sheet: the 'this batch asks for N pc' refusal line is laid out below the fold, so pressing Short looks like nothing happened
- **DOS-119** (ux) — A freshly made wave opens as 'Nothing here yet · 0 of 0 picked' with Scan and an enabled 'Take it to packing' for up to a minute before Start appears
- **DOS-120** (ux) — After 'Start picking' the sheet's status chip keeps saying 'picking' next to 'N of N picked' until the screen is reopened
- **DOS-122** (ux) — The irreversible load-out confirm dialog puts 'Send the vehicle out' and 'Cancel' on 32-px-high buttons on a phone
- **DOS-129** (ux) — Order footer counts cases with the first line's case size
- **DOS-130** (ux) — Owner order panel 'Stock held' shows the number of reservation rows, not the pieces held
- **DOS-141** (ux) — Refusals now reach the desk as machine sentences: record UUIDs, UTC ISO times and 'Input validation failed'
- **DOS-142** (ux) — The manager's cancellation reason never reaches the rep's order screen, although the cancel dialog promises it will
- **DOS-143** (bug) — Retailer 'My orders' prints the UTC date: an order placed at 3:05 am IST on 13 Sep reads 'Placed 12 Sep 2026'
- **DOS-144** (ux) — After a short pick the shop's order page still says 'You pay Rs 6,753.00' and '60 pc', while the delivered bill is Rs 6,679.00 for 54 pc
- **DOS-145** (ux) — The manager cannot open a given bill from search: global search lands on Registers, Billing ?q= works only on the 'Bills issued' tab, and that register is not newest-first
- **DOS-149** (ux) — Stop screen stays stale for ~40 s after a successful delivery, still offering 'Deliver this bill' with the old dues and no success message
- **DOS-150** (ux) — Emptied amount field still announces the previous amount to screen readers ('—' shown, '4756 rupees' spoken)
- **DOS-151** (bug) — Invoice and credit-note PDFs print '?' for the em dash in the tenant's own footer ('Tarsun Enterprise ? Wholesale & Distribution')
- **DOS-153** (bug) — Owner Approvals: a note typed for one approval carries into the next approval opened, and is sent with that decision
- **DOS-154** (ux) — Retailer Pay screen: ticking bills disables the amount field but it keeps showing the full dues, contradicting the bottom bar and the intent
- **DOS-155** (ux) — Owner approve dialog on an order's last approval does not say it will confirm the order and reserve stock, and nothing says so afterwards
- **DOS-158** (bug) — Android: a dialog's confirm button keeps the accessibility description 'busy' after its write has settled, instead of its label
- **DOS-159** (ux) — Android credit-note Sheet: after typing a bill number the matching bill row sits under the soft keyboard, and a tap where it is shown hits the keyboard
- **DOS-162** (bug) — Cancelling the iOS print dialog raises an uncaught PrintIncompleteException (delivery papers and retailer bill)
- **DOS-163** (ux) — iOS delivery return reasons: the three-segment control overflows the line card and 'Past its date' is clipped at the screen edge
- **DOS-165** (ux) — iOS W5 Short sheet: the third reason chip is clipped to 'Batcl' at iPhone width and half of it lies off-screen, so a tap there misses and the default 'Not on the rack' is what gets saved

## 3. Recommended batch 2

1. **The nine held plans, as amended** (already approved): DOS-032+059 first (schema; then rebuild dos_qa from the fixed seed, Q5),
   DOS-074+097 (+ DOS-140's rep/shop half), DOS-096, DOS-003, DOS-004, DOS-106, DOS-043, DOS-007, DOS-056 (+ DOS-156).
2. **New P0:** DOS-115 (remove warehouse and delivery from order cancel / re-line / submit / create — a permission-matrix change) and
   DOS-131 (Plan a trip on W10 and M7; load sheets built for a trip, which also closes DOS-137).
3. **New P1:** DOS-164 first (kit: one modal host for Sheet + Dialog — needs a short Fable design; it unblocks DOS-020 and DOS-034 on iOS),
   then DOS-126, DOS-132, DOS-116, DOS-117, DOS-133, DOS-146.
4. P2/P3 go to the Phase 3 backlog. Still open and unapproved from Phase 1: the eight off-chain P1 (DOS-031, 037, 044, 080, 098, 107, 108, 109).

Founder's words (Charter A.6): "Continue" · "Fix P0/P1" · "Implement all approved" · "the product is right".
