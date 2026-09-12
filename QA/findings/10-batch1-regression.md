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

### DOS-126 — Approving a rate request on Approvals confirms the order at the old rate, not the approved one
Category: business-logic | Priority: P1 | Role: Owner (shop and rep affected) | Platform: Web (owner app :5173, sales app :5175) + Backend (orders.approvals.decide)

```
User: Owner (shop and rep affected)
Platform: Web (owner app :5173, sales app :5175) + Backend (orders.approvals.decide)
Environment: local dev, merged main after batch 1 lanes, dos_qa, 2026-09-13
Steps:
  1. rahul.deshmukh, sales web: Mahalaxmi General Stores → Take order → Campa Cola 2 L 1 cs (rate now ₹51.17) → Ask a rate ₹45.54 ('Over your limit — the office decides') → Place order → SO-0897 submitted with gates credit_limit and bargain. 2. sunil.tarsun, owner Approvals → SO-0897 Bargain → note → Approve (POST /approvals/01a09748-eb36-726f-80cd-50cd5ac54ff3/decide 200) → bargain_requests 01a09748-91be-702d-98df-44f7e0ed5309 approved, approved_rate_paise 4554. 3. Approve SO-0897 Over credit limit (the last gate) → order confirmed 01:59:53, 5 reservations / 24 pc. 4. SQL on sales_order_lines; Rahul opens SO-0897 in the sales app.
Expected: When the bargain gate is approved, the order line is re-priced at the approved ₹45.54/pc (24 pc = ₹1,092.96 before GST) before the order is confirmed and stock reserved, or the confirm waits until it is.
Actual: sales_order_lines: list_rate_paise 5117, rate_paise 5117, line_total_paise 137545, applied_rules []. sales_orders subtotal 122808, total 137500 (₹1,375.00). The rep's detail shows 'Campa Cola 2 L · 1 cs · ₹51.17/pc' directly under 'Rate change · Decided 13 Sep, 1:59 am · Approved'. No re-price happened between the decision and the confirm. The bill was not generated in this walk; per the DOS-005 implementer note, invoices copy the order line rate (not verified here).
Business impact: The owner says yes to ₹45.54, the rep tells the shopkeeper it is approved, and the shop is charged ₹51.17: ₹135 over on one case, 11% on the line. Every rate request approved on a held order is silently lost and turns into a dispute at delivery or collection.
Severity: P1
Evidence: QA/evidence/batch1/regression/web-sales-owner/DOS-020-db-SO-0897-after-last-approval.txt; QA/evidence/batch1/regression/web-sales-owner/DOS-020-40-rep-sees-SO-0897-desk.png; QA/evidence/batch1/regression/web-sales-owner/DOS-020-33-panel-after-last-approval-desk.png; QA/evidence/batch1/regression/web-sales-owner/DOS-020-approve-bargain-SO-0897-network.json
Suggested fix: In the approval decide path, when a bargain_request gate is approved, re-price the order's lines through priceOrder() with the approved bargain (the device's bargain step) in the same transaction, before confirmInTx reserves stock. Add a spec asserting rate_paise = approved_rate_paise and applied_rules carries the bargain after the last approval. The implementer already flagged this as a candidate in the DOS-005 follow-ups.
```

Regression status: **PRE-EXISTING — not caused by batch 1** (executed probe, 2026-09-13). One identical characterisation spec run at c5c6e03 and at merged main 7f2e198 on throwaway template copies: every path where the rate request is approved after the order was drafted confirms the line at the list rate on BOTH commits (Approvals bargain-then-credit, credit-then-bargain, Rate requests approve then gates, bargain as the only gate: 5117 / 137545 / no bargain rule; correct is 4554 / 122412 / bargain rule). Controls: approved before the order is created → 4554 (both); approved after create, before submit → 5117 (both). Batch 1's only effects: DOS-005 (40fc300) now marks the request `approved 4554` beside the 5117 line (before, it stayed `requested`), which made the defect visible; DOS-020 (32315dc) closed the manager's direct-confirm path (409 instead of confirming at 5117).
Root cause at HEAD: lines are priced only while the order is a draft (`orders.service.ts` writeLines :597-599; the approved bargain is looked up in `quote.service.ts:286-312` and matched by variant in `schemes.ts:304`); nothing re-prices at submit, `approvals.decide`, `bargains.decideInTx` or `confirmInTx` (:337-391), which reserves the stored draft-time lines. Billing copies the order line rate (read, not run), so the bill carries the old rate too.
Smallest fix (for the approval gate, not implemented): re-price the stored lines inside `confirmInTx` after the pending-approval check and before reserving, through `priceOrderLines` → `priceOrder()`, updating lines in place and the order totals in the same transaction; quote on the caller's `tx` (the current `QuoteService.quote()` opens its own transaction and cannot see a bargain approved by the same decision); price on the draft's pricing date so only the approved bargain changes; leave price-locked lines alone; specs for the four paths plus the after-create control.
Evidence: QA/evidence/batch1/regression/bargain-rate-probe/ (trace.md, before.spec.ts, before.out — 6 failed/2 passed, after.spec.ts, after.out — 5 failed/3 passed).

Found by: batch 1 regression web walk (sales + owner).

### DOS-127 — A shop's own cancellation leaves the order's approvals pending, and the owner can neither approve nor reject them
Category: bug | Priority: P2 | Role: Owner (shop cancels) | Platform: Backend (orders.cancel under the retailer role, retailer-service :3006) + Web owner app :5173

```
User: Owner (shop cancels)
Platform: Backend (orders.cancel under the retailer role, retailer-service :3006) + Web owner app :5173
Environment: local dev, merged main after batch 1 lanes, dos_qa, 2026-09-13
Steps:
  1. fatima.shaikh (retailer, tenant tarsun) via retailer-service: POST /orders draft for R-0010 Balaji Wholesale Stores (24 pc Campa Cola 750 ml); POST /pricing/bargains asked 2014 against list 2263 with orderId; POST /orders/{id}/submit → SO-0898 (01a09754-da7f-73b5-84b2-2539fdc5d8b7) submitted with approval 01a09754-db92-712c-8693-b77fc5f360ad (bargain / bargain_request) pending. 2. POST /orders/{id}/cancel → 200, state cancelled. 3. SQL on approvals and bargain_requests. 4. Owner GET :3001/approvals?status=pending, then owner Approvals screen. 5. Owner POST /approvals/01a09754-db92…/decide approve, then reject. Control: salesperson rahul.deshmukh cancels his own held SO-0895 → its credit_limit approval turns 'expired' in the same second.
Expected: A shop's cancel expires the order's pending approvals, exactly as the rep's cancel does, and they leave the owner's queue.
Actual: After the shop's cancel the approval stays 'pending' and the bargain stays 'requested'. The owner's API queue still lists it, and the Approvals screen shows an SO-0898 row. Approve → 409 'order: cannot apply "confirm" in state "cancelled"'. Reject → 409 'order: cannot apply "cancel" in state "cancelled"'. Both leave it pending, so it can never be cleared. SO-0886 and SO-0887 (cancelled by ramesh.gupta on 12 Sep) are in the same state and sit under owner Today 'Needs you' as 'Waiting for owner'. pg_policies: approvals_read is USING actor_role <> 'retailer', so cancelInTx's UPDATE approvals SET status='expired' WHERE order_id=… AND status='pending' matches no row when the actor is the shop.
Business impact: The owner's first screen and Approvals queue fill with requests nobody can decide, one more for every held order a shop cancels. Real requests get buried and the pending-approvals count is inflated.
Severity: P2
Evidence: QA/evidence/batch1/regression/web-sales-owner/NEW-retailer-cancel-leaves-approval-pending.txt; QA/evidence/batch1/regression/web-sales-owner/NEW-01-owner-approvals-stale-SO-0898-desk.png; QA/evidence/batch1/regression/web-sales-owner/DOS-005-30-owner-today-after-decisions-desk.png
Suggested fix: Run the approval-expiry statement in cancelInTx under a context that can see the rows: a SECURITY DEFINER function, or withSystem for that one statement, or a retailer SELECT policy limited to its own orders. Make decide on a gate whose order is already cancelled or closed mark the gate expired instead of answering 409. Repair the existing stale rows (SO-0886, SO-0887, SO-0898). Add a rls.test/spec case for a retailer cancel of a held order.
```

Found by: batch 1 regression web walk (sales + owner).

### DOS-128 — Sales web app at phone width: catalog rows clip the item name to 4–5 letters
Category: ux | Priority: P2 | Role: Sales Rep | Platform: Web (sales app :5175) at 390×844

```
User: Sales Rep
Platform: Web (sales app :5175) at 390×844
Environment: local dev, merged main after batch 1 lanes, dos_qa, 2026-09-13
Steps:
  1. rahul.deshmukh at 390×844 → Beat → Laxmi Narayan Stores → Take order. 2. Scroll to 'Add items'. 3. Measure the first six rows (DOM bounding boxes).
Expected: The item name is readable (up to 2 lines) and 'brand · N pc case' is visible, as at 1280 px.
Actual: Name column 32–56 px wide and clipped: 'Camp / Col…' with the pack line 'Cam…' / 'Camp…'. In the 356 px row the stock chip ('18 cs available') takes 142–166 px and 'Add a case' 115 px. At 1280 px the same column is 750–774 px and not clipped.
Business impact: On a phone browser the rep cannot tell Campa Cola 1 L from 2 L or 200 ml before tapping 'Add a case': the same blind-add risk DOS-077 removed on Android. Whether this predates the DOS-077 change could not be established, because Phase 1 phone evidence captured only the top of the screen.
Severity: P2
Evidence: QA/evidence/batch1/regression/web-sales-owner/DOS-077-05-catalog-rows-phone-viewport.png; QA/evidence/batch1/regression/web-sales-owner/DOS-077-04-search-row-phone-viewport.png; QA/evidence/batch1/regression/web-sales-owner/DOS-077-row-measurements.json
Suggested fix: Below the desk breakpoint, move the availability onto the meta line ('Campa · 24 pc case · 18 cs') or let the trailing chip and button wrap under the name. Give the name column a minimum width. Add a 390 px layout check for frontend/sales-app/app/orders/new.tsx catalog rows.
```

