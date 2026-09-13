# lean-owner-money-approvals — architect lean design (Fable, 2026-09-13)

Run `wf_1c5f484c-b7b`. In lean mode this design IS the signed-off plan for these items. Items marked *needs-founder-decision* are built only after the founder approves the recommended default (or picks an alternative).

## DOS-006 — needs-founder-decision

### Design

ROOT CAUSE. Production submit raises the credit gate with payload {orderNo, totalPaise, flag} (backend/libs/core/src/modules/orders/orders.service.ts:311, from approvalFlags in orders.internals.ts:134-155). ApprovalsService.decide (approvals.service.ts:95-157) only confirms or cancels the order and never touches retailers; retailers.setCredit (retailers.service.ts:332-370, MANAGEMENT, audited retailer.set_credit) is the only limit write. The 'requested ₹1,70,000' the owner read exists only in the demo seed (backend/libs/database/src/seed-demo/reporting.ts:442-448, entityType 'retailer', entityId retailerId, currentLimitPaise/requestedLimitPaise/reason), a shape production never writes; orders.spec.ts:493-525 copies it as the 'seed shape'. Neither dialog (owner approvals.tsx:420-450; manager orders/index.tsx:740-763) says what approve does. So today an approval IS a per-order release; the seed and the copy lie about it.

