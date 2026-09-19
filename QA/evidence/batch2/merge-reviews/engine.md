# Merge review: lane engine (DOS-183), branch qa/b2-engine

Fable, architect, 2026-09-19. Read-only review of bab0796 (engine + tests) and 2543378 (docs/27) against `verdicts/DOS-183-design.md`, the DOS-183 finding and founder answer A (2026-09-14: unsent changes stay on that device for that person and go FIRST at their next sign-in). Lens: the three rules, the founder's clause on every path into a session, and whether anything is sent twice or lost.

**Decision:** MERGE

What I ran, not only read: the lane's suite (`pnpm --filter @dos/offline test`: 6 files, 82 passed), prettier on the five files (clean), `tsc --noEmit` for @dos/offline (clean), and the new test file against **main's** `engine.ts` in a scratch copy of the package (lane test-support, main engine): 4 red with exactly the messages the build report quotes — `['manifest','pull']`, `['manifest','pull','upload']`, `[]` for the booted-offline hint, `[]` for the named flush step — and the guard test green. The tests fail without the fix and for the reason the finding measured.

The fix is at the cause. R1 (`engine.ts:486, :504-509`): `start()` now runs `drain('start')` after `bringUp`'s `sending→queued` revert, so the flush sees a crash's rows; `flush({pullAfter:false})` then `sync(reason)` gives `upload → manifest → pull` with the file's own cursor. R2 (`:1042-1053`): `believed = radioOn === true && reachable` decides on what the engine knew; `navigator.onLine` is no longer consulted on a hint; the retry timer is cleared so the reconnect is the retry. R3 (`:1448-1450`): `link = flushChain.then(run, run); flushChain = link.catch(() => undefined); return link` — the caller sees the rejection, the chain never carries it. `flushInternal :1465` skips its own after-upload pull only for the drain. The poll tick (`:1932`) drains before it pulls. `claim`/`settle`/`release`, `claimIdentity` (before any flush), `end()`'s `settled()` and `dropReadSet` are untouched, so nothing new deletes an outbox row and a foreign queue is still wiped unread before the first upload.

