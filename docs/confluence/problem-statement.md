# Problem Statement

## Document Information

| Property     | Value             |
| ------------ | ----------------- |
| Document     | Problem Statement |
| Product      | Distribution OS   |
| Version      | 2.2               |
| Status       | Active            |
| Last Updated | 29 September 2026 |
| Owner        | Prajwal Chavan    |

---

# Purpose

This document defines the core business problems faced by distributors that Distribution OS aims to solve.

The objective is to ensure that product development is driven by validated operational challenges rather than assumptions or technology trends.

Every feature introduced into Distribution OS should directly address one or more of the problems described in this document.

Each problem carries a **How Distribution OS addresses it** section naming the module, procedure or table that answers it.

---

# Background

Small and medium distributors play a critical role in the supply chain between manufacturers and retailers.

Despite handling thousands of products, hundreds of retailers, and daily financial transactions, many distributors continue to rely on a fragmented collection of tools including legacy billing software, WhatsApp, phone calls, Excel spreadsheets, paper invoices, manual registers, and individual employee knowledge.

While these tools support daily operations, they create inefficiencies, duplicate work, and reduce visibility across the business.

The current operational model is heavily dependent on manual coordination rather than connected digital workflows.

**Field evidence.** The distributor Tarsun Enterprises (Kalyan West) bills on TradeEzee, a Windows ERP, while one of its brands (Too Yumm) is billed inside the brand's own DMS, FieldAssist. A distributor therefore does not have one legacy system to replace — it has several, some of which belong to the manufacturer and cannot be switched off. Distribution OS must coexist with them, never issue a second legal invoice for a sale already billed elsewhere, and import rather than demand re-keying.

---

# Core Problem Statement

> **Distributors lack a unified platform that manages the complete distribution lifecycle.**

Most existing solutions focus on only one part of the business, such as billing, accounting, CRM, or inventory.

As a result, distributors must switch between multiple tools and manually coordinate information across departments, increasing operational effort and reducing visibility.

Distribution OS aims to eliminate this fragmentation by providing one integrated platform that supports every operational stage from manufacturer onboarding to payment collection and business analytics.

**How Distribution OS addresses it.** One Postgres database with forced row-level security, one API contract, and one set of backend modules served by eight services. The six business roles share **one app** that becomes the right app after sign-in, on the web and on Android; the iOS app is built from the same code and is not released yet. The single app the distributor's staff install is named "Distribution OS". The manager and the accountant share the manager's screens. The platform console for Distribution OS staff is a separate application. The product runs on Oracle Cloud in the Mumbai region, with PostgreSQL 17 hosted on the product's own server, and the website is served from Cloudflare Pages at `www.distributionos.in`. Document intake, integrations, claims, notifications, reporting, incentives, the AI module and the console are all part of the product.

---

# Validated Business Problems

The following problems have been identified through interviews and observation of real distributor operations.

## 1. Fragmented Order Capture

Orders are received from multiple channels: phone calls, WhatsApp, sales representatives, and manual notes. There is no unified order management process.

**Business impact:** missed orders, duplicate orders, incorrect quantities, time spent manually consolidating requests.

**How Distribution OS addresses it.** Every order is one record with a `source` field (`salesperson`, `retailer_app`, `van_sale`, `phone`, `whatsapp`), created through `orders.create / setLines / submit / repeatLast`. The order inbox is `orders.list` filtered to `state = submitted`. A shop can place its own orders in the app (`orders.submit` is granted to the retailer role). **WhatsApp and voice order capture are part of version 1**, in the `ai` module; the parse is always confirmed by a human before the order is submitted.

## 2. High Manual Data Entry

Most orders must be manually entered into billing software before processing can begin.

**Business impact:** operational delays, human error, duplicate work, increased staffing requirements, slower order processing.

**How Distribution OS addresses it.** Nothing is typed twice on the outbound side: the representative or the shop captures the order once, `orders.repeatLast` turns the last order into a template, and the invoice is derived from the pack (`warehouse.packs.confirm` calls `BillingService.issueForPack`) rather than re-keyed. On the inbound side, `docint` removes typing from supplier bills: QR/IRN verification, LLM vision extraction, validators, SKU match, human review, then GRN. Voice capture and free-text parsing are in the `ai` module.

## 3. Invoice-Centric Operations

The printed invoice acts as order confirmation, picking list, packing instruction, delivery document, payment record, and proof of completion. This creates a dependency on paper for day-to-day operations.

