# 23 — App screens and the API gaps they expose

**Purpose.** Frontend thinking starts before the last backend modules are built, so that anything the six apps will need from
the backend is flagged now, while delivery, docint, integrations, claims, notifications, reporting and incentives are still
plans. For each app this file lists every screen, the exact contract procedures it calls, the graphs it draws (with the series
shape reporting must serve), a permission cross-check, offline needs and the white-label surfaces. The last section lists the
gaps by backend module, one line each, so a module brief can be amended before its slice starts.

**Method (read-only, 2026-09-05).** Screens derive from `docs/22-source-of-truth.md` §2–§7, `docs/06-order-to-cash-flows.md`,
`docs/02` and `docs/design/UX-00-design-system.md` §6.18, §8, §11. Every procedure name was checked against
`backend/libs/contracts/src/*.ts` and `permissions.ts` (grep, not memory). Module plans in `docs/plans/*.md` were read for the
unbuilt modules; where a plan already covers a need it is marked **planned** and not listed as a gap. Service key mounting was
read from `backend/*-service/src/service.ts` as of this date, including the uncommitted warehouse slice in the working tree: the
`warehouse` key is mounted on owner, manager, warehouse and delivery services and `billing` on warehouse-service; `billing` and
`receivables` are NOT mounted on sales-service. "wiring" below is used only for that remaining sales-service case.

**Legend.** `✓` allowed by `permissions.ts` for the app's role · `✗` refused for that role · **planned** = in a module plan ·
**MISSING** = no procedure in the contract and none in a plan · **wiring** = procedure exists, key not mounted on that service.

**Status conventions.** Owner role = `owner`; Manager app roles = `manager`, `accountant`; Sales = `salesperson`;
Warehouse = `warehouse`; Delivery = `delivery`; Retailer = `retailer`. Tuples are the ones in `permissions.ts`:
BACK_OFFICE (owner, manager, accountant), STAFF (everyone but retailer), STOCK_KEEPERS (owner, manager, warehouse),
STOCK_VIEWERS (owner, manager, accountant, warehouse, delivery), MONEY_COLLECTORS (owner, manager, accountant, delivery),
MONEY_READERS (MONEY_COLLECTORS + retailer), PIN_HOLDERS (owner, manager), ONBOARDERS (owner, manager),
DOORSTEP (owner, manager, delivery), CREDIT_NOTE_RAISERS (owner, manager, accountant, delivery).

---

## 0. Shared across all six apps

Every app has the same four frame screens; they are listed once here and not repeated.

- **X1 Sign-in** — username + password, device id, memberships picker when > 1. Primary action: sign in.
  Calls: `auth.login`, `auth.refresh`, `auth.switchTenant`, `auth.logout`, `auth.jwks` (verify only).
  MISSING: `auth.forgotPassword` / `auth.resetPassword` (a retailer has nobody to ask; OTP is a later layer per docs/22 §7).
  Field gap: `AuthTenantSchema` / `MembershipSummarySchema` carry `legalName` only — the sign-in landing and the retailer's
  distributor cards need `displayName` + `logoUrl` (UX-00 §3.6 "sign-in landing after a tenant is identified").
- **X2 Forced password change** — when `user.mustChangePassword`. Calls: `auth.changePassword`.
- **X3 App chrome (header, top-left name + logo, connection strip, updated-at)** — on every screen of every app.
  Calls: `tenancy.me` (legal name only). MISSING: `tenancy.branding.get` (see §7). `notifications.pushTokens.register` (planned).
- **X4 Profile & devices** — `auth.me`, `auth.sessions`, `auth.revokeSession`, `auth.changePassword`, `auth.logout`.

---

## 1. Owner app (`frontend/owner-app`, owner-service :3001, role `owner`)

Desk-primary with graphs, phone-secondary with four zero-tap answers (UX-00 §11). Six rail destinations: Today, Orders, Billing,
Money, Stock, Reports, Settings (UX-00 §8.1). 26 screens.

### 1.1 Screen inventory

- **O1 Today (phone + desk home)** — collected today, cash in transit, outstanding by ageing bucket, orders/dispatched/delivered,
  at-risk stock, pending approvals, active trips. Primary action: open Approvals.
  Calls: `reporting.dashboard.owner` (planned), `orders.approvals.list` status=pending ✓, `pricing.bargains.list` status=requested ✓,
  `receivables.outstanding.list` (totals) ✓, `receivables.cashDiscounts.list` ✓, `delivery.trips.list` state=active (planned).
  MISSING: tenant-level ageing bucket totals (`OutstandingListOutput.totals` has no `buckets`); 7-day sparkline series (§1.2).
- **O2 Growth & performance (desk, the graphs screen)** — sales trend, this month vs last, brand/beat/rep comparison, collections
  trend, outstanding trend, fill rate, delivery performance. Primary action: change range / compare.
  Calls: `reporting.dailyStats.tenant` (planned, day grain, ≤ 92 days), `reporting.dailyStats.rep` (planned),
  `reporting.registers.fillRate` (planned, per variant), `reporting.registers.deliveryPerformance` (planned, per trip),
  `reporting.registers.collections` (planned). MISSING: `reporting.series.get` (month grain, YoY, groupBy beat/brand/rep — §1.2).
- **O3 Approvals queue (phone + desk, keyboard j/k/1/2/3)** — price variance, credit, MOV, bargain, red settlement, GRN exceptions.
  Primary action: approve / reject. Calls: `orders.approvals.list` ✓, `orders.approvals.decide` ✓, `pricing.bargains.list` ✓,
  `pricing.bargains.decide` ✓, `orders.get` ✓, `receivables.creditCheck` ✓, `procurement.discrepancies.list` ✓,
  `delivery.trips.settle` acceptVariance (planned; approval kind `trip_settlement` planned in docs/plans/delivery.md §3 item 3).
- **O4 Live map** — vehicles now, stops done/planned, replay. Calls: `delivery.vehicles.positions` (planned), `delivery.trips.get`
  (planned), `delivery.gps.trace` (planned), `delivery.stops.list` (planned).
- **O5 Orders register + order detail** — every order, state, approvals, transitions; confirm/cancel/release hold.
  Calls: `orders.list` ✓, `orders.get` ✓, `orders.confirm` ✓, `orders.cancel` ✓, `warehouse.reservations.list` ✓,
  `warehouse.reservations.release` ✓, `billing.invoices.list` orderId ✓.
- **O6 Retailers list + retailer detail** — shop record, credit terms, dues, statement, bills, visits, overrides, behaviour.
  Calls: `retailers.list` ✓, `retailers.get` ✓, `retailers.upsert` ✓, `retailers.setCredit` ✓, `retailers.linkIdentity` ✓,
  `receivables.outstanding.get` ✓, `receivables.ledger.get` ✓, `receivables.receipts.list` ✓, `billing.invoices.list` ✓,
  `pricing.overrides.list` ✓, `pricing.overrides.upsert` ✓, `retailers.visits.list` ✓, `reporting.retailers.behaviour` (planned),
  `receivables.statements.send` ✓. MISSING: per-retailer purchase series for the row sparkline (§1.2).
- **O7 Beats & staff** — beats, visit days, who is on which beat, staff accounts, rep discount bounds, authorised brands per rep.
  Calls: `retailers.beats.list` ✓, `retailers.beats.upsert` ✓, `retailers.beats.assign` ✓, `tenancy.staff.list` ✓,
  `tenancy.staff.create` ✓, `tenancy.staff.setPassword` ✓, `tenancy.staff.setStatus` ✓, `pricing.bounds.set` ✓.
  MISSING: `retailers.beats.assignments.list`, `pricing.bounds.list`, `tenantCatalog.repAuthorisations.list/set`,
  `tenancy.staff.update` (name/phone/locale edit).
- **O8 Prices & schemes** — price lists per tier with validity, scheme editor (scope, trigger, slabs, reward, funding, claimable),
  overrides, what-if quote. Calls: `pricing.priceLists.list` ✓, `pricing.priceLists.upsert` ✓, `pricing.priceLists.setItems` ✓,
  `pricing.schemes.list` ✓, `pricing.schemes.upsert` ✓, `pricing.overrides.list` ✓, `pricing.overrides.upsert` ✓,
  `pricing.quote` ✓, `tenantCatalog.list` ✓, `catalog.manufacturers` ✓.
- **O9 Catalog, costs & suppliers** — listed variants, order rules, purchase cost (owner stream), suppliers, propose product.
  Calls: `tenantCatalog.list` ✓, `tenantCatalog.upsertListing` ✓, `tenantCatalog.costs` ✓, `tenantCatalog.upsertCost` ✓,
  `tenantCatalog.suppliers` ✓, `tenantCatalog.upsertSupplier` ✓, `catalog.search` ✓, `catalog.manufacturers` ✓, `catalog.propose` ✓.
  MISSING: `tenantCatalog.brands.list/upsert` (`tenant_brands` has no procedure), `tenantCatalog.packConfigs.list/upsert`.
- **O10 Money: outstanding & ageing register** — dues by shop / bucket / beat, statements, write-off, cash-discount windows.
  Calls: `receivables.outstanding.list` ✓, `receivables.outstanding.get` ✓, `receivables.statements.send` ✓,
  `receivables.writeOffs.create` ✓, `receivables.ageing.rebuild` ✓, `receivables.cashDiscounts.list` ✓.
  MISSING: `receivables.ageing.history` (outstanding trend from `ageing_snapshots`); bucket totals on `outstanding.list`.
- **O11 Money: receipts, banking, cheques** — office payments, deposits, bounces, on-account money, allocations.
  Calls: `receivables.receipts.create` ✓, `receivables.receipts.list` ✓, `receivables.receipts.get` ✓,
  `receivables.receipts.reverse` ✓, `receivables.receipts.deposit` ✓, `receivables.receipts.bounce` ✓,
  `receivables.allocations.create` ✓, `receivables.allocations.remove` ✓. MISSING: receipt document (print/share) — see receivables gaps.
