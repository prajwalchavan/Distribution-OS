# 05 — Delivery review (Phase 1, walked 2026-09-12)

Delivery crew `ganesh.more` on the delivery app (:5177, delivery-service :3005), database `dos_qa` (realistic seed). Web at
1280×800 and 390×844 (Playwright, headless Chromium 145), Android on the Pixel 7 emulator (API 36, debug APK, system camera),
iOS on the iPhone 16 Pro simulator (Expo Go) for sign-in and home. Findings: `QA/findings/04-walkthrough-delivery.md`
(DOS-056 … DOS-072). Evidence: `QA/evidence/phase1/delivery/` (+ `android/`, `ios-*.png`).

The trip driven was the seeded `TRIP-ACTIVE` (12 Sep, 10 stops, 3 already delivered): nothing can be loaded through the app today
(DOS-039), so no new trip could be started. The walk delivered stops 4, 7, 9 and 10 in full, part-delivered stop 5 with a case taken
back, failed stop 6, collected cash and UPI, recorded a diesel expense, tried to send papers, and repeated the door work with the
network cut on both web and Android.

## 1. Answer to the phase question — "Can I complete deliveries even with poor network?"

**No.** With signal, the door work is quick and writes the right things (delivery, lines, photo, credit note, receipt, stop and
order states, the day's cash reconciliation). Without signal:

1. **A delivery is lost.** On Android "Record the delivery" does nothing — no queue, no message — and the record never exists.
   On web it is queued, then refused by the office because the photo could not be uploaded, and the driver is shown the server's
   JSON with a retry button that sends nothing (DOS-056, P1).
2. **The phone does not admit it is offline** — the strip stays "Updated just now"; history says "unknown" (DOS-068).
3. **The real trip is unreachable offline**, because the home shows the wrong trip and the way to today's trip needs the network
   (DOS-061, P1).

And with signal, three things a distributor would refuse to run with:

4. **No paper reaches the shop.** Open, Print and Send on WhatsApp all hang on a relative signed URL; receipts have no PDF at all
   (DOS-057, P1).
5. **A "Damaged" return goes back to saleable stock** (DOS-058, P1) and **receipt numbers are issued twice** with nothing in the
   database to stop it (DOS-059, P1).
6. **Typing 4756 on the phone records ₹47.56** (DOS-060, P1).

## 2. What I did, screen by screen

| Screen (docs/23 §5) | Walked | Verdict |
|---|---|---|
| D1 Today's trip | web desk + phone, Android, iOS | Renders well; picks TRIP-NEXT (14 Sep) as today, calls a draft sheet "38 cartons on board", buries TRIP-ACTIVE (DOS-061) |
| D2 Start trip | web (reached by tapping TRIP-ACTIVE) | Dead end for a trip already on the road: "The godown has to load the vehicle" with DC-0081 confirmed (DOS-061) |
| D3 Stop | web ×5, Android ×4 | Call / maps / expected / arrived / dues / bills; arrive goes through the outbox and syncs; no overdue or credit-mode signal (DOS-066); stale after writes (DOS-063) |
| D4 Deliver / Partial / Failed | web (full, partial, failed), Android (full, offline) | Full and partial write correctly (CN at line rate + GST + cess); case-only stepper (DOS-064); Damaged → saleable (DOS-058); offline lost (DOS-056) |
| D5 Collect | web cash, Android UPI, cheque fields inspected | Receipt + FIFO allocation + summary in one second; no receipt shown after, bill still "owed" (DOS-062); duplicate numbers (DOS-059); paise keypad (DOS-060) |
| D6 Van sale | NOT TESTED — no van stock on the vehicle that the app could sell (the load-out is blocked by DOS-039; TRIP-ACTIVE's "Still on the van" lists lots with no quantity) | — |
| D7 Expenses | web | Records; no proof needed; lands on the wrong trip (DOS-061, DOS-071) |
| D8 Day summary / check-in | web, Android (read) | Totals reconcile (float + cash − spent); "Check the vehicle in" NOT pressed — it would close the seeded trip with stop 8 open and the founder's TRIP-ACTIVE is the only usable trip for the sales and retailer walks |
| D9 Send the papers | web, Android | Invoice PDF renders ~2 min after the request; every button then fails on the relative URL (DOS-057); receipts never rendered; lists ten old receipts and all messages (DOS-065) |
| D10 Needs attention | web (offline + refused), Android (waiting) | Honest counters; refusal shown as raw zod JSON; "Send it again" sends nothing (DOS-056) |
| D11 Trip history | web, Android, Android offline | List works online; KPI "first attempt 0%" wrong; TRIP-NEXT missing; offline "unknown" (DOS-067, DOS-068) |
| D12 Me | web | Session list with raw user-agents; consent withdraw button; targets; inbox full of shop messages (DOS-065) |
| Change password | web (opened) | Form present; not submitted (would invalidate the seeded password other walks use) |
| Backgrounding / termination | Android | Background 20 s → state kept; force-stop + relaunch → signed in, lands on home (DOS-061 home) |
| Offline | web (one session), Android (adb reverse cut) | Arrive queued and synced with offline timestamp on both; delivery lost (DOS-056) |
| Permissions | API probes with the delivery token | outstanding list / staff / settle / cancel / trace / positions → 403; other driver's trip → 404; own 32 trips only; credit limit returned in retailers.get (DOS-072) |

## 3. Business trace of the walk (what the office would see)

| Stop | Did | Server wrote | Screen after |
|---|---|---|---|
| 4 Vaibhav Kirana Mart | delivered INV/0825 in full, photo + receiver; cash ₹7,856 book GM-1042 | stop delivered, SO-0855 delivered, 2 POD rows, RCPT-0698 → INV/0099 (June), outstanding 75,228 → 67,372 | "Not started" until reload; "Owes ₹75,228" until reload |
| 5 Joshi Kirana Stores | part-delivered INV/0826, 1 cs Campa Cola back as "Damaged" | stop partial, SO-0856 partially_delivered, CN/9003 ₹768 `return_saleable`, ledger +24 pc saleable on the vehicle, INV/0826 partially_paid, outstanding −768 | correct after reload |
| 6 Ansari Kirana Stores | failed: "Shop had no money" + note | stop failed, SO-0857 back to packed, INV/0827 issued, goods on the van, StopFailed + OrderReturnedUndelivered | "Not delivered · Shop had no money — …" |
| 7 Nakshatra Kirana (Android) | delivered INV/0829 with camera photo; UPI ₹4,756 UTR 425512345678 | stop delivered, POD photo (JPEG stored) + geo, RCPT-0699 → INV/0404 + INV/0473, outstanding 25,825 → 21,069 | "Owes ₹25,825" until re-entry; bill still "owed ₹4,756" |
| 8 Laxmi Narayan Stores | arrived; delivery attempted offline (web) | stop arrived; delivery refused on sync (row_invalid pod[0]) | tray: JSON |
| 9 Khan General Store | delivered INV/0833 (the accidental online run) | stop delivered, 2 POD rows | — |
| 10 Rukmini Provision (Android) | delivered INV/0835 while "offline" — the request rode a keep-alive socket through adb reverse (environment, see ENV.md) | stop delivered | — |
| TRIP-NEXT stop 1 (Android offline) | arrived offline → synced; delivery lost | stop arrived 16:48:54; no delivery | — |
| Expenses | diesel ₹500 | trip_expenses on TRIP-NEXT (14 Sep) | "Expense recorded" |

Day summary for TRIP-ACTIVE at the end: cash ₹7,856, UPI ₹4,756 (Android), spent ₹0 → "Hand ₹12,856 to the cashier" before the UPI;
consistent with the receipts table.

## 4. Friction a driver would feel

- Two rows of chips for one decision on a return (saleable / damaged bin, then refused / damaged / expired) — and the obvious tap is wrong.
- Every write leaves a screen that still shows the old state; the driver learns to pull-to-refresh or not to trust it.
- "Send the papers" is a scroll of ten old receipts and twenty messages before anything of today.
- The amount keypad hides the rupee/paise convention; the web field takes rupees.
- The Start-the-trip screen for a trip that has left; "Back to the trip" that lands on a different trip.
- Nothing tells the crew that a shop is overdue or on `stop`.
- "Not ordered" on a bill line; "unknown" as an error; a zod array as a refusal.

## 5. Not tested / blocked

- D6 van sale (no sellable van stock reachable — blocked by DOS-039), check-in / settlement (deliberately not run on the only live trip),
  GPS trace and consent withdrawal side effects, cheque collection end to end (fields inspected only), reassignment (no screen; desk),
  returns pick-up outside a delivery, iOS beyond sign-in and home (Expo Go, no camera/share exercised), a real printer.
- Offline on iOS: NOT TESTED.
