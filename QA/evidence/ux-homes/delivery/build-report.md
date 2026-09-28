# Delivery lane — "Today's deliveries" (founder, 2026-09-28)

Branch `ux/home-delivery` (from `ux/kit-signin` 96a44c47), worktree `.claude/worktrees/ux-delivery`, commit e7726973.
Nothing under `backend/` was changed. Walked in a headless browser against the shared demo API (:3700, `dos_test_ux`)
at 390 x 844 and 1280 x 800; screenshots are in this folder (final set: `30-*` to `45-*`; `01-*` to `21-*` are the
first walk on earlier builds of the same branch).

## 0. Read this first — the web export pointed at production

The brief's export command (`EXPO_PUBLIC_API_URL=http://127.0.0.1:3700 pnpm exec expo export …`) produced a bundle
whose API and auth URLs were `https://api.distributionos.in` and `https://api.distributionos.in/auth`. Cause: Metro's
transform cache is shared by every worktree on this Mac (`/var/folders/gc/_mk17lws45j_hln028pvm3x80000gn/T/metro-cache`)
and holds a transform of `src/config.ts` with the production `EXPO_PUBLIC_*` values inlined; the file's content is the
same in every worktree, so the cached transform is reused and the variables on the command line are ignored.

What that cost: loading that first build and pressing Sign in made the browser send ONE CORS preflight
(`OPTIONS https://api.distributionos.in/auth/auth/login`, no body, no credentials); the preflight was refused, so the
login POST itself never left. I moved the page to `about:blank` at once, and every later export ran with a private
cache (`TMPDIR=<scratchpad>/tmp`) and with `EXPO_PUBLIC_AUTH_URL=http://127.0.0.1:3700/auth` added (without it auth
defaults to `127.0.0.1:3000`, which is not the demo API). Before each later page load I checked that the bundle holds
0 occurrences of `distributionos`. **Every other lane running the brief's command is exposed to the same thing.**
Safe form:

```
TMPDIR=<own scratch dir> EXPO_PUBLIC_API_URL=http://127.0.0.1:3700 EXPO_PUBLIC_AUTH_URL=http://127.0.0.1:3700/auth \
  pnpm exec expo export --platform web --output-dir <dir>
grep -c distributionos <dir>/_expo/static/js/web/entry-*.js   # must print 0
```

## 1. What the home shows now, top to bottom

Header: the title "Today's deliveries" and one context line `TRIP-0001 · MH-05-CD-5678 · 28 Sep 2026`. No chips and
no bottom bar any more.

