# Phase 1 — Owner walkthrough findings

Environment for every block below unless stated: local dev, database `dos_qa` (realistic seed of 2026-09-12, commit 472a5df), eight services + worker running against it, owner `sunil.tarsun` of tenant `tarsun`. Web = headless Chromium 145 at 1280×800 and 390×844 (Playwright, `QA/tools/pw.mjs`); Android = Pixel 7 emulator API 36 (debug APK, Metro on :5173); iOS = iPhone 16 Pro simulator, iOS 18.0, Expo Go. Evidence lives in `QA/evidence/phase1/owner/` (paths below are relative to it). DB queries were run with `psql` against `dos_qa`; the SQL is quoted where it matters.

Numbering starts at DOS-001 (Phase 0 raised no numbered findings).

---

### DOS-001 — Home dashboard hides the 90+ day debt: "Money owed, by age" shows 90+ = ₹0.00 while ₹35,144 is over 90 days old
Category: bug | Priority: P1 | Role: Owner | Platform: Web (desk and phone widths)

```
User: Owner
Platform: Web (Chromium 145, 1280×800)
Environment: local dev, dos_qa seed 2026-09-12
Steps:
  1. Sign in as sunil.tarsun, land on Today.
  2. Read the "Money owed, by age" widget on the right.
  3. Open Money → Outstanding and read the same widget.
Expected: both widgets show the same six buckets; 90+ shows ₹35,144.00.
Actual: Today shows 0–7 ₹23,27,491 · 8–15 ₹6,76,326.50 · 16–30 ₹7,86,763.50 · 31–60 ₹5,00,590 · 61–90 ₹98,059 · 90+ ₹0.00.
        Money → Outstanding shows the same first five and 90+ ₹35,144.00.
        The API the home page called (GET /reporting/dashboard/owner) returns "ageing": {…, "b90plus": 3514400}
        and detail.ageingB90plus = 3514400; the DB agrees:
          select sum(bucket_90_plus_paise)/100.0 from retailer_outstanding_summary where tenant_id='01a0947d-…'  → 35144.00
Business impact: the oldest, least-collectable receivable is the one number an owner looks at first; the home page says it is zero.
Severity: P1
Evidence: 01-home-desk.png (widget, 90+ = 0.00) · net-home/05-GET-…reporting_dashboard_owner.json (b90plus 3514400) · 10-money.png (35,144.00) · 50-phone-money.png
Suggested fix: the home widget reads a key that does not exist for the last bucket (the API spells it b90plus / ageingB90plus); use the same mapping the Money screen uses.
```

### DOS-002 — Brand mix shows two different "Other" slices and hides the 4th and 5th brands (home and Reports)
Category: bug | Priority: P2 | Role: Owner | Platform: Web

```
Steps:
  1. Today → "Brand mix 1 Sep — 12 Sep".   2. Reports → Growth → "Brand mix".
Expected: the five biggest brands plus one "Other".
Actual: Today shows Campa ₹5.0L 25% · Other ₹4.1L 21% · Sunbake ₹2.9L 15% · Godavari ₹2.9L 15% · Other ₹4.8L 24%.
        Reports shows Campa ₹1.3Cr 28% · Other ₹1.0Cr 21% · Annapurna ₹65.5L 14% · Sunbake ₹63.2L 13% · Other ₹1.1Cr 23%.
        The API (GET /reporting/series/brand-mix?…&topGroups=5) already returns Campa, Sunbake, Godavari, Neelam, Annapurna
        and one "Other" = ₹4,07,317.98. The screen sorts that list, keeps four, and folds Neelam (₹2.77L) + Annapurna (₹2.03L)
        into a second "Other". Neelam — the 4th biggest brand this month — is invisible.
Business impact: the owner cannot answer "which brands am I selling?" from the chart; "Other" outranks real brands.
Severity: P2
Evidence: 01-home-desk.png · 10-reports.png · net-home/06-GET-…brand-mix….json · DB: invoice_lines grouped by brand, 1 Sep–12 Sep (Neelam 2,76,899.12; Annapurna 2,03,471.88)
Suggested fix: render the API's groups as returned; never re-fold a series that already carries an "other" group.
```

