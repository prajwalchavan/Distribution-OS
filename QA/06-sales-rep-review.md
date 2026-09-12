# 06 — Sales Rep review (Phase 1, walked 2026-09-12)

Salesperson `rahul.deshmukh` on the sales app (:5175, sales-service :3003), database `dos_qa` (realistic seed). Web at 1280×800 and
390×844 (Playwright, headless Chromium 145), Android on the Pixel 7 emulator (API 36, debug APK, API over `adb reverse`, offline by
removing the reverse and force-stopping), iOS on the iPhone 16 Pro simulator (Expo Go) for sign-in and home. Findings:
`QA/findings/05-walkthrough-sales.md` (DOS-073 … DOS-093). Evidence: `QA/evidence/phase1/sales/` (+ `android/`, `ios-*.png`).

Saturday morning as Rahul: 30 shops on three beats, ₹19 lakh owed to Tarsun by them, 14 live schemes, a 3% bargain bound. I walked
his own beat list, a shop card, recorded a visit, built a 12-line order with every scheme type, hit the messy cases (zero stock,
over stock, discontinued, expired, withdrawn, changed price, on-stop, over-limit), asked for rates inside and outside my bound,
cancelled, repeated, onboarded a shop, read my numbers, and did the whole thing again with the signal cut on web and on the Pixel.

## 1. Answer to the phase question — "Can I place an order at a shop in under a few minutes?"

**On the website, yes — a repeat is three taps and a fresh 12-line order took under two minutes, priced on the phone with the
schemes right to the paisa.** On the Pixel, **no**: the catalog rows draw as 171 blank "Add a case" buttons (DOS-077), so the only
usable path is "Repeat last order". And on both, what I tell the shop is not what the office will bill:

1. **The stock hint lies** — "0 cs available" for an item with ten cases in the godown, because the app reads the first 500 lot rows
   and stops (DOS-074, P1).
2. **Two schemes the office published do not behave**: the 2%-over-₹25,000 offer never fires (DOS-075, P1) and one packet of Too
   Yumm gives 2% cash discount on the whole bill (DOS-076, P1) — the seeded invoices already carry it.
3. **The total I read out is "before GST"**; the order says ₹32,030 a screen later, and even that misses the cess on aerated
   drinks (DOS-083, DOS-079). A price the office changed while I was at the counter lands silently (DOS-082).
4. **Credit**: the app says "the office has it" for a strict shop that is all overdue (held), a stop shop (held) and a warn shop
   already ₹68,000 over its limit (confirmed, nobody warned) — the rep and the shop learn nothing (DOS-081).
5. **A rep can cancel a colleague's confirmed order through the API** (DOS-073, P0).

And under the hood, every sign-in costs ~500 `/sync/pull` round trips and every screen ~55 more (DOS-080, P1) — invisible on
localhost, fatal at lakhs of devices.

## 2. What I did, screen by screen

| Screen (docs/23 §3) | Walked | Verdict |
|---|---|---|
| S1 Aaj ka beat | web desk + phone, Android, iOS | Renders well, counters sync across devices; opens on Station Road on a Saturday (DOS-084); red = overdue only (good); on-stop shops carry no marker |
| S2 Shop card | web ×6 (strict, stop ×2, warn, new), Android ×2 | Owes/limit/overdue, ageing sums to the outstanding, Orders 25, Bills 6, schemes (6 of 14, DOS-088), buying pattern, contact; "credit checked when submitted, not here" (DOS-081) |
| Record a visit | web | Outcome chips + reason + position; POST /visits 200; dialog stays open after "Visit recorded" |
| S3 Order entry | web (12-line scheme order, repeat, search, stepper), Android (blank rows, DOS-077) | Device pricing = server pricing per line; stock hint wrong (DOS-074); zero stock/over stock accepted (DOS-078); no keypad, pieces only up (DOS-085); "before GST" only (DOS-083) |
| S4 Bargain | web | ₹14.30 (2%) auto-approved and re-priced; ₹13.00 (11%) queued; orderId dangling (DOS-090) |
| S5 Submit & status | web, Android | Place order = create + submit, no confirmation step; "Order placed" even when held (DOS-081); status block on the detail is honest ("Waiting for the office · Credit limit") |
| S6 My orders | web, Android | Needs you (attention tray) / Travelling / All / Drafts; cancel with reason works (DOS-092 labels) |
| S7 New shop | web | Name/owner/phone/address/beat/position/tax; R-9025 created, in the beat at once; behaviour 404 (DOS-093) |
| S8 Visits | web | Today's and earlier visits with outcomes and reasons |
| S9 Performance (Me) | web, Android | Strike rate, 30-day sparkline, targets (visits 143%, value 81%), August payout ₹6,000 approved |
| S10 Losing | web | Three shops with risk % |
| S11 Catalog | web | All / Deals (14) / In stock with MRP and the same wrong hint |
| S12 Bills | web | Listed with paid-of amounts; cannot open or show one (DOS-091) |
| S13 Drafts + Inbox | web | WhatsApp/voice intents parsed with confidence, confirm dialog leaves unmatched lines out; inbox from/to shops |
| S14 Me / Settings | web | Device list ("Unnamed device" ×4 from my API logins), sign-out-others |
| Offline | web (one session), Android (adb reverse cut) | Reads from the local copy on both; web write queued, uploaded, parked as a draft (DOS-086); Android write untestable beyond the blank list (SO-0884 was placed online by tapping blind) |
| Permissions | API probes | costs/pack-configs/staff/audit/credit/procurement/beats → 403; other tenant → 404; other rep's orders → 200 read AND 200 cancel (DOS-073); outstanding.get → 200 (needed, fine) |

