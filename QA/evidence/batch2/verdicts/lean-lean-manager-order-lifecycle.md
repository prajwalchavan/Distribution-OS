# lean-manager-order-lifecycle — architect lean design (Fable, 2026-09-13)

Run `wf_1c5f484c-b7b`. In lean mode this design IS the signed-off plan for these items. Items marked *needs-founder-decision* are built only after the founder approves the recommended default (or picks an alternative).

## DOS-009 — design-ready

### Design

ROOT CAUSE. All three lists page and sort on the row id: backend/libs/core/src/modules/orders/orders.internals.ts:328 (`lt(salesOrders.id, cursor)`) and :334 (`desc(salesOrders.id)`); backend/libs/core/src/modules/billing/invoices.service.ts:881 and :887; backend/libs/core/src/modules/delivery/trips.service.ts:290 and :296. Seeded rows carry hash ids, imported and pre-planned rows are minted long before or after their business date, so id order is not age. DOS-023 and DOS-133 already settled the convention for waves and packs (picklists.service.ts:291-304, packing.service.ts:207, index 0047 `pack_confirmations_created_idx (tenant_id, created_at, id)`); this item applies it to the three desk lists.

THE ONE CONVENTION (binding for DOS-145 and every later list). Sort key = the column the list's own `from`/`to` window already filters on, so the window and the order never disagree: Orders → `sales_orders.created_at` (listOrders filters on it at :323-324; drafts have no submitted_at; DOS-098's `coalesce(submitted_at, created_at)` is a different question, 'last placed', and stays there); Bills → `invoices.invoice_date` (list filters on it at :868-869; a bill register is by invoice date); Trips → `trips.trip_date` (list filters on it at :287-288; a pre-planned trip is a future-dated row). Order: `desc(key), desc(id)`. Cursor: the wire shape is UNCHANGED — `nextCursor` stays the last row's id, and the server resolves it to the row value inside the tenant transaction, exactly the picklists pattern: `sql\`(${t.key}, ${t.id}) < (select c.<key>, c.id from <table> c where c.tenant_id = ${tenantId} and c.id = ${input.cursor})\``; an unknown cursor matches nothing. Every list gains an explicit `eq(t.tenantId, ctx.tenantId)` predicate (invoices.list has it; orders.list and trips.list do not) so the planner starts from the tenant-led index under `app_rw` (DOS-133 amendment b). No contract text changes, so no README regeneration for this item.

INDEXES (docs/20 rule 8: tenant-led, one index walk per page). sales_orders: add `sales_orders_created_idx (tenant_id, created_at, id)` in backend/libs/database/src/schema/orders.ts next to :112-116. invoices: add `invoices_date_idx (tenant_id, invoice_date, id)` in schema/billing.ts next to :114-134. trips: widen the existing `trips_date_idx` (schema/delivery.ts:201) from `(tenant_id, trip_date)` to `(tenant_id, trip_date, id)` under the same name — drizzle emits DROP INDEX + CREATE INDEX, the precedent is 0010 dropping the subsumed `pack_confirmations_order_idx`; the equality lookups on trip_date (trips.service.ts:221, :360) are served by the wider index unchanged. The three index changes ride in the SAME generated expand migration as DOS-138's `pick_lines.cancelled_at` column (one `pnpm db:generate` run for the group; take the next free index from `_journal.json` at build time, 0048 as of this design), no hand-written sibling (index and nullable column only; precedent 0047 and DOS-133 amendment f).

ORDER OF WORK. (1) schema edits → `pnpm db:generate` → journal; (2) orders.internals.ts listOrders; (3) invoices.service.ts list; (4) trips.service.ts list; (5) the three red-then-green specs; (6) docs/22 §8 architect-default row + strike the DOS-023 bullet in §10 + §11 line; (7) EXPLAIN checks; (8) web + Android walk. Nothing changes in any app: the owner and manager Orders, Bills and Trips screens do not sort client-side (grepped), they simply render the page they get.

### Binding amendments

