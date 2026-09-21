# money-web — DOS-168 / DOS-169 / DOS-170 platform walk, items 2–5 (web)

Walked 2026-09-21 by the money-web block of the batch-2 platform-walk queue, against
`QA/evidence/batch2/verdicts/DOS-168-170-merge-gate-ruling.md` items **2, 3, 4 and 5**.
Item 5 was walked at **both** 1280×800 and 390×844. The airplane-mode half of item 5 and the
whole of items 6 (Android) and 7 (iOS) belong to the end pass and were **not** walked here.

## What I started, and what I stopped

| Thing | Where | Stopped |
| --- | --- | --- |
| `backend/all-in-one` (`DOS_MODE=all WORKER_INLINE=1`) | **:3100** — all eight services behind path prefixes plus the inline worker | yes, before returning |
| `@dos/manager-app` (expo web) | **:5174**, `EXPO_PUBLIC_API_URL=http://127.0.0.1:3100`, `EXPO_PUBLIC_API_PREFIX=/manager` | yes, stopped after item 4 to free memory |
| `@dos/delivery-app` (expo web) | **:5177**, prefix `/delivery` | yes, before returning |
| `pw-server.mjs` (headless Chromium, CDP) | **:9344** | yes, before returning |

Ports **:3000–:3007 were already held** by processes I did not start (PIDs 99690–99708) and were
never touched; the `Pixel_7_API_36` emulator (PID 82296) was already running for another block and
was left alone. Database: `dos_test_b2_walks`, dropped and recreated from `dos_test_batch2b_template`,
then `pnpm db:migrate` (exit 0). **I did not re-seed** — the template copy arrived fully seeded
(3 tenants, 52 users, 1 170 receipts, 12 658 journal lines) and no earlier walk had spent it.
`dos` and `dos_qa` were never connected to. Fixtures were built through the running HTTP API as the
real roles (salesperson → manager approval → warehouse pack → load sheet → depart → deliver →
`/sync/upload` → return), never by writing rows.

