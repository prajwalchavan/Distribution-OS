# Batch 2 — new findings (2026-09-13)

Findings raised while batch 2 was being planned and built. They are outside the scope the founder approved on 2026-09-13, so each
needs its own approval before any product change (Charter A.6).

### DOS-166 — A salesperson can record a money receipt through the offline upload, which the normal receipt endpoint refuses
Category: security | Priority: P0 | Role: Sales Rep (Warehouse also passes the role check, see Actual) | Platform: API

User: Sales Rep (rahul.deshmukh, tenant tarsun)
Platform: API — HTTP requests against the local services (sales-service :3003, warehouse-service :3004, delivery-service :3005, retailer-service :3006)
Environment: local, database dos_qa (QA test data), main at 19e2c12, 2026-09-13 10:20 IST
Steps:
  1. Sign in as rahul.deshmukh (POST :3000/auth/login).
  2. POST :3003/sync/upload with one op: PUT table `receipts`, a new UUIDv7 id, data {retailer_id: a tarsun shop, mode: cash,
     amount_paise: 100, received_at: now, status: collected} — the shape the delivery app queues (frontend/delivery-app/src/lib/queue.ts).
  3. Query dos_qa for the receipt, its journal entry, its allocation and the sync_ops row.
  4. Control: POST :3003/receipts with the same token and the same money.