Regression status: NOT caused by batch 1 — the DOS-077 commit (f2a36ae) changed only the native Button width (fullWidth={false}); the web markup of the row is unchanged, so this web phone-width clipping predates the batch. Not re-executed on the pre-fix build.

Found by: batch 1 regression web walk (sales + owner).

### DOS-129 — Order footer counts cases with the first line's case size
Category: ux | Priority: P3 | Role: Sales Rep | Platform: Web (sales app :5175), desk and phone

```
User: Sales Rep
Platform: Web (sales app :5175), desk and phone
Environment: local dev, merged main after batch 1 lanes, dos_qa, 2026-09-13
Steps:
  1. rahul.deshmukh → Shree Ganesh Kirana → Take order. 2. Add Campa Cola 750 ml 2 cs (24 pc case) and Too Yumm Karare 60 g 1 cs (48 pc case). 3. Read the footer.
Expected: 'Items 2 · 3 cs' (or the piece total when case sizes differ).
Actual: 'Items 2 · 4 cs': 96 pc divided by the first line's 24. An order of 21 lines of one case each with mixed case sizes read 'Items 21 · 45 cs + 3 pcs'. Code: new.tsx:266 formatQty(pieces(totalPcs), caseSizeOf(draft.lines, byVariant)); caseSizeOf returns lines[0]'s case size (new.tsx:519–523).
Business impact: The rep reads a wrong case count back to the shopkeeper just before placing: a small error, but on the number people check.
Severity: P3
Evidence: QA/evidence/batch1/regression/web-sales-owner/DOS-076-01-basket-b-desk.png; QA/evidence/batch1/regression/web-sales-owner/DOS-076-01-basket-b-desk.txt; QA/evidence/batch1/regression/web-sales-owner/DOS-075-03-oil-20cs-desk.txt
Suggested fix: Sum whole cases per line with each line's own case size (and the leftover pieces per line), or show only pieces when the lines' case sizes differ.
```

Found by: batch 1 regression web walk (sales + owner).

### DOS-130 — Owner order panel 'Stock held' shows the number of reservation rows, not the pieces held
Category: ux | Priority: P3 | Role: Owner | Platform: Web (owner app :5173)

```
User: Owner
Platform: Web (owner app :5173)
Environment: local dev, merged main after batch 1 lanes, dos_qa, 2026-09-13
Steps:
  1. Owner Orders → SO-0897 after it was confirmed (1 cs Campa Cola 2 L = 24 pc). 2. Read 'Stock held'.
Expected: '24 pc' (1 cs) held for the order.
Actual: 'Stock held 5': the five reservation rows (lots) that together hold 24 pc. owner-app/app/orders/index.tsx:322 renders String(reservations.data?.items.length ?? 0).
Business impact: The owner reads 5 as a quantity when checking what a confirmed order has taken from stock.
Severity: P3
Evidence: QA/evidence/batch1/regression/web-sales-owner/DOS-020-33-panel-after-last-approval-desk.png; QA/evidence/batch1/regression/web-sales-owner/DOS-020-db-SO-0897-after-last-approval.txt
Suggested fix: Show the summed reservation qty formatted with the line case size (e.g. '1 cs · 24 pc'), or label the count as lots.
```

Found by: batch 1 regression web walk (sales + owner).

### DOS-131 — No screen in any app can create a delivery trip or add a stop, so a newly packed order can never reach a delivery crew
Category: missing-feature | Priority: P0 | Role: Manager (also Owner, Warehouse) | Platform: Web (manager :5274, owner :5173, warehouse :5176, delivery :5177); same code on Android/iOS

```
User: Manager (also Owner, Warehouse)
Platform: Web (manager :5274, owner :5173, warehouse :5176, delivery :5177); same code on Android/iOS
Environment: local dev, merged main + DOS-029 manager build (:5274), dos_qa, 2026-09-13
Steps:
  1. Pack SO-0903..SO-0906 on 13 Sep (INV/9010-9013). 2. As vikas.kadam open Fulfilment -> Waves / Pick & pack / Load-out: the only controls are approve or cancel a sheet and the e-way bill. 3. As sunil.tarsun open Orders -> Trips: a register and settlement preview only. 4. As dinesh.patil open Load -> Trips: existing TRIP-ACTIVE/TRIP-NEXT with Start loading / Send it off only (the screen's own header says it may not create the round). 5. Search frontend/*/app and src for delivery.trips.create or a stop-add call: none. 6. Backend: trips/trip_stops are written only by trips.service create/addStop (HTTP) and van sales; no worker job creates trips.
Expected: The manager, or the godown, plans today's round (docs/23 section 2.1 M7 lists delivery.trips.create; W10 is 'Trips: create, start loading'): date, vehicle, driver, float, and stops chosen from packed bills; and can add a late bill to a planned trip.
Actual: No UI path exists. The regression chain could continue only by calling POST :3002/delivery/trips as the manager (200, TRIP-0001).
Business impact: From go-live the distributor cannot send any new order out for delivery through the product: each morning's packed bills need a developer's API call to become a round, and a late bill cannot be added to a planned round. Seeded TRIP-ACTIVE/TRIP-NEXT hid this in Phase 1.
Severity: P0
Evidence: QA/evidence/batch1/regression/web-chain/c34-manager-fulfilment-desk.png; QA/evidence/batch1/regression/web-chain/c35-manager-load-out-desk.png; QA/evidence/batch1/regression/web-chain/c36-warehouse-trips-before-loading-desk.png; QA/evidence/batch1/regression/web-chain/api-12-manager-create-trip-response.json; QA/evidence/batch1/regression/web-chain/db-07-TRIP-0001-after-create.txt
Suggested fix: Add 'Plan a trip' to the manager Load-out (and owner Trips) screen: date, vehicle, driver/helper, opening float, and stops picked from packed bills not yet on a trip (grouped by beat, reorderable), calling delivery.trips.create. Add 'Add a bill to this trip' calling the stop-add procedure. Have W7/W10 pass tripId so sheet and trip are linked.
```

Regression status: **PRE-EXISTING — never built** (git log over all branches finds no frontend call to delivery.trips.create / stops.add at any commit; the API and matrix have allowed it since before batch 1). Batch 1 only exposed it: DOS-039 let a chain push new orders past load-out for the first time, and the seed's TRIP-ACTIVE/TRIP-NEXT had hidden it. docs/23 lists it (M7 Load-out, W10 Trips: create), and the warehouse W10 screen's header says the godown "may NOT create the round" — which contradicts the founder's 2026-09-12 answer (Q2: warehouse keeps create trip, add stops). New scope; a go-live blocker. Evidence: QA/evidence/batch1/regression/part-b-regression-status.md §1.

Found by: batch 1 regression part B (cross-role chain).

### DOS-132 — Day-end offers cash still out with a delivery crew, and trip receipts of settled trips, for banking; the deposit credits CASH_VAN for them
Category: business-logic | Priority: P1 | Role: Manager, Accountant | Platform: Web (desk 1280x800 and phone 390x844), manager build :5274; server posting applies to all clients

```
User: Manager, Accountant
Platform: Web (desk 1280x800 and phone 390x844), manager build :5274; server posting applies to all clients
Environment: local dev, merged main + DOS-029 manager build (:5274), dos_qa, 2026-09-13
Steps:
  1. Sign in as vikas.kadam (also meena.joshi) → Money → Day-end.
  2. The register 'Cash and cheques in hand' lists:
     - RCPT-0698, Vaibhav Kirana Mart, ₹7,856, 12 Sep;
     - RCPT-0701, Anand Bhavan Provision, ₹2,843, 13 Sep;
     - RCPT-VAN-0001..0004 (₹12,569 / ₹3,848 / ₹61,109 / ₹75,010);
     - RCPT-0655 and RCPT-0644.
     The Trips coming back tile reads 0: 'No trip is waiting to be settled'.
  3. SQL: RCPT-0698 and RCPT-0701 have trip TRIP-ACTIVE (trips.state = active, not settled). RCPT-VAN-* belong to TRIP-20260615-1 (settled); RCPT-0655 and RCPT-0644 belong to settled trips.
  4. Tick RCPT-0701: the bottom bar shows '1 receipts · ₹2,843.00 · Bank this batch', enabled. It was not pressed.
  5. SQL: the CASH_VAN ledger holds only 6 receipt debits (RCPT-VAN-0001..0004, RCPT-0698, RCPT-0701) = ₹1,63,235.00, with no settlement credits. RCPT-0655's receipt entry posted Dr CASH ₹4,323, not CASH_VAN.
  6. Code: receivables.service.ts depositReceipts builds the credit side from receiptAccountCode(mode, tripId), which returns 'CASH_VAN' for any cash receipt with a trip_id. delivery/settlement.service.ts:236 credits CASH_VAN at settlement.
Expected: Day-end lists only money the desk holds: office cash and cheques, plus trip cash only after its trip is settled. A deposit of trip cash that settlement already handed over credits CASH, and nothing is credited out of CASH_VAN twice.
Actual: Cash still in the van (TRIP-ACTIVE) is offered for banking next to office cash, at desk and phone, to both the manager and the accountant. Its amounts are counted in 'Cash to bank' (₹40,98,730.52 at the time).

From the code (not executed; banking trip receipts was deliberately not done):
- Banking RCPT-0655 or RCPT-0644 would credit CASH_VAN for money posted to CASH, taking CASH_VAN negative and leaving CASH overstated.
- Banking RCPT-0698 or RCPT-0701 now, then settling TRIP-ACTIVE, would credit CASH_VAN twice.
Business impact: The desk can mark cash as banked while the delivery man still carries it. The bank slip total then disagrees with the physical cash, the van-cash control account goes wrong, and the day-end cash-to-bank figure includes money the office does not have.
Severity: P1
Evidence: QA/evidence/batch1/regression/web-manager/034-30-trip-cash-RCPT-0701-tickable-desk.png; QA/evidence/batch1/regression/web-manager/034-31-trip-cash-listed-phone-viewport.png; QA/evidence/batch1/regression/web-manager/034-32-trip-cash-listed-accountant-desk.png; QA/evidence/batch1/regression/web-manager/034-01-manager-day-end-desk.png; QA/evidence/batch1/regression/web-manager/db-034-trip-cash-on-day-end.txt; QA/evidence/batch1/regression/web-manager/db-034-cash-van-ledger.txt; QA/evidence/batch1/regression/web-manager/code-034-receipt-account-code.txt
Suggested fix: Exclude receipts whose trip is not settled from the Day-end register and from receipts.deposit (server refusal). Post a deposit's credit from the account the cash sits in now: CASH once settlement has handed it over, never CASH_VAN after settlement. Make trips.settle move CASH_VAN→CASH exactly once per receipt. Add a DB guarantee test that banking plus settling a trip never takes CASH_VAN below zero. This is the van-cash follow-up the DOS-034 implementer asked to be filed.
```

