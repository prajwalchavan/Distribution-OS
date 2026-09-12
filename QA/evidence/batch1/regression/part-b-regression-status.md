# Batch 1 regression part B: is each new finding a regression, a consequence or pre-existing?

2026-09-13. Read-only git comparison (show/log/diff/grep only; nothing built, run or queried).
Baseline **c5c6e03** (before batch 1). Merged main **HEAD dffbfa4** (21 fixes, merges f4b1756 / 83c00b3 / aaa4f6a / 2abb27e).
DOS-029 is on **d600ab8** (branch `qa/b1-l5-manager-errors`, based on 2abb27e, not merged). The manager walk ran on the d600ab8 build:
its "No connection. Check the signal, then press again." string exists only there (`frontend/manager-app/src/strings.ts:47`).

## Summary

| # | Item | Verdict | Commit | Inside approved scope? | Suggested priority change |
|---|---|---|---|---|---|
| 1 | DOS-131: no screen creates a trip or adds a stop | **PRE-EXISTING** (never built) | none. The chain only reached it because DOS-039 (17be1a4) unblocked load-out and the walk used new orders instead of the seeded trips | **No, new scope** (docs/23 M7 and W10 list it; founder Q2 of 2026-09-12 says the warehouse creates trips) | Keep P0 as a go-live blocker. It is not a batch-1 regression and should not block the batch-1 or DOS-029 merge |
| 2 | DOS-133: W7 "Packed orders" shows 50 old packs | **PRE-EXISTING** | none (W7, `packs.list`, contract and seed ids all unchanged since c5c6e03) | **No, new scope** (same ordering class as DOS-023/025, whose texts cover other screens) | Keep P1 (with DOS-131 it blocks the chain from the UI) |
| 3 | DOS-132: Day-end offers trip cash; the deposit credits CASH_VAN | **CONSEQUENCE** (root cause pre-existing) | c0889f7 (DOS-034, merged in aaa4f6a) | **No, new scope.** It is the van-cash finding the DOS-034 plan and verifier said to file "at the same gate"; it was never filed | Keep P1. Re-grade the three failed DOS-034 checks as PASS for DOS-034's scope, with DOS-132 as a linked residual. Approve DOS-132 before Day-end is used with live trips |
| 4 | DOS-140: the sellable API lists damaged-bin lots | **PRE-EXISTING** | none. DOS-058 (d2efc20) only moves the same pieces from the vehicle row to the damaged-bin row | **Partly.** The rep and shop stock hint is inside DOS-074/DOS-097 (planned in batch 1, held for architect review; DOS-074's fix text excludes damaged locations). The raw view/API for every role is new scope | Keep P2 and fold it into the held DOS-074+097 plan |
| 5 | DOS-139: a bill cancelled before dispatch leaves the order `packed` | **PRE-EXISTING** | none. Note: after DOS-039 (17be1a4), re-loading that order now moves no stock | **No, new scope** | Keep P2 for now; re-evaluate to P1 after an API probe (reload or re-bill after cancel can sell the restocked pieces twice by code; not UI-reachable today) |
| 6 | DOS-134: M20 cannot record a part-case pick | **CONSEQUENCE** (loss of a wrong workaround the plan accepted) | 475092f (DOS-041, merged in f4b1756) | **No, new scope** (the plan and verifier name it a separate finding) | Keep P2 |
| 7 | DOS-136: retrying Bank it gets "idempotencyKey was already used with a different request" | **CONSEQUENCE** (mechanism pre-existing) | c0889f7 (DOS-034 copied the pattern into new, reachable dialogs); d600ab8 (DOS-029) made the 409 visible | **No, new scope** (a known residual, `QA/13-change-log.md:94`) | Keep P2 |
| 8 | DOS-135: documents panel drops a refusal while a sibling write is pending | **Defect in DOS-029's own new code.** Not a regression of main (the same refusal was silent at c5c6e03) and not pre-existing code | d600ab8 (unmerged) | **Yes, inside DOS-029** (the finding covers every refusal; the plan wires this panel) | Keep P2, but make the fix a condition for merging DOS-029 |

---

## 1. DOS-131: no screen can create a delivery trip or add a stop (P0)

**Verdict: PRE-EXISTING. The screen was never built, and nothing was removed.**

Evidence:
- **Git history.** `git log --all -G 'trips\.create|stops\.add' -- frontend` returns no commit on any branch, so no frontend file ever added or removed such a call. `git grep` for `trips.create` / `stops.add` over `frontend/` finds 0 hits at c5c6e03, HEAD and d600ab8.
- **Backend (present at both commits).**
  - `POST /delivery/trips` "Plan a trip with its stops": `backend/libs/contracts/src/delivery.ts:1286-1292` (c5c6e03), `:1304-1305` (HEAD).
  - `/delivery/trips/{id}/stops`: `:1375` (c5c6e03), `:1394` (HEAD).
  - Permissions at HEAD: `backend/libs/contracts/src/permissions.ts:189-194` sets `TRIP_PLANNERS` = owner, manager, warehouse, delivery; `:658` gives it `delivery.trips.create` and `:669` `delivery.stops.add`.
- **Screen inventory** (`docs/23-app-screens-and-api-gaps.md`, unchanged since c5c6e03).
  - §2.1 **M7 Load-out & challans** (manager) lists `delivery.trips.create/startLoading` (`:232-235`).
  - §4.1 **W10 "Trips: create, start loading"** (warehouse) (`:406`).
  - D7 van sale lists `delivery.stops.add` (`:463`).
  - O18 owner trips lists no create (`:115`).
- **What was built.**
  - W10 `frontend/warehouse-app/app/load/trips.tsx:1-13`: the header says the godown "may NOT create the round". The screen calls only `trips.list`, `startLoading` and `depart` (`:39-60`). Identical at c5c6e03.
  - O18 `frontend/owner-app/app/orders/trips.tsx:1-8`: register plus settlement preview only; unchanged.
  - M7 `frontend/manager-app/app/fulfilment/load-out.tsx` was changed only by DOS-025 (93c827c, draft-sheets panel). `git diff c5c6e03 HEAD` of that file contains no line mentioning a trip.
- **Founder decision.** Q2 (2026-09-12, `QA/13-change-log.md` founder decisions table): "Warehouse keeps create trip, add stops, start loading". W10's header contradicts both that decision and the permission matrix.
- **Why it was hidden.** The seed provides TRIP-ACTIVE and TRIP-NEXT (`backend/libs/database/src/seed-demo/delivery.ts:645`, `delivery-road.ts:126`). Phase 1 used those. The P0 DOS-039 stopped any chain at load-out (`QA/findings/09-phase-1-approval-gate.md:12`) until 17be1a4.

**Scope:** new. No approved finding covers trip planning.

**Reasoning.** The API and the permission matrix have had trip creation and stop-add since before c5c6e03, and the inventory assigns them to M7 and W10. No app at any revision has ever called either procedure. Batch 1 changed none of W10, O18 or the trip parts of M7. The gap was masked by seeded trips and by the DOS-039 blocker. DOS-039's fix let the chain walker push new orders past load-out for the first time, which exposed the gap without causing it. It remains a go-live P0, to be scheduled at the next gate rather than treated as a batch-1 regression.

## 2. DOS-133: the W7 Load screen's "Packed orders" never shows today's packs (P1)

**Verdict: PRE-EXISTING.**

Evidence:
- **Screen.** W7 `frontend/warehouse-app/app/load/index.tsx:55-58` calls `api.api.warehouse.packs.list({ limit: 50 })` with no filter and no paging; the panel is at `:179-189`. `git diff c5c6e03 HEAD` and `git diff c5c6e03 d600ab8` of the file are both empty.
- **Server.** `backend/libs/core/src/modules/warehouse/packing.service.ts:163-182`: `list` filters only on the optional from/to, picklistId, orderId and invoiced, and runs `.orderBy(desc(packConfirmations.id))`. There is no "not on a live sheet / not dispatched" filter. The file is unchanged since c5c6e03 (same lines).
- **Contract.** The `warehouse.ts` diff since c5c6e03 has hunks only at `:78`, `:565` and `:700`; the packs section (`:876+`) is untouched.
- **Batch commits on warehouse paths.** 17be1a4 (DOS-039, load-out confirm), 475092f (DOS-041, picks) and bdd6055 (DOS-023, picklists ordering). None touches `packs.list` or W7.
- **Why today's packs sort last.**
  - Seeded packs carry `demoId()` ids: a sha1 hash formatted as a UUID, not time-ordered (`backend/libs/database/src/seed-demo/ids.ts:50-80`). In `api-14-warehouse-packs-list-limit50.json` they run `ffea1a46-…` SO-0798, `ffcfa27d-…` SO-0778, … `efeb289f-…` SO-0070.
  - Live packs get uuidv7 ids starting `01a09…`, which sort below every seeded id under `desc(id)`.
  - The seed files are unchanged since c5c6e03.
  - `docs/23` §10 row 7 records the same class for `trips.list`.

**Scope:** new.
- DOS-023's text is the manager's Fulfilment picking-sheets list (`QA/findings/02-walkthrough-manager.md`).
- DOS-025's text is the manager's Load-out draft sheets.
- Neither mentions W7 or `packs.list`.

**Reasoning.** The client call, the server query, its ordering and the seed ids are byte-identical at c5c6e03 and HEAD, so the panel behaved the same way before batch 1. Phase 1 never built a sheet in W7; its load-out used the seeded draft sheet 374f2089. No batch commit touched the path.

## 3. DOS-132: Day-end offers trip cash for banking, and the deposit credits CASH_VAN (P1)

**Verdict: CONSEQUENCE of c0889f7 (DOS-034). The root cause is PRE-EXISTING: batch 1 did not add the trip-cash rows or the CASH_VAN posting. DOS-034 made banking that cash easy to reach from the manager desk, a trade-off its plan and verifier explicitly accepted pending a separate finding that was never filed.**

At c5c6e03:
- **Register.** `frontend/manager-app/app/money/day-end.tsx:85-87` listed `receipts.list({ status: 'collected', limit: 200 })`: every collected receipt, trip cash, UPI and bank transfer included. The cash and cheque totals (`:88-93`) filter by mode only.
- **Bank button.** "Bank this batch" sat in the register Panel header (`:239-250`, testID `bank-batch` at `:247`), out of sight. The deposit mutation is at `:105-114`.
- **Owner app.** Already offered "Bank it" for any `status === 'collected'` receipt, trip cash included (`frontend/owner-app/app/money/receipts.tsx:226-233`).
- **Server.** `receiptAccountCode` returned `CASH_VAN` for cash with a tripId (`backend/libs/core/src/modules/receivables/receivables.service.ts:267-270`), and `depositReceipts` credited it (`:817`, credit side `:849`). Settlement credits CASH_VAN again (`backend/libs/core/src/modules/delivery/settlement.service.ts:233-237`).

At HEAD (c0889f7):
- **Register.** Built from the cash and cheque lists only (`day-end.tsx:97-102`, merged at `:161-163`). The only filters are mode and status; there is no trip filter.
- **Tick guard.** `receiptMayBeDeposited` (`:413`) checks mode and status only.
- **Bank bar.** "Bank this batch" is now a bottom bar that stays in view (`:234`).
- **New Receipts panel buttons.** `frontend/manager-app/app/money/index.tsx` adds Bank it (`:150-160`, `:318-328`), again with no trip rule.
- **d600ab8.** Same code at `day-end.tsx:99-104` / `:415` / `:236`.
- **Server.** Unchanged in substance: `receiptAccountCode` at `:271-274`, deposit at `:826` / `:858`. The only diff is the same-rule substitution `isBankableReceiptMode` at `:845`. `settlement.service.ts` is unchanged.

Plan and verifier (`QA/evidence/batch1/plans.json` DOS-034; `implement-followups.md` DOS-034):
- **rootCause §3** defines the money the desk cannot bank as UPI, bank transfer, adjustment and credit_note rows.
- **rootCause §5** ("SECOND CAUSE … VAN CASH") says: "That is an accounting change needing approval, so it is a NEW finding, not part of DOS-034".
- **Changes** say: "Do NOT touch receiptAccountCode or the deposit posting" and "Do NOT encode a trip rule here".
- **Risk** says: "this fix makes it easy to reach. File and approve the van-cash finding at the same gate". Verify step 8 says never to bank receipts with a trip_id.
- **Verifier note:** "The plan's risk, not a defect in this diff … 'Bank this batch' is now easy to reach … must be filed and approved at the same gate."
- **Not filed.** Neither `QA/13-change-log.md` (including the residuals list `:90-96`) nor the 09 gate mentions van cash or CASH_VAN. It first appears as DOS-132.

The approved finding text (`QA/findings/02-walkthrough-manager.md`, DOS-034) names only UPI (RCPT-0699) and bank-transfer (RCPT-0697) rows as wrong. Its suggested fix is "exclude UPI/bank transfer from 'cash in hand'". The walker's three failed checks (`DOS-034-web-desk-manager`, `-web-phone-manager`, `-web-desk-accountant`) passed on actions, bar and refusal, and failed only on trip cash. Their "Expected" ("holds only money the desk can bank") is wider than the approved scope.

**Scope:** new (DOS-132), the planned companion to DOS-034.

**Reasoning.** Trip cash was on the Day-end list and bankable (owner app, hidden manager button) before batch 1, and the CASH_VAN double credit is untouched server code. What changed is reachability: DOS-034 put Bank this batch in view and added Bank it to the manager Receipts panel, knowingly and on the condition that the van-cash finding was approved alongside. That condition was missed.

Recommendations:
- Keep P1.
- Re-grade the DOS-034 checks as PASS within scope, with DOS-132 linked.
- Approve DOS-132 before pilot use.
- A cheap stopgap: hide or refuse receipts with a tripId on Day-end and Bank it until the settlement hand-off exists.

## 4. DOS-140: the sellable-stock API offers damaged-bin lots as available (P2)

**Verdict: PRE-EXISTING. DOS-058 does not change what reps and shops are shown in total.**

Evidence:
- **View.** `backend/libs/database/migrations/0003_force_rls_ledgers_views.sql:170-174` selects `on_hand - reserved > 0` over every location, with no kind filter. No migration has been added since c5c6e03.
- **Query.** `backend/libs/core/src/modules/inventory/stock.service.ts:166-192` (`sellable`): the location filter is optional. No inventory file has changed since c5c6e03.
- **Callers, identical at both commits.**
  - `frontend/sales-app/app/orders/new.tsx:100` sums every row per variant (`:106`).
  - `frontend/sales-app/app/shops/catalog.tsx:51`.
  - `frontend/retailer-app/app/order.tsx:97` sums "across the distributor's locations" (`:112`).
  - `frontend/delivery-app/app/stop/[id]/van-sale.tsx:94` passes a location.
- **Reservations never touch the bin.** They read the view for one location (`inventory.service.ts:341-345`; `orders.internals.ts:144-151`), which is the kind-`warehouse` location (`warehouseLocation`, `:154-167`).
- **The bin already held stock before batch 1.**
  - The c5c6e03 seed moves expiry write-offs and a leak loss into the damaged bin (`backend/libs/database/src/seed-demo/claims.ts:953-1011`).
  - Desk credit notes with `saleable: false` restock there (`billing/credit-notes.service.ts:471-477` at c5c6e03).
  - Phase 1 moved stock there with W8 (`QA/findings/03-walkthrough-warehouse.md:404`).
- **What DOS-058 (d2efc20) changed.** `deliveries.service.ts` checkLines now refuses a damaged or expired return marked saleable (HEAD `:346-351`).
  - Before: the obvious tap restocked such returns as `sale_return_saleable` into the **vehicle** location (plan rootCause: CN/9003 +24 into "Vehicle MH-05-AB-1234"). The view lists that row too, and at check-in those pieces could return to the godown as reservable stock.
  - After: the same pieces land in the damaged bin (`line.saleable ? saleableLocation : damagedLocation`), which the view still lists but reservations never use.
- **Unknown.** The committed evidence (db-05 shows balances, not the ledger) does not show where the 32 pc of SB20260802 came from; the verdict does not depend on it.

**Scope:** partly inside approved scope.
- The rep and shop "N cs available / in stock" hint is inside DOS-074 (`09-phase-1-approval-gate.md:25`; suggested fix "sum per variant at the Godown (exclude vehicle and damaged locations explicitly)") and DOS-097 (`:30`).
- Their joint plan (a new `inventory.stock.availability` read) is held for architect review (`QA/13-change-log.md`, "Held for an architect (Fable) review").
- The view and API exposure for every role, and anything else that sums the view, is new scope.

**Reasoning.** The view, the query and every caller are unchanged since c5c6e03, and the bin already held stock then. DOS-058 relocates damaged doorstep returns from one unfiltered location row (the van) to another (the bin), and removes their route back into reservable godown stock. It does not newly expose pieces. Keep P2 and add the kind filter and a guarantee test to the held DOS-074+097 plan.

## 5. DOS-139: cancelling a bill before dispatch leaves the order `packed` and back in the billing queue (P2)

**Verdict: PRE-EXISTING.**

Evidence:
- **Bill cancel.** `backend/libs/core/src/modules/billing/invoices.service.ts:788-845` (same lines at c5c6e03 and HEAD; the file is unchanged since c5c6e03). It refuses after dispatch (`:798-804`), restocks (`:827`), reverses the entry (`:828`), sets the invoice `cancelled` (`:829-838`), refreshes the outstanding and emits `InvoiceCancelled`. It never moves the order.
- **Order machine.** `backend/libs/domain/src/state-machines/order.ts:41-44`: `picking: { pack }`, `packed: { dispatch }`. There is no `packed → cancelled/confirmed` edge. No batch commit touches `state-machines/`.
- **Billing queue.** `invoices.service.ts:696-722` lists confirmed, picking and packed orders with no invoice outside ('cancelled', 'draft'). A packed order whose only bill is cancelled therefore reappears as "left to bill". Unchanged.
- **Batch commits on billing and orders.**
  - bc27847 (DOS-021) touches `credit-notes.service.ts`.
  - 54a3ec0 (DOS-094) moves `upiIntent` out of `billing.internals.ts`.
  - 40a2294 / 32315dc / 40fc300 (DOS-073 / DOS-020 / DOS-005) touch ownership, confirm and bargain gates.
  - None touches bill cancel or order state on cancel.
- **UI copy.** The dialog text "The number is kept. Stock and money come back. Only before dispatch." already existed at c5c6e03 (`frontend/manager-app/src/strings.ts:414`).

**Downstream note (batch 1 changes the impact, not the defect).** The stale `packed` order can still be:
- **Loaded again.** `load-sheets.service.ts:142-190` checks packed, pack confirmation and no live sheet; there is no invoice-state check.
- **Billed again.** `POST /warehouse/packs/{packId}/invoice` (`invoices.service.ts:950-993`: "a cancelled earlier bill does not block a new one"; the contract note says it never posts stock).

At c5c6e03, load-out confirm took the pack's `sale` lots out of the godown a second time (`load-sheets.service.ts:371-401` with `packedLotsByOrder`, ref_type `pack` / reason `sale`). That would have used up the +168 cancel restock. Since DOS-039 (17be1a4, HEAD `:383` "COUNTED VAN STOCK ONLY"), re-loading that order would dispatch goods while the books keep the restocked 168 as saleable. Neither path is in an app today: no app calls `issueForPack` at any commit, and W7 would not list the pack (DOS-133). This was not executed.

**Scope:** new. No approved finding covers the order state after a bill cancel; DOS-012 is a different case (a paid bill offered for cancel).

**Reasoning.** The cancel handler, the order machine and the queue query are identical before and after batch 1, so the order was always left `packed`. Keep P2, but re-evaluate to P1 once an API probe confirms that a cancelled-bill order can be loaded or re-billed, because after DOS-039 either path would double-sell the restocked pieces.

## 6. DOS-134: manager Pick & pack cannot record a part-case pick row after DOS-041 (P2)

**Verdict: CONSEQUENCE of 475092f (DOS-041). The capability that went away was an incorrect workaround the plan deliberately accepted losing. The correct capability (record exactly 6 or 18) never existed.**

At c5c6e03:
- **Stepper.** M20 `frontend/manager-app/app/fulfilment/pack.tsx:236-245` renders `QtyStepper` with `pieces`, `caseSize` and `onChange`, and passes no `onOpenPieces`. The kit shows its "Pieces" entry only when that prop is passed (`frontend/libs/ui/src/web/money.tsx:448-451` at c5c6e03). So whole cases only, **exactly as today**.
- **Ids.** Every recorded row was sent with `id: uuidv7()` (`:90`).
- **Server.** A new id was inserted as a split row with `requestedQtyPcs: 0` (`backend/libs/core/src/modules/warehouse/picklists.service.ts:605`). Only the order-line total was checked (`:620`, `:772`).
- **What that allowed.** Stepping one case (24) on the 6-pc row inserted a 24-pc split row on lot RCP20260710 beside the untouched 6-pc row, and the server accepted it because the line total was 24 ≤ 24.
  - The whole case was booked against one batch, and the 18 held on RCP20260724 was never picked.
  - FEFO had found only 6 available on RCP20260710 (`db-041-PICK-0084-before.txt`: rows ask 6 and 18).
  - Pack would then post −24 on that lot. That is the per-lot over-pick DOS-041 was filed for, and in the DOS-041 finding it ended in 400 "insufficient stock".

At HEAD (475092f):
- **Ids.** M20 sends each row's own id (`pack.tsx:105`, `:144`); the stepper is unchanged (`:250-256`).
- **Server.** A pick above the stored row's ask is refused (`picklists.service.ts:593-596`).
- **d600ab8.** Ids at `:114` / `:153`, stepper at `:259-265`, and the refusal is now visible (`:380`).

The trade-off was accepted in writing:
- **Plan risk:** "M20 gets stricter, and a gap already there becomes visible … Today the manager records 24, which is accepted and can break the pack. After the fix it is refused. This is correct for DOS-041. Loose-piece entry on M20 is a separate, unreported issue and is not fixed here."
- Review note (c) and the notes section say the same.
- The verifier and the implementer's follow-ups say "Needs its own finding".

**Scope:** new. DOS-041's text is "picking more than the lot line asks for is accepted".

**Reasoning.** Neither before nor after batch 1 could M20 key a part-case ask. Before, it could only mis-record a whole case against one batch, which is the defect DOS-041 closed. Keep P2: the warehouse app's Short keypad still records exact picks, and this affects only the desk fallback.

## 7. DOS-136: after a lost reply, Bank it again answers "idempotencyKey was already used with a different request" (P2)

**Verdict: CONSEQUENCE of c0889f7 (DOS-034), with d600ab8 (DOS-029) making the 409 visible. The mechanism is PRE-EXISTING.**

**Why the SAME key meets a DIFFERENT body:**
- **Client keying.** `frontend/libs/api-client/src/react/index.tsx:377-391` is identical at c5c6e03, HEAD and d600ab8.
  - `mutateAsync` hashes the hook **input** (`intentHash(input)`, `:379`).
  - It keeps the current id and idempotency key while that input is unchanged (`:381-387`), then builds the request inside `run(input, meta)` (`:391`).
  - The cache is invalidated only on success (`:393`), and `reset()` issues a new key (`:415-421`).
- **The DOS-034 mutation** (HEAD `frontend/manager-app/app/money/index.tsx:150-160`; d600ab8 `:152-162`).
  - Its input is `{ receiptId, ref }`, but `run` adds `depositedAt: new Date().toISOString()` (HEAD `:156`, d600ab8 `:158`). Bounce does the same with `bouncedAt` (HEAD `:167`).
  - After a network failure the dialog stays open (HEAD `:549-557`, d600ab8 `:530`). Pressing again sends the same input, so the same key, but a body with a new timestamp.
- **Server.** The deposit hashes the whole input, timestamp included: `receivables.service.ts:822` (c5c6e03) / `:831` (HEAD) call `idempotent(tx, input.idempotencyKey, input, …)`. `backend/libs/core/src/platform/idempotency.ts:55` hashes it with sha256, and `:68-72` answers 409 with that sentence. Unchanged since c5c6e03.
- **Other paths.** Closing and reopening goes through `deposit.reset()` (HEAD `:324`, d600ab8 `:326`), so a new key meets the status check: 409 "receipt … is deposited, not collected". Either way nothing is banked twice (walker DB: one journal).
- **Stale "Collected".** Nothing is invalidated on error, and nothing is refetched after an unknown-outcome network failure.

**Did the retry path exist at c5c6e03? Yes, silently.**
- **Day-end.** `day-end.tsx:105-114` stamps `depositedAt` inside `run` (`:111`). On error the dialog closes but the ticks stay (`:437-446`). Pressing "Bank this batch" again (`:245`, no reset) resends the same input and key with a new timestamp: 409, with the dialog already closed.
- **Owner app.** `receipts.tsx:83-93` (`depositedAt` at `:90`) with `.then(done, done)` (`:305`) and no reset on open (`:231`): the same silent 409.
- **Manager Receipts panel.** It had no Bank it at c5c6e03.

**Batch 1's part.**
- c0889f7 copied the pattern into two new, easy-to-reach dialogs and moved Day-end's button into view. The implementer's follow-up ("Existing defect I copied"), the verifier note, and the residual in `QA/13-change-log.md:94` all record this.
- d600ab8 turned the silent close into a visible sentence, which is DOS-029 working as designed.

**Scope:** new.
- DOS-034's text is about missing actions and list content.
- DOS-029's text is about showing refusals, which it now does.
- The machine sentence also belongs to DOS-141.

**Reasoning.** Nothing banks twice; the defect is a confusing retry and a stale state. Keep P2. The fix is in the intent pattern: fix the timestamps once per intent, refetch after an unknown-outcome network failure, and map this 409 to "already saved".

## 8. DOS-135: documents panel drops a refusal that arrives while another write is in flight (P2)

**Verdict: a defect inside DOS-029's own implementation (d600ab8, new code). It is not a regression of main and not pre-existing code.**

Evidence:
- **The rule.** d600ab8 `frontend/libs/api-client/src/react/index.tsx:476-497` (`nextRefusal`). In the frame where refusal A arrives while a sibling write is pending, A is added to `seen` (`:483`, `:494`), and `shown` is forced to `undefined` because some write is pending (`:484-485`; rule 2 of its own comment, `:471`). In the next frame the sibling succeeds, `arrived` is empty because A is already seen, and `prev.shown` is `undefined`, so nothing is shown (`:486-490`). A is never displayed.
- **The panel.** d600ab8 `frontend/manager-app/app/inbound/documents.tsx:475-478` wires `<Refusal of={[startReview, saveReview, releaseReview, rematch, acceptMatch]} testID="docint-panel-refusal">`. The Start reviewing press is at `:486` and rematch at `:532`. This is exactly the walker's sequence: rematch pending, then startReview gets 409.
- **Tests.** `refusal.test.ts` on d600ab8 has four cases (`:58`, `:77`, `:86`, `:118`); none covers `[error A, pending] → [error A, success]`.
- **Verifier proof.** `QA/evidence/batch1/implement-results-dos029.json` (minor problem on `react/index.tsx`) records a temporary assertion over frames [pending, pending] → [error A, pending] → [error A, success] that shows nothing, and names the documents panel.
- **Not pre-existing.** `nextRefusal` and `useRefusal` exist in no file at c5c6e03, 2abb27e or HEAD. At 2abb27e the same panel's startReview had no rejection handler at all (`documents.tsx:479`, `.then(ok)`), so every refusal there was silent. That is the original DOS-029 defect.

**Scope:** inside DOS-029. The finding covers "every server refusal"; the plan puts all five panel writes under one `<Refusal>`.

**Reasoning.** For the user, nothing got worse relative to c5c6e03, where this refusal was always silent. The remaining silence comes from the new rule, so this is an incomplete DOS-029, not a new finding's scope. Keep P2, but fix it (plus the missing `refusal.test.ts` case) before `qa/b1-l5-manager-errors` merges.

---

The "Regression status: UNDER INVESTIGATION" lines for DOS-131..136, 139 and 140 in `QA/findings/10-batch1-regression.md` can be filled from the verdicts above.
