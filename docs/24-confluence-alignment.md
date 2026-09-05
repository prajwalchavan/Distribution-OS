# 24 — Confluence alignment audit (read-only, 2026-09-05)

**Purpose.** The founder's Confluence space "DistributionOS" (site prajwalchavan18.atlassian.net, 13 pages, all dated
Aug 05 2026) holds the product documents written before any code existed. This file checks every problem statement,
pain point, goal, KPI, persona and TO-BE step in those pages against what the repo has actually built or decided, so
that Confluence can be brought up to date without re-deciding anything. Nothing was written to Confluence.

**Method.** Twelve pages read in full (markdown): Problem Statement 1081345, Pain Point Analysis 2097154, Vision
1048577, Mission 1605635, Goals 1212417, Success Metrics (KPIs) 1802241, Product Principles 1900545, Personas 1966081,
Target Market & Customer Segments 786434, AS-IS Business Process 1736714, TO-BE Business Process 1441794, Home 0.1
1277953 (the 13th page is the empty space overview). Repo side: `docs/22-source-of-truth.md`, `docs/18-build-log.md`,
`docs/23-app-screens-and-api-gaps.md`, `docs/15`, `docs/17`, `docs/03`, the module plans in `docs/plans/`, the 229
procedures of `backend/libs/contracts/src/*.ts` (extracted by script, not memory), `permissions.ts`, the 126 tables of
`backend/libs/database/src/schema/*.ts` and the state machines in `backend/libs/domain/src/state-machines/`.

**Built and verified** (docs/18): auth, tenancy/platform (files, sync, settings), catalog + tenant-catalog, retailers,
pricing, inventory, procurement, orders, receivables, billing, warehouse, platform-gaps. **In gate:** delivery (32
procedures in the contract, module in the working tree). **In progress / queued:** docint (26 procedures in the
contract), integrations, claims, notifications, reporting, incentives (plans only). **No app screen exists yet**
(founder: backend first; layout A Ledger chosen 2026-09-05).

**Legend.** ADDRESSED = every named element has a built procedure or table (delivery counts as built). PARTIALLY =
the core exists, at least one named element is missing or only planned. PLANNED = nothing built, a queued module
covers it. NOT ADDRESSED = nothing in docs, plans or code. SUPERSEDED = a dated founder decision in docs/22 §8 changed
it. Page codes: PS Problem Statement · PP Pain Point Analysis · AS AS-IS · VI Vision · GO Goals · KP Success Metrics ·
PR Principles · PE Personas · TM Target Market · TB TO-BE · HM Home 0.1.

**Counts.** §1 problems and pain points (49 items): 27 ADDRESSED · 16 PARTIALLY · 3 PLANNED · 3 NOT ADDRESSED · 0
SUPERSEDED. §2 goals (11): 3 ADDRESSED · 8 PARTIALLY. §2 KPIs (66 unique across both pages): 39 measurable now ·
15 partly · 12 not. §3 personas (13): 7 mapped to an app and role · 3 folded into the manager role · 3 with no app;
3 persona statements SUPERSEDED. §4 TO-BE steps (19): 14 exist as flows in docs/22 · 2 as procedures without a flow ·
3 absent. §5 lists 19 contradictions, of which 2 (C17, C18) are repo-internal reversals, not Confluence conflicts.

---

## 1. Problem statements and pain points

### 1.1 Problem Statement (page 1081345)

| ID   | Quote (≤ 20 words)                                                                              | Status    |
| ---- | ----------------------------------------------------------------------------------------------- | --------- |
| PS0  | "Distributors lack a unified platform that manages the complete distribution lifecycle."        | PARTIALLY |
| PS1  | "Orders are received from multiple channels … There is no unified order management process."    | PARTIALLY |
| PS2  | "Most orders must be manually entered into billing software before processing can begin."       | PARTIALLY |
| PS3  | "The printed invoice acts as: order confirmation, picking list, packing instruction, delivery…" | ADDRESSED |
| PS4  | "Once an order is created, stakeholders have limited visibility into its progress."             | ADDRESSED |
| PS5  | "Warehouse operations are largely manual … limited digital tracking of picking, packing…"       | ADDRESSED |
| PS6  | "Delivery staff often rely on printed invoices, phone calls, shared shop photos…"               | ADDRESSED |
| PS7  | "Payments are frequently recorded on paper and updated later."                                  | ADDRESSED |
| PS8  | "Businesses often struggle to monitor customer credit, due dates, overdue invoices…"            | ADDRESSED |
| PS9  | "Business owners often receive operational information only after end-of-day reconciliation."   | PARTIALLY |
| PS10 | "Different activities are managed through different tools … manually synchronized."             | ADDRESSED |
| PS11 | "Most existing software is designed primarily for desktop usage. Field employees often cannot…" | PARTIALLY |
| PS12 | "Managers have limited visibility into operational performance … sales trends, warehouse…"      | PLANNED   |

Evidence (module · procedure / table; what is missing):

- PS0: 13 of 19 backend modules verified on one Postgres with forced RLS (docs/18 status table); 229 contract procedures;
  six apps decided (docs/22 §2). Missing: docint, integrations, claims, notifications, reporting, incentives; every app screen.
- PS1: `orders.create / setLines / submit / repeatLast` with `source` = salesperson | retailer_app | van_sale | phone |
  whatsapp; the sales app and retailer app flows are docs/22 §4 S3–S5 and R1; the "order inbox" is `orders.list`
  state=submitted (docs/23 M2). Missing: WhatsApp intake — `notifications.inbound.list/markHandled` (planned) only
  captures the text; turning it into a draft order is in no queued module (docs/plans/notifications.md §"never").
- PS2: inbound side is docint's zero-typing pipeline (`docint.documents.* / extractions.* / review.*`, 26 procedures,
  in progress; docs/22 §5); order side is rep/shop capture plus `orders.repeatLast`; the invoice is derived from the
  pack (`warehouse.packs.confirm` → `BillingService.issueForPack`), never re-keyed. Missing: voice capture and AI
  order parsing (docs/03 defers both post-pilot; no plan).