Regression status: **CONSEQUENCE of DOS-034 (c0889f7); root cause pre-existing.** Trip cash was already listed and bankable at c5c6e03 (Day-end register, owner Bank it; deposit credits CASH_VAN); DOS-034 put Bank this batch and Bank it in easy reach. DOS-034's approved text named only UPI and bank-transfer rows, so its three failed checks PASS within DOS-034's scope and this is the companion finding. **QA process miss:** the DOS-034 plan and its verifier both said the van-cash finding must be filed at the same gate as DOS-034; it was not filed until this regression. Stopgap until approved: hide or refuse receipts with a tripId on Day-end and Bank it until settlement hands the cash over. Evidence: part-b-regression-status.md §3.

Found by: batch 1 regression part B (manager desk walk).

### DOS-133 — Warehouse Load screen offers 50 arbitrary old packs as 'Packed orders'; today's packed orders never appear, so no load sheet can be built for them
Category: bug | Priority: P1 | Role: Warehouse | Platform: Web (warehouse :5176); code shared by Android/iOS

```
User: Warehouse
Platform: Web (warehouse :5176); code shared by Android/iOS
Environment: local dev, merged main + DOS-029 manager build (:5274), dos_qa, 2026-09-13
Steps:
  1. Pack SO-0903, SO-0904, SO-0905 and SO-0906 (13 Sep 03:12-03:27). 2. As dinesh.patil open Load (W7) and choose vehicle MH-05-EF-9012. 3. Read the 'Packed orders' panel. 4. GET :3004/warehouse/packs?limit=50 (the screen's call in app/load/index.tsx: packs.list({ limit: 50 }), no filter).
Expected: Orders packed and not yet on a sheet, newest first (today's four), with paging or a date filter.
Actual: The panel lists 50 long-dispatched packs (SO-0798 4 Sep, SO-0311 16 Jul, SO-0070 22 Jun...) and none of today's. The API returns id-ordered rows with a nextCursor, and the screen never pages. The sheet had to be created with POST :3004/warehouse/load-sheets using the screen's own body.
Business impact: The godown cannot build today's load sheet, so nothing packed today can be checked out from the app, and old delivered orders are offered for loading instead. Same ordering class as DOS-023/DOS-025, which were fixed for picklists and sheets only.
Severity: P1
Evidence: QA/evidence/batch1/regression/web-chain/c38-warehouse-load-build-before-desk.png; QA/evidence/batch1/regression/web-chain/c38b-warehouse-load-packed-panel-desk.png; QA/evidence/batch1/regression/web-chain/api-14-warehouse-packs-list-limit50.json; QA/evidence/batch1/regression/web-chain/api-15-warehouse-create-load-sheet-response.json
Suggested fix: Serve W7 from a server-side filter 'packed, not on a live sheet, not dispatched', ordered by packed_at desc, paged, with the pack date shown; exclude dispatched and delivered orders.
```

Regression status: **PRE-EXISTING** — W7 `packs.list({ limit: 50 })` with no filter, server orders by `desc(id)`; seeded packs carry hash ids that sort above every live uuidv7 id; nothing in batch 1 touched W7, packs.list or the seed ids. New scope (same ordering class as DOS-023/025, other screens). Evidence: part-b-regression-status.md §2.

Found by: batch 1 regression part B (cross-role chain).

### DOS-134 — Manager Pick & pack cannot record a part-case pick row after DOS-041: whole cases only, so 6 pc or 18 pc can be saved only as 0 or refused
Category: bug | Priority: P2 | Role: Manager | Platform: Web (desk 1280x800 and phone 390x844), manager build :5274

```
User: Manager
Platform: Web (desk 1280x800 and phone 390x844), manager build :5274
Environment: local dev, merged main + DOS-029 manager build (:5274), dos_qa, 2026-09-13
Steps:
  1. PICK-0084 (SO-0899, Campa Cola 2 L, case 24). FEFO split the order into rows: RCP20260710 asks 6, RCP20260724 asks 18.
  2. Fulfilment → Pick & pack → PICK-0084. Each row's stepper reads '− 0 cs + Not ordered'. Its only controls are 'One case less' and 'One case more'; there is no pieces field (0 inputs).
  3. 'One case more' on the 6-pc row → '1 cs = 24 pc' → Record pick → 400 'batch RCP20260710 on PICK-0084 asks for 6 pcs; 24 were picked'.
  4. At phone width the same on the 18-pc row → 400 '…RCP20260724 … asks for 18 pcs; 24 were picked'.
  5. The exact 6 and 18 had to be sent through the warehouse API as dinesh.patil (200, same row ids).
Expected: The desk can enter the pieces actually picked on each row, up to that row's ask (6, 18), as the warehouse app's Short keypad and the credit-note sheet allow.
Actual: Only 0 or multiples of the case size can be entered, and DOS-041's per-row rule refuses anything above the ask. Any row that is not a whole case can no longer be recorded from the manager app. Before DOS-041 the screen inserted split rows; that path is now closed. The stepper also carries order-entry copy ('Not ordered').
Business impact: FEFO routinely splits a case across batches. When the picker's phone is unavailable, the manager cannot finish the pick from the desk, and the order waits.
Severity: P2
Evidence: QA/evidence/batch1/regression/web-manager/041-01-M20-row6-stepped-one-case-desk.png; QA/evidence/batch1/regression/web-manager/041-02-M20-over-ask-400-refusal-desk.png; QA/evidence/batch1/regression/web-manager/041-10-M20-row18-stepped-phone-viewport.png; QA/evidence/batch1/regression/web-manager/041-11-M20-over-ask-400-refusal-phone-viewport.png; QA/evidence/batch1/regression/web-manager/db-041-PICK-0084-after-over-ask.txt; QA/evidence/batch1/regression/web-manager/api-041-dinesh-exact-picks-PICK-0084.txt
Suggested fix: Give the M20 QtyStepper a pieces entry (onOpenPieces / parsePieces, as the credit-note sheet does), capped at the row's requested_qty_pcs, with a helper 'asks for N pc'. Drop the 'Not ordered' label on this screen. This is the residual the DOS-041 implementer and verifier asked to be logged.
```

Regression status: **CONSEQUENCE of DOS-041 (475092f), accepted in its plan.** M20 was already whole-cases-only at c5c6e03; the lost path was an incorrect workaround (a whole case booked onto a 6-pc row, which then broke pack with 'insufficient stock' — the DOS-041 defect). New scope: loose-piece entry on M20. Evidence: part-b-regression-status.md §6.

Found by: batch 1 regression part B (manager desk walk).

### DOS-135 — Documents panel drops a refusal that arrives while another write on the same panel is still in flight (DOS-029 residual)
Category: bug | Priority: P2 | Role: Manager | Platform: Web (desk 1280x800 and phone 390x844), manager build :5274

```
User: Manager
Platform: Web (desk 1280x800 and phone 390x844), manager build :5274
Environment: local dev, merged main + DOS-029 manager build (:5274), dos_qa, 2026-09-13
Steps:
  1. Inbound → Documents → ALA/26-27/00491 (document 2254e884, review lock held by Sunil Tarsun until 2026-10-12).
  2. Control: press Start reviewing. You get 409, and 'Sunil Tarsun is reviewing this document (until …)' shows above the button.
  3. Close and reopen the panel. Press 'Match the items again'; the POST /docint/extractions/32b0dd16…/rematch was held for 8 s with page.route to simulate a slow network.
  4. While it is pending, press Start reviewing. The same 409 comes back in 79 ms.
  5. Watch docint-panel-refusal at +1.5 s, after rematch returns 200, and 6.5 s later.
Expected: The 409 sentence appears where Start reviewing was pressed, at the latest once the other write settles.
Actual: The refusal line never renders (count 0 at every check, desk and phone). The button just stops spinning, which is the same silence DOS-029 removed elsewhere.
Business impact: On a slow connection a manager who presses two things on a document sees one of them fail with no reason. They may think the review started and wait, or retry blindly.
Severity: P2
Evidence: QA/evidence/batch1/regression/web-manager/029e-01-control-start-review-409-desk-viewport.png; QA/evidence/batch1/regression/web-manager/029e-02-refusal-while-rematch-pending-desk-viewport.png; QA/evidence/batch1/regression/web-manager/029e-03-after-rematch-settled-desk-viewport.png; QA/evidence/batch1/regression/web-manager/029e-01-control-start-review-409-phone-viewport.png; QA/evidence/batch1/regression/web-manager/029e-02-refusal-while-rematch-pending-phone-viewport.png; QA/evidence/batch1/regression/web-manager/029e-03-after-rematch-settled-phone-viewport.png
Suggested fix: In frontend/libs/api-client/src/react/index.tsx nextRefusal, do not mark an error as seen-without-shown while a sibling write is pending. Either show it at once or show it when the sibling settles. Add refusal.test.ts cases for frames [pending,pending] → [error A,pending] → [error A,success], expecting A to be shown.
```

