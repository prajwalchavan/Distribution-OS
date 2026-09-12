# Findings — Phase 1, Warehouse walkthrough (dinesh.patil, warehouse app :5176, warehouse-service :3004)

Environment: local dev, database `dos_qa` (realistic seed 2026-09-12, commit 472a5df), all eight services + worker started by
`QA/tools/start-services.sh`, web via `QA/tools/pw-server.mjs` + `pw.mjs` (headless Chromium 145, 1280×800 desk and 390×844 phone),
Android debug APK on the Pixel 7 emulator (API 36), iOS via Expo Go on the iPhone 16 Pro simulator (Appium). Evidence root:
`QA/evidence/phase1/warehouse/` (PNG = full-page screenshot, `.txt` = the page's innerText at that moment, `db-NN-*.txt` = the SQL and
its output, `api-*.txt/json` = direct API calls with the warehouse token, `android/` and `ios-01-home.png` = device screenshots).

Findings the owner and manager walks already filed and which are ALSO true here are not re-numbered; they are listed at the end.

---

### DOS-039 — Load-out confirm deducts the packed orders' stock a second time; today's only sheet cannot leave the godown
Category: business-logic | Priority: P0 | Role: Warehouse | Platform: Web (server-side)

```
User: Warehouse (dinesh.patil)
Platform: Web, 1280×800 (the refusal comes from warehouse-service, so every platform)
Environment: local dev, dos_qa realistic seed
Steps:
  1. Home → LOAD SHEETS → "MH-05-AB-1234 · 12 Sep · 5 orders · 38 cartons · draft" (sheet 374f2089, approved by the manager at
     12:10 pm, E-way bill 381012345678). The screen lists the 5 packed orders (SO-0869/0871/0875/0876/0878, INV/0836–0840, cartons
     3+4+12+12+7 = 38) and "WHAT GOES ON THE VEHICLE": 25 lots, first one Balaji Chataka Pataka Wafers 45 g "5 cs = 240 pc".
  2. Blind-count 35 cartons → Done → "What is different? The count differs — say why" → note typed → "Send the vehicle out" →
     dialog "35 cartons leave on MH-05-AB-1234. Stock moves to the vehicle and challan paper is issued. This cannot be undone." →
     confirm.
Expected: the sheet is confirmed, a challan is issued, the trip's vehicle carries the 5 orders.
Actual: POST /warehouse/load-sheets/374f2089…/confirm → 400 "insufficient stock: lot 56f53711-… at location 01a0947d-… would go
        below zero (delta -240)". The request body was {countedPackages:35, countedVanStock:[], challanId, varianceNote} — the app
        asked for NO van stock; the server itself tries to move the orders' lots godown → vehicle. Those lots already left the
        godown when the orders were packed: stock_ledger for lot 56f53711 = opening +240 (2 Sep) and pack/sale −240 (12 Sep 11:30),
        godown on hand 0. The sheet's own van_stock column is empty. None of the 82 seeded "confirmed" sheets has a ledger row
        against it (they were written by the seed, not by this procedure), so this is the first real confirm — and it fails.
        The message is shown on screen, raw, with two UUIDs. The sheet stays draft; the trip's stops stay pending.
Business impact: no packed order can be sent out through the app — the delivery chain stops at the godown gate. Where a lot
        happens to have surplus stock, the same goods would be deducted twice (sale at pack, transfer at load-out), corrupting
        on-hand and the stock-value register.
Severity: P0
Evidence: w-14b-draft-sheet.png, w-14c-count-35.png, w-14e-variance-note.png, w-14f-send-dialog.png, w-14g-after-send.png (+ .txt),
          db-07-loadout-refused.txt (ledger of lot 56f53711, van_stock = [], 82 seeded sheets with 0 ledger rows), p-05-load-sheet.png
          (phone), android/a-18-draft-sheet.png.
Suggested fix: decide once where stock leaves the godown. If pack books the sale (as it does today: ref_type pack / reason sale),
        load-out must move ONLY the extra van-sale stock the crew counted (countedVanStock) and never the packed orders' lots;
        the challan then lists the packed cartons by invoice. If instead the goods should sit "in transit"/on the vehicle until
        delivery, pack must transfer (not sell) and the invoice's stock effect moves to delivery. Either way, add a spec that
        confirms a load sheet whose orders were packed by warehouse.packs.confirm.
```

