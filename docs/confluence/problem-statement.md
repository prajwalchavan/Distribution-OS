# Problem Statement

## Document Information

| Property     | Value              |
| ------------ | ------------------ |
| Document     | Problem Statement  |
| Product      | Distribution OS    |
| Version      | 2.0                |
| Status       | Active             |
| Last Updated | September 2026     |
| Owner        | Product Management |

---

# Purpose

This document defines the core business problems faced by distributors that Distribution OS aims to solve.

The objective is to ensure that product development is driven by validated operational challenges rather than assumptions or technology trends.

Every feature introduced into Distribution OS should directly address one or more of the problems described in this document.

**New in version 2.0.** Each problem now carries a **How Distribution OS addresses it** section naming the module, procedure or table that answers it, with an honest status: **ADDRESSED** = built and verified in the backend, every named element has a procedure or table; **PARTIAL** = the core is built, at least one named element is missing or only planned; **PLANNED** = nothing built yet, a named module in the build chain covers it; **NOT YET** = no module, no plan, the honest answer is "not scheduled". Nothing from version 1.0 has been deleted; where a founder decision changed the answer, the sentence says so and carries its date.

As at 2026-09-05 13:45 IST: **14 backend modules verified, 1,442 automated tests, 1,004 endpoint calls exercised, 0 broken** (Build Status & Roadmap mirrors `docs/18-build-log.md`). **No app screen exists yet** — the founder's standing decision (2026-09-04) is backend first, production grade on the local database, then the apps one at a time. Statuses below describe the backend, not the user interface.

---

# Background

Small and medium distributors play a critical role in the supply chain between manufacturers and retailers.

Despite handling thousands of products, hundreds of retailers, and daily financial transactions, many distributors continue to rely on a fragmented collection of tools including legacy billing software, WhatsApp, phone calls, Excel spreadsheets, paper invoices, manual registers, and individual employee knowledge.

While these tools support daily operations, they create inefficiencies, duplicate work, and reduce visibility across the business.

The current operational model is heavily dependent on manual coordination rather than connected digital workflows.

**Field evidence (added 2026-09-05).** The pilot customer, Tarsun Enterprises (Kalyan West), bills on TradeEzee, a Windows ERP, while one of its brands (Too Yumm) is billed inside the brand's own DMS, FieldAssist. A distributor therefore does not have one legacy system to replace — it has several, some of which belong to the manufacturer and cannot be switched off. Distribution OS must coexist with them, never issue a second legal invoice for a sale already billed elsewhere, and import rather than demand re-keying.

---

# Core Problem Statement

> **Distributors lack a unified platform that manages the complete distribution lifecycle.**

Most existing solutions focus on only one part of the business, such as billing, accounting, CRM, or inventory.

As a result, distributors must switch between multiple tools and manually coordinate information across departments, increasing operational effort and reducing visibility.

Distribution OS aims to eliminate this fragmentation by providing one integrated platform that supports every operational stage from manufacturer onboarding to payment collection and business analytics.

**How Distribution OS addresses it — PARTIAL.** One Postgres database with forced row-level security, one API contract, and **14 of 21** backend modules verified. Six role apps are decided and their services are running (owner, manager + accountant, sales, warehouse, delivery, retailer), each web + Android + iOS; a seventh platform-admin app (web) was added for Distribution OS staff (Decided 2026-09-05). Still to build: document intake (`docint`), integrations, claims, notifications, reporting, incentives, the AI module, the platform console — and every app screen.

---

# Validated Business Problems

The following problems have been identified through interviews and observation of real distributor operations.

## 1. Fragmented Order Capture

Orders are received from multiple channels: phone calls, WhatsApp, sales representatives, and manual notes. There is no unified order management process.

**Business impact:** missed orders, duplicate orders, incorrect quantities, time spent manually consolidating requests.

**How Distribution OS addresses it — PARTIAL.** Every order is one record with a `source` field (`salesperson`, `retailer_app`, `van_sale`, `phone`, `whatsapp`), created through `orders.create / setLines / submit / repeatLast`. The order inbox is `orders.list` filtered to `state = submitted`. The retailer app can place its own orders (Decided 2026-09-05: `orders.submit` is granted to the retailer role). **Gap:** WhatsApp free text becomes a draft order only when the AI module ships — **Decided 2026-09-05, WhatsApp and voice order capture are in v1, before the pilot**, in a new `ai` module; the parse is always confirmed by a human before the order is submitted. Until then, notifications captures the inbound message only.

