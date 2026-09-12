# 07 — Retailer / Shopkeeper review (Phase 1, walked 2026-09-12)

Who: Ramesh Gupta, signing in for Shree Ganesh Kirana (R-0001, Station Road, Kalyan West) — a C-tier kirana with a ₹50,000
strict credit limit that buys from all three seeded distributors (Tarsun, Sai, Kalyan). Web at desk and phone width, the Pixel 7
debug build, and the iOS simulator for sign-in and home. Findings: `QA/findings/06-walkthrough-retailer.md` (DOS-094 … DOS-105).
Evidence: `QA/evidence/phase1/retailer/`.

## 1. Answer to the phase question — "Would a normal shopkeeper actually want to use this? Is it easier than calling my distributor?"

**For looking, yes. For paying and complaining, no — and one of the two money buttons is dangerous.**

What a shopkeeper gets that a phone call never gave him: every bill with what is left on it, oldest first, coloured by age; a
statement with a running balance; every receipt; the offers running this week; where his order is (with the van's stop number
and expected time); his shop's details he can correct himself; three distributors behind one sign-in. All of that loads clean,
reads in plain words ("You owe", "Past its date", "Money with them") and agrees with the database to the rupee. Placing an order
is genuinely two taps per product and the order lands in the office queue with the same credit hold a rep's order gets.

What stops him:

1. **"Pay everything" would make him pay the wrong amount** (DOS-094, P0). The screen says ₹35,843; the UPI string it hands to the
   phone says ₹5,472 against INV-0753, and for a single part-paid bill it asks for the bill's original total, not what is left.
   The office tells him to quote PAY-…; the UPI reference is the invoice number. On a real phone the intent URL is malformed
   (`upi://pay?upi://pay?…`) and opens nothing. Until this is fixed the Pay button is worse than no button.
2. **The order screen lies about the price** (DOS-096, P1): everything is ex-GST and never says so; "You pay ₹5,237.68" became
   ₹5,855.00 on placing. A shopkeeper compares "₹7.54 per piece" with MRP ₹10 and thinks he makes 25 %.
3. **"Order again" reorders the wrong basket** (DOS-098, P1): a six-week-old rep order, not his last one.
4. **He cannot open, print or share a single bill** (DOS-099, P1) on web or Android — the PDF URL comes back relative.
5. **He cannot order pieces** (DOS-101): cases only, so the "Only 9 pc left" item can only be ordered as 24 and short-supplied.
6. **He cannot reach anyone** (DOS-103): no phone number, no reply, no "report a problem". Returns says "message Tarsun
   Enterprise" and offers no way to.
7. **The statement hides his last four payments** (DOS-095, P1) — the exact document he would use to argue with the distributor.

Is it easier than calling? Checking dues, yes, clearly. Ordering, yes once the price is honest and pieces exist. Paying, not yet.
Complaining or returning, no — the app sends him back to the phone without the number.

## 2. What I did, screen by screen