**Business impact:** limited operational visibility, difficult status tracking, delayed updates, paper handling overhead.

**How Distribution OS addresses it.** Each job the paper invoice was doing is now its own record: `picklists` / `pick_lines`, `pack_confirmations`, `load_sheets`, `delivery_challans`, `trip_stops`, `deliveries`, `receipts`. The invoice is only a financial document, issued at pack by the warehouse, after picking — there is no data-entry-operator role — and immutable once issued: corrections are credit or debit notes, and a cancelled invoice keeps its number.

## 4. Limited Order Visibility

Once an order is created, stakeholders have limited visibility into its progress. Questions such as "has it been picked, loaded, dispatched, delivered?" often require phone calls or manual confirmation.

**Business impact:** delayed customer responses, increased operational coordination, lack of accountability.

**How Distribution OS addresses it.** A coded state machine drives the order: draft → submitted → confirmed → picking → packed → dispatched → delivered | partially_delivered → closed. Every change is written to `order_state_transitions` with the device that made it. Status is readable through `orders.get`, `warehouse.packs.list`, `warehouse.loadSheets.get` and `delivery.stops.list`. The shop sees an ETA, never a live coordinate of the crew.

## 5. Weak Warehouse Visibility

Warehouse operations are largely manual, with limited digital tracking of picking, packing, loading, stock movement and warehouse productivity.

**Business impact:** picking errors, loading mistakes, stock discrepancies, low operational efficiency.

**How Distribution OS addresses it.** `warehouse.queue.list`, `picklists.create / start / pick` (FEFO lot suggestion), `packs.confirm` (short-packs are pack rows, never edits to the order), `loadSheets.create / approve / confirm` with a crew count, and an append-only `stock_ledger` row for every movement. Load-out approval is given by the manager on the **manager's screens**, not typed on the warehouse phone. The warehouse productivity register (`reporting.registers.fillRate`) is part of the reporting module. Rack, bin and zone management and barcode scanning are **not available yet**; they are not part of version 1.

## 6. Delivery Challenges

Delivery staff often rely on printed invoices, phone calls, shared shop photos and personal knowledge. Exact retailer locations may not be available.

**Business impact:** delivery delays, increased travel time, failed deliveries, poor customer experience.

**How Distribution OS addresses it.** Shops carry coordinates (`retailers.upsert` lat/lng), the representative's check-in geo-tags the shop as evidence and never blocks the visit, and the crew works a trip of sequenced stops (`delivery.trips.*`, `stops.next / start / arrive`, `deliveries.record` with `pod_evidence` — photo, signature, OTP, geo). Navigation hands off to the phone's own maps app. **Route sequencing by distance and time window is part of version 1** (`ai` module), with the driver always able to override the order.

## 7. Limited Payment Tracking

Payments are frequently recorded on paper and updated later, delaying visibility into collected amounts, outstanding balances, partial payments and collection performance.

**Business impact:** collection delays, credit disputes, reduced cash-flow visibility.

**How Distribution OS addresses it.** A payment is one append-only receipt plus one balanced double-entry journal, written in the same transaction and allocated to the oldest bill first unless tagged: `delivery.collections.record` → `receivables.receipts.create` (cash, UPI with UTR, cheque), `allocations.*`, `retailer_outstanding_summary`, `trip_settlements` for cash in transit. **Who may collect is a rule, not a setting: only the delivery crew at the door, or the shop paying online in the app; the salesperson never records a receipt, and the sales service has no receipt endpoint at all.** The owner, manager and accountant may record a payment received at the office; the accountant works in the manager's part of the app, and the accountant's scope is the money desk plus reads. The period collections register is part of the reporting module.

## 8. Poor Outstanding Management

Businesses often struggle to monitor customer credit, due dates, overdue invoices and collection priorities.

**Business impact:** increased bad debt, uncontrolled credit exposure, collection inefficiencies.

**How Distribution OS addresses it.** `retailers.setCredit` (limit, open bills, days, mode), `receivables.creditCheck` run on the device before an order is submitted, `outstanding.list / get` with six ageing buckets (0-7, 8-15, 16-30, 31-60, 61-90, 90+), `ageing.history`, `statements.send`, `cashDiscounts.list` and `writeOffs.create` (back office only). "Overdue" is computed, never stored. A salesperson may **see** a shop's dues and run the credit check but still cannot collect. Automated dues reminders are part of the notifications module.

## 9. Delayed Business Insights

