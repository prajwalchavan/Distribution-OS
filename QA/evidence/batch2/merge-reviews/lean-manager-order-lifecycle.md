# lean-manager-order-lifecycle — architect merge review (Fable, 2026-09-21, after repair)

First review: no file ever existed at this path on main or on the lane (the first pass was never persisted), so this is the review of record, judged against the signed-off design. Since then: the verifier's two problems (the forbidden DOS-030 stopgap; the `start` reconcile that survived deletion) were repaired in 77ecd2c and d9e9d65 and re-verified pass; this pass found one NEW production defect in the same reconcile and a docs/22 register conflict with a founder row that landed on main after the lane branched.

Branch `qa/b2-lean-manager-order-lifecycle` (11 commits on 8b030e5; main has moved by 787181c, 40f4682, 20c3d59). Read-only: lane diff, both repair commits, the spec cases, and read-only EXPLAINs under `app_rw` on the lane's own database `dos_test_b2_manager_order_lifecycle`. No build, test or git write.

**Decision:** MERGE AFTER FIXES

## Are the two proven defects closed at the cause?

- Problem 1 (DOS-030 stopgap) — closed by removal, forward revert, history kept. `documents.tsx` is byte-identical to main; `strings.ts` keeps only the m2/m6 copy; the guard test is gone. DOS-030 stays OPEN and unbuilt, which is the right state: the docint path is the architect's design and needs the pipeline files this lane does not own.
- Problem 2 (untested `start` reconcile) — closed at the cause. The new case boots a hookless `bootTestApp([OrdersModule])`, asserts `PicklistsService` does not resolve there, takes the decisive reading between the cancel and the start, and the verifier's two-line deletion now fails exactly that case. The companion case pins the hook path separately. No production code changed. This is the pattern every hook-fallback test in the repo should follow.

## Blockers

1. **`backend/libs/core/src/modules/warehouse/picklists.service.ts:432-447` — `start` revives a sheet the reconcile just cancelled.** When EVERY order on an OPEN wave was cancelled with no hook registered (a rep cancels a confirmed order from the sales app; single-order waves are the common case), the reconcile's `putBackOrder` marks the lines and, finding no live line, closes the sheet as `cancelled` with a reason (:161-167). `start` then continues on its pre-read `sheet.status === 'open'`, calls `updatePicklist({ status: 'picking', startedAt, assignedTo })` (:439-445) — `updatePicklist` (:967) has no machine — and emits `PicklistStarted`. Result: a row that is `picking` AND carries `cancelled_at` + `cancel_reason`, with zero live lines; `cancel` refuses it (:484-493, only `open`), `refreshCompletion` can never mark it (`totals.length > 0` is false), W5 reads "0 of 0" with Confirm enabled. On main this sheet answered 409 and the desk could still cancel the open sheet; on the lane one tap of Start makes it a permanent zombie. Neither DOS-138 case covers it (2511 cancels through the hook on a started sheet; 2594 keeps one live order). **Fix:** after the reconcile loop, re-read the sheet — `const fresh = await this.findPicklist(tx, sheet.id); if (fresh.status === 'cancelled') return { item: await picklistDetail(tx, fresh, this.orders) }` — so the put-back marking and the closure commit, no `PicklistStarted` is written, and the picker's screen reads Cancelled with the reason (a 409 here would roll the whole reconcile back; if that is preferred, say so in the message and accept that the desk then cancels the open sheet by hand). **Spec:** warehouse.spec — single-order open wave, cancel through the sales-shaped app, `start` → 200 with `status 'cancelled'`, every line `cancelled_at` set, `cancel_reason` naming the pre-pick reason, no `PicklistStarted` outbox row, a second `start` → 409 "is cancelled". Red-prove by reverting the guard.

2. **`docs/22-source-of-truth.md` §8 — two answers to the one DOS-023 question.** Main's founder row (2026-09-20, line 330, "I agree with all recommendations") reads "Every list in every app orders by SERVER TIME, newest first, id only as tie-break". The lane's DOS-009 row (architect default) keys bills on `invoice_date` and trips on `trip_date` — business dates a desk can back-date or plan ahead — and strikes the same §10 bullet main already struck. The register cannot hold both. **Fix (docs only, no code change):** keep the founder's row as the rule; rewrite the lane's DOS-009 row as its application — orders by `created_at` (server time, as the founder said); bills and trips keyed on the date column their OWN window filters on (`invoice_date`, `trip_date`), the row id the tie-break — and name that as the one stated exception, put to the founder in one line with the batch approval. If the founder wants pure server time, a follow-up switches bills/trips to `created_at` with new indexes. Resolve the §10 conflict by taking main (all four bullets gone) and §11 by keeping both sides' rows; then `python3 docs/tools/render-source-of-truth.py` and republish (the lane touched only the .md).