### DOS-003 — Order detail lists quantities and money but no product names
Category: bug | Priority: P1 | Role: Owner | Platform: Web + Android

```
Steps:
  1. Orders → search "SO-0854" → open the row (Prerna Super Market, Delivered, ₹73,245.00).
  2. Read the "6 lines" section of the side panel.
  3. Billing → INV/0824 → open: the bill panel for the same goods.
Expected: each line names the item (Konkan Ratlami Sev 180 g, Campa Cola 750 ml, …) and its free quantity.
Actual: order panel lines read "9 case · 324 pc ₹10,910.85", "10 case · 240 pc ₹7,451.61", … — no item names, and the 10 free
        bottles on the Campa Cola 750 ml line are not shown. The bill panel for the same order shows all six names and "10 pc free".
        Android shows the same nameless lines (Order SO-0689: "4 case · 192 pc ₹2,175.68", "7 piece · 7 pc ₹559.11", …).
Business impact: the owner cannot see what a shop ordered without opening the bill; unbilled orders (draft, submitted, picking) have no bill to open.
Severity: P1
Evidence: 22-trace-order-open.png · 24-trace-order-panel-bottom.png · android/owner-android-order-detail.png · 31-trace-bill-open.png (bill panel, names present)
Suggested fix: the order panel should name each line the way the bill panel does (variant name + free qty).
```

### DOS-004 — Approvals never say which shop, order or amount is being approved
Category: ux | Priority: P1 | Role: Owner | Platform: Web + Android

```
Steps:
  1. Today → Approvals (or Open approvals).
  2. Read the list; open "Over credit limit".
Expected: "Laxmi Narayan Stores — limit ₹1,50,000, asked ₹1,70,000, outstanding ₹1,37,886, order SO-0868 ₹17,736 —
          'Festive season stocking, retailer asked for a temporary bump.'" and Approve / Reject.
Actual: list columns are Kind · What · Person · Value · Asked, and "What" shows the entity type — "retailer", "order",
        "bargain_request" — with Value "—" for five of seven rows. The detail panel is titled "retailer" and shows only
        Kind, Person (Rahul Deshmukh), Asked (time) and a note box. The request payload the API returns carries everything
        needed (currentLimitPaise 15000000, requestedLimitPaise 17000000, reason, entityId, orderId) and none of it is rendered.
        Identical on Android.
Business impact: the owner is asked to approve a credit increase, a below-floor price or a bargain without seeing the shop,
        the money or the reason. Every approval becomes a phone call.
Severity: P1
Evidence: 10-approvals.png · 40-approval-open-credit-limit.png · android/owner-android-approvals.png · android/owner-android-approval-detail.png · net-home/10-GET-…approvals_status_pending….json
Suggested fix: resolve entityId to the shop / order / item name, show current vs requested limit, outstanding and the reason on the row and in the panel.
```

### DOS-005 — A bargain shows up twice on Approvals, and rejecting one copy leaves the other open
Category: business-logic | Priority: P1 | Role: Owner | Platform: Web

```
Steps:
  1. Approvals → "All": rows "Bargain / bargain_request / — / 11:20 am" (two) AND "Bargain / Mahalaxmi General Stores / 22.28 / 11:15 am",
     "Bargain / Om Sai Provision Store / 39.58" — the same two bargains (Campa Cola 750 ml ₹23.09→₹22.28; Sunbake Marie Light ₹41.02→₹39.58).
  2. Open the first "bargain_request" row, note "QA: no, list rate holds this month", Reject, confirm.
  3. Reload Approvals; check the DB.
Expected: one row per bargain; rejecting it closes it everywhere; the rep sees "rejected".
Actual: POST /approvals/4ffb552c-…/decide → 200, approvals.status = rejected. bargain_requests 1221ccf5-… (Mahalaxmi, Campa Cola 750 ml)
        is still status = requested, decided_by null; the "Mahalaxmi General Stores 22.28" row is still listed and still approvable
        from the Rate requests tab.
          select status, decided_at from bargain_requests where id='1221ccf5-aa42-7f60-9557-2eedce569b87'  → requested | null
Business impact: an owner's "no" does not reach the shop or the rep; the rate can still be granted from the other tab.
Severity: P1
Evidence: 42-approval-open-bargain.png · 43b-reject-confirm-dialog.png · 44-bargain-rejected.png (row still present) · DB before/after
Suggested fix: one record per bargain on the screen; a decision on the approval must decide the bargain request (or the approval row should not exist for bargains).
```