## 2. High Manual Data Entry

Most orders must be manually entered into billing software before processing can begin.

**Business impact:** operational delays, human error, duplicate work, increased staffing requirements, slower order processing.

**How Distribution OS addresses it — PARTIAL.** Nothing is typed twice on the outbound side: the representative or the shop captures the order once, `orders.repeatLast` turns the last order into a template, and the invoice is derived from the pack (`warehouse.packs.confirm` calls `BillingService.issueForPack`) rather than re-keyed. On the inbound side, `docint` (26 procedures, in build) removes typing from supplier bills: QR/IRN verification, LLM vision extraction, validators, SKU match, human review, then GRN. **Gap:** voice capture and free-text AI parsing are not built; both were deferred post-pilot until **Decided 2026-09-05 moved all AI features into v1** (`ai` module).

## 3. Invoice-Centric Operations

The printed invoice acts as order confirmation, picking list, packing instruction, delivery document, payment record, and proof of completion. This creates a dependency on paper for day-to-day operations.

**Business impact:** limited operational visibility, difficult status tracking, delayed updates, paper handling overhead.

**How Distribution OS addresses it — ADDRESSED.** Each job the paper invoice was doing is now its own record: `picklists` / `pick_lines`, `pack_confirmations`, `load_sheets`, `delivery_challans`, `trip_stops`, `deliveries`, `receipts`. The invoice is only a financial document, issued at pack by the warehouse (Decided 2026-09-04) and immutable once issued — corrections are credit or debit notes, and a cancelled invoice keeps its number.

## 4. Limited Order Visibility

Once an order is created, stakeholders have limited visibility into its progress. Questions such as "has it been picked, loaded, dispatched, delivered?" often require phone calls or manual confirmation.

**Business impact:** delayed customer responses, increased operational coordination, lack of accountability.

**How Distribution OS addresses it — ADDRESSED.** A coded state machine drives the order: draft → submitted → confirmed → picking → packed → dispatched → delivered | partially_delivered → closed. Every change is written to `order_state_transitions` with the device that made it. Status is readable through `orders.get`, `warehouse.packs.list`, `warehouse.loadSheets.get` and `delivery.stops.list`. The shop sees an ETA, never a live coordinate of the crew.

## 5. Weak Warehouse Visibility

Warehouse operations are largely manual, with limited digital tracking of picking, packing, loading, stock movement and warehouse productivity.

**Business impact:** picking errors, loading mistakes, stock discrepancies, low operational efficiency.

**How Distribution OS addresses it — ADDRESSED (productivity reporting PLANNED).** `warehouse.queue.list`, `picklists.create / start / pick` (FEFO lot suggestion), `packs.confirm` (short-packs are pack rows, never edits to the order), `loadSheets.create / approve / confirm` with a crew count, and an append-only `stock_ledger` row for every movement. Load-out approval is given by the manager in the **manager app** (Decided 2026-09-05), not typed on the warehouse phone. **Gap:** the warehouse productivity register (`reporting.registers.fillRate`) belongs to the reporting module, which is queued. Rack, bin and zone management and barcode scanning are **NOT YET** — not scheduled for v1.

## 6. Delivery Challenges

Delivery staff often rely on printed invoices, phone calls, shared shop photos and personal knowledge. Exact retailer locations may not be available.

**Business impact:** delivery delays, increased travel time, failed deliveries, poor customer experience.

**How Distribution OS addresses it — ADDRESSED (route sequencing PLANNED).** Shops carry coordinates (`retailers.upsert` lat/lng), the representative's check-in geo-tags the shop as evidence and never blocks the visit, and the crew works a trip of sequenced stops (`delivery.trips.*`, `stops.next / start / arrive`, `deliveries.record` with `pod_evidence` — photo, signature, OTP, geo). Navigation hands off to the phone's own maps app. **Change:** route optimisation was previously out of scope; **Decided 2026-09-05, route sequencing by distance and time window is in v1** (`ai` module), with the driver always able to override the order.

## 7. Limited Payment Tracking

Payments are frequently recorded on paper and updated later, delaying visibility into collected amounts, outstanding balances, partial payments and collection performance.

**Business impact:** collection delays, credit disputes, reduced cash-flow visibility.