Regression status: **defect inside DOS-029's own new code** (d600ab8, `nextRefusal` in frontend/libs/api-client/src/react/index.tsx:476-497; no test covers [error A, pending] → [error A, success]). Not a regression of main (that refusal was silent before DOS-029). Inside DOS-029's approved scope: repaired on the DOS-029 branch before merging (2026-09-13). Evidence: part-b-regression-status.md §8.

Found by: batch 1 regression part B (manager desk walk).

### DOS-136 — After a lost reply, pressing Bank it again says 'idempotencyKey was already used with a different request' and the receipt still reads Collected although it was banked
Category: bug | Priority: P2 | Role: Accountant, Manager | Platform: Web desk 1280x800, manager build :5274

```
User: Accountant, Manager
Platform: Web desk 1280x800, manager build :5274
Environment: local dev, merged main + DOS-029 manager build (:5274), dos_qa, 2026-09-13
Steps:
  1. As meena.joshi, open Money → Receipts (7 days) → RCPT-0693 (office cash ₹5,511) → Bank it → slip DEP-QA-034-ACC → confirm.
  2. The request reached the service and committed: 200, journal 01a09777-e789 BANK +551100 / CASH −551100. The reply was then dropped in the browser (page.route fetch, then abort), simulating a signal loss.
  3. The dialog says 'No connection. Check the signal, then press again.'
  4. Press Bank it again. The POST carries the same id and idempotencyKey, but depositedAt changed from 2026-09-12T21:13:32.681Z to …32.964Z.
  5. The service answers 409 'idempotencyKey was already used with a different request', and the dialog shows that sentence.
  6. Close the dialog: the panel still shows State Collected.
Expected: The retry of the same intent replays the stored result (200, State Banked), or at least says in plain words that this receipt is already banked with slip DEP-QA-034-ACC.
Actual: The accountant gets a developer sentence and a stale 'Collected' state, while the DB has RCPT-0693 deposited once. The money was not banked twice, because the server's status check holds.
Business impact: On a weak signal the desk cannot tell whether the cash went to the bank. They may try again through Day-end with another slip (it would be refused as 'deposited, not collected') or chase the bank, and the receipt screen disagrees with the books until a reload.
Severity: P2
Evidence: QA/evidence/batch1/regression/web-manager/034-13-accountant-receipt-panel-office-cash-desk.png; QA/evidence/batch1/regression/web-manager/034-14-accountant-lost-reply-no-connection-desk.png; QA/evidence/batch1/regression/web-manager/034-15-accountant-retry-after-lost-reply-desk.png; QA/evidence/batch1/regression/web-manager/db-034-accountant-desk-before.txt; QA/evidence/batch1/regression/web-manager/db-034-accountant-desk-after.txt
Suggested fix: Fix time an intent's client values once per intent, outside the mutation run: depositedAt for Bank it and the Day-end batch, bouncedAt for bounce, lines[].id for credit-note create, lineIds[].id for docint approve. Then a retry is byte-identical and replays. After a network failure of unknown outcome, refetch the record so the panel shows the true state. Map the idempotency 409 to 'This was already saved' plus a refresh. Code review (not executed) shows the same timestamp pattern in day-end.tsx deposit and bounce.
```

Regression status: **CONSEQUENCE of DOS-034 (c0889f7), made visible by DOS-029 (d600ab8); mechanism pre-existing.** The api-client keys on the hook input while `run` adds `depositedAt: new Date()`, so a retry sends the same key with a new body; the same silent 409 existed at c5c6e03 on Day-end and the owner's Bank it. Nothing is banked twice (the status check refuses). New scope. Evidence: part-b-regression-status.md §7.

Found by: batch 1 regression part B (manager desk walk).

### DOS-137 — A load sheet built in the warehouse app is never linked to its trip, so the crew app says the godown has not confirmed the load after it has
Category: bug | Priority: P2 | Role: Delivery / Warehouse | Platform: Web (warehouse :5176, delivery :5177); shared code

```
User: Delivery / Warehouse
Platform: Web (warehouse :5176, delivery :5177); shared code
Environment: local dev, merged main + DOS-029 manager build (:5274), dos_qa, 2026-09-13
Steps:
  1. TRIP-0001 planned for MH-05-EF-9012; Start loading in W10. 2. Build the sheet with the W7 request body (no tripId), have the manager approve it, and have the warehouse confirm it (DC-0084, 6 cartons). 3. As iqbal.shaikh open Today's trip before depart, after depart and after all 4 stops.
Expected: The trip shows the load as confirmed (DC-0084, 6 cartons) so the crew can check what is on board.
Actual: 'Load on board - The godown has not confirmed a load sheet for this trip' every time. GET :3005/delivery/trips/{id} returns loadSheetIds [] and loadConfirmedAt null. The trip stayed 'loading' after load-out confirm until the crew departed. warehouse-app/app/load/index.tsx create() sends no tripId (the sheet's tripId is null).
Business impact: The driver cannot see the challan or cartons he left with and is told the godown never released the load, so carton disputes cannot be settled from the trip.
Severity: P2
Evidence: QA/evidence/batch1/regression/web-chain/c49-delivery-home-before-depart-desk.png; QA/evidence/batch1/regression/web-chain/c55-delivery-home-after-depart-reload-desk.png; QA/evidence/batch1/regression/web-chain/c67-delivery-home-all-stops-done-desk.png; QA/evidence/batch1/regression/web-chain/api-18b-delivery-get-trip-before-depart.json; QA/evidence/batch1/regression/web-chain/api-15-warehouse-create-load-sheet-response.json
Suggested fix: Let W7 choose the vehicle's planned/loading trip and send tripId, or link the sheet to that trip on create/confirm; show the challan on the crew's trip.
```

Found by: batch 1 regression part B (cross-role chain).

### DOS-138 — Once picking has started no one can cancel an order; the manager is offered Cancel order and gets a raw state-machine refusal
Category: missing-feature | Priority: P2 | Role: Manager | Platform: Web (manager :5274 DOS-029 build); the server rule applies on every platform

```
User: Manager
Platform: Web (manager :5274 DOS-029 build); the server rule applies on every platform
Environment: local dev, merged main + DOS-029 manager build (:5274), dos_qa, 2026-09-13
Steps:
  1. SO-0909 (R-0004) waved as PICK-0088, started, 3 of 5 lot lines picked (dinesh.patil). 2. As vikas.kadam: Orders -> Being picked -> SO-0909 -> Cancel order -> reason -> Cancel order. 3. Fulfilment -> PICK-0088 -> Cancel the sheet. 4. Repeat step 2 on SO-0908 (all picked, not packed).
Expected: When a shop phones during picking, the order can be cancelled: reservation voided and the picker told to put the stock back. At least, the product states the route ('finish packing, then cancel the bill').
Actual: POST :3002/orders/{id}/cancel returns 409 'order: cannot apply "cancel" in state "picking"', printed verbatim in the dialog while the Cancel button stays enabled. 'Cancel the sheet' is disabled: 'Only a sheet that has not started can be started or cancelled'. The picker's sheet shows nothing. The only exit was to finish picking, issue INV/9014 and cancel that bill. SO-0908 remains in picking with 144 pc reserved.
Business impact: Every mid-pick cancellation forces a legal invoice to be issued and cancelled (an invoice number and GST paperwork used up), or leaves orders stuck in picking with stock reserved.
Severity: P2
Evidence: QA/evidence/batch1/regression/web-chain/w2-03-warehouse-mid-pick-one-line-picked-desk.png; QA/evidence/batch1/regression/web-chain/w2-04-manager-cancel-SO-0909-mid-pick-dialog.png; QA/evidence/batch1/regression/web-chain/w2-04-manager-cancel-SO-0909-mid-pick-after.png; QA/evidence/batch1/regression/web-chain/w2-09-manager-wave-PICK-0088-panel-desk.png; QA/evidence/batch1/regression/web-chain/api-w2-cancel-mid-pick.json; QA/evidence/batch1/regression/web-chain/db-w2-after-cancel-mid-pick.txt
Suggested fix: Add picking->cancelled to the order machine (void reservations, cancel the open pick lines, show 'put back' on the picker's sheet), or a manager 'stop picking' returning the order to confirmed. Until then hide Cancel on picking orders and explain the route.
```

Context: docs/22 §4 defines cancel as allowed only up to confirmed, so the refusal itself follows the documented state machine; the defect is that Cancel order is offered in picking and answers with a raw refusal, and that no mid-pick cancel workflow exists.

Found by: batch 1 regression part B (cross-role chain).

### DOS-139 — Cancelling a bill before dispatch returns the stock and the money but leaves the order 'packed' and back in the billing queue
Category: business-logic | Priority: P2 | Role: Manager | Platform: Web (manager :5274)

