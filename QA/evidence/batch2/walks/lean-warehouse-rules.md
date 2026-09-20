# lean-warehouse-rules — the walk the lane owed (DOS-045, DOS-050, DOS-054)

Date 2026-09-21 (IST). Worktree `.claude/worktrees/b2-lean-warehouse-rules`, branch `qa/b2-lean-warehouse-rules`
at **121795a** (merge base with main **787181c**; main had moved to 2477fcf by the end of the run).
Database **dos_test_b2_warehouse_rules**, dropped and recreated from `dos_test_batch2b_template`, then
`pnpm db:migrate` + `pnpm db:seed` (pilot tenant Tarsun, tenant id `01a0999a-28c3-7341-93f5-e0e84b0189a1`).

The debt: the nine reshaped wire shapes were proven only against spec fixtures — every earlier stage of the
lane was forbidden to start a server. Nothing below is inferred from source. Every number is read off a
rendered screen, off the wire, or out of the database.

## What I started, and on which ports

| what | port / device | note |
| --- | --- | --- |
| `@dos/all-in-one` (eight services + `/auth` behind path prefixes) | **:3100** | `:3000–:3007` were held by other lanes; nothing of theirs was touched. `ALL_IN_ONE_PORT=3100`, no inline worker |
| `@dos/warehouse-app` web (`expo start --web`) | **:5176** | `EXPO_PUBLIC_API_URL=http://127.0.0.1:3100`, `EXPO_PUBLIC_API_PREFIX=/warehouse`, `EXPO_PUBLIC_AUTH_URL=http://127.0.0.1:3100/auth` |
| `@dos/owner-app` web | **:5173** | same, prefix `/owner` |
| `@dos/manager-app` web | **:5174** | same, prefix `/manager` |
| Metro for the Android dev client, then for Expo Go | **:8081** | `adb reverse` 8081 and 3100 |
| Metro for the owner app in Expo Go mode | **:8082** | iOS only |
| Chrome for Testing 145 (headless, CDP :9333) | — | driven over the DevTools protocol; geometry read with `getBoundingClientRect()`, bodies read with `Network.getResponseBody` |
| Pixel 7 emulator `Pixel_7_API_36` | **already booted by another lane**, idle on the launcher | I did not start it and did not kill it; the installed dev build `in.distributionos.warehouse` was pointed at MY Metro and the device was left on the launcher |
| iOS simulator iPhone 16 Pro, iOS 18.0, Expo Go | booted headlessly by me (`xcrun simctl`) | no Simulator panel was opened; shut down at the end |

Sign-ins: `dinesh.patil` (warehouse), `vikas.kadam` (manager), `pilot.owner` (owner), all `Dos@1234`.

## Walk 1 — the smoke gate, in the shape the architect ruled on 2026-09-19

`pnpm smoke --base http://127.0.0.1:3100 --run-tag whrules-1`, twice on the same seed and the same run tag.

| | run 1 (fresh seed) | run 2 (replay) |
| --- | --- | --- |
| total | 1 606 calls · **929 OK** · 572 expected · **7 BROKEN** · 98 skipped | 1 606 calls · **930 OK** · 571 expected · **3 BROKEN** · 102 skipped |

**(a) The design's named operations read OK on both runs** — never EXPECTED-as-green, never a 409 counted as green:

| operation | owner | manager | warehouse |
| --- | --- | --- | --- |
| `procurement.grns.list` / `.get` / `.count` | OK 200 | OK 200 | OK 200 |
| `procurement.grns.open` / `.post` | OK 200 | OK 200 | EXPECTED 403 — the matrix refuses the godown, which is the design |
| `warehouse.queue.list` | OK 200 | OK 200 | OK 200 |
| `warehouse.reservations.list` | OK 200 | OK 200 | OK 200 |
| `warehouse.picklists.get` | OK 200 | OK 200 | OK 200 |
| `inventory.cycleCounts.list` / `.get` / `.count` / `.open` | OK 200 | OK 200 | OK 200 (`.open` OK, `.post` EXPECTED 403 — back-office only) |

Identical on run 2, line for line.

**(c) Nothing turned BROKEN on the replay.** Run 2's three BROKEN are a strict subset of run 1's seven.

**(b) No new BROKEN against main.** No baseline run on main was made (one more tree, one more database and one
more service, on 8 GB shared with other lanes); attribution is by diff, the route the architect accepted in the
DOS-175 ruling — and here the diff is empty over every failing module:
`git diff --name-only 787181c..HEAD -- '*billing*' '*notification*' '*examples*'` prints **nothing**.

