# 03 — Manager review (Phase 1, walked 2026-09-12)

Manager `vikas.kadam` and accountant `meena.joshi` on the manager app (:5174, manager-service :3002), database `dos_qa`
(realistic seed). Web at 1280×800 and 390×844 (Playwright, headless Chromium 145), Android on the Pixel 7 emulator (API 36, debug
APK), iOS on the iPhone 16 Pro simulator (Expo Go) for sign-in and home. Findings: `QA/findings/02-walkthrough-manager.md`
(DOS-020 … DOS-038). Evidence: `QA/evidence/phase1/manager/` (+ `android/`).

## 1. Answer to the phase question — "Can I run the daily operation without constantly calling people?"

**Not yet.** The manager can see the day accurately — every number on Today agrees with the database to the paisa, and the
90+ ageing that the owner's home hides is correct here — but four of the day's jobs cannot be finished from the app:

1. **Load-out approval** — the one draft load sheet that needs the manager's "PIN" is not on the Load-out screen at all (DOS-025).
2. **Day-end banking** — nothing banks cash, deposits or bounces a cheque; the tab is read-only (DOS-034).
3. **Credit notes** — the line editor only counts whole cases, so a 40-piece short delivery cannot be credited, and the server's
   refusal is invisible (DOS-021).
4. **Waves** — a picking sheet can be made but then cannot be found, assigned or cancelled (DOS-023).

And the one decision the manager did take went wrong quietly: confirming SO-0867 for a shop 93 days overdue also approved a
below-floor rate and a credit-limit request without saying so, and left no audit row (DOS-020, DOS-028). Across the app, every
server refusal (400, 409, 501) is swallowed (DOS-029) and one of them freezes the page (DOS-031). The numbering series for receipts
is behind the seeded receipts and the schema does not stop duplicates, so two receipt numbers are already doubled (DOS-032).
The accountant, meant to be "money desk + reads", can write off stock and book supplier bills (DOS-037).

So today the manager would still phone the warehouse (is the van approved? did you get my sheet?), the accountant (did the
cash go to the bank?) and the owner (did I just approve something?).

## 2. What I did, screen by screen

