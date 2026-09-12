# Findings — Phase 1, Retailer walkthrough (ramesh.gupta, retailer app :5178, retailer-service :3006)

Environment: local dev, database `dos_qa` (realistic seed 2026-09-12), all eight services + worker via `QA/tools/start-services.sh`,
web through `QA/tools/pw-server.mjs` + `pw.mjs` (headless Chromium 145, 1280×800 desk and 390×844 phone), Android debug APK on the
Pixel 7 emulator (API 36, API over `adb reverse`), iOS via Expo Go on the iPhone 16 Pro simulator (Appium) for sign-in and home.
Evidence root: `QA/evidence/phase1/retailer/` (`r-NN` = desk web PNG + innerText `.txt`, `p-NN` = phone width, `net-*` = every API
response of one page load, `api-NN-*` = direct API calls, `db-NN-*` = SQL and output, `android/a-NN` = device screenshots,
`ios/retailer-ramesh.gupta-*.png` = simulator).

Walked on Saturday 12 Sep 2026 as Ramesh Gupta, who signs in for Shree Ganesh Kirana (R-0001, Station Road, Kalyan West; tier C,
₹50,000 strict credit limit, 7 days) and is linked to the same shop at all three distributors (Tarsun, Sai, Kalyan). Orders placed
during the walk: SO-0885 (web, 3 lines, ₹5,855, submitted, credit hold pending for the office), SO-0886 (web "Order again", cancelled
by me with a reason). Two payment intents were created against the shop (PAY-13c1dede2871 from the app, PAY-000000000001/2 from the
API; nothing was paid). The shop's profile now carries an alt phone `+919892000099` and a landmark "Opp. Kalyan station, QA edit".
The password was changed to `Dos@12345` and back to `Dos@1234`; that change signed the Android session out (expected).

Findings the earlier walks already filed and which are also true here are listed at the end.

---

### DOS-094 — "Pay everything" hands the shop a UPI payment for ₹5,472 (one bill) instead of ₹35,843, under a reference the office cannot match
Category: business-logic | Priority: P0 | Role: Retailer | Platform: Web + Android (the API is the same for all)

```
User: Retailer (ramesh.gupta, Shree Ganesh Kirana)
Platform: Web desk 1280×800; confirmed at the API with the shop's own token
Environment: local dev, dos_qa
Steps:
  1. Money due → "Pay everything" (or any bill → "Pay this bill") → the Pay screen shows "How much are you paying ₹35,843.00"
     and lists the six open bills.
  2. "Start the payment". The screen says "Paying M/s. Tarsun Enterprise ₹35,843.00", shows the button "Open a UPI app", the
     raw string below it, and "Quote this reference: PAY-13c1dede2871".
  3. Read the string: upi://pay?pa=tarsun@okhdfcbank&pn=M%2Fs.%20Tarsun%20Enterprise&am=5472.00&tr=INV-0753&cu=INR
  4. API: POST /receivables/payments/initiate {amountPaise: 3584300} → upiQrPayload am=5472.00 tr=INV-0753;
     upiIntentUrl = "upi://pay?upi://pay?pa=…" (the scheme is prefixed twice).
  5. API: initiate for ONE bill, INV/0433, amountPaise 456100 (₹4,561 left of ₹10,119) → am=10119.00 tr=INV-0433.
  6. Android, Pixel 7: Money due → "Pay everything" → "Start the payment" → PAY-9520ecba4571 with the same am=5472.00
     tr=INV-0753 string (android/a-09-payment-started.png). "Open a UPI app" fires an intent for `upi://pay/...` which the
     emulator cannot handle (ActivityTaskManager result code=-91, a-10-logcat-open-upi.txt) and the app shows NO message —
     a shop with no UPI app installed sees nothing happen.
Expected: the UPI intent carries the amount the shop chose (₹35,843.00 / ₹4,561.00) and the intent's own reference
        (PAY-…), so the office can match the money to the intent.
Actual: the intent carries the ORIGINAL TOTAL of one invoice (the last one in the list, or the chosen bill's full total —
        not what is left of it) with the invoice number as reference; the intent URL is malformed and no UPI app will open it.
Business impact: a shop tapping "Open a UPI app" pays ₹5,472 when it meant ₹35,843, or ₹10,119 on a bill that has ₹4,561
        left (an overpayment of ₹5,558); the payment arrives with "INV-0433" while the office was told to look for "PAY-…".
        Wrong amount, wrong reference, and on a real phone the malformed URL opens nothing at all.
