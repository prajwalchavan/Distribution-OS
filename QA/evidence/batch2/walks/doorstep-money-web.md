# doorstep-money-web — DOS-172 · DOS-174 · DOS-175 · DOS-176 · DOS-177, the browser half

Walked 2026-09-21 in the worktree `.claude/worktrees/b2-walks`, branch `main` at **50cab0c** (clean tree),
against database `dos_test_b2_walks`. Web only, at **1280×800** and **390×844**. No Android and no iOS —
see "Machine reading" below.

All five fixes are present on 50cab0c and were walked, not read: `receivables.service.ts:721-750`
(`trip_not_found` / `trip_not_on_road`), `deliveries.service.ts` (`podEvidence.deliveryId` in the look-up),
`vehicles.service.ts:251,285` (`locationConsents.userId`), `load-sheets.service.ts` / `packing.service.ts` /
`trips.service.ts` / `delivery.internals.ts:439,489` (`onADraftSheet`, `ridingTrips`, `registerRoadHold`,
`bill_on_road`, `bill_not_loaded`), `manager-app/app/fulfilment/load-out.tsx:212-215,360` (`challanToken`).

## What I started, and what I stopped

| Thing | Where | Stopped |
| --- | --- | --- |
| `backend/all-in-one` (`DOS_MODE=all WORKER_INLINE=1 ALL_IN_ONE_PORT=3100`) | **:3100**, all eight services behind prefixes + the inline worker | yes, before returning |
| `@dos/warehouse-app` (expo web) | **:5176** | yes, before returning |
| `@dos/manager-app` (expo web) | **:5174** | yes, stopped mid-walk to free memory |
| `@dos/delivery-app` (expo web) | **:5177** | yes, stopped mid-walk to free memory |
| `QA/tools/pw-server.mjs` (headless Chromium, CDP) | **:9350** | yes, before returning |

Ports **:3000–:3007 were already held** by processes I did not start (PIDs 99690–99708) and were never
touched. A second `@dos/all-in-one dev` (PID 10408) and the `Pixel_7_API_36` emulator (PID 82296) belong to
other blocks and were left alone. Database `dos_test_b2_walks` was **dropped and recreated from
`dos_test_batch2b_template`** and migrated (`pnpm db:migrate`, exit 0); **not re-seeded** — the template copy
arrived fully seeded (3 tenants, 82 challans, 1 170 receipts) and no earlier walk had spent it. `dos` and
`dos_qa` were never connected to.

Honesty notes on my own commands: (1) I ran one `pkill -f "5176"` to stop my warehouse Metro; my headless
Chromium died in the same minute and I restarted it — the two may be unrelated (memory pressure), but the
command was wider than the single PID and I am recording it. (2) Every other stop was by PID.

