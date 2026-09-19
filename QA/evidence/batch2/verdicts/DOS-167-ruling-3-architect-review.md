# DOS-167 ruling 3 — architect review (Fable, 2026-09-19)

**Verdict: SOUND WITH AMENDMENTS.**

The diagnosis of S-138 rests on executed evidence, not inference; the load-bearing fix (aa) is empirically
proven end to end; (bb)–(ee) are correct and actually answer S-139 and S-140 rather than defer them; nothing
contradicts docs/27, the charter or founder answer A. Five amendments below close coverage gaps the stand-in did
not name — each is binding on the build. Read-only review: no build, test, run or git write was done here; the
live worktree `b2-dos167r3` (a workflow is running in it) was read, never written.

---

## 1. Is the DIAGNOSIS of S-138 supported by the executed evidence?

Yes, at the level that decides the ruling. Every claim I accept has a file+line in
`QA/evidence/batch2/dos-167/reproof2/diagnose/`:

- **It is ours, triggered by concurrency of three opens.** `react.tsx` fires three effects on mount — the engine
  open (`:139`), the legacy `dos-sales.db` destroy (`:188-207`), the 199952b interim sweep (`:214-221`) — each
  reaching `openStore`. Control (delay 0): `results-diagnose.json` `instr-ctl-01..03` = 3/3 pass, one VFS,
  opens 148/193/361 ms apart. Slow (delay 600): `instr-d600-01`, `d600-01..03`, `vA/vB/vC` show the opens land
  2–3 ms apart and 0/3 pass. **Accepted, executed.**
- **The permanent damage.** Orphan pool files headed `0.<random>` fill the six-slot pool
  (`AccessHandlePoolVFS.js:25` `DEFAULT_CAPACITY = 6`; empty-name branch `:75` `Math.random()`); `d600-02`
  shows `cannotCreate:4`, `d600-03` `/dos-sales.db-wal`; the reload does not heal (`heal-01.json`
  `afterReload.healed=false`) and the next person is broken too (`next-person-01.json` `cannotCreate:6`).
  **Accepted, executed.**
- **Not a Metro artefact.** `prod-d600-01..03` (production `expo export`, COOP/COEP) 0/3; `prod-ctl-01` 1/1.
  **Accepted, executed.**
- **The fix works, the library fix alone does not.** `vC` (both clean-ups removed) 3/3; `vD` (product
  serialised, clean-ups kept) 6/6 across 600 ms and 1500 ms; `prodfix-d600-01..03` 3/3 in the production
  export; `vE` (library single-flight guard, product unchanged) 0/3; `vA`/`vB` (one clean-up removed) 0/3.
  **Accepted, executed** — and this is the load-bearing basis for (aa).

**One claim rests partly on inference, and it does not weaken the ruling.** The mechanistic prose in the "facts"
section fuses two DISTINCT failure modes into one causal sentence. `worker.ts:780` sets `_sqlite3` only after its
`await`, so racing opens build several `AccessHandlePoolVFS` over one OPFS directory (`warm-instr.json`:
`vfsInstances:3`, `pool:12`, at **delay 0**) — the multi-Module VFS-stomp mode. Separately,
`wa-sqlite/sqlite-api.js:34-35` holds one `tmpPtr` scratch cell that `open_v2` (`:573-580`) writes and reads
across an await — but that cell is per-Module, so it swaps filenames only for concurrent opens on ONE Module,
which is the `vE-trace.json` single-VFS mode where the 94-char interim then poisons the healthy connection. The
ruling attributes `jOpen zName=""` to the `tmpPtr` cell in a single breath; the executed traces show `zName=""`
in the multi-VFS run (`warm-instr`) and the interim-poison in the single-VFS run (`vE-trace`). This is imprecise,
not wrong: the serialisation fix removes ALL concurrency and so kills both modes at once, which is exactly what
`vC`/`vD`/`prodfix` prove empirically. The ruling stands; the prose over-tidies two mechanisms into one.

## 2. Is the ruled FIX correct and minimal, across the demanded cases?

- **The OPFS six-file pool and the 56-char ceiling:** held. Naming is unchanged from ruling 2 (s): `./` + 51 = 53
  ≤ 56 (`VFS.js:10` `mxPathname=64`, `SQLiteModule.ts:403` `defaultDatabaseDirectory='.'`). Under serialisation
  at most one real MAIN_DB (+WAL) is open at a time, so the pool never exceeds ~2–3 of its 6 slots; the ruling is
  right that raising `DEFAULT_CAPACITY` is NOT the fix ((cc).5) — the slots were lost to garbage names, not demand.
- **Cold / slow / production:** proven (`vD` 6/6, `prodfix` 3/3).
- **A browser that refuses OPFS:** `whyNoOpfs()` → memory before any import; the chain resolves instantly; (t)/(dd)
  make it honest. Held.
- **An upgrade from an earlier store:** ruling-2's 51-char file opens directly (no migration); the interim is swept
  on native only ((bb)); legacy `dos-sales.db` is destroyed once. Held.
