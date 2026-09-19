# DOS-167 close — "unsent work goes FIRST at the next sign-in", on a real Android device, at the tip

**Verdict: PASS.** Measured twice, from the service's own front door, on `Pixel_7_API_36`.

| | first sign-in over a kept queue | after a DIFFERENT person used the phone in between |
|---|---|---|
| first `POST /sync/upload` | **+502 ms** | **+539 ms** |
| first `GET /sync/manifest` | +764 ms | +702 ms |
| first `GET /sync/pull` | +878 ms | +813 ms |
| zero | the `POST /auth/auth/login` of that sign-in | same |
| evidence | `C2-timeline-signin.txt` | `E2-timeline-signin2.txt` |

The upload precedes the manifest and the pull both times, by a quarter of a second, with no 60-second
wait anywhere. The device's own outbox agrees: `sent_at 2026-09-19T21:59:56.803Z` against a sign-in tap
at `21:59:56.554Z` — **249 ms** (`C4-outbox-after.txt`, `C1-signin-tap.txt`).

Each order reached the office **exactly once**: `sync_ops` holds 4 rows for 4 distinct `op_id`s from this
device, one `sales_orders` row and one `sales_order_lines` row per order, no duplicates
(`C3-office-after.txt`, `E3-office-after2.txt`).

## What was run, and where

- **main tip `8092048`** ("DOS-183 proven in milliseconds and merged f23a9a7 …"), working tree clean.
  The task named `71fa9c3`; main moved on while this walk was being set up, and `8092048` contains both
  `71fa9c3` and the DOS-183 engine fix `f23a9a7` (`git merge-base --is-ancestor f23a9a7 HEAD` → yes).
  This is the tree whose `start()` drains before the handshake — the point of re-measuring.
- Ports :3000–:3007 were **already held** by another run and were not touched. The app talked to
  **`backend/all-in-one`**: the service on **:3101**, and a transparent logging proxy on **:3100** in
  front of it, which is what the phone dialled. `EXPO_PUBLIC_API_URL=http://127.0.0.1:3100`,
  `EXPO_PUBLIC_API_PREFIX=/sales`, `EXPO_PUBLIC_AUTH_URL=http://127.0.0.1:3100/auth`.
- Database **`dos_test_b2_dos167close`**, a fresh copy of `dos_test_batch2b_template`, migrated.
  `dos` and `dos_qa` were not opened.
- Metro for the sales app on **:5185** (the existing :5175 web server was left alone), host `:8081`
  forwarded to it by `QA/tools/proxy8081.mjs`.
- Driven through **Appium/UiAutomator2** (:4725) by `resource-id` and by text — never a raw coordinate.
  `tools/drive.mjs` is the whole client.

## The timeline is measured, not impressed

`tools/log-proxy.mjs` writes one JSON line the instant a request line is parsed, before the body is read
and before anything is forwarded, then pipes the request upstream untouched. Every offset above is
arithmetic on `02-request-timeline.jsonl`; `C2` / `D6` / `E2` are the scripts' output over it.

## The walk

