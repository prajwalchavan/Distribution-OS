# DOS-167 ruling-3 amendments A1..A5 — merge review (Fable, architect, 2026-09-19)

**Decision: MERGE.** Lane `qa/b2-dos167amd`, 7 commits c7a7124..38dae49, base 5d9c5c7 (ruling 3 already on main as ce3dc8c).
Worktree clean at 38dae49. Diff vs main: 10 files, +1350/-1; the ONLY production change is one JSX gate in the dev harness.
The production code each amendment demands was already merged with ruling 3; this lane proves it (red by reversal, green
restored) and closes the two real gaps I named (the un-threaded harness hop, the promoted gate's counter). I re-ran the
A3 verdict myself on scratchpad copies: `--selfcheck` SELFCHECK OK exit 0; `--verdict ctl-01.json` refused, exit 1.

## Per amendment

- **A1 — SATISFIED.** Source `types.ts:183` `persistent: boolean | null`; `engine.ts:978` `this.store === null ? null : …`;
  `react.tsx:311` IDLE null, `:360` `LeaveSession.persistent: boolean | null`, `:406` passes it through. Hops:
  `{sales,delivery,warehouse}-app/src/lib/leave.ts:38,84,108,112` (body on `=== false || === null`, keep only on `=== true`),
  `leave-sheet.tsx:27`, `_layout.tsx` device prop (sales :507, delivery :554, warehouse :519), `sales-app/src/lib/local.ts:293,311`.
  Screens gate on a RESOLVED value: `sales-app/app/index.tsx:234`, `delivery-app/app/{attention.tsx:79,settings.tsx:116}`,
  `warehouse-app/app/{pick/attention.tsx:64,settings.tsx:78}`, and the missed hop `libs/offline/harness/App.tsx:277` (was a plain
  truthiness read = the S-140 flash in the harness; fixed 040536f). Guards: `libs/offline/src/dos-167-persistent-null.guard.test.ts`
  + one per field app; `leave.test.ts` carries 5 null cases in each app. Owner/manager/retailer/admin never read `persistent` (vacuous).
  Reversal evidence accepted: consumer hops narrowed to `boolean` fail 4/11 typecheck tasks by name.
- **A2 — SATISFIED.** `engine.ts:590-604` bringUp's catch closes the failed store (`:600`), never destroys it, and `this.releaseFile()`
  at `:603` lets the `holdFile` hold go before `start()` re-runs in memory (`:452-483`, `brokenStore` set only for a persistent store).
  Test `identity.test.ts:570-687`: second engine on the same factory + name opens `sqlite-web` while the first runs in memory;
  `closes: 1, destroys: 0`. Reversal (delete `:603`) → `blocked`, accepted.
- **A3 — SATISFIED.** `QA/tools/e2e/dos-167-s138-verdict.mjs:56-63` adds `vfsInstances > 1`, `initCREATES > 1`, `not instrumented` and
  `VFS module not instrumented` refusals to the pass condition; `:31-45` counts distinct DOSDIAG lines (not worker-scoped ids);
  `dos-167-s138-instrument.mjs:83-87,111-118` stamps a per-worker tag into both ids; `dos-167-s138-web-store.mjs:55-131` self-checks
  RED warm-instr (3/3, refused by cause) vs GREEN vD-d600-1..3 (1/1) plus four synthetic counter shapes. Verified by my own run.
- **A4 — SATISFIED (unit); walk half-done.** `open.web.ts:85-90` `openStoreInner` turns the second holder's
  `NoModificationAllowedError` into `inMemory('open failed: …')` — announced, never a delete. Test `open-web.test.ts:317-400`:
  tab 2 `memory` with `wanted: 'sqlite-web'` + reason, tab 1 `held: [ENGINE]`, `queued: ['op-1']`, `deleted: []`. The ruling-3
  re-proof already walked tt-01..03 (tab 2 prints the memory line, tab 1's `/s…` header intact, no junk, tab 1 keeps syncing);
  the queued-order-once and no-keep-button halves remain for the proof stage.
- **A5 — SATISFIED.** `open.web.ts:100` `OPEN_DEADLINE_MS = 15_000`; `:107-135` the caller gets memory at the deadline while the chain
  waits for the real open, and a late handle takes `await store.close()` at `:128` — `destroy()` is unreachable on that path.
  Tests `open-web.test.ts:205-262` (closed 1, destroyed 0, chain advanced only after settle) and `:274-315` (250 ms open at the REAL
  deadline returns the file; headroom 10× the worst measured 1500 ms load). Reversals (100 ms deadline; drop the close) accepted.

## Loss / leak judgement
No vector for either. Nothing on this branch deletes a file: the only destroy paths are the legacy `dos-sales.db` (react.tsx:141)
and `end({keepQueue:false})`, both unchanged. A timed-out or unreadable file is closed and stays on disk; its queue goes first at the
next normal load (answer A, delayed not lost). Tab 2 / a second person on a held pool always lands in a per-engine memory store —
the pool VFS is per OPFS directory, so nobody's file is ever opened by another page. Store names and `claimIdentity` untouched.

## Blockers
None.

## Minors (S-rows, not this lane)
1. `open.web.ts:131-135` — `openStore`'s outer rejection branch is dead in production (`openStoreInner` never rejects; only a
   test-supplied `loadSqlite` that throws reaches it). Delete it or test it; its close-not-destroy promise rests on the late path only.
2. The A1 guards are per-file allowlists (`SCREENS`, e.g. sales guard :63): a NEW screen reading `persistent` is unguarded. Worth
   one repo-wide sweep test over `frontend/*-app/app/**` for `\.persistent(?!\s*(===|!==))` outside a gate.
3. `dos-167-s138-verdict.mjs:44,60` — `workers` reads 0 in every recorded GREEN run (main-thread line not captured by the old diag);
   the live gate captures DOSDIAG on the page, so expect `workers === 1` there. Not a third signal; do not cite it as one.
4. `types.ts:183` narrowed back to `boolean` would NOT fail typecheck at leave.ts / leave-sheet.tsx / local.ts (each declares its
   own union); those hops are held by the null tests and the guards, not by the compiler. Recorded so the claim is read correctly.
5. `consoleSink` (`libs/offline/src/log.ts:15`) is not `__DEV__`-gated and the `claimIdentity` wipe log (`engine.ts:809`) carries
   user/tenant UUIDs — P4 info-exposure on a shared browser's devtools, from my ruling-3 review, unchanged.

## Conflicts
None: main since 5d9c5c7 (dd6e0f5, b31bdd8, d4de132) touched only `QA/tools/batch2/workflows/*`; the lane's paths are disjoint
(`comm -12` of the two name lists is empty).

## Walks the amendments still require
- **Web, A3:** `dos-167-s138-instrument.mjs` then `dos-167-s138-web-store.mjs` at delay 0 / 600 / 1500 and on a production
  `expo export` built AFTER instrumenting (an uninstrumented export is refused, exit 1) — each `vfsInstances === 1`, `initCREATES <= 1`.
- **Web, A4:** tab 1 with a queued order → tab 2 same person: memory line, leave sheet WITHOUT "keep", tab 1 header unchanged
  (one `/s…`, five empty slots), tab 1 sends and dos_qa holds the order once.
- **Web, A5:** expo-sqlite chunk held > 15 s → memory with `open timed out after 15s`, OPFS file present, reload opens persistent
  with the queued change. **Web, A2:** post-open corruption → memory line, re-sign-in persistent. **Web, A1:** 50 ms flash watch 0
  intervals; memory variant prints; owner/manager/retailer cold open shows no line.
- **Android:** sales sanity; the delivery and warehouse KEEP runs ruling 3 required (never finished / never started) — Appium by
  resource-id. **iOS:** sanity boot of attention/settings (native screens carry the tri-state gates too).

Fable, architect — 2026-09-19
