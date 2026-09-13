# DOS-167 ruling 2 — merge review (Opus standing in for Fable, 2026-09-14)

Branch `qa/b2-dos167r2`: 10 commits (dcbd1c8..c1ce0a7) on 1d8a964, 36 files (offline, api-client, the sales, delivery and warehouse leave flows, docs/27). Read-only review of ruling 2, addenda (x) and (y), the full diff, the branch's engine.ts, react.tsx, client.ts and session.ts, the backend logout, the builder's report and the verifier's verdict. Nothing was built, run or walked here.

**Decision:** MERGE AFTER FIXES. There is no code blocker, but the ruling's own frontend gate was never run and must be green before merge. The P0 (S-130) stays open until every walk below passes.

## Blockers

1. **The ruling 2 gate was never run.** Ruling 2 orders `cd frontend && pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm format` before the re-proof; the lane typechecked and linted only five packages, and `expo export` has never bundled the BigInt code in `frontend/libs/offline/src/engine.ts:98-134` (`0n` literals, `BigInt(…).toString(36)`) for web or Hermes. Fix, in the worktree: `git merge main` (clean, see Conflicts); then in `frontend/` run `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm format:check`; commit any prettier drift. Anything red means no merge.

## Lenses, read on the branch code

- **LEAK: closed.**
  - The name `<app><user><distributor>` (engine.ts:92-134) takes only canonical UUIDs, lower-cased and fixed-width base 36, so it is injective. An unknown prefix gets no store, never a shared file. Only the three field apps pass a `storePrefix`, and seed ids (`seed-demo/ids.ts`, `uuidv7`) are canonical UUIDs, so no app loses its engine. `parseStoreName` has no runtime caller.
  - The interim sweep (react.tsx:213-221) opens only the signed-in person's own 199952b name.
  - Sign-out order: `signOutOnDevice` (client.ts:326) clears the session, then calls `leave(stored)` in the same turn. `endOnce` sets `ended` before its first await (engine.ts:645), so the provider's cleanup `stop()` returns at :547 and cannot close the file under `end()`; reads answer empty (`readsOpen`, :1714).
  - Late answers: the generation guard (client.ts:193-209, :370) drops and revokes a refresh or switch pair that arrives for an ended session. Backend `logout` revokes by token hash only (auth.service.ts:322-336) and `switchTenant` creates a new row, so no revoke can end the next person's session. `signIn` waits for the leaving (:294); a same-name open waits for the file's previous holder (engine.ts:455-461); the sweep skips held files.
- **LOSS: closed in the leave flow.**
  - `enqueueMany` (engine.ts:1233) gates synchronously and validates every input before any write, then writes one transaction in call order with one count, one emit and one flush. Sales `queue.ts` is its only caller.
  - An upload refused with 401 under an ended session is released back to `queued` (:1372), counted, and the file is kept.
  - A kept file keeps its drafts (sales leave.ts:210-219); the sweep runs on every sign-out and deletes only files with nothing unsent. On a memory store `leaveButtons` never offers "keep" or "Switch anyway", so the sign-out waits. Delivery and warehouse `leave.ts` / `leave-sheet.tsx` differ only in nouns.
- **PLATFORM:** the web path is `./` + 51 = 53, within 56. A memory fallback carries its reason, one log line and `storeNote`. The adapter refuses calls once close has begun and calls `closeAsync` once; HeldStore drains before close, and destroy runs only after close (engine.ts:313-372, :662-683). NOT proven: Hermes BigInt, and SecureStore write order against the sign-out delete (walks below).
- **Ruling followed.** (s) to (w), (x) rules 1-4 and (y) rules 1-4 are in the code; (y) rule 5 has a pre-existing hole in the delivery and warehouse Settings screens (Defects outside, item 1). Accepted deviations: the `signOutOnDevice(leave)` shape, the file holds, the generation counter and the sign-in wait; each closes a race the review round proved, and none contradicts the ruling. docs/27 text beyond the named sections is accurate.

## Minors

1. **Unbounded sign-in wait** (client.ts:294). A hung native close holds every sign-in on that phone until restart, with only a spinner. The file holds already protect the same person's file, and the sweep and `forgetDrafts` are keyed to the person leaving, so a bounded wait (about 25 s, then proceed) is safe.
2. **Drafts forgotten while the file survives** (sales leave.ts:210-212). If `end()` throws, `kept` falls back to `keepQueue`, and engine.ts:665 answers `kept:false` when `stop()` already nulled the store though the file lives on. Matches the ruling's formula and `run` makes the race rare; the safe fix is `kept = true` on a throw and on a store `stop()` closed.
3. **docs/27 wording.** At :236 the colon hangs the one-tap clause off the generation sentence; reword. At :211 `useOutbox()` still omits `enqueueMany`.
4. **Rejected close is cached** (store/expo-sqlite.ts `close()`): a rejected `closeAsync` stays in `closing`, and `destroy` rethrows it unless it means "already gone". Harmless today.
5. **Pre-existing, unchanged** (engine.ts:1328-1335, :1376): `flushChain` stays rejected after a store error, and `scheduleRetry` can re-arm after `end()`. Harmless, because `flushInternal` checks `started`.
6. **Interim sweep on the web** (react.tsx:218): one doomed wasm open per new identity. Harmless per the ruling; confirm in V5A that any `sqlite3_open_v2` console noise is not misread as the engine's store failing.

