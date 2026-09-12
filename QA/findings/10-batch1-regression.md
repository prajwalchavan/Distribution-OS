# Batch 1 regression — new findings (2026-09-13)

Found while re-testing the merged batch 1 fixes (Charter A.12). Not approved for fixing; they go to the next approval gate.
Environment for all: local dev, services on merged main (after 2abb27e), database `dos_qa` (realistic seed of 2026-09-12).

### DOS-115 — Warehouse and delivery logins can cancel, re-line and submit any order in the distributorship (DOS-073 residual)
Category: security | Priority: P0 | Role: Warehouse, Delivery | Platform: Backend API (warehouse-service :3004, delivery-service :3005); every client that holds such a token

```
User: Warehouse, Delivery
Platform: Backend API (warehouse-service :3004, delivery-service :3005); every client that holds such a token
Environment: local dev, merged main after batch 1 lanes, dos_qa
Steps:
  1. As rahul.deshmukh on sales-service :3003, create and submit SO-0889 (R-0015 Ganpati General Stores) and SO-0891 (R-0011 Sai Baba Kirana); both auto-confirm with stock reserved. 2. As dinesh.patil (warehouse): POST http://127.0.0.1:3004/orders/01a09720-9222-79e0-84df-d32e045e090a/cancel {reason}. 3. As ganesh.more (delivery): POST http://127.0.0.1:3005/orders/01a09722-307c-780b-904e-906efd15dc0a/cancel {reason}. 4. As rahul, create draft 01a09726-51a8… (R-0015). dinesh POST :3004/orders/{id}/lines replaces 6 pc with 2 pc; ganesh POST :3005/orders/{id}/submit. 5. GET :3004/orders?limit=200 and :3005/orders?limit=200.
Expected: 403/404. A godown picker or a van driver has no business cancelling, re-lining or submitting a rep's order, and should not browse every order of the tenant. The DOS-073 rule ('a salesperson reaches only its own orders') has no equivalent for these roles.
Actual: Every call returned 200. SO-0889 and SO-0891 are cancelled; order_state_transitions cancel rows carry actor_id 5b6fbe87 (dinesh.patil) and 7b2db500 (ganesh.more); reservations voided; OrderCancelled outbox events; order_cancelled WhatsApp to +919820021437 and SMS to +918655015314 were sent to the shops. The draft was re-lined by the warehouse and submitted by delivery, becoming SO-0893 auto-confirmed under ganesh's actor id. Both lists return 200 rows from every rep (rahul 90, amit 82, others) across 52 shops, with a next page. Cause per the DOS-073 verifier: ORDER_ROLES = STAFF, the matrix entry is ANY_MEMBER, both services mount `orders`, and callerReaches narrows only the salesperson role.
Business impact: Any godown or van login, including a lost driver's phone or a disgruntled helper, can silently cancel every confirmed order in the distributorship, or rewrite and confirm drafts. The shop receives an official 'order cancelled' message, stock is released, and the sale is lost. It is the same class of unauthorised order access as DOS-073 (P0), reachable from two more apps.
Severity: P0
Evidence: QA/evidence/batch1/regression/api-security/b-01-warehouse-list-all-orders.txt; QA/evidence/batch1/regression/api-security/b-02-delivery-list-all-orders.txt; QA/evidence/batch1/regression/api-security/b-03-warehouse-cancel-rahul-order-B.txt; QA/evidence/batch1/regression/api-security/b-04-delivery-cancel-rahul-order-B2.txt; QA/evidence/batch1/regression/api-security/b-07-db-after-warehouse-delivery-cancel.txt; QA/evidence/batch1/regression/api-security/b-08-warehouse-setlines-rahul-draft-E.txt; QA/evidence/batch1/regression/api-security/b-09-delivery-submit-rahul-draft-E.txt; QA/evidence/batch1/regression/api-security/b-10-db-after-warehouse-setlines-delivery-submit.txt; QA/evidence/batch1/regression/api-security/b-11-db-messages-reservations.txt
Suggested fix: A founder/matrix decision is needed. Proposal: remove warehouse and delivery from orders.cancel, orders.setLines and orders.submit (and orders.create unless a van-sale flow needs it) in backend/libs/contracts/src/permissions.ts, or refuse those roles in the order service's reach check, and scope orders.list/get for them to what their work needs (orders on their picklists and trips). Add the cases to describePermissionMatrix and an orders spec, as DOS-073 did for the salesperson.
```

