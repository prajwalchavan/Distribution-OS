# 02 — Owner review (Phase 1, walked 2026-09-12)

I spent the owner's morning in the product as Sunil Tarsun, owner of Tarsun Enterprise (Kalyan): the desk (web, 1280×800), the same site at phone width (390×844), the Owner app on the Pixel 7 emulator and on the iPhone 16 Pro simulator (Expo Go). Everything below is what I saw and did; every number was checked against `dos_qa`. Findings with evidence blocks are in `QA/findings/01-walkthrough-owner.md` (DOS-001 … DOS-019); this file is the narrative.

Harness: `QA/tools/pw-server.mjs` (one headless Chromium kept alive), `pw.mjs` (one command per call: goto/shot/click/do/login…), `pw-audit.mjs` (console + failed-request sweep over routes), `pw-net.mjs` (saves every API response of a page). Evidence: `QA/evidence/phase1/owner/` — `10-*.png/.txt` one per route at desk width, `50-phone-*.png`, `2x/3x-trace-*` the money trace, `4x` approvals, `6x/7x` actions, `android/`, `ios/`, `net-home/` the home page's API responses.

## 1. Answer to the phase question — "Can I understand the health of my business within a few minutes?"

**Mostly yes on the desk, with one number that lies.** The Today screen gives invoiced, collected, outstanding/overdue, orders, a sales-vs-previous line, brand mix, ageing, at-risk stock and a "Needs you" list, all labelled "as of hh:mm". Four of the five tiles matched the database to the paisa. But:

- the ageing widget on Today shows **90+ = ₹0.00** while ₹35,144 is over 90 days old (the Money screen shows it) — DOS-001, P1;
- the brand mix has **two "Other" slices** and hides Neelam, the 4th brand — DOS-002;
- "Outstanding" is ₹35,080 higher than the trial balance's debtors because money received on account is not netted — DOS-016;
- the approvals the owner is asked to make **never name the shop, the order or the amount** — DOS-004, P1.

So the owner gets the shape of the day in two minutes, then has to phone someone for every decision.

## 2. What I did, screen by screen