- **Minimality:** (aa) is ~10 lines; (cc).2's in-memory re-run of `start()` is justified — the observed 240 s
  silence is `start()` rethrowing after a persistent store opened but `createSystemTables` threw on a corrupt file
  (`engine.ts:537` rethrows; `react.tsx:163` only logs; `this.store` stays null so `status().persistent` reads
  false and `ready` stays false forever). This is NOT redundant with `open.web.ts`'s open-failure fallback, which
  cannot catch post-open corruption. Accepted as minimal.

**Two cases the fix touches but the ruling under-specifies — Amendments 1 and 2.**

## 3. Can a person's unsent changes be lost, or seen by another person?

- **Loss:** No new vector. (cc).3 keeps an unreadable file (never destroyed) — answer A. On a real memory
  fallback (t)/(dd) withhold "keep", so nothing is dropped silently. The one residual is the timeout path
  ((cc).1): a slow-but-succeeding OPFS open abandoned at 15 s hands the caller memory while the real handle is
  closed — the file is intact on disk and recovers next launch, but only if the late handle is genuinely CLOSED
  and never destroyed. The ruling asserts this; it gives no test for it — Amendment 5.
- **Leak:** No new vector. Naming and `claimIdentity` (the cross-identity wipe) are untouched by ruling 3; each
  `openStore` returns a fresh store per name; memory fallbacks are per-engine. The one thing to flag: `consoleSink`
  ((dd)) is not `__DEV__`-gated and the existing `claimIdentity` wipe log carries `stored`/`wanted` user and
  tenant UUIDs, so on a shared browser the next person's devtools could read the prior person's opaque ids. Own-
  device, opaque UUIDs, no names or rows — a P3/P4 note, not a blocker; recorded here so it is not lost.

## 4. Are S-139 and S-140 answered, or deferred?

**Answered, both.** S-139: no app passes `onLog` today — `sales-app/app/_layout.tsx:306-315` mounts
`OfflineProvider` with no `onLog`; (dd)'s `consoleSink` over `console.warn` is lint-clean
(`libs/config/eslint/base.js:27` allows `warn`/`error`) and is wired into all three field apps. S-140: the flash
is `engine.ts:919` `persistent: this.store?.persistent ?? false` reading false while opening; (ee) widens to
`boolean | null` and gates the message on `=== false`. Both are real fixes, not deferrals. **But (ee) depends on
(cc):** widening to null hides the "not saved" line during open, which is only safe because (cc).2 removes the
permanent-null stuck state; shipped without (cc) it would MASK a stuck engine. Both are mandatory in one lane, so
the dependency holds — recorded so the build never splits them. And the widening is threaded incompletely —
Amendment 1.

## 5. Contradictions with docs/27, the charter, answer A

None material. (gg) retires (v) as a device walk correctly (under (y) the session clears before `end()`, so the
order screen is gone before a tap). One doc gap: (cc).1 introduces a new fallback reason (`open timed out after
15s`) but docs/27 §2's enumerated reason list is not updated — fold into the lane's docs step.

---

## Amendments (binding on the build)

### Amendment 1 — the `persistent: boolean | null` widening is threaded through EVERY hop, not only the endpoints (ee)

- **Rule:** widening `SyncStatus.persistent` to `boolean | null` (`types.ts:176`, `engine.ts:919`,
  `react.tsx` `IDLE.persistent`) forces the null through every consumer: `useLeaveSession`'s
  `LeaveSession.persistent` (`react.tsx:307`), `LeaveSteps`/`device.persistent` at `sales _layout.tsx`,
  `delivery _layout.tsx:552`, `warehouse _layout.tsx:517`, the `LeaveSheet` prop (`leave-sheet.tsx:27`),
  `leaveButtons`/`leaveSentence` inputs (`leave.ts:100-110`, `:74-89`), `local.ts:308`, and every read-only
  consumer (`connection.ts` / `connectionStateFrom`, and any `useSyncStatus().persistent` read in the owner,
  manager and retailer apps). Every site must treat null as "not resolved": leave.ts uses `!== true` (memory body
  AND keep button); every on-screen "not saved / held in memory" line renders only on `=== false`; the read-only
  apps show no persistence line while null.
- **Red-first test:** after widening `SyncStatus.persistent` to `boolean | null`, `cd frontend && pnpm typecheck`
  FAILS at each hop still typed `boolean`; it PASSES only once all are widened. Add a render test in each field
  app that while `status.persistent === null` (engine opening) the "not saved on this browser" / "Held in memory
  only" line is absent, and that on a real memory store (`=== false`) it is present.
- **Re-proof must show:** the 50 ms flash watch across every sign-in reports zero intervals of the not-kept line
  (web item 6), AND the memory variant still prints the line (web item 7), AND no read-only app (owner/manager/
  retailer web) shows a spurious "not saved" line during a cold open.

### Amendment 2 — the never-a-hang memory fallback releases the failed persistent file's hold (cc.2)