**Machine reading before any device work** (the block's refusal rule): free RAM **2 382 pages × 16 KiB =
38 MB**, swap **7 863 / 9 216 MB = 85.3 %** at the start; **55 MB / 87.4 %** and later **16 MB free** while two
Metro servers ran. Both past the ~300 MB / ~85 % thresholds throughout, so **no emulator and no simulator was
booted**. The device legs are returned **not-proven** with that reading, not guessed at.

### A setup hazard worth passing on
Each app's `EXPO_PUBLIC_AUTH_URL` **defaults to `http://127.0.0.1:3000`** (`src/config.ts:31`), which on this
Mac is another block's auth service on another database. Setting only `EXPO_PUBLIC_API_URL` +
`EXPO_PUBLIC_API_PREFIX` signs the browser into a foreign tenant while reading data from yours: my first
warehouse sign-in produced a token with `tid 01a0b9b5-4765-777d-8073-f34f3a983513`, a tenant that does not
exist in `dos_test_b2_walks` (`select count(*) from tenants where id=…` → 0), and every list came back
empty with 200s. The user ids are identical across seeded databases, so the shell still read
"Kavita Sawant · Tarsun Enterprise" and nothing looked wrong. I restarted with
`EXPO_PUBLIC_AUTH_URL=http://127.0.0.1:3100/auth` and the token read `tid 01a0999a-…` (the pilot). **Any walk
that pointed an app at an all-in-one without setting the auth URL should re-check which tenant it measured.**

---

## DOS-175 — a receipt may name only a trip the office can settle

### API ground truth (`:3100`, accountant `meena.joshi`)

| Call | Measured |
| --- | --- |
| `POST /receipts` with `tripId` = a UUIDv7 no trip has (`01a0c223-57c0-78c6-bd32-13e005a785fd`) | **404** `trip_not_found` — "no trip … at this distributor; record this money at the office, with no trip" |
| `POST /receipts` with `tripId` = `TRIP-NEXT` (state `planned`) | **409** `trip_not_on_road` — "this trip has not left, or was cancelled; money is taken while the trip is out, or at the office with no trip" |
| `POST /receipts` with no `tripId` | **200**, `RCPT-9005`, `tripId: null` |
| `POST /receipts/deposit` for it | **200**, `{"updated":1,"journalEntryId":"01a0c223-5834-…","totalPaise":4000}` |

Rows (`doorstep-money-web-sql/api-rows.txt`): receipts naming the ghost trip = **0**; receipts in the whole
database naming a trip that does not exist = **0**; receipts on the planned trip = **0** — the two refusals
wrote nothing. `RCPT-9005` is `deposited`, `trip_id` NULL, `deposit_ref` `WALK-175`, exactly **one**
`deposit_ref` and **one** Dr BANK line; its journal entry is `BANK +4 000 / CASH −4 000`, sum **0**.

### Browser, manager desk (`vikas.kadam`)

M-money's "Record a payment" sheet has **no trip field at all** — an office receipt by construction
(`receipt-shop`, mode, `receipt-amount`, `receipt-reference`, `receipt-submit`). Recorded ₹55.00 cash against
Khan General Store → **200**, `RCPT-9006`, **`tripId: null`**. Day-end → the receipt appears under "Cash and
cheques in hand"; ticked, bank-slip `WALK-175-WEB`, "Bank this batch" → **200**
`{"updated":1,"journalEntryId":"01a0c23a-0953-…","totalPaise":5500}`. The header figure **"Cash to bank" fell
from ₹40,96,384.52 to ₹40,96,329.52 — exactly ₹55.00**.

Ledger (`doorstep-money-web-sql/web-rows.txt`): `RCPT-9006` `deposited`, `trip_id` NULL, one `deposit_ref`,
one Dr BANK line; entry lines `BANK +5 500 / CASH −5 500`, sum **0**. Pilot-tenant trial balance **0**, and
**0** unbalanced entries in the tenant.

At 390×844 both receipts read **"Banked"** in the register (`RCPT-9006` at x 36 y 479 w 255, `RCPT-9005` at
x 36 y 551, both inside the viewport), `scrollWidth` 390 = viewport, no horizontal scroll.

**Verdict: proven.** The money a desk records now lands where the cashier reaches it, and the ledger says so.
Screenshots: `doorstep-money-web-webdesk-money-receipt-recorded.png`,
`doorstep-money-web-webdesk-money-banked.png`, `doorstep-money-web-webphone-money-banked.png`.

---

## DOS-176 — proof of delivery (was a 500, "proof insert returned nothing")

API, driver `ganesh.more`, the published example body → **200**, `pod_evidence` row
`01a0c223-5839-709b-9092-b27d15682fe0` (`kind geo`, `distanceM 40`, lat 19.2437, lng 73.1355).

Browser, both widths, through the real doorstep path (arrive → bill → "Delivered in full" → photograph →
"Record the delivery"):

| | 390×844, Joshi Kirana Stores | 1280×800, Ansari Kirana Stores |
| --- | --- | --- |
| delivery row | `delivered`, receiver "Joshi ji" | `delivered`, receiver "Ansari bhai" |
| `pod_evidence` rows | **2** — `geo` (19.240012 / 73.125307) + `photo` | **2** — `geo` + `photo` |
| the photo object | `uploaded`, 85 bytes | `uploaded`, 85 bytes |
| HTTP | `sync/upload` 200, no 5xx anywhere | `sync/upload` 200, no 5xx anywhere |

The credit-shop gate held on both: `d4-record` stayed **disabled** with "This shop is on credit — a photo is
required before you can record it" until a photo was attached.

**Verdict: proven** — the 500 is gone and both rows it should write exist, with the photo's bytes stored.
One thing the walk found on the way is filed separately as **S-175**: the direct PUT to the signed storage
URL 404s under all-in-one and the bytes only arrive because the screen falls back to sending them inline.
Screenshots: `doorstep-money-web-webphone-d4-pod-recorded.png`, `doorstep-money-web-webdesk-d4-pod-recorded.png`.

---

## DOS-177 — the driver's GPS consent (was a 500 with no message)

API → **200**, `location_consents` row `01a0c223-586c-7b9b-b442-b647472d77ef` (`granted t`,
`policy_version gps-notice-2026-09`, `locale en-IN`, `withdrawn_at` NULL); the previously granted row was
withdrawn in the same transaction, which is the intended rotation.

Browser, driver `ganesh.more`, both widths, from the app's own screens:

- 390×844 — D12 Settings → "Do not track me" (`d12-withdraw`) → **200** `granted:false`; screen reads
  "You refused location on this account". "I agree to be tracked" routes to D2 `/trip/start`, whose notice
  ("…sees where this vehicle is only while a trip is running… keeps the track for 90 days…") carries
  `d2-agree` at x 16 y 474 w 358 h 69, inside the viewport, no horizontal scroll. Pressing it → **200**
  `{"granted":true,"id":"01a0c23d-1e08-…"}` and the screen reads **"You agreed on 21 Sep, 10:03 am"**.
- 1280×800 — the same withdraw → grant pair on D12/D2 → **200** `granted:false` (`01a0c242-bd7e-…`) then
  **200** `granted:true` (`01a0c242-df82-…`).

**Verdict: proven** at both widths — no 500, and the row is written each time.
Screenshots: `doorstep-money-web-webphone-d2-consent-granted.png`, `doorstep-money-web-webdesk-d12-consent.png`.

---

## DOS-172 — the loading flow: a bill that came back undelivered

Fixture built through the running API as the real roles: driver `ganesh.more` failed stop 4 of `TRIP-ACTIVE`
(`shop_closed`) on `POST /delivery/stops/{id}/fail` → 200, which put **SO-0855 / INV/0825** back to `packed`
while its trip is still `active`. The seed already carries the other half: **SO-0845** and **SO-0850**, both
`dispatch → return_undelivered ("Stop failed; goods back on the dock")` on confirmed sheet **DC-0080**, whose
trip settled.

### A. The returned bill is offered again (W7, warehouse app)

| width | measured |
| --- | --- |
| 1280×800 | "PACKED ORDERS **3**" — SO-0862 (y 580), **SO-0850** (y 656), **SO-0845** (y 732), all in viewport; `scrollWidth` = 1280 |
| 390×844 | "PACKED ORDERS **3**" — same three at x 36, y 520 / 603 / 686, w 220, all in viewport; `scrollWidth` 390, no horizontal scroll |

**SO-0855 is absent from both** (`/SO-0855/` does not appear in the page text): the bill still riding a van
that has not checked in is held out, exactly as designed. Before the fix the two returned bills were the ones
hidden, for good.

### B. The bill still on the road is shown as held, and cannot be taken

W10 "Add a bill" panel, 1280×800: **1** held row, `testID w10-held-caa0f602-adba-7dba-9109-5c5fbb641f76`,
reading **"Vaibhav Kirana Mart · Out on TRIP-ACTIVE — back after check-in · ₹7,856.00"**, y 525, h 76,
in viewport, beside **3** plannable bills. At 390×844 the same row at x 17, w 356 in a 390 viewport, no
horizontal scroll. The row is a real `<button disabled data-state="disabled" data-pressable="false">` —
Playwright refused to click it ("element is not enabled") for 30 s. *(I had suspected it was only styled as
disabled; the measurement disproved my own suspicion.)* The server agrees: `POST /delivery/trips/{TRIP-NEXT}/stops`
for that bill → **409** `bill_on_road` — "invoice INV/0825 came back undelivered and is still out on trip
TRIP-ACTIVE; plan it again after that trip checks in".

### C. The whole second load-out, on screen

1. **W10** — tapped INV/0815 (SO-0845) → "Add a bill" → **200**; `TRIP-NEXT` went from "0 of **5** stops" to
   "0 of **6** stops".
2. **W7** — chose `TRIP-NEXT`; SO-0845 became selectable while SO-0850 went `disabled` with "Not on
   TRIP-NEXT. Add the bill to the trip first". "Build a sheet" → **200**, sheet
   `01a0c22f-df8a-72d2-8f01-0b9699c22b1f`, `draft`, `orderCount 1`, `expectedPackages 5`,
   `loadValuePaise 426400`, `ewbRequired false`.
3. **W7 detail** — "**Waiting for the manager** — A manager approves this sheet from the manager app."
   Declared value ₹4,264.00. Same at 390 (`scrollWidth` 390).
4. **M7** — the row read "21 Sep · MH-05-AB-1234 · **Waiting for your approval** · 1 · 5 · — · 4,264.00 · —"
   (y 302, h 32). Panel → "Approve the load-out" → **200**; the row became "**Approved · the godown may check
   it out**".
5. **W7** — the blind count: "**Blind count: what the bill says is not on this screen**", keypad only, no
   expected figure anywhere in the page text until after "Done". Counted **5** → "Send the vehicle out" →
   dialog "5 cartons leave on MH-05-AB-1234… This cannot be undone" → **200**, sheet `confirmed`.

Rows afterwards: sheet `confirmed`, `expected_packages 5`, `counted_packages 5`, `load_value_paise 426400`,
approved and confirmed; challan **DC-0083**, `value_paise 426400`, **2** lines, MH-05-AB-1234; and SO-0845's
newest transition is `packed → dispatched`, event `dispatch`, **reason NULL** — issued by the load-out, not
the `'trip depart'` of the finding. The old confirmed sheet is untouched (the order is listed on **2** sheets:
DC-0080, the record of the first load-out, and the new one).

**Verdict: proven** on the web for W7, W10 and M7 at both widths, with the challan and the transition read
out of the database.
Screenshots: `doorstep-money-web-{webdesk,webphone}-w7-packed-orders.png`, `…-w10-held-bill.png`,
`…-w7-sheet-built.png`, `doorstep-money-web-webdesk-m7-approve-panel.png`, `…-m7-approved.png`,
`…-w7-confirmed.png`.

---

## DOS-174 — closing the load-out panel must not leave a challan poll running

Walked on M7 with a challan whose PDF the worker had not yet rendered (all 82 seeded challans start with
`pdf_object_key` NULL, so the first answer is `queued`). Instrumented `window.open` and counted every
`GET …/warehouse/challans/{id}/pdf` with its offset from the start of the leg.

| | 1280×800 (sheet A = DC-0041) | 390×844 (sheet A = DC-0047) |
| --- | --- | --- |
| note after pressing Print | "Preparing the challan. It will open here once ready." | same |
| poll requests before the close | t = **116 ms**, **3 160 ms** | t = **2 973 ms**, **6 133 ms** |
| panel closed at | t = **5 136 ms** | t = **8 006 ms** |
| requests after the close | **1**, at t = 6 197 ms — the attempt already scheduled at 3 160 + 3 000 ms | **1**, at t = 9 153 ms — likewise |
| then, for the next 16–18 s | **none** (the poll would otherwise have fired at ≈9.2, 12.2, 15.2, 18.2 s) | **none** (≈12.2, 15.2, 18.2, 21.2 s) |
| the next sheet's panel | DC-0047 opened: "Print the challan" with **no note and no URL** | DC-0074 opened (a different sheet, ₹1,07,223.00 vs ₹1,28,158.00): **no note, no URL** |
| `window.open` calls | **0** | **0** |

Precise reading: the guard drops the **answer** and stops scheduling; one already-queued request still goes
out (a harmless GET whose reply is discarded by the token check at `load-out.tsx:226`). Nothing opens for the
closed sheet, and the newly opened panel is clean.

**Verdict: proven** at both widths.
Screenshots: `doorstep-money-web-webdesk-m7-challan-poll.png`, `doorstep-money-web-webphone-m7-challan-poll.png`.

---

## Storage URLs under all-in-one — filed as S-175 (corrects S-170)

S-170 read the failed POD upload as a missing CORS header. Measured here, the URL simply has **no handler**:
`absoluteUrl()` (identical in all seven apps, `src/config.ts:41-45`) ignores `EXPO_PUBLIC_API_PREFIX`.

```
GET :3100/storage/tenant/…/documents/challan/2eb547a3-….pdf?expires=…&signature=…   -> 404
     {"error":"no service is mounted at this path","services":["/auth","/owner",…]}
GET :3100/manager/storage/…  (same signed URL, prefixed)                            -> 200 application/pdf 22019
GET :3100/delivery/storage/tenant/x.png                                             -> 403 (route present)
GET :3100/storage/tenant/x.png                                                      -> 404
```

The POD path survives on its inline fallback (`deliver.tsx:545-610`), leaving one `pending` `file_objects`
orphan per photo — **2 of 2** in this walk. The manager's "Print the challan" has **no** fallback: it hands
that 404 straight to `window.open`. All-in-one is Stage 0 of the cost plan (docs/26 §7).

---

## Still not proven

1. **Android and iOS — every claim.** No emulator or simulator was booted: free RAM 38 MB / swap 85.3 % at
   the start, 16 MB free at the worst point, both past this block's refusal thresholds. Owed on a device:
   W7's blind-count keypad and the check-out dialog under a real touch target; D4's **camera** POD (the web
   leg used a file chooser, which is a different capture path); D2's consent notice on a phone; and M7's
   challan poll against the phone's own `documents.open`.
2. **DOS-176's camera path.** Web attaches a file; the device takes a photo through
   `@dos/ui/platform` and squeezes it to ≤ 300 KB (docs/27 §15). Not exercised.
3. **DOS-175's `/sync/upload` doors.** The design maps `trip_not_found` / `trip_not_on_road` to
   `SyncRejection` so the tray shows a named money code. I walked only the ONLINE `POST /receipts`; the
   offline receipt path and the D10 tray were not walked, and DOS-178's "handed to the cashier" card is a
   different block's.
4. **DOS-175 settled-trip modes.** Cash/cheque on a settled trip → 409 `trip_settled`, UPI/bank accepted
   (answer A) was not re-walked; only `trip_not_found` and `trip_not_on_road` were.
5. **DOS-172 Rule C (`bill_not_loaded`).** `trips.depart` refusing a trip that carries an uncounted bill was
   **not** proven: my attempt hit the state machine first (409 "cannot apply depart in state planned") because
   `TRIP-NEXT` had not started loading. The D2 sentence that would print it is untested.
6. **DOS-172's e-way bill arithmetic.** The rebuilt sheet came to ₹4,264.00 with `ewbRequired false`; the
   threshold case (a re-attempt pushing the load to or past the limit) was not constructed.
7. **DOS-174 counterfactual.** I did not delete `challanToken.current += 1` and re-run to watch it fail — the
   source guard `manager-app/src/lib/s-108-challan-close.guard.test.ts` already claims that red, and I did not
   re-run it here.
8. **Nothing was measured on a database other than `dos_test_b2_walks`**, and the pilot `dos` database was
   never touched — including the DOS-175 design's Q3 repair query for pre-existing bad rows.
