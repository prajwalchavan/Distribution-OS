# DOS-167 — close decision (Fable, architect, 2026-09-19, main ff28995; product tree unchanged through bc6dd04)

**Decision: NOT CLOSED.** Two of the founder's three clauses hold on every target and the web store is now honest; the third —
"go first at that person's next sign-in" — was measured FAILING on web on two paths, with one tab and no harness trick.

## What is proven (executed, evidence under QA/evidence/batch2/dos-167/)
- **Survive sign-out, never reach anybody else — every target.** Android sales/delivery/warehouse (amendments/sa-*, and-*, wh-*):
  a real op queued with a three-way cut, the sheet names the person, the same person finds it, a DIFFERENT fully-synced person's
  file/tray/sheet hold 0 of it, the office row lands once. iOS: ruling-3 keep cycles 3/3, three uploads, no duplicate, no leak
  (reproof2/ios b2–b8, c2, c5 on ce3dc8c; no native DOS-167 code changed since). Web: tab 1's `/s…` header, size, magic and queue
  untouched by a second tab (a4c), by a corrupted-then-closed file (a2-20), by a 15 s-abandoned open (a5-05..07); orders landed once.
- **Goes first — Android and iOS.** manifest → upload → pull, to the millisecond, three apps, twice each (sa §6/§9, and §7, wh rounds 1–2).
- **The web store opens honestly or says it cannot.** Ruling-3 re-proof: 22 opens (cold / 600 / 1500 ms / production export) one
  header each; flash watch 0 intervals (v5a–c); memory line printed (vmem); switch and kill-in-end passed. Amendments: A2 corruption
  → "could not be used; running in memory" at 752 ms, second engine opens on the same name, file never destroyed. A5 → memory at
  15 055 ms with reason `open timed out after 15s`, late handle open→exec→close, zero deleteDatabase, queued order recovered and sent.

## Why it is not closed
1. **WEB: the kept change goes LAST, not first, whenever the previous session did not end through `end()` on that file.**
   Run B (a4b-result.json): a plain sign-in over a file holding one unsent order — manifest +313 ms, pull +362, errors +489, NO upload;
   first POST /sync/upload at +60 753 ms on the poll tick. Run C (a4c-events.json): tab 1 reloaded offline, real `online` event at
   t=175 028, first request 49.5 s later, pull before upload. Cause read after observing: `engine.ts:452-488` `start()` runs
   `sync('start')` (manifest → pullLoop → pullErrors) and never `flush()`; the only pre-pull flush is `applyManifest`'s STALE branch
   (`:1088-1097`), reached only because `dropReadSet` nulled role/manifest — which is why Android/iOS pass and a browser whose sign-out
   came from another tab, a crash, or a closed window does not. Second cause: `setNetworkHint` (`:1012-1023`) returns early when
   `was = this.radio()` is true, and on a page that booted offline `radioOn` is null so `radio()` reads `navigator.onLine`, already
   true inside the handler (a4d probe) — the reconnect is swallowed; `react.tsx:278-296` never seeds the radio. docs/27 §13 and docs/22
   §7 both promise "sends it before the re-snapshot". Repair is small (flush pending before the pull in `start()`/`sync()`; compare
   `radioOn` only, seeded at mount); re-prove run B and run C on web, and that upload still precedes pull on Android and iOS.
2. **WEB: a second tab's one-tap sign-out signs the queued tab out with no sheet** (run A): tab 2 (memory, 0 pending) counted its own
   queue, cleared the shared session; tab 1's file and order survived (run B) but the warning the sheet exists for was skipped, and it
   is the entry to item 1. Needs a design line and the founder's word (S-row).
3. **A potential loss vector on the memory path, not yet probed.** A5 saw the page silently re-open the persistent store ~80 s into a
   memory session beside POST /auth/refresh. The provider effect (`react.tsx:204-243`) depends on `enabled = session !== null && …`,
   so a transient session change remounts the engine: `stop()` (`engine.ts:608`) closes the memory store and anything queued in it is
   gone, while the order screen still says "Saved on this phone" (S-151). Reproduce with a write queued on the memory store first.
4. **Owed walks not run this stage:** A3 live counter gate at 600/1500 ms and on a production export built AFTER instrumenting (A5's four
   instrumented Metro loads read vfs=1/init=1; product unchanged since ce3dc8c, so low risk); iOS sanity boot of attention/settings on
   the merged tree; A1's read-only-app cold open is vacuous (no owner/manager/retailer screen reads `persistent`).
5. Tab 1 page error `Database not found - nativeDatabaseId[2]`, twice in run A after tab 2 opened, absent in run C — targeted look.

## Filed or to file (not DOS-167 blockers)
- Honesty below the fold / absent on the order screen / strip never carries `lastError` / second tab's first screen identical to
  tab 1 (a4e, a5 P2, a2) — S-151, approved as DOS-179/DOS-180, building.
- NEW, outside DOS-167: delivery Android `d4-record` never fires `onPress` (deliver.tsx:283/482; pressed style renders, nothing
  saved) — a driver cannot record a delivery at the door, P1. Warehouse pick sheet opened without a signal hides Picked/Short for
  5 m 48 s with the wave on the phone (`pick/[id].tsx:102` `locked = liveStatus === undefined || notStarted`), P1/P2. Sign-in after a
  sign-out waits ~17 s while a stalled pull runs to the 20 s deadline (a2-18), P3. Sign-out drops the read set, so a morning with no
  signal shows an empty beat (docs/27 §13, by design) — founder question.
- Merge-review minors: `open.web.ts:131-135` dead branch; repo-wide sweep for ungated `.persistent`; `consoleSink` not `__DEV__`-gated
  (P4); S-155 turbo inputs. Gate must tolerate a `-journal` sibling of the wanted name (run A).
- Harness truths for QA/ENV.md: Android offline needs airplane + `adb reverse --remove` + the service stopped; RN testIDs need
  `UiSelector().resourceId`; LogBox covers the stop footer; a5b's OPFS fields are wrong (root-only walk) — a5/a5c are authoritative.
- dos_qa test data to clear at the next rebuild: 01a0ba24-f6cc…, 01a0ba2f-50b1…, 01a0ba40-326b… (rahul.deshmukh drafts).

Fable, architect — 2026-09-19
