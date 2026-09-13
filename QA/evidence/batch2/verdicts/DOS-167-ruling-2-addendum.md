# DOS-167 ruling 2 — addendum (x): end() drains the store before it closes

Author: the main QA session (Opus 5), standing in for the architect. Fable's usage limit was reached on 2026-09-14 at about 01:26 IST and resets on Saturday at 11:30 IST.
This addendum binds the ruling-2 build. That build's merge review and judge check it like any lettered amendment.

## Evidence

- **Where it was found.** The Android delivery proof in run `wf_74bd442f-12c` at 01:22 IST on 2026-09-14.
- **What happened.** Tapping "Sign out, keep here" crashed the app natively within 1–9 s. It reproduced 2 of 2 times.
  - Signal: SIGSEGV in `libexpo-sqlite.so exsqlite3_reset`, called from `expo::NativeStatementBinding::sqlite3_reset`, called from the `AsyncFunctionComponent` (thread DefaultDispatch).
  - Fault address: `0x1000000bb`.
  - Logs: `QA/evidence/batch2/dos-167/android/d5c-crash-logcat.txt`, `d6b-repro-keep-crash.txt`, `d5c-after-keep-diagnosis.txt`.
- **What was not lost.**
  - The kept file passed `integrity_check`.
  - The queued op and the identity stamp survived.
  - The owner's next sign-in sent the op exactly once.
  - Nobody else saw or sent it.
- **What did not crash.**
  - One-tap sign-outs, where the file is destroyed: 4 runs (delivery and warehouse).
  - The one keep run on the sales app.
- **Reading (not yet proven in code).** A statement is reset or stepped on a connection that `end({ keepQueue: true })` has just closed. Some async store call is still in flight and races `closeAsync`. Candidates:
  - a `useTable`, `useOutbox` or `useNeedsAttention` re-query triggered by the dropped-table emit;
  - a status count;
  - a prepared statement's reset.

  The builder proves the actual cause with the red tests below before fixing it.

## Rule (x)

1. **No new store calls.** From the moment `end()` begins, the engine starts no new store call on anyone's behalf.
   - Every public read answers with an empty, ended result and never touches the store. The reads are: `queryTable`, `countRows`, `outbox`, `needsAttention`, `pullErrors` and the status counts.
   - Every write is refused, as ruling 1 (m) already says.
2. **Drain before close.** The engine tracks every store call it has started, reads included. `end()` does these steps in order:
   1. performs the wipe;
   2. emits the dropped tables and channels, so any re-query those emits trigger falls under rule 1;
   3. awaits every tracked call;
   4. only then calls `store.close()`.

   `destroy()` runs only after `close()` has resolved.
3. **The adapter refuses late calls.** The expo-sqlite adapter rejects any call made after `close()` began with a typed "store closed" error, instead of reaching the native binding. `closeAsync` is awaited once; a second close does nothing.
4. **Same drain elsewhere.** `stop()` and a distributor switch close the store through the same drain.

## Tests (red first)

- `frontend/libs/offline/src/identity.test.ts` — **'DOS-167 end() never lets a store call start or run after close begins'**
  - Setup: a spy store records every method call and when it ran relative to `close()`. Table and channel listeners re-query on every emit, as the React hooks do. One slow read is held in flight.
  - Action: run `end({ keepQueue: true })`, then again with `keepQueue: false` on a fresh engine.
  - Asserts: no call starts or finishes after `close()` began, and `close()` starts only after the in-flight read resolved.
  - Red today: re-queries and/or the in-flight read reach the store after close.
