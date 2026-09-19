# DOS-167 — close decision 3 (Fable, architect, 2026-09-20; main 8092048, which contains 71fa9c3 and the DOS-183 engine fix f23a9a7; product tree unchanged since)

**Decision: CLOSED.** The founder's clause (answer A, 2026-09-14) now holds, measured, on every target: unsent changes survive
"Sign out, keep here" on that device, go FIRST at that person's next sign-in, and never reach anybody else. The one item I
left open on 2026-09-20 — the phone half of my own condition — was executed tonight on Android and on iOS at the tip.

## What closes it (executed; I recomputed every offset from the raw proxy timelines myself, not from the summaries)
- **Android, Pixel_7_API_36, sales app, tip 8092048** (dos-167/close/02-request-timeline.jsonl): sign-in over a kept queue —
  login 21:59:56.714Z → `POST /sync/upload` **+502 ms** → manifest +764 → first pull +878. After a different person had used
  the phone: login 22:16:55.265Z → upload **+539** → manifest +702 → pull +813. Controls: empty queue → no upload at all
  (login → manifest +1639 → pull +1770); Rahul's whole session → **0 uploads**. Only two upload requests exist in the whole
  file, both Amit's. Office: one `sync_ops` row per op_id, 4/4 distinct, one order + one line each, no duplicate at either
  shop (C3, E3). Device: both ops `queued` through the sign-out (B10, file closed, identity kept, read set dropped), then
  `acked` with sent_at 249 ms after the tap (C4). Isolation: two store files; Amit's untouched (mtime 03:33) while Rahul's was
  open at 03:44–45; Rahul's outbox empty; his beat/orders/drafts show nothing of Amit's, "Nothing matches that" (D4, D5).
- **iOS, iPhone 16 Pro simulator (iOS 18.0), Expo Go, tip 8092048** (ios-02-request-timeline.jsonl, zero = the stamped tap):
  login +173 → upload **+356** → manifest +582 → pull +605; after Rahul: login +169 → upload **+336** → manifest +556 →
  pull +578. Controls: empty queue → no upload in 40 s; Rahul → 0 uploads. Two upload requests in the whole file. Office:
  4 sync_ops / 4 distinct, `{"ok": true}` each, ₹755 and ₹759 once each (C3, E3). Device: queued through the keep sign-out
  (B10), acked +350/+568 ms (C4); Amit's file closed and untouched beside Rahul's open one (D7). The 2026-09-14 Expo Go
  SIGSEGV on "Sign out, keep here" did not reproduce (same pid, no crash report, twice).
- **Web** — closed in judge-2: upload +287 ms before manifest +405 / pull +417; booted-offline reconnect +38 ms; each op once.
- **Source agrees:** `engine.ts:474-530` `start()` → `bringUp` → `drain()` = `flush({pullAfter:false})` then `sync()`;
  `setNetworkHint` (:1056-1066) compares `radioOn` only. Both phones' sheets name the person and say "Nobody else can see them."

## What remains — OTHER findings' work. A closed P0 is not a finished area; read this list before saying "offline is done".
1. **Kill-with-a-queue → relaunch on Android** (engine.md walk 3) was in my 2026-09-20 walk list and did NOT run. It is not a
   sign-out path — it is DOS-183's clause (unsent first after stop/crash) — so it does not hold DOS-167, but DOS-183's phone
   proof is owed it. A FAIL there is a new finding against the engine at HEAD.
2. **Phone reconnect while signed in is unwired.** `react.tsx:275` says "on a device the app passes NetInfo through
   `engine.setNetworkHint`"; no app does (grep: only `libs/offline/harness/App.tsx`). On a phone the engine learns the radio is
   back only from a failed call, the retry timer (≤ 60 s) or the poll — a rep who stays signed in and walks out of a dead spot
   waits. Not measured on either phone. S-row, P2, lean-libs-offline-boot (react.tsx) + each field app; web is covered by the
   browser events (run C).
3. **iOS is Expo Go on a simulator, not `expo run:ios` or a release build** — the standing programme gap (CLAUDE.md), same JS
   engine, renderer and expo-sqlite; a native iOS build remains unmeasured for everything, not only this clause.
4. Carried from judge-2, none DOS-167's: a second web tab's one-tap sign-out skips the sheet (honesty; founder's word owed);
   memory-store loss on a provider remount (S-row P2, not probed); A3 counter gate on a production export (programme debt);
   `Database not found - nativeDatabaseId[2]` (P4, not reproduced since).
5. **State docs/27 explicitly:** a person with NOTHING unsent has their store file for that distributorship removed at sign-out
   (iOS D8), while a kept file stays; and sign-out drops the read set, so a morning with no signal starts with an empty beat
   (founder question from judge-1, still open).
6. Harness truths for QA/ENV.md: Android LogBox swallows the whole bottom bar (dismiss first); airplane mode is unusable on a
   dev build (cuts Metro) — cut = `adb reverse --remove` + service stopped; iOS carries two "Sign in" elements (match on type);
   the iOS keyboard covers the footer (dismiss before tapping "Save on this phone"); a simulator cut = stop its loopback proxy.
7. To clear at the next rebuild: `dos_test_b2_dos167close`, `dos_test_b2_dos167ios`; the leftover simulator store
   `s80j3azqcg6our25a35rhwbg7r03guzv9zghwmmy1imsvb8cmft` (Rahul @ 01a09a5b, 2026-09-19). Nothing in the product tree changed.

Fable, architect — 2026-09-20