- **O12 Books: trial balance & day book** — Calls: `receivables.accounts.list` ✓, `receivables.journal.list` ✓.
- **O13 Billing register, invoice detail, GST** — bills, cancel before dispatch, e-way bill, IRN stub, GSTR-1 summary.
  Calls: `billing.invoices.list` ✓, `billing.invoices.get` ✓, `billing.invoices.pdf` ✓, `billing.invoices.cancel` ✓,
  `billing.invoices.setEwayBill` ✓, `billing.invoices.requestIrn` ✓, `billing.invoices.upiQr` ✓, `billing.registers.gstSummary` ✓,
  `billing.registers.salesRegister` ✓, `reporting.registers.gstPurchaseRegister` (planned).
- **O14 Credit notes** — Calls: `billing.creditNotes.list` ✓, `billing.creditNotes.get` ✓, `billing.creditNotes.create` ✓,
  `billing.creditNotes.issue` ✓, `billing.creditNotes.cancel` ✓.
- **O15 Stock** — balances per lot/location, near expiry, ledger, adjust, transfer, lots, locations, stock value (cost).
  Calls: `inventory.stock.balances` ✓, `inventory.stock.sellable` ✓, `inventory.stock.ledger` ✓, `inventory.stock.adjust` ✓,
  `inventory.stock.transfer` ✓, `inventory.lots.upsert` ✓, `inventory.locations.list` ✓, `inventory.locations.upsert` ✓,
  `reporting.registers.stockValue` (planned), `warehouse.reservations.list` ✓.
  MISSING: `inventory.cycleCounts.*` (tables exist, no procedure); `expiringBefore` filter on `stock.balances`.
- **O16 Inbound: supplier invoices, GRNs, purchase orders** — Calls: `procurement.supplierInvoices.list/get/create/matchLine` ✓,
  `procurement.grns.open/count/post/list/get` ✓, `procurement.discrepancies.list` ✓, `procurement.purchaseOrders.upsert/list` ✓,
  `docint.queue.list` + `docint.documents.*` + `docint.review.*` (planned). MISSING: `procurement.discrepancies.resolve`.
- **O17 Profit view (owner-only route, never bundled elsewhere)** — MTD gross margin, margin by brand, scheme spend split,
  stock value. Calls: `reporting.dashboard.owner` (planned), `reporting.registers.schemeSpend` (planned),
  `reporting.registers.stockValue` (planned), `tenantCatalog.costs` ✓. MISSING: margin series by month/brand (§1.2).
- **O18 Delivery: trips, settlements, expenses, collections** — Calls: `delivery.trips.list/get/cancel/settlementPreview/settle`,
  `delivery.collections.list`, `delivery.expenses.list`, `delivery.deliveries.list`, `delivery.vehicles.list/upsert` (all planned).
