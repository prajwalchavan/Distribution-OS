# Batch 1 — reviewer notes, doc follow-ups and platform checks (21 decision-free fixes)

Generated from `implement-results.json` (workflow run wf_843b78bb-4d1). Every fix: failing test confirmed before, passing after, no blocker/major problem.

## DOS-039 (L1-warehouse) — commits: 17be1a4

**Deviations:** None in behaviour; the fix is the plan's.

- **Service:** LoadSheetsService.confirm keeps `lots = loadSheetLots(tx, counted)`, which still feeds the empty-sheet guard and the challan. The inventory post is now built from `input.countedVanStock` summed per lotId in a Map (in insertion order), with the same transfer_out/transfer_in shapes, ref_type/ref_id and `load:<sheetId>:<lotId>:out|in` keys. The class comment and the confirm comment are rewritten.
- **Other files:** the contract and schema edits are comments only, so there is no Zod, route, summary or migration change.
- **Test 1 detail:** it checks the two ledger rows with `toHaveLength(2)` plus `expect.arrayContaining` rather than an ordered `toEqual`. Two uuidv7 ids made in the same millisecond may not sort in insertion order, and the length check keeps it exact.
- **Test 2:** follows the plan's setup and after-fix assertions exactly, and is the last `it` in the describe, with a comment saying why.

**Follow-ups:** Doc updates for the main session (not done here):
- docs/plans/warehouse.md:16, :51 step (d), :161 and :194 still say every lot on the sheet moves at load-out.
- docs/22-source-of-truth.md:117 diagram says 'stock: warehouse → vehicle'. It should say 'van stock: warehouse → vehicle; packed orders left as sale at pack', which restates docs/plans/delivery.md:17/31/84. docs/22 is founder-owned, so the main session decides; if changed, re-render and republish.
- docs/18-build-log.md: add a row for the fix.
- README regeneration: none needed. There is no contract summary change, and `pnpm docs:readme:check` should be unaffected; it was not run, per instructions.

Frontend, deliberately left alone (out of scope):
- frontend/warehouse-app/app/load/[id].tsx:14-17 header comment still says 'a transfer_out + transfer_in per lot'.
- :81 always sends `countedVanStock: []`, and there is no van-stock count screen, so drafted van stock is dropped at the gate. After this fix a warehouse-app confirm moves no stock at all, which matches the pilot data.
- The dialog string at warehouse-app/src/strings.ts:323 is left as is.

Adjacent issues seen, not fixed:
- `pnpm smoke` confirms the newest draft load sheet on every run without --destructive (backend/tools/smoke-endpoints.mts:1640-1651). Before this fix that could double-deduct in the dev `dos` database; worth a separate gating look. The `dos` database was not queried.
- Spec databases where the old code succeeded keep their doubled rows. The ledger is append-only, so there is no backfill.
- Optional hardening: the 'lakh of goods' test could also assert `ledgerFor(bigSheetId)` is empty.

Merge note: DOS-040, DOS-041 and DOS-042 likely also append tests to the end of warehouse.spec.ts. The DOS-039 sold-out test must stay the LAST `it` when resolving conflicts.

**Platform check:** Server-side fix, so the result is identical on web, Android and iOS. Walk it on dos_qa.

**Prep**
1. Take a pg_dump of dos_qa first: confirms cannot be undone.
2. `pnpm --filter @dos/core build`, then restart every service that composes WarehouseModule: owner :3001, manager :3002, warehouse :3004, delivery :3005, and retailer :3006 (its DeliveryModule imports WarehouseModule).
3. Take the plan's "before" on_hand snapshot for the godown 01a0947d… lots of sheets 374f2089 and 1e5181b6, plus the 6 van_load lots on vehicle 3bbe6b52….

**Web, warehouse app :5176, dinesh.patil / Dos@1234**
Home → LOAD SHEETS → 'MH-05-AB-1234 · 12 Sep · 5 orders · 38 cartons · draft' (sheet 374f2089-b8fd-720e-907c-8380307948ab) → count 35 → variance note → 'Send the vehicle out' → confirm.
Expected: a success toast; the sheet shows confirmed with a DC-… challan; SO-0869/0871/0875/0876/0878 become dispatched; no 400 'insufficient stock'.

**DB checks after that confirm**
- `select count(*) from stock_ledger where ref_type='load_sheet' and ref_id='374f2089-…'` returns 0.
- The re-run snapshot shows identical on_hand for every godown lot (the 6 surplus lots included) and for the 6 vehicle lots.
- `delivery_challans` has one row for the sheet, with 23 lines.

**Surplus case, after the fix only**
Confirm sheet 1e5181b6-843a-7855-a4d5-cb6451723518 with its expected package count. Expected: 0 load_sheet ledger rows and its 3 godown lots unchanged. Never confirm this sheet on unfixed code.

**Android (Pixel_7_API_36 with -memory 3072), warehouse app**
Use the draft-sheet screen for 1720dd92-c311-7860-bae2-8c80ba18ee14 (approved, 11 lots). Expected: same result as on web.

**Positive van-stock check**
As manager, create a sheet with vanStock [{lotId: <a godown lot with surplus>, qtyPcs: 12}] and no orders. Confirm it through the API (POST :3004/warehouse/load-sheets/{id}/confirm) with countedVanStock carrying the same entry. Expected: exactly one transfer_out (-12, godown) and one transfer_in (+12, vehicle) for that lot.

**Verifier minor notes:**
- `backend/libs/core/src/modules/warehouse/warehouse.spec.ts` — The plan requires summing countedVanStock per lot. No test sends a repeated lotId, so a regression to the unsummed version (where the second entry is dropped by onConflictDoNothing) would go unnoticed. No test covers a lot that is both packed and counted van stock either (only the van part should move). The two DOS-039 tests cover the finding itself: a sold-out packed lot and a packed lot with surplus.
- `backend/libs/core/src/modules/warehouse/warehouse.spec.ts` — The 'refuses to load a lakh of goods without an e-way bill number' test still confirms a packed-only sheet without asserting ledgerFor(bigSheetId) is empty after the confirm. The plan marks this hardening as optional and the implementer lists it as a follow-up.
- `frontend/warehouse-app/app/load/[id].tsx` — The header comment at line 16 still says 'a transfer_out + transfer_in per lot'. The plan deliberately leaves the frontend out of scope, and the implementer lists it as a follow-up along with docs/plans/warehouse.md:16/51/161/194 and the docs/22:117 diagram. Only docs and comments are stale; behaviour is correct.

## DOS-040 (L1-warehouse) — commits: 740f8c5

**Deviations:** None in the fix. Four small points:

- **Line numbers.** Spec line numbers moved after the DOS-039 commit. The corrected assertion is at 1246 (plan: 1229). The new tests sit after the offline test that now ends at 1281.
- **Extra assertions.** Each guards something the plan relied on:
  - the DOS-040 test checks `row.requestedQtyPcs === 12` (the fixture assumption);
  - the guard test checks `accepted === 0`.
- **Where the not-started line sits.** "This sheet has not been started" (testID w5-not-started) and the start-error line (w5-start-error) are placed at the top of the content stack. That is above the view switch and the list, which meets the plan's "above the list".
- **Chip.** Its label and family use `liveStatus ?? sheet.status`, still shown only when the local sheet row exists, as the plan says.

Contract, permissions and schema: none changed.

**Follow-ups:** **Docs for the main session**
- docs/23 §4.1 W5: the Start step (`warehouse.picklists.start`) is now wired, and the device refuses an open wave as `picklist_not_started`.
- docs/18: add the build-log row.
- QA state: mark DOS-040 fixed.
- docs/plans/warehouse.md test 20 (picklist_closed for a `picked` sheet) is still true.
- No README regeneration is needed: rejection messages do not appear in the generated READMEs.

**Open questions and residuals**
1. **Scan while the sheet row is unknown.** Per the plan, the lock covers an unknown status (sheet row not yet pulled), but the bottom bar stays unchanged there. Scan is visible and silently does nothing until the `picklists` row lands. This is transient. Decide whether the unknown case should show a waiting line instead.
2. **Short sheet under a lock.** If the short sheet were already open when the lock applied, its Done does nothing and the sheet stays open. It is not reachable today: a sheet never goes back to open or unknown after being started.
3. **Sibling gap (reviewer note, not DOS-040).** Manager M20 (frontend/manager-app/app/fulfilment/pack.tsx:110-112) lists `open` sheets as active and posts `picklists.pick` with no Start on that screen. The server correctly answers 409 "start it before picking". Flag it separately if wanted.
4. **DOS-042 rebase.** DOS-042 must rebase onto the split gate in warehouse.sync.ts (keep the open branch) and the new `locked` flag in pick/[id].tsx. `picked`, `packed` and `cancelled` are deliberately left unlocked here for DOS-042 to decide.
5. **Rejected picks already on devices.** A device that already holds a rejected pick against an open wave keeps its optimistic "Picked in full" row after Start. That is DOS-042 / DOS-046.
6. **Duplicate event.** A second start with a different idempotency key re-emits `PicklistStarted`. Nothing consumes it today.

**Platform check:** Sign-ins: warehouse app on :5176 as dinesh.patil / Dos@1234; manager as vikas.kadam. In dos_qa, SO-0881, SO-0883 and SO-0884 are confirmed and on no picklist.

**Web** (fresh browser profile so an old rejected row cannot pollute the walk; 1280×800 and 390×844)
1. Pick tab → select SO-0883 → "Make a wave". The sheet opens with chip "open" and the line "This sheet has not been started" (w5-not-started). Rows show item, batch, expiry, MRP and quantity, with NO Picked/Short. The bottom bar holds only "Start picking" (w5-start): no Scan, no "Take it to packing". Measure at both widths.
2. Go offline. "Start picking" is disabled with "Starting a sheet needs a signal". Record whether it flips on the offline event or only after the next failed call. Go back online.
3. Tap Start. POST /warehouse/picklists/{id}/start → 200. The chip turns "picking" at once; Picked/Short appear on every row; Scan and "Take it to packing" return.
4. Database:
   - picklists: status picking, started_at set;
   - SO-0883 state: picking;
   - order_state_transitions includes start_picking.
5. Tap Picked on line 1. POST /sync/upload returns accepted 1, rejected []. pick_lines.picked_qty_pcs is set. No new sync_errors row; the tray stays empty.
6. Home → WAVES ON THE FLOOR lists the wave as picking.

**API**
7. With a warehouse token, upload a pick against an open wave made in manager M5 from SO-0881. Expect `picklist_not_started` and "Picklist PICK-XXXX has not been started; start it before picking".
8. A pick against PICK-0079 (`picked`) still returns `picklist_closed` "…is picked; it is no longer being picked".

**Android** (QA route: debug APK, proxy8081.mjs 5176, android-login.sh warehouse 5176 dinesh.patil Warehouse)
- Use another confirmed order and repeat steps 1, 3 and 5; airplane mode for step 2.
- Screenshot the not-started and the started sheet.
- `adb reverse --remove-all` afterwards.

**iOS** (Appium, headless simulator, ios-login.mjs 5176 dinesh.patil warehouse)
- Repeat steps 1, 3 and 5 and screenshot.

**Verifier minor notes:**
- `frontend/warehouse-app/app/pick/[id].tsx` — Lines 96-100: `startedHere` is never cleared. `liveStatus = startedHere ?? sheet?.status` lets the Start reply win for as long as the screen stays mounted. The code comment says it wins only 'until the next pull repaints the local row'. After a Start on this screen, the chip keeps saying 'picking' even when the local row moves to 'picked', until the screen is reopened. The lock is not affected (picking and picked both unlock). The formula is the plan's own, so this is not a deviation, but the chip can disagree with the device row. That is the 'three truths on one sheet' theme DOS-042 is about.
- `frontend/warehouse-app/app/pick/[id].tsx` — Line 102: while the sheet row is not on the device yet (`liveStatus === undefined`), picks are locked but no Start button shows (`notStarted` is false). Scan stays visible and does nothing. This state is reachable: W4 (pick/index.tsx:97) goes to /pick/{id} right after `picklists.create` without starting a pull, so a freshly made wave shows no Start until the next poll lands the `picklists` row. It clears itself (the pull covers warehouse-role picklists of every status for 30 days, warehouse.module.ts:51-54, so open sheets do arrive), and the plan explicitly left the bar unchanged here. The implementer flagged it as residual 1.
- `backend/libs/core/src/modules/warehouse/warehouse.spec.ts` — Line 1220: the corrected test still says 'a wave nobody has started is closed to the device', while its assertion (line 1246) is now `picklist_not_started`. The fix exists to say the opposite: not closed, not started yet. Only the comment is stale; the assertion is correct.
- `frontend/warehouse-app/app/pick/[id].tsx` — No automated test covers the UI half: the Start button, hidden Picked/Short/Scan, the not-started line and the offline disabled reason. warehouse-app has no test runner. I read the code and ran typecheck and lint, but did not run it on any device (dev servers, emulator and simulator were out of scope for this lane). The main session's web/Android/iOS walk is the only proof it works.

## DOS-042 (L1-warehouse) — commits: d8dccd8cb401497a9bc0be0d6e3ff1b900ed6e6c

**Deviations:** Implementation deviations: none. The rule in refreshCompletion is exactly the plan's amended per-line rule: full pick OR (picked > 0 AND shortReason AND no row with requestedQtyPcs > 0 still has pickedAt NULL on that order line). perLineTotals, assertNotOverPicked, the warnings, the status gate and the sync handler are untouched.

Minor test-placement and assertion details:
- DOS-040's tests were committed after the plan was written, so the three DOS-042 tests sit after the DOS-040 guard test. They are still after 'accepts a pick from a device…' and before the roles section.
- The shared setup is a describe-scope helper, dos042Wave(tag, expiry). It creates a 10-pc lot per test (expiries 2027-03-31 / 03-30 / 03-29), places a one-case (12-pc) order, waves it, asserts one order line on exactly two rows asking 10 and 2 (found by lotId), and starts the wave.
- Local test types Dos042Line/Dos042Sheet add pickedAt and completedAt to the existing body interfaces. The shared interfaces are unchanged.
- Test 1 also asserts completedAt is null after the short. Test 2 also asserts completedAt is set at the end.
- No existing test was modified.
- The local.ts change was not already made by DOS-040 (its commit did not touch local.ts), so it lands here as the plan instructs.

**Follow-ups:** Doc updates for the main session:
- docs/18 build log row for DOS-042.
- docs/22: only if it states the wave completion rule. The new rule: a wave is picked when every order line is either fully picked (whichever rows carried the pieces) or short with a reason and every lot row it was asked on recorded.
- docs/plans/warehouse.md line 43 is already updated in this commit.
- No contract, permission or schema change, so there is no README/OpenAPI regeneration for this fix.

Not run here (dev servers not allowed):
- pnpm --filter @dos/core build, then restart warehouse-service :3004 and manager-service :3002 (and owner :3001 if definitions.ts mounts the warehouse module there).
- pnpm smoke --service warehouse and pnpm smoke --service manager, both expected to end with 0 BROKEN.

Not repaired: existing waves already wrongly closed, e.g. PICK-0079 in dos_qa. Verify on fresh waves.

Adjacent defects noticed (from the plan notes, not fixed):
1. Likely P1: packing.service.ts whatLeftTheRack selects only pick rows with picked_qty_pcs > 0. A line shorted to 0 on every row falls back to its pending reservations and is packed and billed in full.
2. The manager app M20 (manager-app/app/fulfilment/pack.tsx:90) sends every pick under id: uuidv7() instead of the row's own id.
   - A second Record pick adds rows and can hit the over-pick 400.
   - The wave's own rows never show as picked.
   - After this fix, a line a device shorted can be closed from M20 only by counting it in full.
   - Fix: send line.id.
3. warehouse.sync.ts reads the wave with findPicklist, not lockPicklist. Two devices finishing the last rows at the same instant can miss the close (never close early).
4. A line shorted to 0 on every row never completes the wave (the picked > 0 clause, pre-existing). Pack still works.
5. Related open findings on this flow: DOS-050 (pack list shows ordered pcs), DOS-046 (Try it again replays the rejection), DOS-051 (Short with no reason saves the first chip).
6. No Expo app has a test harness, so the local.ts rejected-row change is proven only in the running app (platform check B).