### DOS-040 — A wave cannot be started from the app; picks on an unstarted wave are rejected while the screen counts them as picked
Category: bug | Priority: P1 | Role: Warehouse | Platform: Web (sync path, so all platforms)

```
User: Warehouse (dinesh.patil)
Platform: Web, 1280×800
Environment: local dev, dos_qa realistic seed
Steps:
  1. Home → WAVES ON THE FLOOR → PICK-0079 ("0 of 750 pc picked · open"). The sheet shows 24 lot lines with Picked / Short,
     Scan, Refresh and "Take it to packing". There is no Start button anywhere (Home, Pick tab, sheet).
  2. Press "Picked" on line 1 (Campa Lemon 200 ml, batch B20260101, 96 pc).
Expected: the wave starts (picklists.start) and the pick is saved; or the app says the wave must be started first.
Actual: header becomes "1 of 24 picked" and the line disappears from "To pick". Nothing reached pick_lines (picked_qty 0,
        picked_at null); the op went through POST /sync/upload and was REJECTED: code picklist_closed, "Picklist PICK-0079 is
        open; it is no longer being picked" (sync_ops 01a094eb…). The rail strip turns to "1 need attention"; the tray
        (/pick/attention) shows the rejection with "Try it again" / "Throw it away". The wording tells the picker the wave is
        "open" and "no longer being picked" in one sentence. Only after the wave was started through the API
        (POST /warehouse/picklists/{id}/start, which the warehouse role IS allowed to call — api-start-pick-0079.txt) did new
        picks get accepted.
Business impact: a fresh wave from the desk cannot be picked at all; every tap looks successful and is silently thrown away,
        so the picker walks the whole sheet for nothing.
Severity: P1
Evidence: w-08-pick-0079-open.png, w-08b-pick-line1-picked.png, w-09-need-attention.png, db-03-pick-first-line.txt (sync_ops row),
          api-start-pick-0079.txt.
Suggested fix: call picklists.start on the first pick of an open wave (or show "Start picking" as the sheet's primary button);
        reject a pick on an unstarted wave with "Start the wave first", not "no longer being picked".
```

### DOS-041 — Picking more than the lot line asks for is accepted; the pack is then refused and the order cannot ship
Category: business-logic | Priority: P1 | Role: Warehouse | Platform: Web (server accepts it, so all platforms)

```
User: Warehouse (dinesh.patil)
Platform: Web, 1280×800
Environment: local dev, dos_qa realistic seed, PICK-0079 started (see DOS-040)
Steps:
  1. On PICK-0079 press "Short" on the Campa Lemon 200 ml line "Batch RCP20260717 · 6 pc" → dialog (Not on the rack / Damaged carton /
     Batch held back, keypad "Pieces picked"). Choose "Damaged carton", key 2, 0 → the dialog shows "20" → Short.
Expected: the keypad refuses more than 6 (or the server rejects picked > requested).
Actual: POST /sync/upload → accepted:1. pick_lines: requested 6, picked 20, short_reason "Damaged carton". The pack screen later
        lists the line as "20 pc · Packed". "Pack and bill" (7 cartons, 45 kg) → POST /warehouse/orders/{SO-0877}/pack → 400
        "insufficient stock: lot 3a6e7f22-… would go below zero (delta -20)"; "Pack without a bill" → same 400. SO-0877 stays
        `picking`, no pack, no invoice, the wave is closed (DOS-042) and the warehouse role may not cancel it (403 on
        picklists.cancel). The order is stuck until the desk intervenes.
Business impact: one fat-fingered digit during picking makes an order unshippable, and the picker finds out only at the packing
        bench, from a message full of UUIDs.
Severity: P1
Evidence: w-10d-short-20-of-6.png, db-04-after-picks.txt, w-13d-pack-and-bill-after.png, w-13f-after-refused-pack.png,
          db-06-after-refused-pack.txt, api-permission-probes.txt (picklists.cancel 403).
Suggested fix: cap the keypad at the requested pieces of the lot line and reject picked > requested on the server per lot line
        (today the server only checks the order-line total, and only when the last lot of that order line is picked).
```

### DOS-042 — The wave closes as "picked" with a line neither picked nor shorted, and a closed wave cannot be corrected by the picker
Category: business-logic | Priority: P1 | Role: Warehouse | Platform: Web (server state, so all platforms)