1. (Only while the phone's first pull is running) the existing "Still filling this phone…" line.
2. ONE summary line: `2 of 3 done · ₹1,520.00 still to collect` (or `· nothing left to collect`).
3. The job list (kit `JobList` of `JobCard`s):
   - **No trip**: the kit's empty state "No trip is out for you" with one action "Your trips", and the existing
     sentence under it.
   - **Before the van leaves** (trip planned or loading): ONE card, "Today's load" (or "Load for 29 Sep 2026" when the
     trip is for another day): `3 shops · 3 bills · 6 cartons`, chip Waiting / Loading / Loaded, primary
     **Picked up, start**. Disabled, with the reason printed under it, while the trip is still only planned ("The
     godown has not started loading your van yet") or while a load sheet is a draft or a bill of the trip is on no
     confirmed sheet ("The godown is still loading your van") — the two cases in which the office refuses `depart`.
   - **On the road**: every stop in trip order, `"{n}. {shop}"`, the address underneath, what is still to collect at
     the right, the state in one word. The first stop with work left is marked "Do this next" (kit eyebrow + accent).
     A finished stop folds to one quiet line (tick, name, what happened). When every door is done, an **All done**
     card sits at the top with **Check in the vehicle**.
   - **Checked in** (trip closing): a "Vehicle checked in" card, "The office now counts the cash and van.", **See end
     of day**; the stops stay below (a stop with money still open keeps its buttons — money is accepted until the trip
     is settled — but is not "next").
4. The pending-writes sentence (unchanged words, still `t(keepKey('pending', status.persistent))`).
5. A closed **More on this trip** (kit `MoreGroup`, remembered open/closed): This trip (state chip, vehicle chip, the
   old figures "Money taken today", "Cash given at start", "Stops"), Stops in order (before the road only — on the road
   the stops ARE the list), Load on board / Loading list (the load sheets, as before; now also sheets with no trip id
   that carry this trip's bills), Location (the tracking panel, unchanged), the buttons Sell from the van / Add money
   spent / End of day (on the road, before all done), and Your other trips. Nothing that was on the home was removed.

## 2. Every button and what it writes

| Card state | Button | What happens / what is written |
|---|---|---|
| load, ready | **Picked up, start** | Opens `/trip/start?tripId=…` — the existing start flow, consent step and confirm unchanged. After `depart` succeeds the start screen now pulls (`pullAfterDoorstepWrite(engine, 'trip departed')`) before it goes home, so the home shows the stops within seconds instead of after the next poll (measured: over a minute before, 10 s after). |
| waiting | **I am here** | `useArrive` → `arrivalFix(platform.location.current)` → `useMoveStop({ state: 'arrived', lat?, lng? })`: the same `trip_stops` PATCH through the outbox that D3's "I am at the shop" makes (D3 now calls the same `arrivalFix`). Works with no signal. Toast "Arrived at {shop}". |
| waiting, next | **Map** / **Call** | Only when the shop has a pin / a phone number: `links.open(mapsUrl)` / `tel:` — D3's own two. No write. |
| here, no photo owed | **Delivered, all items** | Opens ONE confirm naming the shop, each open bill and its pieces ("INV/9007 · 72 pc") and "These bills are recorded as delivered in full at {shop}. You type the money next." (plus the keep sentence when offline). **Yes, all delivered** → `useDeliverAll`: with a signal, reads each bill's order (`orders.get`) and refuses before writing anything if the office would (DOS-148, D4's gate); then for each open bill `deliveryLinePayload(lines, {}, uuidv7)` (every piece in, nothing back), `arrivalGeoProof(stop)`, and `recordOrSave` — `deliveries.record` with a signal, the SAME delivery as one `deliveries` outbox op without one or when the office never answers. Exactly D4's full-bill write (same functions; a test pins that the payload equals D4 opened and recorded untouched). Disabled with a reason until the phone has finished its first pull and holds every line of every bill. |
| here, photo owed (credit shop under `credit_only`, or policy `always`) | **Deliver** | Opens D4 (`/stop/{id}/deliver?deliveryId=…`) on the first open bill; the photo cannot be skipped. Same rule as D4 (`pod.ts`). |
| here | **Something different** | Opens the stop screen (D3): part delivery, refused, returned, nothing delivered, van sale. |
| here, no bill of its own | **Take money** / **Open this shop** | Old dues or a van-sale stop: the money sheet, or D3. |
| money | **Take money** | Opens a sheet on the home: Cash / UPI / Cheque, the amount field EMPTY with "Still to collect here ₹…" printed above it (never pre-filled), the UTR / cheque number where the mode needs one, one line on where the money goes, **Record the payment**. Writes exactly what D5 writes (`collectionRecordInput` → `collections.record` with a signal; `queuedReceipt` → one `receipts` outbox op without). A cheque takes today's date (D5's default). **More options** opens D5 for tagging a bill, a cheque date, the bank or the book number. |
| money | **No money now** | Records nothing. The card stays exactly as it is (and can still take money); for as long as the app is running it stops being "Do this next", so the next shop is. Toast "Nothing recorded for {shop}". |
| all done | **Check in the vehicle** | Opens D8 (`/day`) — the existing check-in. |
| checked in | **See end of day** | Opens D8 for this trip. |
| any card body | (tap) | Opens the stop screen that exists today, finished stops included. |

After a write the card changes in place: an office-answered write pulls (`pullAfterDoorstepWrite`), a kept write
changes the device's own row on the instant. The list keeps its order (trip sequence) and never reloads to the top.
Toasts: "Arrived at {shop}", "Delivered: INV/9007", "Receipt RCPT-9005"; offline "Held in this tab only…" /
"Receipt 01a0e64d held in this tab only" through `keepKey` (the web build here has no persistent store).

Verified in the database after the walk (`dos_test_ux`): INV/9007 delivered, 4 lines, every line delivered in full,
0 returned; SO-0879 delivered; RCPT-9005 cash ₹1,190.00 with its `collections` row and stop; the OFFLINE full
delivery of INV/9008 (36 pc) and the OFFLINE receipt RCPT-9006 ₹500.00 reached the office when the browser came back
online; the failed stop recorded through D3 as "Shop was shut".

## 3. Taps for each core job, before → after

| Job | Before | After |
|---|---|---|
| Arrived at a shop | home → stop row → "I am at the shop": 2 taps, 1 screen change | **I am here** on the card: 1 tap |
| Delivered in full | home → stop → "Deliver this bill" (only with one open bill, else the bill row) → D4 "Record the delivery": 3 taps, 2 screens, one bill at a time | **Delivered, all items** + **Yes, all delivered**: 2 taps on the home, every open bill of the stop |
| Take the money | home → stop → "Take money" → type → "Record the payment": 3 taps + typing, 2 screens | **Take money** → type → **Record the payment**: 2 taps + typing, on the home |
| Credit shop (photo) | home → stop → "Deliver this bill" → D4 | **Deliver** → D4: 1 tap |
| Start the trip | bottom bar "Start this trip" → start screen → "Start the trip" → confirm: 3 | **Picked up, start** → start screen → "Start the trip" → confirm: 3 (the consent and the confirm stay, as decided); the card now says whether the godown has finished |
| Check in | bottom bar "Check in the vehicle" → D8 → "Check the vehicle in" → confirm: 3 | **Check in the vehicle** on the All done card → the same: 3 |

## 4. Words replaced (old → new)

Navigation (rail / ⋯ sheet, still ≤ 14 characters; each now names its screen the way the screen names itself):
- "Day summary" → "End of day"
- "Expenses" → "Money spent" (and the D7 title "Expenses" → "Money spent", so the two agree)
- "Trip history" → "Your trips" (the screen was already titled "Your trips" and also lists planned trips)
- "Today", "Attention", "Me" unchanged.

Home:
- "Today's trip" → "Today's deliveries"
- "Start this trip" (bottom bar) → "Picked up, start" (on the load card). The brief's "Picked up, start trip" is 21
  characters, one over rule 5; "trip" was dropped. Say the word and it becomes "Loaded, start trip" (18) instead.
- "Next stop" (bottom bar + panel) → the card's own verb: "I am here" / "Delivered, all items" / "Deliver" / "Take
  money", with the kit's "Do this next" on the one to do now
- "Something is different" (brief, 22 characters) → "Something different" (19)
- "Check in the vehicle" (bottom bar) → same words, on the All done card; the early check-in in More is "End of day"
- "End of day" (closing-state bottom bar) → "See end of day"
- "Float at start" → "Cash given at start"; "Collected today" → "Money taken today"
- "Add an expense" → "Add money spent"; "Load sheet" → "Loading list"
- Header chips "On the road" / "0 of 3 stops done" / vehicle → gone from the header (the context line carries the trip,
  the vehicle and the date; the chips are in More → This trip); KPI strip "Still to collect / Collected today / Float at
  start / Stops" → one line "{done} of {total} done · {amount} still to collect", the rest in More
- In the money sheet: "The office allocates this receipt when it reaches them — oldest bill first: a tag needs a
  signal." → "When it reaches the office, it goes on the oldest bill the shop owes. Choosing a bill needs a signal.";
  the disabled reason "Amount taken" → "Type the money you took"
- New one-word chips: Waiting, Loading, Loaded, Arrived, Unpaid.

`home.test.ts` holds every home button to ≤ 20 characters, every chip to one word, the nav to ≤ 14 and to its screen's
title, no home string naming the device (keeps go through `keepKey`), and no office words (float, expense, load sheet,
settle, allocate, outstanding, ledger, sync, pending) on the home or in the navigation.

## 5. Code

- `src/groups/delivery/lib/door-writes.ts` (new, pure): what D3, D4 and D5 built inline — `deliveryLinePayload`,
  `arrivalGeoProof`, `podWire`, `deliveryRecordInput`, `queuedDelivery`, `collectionRecordInput`, `queuedReceipt`,
  `moneyNeedsReference`, `receiptNumber`, `arrivalFix`, `billedPieces`. D4 (`deliver.tsx`), D5 (`collect.tsx`) and D3
  (`stop/[id]/index.tsx`) now call these; their behaviour is unchanged.
- `lib/home.ts` (new, pure): `stopJob`, `nextJobId`, `allDoorsDone`, `homeSummary`, `doorNeedsPhoto`,
  `billsToDeliver`, `readyToDeliverAll`, `sheetsForTrip`, `sheetOrderIds`, `loadReadiness`, `cartonsLoaded`, the
  "No money now" memory, and the label lists.
- `lib/home-writes.ts` (new): `useArrive`, `useDeliverAll`, `useTakeMoney` — the same calls, through the same paths.
- `lib/home-sheets.tsx` (new): the one confirm and the money sheet, kit components only.
- `lib/stop-state.ts` (new): `isStopTerminal`, re-exported by `local.ts` so nothing else changes.
- `lib/local.ts`: read hooks `useLocalInvoiceLinesOf`, `useLocalDeliveryLinesOf`, `useLocalLoadSheets`.
- `app/delivery/index.tsx`: the home, rewritten on `JobList` / `JobCard` / `MoreGroup`.
- `app/delivery/trip/start.tsx`: one pull after `depart` (above).
- `libs/ui/src/web/feedback.tsx` (kit, web only, for the kit lane to review): the web `Sheet`'s Close button is
  `fullWidth={false}`. Off the desk a kit `Button` fills its row, and in the sheet header that squeezed every title to
  one word per line ("Take / money", screenshots 11 and 16). The native Sheet puts Close at the bottom and was not
  affected. Kit tests 501/501.

## 6. Tests changed and why

- `dos-070-geo-proof.test.ts` — updated deliberately, not weakened. The `geo` proof row moved from `deliver.tsx` into
  `arrivalGeoProof` (door-writes.ts) because the home's one-tap must write what D4 writes (founder, 2026-09-28; the
  comment in the test says so). The pin now checks that D4 builds the row through that function, that the function is
  gated on the arrival fix, and that neither asks the phone for a fix of its own (two assertions added); the gating
  itself is also run in `door-writes.test.ts`.
