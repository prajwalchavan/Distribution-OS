# DOS-167 — architect ruling 3 (Opus 5 standing in for Fable, 2026-09-19)

Fable's usage limit was reached; this session rules as the architect would, and says so. Binding amendments (aa)–(gg)
to the design, ruling 1 and ruling 2 with addenda (x), (y), (z), on the re-proof of `bafb7b5` (judge: OPEN — Android
delivery/warehouse and iOS sales/delivery/warehouse PROVEN; S-138 P1, S-139 and S-140 open). Read: the design, ruling 1,
ruling 2 and its addenda, S-138/139/140 in `QA/findings/12-batch2-new-findings.md`, the three prover returns and the
judge, and the executed diagnosis (41 browser runs, `QA/evidence/batch2/dos-167/reproof2/diagnose/results-diagnose.json`).
Founder answer A (2026-09-13) governs: nothing unsent is ever thrown away, and a phone that cannot keep says so.
Nothing was built, run or committed for this ruling.

## The facts this ruling rests on (executed, not inferred)

- S-138 is OURS. On first mount `frontend/libs/offline/src/react.tsx` opens THREE different web databases at once —
  the engine's store, the legacy `dos-sales.db` destroy (~:181), the 199952b interim sweep (~:213). Control: the three
  opens land 148–361 ms apart and one `AccessHandlePoolVFS` is built (3/3 pass). With 600 ms on the expo-sqlite chunk
  they land 2–3 ms apart: 3 WASM modules, 3 VFS instances, 12 pool files, `SQLiteError: not a database` (0/3 pass).
- The library halves: `expo-sqlite/web/worker.ts` `maybeInitAsync()` sets `_sqlite3` only after its first `await`;
  `wa-sqlite/sqlite-api.js:34` keeps ONE module-global scratch cell that `open_v2` writes and reads across an `await`,
  so concurrent calls swap filenames — hence `jOpen zName=""` → `Math.random()` orphans and the truncated header.
- It is NOT a Metro artefact: the production `expo export` build, served with COOP/COEP, failed 0/3 at 600 ms and
  passed 1/1 without. On the hosted site the chunk and the worker are separate requests, so a weak connection, a cold
  CDN edge or the first load after a deploy loses the offline store for that browser profile.
- The damage is permanent for that profile: the orphans carry `MAIN_DB|CREATE|READWRITE`, so the VFS never reclaims
  them; capacity is 6 and expo-sqlite never raises it; a reload does not heal (`healed=false`), and the NEXT person to
  sign in gets `cannot create file` too. A fresh profile is clean; clearing site data is the only user-side recovery.
- Serialising the product fixes it: variant D (every web open through one chain) 6/6 on Metro and 3/3 in production.
  Fixing the library alone does NOT (variant E 0/3): the 94-character interim name still fails `sqlite3_open_v2` and
  poisons both healthy connections. Removing one clean-up does not (A and B 0/3); removing both does (C 3/3).

## (aa) ONE WEB OPEN AT A TIME — mandatory (the load-bearing fix)

`frontend/libs/offline/src/store/open.web.ts`: the present body becomes `openStoreInner`, and every `openStore` call
goes through ONE module-level promise chain, so a second open waits for the first to settle — success or failure —
before it touches `expo-sqlite`. A rejection must not break the chain. `open.native.ts` is untouched (each
`openDatabaseAsync` there is its own native handle). `probeStoreKind()` stays outside the chain: it opens nothing.
The chain also covers the sweeps' opens, which is why `sweepStores`' per-file `holdFile` is not enough — that
serialises one NAME, and this bug is three different names.
The seam, so the rule is testable in Node without mocking the bare specifier: `openStore(name, deps?: { loadSqlite?:
() => Promise<ExpoSqliteLike | null>; timeoutMs?: number })`. The second parameter is optional, so `openStore` is still
a `StoreFactory`.

## (bb) THE CLEAN-UPS GO AFTER THE STORE, IN ORDER, AND THE 199952b SWEEP NEVER RUNS ON WEB — mandatory

`frontend/libs/offline/src/react.tsx`. The two floating effects become ONE, and one exported pure function so it can
be tested in Node: `runStartupCleanups({ storeFactory, storePrefix, identity, storeKind, onLog })` runs legacy →
interim, each awaited before the next. The effect awaits the engine's own open first (`await engine.waiting()`, which
awaits `opening`), then calls it once per identity per mount. The rep's own data is opened first, which also shortens
the window behind S-140.