| # | Screen | Web desk | Web phone | Android | iOS | Notes |
|---|---|---|---|---|---|---|
| R1 | Sign-in | ✓ r-01 | ✓ p-01 | ✓ android-login | ✓ ios/-0,-1,-2 | Lands in the first distributor without asking (DOS-102). Password change, wrong-current, mismatch, other-device sign-out all tested (r-25…r-28). |
| R2 | Home / distributor cards | ✓ r-01 | ✓ p-02 | ✓ a-01, a-02 | ✓ home | Switch Tarsun → Sai → Kalyan → Tarsun (r-20, r-21): dues, bills, live delivery re-read per tenant. Only the active card shows an amount (DOS-102). |
| R3 | Money due | ✓ r-02-dues | ✓ p-04 | ✓ a-04 | — | Buckets sum to ₹35,843; all six bills past due; "Pay this bill" per row. |
| R4 | Bill detail | ✓ r-12, r-15 | ✓ p-05 | ✓ a-06 | — | Lines, GST split, rounding, POD ("Signed for by Jayesh Shah"), receipts link. PDF: "still making … try again in a minute" first, then Open/Print — both broken (DOS-099, a-11 LogBox on Android). |
| R5 | Pay | ✓ r-13, r-14 | ✓ p-06 | ✓ a-08…a-10 | — | Amount editable, bill pick optional, "Start the payment" → intent (DOS-094). Desk shows the raw upi:// string as text, no QR. |
| R6 | Statement | ✓ r-02-statement | — | — | — | 50 entries then closing balance (DOS-095). Filters 30/90 days/this year. |
| R7 | Place order | ✓ r-03…r-08 | ✓ p-03 | ✓ a-13…a-16 | — | Search works; case stepper only (DOS-101); "Stock not known" ×14 (DOS-097); ex-GST (DOS-096); SO-0885 submitted with a credit hold nobody tells the shop about (DOS-100); SO-0887 from Android. |
| R7b | Order again | ✓ r-16, r-17 | — | — | — | Repeats SO-0450 of 30 Jul (DOS-098); server draft on tap. Placed as SO-0886 and cancelled with a reason (r-18, r-19). |
| R8 | My orders / order detail | ✓ r-03-orders, r-09…r-11 | ✓ p-07 | ✓ a-16, a-19 | — | "You placed it" vs "Their salesperson"; timeline; partial delivery shows stop, ETA and the bill; cancel from the shop works on web and Android. |
| R9 | Offers | ✓ r-03-deals | ✓ p-08 | — | — | 14 running schemes in shop language; "Rates you asked for" shows the rep's bargains as "You asked" (DOS-105). |
| R10 | Request discount | ✓ (button seen) | — | — | — | "Ask for a better rate" on every basket line; not exercised (the rep's bargain on this shop is still pending and I did not want a second one in the office queue). NOT TESTED. |
| R11 | My shop | ✓ r-03-shop, r-22, r-23 | — | — | — | Prefilled from the DB; alt phone + landmark saved (db-08); invalid GSTIN blocks Save with a message; restored afterwards. |
| R12 | Messages | ✓ r-03-inbox, r-24 | — | — | — | WhatsApp copies with Sent/Delivered/Read; the SO-0886 cancel message arrived within a minute. One-way (DOS-103). |
| R13 | Receipts | ✓ r-02-receipts, r-29 | — | — | — | 25 rows = DB; total ₹1,47,576 = DB; rows are not openable (no detail) — acceptable. |
| — | Returns | ✓ r-03-returns | — | — | — | Four credit notes, badge "To pay" (DOS-105); no way to raise one (DOS-103). |
| — | My account | ✓ r-03-settings, r-25 | ✓ (More sheet) | ✓ (More sheet, below the fold) | — | Devices list with "This one"; revoke works. |
| — | API permission probes | ✓ api-02 | — | — | — | Other shops / other tenant → 404; staff-only → 403; own rows only. Clean. |

iOS: Expo Go sign-in and home only (`ios/retailer-ramesh.gupta-2-home.png`, VoiceOver labels read "35843 rupees"); the deeper
screens were not driven on iOS (no per-screen Appium script yet) — NOT TESTED beyond home, same as the earlier roles.

## 3. Business trace of the walk (what the office would see)

- SO-0885, ₹5,855.00, submitted 6:43 pm from the retailer app, three lines (one knowingly short: 24 pc UHT milk against 9 in
  stock), approval `credit_limit` pending — the office must decide it (like the rep's SO-0879 on the same shop). No reservation
  rows yet (reserved at confirm).
- SO-0886 (₹10,119, the "Order again" repeat) cancelled 6:48 pm, reason "Ordered by mistake — QA"; WhatsApp "cancelled" queued.
- SO-0887 (₹854, Android) cancelled 7:1x pm, reason "QA-Android-test".
- Four payment intents on the shop (PAY-13c1dede2871 and PAY-9520ecba4571 ₹35,843 from web and Android; PAY-000000000001
  ₹35,843 and PAY-000000000002 ₹4,561 from the API), unpaid, expiring within 30 min.
- Shop R-0001: alt_phone `+919892000099`, address.landmark "Opp. Kalyan station, QA edit" (self-edit, kept as evidence).
- Sessions: the shop's old browser session revoked; "QA curl retailer" and the Android/iOS sessions exist; password unchanged.
- INV/0753 now has a rendered PDF (worker, on first request).

## 4. Friction a shopkeeper would feel

- Landing in Tarsun with no choice, then three cards of which two are blank buttons; ₹91,494 of total dues never shown together.
- Cases only. "Only 9 pc left" + a 24-piece case = an order he knows will be short.
- "You pay" that is 12–18 % less than the bill; per-piece rates that do not multiply to the line.
- The bill's "still making the PDF, try again in a minute" on a bill from 3 September.
- No phone number anywhere. "Message Tarsun Enterprise" with no message box.
- A credit note badged "To pay". A cancelled order that still says "You pay ₹1,977".
- "Updated just now" is honest and useful; "Order again" under it is not.
- Payments: the reference to quote is on screen but not in the UPI string; on the desk there is no QR to scan.

## 5. Not tested / out of scope for this role

- "Ask for a better rate" (bargain request) — not exercised, see R10.
- iOS beyond sign-in and home.
- The actual UPI hand-off on a device with a UPI app (the emulator has none); judged from the string the app builds.
- Offline: none by design for this app (docs/23 §6.4); "Updated N min ago" strip was observed only online.
- Deep link / OTP sign-in (docs/23 R1: future).
- Directory opt-in, WhatsApp opt-in consent — no screen exists.
