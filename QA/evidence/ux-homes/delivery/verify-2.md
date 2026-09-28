# Delivery lane — blind check 2 (verify-2, after the repair)

Branch `ux/home-delivery`, worktree `.claude/worktrees/ux-delivery`, head `2b36a11e` (clean before and after; nothing
edited, nothing committed). Demo API `http://127.0.0.1:3700` (shared, not restarted), database `dos_test_ux` (read-only
SQL from me; every write went through the product's API or the app). Web build served on :5720, headless Chromium on
:9720 (both mine, both stopped at the end). Screenshots in this folder, prefix `v2-`.

**Verdict: PASS — no blocker, no major.** Verify-1's major (M1) is fixed and measured on a fresh trip; m1–m6 are fixed,
m7 is fixed on the phone (the desk sheet is unchanged, declared), m8 and m9 remain as declared (not this lane). Four new
minors below.

## 0. Gates (run by me in the worktree, `frontend/`, on 2b36a11e)

| Gate | Result |
|---|---|
| `pnpm format:check` | exit 0 — "All matched files use Prettier code style!" |
| `pnpm lint --force` | exit 0 — 6/6 tasks, 0 cached |
| `pnpm typecheck --force` | exit 0 — 6/6 tasks, 0 cached |
| `pnpm test --force` | exit 0 — ui 501, api-client 130, offline 110, admin-app 14, dos-app 689 (130 files); no timeout this time |
| web export | exit 0 — `TMPDIR=<private>`, `EXPO_PUBLIC_API_URL=http://127.0.0.1:3700`, `EXPO_PUBLIC_AUTH_URL=http://127.0.0.1:3700/auth`; bundle `entry-abd25e74….js`: 0 × `distributionos`, 1 × `127.0.0.1:3700`, 1 × `127.0.0.1:3700/auth`. Nothing was sent to distributionos.in. |

Logs: scratchpad `delivery/verify2/gate-*.log`, `gates.txt`, `export.log`.

## 1. Item 12 — backend untouched, nothing removed

- `git diff --name-only main...HEAD -- backend` → 0; the two lane commits (`96a44c47..HEAD`) touch only
  `frontend/dos-app/app/delivery`, `…/src/groups/delivery`, `libs/offline/src` (a guard test) and `libs/ui/src/{web,native}`.
- `git diff --name-status main...HEAD` → no `D` or `R` line.
- `git ls-tree -r --name-only` of `frontend/dos-app/app/delivery` on main and on HEAD are identical (13 route files).
- The repair's lines removed from `index.tsx` (`git diff e7726973 2b36a11e`) are only the old money memo, the old
  summary key and the old pending key; nothing in "More on this trip" was removed.

## 2. Test data I made (dos_test_ux, all through the API)

Driver **santosh.kamble** (his only open trip was the builder's TRIP-0001, `closing`, so a new planned/active trip is the
one his home picks). Vehicles MH05QW3107, MH05QG…; shops "QAW Aarti Kirana", "QAW Bhole Stores", "QAW Chaitanya
Traders" (POST_FULFILLMENT = credit, photo owed under `delivery.pod_required = "credit_only"`), "QAW Dev General", "QAW
Ekta Kirana", "QAW Fatima Stores" (plus an older bill INV/9032 on no trip = old dues), "QAW Gauri Kirana", "QAW Hari
Stores", "QAW Indu Kirana", "QAW Jyoti Stores"; bills INV/9025..9036; **TRIP-0007** (29 Sep, 6 stops, stop 1 carries two
bills, load sheet DC-0089) — checked in (`closing`); **TRIP-0008** (30 Sep, 2 stops) — checked in; **TRIP-0009** (1 Oct,
2 stops, walked with a location fix) — `active`, every door done and paid; receipts RCPT-9015..9023; credit note CN/9005.
Nothing bulk-changed; no other lane's rows touched.

## 3. Walk as a driver at 390 × 844 (desk 1280 × 800 where marked)