RECOMMENDED DEFAULT (build only after the founder approves): an approval releases only that order; the shop's limit is a setting the owner or manager changes on the shop's page (Shops → Set credit, shops/index.tsx:98-115), audited. Server unchanged. Work order: (1) seed: credit_limit approval rows take the production shape — entityType 'sales_order', entityId c.orderId, payload { orderNo, totalPaise, flag: 'credit_limit' } read from the seeded order; drop currentLimitPaise/requestedLimitPaise/reason (reporting.ts:442-464); re-run QA/tools/seed/verify-seed.sql (I-34 counts kind×status pairs and stays green; the :284 rejected-approval join now also matches credit_limit rows, so if that check moves, fix the seed's rejected credit-limit orders to be cancelled, never the check). (2) owner approvals.tsx: for kind credit_limit the confirm Dialog body states exactly what happens: 'Lets {orderNo} through for {total}. {shop}'s limit stays {limit} (creditLine()). Change the limit under Shops.' plus a secondary Button 'Change the shop's limit' that closes the sheet and router.push('/shops?q=<retailerName>') (shops/index.tsx:51 reads q). (3) manager orders/index.tsx decide Dialog: the same sentence under the existing creditLine(). (4) orders.spec guard pinning the semantics. (5) pnpm db:seed on dos_qa.

ALTERNATIVE (if the founder picks 'approve raises the limit'): DecideApprovalInput gains optional newCreditLimitPaise (contracts/orders.ts, owned by lean-sales-orders-pricing, already merged before this group); decide, when kind = credit_limit and the field is present, calls a new RetailersService.setCreditInTx(tx, ctx, {...}) exported through retailers/index.ts in the same transaction (same audit row as setCredit); the owner dialog gets a RupeeInput prefilled with the live limit; DecideApprovalOutput unchanged. 'Until a date' needs a credit_limit_until column, an expand migration and a nightly revert — phase 2, not batch 2.

### Binding amendments

- (a) Do not build the alternative until the founder answers; the default touches no contract, permission or schema.
- (b) The seed payload must be exactly the production shape {orderNo, totalPaise, flag}; no note/reason field, because the panel would show it as a rep's reason that production never carries.
- (c) Keep orders.spec.ts:493-525 (DOS-004) as it is: it pins that the queue names the order from its own row whatever the payload holds; only its comment may say 'a stray payload', not 'the seed's shape'.
- (d) The dialog copy is per kind: only credit_limit gets the release sentence and the 'Change the shop's limit' button; bargain and below_floor dialogs are unchanged.
- (e) The manager string key is appended to frontend/manager-app/src/strings.ts only after the waited groups that own it have merged; append-only, one key.
- (f) After the seed change re-run pnpm db:seed on dos_qa and re-run verify-seed.sql; record the new check count in the seed spec if I-xx moved for the reason in the design, never by loosening the check.

### Files

- `/Users/prajwalchavan/Desktop/Distribution OS/backend/libs/database/src/seed-demo/reporting.ts`
- `/Users/prajwalchavan/Desktop/Distribution OS/backend/libs/core/src/modules/orders/orders.spec.ts`
- `/Users/prajwalchavan/Desktop/Distribution OS/frontend/owner-app/app/approvals.tsx`
- `/Users/prajwalchavan/Desktop/Distribution OS/frontend/owner-app/src/strings.ts`
- `/Users/prajwalchavan/Desktop/Distribution OS/frontend/manager-app/app/orders/index.tsx`
- `/Users/prajwalchavan/Desktop/Distribution OS/frontend/manager-app/src/strings.ts (one appended key; owned by earlier groups, all merged before this one)`
- `/Users/prajwalchavan/Desktop/Distribution OS/QA/tools/seed/verify-seed.sql (new check; unowned QA tooling)`

### Tests and walks

- verify-seed.sql new check 'DOS-006 no credit_limit approval carries requestedLimitPaise or currentLimitPaise, and every credit_limit approval has entity_type = sales_order pointing at its order' — RED on today's seed (10 rows carry the fake limit), GREEN after pnpm db:seed.
- orders.spec.ts 'DOS-006: approving an over-limit gate lets only that order through — the order confirms, retailers.credit_limit_paise is unchanged, no retailer.set_credit audit row is written, and the shop's next over-limit order raises a fresh credit_limit gate' — a guard on the chosen semantics (green before and after; it exists so the alternative cannot creep in silently).
- Owner web + Android: Approvals → an 'Over credit limit' gate → Approve: the dialog reads 'Lets SO-xxxx through … limit stays ₹1,50,000' and offers 'Change the shop's limit', which lands on Shops filtered to that shop; after approving, the shop's limit on Shops is unchanged. Manager web + Android: Orders → the same gate → Approve dialog carries the same sentence.

### Founder question

**When you approve an 'Over credit limit' request, should approving let only that one order through (the shop's limit stays as it is; you change the limit on the shop's page), or should approving also raise the shop's credit limit?**

Recommended default: Only this order goes through. The screen says so and gives a one-tap link to change the shop's limit on the shop's page (audited, as today).

- Alternative: Approving also raises the limit to a figure you type in the dialog, permanently, recorded as a limit change (a small contract change: an optional new limit on the decision).
- Alternative: A temporary raise until a date that reverts on its own (needs a new column, a migration and a nightly job; phase 2, not this batch).

### Notes

Re-included P2. The record's 'requested limit' was seed fiction; the server already behaves as the default describes, so the default is copy + seed + one guard test. If the founder picks the alternative, the group waits on nothing else (contracts/orders.ts owner lean-sales-orders-pricing is already merged) but the build grows by a contract field, a retailers in-tx export and a RupeeInput.

## DOS-011 — design-ready

### Design

ROOT CAUSE. ReceiptGetOutput (backend/libs/contracts/src/receivables.ts:427-434) carries allocations (AllocationSchema :184-193, invoiceId only) and nothing that names the bill; getReceipt (backend/libs/core/src/modules/receivables/receivables.service.ts:760-805) never reads invoices; ReceiptSchema.cashDiscountPaise (:155) is on the wire but the owner panel (frontend/owner-app/app/money/receipts.tsx:214-255) never renders it; the manager panel prints row.invoiceId (frontend/manager-app/app/money/index.tsx:300-303). CreateReceiptOutput already answers the settled bills as SettledInvoiceSchema (:392-399).

DESIGN. Additive, on the GET only: ReceiptGetOutput gains `invoices: z.array(SettledInvoiceSchema)` — the same shape createReceipt returns. In getReceipt, after the allocations read, one query: loadInvoices(tx, allocations.map(a => a.invoiceId)) (allocation.ts:62, read-only) mapped to { id, invoiceNo, state, openPaise: totalPaise − allocatedPaise }, in allocation order, deduplicated. NEVER recomputeInvoiceStates here: it writes invoices.state, and a GET must not write. AllocationSchema and SettledInvoiceSchema are not touched (both sit in stored mutation replies — DOS-160 exposure); ReceiptGetOutput is a GET, never stored, so no replay exposure. Roles unchanged (MONEY_READERS; a shop reads its own receipt and RLS shows it only its own bills).

SCREENS. Owner receipts.tsx panel, after Amount: a 'Settles' block — one ListRow per allocation, primary = invoiceNo from the invoices map (fallback t('o11.billUnknown')), secondary = 'paid' or 'open ₹X' from state/openPaise, trailingMoney = allocation.amountPaise; then Field 'Cash discount' = receipt.cashDiscountPaise (only when > 0); then one line '₹71,780.10 received + ₹1,464.90 cash discount = ₹73,245.00 settled' (amountPaise + cashDiscountPaise = Σ allocations). Manager money/index.tsx:300-303: primary = invoiceNo from the same map, plus the Cash discount Field. Order of work: contract → service → spec → pnpm docs:readme → owner screen + strings → manager screen (+ one appended manager string) → walk.

### Binding amendments

- (a) Only ReceiptGetOutput changes; AllocationSchema, SettledInvoiceSchema, CreateReceiptOutput and every other receivables output stay byte-identical (DOS-160).
- (b) The invoices read is loadInvoices (read-only). A spec asserts the GET leaves invoices.updated_at untouched.
- (c) No per-allocation billing.invoices.get from any screen (the N+1 DOS-004 refused); both panels read invoices from receipts.get.
- (d) The cash-discount percentage is not shown (the receipt stores paise, not bps); the rupee figure is.
- (e) A reversal receipt's own allocations are not added to the reply; `reversal` stays a ReceiptSchema.
- (f) Run pnpm docs:readme; the owner and manager README endpoint tables change.

### Files

- `/Users/prajwalchavan/Desktop/Distribution OS/backend/libs/contracts/src/receivables.ts`
- `/Users/prajwalchavan/Desktop/Distribution OS/backend/libs/core/src/modules/receivables/receivables.service.ts`
- `/Users/prajwalchavan/Desktop/Distribution OS/backend/libs/core/src/modules/receivables/receivables.spec.ts`
- `/Users/prajwalchavan/Desktop/Distribution OS/frontend/owner-app/app/money/receipts.tsx`
- `/Users/prajwalchavan/Desktop/Distribution OS/frontend/owner-app/src/strings.ts`
- `/Users/prajwalchavan/Desktop/Distribution OS/frontend/manager-app/app/money/index.tsx`
- `/Users/prajwalchavan/Desktop/Distribution OS/frontend/manager-app/src/strings.ts (one appended key, after the owning groups merged)`
- `generated: backend/*-service/README.md and app READMEs via pnpm docs:readme`

### Tests and walks

- receivables.spec.ts 'DOS-011: receipts.get names the bills a receipt settled (invoice number, payment state, open balance) in allocation order and carries the cash discount it realised' — record a receipt under an active cash-discount condition FIFO across two open bills, GET it: invoices has both bills with their invoiceNo, the first paid (openPaise 0) and the second partially_paid, item.cashDiscountPaise > 0, amountPaise + cashDiscountPaise = Σ allocations.amountPaise. RED today: body.invoices is undefined.
- receivables.spec.ts 'DOS-011 (guard): receipts.get writes nothing — invoices.updated_at and state are unchanged after the read, and a retailer login reading its own receipt gets the same bills' — RED today only on the invoices field.
- Platform walk: owner web + Android, Money → Receipts → RCPT-0699 reads 'INV/0824 ₹73,245.00 · paid', 'Cash discount ₹1,464.90', '₹71,780.10 received + ₹1,464.90 cash discount = ₹73,245.00 settled'; a FIFO receipt spread over several bills lists each. Manager web + Android: Money → RCPT-0696 'Put against: OPEN/0005 — ₹9,182.00' (this is DOS-033's proof).

### Notes

Fixes DOS-033 as a by-product. The manager cash-discount field is a bonus of the same read; if the manager strings file is contended, skip that one field and keep the invoiceNo change.

## DOS-033 — design-ready

### Design

Fixed by DOS-011's additive `invoices` list on ReceiptGetOutput, not by a per-allocation billing.invoices.get (the N+1 read DOS-004's design refused). ROOT CAUSE is the same line: frontend/manager-app/app/money/index.tsx:300-303 prints row.invoiceId because AllocationSchema (contracts/receivables.ts:184-193) has no bill number. CHANGE: build `const billNo = new Map(detail.data?.invoices.map(i => [i.id, i]))` beside the existing detail query (money/index.tsx:104-106) and render ListRow primary = billNo.get(row.invoiceId)?.invoiceNo ?? row.invoiceId.slice(0, 8) with secondary 'paid' / 'open ₹X'; trailingMoney unchanged. No contract, permission or service work of its own; AllocationSchema gains nothing (it sits in stored createReceipt replies — DOS-160 exposure). Due date is not added: SettledInvoiceSchema is shared by stored replies; the panel shows the bill's payment state instead. Build after DOS-011's contract and service land in the same lane.

### Binding amendments

- (a) Read the bill numbers only from receipts.get's invoices; never call billing.invoices.get or invoices.list per allocation.
- (b) Keep the slice(0,8) fallback only for an invoice the reply could not name (an RLS-hidden bill is impossible for the money desk, so it should never show).
- (c) A FIFO receipt spread over several bills lists every allocation, each with its own number.

### Files

- `/Users/prajwalchavan/Desktop/Distribution OS/frontend/manager-app/app/money/index.tsx`
- `/Users/prajwalchavan/Desktop/Distribution OS/backend/libs/contracts/src/receivables.ts (DOS-011's change; nothing further here)`

### Tests and walks

- Covered by DOS-011's receivables.spec test (invoiceNo present per allocation).
- Platform walk (the record's own test): manager web Money → RCPT-0696 (Patil) shows 'OPEN/0005 — ₹9,182.00' under Put against, not 'f2863866-…'; a FIFO receipt spread over several bills lists each bill by number; repeat on Android Pixel_7_API_36.

### Notes

App-only once DOS-011 is in; the manager strings file needs no new key for the number itself.

## DOS-013 — design-ready

### Design

ROOT CAUSE. PriceListItemSchema (backend/libs/contracts/src/pricing.ts:35-41) carries no name, so frontend/owner-app/app/prices/index.tsx:87-98 names rows from tenantCatalog.list({ listedOnly: true, limit: 500 }) and falls back to variantId.slice(0, 8) for a variant that is priced but not listed (or past 500). A price list may legitimately price an unlisted variant (Chamak Glass Cleaner is priced in all four lists).

DESIGN. Additive `variantName: z.string()` on PriceListItemSchema, resolved server-side with the tenant-catalog export variantNames(tx, ids) (backend/libs/core/src/modules/tenant-catalog/import.ts:311, exported at index.ts:24; pricing is downstream of tenant-catalog in the chain, so the import is legal) — the tenant's local_alias else the global variant name, the same rule order lines and invoice lines use (DOS-003). One query per call over every item of every list returned. In pricing.service.ts: toPriceList(row, items, names) and toPriceListItem(row, names) with `names.get(row.variantId) ?? row.variantId` (the FK makes the map complete; the fallback is defensive); three callers — listPriceLists (:70-105), upsertPriceList (its returned item) and setPriceListItems (:195-199). Screen: price-list rows and the search filter use item.variantName; the tenantCatalog query stays only for the overrides table (RetailerPriceOverride has no name — out of scope). Order: contract → service → spec → pnpm docs:readme → screen → walk. DOS-160: UpsertPriceListOutput and SetPriceListItemsOutput are stored mutation replies gaining a required field; the group waits for lean-backend-platform's DOS-160 fix, so confirm it is on main before merging (else pnpm smoke --run-tag).

### Binding amendments

- (a) Do not edit tenant-catalog/index.ts; import variantNames from '../tenant-catalog/index.js' as it is exported today.
- (b) variantName is required (z.string()), never nullable: every price_list_items row has a variant.
- (c) One variantNames call per procedure call, over the union of all lists' item ids; never per list or per item.
- (d) Leave frontend/owner-app/app/stock/catalog.tsx:71 alone (same fallback, unowned, different screen); note it for a follow-up finding.
- (e) Merge only after lean-backend-platform's DOS-160 replay fix is on main; a same-day replay of setItems must answer 200 with the stored reply.
- (f) Run pnpm docs:readme; owner and manager READMEs change.

### Files

- `/Users/prajwalchavan/Desktop/Distribution OS/backend/libs/contracts/src/pricing.ts`
- `/Users/prajwalchavan/Desktop/Distribution OS/backend/libs/core/src/modules/pricing/pricing.service.ts`
- `/Users/prajwalchavan/Desktop/Distribution OS/backend/libs/core/src/modules/pricing/pricing.spec.ts`
- `/Users/prajwalchavan/Desktop/Distribution OS/frontend/owner-app/app/prices/index.tsx`
- `generated: backend/*-service/README.md and app READMEs via pnpm docs:readme`

### Tests and walks

- pricing.spec.ts 'DOS-013: priceLists.list names every item — a variant the tenant does not list carries the global variant name, a listed one its local alias' — RED today (variantName undefined on every item).
- pricing.spec.ts 'DOS-013: setItems and the price-list upsert answer the same names, and a same-key replay of setItems answers 200 with the stored reply' — the replay half turns GREEN only with DOS-160 on main (proves the merge order).
- Platform walk: owner web Prices → Price lists → Default Price List, the row after 'Konkan Farsan Mix 400 g' reads 'Chamak Glass Cleaner 500 ml 68.03' and searching 'Chamak' finds it; Android quick check of the same screen.

### Notes

Small (S). The contract-free path (paging the whole global catalog from the app) is unbounded and refused.

## DOS-014 — design-ready

### Design

THREE ROOT CAUSES. (1) frontend/owner-app/app/reports/exports.tsx:69-79 hard-codes register 'gstSalesRegister' × the last 90 days with no dialog and no feedback. (2) ExportButton (frontend/owner-app/src/lib/ui.tsx:439-473) reads exports.get once; when the worker renders off-process the job is still queued, url is null, the label falls back to 'Export CSV' and nothing ever re-reads (useQuery has no interval; api-client react/index.tsx:224-291 exposes refetch only) — DOS-008's class. (3) Orders → 'Export CSV' (frontend/owner-app/app/orders/index.tsx:208-212) exports the dailySales register, not the orders list; ReportRegisterSchema (backend/libs/contracts/src/reporting.ts:248-259) has no orders register.

DESIGN — answers the record's questions: Orders exports the orders list itself (the owner brief's 'every list is exportable', ui.tsx:388-392); Reports → Request export offers every register and the app's four periods.
A. Contract (reporting.ts): ReportRegisterSchema gains 'orders'; REGISTER_WINDOW_DAYS.orders = 92; new OrdersRegisterInput = registerWindow(z.object({ from, to (required), state?, states?, retailerId?, salespersonId?, q?, ...CursorInput }), 92) mirroring OrdersListInput minus openOnly. No JSON GET route (like 'outstanding'); only the CSV path.
B. Read: new plain file backend/libs/core/src/modules/orders/register-reads.ts exporting orderRegisterRows(tx, input) that calls listOrders (orders.internals.ts:308) and flattens each order to { orderNo, orderDate (IST business date of createdAt), retailerId, state, source, salespersonId, paymentTerms, subtotalPaise, discountPaise, taxPaise, roundOffPaise, totalPaise, approvalFlags (space-joined), expectedDeliveryDate, cancelReason }; one re-export line in orders/index.ts beside fillRateLines (:18-23) — the one file outside the group, because a plain read is the established cross-module pattern and no group owns it. registers.service.ts gains orders(input): requireRole(BACK_OFFICE) → withTenant → orderRegisterRows → names in one batch each: retailerRefs (retailers index) and userLabels (already imported :33) → rows carry retailer and salesperson names beside the ids. register-specs.ts REGISTER_SPECS.orders = { input: OrdersRegisterInput, paged: true, read: stack.registers.orders }; renderers.ts FILE_STEM.orders = 'orders'. exports.service.ts:80-90 already validates filters against the spec (window_too_wide) — unchanged.
C. ExportButton: a local phase 'idle | queued | ready | failed | slow'. On request success with url null → phase queued, label t('app.exportPreparing'), and a useEffect setInterval(2 s) calling job.refetch() until item.url (→ ready: label 'Download export' + Toast 'Export ready') or status failed (→ Toast with item.error, label back) or 60 s (→ slow: Toast 'Queued — see Reports → Exports', label back); interval cleared on unmount and on every phase change.
D. Orders screen: ExportButton register='orders' with the register's own filters — { from, to } of the range (a search keeps the range and adds q), state/states as shown.
E. exports.tsx: 'Request export' opens a Dialog: register = Chips single-select over ReportRegisterSchema.options (labels via word(); Segments is limited to three options), period = RangeSegments (d7/d30/d90/fy) clamped with clampWindow to REGISTER_WINDOW_DAYS[register], hidden for registers whose input has no from/to (outstanding; check stockValue's input) which send {}; body states exactly what is queued ('Collections · CSV · 14 Aug–12 Sep'), confirmLabel 'Queue export'. After success: Toast 'Export queued', jobs list invalidated and polled every 3 s (jobs.refetch) while any row is queued/running, stopping otherwise. Order: contract → orders read + index export → registers.service → REGISTER_SPECS + FILE_STEM → reporting.spec → pnpm docs:readme → ExportButton → Orders screen → exports dialog + strings → walk.

### Binding amendments

- (a) No JSON GET for the orders register; the contract change is the enum value, the window cap and OrdersRegisterInput only. Permissions unchanged (reporting.exports.request stays MONEY_DESK; an enum value is not a route).
- (b) The orders read is a plain exported function (no Nest DI) reached only through orders/index.ts; registers.service.ts never imports orders.internals.ts.
- (c) The orders CSV carries names AND ids for shop and rep; money columns stay integer paise like every other register.
- (d) Polling lives in the component with setInterval + refetch; do not add a refetch interval to @dos/api-client (frontend/libs/api-client/src/react/index.tsx is owned by lean-manager-money).
- (e) The dialog offers only registers the contract lists, labelled by word(); the ExportButton's clampWindow rule applies in the dialog too, so no export can 400 on window_too_wide.
- (f) Never open a download URL without a tap (popup blockers); the button flips to 'Download export' and a Toast says it is ready.
- (g) Run pnpm docs:readme (the register enum appears in the reporting examples).

### Files

- `/Users/prajwalchavan/Desktop/Distribution OS/backend/libs/contracts/src/reporting.ts`
- `/Users/prajwalchavan/Desktop/Distribution OS/backend/libs/core/src/modules/orders/register-reads.ts (new)`
- `/Users/prajwalchavan/Desktop/Distribution OS/backend/libs/core/src/modules/orders/index.ts (one re-export line; unowned, same pattern as fillRateLines)`
- `/Users/prajwalchavan/Desktop/Distribution OS/backend/libs/core/src/modules/reporting/registers.service.ts`
- `/Users/prajwalchavan/Desktop/Distribution OS/backend/libs/core/src/modules/reporting/register-specs.ts`
- `/Users/prajwalchavan/Desktop/Distribution OS/backend/libs/core/src/modules/reporting/renderers.ts`
- `/Users/prajwalchavan/Desktop/Distribution OS/backend/libs/core/src/modules/reporting/reporting.spec.ts`
- `/Users/prajwalchavan/Desktop/Distribution OS/frontend/owner-app/src/lib/ui.tsx`
- `/Users/prajwalchavan/Desktop/Distribution OS/frontend/owner-app/app/orders/index.tsx`
- `/Users/prajwalchavan/Desktop/Distribution OS/frontend/owner-app/app/reports/exports.tsx`
- `/Users/prajwalchavan/Desktop/Distribution OS/frontend/owner-app/src/strings.ts`
- `generated: backend/*-service/README.md and app READMEs via pnpm docs:readme`

### Tests and walks

- reporting.spec.ts 'DOS-014: an orders export renders one CSV row per order in the window with its number, shop name, state and total, honours the state filter, and refuses a window wider than 92 days with window_too_wide' — RED today (register 'orders' fails the enum at request).
- reporting.spec.ts 'DOS-014: a salesperson-credited order appears in the owner's orders export (the register is back-office scoped, not rep-scoped)' — RED today for the same reason; guards the listOrders rep scope from leaking into the export.
- Platform walk, owner web: Reports → Exports → Request export opens the dialog; choose Collections · last 30 days → Queue → Toast 'Export queued', a queued row appears and turns succeeded within a few seconds with the worker running; Download opens the file. Orders → Export CSV → 'Preparing…' → 'Download export'; the file's row count equals the register's row count for the window and a state chip. Android Pixel_7_API_36: Orders → Export CSV → Download export opens the file through documents.open.

### Notes

The record's product question is answered by the owner brief ('every list is exportable'): a button labelled Export CSV on the orders register must export the orders. No founder decision needed. The DOS-160 exposure does not apply (RequestReportExportOutput's shape is unchanged; widening the enum breaks no stored reply).

## DOS-016 — needs-founder-decision

### Design

ROOT CAUSE. owner_summary.total_outstanding_paise is Σ retailer_outstanding_summary.outstanding_paise (backend/libs/core/src/modules/reporting/rollup.ts:192-201 → refreshOwnerSummary :567), the GROSS open value of bills; the ₹35,080 received on account (Σ unallocated_credit_paise) is rolled up nowhere, and neither OwnerDashboardOutput (backend/libs/contracts/src/reporting.ts:527-550) nor OutstandingListOutput.totals (contracts/receivables.ts:602-607) carries it. outstanding.ts:15-17 records the identity Σ(outstanding − unallocated) = AR, which is exactly the ₹44,24,374 − ₹43,89,294 gap against Books → Trial balance.

RECOMMENDED DEFAULT (build after the founder approves): keep every existing 'outstanding' figure gross — the ageing ladder, the ageing snapshots, the daily outstanding series and the shop register all sum to it, and re-defining them is a wide change — and make on-account a first-class number shown beside it with the net stated. Work order: (1) backend/libs/database/src/schema/reporting.ts OwnerSummaryDetail gains onAccountPaise?: number (jsonb; no migration, no _journal.json index — rollup.ts:521-524 calls detail expand-only by construction). (2) rollup.ts: the `live` query (:192-201) gains coalesce(sum(unallocated_credit_paise), 0)::bigint as unallocated; the dues precedence block (:206-212) is untouched (DOS-117 amendment (e)); refreshOwnerSummary writes detail.onAccountPaise: n(dues?.unallocated) — its `dues` argument is liveRow, so on-account is always live, like the ageing buckets. (3) seed-demo/reporting.ts seedReportingClose: the same sum and detail key. (4) contracts/reporting.ts OwnerDashboardOutput gains onAccountPaise: PaiseSchema (a GET, never a stored reply — no DOS-160 exposure); reporting.service.ts dashboardOwner: onAccountPaise: fromDetail('onAccountPaise'). (5) contracts/receivables.ts OutstandingListOutput.totals gains unallocatedCreditPaise: PaiseSchema; the totals SQL in receivables.queries.ts:270-301 (listOutstanding; the totals live there, not in outstanding.ts — the file is unowned) adds coalesce(sum(s.unallocated_credit_paise), 0) over the same filtered rows. (6) owner index.tsx tile: value stays gross; delta becomes 'overdue ₹X · less ₹35,080 on account' when onAccountPaise > 0 (else unchanged). money/index.tsx: under the ladder one line 'On account ₹35,080 · Net dues ₹43,89,294 (matches Books → Trial balance)'. (7) pnpm docs:readme; pnpm db:seed on dos_qa.

ALTERNATIVE (net headline): the same fields, but the tile's value = totalOutstandingPaise − onAccountPaise and the delta says 'incl. ₹35,080 on account'; nothing stored changes meaning, but the tile then disagrees with the ladder beside it and with the Reports → Outstanding series' last point until those are also re-defined (a separate, wider change).

### Binding amendments

- (a) The rollup.ts dues precedence (isToday → live; else existing daily_tenant_stats row; else the day's snapshot when rows > 0; else 0) is not edited; only the live query gains a column and refreshOwnerSummary a detail key. Merge over DOS-117 (e) as its verdict foresaw.
- (b) No new column on owner_summary and no migration: the figure lives in detail, typed through OwnerSummaryDetail so seed, rollup and reader cannot drift (the DOS-001 lesson).
- (c) totals.unallocatedCreditPaise is summed over every row the filter matches, exactly as outstandingPaise is, so a filtered Money screen still reconciles.
- (d) Money stays integer paise; the net is computed on the screen as outstanding − onAccount, never stored.
- (e) The identity test compares against the journal's AR balance (the trial balance query the accountant's Books uses), not against a re-sum of invoices.
- (f) Run pnpm docs:readme and re-run pnpm db:seed on dos_qa; the dashboard is a GET so DOS-160 does not gate this merge.

### Files

- `/Users/prajwalchavan/Desktop/Distribution OS/backend/libs/database/src/schema/reporting.ts`
- `/Users/prajwalchavan/Desktop/Distribution OS/backend/libs/core/src/modules/reporting/rollup.ts`
- `/Users/prajwalchavan/Desktop/Distribution OS/backend/libs/core/src/modules/reporting/reporting.service.ts`
- `/Users/prajwalchavan/Desktop/Distribution OS/backend/libs/contracts/src/reporting.ts`
- `/Users/prajwalchavan/Desktop/Distribution OS/backend/libs/contracts/src/receivables.ts`
- `/Users/prajwalchavan/Desktop/Distribution OS/backend/libs/core/src/modules/receivables/receivables.queries.ts (listOutstanding totals; unowned — the totals are built there, not in outstanding.ts)`
- `/Users/prajwalchavan/Desktop/Distribution OS/backend/libs/core/src/modules/reporting/reporting.spec.ts`
- `/Users/prajwalchavan/Desktop/Distribution OS/backend/libs/core/src/modules/receivables/receivables.spec.ts`
- `/Users/prajwalchavan/Desktop/Distribution OS/backend/libs/database/src/seed-demo/reporting.ts`
- `/Users/prajwalchavan/Desktop/Distribution OS/frontend/owner-app/app/index.tsx`
- `/Users/prajwalchavan/Desktop/Distribution OS/frontend/owner-app/app/money/index.tsx`
- `/Users/prajwalchavan/Desktop/Distribution OS/frontend/owner-app/src/strings.ts`
- `generated: backend/*-service/README.md and app READMEs via pnpm docs:readme`

### Tests and walks

- reporting.spec.ts 'DOS-016: after a rollup the owner dashboard carries onAccountPaise = Σ unallocated_credit_paise, and totalOutstandingPaise − onAccountPaise equals the AR balance in journal_lines' — with one on-account receipt in the fixture; RED today (field absent).
- receivables.spec.ts 'DOS-016: outstanding.list totals carry unallocatedCreditPaise over every matching row, and it follows the bucket/overdue filters like outstandingPaise does' — RED today.
- reporting.spec.ts guard: the DOS-117 precedence test (today live, yesterday kept, today−7 snapshot) stays green on the merged tree.
- Platform walk, owner web + Android: Today → Outstanding ₹44,24,374 with 'less ₹35,080 on account'; Money → 'On account ₹35,080 · Net dues ₹43,89,294' equal to Books → Trial balance AR Sundry Debtors after pnpm db:seed on dos_qa.

### Founder question

**On the owner's home screen, should 'Outstanding' stay the total of open bills (₹44,24,374) with the ₹35,080 already received on account shown beside it and the net stated, or should the headline itself become the net figure (₹43,89,294) that equals Sundry Debtors in the books?**

Recommended default: Keep the headline as open bills, show 'less ₹35,080 on account' beside it, and state the net on the Money screen so it always matches the books. Nothing already stored changes meaning.

- Alternative: Make the headline the net figure (tile = books); the ageing ladder, the outstanding history chart and the shop register still sum to open bills, so the on-account line is needed there anyway and those would need re-defining later.
- Alternative: Show both numbers as two tiles (Open bills · Net dues).

### Notes

On-account credit arises only when a receipt exceeds a shop's open bills or is taken with no allocation; the default surfaces it everywhere the gross figure appears. DOS-007's statement pay link already uses the net due and is unaffected.