```
User: Manager
Platform: Web (manager :5274)
Environment: local dev, merged main + DOS-029 manager build (:5274), dos_qa, 2026-09-13
Steps:
  1. SO-0909 packed with 1 carton -> INV/9014 Rs 3,029. 2. As vikas.kadam: Billing -> Bills issued (search INV/9014) -> Cancel the bill -> reason -> Cancel the bill (dialog: 'The number is kept. Stock and money come back. Only before dispatch.'). 3. Query the order, stock ledger and outstanding, and GET :3002/billing/queue.
Expected: In the same step the order is cancelled (or returned to confirmed with its pack voided), so nothing is left to bill or load.
Actual: INV/9014 cancelled; stock_ledger adjustment +168 into Godown; R-0004 outstanding -302,900 and open bills 6 -> 5. But SO-0909 is still 'packed' with no transition, and /billing/queue lists it (state packed, hasDraftInvoice false) as left to bill.
Business impact: The desk sees a packed order waiting for a bill whose goods are already back on the rack. Billing or loading it again would sell or dispatch the same 168 pieces twice (not executed). Order, invoice and stock lifecycles disagree.
Severity: P2
Evidence: QA/evidence/batch1/regression/web-chain/w2-12-manager-INV-9014-panel-desk.png; QA/evidence/batch1/regression/web-chain/w2-13-manager-cancel-bill-dialog-desk.png; QA/evidence/batch1/regression/web-chain/w2-14-manager-after-cancel-bill-desk.png; QA/evidence/batch1/regression/web-chain/api-w2-manager-cancel-bill-INV-9014.json; QA/evidence/batch1/regression/web-chain/api-w2-manager-billing-queue.json; QA/evidence/batch1/regression/web-chain/api-w2-manager-get-SO-0909-after-bill-cancel.json; QA/evidence/batch1/regression/web-chain/db-w2-after-cancel-bill-INV-9014.txt
Suggested fix: In billing.invoices.cancel for a pre-dispatch pack bill, move the order in the same transaction (packed->cancelled with the bill's reason, or packed->confirmed with the pack voided) and remove it from the pack and billing queues.
```

Regression status: **PRE-EXISTING** — invoice cancel restocks and reverses but never moves the order (order machine has packed → dispatch only); unchanged by batch 1. Note: since DOS-039, re-loading such an order would send goods out without deducting stock again, and re-billing is allowed; neither path is reachable from an app today (no app calls issueForPack; W7 would not list the pack). Candidate for P1 after an API probe. Evidence: part-b-regression-status.md §5.

Found by: batch 1 regression part B (cross-role chain).

### DOS-140 — The sellable-stock API offers damaged-bin lots to reps and shops as available
Category: business-logic | Priority: P2 | Role: Sales Rep / Retailer | Platform: Backend API (sales-service :3003 GET /inventory/sellable; the same view serves every role)

```
User: Sales Rep / Retailer
Platform: Backend API (sales-service :3003 GET /inventory/sellable; the same view serves every role)
Environment: local dev, merged main + DOS-029 manager build (:5274), dos_qa, 2026-09-13
Steps:
  1. dos_qa: Sunbake Marie Light 75 g lot SB20260802 has 32 pc in 'Damaged / expiry bin' (location kind damaged). 2. As rahul.deshmukh: GET :3003/inventory/sellable?variantId=860dacfb-9d78-7fd4-95ca-1e6b5e96fdc1&limit=50. 3. SELECT pg_get_viewdef('sellable_stock').
Expected: Available-to-promise counts only saleable warehouse stock (plus the caller's own vehicle for van sales); the damaged/expiry bin never appears.
Actual: The response includes locationId 01a0947d-7a97-7466-8ce4-06501d6672dd (Damaged / expiry bin), batch SB20260802, available 32. The view is on_hand - reserved over every location with no kind filter. Reservations and the order availability check do filter kind='warehouse', so no damaged piece was reserved.
Business impact: Reps and shops are shown damaged or expired pieces as stock they can order, and the bin grows with every DOS-058 return; anything that sums this view inherits the overstatement.
Severity: P2
Evidence: QA/evidence/batch1/regression/web-chain/api-11-sales-sellable-marie-light.json; QA/evidence/batch1/regression/web-chain/db-05-sellable-stock-view-and-damaged-bin.txt
Suggested fix: Restrict sellable_stock (or the inventory.stock.sellable query) to locations of kind warehouse (plus the caller's vehicle for van sales), exclude expired lots, and add a guarantee test.
```

Regression status: **PRE-EXISTING** — the sellable_stock view counts every location (no kind filter) since migration 0003; the damaged bin held stock before batch 1 (seed write-offs, desk saleable:false notes). DOS-058 only moved doorstep damaged returns from the vehicle row (also listed, and reservable later) to the damaged-bin row (listed, never reserved). Partly inside the held DOS-074+097 plan (its fix excludes vehicle and damaged locations from the rep/shop hint); the raw view for every role is new scope. Evidence: part-b-regression-status.md §4.

Found by: batch 1 regression part B (cross-role chain).

### DOS-141 — Refusals now reach the desk as machine sentences: record UUIDs, UTC ISO times and 'Input validation failed'
Category: ux | Priority: P3 | Role: Manager, Accountant | Platform: Web (desk and phone), manager build :5274

```
User: Manager, Accountant
Platform: Web (desk and phone), manager build :5274
Environment: local dev, merged main + DOS-029 manager build (:5274), dos_qa, 2026-09-13
Steps:
  Refused writes observed during this walk:
  1. Stale second desk approves an already-approved gate: 'approval 01a09766-114f-73f5-b1fc-9d9cab81e82e was already approved'.
  2. Stale second desk approves a load sheet: 'load sheet 01a0976e-bbaf-7dbe-9bb3-f6ed587bd574 was already approved by a1cbd424-d568-7ccb-b5cc-b049e8ac2063'.
  3. Start reviewing a locked document: 'Sunil Tarsun is reviewing this document (until 2026-10-12T00:00:00.000Z)'.
  4. 'Cheque returned' → Mark bounced with an empty reason. The button is enabled, a POST is sent, and the answer is 400 'Input validation failed'.
  5. Retry after a lost reply: 'idempotencyKey was already used with a different request'.
Expected: Sentences a desk person can act on:
- names and numbers: SO-0899 · Over credit limit; load sheet MH-05-CD-5678 13 Sep; Vikas Kadam;
- IST dates ('until 12 Oct');
- field messages such as 'Write what the bank said', with the confirm button disabled until a reason is typed.
Actual: DOS-029 now shows the service's own sentence, which is right. Several of those sentences carry database ids, a UTC timestamp or a generic validation line, so the manager still cannot tell who or what the refusal is about.
Business impact: The desk cannot tell which approval or load sheet was involved or who holds it without asking IT. It does not block work.
Severity: P3
Evidence: QA/evidence/batch1/regression/web-manager/020-08-deskB-stale-decide-409-refusal-desk.png; QA/evidence/batch1/regression/web-manager/025-07-deskB-stale-approve-409-refusal-desk.png; QA/evidence/batch1/regression/web-manager/029e-01-control-start-review-409-desk-viewport.png; QA/evidence/batch1/regression/web-manager/034-42-accountant-blank-bounce-reason-phone-viewport.png; QA/evidence/batch1/regression/web-manager/034-15-accountant-retry-after-lost-reply-desk.png
Suggested fix: In approvals.service, load-sheets.service and review.service, build refusal messages from human numbers and names (orderNo, vehicle reg + sheet date, user name) and IST dates. Map Zod issues to field-level messages on the client. Disable 'Mark bounced' in both bounce dialogs until a reason is typed. Related known findings: DOS-033 (UUID for the settled bill on a receipt) and DOS-035.
```

Found by: batch 1 regression part B (manager desk walk).

### DOS-142 — The manager's cancellation reason never reaches the rep's order screen, although the cancel dialog promises it will
Category: ux | Priority: P3 | Role: Sales Rep / Manager | Platform: Web (manager :5274, sales :5175)

```
User: Sales Rep / Manager
Platform: Web (manager :5274, sales :5175)
Environment: local dev, merged main + DOS-029 manager build (:5274), dos_qa, 2026-09-13
Steps:
  1. As vikas.kadam cancel SO-0907 with reason 'Shop asked to cancel - owner out of town, will reorder next week'; the dialog reads 'Why is it cancelled? The shop and the rep will read this.' 2. As rahul.deshmukh open SO-0907.
Expected: The rep sees who cancelled the order and why.
Actual: The rep's screen shows 'Cancelled' with no reason and no actor. GET :3003/orders/{id} does return cancelReason, but the sales app's local order (LocalOrder) has no cancel_reason field.
Business impact: The rep walks into the shop not knowing why the order died, and may re-book it or argue with the shopkeeper.
Severity: P3
Evidence: QA/evidence/batch1/regression/web-chain/w1-02-manager-cancel-dialog-desk.png; QA/evidence/batch1/regression/web-chain/w1-04-sales-rep-sees-SO-0907-cancelled-desk.png; QA/evidence/batch1/regression/web-chain/api-w1-sales-get-SO-0907.json; QA/evidence/batch1/regression/web-chain/db-w1-SO-0907-after-manager-cancel.txt
Suggested fix: Sync cancel_reason and cancelled_by to the device and show them on the order screen; otherwise drop the promise from the dialog.
```

Found by: batch 1 regression part B (cross-role chain).

### DOS-143 — Retailer 'My orders' prints the UTC date: an order placed at 3:05 am IST on 13 Sep reads 'Placed 12 Sep 2026'
Category: bug | Priority: P3 | Role: Retailer | Platform: Web (retailer :5178); code shared by Android/iOS

