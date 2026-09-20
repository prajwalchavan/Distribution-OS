# Merge review — lean-delivery-door (qa/b2-lean-delivery-door, 6 commits eae2202..3d07a51)

Reviewer: Fable (architect), 2026-09-20. Read-only: the diff, the six tests, at-the-door.ts, the order machine, the sync engine,
the kit contracts. No builds, tests or walks run here.   **Decision:** MERGE

Merge-base is main HEAD (b9802b5); `git merge-tree` is clean; no other branch or worktree touches any file of this group.
Every group that owns one of these files later (lean-delivery-collect, lean-warehouse-pick, lean-manager-money,
lean-manager-order-lifecycle) already waits on this one. react.tsx, _layout.tsx and local.ts are untouched, so
lean-libs-offline-boot and lean-sales-rep keep them conflict-free. DOS-085 (lean-sales-entry e6f931c) is in the base, so the
kit pad, `stepPiece` and the `qty.pieces*` strings this group leans on are real; no rebase is owed.

## Design match, item by item

- DOS-148 (backend): `assertOnTheVan` runs after `checkLines` and BEFORE `assertPodPolicy` and `applyFulfilmentEvent`
  (deliveries.service.ts:130-135); 409 `order_not_dispatched` with a driver sentence; `state === transitions.dispatched[event]`
  reproduces `applyFulfilmentEvent`'s own idempotence (FULFILMENT_TARGET orders.service.ts:119-126 matches the machine), so
  "Nothing delivered" on a still-`packed` bill stays a no-op that clears the stop with no credit note and no stock move
  (deliveries.service.ts:205 `outcome === 'failed' ? []`). The spec is strong: 409 before the photo, same 409 with the photo,
  planned row / pod_evidence / credit_notes / outbox all untouched, and the loaded bill at the same stop still records 200.
  A 4xx from the sync-op path is already folded into `sync_errors` (sync.service.ts:175), so ADR 0007 holds.
- DOS-148 (app): `orders.get` is served by delivery-service ('orders' in contractKeys, OrdersModule mounted) and is ANY_MEMBER;
  `doorstepOrderBlock` reads the domain machine, refuses the camera and Record with one sentence, says nothing without an answer.
- DOS-063: the public `useSyncEngine().sync()` only, no engine edit, no local write of server rows. `useTable` re-runs on
  `engine.onTables` (offline react.tsx:453), and dues come from `retailer_outstanding_summary`, whose `updated_at` a receipt bumps
  (outstanding.ts:289), so one pull does refresh both the stop and "Owes".
- DOS-149: no toast on D4/D5; the code + number travel in the route and D3 resolves the sentence against its own `persistent`
  through `keepKey` (never-list #12 honoured); credit note by `item.creditNote.creditNoteNo`, id slice only as fallback.
- DOS-064: `onOpenPieces` → a Sheet with the kit's `parsePieces`, capped at the billed pieces; `qty.notOrdered` overridden at app
  level ('Nothing'), which the translator applies over the kit (`extra[key] ?? base[key]`, strings.ts:189).
- DOS-070: one rule (`geoProofLine`) decides the sentence and its absence, on the same `arrived_lat` gate `commit()` uses for the
  geo row; `word.geo` renamed in this app's own catalogue only. No platform location change.
- DOS-163: Segments → Group/ListRow rows, the pattern D3's failure sheet already uses (index.tsx:422-426); shared words untouched.

Tests: the four source guards would each fail on main (no `useSyncEngine`, `setToast` present, `<Segments`, `t('d4.podGeo')`),
and the pure-function tests cover the caps, the refusal matrix, the unknown-state and route-tamper cases. Nothing is weakened.

## Blockers — none.

## Minors (fix in the follow-up pass or the owning lane; none changes a contract)

1. index.tsx:96-101 — the comment says a reload is "not a second announcement"; it is: `handoffSeen` is per-mount and `done`/`doneNo`
   are never stripped, so a browser reload (or going back to an earlier stop instance in the stack) re-toasts. Strip with
   `router.setParams({ done: undefined, doneNo: undefined })` on dismiss and fix the comment. Harmless (4 s toast, feedback.tsx:409).
2. deliver.tsx:822-828 — the reason rows lose the radio semantics `Segments` gave (radiogroup/aria-checked); selection is colour
   and a 3 px bar only. D3 has the same gap. Fix belongs in the kit (ListRow `selected` accessibility state, native/list.tsx:142,
   web list.tsx) — lean-kit-overlays or with DOS-165 in lean-warehouse-pick, which the plan says must match DOS-163's choice.
3. deliveries.service.ts — the deliberate `packed + failed → accepted` path is pinned only by the app test
   (dos-148-not-on-the-van.test.ts:79); add one spec case so a later tightening cannot strand a crew on a bill it cannot clear.
4. deliver.tsx:257-266 — a full `orders.get` (lines, transitions, approvals) per D4 open, for every bill, every day, at docs/20
   scale, to read one `state`. `staleTime: 60_000` softens it. Better later: order state on the local `invoices` row through the
   manifest (the inventory note already names this), which also makes the D3 badge work offline.
5. Build report evidences vitest only (80/80, 37/37), not typecheck/lint. Static reading found every prop and export it uses
   (`bodyStrong`, `ListRowState 'selected'`, `disabledReason`, `helper`, `staleTime`) — integration CI must still run both.
6. lean-warehouse-pick's DOS-165 chips have NO preselected reason; D4 keeps 'Shop refused it' preselected (DOS-058). The planner
   asked the two to match — decide once there, not here.

## Conflicts

None with main (base == HEAD, merge-tree clean); no live branch/worktree (b2-apps, b2-dos167amd, b2-dos167r3, b2-dos171,
b2-dos172, b2-engine, b2-honesty, b2-money) touches these files. Later groups all wait on this one.

## Walks still owed (NO walk was run; the design asked for three)

- iOS iPhone 16 Pro (402 pt), `QA/tools/ios-drive.mjs labels`: DOS-163 — all three reason rects inside the line card, tap
  'Past its date' flips the caption; DOS-064 — the d4-pieces-sheet opens, 70 of 75 records, cap helper shows at 90.
- Pixel 7 (`-memory 3072`): DOS-149 — part-deliver Meghana and read the CN toast ON D3 with the new dues at once (DOS-063
  green in the same walk); DOS-148 — a bill added to a trip on the road shows the refusal before the camera; DOS-163 rows.
- Web 390×844 and desk: DOS-063 (stop reads 'Delivered', Owes drops with no reload), DOS-070 with geolocation denied (the
  line names the 10:40 am arrival or is absent), DOS-064 sheet, DOS-149 toast on D3 and the reload re-toast (minor 1).
Per STATE these merge as "MERGED, PROOF OWED, still OPEN" until the walks pass; queue them with the A.12 regression walks.

## Defects outside the group

- frontend/libs/offline/src/engine.ts:1095 — `sync()` returns silently when `this.pulling` is already true, so a screen's
  post-write pull (this group's DOS-063, and sales orders/[id].tsx:159, warehouse pick/[id].tsx:85) is dropped whenever the
  60 s poll or an upload tail is mid-flight; the screen then stays stale until the next poll. Fix in lean-libs-offline-boot:
  remember a `pullAgain` flag and run one more pull when the current one finishes. Small window, but it is exactly DOS-063's
  symptom coming back at random.