```
User: Warehouse (dinesh.patil)
Platform: Web, 1280×800 and 390×844
Environment: local dev, dos_qa realistic seed, continuing from DOS-041
Steps:
  1. Pick every remaining line of PICK-0079 with "Picked". The 5th of those uploads is rejected: pick_rejected "line 199afd5f-…
     on PICK-0079 asks for 240 pcs; 246 were picked" (the 20-of-6 over-pick pushed the order line over). The screen still says
     "24 of 24 picked" and enables "Take it to packing".
  2. Reload: "23 of 24 picked", the 80-pc lot line (Campa Lemon 200 ml B20260902) is back in "To pick", "Take it to packing"
     disabled with "1 line not yet picked" — but the status badge already says "picked".
  3. Short that line with 0, "Batch held back".
Expected: either the wave stays `picking` until every line has a pick or a short, or the picker can still record the short.
Actual: the server had already set PICK-0079 status = picked, completed_at 14:58:35, at 676 of 750 pc, with the 80-pc line at
        picked_qty 0, short_reason NULL, picked_at NULL. The short is rejected: picklist_closed "Picklist PICK-0079 is picked; it
        is no longer being picked". The screen nevertheless flips back to "24 of 24 picked" and "Take it to packing" just navigates
        to the Pack tab (no call). The pack list shows SO-0877 as "750 pc" (ordered), not 676 (picked).
Business impact: 80 pieces the shop ordered are neither picked nor recorded as short — they vanish from the paperwork; the
        picker sees three different truths for the same sheet (24/24, 23/24, badge "picked").
Severity: P1
Evidence: w-11-all-picked.png, db-05-all-picked.txt, w-11c-pick-reloaded.png, p-02-pick-sheet.png (badge "picked" + "1 line not
          yet picked" on one screen), w-11d-last-line-short.png, w-12-take-to-packing.png.
Suggested fix: complete a wave only when every lot line has picked_at (pick or short); count a rejected op as NOT picked in the
        local state; let a picker re-open or short a line on a closed wave, or surface "closed — ask the desk to cancel".
```

### DOS-043 — A warehouse user can start loading and send a trip out in one tap each, two days early, with a draft load sheet
Category: security | Priority: P1 | Role: Warehouse | Platform: Web (server accepts it, so all platforms)

```
User: Warehouse (dinesh.patil)
Platform: Web, 1280×800
Environment: local dev, dos_qa realistic seed
Steps:
  1. Load → Trips: "TRIP-NEXT · planned · MH-05-AB-1234 · 14 Sep · 0 of 5 stops · Start loading". Tap "Start loading".
  2. The row now shows "loading" and a "Send it off" button. Tap it.
Expected: "Start loading" needs a confirmed load sheet; departing a trip is the driver's step (consent, odometer, opening cash —
        docs/23 D2) and is refused while the sheet is draft; both steps confirm first.
Actual: POST /delivery/trips/{id}/start-loading → 200 (state loading), no dialog. POST /delivery/trips/{id}/depart → 200, no
        dialog: TRIP-NEXT is `active`, started_at 12 Sep 15:08 (trip_date 14 Sep), start_odometer_km NULL, 5 stops pending,
        load sheet 374f2089 still draft, no stock on the vehicle. audit_log has no row for any of it. The trip now sits in the
        delivery app as an active trip with nothing loaded.
Business impact: a loader can put a van "on the road" that has not been loaded, ahead of its date, with no odometer or cash
        opening — the day's delivery data for that trip is wrong from the first second, and nobody can tell who did it.
Severity: P1
Evidence: w-15b-start-loading.png, w-15d-send-it-off.png, db-08-trip-depart.txt, android/a-07-trips.png (Android shows the
          trip active afterwards).
Suggested fix: remove the warehouse role from trips.depart (and start-loading if the sheet gate is enforced there); refuse
        depart while any load sheet of the trip is draft; confirm dialog on both; write audit rows.
```

### DOS-044 — The warehouse can create stock out of nothing: +1,00,000 pieces posted as "opening stock" with no approval or confirmation
Category: business-logic | Priority: P1 | Role: Warehouse | Platform: Web (server accepts it, so all platforms)