### DOS-006 — Approving "Over credit limit" confirms the order but never changes the limit the request asked for
Category: business-logic | Priority: P2 | Role: Owner | Platform: Web

```
Steps:
  1. Approvals → "Over credit limit" (approval 94b9dc4a, payload: Laxmi Narayan Stores R-0013, currentLimit ₹1,50,000,
     requestedLimit ₹1,70,000, "Festive season stocking, retailer asked for a temporary bump.").
  2. Note "QA: approved for the festive season, review in October" → Approve → confirm.
Expected: whatever the product intends — either the limit becomes ₹1,70,000 (temporary or not) and the order proceeds,
          or the screen makes clear that only this one order is being let through.
Actual: POST /approvals/94b9dc4a-…/decide → 200, status approved. Order SO-0868 moved submitted → confirmed (actor = owner,
        13:15:52) and an OrderConfirmed WhatsApp went out. Retailer R-0013 still has credit_limit_paise = 15000000 and no
        credit_limit_change audit row. The next order from the shop will raise the identical approval.
Business impact: the owner believes he raised the limit; nothing changed. The screen never told him what "approve" would do.
Severity: P2 (product decision needed: per-order release vs limit change)
Evidence: 45-approve-confirm-dialog.png · 46-credit-limit-approved.png · DB: sales_orders SO-0868 transitions, retailers R-0013, messages (order_confirmed, +919769018420)
Suggested fix: decide the semantics; show them on the approval ("Let this order through" vs "Raise limit to ₹1,70,000 until …"); apply the requested limit if that is what is approved.
```

### DOS-007 — "Send statement" says it queued a statement; nothing is ever sent
Category: bug | Priority: P1 | Role: Owner | Platform: Web

```
Steps:
  1. Shops → filter "Prerna" → open Prerna Super Market → "Send statement".
  2. Wait ten minutes with the worker running; check messages, jobs, outbox.
Expected: a WhatsApp/SMS statement to +918655045958 (or a visible "sent"/"failed"), a row under Settings → Messages.
Actual: POST /receivables/statements → 200 {"jobId":"01a09495-ac16-…","queued":1}. The screen shows no confirmation at all.
        outbox_events got StatementRequested {retailerId, channel whatsapp, from 2026-06-14, to 2026-09-12, includeUpiQr true}
        with published_at = null and attempts = 0 (still null 15 minutes later, while OrderConfirmed events created after it
        were published within a minute). No pg-boss job, no messages row, no document, no file for that jobId in any table.
        The worker start line lists handlers for "PDF render, docint, integrations, notifications" — nothing consumes StatementRequested.
Business impact: statements are how a distributor chases ₹44 lakh of outstanding; the button is a no-op with a success answer.
Severity: P1
Evidence: 60-send-statement-click.png · 61-send-statement-after.png · DB: outbox_events (StatementRequested unpublished), messages (none), pgboss.job (none) · ~/.dos-qa-logs/logs/worker.log
Suggested fix: a worker handler for StatementRequested (render the statement PDF, send through notifications) and a visible result on the shop panel.
```

### DOS-008 — "Open bill" keeps saying "being prepared" after the PDF is ready, until the page is reloaded
Category: bug | Priority: P3 | Role: Owner | Platform: Web

```
Steps:
  1. Billing → INV/0824 → Open bill (13:10). Message: "The bill is being prepared — press again in a moment".
  2. Worker log 13:11:28 "document rendered … invoice/010b2d0f-….pdf"; invoices.pdf_object_key set.
  3. Press Open bill again at ~13:12 and ~13:20 on the same page.
  4. Sign in afresh, open the same bill, press Open bill (13:29).
Expected: step 3 opens the PDF.
Actual: steps 3 kept the "being prepared" message; step 4 → GET /invoices/…/pdf → {"status":"ready","url":"/storage/…"} and the message is gone.
        Only 1 of 856 seeded bills has a PDF: they are rendered on first request, so every first "Open bill" waits.
Business impact: minor — the owner learns to reload; but every bill's first open is a two-step wait.
Severity: P3
Evidence: 31-trace-bill-open.png (text) · worker.log 13:11:28 · DB invoices.pdf_object_key
Suggested fix: poll the pdf status after "being prepared" instead of caching the not-ready answer.
```