| BROKEN | runs | what it is |
| --- | --- | --- |
| `billing.invoices.issueForPack` (owner, manager, warehouse) | run 1 only | the published example's hard-coded pack id `01a06dfc-…9054b` is not in a fresh seed (`pack_confirmations` holds 1 459 rows, none with that id). On run 2 the example rebuilt onto a real pack and all three read EXPECTED 400 "pack … moved no stock". S-157. |
| `procurement.discrepancies.resolve` (manager) | run 1 only | the seed leaves ONE open discrepancy; the owner resolved it earlier in the same run, so the manager's example id was already spent. Owner read **OK 200** on the same fresh run; both read OK on run 2. S-156. |
| `notifications.messages.get` / `.markRead` (warehouse, manager) | both runs | message `fe8d2040-…573a` exists (1 row in `messages`) but belongs to another recipient, so the guard answers 404. S-149, verbatim. |

Evidence: `lean-warehouse-rules-smoke/smoke1.txt`, `lean-warehouse-rules-smoke/smoke2.txt`.

## Walk 2 — warehouse app, web desk 1280 × 800 (DOS-045, DOS-050, DOS-054)

Viewport 1280 × 800, DPR 2, measured with `getBoundingClientRect()`.

**Home.** Gate row text **"GUR/26-27/00496 · Guru Kripa Agencies (Balaji Super-Stockist)"** + "4 lines · 21 Sep,
12:28 am" + chip "counting"; the row's first line box is `x 208, y 508, 947 × 22`. A regex sweep of the whole
rendered `body.innerText` for `₹ | Rs | paise` returns **0 hits**. (`…-web1280-home.png`)

**Counts → the seeded 3-lot count (`b24cd950-…be0a`).** The screen prints "Blind count: the expected figure is
not on this screen." and three rows reading "Not counted". The GET the device makes,
`/warehouse/inventory/cycle-counts/{id}`, comes back with **`expectedPcs: null, variancePcs: null` on all three
lines**. Keyed 9 / 14 / 0 on the pad (the pad shows "Counted" and a running figure, nothing else), pressed Save:
`POST …/count` → **200**, and the reply to the godown again carries `expectedPcs: null, variancePcs: null` with
`countedPcs 9 / 14 / 0`. The screen then reads "Count is counted … Count saved".
(`…-web1280-count-keypad.png`, `…-count-filled.png`, `…-count-saved.png`)

**The desk half of DOS-045, and the "stale expected" the finding was actually about.** Read as owner, the same
count shows `expectedPcs 9 / 14 / 5`, `variancePcs 0 / 0 / −5`, which equals the ledger
(`sum(qty_delta)` = 9 / 14 / 5). I then posted a real `−2` damage adjustment on the Campa Cola lot (ledger on
hand 9 → **7**), opened a NEW count on that lot, and keyed **9** from the device:

* device's reply: `expectedPcs null`, `variancePcs null`, `countedPcs 9`;
* owner's reply on the same count: **`expectedPcs 7, countedPcs 9, variancePcs +2`**;
* ledger at that moment: **7**.

That is the finding's "Expected: variance +2", computed from the ledger at COUNT time — not the 9 that was true
when the count was opened. The already-counted line keeps its count-time expected when the ledger moves later
(9, unchanged by the adjustment), which is the DOS-045 guard.

**Held (`/stock/reservations`).** Rows read **"For SO-0894 · Surat Sales Agency · 3 pc · Batch RCP20260605"** —
order, shop, pieces, batch — testID `w11-row-…`, row box `1074 × 76` at `x 189`, one every 76 px.
(`…-web1280-held.png`)

**Pack.** "BEING PICKED" names the shop and the wave with its progress — "Shree Ganesh Kirana · PICK-0081 ·
**8 of 163 pc**", "Om Sai Provision Store · PICK-0083 · 36 of 96 pc". "READY TO PACK" reads **"Nothing picked and
waiting"**: no partly-picked order is offered as ready. Opening SO-0873 and pressing "Pack and bill" raises
`w6-dialog` (1280 × 800 scrim) reading: *"Pack SO-0873? 1 cartons leave the godown for Shree Ganesh Kirana. The
bill is issued in the same step and cannot be edited afterwards. **8 of 163 pc picked · 155 pc short.**"* — the
dialog names the shortfall in pieces (the review's "74 pc short" is this sentence; this seed's numbers are
8/163/155). I pressed Cancel. (`…-web1280-pack.png`, `…-pack-short-dialog.png`)

