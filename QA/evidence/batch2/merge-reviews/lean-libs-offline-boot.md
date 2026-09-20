# Merge review — lean-libs-offline-boot (DOS-046, DOS-053, DOS-055, DOS-068, DOS-089) — Fable, 2026-09-20

Branch `qa/b2-lean-libs-offline-boot` (5 commits d958d3a..a77a155) sits directly on main HEAD b8b116d (merge-base = main).

**Decision:** MERGE AFTER FIXES

## Blockers

1. **`retry()` will re-send money, and the engine has no guard** — `frontend/libs/offline/src/engine.ts:1682-1712`.
   On main a retry of a `kept` payment was harmless by accident: same opId, the server replayed the stored refusal, and
   `handOver()`'s own comment (engine.ts:1759-1760, "sending it again would only replay the server's stored refusal") relied on it.
   This group makes that sentence false: `retry()` selects `WHERE op_id = ?` with no status check, mints a new opId, sets
   `status = 'queued'`, and `claim()` sends it — a doorstep receipt the cashier has already recorded at the office is posted a
   second time under a fresh opId. No screen reaches it today (the delivery tray offers only `handOver` on money, tray.ts:84-97;
   sales and warehouse write no money table), but DOS-178 put the money guard for `discard` IN THE ENGINE, "not merely hidden by
   whichever screen happens to draw the tray", and lean-delivery-collect is still to merge against this tray. `inHand` is a tracked
   set for `end()`, not a lock, so nothing else stops a retry of an op that is not `rejected` either.
   Fix (engine.ts:1686-1692): `SELECT * FROM ${OUTBOX_TABLE} WHERE op_id = ? AND status = 'rejected'` — anything else (kept, queued,
   sending, acked, missing) returns null and changes nothing; then `if (isMoneyTable(op.table)) throw new KeptMoneyError(op.table)`
   before the transaction (money goes to the cashier, never out again — same rule as `discard`). Rewrite the handOver comment at
   :1759-1760 ("not a status `claim()` or `retry()` will ever pick up"). One case in engine.test.ts 6b: refuse a `receipts` op,
   `handOver`, `retry` → throws `KeptMoneyError`, outbox row still `kept`, `handed_over_at` intact, `uploadCalls` unchanged; and
   one in 6d: `retry` of a `queued` opId returns null and sends nothing.

## Minors

- engine.ts ~:2020-2030 (verifier minor 1, agreed): the DOS-178 paragraph "…it is counted here…" now sits above the `rejected`
  query that EXCLUDES handed_over_at; move it back above the `held` query.
- DOS-053 as built: `status.rejected` = tray rows minus handed-over ones, while `needsAttention()` keeps handed-over rows for the
  "Handed to the cashier" section. Correct (DOS-178), narrower than the planner's "must equal" — accepted.
- DOS-068 is wired in the delivery app only. Sales and warehouse phones still believe the radio is up through airplane mode
  (same `radio()` fallback, same engine). One `watchRadio` line + the dependency each; better, a `network.web.ts/.native.ts` pair in
  `@dos/ui/platform` once lean-kit-overlays (owner of platform/types.ts) is through, so no app imports a native module directly —
  the `NetInfo` import in delivery `_layout.tsx:34` is the only such import in any app and sits outside the docs/08 §0 rule
  (lint allows it; the planner's note chose it). S-row.
- Design deviations accepted: (e) no second versioning scheme — `SYSTEM_TABLE_ADDITIONS` (DOS-178, already on main) carries
  `retried_as`, best-effort ALTER, CREATE/ALTER agreement asserted instead of an "upgrade in place" the memory engine cannot
  distinguish; the pull-race test reshaped for DOS-183's queue-first ordering and re-proved red; `delivery-app/src/lib/tray.test.ts`
  two additive lines (no owner, forced by the required `retriedAs`).
- `sales-app/app/orders/attention.tsx:88-95` still offers "Try it again" on a row with `op === null` — harmless null now; one-liner
  for lean-sales-rep (design note 4).
- Not lane-owned, for the main session AT MERGE (the builder's report does not say either was passed on): docs/22 §8 row +
  §11 line correcting the 2026-09-06 "same opId on retry" wording (docs/22:379) per design amendment (i); QA/ENV.md:151 ("a retry
  resends the same opId → replayed:1") is now false and :156 (LogBox on the first Android tap) retires with DOS-055.
- At merge: `cd frontend && pnpm install` first — the lockfile gained `@react-native-community/netinfo@12.0.1` and the main
  checkout's node_modules does not have it; then `pnpm build` (the delivery web export was not reported run).

## Conflicts

- With main now: none (branch is on main HEAD; no file changed on main since the merge-base).
- Still to merge, all declared `waitsFor` this group so they rebase: lean-sales-rep (engine.ts, engine.test.ts, react.tsx — onto the
  new `retry()` / `refreshCounts()` / `pullErrors()`), lean-warehouse-stock (warehouse settings.tsx: `deviceLabel` at the top + the X4
  row), lean-orders-panels (owner `_layout.tsx`), lean-manager-order-lifecycle (manager `_layout.tsx`), lean-owner-desk and
  lean-retailer-platform (pnpm-lock.yaml catalog/importers/packages/snapshots hunks + pnpm-workspace.yaml catalog — the likeliest
  textual collision).

## Walks (none were run; the gate must)

- Web warehouse 1280×800 (dinesh.patil): the DOS-046 design walk — refuse a pick by closing the wave, reopen, "Try it again": network
  tab shows POST /sync/upload with a DIFFERENT opId answering accepted:1; `sync_ops` holds two rows; the old refusal does not return
  after two pulls and a reload. X4 "Refused N" = tray = rail badge (DOS-053); the device row reads "Chrome on Mac".
- Android Pixel 7 (-memory 3072): warehouse, owner, manager, sales cold start + first tap with no LogBox (DOS-055); delivery
  airplane mode → "Offline since …" within a second, radio back → green and the queue drains (a-34); API cut → Trip history shows
  the network sentence with no "unknown" (a-39); warehouse tray: retry in airplane mode, radio on, old refusal absent.
- Web sales: remembered session cold start — the first /sync/manifest carries Authorization; 15 min later a navigation shows
  POST /auth/refresh BEFORE the call and no 401 in sales-service logs (DOS-089).
- iOS (Expo Go, headless): delivery still boots with the new native module; DOS-055 on one app.
- Delivery web: "Send it again" on a stale op is refused stale again under a new opId → ONE tray item.

## Defects outside this group

- engine.ts:1215-1230 `pullErrors`: the `settled` pre-read and the `INSERT OR REPLACE` are not atomic with `retry`/`handOver`/`discard`
  (`inHand` is not a lock). A marker written between the two is overwritten with NULL and the old row is back as a "not on this
  phone" orphan until thrown away. Pre-existing since DOS-178, one store round-trip wide; fix is `INSERT OR IGNORE` (or ON CONFLICT
  DO UPDATE of code/message only) so mirroring never touches the three markers. S-row.
- Server `sync_errors.resolved_at` is never written — discard and retry leave the old row unresolved for support triage (design note). S-row.
