# Delivery lane — blind check 1 (verify-1)

Branch `ux/home-delivery`, worktree `.claude/worktrees/ux-delivery`, head `e7726973` (clean, nothing edited, nothing
committed). Demo API `http://127.0.0.1:3700` (shared, not restarted), database `dos_test_ux` (read-only SQL from me; all
writes went through the product's API or the app). Web build served on :5720, headless Chromium on :9720. Screenshots
in this folder, prefix `v1-`.

**Verdict: FAIL — no blocker, one major** (the home's money figure is not what the shop owes once a credit note or any
receipt outside this trip exists; the card then asks for money that is not owed and never finishes). Everything else the
brief asks for is there and works on the web build.

## 0. Gates (run by me in the worktree, frontend/, on e7726973)

| Gate | Result |
|---|---|
| `pnpm format:check` | exit 0 — "All matched files use Prettier code style" |
| `pnpm lint --force` (no cache) | exit 0 — 6/6 tasks |
| `pnpm typecheck --force` | exit 0 — 6/6 tasks |
| `pnpm test --force` | exit 0 — ui 501, api-client 130, offline 110, admin-app 14, dos-app 675 (129 files) |
| web export | exit 0 — run with a private `TMPDIR` and `EXPO_PUBLIC_API_URL=http://127.0.0.1:3700`, `EXPO_PUBLIC_AUTH_URL=http://127.0.0.1:3700/auth`; the bundle `entry-13f44a99….js` holds 0 occurrences of `api.distributionos.in` and 2 of `127.0.0.1:3700`. Nothing was sent to distributionos.in. |

Logs: scratchpad `delivery/verify/gate-*.log`, `export-new.log`.

## 1. Rule 9 and item 12 — backend untouched, nothing removed

- `git diff --name-only 46b13020 HEAD -- backend` → 0 files.
- `git diff --name-status 46b13020 HEAD | grep '^D\|^R'` → nothing deleted or renamed.
- `git ls-tree -r --name-only main -- frontend/dos-app/app/delivery` equals the same on HEAD (13 route files: _layout,
  attention, day, expenses, index, settings, share/[invoiceId], stop/[id]/{collect,deliver,index,van-sale},
  trip/start, trips).
- The lane commit touches 17 files; its only kit change is `libs/ui/src/web/feedback.tsx` (Sheet's Close gets
  `fullWidth={false}`). Code read: D3/D4/D5 now call `door-writes.ts`; the lifted builders are field-for-field the code
  that was inline before (payload, geo proof, podWire, `deliveries.record` input, outbox twin, `collections.record`
  input, `queuedReceipt`).

## 2. Test data I made (dos_test_ux, all through the API; nothing bulk-changed)

Vehicles MH05QA1565A / MH05QA1565B; shops "QAV Anand Kirana" (ON), "QAV Bhavani Stores" (ON), "QAV Chetan Traders"
(POST_FULFILLMENT = credit, photo owed under the tenant's `delivery.pod_required = "credit_only"`), "QAV Durga General"
(ON), "QAV Eknath Kirana" (ON); orders SO-0886..0892; bills INV/9013..9019; trips **TRIP-0004** (mahesh.sutar, 4
stops, stop 1 carries two bills) and **TRIP-0005** (iqbal.shaikh, 1 stop, two bills); load sheet DC-0087 for TRIP-0004;
receipts RCPT-9007..9011; credit note CN/9003. TRIP-0004 was checked in (state `closing`); TRIP-0005 is on the road with
its one stop finished.

## 3. Walk, as a driver at 390 x 844 (desk 1280 x 800 at the marked points)

**Item 1 — landing page.** Signing in as mahesh.sutar lands on `/delivery`, "Today's deliveries". Above the list there
are NO panels: the shell's connection strip, the context line (`TRIP-0004 · MH05QA1565A · 28 Sep 2026`), the title and
ONE summary line (`0 of 4 done · ₹4,057.00 still to collect` = the five bills' sum). Before the van leaves the list is
one card "Today's load · 4 shops · 5 bills", chip Waiting → Loading → Loaded as I moved the trip on through the API
(`v1-01`, `v1-02`, `v1-03`; the chip followed within ~35 s of each change), primary "Picked up, start", disabled with
the reason printed while the godown had not started / was still loading. More is closed (count badge 5).
On the road every stop is a card: "1. QAV Anand Kirana", the address, chip Waiting, ₹2,405.00, "I am here", and on the
next one Map + Call (`v1-08`). Desk: `v1-05`, `v1-37`.

**Item 2 — start.** "Picked up, start" → the existing start screen (consent already given) → "Start the trip" → confirm
"TRIP-0004 on MH05QA1565A, 4 stops, float ₹500.00…" → home with the stops 6-10 s later (`v1-06`, `v1-07`, `v1-08`).
SQL: `trips.state = active`, `started_at 10:58:44`. 3 taps, same as the old bottom bar.

**Item 3 — stop 1, one tap.** "I am here" → toast "Arrived at QAV Anand Kirana", card → Arrived with "Delivered, all
items" + "Something different", URL still `/delivery` (`v1-09`). SQL: stop 1 `arrived`, arrived_at 10:59:12, no fix
(headless has no GPS). "Delivered, all items" → dialog "Everything delivered? / QAV Anand Kirana / INV/9013 · 72 pc /
INV/9014 · 36 pc / These bills are recorded as delivered in full at QAV Anand Kirana. You type the money next." with
"Yes, all delivered" / "Cancel" (`v1-10`; pieces match `invoice_lines`: 72 and 36). Confirm → toast "Delivered:
INV/9013, INV/9014", same card now Unpaid with Take money / No money now, page did not move (`v1-11`).

Compared with a bill delivered the old way — stop 2, INV/9015: card body → stop screen → "I am at the shop" → "Deliver
this bill" → "Record the delivery" untouched (`v1-15`..`v1-18`):

```sql
select i.invoice_no, i.state, d.outcome, coalesce(d.receiver_name,'<null>'), coalesce(d.note,'<null>'),
       d.device_id is not null, delivered_by user, o.state, s.state …  -- deliveries ⋈ invoices ⋈ orders ⋈ trip_stops
 INV/9013 | paid | delivered | <null> | <null> | t | mahesh.sutar | delivered | delivered
 INV/9014 | paid | delivered | <null> | <null> | t | mahesh.sutar | delivered | delivered
 INV/9015 | paid | delivered | <null> | <null> | t | mahesh.sutar | delivered | delivered   (old D4)
-- delivery_lines: rows = invoice lines, delivered = billed, returned 0, saleable t, reason null
 INV/9013 | 3 rows | 72 | 0 | t | 0      INV/9014 | 2 | 36 | 0 | t | 0      INV/9015 | 2 | 60 | 0 | t | 0
-- per line: same invoice_line_id, billed = delivered = ledger qty for that lot (7 of 7 lines)
-- stock_ledger ref_type='delivery', ref_id = delivery id: one 'sale' row per line, from the vehicle location
 INV/9013 sale -72 (3 rows) | INV/9014 sale -36 (2) | INV/9015 sale -60 (2)
-- pod_evidence 0 / 0 / 0, credit_notes 0 / 0 / 0, journal_entries on the delivery 0 / 0 / 0
```

The one-tap rows have exactly the shape of the old screen's rows. (Invoice state shows `paid` because the money was
taken afterwards; before the money it read `issued` on INV/9013/9014.)

**Item 4 — Take money.** The sheet opens with the amount field EMPTY (`value ""`, placeholder `0.00`) and "Still to
collect here ₹2,405.00" printed above it (`v1-12`); typed 2405 (`v1-13`), "Record the payment" → toast "Receipt
RCPT-9007", stop 1 folds to "✓ 1. QAV Anand Kirana ₹2,405.00 taken", next becomes stop 2 (`v1-14`). The field was
empty on all four openings I made (two shops, online and offline). UPI: "Record the payment" stays disabled until a UTR
is typed (`v1-34`).

```sql
 RCPT-9007 | cash | 240500 | collected | ref null | device t | mahesh.sutar | this trip | collections: cash 240500, stop 1 | allocations INV/9013=119000, INV/9014=121500 | 1 journal
 RCPT-9008 | cash |  80500 | collected | (taken on the old money screen, D5)   | collections 1 | allocations 1 | 1 journal
 RCPT-9010 | upi  |  33600 | reference UTR998877665544 | collections 1 (upi)
```

**Item 5 — Something different.** On TRIP-0005 "Something different" opens the stop screen (`v1-46`); INV/9018 →
Pieces pad → 2 pieces less on one line → reason Damaged → Record (`v1-47`..`v1-49`) → credit note CN/9003. SQL:
INV/9018 `partial`, 7 lines, 70 delivered, 2 returned, reason damaged, 7 sale ledger rows, order
`partially_delivered`, 1 credit note. Back home the card offered "Delivered, all items" again and its confirm named
ONLY the bill still open, "INV/9019 · 36 pc" (`v1-51`); confirming wrote INV/9019 `delivered`, 2 lines 36/36, 2 ledger
rows (`v1-52`). Part delivery works there.

**Item 6 — photo shop.** At QAV Chetan Traders (credit) the arrived card offers "Deliver" + "Something different",
NOT "Delivered, all items" (`v1-22`). "Deliver" opens D4 "This shop is on credit — a photo is required before you can
record it" (`v1-23`); with a photo attached (`v1-24`) it recorded; SQL: INV/9016 delivered with 1 `photo` pod_evidence
row stored under `tenant/…`.

**Item 7 — no signal.** Note: `page.context().setOffline(true)` lasts only for one `pw.mjs` process (the CDP session
ends with it), so `v1-27`, `v1-28`, `v1-28b` were NOT offline — that "I am here" at stop 4 went straight to the office.
The real offline runs were each one process:
- Stop 4 (TRIP-0004): offline confirm carries "No signal — this is held in this tab only, not saved…" (`v1-29`);
  "Yes, all delivered" → card Unpaid, pending line "1 writes are held in this tab only…", strip "1 waiting to send"
  (`v1-30`); Take money offline, field empty, typed 300 → card ₹336.00 left, "2 writes…", "2 waiting to send"
  (`v1-31`, `v1-32`); 8 s later still 2 held. Back online (`v1-33`): pending gone. SQL: INV/9017 ONE delivery,
  outcome delivered, 2 lines 24 pc, 2 ledger rows −24, order delivered; ONE receipt RCPT-9009 cash 30000 for that
  shop. No duplicates.
- TRIP-0005: offline "I am here" → card Arrived + "1 writes are held…" (`v1-44`); SQL while offline: stop `pending`
  (twice, 5 s apart); after `setOffline(false)` 15 s: `arrived 11:09:37`, pending line gone (`v1-45`).

**Item 8 — a button does not open the detail.** After every button tap (I am here, Delivered all items, Yes all
delivered, Take money, Record, No money now) the URL stayed `/delivery`. In the DOM the card body is its own
`…-open` button and the action buttons are siblings, not children. Tapping the card body opens `/delivery/stop/{id}`
(`v1-15`).

**Item 9 — after the last stop.** An "All done · Take the van back and check it in." card with "Check in the vehicle"
appears at the top (`v1-36`, desk `v1-37`) once every door is finished or its money put off. It opens `/delivery/day`
(`v1-39`); "Check the vehicle in" + confirm → SQL `closing`; the home then shows "Vehicle checked in · See end of day"
(`v1-40`). BUT when the last action is taken lower down, the new card is inserted above the scroll position, off screen,
and the toast only names the receipt (`v1-35`).

**Item 10 — More on this trip.** Before the road (`v1-04`, desk `v1-05`): This trip (state chip, vehicle chip, Money
taken today, Cash given at start, Stops), Stops in order (with planned money and state per stop), Load on board (DC-0087,
5 cartons, confirmed time), Location (tracking state and the web sentence), Add money spent. On the road (`v1-38`):
the same without the stop list (the stops ARE the list); End of day while doors are open; "Sell from the van" follows
`van_sales_enabled` exactly as before (off for this trip); Your other trips when there are any. Against the old home
(read at 46b13020): header chips → context line + More; KPI "Still to collect" → the summary line; Next stop panel and
Stops panel → the job list; the bottom bar's Start / Next stop / End day / Day summary → Picked up, start / the cards /
End of day in More + All done / See end of day; the pending sentence stays. Nothing is missing.

**Item 11 — taps, opening the app → one stop delivered in full and paid in cash.**

| | Old home (D3/D4/D5 unchanged screens, old home = row or "Next stop") | New home |
|---|---|---|
| one bill | stop row, I am at the shop, Deliver this bill, Record the delivery, Take money, Record the payment = **6 taps** + typing, and the driver is left on the stop screen (+1 "Back to the trip" = 7) | I am here, Delivered all items, Yes all delivered, Take money, Record the payment = **5 taps** + typing, still on the list |
| two bills (stop 1) | row, arrive, bill 1, Record, bill 2, Record, Take money, Record = **8** (+1 back) | **5** |
| start the trip | 3 | 3 |
| check in | 3 | 3 |

I walked the old path live on stop 2 (INV/9015) in this build; D3/D4/D5's screens are unchanged by the lane (diff read).

**Rule 7.** At 390 wide: `document.scrollWidth = 390`, no element past the right edge; card buttons 321 x 69 px, the
More toggle 358 x 69 — at or above the field floor. Words: every home button ≤ 20 characters ("Delivered, all items"
20, "Check in the vehicle" 20, "Something different" 19, "Picked up, start" 16); chips one word (Waiting, Loading,
Loaded, Arrived, Unpaid); nav Today / End of day / Money spent / Attention / Your trips / Me (`v1-41`).

## 4. Findings

### Blocker — none

### Major

**M1. The home's "what is left to collect" is not what the shop owes, and the card then asks for money that is not
owed.** `stopJob` computes it as `planned_collection_paise` minus this trip's receipts; credit notes and receipts taken
outside the trip are ignored. Measured on TRIP-0005 after the part delivery (CN/9003 = ₹64.00):
- home money sheet: "Still to collect here ₹2,404.00" (`v1-54`); the old money screen (D5, "More options") for the
  same shop at the same moment: "Owes ₹2,340.00 · Owed on the bills here ₹2,340.00" (`v1-55`, it reads
  `receivables.outstanding.get`).
- I took the ₹2,340.00 actually owed through the home sheet: RCPT-9011 allocated INV/9018 = 112500 and INV/9019 =
  121500, both invoices `paid` in SQL — yet the card stays "DO THIS NEXT · Unpaid · ₹64.00 · Take money / No money
  now" and the summary says "₹64.00 still to collect" (`v1-56`). The job never finishes: "All done / Check in the
  vehicle" does not appear until the driver taps "No money now", and that choice is forgotten on reload.
- The driver is therefore told to collect ₹64 the shop does not owe, and the only way to make the card go away is to
  over-collect. Short and damaged drops are routine, so this is a common path, not an edge. The builder recorded it
  as a backend gap; online it is not one — the same `receivables.outstanding.get` read D5 already makes would give the
  right figure (offline, the planned figure is the only one there is).

### Minor

- m1. A credit shop (POST_FULFILLMENT) turns into "Unpaid · Take money" as the next job right after delivery and its
  bill stays in "still to collect" (`v1-25`, `v1-36`: "4 of 4 done · ₹211.00 still to collect" on a checked-in trip).
  Every credit shop costs an extra "No money now" tap (declared).
- m2. "No money now" is kept only in memory; after a reload the card is back (declared, `v1-40`).
- m3. Pending line "1 writes are held in this tab only…": no singular, and "writes" is a software word on the home
  (rule 5); the confirm says "These bills are recorded…" for one bill.
- m4. When the last door's money is recorded while scrolled down, "All done / Check in the vehicle" is inserted above
  the viewport; nothing on screen or in the toast points to it (`v1-35` vs `v1-36`).
- m5. Folded done rows keep a card-tall box with the text at the top, so finished doors leave ~88 px gaps between
  one-line rows at 390 and 1280 (`v1-36`, `v1-37`).
- m6. Every waiting stop carries the same filled primary "I am here"; only the "DO THIS NEXT" eyebrow marks which one
  (`v1-08`). The money figure on a waiting card has no word saying what it is.
- m7. Money sheet reading order: "Amount taken", then "Still to collect here ₹…", then the field (kit RupeeInput).
  At 1280 the sheet is a full-width bottom sheet, and resizing the window closes it (declared).
- m8. "Picked up, start" leads to the existing start screen, whose "Cash handed to you" is pre-filled with ₹500.00
  (existing D2, not changed by this lane; noted against the founder's money rule for whoever owns D2).
- m9. Shell, not this lane: the strip "Not kept in this browser" sits on top of every home in the web build, and after
  a second offline spell it showed the earlier spell's time ("Offline since 11:04 am" at 11:05).

### Not tested

- Native Android / iOS: building is forbidden on this Mac; only the web build was walked. The kit blocks the home uses
  (JobCard, JobList, MoreGroup) have native files and the parity tests are green, which is all I can say.
- The DOS-148 refusal of the one tap (an order not on this van): not arranged.
- A geo proof row on the one tap (headless Chromium gave no location fix); the code path is the same
  `arrivalGeoProof` D4 calls.
- The JobCard tick on a failed stop (no failed stop in my data).

### Observation outside the lane

An offline (outbox) receipt lands with a `receipts` row and no `collections` row (RCPT-9009); an online one has both.
That is the existing D5 offline path (`queuedReceipt` is D5's old inline code), not something this lane changed; the
end-of-day screen still counted it (cash taken ₹3,510.00 = 2405 + 805 + 300).

## 5. Five-second test

Yes, for the common case. What helps: the list starts with the one job marked "DO THIS NEXT", the button on it is the
verb a driver says ("I am here", "Delivered, all items", "Take money"), each card's state is one word, the confirm
names the shop, the bills and the pieces, and the money field is empty. What gets in the way: four identical dark
"I am here" buttons on a fresh trip; an unlabelled rupee figure on each card; the ochre "Not kept in this browser"
strip; the "writes" sentence when offline; and M1's "Unpaid / Take money" on a shop that has paid in full.

## 6. Processes

Mine only: static server :5720 and pw-server :9720 (+ its Chromium), both stopped at the end. The demo API :3700 was
not touched.