- `dos-179-trip-close.guard.test.ts` — unchanged and green: the new home still prints the pending sentence through
  `keepKey('pending', status.persistent)`.
- New: `door-writes.test.ts` (payloads field by field; "Delivered, all items" equals D4 recorded untouched; geo only with
  a fix; money inputs per mode; offline twins; arrival never blocks), `home.test.ts` (card states incl. offline-held and
  refused bills, next/all-done/summary, photo rule, bills named in the confirm, load readiness, the words),
  `home-screen.guard.test.ts` (source pins: job list first with More below and no dashboard/bottom bar; every card write
  goes through the lifted functions and so do D3/D4/D5; money typed never pre-filled; the confirm names shop, bills,
  pieces; photo-owed shops get "Deliver" → D4; the one tap waits for the fill; the start screen pulls after depart; no
  English literal in the home or its sheets).

## 7. Gates (in the worktree)

All run in `frontend/` of the worktree on the committed tree:

| Gate | Exit |
|---|---|
| `pnpm format` | 0 |
| `pnpm format:check` | 0 |
| `pnpm lint` | 0 |
| `pnpm typecheck` | 0 |
| `pnpm test` | 0 — ui 501, api-client 130, offline 110, admin-app 14, dos-app 675 passed. One earlier full run had ONE timeout in `src/groups/retailer/lib/dos-102-last-distributor-restart.guard.test.ts` (5 000 ms limit, machine load average 13); that file passed alone (3 tests, 3.3 s) and the full rerun was green. Not touched by this lane. |
| web export of dos-app | 0 — with a private Metro cache and `EXPO_PUBLIC_AUTH_URL` set (see §0); the bundle checked for 0 `distributionos`. |