### DOS-009 — Orders, Bills and Trips lists are in no order
Category: ux | Priority: P2 | Role: Owner | Platform: Web + Android

```
Steps: Orders (30 days) · Billing → Bills (30 days) · Orders → Trips.
Expected: newest first (or a visible sort).
Actual: Orders: SO-0689 25 Aug, SO-0616 17 Aug, SO-0822 7 Sep, SO-0594 14 Aug, SO-0853 10 Sep, … Bills: 21 Aug, 14 Aug, 10 Sep, 8 Sep, 19 Aug, …
        Trips: 2 Sep, 24 Aug, 4 Sep, 12 Sep, 18 Aug, … No column is sortable; no sort control exists.
Business impact: today's orders are scattered among a month of rows; the owner scans instead of reads.
Severity: P2
Evidence: 10-orders.png · 10-billing.png · 10-orders-trips.txt · android/owner-android-tab-Orders.png
Suggested fix: default sort by date descending, sortable headers.
```

### DOS-010 — At phone width the Orders list drops the shop name
Category: ux | Priority: P2 | Role: Owner | Platform: Web (390×844) + Android

```
Steps: Orders on a 390 px viewport / on the Pixel 7.
Expected: order no, shop, state, value.
Actual: rows show "SO-0689 · Delivered · 6,376.00" — no shop. The desk table has the Shop column.
Business impact: on the phone the owner cannot tell whose order is which without opening each one.
Severity: P2
Evidence: 50-phone-orders.png · android/owner-android-tab-Orders.png
```

### DOS-011 — A receipt does not show which bills it settled or the cash discount given
Category: missing-feature | Priority: P2 | Role: Owner | Platform: Web

```
Steps: Money → Receipts → RCPT-0699 (Prerna Super Market, UPI, ₹71,780.10).
Expected: "Settles INV/0824 ₹73,245.00 — ₹71,780.10 received + ₹1,464.90 cash discount (2%)".
Actual: panel shows Shop, Mode, Amount ₹71,780.10, On account ₹0.00, Received, Person (Meena Joshi) and the actions
        Bank it / Mark bounced / Reverse receipt. The allocation (allocations: 73,245.00 to INV/0824) and the
        cash_discount_paise 146490 exist in the DB and in the journal (CASH_DISCOUNT 1,464.90) but not on screen.
Business impact: ₹1,464.90 left the business and the owner cannot see it from the receipt; nor which bill was closed.
Severity: P2
Evidence: 36-trace-receipt-open.png · DB allocations/receipts/journal_lines for INV/0824
```

### DOS-012 — "Cancel bill" is offered on a paid, delivered bill; the server refuses and the screen says nothing
Category: ux | Priority: P2 | Role: Owner | Platform: Web

```
Steps: Billing → INV/0817 (Shree Ganesh Kirana, Paid, Due ₹0) → Cancel bill → reason "QA test: trying to cancel a paid, delivered bill" → Cancel bill.
Expected: either the action is not offered on a paid/dispatched bill, or the refusal is shown.
Actual: POST /invoices/089d9946-…/cancel → 409 {"code":"CONFLICT","message":"order 1bf21d23-… is delivered; after dispatch the only correction is a credit note"}.
        The dialog closes; the panel is unchanged; no message is displayed. DB: INV/0817 still paid (good).
        The order panel likewise shows Confirm order / Release stock / Cancel order on a delivered order (disabled, unexplained).
Business impact: money is safe (the server holds the rule), but the owner learns nothing from a silent no.
Severity: P2
Evidence: 35-cancel-paid-bill-dialog.png · 37-cancel-paid-bill-confirmed.png · 24-trace-order-panel-bottom.png · 409 response body
```

### DOS-013 — The Default price list shows an id ("1c3586ee") instead of "Chamak Glass Cleaner 500 ml"
Category: bug | Priority: P2 | Role: Owner | Platform: Web