```
User: Retailer
Platform: Web (retailer :5178); code shared by Android/iOS
Environment: local dev, merged main + DOS-029 manager build (:5274), dos_qa, 2026-09-13
Steps:
  1. SO-0903 submitted 2026-09-13 03:05 IST (API createdAt 2026-09-12T21:35:33Z). 2. As fatima.shaikh open My orders.
Expected: 'Placed 13 Sep 2026', matching the order detail ('13 Sep, 3:05 am') and the bill date.
Actual: 'Order SO-0903 · Placed 12 Sep 2026'. frontend/retailer-app/app/orders/index.tsx renders longDate((order.submittedAt ?? order.createdAt).slice(0, 10)), which is the UTC calendar date.
Business impact: Every order placed between midnight and 5:30 am IST shows the previous day in the shop's own list, contradicting the bill and the delivery record.
Severity: P3
Evidence: QA/evidence/batch1/regression/web-chain/c69-retailer-my-orders-desk.png; QA/evidence/batch1/regression/web-chain/c70-retailer-order-SO-0903-desk.png; QA/evidence/batch1/regression/web-chain/api-24-retailer-get-SO-0903.json
Suggested fix: Format instants through the IST business-date helper (businessDate in @dos/domain) instead of slicing the ISO string, and check other apps for .slice(0, 10) on instants.
```

Found by: batch 1 regression part B (cross-role chain).

### DOS-144 — After a short pick the shop's order page still says 'You pay Rs 6,753.00' and '60 pc', while the delivered bill is Rs 6,679.00 for 54 pc
Category: ux | Priority: P3 | Role: Retailer | Platform: Web (retailer :5178)

```
User: Retailer
Platform: Web (retailer :5178)
Environment: local dev, merged main + DOS-029 manager build (:5274), dos_qa, 2026-09-13
Steps:
  1. SO-0903 ordered at Rs 6,753 with 60 pc Chamak Dishwash Bar; 6 pc short at pick -> INV/9010 Rs 6,679 (54 pc), delivered. 2. As fatima.shaikh open My orders -> SO-0903.
Expected: The order shows what was billed and delivered (54 of 60, 6 short and not billed) and the bill's amount due, or no 'You pay' at all.
Actual: 'WHAT YOU ORDERED ... Chamak Dishwash Bar 145 g 1 cs · 60 pc Rs 737.74 ... You pay Rs 6,753.00' next to 'Bill INV/9010 Rs 6,679.00 To pay'; the short is not mentioned.
Business impact: The shopkeeper sees two different amounts to pay for one order and no explanation for the missing 6 bars, which invites short-payment disputes. Same wording class as DOS-105 (a cancelled order showing 'You pay').
Severity: P3
Evidence: QA/evidence/batch1/regression/web-chain/c70-retailer-order-SO-0903-desk.png; QA/evidence/batch1/regression/web-chain/c72-retailer-bill-INV-9010-desk.png; QA/evidence/batch1/regression/web-chain/db-03-INV-9010-after-pack.txt
Suggested fix: On orders that have a bill, show billed/delivered quantities per line and replace 'You pay' with the bill's amount due, linking to the bill.
```

Found by: batch 1 regression part B (cross-role chain).

### DOS-145 — The manager cannot open a given bill from search: global search lands on Registers, Billing ?q= works only on the 'Bills issued' tab, and that register is not newest-first
Category: ux | Priority: P3 | Role: Manager | Platform: Web (manager :5274)

```
User: Manager
Platform: Web (manager :5274)
Environment: local dev, merged main + DOS-029 manager build (:5274), dos_qa, 2026-09-13
Steps:
  1. Billing -> Bills issued: first rows INV/0634 (21 Aug), INV/0822 (10 Sep), INV/0803; INV/9014, issued minutes earlier, is not in view. 2. Global search 'INV/9014' -> choose 'INV/9014 Sai Krupa Super Bazar' -> lands on Registers (sales register) with no bill panel and no Cancel. 3. Open /billing?q=INV%2F9014 -> the Billing desk tab still shows the order queue; the filtered bill appears only after switching to Bills issued.
Expected: Search opens the bill panel (cancel, e-way bill); the issued register is sorted newest first.
Actual: As above: three attempts to reach a bill issued minutes earlier.
Business impact: When a shop phones to cancel before dispatch, the desk loses minutes finding today's bill at exactly the moment the cancel must happen before the van leaves.
Severity: P3
Evidence: QA/evidence/batch1/regression/web-chain/w2-11a-manager-billing-desk.png; QA/evidence/batch1/regression/web-chain/w2-12a-manager-search-INV-9014-desk.png; QA/evidence/batch1/regression/web-chain/w2-12a-manager-bills-issued-search-INV-9014-desk.png
Suggested fix: Route bill hits from global search to /billing with view=bills and the bill panel open; make ?q switch to Bills issued; sort the register by invoice_date desc, invoice_no desc.
```

Found by: batch 1 regression part B (cross-role chain).

### DOS-146 — Trip-start 'Cash handed to you' cannot hold any amount except the planned float: typing appends to ₹3,000 and Clear snaps back
Category: bug | Priority: P1 | Role: Delivery | Platform: Android (Pixel_7_API_36 emulator, API 36); same screen code on iOS, not walked

```
User: Delivery
Platform: Android (Pixel_7_API_36 emulator, API 36); same screen code on iOS, not walked
Environment: local dev, merged main, dos_qa, Android emulator Pixel_7_API_36 (API 36), 2026-09-13
Steps:
  1. Sign in to the delivery app as sachin.dalvi (Sai Distributors). 2. Home → Your other trips → TRIP-NEXT (planned, opening float ₹3,000) → Start the trip → Before you leave → 'Cash handed to you' (shows ₹3,000.00). 3. Tap the field; the money keypad opens on ₹3,000. 4. Tap 4 7 5 6. 5. Tap Clear, then 4 7 5 6 again. 6. Tap ⌫ eight times. 7. Done.
Expected: A driver handed ₹4,756 can enter ₹4,756: Clear empties the pad, digits start a new amount, and the planned float is only a pre-fill he can replace.
Actual: Step 4 previews ₹3,00,04,756 ('30004756 rupees'). Clear snaps back to ₹3,000, and 4-7-5-6 again gives ₹3,00,04,756. ⌫ to empty also snaps back to ₹3,000, and Done leaves ₹3,000.00. The only enterable amounts are ₹3,000 or numbers beginning with 3000. The screen passes value={cashPaise ?? detail?.openingCashPaise}, so onChange(null) falls back to the plan on every render (frontend/delivery-app/app/trip/start.tsx:290). Trip not started; trips.opening_cash_paise stays 300000.
Business impact: The opening float drives 'Cash the office expects' at check-in. A driver given a different float records ₹3,000 (a false variance), or taps one digit and starts the trip with a float in crores. On a loaded trip Start is enabled, so the wrong float is written and every day-end reconciliation for that van is off. The retailer Pay screen uses the same `amount ?? owed` pattern (implementer follow-up), not walked here.
Severity: P1
Evidence: QA/evidence/batch1/regression/android/delivery-060-23-sachin-trip-next-start.png; QA/evidence/batch1/regression/android/delivery-060-24-sachin-cash-field.png; QA/evidence/batch1/regression/android/delivery-060-25-cash-pad-open.png; QA/evidence/batch1/regression/android/delivery-060-26-cash-pad-typed-4756.png; QA/evidence/batch1/regression/android/delivery-060-27-cash-pad-after-clear.png; QA/evidence/batch1/regression/android/delivery-060-28-cash-pad-typed-after-clear.png; QA/evidence/batch1/regression/android/delivery-060-29-cash-pad-back-to-empty.png; QA/evidence/batch1/regression/android/delivery-060-30-cash-field-after-done.png
Suggested fix: Seed cashPaise once from openingCashPaise when the trip loads, and let null mean 'empty' (no render-time fallback). Alternatively, give the pad an explicit 'Use planned float ₹3,000' chip. Apply the same pattern to retailer-app/app/pay.tsx. Add a render test: open pad on a pre-filled value, Clear, type 4756, expect ₹4,756.
```

Regression status: not re-executed on the pre-fix build. The DOS-060 verifier recorded the cause as pre-existing (trip/start.tsx passes `cashPaise ?? openingCash`, so an emptied field falls back to the float) and listed it as a follow-up, not a regression of the rupee-entry change.

Found by: batch 1 regression, Android pass (sales + delivery).

### DOS-147 — Android order entry: with the stock chip shown, item names and pack sizes are clipped, so variants cannot be told apart before 'Add a case'
Category: ux | Priority: P2 | Role: Sales Rep | Platform: Android (Pixel_7_API_36 emulator, API 36); web phone width is DOS-128

```
User: Sales Rep
Platform: Android (Pixel_7_API_36 emulator, API 36); web phone width is DOS-128
Environment: local dev, merged main, dos_qa, Android emulator Pixel_7_API_36 (API 36), 2026-09-13
Steps:
  1. rahul.deshmukh → Beat → Kalyan West Market → Laxmi Narayan Stores → Take order. 2. Scroll to the catalog; then search 'Neelam'. 3. Read the rows and the uiautomator bounds.
Expected: Each row shows the full variant name (up to 2 lines) and 'brand · N pc case', as it does offline where no chip is drawn.
Actual: Online, the '18 cs available' chip [312..665] and 'Add a case' [707..1004] leave the name column 77..260/290 px (~70–80 dp). Rows read 'Campa / Cola 200 …' with 'Campa · 48…'; 'Neelam An / ti-Dandru…' with 'Neelam · 2…' (175 ml, 24 pc case); and 'Neelam / Anti-Da…' with 'Neelam · …' (5 ml sachet, 480 pc case). A row without a chip (340 ml) and all offline rows show the full name and 'Neelam · 18 pc case'. The DOS-077 fix made rows visible; this residual was noted by the implementer.
Business impact: A rep on the phone cannot tell Neelam Anti-Dandruff 175 ml from the 5 ml sachet, or Campa Cola 200 ml from 2 L, before adding a case. He adds blind and must check 'This order'. Wrong-SKU cases go to the shop and come back as returns.
Severity: P2
Evidence: QA/evidence/batch1/regression/android/sales-077-05-catalog-rows.png; QA/evidence/batch1/regression/android/sales-077-05-catalog-rows-bounds.txt; QA/evidence/batch1/regression/android/sales-077-07-neelam-rows.png; QA/evidence/batch1/regression/android/sales-077-07-neelam-rows-bounds.txt; QA/evidence/batch1/regression/android/sales-077-09-offline-catalog-rows.png
Suggested fix: Below the desk breakpoint, move availability onto the meta line ('Neelam · 24 pc case · 4 cs') or wrap chip and button under the name. Give the name column a minimum width. Fix together with DOS-128 in frontend/sales-app/app/orders/new.tsx.
```

