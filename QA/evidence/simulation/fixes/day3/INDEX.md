# fix-day3 evidence — DOS-232, DOS-233, DOS-234, DOS-235 (and DOS-236's wording)

Run 2026-09-26 20:55–21:22 IST on this worktree's build: all-in-one API :3418 (`WORKER_INLINE=1`) against
`dos_test_fixday3` (from `dos_test_batch2b_template`, migrated, re-seeded), Expo web on :5418. Screens driven
with Playwright Chromium (desk 1280×800, phone 375×812); the manager's plan form was also opened in the Browser
pane. Each `.png` has a `.txt` with the page text; `*.wire.log` holds the API calls of that step (sign-in and
refresh bodies omitted: they carry session tokens).

Setup through the API (not UI): a second packed bill for Ambika Provision Store (SO-0879 → INV/9007, the credit
gate approved by the owner), so Ambika has two bills (INV/0820, INV/9007) like Balaji on day 3. After the plan:
manager approves the load sheet, the godown confirms it (13 cartons, the 12 van pieces), Raju Yadav gives consent
and departs; later ₹13,341.00 cash is taken at Ambika and the trip returns with Nutan's bill (INV/0815) on the
van (`wire-15`); after the owner turns the first request down, the godown moves Nutan's 256 pieces off the van
(`wire-21`).

| Files | Finding | What it shows |
| --- | --- | --- |
| `01`, `02`, `03`, `04` | DOS-233 | Desk M7 (vikas.kadam): "What the van does · Deliver bills / Deliver and sell from the van" (shown because `van_sales` is on); the dialog says "The crew may sell from the van on this trip"; wire `POST /manager/delivery/trips` → 200 `vanSalesEnabled: true`, TRIP-0001. |
| `05`, `06`, `06b`, `07`, `08` | DOS-233 | Godown W7 (dinesh.patil, phone): "STOCK TO SELL FROM THE VAN" lists godown lots; failure path — 9999 and then 24 keyed on an 18-piece lot → "Only 18 pc are in the godown", nothing added; 12 pieces picked; `POST /warehouse/warehouse/load-sheets` → 200 with the three bills AND `vanStock` 12 pc Bourbon (sheet shows "Sunbake Bourbon Cream 300 g · 12 pc"). |
| `09`–`12` | DOS-232 | Crew (raju.yadav, phone) at Ambika with two bills: after INV/9007 is recorded the stop still reads "At the shop" with "Deliver this bill" for INV/0820 (`12-…-bill-1`); after the second it reads "Delivered" (`12-…-bill-2`). Both `POST /delivery/delivery/deliveries` → 200. |
| `13`, `14` | DOS-233 | Crew van sale at Nutan: chip "Sell from the van" (allowed), only Bourbon "12 pc to sell", and "256 pc on the van belong to bills of this trip and are not for sale" (Nutan's own Jeera Soda 240 + Toothpaste 16 are not offered); `GET /delivery/delivery/trips/{id}/van-stock` → 200. |
| `wire-15` | DOS-232/234 | Trip return: Ambika `delivered`, Nutan `failed`; the desk's Undelivered register lists INV/0815 only. Old vs new balances read on Loader 1 (592 zero rows): old `limit=200` → 200 rows, 3 non-zero, cursor set; new `nonZero=true` → exactly the 3 live lots, 268 pc. |
| `16`, `17` | DOS-234 | Godown W9 check-in on MH-05-CD-5678: "268 pc in 3 lots" — every live lot, from a vehicle with ~590 zero rows; Bourbon 12 counted back → "256 pc in 2 lots", "Moved back to the godown". |
| `18`, `18b`, `18c` | DOS-235/236 | Accountant day-end (meena.joshi): ₹13,641.00 handed over of ₹13,841.00 expected; red line "256 pc in 2 lots are still booked on the van — the godown has not counted them back in. Settled now, they count as missing."; the dialog says it goes to the owner; the 409 reads "cash is ₹200.00 short (allowed ₹100.00) and the van count does not tally on 2 lots (256 pieces missing) — sent to the owner, who settles it by approving" (capitalised since). |
| `19` | DOS-235 | Manager's "Waiting for a decision": "TRIP-0001 · MH-05-CD-5678 · Trip settlement · waiting for the owner, whose approval settles the trip", no Approve/Reject for the manager (the server answers 403, spec). |
| `20`–`20e` | DOS-235 | Owner approvals: the row is "TRIP-0001 · MH-05-CD-5678", value −200.00; the panel shows cash expected (float ₹500 + cash taken ₹13,341 − expenses ₹0), handed over, "₹200.00 short · You allow ₹100.00 either way", UPI/cheques, and each lot that did not tally with batch and value at cost (Toothpaste 16 pc missing ₹1,107.84, Jeera Soda 240 pc missing ₹1,864.80). The owner REJECTS with a note ("Nutan's bill is still on the van…"): "TRIP-0001 stays open, and the desk counts the cash and the van again". |
| `22`–`22c` | DOS-235 | After the godown counted the rest back (`wire-21`), the accountant settles again: only "cash is ₹200.00 short (allowed ₹100.00) — sent to the owner…". |
| `23`–`23e` | DOS-235 | Owner approves: "Approving settles TRIP-0001 now: cash ₹200.00 short. Then the trip's cash and cheques can be banked." → toast "TRIP-0001 settled with a variance"; the row leaves the queue. |
| `sql-24` | all | TRIP-0001 `settled_with_variance`, settlement settled_by meena.joshi, approved_by sunil.tarsun, −20 000 paise; approvals rejected (with the note) then approved; Ambika stop `delivered` with INV/0820 and INV/9007 delivered, Nutan `failed`, INV/0815 `failed`/order `packed`; sheet `van_stock` 12 pc; Loader 1 0 live rows; journal CASH 1 314 100 · CASH_SHORT 20 000 · CASH_VAN −1 334 100 (balances). |

Specs: `backend/libs/core/src/modules/delivery/road-fixes.spec.ts` (6 tests: two-bill stop both orders; a return
with the second bill undelivered → stop `partial`, bill on the Undelivered register; van-stock read and a van sale
refused 400 when it would take another shop's cartons, then the free 24 sell and shop A still gets its bill;
`nonZero` balances past a page of zeros; the red settlement's human refusal, the owner queue's trip/cash/lot value
(no cost stored on the approval row), manager 403, owner approve settles; a recount expires the old request and
figures that moved since are refused `settlement_changed` with the request left open). Frontend: `trip-settlement.test.ts`,
`all-pages.test.ts`, `van-sale.test.ts` (DOS-233 block), both `trip-plan.test.ts` (van-sales switch and load-sheet van stock).

Observed, not fixed here: on the crew phone the queued `arrive` op reached the server after the first bill had
been recorded online and was rejected `stale` ("1 need attention", `12-…-bill-1.wire.log`, sync upload). The stop
was already `arrived`; the rejection is noise in the tray. It is the same ordering with or without this change.

Observed, not fixed here (follow-up): W9 check-in moves every counted piece van → godown RACK
(`inventory.stock.transfer`), including the pieces of a bill that came back undelivered, which the DOS-195 dock
model (ruling S1) stages on the DOCK for its next sheet. Moving Nutan's 256 pieces that way (`17`, `wire-21`) made
`@dos/db`'s `dispatch-stock.test.ts` report "the dock holds 0 pc of lot … the packed bills waiting there need
240 / 16" on `dos_test_fixday3`; the same suite is 122/122 green on a freshly seeded `dos_test_fixday3b`. Now
that W9 shows every lot on the van (DOS-234), the godown will meet this more often.
