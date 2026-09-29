# Product Goals

## Document Information

| Property     | Value             |
| ------------ | ----------------- |
| Document     | Product Goals     |
| Product      | Distribution OS   |
| Version      | 2.2               |
| Status       | Active            |
| Last Updated | 29 September 2026 |
| Owner        | Prajwal Chavan    |

---

# Purpose

This document defines the business and product goals of Distribution OS.

These goals translate the long-term vision into measurable objectives that guide product planning, architecture decisions, development priorities, and success evaluation. Each goal names the backend module that serves it.

The product name is **Distribution OS**, and there is **one app of that name** for the six business roles, which becomes the right app after sign-in; the platform console is separate. Inside the app and on every printed document the distributor sees their own name and logo (white-label); product branding appears only on the Welcome and sign-in screens.

# Goal Hierarchy

1. Vision
2. Business Goals
3. Product Goals
4. Features
5. User Stories
6. Development Tasks

Every feature should contribute to at least one product goal.

# Primary Product Goal

> **Build a unified cloud platform that enables distributors to manage their complete business through one integrated system instead of multiple disconnected tools.**

# Strategic Goals at a Glance

| #   | Goal                             | Module that serves it                                                                |
| --- | -------------------------------- | ------------------------------------------------------------------------------------ |
| 1   | Digitize end-to-end operations   | procurement, inventory, orders, warehouse, billing, delivery, receivables, reporting |
| 2   | Eliminate duplicate data entry   | catalog + tenant-catalog, retailers, orders, integrations                            |
| 3   | Real-time operational visibility | every module's registers plus reporting                                              |
| 4   | Improve operational efficiency   | orders, warehouse, billing, receivables                                              |
| 5   | Improve inventory accuracy       | inventory                                                                            |
| 6   | Improve delivery performance     | delivery, ai (route sequencing)                                                      |
| 7   | Strengthen financial control     | receivables, billing, reporting                                                      |
| 8   | Empower the mobile workforce     | all services + sync + offline                                                        |
| 9   | Support business growth          | platform (tenancy), scale rules                                                      |
| 10  | Ship AI in v1                    | docint, ai                                                                           |

## Goal 1 — Digitize End-to-End Distribution Operations

Replace manual and paper-based workflows with connected digital processes covering purchase, inventory, sales, warehouse, delivery, payments, finance and reporting. **Success Indicator:** a distributor can run the business without depending on paper for daily operations.

Purchase, inventory, sales, warehouse, delivery, payments, finance and reporting are all in the product, and every one of them has a screen a person works on. The inbound path delivers **zero typing except the blind gate count**: QR/e-invoice verification, LLM vision extraction, validators, SKU match, human review, then a single idempotent goods-receipt commit.

## Goal 2 — Eliminate Duplicate Data Entry

Business information should be captured once and reused across the platform. **Success Indicator:** the same information does not require repeated manual entry in multiple places.

One sales-order aggregate flows order → pick → pack → invoice → proof of delivery → receipt without re-keying. The product catalog is global and curated with a per-distributor overlay; retailer identity is global with per-distributor links, so one shop can be served by several distributors without being typed in twice.

A distributor's legacy data comes in through a **generic importer** (upload → preview → map columns → save profile → dry run → commit) that works for any source — TradeEzee, Marg, Busy, Tally, FieldAssist, Excel — rather than one connector per ERP. It is part of the integrations module.

## Goal 3 — Provide Real-Time Operational Visibility

Owners should know the current state of orders, deliveries, payments, inventory, warehouse and sales without waiting for end-of-day updates. **Success Indicator:** critical operational metrics are available in real time.

Every register is live — orders, stock, sales, collections, outstanding, trips. The owner's screens carry **graphs wherever possible** (growth, how the distributorship is performing), on the owner dashboard and its chart series.

## Goal 4 — Improve Operational Efficiency

Reduce the time required to complete routine business activities: order processing, warehouse operations, delivery management, payment reconciliation, inventory tracking. **Success Indicator:** common tasks require fewer manual steps and less coordination.

Invoices are issued automatically at pack rather than typed; orders inside price and credit limits confirm without an approval hop; picking is FEFO by lot; receipts allocate oldest bill first; a repeat order is three taps.

## Goal 5 — Improve Inventory Accuracy

Maintain accurate inventory across all warehouses, with batch tracking, expiry tracking, reservations, transfers, adjustments and physical verification. **Success Indicator:** inventory reflects actual stock with minimal discrepancies.

Stock lots carry batch, MRP and expiry; reservations, transfers, adjustments and cycle counts are all in the product. The stock ledger is append-only and balances are derived from it, so a discrepancy is always explainable.