Business owners often receive operational information only after end-of-day reconciliation. Real-time business visibility is limited.

**Business impact:** slow decision making, delayed corrective actions, reduced operational control.

**How Distribution OS addresses it.** The underlying registers are live — `orders.list`, `receivables.outstanding.list`, `delivery.trips.list`, `billing.invoices.queue` — so the data exists the moment the event happens rather than at day end. The owner dashboard and the chart-ready series behind the owner's graphs are part of the reporting module, so the owner's screens carry graphs wherever possible.

## 10. Siloed Systems

Different activities are managed through different tools — billing software, Excel, WhatsApp, paper records, phone calls — and data must be manually synchronised between them.

**Business impact:** duplicate work, inconsistent information, increased operational complexity.

**How Distribution OS addresses it.** One database, one contract, one catalog: manufacturers, products and variants are global and curated with a per-distributor overlay (`catalog.*`, `tenantCatalog.*`); a shop has one global identity with a link per distributor, so the same retailer can be served by more than one distributor. Backend modules never read each other's tables. Coexistence with legacy tools is by file — a generic importer (upload → preview → map columns → save profile → dry run → commit) for TradeEzee, Marg, Busy, Tally, FieldAssist or Excel (one generic importer, not a connector per vendor), plus FieldAssist import and Tally export. All three are in the integrations module.

## 11. Limited Mobility

Most existing software is designed primarily for desktop usage. Field employees often cannot capture orders, track deliveries, record collections or access customer information while working outside the office.

**Business impact:** reduced productivity, delayed updates, increased communication overhead.

**How Distribution OS addresses it.** **One app for the six business roles**, which becomes the right app after sign-in — on the web and on Android, with the iOS app built from the same code and not released yet — so the field roles get a real phone app rather than a cut-down web page. The backend is shaped for phones: `sync.upload` never answers 4xx (rejections are recorded and returned, never lost), `sync.pull`, `sync.errors.list`, and a GPS endpoint outside the queue. **The app is online-first, with offline for sales and delivery.** The app is in English. The screens follow the A Ledger layout.

## 12. Lack of Operational Analytics

Managers have limited visibility into operational performance: daily sales trends, warehouse efficiency, delivery performance, salesperson productivity, inventory turnover and customer purchasing patterns.

**Business impact:** reactive management, poor forecasting, missed business opportunities.

**How Distribution OS addresses it.** The reporting module provides daily statistics for the tenant and each representative, registers for representative productivity, delivery performance, fill rate, stock value and scheme spend, retailer behaviour and lapsed-shop lists, and the series behind the owner's charts, including month grain and year-on-year comparison. Inventory turnover is not reported. **Demand forecasting and reorder suggestions** are in the `ai` module, feeding purchase planning.

# Root Causes

The problems above originate from several common root causes: disconnected software systems, paper-based workflows, manual data entry, limited mobile capabilities, lack of workflow automation, limited system integration, and insufficient operational visibility.

Understanding these root causes helps ensure that solutions address underlying issues rather than symptoms.

Two further root causes were confirmed in the field: (a) part of a distributor's own sales are billed in a manufacturer's DMS, so the distributor's books are incomplete by design, not by neglect; (b) the paper invoice is the only artefact every role shares, which is why replacing it requires seven separate records, not a prettier print.

---

# Desired Future State

| Desired capability                                              | How Distribution OS provides it                                                                                                                                                                                              |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A single platform for all distribution activities               | One database, one contract, one set of backend modules served by eight services                                                                                                                                              |
| Digital workflows from order capture to payment reconciliation  | The order-to-cash loop runs end to end, including trip settlement and deposits                                                                                                                                               |
| Real-time visibility into inventory, deliveries and collections | `stock_balances`, `sellable_stock`, trips and receipts are live rows, and the owner's summary tiles show them                                                                                                                |
| Mobile applications for field employees                         | One app for the six business roles, on the web and Android, offline for sales and delivery; the iOS app is built from the same code and is not released yet                                                                  |
| Automated operational workflows                                 | Auto-confirm inside limits, FEFO suggestion, oldest-first allocation, stock reservation at confirm, reminders and route sequencing                                                                                           |
| Integrated analytics and reporting                              | The reporting module: owner dashboard, registers and the chart series                                                                                                                                                        |
| Configurable business processes                                 | Settings, feature flags, numbering series, credit modes, schemes, settlement tolerance and proof-of-delivery policy are per distributor; state machines, roles, approval kinds and the permission matrix are fixed by design |
| Secure multi-tenant SaaS architecture                           | Forced row-level security per distributor, per-endpoint permission matrix, audit log; one tenant = one distributorship; multi-branch comes after version 1                                                                   |
| Extensibility for future AI-driven capabilities                 | LLM vision extraction reads supplier bills (`docint`), and WhatsApp and voice capture, forecasting and route sequencing are part of version 1                                                                                |