**Inbound gate count (GRN `863a59d9-…c8192`, GUR/26-27/00490).** Screen: "Blind count: what the bill says is not
on this screen." Keyed four lines with one damaged piece on line 1, then "Review the count" → **FINDINGS: "No
short, excess or damage recorded"** before saving, and after `POST …/grns/{id}/count` → 200 the panel shows
**"Damaged · 1 pc · open"** and nothing else. Every line of the warehouse reply carries
**`expectedQtyPcs: null`**, with `countedQtyPcs` and `damagedQtyPcs` as keyed, and one `discrepancies` row
`kind: "damaged", qtyPcs: 1, status: "open"`. So the godown sees damage only; short and excess are the desk's.
(`…-web1280-gate-count.png`, `…-gate-findings.png`)

**Pick screen, the DOS-054 chip.** The seed has no Tarsun lot inside 30 days, so I exercised the rule through the
owner's own setting and measured the boundary:

| rule (owner setting) | chips on PICK-0081 | the line at the boundary |
| --- | --- | --- |
| 150 days | 1 | **"Under the 150-day rule"** on Campa Cola B20260515, exp 9 Feb 2027 = **141 days**; RCP20260529 at **155 days** is NOT chipped |
| 160 days | 1 | the chip moves to Campa Lemon RCP20260529 (155 days), label reads **"Under the 160-day rule"** |
| 200 days | 3 | — |
| 0 days | **0** | the chip disappears |

Chip box `188 × 28`, colours `rgb(158,28,28)` on `rgb(253,239,237)` — the brick family. `warehouse.picklists.get`
carries `minShelfLifeDays` (150 / 160 / 200 / 0 in step) and `shortShelfLife` per line.
(`…-web1280-pick-shelf-chip.png`)

Picking the chipped line: the server answers with the warning —
`{"pickLineId":"01a0c02e-4e90-7154-…","code":"short_shelf_life","message":"batch B20260614 expires on 2027-03-11,
under the 200-day rule"}` — but **the screen shows nothing after the pick**: the line simply leaves the To-pick
list and the counter moves (1 → 2 → 3 of 13). The review's minor ("the design's haptics.warning / warning-strip
clause has no home") is confirmed on a real screen: the chip is the whole warning, and it is only visible BEFORE
the pick.

**Money on the picking screen.** The pick rows show ₹115.00 / ₹120.00 / ₹40.00. That is `mrpPaise` — the price
printed on the pack — and `warehouse.picklists.get` carries **no key matching `paise|cost|rate|price` at all**.
No purchase cost reaches the godown. The other five warehouse screens show no rupee.

## Walk 3 — manager app, web desk 1280 × 800 (Inbound gate)

`procurement.grns.get` for the MANAGER carries **`expectedQtyPcs: 1248 / 144 / 432 / …`** — the desk role — while
the warehouse reply for the same procedure carries `null`. Before counting, every line prints "Pieces received"
and nothing else ("0 of 4 lines counted"). I keyed **1240** on line 1 and pressed "Record the count": the line
then prints **"Expected 1248 pc"** above "Pieces received 1240" (box `x 192, y 610, 1068 × 18`, inside the
viewport), and the three uncounted lines still print no expected figure. So nulling the field for the godown did
not take the figure away from the desk. (`…-web1280-manager-gate-expected.png`)

**Desk sheet.** Inbound → Findings lists the flagged lines from the blind counts, including my gate count's
**"Damaged · 1 · Open · 21 Sep"** and the short/extra rows the desk computed against the bill the device never
saw. (`…-web1280-manager-findings.png`)

## Walk 4 — owner app, Settings → Business (DOS-054 blocker)

Field "Minimum shelf life to ship (days)", helper text *"A batch with fewer days left is offered last, never
first. The picker is warned, not stopped. 0 turns the rule off."*, input box `420 × 32` at `x 738, y 733`.

| case | on Save | on reload | in `tenant_settings` | effect |
| --- | --- | --- | --- | --- |
| type **30** | POST `/tenancy/settings` | field reads **30** | `"30"` | rule on |
| type **0** | POST | field reads **0** | `"0"` | pick chips: **3 → 0** |
| **clear the field** | the screen snaps to showing "30" while `edits` holds `''`; Save is sent | field reads **30** | **`""` (jsonb string, empty)** | `warehouse.picklists.get` answers **`minShelfLifeDays: 30`** — the rule is still ON |

The last row is the review's blocker, measured: the blank really does reach the database as `""`, and the reader
returns 30 — the number the screen shows — instead of the old `Number('') = 0` that silently turned the rule off.
(`…-web1280-owner-settings-30.png`, `-zero.png`, `-blank.png`, `-150.png`)

## Walk 5 — Pixel 7 (`Pixel_7_API_36`, 1080 × 2400, density 2.625)

Dev build `in.distributionos.warehouse` against my Metro (`Android Bundled 1744 ms, 1874 modules`), driven with
`adb shell input` and measured from `uiautomator dump` bounds.