**Platform check:** Main session, after merging and rebuilding @dos/core and restarting warehouse :3004 and manager :3002. First re-check which confirmed orders are un-waved and held on 2+ lots (query in the plan's verify).

A. Web, warehouse app :5176 as dinesh.patil / Dos@1234 (e.g. SO-0868):
1. Wave the order and start it with the sheet's Start step.
2. On a multi-lot line, Short one lot row with fewer pieces and 'Not on the rack'.
3. Press Picked on every other row except one more lot row of that same line.
Expected:
- SQL `select status, completed_at from picklists` shows picking with completed_at NULL.
- Badge picking, header 'N-1 of N picked', 'Take it to packing' disabled.
- Short the last row with 0 and 'Batch held back': no tray item.
- That pick_lines row has picked_qty_pcs 0, short_reason 'Batch held back' and picked_at set.
- The wave is now picked with completed_at set, header 'N of N', 'Take it to packing' enabled.

B. Web, rejected op on screen (e.g. SO-0867):
1. Open the sheet in two browser profiles as dinesh.patil and start the wave.
2. Take profile 2 offline and press Picked on row X.
3. In profile 1, record row X and every other row so the wave closes.
4. Bring profile 2 back online. Its op is rejected picklist_closed.
Expected: row X stays under To pick with its Picked/Short buttons, the count excludes it, 'Take it to packing' stays disabled, and the tray shows the rejection. After Refresh, row X shows the server's copy.

C. Manager M20 regression (e.g. SO-0883):
1. Wave and start the order in the warehouse app.
2. In the manager app :5174 as vikas.kadam, go to Fulfilment → Pick and pack, set every row to its asked pieces, and Record pick.
Expected: the sheet moves to Pack → Ready to pack. SQL status = picked; the original rows still have picked_at NULL; the new rows have requested_qty_pcs 0 with picked_at set. Packing it succeeds.

Android (Pixel_7_API_36, -memory 3072): repeat A on another qualifying order (e.g. SO-0884) and confirm by SQL.

iOS (headless simctl, QA/tools ios-login for :5176): on another order (e.g. SO-0881), short one lot row and leave another row of that line untouched. Header count and badge must read picking.

**Verifier minor notes:**
- `frontend/warehouse-app/src/lib/local.ts` — The rejected-row change (`_pending === 'rejected'` makes the row 'todo') has no automated test, because no Expo app package has a test harness. I confirmed it by reading the offline engine plus a clean warehouse-app typecheck and lint, not by execution. A pull uses INSERT OR REPLACE and does reset `_pending` for rows the server sends back. A rejected row whose server copy never changes is not re-sent by the delta pull, so it stays 'todo' until Retry or Discard. That is the intended 'not recorded' reading. Discard (engine.ts:793-810) then clears `_pending` but leaves the values this device wrote, so the row reads picked or short again even though the server never recorded it. That Discard behaviour predates this fix and is out of scope; it is worth a follow-up. The main session's platform check B should exercise this path.
- `backend/libs/core/src/modules/warehouse/picklists.service.ts` — Accepted residual risks, all named in the plan and none a regression from this commit. (1) A short line with a lot-less asking row stays picking until that row is recorded over the API, because the device drops lot-less picks (queue.ts:57). (2) The manager app's M20 records every pick under a new uuidv7 id, so a line one device shorted can be closed from M20 only by counting it in full. M20 sends no shortReason at all (manager-app/app/fulfilment/pack.tsx), so no M20-only short ever closed a wave before the fix either. (3) The sync handler reads the wave with findPicklist, not lockPicklist, so two devices recording the last rows at the same moment can miss the close; they can never close it early.
- `docs/plans/warehouse.md` — `prettier --check` flags this file, but it already failed at the parent commit d8dccd8^ (checked through stdin). docs/ is also outside the backend workspace's `prettier --check .`, so this commit did not introduce it.

## DOS-041 (L1-warehouse) — commits: 475092f

**Deviations:** The fix follows the plan. The deviations are small and come from DOS-040 and DOS-042 already being on this branch:

1. **Where the specs sit.** The plan put them right after 'accepts a pick from a device and never answers 4xx' and before `// roles:`. The DOS-040 and DOS-042 specs now sit between those two points. I put the DOS-041 specs after the DOS-042 guard spec, immediately before `// roles:`. That keeps the earlier fix blocks together and away from the new lot. DOS-039 stays the last test, as its comment requires.

2. **TINY lot expiry is '2028-01-31', not '2027-03-31'.**
   - The DOS-042 fixture lot A already uses 2027-03-31.
   - DOS-039's SOLDOUT lot (2027-06-30), created in the last test, expects FEFO to take it first.
   - With 2028-01-31, TINY still reserves ahead of lotB (2029-06-30), and the DOS-042 lots have 0 available by then. The executed run confirmed the 6 + 18 split.
   - If this spec ever stopped part-way, TINY could still never be taken ahead of SOLDOUT or DOS-042's lots.

3. **The spec also checks the refusal message and the unchanged row.** Spec 2 asserts `rejected[0].messageEn` matches /asks for 6/ and that the row still reads 0 after the refused upload. Spec 1 also asserts the line has exactly 2 rows. These are extra assertions only.

4. **Two comments made false by the M20 change were corrected.** No assertion or test name changed.
   - picklists.service.ts, `refreshCompletion` JSDoc: "(the manager app records every pick that way)" became "(an API client may record a whole line that way)".
   - warehouse.spec.ts, inside the DOS-042 guard spec: "exactly what manager-app/app/fulfilment/pack.tsx (M20) sends: every counted row under a NEW id" now says that is what M20 sent before DOS-041, and that it is still a valid API split.

5. **The plan's reason for not changing the Short pre-fill is out of date, but the plan still holds.** DOS-042 changed local.ts: a row whose upload was refused (`_pending === 'rejected'`) is `todo` again but keeps its optimistic figure. So Short can now open pre-filled above the ask, e.g. 20 on a 6-pc row. The planned over-ask line and refused save handle exactly that case, so the pre-fill was left unchanged as the plan said.

6. **Extra comments.** I added short explanatory comments at the new server rule, the W5 `ask`/`overAsk` derivation and the M20 `id: line.id` line.

7. **Contract comment wording.** The JSDoc on `RecordPickInput` also notes that a new `id` is a split row that asks for nothing of its own. It is a comment only; no schema, route or summary changed.

**Follow-ups:** **Docs for the main session**
- docs/22 and the build log: record that `warehouse.picklists.pick` now refuses a row the wave created from taking more than its own `requested_qty_pcs` (400 over HTTP, `pick_rejected` offline). Split rows ask 0 and stay bounded by the line total.
- Record that M20 now sends each row's own id, so a manager pick updates that row instead of inserting a split row.
- docs/plans/warehouse.md is already updated in this commit.
- Run `pnpm docs:readme` after merging. The contract change is a JSDoc comment only, so the READMEs should come out identical; I did not run it.

**Stale test name (not renamed)**
- The DOS-042 guard spec's name still says "(new ids, as the manager app records it)". M20 no longer records picks that way.
- I left the name alone because the DOS-042 commit refers to it. The comment inside the spec is corrected. Rename it later if wanted.

**Open or adjacent issues, not fixed here**
- **M20 cannot enter loose pieces.** Its QtyStepper steps only by whole cases and has no `onOpenPieces`. A part-case row (e.g. 6 pc in a case of 12 or 24) can now only be recorded as 0 or refused. Log this as its own finding, per the plan's residual note (c).
- **M20 hides refusals.** Its 400 does not appear on screen until DOS-029 lands.
- **Server gaps still open (from the plan's risk section).** An API-only split row can take more from a batch than that batch holds. Re-pointing an asking row onto a thin lot can still overdraw it. Pack stays the stock guarantee in both cases.
- **dos_qa's bad row is not repaired.** PICK-0079 row 01a094c0-82f2-7556 (6 asked, 20 picked, state short) still exists. W5 offers no Short on a `short` row, so it cannot be corrected from the device; use verify step 8 over HTTP, or re-seed.
- **W5 needs a real-app check.** No app test harness exists, so the Short-sheet behaviour is proven only by typecheck and lint until someone walks it.

**Platform check:** **Setup.** dos_qa, warehouse-service :3004, warehouse app :5176 as dinesh.patil, manager app :5174 as vikas.kadam, password Dos@1234.

1. **API.**
   - Raise a wave (e.g. on SO-0884) and POST `/warehouse/picklists/{id}/start`.
   - POST `/warehouse/picklists/{id}/pick` on a wave row asking N with `pickedQtyPcs` N+14 and `shortReason` 'Damaged carton'. Expect 400 "batch <batchNo> on PICK-00xx asks for N pcs; N+14 were picked".
   - Send the same pick as a `/sync/upload` op. Expect 200 with `accepted` 0 and `rejected[0].code` 'pick_rejected'.
   - The row is unchanged in both cases.
   - A pick of exactly N on the same row answers 200.

2. **W5 (warehouse app, web at 1280x800 and 390x844).**
   - Open the started sheet and press Short on a row asking 3. Expect "Requested 3 pc" and the figure 3 above the pad.
   - Key 2 then 0. Expect the pad to show 20 and a brick-coloured line under it: "This batch asks for 3 pc. Count again — more cannot be saved on this line."
   - Press Short. Expect the sheet to stay open, 0 waiting to send, and no `/sync/upload` request.
   - Press back to 2. The brick line disappears and Short saves 2; `pick_lines.picked_qty_pcs` reads 2.
   - Press Short on a row whose upload was refused, if one is queued. It may open pre-filled above the ask; expect the same brick line and refused save.
   - Repeat on Android (Pixel_7_API_36, booted with -memory 3072); spot-check iOS.

3. **M20 (manager app, web).**
   - Fulfilment -> Pick & pack, select the sheet.
   - Step one row up a case past its ask and Record pick -> confirm. Expect `lines[0].id` in the network panel to equal that row's id, and a 400 'asks for N'. The refusal shows on screen only once DOS-029 lands.
   - `select count(*) from pick_lines where picklist_id=<id>` is unchanged.
   - On a row whose ask is a whole case, record exactly the ask. Expect 200 with the SAME row updated.

4. **Pack.** Pick the rest in full and Pack and bill. Expect 200 with an invoice number, the stock_ledger pack rows per lot equal to -Σ picked, and no negative stock_balances row.

**Verifier minor notes:**
- `backend/libs/core/src/modules/warehouse/warehouse.spec.ts` — The DOS-042 guard spec is still named '...split rows alone (new ids, as the manager app records it)...'. After this commit M20 sends each row's own id, so the name is out of date. The comment inside the spec was corrected; the name was left as it is (the implementer noted this). Cosmetic only.
- `frontend/warehouse-app/app/pick/[id].tsx` — A deliberate behaviour change, accepted in the plan's risk section. W5 always PUTs the row's existing id and has no split UI. Before the fix a picker could put the extra pieces from one batch on its row (e.g. 24 on an 18-pc row with the 6-pc row at 0) and pack worked if the lot had the stock. Now that is refused, and on the device the picker can only short. Substituting from another batch now needs an API split row.
- `backend/libs/core/src/modules/warehouse/picklists.service.ts` — The new refusal message names `lot.batchNo` of the lot in the REQUEST. When an asking row is re-pointed onto another lot, the message names that new batch, but the ask belongs to the original row. Cosmetic; the refusal itself is correct.
- `backend/libs/core/src/modules/warehouse/picklists.service.ts` — A residual gap the plan names as out of scope. A split row under a new id (hand-crafted API call or sync op) asks 0, so only the line total bounds it. It can still take more from a lot than that lot holds, and pack remains the only stock guarantee. No first-party client creates such rows after this commit: W5 uses the row id, and M20 now sends line.id.
- `frontend/manager-app/app/fulfilment/pack.tsx` — A residual the plan names. M20's QtyStepper steps only by whole cases and has no onOpenPieces, so a part-case ask (e.g. 6 pc in a case of 12) can now only be recorded as 0 or be refused. The 400 does not show on screen until DOS-029. Needs its own finding.
- `frontend/warehouse-app/app/pick/[id].tsx` — No test harness covers the W5 Short sheet guard (overAsk line, haptics.error, refused save) or the M20 id change. They are proven only by typecheck and lint. The platform walk (web, Android, iOS spot-check) is still owed by the main session.

## DOS-023 (L1-warehouse) — commits: bdd6055

**Deviations:** No change to the fix itself; it follows the plan. Minor points:

1. Test position. The plan says DOS-023 must be the last test, but the DOS-039 commit on this branch had already added a test marked "KEEP THIS THE LAST TEST". I put DOS-023 after it, as the plan says tests from DOS-039 must go before it.
   - I reworded only DOS-039's comment: keep it after every test that reads lots; only DOS-023 follows it, and DOS-023 asserts sheet order, never a lot.
   - No assertion of the DOS-039 test changed, so testsCorrected is empty.

2. Test assertions. The test body follows the plan's notes, with three additions to back up "walks every sheet once":
   - each walk's length must equal the tenant's picklist count (all sheets, and packed ones) read straight from the database;
   - the unfiltered walk must start with the new wave (`all[0]`);
   - it must end with the older sheet.
   The plan's `indexOf(newest) < indexOf(olderId)` check was replaced by that first/last pair, which is stronger: indexOf returns -1 for a missing id.

3. Contract comment. The wording is slightly longer than the plan's. It also says the other lists are still ordered by id descending, so the header stays true until DOS-025 lands.

4. Index.tsx (Waves). No code change, as planned.

**Follow-ups:** 1. Main session, after merging all lanes: run `pnpm docs:readme`. Expect no README change, because only a header comment in contracts/src/warehouse.ts changed and no route summary or Zod shape did.

2. docs/22 and the build log: record that `picklists.list` now orders by `created_at desc, id desc` and pages with an id cursor matched against the cursor sheet's own (created_at, id). DOS-025 (load sheets) should reuse this exact pattern.

3. Adjacent items from the plan, recorded and not fixed:
   - (a) About 40 other lists in backend/libs/core/src/modules still order by `desc(<table>.id)`: orders, invoices, trips, collections, credit notes and more. On seeded demo data they show the same random order. Moving to server time is a cross-cutting founder decision.
   - (b) platform-admin/console.service.ts:260 orders by `createdAt desc, id desc` but pages with `id < cursor`, so it can skip or repeat rows across pages.
   - (c) Missing feature for docs/23 §10: the manager's M5 has no picker chooser, although `warehouse.picklists.start` accepts `assignedTo`. The finding's Expected asks for it.
   - (d) The Waves register shows at most 50 sheets with no "more" indication.
   - (e) Possible later index: `(tenant_id, created_at, id)`, needed only if the unfiltered list ever shows up in a profile. It needs a generated migration plus a hand-written sibling.

4. Open part of DOS-023: "sheet rows are not clickable". The plan disputes this with evidence, but it was never confirmed in a running app. It must be proven by the platform check below before DOS-023 is closed.

**Platform check:** Role manager, sign-in vikas.kadam / Dos@1234 (tenant tarsun). Manager app on :5174 against manager-service :3002, on a database copy that is not dos or dos_qa, per QA/STATE.md.

1. Pick & pack half, before rebuilding @dos/core. Run the manager app from this branch against the unfixed services.
   - Fulfilment → Pick & pack → "Picking sheet" lists PICK-0078 (Picking).
   - "Pack an order" lists the picked sheets.
   - This proves the on-device filter was a cause on its own.

2. Server half. Rebuild @dos/core, then restart manager-service and warehouse-service.
   - `GET :3002/warehouse/picklists?limit=50` returns items with createdAt descending; PICK-0079/0078/0077 on top.
   - Walking `?limit=2` by nextCursor returns every sheet once, and createdAt never increases.
   - The same holds with `&status=packed`.

3. Waves, web desk 1280×800.
   - Tick one confirmed order → "Make a picking sheet" → confirm. The new PICK-00NN is row 1 of "Picking sheets" (Open) and stays row 1 after a reload.
   - GATE: reload, then click that row. The "Sheet PICK-00NN" panel must open with its orders and lines, "Start picking" and "Cancel the sheet" enabled, and `GET /warehouse/picklists/<id>` must appear in manager-service.log or the Network panel.
   - If the click does nothing on a fresh page with no dialog open, the "rows not clickable" part is a real defect and DOS-023 stays open.

4. Android, Pixel_7_API_36 booted with -memory 3072, Fulfilment tab.
   - The new sheet is on top.
   - Tapping it opens the panel.
   - Pick & pack lists PICK-0078 and the new sheet.
   - Reuse the sheet from step 3; do not make a second wave.

5. iOS: the same observations via `node QA/tools/ios-login.mjs 5174 vikas.kadam manager`, or record NOT TESTED with the reason.

**Verifier minor notes:**
- `frontend/manager-app/app/fulfilment/index.tsx` — The finding's claim that sheet rows are not clickable was never checked in a running app, by the implementer or by me (this lane may not start dev servers). The code is wired: index.tsx:292-294 `onSelect` calls `setOpenSheet`, and the web Register renders `<tr onClick={() => onSelect?.(row)}>` (frontend/libs/ui/src/web/list.tsx). The plan makes verify step 8 a gate: reload, click the row, see the Sheet panel and `GET /warehouse/picklists/<id>`. The main session must run it before closing DOS-023. This is not a defect in the commit.
- `frontend/manager-app/app/fulfilment/pack.tsx` — The pack.tsx half has no automated test, which the plan accepts because the Expo apps have no screen test runner. Checked here: typecheck exit 0, eslint exit 0, prettier clean. Verified by reading: only the three per-status reads replaced `sheets`, Async takes arrays, prefix invalidation `['warehouse']` also refreshes the new keys, and imports are unchanged (only @dos/ui and @dos/api-client). Its runtime proof is plan verify step 6 (against unfixed services) plus the Android and iOS steps.
- `backend/libs/core/src/modules/warehouse/warehouse.spec.ts` — `expect(packed.length).toBeGreaterThanOrEqual(2)` depends on earlier tests in the file leaving packed sheets, so running the DOS-023 test alone with `-t` would fail that check. The plan sanctions this coupling, and the test must stay last. Also, the DOS-039 test's comment 'KEEP THIS THE LAST TEST' was reworded to allow DOS-023 after it. That is a comment-only edit with no assertion change, so an empty testsCorrected is accurate.
- `backend/libs/core/src/modules/warehouse/picklists.service.ts` — A cursor whose sheet is not visible (unknown id, another tenant, or a deleted row) now returns an empty page with nextCursor null. A client cannot tell that from the list ending. The plan accepts this, and a grep of backend/libs, worker and tools finds no code that deletes picklists, so there is no live path to it. Also plan-acknowledged: the unfiltered list loses the early-stopping backward scan on picklists_pkey, and a (tenant_id, created_at, id) index is the recorded follow-up.

## DOS-025 (L1-warehouse) — commits: 31af220, 93c827c

**Deviations:** None in substance. Two small notes.

1. Two commits, as the plan's red-first order asked. 31af220 is test(DOS-025): the stub encoding today's screen, the three specs, the vitest script and devDependency, and the lockfile. 93c827c is fix(DOS-025) in the prescribed message format: the real helper bodies, the screen wiring and the strings. The intermediate commit is red on purpose. The CI frontend job does not run pnpm test, so CI stays green at that commit.

2. Small additions inside the named tests, within the plan's own description of the helpers.
- Spec 1 also checks that loadOutQueue, given the whole unfiltered page, keeps only the draft. It also checks that history keeps the server's order.
- Spec 2's 100-row history page includes one cancelled sheet, to show that history keeps cancelled rows.
- Spec 3 mixes in a confirmed row and a duplicate draft, which covers the status filter and the dedupe.

The helper compares createdAt as text. I checked this is safe: warehouse.mappers.ts toLoadSheetSummary serialises createdAt with toISOString() (fixed width), and sheetDate is 'YYYY-MM-DD'.

No contract, permission, schema or backend change.

**Follow-ups:** 1. Merge overlap.
   - DOS-029 edits the same screen (the commit function and possibly the dialogs). My change leaves commit(), the dialogs, the Approve/Cancel buttons and the challans view untouched. It adds the `waiting` query after `sheets`, computes `queue`/`history` after `rows`, and replaces only the sheets branch of the render.
   - If DOS-023 lands in another lane with its own vitest script and devDependency on manager-app, keep one copy. In this branch DOS-023 did not add them; only DOS-025 did.
2. The frontend CI job (.github/workflows/ci.yml) does not run pnpm test, so these specs are guarded only locally. Decide once for the whole batch.
3. vitest was added to manager-app only, not to frontend/libs/app-template. Aligning the template is a follow-up.
4. QA/13-change-log.md should record the corrected facts from the plan.
   - The draft was on the page at row 62 of 83, not missing.
   - It was already approved by the seed, so Approve was correctly disabled and Cancel was live.
   - No unapproved draft exists in any seeded tenant.
   - The chain is blocked by DOS-039, not DOS-025.
5. Out of scope, noticed but not fixed (from the plan's review):
   - packs.list has the same desc(id) behaviour (packing.service.ts), and the warehouse app's W7 reads a 50-row page, which hides buildable orders.
   - The owner is a PIN_HOLDER, but the owner app has no Load-out screen.
   - The history footer says "N rows" even when the 100-row page is capped.
6. Docs: no docs/22 change is needed (no decision changed). The build log and docs/23's M7 entry could note the new two-panel layout. I did not run pnpm docs:readme, as instructed.
7. I ran pnpm install --offline in the worktree's frontend/ to update the lockfile. It pruned and relinked this worktree's hoisted node_modules (+8 −33); nothing outside the worktree was touched.

**Platform check:** This follows the plan's verify steps 2–16 on dos_qa after merge.

1. Role: manager vikas.kadam / Dos@1234. App: manager (:5174). Screen: Fulfilment → Load-out, web desk at 1280×800.
   - Before: capture document.querySelector('[data-testid=loadsheet-waiting-register]') → null.
   - After: the first panel under the PIN hint is "Not out of the godown yet".
   - After building an unapproved draft for SO-0862 via POST :3004/warehouse/load-sheets as dinesh.patil (vehicle 7e8fe8ac MH-05-CD-5678), the panel shows 2 rows:
     - Row 1: the new sheet with the clay "Waiting for your approval" chip.
     - Row 2: 12 Sep MH-05-AB-1234 "Approved · the godown may check it out".
     - Footer: "2".
   - The "Checked out and cancelled" panel shows 82 rows, all Confirmed, with no draft.
   - Network: GET /warehouse/load-sheets?status=draft&limit=100 and GET /warehouse/load-sheets?limit=100, both 200.
2. Open the new sheet: Approve and Cancel are both enabled.
   - Approve with a note → 200. The row stays in the top panel and its chip turns to Approved. SQL shows approved_by a1cbd424, and audit_log has a load_sheet.approve row.
   - Open 374f2089: Approve is disabled ("This sheet is already approved") and Cancel is enabled. Do NOT cancel it, and do not press Start loading or Send it off.
   - Cancel the new sheet with a reason → 200. It leaves the top panel and appears in history as Cancelled. Record that side effect in STATE.
3. Phone 390×844: the waiting panel is the first content under the hint. Rows show date, chip and value (no vehicle column, no footer, by design).
4. Android Pixel_7_API_36 (-memory 3072), manager dev build: same two panels with text in the rows. Re-run this if DOS-077's native List/Row fix lands.
5. iOS Expo Go via QA/tools/ios-login.mjs 5174 vikas.kadam manager. Screenshot Load-out. If the harness cannot get past home, record NOT TESTED.
6. Accountant meena.joshi on :5174: sees the waiting panel read-only. The sheet panel shows the accountant read-only line, with no Approve/Cancel.
7. After merging all lanes, in frontend/: pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build.

**Verifier minor notes:**
- `frontend/manager-app/app/fulfilment/load-out.tsx` — No automated test covers how the screen is wired. The specs test only the pure helpers loadOutQueue and loadOutHistory. Nothing tests that the screen makes the status:'draft' read, or that it feeds the queue into the new register and the filtered history into the old one. I checked this by reading lines 90-92, 135-136 and 214-261, and by finding testID loadsheet-waiting-register in the exported web entry bundle. The behavioural proof is the pw.mjs before/after check in plan verify steps 5 and 8, which the main session still has to run after the merge.
- `.github/workflows/ci.yml` — The frontend CI job does not run pnpm test, so the three new manager-app specs are only checked locally. The plan already flags this as a decision for the whole batch.
- `frontend/warehouse-app/app/load/index.tsx` — Line 47 reads warehouse.loadSheets.list({ limit: 30 }) without a status filter, in the server's desc(id) order. The warehouse crew's Load screen can bury or miss a draft the same way. The plan scoped the fix to M7 and did not name this sibling path, so it is not a scope violation. It should be a follow-up.
- `frontend/manager-app/app/fulfilment/load-out.tsx` — Two cosmetic points in the history panel. (1) The footer 'N rows' counts the 100-row page after dropping drafts and gives no '+' when the page is capped; the plan noted this was already so. (2) When every sheet is a draft, the history panel shows 'No load sheet today' right under a waiting panel that lists today's sheets.

## DOS-058 (L2-delivery) — commits: d2efc20

**Deviations:** None in substance; small details below.
1. Core import style. The value import in deliveries.service.ts is its own line, `import { isSaleableReturn } from '@dos/contracts'`, next to the existing `import type {…}` block. This matches reporting/register-specs.ts:14.
2. Error message. The template uses `String(line.reason)` so typescript-eslint's template-expression rule accepts the optional type. The text reads "<product>: damaged goods go to the damaged bin, not back on sale".
3. setAll. It uses `isSaleableReturn(reason)` for both modes, and isSaleableReturn(null) is true. For 'full' this gives exactly the plan's `returnedSaleable: true, reason: null`.
4. Extra spec assertions beyond the plan: data.reason equals the sent reason, and the planned delivery row is asserted as exactly `[null]` (the trip plan creates one planned row per stop).
5. Extra contracts test assertion: over `DeliveryLineReasonSchema.options`, the unsaleable set is exactly damaged and expired.
6. A short JSX comment above the reason chips explains the single control.
7. The checkLines JSDoc now mentions return_not_saleable.
No contract field, type, default, route, permission or schema change.

**Follow-ups:** 1. MAIN SESSION DOCS
   - Run `pnpm docs:readme` after merging. No README output should change, since only JSDoc changed and not the Zod shapes or summaries, but confirm with `--check`.
   - Record the fix in docs/18 build log and the QA change log.
   - docs/22 §8 register: note that "Past its date" returns go to the 'Damaged / expiry bin', and that D4 now has one reason control that decides the disposition. Neither rests on a dated founder decision.
   - docs/23 §5.1 D4 ("qty and reason") needs no change.
2. MERGE NOTES
   - DOS-056 touches deliver.tsx (commit/queue path) and may add specs to delivery.spec.ts. This fix changes only setAll, the per-line reason chips/caption and the import in deliver.tsx.
   - The new `it` sits just before "a damaged return goes to the damaged bin" and uses stopA2/billA2 while that stop is still open.
3. ADJACENT DEFECTS NOTICED, NOT FIXED (each worth its own finding, per the plan's risk section)
   - (a) In a mixed return (one damaged line and one refused line) the credit-note header reason stays return_saleable (deliveries.service.ts reason derivation). claims/build.service.ts:481 filters on the header reason, so the damaged line misses the damage claim, although its stock correctly goes to the bin.
   - (b) billing.creditNotes.create accepts reason return_damaged with lines whose saleable defaults to true (contracts/billing.ts ~:601), which restocks damaged goods as saleable from the manager desk.
   - (c) When every line comes back (outcome failed), nothing moves and no note is raised, so the caption "Into the damaged / expiry bin" is not literally true there.
   - (d) Whether a brand settles expired goods differently from damaged ones is a product question: today both post sale_return_damaged and claim as return_damaged.
4. EXISTING DATA
   - dos_qa CN/9003 (+24 pcs sale_return_saleable on Vehicle MH-05-AB-1234) is left as evidence. Correcting it would be a desk stock move, not part of this fix.

**Platform check:** After merging, do not reproduce the pre-fix behaviour on dos_qa: Stop 8 is the only open bill on TRIP-ACTIVE.

1. REBUILD AND RESTART
   - Rebuild: `pnpm --filter @dos/contracts build && pnpm --filter @dos/core build`.
   - Restart every service that mounts DeliveryModule: owner :3001, manager :3002, warehouse :3004, delivery :3005, retailer :3006 (QA/tools/start-services.sh).
   - Restart the delivery app's Metro on :5177.

2. API (delivery role ganesh.more / Dos@1234, does not use up the stop)
   - POST :3005/delivery/deliveries on INV/0830 / Stop 8 (dda35990… trip) with: the planned delivery id, and one line with delivered = billed − case, returned = case, returnedSaleable:true, reason:'damaged'.
   - Expect 400 with data.code 'return_not_saleable' and data.invoiceLineId set. Repeat with 'expired'.
   - Then confirm INV/0830 has 0 credit_notes and Stop 8 is still arrived.

3. ANDROID (Pixel_7_API_36, -memory 3072, visual only, do NOT press Record)
   - Trips → Stop 8 → Deliver this bill, then press "−" once on a line.
   - Expect ONE chip row (Shop refused it | Damaged | Past its date) with the caption "Can be sold again" under it, and no second disposition row.
   - Tap Past its date: the caption reads "Into the damaged / expiry bin".
   - Tap Shop refused it: the caption returns to "Can be sold again".
   - Check the layout of the three chips plus caption at phone width.

4. iOS (Expo Go exp://127.0.0.1:5177, visual only)
   - Same screen and same assertions. Screenshot with `xcrun simctl io booted screenshot`.

5. WEB 1280×800 (uses up Stop 8)
   - Stop 8 → Deliver this bill (INV/0830), press "−" once, tap Damaged, check the caption.
   - Attach a photo, fill "Bill signed by", press Record.
   - The request body must carry returnedSaleable:false and reason:'damaged' for that line, and the response must be 200.

6. DB AFTER THE WEB RUN
   - The INV/0830 credit note has reason return_damaged and line saleable = f.
   - Its stock_ledger row is sale_return_damaged into 'Damaged / expiry bin', with no sale_return_saleable row on 'Vehicle MH-05-AB-1234'. Read balances as deltas (DOS-039).
   - Zero delivery_lines created in the last hour with returned_qty_pcs > 0, reason in (damaged, expired) and returned_saleable true.

**Verifier minor notes:**
- `backend/libs/core/src/modules/delivery/deliveries.service.ts` — Out of scope by the plan and already listed in the implementer's followUps: in a mixed return (one damaged line, one refused line) the credit-note header reason is still return_saleable (lines ~185-190), so claims/build.service.ts:481 skips the damaged line for the damage claim. Its stock does go to the bin. Needs its own finding.
- `backend/libs/contracts/src/billing.ts` — Out of scope by the plan: the desk path billing.creditNotes.create still accepts reason return_damaged with lines whose saleable defaults to true, so the same contradiction is possible from the manager desk. Needs its own finding.
- `frontend/delivery-app/app/stop/[id]/deliver.tsx` — Pre-existing, unchanged by the fix: after pressing '-' with no reason tapped, the chip row highlights 'Shop refused it' (value = entry.reason ?? 'refused') but the payload omits reason. This is harmless and consistent: returnedSaleable is true and the caption says 'Can be sold again'. I did not run the web/Android/iOS visual or recorded checks, which the lane rules leave to the main session, so the phone-width layout of three chips plus caption is unverified.

## DOS-060 (L2-delivery) — commits: 2f3d295

**Deviations:** None in substance; the plan's changes are implemented as written. Small differences:
1. The ceiling figure in the test name is corrected. The plan's name says "₹99,99,99,999.99", which has 9 rupee digits. Its own rule (10 integer digits plus 2 decimals, the same as today's 12-digit paise cap) gives ₹9,99,99,99,999.99 = 999999999999 paise. The name and assertions use the correct figure, and the rule is implemented exactly as planned.
2. In the new render test, the preview assertion is a regex, /aria-label="4756 rupees"[^>]*>₹4,756<\/div>/. React emits `style` after `aria-label`, so a plain substring cannot match. This is my own new test, adjusted before the fix landed; no existing test was touched.
3. In both renderers, the `useState` initializer and the derived `current` are gated on mode === 'money'. Count pads therefore never run the money helpers; they only carry an unused `useState('')`, with no behaviour change.
4. The key Pressable (native) and button (web) are extracted into a local `padKey()` used by both the money and count branches. Styles, labels and accessibility labels are identical to before.
5. In web, the existing "The kit's own <Button>" comment moved, text unchanged, from the JSX to above the shared `done` const.
6. The parity test also asserts that neither renderer still previews money with `formatMoney(value ?? 0)`.
7. Prettier re-aligned the kit README's file table after the longer money.ts row.
Nothing touched backend, contracts, permissions, schema, the offline queue, any app screen, or the web RupeeInput.

**Follow-ups:** Docs and records for the main session:
- The hand-written kit README (frontend/libs/ui/README.md) is already updated in this commit. No generated service README is affected.
- UX-00 §6.3 already describes rupee-first entry, so no design doc change is needed.
- Add a build-log / QA change-log row for DOS-060: the kit NumberPad money mode enters rupees, paise only after '.', and Clear sits beside Done.
- Record the stop-8 verification receipt as a walk side effect in QA/STATE.md, as the plan says.

Merge order:
- DOS-041 conditionally overlaps this change: land DOS-060 first. If its plan caps the pick pad inside the kit, rebase it onto the now split money/count branches in both money.tsx files, types.ts, the README and render.test.tsx.
- DOS-069 (status-bar inset on the same Modal/NumberPad) was deliberately not touched.

New findings to log (pre-existing, not fixed here):
1. retailer app/pay.tsx `value={amount ?? owed}` and delivery app/trip/start.tsx `cashPaise ?? openingCashPaise` make Clear snap back to the fallback. A phone user can only type amounts that start from that value, or must pick bills. The pad now shows this honestly but cannot cure it.
2. sales-app/app/orders/new.tsx:663 parses the bargain rate with float math (`Math.round(Number(...) * 100)`).

Not run here (forbidden in this lane): Android, iOS and web walks, and backend tests (no backend code changed).

Optional: the kit gallery still shows only a count pad; a money-mode cell would make the new layout visible in the gallery.

**Platform check:** Money mode, delivery on Android (ganesh.more, dos_qa)
1. Sign in with QA/tools/android-login.sh delivery 5177 ganesh.more Delivery.
2. Go Trips → TRIP-ACTIVE, through the list (DOS-061). Open stop 8 Laxmi Narayan Stores (arrived, planned ₹22,508) → Take money → UPI → Amount taken.
   - The pad shows keys 1-9, '.', 0, ⌫ in the grid, with [Clear | Done] side by side at the same height as the old full-width Done.
3. Tap 2 2 5 0 8: the preview reads ₹22,508 (was ₹225.08).
4. Tap . 5 0: ₹22,508.50. A further 5 is ignored.
5. Tap ⌫ three times: ₹22,508.
6. Tap Clear: ₹0.
7. Tap Done: the field shows the em dash, and Record is disabled with the reason "Amount taken".
8. Reopen the pad, type 22508, tap Done: the field reads ₹22,508.00.
9. Enter UPI ref 425512345678 and tap Record the payment. The receipts row for TRIP-ACTIVE stop 8 must have amount_paise = 2250800.
10. TalkBack or the accessibility tree reads the preview in words ("22508 rupees").

Money mode, iOS (Appium, ios-login.mjs 5177 ganesh.more delivery)
- Same path; tap keys by accessibility label. 2-2-5-0-8 previews ₹22,508.
- Do NOT record a receipt.

Web parity (http://localhost:5177, no mutation)
- The same collect screen's text field takes 22508, and Record enables. The web RupeeInput is unchanged.

Regression, count pads must look and behave exactly as before
- Warehouse app on Android (dinesh.patil), van check-in or cycle-count pad: 2 0 1 reads 201, there is no '.' key, Clear is still in the grid, and Done is full width.
- Manager app gate count on web at 375 px: the same.

Regression, a parent that overrides the value (retailer app on Android, ramesh.gupta, Pay)
- The pad opens on the owed amount (e.g. ₹35,843.12), and ⌫ removes paise digits first.
- Clear snaps back to the owed amount. The preview must never read ₹0 while the field still holds the owed amount.

**Verifier minor notes:**
- `frontend/libs/ui/src/parity.test.ts` — Nothing automated presses keys on the native NumberPad, which is where the defect was seen. The parity test only checks that native/money.tsx's NumberPad body contains the helper names and no longer contains `formatMoney(value ?? 0)`. The kit has no jsdom or react-test-renderer, and the plan chose this approach knowingly. I traced the native branch by hand: it matches the web branch line for line; the native Button's `width:'100%'`, `flexShrink:1` splits the Clear/Done row in half; and native Txt passes accessibilityLabel through (base.tsx). The platform walk the main session runs on Android and iOS is still the only real-device proof.
- `frontend/libs/ui/src/money.test.ts` — One test name differs from the plan: it reads '₹9,99,99,99,999.99' where the plan says '₹99,99,99,999.99'. The plan's figure contradicts its own rule (10 rupee digits plus 2 paise digits, the same as the old 12-digit paise cap), so the implementer's figure is the correct one. The implementer reported this change openly. The name changed; the rule itself is implemented exactly as planned.
- `frontend/retailer-app/app/pay.tsx` — This problem existed before the fix and is not a regression (the plan and implementer already list it as a follow-up). pay.tsx passes `value={amount ?? owed}` and trip/start.tsx passes `cashPaise ?? openingCashPaise`. On those screens, Clear, or backspacing to empty, snaps the pad back to the fallback amount (e.g. '35843.12'), so a fresh amount can only be reached by backspacing to a leading digit. The old pad had the same limit. Since render-time reconcilePadEntry, the preview now always matches the value that will be recorded. Log it as a new finding.

## DOS-057+DOS-099 (L2-delivery) — commits: cbff41c

**Deviations:** 1. FILE NAMES ARE FLATTENED ("/" and "\" become "-"). The code shows the plan alone would not make Android Open work.
   - The screens pass `${invoiceNo}.pdf`, for example "INV/0826.pdf".
   - expo-file-system `Paths.join` does not encode "/". Its encodePathChars escapes only % \ \n \r \t and space.
   - So `new File(Paths.cache, 'INV/0826.pdf')` points into a directory that does not exist.
   - Android `downloadFileWithStore` then writes with `FileOutputStream(destination)`, which fails when the parent directory is missing. iOS moves the temp file into that same missing directory.
   - After absoluteUrl fixed "URI is not absolute", Open on R4 and D9 would have hit this as the next error.
   - Changes:
     - documents.native.ts: localName now flattens the name. This covers open, print and share.
     - documents.web.ts: share names the shared File the same way.
   - The plan's own verify step already expects "INV-0753.pdf" and "INV-0826.pdf".
   - documents.native.test.ts pins this, with the three Expo modules replaced by recorders via vi.mock. It is not proven on a device.

2. EXTRA TESTS beyond the plan's six:
   - a fourth web test for plan item (4): NotAllowedError, or a 403 response, falls back to the tab
   - the native test file (3 tests)
   - a guard sanity test that fails if the regex matches nothing

3. DELIVERY SPEC: the test adds no collection of its own.
   - A new POST /delivery/collections would break assertions already in the file: `items toHaveLength(2)`, `collections toHaveLength(4)`, and the cashCollected settlement arithmetic.
   - Instead the DOS-057 test runs right after the existing doorstep test. It checks that both receipts recorded there through POST /delivery/collections (cash and UPI) have exactly one render request each.
   - It also checks the cash request's payload, including requestedBy = the driver.

4. RECEIVABLES SPEC
   - It uses shop g (no bills) and sits after the seller-block test, so shop a's amounts are untouched.
   - It adds a same-transaction check: outbox created_at = receipt created_at, both `now()`.
   - It replays twice after marking the row published: once with the same idempotency key, and once with the same id under a new key. The second reaches recordReceipt's own replay return.

5. D9 DETAILS
   - PaperActions takes a testID prefix:
     - The invoice keeps d9-open, d9-print, d9-share and d9-pdf-pending.
     - The sheet uses d9-paper-* and d9-paper-sheet.
   - A failed share call maps to "Nothing was sent".
   - The paper sheet closes once a send finishes. On a phone the Sheet is an RN Modal, and the Toast would otherwise be hidden under it.

Everything else follows the plan. No contract, permission or schema change.

**Follow-ups:** DOCS FOR THE MAIN SESSION
- docs/22: record the founder question from the plan's reviewNotes. Should links sent to shops be long-lived single-document share links, for desk and text shares? That needs a public endpoint, a table and a security decision. Phones now share the file, so they are covered.
- docs/23: mark the receivables gap "receipt document rendered at issue" as done. D9 now opens receipt and credit-note papers.
- docs/26: web file sharing on S3 needs bucket CORS that allows the app origins. Without it, share falls back to opening a tab.
- docs/18: build-log row.
- No README regeneration is needed: no contract change.

ADJACENT, NOT FIXED
- retailer-app/app/bills/[id].tsx draws the POD photo `Img source={proof.readUrl}` from a relative URL. Same class of bug; file it as a new finding.
- DOS-065: D9's receipt list is not narrowed to the trip.
- Credit notes have no on-demand render procedure. Seeded credit notes (131 of 132 in dos_qa) show "still making this PDF" on D9 forever. Use CN/9003 to verify.
- The 1177 seeded receipts get a PDF only on first request.
- renderPending head-of-line blocking. This is worse now, because receipts are the most frequent document.
- receivables.spec.ts thermal80 `pdfObjectKey` null assertion can go flaky if a dev worker points at the spec database.
- absoluteUrl ignores API_PREFIX. This predates the fix.

ENVIRONMENT NOTE
Turbo in this worktree reported "using shared worktree cache" and replayed cache hits for @dos/domain and @dos/contracts, so the cache was not cold. Hashes are content-based, so the outputs should be correct.

NOT RUN
Nothing was exercised on a device or in a browser. The native file-name fix is inferred from reading the expo-file-system source, and the web share flow is unit-tested only.

**Platform check:** PREREQUISITE: rebuild and restart the services and worker from the merged branch. The receipt render now lives in @dos/core, which services and the worker consume from dist.

1. RETAILER, WEB (http://localhost:5178, ramesh.gupta / Dos@1234)
   - Open My bills, then INV/0753. Wait for the PDF if it says still making it.
   - "Open the bill": expect a new tab at http://127.0.0.1:3006/storage/tenant/…/invoice/<id>.pdf?expires…, content-type application/pdf.
   - "Print": expect the PDF to open in a tab. A popup-blocker prompt counts as a kit residual.
   - Dues → Receipts → RCPT-0687 → Open: expect the receipt PDF from :3006.

2. RETAILER, ANDROID (Pixel_7_API_36, adb reverse on 3000/3005/3006)
   - Same bill → "Open the bill": expect the share/preview sheet with INV-0753.pdf.
   - Expect no "URI is not absolute" and no downloadFileAsync error in logcat.

3. DELIVERY, WEB (http://localhost:5177, ganesh.more)
   Open /share/89e7513d-3068-762d-8e9a-6060dca8d19f.
   - Open: expect a PDF tab on :3005.
   - Print: expect a PDF tab.
   - Send on WhatsApp in desk Chrome:
     - The PDF tab opens at once.
     - The toast says "Nothing was sent".
     - The network panel shows no /storage fetch before the tab.
   - Tap CN/9003:
     - The d9-paper-sheet opens.
     - The network panel shows GET /credit-notes/<id>, then GET /files/read-url?objectKey=…credit_note….
     - Open shows the credit-note PDF.
   - Tap RCPT-0626:
     - The sheet says "The office is still making this PDF".
     - The worker logs "document rendered" with kind receipt within about 60 s.
     - Reopen: Open, Print and Send then work.

4. DELIVERY, ANDROID
   - D9 Open: expect the PDF share sheet.
   - Send on WhatsApp: the chooser shows a PDF attachment named INV-0826.pdf, with no /storage text.
   - When you come back, the paper sheet (if one was open) is closed and the toast says "Handed to the phone".

5. BACKEND
   - Record a new D5 doorstep cash collection.
   - Run the plan's psql query on dos_qa. Expect:
     - one DocumentRenderRequested row for receipt:<id>:a5:original
     - queued_at equal to the receipt's created_at
     - published_at within about a minute
     - pdf_object_key = tenant/…/documents/receipt/<id>.pdf
   - That receipt's D9 row is ready on the first tap.

6. iOS (Expo Go)
   - D9 Open and Send show the share sheet with the PDF.
   - Record it as unproven if no headless tap driver is available.

**Verifier minor notes:**
- `frontend/libs/ui/src/platform/documents.native.ts` — Deviation from the plan, but justified. localName() now replaces '/' and '\' with '-' for every caller of open, print and share, not only share. Retailer R4/R13 and D9 pass names like 'INV/0826.pdf', which would otherwise point into a cache sub-directory that does not exist. The plan's own verify step already expects 'INV-0753.pdf'. Apps that pass no filename still take the URL tail, so they are unaffected. The fix is proven only against vi.mock recorders of expo-file-system and expo-sharing, never on a device, so the main session must confirm it on Android and iOS.
- `backend/libs/core/src/modules/delivery/delivery.spec.ts` — The new DOS-057 test adds no collection of its own. It reads the two receipts that the previous test ('...doorstep...') recorded on the shared tripId, so it fails if run alone with -t. The file already uses shared sequential state, and the implementer explained why a new collection would break the existing count assertions.
- `frontend/libs/ui/src/document-urls.test.ts` — The guard checks one file at a time, as the plan's risk 6 already notes. A file with one identifier assigned from absoluteUrl() and a second, raw identifier of the same name in another scope would pass. It is enough to catch today's five offenders.
- `frontend/libs/ui/src/platform/documents.web.ts` — When the browser can share files, share() awaits fetch() before navigator.share. A failure after that point (NotAllowedError after user activation expires, a CORS failure, a 403) calls openTab() after the await, and a popup blocker may refuse it. The answer is still honestly false. This is the plan's accepted risk 1, and it is unit-tested only, not run in a real browser.

## DOS-061 (L2-delivery) — commits: 3d64b94

**Deviations:** None in the code. The fix follows the reviewed plan, including its review notes: the state rank is copied unchanged (active, loading, planned, closing), a cancelled sheet gets no carton line, the D2 string is "This trip has already left — open its stops", and D2 hides the form for active and closing trips with a button rather than a redirect.

Small additions, all inside the plan's six tests or its own rules:
- Test 1 also checks the plan's "trip dated today first" and "id ascending" rules. It tries every order of three active trips (11, 12 and 14 Sep) and two same-date trips in both orders. Without this the today-first rule would be untested, because ascending date alone passes the two dos_qa rows.
- Test 2 also covers the plan's "after 12 Sep it still picks TRIP-ACTIVE" (today = 2026-09-13).
- Tests 5 and 6 check that the new string keys exist in `strings` and that the draft wording does not say "on board". A missing key would otherwise print as the raw key on screen.
- tripEntryHref's return type is the two template-literal routes instead of plain string.
- Short DOS-061 comments were added at the changed spots in index.tsx and start.tsx.

**Follow-ups:** Docs and process:
- docs/18 build log: record DOS-061 fixed in lane b1-l2-delivery.
- QA findings/STATE: mark DOS-061 fixed pending the platform walk.
- The delivery app now has its own `test` script and a vitest devDependency. The app template has neither, a deliberate one-app divergence the plan accepts.
- CI's frontend job still runs no `pnpm test`, so this spec (like the kit, client and offline specs) is not enforced in CI. That gap existed before this fix and needs a separate task.

Merge notes:
- frontend/pnpm-lock.yaml gained three lines (vitest under the delivery-app importer). If another lane also adds vitest to delivery-app, regenerate the lockfile after merging with `pnpm install`; do not hand-merge it.
- DOS-056 may touch the same files (src/lib/local.ts header, src/strings.ts); expect plain text conflicts only.
- No contract, permission, schema or README change, so nothing to regenerate.

Open questions left from the plan's review, not changed here:
- `closing` still ranks last. After check-in, a planned next-day trip takes the home and the hand-over line moves behind "Your other trips".
- The earliest-date tie-break prefers a stale planned trip from yesterday over tomorrow's.
- Routing TRIP-NEXT (active, 0 of 5 stops, draft sheet) to the end-of-day screen exposes "Check in the vehicle". That is already reachable from Trip history; DOS-043's server fix stops new cases.
- The "Planned for {date}" subtitle stays on on-the-road rows under "Your other trips".
- Trip history (D11) is still online-only (DOS-068, not approved).
- Only the pure rules are unit-tested; the wiring in index.tsx and start.tsx is proven by the walk.

**Platform check:** Role: Delivery, ganesh.more / Dos@1234. App: delivery-app, web :5177 at 1280×800 and 390×844, Android Pixel_7_API_36 dev build, iOS Expo Go. Follow the plan's verify section.

Read-only on dos_qa (IST 12 Sep):
1. Home (D1) context reads "TRIP-ACTIVE · 12 Sep 2026".
   - Stops chip "9 of 10 stops done"; the next stop is the arrived one.
   - Load panel heading "Load on board", DC-0081 "64 cartons on board", Confirmed chip.
2. "Your other trips" lists TRIP-NEXT. Tapping it opens /day?tripId=72649337-4c50-7033-a988-ca5cf4406f9c with its 5 stops.
3. /trip/start?tripId=dda35990-f442-7931-8da4-5808f09a33b6 by URL:
   - Bottom bar "This trip has already left — open its stops" (testID d2-open-trip).
   - No "Before you leave" odometer/float form; the consent panel still shows the granted chip.
   - Tapping replaces to /day?tripId=dda35990…; the godown sentence never shows.
4. /trip/start with no param: same button, same destination.
5. /expenses context names TRIP-ACTIVE.

Mutating checks, only on a copy of dos_batch1_template:
- A ₹500 diesel expense lands on TRIP-ACTIVE.
- GPS points go to TRIP-ACTIVE only.
- Withdraw consent on Me, then Agree: D2 shows the consent panel plus d2-open-trip and no form.
- Check in TRIP-ACTIVE (active → closing). The home moves to TRIP-NEXT: heading "Load sheet", row "38 cartons planned — not loaded yet" with a Draft chip. TRIP-ACTIVE under "Your other trips" opens /day?tripId=….

Android: with adb reverse removed and the app relaunched, the home still shows TRIP-ACTIVE from SQLite and TRIP-NEXT opens its day screen offline.

iOS: the home names TRIP-ACTIVE · 12 Sep 2026 (xcrun simctl io booted screenshot).

**Verifier minor notes:**
- `frontend/delivery-app/app/trip/start.tsx` — The new d2-open-trip button (shown when state is active or closing and tripId is not null) is enabled even while `provisional` is true, i.e. no tripId in the route and the device not yet hydrated. The old depart button was disabled in that case. During the first pull, /trip/start with no param (Me -> Agree) could therefore send the driver to D8 for a guessed trip. It only navigates, and D8's check-in stays gated on active and online, so nothing wrong can be written. The plan did not ask for gating.
- `frontend/delivery-app/src/lib/trip-choice.test.ts` — Only the pure helpers are unit-tested. The wiring is not covered by any test: index.tsx panel title, carton line and other-trip onPress; start.tsx hiding the form and swapping the button. The plan accepts that the platform walk proves it. The frontend CI job still runs no `pnpm test`, so this spec is not enforced in CI (pre-existing gap, already in followUps).
- `frontend/delivery-app/src/lib/trip-choice.ts` — The prescribed mechanical reverse deletes trip-choice.ts, a new non-test file, so on its own it only proves a module-not-found failure. Proving red for the finding's reason took a temporary stand-in for the pre-fix behaviour (see evidence). This is a note on the red-proof method, not a defect in the fix.

## DOS-094 (L3-money) — commits: 54a3ec0

**Deviations:** The product code follows the plan. The deviations are in the test mechanics:
1. **Spec 2 gets the part-paid bill differently.** It reads the bill from the shop's own `GET /receivables/outstanding/{retailerId}` (includeBills), the same list the Pay screen uses, instead of reusing spec 1's `bills` through a shared variable. Each test therefore runs on its own. It still asserts the plan's precondition explicitly (inv.a2 present, 0 < openPaise < totalPaise), then sends `invoiceIds: [inv.a2], amountPaise: openPaise` with key `pay-094-one-${run}`.
2. **Spec 1 has a few extra assertions.** It checks `bills.length > 1`, so "pay everything" really spans several bills, and that paymentRef matches `/^PAY-[0-9a-f]{12}$/`.
3. **The domain red run had two steps**: first the missing module, then a plain move without `note` failing on the tn key order, so the red is an assertion failure and not only a missing import.
4. **billing.internals.ts** keeps its section divider. The old doc and function are replaced by a one-line comment and `export { upiIntent } from '@dos/domain'`.
5. **pay.tsx** gains a short comment on the `noUpiApp` state explaining that it can never show on web.

**Follow-ups:** **Docs for the main session:**
- Record DOS-094 as fixed in the QA change log and state.
- Optionally add "UPI intent builder (upiIntent)" to the `backend/libs/domain` line in CLAUDE.md's layout block.
- Optionally note the new `r5-no-upi-app` hint in docs/23 §6.1 R5.
- No contract change, so `pnpm docs:readme` should produce no diff.

**Not run by this lane:**
- `pnpm smoke --service retailer`: it needs running services and writes intents.
- Every running-app check in platformCheck.

**Open question for the founder:** does the office's bank statement or UPI app show `tr` for a person-to-person VPA? If yes, drop `note`/`tn` (the initiatePayment call and the tn assertions) and nothing else changes.

**Risks to watch after merge:**
- **DOS-099.** `sellerBranding` signs the logo URL on every initiate. If DOS-099 makes `signedObjectUrl`/`getUrl` throw anything other than ObjectStorageError, initiate returns 500 for tenants with a logo (Tarsun has one). The spec tenant has no logo, so only a dos_qa check will catch this.
- **Merge conflicts.** DOS-095 touches the same receivables service and spec, and likely retailer-app/src/strings.ts.
- **Old replies.** Intents created before the fix replay their old reply for the same idempotency key; intents last 30 minutes.

**Adjacent defects noticed, deliberately not fixed (candidates for separate findings):**
- `receivables.outstanding.get` still returns `upiQrPayload` copied from the newest open bill's snapshot (receivables.service.ts `getOutstanding`). No screen reads it.
- delivery-app/app/stop/[id]/collect.tsx shares the first invoice's stored snapshot, with its original total and invoice number, as the UPI link. `upiIntent` in @dos/domain now allows a correct offline rebuild there.
- R3 "Pay this bill" (retailer-app/app/dues.tsx) pushes /pay without the bill id, and pay.tsx reads no params.
- notifications.internals.ts `upiPayLink` and seed-demo/notifications.ts:423 are further copies of the builder.
- The server does not cap amountPaise at the dues.
- The web desk still shows the raw string, with no QR image.

**Platform check:** Setup: after merging, build domain, contracts and core, then restart retailer-service on :3006. Use fresh idempotency keys, because a reused key replays the stored old reply.

**API.** Sign in as ramesh.gupta / Dos@1234 via :3000 and pick the Tarsun tenant 01a0947d-7a79-75d2-bfff-97e499a58d49 (retailer 34191c43…).
- `POST :3006/receivables/payments/initiate` with no amount should return:
  - exactly one `upi://pay?`, with upiIntentUrl === upiQrPayload
  - payeeVpa "tarsun@okhdfcbank" and payeeName "Tarsun Enterprise"
  - `am=` equal to the current outstanding (₹35,843.00 on the evidence state)
  - `&tr=PAY-<12>&tn=PAY-<12>&cu=INR`, with no `tr=INV`
- With `invoiceIds: ['ca0bcd44-cd0d-72e8-a6b2-11dd2feaf77e'], amountPaise: 456100` (INV/0433) it should return `am=4561.00` and `tr=PAY-…`.

**DB.**
- The outbox PaymentIntentCreated row filtered by the returned paymentRef has amountPaise equal to the URL's am × 100.
- The receipts count for received_by d1dafe6b-235f-73f2-bc56-0bb04b8278ac is unchanged.
- The upi_qr_payload of INV/0433 and INV/0753 is unchanged.
- Initiate does not 500 for this tenant, which has a branding logo (see the DOS-099 risk).

**Web** (retailer app :5178 at 1280×800): Money due → Pay everything → Start the payment.
- The raw string matches the API shape.
- The panel reads "Paying Tarsun Enterprise".
- The "Quote this reference" PAY id equals the one in tr/tn.
- Ticking only INV/0433 shows ₹4,561.00 and am=4561.00.
- Tapping "Open a UPI app" shows NO hint on web. links.web cannot detect a missing app, so this is expected and not a failure.

**Android** (Pixel_7_API_36 booted with -memory 3072, retailer dev build):
- The same flow shows the same string, apart from the PAY id.
- Tapping "Open a UPI app" makes testID `r5-no-upi-app` appear under the button, reading "No UPI app opened on this phone. Pay tarsun@okhdfcbank from any UPI app and quote the reference below." Before the fix nothing appeared.
- `adb logcat -d | grep ActivityTaskManager` shows one VIEW intent for the upi scheme.
- A real GPay/PhonePe opening pre-filled with ₹35,843.00 is NOT TESTABLE on this Mac.

**iOS** (booted simulator, Expo Go, Appium path in QA/ENV.md §5.4): the same steps should show the same hint. Mark it NOT TESTED if Appium or WebDriverAgent is unavailable.

**Verifier minor notes:**
- `frontend/retailer-app/app/pay.tsx` — I did not run the native half of the fix (the r5-no-upi-app hint). The hint relies on React Native's Linking.openURL rejecting when no app handles upi://, so links.native.ts returns false; RN source says it does. Starting the emulator or simulator was not allowed in this lane. On web the hint can never fire, because links.web.ts always returns true; the plan expects this. The main session's Android/iOS walk must confirm the hint.
- `backend/libs/contracts/src/receivables.ts` — The comment on InitiatePaymentOutput.upiQrPayload (line 506) still reads '(pa, pn, am, tr)'. The intent now also carries tn and cu, so the comment is slightly stale. It is a comment-only follow-up and changes no wire shape.
- `backend/libs/core/src/modules/receivables/receivables.service.ts` — The same class of defect remains in sibling paths, left out on purpose because the plan excludes them. getOutstanding (around line 1056) still returns the newest bill's issue-time upiQrPayload snapshot. delivery-app stop/[id]/collect.tsx shares the first invoice's snapshot. notifications.internals.ts upiPayLink and seed-demo/sales.ts are further copies of the builder (the seed does not percent-encode pa). The implementer lists these in followUps; they should become separate findings.
- `backend/libs/core/src/modules/receivables/receivables.spec.ts` — The new DOS-094 specs depend on earlier tests in the same describe. Spec 2 needs inv.a2 part-paid by the FIFO test, and spec 1's bills.length > 1 needs several bills still open. Both preconditions are asserted, so a reorder fails loudly rather than passing vacuously. This matches the plan.

## DOS-095 (L3-money) — commits: a5e39469d842ac7eb47264f2ddb84d4cce0362b9

**Deviations:** None in substance. Small choices the plan left open:

1. **RangeError is a rejection.** `readEveryPage` is an `async function`, as the plan's signature says, so the RangeError for a bad `maxPages` arrives as a rejected promise. `fetchPage` is never called. The test asserts `rejects.toThrow(RangeError)` and no call, and checks -1, 2.5 and NaN as well as 0.
2. **Synthetic fixture uses the finding's figures.** Rows 1-50 are 127,070 paise each, so row 50 is 6,353,500. The last four are the receipts RCPT-0668, 0672, 0693 and 0687, so the closing balance is 3,584,300.
3. **Where `r6-partial` sits.** The plan said only "inside the r6-closing panel". It sits directly under the closing-balance row and above the `r6.explain` line.
4. **Extra assertions in the backend guard.** Every page must carry the same `openingPaise` and `closingPaise` as the single read. The cursor loop has a safety bound: pages <= number of entries.
5. **Database.** Tests ran against this lane's private copy `dos_b1_l3`, as the lane instructions require, not a new `dos_b1_dos095` (the plan's verify step 6).
6. **Playwright check not written or run.** The plan's step 2b check needs the running app, and this lane may not start dev servers. It is handed to the main session in followUps. No unexecuted script was committed.

**Follow-ups:** **1. Playwright regression (main session).** Write and keep the DOS-095 script from plan verify step 2b under QA/tools.
- Red on the pre-merge app: 50 `r6-row-*` rows, last balance ₹63,535.00 against r6-closing ₹35,843.00.
- Green after merge, with `page.route` rewriting `limit` to 12: exactly 5 ledger GETs, calls 2-5 carry `cursor=`, 54 rows, last balance equals r6-closing, no `r6-partial`.
- Green after merge, with `limit` rewritten to 10: 5 GETs, 50 rows, closing shows the em dash, `r6-partial` visible.

**2. Overlaps with DOS-074 and DOS-097.** Those lanes should import `readEveryPage` from `@dos/api-client` with their own `maxPages`. If another lane also created `frontend/libs/api-client/src/pages.ts`, `pages.test.ts` or the `index.ts` export, reconcile to one helper at merge. `retailer-app/src/strings.ts` also gains keys in DOS-094/096/099; those merges are trivial.

**3. Docs (main session).**
- docs/23 §6.1 R6: the statement reads every page of the window (200 per request, at most 1,000 entries) and prints no closing figure with a "pick a shorter period" note on a capped read.
- The docs/18 build-log row.
- The QA/findings status for DOS-095.
- The api-client README test count ("42 of them") is stale at 72; left untouched as the plan says.
- No contract change, so `pnpm docs:readme` is not needed for this fix.

**4. Adjacent defect, not fixed (from reviewNotes).** The STAFF journal ledger path (`receivables.queries.ts` retailerLedger keyset `(d::text, ref_id) > cursor`) can skip one row of an invoice + `invoice_cancel` pair that shares `(entry_date, ref_id)` at a page boundary. dos_qa has 3 such pairs. File it as its own finding before any staff screen follows the ledger cursor.

**5. Open risks.**
- The statement still renders in a non-virtualised Stack (bounded to 1,000 entries). A heavy shop's 'This year' on the Pixel 7 is unmeasured.
- DOS-007: any server-side statement renderer must read the whole window, not the first `limit` rows.

**Platform check:** **Who, where.** Retailer app as ramesh.gupta / Dos@1234; pick Tarsun (tenant 01a0947d-7a79-75d2-bfff-97e499a58d49). Services :3000-3007 on dos_qa. Web :5178 at desk 1280x800 and phone 375 wide. Android Pixel_7_API_36 booted with -memory 3072. iOS Expo Go driven with xcrun simctl.

**Web, 'Last 90 days'** (2026-06-15..2026-09-12). Go to Money due, then Statement.
- Expect 54 `r6-row-*` entries, including RCPT-0668 (₹12,180, 10 Sep), RCPT-0672 (₹5,558, 11 Sep), RCPT-0693 (₹5,511) and RCPT-0687 (₹4,443, 12 Sep).
- The last row's balance is ₹35,843.00, equal to r6-closing. No `r6-partial` element.
- Network: exactly one GET /receivables/ledger/34191c43-f0bc-70ab-a39d-fcbe8f94ae36?from=2026-06-15&to=2026-09-12&limit=200 returning 54 items with nextCursor null.

**Other ranges.** 'This year' shows the same 54 rows. 'Last 30 days' ends on its own closing figure.

**Playwright** (plan step 2b):
- `limit` rewritten to 12: 5 GETs, 54 rows, closing equals the last balance.
- `limit` rewritten to 10: 5 GETs, 50 rows, em-dash closing, `r6-partial` shown.

**Service down.** Stop retailer-service and press retry: the no-connection ErrorState, no closing figure. Restart the service.

**Android and iOS.** Same sign-in and screen. Scroll to the end: 54 entries, and the last balance equals the closing balance.

**Verifier minor notes:**
- `frontend/retailer-app/app/statement.tsx` — The screen wiring has no automated test. No frontend app has a test runner, and the plan's Playwright check from verify step 2b was not written or run; it is handed to the main session. I checked the wiring by reading the code and with the in-process check against seeded data described in the evidence. A real-app check at web, Android and iOS is still owed after merge.
- `frontend/libs/api-client/src/pages.ts` — The plan says the helper throws RangeError before any call. The implementation is async, so the RangeError arrives as a rejected promise. `fetchPage` is still never called. The deviation is disclosed, the test asserts both behaviours, and a caller awaiting inside useQuery sees no difference.
- `backend/libs/core/src/modules/receivables/receivables.queries.ts` — Adjacent defect, not in scope and left unchanged. The staff journal path pages on the keyset (d::text, ref_id) > cursor, which can skip one entry of an invoice + invoice_cancel pair sharing (entry_date, ref_id) at a page boundary. The retailer statement uses the document path, where I observed no ties. It should be filed as its own finding before any staff screen follows the cursor, as the implementer's followUps say.
- `frontend/libs/api-client/README.md` — The README's test count ("42 of them") is stale; the package now has 72 tests. This is pre-existing, and the plan says to leave it.

## DOS-021 (L3-money) — commits: bc27847

**Deviations:** Three small deviations, all within the plan's intent.

1. Loading guard on the earlier-notes read. A new query key starts as 'idle' in the api-client cache (cache.ts EMPTY), so with the plan's plain `<Async state={[bill, prior]}>` there is one render after the bill arrives where `prior.isLoading` is false and there is no data. In that frame every line would show its full quantity as left to credit, and Draft could be pressed.
   - The screen now passes `{ isLoading: prior.isLoading || priorPending, error: prior.error, refetch: prior.refetch }`.
   - `priorPending` = bill picked, bill loaded, and prior has neither data nor error.
   - This cannot hang: a bill with no notes resolves `Promise.all([])` at once.

2. Translator passed through. The meta line calls `billLineQty(line, t)` instead of `billLineQty(line)`, so the app's string catalogue applies. The output is the same kit function.

3. Extra assertions inside the named tests.
   - The piecesLeftToCredit test also checks 10 billed with 12 credited returns -2. This pins the plan's "NOT clamped" rule, which keeps the server's refusal figure byte-identical.
   - The parsePieces tests also check that '0' parses as 0 pieces and whitespace-only input counts as empty.

Everything else is as the plan says:
- The server change is only the one-line swap at credit-notes.service.ts:315 plus its import. The message, its data and the creditedByLine SQL are unchanged.
- There is no contract, permission or schema change.
- QtyStepper, stepByCase and the kit strings are untouched.
- The screen keeps the reason chips, saleable, ratePaise, the per-line uuidv7 and the invalidations.
- create.reset() is called on bill pick and on sheet close.
- The refusal Txt now sits directly above the Draft button.

**Follow-ups:** Docs:
- docs/23 §2.1 M8: the drafting sheet now takes typed "Pieces to credit" per line with "{n} pc left to credit" (billed + free − non-cancelled notes). It reads creditNotes.get once for each live note on the bill.
- Build log: record DOS-021 fixed on qa/b1-l3-money (bc27847).
- No contract change, so the service READMEs are unaffected (`pnpm docs:readme` not needed for this lane).

Not run here:
- Frontend `pnpm build` (expo export for every app) and the backend CI chain beyond domain/core. The main session should run them after merging.
- Rebuild @dos/domain dist before frontend typecheck or bundling. The screen imports the new piecesLeftToCredit and creditedPiecesByLine from dist.

Dependency: DOS-029. If it lands a shared mutation-error surface, move this screen to it at the same position, directly above the Draft button.

Merge contacts:
- credit-notes.service.ts, the import block and :315 (DOS-058 may touch the same file).
- frontend/libs/ui/src/qty.ts and qty.test.ts (DOS-074+097, DOS-077).
- backend/libs/domain/src/index.ts export list.

Pre-existing defects this fix makes easier to reach (propose as new findings; not fixed):
(a) Discounted lines are credited at the gross rate. The screen sends line.ratePaise and the server caps only rate ≤ invoiced gross rate.
(b) Free goods are credited at the full rate: lineTaxable = rate × qtyPcs.
(c) Retry after a lost reply. The per-line uuidv7() is generated inside the mutation run, so a same-intent retry gets 409 "idempotencyKey was already used with a different request". That machine sentence now shows above Draft.
(d) The native Sheet has no KeyboardAvoidingView, so the last "Pieces to credit" field may sit under the Android/iOS keypad. Log a kit finding if verify step 8 shows it.

Open questions:
- A forgotten draft silently lowers "left to credit" (the server counts drafts). The helper could add "(N pc on a draft note)". Left out to stay inside the finding.
- The same case-only entry exists in delivery returns, rep order lines and the retailer basket (DOS-064/085/101); parsePieces can be reused there.

**Platform check:** Role: manager, vikas.kadam / Dos@1234 (accountant meena.joshi sees the same sheet). App: manager (web :5174, then Android Pixel_7_API_36 booted with -memory 3072). Screen: Billing → Credit notes → "Draft a credit note". Use the dos_qa data named in the plan.

1. Desk 1280×800. Search INV/0634 and pick it.
   - No "Not ordered" and no "cs available" anywhere.
   - Each line shows its billLineQty meta and a "Pieces to credit" field.
   - Sunbake Glucose 55 g: "40 pc", helper "40 pc left to credit".
   - Campa Lemon: 48 pc with the "2 pc free" clause, helper "50 pc left to credit".
   - Annapurna: helper "9 pc left to credit".
2. Type 120 on Sunbake.
   - Red error "Only 40 pc left to credit on this line".
   - Draft is disabled with "Fix the pieces marked in red first", and no POST is sent.
   - Type 1.5 instead: "Type whole pieces, like 5 or 40".
3. Type 5 on Sunbake and press Draft.
   - POST /credit-notes returns 200, the sheet closes and the register shows the draft.
   - DB check (tenant 01a0947d-…) returns exactly one row: draft | 5 | 748.
4. Reopen the sheet on INV/0634.
   - Sunbake reads "35 pc left to credit" (the draft counts).
   - 36 turns red.
5. INV/0546 Campa Cola 750 ml reads "294 pc left to credit". INV/0619 Godavari Dahi 200 g reads "30 pc left to credit".
6. The refusal sits above the button.
   - Pick cancelled INV/9002, type 1 and press Draft. Expect 409 "bill INV/9002 is cancelled; a credit note corrects an issued bill" directly ABOVE the Draft button, visible without scrolling.
   - Pick INV/0634: the sentence is gone.
   - Close and reopen the sheet: gone.
7. Phone 375×812 bottom sheet: repeat steps 1–3 and 6. Fields, helpers, red errors and the refusal line are all reachable.
8. Android, INV/0634.
   - The decimal keypad opens on "Pieces to credit".
   - With the keypad up, the last line (Annapurna) field and its error can be scrolled into view. If not, log a kit finding; do not patch Sheet.
   - Type 5 on Sunbake and press Draft: the draft is created.

Cleanup: cancel the test draft with a reason, and log the dos_qa side effect in QA/STATE.md.

**Verifier minor notes:**
- `frontend/manager-app/app/billing/credit-notes.tsx` — The cached 'left to credit' figure can be stale for one round trip. cache.invalidate() keeps the old data and only sets updatedAt to 0 (api-client cache.ts:208). So picking the same bill again right after drafting can show the figure from before that draft (e.g. '40 pc left' instead of '35') until the bill and its notes are fetched again. The server still refuses anything over the cap, and that refusal now shows above Draft, so no wrong note can be written.
- `frontend/libs/ui/src/qty.ts` — parsePieces removes every comma and space, not only thousands separators, so '1,5' and '1 5' parse as 15 instead of being refused. The plan asked for this so that '1,200' works. But a phone whose decimal-pad shows ',' as the decimal key could turn a mistyped '1,5' into 15 without any warning, as long as 15 is within what is left to credit.
- `frontend/manager-app/app/billing/credit-notes.tsx` — No automated test covers the screen defect itself: the case-only stepper, the 'Not ordered'/'cs available' copy, and the refusal shown below Draft. The manager app has no test runner, so this is left to the platform walk, as the plan says. The domain spec only fails before the fix because the module does not exist, not on an assertion. I made up for that with five mutation probes, which all failed as expected (see evidence).

## DOS-034 (L3-money) — commits: c0889f7, 3b73a8d

**Deviations:** None of these change behaviour beyond the plan. They are small choices the plan left open, plus lane rules:

1. Commits. The QA e2e script is in its own commit (test(QA), 3b73a8d), not in the product commit, because the charter asks for product-only fix commits. I did not edit QA/13-change-log.md: this lane may only touch QA/tools scripts. See followUps.

2. Opening a dialog resets its mutation. Before opening them, the new Receipts dialogs call `deposit.reset()` / `bounce.reset()`. Without that, a refusal from an earlier attempt (maybe on another receipt) would still show when the dialog reopens. After a refusal the dialog stays open with the server's message, as planned.

3. Details the plan did not name:
   - testIDs `receipt-deposit-refusal` and `receipt-bounce-refusal` (named like DOS-029's *-refusal), plus `receipt-deposit-ref`, `receipt-bounce-reason` and `receipt-bounce-charges`.
   - Button styles follow the owner app: "Bank it" primary, "Mark bounced" secondary; Reverse stays destructive.
   - Dialog titles: the deposit dialog uses m9.deposit for both title and confirm, as the Reverse dialog does; the bounce dialog uses m10.bounceTitle with confirm m9.bounce.
   - m10.depositBody is reused as the plan says.

4. Guard spec placement. The guard creates its own shop and bill ("Shop 10") inside the test and sits just before 'isolates tenants'. Adding it to beforeAll's `shop` map would have broken the ageing rebuild's `retailers: 9` and the per-shop rollup loop. It uses office receipts only, and no CASH_VAN posting appears anywhere as expected.

5. Extras in the e2e script:
   - It also checks that "Trips coming back" comes before the register (review note 2).
   - It picks receipts by id with psql, taking only RCPT numbers that are unique in the tenant, and switches the Receipts range to the narrowest window holding each one.
   - Exit codes: 0 green, 1 red, 2 precondition missing.
   - DATABASE_URL defaults to dos_qa (as start-services.sh does); override it with the batch copy.

6. I checked the plan's open layout question in code: Expo's web HTML reset sets `#root,body,html{height:100%} body{overflow:hidden}`. So the Screen's inner div is the only scroller, and the bottomBar renders outside it on desk.

**Follow-ups:** - QA/13-change-log.md: add the DOS-034 row in a separate QA-doc commit.
- docs/23 §2.1 (M9/M10), docs/18 build log and docs/22 if it describes the Day-end screen:
  - Day-end order is now KPIs → Cheques in hand + Trips coming back → settlement form → register (cash and cheques only).
  - "Bank this batch" is in the bottom bar.
  - Money → Receipts has Bank it / Mark bounced.
  - No contract or permission change, so docs:readme is not needed.
- Run `cd QA/tools && DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/<batch copy> node e2e/dos-034-day-end.mjs`: RED on a pre-fix build, then GREEN after merge. I have not run it.
- File the van-cash finding from the review notes:
  - Banking cash collected on a trip credits CASH_VAN (receivables.service.ts receiptAccountCode, used in depositReceipts).
  - After trips.settle, CASH_VAN is credited twice.
  - Trip cash is still listed on Day-end, and this fix makes "Bank this batch" easy to reach.
  - Approve it at the same gate.
- Owner app P2s: "Bank it" is enabled for UPI, bank transfer and adjustment (owner-app/app/money/receipts.tsx ~:228), and "Mark bounced" for a cancelled cheque (~:238). They could now use receiptMayBeDeposited / receiptMayBounce.
- Merge overlaps:
  - DOS-029 touches the same day-end.tsx and money/index.tsx. The Day-end deposit, bounce and settle dialogs still close silently on error; that is DOS-029's to fix. If DOS-029 adds a shared refusal surface, move the new Sheet dialogs' error lines onto it.
  - DOS-057 and DOS-099 edit the same receipt Sheet next to `receipt-print`, so expect conflicts there.
- Copy: in the single-receipt deposit dialog, m10.depositBody says "Every ticked receipt is marked banked…". It may deserve its own m9 sentence.
- Existing defect I copied (not fixed): both day-end.tsx and the new dialogs set depositedAt / bouncedAt to `new Date()` inside the mutation. If the first request committed but its reply was lost, pressing confirm again sends the same idempotency key with a different timestamp. That likely gets a 409 instead of a replay, even though the receipt was banked.

**Platform check:** Web, http://localhost:5174, services on the batch DB copy, desk 1280×800 then phone 390×844:

1. Money → Day-end as vikas.kadam (manager), then meena.joshi (accountant).
   - Screen order: KPIs, then Cheques in hand (hint "Tap a cheque the bank returned to mark it bounced") beside Trips coming back, then the register.
   - Picking a closing trip opens "Check the van back in" directly under the trips, above the register.
   - Register rows are only Cash and Cheque.
   - The register foot equals the Cash to bank KPI plus the Cheques in hand KPI; the count reads "more than 200 rows".
   - Register meta reads "Tick the cash and cheques you are banking", with no bottom bar yet.
   - Scroll deep and tick two office cash receipts (trip_id null, picked by id). A bottom bar "2 receipts · ₹X" with "Bank this batch" appears and stays in view while scrolling.
   - Bank with slip DEP-QA-034. Both rows leave and the Cash KPI drops by X.
   - SQL: journal_entries with ref_type 'deposit' shows BANK +X and CASH −X, nothing else.
   - Tap a collected cheque card. "Cheque returned" opens; confirm with a reason. The card leaves; the reversal entry has CHEQUES −amount and AR +amount.

2. Money → Receipts.
   - A deposited cheque: "Bank it" disabled with "Only cash or a cheque in hand goes to the bank"; "Mark bounced" enabled. Confirm: state becomes Bounced and the reversal credits BANK.
   - A UPI receipt: both buttons disabled, each with its reason.
   - Collected office cash: "Bank it" enabled; confirm with a slip and it becomes Banked.
   - Refusal: open the same cash receipt in two tabs, bank it in the first, confirm in the second. The dialog stays open showing "receipt … is deposited, not collected".
   - Blank bounce reason: the dialog stays open and shows the server's validation message.

3. Android, Pixel_7_API_36 booted with -memory 3072, manager app as vikas.kadam.
   - Day-end at phone width: cheques, trips, settlement form (on trip select), then register.
   - Ticking a row shows the bar above the tab bar; it stays while scrolling and banking works.
   - The Receipts sheet shows Bank it and Mark bounced.

iOS inherits the change from the same codebase.

Do NOT bank or bounce receipts with trip_id set (RCPT-VAN-0001..0004, RCPT-0698 id 01a0952f…), because of the open van-cash question. Pick receipts by id: RCPT-0697/0698/0699 each exist twice.

**Verifier minor notes:**
- `QA/tools/e2e/dos-034-day-end.mjs` — The committed tests do not show the defect. The domain test is red before the fix only because receipts.ts did not exist, and the core spec is a guard that is green before. The only committed reproducer is this Playwright script, and nobody has run it: the lane may not start dev servers. To cover that gap I ran an uncommitted static render of the real day-end.tsx and money/index.tsx, with the data hooks stubbed (evidence). It is red without the fix for the finding's own reasons and green with it. The main session still has to run this script after merging: red on a pre-fix build, green after.
- `frontend/manager-app/app/money/index.tsx` — The new Bank it and Mark bounced mutations set depositedAt and bouncedAt to new Date() inside the mutation, and opening a dialog calls reset(), which issues a new idempotency key. So if a reply is lost, retrying gets a 409 instead of a replay of the first write. The server's status checks still stop money being banked or bounced twice. day-end.tsx already had this pattern and the fix copied it; the implementer reported it too.
- `frontend/manager-app/app/money/day-end.tsx` — Existing defect, not new: ticked receipt ids are never removed when a ticked cheque is bounced from its card or the lists refetch. The new bottom bar's count ('N receipts') can then include receipts no longer listed, and 'Bank this batch' sends them. The server refuses the whole batch with a 409, and the dialog closes silently (DOS-029's to fix).
- `frontend/manager-app/app/money/index.tsx` — On native, the new Dialogs are React Native Modals opened from a button inside the Sheet, which is also a Modal. iOS may not show a second Modal on top of one that is already open. The existing Reverse dialog works the same way, so this is not new, but iOS was not walked.
- `backend/libs/core/src/modules/receivables/receivables.service.ts` — The plan's risk, not a defect in this diff. The Day-end register still lists trip cash, and 'Bank this batch' is now easy to reach. Banking trip cash credits CASH_VAN (receiptAccountCode), which after trips.settle credits it twice. The van-cash finding from the plan's notes must be filed and approved at the same gate.

## DOS-073 (L4-orders) — commits: 40a2294

**Deviations:** 1. The six generated service READMEs were NOT regenerated or committed. The lane instructions forbid `pnpm docs:readme`, so the plan's README change entry is left to the main session. Nothing else in the plan was skipped.
2. `lockReachableOrder` uses the plan's preferred order: `findOrder`, then `callerReaches`, then `lockOrder`. A missing id falls through to `lockOrder`'s own 404, so the message text stays identical. `lockOrder`, `findOrder` and every `*InTx` helper are unchanged, and `orders.sync.ts` imports `callerReaches` from `orders.internals.ts` (the plan's main option, not the optional `findReachableOrder`).
3. The tests have extra positive controls beyond the review notes:
   - Test 3 also shows that rep2's own device can still re-head its draft and add a line (accepted 2, note updated, two lines).
   - Test 1 checks rep2's own cancel moves the reservation to state `voided`, which is the enum's name for a released reservation.
   The nested `beforeAll` posts 5 opening pieces on a new lot, as the review notes required.
4. No product-code deviation: the code matched the plan's root cause line by line. The only application writer of `salesperson_id` is `createDraft` (orders.internals.ts:105), so the check-then-lock order is race-free.

**Follow-ups:** - Regenerate READMEs: run `cd backend && pnpm --filter @dos/contracts build && pnpm docs:readme && pnpm docs:readme:check`. The `orders.list` summary changed to 'Orders (a retailer or a salesperson sees only its own)' and appears twice in each of the owner, manager, sales, warehouse, delivery and retailer service READMEs.
- Smoke not run: `pnpm smoke --service sales --only GET` (expect 0 BROKEN) was not executed because no dev servers run in this lane. Run it against a scratch database, not dos_qa, to prove the new `scopeSalespersonId` narrowing of the orders.get/setLines/submit/cancel fixtures.
- Docs: record DOS-073 as fixed in the QA change log and build log. docs/22 may want one line noting that a salesperson reaches only orders credited to it through get/list/setLines/submit/cancel/sync.
- Separate finding recommended (same class, not in scope): warehouse and delivery logins can still call orders.cancel/setLines/submit/get/list on any order through :3004/:3005. ORDER_ROLES = STAFF, the matrix entry is ANY_MEMBER, and both services mount `orders`. Narrowing that is a product/matrix decision.
- Remaining leaks, documented in the plan and unchanged:
  - POST /orders or a sync header PUT with a colleague's order id answers 409 / `conflict` 'already exists', revealing that the id exists.
  - A sync op with an old baseUpdatedAt answers `stale`.
  - Replaying another actor's exact idempotency key and input returns the stored reply. This is platform-wide.
  - `repeatLast` copies a shop's last order by any rep, exposing its lines and quantities.
- Existing, unrelated: `tsc -p backend/tools/tsconfig.json` reports two errors (PermissionRole includes platform_admin, not assignable to the membership role union) at smoke-endpoints.mts ~2395/2516. They are present at HEAD and nothing in CI appears to typecheck tools.
- The documented command `pnpm --filter @dos/core test -- <file>` does not filter: it runs all 35 core spec files. `pnpm --filter @dos/core exec vitest run <file>` does filter.

**Platform check:** API (sales-service :3003 after rebuilding @dos/contracts + @dos/core and restarting it; manager-service :3002). Use a disposable database or accept writes in dos_qa. Tenant tarsun, password Dos@1234.
- Setup: as amit.pawar, create and submit a fresh confirmed order Y (sales app web :5175, or POST /orders then /orders/{Y}/submit). Amit's draft D = 39c6f032-fd27-7d15-b761-79cded32d0f8.
- As rahul.deshmukh:
  1. GET /orders/Y → 404 'order Y not found', the same shape as GET /orders/<random uuidv7>.
  2. GET /orders?salespersonId=<Amit>&limit=50 and GET /orders?limit=50 → 200. Every item.salespersonId is Rahul's; no Amit ids; no null salespersonId.
  3. POST /orders/Y/cancel → 404. POST /orders/Y/lines → 404, not 409. POST /orders/D/lines → 404. POST /orders/D/submit → 404.
  4. POST /sync/upload with a sales_orders PUT on D and a sales_order_lines PUT for D, no baseUpdatedAt → 200, accepted 0, rejection codes `conflict` and `order_not_found`.
- DB checks (column is occurred_at, not created_at):
  - Y is still confirmed with cancelled_at null.
  - No order_state_transitions row by rahul.deshmukh on Y.
  - Y's reservations are unchanged.
  - D still has 5 lines with the same ids, and its note and updated_at are unchanged.
  - No OrderCancelled outbox row for Y.
- Positive controls:
  - Amit: GET /orders/Y → 200. Cancel Y → 200 and the reservation is voided.
  - Rahul in the sales app (web :5175 and Pixel_7_API_36 booted with -memory 3072): Orders tab → one of his own confirmed orders → detail loads → Cancel with a reason → 200.
  - vikas.kadam: GET :3002/orders?salespersonId=<Amit> still lists Amit's orders, and the manager app :5174 Orders queue is unchanged.
- `pnpm smoke --service sales --only GET` → 0 BROKEN. Run the full or destructive smoke only on a scratch database.

**Verifier minor notes:**
- `backend/{owner,manager,sales,warehouse,delivery,retailer}-service/README.md` — The orders.list summary in backend/libs/contracts/src/orders.ts changed, but the generated READMEs were not regenerated because the lane rules forbid it. `pnpm docs:readme:check` in CI will fail until the main session runs `pnpm --filter @dos/contracts build && pnpm docs:readme` after merging.
- `backend/tools/smoke-endpoints.mts` — The smoke harness narrowing (scopeSalespersonId in orderInState and anyOrderId for orders.setLines/submit/cancel/get) was never run, because no dev servers run in this lane. Only its types were checked: `tsc -p tools/tsconfig.json` shows the same two PermissionRole errors (TS2322/TS2345) as the pre-fix file, only at shifted lines (2368/2488 before, 2395/2516 after), so nothing new. `pnpm smoke --service sales --only GET` still needs a run against a scratch database.
- `backend/libs/core/src/modules/orders/orders.service.ts` — These leaks are in the plan and accepted, not regressions. They should be tracked:
- Warehouse and delivery logins can still cancel, re-line, submit, get and list any order through :3004/:3005 (ORDER_ROLES = STAFF, ANY_MEMBER). This needs its own finding.
- Sending a colleague's order id to POST /orders or a sync header PUT still answers 409/`conflict` 'already exists', which reveals the id exists.
- A stale baseUpdatedAt answers `stale`.
- Replaying another actor's exact idempotency key and input returns the stored reply.
- repeatLast copies a shop's last order by any rep.

## DOS-075 (L4-orders) — commits: 4450d81

**Deviations:** None in the implementation. It matches the plan:
- the one-line measure('inr') change (the `/ 100` is gone);
- JSDoc on SchemeRule.triggerMin and triggerUnit and on SchemeSlab.min;
- JSDoc only in contracts on SchemeSlabSchema.min, schemeEconomics.triggerMin and UpsertSchemeInput.triggerMin, with no Zod or wire change;
- the two fixture INPUT conversions.

The tests carry a few extra assertions beyond the plan, and none weakens anything:
- grossPaise checks at and below each threshold;
- the domain order-level test asserts the whole per-line appliedRules array equals the share, not just appliedRules[0].amountPaise;
- the core spec asserts the saved scheme echoes triggerMin 50_000 (stored unconverted).

For regression I ran the full core suite (35 files) instead of the per-module list. That is a superset, and core's `test -- <path>` ignores the path anyway.

**Follow-ups:** 1. **Docs for the main session.**
   - Record in docs/18-build-log.md and the batch change log that priceOrder() now measures `inr` triggers in paise, the unit every writer already used.
   - If docs/22 describes scheme trigger units, make it say paise for inr. The build log line around :968 already does.
   - `pnpm docs:readme` output should be identical, because the contract change is JSDoc only. I did not run it, per the lane rules.

2. **Rebuild and restart before walking the apps.**
   - Build @dos/domain (and contracts).
   - Restart all eight services and the worker. warehouse-service gets the engine through OrdersModule/AiModule, and the worker builds a QuoteService.
   - Restart the sales-app Metro bundler with `expo start --clear`, because the device prices with the linked dist.

3. **Date caveat.** The live dos_qa scheme 6ac23a1a is valid only until 2026-09-21. Device, DB and retailer checks price on today, so after that date reseed or verify through the API with an explicit pricingDate.

4. **DOS-076 lands after this.** Its step-5 expectations must be computed on top of this fix. Per the plan's reviewNotes item 8, basket F gains an order_pct of 55766 and its whole-bill cash discount moves from 55766 to 54651.

5. **Open founder questions** (plan reviewNotes, not decided here):
   - Should a "bills over ₹X" threshold count the value of lines under a final exclusive scheme? Today it does not, so SO-0879 and basket C still earn no 2%.
   - The engine measures the threshold on in-scope gross, while the seed's own pricer uses net after line schemes.

6. **Adjacent defects noticed, not fixed:**
   - The server toSchemeRule (quote.service.ts:318-341) drops `priority`, while the sales-app device adapter passes it, so stacked line_pct rules can compound in a different order on device and server.
   - sales-app shops/catalog.tsx:129 prints the raw trigger_min (e.g. "2500000").
   - DOS-088 hides the order-value offer from the shop card; DOS-087 touches `multiples`.
   - backend/libs/database/src/schema/pricing.ts:167 still documents triggerUnit as `'pcs' | 'case' | 'inr'` without the unit. This was not in the plan and is left alone.

7. **CLAUDE.md is misleading on test filtering.** `pnpm --filter @dos/core test -- src/modules/orders` is documented as running one module's specs, but vitest receives the path after `--` and runs the whole core suite (35 files). `pnpm --filter @dos/core exec vitest run <path>` actually filters.

**Platform check:** Main session, on dos_qa after the rebuild and restarts in followUps 2. The before/after numbers below were computed by the plan from SQL and evidence headers; I observed none of them.

1. **API.**
   - Sign in as rahul.deshmukh / Dos@1234 on :3000, then POST http://localhost:3003/pricing/quote with retailerId 34191c43-f0bc-70ab-a39d-fcbe8f94ae36 (Shree Ganesh Kirana, Tarsun, tier C), pricingDate '2026-09-12', lines [{lineId 'l1', variantId 934dd63c-a112-7fb7-91a1-376a90bf5fcf (Annapurna Sunflower Refined Oil 1 L pouch), qtyPcs 240}].
   - Expect totals.grossPaise 2873760 and orderRules [{ruleId 6ac23a1a-ce35-76d2-a002-3a7888fc1c65, version 1, kind 'scheme', rewardKind 'order_pct', amountPaise 57475}].
   - The same share must appear in lines[0].appliedRules, with totals.discountPaise 57475 and netPaise 2816285.
   - Control: qtyPcs 204 (2442696 paise) must give orderRules [].

2. **Evidence baskets.** Re-run QA/evidence/phase1/sales/api-05-quote-order-level.txt with pricingDate '2026-09-12'.
   - Basket E gains order_pct 54357, and discountPaise goes from 16072 to 70429.
   - Basket C gets no order_pct: the ghee line is under final exclusive scheme 2891ee90 and the remaining gross is 2409548.
   - Basket F gains order_pct 55766, and its cash discount moves from 55766 to 54651 (the DOS-076 interaction).

3. **Sales app** on web :5175 and Android Pixel_7_API_36 (boot with -memory 3072), as rahul.deshmukh.
   - Shops → Shree Ganesh Kirana → new order → Annapurna Sunflower Refined Oil 1 L pouch × 20 cases.
   - The footer must show "Schemes on this order −₹574.75".
   - Submit the order. iOS runs the same bundle (Expo Go).

4. **DB, for the new order.**
   - `sales_order_lines.applied_rules` must contain {"ruleId":"6ac23a1a-ce35-76d2-a002-3a7888fc1c65","rewardKind":"order_pct","amountPaise":57475}.
   - `sales_orders` subtotal_paise must be 2873760 and discount_paise 57475. The server re-prices at submit.

5. **Retailer app** on :5178 as ramesh.gupta.
   - Select the Tarsun tenant (01a0947d).
   - The same basket's quote must show the 2% (57475) in its scheme total.

**Verifier minor notes:**
- `backend/libs/domain/src/pricing/schemes.test.ts` — The report's failBefore count does not match the committed test file. The report says 2 failed (86 passed of 88). With the commit's non-test changes reversed, schemes.test.ts has 3 failures: the two DOS-075 tests plus the corrected fixture 'spreads an order_pct discount across the lines to the paisa'. At triggerMin 3_000 that fixture needs the fix, because the old engine measures 30.03 against 3000. The implementer most likely ran the before-check before converting that fixture. This is a reporting inaccuracy, not a code defect. The correction is authorised by the plan, keeps every expected value, and makes the test stricter, not weaker.
- `backend/libs/database/src/schema/pricing.ts` — Line 167 still documents triggerUnit as `'pcs' | 'case' | 'inr'` without saying inr is paise. The plan did not list this file, so leaving it is in scope. It is a doc follow-up for the main session; the implementer already flagged it.
- `backend/libs/core/src/modules/pricing/quote.service.ts` — Adjacent and pre-existing, not introduced here. The server's toSchemeRule (lines 318-341) drops `priority`, while the device adapter (frontend/sales-app/src/lib/pricing.ts) passes `priority ?? 0`, so stacked line_pct rules can compound in a different order on device and server. Separately, frontend/sales-app/app/shops/catalog.tsx:129 prints the raw trigger_min (e.g. '2500000'). Both are outside this plan and were correctly left alone and listed in followUps.
- `backend/libs/domain/package.json` — Operational note, not a defect. @dos/domain resolves only from dist (main/exports point at ./dist), so the sales-app device prices with the old engine until domain is rebuilt and Metro is restarted with --clear. The same applies to every service and the worker until they are restarted. The report's followUps already cover this.
- `backend/libs/domain/src/pricing/schemes.ts` — Not covered by the new tests (the plan leaves them out deliberately, to avoid colliding with DOS-076). The same unit change also reaches step 5 (cash-discount inr triggers) and the reward `multiples` for value/inr net_scheme_amount and free_qty. By reading the code I confirmed that `multiples` only scales net_scheme_amount and free_qty, not order_pct or line_pct, so a bill several times over the threshold still gets 2% and not 2% × N. I also confirmed that `multiples` now divides paise by paise, which is consistent. No live inr slab and no non-zero cash-discount inr threshold exists, according to the plan's SQL.

## DOS-076 (L4-orders) — commits: 212e478

**Deviations:** The product code follows the plan exactly.

**schemes.ts, step 5 only.**
- Kept the eligibility filter, the trigger check and the `bps()` check.
- Added `netOf = new Map(priced.map(l => [l.lineId, l.lineNetPaise]))`.
- Each scheme's `amount = percentOf(sum(in-scope line nets), value)`. A scheme whose amount is 0 or less is skipped.
- The winner is the larger amount; on a tie, the higher bps; on a full tie, the earlier scheme.
- The winner's amount goes into both `cashDiscountPaise` and its `orderRules` entry.
- Deleted `percentOf(totals.netPaise, cashDiscountBps)`.
- No helper added; `scopeBase` and `spread` are untouched.
- Doc comments updated in the header precedence list (step 5) and on `PriceOrderResult.cashDiscountBps` / `cashDiscountPaise`.

**Tests match the plan's figures:** 480; 150/1500/'s-cd-rj'; 70,800 and 1,416. In the second domain test the two schemes are passed in id order ('s-cd-rj' then 's-cd-ty'), as both real callers do. That order also means a "last scheme wins" bug would still fail the test.

**One deviation, by instruction: QA/13-change-log.md was not edited.** The plan lists a change-log row, but this lane's brief forbids editing anything under QA/ except QA/tools scripts. The row is listed in followUps for the main session.

**Follow-ups:** **1. QA/13-change-log.md (Batch 1 table), in its own QA-docs commit (Charter A.14).** Add a DOS-076 row:
- Root cause: step 5 of `priceOrder()` took a `cash_discount_pct` scheme's rate on `totals.netPaise` (the whole order) and picked the winner by bps.
- Change: the rate now applies to the net of the scheme's own in-scope lines, and the offer with the larger amount wins.
- Tests: the three DOS-076 names above.
- Commit: 212e478. Status: fixed.

**2. Other docs.**
- No contract, permission or schema change, so `pnpm docs:readme` output should not change. The QuoteOutput comment "reported, not deducted" still holds.
- docs/22 and docs/18 need no decision entry. At most, a build-log line saying the brand-scoped cash discount is now quoted on its own lines.

**3. After merging.**
- Rebuild `@dos/domain` dist.
- Restart every service that serves `pricing.quote` (at least sales :3003 and retailer :3006; all eight is simplest).
- Restart the sales-app Metro, so the on-device engine matches the server.

**4. Residual items from the plan review, not fixed here (charter scope).**
- **Possible new finding:** retailer R7 promises a cash discount the bill never gives. The quote uses the scheme's amount, but the invoice and receipt use the retailer's own `cash_discount_bps` term, and Shree Ganesh Kirana's term is 0 bps.
- QuoteOutput still reports only one cash discount (the larger one) when a basket carries two brand offers.
- Priority of DOS-076 (P1 vs P2) is for the gate.

**5. Overlaps.**
- DOS-075 is already on this branch. All new tests use `triggerMin 0`, so its paise change cannot affect them.
- DOS-096 reworks the same R7 Total panel. Whichever lands second re-walks R7.
- Basket F's live figure moves from 55,766 to about 1,381 with DOS-075 present (1,409 without it).

**Platform check:** **1. API** (dos_qa after merge, rebuilt domain, restarted services)
- Sign in as `rahul.deshmukh` / Dos@1234 (deviceId a UUIDv7). POST /pricing/quote for Shree Ganesh Kirana (34191c43-f0bc-70ab-a39d-fcbe8f94ae36, tier C).
- **a. Campa 750 ml ×48 + Rajwadi Lemon Soda 250 ml ×24.** cashDiscountPaise 307 (was 1961), cashDiscountBps 150. The single cash_discount_pct orderRules entry has amountPaise 307. Lines and totals unchanged.
- **b. Campa ×48 + Too Yumm Karare 60 g ×48.** cashDiscountPaise 1409 (was 3614), bps 200.
- **c. Rajwadi ×480 + Too Yumm ×48.** cashDiscountBps 150, ruleId 2bdf40c6…, cashDiscountPaise 5828 (was 200 / 663ad71e… / 9180).

**2. Retailer app R7 order screen** (:5178, `ramesh.gupta` / Dos@1234, choose Tarsun)
- Add Campa Cola 750 ml ×2 cs and Too Yumm Karare 60 g ×1 cs. The `r7-cash-discount` line "Paying early takes ₹X off" reads ₹14.09 (was ₹36.14).
- Add Rajwadi Lemon Soda 250 ml ×10 cs: it reads ₹58.28.
- Walk it on web at 1280 and 375 widths, on the Pixel 7 (Android) and on iOS in Expo Go. Do not press Place order.

**3. Sales app:** no visible change expected (it shows no cash discount), but restart its Metro so the device engine matches.

**4. Money path unchanged** (read-only SQL)
- Tarsun `cash_discount_conditions` still holds only 200 and 250 bps.
- Invoices whose `cash_discount_bps` differs from their retailer's term still number 6.

**Verifier minor notes:**
- `backend/libs/domain/src/pricing/schemes.ts` — Deliberate behaviour change the plan accepted (risk note 2): an all:true cash discount now leaves a final-override line out of its base, as well as out of its trigger. I checked it with a probe: base 480 where the old code gave 880-style whole-order figures. No test pins this. dos_qa has no all:true cash scheme, so nothing visible changes today. A later finding may want a test for it.
- `QA/13-change-log.md` — The plan's change-log row for DOS-076 was not written, because this lane's brief forbids edits under QA/. The main session must add it in the QA-docs commit (root cause, change, the three test names, 212e478, fixed).
- `backend/libs/core/src/modules/pricing/pricing.spec.ts` — Not a defect in this fix. The plan's residual item still stands: R7 shows the scheme's cash discount, but the invoice and receipt use the retailer's own cash_discount_bps term (0 for Shree Ganesh Kirana). The corrected figure is still never realised on the bill. It should be logged as a new finding, not fixed here.

## DOS-020 (L4-orders) — commits: 32315dc6b14abdf258ecf7347333bd063a06fe74

**Deviations:** None in behaviour or scope. Small spec and markup details:
1. **Manager fixture phone.** It is `+91904${run}5`, not the plan's `+91904${run}4`. DOS-073, committed on this branch after the plan was written, already uses `+91904${run}4` for its second rep, and `users.phone` is unique (users_phone_idx).
2. **Imports.** The spec imports only `eq` from drizzle-orm, not `and, eq`; `and` would be unused and fail lint.
3. **Refusal assertion.** The `data.approvals` check sorts both sides by id instead of depending on uuidv7 ordering; it still asserts exactly the two ids with kinds credit_limit and below_floor. The DB check also asserts `decidedAt: null` alongside the plan's `decidedBy` and `decisionNote` nulls.
4. **Guard message.** It is built from a `kinds` const, with the same text as the plan. `String(waiting.length)` is used inside the template literal, per the lint rules.
5. **testIDs.** The new manager-panel elements carry `order-waiting-on` on the list, and `order-approve-<kind>` and `order-reject-<kind>` on the buttons, so the platform walk can target them. No other markup was added.

**Follow-ups:** **Docs (main session)**
- Record DOS-020 in QA/13-change-log.md. Say the shortage test was renamed, its gate is now decided as a fixture, and its approvals assertion changed.
- Add a docs/22 §8 row only if the founder treats "release a held order = decide each approval; the last approval confirms" as a product decision.
- docs/23 §2.1 (M2 manager orders) and §1.1 (O5 owner orders) could note that Confirm is disabled while approvals are pending and that the manager panel lists pending gates with Approve/Reject.
- The /docs `x-dos-note` for orders.confirm changed in examples.ts. Per the plan it is in no README; the main session's `pnpm docs:readme` pass will show any diff.

**Not run here (brief forbids or out of scope)**
- `pnpm smoke`: it should classify the orders.confirm 409 as EXPECTED (smoke-endpoints.mts:2206).
- `pnpm --filter @dos/db test`.
- Any app walk, the Android emulator and the iOS simulator.

**Open questions and residual risk, from the plan**
1. **Stale credit.** It can go stale between submit and the last decision: `ApprovalsService.decide` → `confirmInTx` does not re-run `checkCredit`. This is a candidate new finding.
2. **Stop-shop override.** `DecideApprovalInput.note` is still optional and decide is MANAGEMENT. Whether a stop-shop credit_limit decision needs a mandatory note, or is owner-only, is a founder decision.
3. **Unreachable success path.** `orders.confirm` now succeeds only for a submitted order with nothing pending. Retiring or re-scoping the endpoint is a separate decision.
4. **Stale-screen 409.** Until DOS-029 lands, a 409 on confirm or decide from a stale screen closes the dialog silently.

**Coupling with other lanes**
- **DOS-005:** if its fix stops writing `bargain` approval rows, an order held only on a bargain has no pending approval, and this guard would let a direct confirm through. Keep an order-level approval or extend the guard with `hasPendingBargain`.
- **DOS-003, DOS-004, DOS-029:** they touch the same two order screens, so expect merge conflicts in frontend/manager-app/app/orders/index.tsx and frontend/owner-app/app/orders/index.tsx.

**Adjacent defects noticed, not fixed**
- The register's "Waiting on" column in both apps is still derived from `approval_flags`, which seeded held orders leave `[]` (DOS-027).
- No audit rows for confirm or decisions (DOS-028).
- An approved limit request does not change the limit (DOS-006).
- The owner order panel still does not list pending approvals: only the disabled reason names them, per the plan.

**Platform check:** Before walking: rebuild @dos/core in the merged tree, restart manager-service :3002, owner-service :3001 and auth :3000, and use a copy of dos_batch1_template.

**API (manager-service)**
1. Sign in `sanjay.bhosale` / `Dos@1234` (Sai Distributors, manager) and GET /orders?q=SO-0449.
2. GET /orders/{id}: approvals below_floor and credit_limit are both pending.
3. POST /orders/{id}/confirm answers 409 with `data.code` = approval_required, `data.approvals` = the two ids and kinds, and a message naming "credit limit" and "below floor".
4. In the DB both approvals are still pending with decided_by NULL, the order is still submitted, it has 0 reservations, and its only transition is submit.

**Manager web :5174, 1280×800 and 375 px (measure)**
1. As sanjay.bhosale, open SO-0449. The panel shows "Waiting on" listing "Over credit limit" and "Below floor price", each with Approve and Reject.
2. "Confirm order" is disabled and shows "Waiting on Over credit limit · Below floor price. Approve or reject each one first; the last approval confirms the order." Key 1 does nothing.
3. Approve "Over credit limit": the dialog body reads "SO-0449 · Over credit limit · Credit is blocked for this shop". Approve with a note: the order stays Submitted and one gate is left.
4. Approve "Below floor price" with a note: the order becomes Confirmed and "Held for this order" updates without a reload.
5. In the DB both approvals are approved with sanjay's id and the typed notes, and reservations exist.
6. As accountant `nilesh.wagh`, the Waiting-on list is visible with no Approve/Reject buttons.
7. On an order with no pending gate, the Confirm dialog shows the confirm body plus the credit sentence on its own line.

**Owner web :5173**
1. As `sunil.tarsun`, open SO-0879 (R-0001 strict, pending credit_limit). Confirm is disabled with "Waiting on Over credit limit. Decide it on Approvals; the last approval confirms the order."
2. Approving it on Approvals confirms the order.

**Android (Pixel_7_API_36, -memory 3072)**
- Manager app, same panel: the disabled reason text renders under the Confirm button and the Approve/Reject buttons work.

**iOS (Expo Go, booted iPhone 16 Pro)**
- Manager app as `ashok.kulkarni` on SO-0178 (Kalyan Agencies, stop, two pending): same panel, same disabled reason, key path refused. Do not infer iOS from Android.

**Regressions**
- A sales-app order for an indicate shop inside its limits still auto-confirms at submit.
- A retailer-app own-order still auto-confirms under the system role.
- A van sale with no gates still bills.
- An AI draft confirm still submits.
- `pnpm smoke` ends 0 BROKEN.

**Verifier minor notes:**
- `frontend/manager-app/app/orders/index.tsx` — The new Approve and Reject buttons open the decision Dialog, a native Modal (libs/ui/src/native/feedback.tsx:226), from inside the order Sheet, itself a Modal (:139). The unfixed screen already did this for Confirm, Cancel and Release (lines 530/541/552), so this is not a new pattern. The new path has still not been run on Android or iOS, because device walks are forbidden in this lane. The main session's platform walk must press Approve and Reject inside the panel on both devices.
- `backend/libs/core/src/modules/orders/approvals.service.ts` — Two gaps remain, both named in the plan, neither introduced by this fix. (1) Credit is not re-checked at decide: ApprovalsService.decide calls confirmInTx after the last approval without re-running checkCredit. (2) Coupling with DOS-005: the guard reads only order-scoped approvals rows. If DOS-005 stops writing bargain approval rows, an order held only on a bargain could be confirmed directly. Whichever lane merges second must add a hasPendingBargain check or keep the order-level approval.
- `frontend/owner-app/app/approvals.tsx` — The owner's decide mutation refreshes only approvals, orders and reporting (line 104), not warehouse or billing. When the last approval confirms an order from the owner Approvals screen, the owner order panel's stock-held count can read stale for up to the 30 s cache. This predates the fix and is outside the plan, which extends refreshes on the manager panel only.
- `backend/libs/core/src/modules/orders/orders.spec.ts` — The fixture below_floor approval uses entityType 'order', while submitInTx writes 'sales_order'. The plan specified 'order' to match the demo seed. The guard reads orderId, so the test is still valid; this is only a cosmetic difference.

## DOS-005 (L4-orders) — commits: 40fc300

**Deviations:** None in substance; four small refinements.

1. `decideInTx` with `{ ifStillRequested: true }` returns null in two places: after a failed compare-and-set, and also at the first status check when the bargain is already decided. The plan only named the compare-and-set miss. It also said "a bargain already decided elsewhere keeps its outcome", and returning a 409 at the first check would instead roll back the gate decision. Without opts (the `pricing.bargains.decide` path), a failed compare-and-set re-reads the row, so the 409 still says "Bargain is already <status>".

2. The three specs sit at the very end of the outer describe, after the DOS-073 nested describe that was added to this branch after the plan was written. They are still after "shows the warehouse queue…", and spec 3 cancels its order in a `finally`.

3. Extra assertions beyond the plan's steps:
   - Spec 1 checks that the rejection note is written to the bargain.
   - Spec 2 checks that GET /pricing/bargains?status=requested no longer lists the bargain.

4. Risk 4's confirm-sweep path is already closed on this branch by DOS-020: `confirmInTx` refuses with 409 approval_required and decides nothing. Nothing in this fix touches it.

**Follow-ups:** Docs for the main session:
- docs/22: §8 register and the order-to-cash diagram. A bargain gate is now one approval per pending bargain_request, with entity_type 'bargain_request' and entity_id = the request, order_id kept. Deciding it through orders.approvals.decide decides the request in the same transaction; approve takes the asked rate. Add a §11 change-log line.
- docs/18: build-log row.
- pnpm docs:readme: no contract change, so no diff is expected; regenerate once after merging as planned.

Open, not fixed here (all out of plan scope):
- `cancelInTx` expires pending bargain gates without deciding their bargains, so after an order is cancelled the request reappears as a standalone Rate request.
- Reverse path: calling pricing.bargains.decide directly on a gated bargain leaves its gate pending. pricing cannot import orders, so closing this needs a pricing outbox event. The screens no longer offer that path.
- Candidate new finding: approving a bargain gate confirms the order at its pre-bargain line rate. confirmInTx does not re-price, and invoices copy the order rate (invoices.service.ts:129).
- A standalone requested bargain (order_id null) gates every order of that shop for that variant. Each gate names it, so the queue can show several rows for one bargain. The first decision decides the bargain; later ones only clear their own gate.
- A pending gate naming a missing bargain id now answers 404 and cannot be decided.
- Pending bargain gates in the old 'sales_order' shape are still decided the old way. dos_qa has none; the founder's `dos` database is unchecked.

Knock-on effects to note:
- The sales-app order detail shows one "Rate change" row per bargain.
- owner_summary.pending_approvals counts one per bargain.
- QA verify-seed I-35 joins entity_id to sales_orders, so product bargain gates now fall outside it, as the seed's gates already do.

Lane coordination:
- DOS-004 should build its names on the paired rows.
- DOS-090 changes how bargain_requests.order_id is set, and `pendingBargainsForOrder` filters on that column.
- DOS-029 edits the same manager mutations.

**Platform check:** Setup: rebuild @dos/core, restart owner-service :3001, manager-service :3002 and sales-service :3003 on dos_qa, and reload the Expo web apps. Never press Confirm order during this walk.

1. Manager first (read-only). Sign in as vikas.kadam / Dos@1234 on :5174, Orders, "Waiting for a decision":
   - one card per pending bargain;
   - Om Sai Provision Store is named with "Asked rate ₹39.58", and there is no unnamed "Bargain / —" card;
   - in the network panel, Approve or Reject targets POST /approvals/29e03a4b…/decide, never /pricing/bargains/…/decide.

2. Owner. Sign in as sunil.tarsun on :5173, Approvals:
   - Om Sai appears exactly once in All, in Order approvals and in Rate requests; the panel shows list 41.02 and asked 39.58;
   - Mahalaxmi (1221ccf5) and 01a0958e each appear once;
   - Today's waiting list shows Om Sai once.

3. Reject Om Sai with note "QA DOS-005: list rate holds", then reload. It is gone from all three segments and from Today. Check in SQL:
   - bargain_requests 011d0c51-293c-7e9b-bf53-b5b035898d9c → rejected, decided_by = sunil, decided_at and updated_at = now;
   - approvals 29e03a4b-d74f-75a2-914a-2433674d5b76 → rejected.

4. Other tenants: nitin.bhoir (kalyan-agencies) and prakash.salunkhe (sai-distributors) each see their two pending bargains exactly once.

5. Devices:
   - Android: Pixel_7_API_36 booted with -memory 3072, owner app Approvals and Today show one row per bargain.
   - iOS: the same screens in Expo Go, captured with xcrun simctl io booted screenshot.

6. Product path on fresh data:
   - rahul.deshmukh on sales :5175 drafts an order for a shop without a credit hold (not R-0001), asks a rate beyond his bound (about 11% off) and submits.
   - SQL `select kind, entity_type, entity_id, status from approvals where order_id = '<new id>'` → bargain | bargain_request | <bargain id> | pending.
   - Owner Approvals shows one row with the order number and the rates, also under Rate requests; the manager panel shows it once.
   - Reject → order cancelled with cancel_reason approval_rejected, and the bargain is rejected.
   - Approve a second such order → bargain approved at the asked rate, order confirmed. The order line keeps its pre-bargain rate; that is a known adjacent defect.

**Verifier minor notes:**
- `frontend/manager-app/app/orders/index.tsx` — The order sheet's waiting-on list uses testID `order-approve-${gate.kind}` / `order-reject-${gate.kind}`. An order with two bargain gates, which the fix now creates, renders duplicate testIDs. React keys are gate.id, so rendering is correct; only the test hooks collide.
- `backend/libs/core/src/modules/orders/orders.spec.ts` — Two paths have no committed spec. (1) `decideInTx(..., { ifStillRequested: true })` returning null because the bargain was already decided elsewhere. (2) A shopkeeper's own submit inserting a `bargain_request` gate under the retailer RLS policy. I covered both with a temporary probe, which passed and was reverted. The coverage is not committed.
- `frontend/manager-app/app/orders/index.tsx` — The waiting panel now shows the 20-row approvals page plus every pending bargain gate (up to 200), so the panel can grow long. This follows the plan's pairing design; UX only.
- `backend/libs/core/src/modules/orders/orders.service.ts` — Out of scope per the plan. The implementer listed these in followUps and they are not regressions.
- `cancelInTx` expires bargain gates without deciding their bargain, so the request reappears as a standalone Rate request.
- Calling `pricing.bargains.decide` directly on a gated bargain leaves the gate pending. No screen offers that path any more: only the two paired screens call it, and both filter gated bargains.
- Approving a gate confirms the order at the pre-bargain rate. This is a candidate new finding.

## DOS-077 (L4-orders) — commits: f2a36ae

**Deviations:** 1. No @types/node, and the test gets Node's fs and url functions another way.
- The plan assumed @types/node would load automatically for the app. It does not. With @types/node hoisted and added as a devDependency, `tsc --noEmit` (TS 6.0.3) failed with TS2591 "Cannot find name 'node:fs'" / "'node:url'", and 13 no-unsafe-* lint errors followed from that. `tsc --showConfig` resolves no `types`.
- Adding a `types` field or a triple-slash reference would load Node's globals into the whole app program. frontend/sales-app/env.d.ts forbids that: it says @types/node is deliberately absent from an app ("a screen has no fs") and declares its own `process`.
- So the spec imports 'node:fs' and 'node:url' through a non-literal specifier, which the compiler does not resolve, and declares the two function shapes locally. The file is still typechecked and linted.
- For the same reason I dropped the plan's `"@types/node": "catalog:"` devDependency. Only `"vitest": "catalog:"` and the script `"test": "vitest run --dir src"` were added, so the lockfile gains only the vitest edge.
- The assertions are exactly as planned, reviewer changes included: comments stripped, the `<Button\b[\s\S]*?\/>` count equals 1, the button matches fullWidth={false}, `<Stack gap={1} grow>` is present, and the path goes through fileURLToPath.

2. Not done here, per this lane's rules:
- QA/13-change-log.md and QA/STATE.md are not edited (lane instructions forbid touching QA/). They are listed in followUps.
- No app was run.

3. Prettier folded the Button props onto one line: `<Button label={t('s3.addOneCase')} variant="secondary" fullWidth={false} onPress={onAdd} />`, with the explanatory JSX comment above it. Nothing else in new.tsx changed.

**Follow-ups:** QA docs, separate from the product commit (CHARTER A.14):
- QA/13-change-log.md: add the DOS-077 row to the Batch 1 table. Root cause: the native Button's 100% width inside an auto-width Row collapsed the grow column to 0 dp. Change: fullWidth={false}. Test: frontend/sales-app/src/order-entry-layout.test.ts. Commit: f2a36ae. Add screenshot links after the walk.
- QA/STATE.md: move DOS-077 from Open P1 to fixed, pending verification. Record the SO number that verify step 6 creates in dos_qa as a side effect.

Docs:
- CLAUDE.md's "Frontend checks" says `pnpm test` covers "kit + client + offline specs"; @dos/sales-app now has a test task too.
- The build log should note this is the first app-level vitest runner.
- Mention in docs that CI's frontend job does not run `pnpm test`, so this spec is only a local gate. CI still lints and typechecks the file.
- The pattern for Node-reading specs inside an app (non-literal import, no @types/node, because env.d.ts keeps Node types out) is worth one line in docs.

Merge coordination:
- The DOS-074/097 cluster edits new.tsx (the stock-query hunk around lines 92-108, a different hunk from this one).
- If that cluster also adds a test runner to @dos/sales-app, package.json and frontend/pnpm-lock.yaml will conflict. Keep one `test` script and one `vitest` devDependency, then re-run `pnpm install` in frontend/.
- Do not re-add @types/node to the app.

Environment note: `pnpm install` in this worktree pruned 33 hoisted packages that were not in the lockfile. Frontend typecheck, lint and test stayed green after it.

Residual, not fixed (out of scope): with a 3-digit stock chip ("154 cs available") on a 411 dp phone, the name column is estimated at 80-110 dp, so long names wrap to 2 lines and ellipsise. The source-reading test would not catch a future change to the kit's Button default; a yoga-layout harness belongs in Phase 6.

**Platform check:** After merging to main, with Metro for the sales app on :5175 served from the merged tree (not a stale main Metro), services on dos_qa, rahul.deshmukh / Dos@1234:

ANDROID (Pixel_7_API_36 booted with -memory 3072; JS-only change, no APK rebuild):
1. Force-stop and relaunch in.distributionos.sales.
2. Beat → Laxmi Narayan Stores → Take order, then swipe below "Add items / On this phone: 171 items".
Expected:
- Every catalog row shows the item name (up to 2 lines), "Campa · 24 pc case", and the "N cs available" chip when online.
- A label-width "Add a case" sits at the right, inside the row padding (right edge left of about x=1003 px). Before the fix it was a full-width anonymous button from x≈108 to 1034 px.
3. Search "Neelam" (tap the field by screenshot coordinates, `adb shell input text Neelam`, keyevent 111). Only Neelam rows, each named.
4. Offline: `adb reverse --remove tcp:3000; adb reverse --remove tcp:3003`, then relaunch. Rows are named with no chip. Restore the reverses.
5. Online: tap "Add a case" on a named row. "This order" shows the same name.
6. Place order. The dos_qa row for the new SO has item = that name, entered_qty 1, entered_unit case, source salesperson.

iOS (Expo Go via QA/tools/ios-login.mjs 5175 rahul.deshmukh sales Sales; screenshots with xcrun simctl only, never the simulator panel): same path, rows named and the button label-width.

WEB REGRESSION at http://localhost:5175, 390x844 and 1280x800: the order-entry rows should look identical to QA/evidence/phase1/sales/p-03-order-entry.png and s-09: name, brand · case, chip, same-width "Add a case".

**Verifier minor notes:**
- `/Users/prajwalchavan/Desktop/Distribution OS/.claude/worktrees/b1-l4-orders/frontend/sales-app/src/order-entry-layout.test.ts` — The test reads the source and checks the prop (fullWidth={false}) and one exact string (`<Stack gap={1} grow>`), not the layout Yoga produces. It will not catch a future change to the kit's native Button default or the same trap on another screen. It also fails on a harmless reformat of the Stack line. The plan accepts this as the only Node-side option and defers a yoga harness to Phase 6.
- `/Users/prajwalchavan/Desktop/Distribution OS/.claude/worktrees/b1-l4-orders/.github/workflows/ci.yml` — CI's frontend job (lines 70-78) runs install, format:check, lint, typecheck and build, but not `pnpm test`, so this spec only gates locally. CI still lints and typechecks the file. The plan already notes this; it belongs in the docs follow-ups.
- `/Users/prajwalchavan/Desktop/Distribution OS/.claude/worktrees/b1-l4-orders/frontend/sales-app/package.json` — Deviates from the plan: the `@types/node: catalog:` devDependency was dropped, and the spec imports node:fs and node:url through a string-typed variable with locally declared shapes. The reason holds: env.d.ts keeps Node types out of the app program, and this narrows scope rather than widening it. It is still a type escape hatch inside the app's tsconfig program. Only the test file uses it, and no screen or product rule is affected.
- `/Users/prajwalchavan/Desktop/Distribution OS/.claude/worktrees/b1-l4-orders/frontend/sales-app/app/orders/new.tsx` — Native and web rendering were not observed in this verification, because the lane forbids emulators, simulators and dev servers. The native after-state follows from the code: with fullWidth={false} the kit's native Button wrapper gets no style (controls.tsx:77), so the trailing Row is content-sized and the basis-0 grow Stack takes the remaining width. warehouse-app/app/pick/index.tsx already uses the same opt-out and was walked on iPhone. On web, `(fullWidth ?? !isDesk)` becomes false, so the wrapper and button get auto width, which already resolved to the nowrap label width. The Android, iOS and web walks in the plan's verify section are still owed by the main session after merge.

## DOS-001 (L4-orders) — commits: bc1f809

**Deviations:** The code changes are the plan's, file for file:
- the seed key rename;
- the `OwnerSummaryDetail` type alias next to DailyPaymentModeMix, with `jsonb('detail').$type<OwnerSummaryDetail>()`;
- the `keyof OwnerSummaryDetail` reader, keeping the Record<string, unknown> cast;
- the b90plus assertion in reporting.spec.ts;
- the DOS-001 seed test.

Deviations in how the test was written and how the fix was checked:
1. Assertion (b) is written as `expect(keys, slug).toEqual(expect.arrayContaining(readerKeys))`. An object-literal form with `expect.arrayContaining` failed lint (`@typescript-eslint/no-unsafe-assignment`). The meaning is unchanged, and the slug still labels a failure. I re-proved it red by temporarily restoring the misspelling.
2. Assertion (c) compares the raw jsonb value with the live bucket sum; the plan said `Number(detail[key])`. This is stricter: a missing key shows as null instead of NaN, and a string value fails, just as the dashboard's `typeof value === 'number'` check would read it as 0.
3. Assertion (a) checks the ordered slug list, which implies exactly 3 rows.
4. The plan's scratch database, API, web and Pixel steps were not run: no dos_test_dos001, no services on :3100-3102, no swap of :3000-3002, no browser. The lane rules forbid dev servers and every database except dos_b1_l4. Core specs ran against dos_b1_l4, the lane's private copy, not the plan's scratch URL.
5. I did not run `pnpm db:generate` to confirm that `$type` generates no migration. `$type` only changes TypeScript inference, so nothing about migrations is claimed from execution.

**Follow-ups:** - **Build log and change log.** Record the fix in docs/18-build-log.md and in QA/13-change-log.md plus QA/14-regression-results.md. The plan's verify step 5 lists the QA files; this lane may not edit them.
- **docs/22 and README regeneration.** docs/22 needs no change (no decision, flow or contract changed). No README regeneration is needed: no contract changed.
- **Existing seeded databases.** dos, dos_qa and the batch template keep a seed-written `ageingB90Plus` row until `pnpm db:seed` is re-run or the worker's next */15 rollup rewrites it. Re-seed (or wait for a rollup) before walking the apps.
- **QA record correction.** The manager walkthrough note "DOS-001 is owner-app only" (QA/findings/02-walkthrough-manager.md:421) is a timing artefact, per the plan. The manager and accountant Today read the same endpoint and showed 0.00 on a seed-written row, so that note should be corrected in QA records.
- **Merge risk.** Another lane (DOS-032+DOS-059, receipt numbering) may also edit backend/libs/database/src/seed-demo/* or add tests to seed-demo.test.ts. This commit inserts one `it` block between 'seeds three distributors that share shops and stay isolated' and the platform-console test.
- **Not in scope, not audited.** Other seed-built rollup columns could drift from the worker the same way. The daily_* mixes are already typed; the plan's reviewer did not audit every column.

**Platform check:** Re-run `pnpm db:seed` on the walk database, then keep the worker from rewriting owner_summary before you look: stop it, or check right after the seed. Then:
1. **Owner, web.** Sign in at http://localhost:5173 as sunil.tarsun / Dos@1234. Today, "Money owed, by age": 90+ equals the 90+ on Money -> Outstanding (non-zero, e.g. ₹35,144.00 on the 2026-09-12 seed), and all six rungs match. Check the desk (1280) and phone widths.
2. **Manager, web.** At http://localhost:5174 as vikas.kadam, Today's 90+ matches the same number. Accountant meena.joshi on the same app sees the same.
3. **API.** GET :3001/reporting/dashboard/owner returns `ageing.b90plus` equal to `sum(bucket_90_plus_paise)` for the tenant, and `detail` carries the key `ageingB90plus`, not `ageingB90Plus`.
4. **Android, optional.** The Pixel 7 owner app hits the same endpoint and shows the same 90+.
5. **SQL.** `select t.slug, s.detail ? 'ageingB90Plus' as stray, s.detail->>'ageingB90plus' as dash from owner_summary s join tenants t on t.id=s.tenant_id` shows stray = f and dash equal to the live 90+ sum, for tarsun, sai-distributors and kalyan-agencies.

**Verifier minor notes:**
- `backend/libs/core/src/modules/reporting/reporting.spec.ts` — The new `ageing.b90plus === 200_000` assertion passes both before and after the fix. That is by design: the reader was never wrong, and the plan says it passes on HEAD. So the only red test is the seed test. This is not a weakness in the fix, but the reader-side assertion does not prove this fix.
- `backend/libs/database/src/seed-demo.test.ts` — Assertion (c) differs from the plan's wording. It compares the raw jsonb value with Number(live sum) instead of Number(detail[key]). That is stricter: a missing key gives null and a string value fails. Assertion (b) uses expect(keys, slug).toEqual(expect.arrayContaining(...)) instead of an object literal. Same meaning, and it was re-proved red in this verification. Acceptable.
- `backend/libs/database/src/schema/reporting.ts` — No one ran `drizzle-kit generate`, neither the implementer nor this verification. So nothing executed proves that `.$type<OwnerSummaryDetail>()` produces no migration. `$type` only affects TypeScript inference, and the diff touches no migration or snapshot file, so the risk is negligible.
- `QA/findings/02-walkthrough-manager.md` — Follow-up only, not a defect in the fix. Line 421 says "DOS-001 is owner-app only". Per the plan that is a timing artefact: the manager and accountant Today read the same endpoint. Also, dos, dos_qa and the batch template keep a seed-written `ageingB90Plus` row until a re-seed or the worker's next */15 rollup. Re-seed before the platform walk. The plan's API, web and Pixel checks were not run in this lane; the lane rules forbid servers.