- The 199952b sweep runs ONLY when `storeKind === 'sqlite-native'`. `'./' + interimStoreName(...)` is 94 characters
  against wa-sqlite's 64-character path budget; ruling 2 (s) already records that no browser ever created such a file,
  and every executed trace failed its `sqlite3_open_v2`. On web it can only ever fail, and its failure is what poisons
  the healthy connections. Keep it on native, where those files exist.
- The legacy `<prefix>.db` destroy is skipped on a memory store and keeps its `legacy === databaseName` guard.
- The leave flow's order — local sign-out (y) → `end()` → sibling sweep → drafts → background revoke — is now
  load-bearing on web and must stay sequential: never start the sweep beside `end()`.

## (cc) A STORE THAT WILL NOT OPEN IS ANNOUNCED, BOUNDED, AND NEVER A HANG — mandatory

The re-proof's real harm was not the corruption but the silence: no `/sync` for 240 s, "Still loading the beat",
Shops 0, and ruling (t)'s fallback never firing, because `start()` rethrows and the engine stays `started` with
`ready: false` for ever.

1. BOUNDED. `open.web.ts` and `open.native.ts` bound the whole open at `OPEN_DEADLINE_MS = 15_000`. On the deadline the
   caller gets `createMemoryStore({ wanted, reason: 'open timed out after 15s' })`; the chain still waits for the real
   open, and a handle that arrives late is CLOSED — never destroyed.
2. NEVER A HANG. In `engine.ts` `start()`'s catch (~:537): a failure AFTER a persistent store was opened
   (`createSystemTables`, `claimIdentity`, `restoreManifest`) closes that store, releases its hold, logs
   `offline: the device store could not be used; running in memory` with the error, and runs the SAME start sequence
   once more on `createMemoryStore({ wanted: kind, reason })`. Exactly one fallback; a second failure throws as today.
   The app therefore still signs in, still syncs online, and still says what it cannot keep.
3. NEVER THROWN AWAY. A file we failed to read is never destroyed (answer A). It is closed and left alone.
4. SAID OUT LOUD. `storeNote` carries the reason, `lastError` gets a sentence for the strip, and the existing screen
   lines (`s0.notPersisted`, `tray.storeMemory`, `x4.storeMemory`) already fire on a memory store — no new strings.
5. NOTHING MAY EXHAUST THE POOL. Startup issues exactly ONE web open in the steady state (aa + bb). Raising
   `DEFAULT_CAPACITY` is explicitly NOT the fix: the slots are lost to garbage-named files, not to real demand.

## (dd) S-139 — EVERY FIELD APP PASSES `onLog`, WITH THE SINK DECIDED — mandatory

New `frontend/libs/offline/src/log.ts`: `export function consoleSink(line: string, detail?: unknown): void`, writing
through `console.warn` (the only console level `libs/config/eslint/base.js` allows in a library), exported from
`shared.ts` so both entry points carry it. The sales, delivery and warehouse `app/_layout.tsx` pass
`onLog={consoleSink}` to `<OfflineProvider>`. Not gated on `__DEV__`: these lines are what a support call and a QA
gate read, they are a handful per session, and their absence is why this took a gate to find.

## (ee) S-140 — "WILL NOT KEEP" IS NEVER SAID BEFORE THE OPEN RESOLVES — mandatory

`SyncStatus.persistent` becomes `boolean | null`: null means the store has not resolved yet (or there is no engine).
`engine.ts:919` → `this.store === null ? null : this.store.persistent`; `react.tsx`'s `IDLE.persistent` → null.
Consumers: sales `app/index.tsx:233` shows `s0.notPersisted` only on `=== false`; the delivery and warehouse settings
and attention meta lines are omitted while null; `sales-app/src/lib/local.ts:308` widens the field. In all three
`src/lib/leave.ts` null is treated exactly as false — `input.persistent !== true` for the memory body AND for the keep
button — so a sheet never promises a keep it cannot make and never says "they stay on this phone" without a keep.
A real memory store still reports false and still says it.

## (ff) UPSTREAM — an S-row, not our fix — optional