## 8. What I could not do, and why

1. The production-URL incident in §0 (one refused CORS preflight to `api.distributionos.in`).
2. Native (Android / iOS) NOT TESTED: the brief forbids building them on this Mac; only the web build was walked.
3. Two labels of the brief were over rule 5's 20 characters and were shortened (§4).
4. "What is left to collect" is the office's plan for the stop (`planned_collection_paise`) less this trip's receipts at
   that shop. A credit shop planned at its bill total therefore shows "Take money" after delivery (the driver answers
   "No money now"), and a bill settled at the desk after planning still counts. BACKEND GAP: the device has no per-stop
   "still owed here" figure (no allocations are pulled; D5 asks `receivables.outstanding.get` online).
5. The proof-of-delivery policy is not on the device: it comes from `delivery.trips.get` (`TripDetail.policy.podRequired`)
   and with no answer both D4 and the home assume `credit_only`. Under a tenant policy of `always`, a phone that never
   got that answer would offer the one tap at a cash shop and the office would refuse it into the tray. BACKEND GAP:
   `delivery.pod_required` on a pulled table (the trip row, or tenant settings in the manifest).
6. "No money now" is remembered only for the running app; a browser reload forgets it and the card is "Do this next"
   again. Nothing is written either way, as the brief says.
7. Kit, for the kit lane: the `JobCard` done row always draws a green tick, including for a stop that was not delivered
   ("Shop was shut"), and gives the state text priority over the name — at 390 px a full line left "1. Shiva…". The home
   works around the second on phones (the one fact that matters: the money taken, or what went wrong; the full line on a
   desk). On a desk viewport the delivery group's `Sheet` is a full-width bottom sheet (field density).