Found by: security regression probe (batch 1), residual of DOS-073 raised by its verifier.

### DOS-116 — A desk credit note for damaged goods puts the pieces back into saleable stock unless each line explicitly says saleable:false
Category: business-logic | Priority: P1 | Role: Manager (the endpoint also serves owner, accountant and delivery) | Platform: Backend API (manager-service :3002, POST /credit-notes); the manager-app UI was not tested

```
User: Manager (the endpoint also serves owner, accountant and delivery)
Platform: Backend API (manager-service :3002, POST /credit-notes); the manager-app UI was not tested
Environment: local dev, merged main after batch 1 lanes, dos_qa
Steps:
  1. Own fixture: SO-0892 (R-0027 Gupta Kirana Stores) waved, picked and packed → INV/9007, 6 pc Balaji Masala Masti Wafers 45 g, lot GK20260721. Godown on_hand for the lot is 13. 2. As vikas.kadam: POST http://127.0.0.1:3002/credit-notes {id, invoiceId: INV/9007, reason: 'return_damaged', autoIssue: true, lines: [{id, invoiceLineId, qtyPcs: 2}]}, with saleable omitted as CreditNoteLineInput allows (default true). 3. Query credit_note_lines and stock_ledger for the note. 4. Control: the same request with saleable:false.
Expected: A note whose reason is return_damaged sends its pieces to the damaged bin, or the server refuses saleable:true with that reason. deliveries.record now does exactly that with 400 return_not_saleable (DOS-058).
Actual: 200, CN/9005 issued with reason return_damaged, but credit_note_lines.saleable = true and stock_ledger shows sale_return_saleable +2 into Godown (kind warehouse); Godown on_hand 13 → 15. Only with an explicit saleable:false (control CN/9006) did the pieces go to the Damaged / expiry bin as sale_return_damaged.
Business impact: Damaged returns booked at the desk become sellable stock and are picked for the next shop. The damaged bin, the brand damage claim and the stock valuation are understated, and a credit note labelled 'damaged' contradicts its own stock movement. It is the same outcome DOS-058 fixed at the doorstep, still reachable from the office.
Severity: P1
Evidence: QA/evidence/batch1/regression/api-security/e-06-warehouse-pack-and-bill-W.txt; QA/evidence/batch1/regression/api-security/e-07-db-invoice-W-and-stock-before-credit-note.txt; QA/evidence/batch1/regression/api-security/e-08-manager-credit-note-return-damaged-default-lines.txt; QA/evidence/batch1/regression/api-security/e-09-db-after-credit-note-default-lines.txt; QA/evidence/batch1/regression/api-security/e-10-manager-credit-note-return-damaged-saleable-false-control.txt; QA/evidence/batch1/regression/api-security/e-11-db-after-credit-note-saleable-false.txt
Suggested fix: In billing.creditNotes.create/issue, derive each line's disposition from the reason (return_damaged → saleable false) or reject saleable:true with return_damaged (400 return_not_saleable, reusing isSaleableReturn). Stop defaulting CreditNoteLineInput.saleable to true for damage reasons. Add a billing spec, and check that the manager and owner credit-note screens send the disposition the user chose.
```

Found by: security regression probe (batch 1), residual of DOS-058 raised by its verifier.

### DOS-117 — Overdue and ageing stop moving on days a shop has no posting: no nightly ageing rebuild is scheduled
Category: bug | Priority: P1 | Role: Owner, Manager, Accountant (and the 09:00 dues reminder) | Platform: Backend (worker + receivables); every client

