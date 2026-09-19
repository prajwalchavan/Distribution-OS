# Honesty lane (DOS-178, DOS-179, DOS-180) — architect review 2 (Fable, 2026-09-20)

Branch `qa/b2-honesty` at `89e55eb`, ten commits over merge-base `254958a`; main has moved only in `QA/` since. Read the whole diff
(63 files), the design (`verdicts/DOS-175-180-design.md`) and the round-3 record in `QA/13-change-log.md` (`merge-reviews/honesty.md`
is not on disk — the workflow never wrote it; its content survives in the change log and the "address review" commits). In the lane
worktree, editing nothing, I ran `vitest run` on `@dos/offline` (4 files, 37 green incl. the jsdom `useRow` test), sales `src/lib`
(28), delivery `src/lib` (48), warehouse `src/lib` (12); `tsc --noEmit` on the four packages and `eslint` on every changed file, both
clean; `git status` clean. No service, browser, emulator or database was started — see Walks.

**Decision:** MERGE

## The four questions
1. **Every keep claim through `keepClaim`?** Yes, structurally. `keepClaim` (`offline/src/connection.ts:50`) is the one rule; each
   field app's `src/lib/keep.ts` is the only reader of a device-word key; the guard (`offline/src/dos-179-keep-claims.guard.test.ts`)
   scans all seven catalogues for "this/the phone|device|browser", forces a classification, and for `keep` demands a tab twin naming
   no device, a keep.ts pair, no `t('<key>'` anywhere under `app/` or `src/`, and no `word.` namespace (the `wordFor` hole that hid
   the D10 chip twice). My own re-sweep: no device words in screen literals outside comments; the kit catalogue holds only
   `connection.notKept*` and `map.unavailable`; `s6.queued` is "Waiting to send"; the leave body asks `keepClaim` in all three apps.
   The stated residual (words, not meaning) is real and acceptable: the guard fails closed on the words a claim is born with.
