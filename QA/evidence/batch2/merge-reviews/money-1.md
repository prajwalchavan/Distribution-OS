# Lane `qa/b2-money` (DOS-168 · DOS-169 · DOS-170) — architect merge review

Opus 5 standing in for Fable. Read-only review of `main...qa/b2-money` (9c44458, d19d39d, 1b4e022, f086d1a)
against the approved design and the founder's answers of 2026-09-14. Lens: ledger and concurrency.
**Decision:** MERGE AFTER FIXES — one blocker, one line, in the lane's own new file.

## Sound (ledger and concurrency)
- **Exactly once.** `depositReceipts` locks the batch `FOR UPDATE` ascending id and re-guards the UPDATE on
  `status = 'collected'` with a `.returning()` count, whole batch or none (receivables.service.ts:964-971,
  :1023-1045); the journal and the `ChequeDeposited` event roll back with it.
- **One lock order, no cycle.** Every transaction takes at most ONE trip-money advisory lock —
  sync.service.ts:83, "Each op is its own transaction", so a multi-trip batch cannot self-deadlock — plus receipt
  rows ascending id. Deposit and undo hold rows and never ask for an advisory; settle and `recordReceipt` hold
  the advisory and take rows ascending; `settle` and `collectInTx` take the trip row first. No cycle exists.
- **Journals balance.** `expectedCash = float + cash − expenses` with Cr CASH_VAN = the same `cash`, so
  Dr CASH (handed − float) + Dr TRIP_EXPENSES − Cr CASH_VAN − Cr CASH_SHORT = 0 identically, and Σ Dr CASH_VAN
  of the counted receipts = Cr CASH_VAN by construction. Traced record→settle, record→undo→settle,
  record→settle→undo and record→settle→deposit→undo: CASH_VAN ends at 0 in all four.
- **Net of reversals** — `tripMoney` drops the mirror and the cancelled original, keeps a bounced cheque
  (:643-660), amendment (d). **DOS-170** picks the source under the row lock (:2056-2068): BANK if deposited,
  else CASH for trip cash whose trip settled, else where it landed; right for `settled_with_variance` too.
- **`trip_settled` at every door, UPI accepted.** `REFUSED_AFTER_SETTLEMENT = {cash, cheque}` at
  receivables.service.ts:315 and delivery.sync.ts:181, identical sentence; the sync door rethrows as
  `SyncRejection`, so 2xx + `sync_errors` and a re-sent `opId` replays. It departs from the literal Step 3 and
  follows the founder's answer A — **I bless it explicitly.** docs/22 §4/§6/§8/§11 are already written
  (f9eb9d3, §6 line 196) and match what is built.

## Blockers
1. `frontend/delivery-app/src/lib/check-in.ts:86` — `dayEndCash` keys the settled branch on the SCREEN's
   `tripState`, which day.tsx:143 takes from the LOCAL SQLite row (`useLocalTrips`), and day.tsx:95-99 disables
   the `trips.get` fallback whenever that local row exists. So between the desk settling and the next delta pull
   the phone still reads `closing` while `figures` — the live `settlementPreview`, which carries `tripState`
   (contracts/src/delivery.ts:825) — already reports the settled figures. In that window D8 runs the non-settled
   branch: it adds the phone's held cash on top of a settled hand-over and prints `d8.uncounted`, "the cash part
   is already in the figure above", for money the server will refuse `trip_settled`. That is the double-count
   DOS-169 exists to remove, shown to a driver at the counter; amendment (m) forbids it. **Fix:** pass
   `tripState: figures?.tripState ?? tripState` in day.tsx (or read it inside `dayEndCash`), plus a
   check-in.test.ts case: local `closing` + `figures.tripState = 'settled'` → settled branch, hand-over unchanged.

## Minors
- `TRIP_SETTLED_MESSAGE` is duplicated verbatim at receivables.service.ts:316 and delivery.sync.ts:192 plus two
  spec constants. T4 pins all three doors, but amendment (l)'s honest form is one export from
  `receivables/index.ts`; do it in group 17's rebase.
- `frontend/delivery-app/src/strings.ts:336` `d8.pendingBlocks` says "{count} doorstep records" while
  `status.pending` counts the whole outbox (stop PATCHes, deliveries). The gate is right, the noun is wrong —
  "{count} records" would be true. The design's own text, not the builder's error.
- A `collections` UPI op on a settled trip keeps `trip_not_open`: unreachable and founder-consistent; blessed.
- Two net-of-reversal conventions now live in receivables: `tripMoney` excludes the mirror and keeps a bounced
  cheque, `collectionsRegister` the reverse — right for each report, documented only on `tripMoney`.
- A trip settled SHORT whose receipt is later undone credits CASH the office never got; T9 pins that as intended.

## Conflicts
- Merges clean onto main today. Main HAS moved outside `QA/` since the merge base 9cab1e7 — S-108 is merged
  (0f49863, manager-app), plus ci.yml and libs/database/src/test-setup.ts — none a file this lane touches, so
  the build report's "main moved only under QA/" is stale but harmless.
- Shared files, hunk ranges checked, all disjoint: delivery `strings.ts` money@332 vs DOS-171@285/294 vs
  DOS-172@178; `contracts/delivery.ts` money@496/819 vs DOS-172@80/708/737/742/779; `trips.service.ts`
  money@64/181/1219 vs DOS-172@84…1177. Merge order money → DOS-171 → DOS-172 holds.
- **Scope deviation, recorded not fixed:** the design promised twice that money leaves `trips.service.ts` alone
  (group 18, DOS-172); it adds three lines there plus the `delivery.mappers.ts` trip-detail rewrite. Both are
  load-bearing: `loadTripDetail` carried the same DOS-169 sum, and the new `seesMoney` gate (BACK_OFFICE or crew)
  is REQUIRED because `receipts` is staff-readable while `collections` was not — without it the godown would
  newly see the trip's cash. It reproduces the old godown answer exactly (`trip_expenses` RLS is crew/back-office
  too, so expenses read 0 and expected = the float). Tell group 18 and DOS-172 at rebase.
- Still owed by the main session: docs/27 §14 (after DOS-167 ruling 2); docs/23 §10 #6 before group 14 starts;
  group 14's stale comments (collect.tsx:13-21, queue.ts:225-235); group 10's two Day-end sentences.

## Walks still needed (none run in this lane)
`pnpm smoke` 0 BROKEN on the lane DB, and QA/evidence/batch2/dos-168-170/{web,android,ios}: two desks banking one
receipt; the offline-receipt trip settling green; the reversal on the trial balance; D8 with one receipt held
offline (web, Pixel 7, iOS); and, after the blocker, the settle-while-the-phone-is-open case that exposes it.

## Defects outside the lane
- `backend/libs/core/src/modules/delivery/collections.service.ts:193-199` — `collections.list` `totals` still sums
  `collections` rows per mode, its comment calling them "the accountant's cash in transit". An offline doorstep
  payment writes no such row, so from this merge that register disagrees with the settlement cockpit for exactly
  the DOS-169 case. Needs its own finding.
- `frontend/delivery-app/src/lib/check-in.test.ts` asserts the returned key literals but nothing proves
  `d8.uncountedSettled` / `d8.pendingBlocks` exist in `strings.ts` (the translator is typed
  `(key: string) => string`), so a rename would ship a raw key to a driver with every gate green.