```
User: Warehouse (dinesh.patil)
Platform: Web, 1280×800
Environment: local dev, dos_qa realistic seed
Steps:
  1. Inbound → Stock → Campa Cola 1 L, batch RCP20260807 (on hand 5 pc after a real −2 "Damaged" adjustment with a note, which
     worked correctly: ledger row damage −2, actor dinesh.patil). Press "Adjust", type 100000, reason "Opening stock", note, "Post
     the adjustment".
Expected: a positive adjustment of that size by a warehouse user needs the desk's approval, or at least a confirmation
        ("You are adding 4,166 cases — are you sure?").
Actual: POST /inventory/adjustments → 200 straight away. The card reads "On hand 4166 cs + 21 pc = 100005 pc · Free 1,00,005 pc";
        the lot is sellable at once. Reversed by QA with −100000 "Correction". (Zero is blocked client-side; −100 was refused by the
        server as below zero — the guard exists only downwards.)
Business impact: any loader can inflate stock, make unavailable goods orderable, and distort the stock-value register the owner
        reads; the only trace is a ledger row.
Severity: P1
Evidence: w-05e-adjust-huge-after.png, w-05b-adjust-minus2-filled.png, db-02-adjust.txt, db-03-pick-first-line.txt (ledger:
          +100000 / −100000).
Suggested fix: warehouse adjustments limited to negative reasons (damage, expiry, count difference) or capped; "Opening stock"
        desk-only; a confirm dialog for anything above a case or two.
```

### DOS-045 — Counts compare against a stale "expected" figure, and the expected figure is sent to the counter's device anyway
Category: business-logic | Priority: P2 | Role: Warehouse | Platform: Web (API, so all platforms)

```
User: Warehouse (dinesh.patil)
Platform: Web, 1280×800
Environment: local dev, dos_qa realistic seed
Steps:
  1. Inbound → Counts → "Godown · 3 lots · 12 Sep · open" → "Blind count: the expected figure is not on this screen". Key 9 for
     Campa Cola 1 L RCP20260807 (true on hand 7 — the manager posted two −1 damage adjustments at 14:24 and 14:27), 14 for
     Chamak Detergent Bar (true 14), 0 for Godavari Cow Ghee (true 5). Save the count.
Expected: variance +2 / 0 / −5 against the stock at count time.
Actual: POST /inventory/cycle-counts/{id}/count → 200 with expectedPcs 9 / 14 / 5 and variancePcs 0 / 0 / −5: the expected figure
        was frozen when the count was opened (08:15) and the desk would post a zero variance for a lot that is really 2 short of
        the count. The response carries expectedPcs and variancePcs to the warehouse device, and the Stock tab one tap away shows
        the same lots' on-hand — the count is not blind. The gate count (procurement.grns.count) returns expectedQtyPcs the same way.
Business impact: a cycle count taken hours after it was raised posts the wrong difference; a counter who wants to "pass" can read
        the target.
Severity: P2
Evidence: w-03-count-open.png, w-03d-count-filled.png, w-03e-count-saved.png, db-01-cycle-count.txt, w-02-inbound-Stock.txt (same
          lot "On hand 7 pc"), db-09-gate-count.txt.
Suggested fix: compute expected from the ledger as of counted_at (or refresh it when the count starts); strip expected/variance
        from the warehouse-role response.
```

### DOS-046 — "Try it again" on a refused change replays the same stored rejection forever
Category: reliability | Priority: P2 | Role: Warehouse | Platform: Web (sync client, so all platforms)

```
User: Warehouse (dinesh.patil)
Platform: Web, 1280×800
Environment: local dev, dos_qa realistic seed
Steps:
  1. The pick rejected in DOS-040 sits in the attention tray. Start the wave through the API. Press "Try it again".
Expected: the pick is re-evaluated and accepted (the cause is gone).
Actual: POST /sync/upload → {accepted:0, replayed:1, rejected:[picklist_closed …"is open; it is no longer being picked"]} — the
        outbox resends the same opId and the server returns the outcome it stored the first time, without looking again. Every
        retry gives the same answer; only "Throw it away" and re-picking works, and the tray does not say so.
Business impact: the retry button is a dead end; after any transient refusal the user must guess to discard and redo.
Severity: P2
Evidence: w-09b-retry.png (+ .txt), db-03-pick-first-line.txt, api-start-pick-0079.txt (wave `picking` before the retry).
Suggested fix: a retry from the tray should send a NEW opId (same intent), or the server should re-evaluate a replayed op whose
        stored outcome was a rejection.
```

### DOS-047 — The Pick and Load lists hide the waves and sheets that need work
Category: ux | Priority: P2 | Role: Warehouse | Platform: Web, Android