---

# Product Principles Derived from the Problems

1. Capture data once and reuse it throughout the system.
2. Replace paper-based workflows with digital processes where practical.
3. Provide real-time operational visibility.
4. Automate repetitive manual tasks.
5. Support mobile-first field operations.
6. Maintain a complete audit trail for critical business activities.
7. Design for scalability across distributors of different sizes.
8. Enable configurable workflows rather than hard-coded processes — **within limits**: business parameters are per distributor, but state machines, roles, approval kinds and the permission matrix are fixed so that money and stock behave identically everywhere.
9. Keep business processes modular and extensible.
10. Build with future integrations and AI capabilities in mind.
11. The distributor's brand, not ours: each distributor sees their own name and logo inside the app and on every printed document; Distribution OS appears only on the sign-in screen.
12. AI proposes, a human commits: no AI output — parsed order, extracted bill line, forecast or route — becomes a transaction without human confirmation.

---

# Success Criteria

Distribution OS will be considered successful when it enables distributors to manage operations from a single platform, reduce manual data entry, improve operational visibility, track orders and deliveries in real time, manage inventory more accurately, monitor outstanding payments effectively, increase employee productivity, and make faster, data-driven business decisions.

---

# Scope

This problem statement focuses on operational challenges within the distribution business. Specific feature requirements, workflows and implementation details are documented separately in the Product Requirements, Business Process and Architecture documentation.

**Scope notes.** Positioning is multi-industry — pharma, electricals, dairy and agri are named markets — while the product is FMCG-shaped. One tenant is one distributorship; multi-branch groups come after version 1. Revenue is the distributor's subscription; the platform never touches payments as a business.

## Traceability: problem to what actually delivers it

| Problem                                         | What delivers it                                                                                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fragmented Order Capture                        | `orders.create / setLines / submit / repeatLast` with a `source` field; `orders.list` state = submitted as the order inbox; shops place their own orders in the app |
| Fragmented Order Capture — WhatsApp and voice   | `ai` module: free-text and speech parsed against the shop's own purchase history, always human-confirmed                                                            |
| High Manual Data Entry — outbound               | `orders.repeatLast`, `pricing.quote`, invoice derived at pack by `warehouse.packs.confirm`                                                                          |
| High Manual Data Entry — inbound bills          | `docint`: QR/IRN verify → vision extraction → validators → SKU match → human review → `procurement.grns.post`                                                       |
| Delivery Challenges                             | `delivery.trips.*`, `stops.next / start / arrive`, `deliveries.record`, `pod_evidence`, shop coordinates, maps hand-off                                             |
| Delivery route sequencing                       | `ai` module: stop sequencing by distance and time window, driver may override                                                                                       |
| Limited Payment Tracking                        | `delivery.collections.record`, `receivables.receipts.*`, `allocations.*`, balanced journal, `trip_settlements`                                                      |
| Poor Outstanding Management                     | `receivables.outstanding.list / get` with six ageing buckets, `creditCheck`, `retailers.setCredit`, `statements.send`, `writeOffs.create`                           |
| Delayed Business Insights                       | `reporting.dashboard.owner` and the series behind the owner's graphs                                                                                                |
| Lack of Operational Analytics                   | `reporting.registers.*`, `reporting.retailers.behaviour / lapsed`                                                                                                   |
| Demand forecasting and reorder suggestions      | `ai` module feeding purchase planning                                                                                                                               |
| Siloed Systems — legacy coexistence             | Generic mapped importer, FieldAssist import, Tally export (integrations module)                                                                                     |
| Limited Mobility                                | One app for the six roles, web and Android; `sync.upload` / `sync.pull` never lose a rejection; offline for sales and delivery                                      |
| Distributor onboarding and support              | Platform-admin app and service: organisations, plans, subscription state, time-boxed owner-approved support access                                                  |
| Rack, bin and zone management; barcode scanning | Not available yet                                                                                                                                                   |

This traceability helps prioritise features, avoid unnecessary complexity, and explain the product's value to customers and investors in terms of what exists rather than what is hoped for.