```
User: Owner (Today "overdue" and "Money owed, by age"); Accountant follow-up list; 09:00 IST dues reminder
Platform: Backend — worker pg-boss schedules, retailer_outstanding_summary, owner_summary
Environment: local dev, dos_qa, merged main after batch 1, 2026-09-13 01:45–01:58 IST
Steps:
  1. QA/evidence/batch1/regression/reconcile/08-followup-worker-schedule.sql: pgboss.schedule has no ageing job and none was ever
     created; the worker's reporting finalize re-runs only yesterday's rollup and retailer behaviour; the receivables rebuildAgeing
     path ("the same code path the nightly worker job runs") is called only by the owner app's Rebuild ageing button.
  2. 08-followup-stale-shops.sql: retailer_outstanding_summary rows with as_of before today, stored overdue vs overdue recomputed
     from invoices − allocations with today's IST date.
  3. 08-followup-ageing-freshness.sql: owner_summary overdue and detail.ageingB* vs the same live recompute.
Expected: at the start of each IST business day every shop's dues row is re-dated (as_of = today), overdue and buckets recomputed, an
          ageing_snapshots row written, and the owner report's overdue equals live.
Actual: at 01:58 on 13 Sep, 120 of 124 pilot-shop rows are as_of 2026-09-12; ageing_snapshots stop at 2026-09-12. Owner overdue
        ₹26,77,818 vs live ₹27,79,739 (Tarsun, −₹1,01,921); Sai ₹21,24,093 vs ₹22,33,678 (−₹1,09,585); Kalyan ₹5,27,168.50 vs
        ₹5,35,277.50 (−₹8,109); 18 shops drifted (Sahyadri Super Bazar stored ₹2,54,538 vs live ₹3,03,000 — INV/0643 fell due 12 Sep).
        Sai's Ayre Road Super Market: stored overdue 0, live ₹4,163, so the 09:00 sweep skips it. Revenue, collections, outstanding and
        90+ unaffected.
Business impact: every morning the owner's and accountant's overdue and ageing understate what is overdue, by more each quiet day; newly
        overdue shops get no dues reminder; the ageing trend has no points after the seed date. DOS-015 was graded P3 on the belief that
        the worker rebuilds ageing on its own — it does not.
Severity: P1
Evidence: QA/evidence/batch1/regression/reconcile/08-owner-report.out, 08-followup-ageing-freshness.out, 08-followup-stale-shops.out,
          08-followup-worker-schedule.out, 07-outstanding.out; SUMMARY.md
Suggested fix: schedule a per-tenant ageing rebuild just after IST midnight (inside the 00:20 finalize, before the owner rollup) using the
          rebuildAgeing path plus writeAgeingSnapshot; on worker start, catch up when the latest ageing_snapshots as_of is older than
          today (pg-boss does not backfill a missed cron slot); a worker spec that after a business-date change with no postings overdue
          equals the live recompute. Revisit DOS-015's severity.
```

Found by: batch 1 business reconciliation (read-only SQL). Note: QA stopped the worker 22:45–00:57 to free memory, so the 13 Sep 00:20
finalize slot was also missed; that is separate from this defect (no ageing job exists at any hour).

### DOS-118 — Phone Short sheet: the 'this batch asks for N pc' refusal line is laid out below the fold, so pressing Short looks like nothing happened
Category: ux | Priority: P3 | Role: Warehouse | Platform: Web, phone 390x844 (warehouse app :5176)

```
User: Warehouse
Platform: Web, phone 390x844 (warehouse app :5176)
Environment: local dev, merged main after batch 1 lanes, dos_qa, 2026-09-13
Steps:
  1. Sign in as dinesh.patil. Open a started wave (PICK-0082) at 390×844.
  2. Press Short on a lot row asking 12 pc (GK20260630).
  3. Key 2, 0 on the pad.
  4. Press Short.
Expected: The reason the save is refused ('This batch asks for 12 pc. Count again…') is visible without scrolling, next to the figure or the Short button. Alternatively Short is visibly disabled with that reason.
Actual: The over-ask line exists in the sheet but is laid out at y=836–880 in an 844-px viewport, below the Short button (y=728–804). Only a sliver of red text shows at the bottom edge; the reason chips are scrolled off the top. Pressing Short does nothing visible: no upload, the sheet stays open. At 1280×800 the same line is fully visible.
Business impact: A picker on the phone, the warehouse's main device, taps Short repeatedly and sees nothing happen. They may think the app has frozen, abandon the line, or re-key blindly. The refusal is correct (DOS-041), but it is not explained where the thumb is.
Severity: P3
Evidence: QA/evidence/batch1/regression/web-warehouse/041-11-short-20-of-12-phone.png; QA/evidence/batch1/regression/web-warehouse/041-12-short-refused-phone.png; QA/evidence/batch1/regression/web-warehouse/041-06-short-20-of-3-desk.png
Suggested fix: In frontend/warehouse-app/app/pick/[id].tsx, render the w5-short-over line above the pad, beside 'Requested N pc'. Alternatively pass disabled + disabledReason to the pad's done button when overAsk. At minimum, scroll the line into view when overAsk turns true.
```