`expo-sqlite`'s `maybeInitAsync()` and `wa-sqlite`'s single global `tmpPtr` are genuine library defects. A
`pnpm patch expo-sqlite` single-flight guard plus an upstream issue is worth doing as defence in depth, separately.
It must never be the fix: with the guard applied and the product unchanged the run still failed 0/3.

## (gg) THE RE-PROOF GAPS — what is required now

- **(v), the refusal sentence through the UI: RETIRED as a device walk.** (y) clears the session before `end()`, so the
  order screen is gone before a person can tap — the sentence is now a last-resort fallback for a write already
  dispatched, not a screen anyone reaches. It stays proven by the two unit tests (offline refusal, api-client mapping).
  docs/27 §14 gains one line saying so. Not a blocker.
- **The two-distributor rep: REQUIRED, and the prover MAY create one on `dos_qa` through the product's own API.**
  Sign in as the SECOND distributor's owner and `POST /tenancy/staff` with the existing rep's phone and userId — the
  contract reuses the user by phone — then change the temporary password through the product's own screen. Never SQL,
  never the `dos` pilot database; record the ids and the calls. If that route does not yield a second membership, the
  sibling sweep and the switch path stay NOT TESTED and it becomes an S-row plus a demo-data item for the queued
  backend slice (the seed owes us a rep at two distributors).
- **(y) under a crash: REQUIRED, proven by an induced kill on web.** (x) removed the native crash, so waiting for one
  is not a test. Stall `/sync/**`, tap keep, and close/reload the context inside `end()`: the reopened page must show
  the sign-in form. Android keeps a best-effort `am force-stop` attempt; it does not block.
- **The full frontend gate after the (z) commits: REQUIRED NOW, once, at integration** — `cd frontend && pnpm lint &&
  pnpm typecheck && pnpm test && pnpm build && pnpm format:check` on the merged tree, with the log kept as evidence.
  No backend change, so no `pnpm smoke` and no README regeneration.
- **(u) kept drafts: REQUIRED on Android sales and on web** (the two storage backends), not on iOS.
- **The distributor-switch leave path: REQUIRED on web**, gated on the rep above.

## The re-proof (only these close the P0)

WEB (sales, dos_qa). (1) Three cold-Metro first loads, each after a Metro restart. (2) Three runs at 600 ms and three
at 1500 ms added to the expo-sqlite chunk and worker. (3) The SAME two at (2) against a PRODUCTION `expo export`
served with COOP/COEP — this is where the bug was reproduced and it is what a rep loads. Every run must show: one pool
header `/s…` and five empty slots, no `0.<random>`, no `-wal` orphan, no `not a database`, no `cannot create file`,
one manifest, a pull, and the not-persisted line gone. (4) The next person signs in on the SAME profile after (2) and
gets a persistent store of their own. (5) V5A–V5C as ruling 2 lists them. (6) The 50 ms flash watch across every
sign-in: zero intervals. (7) The memory variant: `offline: no persistent store; running in memory` now in the console.
(8) (y)'s induced kill inside `end()`. (9) (u) kept drafts. (10) The two-distributor rep: sibling sweep and "Switch
anyway". Promote `reproof2/diagnose/diag.mjs` into `QA/tools/e2e/` as the permanent S-138 gate.
ANDROID (Pixel_7_API_36, `-memory 3072`). Sales: the long-name upgrade with one queued op, now expecting
`offline: kept the store from before ruling 2` in logcat; (u) kept drafts across a keep sign-out, present for the same
rep and absent for another; a best-effort force-stop inside `end()`. Delivery and warehouse: one keep each, no crash,
op sent once.
iOS (simctl + ios-drive.mjs, never the simulator panel). A short sanity run only, because shared code changed: sales
sign-in → sign-out → second person (one `[sdw][0-9a-z]{50}` file per person, no leak) and one keep path.

## Lane, order, hand-offs

One lane over main, test-first, (aa) → (bb) → (cc) → (dd) → (ee) → docs/27, then the full frontend gate, then the
re-proof, then merge review. Frontend only: no backend, contract, kit or migration change. docs/22 for the main
session, §8: "2026-09-19 — a browser opens the phone's offline copy one at a time and only after the person's own
file is open, because two at once destroyed it; a copy that cannot be opened is said out loud and the app carries on
without it, and nothing unreadable is ever deleted." Plus §11.
