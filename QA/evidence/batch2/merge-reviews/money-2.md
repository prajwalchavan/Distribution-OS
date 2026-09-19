# Lane `qa/b2-money` (DOS-168 · DOS-169 · DOS-170) — architect merge review

Opus 5 standing in for Fable. Lens: offline and platform. Read-only. Reviewed `main..qa/b2-money` = 9c44458, d19d39d, 1b4e022, f086d1a against the
design, the founder's answer of 2026-09-14, docs/27 and the sibling lanes.

**Decision:** MERGE AFTER FIXES — one line in `day.tsx`, then merge first as the design orders.

Substance is right, the doors proved. `tripMoney` is the one count; all three doors refuse cash and a cheque for a settled trip in one byte-identical
sentence and accept UPI (T4 asserts the three, the `planned` trip keeping `trip_not_open`, the replay, the UPI landing in UPI/AR). `trip_settled` is a
free string in `SyncUploadOutput` (`sync.ts:83`) so no upload can 500 on it; it reaches the tray with the server's sentence and Retry/Discard
(`attention.tsx:128,152,161`), and the replay check runs BEFORE the refusal, so a landed op still replays. Step 5 holds — `onTheRoad` trips carry no
bill and van sales, `loadedOutTrip` confirms a sheet first — so both pass DOS-172's `bill_not_loaded` gate. `docs:readme:check` clean (JSDoc only).

**Blessed on the record.** `REFUSED_AFTER_SETTLEMENT = {cash, cheque}` departs from the literal Step 3 and follows the founder's answer A: the design
predates the answer, the founder wins, T4 pins both halves. Likewise `trips.service.ts` / `delivery.mappers.ts` against "untouched by money" —
`loadTripDetail` carried the identical DOS-169 sum, and its `seesMoney` gate is load-bearing: `receipts` is staff-wide where `collections` was
back-office-or-crew, so without it the godown would newly read a trip's takings. Group 18 is told, not left to find it in a rebase.

## Blockers

1. `frontend/delivery-app/app/day.tsx:189` — `dayEndCash` branches on the SCREEN's `tripState` (`trip?.state ?? remote?.state`, :143), which is
   local-first and lags: `useLocalTrips` filters to `OPEN_TRIP_STATES` (`src/lib/local.ts:232`), so between the office settling and the next pull the local
   row still reads `closing` while `preview.data` already carries the settled figures. In that window the non-settled branch adds the phone's held
   cash on top of a settled hand-over and prints `d8.uncounted` — "they count into this trip when they arrive" — for money the server will refuse.
   Amendment (m) broken in the exact window this slice exists for. The figures and the rule reading them must come from ONE snapshot, and the snapshot
   carries its own state (`contracts/src/delivery.ts:824`). Fix: `tripState: figures?.tripState ?? tripState,` at :189 — no signature, type or test
   change (`dayEndCash` reads `tripState` only when `figures !== undefined`). Add to the `check-in.test.ts` guard:
   `expect(code).toMatch(/tripState:\s*figures\?\.tripState/)`.

## Minors (1 and 2 before the Android walk — they are what a driver reads)

1. `strings.ts:335` — `d8.pendingBlocks` says "{count} doorstep records", but `status.pending` is the whole outbox (`offline/src/engine.ts:1773`,
   `status IN ('queued','sending')`), which after an offline day also holds `trip_stops` PATCHes and `deliveries` PUTs. Blocking on all of them is
   right; the noun is not. Suggest "{count} records from this phone have not reached the office yet." — `d8.pending` at :339 already words it
   honestly.
2. `strings.ts:333` — `d8.uncountedSettled` sends ALL leftover phone receipts to the cashier, but `uncountedAllPaise` spans every mode and a late UPI
   is now ACCEPTED (founder A, proved in T4). Name the cash: "…; hand any cash to the cashier, the office records the rest."
3. `check-in.test.ts` — nothing asserts the two new keys exist; `Translator` is `(key: string, …) => string` (`libs/ui/src/strings.ts:171`), so a
   rename ships a raw key with every gate green. Both are exact today. And `day.tsx:240`'s offline fallback (`deviceCash + float`) still ignores the
   settled case — harmless, but the one place on D8 that did not follow `dayEndCash`.
4. Stranding, bounded: `pending > 0` with `online` true and a frozen queue blocks check-in for good — only via `upgradeRequired` (`engine.ts:1348`,
   `:1466`), and owner or manager can still call `delivery.trips.return` (DOORSTEP, `permissions.ts:730`). One sentence to group 10, not code.
5. `TRIP_SETTLED_MESSAGE` is a second verbatim copy (`delivery.sync.ts:186`) of `receivables.service.ts:305`; amendment (l) wants one export from
   `receivables/index.ts`. Four specs assert the string, so drift is caught.

## Conflicts

- Textually clean: `git merge-tree --write-tree` against `qa/b2-dos171`, `qa/b2-dos172`, `qa/b2-s108`, `qa/b2-dos167r3` and `main` each returns a tree
  with no conflict list.
- The build report's "main has moved only under QA/" is now STALE. Main has taken 4 non-QA files since merge base 9cab1e7: S-108
  (`manager-app/app/fulfilment/load-out.tsx` + guard test, on main as 0f49863), `ci.yml` (+`db:seed`), `libs/database/src/test-setup.ts` (import path only).
  None touches money: no rebase risk, no re-verification beyond the normal suite. `qa/b2-s108` and `qa/b2-dos167r3` are at or behind main — do not
  merge those branch names.
- DOS-172 adds `libs/core/src/testing/load-out.ts`, duplicated by money's `loadedOutTrip` (`settlement-money.spec.ts:392`). Fine at merge; fold
  later. Merge order stands: money → DOS-171 → DOS-172, before groups 2, 5, 10, 14, 17.
- The gate depends on `status.pending` meaning queued + sending only. DOS-167 ruling 3 touches the offline engine and the leave flow: if it ever folds
  `rejected` into `pending`, this gate strands the van. Put that in its brief.

## Walks still owed (none ran on this lane)

`QA/evidence/batch2/dos-168-170/{web,android,ios}/` items 1–4, AFTER the blocker — the settled-trip leg is where it shows. Web item 4: Delivery :5177
D8 at 1280x800 and 390x844, one receipt held offline → `d8-uncounted` and the disabled button; back online → the note clears and the hand-over figure
does NOT move. Android (Pixel_7_API_36, `-memory 3072`): airplane-on collect → End of day disabled with the pending sentence; airplane-off → Updated,
check in. iOS via `xcrun simctl` + `QA/tools/ios-drive.mjs`, never the panel. Plus `pnpm smoke` 0 BROKEN on a copy (its deposit and receipt examples
carry no `tripId`, so the new refusals cannot fire).

## Defects outside the lane

- `modules/delivery/collections.service.ts:193-195` — `collections.list` totals still sum `collections` rows per mode and call themselves "the
  accountant's cash in transit"; an offline doorstep payment writes no such row, so they understate exactly the way DOS-169 described. Scoped out by
  the design; file it.
- `modules/receivables/receivables.module.ts:48-54` — a `delivery` device pulls EVERY receipt in the tenant for 90 days (RLS is staff-wide; `extra`
  only adds the date). D8 filters by trip so nothing is wrong, but it is a wide read set for a phone.
- Main session still owes: docs/22 §4 D8 + §6 + §8 + §11; docs/27 §14 after DOS-167 ruling 2; docs/23 §10 #6 before group 14; group 14's comments
  (`collect.tsx:13-21`, `queue.ts:225-235`); group 10's two Day-end sentences.