Found by: batch 1 regression web walk (warehouse).

### DOS-119 — A freshly made wave opens as 'Nothing here yet · 0 of 0 picked' with Scan and an enabled 'Take it to packing' for up to a minute before Start appears
Category: ux | Priority: P3 | Role: Warehouse | Platform: Web, desk 1280x800 (the pick sheet waits on a sync pull, so likely every platform; only web was walked)

```
User: Warehouse
Platform: Web, desk 1280x800 (the pick sheet waits on a sync pull, so likely every platform; only web was walked)
Environment: local dev, merged main after batch 1 lanes, dos_qa, 2026-09-13
Steps:
  1. Sign in as dinesh.patil. Pick tab.
  2. Select a confirmed order (SO-0881; also seen with SO-0883) → Make a wave.
  3. Watch the sheet the app navigates to.
Expected: The new sheet shows its lines and 'Start picking' at once, or a 'Getting the sheet…' state with no actions.
Actual: - 1.6 s after the 200 create reply, PICK-0083's screen read 'Picklist / Nothing here yet / 0 of 0 picked'.
- The bottom bar showed Scan and 'Take it to packing', ENABLED (disabled=false).
- 'Start picking' and the 7 lines appeared only 57 s after creation; PICK-0082 took 33 s.
- Cause (verifier residual 1): W4 navigates to /pick/{id} straight after picklists.create without triggering a pull. The sheet's status is unknown (picks locked), but no Start is offered and the not-started bar is not used.
Business impact: Every new wave leaves the picker on an empty sheet for 30–60 s whose primary button invites them to 'Take it to packing'. They may walk to the packing bench with nothing picked, or believe the wave failed and ask the desk to raise another. It costs time on every wave.
Severity: P3
Evidence: QA/evidence/batch1/regression/web-warehouse/042b-01-new-wave-before-pull-desk.png; QA/evidence/batch1/regression/web-warehouse/db-042b-timeline.json; QA/evidence/batch1/regression/web-warehouse/041-02-so0883-sheet-not-started-desk.png; QA/evidence/batch1/regression/web-warehouse/041-03-so0883-sheet-after-pull-desk.png
Suggested fix: In pick/index.tsx onSuccess, call engine.sync('picklist-created') before or while navigating, or seed the local picklists and pick_lines rows from the create reply. In pick/[id].tsx, while liveStatus is undefined, show a waiting line and hide Scan and 'Take it to packing', as already done for the not-started state.
```

Found by: batch 1 regression web walk (warehouse).

### DOS-120 — After 'Start picking' the sheet's status chip keeps saying 'picking' next to 'N of N picked' until the screen is reopened
Category: ux | Priority: P3 | Role: Warehouse | Platform: Web, desk 1280x800

```
User: Warehouse
Platform: Web, desk 1280x800
Environment: local dev, merged main after batch 1 lanes, dos_qa, 2026-09-13
Steps:
  1. As dinesh.patil, make a wave (SO-0881 → PICK-0083) and press 'Start picking' on its sheet.
  2. Stay on that screen while every row gets recorded; here one row by this device and the rest by a second device through the API, so the server closes the wave.
  3. Watch the header after the next pull.
Expected: Once the local picklists row reads 'picked', the chip says 'picked', matching the count and the enabled 'Take it to packing'.
Actual: - Server: PICK-0083 status picked, completed_at 01:21:53.
- For all 13 s sampled after the pull, the screen showed '7 of 7 picked' with 'Take it to packing' enabled and the chip 'picking'.
- The chip read 'picked' only after navigating away and back.
- In pick/[id].tsx, liveStatus = startedHere ?? sheet.status keeps the Start reply's 'picking' for as long as the screen stays mounted. The DOS-040 verifier noted this; it was not logged.
Business impact: This is a smaller instance of the 'three truths on one sheet' problem DOS-042 fixed: the count says done while the badge says still picking. A picker or supervisor glancing at the badge may think lines are still open.
Severity: P3
Evidence: QA/evidence/batch1/regression/web-warehouse/042b-04-after-rejection-13s-desk.png; QA/evidence/batch1/regression/web-warehouse/db-042b-timeline.json; QA/evidence/batch1/regression/web-warehouse/042b-06-after-refresh-desk.png
Suggested fix: Use startedHere only while the local row is still 'open' or undefined. For example, liveStatus = sheet?.status === 'open' || sheet === null ? (startedHere ?? sheet?.status) : sheet.status. Alternatively clear the start mutation's data once the local row moves past 'open'.
```

