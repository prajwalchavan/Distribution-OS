# d8-fix — the D8 money-display cluster, re-walked after the repair

Walked 2026-09-21 on `qa/b2-d8-display` (worktree `.claude/worktrees/b2-d8-display`), against the four
findings the `money-web` walk confirmed: **S-183** (the offline `d8.uncounted` sentence never renders,
and `d8-hand-over` disappears with it), **S-184** (the disabled check-in button gives the van-sale
sentence as its reason), **S-168** (after the outbox drains on the same mount the figure blanks to
"—"), **S-169** (after the desk settles the crew's own trip, D8 never shows it and re-points at
another open trip).

## What I started, and what I stopped

| Thing | Where | Stopped |
| --- | --- | --- |
| `backend/all-in-one` (`DOS_MODE=all`, no inline worker) | **:3300** — :3100 free but :3200 was held by a process I did not start | yes, before returning |
| `@dos/delivery-app` (expo web) | **:5177**, `EXPO_PUBLIC_API_URL=http://127.0.0.1:3300`, `EXPO_PUBLIC_API_PREFIX=/delivery` | yes, before returning |
| headless Chromium (playwright, one context per leg) | — | yes, each leg closes its own browser |

Ports **:3000–:3007, :3200** were held by processes I did not start and were never touched. No emulator
or simulator was booted. Database: **`dos_test_b2_d8`**, created `-T dos_test_batch2b_template`, then
`pnpm db:migrate` (exit 0) and `pnpm db:seed` (exit 0). `dos` and `dos_qa` were never connected to.

**Fixture honesty.** Every fixture was built through the running HTTP API as the real roles (driver
signs in on the app, takes cash at a door with `context.setOffline(true)`; the desk calls
`delivery.trips.return` as the manager and `delivery.trips.settle` as the accountant) — with ONE
exception, recorded here rather than left out: two trips (`f352817e…` sai, `ef3aa4e3…` kalyan) were put
back from `closing` to `active` with a direct `UPDATE trips SET state='active', ended_at=null` on
`dos_test_b2_d8`, because an earlier aborted attempt of my own had already returned them and the seed
carries exactly one active trip per driver. Nothing else was written by SQL, and no ledger row was
touched.

Every hop after sign-in is CLIENT-SIDE (a rail link at 1280, the home button or the More sheet at 390).
A `page.goto` reloads the SPA, and a browser device store is memory-only here — the strip says
"Not kept in this browser" — so a reload empties exactly what the phone is supposed to be holding.
Because the store is memory, the app correctly uses the DOS-179 **tab twins** of every D8 sentence.

---

## Item 5(A) — offline with one receipt held (both widths)

`desk-a` = 1280×800, driver `ganesh.more` (Tarsun), trip TRIP-ACTIVE, float ₹5,000.
`phone-a` = 390×844, driver `balu.shirke` (Kalyan Agencies), trip TRIP-ACTIVE, float ₹5,000.
Both took ₹1,544 of cash at a delivered door with the context offline.

| phase | `d8-expected` | `d8-hand-over` | `d8-uncounted` | check-in button |
| --- | --- | --- | --- | --- |
| 1. online, nothing held | ₹5,000.00 | "Hand ₹5,000.00 to the cashier" | — | enabled |
| 2. **offline, holding ₹1,544** | **₹6,544.00** | **"Hand ₹6,544.00 to the cashier"** ✔ | **"This tab holds ₹1,544.00 in receipts that have not reached the office yet…"** ✔ | **disabled**, reason **"1 records held in this tab only have not reached the office yet. They go first; check in when the strip reads Updated."** ✔ |
| 3. back online, **same mount** | **₹6,544.00** ✔ (never "—") | "Hand ₹6,544.00 to the cashier" | gone once the queue drained | enabled |
| 4. re-opened | ₹6,544.00 | same rupee | none | enabled |

Identical line for line at both widths (`d8-fix-desk-a.txt`, `d8-fix-phone-a.txt`).

- **S-183 fixed.** The sentence and the hand-over line both render offline. They are now drawn OUTSIDE
  `<Async state={preview}>`, which paints "No connection. This is not the current picture." over its
  children on every offline mount; only the office's own three figures go blank now.
- **S-184 fixed.** The reason is `d8.pendingBlocks`, the sentence the DOS-168..170 ruling names for this
  state. `d6.online` ("A van sale needs a signal…") appears nowhere on D8. The gate itself is unmoved:
  the button is disabled in both the old and the new order.
