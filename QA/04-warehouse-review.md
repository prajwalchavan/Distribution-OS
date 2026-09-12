# 04 — Warehouse review (Phase 1, walked 2026-09-12)

Warehouse `dinesh.patil` on the warehouse app (:5176, warehouse-service :3004), database `dos_qa` (realistic seed). Web at
1280×800 and 390×844 (Playwright, headless Chromium 145), Android on the Pixel 7 emulator (API 36, debug APK), iOS on the
iPhone 16 Pro simulator (Expo Go) for sign-in and home. Findings: `QA/findings/03-walkthrough-warehouse.md` (DOS-039 … DOS-055).
Evidence: `QA/evidence/phase1/warehouse/` (+ `android/`, `ios-01-home.png`).

## 1. Answer to the phase question — "Can I process orders quickly without mistakes?"

**No — and the mistakes are the product's, not the picker's.** The screens are the best-built in the suite for a hand with a
carton in it (one line per screen at the gate, 76 dp keypads, Picked/Short per lot, honest disabled buttons, plain-language
confirm dialogs), but the day cannot be finished:

1. **Nothing can leave the godown.** The one approved load sheet fails on "Send the vehicle out" because the server tries to move
   the packed orders' stock a second time — packing already booked it as sold (DOS-039, P0). Every packed order in the pilot
   would stop here.
2. **A new wave cannot be picked.** There is no Start; every "Picked" on an unstarted wave is thrown away by the sync layer while
   the screen counts it (DOS-040). Retry replays the same rejection forever (DOS-046).
3. **One wrong digit wrecks an order.** 20 picked against 6 is accepted; the wave then closes at 676/750 with a line that was
   neither picked nor shorted; the pack is refused; the picker cannot cancel or reopen (DOS-041, DOS-042).
4. **The loader can do things he must not.** One tap starts loading and one tap sends a van out two days early with a draft
   sheet and no odometer (DOS-043); +1,00,000 pieces of "opening stock" post without a question (DOS-044).

What DOES work end to end: the blind gate count (four lines, short/excess/damage findings computed for the desk), damage
adjustments and moves to the damaged bin with correct ledger rows, the permission fence around cost and desk-only actions
(every probe 403), and the sync layer's honesty about what it could not save.

## 2. What I did, screen by screen