**How Distribution OS addresses it — ADDRESSED (collections register PLANNED).** A payment is one append-only receipt plus one balanced double-entry journal, written in the same transaction and allocated to the oldest bill first unless tagged: `delivery.collections.record` → `receivables.receipts.create` (cash, UPI with UTR, cheque), `allocations.*`, `retailer_outstanding_summary`, `trip_settlements` for cash in transit. **Who may collect is a rule, not a setting (Decided 2026-09-04): only the delivery crew at the door, or the shop paying online in the retailer app; the salesperson never records a receipt, and the sales service has no receipt endpoint at all.** The owner, manager and accountant may record a payment received at the office; the accountant's scope was fixed at money desk plus reads (Decided 2026-09-05). **Gap:** the period collections register is in reporting.

## 8. Poor Outstanding Management

Businesses often struggle to monitor customer credit, due dates, overdue invoices and collection priorities.

**Business impact:** increased bad debt, uncontrolled credit exposure, collection inefficiencies.

**How Distribution OS addresses it — ADDRESSED (reminders PLANNED).** `retailers.setCredit` (limit, open bills, days, mode), `receivables.creditCheck` run on the device before an order is submitted, `outstanding.list / get` with six ageing buckets (0-7, 8-15, 16-30, 31-60, 61-90, 90+), `ageing.history`, `statements.send`, `cashDiscounts.list` and `writeOffs.create` (back office only). "Overdue" is computed, never stored. A salesperson may **see** a shop's dues and run the credit check (Decided 2026-09-05) but still cannot collect. **Gap:** automated dues reminders sit in the notifications module.

## 9. Delayed Business Insights

Business owners often receive operational information only after end-of-day reconciliation. Real-time business visibility is limited.

**Business impact:** slow decision making, delayed corrective actions, reduced operational control.

**How Distribution OS addresses it — PARTIAL.** The underlying registers are live today — `orders.list`, `receivables.outstanding.list`, `delivery.trips.list`, `billing.invoices.queue` — so the data exists the moment the event happens rather than at day end. **Gap:** the owner dashboard (`reporting.dashboard.owner`, a 15-minute rollup) and the chart-ready series the owner app needs (`reporting.series.get` — month grain, year-on-year, beat grouping) are in the reporting module, which is queued. The founder's requirement that the owner app carry graphs wherever possible (2026-09-04) depends on that module.

## 10. Siloed Systems

Different activities are managed through different tools — billing software, Excel, WhatsApp, paper records, phone calls — and data must be manually synchronised between them.

**Business impact:** duplicate work, inconsistent information, increased operational complexity.

**How Distribution OS addresses it — ADDRESSED (file-level integrations PLANNED).** One database, one contract, one catalog: manufacturers, products and variants are global and curated with a per-distributor overlay (`catalog.*`, `tenantCatalog.*`); a shop has one global identity with a link per distributor, so the same retailer can be served by more than one distributor (the demo data covers three distributors with shops linked to several). Backend modules never read each other's tables. **Gap:** coexistence with legacy tools is by file — a generic importer (upload → preview → map columns → save profile → dry run → commit) for TradeEzee, Marg, Busy, Tally, FieldAssist or Excel (Decided 2026-09-04: one generic importer, not a connector per vendor), plus FieldAssist import and Tally export. All three are in the integrations module, which is queued.

## 11. Limited Mobility

Most existing software is designed primarily for desktop usage. Field employees often cannot capture orders, track deliveries, record collections or access customer information while working outside the office.

**Business impact:** reduced productivity, delayed updates, increased communication overhead.

**How Distribution OS addresses it — PARTIAL.** **Decided 2026-09-04: six apps, one per role, each built for web, Android and iOS** — the field roles get a phone app rather than a cut-down web page. The backend is already shaped for phones: `sync.upload` never answers 4xx (rejections are recorded and returned, never lost), `sync.pull`, `sync.errors.list`, and a GPS endpoint outside the queue. **Decided 2026-09-04: online-first now, with offline for the sales and delivery apps before the pilot.** English only for the first release. **Gap:** no app screen has been built yet; the A Ledger layout was chosen 2026-09-05 and the apps follow the backend.

## 12. Lack of Operational Analytics

Managers have limited visibility into operational performance: daily sales trends, warehouse efficiency, delivery performance, salesperson productivity, inventory turnover and customer purchasing patterns.

**Business impact:** reactive management, poor forecasting, missed business opportunities.

