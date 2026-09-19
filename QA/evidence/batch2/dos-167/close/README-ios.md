# DOS-167 close — "unsent work goes FIRST at the next sign-in", on the iPhone simulator, at the tip

**Verdict: PASS.** Measured twice, from the service's own front door, on the sales app running in Expo Go
on `iPhone 16 Pro, iOS 18.0` (UDID `DBCB09C3-80BF-48CE-AC4C-1F5892C0CE74`), at main tip **`8092048`**.

| | first sign-in over a kept queue | after a DIFFERENT person used the phone in between |
|---|---|---|
| first `POST /sync/upload` | **+356 ms** | **+336 ms** |
| first `GET /sync/manifest` | +582 ms | +556 ms |
| first `GET /sync/pull` | +605 ms | +578 ms |
| (`POST /auth/auth/login` was at) | +173 ms | +169 ms |
| zero | the `POST /auth/auth/login` tap of that sign-in | same |
| evidence | `ios-C2-timeline-signin.txt` | `ios-E2-timeline-signin2.txt` |

The upload precedes the manifest and the pull both times, by a fifth of a second, with no 60-second wait
anywhere. The device's own outbox agrees, independently of the proxy:

| | sign-in tap | outbox `sent_at` | offset | outbox `acked_at` | offset |
|---|---|---|---|---|---|
| measurement 1 | `22:37:41.803Z` | `22:37:42.153Z` | **+350 ms** | `22:37:42.371Z` | +568 ms |
| measurement 2 | `22:48:53.154Z` | `22:48:53.486Z` | **+332 ms** | `22:48:53.696Z` | +542 ms |

(`ios-C1-signin.txt` / `ios-E1-signin.txt` for the taps, `ios-C4-outbox-after.txt` / `ios-E3-office-after2.txt`
for the outbox.)

Each order reached the office **exactly once**: `sync_ops` ends with **4 rows for 4 distinct `op_id`s** from
this device, one `sales_orders` row and one `sales_order_lines` row per order, no duplicates
(`ios-C3-office-after.txt`, `ios-E3-office-after2.txt`). The app agrees — "Waiting: 0", and the two orders
appear once each in Drafts at ₹755 and ₹759 (`ios-E4-2-amit-drafts.png`).

## The two controls that make the number mean something

- **Empty queue → no upload at all.** Amit's very first sign-in on a cleared app went `login +299 ms` →
  `manifest +667 ms` → `pull +719 ms`, with **no `POST /sync/upload` anywhere in 40 s**
  (`ios-A2-timeline-baseline.txt`). So the upload in the table above is the kept work going, not a call the
  app makes on every start.
- **A different person's sign-in uploads nothing.** While Amit's two ops sat unsent, **Rahul Deshmukh**
  (same distributorship) signed in on the same phone: `login +167 ms` → `manifest +352 ms` → `pull +395 ms`,
  **zero `POST /sync/upload` for his whole session** (`ios-D6-timeline-rahul.txt`).

## What was run, and where

- **main tip `8092048`**, working tree clean apart from this evidence folder. This is the tree whose
  `start()` drains the queue before the handshake, whose `setNetworkHint` no longer defers to
  `navigator.onLine`, and whose poll drains before it pulls — the point of re-measuring on a phone.
- Ports **:3000–:3007 were already held by another run and were not touched** (listed in `ios-00-setup.txt`).
  The app talked to **`backend/all-in-one`**: the service on **:3201**, with a transparent logging proxy on
  **:3200** in front of it, which is what the simulator dialled.
  `EXPO_PUBLIC_API_URL=http://127.0.0.1:3200`, `EXPO_PUBLIC_API_PREFIX=/sales`,
  `EXPO_PUBLIC_AUTH_URL=http://127.0.0.1:3200/auth` (passed to Metro, no `.env` file written).
- Database **`dos_test_b2_dos167ios`**, a fresh copy of `dos_test_batch2b_template`, migrated.
  **`dos` and `dos_qa` were never opened.**