## Conflicts

- **main: none.** `main` differs from the merge base only in QA/STATE.md, which the branch does not touch.
- **lean-delivery-door** (not built yet) owns delivery `_layout.tsx`, delivery `strings.ts` and `react.tsx`, all rewritten here. Branch it from main after this merge and keep Chrome's `signOutOnDevice` prop, `persistent` on LeaveSheet and `leave.bodyMemory`. Its `useSyncEngine().sync()` does nothing once `end()` has begun (engine.ts:972).
- **lean-libs-offline-boot** (not built yet) owns engine.ts, react.tsx, client.ts, session.ts, errors.ts, docs/27, the three `_layout.tsx` files and warehouse `settings.tsx`. On rebase:
  - DOS-046's `retry()` (engine.ts:1499) keeps `requireStore()` and `inHand`. `systemSchema` stays out of `dropReadSet`'s keys (:599-607) and `CLEARED_FOR_ANOTHER_IDENTITY` (:167); its ALTER also runs in `sweepStores` via `createSystemTables` (:859), so it must be idempotent.
  - DOS-089 adds `!hydrating` at sales `_layout.tsx:255`, and any proactive refresh goes through `refreshNow` so the generation guard applies. DOS-068's NetInfo hint stays behind the started/ended gates.
- **DOS-168..172 designs** already rebase after ruling 2 (the delivery strings d6 block, a docs/27 §14 row, `useSyncEngine().sync`). No overlap.
- **The web proof script** `QA/tools/e2e/s-098-shared-device.mjs:56` still builds the 199952b name. Before the web re-proof, `storeFacts` must match `/^[sdw][0-9a-z]{50}$/` and decode both ids (main session; QA-owned).

## Walks (the P0 closes only when all pass; the gate comes first)

- **Web, persistent store:** V5A-V5E with the new `storeFacts`, plus the memory variant, as ruling 2 lists. If dos_qa has a rep at more than one distributor, add their sign-out: the sibling sweep creates and deletes OPFS pool files, and the next open must stay persistent.
- **Android sales, steps 1-6:** `files/SQLite` holds only `s…`, with no `-wal`/`-shm` left beside a deleted name; on the first run check `typeof BigInt` and that Rahul's name is byte-equal to `s80j3azqcg6our25a35rhwbg7r03guzv9zghwmmy1imsvb8cmft`; run the long-name upgrade with an empty file and with one queued op.
- **Android delivery keep ×3 and warehouse keep ×1,** office unreachable, outbox retrying. Pass: no `am_crash` or `Fatal signal`, each relaunch shows the sign-in form, each op is sent once.
- **iOS sales keep ×3** with sales-service stopped. Pass: no new `.ips`, each relaunch shows the sign-in form, ops sent once. Also "Send now" while online.
- **A refresh in flight at the tap:** let the access token expire, tap "Sign out, keep here", relaunch. Pass: the sign-in form shows and no token is in SecureStore or localStorage.
- **SecureStore ordering (Android):** force a token refresh, tap keep within 100 ms, `am force-stop` during `end()`. Pass: the relaunch shows the sign-in form.
- **Fast re-sign-in:** the same person, and separately another person, signs in while `end()` waits on a page in flight. Pass: the sign-in waits, the kept op goes once, and the other person sees none of the first person's data.
- **S-126 and S-127:** the checks listed in addendum (x).

## Defects outside the fix (unfiled)

1. **The Settings sign-out bypasses the leave flow.** `frontend/delivery-app/app/settings.tsx:285` and `frontend/warehouse-app/app/settings.tsx:165` call plain `useSession().signOut()`: no sheet, no `end()`, the read set stays on the phone, the sibling sweep is skipped, and the session is cleared only after the server revoke (up to 20 s). On a browser memory store it throws away queued deliveries and picks, against answer A and ruling (t). Pre-existing (2f8a5a5, 335a11c). File as P1 and fix before DOS-167 is declared closed: expose Chrome's `leave({ mode: 'signOut' })` through a context and call it from both screens.
2. **SecureStore write order** (`frontend/libs/ui/src/platform/storage.native.ts:36-45`): `setItemSync` fires writes without awaiting them, so a refresh applied just before the tap may land after `clearSession`'s delete. The fix is a per-key write chain, a kit change, so it needs its own S-row; proof by the ordering walk.
3. **Forced sign-out on a memory store:** a refresh answered 401 drops the queue without a word. Add a docs/27 §14 row and fold it into ruling 2's S-row for the strip's persistence field (P3).
4. **Interim files on the QA phones:** a 199952b file kept with an op is never sent, as the ruling accepts. `pm clear` the QA phones after the upgrade proof.
5. **Owed by the main session:** docs/22 §8 and §11 rows (ruling 2, addendum (y), one holder per file, the sign-in wait, the generation guard), then render and republish; and ruling 2's two P3 S-rows (the strip has no field to say a browser keeps nothing; "Saved on this phone" shows on a memory store).