**Not in v1:** racks, bins and barcode scanning. The only scanning in v1 is e-invoice QR verification on a supplier bill.

## Goal 6 — Improve Delivery Performance

Digitize delivery: route management, navigation, delivery confirmation, proof of delivery, payment collection and return handling. **Success Indicator:** delivery progress is visible throughout the day.

The delivery module covers trips, stops, doorstep deliveries with proof of delivery, partial and failed outcomes, returns, van sales, expenses, GPS tracking and cash settlement with variance control.

**Route sequencing is in v1** — stops ordered by distance and time windows, with the driver free to override. It is part of the AI module.

**Only the delivery crew collects money, or the shop pays online.** The salesperson never records a receipt — the sales service has no receipt endpoint and the permission matrix never grants one. The back office may record a payment received at the desk.

## Goal 7 — Strengthen Financial Control

Provide visibility into customer credit, outstanding payments, collections, cash reconciliation and profitability. **Success Indicator:** owners can monitor financial exposure and collections in real time.

Credit limits and checks, outstanding with ageing buckets, collections, cheque lifecycle including bounce and reversal, write-offs and cash settlement variance are all in the product. Every rupee lands in a double-entry journal that must balance at commit — enforced in the database, not in application code.

**Profitability is deliberately restricted.** Purchase cost, landed cost and margin are readable only by owner, manager, accountant and system roles; salesperson, warehouse, delivery and retailer roles cannot read them. That is a database policy with tests, not an app rule.

The **accountant is a money desk plus reads** — may record office receipts, deposits, cheque bounces and write-offs, and may read and export everything, but has no access to prices, schemes, credit limits, approvals or settings.

## Goal 8 — Empower Mobile Workforce

Field users should complete their responsibilities on their own device.

The platform has **one app for the six business roles** — Owner; Manager (shared with the Accountant); Sales; Warehouse; Delivery; Retailer — which becomes the right app after sign-in, plus a separate **Platform Admin** console for Distribution OS staff. The app is one website and one Android app from one codebase; the iOS app is built from the same code and is not released yet. The elected role decides which backend service the app talks to, so a role can only reach the endpoints its service mounts, and a per-endpoint permission matrix decides the rest. One listing in each store, one install for a distributor's staff.

The app is **online-first, with offline for Sales and Delivery**, and it is in **English**. The visual layout is **A Ledger**; the design system is built on it and applies everywhere.

## Goal 9 — Support Business Growth

The platform should scale with the business: multiple warehouses, delivery vehicles, sales teams, manufacturers and thousands of retailers.

The load model the system is designed and tested against is 10,000 distributors, 100,000 staff devices and 2,000,000 retailers, with 5,000 orders per minute at peak. Every table keys on the distributor, every index leads with it, services are stateless, lists are cursor-paginated with hard caps, and long work goes to a background worker.

**Branches are not modelled in v1.** One tenant is one distributorship, which may have many warehouses, vehicles, teams and manufacturers. **Multi-branch comes after version 1**, with each branch its own tenant and an owner-level group view across them; the branch-manager persona comes with it.

## Goal 10 — Ship AI in v1

The AI capabilities are **in v1**, not a future phase.

| Capability                               | Scope in v1                                                                                              | Module |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------ |
| Invoice scanning (supplier bills)        | LLM vision extraction, validators, SKU match, human review before commit                                 | docint |
| WhatsApp order capture                   | Free text parsed into a draft order against the shop's own purchase history — **always human-confirmed** | ai     |
| Voice order capture                      | Speech into the same parser, same human confirmation                                                     | ai     |
| Demand forecasting / reorder suggestions | Purchase planning support for the back office                                                            | ai     |
| Route sequencing                         | Stop order by distance and time windows, driver may override                                             | ai     |

**Non-negotiable:** document intake and order parsing **never commit on their own**. A human reviews before goods are received or an order is placed. A general-purpose AI assistant is not in v1 scope.

# v1 Scope

| Scope                                      | What it means for the goals                                                                                                                                                              |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **All AI features in v1**                  | Goal 10 is the AI features themselves, not readiness for them; route sequencing is part of Goal 6                                                                                        |
| **Platform console in v1**                 | A separate app and service for distributor onboarding, plans and subscription state, and time-boxed, owner-approved, audited support access. Revenue stays subscription-only; no fintech |
| **One tenant = one distributorship**       | Goal 9 has no branches in v1                                                                                                                                                             |
| **Multi-branch after version 1**           | Each branch its own tenant plus an owner group view — an additive change, not a schema rewrite                                                                                           |
| **Multi-industry positioning, FMCG first** | Pharma, electricals, dairy and agri are addressable markets; the product is FMCG-shaped                                                                                                  |