- **S-168 fixed.** Sampled every 2 s across the drain window (14 samples per leg): `d8-expected`
  never reads "—". **One honest wrinkle**: at the single sample where the queue reaches 0 (t+14 s desk,
  t+12 s phone) the figure shows **₹5,000.00** for ~2 s — held money has gone to zero and the office's
  answer has not come back yet — and then settles at ₹6,544.00 when the refetch lands. That is a
  round trip, not a stale mount: before the fix the figure stayed "—" until D8 was re-opened.

## Item 5(B) — the desk settles while the phone holds the receipt (both widths)

`desk-b` = 1280×800, `ganesh.more`; `phone-b` = 390×844, `sachin.dalvi`; `desk-c` = 1280×800,
`balu.shirke` (the extra leg that also walks the hand-over). In each: phone offline holding ₹1,544, the
desk calls `trips.return` (200) then `trips.settle` (200, variance 0, van counted as expected), the
phone comes back online, the op is refused.

**The tray, at both widths** — founder answer A, unchanged by this repair:

```
Refused: 1 · Waiting: 0
"this trip has already settled; hand this money to the cashier and record it at the office, not on the trip"
"Take money · trip_settled · 21 Sep, 12:21 pm"
"₹1,544.00 Cash from Prerna Super Market"
action: "Handed to the cashier"
```

**D8 re-opened** — the half that used to fail:

| | desk-b (1280) | phone-b (390) | desk-c (1280) |
| --- | --- | --- | --- |
| trip shown | **TRIP-ACTIVE · 12 Sep 2026**, chip **Closed** | same | same |
| `d8-expected` / `d8-hand-over` | **₹6,544.00** = the settled `expectedCashPaise` (654400 p), "The office expected ₹6,544.00 from this trip" | ₹6,544.00 | ₹8,088.00 = 808800 p |
| `d8-uncounted` | **"This tab holds ₹1,544.00 in receipts, none of it saved, that reached the office after this trip was settled. Hand any cash to the cashier; the office records the rest."** | same | same |

**S-169 fixed.** D8 shows the settled trip and never more than its settled `expectedCashPaise`, and
`d8.uncountedSettled` — the sentence the money-web walk recorded as "never seen render" — renders at
both widths. The 1280 legs are the exact condition of the finding: each driver also has an OPEN
`TRIP-NEXT`, which is what D8 used to jump to, reading out that trip's ₹3,000 float.

**The documented trade, walked (`desk-c` phase 6).** Tapping the tray's "Handed to the cashier" makes
the money the cashier's (`_pending = 'kept'`), the trip stops being owed, and D8 goes straight back to
`TRIP-NEXT · 14 Sep 2026` with its own ₹3,000 float and no note. So a crew member sees the settled trip
here only until they have handed the notes over, which is the one action the tray is asking for.

## Screenshots

`d8-fix-desk-a-p1-online-baseline.png`, `-p2-offline-holding`, `-p3-online-same-mount`, `-p4-reopened`;
the `d8-fix-phone-a-*` set; `d8-fix-desk-b-p2-offline-holding`, `-p5-tray`, `-p5-d8-after-settle`;
`d8-fix-phone-b-p5-tray`, `-p5-d8-after-settle`; `d8-fix-desk-c-p5-d8-after-settle`,
`-p6-d8-released`. Full DOM transcripts in `d8-fix-{desk-a,phone-a,desk-b,phone-b,desk-c}.txt`.

## Not proven here

1. **Any device.** No Android and no iOS leg: this block owns a web repair and did not boot the
   emulator. A phone with the real SQLite store may hold a cached settlement preview, so the offline
   branch of `dayEndCash` (which only runs when there is no preview at all) is web-proven only.
2. **Airplane mode.** What is walked is `context.setOffline(true)` in a browser with no persistent
   store, which is why every sentence above is the DOS-179 tab twin.
3. **A helper's phone.** Risk (e)(2) of the ruling — a helper's landed receipt masking this phone's own
   — is closed in the rule and covered by `s183-offline-money.test.ts`; two phones on one trip were
   not driven.
4. **The 2-second ₹5,000 sample** at the drain moment is reported as measured; whether a real device
   on a slow link widens that window was not tested.
5. **The check-in itself** was never pressed: no `trips.return` was made from the app in these legs
   (the desk made it), so this walk says nothing new about DOS-169's gate beyond that it holds.