```
Steps: Prices → Price lists → Default Price List, scroll to the row after "Konkan Farsan Mix 400 g".
Expected: "Chamak Glass Cleaner 500 ml  68.03".
Actual: "1c3586ee  68.03  No". product_variants 1c3586ee-fac5-75bf-83e5-eb28c63dc730 exists with name "Chamak Glass Cleaner 500 ml";
        the same variant is priced in all four price lists.
Business impact: one unreadable row now; the owner cannot tell which item is priced at ₹68.03.
Severity: P2
Evidence: 10-prices.txt · DB price_list_items ⨝ product_variants
Suggested fix: the price list names items from a catalog subset ("Only what I sell"?) that lacks this variant; name from product_variants.
```

### DOS-014 — "Request export" and "Export CSV" fire a fixed export with no choice and no feedback
Category: ux | Priority: P2 | Role: Owner | Platform: Web

```
Steps:
  1. Reports → Exports → "Request export" (twice, a minute apart).
  2. Orders → "Export CSV".   3. Reports → Exports → Download on "Stock value · CSV".
Expected: a dialog to choose what and which period; a downloaded file or a visible "queued, see Exports".
Actual: 1. no dialog, no message; two jobs "GST sales register · CSV, 15 Jun–12 Sep, groupBy hsn" appeared
           (audit_log report.export.request 13:17:26 and 13:18:24; export list "gst-sales-2026-06-15-to-2026-09-12.csv · 49 · Sunil Tarsun · 1:17 pm").
        2. no download event, no message; a "Daily sales · CSV 14 Aug–12 Sep" job (26 rows) appeared under Reports → Exports — not the orders list.
        3. works: GET /integrations/exports/…/download-url → stock-value.csv downloaded.
Business impact: the owner does not know an export happened, cannot pick the report or period, and "Export CSV" on Orders does not export the orders.
Severity: P2
Evidence: 63-request-export-dialog.png (nothing opened) · DB export_jobs · audit_log · 72 (no file produced by the Orders button)
```

### DOS-015 — "Rebuild ageing" does nothing
Category: bug | Priority: P3 | Role: Owner | Platform: Web

```
Steps: Money → "Rebuild ageing" (enabled link-button), click, wait 3 s.
Expected: a request and a visible result ("ageing rebuilt as of …").
Actual: no HTTP request of any kind left the page; no message.
Severity: P3 (the worker rebuilds ageing on its own; the button is decoration)
Evidence: 73-rebuild-ageing.png · network capture in the run log (empty)
```

### DOS-016 — Dashboard "Outstanding" counts ₹35,080 the business has already received on account
Category: business-logic | Priority: P2 | Role: Owner | Platform: Web

```
Steps: Today → Outstanding ₹44,24,374.00. Money → Books → Trial balance → AR Sundry Debtors ₹43,89,294.00.
Expected: one number for "what shops owe me", or the difference explained.
Actual: the difference is exactly sum(unallocated_credit_paise) = ₹35,080 across 13 shops (Mangal Traders ₹5,000, Sharma Kirana ₹4,800, …):
        money received on account and not yet applied to a bill. The dashboard (and the Money screen) present the gross figure.
Business impact: the owner chases ₹35,080 that is already in the till; the books and the dashboard disagree by design.
Severity: P2
Evidence: 01-home-desk.png · 10-money-books.txt · DB retailer_outstanding_summary (outstanding vs unallocated_credit)
Suggested fix: show "less on account ₹35,080" (or net) beside Outstanding; keep the definition consistent with the trial balance.
```

### DOS-017 — "Live map" has no map
Category: missing-feature | Priority: P2 | Role: Owner | Platform: Web + Android + iOS

```
Steps: Today → Live map.
Expected: vehicles on a map.
Actual: a table (Vehicle · Driver · Trip · Stops · Last seen · "Open in maps") under the sentence
        "Map tiles arrive with the MapView component; positions are live." One vehicle on TRIP-ACTIVE 3/10, two idle since 11 Sep 7:30 pm.
Business impact: "where are my vans" is answered by a table and an external link.
Severity: P2
Evidence: 10-map.png · 10-map.txt
```

### DOS-018 — Internal labels leak onto the owner's screens
Category: ux | Priority: P3 | Role: Owner | Platform: Web + Android + iOS