Found by: batch 1 regression web walk (warehouse).

### DOS-121 — Load-out in the warehouse app always sends countedVanStock [] and has no van-stock count, so after DOS-039 a sheet's van stock can never be moved to the vehicle from the app
Category: missing-feature | Priority: P2 | Role: Warehouse | Platform: Web (warehouse app :5176); the code path is shared by Android and iOS

```
User: Warehouse
Platform: Web (warehouse app :5176); the code path is shared by Android and iOS
Environment: local dev, merged main after batch 1 lanes, dos_qa, 2026-09-13
Steps:
  1. As dinesh.patil, open an approved draft load sheet (374f2089) → count cartons → 'Send the vehicle out' → confirm.
  2. Read the confirm request body.
  3. Look for any van-stock count control on the sheet screen (W7).
Expected: When a sheet carries van stock (lots listed with source 'van' under 'What goes on the vehicle'), the crew counts those lots and the app sends them as countedVanStock. Since DOS-039, that is the only stock load-out moves.
Actual: - The confirm body was {countedPackages:35, countedVanStock:[], challanId, varianceNote}; frontend/warehouse-app/app/load/[id].tsx:81 hard-codes `countedVanStock: []`.
- W7 offers only a carton count pad, on desk and phone and on both tenants' sheets walked.
- dos_qa has 6 trips with van_sales_enabled but no load sheet with non-empty van_stock today. The consequence on a van-stock sheet was therefore NOT executed here, because only one sheet could be confirmed.
Business impact: The consequence below follows from the merged DOS-039 server rule and was not executed on a van-stock sheet. With DOS-039 merged, a van-sales trip loaded through the app would leave the godown with the van-sale stock still booked at the godown and none on the vehicle. Van sales from the vehicle would then be refused or drive balances wrong, while the godown shows goods that physically left.
Severity: P2
Evidence: QA/evidence/batch1/regression/web-warehouse/api-039-confirm-response.json; QA/evidence/batch1/regression/web-warehouse/039-03-count-35.png; QA/evidence/batch1/regression/web-warehouse/039-11-count-24-phone.png; QA/evidence/batch1/regression/web-warehouse/db-039-phone-walk-and-van-stock-usage.txt
Suggested fix: Add a van-stock count step to W7: list the source='van' lots with a count pad each, and send them as countedVanStock. Until that exists, refuse or warn on confirm when the sheet's van_stock is non-empty. Then walk the verifier's positive van-stock case (a sheet with vanStock 12 pc → exactly one transfer_out/transfer_in pair).
```

Found by: batch 1 regression web walk (warehouse).

### DOS-122 — The irreversible load-out confirm dialog puts 'Send the vehicle out' and 'Cancel' on 32-px-high buttons on a phone
Category: ux | Priority: P3 | Role: Warehouse | Platform: Web, phone 390x844

```
User: Warehouse
Platform: Web, phone 390x844
Environment: local dev, merged main after batch 1 lanes, dos_qa, 2026-09-13
Steps:
  1. As a warehouse user at 390×844, open an approved draft load sheet (1720dd92, MH-05-BQ-4471).
  2. Count the cartons → 'Send the vehicle out'.
  3. Measure the dialog's buttons.
Expected: The dialog's buttons are thumb-sized like the rest of the warehouse app (bar buttons are 76 px high): the confirm is a primary button that cannot be missed or mis-tapped.
Actual: The dialog 'Check out MH-05-BQ-4471? … This cannot be undone.' shows 'Cancel' at 84×32 and 'Send the vehicle out' at 185×32, side by side at y=468. The button that opened the dialog was 358×76.
Business impact: At the godown gate, with gloves or a hurried thumb, a 32-px pair of adjacent buttons for a step that cannot be undone is easy to mis-tap in either direction.
Severity: P3
Evidence: QA/evidence/batch1/regression/web-warehouse/039-12-send-dialog-phone-viewport.png; QA/evidence/batch1/regression/web-warehouse/039-11-count-24-phone.png
Suggested fix: Give the @dos/ui web Dialog phone-width button sizing, full-width stacked with the 76 px primary used elsewhere, below 1024 px. Check the native Dialog for the same.
```