**How Distribution OS addresses it — PLANNED.** The reporting module covers `dailyStats.tenant / rep` and the registers for representative productivity, delivery performance, fill rate, stock value and scheme spend, plus retailer behaviour and lapsed-shop lists. Inventory turnover, month grain and year-on-year comparison are recorded gaps not yet in that plan. Demand forecasting and reorder suggestions were previously absent; **Decided 2026-09-05, they are in v1** in the `ai` module, feeding purchase planning.

# Root Causes

The problems above originate from several common root causes: disconnected software systems, paper-based workflows, manual data entry, limited mobile capabilities, lack of workflow automation, limited system integration, and insufficient operational visibility.

Understanding these root causes helps ensure that solutions address underlying issues rather than symptoms.

**Added 2026-09-05.** Two further root causes were confirmed in the field: (a) part of a distributor's own sales are billed in a manufacturer's DMS, so the distributor's books are incomplete by design, not by neglect; (b) the paper invoice is the only artefact every role shares, which is why replacing it requires seven separate records, not a prettier print.

---

# Desired Future State

| Desired capability                                              | Status    | Where it stands                                                                                                                                                                                                              |
| --------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A single platform for all distribution activities               | ADDRESSED | One database, one contract, 14 of 21 modules verified                                                                                                                                                                        |
| Digital workflows from order capture to payment reconciliation  | ADDRESSED | Order-to-cash loop is complete end to end, including trip settlement and deposits                                                                                                                                            |
| Real-time visibility into inventory, deliveries and collections | ADDRESSED | `stock_balances`, `sellable_stock`, trips and receipts are live rows; the summary tile is planned                                                                                                                            |
| Mobile applications for field employees                         | PARTIAL   | Six apps decided, web + Android + iOS; backend ready; no screen built yet                                                                                                                                                    |
| Automated operational workflows                                 | PARTIAL   | Auto-confirm inside limits, FEFO suggestion, oldest-first allocation, stock reservation at confirm; reminders and route sequencing planned                                                                                   |
| Integrated analytics and reporting                              | PLANNED   | Reporting module, queued                                                                                                                                                                                                     |
| Configurable business processes                                 | PARTIAL   | Settings, feature flags, numbering series, credit modes, schemes, settlement tolerance and proof-of-delivery policy are per distributor; state machines, roles, approval kinds and the permission matrix are fixed by design |
| Secure multi-tenant SaaS architecture                           | ADDRESSED | Forced row-level security per distributor, per-endpoint permission matrix, audit log; one tenant = one distributorship (Decided 2026-09-05; multi-branch is v2)                                                              |
| Extensibility for future AI-driven capabilities                 | PARTIAL   | LLM vision extraction is contracted and in build (module 5 `docint`, 26 procedures declared, mounted on no service yet); **Decided 2026-09-05 the remaining AI features are v1, not "future"**                               |

---

# Product Principles Derived from the Problems

1. Capture data once and reuse it throughout the system.
2. Replace paper-based workflows with digital processes where practical.
3. Provide real-time operational visibility.
4. Automate repetitive manual tasks.
5. Support mobile-first field operations.
6. Maintain a complete audit trail for critical business activities.
7. Design for scalability across distributors of different sizes.
8. Enable configurable workflows rather than hard-coded processes — **within limits set 2026-09-05**: business parameters are per distributor, but state machines, roles, approval kinds and the permission matrix are fixed so that money and stock behave identically everywhere.
9. Keep business processes modular and extensible.
10. Build with future integrations and AI capabilities in mind.
11. **Added 2026-09-05.** The distributor's brand, not ours: each distributor sees their own name and logo inside the apps and on every printed document; Distribution OS appears only on the sign-in screen.
12. **Added 2026-09-05.** AI proposes, a human commits: no AI output — parsed order, extracted bill line, forecast or route — becomes a transaction without human confirmation.

---

# Success Criteria

Distribution OS will be considered successful when it enables distributors to manage operations from a single platform, reduce manual data entry, improve operational visibility, track orders and deliveries in real time, manage inventory more accurately, monitor outstanding payments effectively, increase employee productivity, and make faster, data-driven business decisions.

---

# Scope

This problem statement focuses on operational challenges within the distribution business. Specific feature requirements, workflows and implementation details are documented separately in the Product Requirements, Business Process and Architecture documentation.

**Scope notes added 2026-09-05.** Positioning stays multi-industry — pharma, electricals, dairy and agri are named markets — while the product stays FMCG-shaped until a second-industry customer exists. One tenant is one distributorship; multi-branch groups are v2. Revenue is the distributor's subscription; the platform never touches payments as a business.

