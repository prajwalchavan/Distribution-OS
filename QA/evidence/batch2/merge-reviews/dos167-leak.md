# DOS-167 merge review — leak lens (Fable, 2026-09-13)

Lane `b2-dos167`, branch `qa/b2-dos167` (7 commits afc8b6e..10e864e, `main...qa/b2-dos167`: 34 files, frontend + docs/27 only). Read-only review of the diff, the branch engine, the design, ruling 1 and the three build reports. No build, test or walk was run here.

**Decision:** MERGE AFTER FIXES — one small engine blocker (an orphaned `start()` after `stop()` can write the NEXT session's manifest and refusals into the previous person's per-person file); everything else is minor or a walk still owed.

## Leak lens — every entry walked on the branch code

- Cold start on a foreign stamped file: `claimIdentity` (engine.ts:267,391-417) runs after the open and BEFORE `this.store` is set (ruling o, :274), `restoreManifest`, the first emit and `sync('start')`; a userId/tenantId mismatch runs `wipeAll` (data tables from the stored manifest + loaded shapes, `_outbox`, `_sync_errors`, `_gps_buffer`, every state key but `deviceId`, :419-431). CLOSED. Only Layer B is exercised in production, because Layer A (`storeNameFor`, :62-69, ids checked against `[A-Za-z0-9-]{1,64}`; dos_qa ids are UUIDs) means two identities never open one file.
- File with no stamp: stamped and kept (:407-416). Only the person's own file can be unstamped; the legacy `<prefix>.db` (stamped by role/tenantId only) is never opened by the engine, it is destroyed once per mount (react.tsx:165-189). CLOSED.
- Sign-in after sign-out: `end({keepQueue:false})` drops the read set, emits every dropped table + OUTBOX + ERRORS (so mounted `useTable` state empties), closes and destroys the file, then sweep → drafts → `signOut()` (leave.ts:153-175). QueryCache cleared by `bindCacheToSession` on the identity key change (react/index.tsx:189-200) with a generation guard on in-flight answers (cache.ts:145-190). CLOSED.
- Distributor switch both ways: provider deps `[enabled, deviceId, storeFactory, name, idKey, pullIntervalMs]` (react.tsx:150) stop the old engine (queue kept in that person's file) and start one on the other file; `useSession().switchDistributor` and the binding both clear the cache. CLOSED for other people. Same-person handoff frame: see minor 1.
- Several memberships (the sweep): `otherIdentities(session)` → `sweepIdentityStores` deletes sibling files with nothing queued/sending/rejected, keeps and reports the rest, closes an uncountable one (ruling p, :460-500). CLOSED; on the keep path the sweep is skipped (minor 2).
- Forced sign-out (401 on refresh): `refreshNow` → `session.clear()` (client.ts:153-172) → identity null → provider `stop()`; the file stays with queue AND read set, openable only by that identity; cache cleared by the binding; drafts unreadable without a userId (draft.ts:133-141). CLOSED (data at rest accepted by the design, 6f).
- Ordinary token refresh: same `userId:tenantId` → same `name`/`idKey`, no engine restart, no cache clear (identity.test api-client case). MUST-NOT-WIPE holds. Sales `enabled` lacks `!hydrating` (see defects outside).
- Admin console `PlatformSession`: `cacheOwner` keys `user.id:` when there is no tenant (react/index.tsx:170-177); no offline store in that app. CLOSED.
- QueryCache stale-while-revalidate: cleared on every identity change including null↔key; a fetch in flight under the old owner is dropped by `slot.generation` (cache.ts:64-68,147-160). CLOSED.
- Sales draft: `dos.sales.draft.<userId>.<retailerId>` + per-user index; `forgetDraftsOf` on the one-tap path; `forgetDraft` callers updated (orders/new.tsx:236). CLOSED. Old unkeyed keys rest in localStorage (P3, never read).
- Legacy `<prefix>.db`: destroyed once per mount, skipped when it IS the configured name. CLOSED.
- GPS buffer and errors mirror: `_gps_buffer` always dropped, `_sync_errors` kept only with `keepQueue` (:331-346); `sync.errors.list` is `user_id = actor` on the server for field roles (sync.service.ts:229-237), so a colleague on the same deviceId never receives another rep's refusals. CLOSED.
- Web OPFS vs expo-sqlite: `destroy` closes once then `deleteDatabaseAsync(name)` (expo-sqlite.ts:105-120); on web that is AccessHandlePoolVFS `jDelete` → `#setAssociatedPath('')` → `truncate(HEADER)`, so the bytes go (node_modules/expo-sqlite/web/wa-sqlite/AccessHandlePoolVFS.js:381-408,450-456). A second tab cannot acquire the pool → memory store (open.web.ts:44-52) → nothing persists there; the first tab is forced out on its next refresh and keeps its file (forced path). Native `-wal/-shm` after delete: walk item. CLOSED by reading, NOT walked.
- Order of `end()` vs `client.signOut()`: `end` first (token still valid for Send now), `signOut` even when `end` throws (leave.ts:158-175; leave.test.ts). From the tap on every write is refused synchronously in `requireStore` (:1342-1346); writes in hand are awaited by `settled()` (:356-367) and re-counted (:338-345). CLOSED.

Fix vs design/answer A: Layers A/B/C, amendments a–l and rulings m–p are all in the code; the sheet never offers discard, 'Send now' only while online, keep = `end({keepQueue:true})`, forced sign-out keeps the file. Product rules: `leave-sheet.tsx` imports only `@dos/ui`; no backend, contract, permission, migration or kit change; `SyncIdentity` is offline's own type. Tests: 16 offline + 2 api-client + 3×3 app + 1 draft, all DOS-167-named; the apps' `test` scripts run under `turbo run test`.

## Blockers

1. `frontend/libs/offline/src/engine.ts:255-303` — `stop()` during the open/claim orphans the engine: `start()` still assigns `this.store` (:274) and runs `sync('start')` (:303) on a stopped engine, and `sync()` (:633) / `pullErrors` (:722) are not gated on `started`. The transport is the ONE api client the app keeps across sessions, so the orphan's manifest and `sync.errors.list` go out with whoever is signed in by then: a next person's manifest re-stamps role/schema in the previous person's file, drops their read set, and mirrors the next person's refusals into their `_sync_errors` (read in the tray at their next sign-in); on native the connection stays open so the later `deleteDatabaseAsync` fails "currently open". Window: the session changes while the open is in flight (sales cold start with a dead refresh token — sales `enabled` has no `!hydrating` — and on web the first open includes the expo-sqlite wasm load). The verifier's PROBE-5 rig reproduces the orphan. Fix: after :255 and again after :267 (before :274) `if (!this.started) { await store.close().catch(() => {}); return }` (the `finally` still calls `opened()`); in `sync()` :633 add `|| !this.started`. Test: PROBE-5 as a DOS-167 identity.test.ts case — `stop()` during the claim → store closed once, no manifest call, `this.store` null.

## Minors

1. Same-person switch handoff: after `applyTokens` the tree renders the new tenant's header while `useTable` state (react.tsx:326-362) still holds the old engine's rows until the provider effect swaps the engine — at most one frame, same person, both books theirs. Fix later: reset rows/loading synchronously when `engine` changes, or gate Chrome on engine identity === session identity.
2. `leave.ts:163` (sales, delivery, warehouse): the sibling sweep runs only when `keepQueue` is false; run `steps.sweep()` on the keep path too (it deletes only empty-queue files), so a keep-sign-out does not leave the person's OTHER distributors' read sets at rest.
3. `engine.ts:331-346`: a kept file still holds the dropped rows in SQLite free pages until reuse; `VACUUM` (or `PRAGMA secure_delete = ON` for the session) after the drops when `keepQueue` makes "the file keeps only that queue" physically true. Defence in depth (unencrypted store is accepted for the pilot).
4. Verifier's partial order: `sales-app/src/lib/queue.ts:42-59` queues a header and each line as separate `enqueue` calls, so a sign-out between them keeps a header-only draft; `leaveNow` (leave.ts:163-170) then forgets the draft although `end()` reported `kept`. Fix: one enqueue transaction per order, or skip `forgetDrafts` when `kept`.
5. docs/27 :77 and :209 still say the kept queue "and its refusals … go out the next time"; under ruling (n) refused ops wait in Needs attention. Reword (lane-owned file).
6. `end()` can wait a full 20 s request deadline on `pullErrors` in flight with nothing on screen; ruling (r) toast stays optional.
7. docs/22 §8 row :311 (main session) still quotes "Sign out, keep them here" and lacks the (m) clause.

## Conflicts

- lean-delivery-door: delivery `_layout.tsx` Chrome/Offline rewritten (:283-317, :393-556) and `leave.*` keys in strings.ts:51-76 — rebase after DOS-167; stop-screen hunks do not overlap.
- lean-libs-offline-boot: engine.ts `retry()`/`discard()` are now wrapped in `inHand` (:1136-1191) — DOS-046's retry region conflicts textually; its `systemSchema` key must be placed in `CLEARED_FOR_ANOTHER_IDENTITY` (:64-74) or excluded like `deviceId`; docs/27 §4 :75-77 paragraph shared; react.tsx gained `useLeaveSession`/`leaveDecision` (:242-307); DOS-089's `!hydrating` goes into sales `_layout.tsx:255` `enabled=`; session.ts additions are additive.

## READMEs

`frontend/libs/offline/README.md` updated in the branch. No contract change → no service or app README regeneration (`pnpm docs:readme:check` unaffected). `pnpm format:check` in frontend was not reported by any slice; run it at integration (docs/27 is outside it).

## Walks (still owed before the P0 is closed; none run by any slice)

- Web (COOP/COEP, dos_qa): `s-098-shared-device.mjs v5a v5b v5c` + V5D, plus the two ruling cases (cold-start sign-out reads "1 change has not reached the office", keep button "Sign out, keep here"; the `/sync/pull` stall race). The OPFS check must NOT list by file name — AccessHandlePoolVFS stores pool files under opaque names with the SQLite path in each file's header — read the headers or open the name and assert `_sync_state` has no `userId`.
- Android Pixel_7_API_36: sales steps 1-6 (add: no `-wal`/`-shm` left beside a deleted name), delivery and warehouse 1-3; upgrade path from a pre-fix APK.
- iOS simctl: steps 1-5. Plus a screenshot burst at a distributor switch (minor 1).

## Defects outside the fix

- `frontend/sales-app/app/_layout.tsx:255` — `enabled` lacks `!hydrating` (delivery :253 and warehouse :262 have it), so the engine opens on a restored session before the boot refresh proves it; DOS-089's item, and what makes blocker 1 reachable.
- `frontend/libs/offline/src/engine.ts:722` — `pullErrors` runs after `pullLoop` returned on `!started`, so a stopped engine still calls `sync.errors.list` (folded into blocker 1).
- `frontend/*-app/app/_layout.tsx` `run` (`void step().finally`) — a rejected `switchDistributor` is an unhandled rejection with nothing shown (S-row, pre-existing).
- `frontend/sales-app/src/lib/draft.ts` — pre-DOS-167 `dos.sales.draft.<retailerId>` keys are never removed (P3).
- `backend/libs/core/src/modules/sync/sync.service.ts:481-493` — the cursor carries no device identity (S-row, defence in depth).