Found by: batch 1 regression web walk (warehouse).

### DOS-123 — Retailer bill screen: the proof-of-delivery photo never loads on the web; the POD readUrl is service-relative and resolves against the app's own origin
Category: bug | Priority: P2 | Role: Retailer | Platform: Web (desk 1280x800; the same <Img> is used at phone widths)

```
User: Retailer
Platform: Web (desk 1280x800; the same <Img> is used at phone widths)
Environment: local dev, merged main after batch 1 lanes, dos_qa, 2026-09-13
Steps:
  1. Sign in as ramesh.gupta at http://localhost:5178 and open My bills → INV/0753. Scroll to PROOF OF DELIVERY. 2. The panel reads 'Delivered · 3 Sep, 10:40 am · Signed for by Jayesh Shah', followed by a broken image showing only its alt text 'Photograph taken at your shop'. 3. DOM: img[data-testid=r4-pod-dfab2672…] src='/storage/demo/pod/c68cd7c9…/a924ae38….jpg?expires…&signature…', complete=true, naturalWidth=0. The browser requested http://localhost:5178/storage/demo/pod/… and got 200 text/html (the app's own page). 4. Real photo taken by the delivery app (INV/0830, R-0013): manager GET :3002/delivery/deliveries/3ef9bd1e… returns readUrl '/storage/tenant/01a0947d…/pod/3ef9bd1e…/01a09725….jpg?expires…'. That path on localhost:5178 gives 200 text/html; on 127.0.0.1:3002 it gives 200 image/jpeg, 20,817 bytes. 5. Seed: 825 of the 831 Tarsun pod_evidence photo keys are demo/… keys with no stored object; the service answers 404 JSON even at its own origin.
Expected: The shop sees the photo the driver took. The client absolutises readUrl with absoluteUrl(), as DOS-099 now does for the bill PDF and as the tenant logo already did. Seeded POD keys point at objects that exist.
Actual: Every bill with a POD photo shows a broken image in the retailer web app. For real photos the cause is the relative URL; on the demo data the object is missing as well.
Business impact: A POD photo exists to settle 'I never received it'. When a shopkeeper disputes a delivery, the retailer app shows him a broken image in place of the photo taken at his counter, so the distributor's proof never reaches the customer and every dispute becomes a phone call. It is the same class as DOS-099; the DOS-057+099 implementer listed it as an adjacent defect, but it had no finding id.
Severity: P2
Evidence: QA/evidence/batch1/regression/web-retailer/new-01-bill-pod-photo-broken-desk.png; QA/evidence/batch1/regression/web-retailer/net-099-01-open-print-desk.json; QA/evidence/batch1/regression/web-retailer/api-new-01-pod-photo-origins.txt; QA/evidence/batch1/regression/web-retailer/api-new-01-pod-readurl-real-key.txt; QA/evidence/batch1/regression/web-retailer/db-new-01-pod-evidence.txt
Suggested fix: In frontend/retailer-app/app/bills/[id].tsx, pass absoluteUrl(proof.readUrl) to <Img>. Extend frontend/libs/ui/src/document-urls.test.ts to cover Img sources built from readUrl, and grep the other six apps for raw readUrl images. For the demo data, store placeholder JPEGs under the demo/pod keys or null those keys, so the screen shows 'no photo' rather than a broken image.
```

Found by: batch 1 regression web walk (retailer).

### DOS-124 — Money due → 'Pay this bill' → 'Start the payment' forgets the bill: the Pay screen opens with nothing ticked and the whole ₹35,843 prefilled
Category: ux | Priority: P2 | Role: Retailer | Platform: Web desk 1280x800 (same routing code at every width)

