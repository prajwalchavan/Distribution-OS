# DOS-167 ruling 3 — merge review (Opus 5 standing in for Fable, 2026-09-19)

Fable's usage limit was reached; this review is written as the architect would write it, and says so. Read-only:
`qa/b2-dos167r3` @ `b00c5fa` (5 commits, merge-base `c3b4ec1`, 31 files), ruling 3, Fable's own
`DOS-167-ruling-3-architect-review.md` (on main at `6f2614b`, AFTER this lane's base) and `expo-sqlite`'s bundled
`wa-sqlite/sqlite-api.js`. Nothing built, run, written or committed.

**Decision: MERGE.**

(aa)–(ee) are implemented as ruled; no backend, contract, kit, permission or migration file is touched; no test was
weakened (807 insertions, 2 deletions, both import lines); every red-before is recorded, and the two weak reds
((aa) on main, (cc)'s missing export) were each backed by a mutation check at HEAD reproducing the measured S-138
symptoms. Fable's amendments A1–A5 are NOT this lane's — main's own `dos167-amendments.js` schedules them as lane
`b2-dos167amd`; two are already satisfied here (see Conflicts).

**One correction to the verifier's third minor, as architect.** That the legacy destroy's `open_v2` races the
engine's `exec`/`query` does not leave (bb)'s rationale incomplete. In `sqlite-api.js` the module-global scratch
cell is crossed by an `await` in `open_v2` ONLY (`:573-580`); `sqlite3.statements` allocates its own `pzHead`
(`:784`) and `tmpPtr`'s other users are unreachable from expo-sqlite. Serialising OPENS is the complete fix for
that half, `maybeInitAsync` can only bite before `_sqlite3` is set (already done by the engine's own open), and
variant D — chain only, clean-ups still floating — passed 6/6 on Metro and 3/3 in production, a weaker shape than
what shipped. No defect.

## Blockers

None.

## Minors

1. `frontend/libs/offline/harness/App.tsx:274` — `{status.persistent ? null : (…)}` is the one un-threaded (ee) hop
   left in the repo: it prints the not-kept line while `persistent === null`, the exact S-140 shape. Dev harness
   only. Fix: `status.persistent !== false ? null : (…)`. Belongs to A1; hand it to `b2-dos167amd`.
2. `docs/27-offline-sync-client.md:40` — §2's fallback-reason list still omits `open timed out after 15s`; §14
   (`:342`) has it. Fable's note 3 asked for it in THIS lane's docs step. One clause.
3. `frontend/libs/offline/src/engine.ts:820` — (dd) wires `consoleSink` into release builds and this line's
   `stored` detail carries the PRIOR person's `userId`/`tenantId`/`role`. Opaque UUIDs, own device, devtools
   needed; no names, rows or dues. P4, Fable's own note — trim the detail in production, separately.
4. `frontend/libs/offline/src/engine.ts:948` (`sweepStores`) — pre-existing, and (cc)'s deadline adds a second way
   in: on web `openStore` never throws, so a sibling whose open failed or timed out answers a MEMORY store,
   `createSystemTables` succeeds on it, the count reads 0 and the sweep takes the destroy branch with
   `destroyed += 1`. Nothing real is deleted (`MemoryStore.destroy` resets its own db) so answer A holds, but the
   count lies and ruling (p)'s "logged, closed, skipped" never fires. S-row.
5. Two disclosed behaviour changes, merge knowingly. `react.tsx`: the clean-ups now need an engine AND an identity,
   so a signed-out mount runs neither the legacy destroy nor the interim sweep — conformant with (bb), a narrowing
   of ruling 1 (i). `engine.ts` `endOnce`: after a (cc) fallback the store is the memory one, so a clean "nothing
   waiting" sign-out destroys nothing and the person's on-disk file survives — right under answer A, recorded so
   it is not later read as a defect.
6. `docs/27` carries prettier reformatting of unrelated §1/§3/§7/§10/§14, burying the substantive diff; the three
   `leave-sheet.tsx` widenings sit outside (ee)'s file list, though typecheck required them. Do not respin.

## Conflicts

- **main: none.** `git merge-tree --write-tree main qa/b2-dos167r3` yields a clean tree; main advanced only in
  `QA/`, `.github/workflows/ci.yml` and `QA/tools/` (`6f2614b`, `46baeb7`, `98f9800`, `eb9a155`).
- **b2-money / b2-dos171 / b2-dos172: none.** They touch delivery and warehouse screens, `strings.ts` and their own
  specs; zero overlap with these 31 files, no `persistent` read in any diff. `b2-s108` is not ahead of main. Lean
  wave 3's `lean-libs-offline-boot` edits `react.tsx` and `engine.ts` and must rebase on this merge.
- **For `b2-dos167amd`:** branch from the merged main, and tell it **A2 is already done** (`bringUp`'s catch calls
  `releaseFile()` unconditionally) and **A5's assertions already exist** (`open-web.test.ts` asserts `closed: 1,
  destroyed: 0` at the deadline), so A5 reduces to the deadline budget. **A1 reduces to minor 1 plus the render
  tests**: no owner, manager, retailer or admin app consumes `persistent`, and `connectionStateFrom` never reads it.

## Walks still owed

- The whole ruling-3 re-proof list is NOT run — correctly; this lane was told not to start it. It gates the P0.
- **The distributor-switch leave path on web, watching the OPFS pool.** The one shape the 41-run diagnosis never
  covered: the chain serialises OPENS, not `deleteDatabaseAsync`, so the old file's destroy can overlap the new
  engine's `open_v2` on a different name.
- **An Android cold start on a full store against the new 15 s deadline** — `open.native.ts` gains this bound for
  the first time; confirm a slow-but-succeeding open is not routinely abandoned to memory (A5's budget).
- **After an induced (cc) fallback, that the memory line is visible on the screens a rep works on all day** in all
  three apps, not only beat and settings: the app now looks healthy while keeping nothing. Plus A3
  (`vfsInstances <= 1`, `initCREATES <= 1` in the promoted gate) and A4 (a second tab of the same person).

## Defects outside this branch

- Minors 4, 3 and 1 as S-rows. Still owed under `QA/`, as the builder reported: the (ff) upstream S-row against
  pinned `expo-sqlite` 57.0.2 and wa-sqlite's global `tmpPtr`; the demo-data item for a rep with two distributor
  memberships; promoting `reproof2/diagnose/diag.mjs` into `QA/tools/e2e/` with A3's assertions. `docs/22` §8 and
  §11 remain the main session's, per the ruling, then re-render and republish.