Related: DOS-128 (the same clipping on the web phone width). DOS-077 itself PASSES on Android — rows are no longer blank — but the name column is still narrow when the stock chip shows.

Found by: batch 1 regression, Android pass (sales + delivery).

### DOS-148 — Delivering a bill whose order was never dispatched fails only after the photo, with the raw message 'order: cannot apply "deliver_partial" in state "packed"'
Category: ux | Priority: P2 | Role: Delivery | Platform: Android (Pixel_7_API_36 emulator, API 36)

```
User: Delivery
Platform: Android (Pixel_7_API_36 emulator, API 36)
Environment: local dev, merged main, dos_qa, Android emulator Pixel_7_API_36 (API 36), 2026-09-13
Steps:
  1. ganesh.more → Your other trips → TRIP-NEXT → Stop 1 City Light Provision (INV/0831, order SO-0862 state packed, not in DC-0083's order_ids, both lots still in the Godown). 2. The stop screen offers 'Deliver this bill'; tap it. 3. Press '−' on a line, choose a reason, photograph the signed bill, fill 'Bill signed by', Record the delivery.
Expected: The stop or bill screen says before the door that this bill is not on the van (not dispatched) and does not offer Deliver. If the server refuses, the driver reads a sentence he can act on.
Actual: Nothing marks the bill as not loaded; 'Deliver this bill' is enabled. After the photo upload, POST /delivery/deliveries answers 409 and the form shows, in red above the footer, 'order: cannot apply "deliver_partial" in state "packed"'. The Record button's accessibility state stays 'busy'. Nothing is written (INV/0831 has only its plan row, no credit note). An API replay with the same body gives the same 409 {from packed, event deliver_partial}.
Business impact: The driver stands at the shop with a signed bill and a photo, and the app gives him developer text. He cannot tell whether he or the godown is at fault, and the goods were never on his van. With DOS-043 still open (trips go active before loading), this reaches real stops.
Severity: P2
Evidence: QA/evidence/batch1/regression/android/delivery-058-17-d4-bottom-after-409.png; QA/evidence/batch1/regression/android/delivery-058-17-d4-texts-bottom.txt; QA/evidence/batch1/regression/android/delivery-058-api-probes.txt; QA/evidence/batch1/regression/android/delivery-058-db-trip-next-deliverable.txt; QA/evidence/batch1/regression/android/delivery-058-db-safety-check.txt
Suggested fix: Map order-state 409s from deliveries.record to driver sentences, e.g. 'This bill is still in the godown — it was not loaded on this van'. Mark such bills on D3 and disable Deliver when the order is not dispatched or not on the trip's confirmed sheet. Refuse stop planning or trip start for orders that are not on the load sheet (with DOS-043).
```

Found by: batch 1 regression, Android pass (sales + delivery).

### DOS-149 — Stop screen stays stale for ~40 s after a successful delivery, still offering 'Deliver this bill' with the old dues and no success message
Category: ux | Priority: P3 | Role: Delivery | Platform: Android (Pixel_7_API_36 emulator, API 36)

```
User: Delivery
Platform: Android (Pixel_7_API_36 emulator, API 36)
Environment: local dev, merged main, dos_qa, Android emulator Pixel_7_API_36 (API 36), 2026-09-13
Steps:
  1. ganesh.more → TRIP-NEXT → Stop 5 Meghana General Store → I am at the shop → Deliver this bill → return one case as Damaged → photo → Record the delivery. 2. Read the stop screen immediately, then again ~40 s later.
Expected: After a 200 the stop shows 'Part delivered', the new dues and 'This stop is finished', and a toast names the credit note.
Actual: At 03:25:0x (POST 200 at 03:24:58, CN/9007 written) the stop screen still read 'At the shop · Owes ₹28,496.00 · INV/0836 Not started · Deliver this bill · Take money'. No toast was visible: onSuccess sets the toast on D4 and then router.replace()s away from it. At 03:25:38 it showed 'Part delivered · Owes ₹27,724.00 · This stop is finished'.
Business impact: For up to a minute a driver sees the bill as undelivered and may deliver it again or tell the shop the wrong dues. A second record is refused by the server, adding confusion at the door.
Severity: P3
Evidence: QA/evidence/batch1/regression/android/delivery-058-24-meghana-after-record.png; QA/evidence/batch1/regression/android/delivery-058-24-meghana-after-record.txt; QA/evidence/batch1/regression/android/delivery-058-25-meghana-stop-refresh-check.png; QA/evidence/batch1/regression/android/delivery-058-db-after-record-meghana.txt
Suggested fix: Write the returned stop and delivery (RecordDeliveryOutput.stop / item) into the local tables before navigating. Show the success toast on the destination screen, or pass it through the route.
```

Found by: batch 1 regression, Android pass (sales + delivery).

### DOS-150 — Emptied amount field still announces the previous amount to screen readers ('—' shown, '4756 rupees' spoken)
Category: ux | Priority: P3 | Role: Delivery | Platform: Android (Pixel_7_API_36 emulator, API 36)

```
User: Delivery
Platform: Android (Pixel_7_API_36 emulator, API 36)
Environment: local dev, merged main, dos_qa, Android emulator Pixel_7_API_36 (API 36), 2026-09-13
Steps:
  1. ganesh.more → Stop 7 Nakshatra Kirana → Take money → Cash → Amount taken. 2. Type 4 7 5 6, then Clear, then Done. 3. Read the accessibility node of the field.
Expected: The empty field's accessibility label says it is empty ('Amount taken, not entered').
Actual: The field shows '—' and 'Record the payment' is DISABLED, but the node's content-desc is still '4756 rupees' ([76,1688][117,1757] '—' '4756 rupees'). Whether this predates batch 1 was not established.
Business impact: A TalkBack user hears ₹4,756 while nothing is entered, and cannot tell why Record is disabled. It is low impact for sighted drivers.
Severity: P3
Evidence: QA/evidence/batch1/regression/android/delivery-060-08-done-empty-record-disabled.png; QA/evidence/batch1/regression/android/delivery-060-08-done-empty-nodes.txt
Suggested fix: Derive the field's accessibilityLabel from the current value (null → the 'empty' string) rather than the last non-null amount, and add a native render test.
```

Found by: batch 1 regression, Android pass (sales + delivery).

### DOS-151 — Invoice and credit-note PDFs print '?' for the em dash in the tenant's own footer ('Tarsun Enterprise ? Wholesale & Distribution')
Category: bug | Priority: P3 | Role: Delivery / Retailer / Accountant (anyone reading the paper) | Platform: Backend PDF renderer, seen in the Android print preview

```
User: Delivery / Retailer / Accountant (anyone reading the paper)
Platform: Backend PDF renderer, seen in the Android print preview
Environment: local dev, merged main, dos_qa, Android emulator Pixel_7_API_36 (API 36), 2026-09-13
Steps:
  1. ganesh.more → Stop 5 Joshi Kirana Stores → INV/0826 → Send the papers → Print. 2. Read the footer line of the rendered tax invoice. 3. Extract the text of the stored PDF and read tenant_settings branding.invoice_footer.
Expected: The footer reads 'Tarsun Enterprise — Wholesale & Distribution · GSTIN 27CNGPP9039R1ZX'.
Actual: The print preview and the stored PDF text read 'Tarsun Enterprise ? Wholesale & Distribution · GSTIN …'. branding.invoice_footer contains U+2014, and pdf.ts documents that characters outside Latin-1 print '?'. The em dash exists in WinAnsi (0x97), yet it is replaced.
Business impact: Every paper the shop receives carries a visible encoding glitch in the distributor's own letterhead line. It is cosmetic, but it undermines the professional look of GST papers.
Severity: P3
Evidence: QA/evidence/batch1/regression/android/delivery-057-07-print-invoice.png
Suggested fix: In backend/libs/core/src/documents/pdf.ts, map the cp1252 punctuation WinAnsi can hold (— – ‘ ’ “ ” • …) to their WinAnsi codes before the Latin-1 fallback. Optionally normalise tenant branding text on save.
```

Found by: batch 1 regression, Android pass (sales + delivery).

### DOS-152 — Android W5 Short sheet: the Short (save) button and the pad's last row sit below the sheet's scroll viewport, behind 'Close'; tapping where Short is laid out closes the sheet and discards the entry
Category: bug | Priority: P2 | Role: Warehouse | Platform: Android (Pixel_7_API_36 emulator, API 36, 1080x2400)