# Technical Goals

| Goal          | How it is met                                                                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Scalability   | Stateless services, tenant-keyed indexes, cursor pagination, background worker; documented load model                                                                                                                          |
| Reliability   | Idempotency key on every mutation, append-only ledgers, transactional outbox                                                                                                                                                   |
| Security      | Argon2id passwords, signed tokens with per-device rotating refresh, lockout, forced row-level security, audit log, per-endpoint permission matrix tested for every endpoint × role. Encryption at rest is a deployment concern |
| Extensibility | Contract-first modules with enforced boundaries; a new module adds files, it does not edit others                                                                                                                              |
| Performance   | Bounded lists and indexes; application performance monitoring is not available yet                                                                                                                                             |
| Availability  | Oracle Cloud (Mumbai) with PostgreSQL 17 hosted on the product's own server, and Cloudflare Pages for the website at `www.distributionos.in`; nightly backups with a restore that is actually tested                           |

# Business Goals

Distribution OS aims to help distributors increase operational efficiency, reduce manual effort, improve customer service, increase collection efficiency, improve inventory management, reduce operational errors, support expansion and improve decision making. These are the commercial case for the subscription.

# User Experience Goals

The platform should be easy to learn, fast to use, mobile friendly, consistent across modules, and usable by non-technical staff. Consistency is concrete: one design system (layout A Ledger) across every role, the admin console included; the app is in English; and the distributor's own branding is inside the app and on every document. The app opens on a Welcome screen carrying the Distribution OS mark, and after sign-in lands on who-you-are — the distributor's logo and name, the person's name, and which role this is — before the day's work.

# Long-Term Goals (5–10 Years)

Distribution OS should evolve into a connected distribution ecosystem supporting manufacturer collaboration, retailer self-service, third-party logistics integration, marketplace capabilities and AI-driven optimisation.

Two boundaries on this list:

- **Retailer self-service is already part of v1.** The shop sees its bills and outstanding, reorders, pays online and tracks delivery, with one card per linked distributor.
- **Financial services integration is not a goal.** No fintech, no payments aggregation, no lending. Revenue is the distributor's subscription.

# Non-Goals (Current Scope)

To maintain focus, these are **not** objectives:

- Consumer e-commerce platform or marketplace for end consumers
- Manufacturing ERP
- Full HR management system
- General-purpose accounting software replacement — the journal and Tally export complement the distributor's accountant, they do not replace them
- **Payments aggregation, lending or any fintech product**
- **Per-distributor custom roles and configurable approval flows** — there is one fixed role set with one permission matrix tested endpoint by endpoint; states change only through coded state machines
- **Branch hierarchy** in v1 — multi-branch comes after version 1, as a tenant per branch
- Warehouse racks, bins and barcode scanning
- Re-invoicing a sale already billed in a brand's own DMS — those are imported and linked, never issued a second legal invoice

# Success Metrics (KPIs)

Each KPI is annotated with whether the product holds the data to measure it. Full KPI coverage is in the Success Metrics page.

| Area             | KPI                             | Measurable? | Where the data lives                                                     |
| ---------------- | ------------------------------- | ----------- | ------------------------------------------------------------------------ |
| Order Processing | Average order processing time   | Yes         | Order submission, state transitions, invoice issue timestamps            |
| Inventory        | Inventory accuracy (%)          | Yes         | Cycle count lines: expected vs counted                                   |
| Deliveries       | On-time delivery rate           | Yes         | Stop ETA vs arrival time                                                 |
| Finance          | Outstanding collection period   | Yes         | Allocation date minus invoice date                                       |
| Warehouse        | Picking accuracy                | Partly      | Requested vs picked with short reason; wrong-item picks are not captured |
| Sales            | Orders processed per day        | Yes         | Sales order states                                                       |
| Productivity     | Orders processed per employee   | Yes         | Salesperson on each order                                                |
| Customer Service | Average issue resolution time   | No          | No complaint entity exists; not in v1                                    |
| Platform         | Active users per day            | Yes         | Authentication events and sessions                                       |
| Platform         | Monthly recurring revenue (MRR) | Yes         | Plan and subscription state in the platform console                      |

> **Note:** target values are set against baselines measured at the distributor. A KPI without a baseline is a guess.

# Alignment with Vision

These goals support becoming the operating system for Indian distributors by connecting every department, eliminating fragmented workflows, giving owners real-time intelligence, scaling from one distributorship to many, and including the AI capture, forecasting and routing capabilities in the first release.