2. **DOS-180 bound to the order, including the render after the tap?** Yes. `orderOutcome` reads only the reply's `queued`, the
   row's `_pending`, `order_no` and `rowKnown`; `new.tsx` has no `local.online ? t('s3.placed` (guard); the pre-tap label keeps the
   radio, correctly. `useMutation` sets `data` and calls `onSuccess → setPlaced` in one synchronous continuation
   (`api-client/src/react/index.tsx:434-437`), so React batches them into ONE render: no frame has `placed` set and `data` unset.
   In that frame `useRow` answers `{loading: true}` for the new id (`answerFor`, derived in the render, not an effect) → "held",
   never "draft"; `react.test.tsx` records every frame. Ack → "Reached the office as a draft" (`queue.ts:57` writes a draft, no
   number); refusal → the tray's sentence.
3. **Never-list #12 on a memory store?** Holds on every screen traced: strip "· Not kept in this browser" on all eight branches
   (render test × three tri-states); S3 "Hold until there is a signal" / "Held in this tab only" + banner; S0, S5, S11, S12, the
   catalogue count; D1/D8 "held in this tab only", D8 "This tab holds ₹…, none of it saved"; D10 chip "In this tab only" and the
   hand-over dialog "marked handed over in this tab only … what lasts is the cashier's entry"; W5, X4. `null` says nothing in the
   strip and takes the tab words for offers (ruling 3 (ee)).
4. **`useRow` change break anything?** No: its only consumer on the lane tree is `new.tsx:260` (screens read rows via `useTable`,
   untouched); null id keeps `loading: false`, an id change now answers true — the correction itself.

DOS-178 as designed: `MONEY_TABLES` by table; `discard` refused at the engine (`KeptMoneyError`, table read from the op or `_sync_errors`
so an op-less pulled-back refusal is refused too); `handOver` → `kept`/`_pending='kept'`/`handed_over_at`; never re-mirrored; `rejected`
stays the outbox count so the badge (`_layout.tsx:427-434`) and leave sheet drop it while `heldMoney` keeps the file in `end()`;
`deviceMoney` drops it from D8; one non-destructive button; own section; `ALTER TABLE … ADD COLUMN` best-effort at open. docs/27 updated.

## Blockers — none.

## Minors (follow-up slice; none reaches a lie today)
- `offline/src/engine.ts:1595` `retry()` has no status guard: `outbox.retry(opId)` on a `kept` money op re-queues it, deletes its
  `_sync_errors` row (`handed_over_at` lost) and replays the stored refusal (S-73), putting the rupees back into D8. Unreachable
  (`trayActions` never offers retry on money). Fix after `if (op === null) return`: `if (op.status === 'kept' ||
  (isMoneyTable(op.table) && op.status === 'rejected')) throw new KeptMoneyError(op.table)` + one engine test.
- `delivery-app/app/attention.tsx:311-323`: a kept card with no op (`money === null`, pulled back after a reload) opens the
  hand-over Dialog with an EMPTY body. Fix: a third pair `handOverBodyUnknown` (+ tab twin) used in the `== null` arm.
- `sales-app/app/orders/new.tsx:268` `queued: place.data?.queued ?? false` leans toward "placed" when unknown (unreachable, Q2).
  Prefer `?? true`: unknown → held is the conservative half of #12.
- `warehouse-app/src/lib/keep.ts:28` `x4.tables`/`x4.tablesTab`: a classified keep pair nothing renders (verifier minor 1). Delete
  both keys and the `'x4.tables'` entry in the guard's `warehouse.keep`.
- `*/src/lib/leave.ts:122` `leaveButtons` uses `input.persistent === true` while the body asks `keepClaim` (verifier minor 2).
  Same truth; make it `keepClaim(input.persistent) === 'device'` and extend the guard's leave assertion.
- Wording: the tab twins say "tab" on every surface, so a phone's null window and a native memory fallback read "in this tab" under
  a strip saying "on this phone". Give `keepKey` a surface, as the kit's `keepSegment` has.
- `engine.ts:952` `sweepStores` counts `kept` rows as `pending` (reported as unsent work), and a file holding only handed-over money
  is kept for ever — by design (docs/27 §6); release needs the office half (design §5). A docs/22 register row, not a code defect.

## Conflicts
None. `git diff 254958a..main -- frontend` is empty; `qa/b2-money-delivery`, `qa/b2-engine`, `qa/b2-dos167amd` touch no frontend file;
`git merge-tree` onto `qa/b2-engine` is clean. Integrator: kit cross-app guards with `--force` (S-155); `pnpm install
--frozen-lockfile` (jsdom entered the catalogue and lockfile); add the docs/22 §11 as-built row — the lane updated docs/27 only.

## Walks (owed before DOS-178/179/180 close; proof-owed like DOS-168/169)
1. Web, memory store (ruling-3 rig, no OPFS): strip "· Not kept in this browser" on Beat, Shops, Orders, Me; S3 offline → "Hold
   until there is a signal" → "Held in this tab only" + banner; restore the signal, hold the screen: banner unchanged until the ack,
   then "Reached the office as a draft"; My orders "Not numbered yet · Waiting to send". Capture the first frame after the tap.
2. Web, OPFS store: online tap → "Order placed"; offline → "Saved on this phone"; no not-kept segment; no S-140 flash at sign-in.
3. Android delivery (Pixel 7, `-memory 3072`): cash receipt offline on an active trip (collect.tsx, not the DOS-181 button); settle
   the trip at the desk; reconnect → D10 card: office sentence, "₹… Cash from … · book no … · time", cashier line, ONLY "Handed to
   the cashier"; confirm → Handed-over section with time; D8 figure and shell badge drop it; sign out → file kept; sign in → still
   there. Then a UPI receipt: the "already in the account" line.
4. Android upgrade: a device file from the previous build (no `handed_over_at`) opened by this build — no error, tray works.
5. Web memory store, delivery: D10 chip, D1/D8 sentences and D8 "This tab holds ₹…" each screenshotted with the strip in frame.
6. iOS sanity boot of sales, delivery, warehouse on the merged tree (the unproven target).

## Defects outside the lane
None new with hard evidence; DOS-181 (deliver.tsx button dead on Android), DOS-182, DOS-183 stand as filed and sit on walk 3's path.