```
User: Warehouse (dinesh.patil)
Platform: Web 1280×800, Android Pixel 7
Environment: local dev, dos_qa realistic seed
Steps:
  1. Pick tab → WAVES: 30 rows, all "packed"/"picked", ordered by id (PICK-0047, PICK-0077, PICK-0009 …). PICK-0078 (picking) and
     PICK-0079 (open) are not in the list at all.
  2. Load tab → LOAD SHEETS: 30 "confirmed" rows ordered by id; the one draft sheet awaiting the count is absent.
Expected: open/picking waves first, draft sheets first, newest first; the finished ones below or behind a filter.
Actual: as above; the only way to reach today's work is the Home queue. The API supports status filters
        (picklists?status=picking → PICK-0078; load-sheets?status=draft → the sheet), the screens do not use them.
Business impact: a picker who lands on the Pick tab sees 30 finished waves and no work.
Severity: P2
Evidence: w-07-pick-list.png (+ .txt), w-14-load-list.png, api-shapes.txt, android/a-03-pick.png, android/a-06-load.png.
Suggested fix: sort by status then date; cap the finished list or put it under "Done".
```

### DOS-048 — Server refusals are shown verbatim with UUIDs
Category: ux | Priority: P2 | Role: Warehouse | Platform: Web

```
User: Warehouse (dinesh.patil)
Platform: Web, 1280×800
Environment: local dev, dos_qa realistic seed
Steps:
  1. Adjust −100 on a 5-pc lot; Move 200000 to a van; Pack SO-0877; Send the vehicle out.
Expected: "Only 5 pc of Campa Cola 1 L (RCP20260807) are in the godown."
Actual: every refusal is printed as it came: "insufficient stock: lot 00106d03-d980-73ae-a720-b3369ea572f7 at location
        01a0947d-7a96-723f-952d-338dd284a1b4 would go below zero (delta -100)". The warehouse app at least shows the message
        (the manager app swallows it — DOS-029); a loader cannot act on a lot UUID.
Business impact: the person at the bench cannot tell which product or which godown the server means.
Severity: P2
Evidence: w-05d-adjust-minus100-after.txt, w-06c-move-too-many.txt, w-13f-after-refused-pack.txt, w-14g-after-send.txt.
Suggested fix: map lotId/locationId to names in the error surface; keep the raw text behind "details".
```

### DOS-049 — "Blind" counts show the answer on the same screen
Category: ux | Priority: P3 | Role: Warehouse | Platform: Web, Android

```
User: Warehouse (dinesh.patil)
Platform: Web, Android
Environment: local dev, dos_qa realistic seed
Steps:
  1. Draft load sheet: "Blind count: what the bill says is not on this screen" above the keypad; directly below, ORDERS ON THIS
     SHEET lists "Cartons 7 / 12 / 12 / 4 / 3" (= 38). Typing 35 immediately shows "The count differs — say why".
  2. Load → Check-in → a vehicle: "EXPECTED ON THE VEHICLE" with quantities per lot (including a "0 pc" row).
Expected: hide the per-order carton counts until the crew count is in; check-in counts blind too, or drop the word.
Actual: as above.
Business impact: the count is theatre; a crew short by three cartons types 38.
Severity: P3
Evidence: w-14b-draft-sheet.txt, w-14d-after-done-35.txt, w-16b-checkin-vehicle.png, android/a-18-draft-sheet.png.
```

### DOS-050 — Queue rows do not say what they are: reservations without an order, "Ready to pack" with orders still being picked, an unnamed receipt
Category: ux | Priority: P3 | Role: Warehouse | Platform: Web, Android

```
User: Warehouse (dinesh.patil)
Platform: Web, Android
Environment: local dev, dos_qa realistic seed
Steps / Actual:
  1. Inbound → Held: 42 rows "Sunbake Orange Cream 120 g · 23 pc · Batch SB20260830 · pending" — no order, no shop; tapping a row
     does nothing. The API returns orderNo (SO-0867) for every row.
  2. Pack → READY TO PACK lists SO-0874 and SO-0872 ("picking", in PICK-0078, 13 lines still to pick) next to SO-0877; each row
     shows the ORDERED pieces (750) not the picked (676). The pack dialog says "7 cartons leave the godown for Bhosale Traders" and
     nothing about 74 pc short.
  3. Home → GATE COUNTS WAITING: "1 line" for a 4-line GRN; the row reads "Receipt at Godown · 12 Sep, 3:17 pm · counting" — no
     supplier, no bill number (it was GUR/26-27/00490, Guru Kripa).
Expected: order + shop on held rows; only picked orders under "Ready"; picked qty and shortages on the pack row/dialog; supplier
        and bill number on the receipt row.
Business impact: the packer picks the wrong order; the gate cannot tell which lorry the count is for.
Severity: P3
Evidence: w-02-inbound-Held.txt, w-04-held-click.png, api-shapes.txt (reservations orderNo), w-13-pack-list.png, w-13d-pack-and-bill-after.png,
          w-19-home-with-grn.txt, android/a-05-pack.png.
```

