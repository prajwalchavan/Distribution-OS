# Findings — Phase 1, Manager walkthrough (vikas.kadam, manager app :5174; accountant meena.joshi on the same app)

Environment: local dev, database `dos_qa` (realistic seed 2026-09-12, commit 472a5df), all eight services + worker started by
`QA/tools/start-services.sh`, web via `QA/tools/pw-server.mjs` + `pw.mjs` (headless Chromium 145, 1280×800 desk and 390×844 phone).
Evidence root for this file: `QA/evidence/phase1/manager/` (PNG = full-page screenshot, `.txt` = the page's innerText at that moment,
`api-*.json` = direct API responses with the manager's token).

Findings the owner walk already filed and which are ALSO true on the manager side are not re-numbered; they are listed at the end
under "Re-observed on the manager app".

---

### DOS-020 — "Confirm order" silently approves the order's pending approvals and walks through a credit stop
Category: business-logic | Priority: P1 | Role: Manager | Platform: Web

```
User: Manager (vikas.kadam)
Platform: Web, 1280×800
Environment: local dev, dos_qa realistic seed
Steps:
  1. Today → "Open the queue" → Orders. One order waits: SO-0867, Patil General Store (R-0018), ₹5,367.00, "Waiting on: —".
     Below the table, "Waiting for a decision" lists three unnamed cards: "Below floor price / —", "Over credit limit / —",
     "Bargain / —" plus two named bargains. (DB: the below-floor approval 5d89bf84 IS for SO-0867 and the credit-limit
     approval 59eeee35 IS for R-0018 — the same shop — but neither card nor the order row says so.)
  2. Open SO-0867. Panel: "Credit — Credit is blocked for this shop" in red. Nothing about the two pending approvals.
     GET /receivables/credit-check for R-0018 says: creditMode "stop", breached true, reasons ["overdue_days_exceeded"],
     overdueDays 93 (oldest bill OPEN/0005 due 11 Jun), outstanding ₹69,604.50 against a ₹1,50,000 limit
     (api-credit-check-R-0018.json).
  3. Press "Confirm order" (key 1). Dialog: "Confirm order SO-0867 ₹5,367.00 — Stock is reserved when this is confirmed.
     There is no undo." — no mention of the credit stop, the below-floor line, or the credit-limit request. Confirm.
Expected: either the confirm is refused / needs an explicit override while the shop is on credit stop and an approval is
          pending, or the dialog says exactly what will happen: "this shop is 93 days overdue (credit stop); confirming also
          approves selling below floor and the ₹1,50,000 → ₹1,70,000 limit request".
Actual: POST /orders/…/confirm → 200. SO-0867 submitted → confirmed at 13:52:31 by vikas.kadam, 16 reservations for 337 pc,
        an order_confirmed WhatsApp queued to +919821026123. In the SAME second approvals 5d89bf84 (below_floor) and
        59eeee35 (credit_limit) flipped to status = approved, decided_by = vikas.kadam, decision_note NULL. R-0018's
        credit_limit_paise is still 15000000 (the "approved" limit request changed nothing — DOS-006 again). audit_log has
        no row for the confirm or for either approval (only an older owner export in the last 40 min). After a reload the
        two cards are gone from "Waiting for a decision" — the manager never saw them decided.
Business impact: a manager who only meant to release one order has (a) shipped on credit to a shop 93 days overdue,
        (b) approved a below-floor rate the owner was supposed to decide, and (c) "approved" a limit raise that did not
        happen — none of it visible, none of it audited.
Severity: P1
Evidence: 02-open-queue.png · 03-order-open.png · 04-confirm-click.png (dialog) · 05-after-confirm.png · 06-queue-after-reload.png
          · api-credit-check-R-0018.json · DB: sales_orders SO-0867, order_state_transitions (confirm, actor a1cbd424 = vikas.kadam),
          approvals 5d89bf84 / 59eeee35 (approved 13:52:31.117, note null), reservations (16 rows, 337 pc), messages (order_confirmed)
Suggested fix: the order row and panel must list the order's pending approvals and the credit-check reasons; a credit "stop"
        should block confirm unless the role explicitly overrides with a note; the confirm dialog must state what it decides;
        write audit rows for confirm and for every approval decision, implicit or not.
```

### DOS-021 — Credit notes cannot be drafted for less than a full case, and the server's refusal is invisible
Category: bug | Priority: P1 | Role: Manager | Platform: Web

```
Steps:
  1. Billing → Credit notes → "Draft a credit note". Type INV/0634 in "Bill"; pick "INV/0634 Sharma Kirana Stores ₹10,187.00".
  2. Reason buttons: Short delivered · ✓ Return, saleable · Return, damaged · Rate difference · Scheme settlement · Cancellation · Other.
     Each bill line shows "40 pc  −  0 cs  +  Not ordered" — the stepper counts CASES only and every untouched line is
     labelled "Not ordered" (they were all ordered; the label is the order-entry stepper's copy).
  3. Press + once on "Sunbake Glucose 55 g (40 pc)". It becomes "1 cs — 1 cs = 120 pc · 0 cs available — Only 0 cs available
     — rest short-supplied" (stock-availability copy on a return). There is no way to enter 5, 10 or 40 pieces.
  4. "Draft a credit note".
Expected: enter the returned/short quantity in pieces up to the billed quantity; if the server refuses, show why.
Actual: POST /credit-notes → 400 "only 40 pcs of Sunbake Glucose 55 g are left to credit on INV/0634"
        (remaining 40, requested 120). The screen does not change at all — no message, the panel stays as it was; the
        manager cannot tell whether the note was made. No credit_notes row was created. (The button is not disabled:
        aria-disabled false.)
Business impact: short-delivery and return credit notes are a daily job; with this form none can be raised for any line
        whose case size exceeds the billed or returned pieces, and the manager gets no explanation.
Severity: P1
Evidence: 13-credit-note-form.png · 13b-credit-note-bill.png · 13c-credit-note-lines.png · 13d-credit-note-created.png (stepper) ·
          13e-credit-note-400.png · request/response pair in this file's steps · DB credit_notes (no new row)
Suggested fix: a pieces stepper capped at the line's remaining pieces (show "40 pc billed · 40 left to credit"); drop the
        availability and "Not ordered" copy; surface server errors in the panel.
```

### DOS-022 — "9 left to bill" counts orders that cannot be billed; the one order that needs a bill has no way to get one
Category: ux | Priority: P2 | Role: Manager | Platform: Web

```
Steps:
  1. Today: tile "ORDERS TO CONFIRM 1 — 8 bills to issue"; "What is waiting → Bills to issue 8 rows ₹1,55,836.00"; rail badge
     Billing 8. After confirming SO-0867 (DOS-020) the badge became 9 and the desk says "9 left to bill".
  2. Billing → Billing desk: "9 confirmed orders": six Confirmed, two Being picked, one Packed (SO-9001), total ₹1,61,203.00.
     No row can be selected or opened (no row controls; clicking does nothing). Below: "Packed, not billed — 0 packs already
     gone out — Nothing waiting to be billed".
Expected: the count means "bills I can issue now". In this product a bill is issued at pack, so the desk's real work is the
          exceptions: SO-9001 (packed 10 Sep, its bill INV/9002 cancelled) needs a new bill and should be the one row here.
Actual: the number is the count of confirmed + picking + packed-unbilled orders — work that belongs to the picker, not the
        biller — and SO-9001 is listed with the rest but cannot be acted on. Each morning the manager sees "N left to bill"
        and can do nothing about any of them. (docs/23 §2.1 M6 already records that a pack without a bill has no HTTP path
        to be billed later; this is what that looks like on screen.)
Business impact: a wrong, permanently non-zero backlog number on the home screen; the genuinely unbilled packed order stays unbilled.
Severity: P2
Evidence: 01-home-desk.png · 07-billing.png · 08-billing-so9001.png · DB: 9 in-flight orders with pack_confirmations / invoices
          (only SO-9001 lacks a live invoice: INV/9002 cancelled)
Suggested fix: badge and tile = packed orders without a live invoice; give the desk an "Issue bill" action for those rows.
```

### DOS-023 — A picking sheet the manager just made vanishes: the sheets list is 50 unsorted rows
Category: bug | Priority: P1 | Role: Manager | Platform: Web

```
Steps:
  1. Fulfilment → Waves. "Waiting to be picked": 9 orders, 2,694 pc, "On the sheet: No". Click the SO-0877 row (it ticks —
     no checkbox is drawn) → "Make a picking sheet" appears → dialog "1 orders · 750 pc" → confirm.
  2. POST /warehouse/picklists → 200, PICK-0079 (open, 1 order, 3 lines, 750 pc, assignedTo null).
Expected: PICK-0079 at the top of "Picking sheets" so it can be opened, assigned to a picker, started or cancelled.
Actual: SO-0877 disappears from the queue (correct) but PICK-0079 is nowhere on the page, before or after a reload. "Picking
        sheets" shows 50 rows in no order (PICK-0047 7 Aug, PICK-0077 11 Sep, PICK-0009 24 Jun, …); the tenant has 79 sheets
        and the newest is not among the 50 shown. Sheet rows are not clickable either, so even a visible sheet cannot be
        assigned or cancelled from here. Pick & pack tab: "Nothing to pick or pack" (PICK-0078 is being picked by
        kavita.sawant, PICK-0079 is open and unassigned).
Business impact: the manager's wave is created but cannot be seen, given to a picker, watched or cancelled; the fulfilment
        desk is write-only.
Severity: P1
Evidence: 15-fulfilment.png · 16-fulfilment-row-click.png · 17-make-wave.png · 18-wave-made.png · 19b-fulfilment-reload.png ·
          DB: picklists count 79, PICK-0079 open 14:03:59, assigned_to null; SO-0877 still confirmed
Suggested fix: sort sheets newest first with open/picking on top; open a sheet panel (orders, lines, assign, start, cancel).
```

### DOS-024 — "Waiting to be picked" offers orders that are already packed and billed; the refusal is silent
Category: bug | Priority: P2 | Role: Manager | Platform: Web

```
Steps:
  1. Fulfilment → Waves. The queue lists SO-0845 and SO-0850 (both state packed, on PICK-0076 which is packed, bills
     INV/0815 issued and INV/0820 PAID) and SO-9001 (packed, bill cancelled) alongside the confirmed orders, each "On the
     sheet: No".
  2. Tick SO-0850 → "Make a picking sheet" → confirm.
Expected: only confirmed orders appear; if a row cannot be waved the screen says why.
Actual: POST /warehouse/picklists → 409 "only a confirmed order can be waved; SO-0850 is packed". The dialog closes and
        nothing is shown; SO-0850 stays in the queue.
Business impact: the manager will keep trying to pick goods that are already packed (one of them already paid for).
Severity: P2
Evidence: 15-fulfilment.png · 21-wave-packed-order.png · DB: SO-0845/SO-0850 pick_lines → PICK-0076 (packed), pack_confirmations 1 each
Suggested fix: queue = confirmed orders without an open/picking sheet; show the 409 message.
```

### DOS-025 — The load sheet waiting for the manager's approval is not on the Load-out screen
Category: bug | Priority: P1 | Role: Manager | Platform: Web

```
Steps:
  1. Fulfilment → Load-out. Banner: "Your approval IS the PIN, and it is given here — nothing is typed on the warehouse phone
     but the count." Table: 82 rows, every one "Confirmed", in no order (28 Jul, 4 Aug, 3 Sep, 21 Jul, …).
  2. DB / API: one sheet is in status draft — 374f2089, 12 Sep, trip TRIP-NEXT (ganesh.more, 14 Sep), 5 orders,
     38/38 packages, ₹1,50,147.00 (today's five bills), EWB 381012345678. GET /warehouse/load-sheets?status=draft returns it
     (api-load-sheets-draft.json); the default GET /warehouse/load-sheets the screen uses returns 50 confirmed rows and a
     cursor (api-load-sheets-default-summary.json); the screen pages to 82 confirmed rows and never shows the draft.
Expected: the draft sheet first, with "Approve the load-out" / "Cancel the sheet" live.
Actual: the only sheet that needs the manager is invisible; a confirmed sheet's panel (DC-0074) is good — orders with
        SO·INV numbers, approver, checkout time, EWB — and its actions are correctly disabled with reasons ("This sheet is
        already approved", "Only a draft sheet can be cancelled"), so the panel exists but can never be reached for a draft.
Business impact: load-out cannot be approved from the manager app; the van waits or the warehouse works around it.
Severity: P1
Evidence: 23-load-out.png · 26-load-sheet-open.png · api-load-sheets-draft.json · api-load-sheets-default-summary.json ·
          DB: load_sheets status draft 1 / confirmed 82
Suggested fix: list drafts first (or a "Needs approval" section), newest first.
```

### DOS-026 — "Print the challan" does nothing visible
Category: bug | Priority: P2 | Role: Manager | Platform: Web

```
Steps:
  1. Fulfilment → Load-out → open DC-0074 → "Print the challan".
Expected: the challan opens, or the panel says it is being prepared and then offers it.
Actual: GET /warehouse/challans/7fcbfdb7…/pdf → 200 {"status":"queued","objectKey":null,"url":null}. No new tab, no text
        change in the panel, no toast. Same family as DOS-008 (owner "Open bill"), but here there is not even a "being
        prepared" line.
Business impact: the Rule 55 delivery challan the van must carry cannot be printed from the desk that approves the load.
Severity: P2
Evidence: 26b-challan-print.png · response pair above
Suggested fix: show "preparing…" and poll until the URL arrives, then open it.
```

### DOS-027 — Orders "Waiting on" column is blank for an order with two pending approvals
Category: bug | Priority: P2 | Role: Manager | Platform: Web

```
Steps:
  1. Orders → Submitted: SO-0867 row, column "Waiting on: —", while approvals 5d89bf84 (below_floor, order SO-0867) and
     59eeee35 (credit_limit, its shop R-0018) are pending; sales_orders.approval_flags = [].
Expected: "Waiting on: Below floor price · Credit limit" — the column exists for exactly this.
Actual: "—". The manager has no way to connect the unnamed cards below with the order above (see DOS-004 for the cards).
Business impact: the queue's one decision-support column is empty precisely when it matters; leads straight to DOS-020.
Severity: P2
Evidence: 02-open-queue.png · DB approvals + sales_orders SO-0867
Suggested fix: derive "Waiting on" from pending approvals (order-level and shop-level) and the credit check reasons.
```

### DOS-028 — Manager actions leave no audit trail (confirm, implicit approvals)
Category: tech-debt | Priority: P2 | Role: Manager | Platform: Web + DB

```
Steps: after DOS-020, `select … from audit_log where tenant_id = tarsun and occurred_at > now() - interval '40 minutes'`.
Expected: rows for order.confirm SO-0867 and for the two approval decisions with actor vikas.kadam.
Actual: only `report.export.request` by the owner at 13:27. (The owner walk saw the same for approvals; the owner's
        set-credit and exports ARE audited, so the mechanism exists.)
Business impact: an owner cannot later see who released a credit-stopped shop or approved a below-floor sale.
Severity: P2
Evidence: query and result quoted above (also in 02-walkthrough-manager evidence notes)
Suggested fix: audit every state transition and approval decision, including ones made implicitly by confirm.
```

### DOS-029 — The manager app swallows every server refusal: 400, 409 and 501 all look like "nothing happened"
Category: ux | Priority: P1 | Role: Manager | Platform: Web

```
Steps (three independent actions, same session):
  1. Credit note for 120 pc on a 40 pc line → POST /credit-notes 400 "only 40 pcs … left to credit" (DOS-021).
  2. Picking sheet for a packed order → POST /warehouse/picklists 409 "only a confirmed order can be waved; SO-0850 is packed" (DOS-024).
  3. Documents → FA/TY/26-27/1187 (a Too Yumm FieldAssist bill) → "Book it as a supplier bill" → confirm → POST /docint/documents/…/approve
     501 "a brand-DMS bill is committed through billing.invoices.importBrandDms (never a second legal invoice); docint keeps it reviewed".
Expected: the server's message, which is specific and human-readable in all three cases, shown where the manager is looking.
Actual: in all three the dialog closes or the panel stays exactly as it was; no text, no toast, no colour change. The only trace
        is the browser console ("Failed to load resource: … 400/409/501").
Business impact: the manager cannot tell a success from a refusal and will retry, phone the warehouse, or assume the system is broken.
Severity: P1
Evidence: 13e-credit-note-400.png · 21-wave-packed-order.png · 30e-document-booked.png · response bodies in DOS-021/024 and above
Suggested fix: one error surface in the panel/dialog for every mutation (the api-client already types these as ApiError).
```

### DOS-030 — A brand-DMS document offers "Book it as a supplier bill", which the server will never accept
Category: bug | Priority: P2 | Role: Manager | Platform: Web

```
Steps: Inbound → Documents → FA/TY/26-27/1187 (Guiltfree Industries, Too Yumm; the bill number is a FieldAssist one) → Start
       reviewing (200, session opened) → Book it as a supplier bill → dialog "This books a DRAFT supplier bill…" → confirm.
Expected: a brand-DMS bill is routed to Billing → Brand DMS (the product rule: never a second legal invoice) — the panel should say
          so and offer that path, not the supplier-bill one.
Actual: 501 NOT_IMPLEMENTED from the server (message in DOS-029 step 3), silent on screen. The document stays "Needs review" forever.
        (The regular supplier document GUR/26-27/00490 booked fine: supplier_invoices GUR/26-27/00490 status approved ₹44,218.00,
        panel "Booked · QR Verified · IRN verified" — though the dialog promised a "DRAFT" bill and the row is `approved`.)
Business impact: the Too Yumm bills — the one brand this flow was designed around — cannot be finished from the review desk.
Severity: P2
Evidence: 30b-document-open.png · 30c-document-reviewing.png · 30e-document-booked.png · 32d-document-gur-booked.png · DB supplier_invoices
Suggested fix: per document kind, show the right commit action (brand_dms_invoice → "Import as brand bill").
```

### DOS-031 — "Start reviewing" on an already-reviewed document throws an unhandled error and leaves the page unclickable
Category: reliability | Priority: P1 | Role: Manager | Platform: Web (dev build)

```
Steps: Inbound → Documents → GUR/26-27/00490 (state "Reviewed") → "Start reviewing".
Expected: the button is not offered on a reviewed document, or the refusal is shown.
Actual: POST /docint/documents/76f4437a…/review → 409 "document … is reviewed; only an extracted or needs_review document can be
        reviewed". The error is not caught: Metro logs `Web ERROR [ApiError: document 76f4437a… is reviewed; …] toApiError
        (libs/api-client/src/errors.ts:144)` and Expo's `#error-overlay` element takes over the page — every later click
        ("Book it as a supplier bill", tabs, Close) is intercepted for as long as the page lives. Only a reload recovers.
        In a production build the same rejection would be silent (DOS-029) — but the reviewed document would still show a
        "Start reviewing" button that can never work.
Business impact: one wrong click freezes the review desk.
Severity: P1
Evidence: 32-document-gur.png · 32c-error-overlay.png · ~/.dos-qa-logs/logs/manager-app.log line 95 · request pair above
Suggested fix: hide/disable Start reviewing unless status ∈ {extracted, needs_review}; catch ApiError in the mutation hook.
```

### DOS-032 — Two receipts carry the same number: RCPT-0696 exists twice, and the next three office receipts will collide too
Category: bug | Priority: P1 | Role: Manager | Platform: Web + DB

```
Steps: Money → Record a payment → shop "Patil General Store" (panel: Owes ₹69,604.50) → Cash → 9182 → reference "QA cash 12 Sep" → Record.
Expected: a new, unique receipt number (the seed's newest receipt is RCPT-0699, so RCPT-0700).
Actual: POST /receipts → 200 receiptNo "RCPT-0696". The list now shows TWO rows "RCPT-0696": Patil General Store ₹9,182.00 (14:17,
        Vikas Kadam) and Jai Bhavani Stores ₹6,990.00 (12:50, Rahul Deshmukh). DB: numbering_series RCPT next_no was 696 while
        receipts already went up to RCPT-0699 (the seed wrote 0696–0699 without advancing the series), so 0697, 0698 and 0699
        will be duplicated by the next three receipts as well. The schema lets it happen: receipts has unique indexes on id,
        (tenant, idempotency_key) and (tenant, device, client_receipt_no) but NONE on (tenant, series, fy, receipt_no) — invoices
        do have exactly that index (invoices_no_idx). The allocation itself was right: ₹9,182 went to OPEN/0005 (oldest, due
        11 Jun), now paid; Patil now owes ₹60,422.50 on 8 bills.
Business impact: a receipt number is what the shop and the accountant quote; two different payments answering to one number
        breaks reconciliation and any printed receipt. The seed is the trigger, the missing uniqueness guarantee is the product's.
Severity: P1
Evidence: 36-payment-recorded.png (two RCPT-0696 rows) · 37-receipt-panel.png · DB: receipts RCPT-0696 ×2, numbering_series RCPT 697,
          pg_indexes receipts vs invoices
Suggested fix: UNIQUE (tenant_id, series_code, fy, receipt_no) on receipts (same for credit notes, challans, GRNs, picklists if
          missing) + the seed advancing every series it writes past.
```

### DOS-033 — A receipt shows the bill it settled as a UUID
Category: bug | Priority: P2 | Role: Manager | Platform: Web

```
Steps: Money → open RCPT-0696 (Patil).
Expected: "Put against: OPEN/0005 — ₹9,182.00".
Actual: "Put against: f2863866-a4df-7230-a244-806047d8f2e1 — ₹9,182.00" (the invoice id). The owner's receipt panel has no
        allocation at all (DOS-011); the manager's has one, unreadable. "Print the receipt" and "Reverse the receipt" are offered.
Severity: P2
Evidence: 37-receipt-panel.png
Suggested fix: join the invoice number (and due date) into the allocation rows.
```

### DOS-034 — Day-end has no action: nothing in the manager app banks cash, deposits a cheque or marks a bounce
Category: missing-feature | Priority: P1 | Role: Manager, Accountant | Platform: Web + Android

```
Steps:
  1. Money → Day-end: tiles "CASH TO BANK ₹41,05,511.52 — more than 200 rows", "CHEQUES IN HAND ₹1,73,556.98 — 6 rows",
     "TRIPS COMING BACK 0". Table "Cash and cheques in hand" (every row "To bank: No") and six cheque cards.
  2. Click a cash row (RCPT-0698) → nothing. Click a cheque card (Dnyandeep Stores RCPT-CHQ-0001 · Bank of Maharashtra
     ₹29,952.00) → nothing. No "Bank it", "Deposit batch", "Mark bounced" anywhere on the tab.
  3. Money → Receipts → open RCPT-CHQ-0001: actions are "Print the receipt" and "Reverse the receipt" only. Same for cash.
     Same as the accountant (meena.joshi).
Expected: the M10 day-end (docs/23 §2.1): pick the cash and cheques, make a deposit batch, mark a cheque bounced. The owner's
          receipt panel has "Bank it / Mark bounced" (owner review, Money → Receipts) — the desk that actually does the banking has neither.
Actual: read-only. The table also lists UPI and bank-transfer receipts (RCPT-0699 UPI ₹71,780.10, RCPT-0697 bank transfer
        ₹28,759.08) under "Cash and cheques in hand — To bank: No", money that is already in the bank.
Business impact: the daily cash cannot be closed from the app; the "cash to bank" number will only ever grow (it is already
        every cash receipt of 90 days).
Severity: P1
Evidence: 38-day-end.png · 38b-day-end-cheque.png · 37b-cheque-receipt-panel.png · 53-acct-day-end.png · p-money-day-end.png (phone)
Suggested fix: deposit batch (select rows → bank account → reference) and per-cheque deposit/bounce on this tab; exclude UPI/bank
        transfer from "cash in hand".
```

### DOS-035 — Shop panel prints the overdue amount in raw paise
Category: bug | Priority: P2 | Role: Manager, Accountant | Platform: Web

```
Steps: Shops → Patil General Store.
Expected: "Owes ₹60,422.50 · ₹60,422.50 overdue".
Actual: "Owes ₹ | ₹60,422.50 | 6042250 overdue" — the overdue figure is the integer paise (DB: 6042250). Same on the accountant's panel.
Severity: P2
Evidence: 44b-shop-panel.png · 54-acct-shop-panel.png
Suggested fix: format with the money formatter like the line above it.
```

### DOS-036 — The shop's "Statement of account" shows a running balance in the amount column and omits the opening bill
Category: ux | Priority: P2 | Role: Manager, Accountant | Platform: Web

```
Steps: Shops → Patil General Store → "Statement of account".
Shown: Invoice · INV/0037 · 19 Jun 2026 · ₹17,197.00 | Invoice · INV/0105 · 26 Jun · ₹19,106.00 | Invoice · INV/0175 · 3 Jul · ₹22,789.00 |
       Receipt · RCPT-0040 · 6 Jul · ₹21,682.00 …
DB:    INV/0037 = ₹8,015.00, INV/0105 = ₹1,909.00, INV/0175 = ₹3,683.00, RCPT-0040 = ₹1,107.00; the shop's first bill OPEN/0005
       (21 May, ₹9,182.00) is not listed. 9,182 + 8,015 = 17,197; + 1,909 = 19,106; + 3,683 = 22,789; − 1,107 = 21,682.
Expected: debit / credit / balance per row, opening balance as the first row.
Actual: one column, the running balance, with no header — every row reads as if the document were for that amount
        ("INV/0175 ₹22,789.00" for a ₹3,683 bill). Nothing says the first row includes a ₹9,182 opening bill.
Business impact: a manager reading it to a shopkeeper on the phone will quote wrong bill amounts.
Severity: P2
Evidence: 44b-shop-panel.png · DB invoices/receipts for R-0018 quoted above
Suggested fix: three columns and the opening row; "Send the statement" should produce the same.
```

### DOS-037 — The accountant can adjust stock and book supplier bills (app offers it, server accepts it)
Category: security | Priority: P1 | Role: Accountant | Platform: Web + API

```
Steps (signed in as meena.joshi, role accountant):
  1. Stock → click "Campa Cola 1 L · RCP20260807" → the "Adjust stock" form opens (Adjusted by hand / Damaged / Expired, Pieces,
     Note, "Move stock", "Adjust the stock") — identical to the manager's.
  2. API, accountant token: POST /inventory/adjustments {lot RCP20260807, qtyDelta −1, reason damage, note "QA accountant
     permission probe"} → 200, ledger entry 01a094d5… actorId 3188dd91 (meena.joshi). On hand went 8 → 7 (the manager's own
     −1 test took it 9 → 8 a minute earlier).
  3. Inbound → Documents → REL/26-27/00495 → the panel offers "Start reviewing / Match the items again / Book it as a supplier
     bill / Reject the document" (not exercised further as accountant; the matrix allows procurement writes to the accountant).
  4. For contrast the server DOES refuse the accountant elsewhere: POST /retailers/{id}/credit → 403, POST /approvals/{id}/decide
     → 403, POST /warehouse/picklists → 403 (messages "the accountant role may not call …").
Expected: founder decision 2026-09-05 (docs/22 §2, CLAUDE.md): accountant = money desk + reads. No stock writes, no procurement
          commits. docs/23 §2.3 already flagged that the matrix lets the accountant write these and asked for an ACCOUNTANT_READS
          narrowing before the frontend; the frontend shipped without it, and the app draws the forms because it trusts the matrix.
Actual: the accountant can write stock off as damaged or expired, move stock between locations, and commit supplier bills.
Business impact: stock and purchase records can be altered by a role that is supposed to only count money — an audit and
        fraud exposure (damage write-offs are the classic leak).
Severity: P1
Evidence: 55-acct-stock.png · API pair in step 2 · DB stock_ledger for lot 00106d03 (two adjustment rows, actors a1cbd424 and 3188dd91)
Suggested fix: narrow permissions.ts for accountant to receipts/allocations/deposits/bounces/credit notes/exports + reads; the
        app then hides the forms by itself (nav/permission mechanism already works — Fulfilment and Prices are gone from her rail).
```

### DOS-038 — On a phone the Shops list has no shop names
Category: bug | Priority: P2 | Role: Manager, Accountant | Platform: Android (Pixel 7) + Web 390×844

```
Steps: Android manager app → ⋯ → Shops.
Expected: code, NAME, beat, credit policy.
Actual: rows read "R-0046 · Blocked · 0.00", "R-0018 · Blocked · 1,50,000.00" — the name cell is dropped at phone width (the
        same column-hiding that DOS-010 filed for Orders, here on the one list whose only useful column is the name). The
        filter box still matches names, which is the workaround. uiautomator shows the cell as an empty view ("￼").
Business impact: a manager on the phone cannot recognise a shop in the list.
Severity: P2
Evidence: android/a-10-shops.png · android/a-11-shop-panel.png (tap on "Patil General Store" failed: no such text on screen)
Suggested fix: at phone width keep name + policy, drop code/limit into the panel.
```

Addendum to DOS-032: the accountant's API receipt (₹1.00, "QA accountant API probe", allocated to R-0018's oldest open bill)
came back as **RCPT-0697** — the second collision (seed RCPT-0697 = New Bombay Stores ₹28,759.08). Two more (0698, 0699) will follow.

Addendum to DOS-026: the worker DID render the challan — delivery_challans DC-0074 pdf_object_key set at 14:09:40, about 40 s
after the click — and the panel never offered it; the manager has no way to know it is ready short of guessing and reloading.

---

## Re-observed on the manager app (already filed from the owner walk — no new numbers)

- **DOS-003** Order panel lines carry quantity, scheme tag and money, no product name (SO-0867 panel: "2 cs · 180 pc — Off the line — ₹1,489.18").
- **DOS-004** "Waiting for a decision" cards show the kind twice and a dash: "Below floor price / Below floor price / —"; no shop, order or amount. Approve/Reject buttons are on the card.
- **DOS-005** Both bargain rows still present for the Om Sai bargain (one unnamed "Bargain / —" card = approval 29e03a4b, one named "Om Sai Provision Store — Asked rate ₹39.58" = bargain_request 011d0c51); the Mahalaxmi bargain the owner rejected on the approval row is still listed and approvable as "Mahalaxmi General Stores — Asked rate ₹22.28" (bargain_requests 1221ccf5 still `requested`).
- **DOS-006** The credit-limit approval decided by confirm (59eeee35) left R-0018's limit at ₹1,50,000.
- **DOS-009** Bills issued (INV/0634 21 Aug, INV/0572 14 Aug, INV/0822 10 Sep …), picking sheets, load sheets, supplier bills and GRNs are all in no order.
- **DOS-018** Internal wording: "Off the line" on order lines; "Not ordered" on credit-note lines; "0 packs already gone out".
- **DOS-010** Android + phone width: the Confirmed orders list and the Billing desk rows show order no · state · amount with an empty
  shop cell (`android/a-03-orders-confirmed.png`, `android/a-05-billing.png`). Shops list: DOS-038.
- **DOS-003** Android order panel SO-0870: "1 cs · 24 pc ₹1,730.07 / 2 Inner · 24 pc Free goods ₹429.62 / 3 cs · 108 pc ₹5,200.82" — no names
  (`android/a-04-order-panel.png`).
- **DOS-032** Both duplicate numbers are visible on the phone too: Money lists RCPT-0697 ₹1.00 and RCPT-0697 ₹28,759.08, RCPT-0696 ₹9,182.00
  and RCPT-0696 ₹6,990.00 (`android/a-08-money.png`).
- Android order panel credit line for a shop within its limit reads, in red, "Owes ₹34,995.00 · limit ₹50,000.00 · This order takes it ₹0.00
  over the limit" — right numbers, wrong colour and wording when nothing is exceeded (P3, not filed separately; `android/a-04-order-panel.png`).
- Phone width (web 390×844 and Android): the keyboard hint "j / k move · Enter open · 1 confirm · 2 cancel" is shown under the order queue on
  a touch screen; the seven state chips take three rows before the list starts (`p-orders.png`) (P3, not filed separately).
- iOS (iPhone 16 Pro, Expo Go): sign-in and home only — same tiles and "What is waiting" rows as web (`ios-01-home.png`); the rest of the
  app NOT TESTED on iOS this phase (no headless tap path beyond sign-in in the harness yet).

## What worked (for the review file)

- Home tiles agree with the DB to the paisa: Invoiced today ₹1,50,147.00 = 5 invoices dated 12 Sep; Collected today ₹4,49,793.67 = receipts received 12 Sep (cash ₹1,56,204.72 / UPI ₹1,89,366.87 / bank ₹74,270.08 / cheque ₹29,952.00 — the by-mode panel's 35 / 42 / 17 / 7 % match); Cheques in hand 6 = ₹1,73,556.98; Orders to confirm 1 = SO-0867 ₹5,367.00. **The 90+ ageing bucket shows ₹35,144.00 here** — the same number the owner's home hides (DOS-001 is owner-app only).
- Bill panel (from Billing → Bills issued): named lines with case/piece/free and rate, Print / Record e-way bill / Get IRN / Cancel.
- Confirm is two-step, keyboard-driven (j/k, Enter, 1, 2), reserves stock (16 reservations, 337 pc) and notifies the shop.
- Credit-note form finds a bill by number and lists its lines; the server enforces "left to credit" per line.
- Supplier bill panel: matched lines, "Open a goods receipt" / "Mark it disputed" disabled with reasons. Findings tab reads like a real gate log (extra / damaged / short with notes and state).
- Load-sheet panel for a confirmed sheet: orders with SO·INV, approver, checkout, EWB, disabled actions explained.