## 3. Business trace of the walk (what the office would see)

| What I did | Server wrote | What the screen said |
|---|---|---|
| Visit at Shree Ganesh, "Ordered" | visits row 17:26, outcome ordered, no position | "Visit recorded"; home "5:26 pm · Ordered", Visited 1 |
| 12-line order at Shree Ganesh (strict, all overdue) | SO-0879 submitted, ₹32,030.00 (sub 29,534.12 − 794.42 + GST 3,290.50, no cess), approval credit_limit pending, stock reserved | "The office has it, with its number and its price." — footer ₹28,739.70 before GST |
| 1 cs at Patil (stop) → cancelled it | SO-0880 submitted + credit_limit → cancelled 17:46, approval Expired | same "office has it"; detail "Cancelled" |
| 1 cs at Navjeevan (warn, over limit) | SO-0881 confirmed, no flag, no approval, 78 pcs reserved | same "office has it" |
| Bargain ₹14.30 / ₹13.00 on Balaji | bargain auto_approved / requested, orderId of a draft that was never posted | "Inside your limit — approves at once" / "Over your limit — the office decides" |
| Price changed 26.08 → 27.50 mid-draft | SO-0882 submitted at 27.50 | ₹1,877.76 until the tap, ₹1,980.00 after |
| Offline order at Om Sai (web) | sync_ops 2 × ok, draft ₹780.00; submitted by hand → SO-0883 confirmed | "Saved on this phone … Submit it from My orders once it lands" |
| Blind tap on the Pixel at Laxmi Narayan | SO-0884 confirmed, Campa Cola 500 ml × 24, ₹303 | "Campa Cola 500 ml · 1 cs · ₹270.96 · Order placed" |
| New shop | retailers R-9025, beat Khadakpada, indicate/limit 0/tier C, onboarded_by Rahul | card opens; behaviour 404 in the console |
| Probe: cancel Amit's SO-0870 | cancelled, reason stored, reservation released | (API) 200 |

Pricing cross-check on SO-0879, device vs server vs my arithmetic: Balaji 3 cs 2,100.96 → −84.04 (4%) ✓; ghee 200 ml 3,229.44 → −193.77
(6%) ✓; ghee 1 L 5,007.28 → −300.44 ✓; Konkan 1,244.88 → −124.49 (10%) ✓; MOM 3,834.24 → −76.68 (2% slab) ✓; Sunbake 72 pcs → 6 free ✓;
Campa 2 cs → 2 free ✓; Neelam Rose (expired) 0 ✓; Annapurna oil (withdrawn) 0 ✓; Atta 2 cs → −15.00 (named per case: DOS-087);
order-level 2% on ₹28,739.70 → absent (DOS-075); Too Yumm cash 2% → reported on the whole order (DOS-076, not shown to the rep at all).

## 4. Friction a rep would feel

- Tapping "Pieces" eighteen times; no way back down a piece; "−" at zero cases throws the pieces away.
- The morning list is the wrong beat until you tap; then it forgets after a reload.
- "Order placed" that means "held"; "The office checks the credit … not here" on a shop that is all overdue.
- A total without GST at the counter, with GST on the next screen, without cess on the bill.
- Six schemes on the card, fourteen in the catalog, the launch offer in neither place a rep looks at the door.
- A bill you can list but not open; "Due 10 Sep · 2 days" that means overdue.
- On the Pixel: a wall of identical buttons where the products should be.

## 5. Numbers behind DOS-080 (sales-service log, this afternoon)

| Minute (IST) | /sync/pull calls | What was happening |
|---|---|---|
| 17:22 | 512 | web sign-in |
| 17:26–17:27 | 690 | shop card + order entry opened |
| 17:30–17:31 | 260 | order entry reloaded (55 of them inside one 4 s capture) |
| whole log | 1,801 | three devices (web ×2, Pixel) |

Cursor values decoded from consecutive calls: `2026-09-12T07:20:46.655701Z`, `.656751Z`, `.657478Z`, `.657900Z`, `.658276Z`,
`.658734Z` — one millisecond per round trip through the seed's write burst, 6–21 rows each with `limit=500`.

## 6. Not tested / out of scope for this role

- iOS beyond sign-in and home (the Android walk stands in, as in the earlier roles; Expo Go on the simulator has no per-app sandbox).
- Change password (would invalidate the shared seeded password); "Pin this spot"/"Tag my position" (headless Chromium denies
  geolocation — "No position" is the harness, not the product).
- Confirming a WhatsApp draft into an order (dialog opened and read, not placed — it would have created a fourth order at Shree Ganesh).
- Rep-authorised brands (`tenantCatalog.repAuthorisations`, docs/23 S3 MISSING) — no procedure to exercise.