```
User: Warehouse
Platform: Android (Pixel_7_API_36 emulator, API 36, 1080x2400)
Environment: local dev, merged main, dos_qa, Android emulator Pixel_7_API_36 (API 36), 2026-09-13
Steps:
  1. Sign in as dinesh.patil on the warehouse app and open a started wave (PICK-0089). 2. Press Short on a lot row (e.g. SC20260716, 2 pc), choose 'Batch held back', leave the pad at 0. 3. Look for the Short button: only the pad rows 1–9, a 48-px sliver of Clear/0/⌫, and 'Close' are visible. 4. Drag the sheet up slowly (adb swipe 1180→560 over 900 ms, 900→300 over 1000 ms, 1700→700 over 1000 ms): it does not scroll. 5. Tap where uiautomator reports Short (540,2184): Close is on top, the sheet shuts, nothing is saved. 6. Only a fast fling (1150→450 in 250 ms) scrolls the sheet and brings Short to y 1834–2033, where it saves.
Expected: The Short button, the whole keypad and any refusal line are visible without scrolling on a common phone, or the sheet reliably scrolls under a normal drag, and 'Close' never overlaps the save action.
Actual: uiautomator bounds: ScrollView [42,521][1038,2075]; Button 'Short' top 2293, clipped at 2075 (entirely below the viewport); Button 'Close' [42,2117][1038,2317]; keypad row 4 [..,2027][..,2075]. Slow drags do not scroll the sheet. A tap at Short's laid-out centre hits Close and discards the pieces and reason. PICK-0089 row SC20260716 stayed picked_at NULL and the wave stayed picking until the fling path was found. The same happened on the 7-pc row: Short was hidden until an over-ask figure was keyed and the sheet scrolled.
Business impact: The picker's main device is an Android phone, and recording a short is part of every wave. On a 412-dp-wide Pixel 7 (cheaper phones are shorter) the save button of the Short sheet cannot be seen. A picker who drags gently finds nothing to press, and one who taps near the bottom closes the sheet and loses what he typed. The wave cannot close (DOS-042 rule) until the short is recorded, so the order waits at the rack.
Severity: P2
Evidence: QA/evidence/batch1/regression/android/warehouse-042-02-short-sheet-last-row-0.png; QA/evidence/batch1/regression/android/warehouse-042-03-short-sheet-scrolled.png; QA/evidence/batch1/regression/android/warehouse-042-04-after-last-short.png; QA/evidence/batch1/regression/android/warehouse-042-06-swipe-a.png; QA/evidence/batch1/regression/android/warehouse-042-07-swipe-b.png; QA/evidence/batch1/regression/android/warehouse-042-11-sheet-after-fast-fling.png; QA/evidence/batch1/regression/android/warehouse-042-12-after-last-short-saved.png; QA/evidence/batch1/regression/android/warehouse-042-sheet-scroll-measure.txt; QA/evidence/batch1/regression/android/warehouse-041-01-short-sheet-7pc-row.png
Suggested fix: In frontend/libs/ui/src/native/feedback.tsx (Sheet) inset the scroll content by the pinned footer's height (or put Close inside the scroll content), so no child is laid out behind the footer. In frontend/warehouse-app/app/pick/[id].tsx make the W5 Short sheet compact: put the reason chips and the 'Requested N pc' line on one row, use a shorter pad, and render the over-ask line next to the figure (DOS-118). Blame: the sheet dates from 335a11c9. DOS-041 (475092f) added expected/expectedLabel, which uses 127 px (y 884–1011) and pushed Short further down; by the same bounds the button top would still sit at about 2166, below the 2075 viewport, without it (inference from the measured bounds, not run on the pre-batch build).
```

Found by: batch 1 regression, Android pass (retailer + warehouse + owner).

### DOS-153 — Owner Approvals: a note typed for one approval carries into the next approval opened, and is sent with that decision
Category: bug | Priority: P3 | Role: Owner | Platform: Android (Pixel_7_API_36 emulator, API 36); same component on web

```
User: Owner
Platform: Android (Pixel_7_API_36 emulator, API 36); same component on web
Environment: local dev, merged main, dos_qa, Android emulator Pixel_7_API_36 (API 36), 2026-09-13
Steps:
  1. Sign in as sunil.tarsun. Today → Approvals → open SO-0910 (Bargain). 2. Type a note in 'Note for the person who asked'. 3. Close the panel without deciding. 4. Open a different approval (Om Sai Provision Store, Bargain). 5. Read its note box.
Expected: Each approval opens with an empty note box; a note typed for one request never appears on another.
Actual: Om Sai's panel opened with 'QA android DOS-020 approve fixture bargain' already in the note box (EditText text identical). Re-opening SO-0910 showed it again, and an earlier ESC-closed attempt had left partial text that a new tap inserted into, garbling the note. In frontend/owner-app/app/approvals.tsx the note state is cleared only after a successful decision (line ~171, setNote('')); the Sheet's onClose (line ~268) clears only `selected`. Code from 5a13a64 (2026-09-06), so it predates batch 1.
Business impact: An owner who writes 'No, list rate holds this month' on one rep's bargain, closes it and opens another request can approve or reject the second one with the first note attached. The note is shown to the rep who asked ('the person who asked will read it'), so the wrong explanation reaches the wrong person.
Severity: P3
Evidence: QA/evidence/batch1/regression/android/owner-020-06-note-typed.png; QA/evidence/batch1/regression/android/owner-020-06-note-clean.png; QA/evidence/batch1/regression/android/owner-020-08-om-sai-panel-note-carried.png; QA/evidence/batch1/regression/android/owner-020-08-om-sai-panel-note-carried.txt
Suggested fix: In frontend/owner-app/app/approvals.tsx call setNote('') whenever `selected` changes (in the Sheet onClose and in the row onPress), or key the note by approval id. Apply the same check to the manager app's decision dialog.
```

Found by: batch 1 regression, Android pass (retailer + warehouse + owner).

### DOS-154 — Retailer Pay screen: ticking bills disables the amount field but it keeps showing the full dues, contradicting the bottom bar and the intent
Category: ux | Priority: P3 | Role: Retailer | Platform: Android (Pixel_7_API_36 emulator, API 36); same screen on web

```
User: Retailer
Platform: Android (Pixel_7_API_36 emulator, API 36); same screen on web
Environment: local dev, merged main, dos_qa, Android emulator Pixel_7_API_36 (API 36), 2026-09-13
Steps:
  1. Sign in as ramesh.gupta, Money due → Pay everything. 2. Tick only INV/0433 (₹4,561.00). 3. Read 'How much are you paying' at the top and in the bottom bar. 4. Start the payment.
Expected: The amount field shows the ticked total (₹4,561.00), or is replaced by 'Paying for 1 bill: ₹4,561.00', so the screen shows one amount.
Actual: The top field (disabled, but not visibly different) still reads ₹35,843.00 with 'Leave it as it is to pay everything you owe', while the bottom bar reads 'How much are you paying ₹4,561.00'. The intent correctly uses ₹4,561.00 (am=4561.00, PAY-f97f2fe653a0). pay.tsx: value={amount ?? owed} with disabled={chosen.length > 0}; payable uses chosenTotal. From edb56b4 (2026-09-07), predates batch 1.
Business impact: A shopkeeper sees two different amounts under the same label and may untick, re-tick or abandon the payment. It is a small trust dent on the one screen where money leaves his account.
Severity: P3
Evidence: QA/evidence/batch1/regression/android/retailer-094-07-one-bill-ticked.png; QA/evidence/batch1/regression/android/retailer-094-08-one-bill-started.png
Suggested fix: In frontend/retailer-app/app/pay.tsx show value={chosen.length > 0 ? chosenTotal : (amount ?? owed)} and swap the helper text to 'Total of the bills you ticked' while bills are chosen; render the disabled state visibly.
```

Found by: batch 1 regression, Android pass (retailer + warehouse + owner).

### DOS-155 — Owner approve dialog on an order's last approval does not say it will confirm the order and reserve stock, and nothing says so afterwards
Category: ux | Priority: P3 | Role: Owner | Platform: Android (Pixel_7_API_36 emulator, API 36); same dialog on web

```
User: Owner
Platform: Android (Pixel_7_API_36 emulator, API 36); same dialog on web
Environment: local dev, merged main, dos_qa, Android emulator Pixel_7_API_36 (API 36), 2026-09-13
Steps:
  1. Sign in as sunil.tarsun. Approvals → open SO-0910 (its only pending approval is the bargain). 2. Type a note → Approve. 3. Read the dialog. 4. Approve. 5. Look at the Approvals list; open Orders.
Expected: On the last pending approval the dialog states the consequence ('Approving this confirms SO-0910 for Rameshwar General Store and holds 24 pc'), and after the decision the owner sees 'SO-0910 confirmed'.
Actual: The dialog reads only 'Approve SO-0910 · Bargain · ₹44.80 · <note> · Approve / Cancel'. After Approve the row vanishes with no message, while in the same second SO-0910 moved submitted→confirmed (actor sunil.tarsun) and 24 pc were reserved. The consequence is stated only on the order panel's disabled Confirm reason, which the owner does not see from Approvals.
Business impact: DOS-020's purpose was that a decision never confirms an order silently. On the Approvals screen, where owners actually decide, the confirmation and stock hold still happen without a word, so an owner who meant only to allow a rate learns later that the order is confirmed and stock is held.
Severity: P3
Evidence: QA/evidence/batch1/regression/android/owner-020-09-approve-dialog.png; QA/evidence/batch1/regression/android/owner-020-10-after-approve.png; QA/evidence/batch1/regression/android/owner-020-db-02-after-approve.txt; QA/evidence/batch1/regression/android/owner-020-04-so0910-confirm-disabled.png
Suggested fix: In frontend/owner-app/app/approvals.tsx (and the manager order sheet), when the approval is the order's last pending one, add a line to the confirm dialog: 'This is the last decision: SO-xxxx will be confirmed and its stock held'. After success, show a toast naming the confirmed order. The decide reply already returns order.state.
```

Found by: batch 1 regression, Android pass (retailer + warehouse + owner).