| Area | Walked | Verdict |
|---|---|---|
| Sign-in | web, Android, iOS | Works on all three (`w-01-home`, `android/a-00-signin`, `ios-01-home`). |
| Home (W1 queues) | web desk + phone, Android, iOS | Tiles and lists match the DB (2 waves, 1 draft sheet, 0 packs without bill, the open cycle count; after the manager opened a GRN: "Bills to count 1", "Gate counts waiting 1 line" for a 4-line GRN — DOS-050). Fill-rate sparkline "96.2 % of ordered pieces picked, 72,495 of 75,344". This is the only screen that shows today's actionable waves and sheets (DOS-047). |
| Inbound → Capture (W2) | web | Supplier chips with GSTIN, "Photograph a page" (native file chooser — NOT TESTED headless), "Scan the e-invoice QR", recent captures with states (needs_review / failed / extracted / committed). |
| Inbound → Gate count (W3) | web | **Works**: manager opened a GRN for GUR/26-27/00490 through the API; the gate saw "Receipt at Godown · counting"; one line per screen, blind keypad, "Damaged pieces" toggle, review list, Save → GRN `reconciled`, five discrepancy rows (short 48, excess 2, damaged 2, excess 68, short 240). Received+damaged counted as excess (DOS-051); expected quantities in the API reply (DOS-045); the warehouse cannot post (403, correct). |
| Inbound → Stock (W8) | web desk + phone, Android | Per-lot cards with MRP (never cost), on hand / held / free, near-expiry filter, location chips incl. vehicles and the damaged bin. **Adjust −2 damage and Move 1 → damaged bin correct** (ledger + balances). **+100000 opening stock accepted** (DOS-044). Below-zero refused with a raw UUID message (DOS-048). 0-pc lots listed among live ones. Android adds a search box. |
| Inbound → Counts (cycle count) | web | Blind keypad per lot, 3/3, Save → `counted`. Expected frozen at 08:15 so a wrong 9 (true 7) shows variance 0; expected/variance returned to the device; Stock tab shows the answer (DOS-045). |
| Inbound → Held (W11) | web | 42 reservation rows with product, pieces, batch, "pending" — no order or shop; rows do nothing (DOS-050). |
| Pick tab (W4) | web, Android | Orders waiting by beat (5 confirmed orders, Select all / Clear, "0 selected · 0 pc"); wave list of 30 finished waves, the two live ones absent (DOS-047). Making a wave was NOT exercised (the manager made PICK-0079). |
| Picking sheet (W5) | web desk + phone, Android | Per-lot lines with batch, expiry badge, MRP, Picked/Short, "To pick / Every line", "N lines not yet picked" under a disabled "Take it to packing". No Start (DOS-040); over-pick accepted (DOS-041); wave auto-closes with an unpicked line, three contradicting counts on one screen (DOS-042); 16-day lot offered (DOS-054); Scan → "Nothing readable in frame" (no camera). PICK-0078 (kavita's) opens for dinesh too — no "assigned to" shown. |
| Attention tray | web | "1 need attention" → /pick/attention: rejection text, table · code · time, Try it again / Throw it away, "Held in memory only". Retry replays (DOS-046); count mismatch (DOS-053). |
| Pack (W6) | web desk + phone, Android | Ready to pack (includes orders still being picked, ordered qty shown — DOS-050), packed without a bill (none), packed today with INV numbers. Pack screen: cartons keypad (min 1), weight keypad, "What goes in the cartons" from the picks (shows the 20-of-6 line as "20 pc Packed"), two actions with confirm dialogs. **Pack and bill / Pack without a bill both 400** on the over-picked lot (DOS-041); the error is shown raw (DOS-048). |
| Load → Sheets (W7) | web desk + phone, Android | 30 confirmed sheets by id; the draft one only via Home (DOS-047). Draft sheet: vehicle, "Approved · 12 Sep, 12:10 pm", E-way bill, blind carton keypad, orders with cartons and INV numbers, "What goes on the vehicle" (25 lots), declared value ₹1,50,147.00, variance note appears when the count differs, confirm dialog. **Confirm → 400 insufficient stock** (DOS-039). |
| Load → Trips (W10) | web, Android | TRIP-ACTIVE (3 of 10 stops), TRIP-NEXT planned 14 Sep → "Start loading" → "Send it off" both one tap, both 200 (DOS-043). "The money side of the trip is settled at the desk." |
| Load → Check-in (W9) | web, Android | Vehicle chips → "Expected on the vehicle" per lot (with a 0-pc row) — not blind (DOS-049). Counting back NOT exercised (no returned trip). |
| Settings / ⋯ (W12) | web, Android | Me, role, distributor, "Tables on this device 13", "Held in memory only", waiting/refused counts (wrong — DOS-053), signed-in devices by User-Agent (DOS-053), "Inbox" = tenant's outbound SMS/WhatsApp to shops (DOS-052), change password, sign out. |

## 3. Deliberate wrong quantities — what the inventory did (the phase's explicit check)

| Action | Server | Ledger / balances | Verdict |
|---|---|---|---|
| Cycle count 9 / 14 / 0 against 7 / 14 / 5 | 200, `counted` | none (desk posts) | expected stale → variance 0 for the 9 (DOS-045) |
| Adjust −2 damage, note | 200 | damage −2, on hand 7 → 5 | correct |
| Adjust −100 (below zero) | 400 | none | correct, message raw |
| Adjust 0 | blocked client-side | — | correct |
| Adjust +100000 opening | 200 | +100000, on hand 100,005 | **wrong** (DOS-044); reversed −100000 |
| Move 1 → damaged bin | 200 | transfer_out/in, 4 / 1 | correct |
| Move 200000 → van | 400 | none | correct |
| Pick 5 of 12 "Not on the rack" | accepted | none at pick | correct |
| Pick 20 of 6 "Damaged carton" | accepted | none | **wrong** (DOS-041) |
| Pick 0 of 1, no reason chosen | accepted, reason defaulted | none | DOS-051 |
| Last lot of the order line | rejected: 240 asked, 246 picked | wave closed at 676/750 anyway | **wrong** (DOS-042) |
| Pack 7 cartons (with the 20-of-6) | 400 insufficient stock | none (rolled back) | order stuck (DOS-041) |
| Load-out count 35 of 38 + note | 400 insufficient stock (lot already sold at pack) | none | **wrong** (DOS-039) |
| Gate count 1200/1248, 144+2 dmg, 500/432, 0/240 | 200, `reconciled` | none (desk posts); 5 discrepancies | correct (semantics DOS-051) |

## 4. Platforms

- **Web desk (1280×800):** everything above. **Web phone (390×844):** same screens, no horizontal scroll on any of the six checked; the pick sheet's contradiction (badge "picked", "23 of 24", "1 line not yet picked") is on one phone screen (`p-02-pick-sheet.png`).
- **Android (Pixel 7):** signed in with the hardened driver; walked Home, Pick, PICK-0078 sheet, Pack, Load, Trips, Check-in, ⋯ menu, Stock, draft load sheet (`android/a-00…a-18`). Same data as web; 76 dp targets read well; LogBox warning on first tap (DOS-055). Bottom tabs Inbound/Pick/Pack/Load, Settings behind ⋯.
- **iOS (iPhone 16 Pro, Expo Go, headless Appium):** sign-in + home only (`ios-01-home.png`). Beyond home NOT TESTED on iOS.

## 5. Friction, terminology, defaults

- No Start on a wave; "Take it to packing" is really "go to the Pack tab"; "Send it off" departs a trip with no ceremony.
- "reconciled" for a counted GRN with five open findings; "picked" for a wave with an unpicked line; "is open; it is no longer being picked".
- UUIDs in every refusal; User-Agent strings as device names; "Inbox" that is not the user's.
- Lists ordered by id: the newest and the actionable are never on top.
- Blind counts that print the answer underneath.
- Good: consequences spelled out in dialogs ("Stock is reserved when this is confirmed", "cannot be edited afterwards"), disabled buttons that say why, the attention tray, the memory-only warning on web.

## 6. Counts

New findings this role: **17** — P0: 1 (DOS-039) · P1: 5 (DOS-040, 041, 042, 043, 044) · P2: 4 (DOS-045, 046, 047, 048) · P3: 7 (DOS-049 … 055).
Re-observed from earlier walks: DOS-009, DOS-025, DOS-028.
Test artefacts left in `dos_qa` (tenant tarsun, all labelled "QA" where a note exists): cycle count b24cd950 `counted` (9/14/0);
Campa Cola 1 L lot RCP20260807: −2 damage, +100000/−100000, 1 pc moved to the damaged bin (godown 4, bin 1); PICK-0079 `picked`
676/750 with lot RCP20260717 over-picked 20/6 and lot B20260902 unpicked; SO-0877 stuck in `picking`; TRIP-NEXT `active` (departed
12 Sep 15:08 by the warehouse, trip date 14 Sep) with load sheet 374f2089 still `draft` (counted 35, variance note); GRN
01a09503 `reconciled` for GUR/26-27/00490 with five open discrepancies (opened via the manager's token).