8. "1 writes are still on this phone" — `d8.pending` has no singular form; adding one needs a new keep pair and a
   classification in `libs/offline`'s DOS-179 guard, left alone.
9. Not exercised live: the DOS-148 refusal of the one tap (an order not on this van), and completing D4's photo in a
   headless browser. The rule is the existing `doorstepOrderBlock`, called before any write.
10. Rows created in `dos_test_ux` (all mine, nothing bulk-changed): shops Shivam Kirana Stores, Siddhi Provision, Om
    Namo Traders (owner name "QA ux-delivery"); orders SO-0879..0881, SO-0883..0885; invoices INV/9007..9012; trips
    TRIP-0001 (santosh.kamble, checked in), TRIP-0002 (tanaji.bhosale, on the road), TRIP-0003 (raju.yadav, on the
    road); receipts RCPT-9005 and RCPT-9006.

## 9. Screenshot index

Final build (the committed code, bar formatting):
- `36`/`37` checked-in home, phone / desk · `38`/`39` before the road, godown still loading (desk with More open) ·
  `40`/`41` before the road, loaded · `44` loaded (third driver) · `45` the home 10 s after "Start the trip" with the
  new pull — the stops are there.
- `30`/`31`/`32` on the road: finished doors as one line (phone compact / desk full), "No money now", All done ·
  `34` money sheet (cheque) with the web Sheet title fixed.

Earlier builds of the same branch (kept as the record of the walk and of what was fixed):
- `01`–`05` before the road (waiting, loading, loaded, More open) · `06`/`07` on the road, phone / desk · `08` I am
  here + toast · `09` the one confirm · `10` delivered, card now Unpaid · `11`–`13` money sheet empty / typed /
  recorded (title still broken into two lines) · `14`–`17` the same with NO signal (keep sentences via keepKey) ·
  `18` No money now · `19`/`20` credit shop gets Deliver → D4 · `21` All done (subtitle and phone done-line still
  clipped; fixed in `30`–`31`) · `33` desk money sheet before the Sheet fix · `35` desk after the sheet closed on
  resize · `42`/`43` taken right after "Start the trip" BEFORE the start screen pulled: the load card still showed for
  over a minute — the reason for the pull in `trip/start.tsx`.
- `00-before-login` is the welcome page of the misconfigured first export (§0); no signed-in screen exists from it.

## Repair (after verify-1)

Commit `2b36a11e` on `ux/home-delivery` (on top of e7726973). Nothing under `backend/` changed. Walked on a fresh web
export (private Metro cache, `EXPO_PUBLIC_AUTH_URL` set, bundle checked for 0 `distributionos`) at 390 x 844 and
1280 x 800 against the shared demo API; screenshots `r1-*` in this folder.