* Home: gate row **"GUR/26-27/00496 · Guru Kripa Agencies (Balaji Super-Stockist)" / "4 lines · 21 Sep, 12:28 am"
  / "counting"**, row box `990 × 230` px. (`…-pixel7-home.png`)
* Counts → an open count: "Blind count: the expected figure is not on this screen.", line "Campa Cola 750 ml ·
  Batch RCP20260822 · **Not counted**", footer "0 / 1". Number-pad keys measure **260 × 200 px = 99 × 76 dp** —
  the warehouse floor target of 76 dp. No expected figure anywhere. (`…-pixel7-count-blind.png`, `-count-pad.png`)
* Keyed **9**, Done, "Save the count" → the row reads "9 pc" and the header "Count is counted".
  (`…-pixel7-count-keyed.png`, `-count-saved.png`) Read back afterwards:
  **warehouse role** `expectedPcs null · countedPcs 9 · variancePcs null`; **owner role** `expectedPcs 5997 ·
  countedPcs 9 · variancePcs −5988`. DOS-045 holds on the device, not just in the browser.
* Held: **"For SO-0894 · Surat Sales Agency · 3 pc · Batch RCP20260605"**, row `990 × 199` px (377 × 76 dp),
  secondary line 674 px wide, not truncated. (`…-pixel7-held.png`)

## Walk 6 — iOS, Expo Go (iPhone 16 Pro, iOS 18.0, headless)

* warehouse app: `iOS Bundled 3827 ms (1736 modules)`, boots and renders "Distribution OS - Warehouse / Sign in /
  Username / Password / The godown sign-in. Ask your manager for a username." (`…-ios-warehouse-boot.png`)
* owner app: `iOS Bundled 11427 ms (1727 modules)`, boots and renders "Distribution OS - Owner / Sign in / Use the
  username your distributorship issued." (`…-ios-owner-boot.png`)

This is the sanity boot the review asked for. It is NOT a walk: this Mac has no headless way to type into a
simulator without an Appium server, and I did not start one.

## Observations worth a coordinator's eye (none of them this lane's regression)

1. **A saved cycle count re-opens blank.** `frontend/warehouse-app/app/stock/counts/[id].tsx` drives the row chip
   from local `entered` state only (line 55, `useState<Record<string, number>>({})`), so after a reload every line
   reads "Not counted" and the footer "0 / 3" although the server's reply holds `countedPcs 9 / 14 / 0`.
   **Byte-identical at the merge base** (`git show 787181c:…` has the same lines) — pre-existing, not this lane.
2. **The owner screen writes the setting as a JSON string.** The seed stores `30` (jsonb number); a Save from
   Settings stores `"30"` (jsonb string), and a cleared field stores `""`. The lane's reader copes with all three
   — which is exactly why the blocker fix is the right one — but any other reader of `tenant_settings` should be
   assumed to receive strings.
3. **"1 cartons"** in the pack dialog (no plural rule on the carton count).
4. **LogBox dev toasts swallow taps on the Pixel 7.** The count pad's "Done" (box `[84,1893][996,2092]`) did not
   respond until I dismissed the two dev warning toasts stacked at the bottom of the screen; one of them is
   *"Can't perform a React state update on a component that hasn't mounted yet"*, raised by the app shell at
   sign-in. Dev-bundle only, but it is the same class of trap as the ANR dialogs the delivery gate recorded.

## Still not proven

* **No baseline `pnpm smoke` on main at the merge base.** Attribution of the seven BROKEN rests on an empty diff
  over billing / notifications / examples plus a reproduced cause for each, the route the DOS-175 ruling accepted.
* **A real 16-day lot was never picked.** The pilot seed has no Tarsun lot inside 30 days on an open wave, so the
  30-day rule was exercised by moving the distributor's own number across the boundary (141 / 155 days). The
  rule's arithmetic and its label are proven; "a 16-day batch sorts last in FEFO" is not — that path needs a lot
  seeded inside 30 days.
* **iOS is boot-only** (see walk 6), and no iOS screen was driven.
* **The manager gate count was not posted** (`grns.post`) from the screen, and no GRN was committed to the ledger
  during the walk; the desk side was read, not completed.
* Everything above was measured on **one tenant** (Tarsun). Cross-tenant behaviour of the setting was not walked.

## What I stopped

All-in-one (:3100), the three Expo web servers (:5176, :5173, :5174), both Metro instances (:8081, :8082), the
headless Chrome on :9333, and the iOS simulator (`xcrun simctl shutdown`). The Pixel 7 emulator was **not**
stopped — another lane started it; its app was returned to the launcher and `adb reverse` entries removed. The
test database `dos_test_b2_warehouse_rules` was left in place with the walk's rows in it.