**Item 1 — landing page.** Sign-in lands on `/delivery`. Above the list: the shell strip, the context line
`TRIP-0007 · MH05QW3107 · 29 Sep 2026`, the title and ONE summary line `0 of 6 done · ₹5,502.00 still to collect`
(= the five cash shops 2405 + 805 + 846 + 636 + 810; the credit shop's ₹211 is left out, m1). No panel. Before the road
one card "Load for 29 Sep 2026 · 6 shops · 7 bills", chip Waiting → Loading → Loaded (7 cartons) as I moved the trip on
through the API (`v2-01`, `v2-02`, `v2-03`, ~60 s per change), "Picked up, start" disabled with its reason until loaded.
On the road (`v2-07`) each stop is a card: "1. QAW Aarti Kirana", address, chip Waiting, "To collect ₹2,405.00", and
ONLY the next card has a filled "I am here" (+ Map, Call); the others carry an outlined "I am here"; the credit shop reads
"On credit ₹211.00" (m6 fixed). At 390: `scrollWidth = 390`, 0 elements past the right edge, card buttons 321–324 × 69,
Map/Call 151 × 69. Desk: `v2-46`, `v2-56` (`scrollWidth = 1280`).

**Item 2 — start from the home.** "Picked up, start" → start screen (consent already given; "Cash handed to you" shows
₹500.00, m8) → "Start the trip" → confirm "TRIP-0007 on MH05QW3107, 6 stops, float ₹500.00…" → home with the six stops at
once (`v2-05`, `v2-06`, `v2-07`). SQL: `TRIP-0007 | active | started 12:09:24`. 3 taps.

**Item 3 — stop 1, one tap.** "I am here" → toast "Arrived at QAW Aarti Kirana", chip Arrived, buttons "Delivered, all
items" + "Something different", URL `/delivery` (`v2-08`). "Delivered, all items" → dialog "Everything delivered? / QAW
Aarti Kirana / INV/9025 · 72 pc / INV/9026 · 36 pc / These bills are recorded as delivered in full at QAW Aarti Kirana.
You type the money next." (`v2-09`) → "Yes, all delivered" → toast "Delivered: INV/9025, INV/9026", same card now Unpaid
with Take money / No money now (`v2-10`). For one bill the body reads "This bill is recorded…" (`v2-42`, m3 fixed).

Old-way comparison: stop 2 (INV/9027) by card body → D3 "I am at the shop" → "Deliver this bill" → D4 "Record the
delivery" untouched (`v2-14`..`v2-17`). And on TRIP-0009, WITH a location fix (CDP grant + override 19.2437, 73.1305),
INV/9035 by the one tap and INV/9036 the old way. SQL (`scratchpad/delivery/verify2/cmp.sql`, outputs `cmp-1..3.txt`):

```
-- deliveries: outcome, receiver/note null, device set, delivered_by, order state, stop state
 INV/9025 | delivered | t | t | t | santosh.kamble | delivered | delivered   (one tap)
 INV/9026 | delivered | t | t | t | santosh.kamble | delivered | delivered   (one tap)
 INV/9027 | delivered | t | t | t | santosh.kamble | delivered | delivered   (old D4)
 INV/9031 | issued (no money yet) | delivered | … | delivered              (one tap)
 INV/9033 / INV/9035 (one tap) and INV/9034 / INV/9036 (old D4): identical rows, all `issued` before money
-- delivery_lines: every line delivered = billed + free, returned 0, reason null
 INV/9025 2 lines 72 | INV/9026 1 line 36 | INV/9027 2 lines 60 | INV/9035 1 line 24 | INV/9036 1 line 24
-- stock_ledger ref_type 'delivery': one 'sale' row per line, all from the van's location, one key each
 INV/9025 -72 (2) | INV/9026 -36 (1) | INV/9027 -60 (2) | INV/9035 -24 (1) | INV/9036 -24 (1)
-- pod_evidence / credit notes / journal entries on the delivery
 INV/9025, 9026, 9027: 0 / 0 / 0
 INV/9035 (one tap): 1 geo row 19.2437, 73.1305 | INV/9036 (old D4): 1 geo row 19.2437, 73.1305; both stops arrived_lat/lng set
```

The one tap writes exactly what the old screen writes, including the geo proof (verify-1 could not test that).

**Item 4 — Take money.** The sheet opens with the field EMPTY (`value ""`, placeholder `0.00`); "Still to collect here
₹2,405.00" now sits ABOVE "Amount taken" (`v2-11`, m7 fixed on the phone). Typed 2405 (`v2-12`) → "Record the payment" →
toast "Receipt RCPT-9015", the door folds to "✓ 1. QAW Aarti Kirana ₹2,405.00 taken" (`v2-13`). The field read `""` on six
openings (stop 1, stop 4 twice, stop 5 offline, stop 6 on the desk, TRIP-0008 stop 1); on the other four the recorded
amount equals exactly what I typed (RCPT-9019 33600, 9021/9022/9023 76800), which a pre-filled value would have broken.
UPI: "Record the payment" disabled until the UTR is typed (`v2-52`). SQL (`rcpt.sql`):

```
 RCPT-9015 | cash   | 240500 | collected | device | TRIP-0007 | collections cash 240500 stop 1 | INV/9025=119000, INV/9026=121500 | 1 journal
 RCPT-9016 | cash   |  80500 | (old D5 at stop 2)            | collections 1 | INV/9027=80500 | 1 journal
 RCPT-9017 | cash   |  79300 | (home sheet, stop 4)          | collections 1 | INV/9029=79300 | 1 journal
 RCPT-9020 | upi    |  76800 | reference 717905785492         | collections upi    | INV/9033
 RCPT-9021 | cheque |  76800 | reference 131469, cheque_date 2026-09-28 | collections cheque | INV/9034
```

**Item 5 — Something different.** Stop 4 "Something different" → D3 (`v2-25`) → "Deliver this bill" → Pieces pad → two
pieces less on Marie → reason Damaged → Record (`v2-26`..`v2-29`). SQL: INV/9029 outcome `partial`, 2 lines, 46
delivered, 2 returned, reason 1, order `partially_delivered`, stop `partial`, CN/9005 issued ₹53.00; ledger −24, −24 from
the van and +2 into the damaged bin (`sale_return_damaged`, ref CN/9005). Part delivery works there.

**M1 re-check (verify-1's major).** Back home the card reads "Unpaid · To collect ₹793.00" (`v2-30`) = ₹846.00 − CN
₹53.00; the home sheet says "Still to collect here ₹793.00" (`v2-31`) and D5 (More options) says "Owes ₹793.00" for the
same shop at the same moment (`v2-32`); `retailer_outstanding_summary.outstanding_paise = 79300`. I took ₹793.00 through
the home sheet (field empty first) → RCPT-9017 → the card folded at once to "✓ 4. QAW Dev General · Part delivered" and the
summary dropped to ₹1,446.00 (`v2-33`). **Fixed.** Code read (`leftToCollect` in `lib/home.ts`): plan − face of `failed`
bills − issued/applied credit notes − this trip's receipts, capped by `outstanding + undelivered − receipts still on the
phone`; the tables it reads (`credit_notes`, `retailer_outstanding_summary`) are in the delivery role's sync manifest, and
the summary is refreshed in the same transaction as every posting (invoice issue, receipt, credit note), so the cap is
not stale-low after a bill is issued.

**Item 6 — photo shop.** At QAW Chaitanya Traders (credit) the arrived card offers "Deliver" + "Something different",
never "Delivered, all items" (`v2-20`). "Deliver" opens D4: "This shop is on credit — a photo is required before you can
record it", Record disabled (`v2-21`); with a photo (file chooser) it records (`v2-22`, `v2-23`). SQL: INV/9028 delivered,
1 `photo` pod_evidence row under `tenant/…`. Back home the door folds to "✓ 3. QAW Chaitanya Traders · On credit" and is
not in "still to collect" (`v2-24`, m1 fixed).

**Item 7 — no signal** (one `pw.mjs` process, `offline.js`, `offline-run.txt`). `setOffline(true)` → strip "Offline since
12:17 pm". "I am here" at stop 5 → toast "Arrived at QAW Ekta Kirana", pending line "1 waiting to send. Held in this tab
only, not saved — it goes when there is a signal; close this tab and it is gone." (m3 fixed), SQL stop still `pending`
(`v2-35`). Confirm carries "No signal — this is held in this tab only…" (`v2-36`); "Yes, all delivered" → "2 waiting to
send", SQL outcome null / 0 lines (`v2-37`). Take money, field empty, typed 300 → card "To collect ₹336.00", "3 waiting to
send", SQL 0 receipts after 8 s (`v2-38`, `v2-39`). `setOffline(false)` → pending line gone within seconds (`v2-40`). SQL:
stop `delivered`; INV/9030 exactly ONE delivery row, 1 line 24 pc, ONE ledger row −24; exactly ONE receipt RCPT-9018 cash
30000 (allocated INV/9030). Card still "₹336.00" after reconnect (no double count). Then ₹336 through the home → RCPT-9019,
door folds "₹636.00 taken" (`v2-41`). No duplicates.

**Item 8 — a button does not open the detail.** After every card button (I am here, Delivered all items, Yes all
delivered, Take money, Record, No money now, the outlined Take money on a non-next card) the URL stayed `/delivery`.
DOM: the card body is its own `…-open` button; `open.contains(actionButton)` is false; `button button` count 0. Native
`JobCard` (code read): body `Pressable` and the actions `View` are siblings, not nested. The outlined "Take money" on a
card that is not next opened the sheet for THAT shop (QAW Jyoti Stores, RCPT-9022 → INV/9036).

**Item 9 — after the last stop.** Stop 6: one tap (INV/9031) then "No money now" → toast "Nothing recorded for QAW
Fatima Stores"; the "All done · Take the van back and check it in · Check in the vehicle" card appears as the LAST card,
in view (top 629 of 844) right under the last stop, and the summary says "6 of 6 done · ₹810.00 not taken · now check in
the vehicle" (m4 fixed). After a full reload the put-off is kept and All done stays (`v2-44`, m2 fixed). Done rows now
carry a faint outline (`v2-44`, desk `v2-46`, m5 fixed). "Check in the vehicle" → D8 (`v2-48`: hand ₹5,139.00 = float 500 +
cash 4,639) → "Check the vehicle in" + confirm → SQL `TRIP-0007 closing`. Same for TRIP-0008.

**Item 10 — More on this trip.** Before the road (`v2-04`): This trip (state chip, vehicle chip, Money taken today, Cash
given at start, Stops), Stops in order (planned money and state per stop), Load on board (DC-0089, 7 cartons, confirmed
12:06 pm), Location, Add money spent, Your other trips (TRIP-0001). On the road (`v2-45`): the same without the stop list,
Money taken today ₹4,639.00 (= 2405 + 805 + 793 + 300 + 336); End of day shows while doors are open and gives way to the
All done card after. Nothing of the old home is missing (the repair removed nothing from it).

**Item 11 — taps, opening the app → one stop delivered in full and paid in cash** (walked live both ways in this build):

| | Old home (row → D3 → D4 → D5) | New home |
|---|---|---|
| one bill | row, I am at the shop, Deliver this bill, Record the delivery, Take money, Record the payment = **6** + typing (+1 "Back to the trip" = 7) | I am here, Delivered all items, Yes all delivered, Take money, Record the payment = **5** + typing, still on the list |
| two bills | 8 (+1 back) | **5** |
| start the trip | 3 | 3 |
| check in | 3 | 3 |

## 4. Findings

### Blocker — none. Major — none.

### Minor (new in verify-2)

- n1. Desk: on the next card the buttons read "No money now | Take money" (primary at the right end); on a card that is
  not next they read "Take money | No money now" — the same verb jumps place between adjacent cards (`v2-56`).
- n2. Kit `JobCard` done row draws the same green tick for a door that was NOT delivered: "✓ 3. Om Namo Traders · Shop
  was shut" (`v2-49`; builder declared it in round 1).
- n3. Offline toasts do not say what was recorded: the one-tap toast is only "Held in this tab only — not saved…" (no
  bill), and the money toast is "Receipt 01a0e6c5 held in this tab only" (an id fragment a driver cannot match to
  anything; same number D5 prints). The card does change in place.
- n4. Phone done row of a part-delivered door says only "Part delivered": whether money was taken there is not visible on
  the phone (the desk line says "Part delivered 46 pc · ₹793.00 taken").

### Minor carried over (declared by the builder)

- m7 (desk part): the money sheet is still a full-width bottom sheet at 1280 (`v2-47`), kit `Sheet`.
- m8: D2 "Cash handed to you" pre-filled ₹500.00 (existing start screen, not changed here; for the architect).
- m9 (shell, not this lane): "Not kept in this browser" strip on every home in the web build.

### Observations outside the lane

- An offline receipt still lands with no `collections` row (RCPT-9018; online ones have one) — the existing D5 offline
  path, same as verify-1; D8 still counts it (cash ₹4,639.00).
- After TRIP-0007 (29 Sep) was checked in, the home showed the builder's TRIP-0001 (28 Sep, also `closing`) because the
  trip picker prefers today's date between two closing trips — the existing DOS-061 rule; an artefact of my test data.

### Not tested

- Native Android / iOS: building is forbidden on this Mac. Code read only: native `JobCard` has the new outline and
  un-nested buttons; native `RupeeInput` never puts the expected figure between label and field; parity tests green.
- The DOS-148 refusal of the one tap (an order not on this van): not arranged.
- The web `RupeeInput` order change on the van sale and the manager's day-end (kit lane's review); seen on D5 only.

## 5. Five-second test

Yes. The page opens on the list, and the one thing to do is the only filled button on the screen, on the card marked
"DO THIS NEXT"; the words are a driver's ("I am here", "Delivered, all items", "Take money", "Check in the vehicle"); each
card says the shop, where, the state in one word and "To collect ₹…" / "On credit ₹…"; the confirm names the shop, bills
and pieces; the money field is empty; finished doors fold into slim outlined rows; the summary line says what is left and,
at the end, "now check in the vehicle". What gets in the way: the ochre "Not kept in this browser" strip (shell), the
long offline sentence, the tick on a door that was shut, and on the desk the two money buttons swapping sides.

## 6. Screenshots

`v2-01..03` load card Waiting/Loading/Loaded · `v2-04` More before the road · `v2-05/06` start screen and confirm ·
`v2-07` road start (one filled button) · `v2-08` arrived · `v2-09` confirm (two bills) · `v2-10` delivered, Unpaid ·
`v2-11/12/13` money sheet empty / typed / recorded · `v2-14..19` old way D3 → D4 → D5 · `v2-20..24` credit shop, D4 photo,
On credit · `v2-25..29` part delivery · `v2-30..33` M1 after the part drop (home ₹793 = D5 ₹793) and paid → finished ·
`v2-34..40` offline and back online · `v2-41` rest paid · `v2-42/43` one-bill confirm · `v2-44` after reload, All done
last · `v2-45` More on the road · `v2-46/47` desk all done, desk money sheet · `v2-48` D8 · `v2-49` checked-in home ·
`v2-50..51` TRIP-0008 · `v2-52/53` UPI without UTR, cheque · `v2-54..57` TRIP-0009 (with location), desk and phone.

## 7. Processes

Mine only: static server :5720 (pid 99023) and pw-server :9720 (pid 99046 + its Chromium), all stopped. The orphan
`pw-server.mjs` pid 50599 (PW_PORT=9720, started 10:53, no Chromium) is not mine and was left alone. The demo API :3700
was not touched.