| step | what happened | files |
|---|---|---|
| A | Amit Pawar signs in on a cleared app; beat lands (Shops: 10, "Updated just now"). Baseline order of calls with an EMPTY queue: login → manifest → pull, **no upload at all**. | `A1-*`, `00-setup.txt` |
| B1 | The office is cut: `adb reverse --remove tcp:3100` **and** the :3100 service stopped. Proved from inside the emulator — `nc 127.0.0.1 3100` → *Connection refused* — while Metro stays reachable on purpose. | `B1b-office-cut-proof.txt`, `B1a-airplane-note.txt` |
| B2–B4 | One case of Campa Cola 1 L added at Prerna Super Market; the button reads **"Save on this phone"**; strip becomes **"Offline since 3:12 am · 2 waiting to send"**. The outbox holds 2 `queued` ops. | `B4-queue-order.txt`, `B5-line-added.png`, `B6-queued.png`, `B7-outbox-queued.txt` |
| B5 | Sign out. The sheet says, in the product's own words: *"2 changes have not reached the office — They stay on this phone for Amit Pawar only and go the next time Amit Pawar signs in here. Nobody else can see them. No connection — they cannot go now."* Pressed **"Sign out, keep here"**. | `B9-signout-keep.txt`, **`B9-3-leave-sheet.png`** |
| B5′ | Both ops survive the sign-out, still `queued`, file cleanly closed. The office has 0 rows for them. | `B10-outbox-after-signout.txt`, `B8-office-before.txt` |
| C | Office back. **Amit signs in again → the measurement above.** | `C0-office-back.txt`, `C1-*`, **`C2-timeline-signin.txt`**, `C3-office-after.txt`, `C4-outbox-after.txt` |
| D | Round 2, the isolation half: office cut again, a second order queued at Ansari Kirana Stores, signed out keeping it, office back — then **Rahul Deshmukh** (a different person, same distributor) signs in on the same phone. | `D1-round2.txt`, `D2-amit-kept-file.txt` |
| D | Rahul sees **none of it**: his own beat (Station Road), his own two drafts (₹1,472 / ₹1,598 of 12 Sep), "Waiting: 0", no "waiting to send" anywhere, and searching his beat for Amit's shop answers **"Nothing matches that"**. Two separate store files on the phone; Amit's untouched. **Zero `POST /sync/upload` during Rahul's whole session** — his sign-in went login → manifest (+331 ms) → pull (+409 ms). The office still had 0 rows for Amit's queued order the entire time. | `D4-rahul-sees-nothing.txt`, `D4-1..4-*.png`, `D5-while-rahul.txt`, **`D6-timeline-rahul.txt`** |
| E | Rahul signs out (no sheet — he has nothing unsent). Amit signs back in: his kept work **still goes first**, +539 ms, and arrives once. | `D7-rahul-signout.txt`, `E1-*`, **`E2-timeline-signin2.txt`**, `E3-office-after2.txt` |

## One thing that is NOT a product bug

`B3-take-order-no-op.txt` is a **retraction**, kept deliberately. Mid-walk, "Take order" and "Save on this
phone" looked dead — the cause was React Native's dev-only **LogBox banner**, which swallows presses
across the whole bottom bar, exactly as the task brief warned. With the banner dismissed both buttons work
on the first tap (`F1-take-order-retest.txt`, `F1-take-order-after-logbox-dismissed.png`). A release build
has no LogBox. Airplane mode was tried once as an extra cut and had to be abandoned: it also cuts the
emulator off from Metro, so the dev bundle cannot fetch a route it has not loaded (`B1a-airplane-note.txt`).
The office was cut the way the brief prescribes and no other way.

## Everything in this folder

`00-setup.txt` ports and tip · `01-all-in-one.log` the service · `02-request-timeline.jsonl` **the timeline
everything is measured from** · `02-proxy.log` · `03-metro.log` · `04-boot.png` ·
`A1-*` Amit's first sign-in (form, six shots after the tap, home, synced, tap time) ·
`B0-before-cut.png` `B1-cut.txt` `B1a-airplane-note.txt` `B1b-office-cut-proof.txt` `B2-after-cut.png`
`B2-order.txt` `B2a-relaunched-offline.png` `B3-shop.png` `B3-take-order-no-op.txt` (retraction)
`B4-order-entry.png` `B4-queue-order.txt` `B4-stuck.png` `B5-line-added.png` `B6-queued.png`
`B7-outbox-queued.txt` `B8-office-before.txt` `B9-1..4-*.png` `B9-signout-keep.txt`
`B10-outbox-after-signout.txt` ·
`C0-office-back.txt` `C1-*` `C2-timeline-signin.txt` `C3-office-after.txt` `C4-outbox-after.txt` ·
`D1-*` `D2-amit-kept-file.txt` `D3-*` Rahul's sign-in `D4-*` what Rahul sees `D5-while-rahul.txt`
`D6-timeline-rahul.txt` `D7-*` ·
`E1-*` `E2-timeline-signin2.txt` `E3-office-after2.txt` ·
`F1-take-order-retest.txt` `F1-take-order-after-logbox-dismissed.png` ·
`logbox-open.png` `probe-after-take-order.png` `probe3-beat.png` `probe7-deeplink.png` (diagnosis shots) ·
`tools/` `drive.mjs` (the W3C/UiAutomator2 client) `log-proxy.mjs` (**the instrument**) `signin.mjs`
`cut-order-signout.mjs` `order-offline.mjs` `queue-order.mjs` `signout-keep.mjs` `round2-isolation.mjs`
`round2b.mjs` `isolation-evidence.mjs` `outbox.sh` (read a store file off the device, read-only).

No product code was changed and nothing was committed.