- **Rule:** when `start()` falls back to `createMemoryStore(...)` after a persistent store opened and a later step
  threw, it must release that persistent file's `holdFile` hold (`engine.ts` `releaseFile()`) before or as it runs
  the memory sequence, and the memory retry must not leave any hold on the persistent name. A file whose read
  failed is closed and left on disk — never destroyed (answer A).
- **Red-first test (`frontend/libs/offline/src/identity.test.ts`):** a store factory whose persistent open
  succeeds but whose first `createSystemTables`/`exec` throws "not a database"; `start()` must resolve running in
  memory (`status().store === 'memory'`, `ready === true`, the `offline: … running in memory` line logged), and a
  SECOND engine started on the SAME name (a next-launch simulation) must open within its deadline rather than
  block on a leaked hold. Red today: (cc).2 naively implemented keeps the persistent hold and the second start
  hangs / times out.
- **Re-proof must show:** web item 7's memory line fires on an induced post-open corruption, and a re-sign-in on
  the same profile afterwards opens a persistent store of its own (not memory).

### Amendment 3 — the permanent S-138 gate asserts at most one VFS construction and one WASM init per load

- **Rule:** when `reproof2/diagnose/diag.mjs` is promoted into `QA/tools/e2e/`, its pass condition must include
  `vfsInstances <= 1` and `initCREATES <= 1` per page load, in addition to the pool-header / no-orphan / no
  "not a database" / manifest+pull checks. The pool-header check alone can pass while a latent second VFS exists,
  and the concurrency mode is NOT delay-gated — `warm-instr.json` failed at **delay 0** with `vfsInstances:3`,
  `pool:12`.
- **Red-first:** run the promoted gate against pre-fix `199952b` (or a delay-600 baseline) — it reports
  `vfsInstances/initCREATES > 1` and FAILS; against the fixed tree it reports exactly 1 each and PASSES.
- **Re-proof must show:** every web run in the ruling's re-proof (items 1–3, cold / 600 ms / 1500 ms / production)
  records `vfsInstances === 1` and `initCREATES <= 1`, not merely one pool header.

### Amendment 4 — a second tab is proven honest and non-destructive (missing re-proof case)

- **Rule:** the S-138 fix must not let a second browser tab of the same signed-in person corrupt or evict the
  first tab's persistent OPFS file. The second tab, unable to acquire the exclusive access-pool, must fall to a
  memory store, say so ((t)/(dd)), and leave tab 1's file and its queue intact.
- **Red-first / proof:** this is a walk, not a unit test — add it to the web re-proof: with tab 1 signed in on a
  persistent store, open a second tab of the same app+person; assert tab 2 shows the memory line and never a
  keep-able sign-out, tab 1's OPFS header `/s…` is unchanged, and a queued order in tab 1 survives.
- **Re-proof must show:** the OPFS walk after the two-tab sequence lists exactly tab 1's `/s…` header and the five
  empty slots, no new orphan, and dos_qa holds tab 1's queued order once.

### Amendment 5 — the timeout path is tested to keep the file, not lose it (cc.1)

- **Rule:** on the 15 s open deadline the caller receives a memory store while the real open continues on the
  chain; a persistent handle that arrives late is CLOSED and the on-disk file is left intact — never destroyed
  (answer A). `OPEN_DEADLINE_MS` must be generous enough that a slow-but-succeeding OPFS open is not routinely
  abandoned to memory (OPFS opens are sub-second; confirm the budget-phone p99 is well under the deadline).
- **Red-first test (`open-web.test.ts` / `identity.test.ts`):** a `loadSqlite` whose `openExpoSqlite` resolves
  only after the deadline; assert `openStore` resolves a memory store at the deadline, the late real store's
  `close()` is called exactly once and its `destroy()` is NEVER called, and the chain advanced only when the real
  open settled (no two real opens overlap). Red today: no deadline exists, so the caller waits for the real open
  (or, with a naive deadline, the late handle is dropped without an explicit close, or destroyed).
- **Re-proof must show:** a web run with the expo-sqlite chunk held past 15 s ends in a memory store with the
  `offline: … running in memory` line and reason `open timed out after 15s`, and the persistent file (if one had
  existed with a queued order) is still present and recovers on the next normal load.

---

## Notes (not binding; recorded so they are not lost)

- The mechanistic prose in the ruling conflates the multi-Module VFS-stomp mode (`warm-instr`, delay 0) with the
  single-Module `tmpPtr` swap mode (`vE-trace`). Harmless — serialisation kills both — but the build's docs/27
  wording should not repeat the conflation.
- `consoleSink` is not `__DEV__`-gated and `claimIdentity`'s wipe log carries user/tenant UUIDs; on a shared
  browser the next person's devtools can read the prior person's opaque ids. P4 info-exposure; consider trimming
  identifiers from the production log detail.
- docs/27 §2's fallback-reason list must gain `open timed out after 15s` in the lane's docs step.
- (ee) must never ship without (cc): recorded above, both mandatory in the one lane.

Fable, architect
2026-09-19