- Metro for the sales app on **:5186** (the other run's :5175 was left alone).
- Driven through **Appium/XCUITest on :4723** by accessibility label and element type. The simulator was
  booted and screenshotted with `xcrun simctl` only; **the Claude app's iOS simulator panel was never
  opened** (founder, 2026-09-06). `Simulator.app` was already running from 2026-09-19 17:40, before this
  session started, and was left alone.

## Cutting the office for the simulator alone

The simulator shares the Mac's loopback, so the **:3200 proxy is its only road to the office**. Stopping
that proxy cuts the app and nothing else — the :3201 service keeps serving, Metro keeps serving the dev
bundle, and no other lane's service is approached. Proved each time by `nc -z 127.0.0.1 3200 → REFUSED`
while `:3201/sales/health` still answers `{"ok":true,"db":"up"}` (`ios-B1-cut.txt`, `ios-D1-round2-cut.txt`),
and, from inside the app, by the strip turning to **"Offline since 4:02 am"** on its own
(`ios-B1a-strip-goes-offline.txt`).

## The timeline is measured, not impressed

`ios-tools/log-proxy.mjs` appends one JSON line the instant a request line is parsed — before the body is
read and before anything is forwarded — then pipes the request upstream untouched. Every offset above is
arithmetic on `ios-02-request-timeline.jsonl` done by `ios-tools/timeline.mjs`; `ios-A2`, `ios-C2`,
`ios-D6`, `ios-E2` are that script's output. The sign-in taps are stamped by the driver itself
(`ios-tools/ios.mjs` returns the epoch millisecond of the pointer action).

## The walk

| step | what happened | files |
|---|---|---|
| A | Amit Pawar signs in on a cleared app; beat lands (Godrej Hill, Shops: 10, "Updated just now"). Baseline with an EMPTY queue: login → manifest → pull, **no upload**. | `ios-A1-*`, **`ios-A2-timeline-baseline.txt`** |
| B1 | The office is cut: the :3200 proxy stopped. `nc` refused; the app says "Offline since 4:02 am". | `ios-B1-cut.txt`, `ios-B1a-strip-goes-offline.txt` |
| B2–B6 | One case of **Campa Cola 1 L** at **Prerna Super Market**; the button reads **"Save on this phone"**; the strip becomes **"Offline since 4:02 am · 2 waiting to send"**. The outbox holds 2 `queued` ops. | `ios-B5-line-added.png`, `ios-B6-queued.png`, **`ios-B7-outbox-queued.txt`** |
| B9 | Sign out. The sheet says, in the product's own words: *"2 changes have not reached the office — They stay on this phone for Amit Pawar only and go the next time Amit Pawar signs in here. Nobody else can see them. No connection — they cannot go now."* Pressed **"Sign out, keep here"**. | `ios-B9-signout-keep.txt`, **`ios-B9-3-leave-sheet.png`** |
| B10 | Both ops survive the sign-out, still `queued`; the read-set tables (`sales_orders`, `retailers`, …) are dropped and `cursor`/`manifest`/`role` cleared, while `userId`/`tenantId`/`deviceId` stay. The office has 0 rows for them. | `ios-B10-outbox-after-signout.txt`, `ios-B8-office-before.txt` |
| C | Office back. **Amit signs in again → measurement 1.** The order lands once. | `ios-C0-office-back.txt`, `ios-C1-*`, **`ios-C2-timeline-signin.txt`**, `ios-C3-office-after.txt`, `ios-C4-outbox-after.txt` |
| D1–D2 | Round 2: office cut again, a second order (**Campa Orange 1 L** at **Ansari Kirana Stores**) queued, signed out keeping it. | `ios-D1-round2-cut.txt`, `ios-D1-queue2.txt`, `ios-D2-amit-kept-file.txt` |
| D3–D7 | Office back, then **Rahul Deshmukh** signs in on the same phone. He sees **none of it**: his own beat (Station Road), his own two drafts (₹1,472 / ₹1,598 of 12 Sep), **"Waiting: 0"**, no "waiting to send" anywhere, and searching his beat for Amit's shops answers **"Nothing matches"**. Separate store files, Amit's closed and untouched. **Zero uploads** in his whole session; the office still had 0 rows for Amit's queued order throughout. | `ios-D5-rahul-sees-nothing.txt`, `ios-D5-1..4-*.png`, **`ios-D6-timeline-rahul.txt`**, **`ios-D7-while-rahul.txt`** |
| D8 | Rahul signs out — **no sheet**, he has nothing unsent. His store file for this distributorship is removed with him; Amit's is left exactly as it was. | `ios-D8-rahul-signout.txt`, `ios-E3-office-after2.txt` (file listing) |
| E | Amit signs back in: his kept work **still goes first**, +336 ms, and arrives once. | `ios-E1-*`, **`ios-E2-timeline-signin2.txt`**, `ios-E3-office-after2.txt`, `ios-E4-amit-after.txt` |

## One file per person, and the name says whose it is

Since `609388b` the device store is named `<appLetter><userId in base36×25><distributorId in base36×25>`
(docs/27 §2, `frontend/libs/offline/src/engine.ts` `storeNameFor`) — no hash, reversible.
`ios-tools/decode-store-name.mjs` reads each name back, and the listings in `ios-D7-while-rahul.txt` name
their owners:

- `se785zfuyt7tcdzqszqe91ohvs03guyq2wniciyvg4kmlprdnz5` → Amit Pawar `efde1e76…` @ Tarsun `01a0999a…`
- `s80j3azqcg6our25a35rhwbg7r03guyq2wniciyvg4kmlprdnz5` → Rahul Deshmukh `8760e17e…` @ Tarsun `01a0999a…`
- `s80j3azqcg6our25a35rhwbg7r03guzv9zghwmmy1imsvb8cmft` → Rahul Deshmukh @ distributor `01a09a5b…` —
  a **leftover from a QA run on 2026-09-19 against another database**, present before this walk started and
  deliberately left in place: it sits untouched beside the walk's two files the whole time.

## Two things that are NOT product bugs

1. **`ios-A0-first-attempt-mistap.txt` is a retraction, kept deliberately.** The first sign-in attempt tapped
   the page heading, not the button: the screen carries two elements labelled "Sign in". Nothing signed in;
   the driver now matches on element type as well as label.
2. **A retraction inside `ios-D1-queue2.txt`.** One "Save on this phone" tap at 22:41:33 landed on the
   iOS keyboard instead — the search field had focus and the keyboard covered the footer, so the tap hit the
   `n` key (the field then read "N"). Nothing was queued by it. Retried with the keyboard dismissed first;
   the second tap saved on the first press. This is the simulator's software keyboard, not the product.

## And one positive regression

The 2026-09-14 iOS evidence records **Expo Go crashing with SIGSEGV on the "Sign out, keep here" tap**,
twice (`../ios/5e-crash-summary.txt`, `../ios/5r-repro-keep-crash.txt`). At this tip it does **not**
reproduce: the same tap, twice, left Expo Go on the same pid (`60326`) and wrote **no new crash report**
(`ios-B9-signout-keep.txt`). Both keep-sign-outs of this walk completed cleanly to the sign-in screen.

## Everything in this folder (the `ios-` prefixed half; the unprefixed half is the Android walk)

`ios-00-setup.txt` ports, tip, simulator, database · `ios-01-all-in-one.log` the service ·
**`ios-02-request-timeline.jsonl` the timeline everything is measured from** · `ios-02-proxy.log` ·
`ios-03-metro.log` · `ios-04-boot.png` ·
`ios-A0-first-attempt-mistap.txt` (retraction) `ios-A1-*` Amit's first sign-in `ios-A2-timeline-baseline.txt` ·
`ios-B0-*` `ios-B1-cut.txt` `ios-B1a-strip-goes-offline.txt` `ios-B2..B6-*` the offline order
`ios-B7-outbox-queued.txt` `ios-B8-office-before.txt` `ios-B9-*` the leave sheet
`ios-B10-outbox-after-signout.txt` ·
`ios-C0-office-back.txt` `ios-C1-*` **`ios-C2-timeline-signin.txt`** `ios-C3-office-after.txt`
`ios-C4-outbox-after.txt` ·
`ios-D1-*` round 2 `ios-D2-*` the kept file `ios-D3-office-back.txt` `ios-D4-*` Rahul's sign-in
`ios-D5-*` what Rahul sees **`ios-D6-timeline-rahul.txt`** **`ios-D7-while-rahul.txt`** `ios-D8-*` ·
`ios-E1-*` **`ios-E2-timeline-signin2.txt`** `ios-E3-office-after2.txt` `ios-E4-*` ·
`ios-tools/` `ios.mjs` (the XCUITest client, every tap stamped) `log-proxy.mjs` (**the instrument**)
`signin.mjs` `timeline.mjs` `outbox.sh` (reads a store file off the device through a copy, never the
app's own file in place) `decode-store-name.mjs` · `ios-Z-teardown.txt`.

No product code was changed and nothing was committed.