Severity: P0
Evidence: QA/evidence/phase1/retailer/r-14-start-payment.png, api-01-payments-initiate.txt, net-bill-0753/
Suggested fix: payments.initiate must build its own UPI string from the intent (am = intent amount, tr = paymentRef, tn = bill
        list) instead of copying the invoice's stored upi_qr_payload; fix the double "upi://pay?" prefix; render a QR image
        on web (the desk shows the raw string as text — a shopkeeper on a laptop has nothing to scan).
```

### DOS-095 — The statement stops after 50 entries: the last four payments are missing and the running balance jumps from ₹63,535 to a closing ₹35,843
Category: bug | Priority: P1 | Role: Retailer | Platform: Web (API pages; the app never asks for page 2)

```
User: Retailer (ramesh.gupta)
Platform: Web desk 1280×800, default filter "Last 90 days"
Environment: local dev, dos_qa
Steps:
  1. Money → Statement. Count the entries: 50 (25 bills + 21 receipts + 4 credit notes).
  2. The last entry is RCPT-0659 (10 Sep, balance ₹63,535.00). Directly below: "Closing balance ₹35,843.00".
  3. Receipts screen lists RCPT-0668 (₹12,180 UPI, 10 Sep), RCPT-0672 (₹5,558), RCPT-0687 (₹4,443), RCPT-0693 (₹5,511) —
     none of them is on the statement. 63,535 − 12,180 − 5,558 − 4,443 − 5,511 = 35,843.
  4. API: GET /receivables/ledger/<retailer>?from=2026-06-15&to=2026-09-12 → items: 50, nextCursor: "MjAyNi0wOS0xMAAz…".
     The screen has no "more" control and never sends the cursor.
Expected: every entry of the period, running balance ending at the closing balance.
Actual: 50 entries, a ₹27,692 gap between the last running balance and the closing line.
Business impact: the one document a shopkeeper uses to check the distributor's arithmetic hides his four latest payments;
        he will conclude the distributor "lost" ₹27,692 of his money. Any shop with more than 50 entries in 90 days is affected.
Severity: P1
Evidence: QA/evidence/phase1/retailer/r-02-statement.png, r-02-statement.txt, net-statement/11-GET-…receivables_ledger….json
Suggested fix: follow nextCursor until exhausted (or "Show more"), and never print the closing line while a cursor is pending.
```

### DOS-096 — The order screen prices everything before GST: "You pay ₹5,237.68" became an order of ₹5,855.00 the moment it was placed
Category: business-logic | Priority: P1 | Role: Retailer | Platform: Web + Android

```
User: Retailer (ramesh.gupta)
Platform: Web desk 1280×800 (same rows and totals on the Pixel 7)
Environment: local dev, dos_qa
Steps:
  1. Place order → add Sunbake Bourbon Cream 60 g ×2 cs, Godavari Cow Ghee 200 ml ×1 cs, Godavari UHT Milk 500 ml ×1 cs.
  2. Footer: "Before offers ₹5,474.88 · Offers −₹237.20 · You pay ₹5,237.68". Lines: ₹1,404.25, ₹3,035.67, ₹797.76.
  3. "Place order" → order SO-0885 → detail screen: lines ₹1,657.02, ₹3,399.95, ₹797.76 and "You pay ₹5,855.00".
  4. DB: sales_orders SO-0885 subtotal 5,474.88, discount 237.20, tax 617.05, total 5,855.00 (db-03-so-0885.txt).
  5. Android, Pixel 7: 1 cs Bourbon → "You pay ₹723.84" → placed as SO-0887 "You pay ₹854.00" (android/a-15-order-plus.png,
     a-16-order-placed.png); cancelled afterwards.
Expected: the number the shop agrees to is the number on the bill; if rates are shown ex-GST the screen says so and shows the
        tax line before "Place order".
Actual: no tax anywhere on the order screen; the placed order is 11.8 % more than promised. The detail screen then prints
        "192 pc · ₹7.54" next to ₹1,657.02 — 192 × 7.54 is ₹1,447.68, so the shop's own arithmetic also fails.
Business impact: every retailer order looks cheaper than it is; the shopkeeper compares "₹7.54 per piece" with MRP ₹10 and
        thinks his margin is 25 % when it is 11 %. This is the buyer, not a rep — the same defect as DOS-083 but the person
        misled is the customer.