- **O19 Claims** — policies, periods, open/build/submit/settle, ageing. Calls: `claims.*` (planned, owner + manager only).
- **O20 Incentives** — targets, bulk assign, what-if, team leaderboard, statements approve. Calls: `incentives.*` (planned).
- **O21 Imports wizard** — upload → preview → map columns → save profile → dry run → commit (docs/17 §D7).
  Calls: `integrations.imports.create/list/get/rows.list/preview/rows.override/commit/cancel` (planned).
  MISSING: `files.uploadUrl` (the plan says the signed-URL helper "is not yet built"); `integrations.profiles.list/upsert`
  (saved column-mapping profiles are in the plan's intro but not in its endpoint table).
- **O22 Exports & Tally** — Calls: `integrations.exports.create/list/get`, `integrations.tally.mappings.list/upsert`,
  `integrations.tally.syncLedger.list`, `reporting.exports.request/get` (all planned).
- **O23 Notifications & templates** — Calls: `notifications.templates.list/upsert`, `notifications.broadcasts.create/list/get`,
  `notifications.messages.list/get/resend`, `notifications.inbound.list/markHandled` (all planned).
- **O24 Settings** — business profile (legal name, GSTIN, state, address, FSSAI), branding (display name, logo, invoice footer),
  UPI VPA, numbering series (prefix, starting number, locked after first issue), feature flags (van_sales, e_invoicing, claims_ui,
  retailer_app, brand_dms_import), delivery policy (settlement tolerance, POD policy, geofence metres, GPS retention),
  e-way bill threshold. Primary action: save. Calls: `tenancy.me` ✓ (read only).
  MISSING: `tenancy.settings.get`, `tenancy.settings.set`, `tenancy.branding.get`, `files.uploadUrl` (logo),
  `tenancy.numbering.list/upsert`, `tenancy.featureFlags.list/set`, `tenancy.tenant.update`. This screen has zero backend today.
- **O25 Audit & security** — who changed prices/credit/approvals, exports taken, GPS trace reads, sessions.
  Calls: `auth.sessions` ✓, `auth.revokeSession` ✓. MISSING: `tenancy.audit.list` (`audit_log` has no reader).
- **O26 Documents inbox (docint queue)** — shared with the manager app; Calls: `docint.queue.list`, `docint.documents.get`,
  `docint.review.start/save/submit/release`, `docint.matches.list/choose/rerun`, `docint.documents.commit/reject` (planned).

### 1.2 Graphs the owner app must draw, and the series shape reporting must serve

The chart set is `<TrendChart>`, `<CompareBars>`, `<StackedMix>`, `<Sparkline>`, `<AgeingBuckets>` (UX-00 §6.18). Money in
paise, x axis = IST business date, every chart carries its range and "as of". What exists today (planned) is **day grain for
≤ 92 days** (`reporting.dailyStats.tenant`) and per-rep day rows (`reporting.dailyStats.rep`). Nothing serves month grain,
year-over-year, beat grouping, per-retailer series or ageing history. One generic procedure closes most of it:

`reporting.series.get` (proposed) — GET `/reporting/series` — input
`{ metric, grain: day|week|month, from, to, groupBy?: brand|beat|salesperson|paymentMode|vehicle,`
`compare?: none|previousPeriod|previousYear }`
— output `{ metric, grain, unit: paise|count|ratio, asOf, points: [{ bucket, value, previous }], groups?: [{ key, name, points }] }`.
Window caps: day ≤ 92, week ≤ 53, month ≤ 24; groups ≤ 12 (CompareBars max). Metrics and their source rollup:

| Chart (screen)                     | Component     | Metric · grain · range · groupBy            | Source today                       |
| ---------------------------------- | ------------- | ------------------------------------------- | ---------------------------------- |
| KPI tile sparklines (O1)           | Sparkline     | invoiced, collected, orders · day · 7 d     | daily_tenant_stats (planned)       |
| Outstanding by ageing (O1, O10)    | AgeingBuckets | six buckets · now · tenant or beat          | MISSING tenant bucket totals       |
| Sales trend vs previous (O2)       | TrendChart    | invoiced · day · 30/90 d · compare previous | daily_tenant_stats; compare ✗      |
| Growth month/month, YoY (O2)       | TrendChart    | invoiced · month · 24 m · compare prevYear  | MISSING (no month grain, no YoY)   |
| This month vs last by brand (O2)   | CompareBars   | invoiced · month · 2 m · groupBy brand      | by_brand jsonb (planned)           |
| Sales by beat (O2)                 | CompareBars   | invoiced · month · groupBy beat             | MISSING (no beat dimension)        |
| Sales by rep (O2)                  | CompareBars   | orderValue · month · groupBy salesperson    | daily_rep_stats (sum ≤ 92 d)       |
| Brand mix (O2, O17)                | StackedMix    | invoiced · month · groupBy brand, ≤ 5       | by_brand jsonb (planned)           |
| Collections trend (O2)             | TrendChart    | collected · day · 90 d                      | daily_tenant_stats (planned)       |
| Payment-mode mix (O2, O11)         | StackedMix    | collected · month · groupBy paymentMode     | registers.collections (planned)    |
| Outstanding trend (O2, O10)        | TrendChart    | outstanding, overdue · day · 90 d           | daily_tenant_stats; buckets ✗      |
| Ageing history (O10)               | TrendChart    | six buckets · week · 26 w                   | MISSING receivables.ageing.history |
| Fill rate trend (O2)               | TrendChart    | fillRate (ratio) · day/week · 31 d          | MISSING (register is per variant)  |
| Delivery performance (O2, O18)     | CompareBars   | deliveredStops, failedStops · day · 31 d    | daily_tenant_stats (planned)       |
| On-time and POD coverage (O18)     | TrendChart    | onTimeRate, podCoverageRate · day · 31 d    | MISSING (register is per trip)     |
| Stops per vehicle (O18)            | CompareBars   | deliveredStops · range · groupBy vehicle    | deliveryPerformance (planned)      |
| Gross margin by month (O17)        | TrendChart    | grossMargin · month · 12 m · owner only     | MISSING (owner_summary = MTD)      |
| Margin by brand (O17)              | CompareBars   | grossMargin · month · groupBy brand         | MISSING                            |
| Scheme spend split (O17)           | StackedMix    | schemeSpend · month · groupBy fundingSource | registers.schemeSpend (planned)    |
| Stock value by brand, expiry (O15) | StackedMix    | stockValue, nearExpiryValue · now · brand   | registers.stockValue (planned)     |
| Retailer row sparkline (O6)        | Sparkline     | invoiced · week · 12 w · per retailer       | MISSING reporting.retailers.series |
| Rep target achievement (O20)       | CompareBars   | achievedPct per rep · period                | incentives.progress.team (planned) |
| Docint quality (O26)               | TrendChart    | editsPerTenLines, p95 latency · day · 30 d  | docint.stats.summary (totals only) |

Grain rules for the rollup: `daily_tenant_stats` stays the day source; month/week grain is a grouped read of the same table
(≤ 24 rows out), never a live scan. Beat grouping needs a `by_beat` jsonb on `daily_tenant_stats` (same shape as `by_brand`,
keyed by beat id, filled from the order's retailer beat at rollup time) — a field to add before reporting is built.
`grossMargin` must exist only on owner-service (`requireRole(OWNER_ONLY)`), like `stockValue`.

### 1.3 Permission cross-check (owner)

- Every procedure the owner screens call is allowed for `owner` (the owner is in every tuple). No mismatch.
- The `warehouse` key (reservations, load sheets, challans, packs) is mounted on owner-service in the in-flight slice.
- Callable but no owner screen: `sync.upload` (STAFF), `pricing.bargains.request`, `retailers.visits.record`, `orders.repeatLast`,
  `procurement.grns.count`. Harmless; noted so nobody builds a screen for them.

### 1.4 Offline

Online-first; the phone surface (O1, O3, O4) caches the last dashboard payload and shows "as of". No write queue.

### 1.5 White-label

Chrome on every screen (X3), Settings > Branding (O24, upload + preview), invoice/credit-note/challan previews (O13, O14 via
`seller` block ✓), statements (O10, renderer deferred), receipts (O11, no document), WhatsApp templates (O23, sender identity
open per UX-00 §12 q5). Backend exposure: `InvoiceDetail.seller`, `CreditNoteDetail.seller`, `DeliveryChallanSchema.seller` ✓;
app chrome and settings ✗ (MISSING `tenancy.branding.get`, `tenancy.settings.*`, `files.uploadUrl`).

---

## 2. Manager + accountant app (`frontend/manager-app`, manager-service :3002, roles `manager`, `accountant`)

The keyboard loop: order queue, GRN review, billing desk, load-out, day-end, registers, Tally export; the accountant is
read + exports (docs/22 §2). 21 screens; the accountant sees M1–M2, M9–M15, M21 and everything else read-only.

### 2.1 Screen inventory

- **M1 Today (desk)** — submitted orders, billing backlog, GRN queue, documents awaiting review, cash to bank, cheques due.
  Calls: `reporting.dashboard.owner` (planned; roles include manager, accountant), `orders.list` state=submitted ✓,
  `billing.invoices.queue` ✓, `warehouse.packs.list` invoiced=false ✓, `docint.queue.list` (planned),
  `receivables.receipts.list` status=collected ✓, `receivables.cashDiscounts.list` ✓.
- **M2 Order queue (submitted → confirmed)** — ageing, credit block and reason in one line at the point of confirmation.
  Calls: `orders.list` ✓, `orders.get` ✓, `orders.confirm` ✓, `orders.cancel` ✓, `receivables.creditCheck` ✓,
  `orders.approvals.list/decide` ✓, `pricing.bargains.list/decide` ✓, `warehouse.reservations.release` ✓.
- **M3 Inbound documents: capture (phone) and review (desk)** — photograph/share the supplier bill, QR verify, line cards with
  crops, SKU match, commit to supplier invoice. Calls: `docint.documents.create/pageUploadUrl/addPage/verifyQr/submit/list/get`,
  `docint.queue.list`, `docint.review.start/heartbeat/save/release/submit`, `docint.matches.list/choose/rerun`,
  `docint.documents.commit/reject`, `docint.extractions.run/list` (all planned), `catalog.propose` ✓.
- **M4 Supplier invoices, GRN open/post, discrepancies, purchase orders** — Calls: `procurement.supplierInvoices.create/list/get/
matchLine` ✓, `procurement.grns.open/post/list/get` ✓, `procurement.grns.count` ✓ (manager), `procurement.discrepancies.list` ✓,
  `procurement.purchaseOrders.upsert/list` ✓. MISSING: `procurement.discrepancies.resolve`, `procurement.supplierInvoices.dispute`.
- **M5 Fulfilment desk (queue → wave)** — group by beat/trip, create picklist, watch progress, cancel an unstarted wave.
  Calls: `warehouse.queue.list` ✓, `warehouse.picklists.create/list/get/start/cancel` ✓ (manager; accountant ✗ by design).
- **M6 Billing desk (select → review → issue → next, count remaining)** — packed orders without a bill, invoice preview, A4 print,
  e-way bill, IRN. Calls: `billing.invoices.queue` ✓, `warehouse.packs.list` invoiced=false ✓, `warehouse.packs.get` ✓,
  `billing.invoices.get` ✓, `billing.invoices.pdf` ✓ (renderer deferred: always `queued`), `billing.invoices.setEwayBill` ✓,
  `billing.invoices.requestIrn` ✓, `billing.invoices.cancel` ✓ (manager; accountant ✗ by design).
  MISSING: `billing.invoices.issueForPack` — a pack confirmed with `issueInvoice: false` has NO HTTP path to be billed later
  (`packs.confirm` is UNIQUE per order and the only caller of `issueForPack`); `BillingQueueItem.hasDraftInvoice` implies a
  procedure that does not exist. MISSING: the PDF renderer worker (coordination §3.4 deferred) — the desk cannot print.
- **M7 Load-out & challans (manager's PIN)** — build sheet last-stop-first, crew count, e-way bill gate, confirm, print challan.
  Calls: `warehouse.loadSheets.create/list/get/confirm/cancel` ✓ (PIN_HOLDERS = manager), `warehouse.challans.list/get/recordEwb` ✓,
  `delivery.trips.create/startLoading` (planned), `delivery.vehicles.list` (planned), `inventory.locations.list` kind=vehicle ✓.
  MISSING: `warehouse.challans.pdf` (deliberately absent per warehouse.ts; needed for the printed Rule 55 challan).
- **M8 Credit notes** — Calls: `billing.creditNotes.create/issue/cancel/get/list` ✓.
- **M9 Receipts & allocations (office payments)** — Calls: `receivables.receipts.create/list/get/reverse` ✓,
  `receivables.allocations.create/remove` ✓, `receivables.outstanding.get` ✓, `billing.invoices.upiQr` ✓.
- **M10 Day-end: banking, cheques, trip settlement** — deposit batch, bounce, cheques in hand, expected vs handed-over cash,
  stock counted back, variance → owner. Calls: `receivables.receipts.deposit/bounce/list` ✓, `delivery.trips.settlementPreview`,
  `delivery.trips.settle`, `delivery.trips.return`, `delivery.collections.list`, `delivery.expenses.list` (all planned; accountant
  included), `receivables.cashDiscounts.list` ✓.
- **M11 Brand-DMS bills (Too Yumm on FieldAssist)** — capture and commit as `brand_dms_import`, never a second invoice.
  Calls: `billing.invoices.importBrandDms` ✓, `docint.documents.create` kind=brand_dms_invoice (planned),
  `integrations.imports.create` kind=fieldassist_invoices (planned).
- **M12 Registers (accountant home)** — sales register, GST summary with days-to-11th, purchase register, collections, outstanding,
  trial balance, day book, daily sales. Calls: `billing.registers.gstSummary/salesRegister` ✓, `receivables.accounts.list` ✓,
  `receivables.journal.list` ✓, `receivables.outstanding.list` ✓, `reporting.dailyStats.tenant`, `reporting.registers.collections/
gstSalesRegister/gstPurchaseRegister/schemeSpend/stockValue/fillRate`, `reporting.exports.request/get` (planned).
- **M13 Tally export & mapping** — Calls: `integrations.exports.create/list/get`, `integrations.tally.mappings.list/upsert`,
  `integrations.tally.syncLedger.list` (planned).
- **M14 Retailers (staff view) & credit** — Calls: `retailers.list/get/upsert/setCredit/linkIdentity` ✓ (manager; accountant may
  `setCredit` ✓ but not `linkIdentity` ✗), `receivables.outstanding.get/ledger.get` ✓, `receivables.statements.send` ✓.
- **M15 Prices & schemes (manager edits, accountant reads)** — Calls: `pricing.priceLists.*`, `pricing.schemes.*`,
  `pricing.overrides.*` ✓ (BACK_OFFICE; see §2.3 on the accountant).
- **M16 Stock (balances, adjust, transfer, cycle count, near expiry)** — Calls: `inventory.stock.balances/ledger/adjust/transfer` ✓,
  `inventory.lots.upsert` ✓, `inventory.locations.list/upsert` ✓, `warehouse.reservations.list` ✓. MISSING: cycle counts.
- **M17 Claims** — `claims.*` (planned; `claims.writeOff` owner + accountant, `policies.upsert` owner only).
- **M18 Notifications inbox, broadcasts, inbound texts** — `notifications.*` (planned).
- **M19 Phone: gate count** — `procurement.grns.get/count` ✓ (manager in STOCK_KEEPERS).
- **M20 Phone: pick / pack** — `warehouse.picklists.get/start/pick` ✓, `warehouse.packs.confirm` ✓ (manager).
- **M21 Team performance** — `reporting.dailyStats.rep`, `reporting.registers.repProductivity`, `reporting.retailers.lapsed`,
  `incentives.progress.team`, `incentives.statements.compute/list` (all planned).

### 2.2 Graphs

M1: today's collections by mode (`<StackedMix>`, `reporting.registers.collections` groupBy=day, planned); billing backlog count.
M12: GSTR-1 days-to-deadline (client-side against the 11th); collections by day (`<TrendChart>`, `registers.collections`).
M21: strike rate per rep (`<CompareBars>`, `repProductivity`), target achievement (`incentives.progress.team`).
No new series beyond §1.2.

### 2.3 Permission cross-check (manager, accountant)

- Manager: every screen's procedures are allowed. Owner-only procedures the app must hide, not grey: `pricing.bounds.set`,
  `receivables.writeOffs.create`, `receivables.ageing.rebuild`, `claims.policies.upsert`, `incentives.targets.upsert/bulkAssign/
remove`, `incentives.statements.approve/reopen` (planned).
- Accountant is in BACK_OFFICE, so the matrix lets the accountant WRITE things the app gives the accountant no screen for:
  `pricing.priceLists.upsert/setItems`, `pricing.schemes.upsert`, `pricing.overrides.upsert`, `pricing.bargains.decide`,
  `retailers.upsert/setCredit`, `tenantCatalog.upsertListing/upsertCost/upsertSupplier`, `orders.confirm`, `orders.approvals.decide`,
  `procurement.*` writes, `inventory.stock.adjust/transfer`, `billing.invoices.importBrandDms`, `billing.creditNotes.create/issue`,
  `warehouse.reservations.release`, `warehouse.challans.recordEwb`, `delivery.trips.settle` (planned), `claims.*` writes (planned).
  docs/22 §2 says the accountant is "read + exports". Either an `ACCOUNTANT_READS` narrowing lands in `permissions.ts` before the
  frontend (recommended: keep `receipts.*`, `allocations.*`, `deposit`, `bounce`, `trips.settle`, `creditNotes.*`, exports; drop the
  rest) or docs/22 is amended to say the accountant may write. Flagged, not decided here.
- Accountant deliberately ✗: `warehouse.picklists.*`, `warehouse.packs.confirm`, `loadSheets.confirm/cancel`, `billing.invoices.cancel`,
  `retailers.linkIdentity`, `tenancy.staff.create/setPassword/setStatus`, `procurement.grns.count`. The app hides these.

### 2.4 Offline

Online-first. The phone surfaces (M3 capture, M19 gate count, M20 pick/pack) queue photos and counts locally and retry; the
gate count and pick lines go through `sync.upload` (`pick_lines` handler exists; `grn` count has none — see sync gaps).

### 2.5 White-label

A4 invoice / credit note / challan / statement print from this app: `seller` block ✓ on invoice, credit note, challan; statement
and receipt have none. Chrome ✗ (MISSING `tenancy.branding.get`).

---

## 3. Sales app (`frontend/sales-app`, sales-service :3003, role `salesperson`; phone, offline before pilot)

Ninety seconds in a doorway: repeat order in 3 taps, modified order ≤ 15 taps. Never sees cost, never collects money. 14 screens,
4 tabs (Beat, Orders, Shops, Me).

### 3.1 Screen inventory

- **S1 Aaj ka beat (home)** — today's beat, shops in visit order, last-order and outstanding chips, visited ticks.
  Calls: `retailers.beats.list` ✓, `retailers.list` beatId ✓, `orders.list` retailerId ✓, `retailers.visits.list` today ✓,
  `reporting.retailers.behaviour` (planned), `reporting.retailers.lapsed` (planned).
  MISSING: `retailers.beats.assignments.list` (nothing tells the rep WHICH beat is his today; `beat_assignments` has no reader).
  MISMATCH: `receivables.outstanding.get` is MONEY_READERS (no salesperson) and `receivables` is not mounted on sales-service —
  the outstanding chip docs/06 and UX-00 §11 require cannot be drawn.
- **S2 Shop card** — outstanding, ageing, last order above the fold; check-in (geo-tag amber, never a block); pending undelivered.
  Calls: `retailers.get` ✓, `retailers.visits.record` ✓, `orders.list` retailerId ✓, `orders.get` ✓,
  `billing.invoices.list` openOnly ✓ by matrix but `billing` is not mounted on sales-service (wiring),
  `reporting.retailers.behaviour` (planned). MISMATCH: `receivables.outstanding.get` (see S1), `receivables.creditCheck`
  (MONEY_COLLECTORS, no salesperson) — docs/22 §4 S4 says the credit check runs on the device before submit.
  Field gap: `OrdersListInput.state` is a single value; "pending undelivered" needs `states[]` (confirmed..dispatched).
- **S3 Order entry (reorder last / suggested / grid, case + pcs stepper, live ATP hint)** — priced on the device; the turn-around
  confirmation screen (single column, ≥ 20 sp). Primary action: Submit.
  Calls: `orders.repeatLast` ✓, `orders.create` ✓, `orders.setLines` ✓, `tenantCatalog.list` ✓, `inventory.stock.sellable` ✓,
  `pricing.quote` ✓ (online), `pricing.priceLists.list` ✓, `pricing.schemes.list` ✓, `pricing.overrides.list` ✓ (engine inputs
  for offline pricing). MISSING: `pricing.bounds.list` (the rep's own auto-approve bound; only `bounds.set` exists);
  `tenantCatalog.repAuthorisations` (docs/02: a manufacturer-employed rep sees only that brand; table exists, no procedure).
- **S4 Bargain request** — ask a lower rate, auto-approved within bound. Calls: `pricing.bargains.request` ✓, `pricing.bargains.list` ✓.
- **S5 Submit & status ("Needs attention" tray)** — status dot, confirmed / approval pending / rejected with reason.
  Calls: `orders.submit` ✓, `orders.get` ✓ (approvals visible to staff), `sync.upload` ✓.
  MISSING: `sync.errors.list` (rejections are written to `sync_errors` but no procedure reads them back; PowerSync is "later").
- **S6 My orders** — Calls: `orders.list` salespersonId ✓, `orders.cancel` ✓ (up to confirmed).
- **S7 New shop (onboarding, no credit fields)** — Calls: `retailers.upsert` ✓ (credit block 403 by design), `catalog.propose` ✓.
  `retailers.linkIdentity` ✗ deliberately (docs/17 item 27): the app shows "linked by office later".
- **S8 Visits history** — `retailers.visits.list` userId=self ✓.
- **S9 Performance tab** — target, achievement, computed incentive, today's numbers, 30-day sparkline.
  Calls: `incentives.progress.mine`, `incentives.statements.list/get`, `reporting.dashboard.rep`, `reporting.dailyStats.rep`
  self ✓, `reporting.registers.repProductivity` (all planned).
- **S10 Lapsed shops (shops I am losing)** — `reporting.retailers.lapsed` (planned, pre-scoped to own beats).
- **S11 Catalog & stock browse, deals to pitch** — `tenantCatalog.list` ✓, `catalog.search` ✓, `inventory.stock.sellable` ✓,
  `pricing.schemes.list` on=today ✓.
- **S12 Pending bills of a shop (read-only chip)** — `billing.invoices.list/get` ✓ by matrix, wiring ✗ on sales-service.
- **S13 Inbox** — `notifications.messages.list/markRead`, `notifications.inbound.list/markHandled`,
  `notifications.pushTokens.register` (planned).
- **S14 Me** — X4.

### 3.2 Graphs

S9: 30-day own sales `<Sparkline>` (`reporting.dailyStats.rep` userId=self, day grain, ≤ 92 d, planned); target progress bar
(`incentives.progress.mine`). S2: shop ageing `<AgeingBuckets>` (needs `outstanding.get`, blocked by the mismatch above).

### 3.3 Permission cross-check (salesperson)

- Needs but cannot: `receivables.outstanding.get`, `receivables.creditCheck` (tuples exclude salesperson; module not mounted);
  `billing.invoices.list/get/pdf` (allowed, key not mounted); `pricing.bounds` (no read procedure at all).
  Recommendation: add `salesperson` to a new READ tuple for `outstanding.get`, `creditCheck`, `ledger.get` (the founder rule is
  "never collects", not "never sees dues"); mount `receivables` (reads only refuse the rest) and `billing` on sales-service.
- Can but no screen (wider than the app): `retailers.beats.upsert`, `retailers.beats.assign` (STAFF — a rep can create a beat
  and assign himself; should be ONBOARDERS), `tenantCatalog.suppliers` (STAFF), `inventory.locations.list`, `orders.confirm` ✗ fine.
- Deliberate ✗ the app must never show: any `tenantCatalog.costs`, `procurement.*`, `receivables.receipts.*`, `warehouse.*`.

### 3.4 Offline (must work before the pilot)

Screens that must work with no network: S1, S2, S3, S4, S5 (queued), S6, S7 (queued), S8, S11. Read set to hold on the device:
retailers of own beats, beats, tenant catalog (no cost), sellable stock, price lists, schemes, overrides, own orders (90 d),
visits, bargains, outstanding summary per shop, own bound, authorised brands.
Write path through `sync.upload` (table → handler today): `sales_orders` ✓, `sales_order_lines` ✓, `visits` ✗ (no handler),
`bargain_requests` ✗ (no handler), `retailers` ✗ (no handler; docs/07 §7.3 lists rep onboarding). `frontend/libs/offline`
`SYNC_TABLES` already names `visits` and `retailers`. Rejections come back on the upload response and must ALSO be readable later
(`sync.errors.list`, MISSING). Until PowerSync lands there is no delta download: every list needs a `since`/`updatedAfter`
filter or one `sync.pull` procedure (MISSING) — a full `retailers.list` (≤ 500) + `tenantCatalog.list` (≤ 500) +
`inventory.stock.sellable` (≤ 500) per open is the fallback and breaks the 10 MB/day budget (UX-00 §8.3) at scale.

### 3.5 White-label

Chrome only (X3, MISSING `tenancy.branding.get`); the turn-around confirmation screen shows the distributor's name; the shop's
bill (S12) carries `seller` ✓ once billing is mounted.

---

## 4. Warehouse app (`frontend/warehouse-app`, warehouse-service :3004, role `warehouse`; phone + desk)

Put it down, pick it up: 76 dp targets, no Save step, the gate count is a typed keypad. 12 screens, 4 tabs (Inbound, Pick, Pack, Load).

### 4.1 Screen inventory

- **W1 Home (queues)** — GRNs to count, waves open/picking, packs without a bill, draft load sheets.
  Calls: `procurement.grns.list` status=counting ✓, `warehouse.queue.list` ✓, `warehouse.picklists.list` ✓,
  `warehouse.packs.list` invoiced=false ✓, `warehouse.loadSheets.list` status=draft ✓.
- **W2 Capture supplier bill (photo / share sheet, QR)** — Calls: `docint.documents.create/pageUploadUrl/addPage/verifyQr/submit/
list/get` (planned, CAP includes warehouse). Review/commit ✗ by design (desk).
- **W3 Gate count (full-screen keypad, blind)** — Calls: `procurement.grns.get` ✓, `procurement.grns.count` ✓,
  `procurement.discrepancies.list` ✓. `grns.open/post` ✗ by design (desk opens and posts).
- **W4 Fulfilment queue → wave** — group by beat/trip, select, create picklist. Calls: `warehouse.queue.list` ✓,
  `warehouse.picklists.create` ✓, `retailers.beats.list` ✓, `delivery.trips.list` (planned, warehouse included).
- **W5 Picking sheet (consolidated by SKU, FEFO lots, actual lot, short reason)** — Calls: `warehouse.picklists.get/start/pick` ✓.
  `picklists.cancel` ✗ (PIN_HOLDERS) — see §4.3.
- **W6 Pack per order (cartons, weight, short-packs) → invoice issued** — Calls: `warehouse.packs.confirm` ✓, `warehouse.packs.get` ✓,
  `billing.invoices.get` ✓, `billing.invoices.pdf` ✓, `billing.invoices.setEwayBill` ✓ (`billing` is mounted on warehouse-service
  in the in-flight slice). PDF renderer deferred.
- **W7 Load sheet: build, crew blind count, manager confirm, challan print** — Calls: `warehouse.loadSheets.create/get/list` ✓,
  `warehouse.challans.get/list` ✓, `inventory.locations.list` kind=vehicle ✓, `delivery.vehicles.list` (planned).
  `warehouse.loadSheets.confirm/cancel` ✗ (PIN_HOLDERS) — see §4.3. MISSING: `warehouse.challans.pdf`.
- **W8 Stock: balances per lot, near expiry, damage/expiry bin, transfer, new lot** — Calls: `inventory.stock.balances/ledger/adjust/
transfer` ✓, `inventory.lots.upsert` ✓, `inventory.locations.list/upsert` ✓. MISSING: `inventory.cycleCounts.*`, `expiringBefore`.
- **W9 Van check-in count (stock counted back)** — the crew's unsold stock is counted at the gate; the settlement itself is desk
  work. Calls: `inventory.stock.balances` locationId=vehicle ✓, `delivery.trips.settlementPreview` ✗ (planned roles exclude
  warehouse) — the warehouse app shows expected van stock from balances instead.
- **W10 Trips: create, start loading** — `delivery.trips.create/startLoading/list/get` (planned, warehouse included).
- **W11 Reservations (what is held for whom)** — `warehouse.reservations.list` ✓; `release` ✗ by design.
- **W12 Me / inbox** — X4, `notifications.messages.list`, `pushTokens.register` (planned).

### 4.2 Graphs

None beyond counts on W1 (a `<Sparkline>` of packs per day from `reporting.registers.fillRate`, planned, warehouse may call).

### 4.3 Permission cross-check (warehouse)

- The `warehouse` and `billing` keys are mounted on warehouse-service in the in-flight slice (verify after it commits): W6's print
  needs `invoices.get/pdf` and the e-way bill entry `setEwayBill`, all BILLING_ISSUERS ✓.
- The manager's PIN steps (`loadSheets.confirm/cancel`, `picklists.cancel`) are PIN_HOLDERS and "holding an owner/manager token is
  the PIN" — but warehouse-service serves ONLY the `warehouse` role, so a manager's token is 403 on :3004 before business logic.
  Consequence for the frontend: either (a) load-out confirm lives in the manager app (M7) and the warehouse app's W7 is read-only
  "waiting for manager", or (b) an `auth.stepUp` procedure (manager username + PIN on the warehouse device → short-lived
  manager token scoped to `loadSheets.confirm`) is added and warehouse-service accepts it. Decision needed; (a) needs no backend.
- Can but no screen (wider than the app): `retailers.upsert`, `retailers.beats.upsert/assign`, `retailers.visits.record`,
  `orders.create/setLines/submit/repeatLast` (a loader can place and submit orders), `catalog.propose`, `tenantCatalog.suppliers`.
  Recommendation: keep `catalog.propose`; move the retailer/beat/visit/order writes to tuples without `warehouse`.

### 4.4 Offline

Not required before the pilot (docs/22 §2). Counts and pick lines persist locally and retry through `sync.upload`
(`pick_lines` handler ✓; a `grn_lines` count handler ✗ — add if the godown's 4G proves as bad as the field's).

### 4.5 White-label

Challan print (W7) carries `seller` ✓; invoice print (W6) ✓ once billing is mounted; chrome ✗ (MISSING `tenancy.branding.get`).

---

## 5. Delivery app (`frontend/delivery-app`, delivery-service :3005, role `delivery`; phone, offline before pilot, GPS)

One hand, the other has cash in it. No tab bar: a single stack that opens on the next stop. 12 screens.
The whole `delivery` contract is **planned** (docs/plans/delivery.md §2); calls below name the planned procedures.

### 5.1 Screen inventory

- **D1 Today's trip (home → next stop)** — trip header, stops in sequence, load confirmed, expected cash.
  Calls: `delivery.trips.list` mine (planned), `delivery.trips.get` (planned), `warehouse.loadSheets.get` ✓ (STOCK_VIEWERS),
  `warehouse.challans.get` ✓. MISSING: feature-flag read (`van_sales` decides whether the van-sale button exists).
- **D2 Start trip: consent, odometer, opening cash, depart** — Calls: `delivery.trips.depart` (planned), `delivery.gps.points`
  (planned, background batches, never the queue). MISSING: `delivery.consents.grant/get` — `depart` requires a granted
  `location_consents` row (plan §4 rule 11) and no procedure writes one; the DPDP notice screen has no backend.
- **D3 Stop (maps hand-off, phone, bills for this stop, dues)** — Calls: `delivery.stops.start/arrive` (planned), `retailers.get` ✓,
  `billing.invoices.get` ✓, `receivables.outstanding.get` ✓, `delivery.stops.reorder` (planned).
- **D4 At the door: Deliver / Partial / Failed (+ ePOD)** — per-line qty and reason on partial, photo/OTP/signature per tenant
  policy, shortfall → credit note at the original rate. Calls: `delivery.deliveries.record` (planned, derives outcome and raises
  the credit note), `delivery.deliveries.addPod` (planned), `delivery.stops.fail` (planned), `billing.creditNotes.create`
  autoIssue ✓, `billing.creditNotes.issue` ✓. MISSING: `files.uploadUrl` (the plan says "the photo uploads through a signed URL
  and only the object_key arrives here" — that signed-URL procedure does not exist); the POD policy setting read.
- **D5 Collect (cash / UPI with UTR / cheque), receipt** — expected cash shown above, never pre-filled. Calls:
  `delivery.collections.record` (planned, wraps `receivables.receipts.create` ✓), `billing.invoices.upiQr` ✓,
  `receivables.receipts.get` ✓, `receivables.receipts.list` tripId ✓. MISSING: receipt document to share (see receivables gaps).
- **D6 Van sale (order from vehicle stock, invoice at the door)** — Calls: `delivery.vanSales.create` (planned, one transaction),
  `inventory.stock.balances` locationId=vehicle ✓, `inventory.stock.sellable` ✓, `pricing.quote` ✓, `receivables.creditCheck` ✓,
  `billing.invoices.issueVanSale` ✓ (DOORSTEP), `delivery.stops.add` (planned). Plan correction: docs/plans/delivery.md §2 bills the
  van sale from a per-vehicle `VAN-<reg>` series with `allocation_mode = 'device'`; docs/17 §D5 removed that — it must call
  `BillingService` on the tenant's normal series exactly as `billing.invoices.issueVanSale` already does.
- **D7 Expenses (diesel, toll, …, proof photo)** — `delivery.expenses.record/list` (planned); `files.uploadUrl` MISSING.
- **D8 Day summary & check-in (return, expected vs collected, unsold stock)** — `delivery.trips.return`,
  `delivery.trips.settlementPreview`, `delivery.collections.list`, `delivery.expenses.list` (planned). `trips.settle` ✗ by design.
- **D9 Share invoice / POD / receipt on WhatsApp** — `billing.invoices.pdf` ✓ (renderer deferred), OS share sheet;
  `notifications.messages.list` (planned) shows what already went out automatically.
- **D10 Needs attention (sync rejections)** — `sync.upload` ✓; MISSING `sync.errors.list`.
- **D11 Trip history (mine)** — `delivery.trips.list` (planned), `delivery.deliveries.list` (planned),
  `reporting.registers.deliveryPerformance` driverId=self (planned).
- **D12 Me / inbox** — X4, `notifications.pushTokens.register` (planned), `incentives.progress.mine` (planned, delivery included).

### 5.2 Graphs

None required. D8 shows totals only; D11 may show own on-time rate (`deliveryPerformance`, planned).

### 5.3 Permission cross-check (delivery)

- Needs: `delivery.*` (planned, 28 procedures), `receivables.receipts.create/list/get` ✓, `receivables.outstanding.get` ✓,
  `receivables.creditCheck` ✓, `billing.invoices.get/pdf/upiQr/issueVanSale` ✓, `billing.creditNotes.create/issue/get/list` ✓,
  `warehouse.packs/loadSheets/challans` reads ✓, `inventory.stock.balances/sellable` ✓, `retailers.get/list` ✓.
- A van-sale order needs `orders.confirm` (BACK_OFFICE ✗) — fine only because `delivery.vanSales.create` confirms server-side
  as planned; the app must never build the van sale from `orders.create` + `orders.submit` alone.
- Can but no screen (wider than the app): `receivables.outstanding.list` (MONEY_COLLECTORS — the crew can read the whole ageing
  register; the app needs one shop at a time), `retailers.upsert`, `retailers.beats.upsert/assign`, `retailers.visits.record`,
  `orders.create/submit` for non-van orders, `pricing.bargains.request`, `inventory.stock.ledger`, `tenantCatalog.suppliers`.
  Recommendation: drop `delivery` from `outstanding.list`; move retailer/beat/visit writes off STAFF.
- `retailers.get` returns the staff shape (code, tier, credit limit, credit days, mode) to the crew; the ROLE_GROUPS comment says
  credit terms are back-office. The crew needs `creditMode` and dues, not the limit. Field-level narrowing to consider.

### 5.4 Offline (must work before the pilot)

Screens: D1, D3, D4, D5, D6, D7, D8 (preview computed locally), D10. Device holds: today's trip + stops, invoices + lines of those
stops, retailers of those stops (phone hidden after delivery), vehicle stock snapshot, price inputs for van sales, tenant
settings (tolerance, POD policy, geofence). Write path through `sync.upload` (handlers planned in `delivery.sync.ts`):
`trip_stops`, `deliveries`, `delivery_lines`, `pod_evidence`, `collections`, `trip_expenses`; today only `receipts` and
`allocations` handlers exist — the `collections` handler must call `ReceiptsService` so a doorstep receipt is one row, not two.
Van sale offline: `sales_orders` handler exists but confirms as BACK_OFFICE — a `van_sales` handler (planned via
`vansales.service.ts`) must wrap create → submit → confirm → invoice. GPS: `/gps/points` only, never the queue. Attachments: a
separate upload queue needs `files.uploadUrl` (MISSING) and client-side compression (≤ 1600 px / ~200 KB, UX-00 §8.3).

### 5.5 White-label

Foreground GPS notification "Trip in progress — location shared with <display name>" (MISSING branding read); invoice / credit
note shown or shared at the door carry `seller` ✓; receipt has no seller block; chrome ✗.

---

## 6. Retailer app (`frontend/retailer-app`, retailer-service :3006, role `retailer`; phone, online only)

The detail view for a WhatsApp message: no registration form, no permissions, one card per linked distributor, reorder in 2 taps.
13 screens, no tab bar.

### 6.1 Screen inventory

- **R1 Sign-in / deep link** — X1. The shop "arrives already identified" (UX-00 §11): with username + password only, the first
  open needs a sign-in. MISSING: `auth.loginWithLink` (one-time link token in the WhatsApp message) — future per docs/22 §7 (OTP
  layer); `auth.forgotPassword` (a shop cannot ask its distributor's owner to reset). Flag for the founder before the pilot.
- **R2 Distributor cards (one per membership)** — name, logo, outstanding, last bill. Calls: `auth.me` memberships ✓,
  `auth.switchTenant` ✓. Field gap: `MembershipSummary` has `tenantName` (legal) only, no display name / logo; the per-card
  outstanding needs one `receivables.outstanding.get` PER TENANT, each behind a `switchTenant` — acceptable for 2–3 cards, but a
  `auth.memberships.summary` (dues + last bill per membership, computed cross-tenant by the auth service) would make R2 one call.
- **R3 Outstanding (the pending-bills file)** — one row per open bill, oldest first, ageing colour + word, UPI QR one tap away.
  Calls: `receivables.outstanding.get` includeBills ✓ (buckets ✓ for `<AgeingBuckets>`), `billing.invoices.list` openOnly ✓,
  `billing.invoices.upiQr` ✓.
- **R4 Bill detail (lines, credit notes, receipts against it, POD)** — Calls: `billing.invoices.get` ✓ (seller ✓, amountDue ✓),
  `billing.invoices.pdf` ✓, `billing.invoices.upiQr` ✓, `billing.creditNotes.list/get` ✓, `receivables.receipts.list` ✓,
  `delivery.deliveries.list` invoiceId (planned, retailer included; returns `podKinds` only). MISSING: `delivery.deliveries.get`
  with signed read URLs for the POD photo (the plan has `list` only, no `get`, no URL).
- **R5 Pay online** — `receivables.payments.initiate` ✓ (retailer only; payee name = distributor ✓). Gateway callback = later.
- **R6 Statement of account** — `receivables.ledger.get` ✓ (built from documents for the retailer role).
- **R7 Reorder / order editor (ATP-aware quantities, running-low, price shown)** — Calls: `orders.repeatLast` ✓, `orders.create` ✓,
  `orders.setLines` ✓, `orders.cancel` ✓, `tenantCatalog.list` ✓, `catalog.search` ✓, `inventory.stock.sellable` ✓,
  `pricing.quote` ✓. MISMATCH: `orders.submit` is STAFF — the shop can draft but NEVER submit its own order; docs/22 §4 R1 → S5
  ("Reorder → submitted") is unreachable. `OrdersService.submit` has `requireRole(STAFF)` too. The single most important
  retailer gap. "Running low" needs `reporting.retailers.behaviour.usualBasket`, deliberately not on retailer-service — use
  `orders.repeatLast` and the last-order lines instead.
- **R8 Order status & track delivery** — `orders.list/get` ✓ (approvals stripped for the shop), `delivery.stops.list` retailerId
  (planned, ETA only, never a coordinate).
- **R9 Deals** — MISMATCH: `pricing.schemes.list` is STAFF; the shop cannot see its applicable schemes (docs/06 "deals").
  Proposed: allow `retailer` on `schemes.list` with the handler filtering by `applicability` (tier/retailer/beat), or add
  `pricing.deals.mine`.
- **R10 Request discount** — `pricing.bargains.request` ✓ (ANY_MEMBER). MISMATCH: `pricing.bargains.list` is STAFF — the shop
  never learns the outcome (and `orders.get` hides approvals from the shop). Allow `retailer` with RLS narrowing to own rows.
- **R11 Shop profile self-edit (name, owner, alt phone, address, GSTIN — never credit or tier)** — `retailers.get` ✓ (public shape).
  MISMATCH: `retailers.upsert` is STAFF. MISSING: `retailers.updateOwn`.
- **R12 Notifications / inbox** — `notifications.messages.list/get/markRead` (planned, retailer included).
- **R13 Receipts** — `receivables.receipts.list/get` ✓.

### 6.2 Graphs

R3: `<AgeingBuckets>` from `outstanding.get.buckets` ✓. Nothing else (a shop never sees a report; reporting is not mounted).

### 6.3 Permission cross-check (retailer)

- Needs but cannot: `orders.submit` (STAFF), `pricing.schemes.list` (STAFF), `pricing.bargains.list` (STAFF), `retailers.upsert`
  (STAFF). Everything else the screens call is ANY_MEMBER / MONEY_READERS / SHOPKEEPER_ONLY ✓ with RLS narrowing.
- Can but no screen: `catalog.manufacturers`, `inventory.stock.sellable` per-lot rows (batch, MRP, expiry to a shop — acceptable,
  it is ATP), `orders.cancel` on own draft/submitted ✓ (R8 needs it).
- Directory opt-in (`directory_optins` table) has no procedure — post-pilot, not a pilot gap.

### 6.4 Offline

None by decision (docs/02, online-first, persisted query cache only).

### 6.5 White-label

R2 cards need display name + logo (field gap on `MembershipSummary`); R3/R4 documents carry `seller` ✓; UPI payee name ✓;
chrome ✗ — and the retailer role cannot read `tenant_settings` at the database (policy excludes retailer), so the branding
procedure must be service-mediated and served on retailer-service for the active tenant.

---

## 7. White-label surfaces (all apps) — does the backend expose the distributor's name and logo to that role?

| Surface                                        | Roles                  | Backend today                                    | Status  |
| ---------------------------------------------- | ---------------------- | ------------------------------------------------ | ------- |
| App chrome, top-left, every screen             | all seven              | `tenancy.me.tenant.legalName`; no logo, no key   | MISSING |
| Sign-in landing after tenant identified        | all seven              | `auth.login.tenant.legalName`; memberships too   | field   |
| Retailer distributor cards                     | retailer               | `MembershipSummary.tenantName` (legal name)      | field   |
| Tax invoice (screen, PDF, thermal)             | any member (RLS)       | `InvoiceDetail.seller` (name, logo, footer…)     | ✓       |
| Credit note                                    | any member (RLS)       | `CreditNoteDetail.seller`                        | ✓       |
| Delivery challan (Rule 55)                     | STOCK_VIEWERS          | `DeliveryChallanSchema.seller`; no PDF proc      | ✓ / pdf |
| UPI QR payee name (bill, dues, online pay)     | MONEY_READERS          | `upiQr.payeeName`, `payments.initiate`           | ✓       |
| Statement of account (WhatsApp / PDF)          | BACK_OFFICE send; shop | `statements.send` queues; `ledger.get` no seller | field   |
| Receipt handed to the shop (print / WhatsApp)  | MONEY_COLLECTORS, shop | `ReceiptSchema` has no seller, no document       | MISSING |
| Load sheet / picklist (internal paper)         | STOCK_KEEPERS          | none needed; name optional                       | n/a     |
| WhatsApp message body and sender identity      | system → shop          | notifications planned; sender = tenant (q5)      | planned |
| GPS foreground notification text               | delivery               | no read of display name                          | MISSING |
| Owner Settings > Branding (edit + logo upload) | owner                  | no settings read/write, no upload URL            | MISSING |

Backend facts that shape the fix: keys are `TENANT_SETTING_KEYS` in `backend/libs/database/src/tenant-bootstrap.ts`
(`branding.display_name`, `branding.logo_object_key`, `branding.invoice_footer`, `branding.address`, `seller_fssai`, `upi_vpa`,
`ewb_intra_state_threshold`; `secret.*` owner-only). RLS: owner writes; migration 0009 added staff read of non-secret keys; the
retailer role reads nothing, so `tenancy.branding.get` must run as the service and return a pre-signed logo URL. The delivery
plan adds `delivery.settlement_tolerance_paise`, `delivery.pod_required`, `delivery.geofence_metres`, `dpdp.gps_retention_days`
as settings rows — the same `tenancy.settings.*` procedures must cover them.

---

## 8. Gaps by backend module

Format: `proposed procedure` — route — input → output — screens — why. **planned in …** means no gap. Field gaps are additions to
an existing shape. Counts at the end of each block are MISSING items (procedures + field gaps + permission mismatches).

### 8.1 receivables (built) — 5

- `receivables.ageing.history` — GET `/receivables/ageing/history` — `{ from, to, grain: day|week|month, beatId?, retailerId? }` →
  `{ points: [{ asOf, outstandingPaise, overduePaise, openBills, buckets }] }` — O2, O10 — `ageing_snapshots` is written nightly
  and never read; the outstanding-trend and ageing-history charts have no source.
- field: `OutstandingListOutput.totals.buckets` (six paise fields) — O1, O10 — the tenant-level `<AgeingBuckets>` needs bucket
  totals, and summing pages of `outstanding.list` on the client is wrong past 200 shops.
- permission: add `salesperson` to `receivables.outstanding.get`, `receivables.creditCheck`, `receivables.ledger.get` (a new
  DUES_READERS tuple) and mount `receivables` on sales-service — S1, S2, S3 — docs/06 and docs/22 §4 require the outstanding chip
  and the on-device credit check; the founder rule forbids collecting, not seeing.
- `receivables.receipts.document` — GET `/receipts/{id}/document` — `{ id, format: a5|thermal80 }` → `{ status, url, expiresAt }`
  plus a `seller` block on `ReceiptGetOutput` — D5, O11, R13 — the printed / WhatsApp receipt is the third white-label document
  (docs/22 §4 D6) and has no document or seller identity today.
- permission: drop `delivery` from `receivables.outstanding.list` — D3 — the crew needs one shop's dues, not the tenant register.

### 8.2 billing (built) — 3

- `billing.invoices.issueForPack` — POST `/warehouse/packs/{packId}/invoice` — `{ id, packId, invoiceDate?, deviceId? }` →
  `{ item: InvoiceDetail }` — M6, W6 — a pack confirmed with `issueInvoice: false` lands in `packs.list?invoiced=false` and
  `BillingQueueItem.hasDraftInvoice`, but no procedure can bill it (`packs.confirm` is UNIQUE per order and the only caller of
  `BillingService.issueForPack`). Roles BILLING_ISSUERS; must call the exported method, never re-post stock.
- worker `documents.pdf.render` (invoice, credit note, challan, statement, receipt; A4 + thermal80) — M6, W6, D9, R4, O13 — every
  `*.pdf` procedure answers `queued` forever; coordination §3.4 deferred the renderer and no plan owns it. The billing desk and the
  warehouse pack screen cannot print; WhatsApp sends have no attachment. Needs an owner before the frontend starts.
- wiring: mount `billing` on sales-service (reads only; every write refuses the salesperson in PERMISSIONS) as billing.ts §"which
  services mount" already states — S2, S12. (Warehouse-service already mounts it in the in-flight slice.)

### 8.3 warehouse (in flight) — 2

- (done in the working tree, verify at commit) `WarehouseModule` + key on warehouse-, owner-, manager-, delivery-service per
  coordination §6 — W1–W7, W11, M5–M7, O5, O15, D1.
- `warehouse.challans.pdf` — GET `/warehouse/challans/{id}/pdf` — `{ id, copy?, format? }` → `{ status, objectKey, url, expiresAt }`
  — W7, M7, D1 — deliberately absent in this slice (warehouse.ts); the Rule 55 challan must ride with the vehicle on paper.
- decision: manager's-PIN steps on the warehouse device — either W7 is read-only and load-out confirms in M7, or `auth.stepUp`
  (below) lets a manager confirm on the warehouse phone. Also mirror `picklists.cancel`.

### 8.4 delivery (plan) — 3 + 1 correction

- `delivery.consents.grant` / `delivery.consents.get` — POST/GET `/delivery/consents` — `{ id, granted, noticeVersion, deviceId }`
  → `{ item: { userId, granted, grantedAt, noticeVersion } }` — D2 — the plan's `trips.depart` refuses without a granted
  `location_consents` row (§4 rule 11) and nothing writes one; the DPDP notice screen has no backend.
- `delivery.deliveries.get` — GET `/delivery/deliveries/{id}` — `{ id }` → `{ item: Delivery, lines, pod: [{ kind, readUrl }] }` —
  R4, O18, D11 — the plan has `deliveries.list` (podKinds only) and no way to open the POD photo; the retailer's "proof" screen
  and the owner's dispute view need a signed read URL.
- field: `TripDetail.settings` (tolerance, podRequired, geofenceMetres) in `trips.get` — D2, D4, D8 — the crew's offline device
  must know the tenant policy; otherwise it needs `tenancy.settings.get` on delivery-service.
- correction: `delivery.vanSales.create` and `delivery.vehicles.upsert` (per-vehicle `VAN-<reg>` series, `allocation_mode =
'device'`, `nextDocumentNumber` widening in §3 item 10) contradict docs/17 §D5 and `billing.invoices.issueVanSale` — bill from
  the tenant's normal series; delete the per-vehicle series from the brief.

### 8.5 docint (plan) — 0

- Covered: capture on the warehouse phone (CAP includes warehouse), review desk, queue, stats. Note: `docint.documents.pageUploadUrl`
  should be a thin wrapper of the platform `files.uploadUrl` below, not a second signed-URL implementation.

### 8.6 integrations (plan) — 2

- `integrations.profiles.list` / `integrations.profiles.upsert` — GET/POST `/integrations/import-profiles` — `{ id, name, kind,
target, mapping, transforms? }` → `{ item }` — O21 — docs/17 §D7 makes "save the mapping as a named profile" a step of the
  wizard; the plan's intro promises it and its endpoint table has no procedure for it.
- upload: `imports.create` takes `sourceObjectKey` "already uploaded through the platform's signed-URL helper — not yet built";
  see `files.uploadUrl` in 8.13.

### 8.7 claims (plan) — 0

- Covered for O19 / M17. `claims.evidence.attach` takes an `objectKey` — needs `files.uploadUrl` (8.13).

### 8.8 notifications (plan) — 1

- `notifications.send` — POST `/notifications/send` — `{ id, templateKey, retailerId, refType, refId, channel? }` → `{ item }` —
  D9, M9, O6 — an on-demand "send this bill / receipt / statement to the shop now" from a screen; the plan has event-driven sends,
  broadcasts and `resend` of a failed row only. (Low if the OS share sheet with a PDF URL is accepted for the pilot.)

### 8.9 reporting (plan) — 4

- `reporting.series.get` — GET `/reporting/series` — `{ metric, grain, from, to, groupBy?, compare? }` → `{ points, groups }` (full
  shape in §1.2) — O1, O2, O10, O17, O18 — the founder's graphs (docs/22 decision 2026-09-04) need month grain, YoY, and
  brand/beat/rep grouping; the plan serves day grain ≤ 92 days and per-trip / per-variant registers only.
- field: `daily_tenant_stats.by_beat` jsonb (mirror of `by_brand`) and `gross_margin_paise` on `owner_summary` per day (owner
  only) — O2, O17 — beat and margin series have no rollup column.
- `reporting.retailers.series` — GET `/reporting/retailers/{id}/series` — `{ id, weeks: ≤ 26 }` → `{ points: [{ week,
invoicedPaise, orders }] }` — O6 row sparkline, S2 shop card — `retailer_purchase_history` exists and nothing reads it.
- field: `reporting.registers.fillRate` and `deliveryPerformance` gain `groupBy: day` (or are served by `series.get` metrics
  `fillRate`, `onTimeRate`, `podCoverageRate`) — O2 — trends need a day axis; both registers are per variant / per trip.

### 8.10 incentives (plan) — 0

- Covered: S9, D12 (`progress.mine`), O20, M21.

### 8.11 sync (built) — 3

- `sync.errors.list` — GET `/sync/errors` — `{ deviceId?, since?, limit, cursor }` → `{ items: SyncRejection + createdAt +
resolved }` — S5, D10 — rejections are durable in `sync_errors` and unreadable; the "Needs attention" tray has no backend until
  PowerSync streams the table (docs/07), and PowerSync is "later" (`frontend/libs/offline`).
- `sync.pull` — GET `/sync/pull` — `{ deviceId, since (server cursor), tables[] }` → `{ changes: [{ table, rows, deleted }],
cursor }` — S1–S3, D1 — no delta download exists; without PowerSync every open re-reads full lists (≤ 500 each) and breaks the
  10 MB/day budget. Alternative: `updatedAfter` on `retailers.list`, `tenantCatalog.list`, `inventory.stock.sellable`,
  `pricing.*.list`, `orders.list`.
- handlers: register `visits`, `bargain_requests`, `retailers` (rep onboarding), `grn_lines` (count) in `SyncRegistry` — S4, S5,
  S7, W3 — only `sales_orders`, `sales_order_lines`, `receipts`, `allocations`, `pick_lines` have handlers today; delivery's six
  are planned.

### 8.12 auth (built) — 3

- `auth.forgotPassword` / `auth.resetPassword` — POST `/auth/forgot-password`, `/auth/reset-password` — `{ username }` →
  `{ ok }` / `{ token, newPassword }` → `{ ok }` — X1, R1 — no self-service reset; a retailer has no owner to call. Channel is
  SMS/WhatsApp OTP, which docs/22 §7 defers — decide whether the pilot ships without it.
- `auth.loginWithLink` — POST `/auth/link` — `{ token, deviceId }` → `TokenPair` — R1 — the WhatsApp deep link must land a
  shop "already identified" (UX-00 §11); a one-time link token is the password-free path. Future per founder; flag.
- `auth.stepUp` — POST `/auth/step-up` — `{ username, password|pin, scope: [procedure paths], ttlSeconds ≤ 300 }` → short token —
  W7 (load-out confirm), W5 (cancel wave) — the manager's PIN on the warehouse device; warehouse-service refuses a manager token
  today. Skip if load-out confirms in the manager app.
- field: `AuthTenantSchema` and `MembershipSummarySchema` gain `displayName`, `logoUrl` — X1, R2.

### 8.13 tenancy + platform files (built) — 10

- `tenancy.branding.get` — GET `/tenancy/branding` — none → `SellerBrandingSchema` (+ `logoUrl` signed, 24 h) — X3 on all six
  apps, D2 notification text, R2 — the only branding today is inside a document; ANY_MEMBER incl. retailer, service-mediated.
- `tenancy.settings.get` — GET `/tenancy/settings` — `{ keys?: string[] }` → `{ items: [{ key, value }] }` (never `secret.*` to
  non-owners) — O24, D2/D4 (policy), M7 (EWB threshold) — no read of `tenant_settings` exists on the wire.
- `tenancy.settings.set` — POST `/tenancy/settings` — `{ idempotencyKey, items: [{ key, value }] }` → `{ items }`, owner only,
  `audit_log` row per key — O24.
- `files.uploadUrl` — POST `/files/upload-url` — `{ idempotencyKey, id, domain: logo|pod|expense|claim|import|damage, entityId,
mimeType, bytes ≤ 15 MB }` → `{ objectKey, url|null, method, headers, inline, expiresAt }` — O24 (logo), D4/D7 (POD, proof),
  O21 (import file), O19 (evidence) — coordination §3.3 built the storage functions; nothing exposes `putUrl` over HTTP except
  docint's page-specific one (planned). Key convention `tenant/{tenantId}/{domain}/{entityId}/…` already fixed.
- `files.readUrl` — GET `/files/read-url` — `{ objectKey }` → `{ url, expiresAt }` with a per-domain role check (a supplier
  invoice page is never readable by delivery) — R4, O18, O19 — signed GETs are needed wherever an `objectKey` is returned.
- `tenancy.numbering.list` / `tenancy.numbering.upsert` — GET/POST `/tenancy/numbering-series` — `{ seriesCode, prefix,
startingNo, allocationMode }` → `{ items: [{ …, nextNo, lockedAfterFirstIssue }] }`, owner only — O24 — docs/17 §D1: the
  invoice series is per-tenant configuration "surfaced as a setting in the owner app"; no procedure touches `numbering_series`.
- `tenancy.featureFlags.list` / `tenancy.featureFlags.set` — GET/POST `/tenancy/feature-flags` → `{ items: [{ flag, enabled }] }`
  (list ANY_MEMBER, set owner) — O24, D6 (van_sales), O19 (claims_ui), R1 (retailer_app), O13 (e_invoicing) — `feature_flags` is
  read only inside billing; every app that hides a feature behind a flag has no way to know it.
- `tenancy.tenant.update` — POST `/tenancy/tenant` — `{ idempotencyKey, legalName, gstin, stateCode }` → `{ item: Tenant }`,
  owner only, audited — O24 — `tenancy.me` reads the tenant; nothing edits it.
- `tenancy.audit.list` — GET `/tenancy/audit` — `{ entityType?, entityId?, actorId?, action?, from, to, limit, cursor }` →
  `{ items, nextCursor }`, BACK_OFFICE — O25 — `audit_log` is written by prices, credit, approvals, exports, GPS reads and read by
  nobody.
- `tenancy.staff.update` — POST `/tenancy/staff/update` — `{ idempotencyKey, userId, name?, phone?, locale? }` → `{ ok }`,
  ONBOARDERS — O7 — staff can be created, disabled and reset, not edited.

### 8.14 retailers (built) — 3

- `retailers.beats.assignments.list` — GET `/beats/assignments` — `{ beatId?, userId?, on?: IsoDate }` → `{ items: BeatAssignment
  - beatName + userName }`(STAFF; a salesperson forced to self) — S1, O7, M14 —`beat_assignments`is written by`beats.assign`and never read; the rep cannot learn today's beat. Reporting's planned`RetailersService.beatAssignmentsFor` is the internal
    half of the same read.
- `retailers.updateOwn` — POST `/retailers/me` — `{ idempotencyKey, ownerName?, altPhone?, address?, gstin?, gstRegType? }` →
  `{ item: RetailerPublic }`, retailer only, audited — R11 — docs/06 "shop-detail self-edit (never credit/tier)"; `upsert` is STAFF.
- permission: `retailers.beats.upsert` and `retailers.beats.assign` from STAFF to ONBOARDERS — S, W, D cross-checks — a rep, a
  loader or a driver can create beats and assign anyone today.

### 8.15 orders (built) — 2

- permission: `orders.submit` for `retailer` (own order only; `assertRetailerOwns`) and `OrdersService.submit` from
  `requireRole(STAFF)` to `ORDER_ROLES` — R7 — the shop can draft and never submit; docs/22 §4 draws R1 → S5 directly.
  Approvals raised at submit stay invisible to the shop (already stripped by `loadDetail`).
- field: `OrdersListInput.states[]` (or `openOnly`) — S2 "pending undelivered" needs confirmed..dispatched in one call.

### 8.16 pricing (built) — 3

- `pricing.bounds.list` — GET `/pricing/bounds` — `{ userId? }` → `{ items: RepBound[] }` (STAFF; salesperson forced to self) —
  S3 (on-device auto-approve), O7 — `rep_auto_approve_bounds` has a setter and no reader.
- permission: `pricing.schemes.list` for `retailer` with the handler filtering by `applicability` (tier / retailerIds / beatIds)
  and stripping `fundingSource`, `claimable`, `sourceRef` — R9 — the shop's "deals".
- permission: `pricing.bargains.list` for `retailer` (RLS: own rows) — R10 — the shop asks and never hears the answer.

### 8.17 catalog / tenant-catalog (built) — 3

- `tenantCatalog.repAuthorisations.list` / `.set` — GET/POST `/tenant-catalog/rep-authorisations` — `{ userId, brandIds[] }` →
  `{ items }` (list STAFF self-scoped, set BACK_OFFICE) — S3, S11, O7 — docs/02 "authorised product lists per rep";
  `rep_product_authorisations` exists and docs/07 streams it; no procedure.
- `tenantCatalog.brands.list` / `.upsert` — GET/POST `/tenant-catalog/brands` — `{ brandId, cashDiscountMode, active }` — O9,
  O19 — `tenant_brands` (cash-discount mode per brand, claim policy anchor) has no procedure; claims' `policies.list` joins it.
- `tenantCatalog.packConfigs.list` / `.upsert` — GET/POST `/tenant-catalog/pack-configs` — `{ supplierId, variantId,
pcsPerCase, code }` — M3/M4 (buy-side pack sizes for the GRN) — `supplier_pack_configs` has no procedure; docint's
  `matches.choose` takes `pcsPerCase` but nothing lists or edits the configs.

### 8.18 inventory (built) — 2

- `inventory.cycleCounts.open` / `.count` / `.post` / `.list` — POST/GET `/inventory/cycle-counts` — `{ id, locationId, lotIds? }`
  → `{ item: { lines: [{ lotId, expectedPcs, countedPcs }] } }` (STOCK_KEEPERS count, BACK_OFFICE post) — W8, M16, O15 —
  `cycle_counts` / `cycle_count_lines` exist; `stock.adjust` reason `cycle_count` is one lot at a time.
- field: `StockBalancesInput.expiringBefore: IsoDate` and `nearExpiryOnly` — W8, O15 — the near-expiry list is a client-side
  filter over pages today.

### 8.19 procurement (built) — 2

- `procurement.discrepancies.resolve` — POST `/procurement/discrepancies/{id}/resolve` — `{ idempotencyKey, id, status:
accepted|claimed|credited|written_off, note? }` → `{ item }`, BACK_OFFICE — M4, O3 (GRN exceptions) — status has no writer;
  claims' `build` may set `claimed` later but `accepted` / `written_off` are desk decisions.
- `procurement.supplierInvoices.dispute` / `.cancel` — POST `/procurement/supplier-invoices/{id}/dispute` — `{ idempotencyKey,
id, reason }` → `{ item }` — M4 — the `disputed` / `cancelled` statuses in the enum are unreachable over the API.

### 8.20 Cross-cutting decisions the frontend needs before its first screen

1. Accountant write scope (§2.3): narrow the matrix or amend docs/22 — it changes which manager-app screens the accountant gets.
2. Manager's PIN on the warehouse device (§4.3): read-only W7 + confirm in M7, or `auth.stepUp`.
3. Retailer sign-in without a password (§6.1): ship the pilot with username + password for shops, or bring the OTP / link layer
   forward.
4. PDF renderer ownership (8.2): every print and every WhatsApp attachment waits on it.
5. Offline read path (8.11): PowerSync before the pilot, or `sync.pull` / `updatedAfter` filters on the six list procedures.

---

## 9. Totals

| App                  | Screens | MISSING / mismatch items touching it                                                            |
| -------------------- | ------: | ----------------------------------------------------------------------------------------------- |
| Owner                |      26 | series, settings/branding/numbering/flags, upload URL, assignments, bounds list, ageing history |
| Manager + accountant |      21 | bill a parked pack, PDF renderer, challan PDF, discrepancy resolve, accountant scope            |
| Sales                |      14 | outstanding/credit read, beat of the day, bounds list, authorised brands, sync errors/pull      |
| Warehouse            |      12 | manager PIN, cycle counts, challan PDF, near-expiry filter                                      |
| Delivery             |      12 | consents, upload URL, deliveries.get, feature flags, receipt document, van-sale series fix      |
| Retailer             |      13 | orders.submit, schemes/bargains read, self-edit, POD URL, link sign-in, branding on cards       |

MISSING items by module: receivables 5 · billing 3 · warehouse 2 · delivery 3 (+1 plan correction) · docint 0 · integrations 2 ·
claims 0 · notifications 1 · reporting 4 · incentives 0 · sync 3 · auth 3 (+1 field) · tenancy + files 10 · retailers 3 ·
orders 2 · pricing 3 · catalog 3 · inventory 2 · procurement 2 — **51 items**, of which 8 are permission, wiring or decision
items rather than new procedures.