"Goes first" on every path into a session: a file kept by `end()` (manifest null → stale → upload, manifest, drop, snapshot; identity.test :1371/:1629), a file left by `stop()`, a crash, a closed tab, a 401 that ended the session by itself, a reload while signed in, and a distributor switch (the provider's `idKey` change is a `stop()` and a fresh `start()` over the other file) all enter through the one `start()`. The reconnect covers a web page that booted in a dead spot. The two paths where the clause is vacuous are by earlier rulings: the memory fallback (ruling 3 (cc) — the file could not be opened and is left alone, announced on the strip) and a second OPFS tab (memory store, empty outbox).

Sent twice / lost: the chain serialises every flush; `claim` marks `sending` before the request; the reconnect clears the retry timer and a timer that fires under a drain queues behind it and finds nothing queued; a lost reply replays by `opId` (`FakeServer.applied` stays 1 in all five tests). No path added by this lane deletes an outbox row. Nothing is lost.

## Blockers

None.

## Minors

1. **A radio-back hint inside the open window flushes with no shapes.** `this.started` is true from the first line of `start()`, and between `this.store = held` (`engine.ts:584`) and `ready = true` (`:591`) `shapes` is still empty. An `online` event landing there (web, `radioOn` null → not believed) runs `drain('reconnect')`: `claim` skips `setPending` (no shape), the upload lands, `settle` skips it again, and the local row keeps `_pending = 'queued'`, which `pendingKeys` (`:1280`) then protects from every pull — a stale "waiting" chip on an order that was sent, until a re-snapshot or a new write on that row. On main the hint returned early (`navigator.onLine`), so the window is new. Fix: in `flush()`'s `run` (`:1435`) `if (store === null || !this.ready) return`. Window is a few store awaits; nothing is lost or applied twice.
2. **A thrown `claim` on the timer path is unhandled and not re-armed.** `scheduleRetry` (`:1914`), `enqueueMany` (`:1372`) and `retry` (`:1636`) call `void this.flush()`; with R3 the rejection now reaches nobody (an `unhandledrejection` in the browser, a LogBox warning in RN dev) and `scheduleRetry` is not re-armed because the throw precedes `flushInternal`'s try. The poll's drain owns the queue within 60 s. Main was worse (the chain died for the tab). Fix: `void this.flush().catch((e) => this.note(e, 'flush(retry)'))` on the three sites.
3. The strip never sees `flush(start): …` — `note()` sets `lastError`, the sync two lines later clears it (`:1092`). Named in `onLog` only, as deviation 4 says. Accepted; ConnectionStrip shows "N waiting" honestly either way.
4. The first `setNetworkHint(true)` an app ever gives after `start()` always drains (`radioOn` null). Web gives none at boot; NetInfo's initial emission (DOS-068) will cost one manifest+pull per launch unless that wiring skips its first event. Carry to DOS-068.
5. docs/22 §8 register row and §11 change-log line for DOS-183 are the main session's (the design says so); docs/27 §4/§5/§10/§12/§13/§14 match the code line for line.
6. Cosmetic: a `stale` rejection inside the drain's flush runs `sync('stale-rejection')` (`:1599`) and the drain's own `sync` then runs a second manifest+pull. Pre-existing shape, one extra pull.

## Conflicts

- **main:** merge base is main 8f9f5c5 = main today; fast-forward, nothing to rebase.
- **qa/b2-honesty (9 commits, unmerged):** also edits `engine.ts` (pullErrors, `setPending` types, `discard`, hand-over), `identity.test.ts` and docs/27. `git merge-tree --write-tree qa/b2-engine qa/b2-honesty` is clean (e57cf9e, exit 0) and its hunks never touch `start`, `flush`, `setNetworkHint` or the poll. Whichever merges second: re-run `pnpm --filter @dos/offline test` and `prettier --check docs/27-offline-sync-client.md` (this lane re-flowed the §14 table).
- Other unmerged lanes (money-delivery, 14 commits) share no file.

## Walks (owed before DOS-183 closes; none run here, and this lane could not)

1. **Browser re-proof, the design's ORDER decision** — runs B and C of the finding on dos_qa, headed Chromium, `QA/evidence/batch2/dos-181-183/` (empty today). PASS = `POST /sync/upload` request start before that page load's first `GET /sync/manifest` and `/sync/pull` in the network log's milliseconds; on the booted-offline page the upload within 2 s of the `online` event, with no tap; the order in `dos_qa` exactly once (one `sync_ops` row, one `sales_orders` row).
2. **Sign-out keep → same person signs in (web)** — the founder's literal clause through `end()`: upload before manifest, then the re-snapshot; the queued order visible as sent, the refused one still in Needs attention.
3. **Pixel 7 (expo-sqlite)** — kill the sales app with a queued order (not sign-out), relaunch: upload precedes the pull (service log or `sync_ops.created_at` against the pull's `since`). The native start path was never driven; DOS-068 means the reconnect rule has no caller there yet.
4. **Colleague signs in over a kept file** — nothing of the first person's goes under the second's token (claim precedes the new start flush; identity.test 'a colleague signs in' is the unit form).
5. Re-judge DOS-167 (ruled NOT CLOSED on this clause) once 1–3 pass.

## Defects outside the lane

- `engine.ts:1138` — `applyManifest`'s stale-branch `flushInternal(store)` runs OFF the flush chain, so it can race the chain's own `claim` (both SELECT `queued` before either UPDATE) and put the same `opId` in two upload calls; the server replays, `settle` runs twice idempotently, so no double apply — wire noise only. Do not route it through `flush()` naively: the chain head's after-upload sync → applyManifest → `flush()` would wait on itself. Skip the stale flush when a flush is on the chain (a `flushing` flag). P3, pre-existing.
- DOS-068 — no NetInfo on native: a rep leaving a dead spot on the phone waits for the backoff timer (1→60 s) or the poll; the reconnect rule of this lane is web-only until it is wired. Not new.