```
Seen:
  · Payment terms "POST_FULFILLMENT" (order panel, web and Android)
  · Approvals "What" = retailer / order / bargain_request; confirm dialogs titled "Approve retailer", "Reject bargain_request"
  · Trip numbers "TRIP-ACTIVE", "TRIP-NEXT" on Live map and Trips
  · Profit → Scheme spend rows "Scheme fd5079b5", "Scheme 57dd77c6", … brand "—" (schemes rendered by id)
  · Trips list column "Amount ₹" = 5,000.00 on every trip (it is the opening cash, not what the trip collected)
  · "2 trips active" on the tiles while the DB has 1 active + 1 planned; Live map shows one
  · Reports → "Stock turns" y-axis reads 0.0× 0.1× 0.1× 0.1× (duplicate rounded ticks)
  · Sidebar shows "Tarsun Enterprise" (branding.display_name) while the legal name is "M/s. Tarsun Enterprise" — fine, noted
Severity: P3
Evidence: 22-trace-order-open.png · 10-approvals.png · 45-approve-confirm-dialog.png · 10-map.txt · 10-reports-profit.txt · 10-orders-trips.txt · 10-reports.txt
```

### DOS-019 — "Needs you (5)" lists six rows; the badge stays at 5 after two decisions
Category: ux | Priority: P3 | Role: Owner | Platform: Web

```
Steps: Today → "Needs you (5)" (six rows: five approvals + one rate request). Decide two approvals; return to Today.
Actual: the count comes from the rollup (pendingApprovals 5, "as of 1:15 pm") and stays 5 until the worker recomputes; the DB has 3 pending.
        The list merges two sources (approvals + bargains) so the count and the rows disagree even before any decision.
Severity: P3
Evidence: 01-home-desk.txt · 46-credit-limit-approved.png (sidebar "Today 5") · DB approvals status=pending → 3
```

---

## Verified as working (with evidence)

- Sign-in, session refresh, sign-out on web; sign-in on Android and iOS (`android/owner-sunil.tarsun-2-home.png`, `ios/owner-sunil.tarsun-2-home.png`). Home numbers identical on all three.
- All 26 owner routes load with 0 console errors and 0 failed requests (`pw-audit.mjs` run, 13:00).
- Dashboard tiles: Invoiced today ₹1,50,147.00 = 5 bills dated today; Collected today ₹4,49,793.67 = 20 receipts today; Outstanding ₹44,24,374.00 and Overdue ₹26,86,917.00 = `retailer_outstanding_summary`; Orders today 13 = 16 created minus 3 drafts; ageing buckets 0–7 … 61–90 = DB. Sales this month ₹19,72,543 = sum of Sept invoice lines.
- Six-place money trace on SO-0854 — see `QA/02-owner-review.md` §3. All six agree.
- Credit-limit change from the shop panel: POST /retailers/…/credit → panel ₹6,50,000, DB updated, audit row `retailer.set_credit` with before/after; restored to ₹6,00,000 (second audit row).
- Approval decisions reach the DB with the note (`approvals.decision_note`); approving an over-limit order confirms it and sends the OrderConfirmed WhatsApp.
- Cancelling a paid, delivered bill is refused by the server (409) — the money rule holds.
- Export download (signed URL) works; GST summary by HSN renders; trial balance balances ("Debits equal credits"); stock ledger per lot; audit log records set_credit, export requests and live-map reads with actor and role.

## Seen but NOT filed (data/fixture artefacts or unverified — for the phase that owns them)

- Trial balance "Cash with delivery crews ₹1,52,536" vs dashboard "Cash in transit ₹0.00": the ₹1,52,536 is four van receipts dated 11–12 Sep that the seed attached to a trip settled in June (TRIP-20260615-1); no settlement moved the cash. Seed artefact; Phase 2 (delivery settlement) must confirm the product posts the transfer on a real settlement.
- Home said "5 stops delivered" at 12:50 and "3 stops delivered" from 13:15; the API and DB say 3 today. The 12:50 rollup could not be re-examined. Watch in Phase 2.
- Seeded cash receipts carry paise (₹1,56,204.72 cash today) — fixture realism, Phase 5.
- Only the seed's `credit_limit_change` and my `set_credit`/`export.request`/`gps` actions are in `audit_log`; approval decisions and the refused cancel are not. Phase 18.