Severity: P1
Evidence: QA/evidence/phase1/retailer/r-07-order-uht-1cs.png, r-08-after-place-order.png, db-03-so-0885.txt, db-04-so-0885-lines.txt
Suggested fix: pricing.quote already returns per-line GST; show "GST ₹617.05" and a GST-inclusive "You pay" on the order screen
        and per-piece landed rates (or label the rate "+ GST").
```

### DOS-097 — "Stock not known" for 14 of 171 products because the stock hint reads only the first 500 lot rows
Category: bug | Priority: P1 | Role: Retailer | Platform: Web + Android (retailer instance of DOS-074)

```
User: Retailer (ramesh.gupta)
Platform: Web desk 1280×800
Environment: local dev, dos_qa
Steps:
  1. Place order. Godavari Cheese Slices 200 g and Godavari Dairy Whitener 500 g read "Stock not known".
  2. Network: GET /inventory/sellable?limit=500 → 500 rows, nextCursor set, 157 distinct variants (net-order/12-…sellable….json).
  3. DB: 793 sellable lot rows across 166 variants; Cheese Slices 7 pc on hand, Dairy Whitener 200 g 360 pc on hand,
     reserved 0 (db-02-stock-not-known.txt).
Expected: "In stock" / "Only N pc left" for every listed product.
Actual: whichever variants fall after row 500 are "not known"; the same truncated page feeds "Only 9 pc left" hints, which are
        therefore also unreliable for those items.
Business impact: the shop will not order a product whose stock is "not known"; the distributor loses the sale on ~8 % of the
        catalogue for no reason, and the number grows with every GRN (more lots = more rows).
Severity: P1
Evidence: QA/evidence/phase1/retailer/r-03-order.txt, net-order/12-GET-…inventory_sellable_limit_500.json, db-02-stock-not-known.txt
Suggested fix: an aggregated per-variant ATP endpoint (variantId → available) for the price list, not per-lot rows; paginate to the
        end until then.