| Area | Walked | Verdict |
|---|---|---|
| Sign-in / session / sign-out | web, Android, iOS | Works. Refresh is transparent; sign-out returns to /sign-in. Change-password screen present (not exercised — it signs out other devices). |
| Today (dashboard) | web desk + phone, Android, iOS | Numbers correct except 90+ ageing (DOS-001); brand mix (DOS-002); "2 trips active" is 1 active + 1 planned (DOS-018); "Needs you (5)" lists 6 (DOS-019). Same tiles on all three platforms. |
| Approvals | web, Android | Rows and panel show entity types, no shop/amount (DOS-004). Approve/reject are two-step with a mandatory note — good. Decision persists with the note. Bargains are listed twice and the reject does not reach the bargain request (DOS-005). Credit-limit approval confirms the order, does not change the limit (DOS-006). |
| Live map | web | A table, no map (DOS-017). "Open in maps" links out. |
| Orders | web desk + phone, Android | Search works (global search → filtered list). Detail panel has no product names (DOS-003). List unsorted (DOS-009). Phone rows drop the shop (DOS-010). Actions on a delivered order shown disabled (DOS-012 note). Export CSV queues a *daily sales* export silently (DOS-014). |
| Trips | web | List of trips with stops n/n and state; "Amount ₹ 5,000.00" on every row is opening cash (DOS-018). Unsorted. |
| Money → Outstanding | web desk + phone, Android | Correct buckets incl. 90+; shop-by-shop table with beat, overdue, open bills, oldest due, credit policy — this is the best screen in the app. "Rebuild ageing" does nothing (DOS-015). |
| Money → Receipts | web, Android | List by mode with filters; receipt panel lacks allocation and cash discount (DOS-011). Actions Bank it / Mark bounced / Reverse receipt present (not exercised — Phase 2/7). |
| Money → Books | web | Trial balance balances; day book present. AR vs dashboard outstanding differ by unallocated credit (DOS-016). "Cash with delivery crews ₹1,52,536" is a seed artefact (see findings file, not filed). |
| Money → Claims | web | Claim ageing by supplier, claims table with status; consistent totals (claimed ₹2,37,438.88, open ₹1,54,268.68). Not exercised further (Phase 7). |
| Shops | web desk + phone, Android | 60 shops, beat chips, filter; shop panel shows outstanding/overdue/open bills/12-week sparkline/behaviour/credit. **Set credit works and is audited** (₹6,00,000 → ₹6,50,000 → back). **Send statement is a no-op with a success answer** (DOS-007, P1). |
| Billing → Bills | web | Correct totals; bill panel names every line incl. free qty; Open bill lazily renders the PDF and needs a reload to notice it is ready (DOS-008); Cancel bill on a paid bill refused server-side, silently (DOS-012). GST summary by HSN/rate renders. Credit notes list with reason and bill. |
| Stock | web | Value by brand, stock at cost ₹21,75,206.91, near expiry ₹1,65,781.86, per-lot balances with location chips; stock ledger per movement. Inbound: supplier bills, GRNs, POs. Documents inbox with reading quality and a waiting queue. Catalog with case size / MRP. Nothing broken; not exercised beyond reading (Phase 10). |
| Reports | web desk + phone | Growth (day-by-day, collections vs sales, month-by-month, brand mix, by beat, outstanding, fill rate, delivery, on-time/POD, stock turns/cover, top shops); Profit (owner-only; gross margin ₹82,766.50 on ₹19,72,543 = 4.2 %, margin by brand, scheme spend by scheme — six rows show ids, DOS-018); Incentives (targets and achievement — several seeded targets are 449–527 % achieved, fixture realism); Exports (list + download works; Request export fires a fixed job, DOS-014). Top shops and 11 Sep sales matched the DB. |
| Prices | web | Three price lists, schemes, shop overrides. One row shows an id instead of an item (DOS-013). |
| Staff | web | Staff with role, phone, last sign-in, status; beats tab. Fine. |
| Settings | web | Business profile (legal name, GSTIN, branding, logo upload), numbering series, feature flags, delivery policy (geofence, POD rule, GPS retention, settlement tolerance ₹100, e-way threshold ₹1,00,000), Imports (saved column maps, import jobs with status), Messages (sent messages with cost/status), Audit (rows appear for set-credit, exports, live-map reads; approvals and the refused cancel are absent — Phase 18). |

## 3. The money sanity check — SO-0854 (Prerna Super Market), delivered 11 Sep, paid 12 Sep