### DOS-051 — Short-pick and gate-count semantics: a silent default reason, and damaged pieces counted as excess
Category: ux | Priority: P3 | Role: Warehouse | Platform: Web

```
User: Warehouse (dinesh.patil)
Platform: Web, 1280×800
Environment: local dev, dos_qa realistic seed
Steps / Actual:
  1. PICK-0079, line "RCP20260529 · 1 pc" → Short → press Short without choosing a reason or a number → accepted; pick_lines
     stores picked 0, short_reason "Not on the rack" (the first chip, never chosen).
  2. Gate count GUR/26-27/00490 line 2 (bill says 144): "Pieces received" 144, then "Damaged pieces" 2 → findings show
     "Excess 2 pc" AND "Damaged 2 pc" — the app adds damaged on top of received (146). A gate hand who counted 144 boxes of which
     2 were crushed has recorded an excess that does not exist. The GRN status afterwards is "reconciled — nothing to count" while
     five findings are open.
Expected: Short requires a reason (or records "no reason given"); "received" includes damaged, or the label says "good pieces";
        a counted GRN with open findings is "counted", not "reconciled".
Business impact: the supplier claim for damage is wrong by the same 2 pieces; reasons in the short report are fiction.
Severity: P3
Evidence: db-04-after-picks.txt, w-19e-line2-damaged.png, w-19g-count-saved.txt, db-09-gate-count.txt.
```

### DOS-052 — The warehouse role receives retailer credit terms, and its "Inbox" is the distributor's outbound message log
Category: security | Priority: P3 | Role: Warehouse | Platform: Web (API)

```
User: Warehouse (dinesh.patil)
Platform: Web / API :3004
Environment: local dev, dos_qa realistic seed
Steps / Actual:
  1. GET /retailers/{id} with the warehouse token → 200 with creditLimitPaise, creditDays, creditMode, cashDiscountBps,
     cashDiscountDays, tier. No warehouse screen needs them (docs/23 §5.3 flagged the same for the delivery crew).
  2. Settings → "Inbox" lists "Order SO-0459 of ₹8,044.00 confirmed. Delivery on the next beat day…" — SMS/WhatsApp the tenant sent
     to SHOPS, with order values, presented as the loader's inbox.
  (Checked and correct: purchase cost is not in balances/ledger/picklists; /tenant-catalog/costs, the stock-value register,
   sales register, GST summary, supplier invoices, POs, collections, expenses, GRN open/post, cycle-count post, load-sheet
   approve/cancel, picklist cancel, order confirm, credit changes, docint approve, van sales, trip settle → all 403 —
   api-permission-probes.txt.)
Expected: credit terms narrowed to creditMode for field roles; the inbox shows messages TO the user (or is not called Inbox).
Severity: P3
Evidence: api-shapes.txt, w-17-settings.txt, api-permission-probes.txt.
```

### DOS-053 — Settings and the attention strip disagree with themselves
Category: ux | Priority: P3 | Role: Warehouse | Platform: Web

```
User: Warehouse (dinesh.patil)
Platform: Web, 1280×800
Environment: local dev, dos_qa realistic seed
Actual: Settings → "Signed-in devices" names each device by its full User-Agent string ("Mozilla/5.0 (Macintosh; Intel Mac OS X
        10_15_7) AppleWebKit/537.36 … HeadlessChrome/145…"); "Refused 0" while the attention tray holds two refused changes; the
        rail strip says "1 need attention" while the tray lists two.
Expected: "Browser on Mac" as the manager app shows; one count everywhere.
Severity: P3
Evidence: w-17-settings.txt, w-11b-attention-2.png, w-09-need-attention.png.
```

