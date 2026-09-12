# Findings — Phase 1, Delivery walkthrough (ganesh.more, delivery app :5177, delivery-service :3005)

Environment: local dev, database `dos_qa` (realistic seed 2026-09-12, commit 472a5df), all eight services + worker started by
`QA/tools/start-services.sh`, web via `QA/tools/pw-server.mjs` + `pw.mjs` (headless Chromium 145, 1280×800 desk and 390×844 phone),
Android debug APK on the Pixel 7 emulator (API 36, camera = the emulator's virtual camera, API reached over `adb reverse`), iOS via
Expo Go on the iPhone 16 Pro simulator (Appium) for sign-in and home. Evidence root: `QA/evidence/phase1/delivery/` (`d-NN` = desk
web PNG + innerText `.txt`, `p-NN` = phone width, `api-NN-*.txt` = the request/response pairs the browser sent, `db-NN-*.txt` = SQL and
its output, `android/a-NN-*.png` = device screenshots, `ios-*.png` = simulator screenshots).

Live state used: `TRIP-ACTIVE` (12 Sep, MH-05-AB-1234, 10 stops, 3 delivered by the seed) is Ganesh More's real trip; `TRIP-NEXT`
(14 Sep, 5 stops) is `active` with nothing loaded — the artefact of DOS-043 from the warehouse walk. Nothing could be loaded through the
app (DOS-039), so the walk drove the seeded active trip: stops 4, 7, 9, 10 delivered in full, stop 5 part-delivered with a case taken
back, stop 6 failed, stop 8 arrived (the offline delivery attempts), cash and UPI collected, a diesel expense recorded, papers shared.

Note on `d-43`/`d-44`: that run was NOT offline — Playwright's `setOffline` does not survive between `pw.mjs` processes, so the
browser had reconnected and stop 9 was delivered online. The real offline run is `d-45`…`d-48` (one process, stop 8).

Findings the earlier walks already filed and which are ALSO true here are not re-numbered; they are listed at the end.

---

### DOS-056 — A delivery recorded without network is lost: Android drops it silently, web queues it and the office refuses it
Category: reliability | Priority: P1 | Role: Delivery | Platform: Android + Web

```
User: Delivery (ganesh.more)
Platform: Android (Pixel 7 emulator, API 36, debug APK) and Web 1280×800
Environment: local dev, dos_qa realistic seed
Steps (Android):
  1. Cut the app's path to the API (adb reverse tcp:3000/3005 removed, app force-stopped and relaunched so no socket survives;
     the JS bundle still loads). Home opens signed in, "Still filling this phone from the office".
  2. Today → Next stop (City Light Provision, TRIP-NEXT) → "I am at the shop" → strip says "1 waiting to send" (correct).
  3. Deliver this bill → Photograph the signed bill (camera, shutter, Done) → "Photo attached" → Record the delivery.
  4. Wait 3 s, 25 s, 45 s. Restore the API path, wait 45 s, open Attention.
Steps (Web):
  1. One Playwright session: open stop 8 (Laxmi Narayan Stores, already arrived), context.setOffline(true) → strip "Offline since 4:57 pm".
  2. Deliver this bill → photo through the file chooser → "Bill signed by" → Record the delivery. Wait 28 s. setOffline(false).
Expected: the delivery is saved on the phone with its photo, shown as waiting, and reaches the office when the network returns
          (docs/23 §5.4: D4 must work offline before the pilot).
Actual (Android): nothing happens. The form stays on screen with "Record the delivery" enabled, no message, no spinner, no
          "waiting to send" for the delivery (the counter stays at 1 = the arrival), nothing in logcat. After reconnecting the
          arrival syncs (trip_stops.arrived_at 16:48:54 = the offline time) but the delivery never exists: DB stop 1 = arrived, no
          deliveries row. The driver has handed over ₹7,038 of goods with no record.
Actual (Web): the delivery IS queued ("Offline since 4:57 pm · 1 waiting to send"), and on reconnect the office REFUSES it:
          sync_ops outcome row_invalid — "a photo or signature carries exactly one of objectKey / inline; an otp or geo carries
          neither" (the photo could not be uploaded offline, so the queued row carries a photo entry with no object key). The
          Attention tray shows that zod JSON verbatim to the driver; "Send it again" sends nothing (no request leaves the browser);
          the only other button is "Throw it away".
Business impact: the one thing the crew must be able to do with no signal — say what was dropped at the door and prove it — does
          not survive a dead spot on either platform. On the phone it is lost without a word; on web it is lost with a JSON blob.
Severity: P1
Evidence: android/a-41-tripnext-stop1-arrive-offline.png, a-42-offline-record.png, a-42b/c/d (3 s / 25 s / 45 s), a-43-attention-offline.png
          (Waiting: 1 = the stop only), a-44-attention-back-online.png; db-10-web-offline.txt (sync_ops rejection, stop 8 still
          arrived); d-45-offline-deliver-filled.png, d-46-offline-record-3s.png, d-47-offline-record-28s.png, d-48-back-online.png,
          d-49-attention-refused.png, d-50-attention-retry.png; api-08-web-offline.txt.
Suggested fix: make the delivery an outbox op on every platform (docs/27), with the photo in a separate upload queue that runs
          first when the network returns and only then releases the delivery op (the plan already says so: "a separate upload
          queue"). Until the upload is done the tray must show the delivery as waiting, never refused. Translate rejections into
          words ("The office needs the photo — it will go once you have signal"). Make "Send it again" actually resend.
```

### DOS-057 — No paper can be opened, printed or sent: the signed link is relative, and receipts are never rendered
Category: bug | Priority: P1 | Role: Delivery | Platform: Web + Android

```
User: Delivery (ganesh.more)
Platform: Web 1280×800 and Android (Pixel 7 emulator)
Environment: local dev, dos_qa realistic seed
Steps:
  1. Stop → tap the bill row → "Send the papers" (D9). Before the worker has rendered: "The office is still making this PDF",
     the credit note row and every receipt row are disabled buttons (d-27, d-28: 0 enabled rows). ~2 minutes later the invoice
     gets Open / Print / Send on WhatsApp (worker log "document rendered", d-29).
  2. Web "Open" → a new tab at http://localhost:5177/storage/tenant/…/invoice/….pdf?expires=…&signature=… — the APP's origin, which
     answers 200 text/html: the delivery app shell, not the PDF (api-05-share-buttons.txt; curl in the same file).
  3. Web "Send on WhatsApp" → toast "Nothing was sent" (no share sheet in a desk browser, no wa.me fallback) (d-30).
  4. Android "Send on WhatsApp" → the OS chooser shares TEXT: "INV/0829 · Tarsun Enterprise /storage/tenant/…/….pdf?expires=1789211874
     &signature=…" — a path with no host, and a signature that expires 15 minutes after the tap (a-25-whatsapp-tap.png).
  5. Android "Open" → nothing visible; logcat: FileSystem.downloadFileAsync rejected — "URI is not absolute" (a-26-open-pdf.png,
     a-26-open-logcat.txt).
  6. Receipts: 0 of 731 receipts in the tenant carry a pdf_object_key (db-06-pdf-render.txt), so a receipt can never be shared;
     the credit note CN/9003 got a PDF but its row stayed disabled after the render.
Expected: at the door the driver shows the bill, prints it on the van printer, or sends bill + receipt to the shop's WhatsApp;
          the link the shop receives opens the paper and stays valid long enough to be read in the evening.
Actual: no paper can be opened on either platform, nothing prints, and what WhatsApp would carry is a broken relative path
          that dies in 15 minutes. Receipts have no document at all.
Business impact: the shopkeeper gets no bill and no receipt from the app — the paper book stays mandatory, and the "zero
          paper" pitch of the delivery app is not true today.
Severity: P1
Evidence: d-27-bill-tap.png/.txt, d-28-receipt-tap.png, d-29-share-after-render.png, d-30-share-buttons.png, api-05-share-buttons.txt,
          android/a-24-send-papers.png, a-25-whatsapp-tap.png, a-26-open-pdf.png, a-26-open-logcat.txt, db-06-pdf-render.txt.
Suggested fix: files.readUrl / documents must return an ABSOLUTE https URL (or the client must prefix the API base) — one fix
          covers Open on web, Open on Android and the WhatsApp text. Share the PDF file itself on the phone (download to cache, share
          as a file), and use a long-lived, single-document token for links sent to shops. Render a receipt document
          (docs/23 receivables gap) and request the invoice render at delivery time, not when the share screen opens, so the paper
          is ready at the door. Enable the credit-note row once its PDF exists.
```

### DOS-058 — Choosing "Damaged" for a returned case still puts it back into saleable stock
Category: business-logic | Priority: P1 | Role: Delivery | Platform: Web (server-side, so every platform)

```
User: Delivery (ganesh.more)
Platform: Web 1280×800 (the request body and the ledger row are the same from the phone)
Environment: local dev, dos_qa realistic seed
Steps:
  1. Stop 5 Joshi Kirana Stores → I am at the shop → Deliver this bill (INV/0826).
  2. Campa Cola 750 ml, on the bill 75 pc: press "−" once → "2 cs + 3 pc = 51 pc · Taken back · 24 pc". Two rows of chips appear
     under the line: [Can be sold again | Damaged — into the damaged bin] and [Shop refused it | Damaged | Past its date].
  3. Tap "Damaged" in the second row (the reason). Photo, "Bill signed by", Record the delivery.
Expected: a case the driver has just called damaged goes to the damaged bin (or at least the app asks), and the credit note says
          damaged.
Actual: the request carried {returnedQtyPcs: 24, returnedSaleable: TRUE, reason: "damaged"}; the server issued CN/9003 with
          reason `return_saleable` and wrote stock_ledger `sale_return_saleable` +24 pc into location "Vehicle MH-05-AB-1234"
          (db-05-after-partial-delivery.txt). The damaged case is now sellable stock on the van, and will be counted back into
          the godown as good stock at check-in. The default of the first chip row is "Can be sold again" and the reason row does
          not change it; a driver reads "Damaged" as one decision, not two.
Business impact: damaged goods re-enter saleable inventory with a ₹768 credit note that says "saleable return"; the damaged bin,
          the claim to the company and the stock-value register are all wrong by that case, every time a driver taps the obvious
          chip.
Severity: P1
Evidence: d-31-return-line-controls.png (the two chip rows), d-24-deliver-stop5-partial-filled.png, api-04-partial-delivery-stop5.txt
          (request body with returnedSaleable:true, reason:"damaged"), db-05-after-partial-delivery.txt (CN reason, ledger row, location).
Suggested fix: one control, not two: "Why is it coming back?" → Shop refused it (saleable) / Damaged (damaged bin) / Past its date
          (damaged bin); if the two must stay separate, selecting "Damaged" or "Past its date" must flip the disposition to the damaged
          bin and the server must refuse returnedSaleable:true with reason damaged|expired.
```

### DOS-059 — Receipt numbers are issued twice: RCPT-0696 … RCPT-0699 each exist twice, and nothing stops it
Category: business-logic | Priority: P1 | Role: Delivery (and every money collector) | Platform: Web (server-side)

```
User: Delivery (ganesh.more), plus the manager and accountant walks earlier today
Platform: Web (server-side numbering)
Environment: local dev, dos_qa realistic seed
Steps:
  1. Stop 4 → Take money → Cash ₹7,856, book number GM-1042 → Record the payment. Response: receiptNo "RCPT-0698".
  2. Android stop 7 → UPI ₹4,756 with UTR → Record. Response: "RCPT-0699".
  3. SELECT receipt_no, count(*) … HAVING count(*) > 1 for tenant tarsun.
Expected: every receipt number is unique in the series for the FY; the database refuses a second RCPT-0698 the way it refuses a
          second INV/0826 (invoices_no_idx) or CN (credit_notes_no_idx).
Actual: RCPT-0696, 0697, 0698 and 0699 each exist twice: the seeded receipts of those numbers (received 12:50, 4 Sep…) and the four
          receipts recorded through the apps today (manager 14:17, accountant 14:27, Ganesh 16:05 and 16:29). The RCPT series row
          stood at next_no 696 while receipts up to RCPT-0699 already existed (seed did not advance the counter — fixture cause),
          and the `receipts` table has NO unique index on (tenant_id, series_code/fy, receipt_no): only on id, idempotency key and
          (device_id, client_receipt_no). The product accepted the collision four times without a word.
Business impact: a receipt is the shop's legal proof of payment. Two shops now hold RCPT-0698 for different amounts (₹98,992 and
          ₹7,856); a statement, an audit or a bounced-cheque dispute cannot tell them apart. Any restore from backup, any re-seeded
          counter, any two-instance race reproduces it in production because the database does not defend the number.
Severity: P1
Evidence: db-04-duplicate-receipt-no.txt (the six rows, the series table, the index list), api-02-record-cash-collection.txt,
          db-09-android-upi-receipt.txt.
Suggested fix: add the unique index the invoices already have (`receipts (tenant_id, series_code, fy, receipt_no) WHERE receipt_no IS NOT NULL`)
          and make nextDocumentNumber fail loudly on conflict; the seed must set next_no past the last seeded number (QA will fix the
          seed once product approves the index — the two belong together).
```

### DOS-060 — The phone's amount keypad counts paise: typing 4-7-5-6 records ₹47.56
Category: ux | Priority: P1 | Role: Delivery | Platform: Android (native keypad; web takes rupees)

```
User: Delivery (ganesh.more)
Platform: Android (Pixel 7 emulator, API 36)
Environment: local dev, dos_qa realistic seed
Steps:
  1. Stop 7 Nakshatra Kirana → Take money → UPI → tap "Amount taken" → a full-screen keypad opens (₹0.00, digits, Clear, ⌫, Done).
  2. Tap 4, 7, 5, 6 for the ₹4,756 bill → the display reads ₹47.56 (a-18-keypad-4756.png). Done → the field shows ₹47.56.
  3. On web the same collect screen takes "7856" in a text input and records ₹7,856.00 (api-02).
Expected: the natural gesture for a ₹4,756 cash/UPI collection — typing 4756 — records ₹4,756.00; the two platforms agree.
Actual: the phone keypad shifts digits in from the right as paise, so ₹4,756 needs "475600"; nothing tells the driver, and the
          keypad title sits under the status bar clock ("Amount taken" and "4:23" overlap, DOS-069). With "Record the payment"
          one tap away, a driver in a hurry books ₹47.56 against a ₹4,756 bill and the shop's dues stay ₹4,708 too high.
Business impact: wrong receipts at the door on the platform the crew will actually use; every one is a dispute with the shop and a
          reversal for the accountant.
Severity: P1
Evidence: android/a-17-collect-upi-amount.png (keypad open), a-18-keypad-4756.png (₹47.56), a-20-upi-filled.png (after Clear + 475600),
          api-02-record-cash-collection.txt (web: 7856 → 785600 paise).
Suggested fix: the keypad should enter whole rupees by default (paise only after an explicit "." key — receipts at the door are whole
          rupees in practice); at minimum show the interpretation live in words ("forty-seven rupees fifty-six paise") and match web.
```

### DOS-061 — "Today's trip" is the wrong trip; today's real trip is a dead end from the home and unreachable offline
Category: bug | Priority: P1 | Role: Delivery | Platform: Web + Android + iOS

```
User: Delivery (ganesh.more)
Platform: Web 1280×800 and 390×844, Android, iOS (Expo Go)
Environment: local dev, dos_qa realistic seed (TRIP-NEXT was put `active` by the warehouse walk, DOS-043)
Steps:
  1. Sign in. Home (D1) shows "TRIP-NEXT · 14 Sep 2026 — Today's trip — On the road — 0 of 5 stops done", "Load on board: 12 Sep 2026,
     38 cartons on board, Draft", and at the bottom "Your other trips: TRIP-ACTIVE · Planned for 12 Sep 2026 · On the road".
     Same on the phone width, on Android and on iOS (d-01, p-01, android/a-02, ios-…-2-home.png).
  2. Tap TRIP-ACTIVE there → /trip/start?tripId=… "Start the trip — Trip is On the road", odometer + cash form, and a disabled
     "Start the trip" with the reason "The godown has to load the vehicle before it can leave" — although DC-0081 for this trip is
     confirmed and 3 of its 10 stops are delivered (d-02). No way forward from that screen.
  3. The only route to today's stops is ⋯ → Trip history → TRIP-ACTIVE → the End-of-day screen → tap a stop (d-03, d-04). Trip
     history needs the network: with the API unreachable it shows "Something could not be completed. Try again. · unknown"
     (android/a-39-history-offline.png), so offline the driver cannot reach his real trip at all.
  4. Expenses (D7) is bound to the same wrong trip: the ₹500 diesel recorded at 4:15 pm today went onto TRIP-NEXT (tripId 72649337…,
     dated 14 Sep) — api-07-expense.txt.
Expected: "Today's trip" is the trip dated today that the driver is on (TRIP-ACTIVE, 3 of 10 done); a trip that is "On the road"
          never lands on the Start screen; a draft load sheet is not "38 cartons on board"; expenses go on the trip being driven;
          the driver's own trips are on the phone when the signal is not.
Actual: the app picks the later-dated active trip, calls a draft sheet "on board", sends the driver to a Start screen that refuses
          him, and puts today's diesel on a trip two days ahead. Two active trips for one driver is exactly what DOS-043 makes
          possible with one tap, so the pilot will hit this.
Business impact: the driver's home, cash summary, expenses and the office's view of the day all point at the wrong trip; the check-in
          of the real trip (₹12,856 to hand over) is two menus away and invisible offline.
Severity: P1
Evidence: d-01-home.png/.txt, p-01-home.png, d-02-trip-active.png/.txt, d-03-trips.png, d-04-trip-active-from-history.png, d-12-home-after.png,
          d-35-expenses.png, api-07-expense.txt, android/a-02-home.png, a-32-after-kill-relaunch.png, a-39-history-offline.png,
          ios-delivery-ganesh.more-2-home.png.
Suggested fix: pick the trip by (trip_date = today, state active) first, then the earliest active; show a trip switcher when the driver
          has more than one; route an active trip to its stops, never to Start; label a draft sheet as draft; keep the driver's
          trips of the last N days in the offline tables (docs/23 §5.4 lists D1/D3 as offline screens — D11 needs the same).
```

### DOS-062 — Money taken "for this bill" is booked against June's bill, the screen never says so, and then shows the bill still owed
Category: ux | Priority: P2 | Role: Delivery | Platform: Web + Android

```
User: Delivery (ganesh.more)
Platform: Web 1280×800 and Android
Environment: local dev, dos_qa realistic seed
Steps:
  1. Stop 4 Vaibhav Kirana Mart (owes ₹75,228 on 7 bills) → Take money → the screen lists "Bills on this stop: INV/0825 ₹7,856" as a
     tappable row, "Owed on the bills here ₹7,856". Cash ₹7,856, book GM-1042, Record.
  2. Response: RCPT-0698 allocated ₹7,856 — to INV/0099 of 26 June (db-03). INV/0825 stays `issued`. The app returns to the stop
     with "Owes ₹75,228" (stale, DOS-063) and no receipt number anywhere.
  3. Android stop 7: UPI ₹4,756 "for INV/0829" → allocated to INV/0404 (July, paid) and INV/0473 (Aug). Back on Take money the
     screen says "Settled 1 bill" AND still lists INV/0829 with "Owed on the bills here ₹4,756.00" (a-22); Send the papers shows
     INV/0829 as "Issued".
Expected: oldest-bill-first is the founder's rule (docs/22 line 175: "allocated bill-to-bill oldest first unless tagged"), so the money
          may go to June — but the driver and the shop must be told ("this pays INV/0099 of 26 Jun; today's bill stays open"), the
          "unless tagged" path must exist at the door, and a bill that has been paid must not be offered again as owed.
Actual: the screen implies this bill is being paid, offers no way to tag, and afterwards keeps offering the same bill as owed —
          a second tap of "Record the payment" would take the money again (it would land FIFO on other bills, so the shop would be
          double-charged in practice).
Business impact: shop disputes ("I paid INV/0829 by UPI, your ledger says unpaid") and double collections at the door.
Severity: P2 (the accountant can re-allocate; the door cannot)
Evidence: d-13-collect-vaibhav.png, d-16-collect-cash-filled.png, d-17-after-collect.png, api-02-record-cash-collection.txt,
          db-03-after-cash-collection.txt, android/a-22-collect-after-paid-still-owed.png, db-09-android-upi-receipt.txt.
Suggested fix: after Record show the receipt number and "applied to: INV/0099 ₹7,856 (26 Jun) — INV/0825 still open"; make the bill
          row a real selector that sends an explicit allocation (`strategy: explicit`) when the driver tags it; compute "Owed on the
          bills here" from the invoice's open balance, not its total.
```

### DOS-063 — The stop screen does not refresh after recording a delivery or a payment
Category: bug | Priority: P2 | Role: Delivery | Platform: Web + Android

```
User: Delivery (ganesh.more)
Platform: Web 1280×800 and Android
Environment: local dev, dos_qa realistic seed
Steps:
  1. Web stop 4 → Deliver → Record. The app navigates back to the stop: "At the shop · INV/0825 · Not started · Deliver this bill"
     while the server has stop delivered (api-01, d-10). Reload: "Delivered · This stop is finished" (d-11).
  2. Web stop 4 → Take money → Record ₹7,856. Back on the stop: "Owes ₹75,228.00 · Still due ₹75,228.00" (d-17). Reload: ₹67,372.
  3. Android stop 7 after the UPI receipt: "Owes ₹25,825.00" until the screen is left and re-entered (then ₹21,069).
Expected: the screen the driver lands on after a write shows the write.
Actual: stale until reload/re-entry; a driver who trusts the screen re-delivers or re-collects (see DOS-062).
Business impact: double entries and confusion at the door.
Severity: P2
Evidence: d-10-after-record.png/.txt, d-11-stop4-after-reload.png, d-17-after-collect.png, android/a-21-after-upi-record.png.
Suggested fix: invalidate the stop / trip / outstanding queries on mutation success (the api-client cache hooks), or navigate with
          the mutation result in hand.
```

### DOS-064 — Quantities move by whole cases only; a line under one case can only go to zero; "Not ordered" appears on a bill line
Category: ux | Priority: P2 | Role: Delivery | Platform: Web + Android

```
User: Delivery (ganesh.more)
Platform: Web 1280×800 and Android
Environment: local dev, dos_qa realistic seed
Steps:
  1. Deliver INV/0825 (Vaibhav): Campa Lemon 750 ml on the bill 75 pc (3 cs + 3 pc). "−" → 51 pc, "−" → 27 pc. There is no way to
     drop 70 of 75 (a shop refusing five loose bottles is the common case).
  2. Deliver INV/0826 (Joshi): Godavari Cow Ghee 200 ml, 5 pc = "0 cs + 5 pc". "−" → 0 with the label "Not ordered" (d-23); the line
     was on the bill. Same on INV/0827 Masti Oye 34 pc (d-31) and on Android (a-09: Campa Cola 1 L 11 pc → 0 cs).
Expected: the driver can take back any number of pieces (case stepper + a pieces stepper or a keypad, as the warehouse pack screen
          has); a line taken back in full reads "Nothing dropped", not "Not ordered".
Actual: case-only steps; sub-case lines are all-or-nothing; wrong label.
Business impact: partial deliveries are recorded wrong (a full case taken back when only three bottles were), credit notes and stock
          follow.
Severity: P2
Evidence: d-07-deliver-after-minus-minus-plus.png, d-23-deliver-stop5-ghee-minus.png, d-31-return-line-controls.png, android/a-09-stop7-deliver.png.
Suggested fix: keypad per line (pieces) with the case conversion shown, as the warehouse app does; rename the zero label.
```

### DOS-065 — The driver's inbox and the "Send the papers" screen list every shop's messages and every old receipt
Category: ux | Priority: P2 | Role: Delivery | Platform: Web + Android

```
User: Delivery (ganesh.more)
Platform: Web 1280×800 (same data on Android)
Environment: local dev, dos_qa realistic seed
Steps:
  1. Me (D12) → "Inbox": "Order SO-0459 of ₹8,044.00 confirmed. Delivery on the next beat day. M/s. Tarsun Enterprise · sms",
     "Received ₹3,728.00, receipt RCPT-0024. Thank you." … 20 rows of messages the office sent to SHOPS since June (d-39-me.txt).
  2. Stop 5 → bill row → Send the papers: after the invoice and CN, "Receipt" lists RCPT-0626 … RCPT-0123 — ten receipts back to
     July — then "What the office already sent": 12+ order confirmations, a cancellation, "Goods against bill E370AE95 delivered
     today" (d-27-bill-tap.txt).
Expected: the driver's inbox holds what is addressed to the driver; the door screen shows today's papers for this stop (bill, CN,
          today's receipt) with history behind a fold.
Actual: the crew reads the whole tenant's outbound messaging and every shop's receipt history on a one-hand screen.
Business impact: noise at the door and a privacy question — a driver sees every shop's payment history and every order message.
Severity: P2
Evidence: d-39-me.png/.txt, d-27-bill-tap.png/.txt, d-29-share-after-render.png.
Suggested fix: scope notifications.messages.list to recipient = self for the inbox; on D9 show this trip's receipt(s) and this bill
          only, with "older papers" collapsed.
```

### DOS-066 — Nothing at the door says the shop is overdue: ₹52,176 of Vaibhav's ₹75,228 is past due, the oldest bill from June
Category: missing-feature | Priority: P2 | Role: Delivery | Platform: Web + Android

```
User: Delivery (ganesh.more)
Platform: Web 1280×800 and Android
Environment: local dev, dos_qa realistic seed
Steps:
  1. Stop 4 Vaibhav Kirana Mart: chip "Owes ₹75,228.00", "Still due ₹75,228.00", "7 bills still open at this shop". DB: overdue
     ₹52,176, bucket 61–90 days ₹14,720 (INV/0099, 26 June, due 10 July), oldest_due_date 2026-07-10 (db-01, db-02).
  2. Stop 5 Joshi: "Owes ₹1,21,522", stop 8 Laxmi Narayan: "Owes ₹1,37,886" — no ageing, no "credit mode: stop" behaviour visible
     (stop 9 Khan is credit_mode `stop` in the DB and looks exactly like the others).
Expected: the person holding the goods knows before handing them over that the shop is 78 days late on ₹14,720, and what the
          distributor's rule for a `stop` shop is (the summary table already carries the buckets and the oldest due date).
Actual: one total, no age, no overdue amount, no difference between an `indicate` and a `stop` shop.
Business impact: the crew keeps extending credit to shops the office would have stopped.
Severity: P2
Evidence: d-05-stop4-vaibhav.png, db-01-vaibhav-outstanding.txt, db-02-after-record-delivery.txt (retailer_outstanding_summary row),
          d-19-stop5-joshi-pending.png, api-09-permission-probes.txt (outstanding endpoint returns overduePaise).
Suggested fix: show "Overdue ₹52,176 · oldest 26 Jun" under the chip, colour `stop` shops, and gate "Deliver this bill" on the
          credit mode the way the sales app gates ordering.
```

### DOS-067 — Trip history says "Delivered on the first attempt 0%" for a driver with 104 of 125 stops delivered; today's trip is missing from the list
Category: bug | Priority: P2 | Role: Delivery | Platform: Web + Android

```
User: Delivery (ganesh.more)
Platform: Web 1280×800 and Android
Environment: local dev, dos_qa realistic seed
Steps:
  1. Trip history (D11): "Last 30 days — STOPS 125 · DELIVERED 104 · NOT DELIVERED 8 · DELIVERED ON THE FIRST ATTEMPT 0%" (d-03);
     Android after the walk: 125 / 105 / 9 / 0% (a-04-trips.png).
  2. The list starts at TRIP-ACTIVE (12 Sep); TRIP-NEXT — the trip the home calls "Today's trip" — is not in it.
Expected: a first-attempt rate consistent with 104 delivered of 125; every trip of the driver in the window, including the one on
          the home.
Actual: 0% (the KPI is either computed from a field the seed never sets or divided wrongly); the trip list and the home disagree
          about what exists.
Business impact: the one performance number the crew sees is wrong; the incentive screen on Me would be built on it.
Severity: P2
Evidence: d-03-trips.png/.txt, android/a-04-trips.png.
Suggested fix: define first-attempt = delivered stops whose stop was never `failed` before / all completed stops, and test it on the
          seed; list every trip with trip_date in the window regardless of date > today.
```

### DOS-068 — On the phone the app never says it is offline; reads fail with "unknown"
Category: ux | Priority: P2 | Role: Delivery | Platform: Android

```
User: Delivery (ganesh.more)
Platform: Android (Pixel 7 emulator)
Environment: local dev, dos_qa realistic seed
Steps:
  1. Wi-Fi and mobile data off, then airplane mode (ping 10.0.2.2 "Network is unreachable"): the strip keeps "Updated just now" with
     a green dot for the whole time (a-34, 12 s later still the same).
  2. API path cut and app relaunched: home "Updated 1 min ago" + "Still filling this phone from the office — this may not be the
     whole trip yet." — good; but Trip history: "Something could not be completed. Try again. · unknown · Try again" (a-39),
     and after a write the strip shows only "1 waiting to send" — never "Offline since …" as web does (d-41: "Offline since 4:55 pm").
Expected: the strip says offline on the phone the way it does in the browser; a failed read says "No signal — showing what this
          phone has" rather than "unknown".
Actual: the phone looks online while nothing is reaching the office.
Business impact: the driver keeps tapping and trusting numbers that are not being refreshed (see DOS-056 for what that costs).
Severity: P2
Evidence: android/a-34-stop10-arrived-offline.png, a-38-relaunch-api-unreachable.png, a-39-history-offline.png, a-42-offline-record.png,
          d-41-stop9-offline.png.
Suggested fix: drive the strip from the last failed/successful request on native too (NetInfo alone is not enough — the API can be
          unreachable with the radio up); map network errors to one plain sentence.
```

### DOS-069 — The amount keypad sheet draws under the status bar on Android
Category: ux | Priority: P3 | Role: Delivery | Platform: Android

```
Steps: Take money → tap Amount taken. The sheet's title "Amount taken" is painted under the clock ("4:23" and the title overlap).
Expected: safe-area inset on the sheet.
Evidence: android/a-17-collect-upi-amount.png, a-18-keypad-4756.png.
Severity: P3
```

### DOS-070 — "Where you were is attached as proof" while the browser has no location: the geo proof is the stop's arrival point
Category: ux | Priority: P3 | Role: Delivery | Platform: Web (+ phones when location is refused)

```
Steps: web home says "Location is off — this phone is not sharing location". Deliver INV/0825 → record. pod_evidence has a `geo` row
       19.231291 / 73.142109 = trip_stops.arrived_lat/lng (the seeded 10:40 am arrival), not anything the browser measured (db-02).
Expected: the proof says what it is ("arrival position, 10:40 am") or is absent when the device gave nothing.
Actual: a "where you were" claim the phone never made.
Severity: P3
Evidence: d-01-home.txt (Location is off), api-01-record-delivery.txt (podKinds photo, geo), db-02-after-record-delivery.txt.
```

### DOS-071 — Small door-screen defects: expense needs no proof, stale "photo required" text after the photo, inert Record button
Category: ux | Priority: P3 | Role: Delivery | Platform: Web + Android

```
1. Expenses: ₹500 diesel recorded with no photo (proofObjectKey null) — "Photograph the bill" is optional with no policy behind it
   (api-07-expense.txt, d-36-expense-no-photo.png).
2. Deliver: after "Photo attached" the footer still says "This shop is on credit — a photo is required before you can record it"
   (d-09-after-photo.png/.txt, a-13-after-photo.png).
3. "Record the delivery" looks enabled without a photo; tapping it does nothing but repeat the sentence (d-08-record-no-photo.png).
4. After a delivery the stop keeps a "Take money" button on a failed stop (fine) but the finished stop's "Back to the trip" goes to the
   home = the wrong trip (DOS-061).
Severity: P3
```

### DOS-072 — The crew receives the shop's credit limit and credit days
Category: security | Priority: P3 | Role: Delivery | Platform: API

```
Steps: GET /retailers/{id} with the delivery token → creditLimitPaise 18000000, creditLimitBills, creditDays 14, tier, code, GSTIN, alt
       phone (api-09-permission-probes.txt). docs/23 §5.3 already flags it ("the crew needs creditMode and dues, not the limit").
Expected: field-level narrowing for FIELD roles.
Severity: P3 (no screen shows it today)
```

---

## What worked (so the fixes do not break it)

- Arrive / fail / deliver / collect / expense all reach the server online and write what they claim: stop states, deliveries with
  lines, POD photo (a real 1392×1856 JPEG in `backend/.storage`, a-13b) + geo, orders delivered / partially_delivered / packed
  (failed stop returns the order to `packed`, invoice stays issued, goods stay on the van — db-07), the credit note at the invoice
  line's rate with GST + cess (db-05), FIFO receipts with allocations, `retailer_outstanding_summary` updated in the same second,
  outbox events for each (OrderDelivered, DeliveryRecorded, CreditNoteIssued, ReceiptRecorded, CollectionRecorded, StopFailed,
  OrderReturnedUndelivered, InvoicePaid). No stock ledger row on a plain delivery (the sale was booked at pack), one `sale_return_saleable`
  row on the return — consistent with the DOS-039 discussion.
- The day summary reconciles: float ₹5,000 + cash ₹7,856 − spent ₹0 = "Hand ₹12,856 to the cashier"; UPI and cheque tallied apart.
- Validation at the door: UPI needs its UTR, cheque needs number/date/bank, credit shops need a photo, "Nothing delivered" needs a reason.
- The offline layer is honest on web ("Offline since 4:55 pm · 1 waiting to send"), the queued arrival synced with its offline
  timestamp on both platforms, and the tray keeps the refusal durable.
- Permission fence: outstanding list, staff, settle, cancel, trace, vehicle positions → 403 with a plain sentence; another driver's
  trip → 404; the trip list holds only Ganesh's 32 trips (api-09).
- Android: sign-in, camera capture through the system camera, backgrounding (state kept) and kill + relaunch (signed in, home).
- iOS (Expo Go): sign-in and home render the same data (ios-…-2-home.png, ios-02-home-after-fill.png).

## Also true here (already filed)

- DOS-039 (load-out refused) and DOS-043 (a trip can start without a load) shaped this walk: TRIP-NEXT is "on the road" with a draft
  sheet, which is what DOS-061 trips over.
- DOS-029 (mutations fail without a visible reason) — the Android "Record the delivery" offline (DOS-056) is the delivery app's copy.
- DOS-046 (retry replays the same rejection) — "Send it again" in the delivery tray (DOS-056) is the same behaviour, here it sends nothing at all.
- The dev-build LogBox toast covers the primary button after an uncaught error (environment, not product) — noted in ENV.md.