| # | Place | What it shows | Evidence |
|---|---|---|---|
| 1 | **Order screen** | SO-0854 · Prerna Super Market · Delivered · ₹73,245.00; panel: subtotal ₹69,796.92, discount ₹3,472.98, GST ₹6,920.66, total ₹73,245.00, 6 lines, bill INV/0824 | `21-trace-order-detail.png`, `22-trace-order-open.png` |
| 2 | **Invoice** | INV/0824 · 11 Sep 2026 · taxable ₹66,323.94 · GST ₹6,920.66 · total ₹73,245.00 · due ₹0.00 · Paid; six named lines (Campa Cola 750 ml 10 cs · 240 pc · 10 pc free …) | `30-trace-bill-list.png`, `31-trace-bill-open.png` |
| 3 | **Payment record** | RCPT-0699 · Prerna Super Market · UPI · ₹71,780.10 · Collected · 12 Sep 12:50 pm · Meena Joshi. (The ₹1,464.90 cash discount that closes the gap to ₹73,245.00 is in the DB and the journal, not on the receipt screen — DOS-011.) | `33-trace-receipts-list.png`, `36-trace-receipt-open.png` |
| 4 | **Retailer outstanding** | Shops → Prerna: Outstanding ₹3,94,335.00, Overdue ₹2,85,332.00, 9 open bills; Money → shop-by-shop: the same. INV/0824 is not among the open bills. | `34-trace-shop-prerna.png`, `10-money.png` |
| 5 | **Owner's revenue report** | Reports → Growth: Top shops 14 Aug–12 Sep: Prerna Super Market ₹4,87,960.00 (2nd); Sales day-by-day 11 Sep point = ₹1,81,010 (API series, `net-home/07-…series_sales….json`, and `daily_tenant_stats` 2026-09-11 invoiced 181010.00) | `10-reports.png`, `10-reports.txt` |
| 6 | **Database** | sales_orders SO-0854 total 7324500 (lines 7324460 + round-off 40); invoices INV/0824 total 7324500, cgst 301487, sgst 301487, cess 89092, state paid; allocations: 7324500 from RCPT-0699 (amount 7178010, cash_discount 146490); journal: invoice entry AR 73,245.00 / DISCOUNTS 3,472.98 / ROUND_OFF −0.40 / OUTPUT_CESS −890.92 / OUTPUT_CGST −3,014.87 / OUTPUT_SGST −3,014.87 / SALES −69,796.92 (sums to 0); receipt entry UPI 71,780.10 / CASH_DISCOUNT 1,464.90 / AR −73,245.00; stock_ledger 6 rows reason sale, −1,750 pcs (1,740 sold + 10 free); Prerna: unpaid on 9 open bills = 2,55,086 + 1,39,249 = ₹3,94,335 = summary; overdue by due_date < 12 Sep = ₹2,85,332 = summary; 11 Sep: 13 bills = ₹1,81,010; Prerna 14 Aug–12 Sep bills = ₹4,87,960 | psql, quoted in the findings file |

**All six agree.** No P0. The one gap is presentational: place 3 shows ₹71,780.10 against a ₹73,245.00 bill without saying where the ₹1,464.90 went.

## 4. Platforms

- **Web desk**: everything above. 26 routes, 0 console errors, 0 failed requests.
- **Web phone width (390 px)**: same shell as the phone apps — tab bar Today · Orders · Money · Shops and a "⋯" More sheet for Billing, Stock, Reports, Prices, Staff, Settings, Change password, Audit, Sign out. Orders rows lose the shop (DOS-010); filter chips push the list one screen down; tab labels truncate ("Outstan…", "Incenti…").
- **Android (Pixel 7)**: signed in after dismissing the emulator's ANR dialog (environment, ENV.md §5.2). Today, Orders, Money → Receipts, Shops, Approvals, approval detail, order detail all rendered; the same defects as web (DOS-003, DOS-004, DOS-009, DOS-010). Nothing Android-only found. Screens: `android/`.
- **iOS (Expo Go)**: signed in headlessly through Appium; Today renders with identical numbers ("3 stops delivered", as of 1:15 pm). Only the home screen was walked on iOS this session — deeper iOS coverage: NOT TESTED (time; Phase 15).

## 5. Friction, terminology, defaults (across the day)

- Approvals are the owner's real job here and they are the weakest screen: no names, no amounts, no reason, duplicates, decisions that do not propagate.
- Lists never sort; there is no date column sort anywhere; "7 / 30 / 90 days" is the only control.
- Feedback is missing after most actions: Send statement, Export CSV, Request export, Rebuild ageing, a refused Cancel bill — the screen stays the same and the owner cannot tell whether anything happened.
- Raw identifiers/enums (POST_FULFILLMENT, bargain_request, TRIP-ACTIVE, Scheme fd5079b5) read as bugs to a non-technical owner.
- Good: the "as of" stamps, the mandatory note on approvals, the shop panel (outstanding, behaviour, credit in one place), the shop-by-shop money table, the trial balance that balances, audit rows for set-credit with before/after, the bill panel with free quantities.

## 6. Counts

P0 0 · P1 5 (DOS-001, 003, 004, 005, 007) · P2 10 (DOS-002, 006, 009, 010, 011, 012, 013, 014, 016, 017) · P3 4 (DOS-008, 015, 018, 019).

Recommended before the Manager walk: none are blockers for continuing Stage 1. DOS-001 and DOS-007 are the two an owner would notice on day one.