| Area | Walked | Verdict |
|---|---|---|
| Sign-in / sign-out / devices | web (both roles), Android, iOS | Works. Settings → My account lists signed-in devices ("Browser on Mac", "Unnamed device" = the API session) with "that device will have to sign in again". |
| Today | web desk + phone, Android, iOS | **All tiles match the DB**: invoiced ₹1,50,147.00 (5 bills), collected ₹4,49,793.67 by mode (35/42/17/7 %), cheques 6 = ₹1,73,556.98, orders to confirm 1 = SO-0867 ₹5,367. 90+ bucket ₹35,144 shown (owner's is ₹0, DOS-001). After my two receipts the 2:30 pm rollup showed ₹4,58,976.67 — honest "as of". "Bills to issue 8" counts unbillable orders (DOS-022); "Cash to bank 200+ rows ₹40.96 L" is 90 days of never-banked cash (DOS-034 + fixture). |
| Orders (queue) | web desk + phone, Android | Keyboard queue (j/k, Enter, 1, 2), two-step confirm, reserves stock (16 reservations / 337 pc) and notifies the shop. But: "Waiting on —" for an order with two pending approvals (DOS-027); approval cards unnamed (DOS-004); confirm walks through a credit stop and silently decides the approvals (DOS-020); no audit (DOS-028); lines unnamed (DOS-003). Accountant: panel says "The money desk reads this register; the manager makes the changes" — correct. |
| Billing desk / Bills issued | web, Android | Bill panel is good (named lines, print, e-way bill, IRN, cancel). Desk headline "9 left to bill" is wrong and no row is actionable (DOS-022); lists unsorted (DOS-009). |
| Credit notes | web | Form finds the bill and lists lines; stepper is cases-only with stock copy; 400 swallowed (DOS-021). Accountant also has "Draft a credit note" (allowed). |
| Brand DMS | web | One FieldAssist import shown; "Import a FieldAssist file" opens nothing visible in headless (native file chooser — NOT TESTED). |
| Fulfilment → Waves | web, Android | Rows tick on click (no checkbox), "Make a picking sheet" appears; PICK-0079 created (200) then invisible (DOS-023); queue lists packed orders and the 409 is silent (DOS-024). |
| Fulfilment → Pick & pack | web | "Nothing to pick or pack" while PICK-0078 is being picked and PICK-0079 is open — presumably "my sheets" only; nothing to do here for a manager. |
| Fulfilment → Load-out | web | 82 confirmed sheets, no order; the draft sheet awaiting approval is absent (DOS-025). Confirmed-sheet panel is excellent (orders SO·INV, approver, checkout, EWB, disabled actions explained). "Print the challan" queues a render that completes in ~40 s and never surfaces (DOS-026). |
| Inbound → Supplier bills / GRNs / Findings / POs | web | Supplier bill panel with matched lines and explained-disabled actions; GRN list (no supplier column, unsorted); Findings tab reads like a real gate log; POs "Nothing inbound". |
| Inbound → Documents | web | Review desk works for a real supplier bill: GUR/26-27/00490 → Start reviewing → Book → supplier_invoices row `approved` ₹44,218, "QR Verified · IRN verified". A brand-DMS document offers the same button and gets a silent 501 (DOS-030); "Start reviewing" on a reviewed document throws and freezes the page (DOS-031). Tile "Bills to review 8" vs 7 rows listed (P3, noted). |
| Inbound → Gate count | web | "No goods receipt is open" — nothing to count; NOT TESTED further (Warehouse phase). |
| Money → Receipts | web, Android | "Record a payment" (shop search shows "Owes ₹69,604.50", Cash/UPI/Cheque — no bank transfer option, oldest-bill-first) recorded RCPT-0696 ₹9,182 → allocated to OPEN/0005 correctly, but the number is a duplicate (DOS-032); receipt panel shows the bill as a UUID (DOS-033). Accountant has the same form. |
| Money → Day-end | web, Android | Read-only; UPI/bank rows listed as "cash in hand" (DOS-034). |
| Money → Claims | web | Ageing by supplier + claim list by month/kind with state; consistent; not exercised further (Phase 7). |
| Registers | web | Sales register, GST summary by HSN/rate, purchase register, collections by day and mode, outstanding by shop, trial balance, day book (with narrations naming the bill), daily sales — all render; 12 Sep row = the home tiles. GSTR-1 banner "due on the 11th — 29 days left" is right. Outstanding register headers "Owed ₹ / Money owed" are ambiguous (P3). |
| Registers → Tally / Team | web | Export jobs with downloads and "Queue an export" (accountant too); Team: strike rate per person, leaderboard, per-person table (includes the accountant and a delivery man in a sales strike-rate chart — odd but they take receipts). |
| Shops | web desk, Android | Filter + beat chips; shop panel: code, beat, phone, GSTIN, owes/overdue, "usually pays in 17 days", statement, "Change the credit terms" (manager only — accountant correctly lacks it), "Send the statement". Overdue in raw paise (DOS-035); statement is a running balance without document amounts (DOS-036); phone list has no names (DOS-038). |
| Stock | web | On hand / ledger / held, location chips incl. vehicles, damaged bin, in transit, near expiry. **Adjust works**: Campa Cola 1 L RCP20260807 9 → 8, ledger row reason damage with note, actor vikas.kadam. The accountant gets the same form and the server accepts her adjustment (DOS-037). |
| Prices | web | Four price lists (Default, Tier A/B/C, 174 items), schemes, shop rates — read only this phase. Hidden from the accountant's rail, as designed. |
| Messages | web | Sent log by channel with delivery state, "Shops wrote to us", "Wording", "Send to a beat" — not exercised (Phase 18). |
| Settings | web | My account, change password, devices. No business settings on this app (owner's). |

## 3. Cross-check of the owner's open items from the manager side

- **DOS-005 (bargain twice / reject does not reach the request):** the manager's queue still shows both copies of the Om Sai bargain
  and the Mahalaxmi bargain the owner rejected on the approval row — still `requested`, still approvable from the named card.
- **DOS-006 (credit-limit approval changes nothing):** reproduced by the confirm path — R-0018's request was "approved" by the confirm
  and the limit stayed ₹1,50,000.
- **SO-0868 (the order the owner let through):** sits in the Billing desk and the Fulfilment queue as a normal confirmed order; the
  manager cannot tell it went through on an override.

## 4. Platforms

- **Web desk (1280×800):** everything above. **Web phone width (390×844):** same tiles and lists, columns dropped (shop names), keyboard hints shown on touch.
- **Android (Pixel 7):** signed in with the hardened driver (`android-login.sh manager 5174 vikas.kadam Manager`); walked Today, Orders (Submitted → Confirmed → SO-0870 panel), Billing, Fulfilment, ⋯ menu, Money, Day-end, Shops. Same data as web. Bottom tabs Today/Orders/Fulfilment/Billing; the rest behind ⋯. Screens: `android/a-01…a-11`.
- **iOS (iPhone 16 Pro, Expo Go, headless Appium):** sign-in + home only (`ios-01-home.png`); VoiceOver labels read the tiles as "150147 rupees". Beyond home NOT TESTED on iOS.

## 5. Friction, terminology, defaults

- The manager's real queue is spread over Orders (decisions), Billing (nothing to do), Fulfilment (waves, load-out), Inbound (documents), Money (day-end) — the Today rows link to them, which helps, but "Bills to issue" and "Cash to bank" mislead.
- Silent failures everywhere a mutation is refused; disabled buttons ARE explained ("Only a draft sheet can be cancelled") — the pattern exists, it is just not applied to server answers.
- Row selection by click with no visible checkbox (waves); a panel whose primary button only appears after a tick.
- Internal words: "Off the line", "Not ordered", "0 packs already gone out", "Owed ₹ / Money owed", raw paise, UUIDs.
- Lists are capped (50) and unordered, so "newest" is never visible without a filter.

## 6. Counts

New findings this role: **19** — P0: 0 · P1: 9 (DOS-020, 021, 023, 025, 029, 031, 032, 034, 037) · P2: 10 (DOS-022, 024, 026, 027, 028, 030, 033, 035, 036, 038) · P3: 0 filed (three noted inline in the findings file).
Re-observed from the owner walk: DOS-003, 004, 005, 006, 009, 010, 018.
Test artefacts left in `dos_qa` (all under tenant tarsun, all labelled "QA"): SO-0867 confirmed; PICK-0079 open; approvals 5d89bf84 / 59eeee35 approved; supplier invoice GUR/26-27/00490 approved from document 76f4437a; docint review session on FA/TY/26-27/1187; receipts RCPT-0696 ₹9,182 (Patil, → OPEN/0005 paid) and RCPT-0697 ₹1.00 (Patil); two −1 damage adjustments on Campa Cola 1 L lot RCP20260807 (on hand 9 → 7).