**Machine reading before any device work** (the block's refusal rule): free RAM
**3 298 pages × 16 KiB = 53 MB**, swap **6 451 / 7 168 MB = 90.0 % used** — both past the
~300 MB / ~85 % thresholds. No emulator or simulator was booted; the web legs were walked, and the
device legs are returned **not-proven** with that reading.

Honesty note: while restarting my own headless Chromium I ran one broad `pkill -f pw-server.mjs`.
Four `pw-server.mjs` processes belonging to other blocks were alive both before and after it, so
nothing of theirs appears to have been lost, but the command was wider than my own process and I am
recording it rather than leaving it out.

---

## Item 2 — two desks bank one receipt (DOS-168)

### 2a. API, ten concurrent pairs

`POST /manager/receipts/deposit` twice in one `Promise.all`, one accountant token
(`meena.joshi`) and one manager token (`vikas.kadam`), on the same freshly created `collected`
office receipt, alternating cash and cheque.

```
pairs=10  bothSucceeded=0  exactlyOne=10  neither=0
loser, every time: 409 CONFLICT "receipt RCPT-90xx is deposited, not collected"
```

Ledger for those ten receipts (`money-web-sql/item2-receipts.txt`, `item2-ledger.txt`):

| measured | value |
| --- | --- |
| deposit journal entries for 10 receipts | **10** (one each) |
| lines per entry | `BANK +10 000` and `CASH` or `CHEQUES` `−10 000` |
| `receipts.deposit_ref` per receipt | exactly **one** (the winner's) |
| `ChequeDeposited` outbox rows | **10** for 10 receipts |
| entries whose lines do not sum to 0 | **0** |
| trial balance, whole pilot tenant | **0** |

**Verdict: PROVEN.** The pre-fix behaviour recorded in DOS-168 was 69 of 70 pairs banking twice;
here it is 0 of 10.

### 2b. Browser, two contexts, 1280×800 and 390×844

Two browser contexts on `:5174` → Money → **Day-end**, both tick the same receipt in
`tobank-register`, both open `deposit-dialog`, both press the confirm in the same second
(`Promise.all` of the two clicks).

| | 1280×800 (RCPT-9020) | 390×844 (RCPT-9021) |
| --- | --- | --- |
| both presses within | **108 ms** | **108 ms** |
| manager context | `200 POST /receipts/deposit` | `200` |
| accountant context | `409`, dialog **stays open** | `409`, dialog stays open |
| refusal rendered in `deposit-refusal` | **“receipt RCPT-9020 is deposited, not collected”** | **“receipt RCPT-9021 is deposited, not collected”** |

Ledger for RCPT-9020 (`money-web-sql/item2-web-ledger.txt`): status `deposited`, **one**
`deposit_ref` = `DEP-B-w2` (the winner's), **one** deposit entry `BANK +250 000 / CASH −250 000`,
**one** `ChequeDeposited` row, trial balance **0**.

Screenshots: `money-web-desk-dos168-accountant.png` (the loser's sentence),
`money-web-desk-dos168-manager.png`, `money-web-phone-dos168-accountant.png`,
`money-web-phone-dos168-manager.png` (each with its `.txt` body dump).

**Verdict: PROVEN at both widths.**

---

## Item 3 — the offline receipt settles (DOS-169)

Trips built per design Step 5: order → approval → pack + invoice → **load sheet built, approved and
confirmed** (DOS-172's `bill_not_loaded` gate refuses departure otherwise) → depart → deliver with a
signature → the **only** cash arrives as a `receipts` op through `POST /delivery/sync/upload` as the
driver → `trips.return`.

### 3a. API — the honest crew (TRIP-0008)

| measured | value |
| --- | --- |
| `collections` rows for the trip | **0** (the S-76 skeptic shape) |
| preview `cashCollectedPaise` | **154 400** = X |
| preview `expectedCashPaise` | **204 400** = float 50 000 + X |
| settle handing 204 400 | **200**, `settled`, variance **0**, `hasVariance` false |
| receipt journal | `CASH_VAN +154 400` / `AR −154 400` |
| settlement journal | `CASH +154 400` / `CASH_VAN −154 400` |
| **CASH_VAN net for the trip** | **0** |
| trial balance | **0** |

### 3b. API — the crew keeps the cash (TRIP-0009)

Preview `cashCollectedPaise` 154 400, `expectedCashPaise` 174 400 (float 20 000 + X). Settling with
the float alone:

```
409  code=settlement_needs_owner  cashVariancePaise=-154400
"cash is -154400 paise off (tolerance 10000) or the van stock does not tally; the owner has to accept the variance"
```

Exactly **one** pending approval, `kind=trip_settlement`, `entity_id` = that trip,
payload `{expectedCashPaise: 174400, handedOverCashPaise: 20000, cashVariancePaise: -154400}`.
The trip stayed `closing` with **no** `trip_settlements` row.

### 3c. Browser — the same two halves on the cockpit, 1280×800

Manager app → Money → Day-end → tick the trip in `trips-register` → `dayend-settlement`:

| trip | “Collected on the road” | “Expected ₹” | typed “Handed over” | “Difference ₹” | settle |
| --- | --- | --- | --- | --- | --- |
| TRIP-0011 (float ₹300) | **₹1,544.00** | **₹1,844.00** | ₹300 | **−₹1,544.00** | **409**, `settle-refusal` reads “cash is -154400 paise off (tolerance 10000) or the van stock does not tally; the owner has to accept the variance” |
| TRIP-0010 (float ₹500) | **₹1,544.00** | **₹2,044.00** | ₹2,044 | **₹0.00** | **200** |

Cockpit panel geometry at 1280×800: `x=192 y=798 w=1068 h=402` — the panel opens **below the fold**
and the page does not scroll to it; a desk user must scroll. Recorded as an observation, not a fault.

Screenshots: `money-web-desk-dos169-cockpit-offline-cash.png`, `money-web-desk-dos169-needs-owner.png`,
`money-web-desk-dos169-settled.png`.

**Verdict: PROVEN** (API + browser + ledger). The cash that arrived only through `/sync/upload`
is counted by the cockpit and by `settle`, and CASH_VAN nets to 0.

---

## Item 4 — undo after settlement (DOS-170)

### 4a. API, on the item-3 receipt of the settled TRIP-0008

```
before  GET /receivables/accounts  {AR 440527800, BANK 235599155, CASH 394842552, CASH_VAN 15408000}
POST /receipts/{id}/reverse  -> 200
after   GET /receivables/accounts  {AR 440682200, BANK 235599155, CASH 394688152, CASH_VAN 15408000}
delta   CASH=-154400   CASH_VAN=0   AR=+154400
```

`receipt_reversal` journal lines: **`AR +154 400` and `CASH −154 400`, and no CASH_VAN line at all.**
The settlement preview read identically before and after (`tripState=settled`, expected 204 400,
cashCollected 154 400).

### 4b. Browser, on the trip settled **through the cockpit** (TRIP-0010, RCPT-9022)

Accountant → Registers → Trial balance, before and after pressing **Reverse the receipt** on the
receipt panel:

| account | before | after | delta |
| --- | --- | --- | --- |
| CASH (Cash in hand) | **39,48,425.52** | **39,46,881.52** | **−₹1,544.00** |
| CASH_VAN (Cash with delivery crews) | **1,55,624.00** | **1,55,624.00** | **unchanged** |
| BANK | 23,60,991.55 | 23,60,991.55 | unchanged |

Every journal line that touches that trip, end to end (`money-web-sql/item4-web-ledger.txt`):

```
receipt          receipt RCPT-9022              AR       -154400
receipt          receipt RCPT-9022              CASH_VAN  154400
trip_settlement  settlement of trip TRIP-0010   CASH      154400
trip_settlement  settlement of trip TRIP-0010   CASH_VAN -154400
receipt_reversal entered against the wrong shop AR        154400
receipt_reversal entered against the wrong shop CASH     -154400
net per account for the trip: AR 0, CASH 0, CASH_VAN 0
```

The bill reopened: **INV/9022 outstanding back to 154 400**, allocations 0. The settlement row was
untouched: `TRIP-0010 expected 204 400 / handed 204 400 / variance 0 / has_variance f /
settled_at 08:42:10.678` — the same values read before the reversal. Trial balance **0**.

Screenshots: `money-web-desk-dos170-trial-before.png`, `money-web-desk-dos170-reverse-dialog.png`,
`money-web-desk-dos170-trial-after.png`.

**Verdict: PROVEN.** The reversal credits CASH, never CASH_VAN.

---

## Item 5 — D8 with one receipt held (both widths)

Delivery app on `:5177`, driver's own trip, one stop delivered, cash taken at the door with
`context.setOffline(true)`. Note for the reader: a browser here has **no persistent store** — the
strip reads “Not kept in this browser” — so the app correctly uses the DOS-179 *tab twins* of the D8
sentences. Both widths were measured from the DOM, three runs of (A) in total (1280×800 twice,
390×844 once), and they agree line for line.

### 5(A) measured — identical at 1280×800 and 390×844

| phase | `d8-expected` (bottom bar) | `d8-hand-over` | `d8-uncounted` | `d8-pending` | check-in button |
| --- | --- | --- | --- | --- | --- |
| 1. online, no money | ₹400.00 | “Hand ₹400.00 to the cashier” | — | — | enabled |
| 2. **offline, holding ₹1,544** | **₹1,944.00** ✔ (= float ₹400 + X) | **absent** ✘ | **absent** ✘ | “1 writes are held in this tab only, not saved. They go before the office can close the trip; close this tab and they are gone.” | **disabled** ✔, reason **“A van sale needs a signal: it makes a numbered GST bill.”** ✘ |
| 3. back online, **same mount** | **“—”** ✘ | absent | absent | — | **enabled** |
| 4. **re-opened** | **₹1,944.00** ✔ | “Hand ₹1,944.00 to the cashier” ✔ | **gone** ✔ | — | enabled ✔ |

`d8.pendingBlocks` — the sentence the ruling asks for — was **never seen**: not while offline
(`checkInBlock` returns `'offline'` before `'pending'`), and not once in **10.2 s of 300 ms samples**
across the drain window.

Server: the trip carries **exactly one** receipt of 154 400 paise, `client_receipt_no` from the
device (`money-web-sql/item5-tripF-receipts.txt`) — the op was sent once.

Screenshots: `money-web-desk-d8-offline-holding.png`, `-online-same-mount.png`, `-reopened.png`
and the `money-web-phone-d8-*` set.

**Verdict: PARTLY PROVEN, and three Pass conditions FAIL.**
- ✔ the hand-over rupee is right offline (₹1,944.00) and after a re-open (the same rupee);
- ✔ the note does not survive a re-open (the item's stated failure mode does not happen);
- ✔ the check-in gate holds — the van cannot leave while money is on the phone;
- ✔ the server holds the receipt once;
- ✘ `d8-uncounted` never names X offline → **S-183**;
- ✘ the disabled reason is a van-sale sentence, not `d8.pendingBlocks` → **S-184**;
- ✘ on the same mount after the drain the figure blanks to “—” beside an enabled button → **S-168**.

### 5(B) — the desk settles while the phone holds the receipt (1280×800)

Phone offline holding ₹1,544 with D8 open; the desk then called `trips.return` (200) and
`trips.settle` with the settled `expectedCashPaise` = **40 000 paise (₹400.00)** (200). The phone
came back online.

What the tray shows (`money-web-desk-d8-b-tray.png` / `.txt`) — **right, and better than the
ruling's risk (e)(3) feared**:

```
Refused: 1 · Waiting: 0
"The office could not accept these"
"this trip has already settled; hand this money to the cashier and record it at the office, not on the trip"
"Take money · trip_settled · 21 Sep, 9:23 am"
"₹1,544.00 Cash from Ansari Kirana Stores · 21 Sep, 9:23 am"
"The office could not take this on the trip. Hand the money and the slip to the cashier, who records it at the office."
action: "Handed to the cashier"
```

Ledger (`money-web-sql/item5b-legB.txt`): **0 receipts** on the trip, **no journal line** for the
₹1,544, `TRIP-0019` settled at expected 40 000 / handed 40 000 / variance 0, the bill **INV/9032 still
open at 154 400 outstanding**, trial balance **0**. Exactly founder answer A.

What D8 shows — **fails the item**: re-opened, D8 does not show the settled trip at all. It silently
re-points at **TRIP-ACTIVE · 12 Sep 2026**, another *open* trip on which this person is the **helper**
(`trips.helper_id`), and reads “Hand **₹5,000.00** to the cashier” — that trip's float, money the
driver is not holding. `d8.uncountedSettled` therefore never appears and the Pass condition
“hand-over = the settled `expectedCashPaise` (never more)” cannot be met → **S-169**.

At **390×844** the same leg was walked on a driver with no other open trip. The offline phase and the
tray were identical (`money-web-phone-d8-b-tray.txt`), and D8 re-opened landed on the other outcome:
it reads **“The office plans the trip and the godown loads it. Nothing is on the road yet.”** while
the phone is holding ₹1,544 of refused cash. Either way the settled trip's figures and
`d8.uncountedSettled` are never shown.

**Verdict for 5(B): the refusal path is PROVEN at both widths; the D8 half FAILS at both widths.**

---

## New findings filed

Filed in `QA/findings/12-batch2-new-findings.md` under DOS-168..170, per section (c) of the ruling:
**S-183** (P2, the offline `d8.uncounted` note never renders), **S-184** (P3, the wrong disabled
sentence), **S-168** (P2, the blank figure beside an enabled button — walks S-144),
**S-169** (P2, D8 switches to another open trip after the desk settles). S-143's status was updated
with a measured result: on this tree the tray's action reads “Handed to the cashier”, not “Discard”,
and the row names shop and amount — **S-143 as written is not reproducible on web**.

**Renumbered 2026-09-21.** This block filed the four rows as S-166..S-169 at 09:28, but the earlier
smoke-failures block (08:17) had already taken S-166 and S-167 in
`smoke-failures-findings-rows.md`. Being the later filing, the two colliding rows were renumbered in
the findings file: **S-166 → S-183** and **S-167 → S-184**. S-168 and S-169 are unchanged. The numbers
in this report have been updated to match, so every S-number here means one thing.

None of the failures is a ledger fault. Every ledger claim in items 2, 3, 4 and 5(B) passed, the
trial balance summed to **0** after every stage, and no revert trigger from ruling section (c) was
met.

## Still not proven

1. **Every device leg.** Items 6 (Android) and 7 (iOS) were not attempted: free RAM 53 MB and swap
   90.0 % at the start (68 MB / 87.4 % at the mid-point) are past this block's refusal thresholds,
   and an emulator belonging to another block already held 405 MB.
2. **Item 5's airplane-mode half**, named for the end pass in the block brief. What is walked here is
   `context.setOffline(true)` in a browser with **no persistent store**; a phone with the SQLite store
   may hold a cached settlement preview and therefore may not show S-183 and S-168. Those two
   findings are **web-only** until the Pixel 7 says otherwise.
3. **The `d8.uncountedSettled` sentence has never been seen render**, at either width — S-169 keeps D8 off the settled trip, so the string is unproven in a browser and stays owed to the Android pass.
4. **`d8.pendingBlocks` in the state that can reach it** — online with a queue still draining. It was
   never observed in 10.2 s of sampling; whether it is reachable at all on a real device with a
   larger outbox is untested.
5. **Item 5(A)'s “the strip reads Updated, button enabled”** was measured on the same mount, where the
   figure had blanked (S-168); it was not measured on a phone where the strip and figure are read by
   a person rather than by a selector.
6. **Ruling items 0 and 1** (the integration gate and `pnpm smoke`) were not this block's; item 1 was
   settled by the previous block (`smoke-failures.md`).
7. **Trip B (TRIP-0009) was deliberately left `closing`** with its pending owner approval as standing
   evidence; the owner-accepts-variance branch was not walked.