| Finding | What changed | Seen |
|---|---|---|
| **M1** money figure ignored credit notes | `leftToCollect()` in `lib/home.ts`: the stop's plan, less the face of any bill that did not go in (`failed`), less the credit notes against the stop's bills (the device's own `credit_notes` table, states issued/applied), less every receipt this trip holds for the shop; never more than what the shop owes in all (`retailer_outstanding_summary` outstanding + undelivered, so a bill re-planned after coming back on a van is not capped away) less the receipts still on the phone. All of it is on the device, so it works with no signal. New read hooks `useLocalCreditNotesOf`, `useLocalOutstandingOf`. | TRIP-0005 (the check's own case, CN/9003): the card is now "✓ Part delivered", "1 of 1 done · now check in the vehicle", All done shown (`r1-01`). New TRIP-0006: after a 2 pc short drop on INV/9021 (CN/9004 ₹64), the card said "To collect ₹1,109.00", the same as D3's "Owes ₹1,109.00" (`r1-12`); the sheet showed ₹1,109.00 (`r1-14`); paying ₹1,109.00 (RCPT-9013) finished the card at once (`r1-15`). SQL: INV/9021 and INV/9022 `paid`, shop outstanding 0. |
| m1 credit shop asked for money | `onCreditTerms()` (POST_FULFILLMENT and credit not stopped): the bills go on the account; only what the planner added over them is asked. The card shows "On credit ₹210.00" before, folds to "On credit" after, and is out of "still to collect". A shop whose credit is stopped is still asked (DOS-066). | `r1-04` summary ₹2,193.00 excludes the credit bill; `r1-18` "✓ 3. QAR Chandan Traders · On credit" right after the photo delivery. |
| m2 No money now forgotten on reload | `lib/put-off.ts`: the list is also kept in the device's storage per driver for ONE trip (the next trip starts empty); nothing goes to the office. | `r1-23`: after a reload stop 4 is still put off and All done stays. |
| m3 "1 writes are held…" / "These bills" for one | New keep pair `homePending` → `d1.pending` / `d1.pendingTab` ("1 waiting to send. Held in this tab only, not saved — it goes when there is a signal; close this tab and it is gone."), still through `keepKey(...)`; D8 keeps `d8.pending`. `home.confirmBody.one` ("This bill is recorded…"). | `r1-19` offline arrive; `r1-06` one-bill confirm. |
| m4 All done inserted above the viewport | All done is now the LAST card (the last job), and the summary line says "now check in the vehicle" once every door is over ("… · ₹384.00 not taken · …" when money was put off). | `r1-25`: last money taken with the list scrolled down → the card appears in view right under the last stop (top 519 of 844). |
| m5 folded rows looked like gaps | Kit `JobCard` done row (web and native): a faint outline, touch floor unchanged. | `r1-26` phone, `r1-27` desk. |
| m6 every waiting card had a filled button; figure unlabelled | Only the next card carries a primary; other cards keep their step as an outlined secondary. The door the van is at is always next. The figure reads "To collect ₹…" or "On credit ₹…". | `r1-04` phone, `r1-05` desk. |
| m7 sheet reading order | Kit web `RupeeInput` prints the expected block ABOVE the field's label (native shows it on its pad already). Affects every web money field that passes `expected` (D5, van sale, manager day-end), in the same direction. | `r1-08` sheet, `r1-28` D5. |
| m7 desk bottom sheet / closes on resize | Not changed: kit `Sheet` behaviour. | — |
| m8 D2 float pre-filled ₹500 | Not changed: the brief keeps the start screen as it is, and DOS-146 (founder default 2026-09-13) made the untouched field send nothing so the office's float stands. For the architect: whether the founder's "money is always typed" covers the float. | — |
| m9 shell strip | Not this lane. | — |

Words changed: "{count} writes are still on this phone" → "{count} waiting to send…" (home only); "These bills are recorded" → "This bill is recorded" for one bill; new "To collect", "On credit", "{amount} on credit", "now check in the vehicle".

Tests: `home.test.ts` (M1 case with the check's own figures, failed bill, whole return, cap, agreed old dues, credit terms, credit-note states, the door you are at is next, summary keys, "writes"/"queue"/"outbox" added to the forbidden words), `put-off.test.ts` (new). Guards updated deliberately, not weakened: `dos-179-trip-close.guard.test.ts` pins the home's sentence to `keepKey('homePending', status.persistent)` and D8's to `keepKey('pending', …)`; the libs/offline keep-claims register classifies `d1.pending` as a keep; `home-screen.guard.test.ts` pins the one/many confirm sentence; the kit render test pins the expected figure before the label.

Gates (worktree `frontend/`, committed tree): `pnpm format` 0 · `pnpm format:check` 0 · `pnpm lint` 0 · `pnpm typecheck` 0 · `pnpm test` 0 (ui 501, api-client 130, offline 110, admin-app 14, dos-app 689; the first full run had one 5 s timeout in the untouched `retailer/lib/dos-102-last-distributor-restart.guard.test.ts` at load average 12, it passed alone and on the full rerun) · web export 0.

Rows I created in `dos_test_ux` (API only): vehicle MH05QR9928; shops QAR Asha Kirana, QAR Balaji Stores, QAR Chandan Traders (credit), QAR Dhanraj General; bills INV/9020..9024; TRIP-0006 for mahesh.sutar dated 29 Sep (his TRIP-0004 of 28 Sep is still `closing`, so the office refused a second trip that day), left `active` with every door done; CN/9004; RCPT-9012..9014. Processes: static server :5720 and browser :9720, both stopped. An orphaned `pw-server.mjs` (pid 50599, PW_PORT=9720, no Chromium, started 10:53 before this run) was left alone.

Not tested: native Android/iOS (building is forbidden on this Mac). The home money sheet was walked at 390 only (the desk sheet is the kit's unchanged bottom sheet); D5's new field order was looked at at 390 only.