## Minors

- `trips_date_idx` was not widened (design (e)). EXPLAIN on the lane DB: orders and bills → Index Scan Backward on the new indexes; trips → Sort over a Bitmap Heap Scan on `trips_state_idx` (`\d trips` still shows `(tenant_id, trip_date)`). Correct, but not docs/20 rule 8. Fix: `schema/delivery.ts:201` → `.on(t.tenantId, t.tripDate, t.id)` + generated 0050; ride with blocker 1 or follow up.
- `PickLineSchema` (contracts/warehouse.ts:216) does not carry `cancelledAt` (design step 5): W5 reads the column off the synced row, but `picklists.get` online omits it, so no desk panel can show put-back lines. Follow-up: additive field + `toPickLine` + `pnpm docs:readme`.
- A pick on a put-back line offline is rejected as the generic `pick_rejected` (warehouse.sync.ts:90-98 maps every CONFLICT), not `line_put_back` as amendment (e) named; the message carries "put the pieces back". Acceptable; recorded.
- DOS-139 amendment (d) — load-sheet approve/confirm re-reading the orders — was not built (file not owned). billing.spec:890 pins the invariant honestly: confirm's `dispatch` has no edge from `cancelled`, the transaction rolls back and no stock moves. Residual: a sheet drafted before the bill cancel gets approved (PIN spent), then sticks in `approved` behind a raw machine message and cannot be cancelled (load-sheets.service.ts:554-580, draft only). Defect outside, below.
- The verifier's note stands: the `LIVE_PICKLIST_STATUSES` mutation fails three cases, not one; the two-line deletion is the real discriminator.
- `updatePicklist` writes any status with no picklist machine; blocker 1 is a symptom. Later hardening, not this lane.

## Conflicts

Only `docs/22-source-of-truth.md` overlaps main since 8b030e5 (`comm` of both name lists); `git merge-tree` shows two hunks, §10 and §11, resolved as in blocker 2. Migrations 0048/0049 are free (main ends at 0047). No code conflicts.

## Walks (none run in the repair round; no earlier walk record exists on disk)

- Warehouse Android (`Pixel_7_API_36 -memory 3072`): two-order wave, start, pick one line of A; manager cancels A on web → after sync W5 shows "Put back N pcs · batch" for the picked line and "Not needed" for the untouched one, progress counts only B, Confirm ignores A; then blocker 1's case — single-order open wave, rep cancels from the sales app, Start → sheet reads Cancelled with the reason. The new column re-snapshots every device (outbox kept, offline/schema.ts:237) — prove once here; iOS not owed.
- Manager web 1280 and 375: picking order → Cancel dialog shows the picker sentence → 200, row to Cancelled; packed → Cancel off "Cancel its bill…"; dispatched → credit-note reason; Bills issued → cancel dialog copy → order Cancelled naming the bill, gone from the queue; header search INV/… → Bills issued with the panel open, also while already on the desk (DOS-145).
- Owner web + owner Android Orders tab: today's SO above 25 Aug, Show more without a repeat; Trips by trip date; Bills by bill date (DOS-009).

## Defects outside this lane

- DOS-030 OPEN and un-mitigated: `documents.service.ts:545-549` answers 501 and `pipeline/validators.ts:177-185` red-flags every real brand bill; needs the docint slice (contracts/docint.ts + billing.ts, documents.service.ts, validators.ts, extractions.service.ts, review.service.ts, docint.module.ts, the per-kind commit dialog).
- DOS-139 (d): load-sheets.service.ts approve/confirm must refuse `order_left_the_sheet` and an approved sheet needs a way back — warehouse slice.
- Still id-ordered (design (g)): `fulfilmentQueue`, `loadSheets.list`, `trips.stops.list`, `billing.invoices.queue`.
- Hook-fallback tests elsewhere (DOS-132 `registerTripSettled`, DOS-172 `registerRoadHold`) should adopt the two-container pattern this lane now uses.