```

### DOS-098 — "Order again" repeats a random old order (a rep's order from 30 July), not the shop's last one, and creates a server draft on every tap
Category: business-logic | Priority: P1 | Role: Retailer | Platform: Web (orders.repeatLast — same on Android)

```
User: Retailer (ramesh.gupta)
Platform: Web desk 1280×800
Environment: local dev, dos_qa
Steps:
  1. Home shows "Your last orders": SO-0873 (12 Sep, 4 lines), then SO-0844… Tap "Order again" ("The same items as your last
     order, at today's prices").
  2. POST /orders/repeat-last → a draft with ONE line: Godavari Table Butter 500 g, 40 pc (2 cs), "Only 15 pc left".
  3. DB: the only earlier order of this shop with Table Butter ×40 is SO-0450, 30 Jul 2026, placed by the salesperson
     (db-05-repeat-last.txt). The shop's real last orders are SO-0885 (3 lines) and SO-0873 (4 lines).
  4. GET /orders?limit=3 with the shop's token also returns SO-0450 first: the "last" order is the first row of an
     unsorted list.
  5. The draft row exists in sales_orders the moment "Order again" is tapped (state draft, no order_no), before the shop
     has confirmed anything; leaving the screen orphans it.
Expected: the basket of the shop's most recent order (by date), built client-side until "Place order".
Actual: a six-week-old basket of a different author; the wanted item was short-supplied (0 cs available) on top.
Business impact: the headline "two-tap reorder" of the retailer app sends the wrong goods; the shop notices only when the
        bill arrives. Every tap leaves a draft row behind (the smoke pollution the sales walk saw, now from real users).
Severity: P1
Evidence: QA/evidence/phase1/retailer/r-16-order-again.png, r-17-repeat-placed.png, db-05-repeat-last.txt
Suggested fix: repeatLast must ORDER BY created_at DESC (and skip cancelled orders); build the draft on the device.
```

### DOS-099 — The bill PDF cannot be opened on any platform: the API returns a relative `/storage/…` URL
Category: bug | Priority: P1 | Role: Retailer | Platform: Web + Android

```
User: Retailer (ramesh.gupta)
Platform: Web desk 1280×800; Android Pixel 7 emulator (API 36)
Environment: local dev, dos_qa
Steps:
  1. My bills → INV/0753. First open: "Tarsun Enterprise is still making the PDF of this bill. Try again in a minute."
     (5 of the shop's 6 open bills had no PDF; the worker rendered it on request within ~30 s.)
  2. Re-open → buttons "Open the bill" and "Print".
  3. API: GET /invoices/<id>/pdf → {"status":"ready","url":"/storage/tenant/…/invoice/<id>.pdf?expires=…&signature=…"}
     (net-bill-0753/05-…pdf….json). The same signed path fetched on :3006 is a real PDF (inv-0753.pdf, 21 KB, %PDF-1.4).
  4. Web "Open the bill": a new tab at http://localhost:5178/storage/tenant/… — the app's own web server, which answers the
     app's HTML (200 text/html, blank page). "Print": fetches the same wrong origin, window.print never fires, nothing happens.
  5. Android "Open the bill": red LogBox "Call to function 'FileSystem.downloadFileAsync' has been rejected. Caused by:
     java.lang.IllegalArgumentException: URI is not absolute" (a-11-logbox-open-bill.png, a-11-logcat-downloadFileAsync.txt);
     the toast then sits over the primary button of every screen until dismissed.
Expected: the bill opens (web) / downloads and shares (phone).
Actual: no bill can be opened, printed or shared by the shop on any platform. (The tenant logo has the same relative URL but
        the app prefixes it with the service origin — the PDF path is simply not prefixed.)
Business impact: the shop cannot keep or forward its GST invoice; its accountant has nothing to file. Together with DOS-060
        (delivery papers unshareable) no document reaches a customer.
Severity: P1
Evidence: QA/evidence/phase1/retailer/r-12-bill-inv-0753.png, r-31-open-the-bill.png, net-bill-0753/, inv-0753.pdf,
        android/a-11-logbox-open-bill.png, android/a-11-logbox-open-bill.txt, android/a-11-logcat-downloadFileAsync.txt
Suggested fix: return an absolute signed URL from billing.invoices.pdf (or resolve it against the API base in @dos/api-client
        exactly as the logo is); render the PDF eagerly at issue so the first open never says "try again in a minute".
```

### DOS-100 — The shop is never told its order is on credit hold, and hears nothing when the order is received
Category: ux | Priority: P2 | Role: Retailer | Platform: Web + Android

```
User: Retailer (ramesh.gupta, strict credit mode, ₹50,000 limit, ₹35,843 owed, ₹47,203 in open orders)
Platform: Web desk 1280×800
Environment: local dev, dos_qa
Steps:
  1. Place SO-0885 (₹5,855). The order screen shows no credit information before placing.
  2. Detail: "With the distributor · Pay after delivery". DB: approval_flags ["credit_limit"], approvals row pending
     (db-03-so-0885.txt) — the office must decide before anything moves.
  3. Messages: nothing for SO-0885. The only message of the walk was "Your order SO-0886 … has been cancelled" (db-10).
     The seeded pattern is "confirmed" messages only.
Expected: "Waiting for Tarsun to approve credit — ₹35,843 is overdue" on the order, and a "we received your order" message.
Actual: the order looks normal; the shop learns nothing until a rep or the office calls.
Business impact: the shop waits for goods that will not come; the office gets the "where is my order" call the app was meant
        to remove. Paying the overdue amount is the one action that would release the order, and the app does not connect
        the two.
Severity: P2
Evidence: QA/evidence/phase1/retailer/r-08-after-place-order.png, db-03-so-0885.txt, db-10-messages-today.txt
Suggested fix: expose approval_flags to the shop (orders.get already strips approvals; keep the flag), an "order received"
        notification, and a credit line ("₹X available") on the order screen.
```

### DOS-101 — The shop can order only whole cases: no pieces, so "Only 9 pc left" items cannot be ordered at all
Category: missing-feature | Priority: P2 | Role: Retailer | Platform: Web + Android

```
User: Retailer (ramesh.gupta)
Platform: Web desk 1280×800; Android
Environment: local dev, dos_qa
Steps:
  1. Place order: every row has "− 0 cs +" and nothing else. No piece entry, no typed quantity.
  2. Godavari UHT Milk 500 ml "Only 9 pc left" → the only possible quantity is 1 cs = 24 pc → "0 cs available — rest
     short-supplied" — accepted and placed (SO-0885 line 3, 24 pc), i.e. the shop knowingly ordered 24 with 9 in stock.
  3. The shop's own earlier orders (source retailer_app, seeded) carry 37 pc, 18 pc, "6 inner · 72 pc" — quantities the app
     cannot produce (r-10-order-so-0703-partial.txt).
Expected: pieces (and inner packs where the product has them), like the sales app.
Actual: cases only.
Business impact: a kirana buys dozens, not cases of 96; for a C-tier shop the case-only screen is a reason not to use it.
Severity: P2
Evidence: QA/evidence/phase1/retailer/r-07-order-uht-1cs.png, r-10-order-so-0703-partial.png, android/a-14-order-search.png
Suggested fix: piece stepper + typed quantity next to the case stepper; block or cap when qty > available instead of
        "rest short-supplied".
```

### DOS-102 — One home for three distributors, but only the active one shows what is owed; sign-in silently lands in the first
Category: ux | Priority: P2 | Role: Retailer | Platform: Web + Android + iOS

```
User: Retailer (ramesh.gupta — member of Tarsun, Sai Distributors and Kalyan Agencies)
Platform: Web desk + phone, Android, iOS home
Environment: local dev, dos_qa
Steps:
  1. Sign in → straight into Tarsun; no distributor choice was offered.
  2. Home "Your distributors": Tarsun "You owe ₹35,843.00"; Sai and Kalyan cards show only a button "Open …".
  3. Open Sai → ₹26,470 owed, 7 bills; open Kalyan → ₹29,181 owed, 9 bills, a delivery "at your shop" right now.
     Each switch = POST /auth/switch-tenant + a full reload of every screen; the "Home" of one distributor does not know the
     other two exist beyond their names.
Expected: one glance shows what the shop owes each supplier (₹91,494 in total) and which one has a van at the door.
Actual: three separate apps behind one sign-in.
Business impact: the multi-distributor shop is the retailer app's strongest reason to exist (docs/23 R2); today it hides the
        total and the live delivery of the two suppliers that are not open.
Severity: P2
Evidence: QA/evidence/phase1/retailer/r-01-after-signin.png, r-20-home-sai.png, r-21-home-kalyan.png, db-06-other-tenants.txt
Suggested fix: the `auth.memberships.summary` call proposed in docs/23 R2 (dues + last bill + on-the-way per membership).
```

### DOS-103 — No way to contact the distributor, complain or ask for a return from the app
Category: missing-feature | Priority: P2 | Role: Retailer | Platform: Web + Android

```
User: Retailer (ramesh.gupta)
Platform: Web desk 1280×800; Android
Environment: local dev, dos_qa
Steps:
  1. Returns: "To return goods — Tell the delivery crew at the door, or message Tarsun Enterprise. They raise the credit note
     and it appears here." There is no button to message anyone.
  2. Messages: "Messages from Tarsun Enterprise" — inbound only, no reply, no compose.
  3. Home, My shop, bill detail: the distributor's phone number appears nowhere (the bill shows the GSTIN only).
  4. Every screen searched for "call", "contact", "help", "support": nothing.
Expected: a phone number to tap, and a "report a problem with this bill / delivery" that reaches the office.
Actual: the shop still has to know the distributor's number by heart. "Is it easier than calling my distributor?" — for a
        complaint, the app IS calling the distributor, without the number.
Business impact: the complaint and return path, half of why a shop would open the app, does not exist.
Severity: P2
Evidence: QA/evidence/phase1/retailer/r-03-returns.png, r-03-inbox.png, r-03-shop.png
Suggested fix: distributor phone + WhatsApp deep link on the home card and bill; a "report" action on bill/delivery that
        writes an inbound_messages row for the office.
```

### DOS-104 — The price list loads 171 quotes and 500 stock rows (233 KB) on every open of "Place order"
Category: performance | Priority: P3 | Role: Retailer | Platform: Web + Android

```
User: Retailer (ramesh.gupta)
Platform: Web desk 1280×800 (net capture; the phone does the same)
Environment: local dev, dos_qa
Steps:
  1. Open /order. Network: GET /tenant-catalog/products?limit=200 (171 rows), GET /inventory/sellable?limit=500 (178 KB),
     POST /pricing/quote with all 171 variants at qty 1 (55 KB response) — before the shop has touched anything.
  2. Every "+" re-posts a quote for the whole basket (fine) — but the initial 171-line quote exists only to print "per piece".
Expected: list prices from the catalogue call; a quote only for lines in the basket.
Actual: ~233 KB and three round trips per open, on a shopkeeper's phone data.
Business impact: slow first paint on 4G in a shop; grows with the catalogue (the 500-row stock page is already truncated,
        DOS-097).
Severity: P3
Evidence: QA/evidence/phase1/retailer/net-order/
Suggested fix: serve tier list rates on tenantCatalog.list; quote only the basket.
```

### DOS-105 — Words that mislead a shopkeeper: credit notes "To pay", a cancelled order "You pay ₹1,977", "You asked" for a rate the rep asked, an ISO date in a WhatsApp reminder
Category: ux | Priority: P3 | Role: Retailer | Platform: Web + Android

```
User: Retailer (ramesh.gupta)
Platform: Web desk 1280×800 (same strings on Android)
Environment: local dev, dos_qa
Steps / what was seen:
  1. Returns: every credit note carries the badge "To pay" (CN/9002 ₹134, CN/0037 ₹215, CN/9001 ₹571, CN/0022 ₹1,402) — it is
     the parent bill's state, printed on a document that REDUCES what the shop pays. Reasons are office codes: "Return
     saleable", "Rate difference".
  2. Order SO-0310 (Cancelled) ends with "You pay ₹1,977.00" and a live "Cancel this order"-less footer; nothing is payable.
  3. Offers → "Rates you asked for": "You asked ₹13.00 · Waiting" and "They agreed ₹14.30" — both bargains were raised by
     the salesperson rahul.deshmukh at 5:48 pm (db-09-bargains.txt); the shop asked nothing.
  4. Inbox: "A gentle reminder: ₹36,548.00 is overdue on your account since 2026-08-06" — the only ISO date in the app, in
     the one message that goes out on WhatsApp.
  5. The cancel dialog offers "Cancel" and "Cancel this order" side by side; on a phone the first is easy to read as confirm.
  6. Bill detail "Still to pay" / list badge "To pay" / dues "left of" — three phrasings of one number.
Expected: "Credited ₹134", "Your salesperson asked", "since 6 Aug", "Keep it / Cancel the order".
Severity: P3
Evidence: QA/evidence/phase1/retailer/r-03-returns.png, r-11-order-so-0310-cancelled.png, r-03-deals.png, r-03-inbox.png,
        r-18-cancel-dialog.png, db-09-bargains.txt
Suggested fix: copy pass on the retailer strings namespace; derive the credit-note badge from the credit note, not the bill.
```

---

## Also true for the retailer (already filed)

- **DOS-029 (manager) / DOS-083 (sales)** — the app shows no error text on a failed mutation; the order screen is "before GST".
  Retailer instance filed as DOS-096 because the person misled is the customer.
- **DOS-074 (sales)** — stock hint reads 500 lots only. Retailer instance filed as DOS-097.
- **DOS-077 (sales)** — on the Pixel 7 `uiautomator` reports collapsed bounds for the price-list steppers ([586,615][615,518]),
  so scripted taps by accessibility node miss; not a user-facing defect, noted for the harness.
- **DOS-059 (delivery)** — duplicate receipt numbers: the shop's Receipts screen shows RCPT-0693 and RCPT-0687 both at
  "12 Sep, 12:50 pm"; those are the delivery walk's receipts, numbering unchanged.
- **DOS-060 (delivery)** — papers unshareable: the retailer side of the same defect is DOS-099.

## What worked (so the office knows what NOT to fix)

- Tenant isolation and permissions from the shop's token: other shops' orders, bills, PDF, ledger, outstanding → 404; another
  tenant's invoice → 404; confirm / costs / approvals / trips → 403; `retailers.list` returns only the shop's own row;
  `payments.initiate` for another retailerId silently answers for the caller's own shop (api-02-permission-probes.txt).
- The shop CAN submit its own order (docs/23's "single most important retailer gap" is closed): POST /orders + /submit → SO-0885,
  source retailer_app, credit hold raised exactly like the rep's SO-0879.
- Cancel with a reason from the order screen → state cancelled, reason stored, WhatsApp "cancelled" message queued (db-07, db-10).
- Dues, bills, receipts and the closing balance agree with the database: ₹35,843 = 6 open bills; receipts ₹1,47,576 = 25 rows;
  ageing buckets sum to the total; credit notes CN/9001 (₹571) and CN/9002 (₹134) are netted on the right bills.
- Distributor switch (Tarsun → Sai → Kalyan → Tarsun) re-reads everything for the new tenant, including Kalyan's live
  "Bill KA/0165 · At your shop"; Sai's monogram replaces the Tarsun logo.
- My shop self-edit: alt phone + landmark saved through POST /retailers/me and visible in the DB; an invalid GSTIN disables
  Save with "That is not a valid 15-character GSTIN"; name / terms / tier / credit are read-only as designed.
- Account: sign out another device (POST /auth/sessions/revoke), change password (wrong current → "Current password is
  incorrect"; mismatch disables the button; success → old password 401, new 200; other devices signed out).
- Phone width 390 px: no horizontal overflow on any screen; the "More" sheet on Android carries My account / Change your
  password / Sign out below the fold.
- 0 console errors and 0 failed requests on all 12 routes (pw-audit).