### DOS-054 — FEFO hands the picker a lot that expires in 16 days with no minimum-shelf-life rule or warning
Category: business-logic | Priority: P3 | Role: Warehouse | Platform: Web, Android

```
User: Warehouse (dinesh.patil)
Platform: Web, Android
Environment: local dev, dos_qa realistic seed
Actual: PICK-0079 line 1 = Campa Lemon 200 ml, batch B20260101, "Expires in 16 days", 96 pc for Bhosale Traders. The badge is
        amber but nothing stops or questions it; no tenant setting for a minimum remaining shelf life exists (owner Settings walk).
Expected: a per-tenant "do not ship under N days" rule (FMCG norm 30–90 days depending on category) with an override reason.
Business impact: the shop returns it in two weeks; the return, credit note and claim cost more than the sale.
Severity: P3
Evidence: w-08-pick-0079-open.png, android/a-10-pick-0078.png (87-day lot, same badge).
```

### DOS-055 — Android dev build: a React warning pops up over the whole screen on the first tap
Category: reliability | Priority: P3 | Role: Warehouse | Platform: Android

```
User: Warehouse (dinesh.patil)
Platform: Android (Pixel 7 emulator, API 36, debug APK)
Environment: local dev, dos_qa realistic seed
Steps: sign in → home renders → tap the "Pick" tab.
Actual: the first tap opens LogBox: "Console Error — Can't perform a React state update on a component that hasn't mounted yet.
        This indicates that you have a side-effect in your render function…" covering the app until "Dismiss". Dev-build only
        (LogBox does not exist in release), but the warning itself is a real render-phase side effect in the warehouse home.
Severity: P3
Evidence: android/a-02-logbox.png, android/a-02b-after-dismiss.png.
```

---

## Re-observed on the warehouse app (already filed)

- **DOS-028 (no audit rows):** adjustments (+100000!), transfers, 24 picks, the failed packs, the trip departure — audit_log has
  no row for any of them (db-08-trip-depart.txt).
- **DOS-009 (lists unsorted / capped):** Pick, Load, Stock (0-pc lots mixed in), Held.
- **DOS-025 (draft sheet needs the manager):** the sheet the manager could not find on 12 Sep is `approved` now (approved_by
  vikas.kadam 12:10) — the warehouse side then fails on DOS-039.

## Correct behaviour worth keeping (verified)

- Damage adjustment −2 with a note → ledger row (damage, actor, note), on hand 7 → 5; Move 1 pc godown → damaged bin → paired
  transfer_out/transfer_in rows, balances 4 / 1 (db-02, db-03).
- Below-zero adjustments and moves are refused by the server (delta −100, −200000).
- Warehouse role permission matrix: every desk-only and money endpoint probed answers 403; no purchase cost anywhere in the
  warehouse payloads (api-permission-probes.txt, api-stock-balances.json — mrpPaise only).
- Gate count: one line per screen, blind keypad, damaged toggle, review list, "Save the count" → GRN counted with the five
  discrepancy rows the desk needs (short 48, excess 2, damaged 2, excess 68, short 240); the warehouse cannot post it (403).
- "Take it to packing" is disabled with "N lines not yet picked"; "Pack and bill" and "Send the vehicle out" ask for confirmation
  with plain-language consequences; Cartons cannot be 0.
- Sync rejections ARE surfaced (strip + tray with retry/discard) and the web build says honestly "Held in memory only — a reload
  empties this device".
- Phone width 390 px: no horizontal scroll on Home, Pick sheet, Pack, Pack order, Load sheet, Stock (p-01…p-06).

## Not tested (and why)

- Supplier-bill capture (W2): "Photograph a page" opens the OS file chooser (camera) — headless Chromium has none; "Scan the
  e-invoice QR" needs a camera. Pick-sheet and gate "Scan": web answers "Nothing readable in frame" (no camera) — barcode picking
  NOT TESTED.
- GRN posting, cycle-count posting, reservation release, picklist cancel, load-sheet approve/cancel: desk-only by design (403
  verified), belong to the manager/owner walks.
- Challan print: no load sheet could be confirmed (DOS-039).
- Offline picking on a device (docs/23 §4.4 says not required before the pilot): NOT TESTED; the web memory adapter path was.
- iOS beyond sign-in and home (Expo Go): NOT TESTED (VoiceOver tree lists the tile labels without their numbers — note for the
  accessibility phase).