```
User: Retailer
Platform: Web desk 1280x800 (same routing code at every width)
Environment: local dev, merged main after batch 1 lanes, dos_qa, 2026-09-13
Steps:
  1. Sign in as ramesh.gupta and open Money due. On INV/0433 (₹4,561.00 left of ₹10,119.00), tap 'Pay this bill'. 2. The 'SCAN TO PAY' sheet shows ₹4,561.00 and upi://pay?…am=4561.00&tr=INV-0433&cu=INR. 3. Tap 'Start the payment' in the sheet. 4. /pay opens with the amount field at 35843.00, all six bills unticked, and a bottom bar reading 'How much are you paying ₹35,843.00'. 5. Code: dues.tsx r3-qr-pay and bills/[id].tsx r4-pay both call router.push('/pay') with no bill id, and pay.tsx reads no route params.
Expected: The Pay screen opens with INV/0433 ticked and ₹4,561.00, so Start the payment asks for that bill only.
Actual: Nothing is ticked and the full dues are prefilled. Tapping Start the payment here mints an intent for ₹35,843 across 6 bills (as PAY-5c0672c7d3e5 did).
Business impact: A shopkeeper who chose to pay one bill is one tap away from being asked for everything he owes. He either gives up, or pays an amount he did not mean to, and the office allocates it oldest-first rather than to the bill he picked. The amount is visible before the tap, so a careful user can re-tick the bill; that is the workaround.
Severity: P2
Evidence: QA/evidence/batch1/regression/web-retailer/094-07-pay-this-bill-sheet-desk.png; QA/evidence/batch1/regression/web-retailer/094-08-pay-this-bill-lands-desk.png
Suggested fix: Push /pay?bill=<id> from dues.tsx (r3-qr-pay) and bills/[id].tsx (r4-pay), and have pay.tsx preselect that bill with its open amount. Consider having the sheet mint the PAY intent itself, so the shop is not given two different references (INV-0433 in the sheet, PAY-… on the Pay screen) for the same payment.
```

Found by: batch 1 regression web walk (retailer).

### DOS-125 — Web pay screens give a shop nothing to scan or tap: no QR image, a raw upi:// string clipped on a phone, and 'Open a UPI app' does nothing visible
Category: missing-feature | Priority: P2 | Role: Retailer | Platform: Web desk 1280x800 and web phone 390x844

```
User: Retailer
Platform: Web desk 1280x800 and web phone 390x844
Environment: local dev, merged main after batch 1 lanes, dos_qa, 2026-09-13
Steps:
  1. Desk: Money due → Pay this bill (INV/0433). The sheet is titled 'SCAN TO PAY' and says 'Scan this in any UPI app', but shows only ₹4,561.00 and the text upi://pay?pa=tarsun%40okhdfcbank…; there is no QR image. 2. Pay everything → Start the payment. The intent panel shows the same raw string as text and no QR. 3. Tap 'Open a UPI app'. No tab opens: the page sends a navigation to upi://pay?…, which a desktop browser cannot handle, and shows no message (links.web always reports success, so the r5-no-upi-app hint never shows on web). 4. Phone 390×844: the raw string does not break inside, so its middle (…&am=35843.00&tr=PAY-…) is clipped at the right edge.
Expected: A scannable QR of the intent, so a shop on a counter PC can pay from its phone. A copyable string that wraps. On web, a line telling the shop to scan the QR or pay the VPA when the UPI hand-off cannot be confirmed.
Actual: There is no QR anywhere on web. The only scannable thing on a 'Scan to pay' sheet is plain text, tapping Open a UPI app gives no feedback, and on a phone the string cannot even be read.
Business impact: A shopkeeper using the web app cannot pay the distributor online from these screens, so collection falls back to cash or cheque at the next delivery and money comes in later. DOS-094's suggested fix and the cross-role friction list (QA/findings/08, Retailer) both name this, but it has no finding id, and the DOS-094 implementer left it out of scope.
Severity: P2
Evidence: QA/evidence/batch1/regression/web-retailer/094-07-pay-this-bill-sheet-desk.png; QA/evidence/batch1/regression/web-retailer/094-03-intent-all-desk.png; QA/evidence/batch1/regression/web-retailer/094-04-open-upi-web-desk.png; QA/evidence/batch1/regression/web-retailer/094-11-intent-all-phone.png
Suggested fix: Add a dependency-free QR component to @dos/ui that renders the intent string as SVG, and use it in r3-qr-sheet and r5-intent (web at least). Let the raw string break anywhere and add a Copy button. On web, show a static hint under Open a UPI app ('On a computer, scan the QR with your phone's UPI app, or pay <vpa> and quote the reference').
```

Found by: batch 1 regression web walk (retailer).