- (a) `nextCursor` remains the last row's id (opaque string to the client); the cursor is resolved to a row value server-side by a subquery INSIDE the same withTenant transaction with an explicit `c.tenant_id = ${tenantId}` fence. Never encode `(date, id)` into the cursor string and never compare on `id` alone.
- (b) The sort key for each list is the column its own `from`/`to` filter uses: created_at (orders), invoice_date (bills), trip_date (trips). Do not introduce a `sortBy` input; sortable headers are not part of this item.
- (c) Add the explicit tenant predicate to `listOrders` and `trips.list` (invoices.list already has it) — RLS stays the guarantee, the literal is what lets the planner use the tenant-led index; verify with EXPLAIN ANALYZE run under `SET LOCAL ROLE app_rw` with `app.tenant_id` set, expecting an Index Scan Backward on the new index and no Seq Scan of sales_orders / invoices / trips.
- (d) One generated migration for the whole group (these three index changes + DOS-138's column), next free index from `_journal.json` at build time; never hand-renumber; no hand-written sibling because no table, policy, grant or trigger changes.
- (e) The trips index keeps its name `trips_date_idx` and widens to (tenant_id, trip_date, id): drizzle's DROP + CREATE in the generated file is accepted on the 0010 precedent; do not leave two indexes with the same prefix.
- (f) The retailer-role and salesperson filters in listOrders (`salespersonId` forced for a rep, RLS for a shop) are untouched; `trips.list` keeps `mine` forced for the delivery role — the specs assert both still hold under the new order.
- (g) Out of scope, recorded not fixed: `fulfilmentQueue` (orders/fulfilment.ts:105,178), `loadSheets.list` (load-sheets.service.ts:227,233), `trips.stops.list` (trips.service.ts:611,617) and `billing.invoices.queue` (invoices.service.ts:706,726) are still id-ordered — the first three are already listed in the DOS-133 verdict's new findings; DOS-145 applies this convention to the sales register.

### Files

- `backend/libs/core/src/modules/orders/orders.internals.ts`
- `backend/libs/core/src/modules/billing/invoices.service.ts`
- `backend/libs/core/src/modules/delivery/trips.service.ts`
- `backend/libs/database/src/schema/orders.ts`
- `backend/libs/database/src/schema/billing.ts`
- `backend/libs/database/src/schema/delivery.ts (outside the owned list: the only home of `trips_date_idx`, a one-line index widening)`
- `backend/libs/database/migrations/<next>_order_lifecycle_expand.sql (generated, shared with DOS-138)`
- `backend/libs/database/migrations/meta/_journal.json`
- `backend/libs/core/src/modules/orders/orders.spec.ts`
- `backend/libs/core/src/modules/billing/billing.spec.ts`
- `backend/libs/core/src/modules/delivery/delivery.spec.ts`
- `docs/22-source-of-truth.md`

### Tests and walks

- orders.spec.ts › 'DOS-009: orders.list is newest first by creation time — an order back-dated by a day on the owner pool (BYPASSRLS, the DOS-023 precedent at warehouse.spec :1988-1997) with an id that sorts higher lands below today's orders; with limit=1 the cursor walks every order of the tenant exactly once in (created_at, id) order, with and without the from/to window; a rep still sees only its own orders and a shop only its own' — red today (id order), green after.
- billing.spec.ts › 'DOS-009: invoices.list is newest first by invoice_date then id — a bill dated yesterday whose id sorts higher lands below today's bills; two bills on one date come back higher id first; the cursor walks each once with limit=1; from/to still filter on invoice_date; openOnly/overdueOnly and q are unchanged' — red today, green after.
- delivery.spec.ts › 'DOS-009: trips.list is newest first by trip_date then id — a trip planned for tomorrow tops a trip for today created later; the cursor walks each once; the crew's list is still forced to its own trips' — red today, green after.
- EXPLAIN (verifier, under app_rw with app.tenant_id set): `select * from sales_orders where tenant_id = $1 order by created_at desc, id desc limit 51` → Index Scan Backward on sales_orders_created_idx; the same on invoices_date_idx and trips_date_idx; `\d trips` shows trips_date_idx with three columns.
- `pnpm --filter @dos/core test -- src/modules/orders`, `src/modules/billing`, `src/modules/delivery` green including DOS-023, DOS-098, DOS-133 and DOS-043; `pnpm smoke --only GET` 0 BROKEN.
- Platform walk (web 1280 and 375; Android Pixel_7_API_36 owner app Orders tab): owner Orders (30 days), Billing → Bills, Orders → Trips and the manager's Orders, Bills, Trips read newest first — today's SO-08xx rows above 25 Aug; the second page (Show more / scroll) continues without a repeat; iOS recorded as not walked (no screen changed).

### Notes

Technical choice, no founder decision: the finding's expectation ('newest first') is unambiguous and DOS-023/DOS-133 already chose server-time ordering with a row-value cursor; this only picks the business column per list and records the convention in docs/22 §8 so DOS-145 and later lists follow it. No contract, permission or RLS change; no app change; one migration shared with DOS-138. The docs/22 §10 open question '(QA DOS-023) should every list sort by server time' is answered by this row and struck.

## DOS-030 — design-ready

### Design

ROOT CAUSE — two, and the finding saw only the first. (1) backend/libs/core/src/modules/docint/documents.service.ts:545-549 answers 501 for `kind = 'brand_dms_invoice'` and `ApproveDocumentInput` (backend/libs/contracts/src/docint.ts:1088-1100) can only describe a supplier-invoice draft. (2) backend/libs/core/src/modules/docint/pipeline/validators.ts:177-185 emits `buyer_gstin_mismatch` at severity `error` whenever the printed buyer GSTIN differs from the tenant's, and `review.submit` refuses while a red check stands (review.service.ts:270-277) — on a brand bill the BUYER IS THE SHOP and the SELLER IS US, so a real Too Yumm bill can never reach `reviewed`, whatever approve does. The behaviour itself is already fixed by docs/22: §5 'Too Yumm bills billed in FieldAssist → extraction → committed as brand_dms_import sales: receivable in, NO stock, NEVER a second legal invoice', §8 2026-08 'coexist by import', never-list 5, and the engine exists: `InvoicesService.importBrandDms(tx, input)` (invoices.service.ts:426) — it refuses a repeated external number with 409, never advances our counter, posts the receivable and moves no stock. So a photographed brand bill is committed from the Documents tab through that engine; the FieldAssist export importer lands on the same row and the same duplicate guard, whichever arrives first.

CHANGE, in order. (1) contracts/docint.ts: `ApproveDocumentInput` becomes kind-shaped but stays ONE procedure (no matrix change): `supplierInvoiceId` optional, add `invoiceId: IdSchema.optional()` (client id of the invoices row) and `retailerId: IdSchema.optional()` (the shop the bill is for); server: supplier kind requires supplierInvoiceId, brand kind requires invoiceId + retailerId, 400 `invoice_id_required` / `retailer_required` otherwise; `lineIds` is reused as the invoice line ids. `ApproveDocumentOutput`: `supplierInvoice` becomes `.nullable()` and `invoice: InvoiceItemSchema.nullable()` is added (import the schema from billing.ts). (2) contracts/billing.ts: `ImportBrandDmsInvoiceInput.placeOfSupplyState` becomes optional; invoices.service.ts importBrandDms defaults it to `placeOfSupplyOf(buyer)`; expose a public `invoiceItem(tx, id): Promise<InvoiceItem>` on InvoicesService (the existing findInvoice + detail) for the idempotent replay. (3) pipeline/validators.ts: `ValidationContext` gains `kind: DocumentKind`; `buyer_gstin_mismatch` runs only when kind !== 'brand_dms_invoice'; for the brand kind push `seller_gstin_is_ours` (error) comparing `h.supplierGstin` with the tenant GSTIN when both are present, and keep `supplier_gstin_matches_master` as a warn; the two callers that build the context (extractions.service.ts, review.service.ts) pass `doc.kind`. (4) docint.module.ts imports BillingModule (docint is downstream of billing in the chain; procurement is imported the same way at :27) and DocumentsService injects InvoicesService. (5) documents.service.ts approve: keep the idempotent replay on a committed document (answer `invoice` when `committedEntityType = 'invoice'`); for the brand kind, after the same `reviewed` and submitted-session checks, map `reviewed` → `importBrandDms`: `externalInvoiceNo = h.invoiceNo`, `invoiceDate = h.invoiceDate`, `retailerId = input.retailerId`, `buyerGstin = h.buyerGstin ?? undefined`, `placeOfSupplyState = h.placeOfSupplyState ?? undefined`, lines: `variantId` (400 `line_unmatched` naming the lineNo when null), `description`, `hsnCode` (400 `hsn_required` when null or not 4-8 digits), `qtyPcs`, `freeQtyPcs`, per-piece `ratePaise` = printed rate when `rateBasis = 'piece'`, else `Math.round(ratePaise / basisQty)`, `discountPaise = ratePerPiece * qtyPcs - taxablePaise` (400 `line_incomplete` if negative or taxable/tax/lineTotal null), `gstBps`, `cessBps`, `batchNo`, `expiryDate`, `mrpPaise`, `enteredQty/enteredUnit/packSizeAtEntry` from printedQty/printedUnit/caseSize; `roundOffPaise = h.totalPaise - sum(lineTotals as importBrandDms computes them)`, refused as 400 `total_mismatch` when |roundOff| > 99 paise (the review's own GST-arithmetic checks make anything larger a reading error, not rounding). Then `transition(tx, doc, 'commit', { committedEntityType: 'invoice', committedEntityId: invoice.id, committedAt })`, the existing commit event with entity type 'invoice', and `{ item, supplierInvoice: null, invoice }`. A 409 from importBrandDms (already imported by the file importer) passes through with its message; the document stays `reviewed` for the desk to reject as a duplicate. Roles unchanged: DESK_WRITERS (owner, manager; the accountant captures but never books, DOS-037). (6) `pnpm docs:readme` (contract changed). (7) frontend/manager-app/app/inbound/documents.tsx: the commit button and dialog are per kind — brand: label `m3.approveBrand` 'Book it as the brand's bill', body `m3.approveBrandBody` 'Records the FieldAssist bill under its own number {no}, money owed by {shop}. No stock moves and none of our bill numbers is used.', a required Shop field pre-filled from `retailers.list({ q: buyerName })` when exactly one shop matches, else a search box + ListRow pick (the shops screen's list pattern), the mutation sending `invoiceId: uuidv7()`, `retailerId`, `lineIds`; supplier: unchanged. brand-dms.tsx header comment updated to say the Documents tab commits through docint.approve → importBrandDms. (8) docs/22 §5 gains one line under the J→K edge naming the path; §11 line.

### Binding amendments

- (a) ONE procedure, no matrix change: `docint.documents.approve` stays the commit verb for both kinds; do not add a `commitBrandDms` procedure. The input is validated per `doc.kind` on the server; the client's kind is never trusted.
- (b) Never a second legal invoice (never-list 5): `invoiceNo = externalInvoiceNo`, the tenant's invoice counter is not touched, `stock_ledger` gains zero rows — the spec counts the ledger and the numbering counter before and after. Never pass `seriesCode` from docint; the tenant's external series is the default.
- (c) The validator change is the prerequisite: `buyer_gstin_mismatch` must not fire on a brand bill and `seller_gstin_is_ours` (error) must; both are pinned by a validators unit case and the spec's real bill fixture carries the shop's GSTIN as buyer and the tenant's as seller. Files outside the owned list — pipeline/validators.ts, extractions.service.ts, review.service.ts (context builders), docint.module.ts (BillingModule import) — are touched only for this, in the smallest diff.
- (d) Money exactness: line taxable must equal the reviewed taxable to the paisa (the discount absorbs a per-case rate that does not divide by the pack); the header total must equal the reviewed total within a round-off of ±99 paise, else 400 `total_mismatch` — the brand's document is the legal one and we store it verbatim.
- (e) Idempotent on the document: a replay of approve on a committed brand document answers the same `invoice`; a replay with a different `invoiceId` also answers the existing one (the document, not the client id, is the identity).
- (f) A 409 from importBrandDms ('imported before') is surfaced verbatim; the document is left `reviewed` (never auto-rejected, never-list 6); the panel's Refusal shows it and the desk rejects with reason `duplicate`.
- (g) The shop is chosen by the reviewer (pre-filled by name when unique); no GSTIN-based auto-commit and no new retailers index in this item — record 'match the shop by GSTIN' as a later enhancement in docs/25.
- (h) README regeneration is mandatory (`pnpm docs:readme`, CI runs --check); never edit the READMEs by hand.

### Files

- `backend/libs/contracts/src/docint.ts`
- `backend/libs/contracts/src/billing.ts`
- `backend/libs/core/src/modules/docint/documents.service.ts`
- `backend/libs/core/src/modules/docint/docint.module.ts (outside the owned list: adds the BillingModule import, one line)`
- `backend/libs/core/src/modules/docint/pipeline/validators.ts (outside the owned list: kind-aware buyer/seller GSTIN checks — the second root cause)`
- `backend/libs/core/src/modules/docint/extractions.service.ts and review.service.ts (outside the owned list: pass doc.kind into the validation context)`
- `backend/libs/core/src/modules/billing/invoices.service.ts`
- `backend/libs/core/src/modules/docint/docint.spec.ts`
- `backend/libs/core/src/modules/billing/billing.spec.ts`
- `backend/*-service/README.md and app READMEs (generated by pnpm docs:readme)`
- `frontend/manager-app/app/inbound/documents.tsx`
- `frontend/manager-app/app/billing/brand-dms.tsx`
- `frontend/manager-app/src/strings.ts`
- `docs/22-source-of-truth.md`
- `docs/25-phase-2-enhancements.md (one line: shop match by GSTIN)`

### Tests and walks

- docint.spec.ts › 'DOS-030: a photographed brand-DMS bill whose buyer is the shop and whose seller is us reaches reviewed — buyer_gstin_mismatch is not raised for kind brand_dms_invoice, seller_gstin_is_ours passes, blocking is 0' — red today (submit refuses with checks_blocking), green after.
- docint.spec.ts › 'DOS-030: approving a reviewed brand-DMS document books it as a brand_dms_import invoice under the brand's own number against the chosen shop — invoiceNo equals the printed number, our invoice counter is unchanged, stock_ledger gains zero rows, the shop's outstanding rises by the bill total, the document is committed with committedEntityType invoice, and a replay answers the same invoice' — red today (501), green after.
- docint.spec.ts › 'DOS-030: approve refuses a brand document without retailerId (400 retailer_required), with an unmatched line (400 line_unmatched naming the line), with a total that does not reconcile (400 total_mismatch), and answers 409 verbatim when the file importer landed the same external number first, leaving the document reviewed'.
- docint.spec.ts › 'DOS-030 guard: a supplier document still books a DRAFT supplier bill with supplierInvoiceId and answers invoice: null; DOS-037 still holds — the accountant cannot approve either kind'.
- billing.spec.ts › 'DOS-030: importBrandDms with placeOfSupplyState omitted uses the buyer's state and computes intra/inter-state GST accordingly'.
- validators unit case (pipeline) › 'DOS-030: kind brand_dms_invoice skips buyer_gstin_mismatch and raises seller_gstin_is_ours as an error when the seller GSTIN is not the tenant's'.
- `pnpm docs:readme:check` green; `pnpm smoke --service manager` 0 BROKEN.
- Platform walk (manager web 1280 and 375, Android): Inbound → Documents → FA/TY/26-27/1187 → Start reviewing → This reading is right → 'Book it as the brand's bill' with the shop pre-filled → confirm → panel reads Booked; Billing → Brand DMS lists FA/TY/26-27/1187 with source brand_dms_import; the supplier document GUR/26-27/00490 still shows 'Book it as a supplier bill'; iOS recorded as not walked.

### Notes

No founder decision needed: docs/22 §5, §8 (2026-08) and never-list 5 already fix the behaviour; this item builds the path that was designed and finds the second cause (the buyer-GSTIN validator) that would have blocked every real brand bill even after the 501 went away. Roles unchanged (owner, manager book; the accountant captures only, DOS-037). Contract change is additive except `ApproveDocumentOutput.supplierInvoice` becoming nullable, which TypeScript surfaces at the one manager-app call site. Effort L as inventoried; the app-only stopgap (hide Book for brand documents) is superseded by this design and should not be shipped separately.

## DOS-138 — needs-founder-decision

### Design

ROOT CAUSE. backend/libs/domain/src/state-machines/order.ts:42 `picking: { pack: 'packed' }` — no cancel edge; docs/22 §4 line 141 says 'cancel allowed up to confirmed'. The manager panel (frontend/manager-app/app/orders/index.tsx:667) and the owner panel (frontend/owner-app/app/orders/index.tsx:366) disable Cancel only for cancelled/delivered, so a picking order gets the machine's raw 409. `pick_lines` (backend/libs/database/src/schema/warehouse.ts:102-147) has no put-back marker, so a picker could not be told even if the server allowed it. A second, pre-existing hole the same fix closes: an order cancelled from `confirmed` while it already sits on an OPEN wave (allowed today) breaks that wave — `picklists.start` (picklists.service.ts:358-359) applies start_picking to every orderId and 409s on the cancelled one.

RECOMMENDED DEFAULT (build only after the founder approves). The desk — owner or manager — may cancel an order while it is being picked; the hold is released, the picker's sheet shows which lines to put back, no invoice is issued. A packed order is never cancelled directly: its bill is cancelled and the order goes with it (DOS-139). After dispatch, only a credit note. Reps and shops keep today's reach (shop: draft/submitted; rep: up to confirmed).

CHANGE, in order. (1) domain: `picking: { pack, cancel: 'cancelled' }` and `packed: { dispatch, cancel: 'cancelled' }` (the second is DOS-139's edge; the procedure below refuses it, billing uses it); state-machines.test.ts:36 flips `can('picking','cancel')` to true and adds packed. (2) schema/warehouse.ts pick_lines: `cancelledAt: tz('cancelled_at')` nullable, JSDoc 'set when the order was cancelled while this line was on a live sheet: picked pieces go back on the rack' — in the group's single generated expand migration (with DOS-009's indexes), no sibling. (3) orders.service.ts: `cancel` (procedure) keeps `assertRetailerOwns`, adds two guards BEFORE the machine so the message says why: state `picking` and actor not owner/manager → 409 'order X is being picked; only the desk can cancel it now'; state `packed` → 409 'order X is packed and billed as <no>; cancel the bill and the order goes with it' (the packed edge is reserved for billing). New registration `registerCancelled(hook: (tx, order, reason) => Promise<void>)` on OrdersService — the DOS-132 `registerTripSettled` pattern (receivables.service.ts:328), downstream registers with upstream at start-up, no import back — and `cancelInTx` runs every registered hook inside the same transaction after the state update and before recordTransition/emit. (4) picklists.service.ts: `PicklistsService implements OnModuleInit` and registers `putBackOrder` (Nest runs onModuleInit on providers; owner and manager services mount both modules, definitions.ts:59-70 and :114-125, so the desk's cancel is same-transaction). `putBackOrder(tx, orderId, reason)`: update pick_lines set cancelled_at = now(), updated_at = now() where order_id = ? and cancelled_at is null and picklist_id in live sheets (open/picking/picked) — updated_at bumps so the device's delta pull carries it; then for each touched sheet, if no line with cancelled_at null remains, `updatePicklist({ status: 'cancelled', cancelledAt, cancelReason: 'every order on it was cancelled: ' + reason })`; idempotent by the null filter. Reconcile in `start`: read `this.orders.fulfilmentOrders(tx, sheet.orderIds)`, call putBackOrder for any order that is `cancelled`, then apply start_picking only to orders that still have an uncancelled line on the sheet (closes the open-wave 409). `applyPicks`: a pick against a line with cancelled_at set → 409 `line_put_back` 'line X was cancelled; put the pieces back'; `refreshCompletion` and `perLineTotals` ignore cancelled rows; `markPackedIfComplete` treats an order whose lines on the sheet are all cancelled as done. (5) contracts/warehouse.ts `PickLineSchema.cancelledAt: z.string().nullable()` (additive) and warehouse.mappers.ts `toPickLine` maps it; `pnpm docs:readme`. The device receives the column automatically: `tablePull(pickLines)` publishes every column, the manifest's schemaVersion hashes the tables, and the device re-creates its tables on a changed version (contracts/sync.ts:13-14). (6) frontend/warehouse-app/app/pick/[id].tsx: rows with `cancelled_at !== null` leave the to-do count and the Confirm gate and render in a 'Put back' group — `w5.putBack` 'Put back {pieces} pcs · {batch}' when picked_qty_pcs > 0, `w5.notNeeded` 'Not needed — order cancelled' when 0; strings in warehouse strings.ts. (7) manager and owner Orders panels: Cancel enabled on submitted/confirmed/picking (desk apps), disabled on packed with `m2.cancelViaBill` / `o5.cancelViaBill` 'Cancel its bill; the order is cancelled with it' and a link to the bill, disabled on dispatched/delivered/partially_delivered/closed with 'After dispatch the only correction is a credit note'; the dialog body for picking adds 'The picker will be told which lines to put back.' (8) docs/22 §4 line 141 → 'cancel allowed up to picking by the desk (owner, manager); a packed order is cancelled only through its bill; after dispatch a credit note'; §8 row; §11 line.

### Binding amendments

- (a) The picking cancel is desk-only (owner, manager) inside the handler, like the retailer's state restriction; the matrix row `orders.cancel: ORDER_PLACERS` is not changed and the rep's and shop's reach stay exactly as today.
- (b) Cross-module coupling only by registration (DOS-132 precedent) or by warehouse calling orders' exported surface: orders never names pick_lines or picklists; warehouse never names sales_orders. The registration lives in `PicklistsService.onModuleInit` (owned file), not in warehouse.module.ts.
- (c) The hook is a fallback-safe design: services that mount orders without warehouse (sales, retailer) register nothing, and `picklists.start` reconciles a cancelled order on its sheet before starting — the spec pins both paths.
- (d) The picked pieces of a cancelled order are NOT posted anywhere: reservations are released (cancelInTx), no stock_ledger row is written (a half-picked wave never touched the ledger), and the physical put-back is the picker's act shown on W5. If the order was already packed (DOS-139), the invoice cancel's restock is the only ledger movement.
- (e) A pick on a put-back line is refused online with 409 `line_put_back` and offline as a SyncRejection `line_put_back` (never a 4xx on /sync/upload) — if applyPicks' 409 is not already mapped by the sync door, add the pre-check in warehouse.sync.ts (outside the owned list, six lines).
- (f) One generated migration for the group (with DOS-009's indexes); `updated_at` must be bumped on every pick_lines row the hook touches so the delta pull carries the change.
- (g) Build the packed/dispatched disabled reasons and the picking guard messages immediately (they follow DOS-139 and need no decision); build the picking→cancelled edge, the hook, the column and the W5 put-back group only after the founder approves the default.

### Files

- `backend/libs/domain/src/state-machines/order.ts`
- `backend/libs/domain/src/state-machines/state-machines.test.ts`
- `backend/libs/database/src/schema/warehouse.ts`
- `backend/libs/database/migrations/<next>_order_lifecycle_expand.sql (generated, shared with DOS-009)`
- `backend/libs/database/migrations/meta/_journal.json`
- `backend/libs/core/src/modules/orders/orders.service.ts`
- `backend/libs/core/src/modules/orders/orders.spec.ts`
- `backend/libs/core/src/modules/warehouse/picklists.service.ts`
- `backend/libs/core/src/modules/warehouse/warehouse.spec.ts`
- `backend/libs/contracts/src/warehouse.ts (outside the owned list: additive PickLineSchema.cancelledAt)`
- `backend/libs/core/src/modules/warehouse/warehouse.mappers.ts (outside the owned list: toPickLine maps the new column, one line)`
- `backend/libs/core/src/modules/warehouse/warehouse.sync.ts (outside the owned list, only if the 409 is not already mapped to a SyncRejection)`
- `backend/*-service/README.md (generated)`
- `frontend/manager-app/app/orders/index.tsx`
- `frontend/manager-app/src/strings.ts`
- `frontend/owner-app/app/orders/index.tsx`
- `frontend/owner-app/src/strings.ts`
- `frontend/warehouse-app/app/pick/[id].tsx`
- `frontend/warehouse-app/src/strings.ts`
- `docs/22-source-of-truth.md`

### Tests and walks

- state-machines.test.ts › 'DOS-138/139: picking and packed may cancel; the happy path is unchanged' — red today (can('picking','cancel') is false), green after.
- orders.spec.ts › 'DOS-138: the manager cancels an order mid-pick — 200 cancelled with the reason, every reservation voided and reserved back to zero, pending approvals expired, an OrderCancelled outbox row; the same call by the rep on a picking order is 409 "only the desk"; on a packed order it is 409 "cancel the bill" for everyone; a shop is still limited to draft/submitted' — red today (409 cannot apply cancel in state picking), green after.
- warehouse.spec.ts › 'DOS-138: two orders on one wave, three of five lot rows picked; the desk cancels one order — in the same transaction its pick lines carry cancelled_at (updated_at bumped), the other order's lines do not, the sheet stays picking, a pick on a put-back line is 409 line_put_back online and a sync rejection line_put_back offline, the remaining order packs and the sheet goes packed; cancelling the last order closes the sheet as cancelled with the reason' — red today, green after.
- warehouse.spec.ts › 'DOS-138: an order cancelled from confirmed while on an open wave no longer breaks the wave — picklists.start marks its lines put-back, starts the others and answers 200' — red today (409 from applyFulfilmentEvent), green after.
- `pnpm --filter @dos/core test -- src/modules/warehouse` and `src/modules/orders` green including DOS-040, DOS-041, DOS-042, DOS-115 and DOS-133; `pnpm docs:readme:check` green.
- Platform walk (manager web 1280 and 375, owner web, warehouse Android Pixel_7_API_36 with -memory 3072): wave SO-A + SO-B, dinesh.patil starts and picks two lines of SO-A; vikas.kadam Orders → Being picked → SO-A → Cancel order → reason → 200, row moves to Cancelled; W5 on the Pixel syncs and shows SO-A's lines under 'Put back' with the picked pieces and batch, progress counts only SO-B, Confirm gate ignores SO-A; on a packed order the manager and owner see Cancel disabled with 'Cancel its bill…' and the bill link; iOS: the cancel dialog inside the Sheet was walked on the merged DOS-164, recorded as not re-walked.

### Founder question

**When a shop phones during picking, may the desk (owner or manager) cancel the order — the hold is released, the picker's sheet shows which lines to put back, and no GST invoice is issued — while a packed order is cancelled only through its bill and after dispatch only a credit note applies?**

Recommended default: Yes: the desk may cancel up to and including picking; reps and shops keep today's limits; packed orders are cancelled through the bill (DOS-139); after dispatch a credit note. This stops every mid-pick cancellation from burning a legal invoice number and leaves no order stuck in picking with stock reserved.

- Alternative: Keep docs/22's 'cancel only up to confirmed': hide Cancel on picking and packed orders and state the route 'finish packing, then cancel the bill' (costs an invoice number and GST paperwork per cancellation; orders stay in picking with stock held until then).
- Alternative: Let every role that may cancel today (owner, manager, salesperson, retailer within their reach) also cancel during picking (the floor learns of a cancellation from a rep's phone with no desk in the loop).
- Alternative: A desk 'stop picking' that returns the order to confirmed and re-waves it later (needs a picking→confirmed edge, re-reservation and a second wave; larger, and still no answer for a shop that no longer wants the goods).

### Notes

Business rule (what a role may do to an order the floor is already handling, and a stock-handling instruction to the picker), so the founder decides; the design is complete for the default. Effort L. Shares the machine edit and the migration with DOS-139/DOS-009; the packed/dispatched disabled reasons can ship with DOS-139 before the answer. If the founder chooses alternative 1, the build shrinks to the two panels' disabled reasons and route sentence plus the docs/22 wording — no schema, no hook.

## DOS-139 — design-ready

### Design

ROOT CAUSE. backend/libs/core/src/modules/billing/invoices.service.ts:788-850 `cancel` restocks (`restock`) and reverses the journal (`reverseInvoiceEntry`) but never moves the order; backend/libs/domain/src/state-machines/order.ts:44 has only `packed: { dispatch }`; `queue` (:696-745) lists packed orders whose invoices are all cancelled, so the desk is offered a bill for goods already back on the rack. THE RE-BILL PROBE, reasoned from the code (the verifier runs it as the red test's first assertions): after the cancel, `packs.confirm` again is 409 on `pack_confirmations_order_uniq` (`assertNotAlreadyPacked`, packing.service.ts:328-336) and no app calls `issueForPack`, so the invoice path cannot double-sell; but `packs.list?status=awaiting_load` still offers the order (DOS-133 verdict recorded SO-0909/INV/9014 exactly so), `loadSheets.create` (load-sheets.service.ts:165-191) accepts any packed order with a pack row and never looks at the invoice's state, and `confirm` never re-checks — a confirmed sheet would move the 168 restocked pieces godown → vehicle and `trips.depart` would dispatch the order with a cancelled bill. That is the P1-class hole, and it is closed by this design; if the verifier can drive it end to end on main it is recorded in the report as confirmed, not escalated, because the fix below is the escalation.

DECISION. The order is cancelled with its bill, in the same transaction. 'Back to confirmed' would need a second pack and a second invoice for the same order, which `pack_confirmations_order_uniq` exists to forbid ('the invoice is issued once' is a database guarantee, coordination §5.4); dropping it is a schema-guarantee change outside batch 2, and the shop that still wants the goods gets a fresh order (the pilot's correction, as billing.spec.ts:742-746 already documents).

CHANGE, in order. (1) domain: `packed: { dispatch, cancel: 'cancelled' }` (shared edit with DOS-138; land it here if DOS-138 waits). (2) orders.service.ts `cancel` (the procedure) refuses `packed` with 409 'order X is packed and billed as <no>; cancel the bill and the order goes with it' — the edge is for billing only; `cancelInTx` stays public and is what billing calls. (3) invoices.service.ts `cancel`: after `restock` and `reverseInvoiceEntry`, when `invoice.orderId` is set and the order is `packed` (the only pre-dispatch state an issued pack bill can have; `confirmed`/`picking` orders carry no issued bill), call `this.orders.cancelInTx(tx, order, \`bill ${invoiceNo} cancelled: ${reason}\`.slice(0, 200), input.deviceId ?? null)` — it releases nothing (holds were posted at pack), expires pending approvals, records the transition and emits OrderCancelled (the shop's notification template already exists); the DOS-138 hook, if registered, marks any of its lines still on a live multi-order wave as put-back, which is physically right: the cartons are unpacked. A brand_dms_import or van_sale bill with an `orderId` in any other state is left alone. (4) load-sheets.service.ts `approve` and `confirm`: re-read `this.orders.fulfilmentOrders(tx, sheet.orderIds)` and refuse with 409 `order_left_the_sheet` naming the orders that are no longer `packed` ('cancel this sheet and build it again') — the safety net for a bill cancelled after the sheet was drafted; `awaiting_load` and `billing.invoices.queue` drop the order by state with no query change. (5) billing.spec.ts:697 'cancels before dispatch' — its 'the order is back in the billing queue' assertion inverts (it was pinning the defect). (6) manager billing/index.tsx dialog body `m6.cancelBody` → 'The number is kept. Stock and money come back. The order is cancelled with it. Only before dispatch.'; the manager/owner Orders panels' packed disabled reason is DOS-138's amendment (g). (7) docs/22 §4 invoice line 145 → 'cancelling a bill before dispatch cancels its order in the same step; the order keeps its number and history'; §8 architect-default row; §11 line.

### Binding amendments

- (a) One transaction: bill cancelled, stock back, money reversed, order cancelled, OrderCancelled emitted — or none of it. The order's `cancel_reason` names the bill and its reason; `cancelled_at` is set; an `order_state_transitions` row packed → cancelled by event cancel is written.
- (b) `orders.cancel` (the procedure) must refuse a packed order with the 'cancel the bill' message for every role; only `InvoicesService.cancel` takes the packed → cancelled edge, through `OrdersService.cancelInTx`, never by writing `sales_orders.state`.
- (c) The existing pre-dispatch guards stay in this order: dispatched-state 409, money-allocated 409, credit-note 409, then the machine; the order move is the last write before the invoice row update, so a failure anywhere rolls the lot back.
- (d) The load-sheet re-check belongs in warehouse (load-sheets.service.ts, outside the owned list: two reads and one refusal in approve and confirm) because the rule 'only a packed order is loaded' is create's own rule (load-sheets.service.ts:171-176) and must hold at confirm too; it also protects against any other state drift after drafting.
- (e) The verifier records the probe on main before the fix: awaiting_load offers the order, loadSheets.create accepts it, packs.confirm again is 409; after the fix: absent from awaiting_load and billing.queue, create 409 'only a packed order can be loaded', a sheet drafted before the cancel refuses approve/confirm with order_left_the_sheet.
- (f) No schema change; no new event type; no contract change (the invoice cancel input is unchanged) — so no README regeneration for this item.

### Files

- `backend/libs/core/src/modules/billing/invoices.service.ts`
- `backend/libs/domain/src/state-machines/order.ts`
- `backend/libs/domain/src/state-machines/state-machines.test.ts`
- `backend/libs/core/src/modules/orders/orders.service.ts`
- `backend/libs/core/src/modules/orders/orders.spec.ts`
- `backend/libs/core/src/modules/billing/billing.spec.ts`
- `backend/libs/core/src/modules/warehouse/load-sheets.service.ts (outside the owned list: approve/confirm re-check that every order is still packed)`
- `backend/libs/core/src/modules/warehouse/warehouse.spec.ts`
- `frontend/manager-app/app/billing/index.tsx`
- `frontend/manager-app/src/strings.ts`
- `docs/22-source-of-truth.md`

### Tests and walks

- billing.spec.ts › 'DOS-139: cancelling a pre-dispatch pack bill cancels its order in the same transaction — order cancelled with reason "bill INV/… cancelled: …", a packed→cancelled transition row, an OrderCancelled outbox row, the order absent from billing.queue and from packs.list?status=awaiting_load, loadSheets.create refuses it with 409 only-a-packed-order, issueFor again is 409, stock and journal net to zero as before' — red today (order stays packed and is listed), green after; the existing :697 test's queue assertion is inverted rather than duplicated.
- billing.spec.ts › 'DOS-139 guard: a bill cancel that fails after restock (money allocated, or a credit note) leaves the order packed — nothing partial'.
- orders.spec.ts › 'DOS-139: orders.cancel on a packed order is 409 "cancel the bill and the order goes with it" for the owner, the manager and the rep, and writes nothing'.
- warehouse.spec.ts › 'DOS-139: a draft load sheet holding an order whose bill is then cancelled refuses approve and confirm with order_left_the_sheet naming the order; cancelling the sheet and rebuilding it without the order succeeds' — red today (confirm moves the restocked pieces to the vehicle), green after.
- state-machines.test.ts › 'DOS-138/139: picking and packed may cancel' (shared).
- `pnpm --filter @dos/core test -- src/modules/billing`, `src/modules/orders`, `src/modules/warehouse` green including DOS-131/137, DOS-133 and DOS-043.
- Platform walk (manager web 1280 and 375; owner web): pack SO-X → INV/N; Billing → Bills issued → INV/N → Cancel the bill (dialog now says the order is cancelled with it) → the bill reads cancelled, Billing → queue no longer lists SO-X, Orders shows SO-X Cancelled with 'bill INV/N cancelled: …', W7 on the warehouse web build no longer offers SO-X; Android and iOS recorded as not walked (no phone screen changed; the dialog text is the merged DOS-164 sheet).

### Notes

Design-ready: docs/22 already fixes the bill's fate (never-list 4, §4 line 145) and the only alternative for the order collides with a deliberate database guarantee, so nothing is left for the founder to choose inside batch 2; the founder may still overrule the default in the §8 batch approval, in which case the item defers to a later slice. The P1 re-bill probe is folded into the red test (amendment e): the code shows the double-move path is a load sheet, not a second bill, and this design closes it in the same slice. Shares the packed→cancelled edge with DOS-138 but does not wait on DOS-138's decision.