Expected: the upload refuses the op as a sync rejection (2xx + sync_errors), just as the HTTP route refuses it, because a salesperson
never collects money (docs/22 §6 and never-list #2; docs/17 §D4).
Actual: 200 {accepted: 1}. dos_qa holds RCPT-0708 (100 paise, cash, collected, received_by rahul.deshmukh whose role is salesperson) with a
balanced journal entry, an allocation to a live bill, a ReceiptRecorded outbox event and a rendered PDF. The HTTP control answered 403
"the salesperson role may not call POST /receipts". A warehouse token (dinesh.patil, :3004) also passed every role check and was stopped
only by a journal insert policy, surfacing as 500 "Internal server error" instead of a sync rejection. The retailer was refused 403 because
the upload itself is staff-only. The delivery control (ganesh.more) was accepted as RCPT-0707, as it should be.
Business impact: the founder's most-repeated money rule holds on the normal endpoint and not on the offline route every field app ships.
A salesperson's phone can post cash receipts into the books, reduce a shop's outstanding and print a genuine-looking receipt: an
embezzlement and books-integrity hole. Any staff role may write any synced table wherever a database policy happens to allow the insert.
Severity: P0
Evidence: QA/evidence/batch2/sync-role-probe/ — 02-salesperson-receipts.json and 02-salesperson-receipts-db.txt (accepted, RCPT-0708),
05-salesperson-receipts-http.json (403 control), 01-delivery-receipts.* (legitimate control), 03-warehouse-receipts.* (500),
04-retailer-receipts.json (403), 06-salesperson-trip_expenses.* (refused only by the trips row policy), side-effects.md, probe.mjs.
Re-checked by the main session: the JSON statuses above and `SELECT receipt_no, amount_paise, username … WHERE receipt_no IN
('RCPT-0707','RCPT-0708')` → RCPT-0707|100|ganesh.more, RCPT-0708|100|rahul.deshmukh.
Root cause (the probe agent's code reading, to be confirmed by the architect's design): `sync.upload` is STAFF
(backend/libs/contracts/src/permissions.ts:451); `SyncService.upload` dispatches by table with no per-op role check
(backend/libs/core/src/modules/sync/sync.service.ts:108-148); `applyReceiptSync` calls `recordReceipt` directly
(backend/libs/core/src/modules/receivables/receivables.sync.ts:36), while `requireRole(MONEY_COLLECTORS)` exists only on the HTTP path
(receivables.service.ts:709).
Suggested fix: check every upload op against the permission matrix before dispatch. Each synced table names the procedure it stands for,
and a role the matrix refuses gets a sync rejection (2xx + sync_errors, never 4xx). The architect's design is being written to
QA/evidence/batch2/verdicts/DOS-166-design.md. The architect first suspected this while signing off DOS-115
(QA/evidence/batch2/verdicts/DOS-115.md); the probe proved it.
Side effects in dos_qa: RCPT-0707 and RCPT-0708 (100 paise each, with journal entries, allocations and PDFs) and one sync_errors row.
Ledgers are append-only, so they stay until dos_qa is rebuilt after DOS-032+059 merges.


## Suspected by the architect's plan sign-offs — NOT TESTED

Raised by Fable while signing off batch-2 plans (sign-off run wf_b67cb996-95f, 2026-09-13), from code reading only. None of these is a
finding until a probe, a test or a walk proves it (Charter A.4). Verify the money and security ones first, then file each proven one as a
DOS block above with its evidence. Full wording: QA/evidence/batch2/verdicts/<verdict id>.md, section "New findings outside this fix".

| # | Raised in verdict | Suspected defect (file:line, as the architect wrote it) | Status |
|---|---|---|---|
| S-01 | DOS-116 | backend/libs/core/src/modules/claims/build.service.ts:481 — creditNoteCandidates filters on the note header reason === 'return_damaged', not the line's saleable (registers.service.ts:84 carries it), so damaged lines inside a mixed doorstep return (reason return_saleable, deliveries.service.ts:187-191) are never offered as brand damage-claim candidates. P2, claims. | NOT TESTED |
| S-02 | DOS-116 | backend/libs/core/src/modules/delivery/delivery.sync.ts:132 — an offline delivery op that omits returned_saleable defaults to true instead of isSaleableReturn(l.reason), so a queued damaged return without the flag becomes a durable sync rejection rather than a booking to the bin (the delivery app sends the flag today, deliver.tsx:269). P3, delivery. | NOT TESTED |
| S-03 | DOS-133 | backend/libs/core/src/modules/warehouse/load-sheets.service.ts:754-767 — onALiveSheet counts a CONFIRMED sheet for an order later return_undelivered → packed, so loadSheets.create refuses it for ever (409); only exit is trips.depart's dispatchIfPacked (trips.service.ts:844-858) with no sheet/challan. Every fresh seed: SO-0845/SO-0850; dos_qa SO-0857/SO-0899/SO-0904. P1. | NOT TESTED |
| S-04 | DOS-133 | backend/libs/core/src/modules/orders/fulfilment.ts:105,178 — fulfilmentQueue orders/pages on desc(sales_orders.id); seeded orders carry hash ids (SO-0862 = a4e4ef5b…) above every live UUIDv7, so W2/W3's confirmed queue lists seeded orders above today's (DOS-023/133 class, unfiled). P1. | NOT TESTED |
| S-05 | DOS-133 | backend/libs/core/src/modules/warehouse/load-sheets.service.ts:227,233 — loadSheets.list still id-ordered with an id cursor; W7 LOAD SHEETS (limit 30) shows seeded sheets above today's; DOS-025 fixed only the manager side client-only. P2. | NOT TESTED |
| S-06 | DOS-133 | backend/libs/core/src/modules/warehouse/load-sheets.service.ts:758-765 (and the new predicate) — no index serves load_sheets.order_ids containment; every create/awaiting_load scans all non-cancelled sheets of the tenant, which accumulate for ever (docs/20 rule 3); GIN jsonb_path_ops later. P3. | NOT TESTED |
| S-07 | DOS-133 | backend/libs/core/src/modules/warehouse/packing.service.ts:335 — packedAt: new Date() is the Node clock while the column defaults to Postgres now(); skewed instances make W5's from/to (packed_at) disagree with list order (created_at). P3. | NOT TESTED |
| S-08 | DOS-132 | backend/libs/core/src/modules/receivables/receivables.service.ts:1744-1746 — reversing a collected trip cash receipt after its trip settled credits CASH_VAN, which settlement already emptied; should credit CASH once settled (P2). | NOT TESTED |
| S-09 | DOS-132 | backend/libs/core/src/modules/delivery/settlement.service.ts:348-360 (+ receivables.sync.ts:60-79, frontend/delivery-app/src/lib/queue.ts:226-270) — settlement counts collections rows only; an offline doorstep receipt uploaded through the receipts table has none, so its cash is never credited out of CASH_VAN and reads as cash over in CASH_SHORT, which can force owner approval (P1). | NOT TESTED |
| S-10 | DOS-132 | backend/libs/core/src/modules/delivery/settlement.service.ts:217-238 vs receivables.service.ts:855 — after a settlement with expenses or a shortage CASH holds handed-over minus float, yet receipts bank at full value; the per-receipt deposit takes CASH below the drawer by expenses + short and cannot represent the bank slip (P2, design). | NOT TESTED |
| S-11 | DOS-132 | backend/libs/core/src/modules/receivables/receivables.service.ts:832-870 — deposit reads without FOR UPDATE and its UPDATE has no status = 'collected' guard; two desks can bank the same receipt twice (P2, reproduce first). | NOT TESTED |
| S-12 | DOS-132 | frontend/owner-app/app/money/receipts.tsx:305-311 — the O11 dialogs close on any refusal (.then(done, done)), so a server 409 is never shown to the owner (P2). | NOT TESTED |
| S-13 | DOS-132 | backend/libs/database/src/seed-demo/receivables.ts:664-669 — RCPT-VAN receipts attach to a settled trip with no collections row and seeded trip_settlements post no journal entry; CASH_VAN never nets and the owner's cash-in-transit tile reads 0 (P3, demo data). | NOT TESTED |
| S-14 | DOS-117 | backend/worker/src/jobs/reporting.ts:16-20, :83, :91 — reporting.rollup.tenant/schedule/finalize are 'standard' queues, so singletonKey is never enforced (pg-boss 12 indexes only short/singleton/stately/exclusive, plans.js:668-709); the header's 'never doubled up' is false — harmless by idempotency, wasteful at scale | NOT TESTED |
| S-15 | DOS-117 | backend/worker/src/jobs/reporting.ts:74-76 — the finalize loops rollupBehaviour over every tenant inside one job, O(all shops), against rollup.ts property 2 and the 900 s expiry | NOT TESTED |
| S-16 | DOS-117 | backend/worker/src/jobs/retention.ts + docs/20 partition addendum — ageing_snapshots (one row per shop per day after this fix) has no retention sweep and no partition plan | NOT TESTED |
| S-17 | DOS-117 | backend/libs/core/src/modules/reporting/rollup.ts:267 — the finalize's yesterday re-run calls refreshOwnerSummary with day = yesterday, so owner_summary.today_invoiced/collected show yesterday's figures until the next 15-minute tick | NOT TESTED |
| S-18 | DOS-117 | backend/libs/core/src/modules/receivables/receivables.service.ts:1441 — the owner's rebuildAgeing accepts any past asOf and re-dates every summary row backwards; the new catch-up heals it only at the next worker start | NOT TESTED |
| S-19 | DOS-126 | backend/libs/core/src/modules/pricing/bargains.service.ts:81-97 and :185-196 never write expires_at, so quote.service.ts:299-302 applies an API-filed standalone approved rate to every future order of that shop for that variant, forever (dos_qa: 13 approved standalone requests; every row with an expiry is the seed's). P2 business. | NOT TESTED |
| S-20 | DOS-126 | backend/libs/core/src/modules/orders/pricing-lines.ts:174 vs :192 against backend/libs/database/src/seed-demo/sales.ts:689-700, :865: two stored conventions for a bargained sales_order_line in one table; rate × qty − discount is not the taxable and every reader must use line_total − tax. One convention plus a backfill is a tech-debt item. P3. | NOT TESTED |
| S-21 | DOS-126 | dos_qa holds a confirmed sales_order with no order_no whose line is rate 4000 / tax 0 / line_total 0 (sales_order_lines, direct insert, not an API path): the QA database has taken a non-API write; the Q5 rebuild clears it. P3 hygiene. | NOT TESTED |
| S-22 | DOS-146 | frontend/retailer-app/app/pay.tsx:141-142 — value={amount ?? owed} / onChange={setAmount}: an emptied Pay amount snaps back to what is owed on every platform; fix with DOS-124/DOS-154 as one Pay slice, not with ?? 0 (Start would disable with the wrong reason, pay.tsx:104-109; retailer strings.ts:191 helper changes with it). | NOT TESTED |
| S-23 | DOS-146 | frontend/manager-app/app/inbound/documents.tsx:418 — value={totalPaise ?? header.totalPaise}: clearing the invoice total on the desk text field snaps back to the header value on blur; same class. | NOT TESTED |
| S-24 | DOS-146 | frontend/libs/ui/src/money.ts:162-164 + frontend/libs/ui/src/native/money.tsx:165-183 (both renderers) — a money pad opened on a PRE-FILLED whole amount appends the first digit (₹3,000 → '4' → ₹30,004); DOS-060 design for a reopened entry, but on a pre-filled field it is the crores hazard the finding names; replace-on-first-digit (⌫ and . still edit) is a kit-wide founder call, P2 UX, own id, touches retailer Pay too. | NOT TESTED |
| S-25 | DOS-131+DOS-137 | backend/libs/core/src/modules/delivery/trips.service.ts:209-219 — create's busy check covers input.driverId only; a helper already on another open trip that day is accepted as helper again. | NOT TESTED |
| S-26 | DOS-131+DOS-137 | backend/libs/core/src/modules/delivery/trips.service.ts:1034-1050 — assertMember selects tenancy's `memberships` table from the delivery module (module rule; should go through a tenancy export). | NOT TESTED |
| S-27 | DOS-131+DOS-137 | frontend/warehouse-app/app/load/index.tsx:149-151 — `reason: t('w7.challan')` on a default-state ListRow never renders (ui/src/web/list.tsx:185 and native/list.tsx:175 render reason only for needsAttention), so the challan number is invisible on W7's sheet rows. | NOT TESTED |
| S-28 | h4-stock merge review | frontend/delivery-app/app/stop/[id]/van-sale.tsx:193,217 — the van sale shows quote.totals.netPaise (pre-GST) under 'Sale total' above 'Take the money now', so the crew asks for the wrong amount at the door; DOS-096 now gives totals.totalPaise. P1 candidate. | NOT TESTED |
| S-29 | h4-stock merge review | hsn_rates holds same-date duplicates (0406 at 500 and 1200, 2106, 2202) and loadGstBps orders by effectiveFrom only (quote.service.ts:402, billing.internals.ts:240), so which GST rate wins is heap order. P2. | NOT TESTED |
| S-30 | h4-stock merge review | price_list_items.inclusive_of_gst is ignored by the engine, the quote and the order while R7 now prints '+ GST'. P2. | NOT TESTED |
| S-31 | h4-stock merge review | frontend/owner-app/app/prices/index.tsx:347 — the owner what-if shows netPaise (pre-GST) under o8.quoteNet with no label. P2. | NOT TESTED |
| S-32 | h4-stock merge review | Order tax uses percentOf(net, rate) (quote.service.ts:126) while the invoice uses splitGst = 2 × percentOf(taxable, rate/2) (invoices.service.ts:1421, domain/gst.ts:23-24): one paisa difference per intra-state line (SO-0885 line 1: 25277 vs 25276). P3. | NOT TESTED |
| S-33 | h4-stock merge review | Two more copies of the godown rule: billing/invoices.service.ts:1276-1295 and delivery/settlement.service.ts:536-555, while inventory/index.ts:23-26 now says no module keeps its own copy. Tech-debt. | NOT TESTED |
| S-34 | h4-stock merge review | api-client/src/cache.ts:172-182 keeps the last good value when a refetch fails; sales-app and retailer-app stock hooks read only data, so an hour-old godown total stays on screen with no signal. P3. | NOT TESTED |