- `frontend/libs/offline/src/identity.test.ts` (or the adapter's own test file) — **'DOS-167 the SQLite adapter refuses a call after close began'**
  - Setup: `openExpoSqlite` over a fake `ExpoSqliteLike`.
  - Asserts: a statement or query call made after `closeAsync` began rejects with the typed error and never reaches the fake binding.
  - Red today: the call reaches the binding.

## Re-proof additions (on top of ruling 2's list)

- **Android delivery.** Run "Sign out, keep here" three times in a row, with one change queued offline each time. Pass when:
  - logcat shows no `am_crash` and no `Fatal signal` for `in.distributionos.delivery`;
  - the sign-in form shows;
  - the kept op is sent exactly once at the owner's next sign-in.
- **Android warehouse.** Run the keep path once: queue a change offline, then "Sign out, keep here". Pass when there is no crash and the op is sent once at the owner's next sign-in.
- **iOS sales.** Run the keep path once. Pass when there is no crash and the op is sent once.
- **Android delivery, S-127.**
  - After an offline relaunch with a completed pull, record whether the home still says "Still filling this phone from the office".
  - Run the same check once on the pre-DOS-167 JavaScript (the idle worktree `.claude/worktrees/b2-lean-manager-billing`, sales/delivery Metro started from there). This shows whether DOS-167 caused it.
- **Android warehouse, S-126.** Record whether the Fabric cold-start crash repeats after `install -r` + `pm clear`.

## Addendum (y): a crash during sign-out never leaves the person signed in

Author: the same main session (Opus 5), standing in for the architect, 2026-09-14 about 02:45 IST. It is binding on the ruling-2 build, like (x).

### Evidence

- **Where it was found.** The iOS proof in run `wf_74bd442f-12c`, at 02:18 and 02:23 IST.
- **What happened.** "Sign out, keep here" crashed Expo Go natively, 2 of 2 times.
  - Signal: SIGSEGV EXC_BAD_ACCESS at `0x1000000bb`, on thread `expo.module.sqlite.AsyncQueue`, in `exsqlite3_reset` called from `SQLiteModule.run`. That is the same fault as S-128 on Android.
  - Both crashes happened while the outbox was retrying against an office that could not be reached (attempts = 3).
- **Why it is a P0.** On relaunch the app came back **signed in as the rep who had chosen to sign out**: that rep's session, beat and shops. On a shared phone the next person is inside that rep's session. DOS-167 exists to prevent exactly that.
- **What was not lost.** The kept ops were intact, and both orders reached dos_qa exactly once when the session resumed.
- **Evidence files** (under `QA/evidence/batch2/dos-167/ios/`): `5e-crash-expo-go-2026-09-14-021827.ips`, `5r-crash-expo-go-2026-09-14-022331.ips`, `5e-crash-summary.txt`, `5r-crash-summary.txt`, `5e-simulator-log-02-18.txt`.

### Rule (y)

1. **Sign out on the device before the store is touched.**
   1. The leave flow keeps in memory only what the server revoke needs: the refresh token and the device id.
   2. It clears the stored session: the refresh token in platform storage and the in-memory access token. From here on, a relaunch after any crash shows the sign-in form.
   3. Only then does it run `end()`.
   4. Last, it asks the server to revoke, using the kept token. This is best effort and runs in the background: it never blocks the person, never signs anyone back in, and its 20 s deadline does not hold the screen.
2. **'Send now' keeps its order.** It sends with the live session first. Rule 1 applies only when the person then leaves.
3. **The query cache.** Its clear follows the local sign-out: `bindCacheToSession` already clears the cache when the identity key changes.
4. **After a crash between the local sign-out and the end of `end()`:**
   - the person is signed out;
   - the store file may still exist: with its queue on a keep, or with its read set on a one-tap sign-out;
   - the identity claim at the next start protects everyone else (design (b), ruling 1 (o)): another identity's file is wiped before any read;
   - the same person's next sign-in finds their own file, as design (c) already allows.
5. **Scope.** The rule holds in the sales, delivery and warehouse apps. The forced sign-out path (a 401 on refresh) is unchanged.

### Tests (red first)

- **Each app's `src/lib/leave.test.ts`** — 'DOS-167 the keep sign-out clears the stored session before the store is touched'
  - Setup: the injected leave steps record the order in which they are called.
  - Assert: on the keep path, the local sign-out step comes before `end`.
  - Assert: when `end` never resolves (a stand-in for a crash), the session is already cleared.
  - Red today: `end` runs before `signOut`.
- **`frontend/libs/api-client`** (session or react layer) — 'DOS-167 signing out on the device does not wait for the network'
  - Assert: the local sign-out clears the stored refresh token and the in-memory token before any network call.
  - Assert: the revoke then runs with the kept token.
  - Assert: a revoke that never answers neither blocks the local sign-out nor restores the session.
  - The builder first confirms today's order, which the design's (d) says awaits the server, and records it as the red.

### Re-proof additions for (y)

- **iOS sales, keep path.** Run "Sign out, keep here" three times, each with the office unreachable and the outbox retrying (the crash condition), and relaunch after each. Pass when:
  - no new Expo Go `.ips` crash report appears;
  - the relaunch shows the sign-in form, not the rep's session;
  - the owner's next sign-in sends the kept ops exactly once.
- **iOS sales, online.** Open the leave sheet while online and tap "Send now". Pass when the changes are sent and the person is then signed out.
- **Android delivery, keep path.** Run the keep path three times with the office unreachable and the outbox retrying. Pass when each relaunch shows the sign-in form and logcat shows no crash.

## Out of scope

- **S-129.** On iOS the native kit Sheet exposes one accessibility element, so its rows cannot be targeted one by one. This predates DOS-167; it stays a P3 row for the kit.
- **S-126, the warehouse cold-start crash.** It is in the React Native Fabric renderer (`MountingCoordinator::pullTransaction` on the JS thread), was seen once, and is not attributed to DOS-167. It is only re-tried, not fixed here.
- **S-127, "Still filling".** It is fixed here only if the comparison above proves DOS-167 caused it. Otherwise it stays a P3 row.