## Traceability: problem to what actually delivers it

| Problem                                         | What delivers it                                                                                                                                       | Status             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| Fragmented Order Capture                        | `orders.create / setLines / submit / repeatLast` with a `source` field; `orders.list` state = submitted as the order inbox; retailer app places orders | ADDRESSED          |
| Fragmented Order Capture — WhatsApp and voice   | `ai` module: free-text and speech parsed against the shop's own purchase history, always human-confirmed (v1, Decided 2026-09-05)                      | PLANNED            |
| High Manual Data Entry — outbound               | `orders.repeatLast`, `pricing.quote`, invoice derived at pack by `warehouse.packs.confirm`                                                             | ADDRESSED          |
| High Manual Data Entry — inbound bills          | `docint`: QR/IRN verify → vision extraction → validators → SKU match → human review → `procurement.grns.post`                                          | PARTIAL (in build) |
| Delivery Challenges                             | `delivery.trips.*`, `stops.next / start / arrive`, `deliveries.record`, `pod_evidence`, shop coordinates, maps hand-off                                | ADDRESSED          |
| Delivery route sequencing                       | `ai` module: stop sequencing by distance and time window, driver may override (v1, Decided 2026-09-05)                                                 | PLANNED            |
| Limited Payment Tracking                        | `delivery.collections.record`, `receivables.receipts.*`, `allocations.*`, balanced journal, `trip_settlements`                                         | ADDRESSED          |
| Poor Outstanding Management                     | `receivables.outstanding.list / get` with six ageing buckets, `creditCheck`, `retailers.setCredit`, `statements.send`, `writeOffs.create`              | ADDRESSED          |
| Delayed Business Insights                       | `reporting.dashboard.owner`, `reporting.series.get` for the owner app's graphs                                                                         | PLANNED            |
| Lack of Operational Analytics                   | `reporting.registers.*`, `reporting.retailers.behaviour / lapsed`                                                                                      | PLANNED            |
| Demand forecasting and reorder suggestions      | `ai` module feeding purchase planning (v1, Decided 2026-09-05)                                                                                         | PLANNED            |
| Siloed Systems — legacy coexistence             | Generic mapped importer, FieldAssist import, Tally export (integrations module)                                                                        | PLANNED            |
| Limited Mobility                                | Six role apps, web + Android + iOS; `sync.upload` / `sync.pull` never lose a rejection; offline for sales and delivery before pilot                    | PARTIAL            |
| Distributor onboarding and support              | Platform-admin app and service: organisations, plans, subscription state, time-boxed owner-approved support access (v1, Decided 2026-09-05)            | PLANNED            |
| Rack, bin and zone management; barcode scanning | Not scheduled for v1                                                                                                                                   | NOT YET            |

This traceability helps prioritise features, avoid unnecessary complexity, and explain the product's value to customers and investors in terms of what exists rather than what is hoped for.

---

## What changed from version 1.0

| Change                                                                                                                                                        | Date decided            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Every problem now names the module, procedure or table that answers it, with an honest built / partial / planned / not-yet status                             | 2026-09-05              |
| Voice capture, WhatsApp and AI order parsing, demand forecasting and route sequencing moved from "future" to **v1, before the pilot**, always human-confirmed | 2026-09-05              |
| Six role apps (owner; manager + accountant; sales; warehouse; delivery; retailer), each web + Android + iOS, plus a seventh platform-admin web app            | 2026-09-04 / 2026-09-05 |
| Only the delivery crew or the shop paying online may record money; the salesperson never collects                                                             | 2026-09-04              |
| The invoice is issued at pack by the warehouse, after picking — there is no data-entry-operator role                                                          | 2026-09-04              |
| Accountant scope fixed at money desk plus reads; manager approves load-out from the manager app                                                               | 2026-09-05              |
| White-label: the distributor's own name and logo everywhere except the sign-in screen                                                                         | 2026-09-04              |
| One tenant = one distributorship; multi-branch groups are v2                                                                                                  | 2026-09-05              |
| Product name is "Distribution OS"; apps are named "Distribution OS - Owner", "- Manager", "- Sales", "- Warehouse", "- Delivery", "- Retailer"                | 2026-09-05              |
| The repository document `docs/22-source-of-truth.md` is the single source of truth; this space mirrors it                                                     | 2026-09-05              |