- PS3: order state machine (`domain/state-machines/order.ts`), `picklists` / `pick_lines`, `pack_confirmations`,
  `load_sheets`, `delivery_challans`, `trip_stops`, `deliveries`, `receipts` are separate records; the invoice is a
  financial document issued at pack and immutable (docs/22 §9 #4).
- PS4: states picking → packed → dispatched → delivered | partially_delivered, each written to
  `order_state_transitions` with the device id; `orders.get`, `warehouse.packs.list`, `warehouse.loadSheets.get`,
  `delivery.stops.list` (the shop gets an ETA, never a coordinate).
- PS5: `warehouse.queue.list`, `picklists.create/start/pick` (FEFO), `packs.confirm`, `loadSheets.create/approve/
confirm` (crew count), `stock_ledger` per movement. Productivity register: `reporting.registers.fillRate` (planned).
- PS6: `retailers.lat/lng` (`retailers.upsert`), `visits.lat/lng` geo-tag, `delivery.trips.*`, `stops.next / start /
arrive` (arrivedLat/Lng), `deliveries.record` + `pod_evidence` (photo, signature, otp, geo); maps hand-off in the
  app (docs/22 §4 D1). Delivery module is in gate.
- PS7: `delivery.collections.record` → `receivables.receipts.create` (cash, UPI + UTR, cheque) → balanced journal
  (database trigger) → `allocations` oldest-first → `retailer_outstanding_summary`; `trip_settlements` for cash in
  transit; offline through `sync.upload` (receipts handler). Collections register by period: reporting (planned).
- PS8: `retailers.setCredit` (limit, bills, days, mode), `receivables.creditCheck`, `outstanding.list/get` with six
  ageing buckets, `ageing.history`, `statements.send`, `cashDiscounts.list`, `writeOffs.create`; overdue is computed,
  never stored. Dues reminders: `notifications.duesReminder` (planned).
- PS9: every register is live today (`orders.list`, `outstanding.list`, `delivery.trips.list`, `billing.invoices.queue`);
  the owner dashboard `reporting.dashboard.owner` (`owner_summary` refreshed every 15 min) and the chart series are
  planned; `reporting.series.get` (month grain, YoY, beat grouping) is a docs/23 §8.9 gap not yet in the plan.
- PS10: one database, one contract, global curated catalog + tenant overlay (`catalog.*`, `tenantCatalog.*`), global
  retailer identity with per-tenant links; modules talk only through services and `outbox_events`. Legacy tools
  coexist by files: generic importer, FieldAssist import, Tally export (integrations, planned).
- PS11: the backend is built for phones (`sync.upload` never 4xx, `sync.pull`, `sync.errors.list`, `/gps/points`,
  `frontend/libs/offline`), six apps web + Android + iOS decided (docs/22 §2). Missing: no app screen exists yet.
- PS12: reporting (planned): `dailyStats.tenant/rep`, `registers.repProductivity / deliveryPerformance / fillRate /
stockValue / schemeSpend`, `retailers.behaviour / lapsed`. Not in the plan: inventory turnover, month grain, YoY.

Desired future state (same page):

| ID   | Quote                                                               | Status    |
| ---- | ------------------------------------------------------------------- | --------- |
| PSD1 | "A single platform for all distribution activities."                | ADDRESSED |
| PSD2 | "Digital workflows from order capture to payment reconciliation."   | ADDRESSED |
| PSD3 | "Real-time visibility into inventory, deliveries, and collections." | ADDRESSED |
| PSD4 | "Mobile applications for field employees."                          | PARTIALLY |
| PSD5 | "Automated operational workflows."                                  | PARTIALLY |
| PSD6 | "Integrated analytics and reporting."                               | PLANNED   |
| PSD7 | "Configurable business processes."                                  | PARTIALLY |
| PSD8 | "Secure multi-tenant SaaS architecture."                            | ADDRESSED |
| PSD9 | "Extensibility for future AI-driven capabilities."                  | PARTIALLY |

- PSD1: as PS0 / PS10. PSD2: the docs/22 §4 loop end to end; `trip_settlements`, `receipts.deposit`.
- PSD3: `stock_balances`, `sellable_stock`, `trips`, `collections` are live rows; the dashboard tile is planned.
- PSD4: backend ready, apps not started (PS11).
- PSD5: auto-confirm inside limits, FEFO suggestion, oldest-first allocation, reservation at confirm; dues reminders
  and customer notifications planned; delivery assignment and route suggestion not built.
- PSD6: reporting module (planned).
- PSD7: `tenant_settings`, `feature_flags`, `numbering_series`, credit modes, schemes, settlement tolerance, POD
  policy are per tenant; state machines, roles, approval kinds and the permission matrix are fixed (docs/22 §9 #7).
- PSD8: ADR 0002 forced RLS, `withTenant()`, auth-service, per-endpoint permission matrix, `audit_log`.
- PSD9: docint's LLM vision extraction and `engine_disagreements` table; no other AI hook exists or is planned.

Feature traceability table on the same page (what the page promised → what exists):

| Feature (PS)          | Status        | Where                                                                     |
| --------------------- | ------------- | ------------------------------------------------------------------------- |
| Order Inbox           | ADDRESSED     | `orders.list` state=submitted, `orders.approvals.list` (manager M2, O3)   |
| Salesman App          | PARTIALLY     | sales-service :3003 complete; app screens after backend                   |
| WhatsApp Integration  | PLANNED       | notifications: outbound templates + inbound capture; no order parsing     |
| Quick Order Entry     | ADDRESSED     | `orders.repeatLast`, `orders.setLines`, `pricing.quote`, ATP hint         |
| Templates             | ADDRESSED     | `orders.repeatLast` (last order as template)                              |
| Voice Capture         | NOT ADDRESSED | docs/03 post-pilot after a 100-utterance benchmark; no plan               |
| AI Parsing            | NOT ADDRESSED | no plan (notifications explicitly excludes it)                            |
| GPS Locations         | ADDRESSED     | `retailers.lat/lng`, `visits`, `trip_stops.arrivedLat/Lng`, `trip_points` |
| Driver App            | ADDRESSED     | delivery-service :3005 (in gate); screens after backend                   |
| Route Management      | PARTIALLY     | `trips.create` sequence, `stops.reorder`, `next`; no optimisation         |
| Payment Ledger        | ADDRESSED     | `journal_entries/lines`, `receivables.accounts.list`, `journal.list`      |
| Collections Module    | ADDRESSED     | `receivables.receipts.*`, `delivery.collections.*`, `allocations.*`       |
| Outstanding Dashboard | ADDRESSED     | `outstanding.list` totals + buckets, `ageing.history`                     |
| Real-Time Dashboards  | PLANNED       | `reporting.dashboard.owner / rep`                                         |
| Analytics             | PLANNED       | reporting registers; `series.get` still a gap (docs/23 §8.9)              |
| Alerts                | PLANNED       | notifications (dues reminder, delivery today); no low-stock alert         |

### 1.2 Pain Point Analysis (page 2097154)

| ID   | Quote (≤ 20 words)                                                                              | Status        |
| ---- | ----------------------------------------------------------------------------------------------- | ------------- |
| PP1  | "A data entry operator manually enters every order into billing software to generate invoices." | ADDRESSED     |
| PP2  | "Sales representatives send retailer orders as free-text messages in WhatsApp groups."          | ADDRESSED     |
| PP3  | "A single printed invoice is used as: Bill, Picking list, Delivery note, Payment tracker…"      | ADDRESSED     |
| PP4  | "Once an invoice is printed, management has no visibility into order progress."                 | ADDRESSED     |
| PP5  | "Drivers receive a photograph or vague description of the shop location."                       | ADDRESSED     |
| PP6  | "Drivers write payment status on paper invoices. Outstanding balances are updated manually…"    | ADDRESSED     |
| PP7  | "Inventory is updated only after billing or manual entry."                                      | ADDRESSED     |
| PP8  | "Picking depends on staff familiarity with product locations. No rack or bin management…"       | PARTIALLY     |
| PP9  | "Drivers receive printed invoices without optimized routes or live tracking."                   | PARTIALLY     |
| PP10 | "Management receives end-of-day reports but lacks operational visibility throughout the day."   | PLANNED       |
| PP11 | "Sales representatives often do not know a retailer's outstanding balance or credit limit…"     | ADDRESSED     |
| PP12 | "Different tasks are handled across billing software, WhatsApp, phone calls, Excel, and paper." | ADDRESSED     |
| PP13 | Prioritisation matrix: "AI Voice Orders" (Phase 3)                                              | NOT ADDRESSED |
| PP14 | Prioritisation matrix: "Demand Forecasting" (Phase 3)                                           | NOT ADDRESSED |
| PP15 | Prioritisation matrix: "Smart Recommendations" (Phase 3)                                        | PARTIALLY     |

Evidence:

- PP1: mobile capture = `orders.*` for `salesperson` (offline via `sync.upload`); web entry = the manager's `orders.create`
  with `source = phone` (docs/23 M2); the invoice is derived at pack. The page's own "future" items (WhatsApp, voice)
  are PLANNED (capture only) and NOT ADDRESSED respectively.
- PP2: structured orders in the sales app (`orders.create/setLines/submit`, `pricing.bargains.request`, `visits.record`);
  order history `orders.list` retailerId / salespersonId; search by state, dates, shop.
- PP3 / PP4: as PS3 / PS4. Vocabulary differs from the page's example (Created → Confirmed → Allocated → Picking → Packed
  → Loaded → Out for Delivery → Delivered → Completed): docs/15 D13 chose draft → submitted → confirmed → picking → packed
  → dispatched → delivered | partially_delivered → closed; "Allocated" is the reservation side effect of confirm,
  "Loaded" is `loadSheets.confirm` → dispatched.
- PP5: coordinates on the shop (`retailers.lat/lng`), geo-tag at check-in as evidence never a block (docs/22 §4 S2),
  `delivery.stops.next` → OS maps hand-off. There is no "verified" flag; the check-in geo-tag is the verification.
- PP6: `delivery.collections.record` is one receipt row, one balanced journal entry, allocated oldest bill first, in the
  same transaction; cash, UPI (UTR), cheque (`receipts.deposit / bounce`); "future payment methods" = the shop's
  `receivables.payments.initiate` (gateway callback later).
- PP7: append-only `stock_ledger` rows at GRN (`procurement.grns.post`), reservation (`orders.confirm`), pick / pack
  (`warehouse.packs.confirm`), load (`loadSheets.confirm` godown → vehicle), return (`billing.creditNotes.issue`
  restocks), adjustment / transfer / cycle count (`inventory.*`); ATP through the `sellable_stock` view.
- PP8: pick lists with FEFO lots and short reasons exist; locations are `warehouse | vehicle | damaged | in_transit |
customer` — no rack, bin or zone; no barcode scanning (the only QR is the supplier e-invoice). The page puts this in
  Phase 2; docs/03 does not schedule it.
- PP9: trips with sequenced stops, `stops.reorder`, live map `delivery.vehicles.positions` + `/gps/points`
  (trip-scoped, DPDP consent, 90-day retention), POD, stop states. Missing: route optimisation (docs/03 lists VRP
  under "must not build"; owner beats + maps are the substitute).
- PP10: `reporting.dashboard.owner` with drill-down registers (planned); alerts via notifications (planned).
- PP11: `receivables.outstanding.get` and `ledger.get` (DUES_READERS include salesperson, scoped to own beats),
  `receivables.creditCheck` (CREDIT_CHECKERS include salesperson) before submit (docs/22 §4 S4).
- PP12: as PS10; shared master data is the global catalog, `retailer_identities` + `retailer_links`, `tenant_settings`.
- PP13: rep voice ordering deferred post-pilot in docs/03; no module or plan.
- PP14: no forecasting; `retailer_purchase_history` (imported TradeEzee lines) and `retailer_behaviour.usualBasket`
  (planned) are inputs only; purchase planning has no procedure (see AS9).
- PP15: rule-based only: `orders.repeatLast`, suggested order from `reporting.retailers.behaviour` (planned), lapsed
  shops (`retailers.lapsed`, planned). No AI recommendation.

### 1.3 AS-IS Business Process (page 1736714) — "Current Pain Points" table and step-level pain points

| ID   | Quote                                                                  | Status        | Evidence                              |
| ---- | ---------------------------------------------------------------------- | ------------- | ------------------------------------- |
| AS1  | "Orders — Multiple channels"                                           | PARTIALLY     | as PS1                                |
| AS2  | "Billing — Manual entry"                                               | ADDRESSED     | invoice derived at pack, not keyed    |
| AS3  | "Inventory — Delayed updates"                                          | ADDRESSED     | as PP7                                |
| AS4  | "Warehouse — Manual picking"                                           | ADDRESSED     | `warehouse.picklists.*` FEFO          |
| AS5  | "Delivery — No tracking"                                               | ADDRESSED     | trips, stops, GPS, POD (in gate)      |
| AS6  | "Payments — Paper records"                                             | ADDRESSED     | as PP6                                |
| AS7  | "Reports — End-of-day visibility"                                      | PARTIALLY     | as PS9                                |
| AS8  | "Communication — Phone & WhatsApp dependency"                          | PARTIALLY     | WhatsApp templates + inbound planned  |
| AS9  | Step 2: "Forecasting based on experience. No demand prediction…"       | PARTIALLY     | `procurement.purchaseOrders.*` only;  |
|      |                                                                        |               | no planning, no reorder suggestion    |
| AS10 | Step 3: "Manual verification. No barcode scanning. Delayed stock…"     | ADDRESSED     | docint QR + vision, blind count,      |
|      |                                                                        |               | `grns.post` → ledger; no carton scan  |
| AS11 | Step 4: "Usually no: Rack management, Bin management, Zone management" | NOT ADDRESSED | no bin entity; not in docs/03         |
| AS12 | Step 9: "Driver receives invoice, products. Usually no digital…"       | ADDRESSED     | `loadSheets.approve/confirm`, challan |

The Vision page's "The Problem We Are Solving" (eight bullets) restates PS1, PS2, PP7, PS5, PS6, PS7, PS9 and PS0 and
carries the same statuses.

---

## 2. Goals and KPIs

### 2.1 Goals (page 1212417)

| ID  | Goal (quote)                                                           | Status    |
| --- | ---------------------------------------------------------------------- | --------- |
| G0  | "Build a unified cloud platform … one integrated system"               | PARTIALLY |
| G1  | "Digitize End-to-End Distribution Operations"                          | PARTIALLY |
| G2  | "Eliminate Duplicate Data Entry"                                       | ADDRESSED |
| G3  | "Provide Real-Time Operational Visibility"                             | PARTIALLY |
| G4  | "Improve Operational Efficiency"                                       | ADDRESSED |
| G5  | "Improve Inventory Accuracy" (batch, expiry, reservations, transfers…) | ADDRESSED |
| G6  | "Improve Delivery Performance" (route, GPS, POD, collection, returns)  | PARTIALLY |
| G7  | "Strengthen Financial Control" (credit, dues, cash recon, profit)      | PARTIALLY |
| G8  | "Empower Mobile Workforce" (apps for reps, delivery, warehouse, owner) | PARTIALLY |
| G9  | "Support Business Growth" (branches, warehouses, vehicles, thousands)  | PARTIALLY |
| G10 | "Build an AI-Ready Platform" (voice, WhatsApp, OCR, forecast, routes)  | PARTIALLY |

- G0: 13 of 19 modules verified; apps not started; deployment later.
- G1: purchase, inventory, sales, warehouse, delivery, payments, finance built; reporting planned.
- G2: one aggregate flows order → pick → pack → bill → POD → receipt; global catalog + tenant overlay; global retailer
  identity with per-tenant links; legacy data enters once through the generic importer (planned).
- G3: every register is live; `reporting.dashboard.owner` and the chart series are planned.
- G4: invoice at pack, auto-confirm inside limits, FEFO, oldest-first allocation, repeat order in three taps.
- G5: `stock_lots` batch / MRP / expiry, `reservations`, `inventory.stock.transfer / adjust`, `inventory.cycleCounts.*`;
  many `locations` of kind warehouse per tenant.
- G6: all built except route management (manual stop sequence + `stops.reorder`; no optimisation, docs/03).
- G7: credit, outstanding, collections, cash reconciliation built; profitability = `owner_summary` margin and
  `reporting.registers.stockValue` (planned, owner / manager / accountant only).
- G8: backend + `sync.*` ready; six apps decided (docs/22 §2); no screen built.
- G9: docs/20 sizes for lakhs of users; many warehouses, vehicles, teams, manufacturers, retailers; no branch entity
  (one tenant = one distributorship — a branch would be its own tenant).
- G10: OCR = docint LLM vision (in progress); voice, WhatsApp parsing, forecasting, route optimisation, assistant absent.

Technical goals: scalability (docs/20, stateless services, RLS, keyset pagination) ADDRESSED; reliability
(idempotency keys, append-only ledgers, outbox) ADDRESSED; security (argon2id, EdDSA tokens, lockout, forced RLS,
`audit_log`, per-endpoint matrix) ADDRESSED — encryption at rest is a deployment concern; extensibility (contract-first
modules, `index.ts` boundaries) ADDRESSED; performance (bounded lists, indexes; no APM) PARTIALLY; availability
(backup + restore drill D30, deployment later) PLANNED. Long-term goals: retailer self-service built; manufacturer
collaboration, 3PL, financial services (docs/15 F6: no fintech) and marketplace not planned. Non-goals match: no
consumer e-commerce, HR or manufacturing ERP; the journal + Tally export complements accounting, never replaces it.

### 2.2 KPIs — can the backend measure each one today?

YES = the data is recorded now (table / procedure named; a report may still be planned). PART = some inputs exist.
NO = nothing recorded. Source: Success Metrics page 1802241 (KP) and the KPI table on the Goals page (GO).

Business Operations (KP §1, GO):

| KPI                         | Now  | Table / procedure                                                              |
| --------------------------- | ---- | ------------------------------------------------------------------------------ |
| Order processing time       | YES  | `sales_orders.submitted_at`, `order_state_transitions`, `invoices.issued_at`   |
| Manual data entry time      | PART | `docint.stats.summary` edits + latency per bill (planned); nothing for orders  |
| Orders per operator per day | YES  | `sales_orders.created_by / salesperson_id`; `reporting.dailyStats.rep` planned |
| Paper-based activities %    | NO   | qualitative; not a data point                                                  |
| Workflow automation rate    | PART | auto-confirmed vs `approvals` raised; docint edits; no general metric          |

Sales & Order Management (KP §2, GO):

| KPI                         | Now  | Table / procedure                                                             |
| --------------------------- | ---- | ----------------------------------------------------------------------------- |
| Orders received / processed | YES  | `sales_orders.state`, `orders.list`; `daily_tenant_stats` planned             |
| Order accuracy              | PART | `credit_notes.reason`, `pick_lines.short_reason`; no "corrected" flag         |
| Order completion rate       | YES  | states delivered / partially_delivered / closed vs cancelled; `deliveries`    |
| Average order value         | YES  | `invoices.total_paise`, `billing.registers.salesRegister`                     |
| Sales growth (MoM)          | YES  | `invoices` by month; month grain series is a reporting gap (docs/23 §8.9)     |
| Salesman productivity       | YES  | orders per `salesperson_id`; `registers.repProductivity` planned              |
| Customer visit completion   | PART | `visits` recorded; planned visits = `pjp` + `beat_assignments` (no procedure) |

Inventory & Warehouse (KP §3, GO):

| KPI                     | Now  | Table / procedure                                                              |
| ----------------------- | ---- | ------------------------------------------------------------------------------ |
| Inventory accuracy      | YES  | `cycle_count_lines` expected vs counted (`inventory.cycleCounts.post`)         |
| Stock availability %    | PART | `stock_balances`, `sellable_stock` now; no availability history                |
| Out-of-stock events     | PART | no stockout event; `pick_lines.short_reason`, unfilled `reservations` approx.  |
| Picking accuracy        | PART | requested vs picked + short reason; wrong-item picks not captured              |
| Loading accuracy        | PART | `load_sheets.expected/counted_packages`, `variance_note`; per-item variance no |
| Inventory turnover      | PART | derivable from `stock_ledger` + `stock_balances`; no procedure in any plan     |
| Inventory age           | YES  | `stock_lots.mfg_date`, GRN date; `registers.stockValue` near-expiry planned    |
| Expired inventory value | YES  | `stock_lots.expiry_date` × `tenant_product_costs` (back office only)           |

Delivery & Logistics (KP §4, GO):

| KPI                       | Now  | Table / procedure                                                             |
| ------------------------- | ---- | ----------------------------------------------------------------------------- |
| On-time delivery rate     | YES  | `trip_stops.eta_at` vs `arrived_at`; `registers.deliveryPerformance` planned  |
| Delivery completion rate  | YES  | `trip_stops.state` delivered / partial / failed; `deliveries.outcome`         |
| Average delivery time     | YES  | `load_sheets.confirmed_at` / `trips.started_at` → `deliveries.delivered_at`   |
| Failed deliveries         | YES  | `trip_stops.failure_reason` (shop_closed, refused, no_cash, wrong_address…)   |
| Delivery route efficiency | PART | actual: `trips.start/end_odometer_km`, `trip_points`; planned distance absent |
| GPS tracking coverage     | YES  | `trip_points` per trip; `location_consents`                                   |
| Delivery proof completion | YES  | `pod_evidence` per delivery; `podCoverageRate` planned                        |

Finance & Collections (KP §5, GO):

| KPI                       | Now | Table / procedure                                                         |
| ------------------------- | --- | ------------------------------------------------------------------------- |
| Outstanding amount        | YES | `retailer_outstanding_summary`, `receivables.outstanding.list` totals     |
| Collection rate           | YES | `receipts` + `allocations` vs `invoices`; `registers.collections` planned |
| Average collection period | YES | allocation date − invoice date; `retailer_behaviour.avgDaysToPay` planned |
| Overdue customers         | YES | ageing buckets (`outstanding.list`, `ageing_snapshots`)                   |
| Credit utilization        | YES | `retailers.credit_limit_paise` vs outstanding (`receivables.creditCheck`) |
| Cash collection accuracy  | YES | `trip_settlements.cash_variance_paise`, `has_variance`                    |
| Payment recording time    | YES | `receipts.received_at` vs `created_at`; `sync_ops` for offline lag        |

Customer Management (KP §6):

| KPI                       | Now | Table / procedure                                                             |
| ------------------------- | --- | ----------------------------------------------------------------------------- |
| Active retailers          | YES | `sales_orders` by retailer; `retailer_behaviour.ordersLast30` planned         |
| New customers             | YES | `retailers.created_at`, `onboarded_by`                                        |
| Repeat order rate         | YES | `sales_orders` per retailer over time                                         |
| Customer retention        | YES | derived from the above; `retailers.lapsed` planned                            |
| Complaint resolution time | NO  | no complaint entity; nearest is `inbound_messages.handled` (planned, no time) |
| Customer satisfaction     | NO  | nothing (page marks it future)                                                |

Employee Productivity (KP §7, GO):

| KPI                          | Now  | Table / procedure                                                          |
| ---------------------------- | ---- | -------------------------------------------------------------------------- |
| Sales orders per salesperson | YES  | `sales_orders.salesperson_id`; `dailyStats.rep` planned                    |
| Deliveries per driver        | YES  | `trips.driver_id / helper_id`, `deliveries.delivered_by`                   |
| Warehouse tasks completed    | YES  | `picklists`, `pack_confirmations`, `load_sheets` with actor and timestamps |
| Average task completion time | YES  | `picklists.started_at / completed_at`, `grns` count/post times             |
| Attendance & activity        | PART | `auth_events` sign-ins, `devices.last_seen_at`; no attendance model        |
| Issue resolution time (GO)   | NO   | as complaint resolution time                                               |

Platform Performance (KP §8):

| KPI                         | Now  | Table / procedure                                         |
| --------------------------- | ---- | --------------------------------------------------------- |
| System availability         | NO   | `/health/ping` only; no uptime store (deployment later)   |
| Average API response time   | NO   | no APM / request log                                      |
| Mobile app crash rate       | NO   | no app yet                                                |
| Failed transactions         | PART | `sync_errors`, `auth_events`, `outbox_events` unpublished |
| Background job success rate | YES  | pg-boss `job` / `archive` tables                          |

Product Adoption (KP §9, GO "Active users per day"):

| KPI                          | Now  | Table / procedure                                            |
| ---------------------------- | ---- | ------------------------------------------------------------ |
| Organizations onboarded      | YES  | `tenants` (`plan`, `status`)                                 |
| Active organizations         | YES  | `auth_sessions.last_used_at` per tenant                      |
| Daily / monthly active users | YES  | `auth_events` (kind = login), `auth_sessions`                |
| Feature adoption rate        | PART | `audit_log`, `feature_flags`; no per-procedure usage counter |
| Mobile app adoption          | PART | `devices.platform`, `auth_sessions.platform`; no app yet     |
| User retention               | YES  | derived from `auth_sessions` over time                       |

Business Growth (KP §10, GO "MRR"):

| KPI                        | Now  | Table / procedure                                                          |
| -------------------------- | ---- | -------------------------------------------------------------------------- |
| Monthly recurring revenue  | NO   | `tenants.plan` enum only (pilot, starter, growth); no subscription billing |
| Customer acquisition rate  | YES  | `tenants.created_at`                                                       |
| Customer churn rate        | PART | `tenants.status`; no cancellation record                                   |
| ARPO / CLV / CAC / CLV:CAC | NO   | outside the product database (docs/15 D28 public price page is the plan)   |

KPI Dashboard tiles on the same page (Sales, Inventory, Delivery, Finance, Workforce, Platform): every Sales, Inventory,
Delivery and Finance tile has its data today (see above) and its tile in `reporting.dashboard.owner` (planned); the
Workforce tiles are `daily_rep_stats` (planned) and `trips` state=active; the Platform tiles (system health, API status)
have no data source.

---

## 3. Personas vs the six apps

| Confluence persona (PE) | App / role in the repo                        | Verdict                                               |
| ----------------------- | --------------------------------------------- | ----------------------------------------------------- |
| Organization Owner      | Owner app, role `owner`, owner-service :3001  | mapped                                                |
| Branch Manager          | Manager app, role `manager` :3002             | mapped, but no branch entity (tenant = one business)  |
| Sales Manager           | none; owner/manager do `beats.assign`,        | NO APP — folded into `manager`                        |
|                         | `pricing.bounds.set`, `dailyStats.rep` (plan) |                                                       |
| Sales Representative    | Sales app, role `salesperson` :3003           | mapped; persona KPI "Collections" SUPERSEDED (D4)     |
| Data Entry Operator     | none; phone orders keyed by the manager (M2); | NO APP — the role is designed away (invoice at pack,  |
|                         | bills issued at pack by `warehouse`           | orders from rep / shop)                               |
| Warehouse Manager       | Manager app (`picklists.create/cancel`,       | folded into `manager` (supervision) + `warehouse`     |
|                         | `loadSheets.approve`, `grns.open/post`)       |                                                       |
| Warehouse Staff         | Warehouse app, role `warehouse` :3004         | mapped                                                |
| Delivery Executive      | Delivery app, role `delivery` :3005           | mapped (collects cash / UPI / cheque, POD, van sale)  |
| Delivery Manager (tree) | none; manager app M7 load-out, M10 day-end    | NO APP — folded into `manager`                        |
| Accountant              | Manager app (shared), role `accountant`       | mapped; "Credit approvals" SUPERSEDED (2026-09-05)    |
| Retailer (Future)       | Retailer app, role `retailer` :3006           | mapped — built NOW, not future; "(Future)" SUPERSEDED |
| Manufacturer (Future)   | none                                          | NO APP — stays future (docs/03 not in pilot)          |
| Super Administrator     | none; `users.platform_role` column; support   | NO APP — no onboarding / subscription console;        |
|                         | access = time-boxed audited grant (docs/17 B) | tenants created by `bootstrapTenant()` / seed         |

Apps with no persona: none — each of the six apps maps to at least one persona. The `manager` role absorbs four
personas (Branch, Sales, Warehouse and Delivery Manager) plus the Data Entry Operator's billing desk; Confluence's
"Web ✅ / Mobile ❌" matrix is replaced by "every app web + Android + iOS" (docs/22 §2, layout A Ledger).
Roles in code (`permissions.ts` ALL_ROLES): owner, manager, accountant, salesperson, warehouse, delivery, retailer.
Confluence's "Permissions are role-based and can be customized by each organization" is not built: the matrix is
one fixed table, tested endpoint × role, not per tenant (see §5 C7).

---

## 4. AS-IS → TO-BE: which TO-BE steps exist as flows in docs/22 §4–§7

TO-BE high-level workflow (page 1441794), step by step:

| TO-BE step            | In docs/22?         | Where / note                                                              |
| --------------------- | ------------------- | ------------------------------------------------------------------------- |
| Manufacturer          | procedures, no flow | `catalog.manufacturers`, `tenantCatalog.brands / suppliers / packConfigs` |
| Purchase Planning     | ABSENT              | no procedure, no plan (AS9)                                               |
| Purchase Order        | procedures, no flow | `procurement.purchaseOrders.upsert / list`; §5 starts at the bill         |
| Goods Receipt         | §5 A–H              | gate count, docint, GRN commit                                            |
| Quality Check         | §5 G (partial)      | short / damaged at review + gate; `inbound_discrepancies`; no QC state    |
| Warehouse Putaway     | ABSENT              | stock lands in the godown location; no bins (AS11)                        |
| Inventory Available   | §5 I                | "visible to sales within one sync"; `sellable_stock`                      |
| Sales Order           | §4 S3, R1           | rep or shop                                                               |
| Validation            | §4 S4               | price engine + credit check on the device; server re-price at C           |
| Inventory Reservation | §4 C                | `orders.confirm` reserves                                                 |
| Picking               | §4 W1–W3            | picklist by SKU, FEFO                                                     |
| Packing               | §4 W4–W5            | pack per order; invoice issued here                                       |
| Loading               | §4 W6               | load sheet, manager approval, crew count                                  |
| Dispatch              | §4 W6               | dispatched; stock godown → vehicle; challan                               |
| Live Delivery         | §3 map, §4 D1       | trip, next stop, `/gps/points`, live map                                  |
| Proof of Delivery     | §4 D3–D5            | delivered / partial / failed; `pod_evidence`                              |
| Payment               | §4 D6, §6           | delivery collects; shop pays online; desk records office money            |
| Settlement            | §4 D8, M1           | check-in, cash variance, day-end                                          |
| Analytics             | ABSENT from §4–§7   | reporting planned; owner graphs decision in §8                            |

TO-BE object lifecycles vs the code (`domain/state-machines/`):

- Purchase Order (TB: Draft → Submitted → Approved → Sent → Partially Received → Received → Closed / Cancelled): code has
  `draft | sent | partially_received | received | cancelled` as a status column, no Submitted / Approved / Closed, no
  state machine. Gap.
- Sales Order (TB: Draft → Submitted → Validated → Reserved → Picking → Packed → Loaded → Dispatched → Delivered →
  Completed): code `draft → submitted → confirmed → picking → packed → dispatched → delivered | partially_delivered →
closed`; Validated + Reserved collapse into confirmed; Loaded is the load sheet; cancel allowed up to confirmed.
- Delivery (TB: Created → Assigned → Accepted → In Transit → Reached → Delivered → Payment Collected → Completed): trip
  `planned → loading → active → closing → settled | settled_with_variance`, stop `pending → started → arrived →
delivered | partial | failed`. No driver "Accepted" step; payment is a receipt, not a stop state.
- Payment (TB: Pending → Collected → Verified → Reconciled → Closed): `receipts.status` = collected | deposited |
  bounced | cancelled. No Verified / Reconciled: bank-statement reconciliation is not built or planned.

TO-BE nine domains: Procurement ✓ (procurement + docint), Inventory ✓ (no bins), Sales ✓, Order Fulfilment ✓, Logistics
✓ minus route planning, Finance ✓ (refunds = reversal / credit note), CRM: retailers, visits, schemes ✓ — complaints ✗,
Analytics planned, Administration ✓ (`tenancy.staff / settings / featureFlags / numbering / audit`; roles fixed).
TO-BE automation points: reserve stock ✓, generate pick lists (manual wave, FEFO auto) ✓, assign warehouse tasks
(`picklists.start` assignedTo, manual), suggest routes ✗, notify customers (planned), flag overdue ✓ (computed) +
reminders (planned), low-stock alert ✗ (not in the notifications plan), commissions (incentives, planned), reports
(reporting, planned).
TO-BE exceptions: insufficient stock ✓ (ATP, short pack), credit exceeded ✓ (approval), wrong product picked ✗ (only
short / FEFO override), delivery failed ✓, customer unavailable ✓ (shop_closed), partial delivery ✓ (credit note),
damaged goods ✓ (damaged bin, discrepancies, return_damaged), payment mismatch ✓ (settlement variance → owner),
vehicle breakdown ✗ (cancel before departure; `trips.return` fails open stops), network unavailable ✓ (sync never 4xx).

---

## 5. Contradictions: what Confluence says and what docs/22 (or the code) decided differently

Format: Confluence (page) → repo decision (where enforced; dated row in docs/22 §8 when it is a founder decision).

- **C1** PE: Sales Representative KPIs include "Collections"; AS-IS step 10 has the driver collect. → The salesperson
  NEVER collects: `MONEY_COLLECTORS` excludes the rep, sales-service has no receipt endpoint (docs/22 §6, §8 2026-09-04).
- **C2** PE: Data Entry Operator "Generate invoices"; HM flow "Sales Order → Invoice → Picking". → No operator role;
  the invoice is issued at pack by the warehouse (`warehouse.packs.confirm`), after picking (docs/15 D15, docs/22 §4).
- **C3** HM stack: Flutter, Next.js, Redis, BullMQ, S3, AWS. → TypeScript everywhere: Expo + Vite + NestJS 12 + oRPC +
  Drizzle, pg-boss, no Redis (docs/03), own S3 SigV4 / local storage driver, deployment later (docs/15 F1, docs/22 §8).
- **C4** PE mapping: per-persona Web ✅ / Mobile ❌; HM "admin portal" + five mobile apps; docs/15 D1 two store binaries.
  → Six apps, one per role, EACH web + Android + iOS; manager + accountant share one; one service per app (§2, 2026-09-04).
- **C5** PE: Accountant permissions include "Credit approvals". → Accountant = money desk + reads; no credit limits,
  prices, schemes, approvals or settings (`MONEY_DESK`, `MANAGEMENT`; docs/22 §8 2026-09-05).
- **C6** PE / HM / VI Stage 3: Retailer "(Future)". → Retailer app is in scope now: retailer-service :3006, the shop
  places orders (`orders.submit`) and pays online (docs/22 §2, docs/23 R7).
- **C7** PE: "Permissions are role-based and can be customized by each organization"; PR 8: configurable order statuses
  and approval flows. → One fixed matrix tested endpoint × role, seven roles, no per-tenant roles; state columns change
  only through the state machines; approval kinds are a fixed enum (`permissions.ts`, docs/22 §9 #7).
- **C8** GO 9 / TM enterprise: "Multiple branches"; PE Branch Manager with branch-level access. → No branch entity:
  one tenant = one distributorship with many warehouses, vehicles and teams; a branch would be its own tenant (schema).
- **C9** PP9 / GO 6 / TB Logistics: route planning and optimisation. → VRP is under "must not build"; manual stop
  sequence + `delivery.stops.reorder` + OS maps hand-off (docs/03).
- **C10** PP8 Phase 2: racks, bins, barcode / QR scanning. → No bins, no barcode; the only QR is e-invoice
  verification on the supplier bill (schema, docs/03).
- **C11** PP4 / TB lifecycles (Allocated, Loaded, Accepted, Payment Collected, Verified, Reconciled). → D13 vocabulary
  with an ONDC mapping; PO has a status list, no machine; receipts are collected / deposited / bounced / cancelled.
- **C12** HM: "This Confluence space is the single source of truth". → `docs/22-source-of-truth.md` is the single
  source of truth, updated in the same turn as any founder decision (docs/22 §8 2026-09-05).
- **C13** HM status: "Development — Not Started". → 13 modules verified, 1254 tests, `pnpm smoke` 844 calls, 0 broken
  (docs/18).
- **C14** PE Super Administrator: organisation onboarding, subscription management. → No platform console;
  `tenants.plan` enum only; support access = time-boxed, owner-approved, audited grant; no subscription billing
  (docs/17 B, docs/15 F6 no fintech).
- **C15** TB steps "Purchase Planning", "Quality Check", "Warehouse Putaway". → Not modelled; the stock-in flow starts
  at the supplier bill and ends at the godown location (docs/22 §5).
- **C16** GO 10 / VI AI-ready: voice, WhatsApp parsing, forecasting, route optimisation, assistant. → Only docint's
  LLM vision; voice and WhatsApp parsing deferred post-pilot, forecasting absent (docs/03).
- **C17** TM: "Multiple languages" as a future market need; Confluence never asks for Hindi. → Repo-internal reversal:
  docs/15 F6 "Hindi + English first" → docs/22 "English only for now" (2026-09-04); `users.locale` still defaults to
  hi-IN and `LocaleSchema` keeps hi-IN / mr-IN.
- **C18** HM auth "JWT + Refresh Tokens" (consistent); Confluence never mentions OTP. → Repo-internal reversal: docs/03
  "no own OTP/JWT stack" → docs/22 own username + password token service, OTP layered later (§7, §8 2026-09-04).
- **C19** VI / TM industries: pharma, electricals, dairy, ice cream, agri. → FMCG only; pilot Tarsun (Too Yumm billed
  in FieldAssist, Campa, MOM); brand-DMS coexistence is a first-class flow Confluence lacks (docs/22 §1, ADR 0014).

C17 and C18 are listed because the brief named them; both reversals happened inside the repo (docs/15 → docs/22 and
docs/03 → docs/22), not against Confluence, which is silent on Hindi and on OTP.

---

## 6. Proposed Confluence updates (proposals only — nothing written)

1. Home 0.1: replace the Technology Stack table (NestJS 12 + oRPC + Drizzle + Postgres 17 + pg-boss; Expo / Vite;
   local or S3 object storage) and the status table; add "docs/22 in the repo is the single source of truth".
2. Personas: drop "Collections" from the Sales Representative KPIs, add "sees dues, never collects"; Accountant =
   money desk + reads; Retailer = current; merge Warehouse Manager / Staff into one `warehouse` role.
3. Personas → Persona-to-Application Mapping: replace the Web / Mobile matrix with the six apps, each web + Android +
   iOS, with service and port; note that Sales / Warehouse / Delivery / Data Entry managers are the `manager` role.
4. Pain Point 4 and TO-BE lifecycles: replace the example ladders with the coded machines (order, trip + stop,
   invoice) and the PO status list; mark Validated / Reserved / Accepted / Verified / Reconciled as not states.
5. TO-BE workflow: mark Purchase Planning, Quality Check, Putaway and Analytics as "not in v1"; add the zero-typing
   inbound flow (QR verify → vision → validators → SKU match → review → GRN) and brand-DMS import (docs/22 §5).
6. Pain Point prioritisation matrix: Warehouse optimisation and Delivery route optimisation → "not planned"; add MVP
   rows Confluence lacks — brand-DMS ingestion, generic importer, Tally export, claims, incentives, van sales.
7. Goals: Goal 9 drop "branches" (or define branch = tenant); Goal 7 profitability = owner-only margin; add non-goal
   "no payments aggregation / fintech" (docs/15 F6) and "no per-tenant custom roles".
8. Success Metrics: annotate every KPI with its table / procedure from §2.2; mark MRR, CAC, CLV, availability and
   crash rate as outside the product database; add docint quality KPIs (edits per 10 lines, line recall ≥ 98 %).
9. Product Principles 8: list what is configurable (settings, feature flags, numbering series, credit modes, schemes,
   settlement tolerance, POD policy) and what is fixed (state machines, roles, approval kinds, permission matrix).
10. Problem Statement traceability table: replace feature names with `module.procedure` names; move Voice Capture and
    AI Parsing to a "future" row; add "Salesman App = sales-service :3003, screens after the backend".
11. Target Market: add the pilot (Tarsun Enterprises, Kalyan West; TradeEzee ERP; Too Yumm billed in FieldAssist DMS)
    and the "coexist with a brand DMS, never a second legal invoice" reality as a segment characteristic.
12. New page "Founder decisions register" mirroring docs/22 §8 (dated rows), so Confluence readers see six apps,
    username + password, white-label, English-only, who collects money, and the A Ledger layout in one place.
