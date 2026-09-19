# DOS-167 — close decision 2 (Fable, architect, 2026-09-20; main 71fa9c3, which contains f23a9a7 — the five DOS-183 engine regions are byte-identical, d183-engine-regions-md5.txt)

**Decision: NOT CLOSED — on the unexecuted half of my own 2026-09-19 condition, not on any observed failure.** The web clause
that failed is fixed and measured on a real browser; DOS-183 is proven. My condition read "re-prove run B and run C on web, AND
that upload still precedes pull on Android and iOS". The second half was not run. The phone measurements of "goes first" date
from ce3dc8c; since then bab0796/76704af changed how `start()` orders the queue and cfe2010 changed `end()`'s keep condition.
Charter A.4 does not let me infer a phone from a browser or iOS from Android, and I will not close a P0 clause on a unit test
where I asked for a device.

## What the fresh proofs settle (executed; QA/evidence/batch2/dos-181-183/)
- **Web, goes first — CLOSED.** Run B (sign-in over a file whose session ended by another tab's sign-out and a closed window):
  upload +287 ms, manifest +405, pull +417 carrying a cursor; run 1 on its own profile 328/487/502. Run C (booted offline, 150 s
  no signal, `online` event): upload +38 ms, manifest +242, pull +258; the backoff was at its 60 s cap with ~29 s to the next
  retry, so this is the reconnect. I re-read the raw d183v2-network.json myself: t=252171 upload → 401, refresh → 200,
  t=252241 upload → 200; sync_ops one row per op, no duplicate; one order + one line each. The raw result.json still says
  `runC_everyOpSentOnce: False / PASS: False` — that is the attempt count; the correction is right and the file says so.
- **Web, survive + nobody else — still hold.** The 3.9 MB file with one header survived the cross-tab sign-out and the closed
  window (s2-01); `claimIdentity`, `dropReadSet` and the identity claim before any flush are untouched by DOS-183 and by the
  honesty lane, whose only `end()` change is `kept = pending + rejected + heldMoney > 0` — it keeps more, never less.
- **Android, the new engine's outbox — executed at 71fa9c3 (DOS-181 walk):** a queued doorstep op survived the office cut, went
  once with its original op id (`sync_ops` 1 row, one delivery row), `_outbox` acked, `_sync_errors` 0. That is the expo-sqlite
  half of the start flush; it is NOT the start order, and no relaunch or sign-in ran with a queue on the phone.
- **Unit, on main:** I ran `vitest run` in @dos/offline — 92/92. identity.test.ts :1375/:1633 assert `upload → manifest → pull`
  on the end()-kept path; dos-183-unsent-first.test.ts covers stop/crash, reconnect, poll, a throwing flush, no double send.
- The literal founder path on web (same-tab "Sign out, keep here" → colleague sees nothing → same person → upload before the
  first pull, order once) was executed at ce3dc8c (reproof2/web results-v5d: d4CallOrder iUpload=1 < iPull=2, d4Sql once).

## The one DOS-167 item that remains (~30 min per phone; PASS closes DOS-167 without another judgement)
Android sales on the Pixel 7 (-memory 3072) and iOS sales on the simulator, main tip, dos_qa or a lane copy: sync; office cut;
queue one order; "Sign out, keep here"; office back; the SAME person signs in → the service log (or `sync_ops.created_at`
against the first pull's `since`) shows `sync.upload` before the first `sync.pull`; the office holds the order once; then a
colleague signs in over the same device and holds 0 of it. Add one kill-with-a-queue → relaunch on Android (engine.md walk 3).
A FAIL is a new finding against the engine at HEAD, not a reopening of the web work. This also retires "iOS sanity boot of the
merged tree" from item 4 below.

## Earlier open items — where each stands
1. Web goes first (run B, run C) — DOS-167's; CLOSED tonight. Native half of the same condition — DOS-167's; the walk above.
2. A second tab's one-tap sign-out signs the queued tab out with no sheet — reproduced again in tonight's set-up (tab 2 on a
   memory store, 0 pending, cleared the shared session). With DOS-183 its consequence is gone: the file kept the order and it
   went first. What is missing is the warning — an honesty gap, NOT DOS-167's. S-row for the founder's word: either the memory
   tab counts the file's queue before it signs out, or the file's tab shows the sheet at its next open.
3. Memory-path loss on a provider remount (react.tsx `enabled = session !== null …` → `stop()` closes a memory store holding a
   queue) — still not probed; not a sign-out path, NOT DOS-167's. S-row P2 for lean-libs-offline-boot (owns engine.ts/react.tsx):
   queue a write on a memory store, force a transient session change, count the outbox.
4. A3 counter gate at 600/1500 ms on a production export built after instrumenting — programme debt (promote the S-138 gate
   into QA/tools/e2e), NOT DOS-167's: the open path is unchanged since ce3dc8c, where 22 opens passed. A1 stays vacuous.
5. `Database not found - nativeDatabaseId[2]` — not reproduced tonight (pageErrors 0 and [] in both runs); S-row P4, watch.

## From tonight's proofs, none of it DOS-167's
- S-88 confirmed on a device: with a doorstep write in the outbox the stop still offers "Deliver this bill" (d181-43); a second
  press was not tried — hold it at P2 until it is.
- DOS-181: both presses and the credit gate passed; the photo → enabled → press branch is NOT TESTED (the camera kills the app
  on the 3 GB emulator) — DOS-181 stays proof-owed on that branch only.
- Retry storm with no signal: /auth/refresh, /inventory/availability and the logo each 22× in 8.2 s then silent for 155 s
  (d183v2 side observation; the DOS-181 phone showed the same) — api-client/useQuery, P3; the engine's own backoff is clean.
- Harness truths for QA/ENV.md: a rep's device holds only his shops (read the app's own list); count 2xx uploads, not attempts;
  refuse to press under a LogBox node; tolerate a `-journal` sibling. Lane databases to clear at their next rebuild:
  dos_test_b2_d183 (four rahul.deshmukh drafts), dos_test_b2_d181walk.

Fable, architect — 2026-09-20
