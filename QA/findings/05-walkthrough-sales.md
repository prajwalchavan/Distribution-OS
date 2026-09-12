# Findings — Phase 1, Sales Rep walkthrough (rahul.deshmukh, sales app :5175, sales-service :3003)

Environment: local dev, database `dos_qa` (realistic seed 2026-09-12), all eight services + worker via `QA/tools/start-services.sh`,
web through `QA/tools/pw-server.mjs` + `pw.mjs` (headless Chromium 145, 1280×800 desk and 390×844 phone), Android debug APK on the
Pixel 7 emulator (API 36, API over `adb reverse`), iOS via Expo Go on the iPhone 16 Pro simulator (Appium) for sign-in and home.
Evidence root: `QA/evidence/phase1/sales/` (`s-NN` = desk web PNG + innerText `.txt`, `p-NN` = phone width, `api-NN-*` = request/response
captures and direct API calls, `db-NN-*` = SQL and output, `android/a-…e-NN` = device screenshots, `ios-0N-*.png` = simulator).

Walked on Saturday 12 Sep 2026 as Rahul Deshmukh (beats Station Road Mon/Thu, Kalyan West Market Tue/Fri, Khadakpada Wed/Sat).
Orders placed during the walk: SO-0879 (Shree Ganesh Kirana, 12 lines, credit hold), SO-0880 (Patil, cancelled by me), SO-0881
(Navjeevan, confirmed over limit), SO-0882 (Shree Ganesh, changed-price test), SO-0883 (Om Sai, web offline → draft → submitted),
SO-0884 (Laxmi Narayan, Android). Probe side effect: SO-0870 (Amit Pawar's confirmed order) is now cancelled — see DOS-073. New shop
R-9025 "Kalyan QA Kirana" (fictional). A bargain of ₹13.00 on Balaji Masala Masti is pending for the office. The Tier C rate of Neelam
Neem Soap was changed to ₹27.50 for DOS-082 and restored to ₹26.08.

Findings the earlier walks already filed and which are also true here are listed at the end.

---

### DOS-073 — A salesperson can cancel another rep's confirmed order (and read every order of the tenant)
Category: security | Priority: P0 | Role: Sales Rep | Platform: Backend API (sales-service)

```
User: Sales Rep (rahul.deshmukh)
Platform: Backend API, sales-service :3003, with Rahul's own access token
Environment: local dev, dos_qa
Steps:
  1. Pick a confirmed order of another rep for a shop on a beat Rahul is not assigned to:
     SO-0870, Amit Pawar, Nutan Kirana Stores (Birla College Road) — db-12-probe-ids.txt.
  2. POST /orders/6d53cb37-…/cancel {idempotencyKey, reason} with Rahul's token.
  3. GET /orders/6d53cb37-… and GET /orders?salespersonId=<amit> with Rahul's token.
Expected: 403 (or 404) — a rep may cancel only his own orders (orders.cancel "up to confirmed" is meant for the rep's own work).
Actual: 200, state → cancelled, cancelled_at 17:49:26, cancel_reason stored, stock reservation released. The reads also answer
        200 (full order with lines and prices). Cross-tenant ids correctly 404; costs/staff/credit/procurement/beats correctly 403.
Business impact: any rep (or a rep's stolen phone) can cancel colleagues' confirmed orders across the whole distributorship; the
        office sees a legitimate-looking cancellation with a reason. Sales are lost silently.
Severity: P0
Evidence: QA/evidence/phase1/sales/api-06-permission-probes.txt, db-14-cross-rep-cancel.txt
Suggested fix: orders.cancel (and setLines/submit) must check salesperson_id = actor for the salesperson role; consider scoping
        orders.get/list for reps to own orders + own-beat shops. Add the case to rls.test.ts / describePermissionMatrix.
```

### DOS-074 — "N cs available" on the order screen is wrong: the app reads only the first 500 lot rows and never pages
Category: business-logic | Priority: P1 | Role: Sales Rep | Platform: Web + Android (same client)

```
User: Sales Rep
Platform: Web 1280×800 (also the Android list before DOS-077 hides it)
Environment: local dev, dos_qa (807 sellable lot rows for the tenant, 759 at the Godown)
Steps:
  1. Shop card → Take order. Read the hints: "Campa Orange 1 L — 0 cs available", "Campa Cola 200 ml — 1 cs available",
     "Campa Cola 750 ml — 154 cs available".
  2. GET /inventory/sellable?variantId=<Campa Orange 1 L> → 9 Godown lots, 249 pcs (10 cs); Campa Cola 200 ml → 480 pcs (10 cs);
     Campa Cola 750 ml → 9,709 pcs at the Godown (404 cs).
  3. Capture the page's own calls: GET /inventory/sellable?limit=500 → 500 rows + nextCursor; the app never calls the cursor.
     In that page Campa Orange 1 L has 2 rows summing 4 pcs → "0 cs".
Expected: the ATP hint equals the godown's sellable total per variant (docs/23 S3 "live ATP hint").
Actual: the hint is the sum of whichever lots fell into the first 500 rows. 3 of the 12 Campa rows on screen were wrong by 9–250 cases.
Business impact: the rep tells shops "none available" for items the godown holds by the pallet, or promises 154 cases of
        something it has 404 of; every distributor with more than ~500 lots is affected from day one.
Severity: P1
Evidence: s-09-order-entry.txt, api-01-sellable.json, api-02-order-page-network.txt, db-05-stock-by-location.txt
Suggested fix: page through nextCursor (or add a per-variant aggregate endpoint / sync table) and sum per variant at the Godown
        (exclude vehicle and damaged locations explicitly).
```

### DOS-075 — The live "Order value — 2% off on bills over ₹25,000" scheme never applies
Category: business-logic | Priority: P1 | Role: Sales Rep (shop gets the bill) | Platform: Backend pricing engine + device

```
User: Sales Rep
Platform: Backend (POST /pricing/quote, orders.submit) and the device pricing
Environment: dos_qa — scheme id 6ac23a1a…, reward order_pct 200 bps, trigger value ≥ 2,500,000 paise, scope {all:true}, active,
        valid 14 Jun–21 Sep, listed by GET /pricing/schemes?on=2026-09-12
Steps:
  1. Place SO-0879 for Shree Ganesh Kirana: gross ₹29,534.12, net of line schemes ₹28,739.70 (s-19, db-08).
  2. POST /pricing/quote basket E (11 lines, no exclusive scheme, no cash-discount brand): gross ₹27,339.32, net ₹27,178.60.
  3. Basket C (with the exclusive ghee line): gross ₹27,324.92.
Expected: an order-level 2% (₹543–₹575) on each basket, allocated to lines by largest remainder (ADR 0008).
Actual: orderRules = [] in E; SO-0879 discount = ₹794.42 = the sum of line schemes only; "Schemes on this order −₹794.42".
Business impact: every bill over ₹25,000 is overcharged 2% against a scheme the office published; shops that know the offer
        will dispute bills; the scheme table promises something the engine never pays.
Severity: P1
Evidence: api-05-quote-order-level.txt (E, C), db-08-order-1.txt, s-19-confirmation.png
Suggested fix: priceOrder() must evaluate value-triggered order_pct rules with scope.all; add an engine unit test for the seed's scheme.
```

### DOS-076 — A brand-scoped cash discount (Too Yumm 2%) is granted on the whole bill
Category: business-logic | Priority: P1 | Role: Sales Rep / Accountant | Platform: Backend pricing engine + billing

```
User: Sales Rep (shop pays the bill)
Platform: Backend (POST /pricing/quote) and seeded invoices
Environment: dos_qa — "Too Yumm — 2% cash discount" (663ad71e…) scope brandIds [Too Yumm], reward cash_discount_pct 200
Steps:
  1. Quote basket E (no Too Yumm): cashDiscountBps 0.
  2. Quote basket F = E + one case Too Yumm Karare 60 g (₹704.64): orderRules [663ad71e cash_discount_pct amountPaise 55766],
     cashDiscountBps 200, cashDiscountPaise ₹557.66 = 2% of the whole net ₹27,883.24 (2% of the Too Yumm line would be ₹14.09).
  3. Seeded invoices confirm it reaches the bill: SAI/0427 taxable ₹33,042.63 with ₹672.67 of Too Yumm → cash_discount_bps 200
     on the header; 169 of 443 invoices since 22 Aug carry 200 bps (db-11).
Expected: the cash discount is computed on the scoped brand's lines only (or the scheme is order-scoped by design and named so).
Actual: one packet of the brand unlocks 2% cash discount on the entire bill.
Business impact: the distributor pays ~40× the intended cash discount on every early-paid bill that contains one Too Yumm line
        (₹557 instead of ₹14 on this basket); the Rajwadi 1.5% scheme behaves the same way.
Severity: P1
Evidence: api-05-quote-order-level.txt (E vs F), db-11-invoice-cash-discount.txt, db-10-scheme-rule-ids.txt
Suggested fix: cash_discount_pct base = the scope's lines' net; cash_discount_bps on the invoice header must then become an amount.
```

### DOS-077 — Android: the order-entry catalog rows are blank — 171 anonymous "Add a case" buttons, no name, pack or stock
Category: bug | Priority: P1 | Role: Sales Rep | Platform: Android (Pixel 7 emulator, API 36, debug APK)

```
User: Sales Rep (rahul.deshmukh)
Platform: Android, in.distributionos.sales debug build, online and offline
Environment: local dev, dos_qa
Steps:
  1. Beat → Laxmi Narayan Stores → Take order. Below "Add items / On this phone: 171 items" nothing is drawn (d-04, a-05).
  2. Swipe up inside the list: a column of identical "Add a case" buttons appears, no item text, no "N cs available" (e-02).
  3. uiautomator dump: every "Add a case" node has a collapsed rectangle (bounds [467,710][675,184] — bottom above top).
  4. Tap a visible button: "Items: 1 · ₹270.96" — the line then shows "Campa Cola 500 ml" in "This order" (e-08, e-10); Place order
     → SO-0884 confirmed (db-17). Search: typing "Neelam" leaves the same anonymous buttons (e-03).
Expected: the same rows as web — name, brand · case size, availability, Add a case.
Actual: the rep cannot see what he is adding; the only usable path on the phone is "Repeat last order" (which works, a-05) or
        tapping blind.
Business impact: order entry on the phone — the device the pilot reps will carry — is unusable for anything except repeats.
Severity: P1
Evidence: android/d-04-offline-order-entry.png, android/e-02-list-scrolled-2.png, android/e-08-tap-visible-add.png, android/e-10-placed.png
Suggested fix: the native catalog row (List + Row in @dos/ui native) loses its text children/height; check the native List item
        renderer with fixed-height rows (web renders correctly from the same screen).
```

### DOS-078 — Items with zero stock and quantities beyond stock are accepted silently; the office is not told
Category: business-logic | Priority: P2 | Role: Sales Rep | Platform: Web (client) + Backend (orders.submit)

```
User: Sales Rep
Platform: Web 1280×800, then the server
Environment: dos_qa — Chamak Dishwash Gel 750 ml: 0 on hand; Neelam Sandal Soap 3×100 g: 240 pcs (10 cs)
Steps:
  1. Search "Dishwash Gel 750": the row shows no availability line at all (other rows say "N cs available"); Add a case → line
     "1 cs" with no hint (s-17, s-18). Place order → SO-0879 line 10 accepted, approval_flags only ["credit_limit"].
  2. Neelam Sandal Soap: + to 12 cs on "10 cs available": accepted, Place order enabled; a red note appears under the editor only
     while the line is open (s-16).
Expected: a zero-stock line is marked (or blocked) on the device and the order carries a stock flag the office sees before pack;
        docs/23 S3 promises a live ATP hint.
Actual: the shop is promised goods the godown does not have; the warehouse discovers it at pick.
Business impact: short deliveries, credit notes and shop disputes; combined with DOS-074 the rep cannot trust any hint.
Severity: P2
Evidence: s-17-search-zero-stock.txt, s-18-scheme-order-built.txt, db-08-order-1.txt (line 10), s-16-over-availability.png
Suggested fix: show "none in stock" on the row; at submit raise a `stock` approval flag or clamp with a message.
```

### DOS-079 — The order total omits compensation cess, so the rep's total differs from the invoice
Category: business-logic | Priority: P2 | Role: Sales Rep / Accountant | Platform: Backend (orders) vs billing

```
User: Sales Rep
Platform: Backend
Environment: dos_qa — Campa Cola 750 ml, HSN 2202 "Aerated waters (Campa)" 28% GST + 12% cess (hsn_rates)
Steps:
  1. SO-0879 line 12: 48 pcs × ₹22.97 = ₹1,102.56 taxable, gst_bps 2800, tax ₹308.72, line total ₹1,411.28 — no cess column on
     sales_order_lines (db-08).
  2. Seeded invoice INV/0836 for the same variant: 28% GST ₹154.36 + cess ₹66.15 on ₹551.28 (db-09).
Expected: the order total the rep reads out ("Order total ₹32,030.00") equals what the bill will say.
Actual: the bill for the same goods will be ₹132.31 more; the credit check used ₹32,030 (approval payload totalPaise 3203000).
Business impact: the shop is told one number and billed another on every aerated-drink order; credit exposure is understated.
Severity: P2
Evidence: db-08-order-1.txt, db-09-cess.txt, s-20-order-detail.txt
Suggested fix: carry cess_bps/cess_paise on sales_order_lines and in the order total (the domain GST split already knows cess).
```

### DOS-080 — Sync pull storm: hundreds of /sync/pull calls per sign-in and ~55 per screen open
Category: performance | Priority: P1 | Role: Sales Rep (every field device) | Platform: Web + Android (offline client)

```
User: Sales Rep
Platform: Web (device 01a09576…) and Android (device 01a09579…)
Environment: local dev, sales-service log ~/.dos-qa-logs/logs/sales-service.log
Steps:
  1. Sign in on web at 17:22: 512 GET /sync/pull in that minute; opening the shop card + order entry at 17:26–17:27: 690 pulls.
  2. Reload the order screen and capture: 55 pulls in ~4 s, each returning 6–21 rows with limit=500; decoded `since` cursors advance
     by about one millisecond per call ("t":"…07:20:46.655701Z" → ".656751Z" → ".657478Z" …).
  3. Idle 8 s: 0 pulls (it does stop).
  4. 1,801 pulls in the log from three devices in one afternoon; 220 /auth/refresh calls.
Expected: a delta pull returns up to `limit` rows per call and one or two calls catch a device up (docs/27).
Actual: the server hands back one transaction's worth of rows per call (rows sharing a timestamp), so a first sync is ~500 round
        trips per device; every screen mount re-runs a tail of it.
Business impact: at lakhs of devices (docs/20) this is tens of millions of requests a day for nothing; on a 2G beat the first
        sync takes minutes and drains the battery; the 10 MB/day budget (UX-00 §8.3) is blown by request overhead alone.
Severity: P1
Evidence: api-02-order-page-network.txt, sales-service.log counts in QA/06-sales-rep-review.md §5, ENV.md notes
Suggested fix: pull must fill `limit` across timestamps (cursor = (updated_at, id) keyset, not "next distinct timestamp"), and the
        client should not re-pull on every mount.
```

### DOS-081 — Credit holds and over-limit warnings never reach the rep: "Order placed" for strict, stop and warn shops alike
Category: business-logic | Priority: P2 | Role: Sales Rep | Platform: Web (client) + Backend

```
User: Sales Rep
Platform: Web 1280×800
Environment: dos_qa — Shree Ganesh (strict, owes ₹35,843 all overdue, limit ₹50,000); Patil General Store (stop, owes ₹60,422 all
        overdue, limit ₹1,50,000); Navjeevan Super Bazar (indicate = "Warn at the limit", owes ₹2,68,111 > limit ₹2,00,000)
Steps:
  1. Shree Ganesh: 12-line order ₹32,030 → placed screen "The office has it, with its number and its price." DB: state submitted,
     approval credit_limit pending; the hold is visible only if the rep opens the order ("Waiting for the office").
  2. Patil (stop): 1 case → same message; DB: submitted + credit_limit approval (SO-0880).
  3. Navjeevan (warn, already over limit): 1 case → same message; DB: SO-0881 confirmed, approval_flags [], no approval row, no audit
     entry — nobody was warned.
  4. The shop card says "The office checks the credit (…) when the order is submitted, not here"; the order screen shows no
     limit/overdue signal (s-33, s-34).
Expected: docs/22 §4 S4 — the credit check runs on the device before submit; the rep knows at the counter whether the order will
        be held, and "warn" mode warns someone.
Actual: the rep promises delivery; the office silently holds it (strict/stop) or silently confirms it (warn).
Business impact: shops are told "placed" for orders that will not ship; over-limit shops keep getting goods with no one alerted.
Severity: P2
Evidence: s-26-patil-order-placed.txt, s-34-navjeevan-placed.txt, db-08-order-1.txt, db-10-scheme-rule-ids.txt (SO-0880), db-15-so0881.txt
Suggested fix: run creditCheck on the device (receivables.outstanding.get is already allowed to the rep) and say "held for
        credit" on the placed screen; make `indicate` create an approval/notification the manager sees.
```

### DOS-082 — A price changed by the office lands silently: the rep quoted ₹1,877.76, the order is ₹1,980.00
Category: business-logic | Priority: P2 | Role: Sales Rep | Platform: Web (client) + Backend

```
User: Sales Rep
Platform: Web 1280×800
Environment: dos_qa, Tier C price of Neelam Neem Soap 100 g changed 26.08 → 27.50 in price_list_items while the draft was open
Steps:
  1. Take order for Shree Ganesh, add 1 cs Neelam Neem Soap: line ₹1,877.76 (72 × 26.08) (s-43).
  2. Office changes the Tier C rate to ₹27.50 (SQL, then restored).
  3. Place order: the line silently becomes ₹1,980.00; POST /orders answers listRate 2750; SO-0882 submitted at 27.50 (api-07).
Expected: the server re-prices (correct) AND the rep is told "prices changed since you built this: Neelam Neem Soap 26.08 → 27.50"
        before or at least after placing.
Actual: no notice at all; the shop heard one number and the bill will carry another.
Business impact: disputes at delivery, refused bills; the rep loses the shop's trust.
Severity: P2
Evidence: api-07-changed-price.txt, s-43-price-change-draft.png, s-44-price-change-placed.png
Suggested fix: compare device quote vs server reply on create/submit and surface the diff; refresh price lists on the device
        before submit when online.
```

### DOS-083 — The rep never sees the bill total: order screen is "before GST", the detail screen is with GST
Category: ux | Priority: P2 | Role: Sales Rep | Platform: Web + Android

```
User: Sales Rep
Platform: Web 1280×800 and 390×844, Android
Steps:
  1. Build SO-0879: footer "₹28,739.70 before GST"; Place order; the placed screen still says ₹28,739.70.
  2. Open the order: lines are now GST-inclusive (Sunbake ₹1,288.84 instead of ₹1,092.24) and "Order total ₹32,030.00".
Expected: the amount the shop will owe (with GST and cess) is visible before the rep commits — the turn-around confirmation of
        docs/23 S3 ("single column, ≥ 20 sp") does not exist; Place order submits at once.
Actual: two different totals for the same order on consecutive screens; no confirmation step; scheme benefits (free goods,
        discount chips) appear only after placing (s-18 vs s-19).
Business impact: the rep either under-quotes by 11–13% or does mental GST at the counter; the pitch ("you get 6 free") cannot be
        shown before committing.
Severity: P2
Evidence: s-18-scheme-order-built.png, s-19-confirmation.png, s-20-order-detail.txt
Suggested fix: footer shows net + GST/cess = payable; a confirm step (or an inline summary) before submit with free goods and schemes.
```

### DOS-084 — "Today's beat" is not today's beat: the home opens on Station Road every day
Category: ux | Priority: P2 | Role: Sales Rep | Platform: Web + Android + iOS

```
User: Sales Rep
Platform: all three
Environment: dos_qa — beats.visit_days: Station Road [1,4], Kalyan West Market [2,5], Khadakpada [3,6]; walked on Saturday 12 Sep
Steps:
  1. Sign in: "Station Road / Today's beat / Shops: 10 Visited: 0". The seed's own visits today (8 of them, 10:19–12:44) are all on
     Khadakpada (Khadakpada chip: "Shops: 11 Visited: 8 Ordered: 4").
  2. Switch chip, reload: back to Station Road (s-54, ENV).
Expected: the beat whose visit_days contains today (or the assignment for today) is selected; docs/23 S1 notes the missing
        `beats.assignments.list` reader.
Actual: the first assignment wins; the rep must know his roster by heart and tap every morning.
Business impact: wrong shops in the morning list; "Visited 0" on the wrong beat while the real beat is half done.
Severity: P2
Evidence: s-01-home.png, s-54-beat-kwm.txt, db-00-rep-world.txt (visit_days), s-45-me-visits.txt
Suggested fix: pick the beat by visit_days/assignment for the IST business date; remember the last manual choice for the day.
```

### DOS-085 — Quantity entry: no keypad, pieces only go up, and "one case less" at 0 cs deletes the pieces
Category: ux | Priority: P2 | Role: Sales Rep | Platform: Web + Android

```
User: Sales Rep
Platform: Web 1280×800 (same component on Android)
Steps:
  1. Open a line: controls are "−" (One case less), "+" (One case more), "Pieces", "Ask a rate", "Remove". "Pieces" adds ONE piece per
     tap (2 cs → 2 cs + 1 pc → 2 cs + 2 pc); there is no piece-minus and no field to type 18 (s-15, s-15b).
  2. Repeat last order gives "Campa Cola 750 ml — 0 cs + 18 pcs"; tapping "−" there removes the whole line, pieces included, with
     no confirmation (s-11 → line gone).
  3. Zero, negative, text and huge values are impossible to enter (there is no input) — good — but 12 cs on 10 available is one
     tap away with no stop.
Expected: docs/23 S3 "case + pcs stepper" in ≤ 15 taps; a rep asked for "18 pieces" needs 18 taps today, "1 case less 4 pieces" is impossible.
Actual: as above.
Business impact: slow doorstep entry, wrong quantities, accidental line deletion.
Severity: P2
Evidence: s-15-pieces-sheet.png, s-15b-after-pieces-click.txt, s-11-line-editor.png, s-14/s-12 attempts
Suggested fix: a numeric keypad sheet for pieces (the delivery app has one), piece-minus, and "−" at 0 cs should ask before removing.
```

### DOS-086 — Offline orders park as drafts the rep must remember to submit by hand
Category: ux | Priority: P2 | Role: Sales Rep | Platform: Web (offline client; Android offline blocked by DOS-077)

```
User: Sales Rep
Platform: Web, one Playwright session with context.setOffline(true)
Steps:
  1. Offline: shop card and order entry come from the local copy (ageing, schemes, 171 items — good). Add 1 cs Balaji, Place order:
     "Saved on this phone · It goes to the office as a draft as soon as there is a signal. Submit it from My orders once it lands."
     Strip: "Offline since 5:59 pm · 2 waiting to send" (s-48).
  2. Reconnect: POST /sync/upload 200, both ops {"ok":true}; DB: draft, no number (db-16).
  3. My orders → Drafts → open → "Submit order" → SO-0883 confirmed (s-52, s-53).
  4. Offline the rows show no "N cs available" at all (the hint depends on the online sellable call).
Expected: the same intent as online — an order placed at the shop is submitted when the signal returns (docs/23 S5 "queued").
Actual: two-step; nothing on the home or the strip says "1 draft to submit" after the upload lands; a busy rep forgets.
Business impact: orders taken on a dead-signal beat may sit unsubmitted until the shop calls.
Severity: P2
Evidence: s-46…s-50, s-52, s-53, db-16-offline-web-order.txt
Suggested fix: auto-submit after upload (with the credit check server-side) or a persistent "drafts waiting" badge; keep the
        sellable copy on the device so the hint survives offline.
```

### DOS-087 — "₹15 off per case on 2+" gives ₹15 in total
Category: business-logic | Priority: P2 | Role: Sales Rep (shop) | Platform: Backend pricing engine

```
User: Sales Rep
Platform: Backend (orders.submit) and device — both agree
Environment: dos_qa — "Annapurna Atta — ₹15 off per case on 2+": trigger 2 cases, reward net_scheme_amount 1500 paise
Steps:
  1. SO-0879 line 11: 2 cs Annapurna Chakki Fresh Atta 5 kg, ₹2,266.60 → discount ₹15.00 (discount_bps 66), rule amountPaise 1500 (db-08).
Expected: ₹30 (₹15 × 2 cases) as the scheme is named and as the shop card advertises ("₹15 off per case on 2+").
Actual: ₹15 once per line regardless of cases.
Business impact: either the shop is short-changed ₹15 per extra case, or the scheme is mis-described to reps and shops; both cause
        counter arguments.
Severity: P2
Evidence: db-08-order-1.txt (line 11), s-19-confirmation.txt ("−₹15.00"), db-01-schemes-catalog.txt
Suggested fix: decide the semantics of net_scheme_amount (per trigger unit vs per line) in docs/22 and make the engine and the
        scheme names agree.
```

### DOS-088 — Deals to pitch: the shop card lists 6 of 14 live schemes and hides launches and the order-value offer
Category: ux | Priority: P3 | Role: Sales Rep | Platform: Web + Android

```
Steps: Shop card "Schemes this shop is in — Live today": Godavari Ghee, Rajwadi cash, MOM Makhana, Sunbake Glucose, Balaji, Too Yumm.
       GET /pricing/schemes?on=today returns 14 (all applicability {}), including "Konkan Crunch — launch offer 10%", "Order value 2%",
       "Campa bottle free", "Annapurna Atta", "Sunbake creams", "Campa 1 L/2 L", "Godavari UHT", "Rajwadi 5%". Shops tab → Catalog → Deals
       does list 14, but a rep at the counter reads the shop card.
Expected: the deals a rep can pitch at THIS shop, with launches first (docs/23 S11 "deals to pitch").
Actual: only brands the shop already buys.
Severity: P3 | Evidence: s-02-shop-shree-ganesh.txt, api-03-bounds-schemes-catalog.txt, s-40-catalog.txt
Suggested fix: show all live schemes grouped "for what you buy / new", or label the list "on brands you buy".
```

### DOS-089 — Every screen open after 15 minutes fires a 401 on /sync/manifest before the token is refreshed
Category: reliability | Priority: P3 | Role: Sales Rep | Platform: Web (offline client)

```
Steps: after the access token expired (15 min) every navigation logged "401 GET /sync/manifest" then POST /auth/refresh then a 200
       manifest; 31 such 401s and 220 refreshes in one afternoon (sales-service / auth-service logs). Functionally self-healing.
Expected: the sync client uses the session's token (refreshed proactively) like the rest of the api-client.
Severity: P3 | Evidence: api-02-order-page-network.txt (first line), pw.mjs "[failed requests]" on every command after 17:38
Suggested fix: route the manifest/pull calls through the same auth-aware fetch with the one-refresh-per-401 rule (docs/08).
```

### DOS-090 — A bargain request points at an order id that does not exist
Category: tech-debt | Priority: P3 | Role: Sales Rep / Manager | Platform: Backend

```
Steps: Ask a rate on a fresh draft (nothing posted yet): POST /pricing/bargains carries orderId 01a0958d-4353-… (the device's
       draft id); both bargain rows reference it; sales_orders has no such row (db-13). The manager's bargain queue will show an
       order that cannot be opened. Within-bound (₹14.30, 2%) auto-approved and re-priced the line — good; ₹13.00 (11%) → requested.
Severity: P3 | Evidence: db-13-bargains-drafts.txt, s-30/s-31
Suggested fix: create the draft server-side before the first bargain, or make orderId nullable until submit and link on submit.
```

### DOS-091 — The rep can list a shop's bills but cannot open or show one; "Due 10 Sep · 2 days" is ambiguous
Category: missing-feature | Priority: P3 | Role: Sales Rep | Platform: Web + Backend

```
Steps: Bills tab lists INV/0753 "Due 10 Sep 2026 · 2 days ₹5,472.00 of ₹5,472" (past due, read as "2 days to go" at a glance);
       GET /billing/invoices/{id} and /pdf → 404 "Cannot GET" on sales-service (route not mounted). docs/23 S12 marks billing
       "wiring ✗ on sales-service".
Severity: P3 | Evidence: s-04-shop-bills-tab.txt, api-06-permission-probes.txt
Suggested fix: mount billing reads (get + pdf) for the rep; say "2 days overdue" / "due in 2 days".
```

### DOS-092 — Cancel dialog offers "Cancel" and "Cancel order"
Category: ux | Priority: P3 | Role: Sales Rep | Platform: Web + Android

```
Steps: Order detail → "Cancel this order" → dialog "Order SO-0880 … will be cancelled and its stock released. Why [ ] · Cancel · Cancel order".
       Cancel works (POST /orders/{id}/cancel 200, approval "Expired"). The reason is optional.
Severity: P3 | Evidence: s-27-cancel-dialog.png, s-28-after-cancel.txt
Suggested fix: "Keep it" / "Cancel the order"; require a reason (the office reads it).
```

### DOS-093 — A brand-new shop's card throws a 404 for its behaviour block
Category: bug | Priority: P3 | Role: Sales Rep | Platform: Web + Backend

```
Steps: Shops → search a name that does not exist → "Add as new item" → New shop form (name, owner, phone, address, beat, position,
       tax type) → Add shop → POST /retailers 200 → R-9025 "Kalyan QA Kirana", credit_mode indicate, limit 0, tier C, listed in the
       beat at once (good). The card then logs 404 GET /reporting/retailers/{id}/behaviour; "How this shop buys" stays empty.
Severity: P3 | Evidence: s-36…s-38, api-06 (POST /retailers in the s-38 capture)
Suggested fix: behaviour endpoint returns zeros for a shop with no history, or the card hides the block on 404.
```

---

## Also true here (already filed by earlier walks — not re-numbered)

- DOS-063-style staleness: after Record visit the dialog stays open with "Visit recorded" until Close; the beat row updates only on
  navigation. After the credit hold the placed screen never says so (DOS-081 covers the sales side).
- The 401-then-refresh pattern (DOS-089 here) was seen in the delivery and warehouse walks as "Updated just now" strips that are honest.
- Positions: "Tag my position" / "Pin this spot" give "No position" silently in headless Chromium — expected for the harness, not
  a product defect; on the Pixel the delivery walk found the Google "Location Accuracy" dialog (DOS-0xx not needed).
- `pnpm smoke` style duplicates are absent in dos_qa; the two seeded "Not numbered yet" drafts (₹1,598, ₹1,472) are seed data.

## Verified working (no finding)

Sign-in on all three platforms; home counters (Shops/Visited/Ordered) update from the server on all three; shop card with
outstanding, limit, overdue, six ageing buckets that sum to the outstanding (₹35,843), Orders tab (25) and Bills tab (6 bills that
add up); Record a visit with outcome/reason (POST /visits 200, row in `visits`); Repeat last order (4 lines re-priced); tier pricing
(Sunbake Glucose ₹15.17 tier C, ₹15.10 tier B, ₹14.95 tier A); line schemes on the device and server agree to the paisa (Balaji 4%,
ghee 6% exclusive, Konkan 10%, MOM 2% slab, Sunbake 12+1 = 6 free, Campa 1 free per case); expired (Neelam 12+1) and withdrawn
(Annapurna oils) schemes correctly ignored; discontinued Chamak Glass Cleaner hidden; proposed Konkan Ratlami Sev orderable;
bargain within the 3% bound auto-approved and re-priced, beyond it queued; credit_limit approval raised for strict/stop shops;
cancel with reason; My orders with Needs you / Travelling / All / Drafts; Shops search by name, code and phone; Losing (risk %);
Catalog All / Deals / In stock; Me: strike rate, targets, payouts, Visits, WhatsApp/voice Drafts with a confirm dialog that leaves
unmatched lines out, Inbox; Settings device list; phone width 390 px with no horizontal scroll on six screens; web offline read +
queued write + upload; Android home/beat/shop card/Me/offline reads; iOS sign-in + home; cross-tenant 404; costs/staff/credit/
procurement/beats 403 for the rep.
