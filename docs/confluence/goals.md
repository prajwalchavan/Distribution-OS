# Product Goals

## Document Information

| Property | Value |
| --- | --- |
| Document | Product Goals |
| Product | Distribution OS |
| Version | 2.0 |
| Status | Active |
| Last Updated | September 2026 |
| Owner | Product Management |

---

# Purpose

This document defines the business and product goals of Distribution OS.

These goals translate the long-term vision into measurable objectives that guide product planning, architecture decisions, development priorities, and success evaluation. Version 2.0 adds, for every goal, **where it stands in the build today**, **the backend module that serves it**, and **what remains** — so a goal can no longer be claimed without something to point at.

**Decided 2026-09-05:** the product name is **Distribution OS**; the apps are named "Distribution OS - Owner", "- Manager", "- Sales", "- Warehouse", "- Delivery", "- Retailer". Inside every app and on every printed document the distributor sees their own name and logo (white-label); product branding appears only on the sign-in screen.

**Decided 2026-09-05:** the repository file `docs/22-source-of-truth.md` is the single source of truth for product shape and founder decisions. This space mirrors it. Where the two disagree, `docs/22` wins and this page is corrected.

---

# Goal Hierarchy

1. Vision
2. Business Goals
3. Product Goals
4. Features
5. User Stories
6. Development Tasks

Every feature should contribute to at least one product goal.

---

# Primary Product Goal

> **Build a unified cloud platform that enables distributors to manage their complete business through one integrated system instead of multiple disconnected tools.**

**Status: Partial.** 13 backend modules are built and verified against the working database (1,254 automated tests; 844 endpoint calls exercised end to end with 0 broken, `docs/18-build-log.md`, 2026-09-05). The delivery module cleared the same verification gate later that day (1,442 tests, 1,004 endpoint calls, 0 broken). No app screen is built yet — backend first is a deliberate sequencing decision (2026-09-04) — and deployment comes after the pilot build.

---

# How to Read the Status Column

| Status | Meaning |
| --- | --- |
| **Addressed** | Every element named in the goal has a built, tested procedure or table |
| **Partial** | The core exists; at least one named element is missing or only planned |
| **Planned** | Nothing built; a queued module covers it with a written plan |

Status assessments come from the alignment audit `docs/24-confluence-alignment.md` §2.1, which checked each goal against the contract procedures, the database schema and the build log rather than against intent.

---

# Strategic Goals — Status at a Glance

| # | Goal | Status | Module that serves it | What remains |
| --- | --- | --- | --- | --- |
| 1 | Digitize end-to-end operations | Partial | procurement, inventory, orders, warehouse, billing, delivery, receivables | reporting module; app screens |
| 2 | Eliminate duplicate data entry | Addressed | catalog + tenant-catalog, retailers, orders | generic importer (integrations, planned) |
| 3 | Real-time operational visibility | Partial | every module's registers | owner dashboard + chart series (reporting, planned) |
| 4 | Improve operational efficiency | Addressed | orders, warehouse, billing, receivables | baseline measurement at pilot |
| 5 | Improve inventory accuracy | Addressed | inventory | nothing for v1 |
| 6 | Improve delivery performance | Partial | delivery | AI route sequencing (module 12) |
| 7 | Strengthen financial control | Partial | receivables, billing | profitability registers (reporting, planned) |
| 8 | Empower the mobile workforce | Partial | all services + sync | all seven apps; no screen built yet |
| 9 | Support business growth | Partial | platform (tenancy), scale rules | multi-branch is v2 |
| 10 | Ship AI in v1 | Partial | docint (in progress), ai (module 12, queued) | voice, WhatsApp parsing, forecasting, routing |

## Goal 1 — Digitize End-to-End Distribution Operations

Replace manual and paper-based workflows with connected digital processes covering purchase, inventory, sales, warehouse, delivery, payments, finance and reporting. 

**Success Indicator:** a distributor can run the business without depending on paper for daily operations.

**Status: Partial.** Purchase, inventory, sales, warehouse, delivery, payments and finance are built and verified. Reporting is a queued module (module 9). The inbound path is designed for **zero typing except the blind gate count**: QR/e-invoice verification, LLM vision extraction, validators, SKU match, human review, then a single idempotent goods-receipt commit.

**What remains:** the reporting module, and the app screens that put these flows in a user's hands.

## Goal 2 — Eliminate Duplicate Data Entry

Business information should be captured once and reused across the platform. 

**Success Indicator:** the same information does not require repeated manual entry in multiple places.

**Status: Addressed.** One sales-order aggregate flows order → pick → pack → invoice → proof of delivery → receipt without re-keying. The product catalog is global and curated with a per-distributor overlay; retailer identity is global with per-distributor links, so one shop can be served by several distributors without being typed in twice.

**What remains:** legacy data migration. **Decided 2026-09-04:** migration is a **generic importer** (upload → preview → map columns → save profile → dry run → commit) that works for any source — TradeEzee, Marg, Busy, Tally, FieldAssist, Excel — rather than one connector per ERP. It lands with the integrations module.

## Goal 3 — Provide Real-Time Operational Visibility

Owners should know the current state of orders, deliveries, payments, inventory, warehouse and sales without waiting for end-of-day updates. 

**Success Indicator:** critical operational metrics are available in real time.

**Status: Partial.** Every register is live today — orders, stock, sales, collections, outstanding, trips. **Decided 2026-09-04:** the owner app must carry **graphs wherever possible** (growth, how the distributorship is performing); the chart-ready series and the owner dashboard are served by the reporting module, which is planned, not built.

**What remains:** `reporting.dashboard.owner` and the chart series behind the owner graphs.

## Goal 4 — Improve Operational Efficiency

Reduce the time required to complete routine business activities: order processing, warehouse operations, delivery management, payment reconciliation, inventory tracking. 

**Success Indicator:** common tasks require fewer manual steps and less coordination.

**Status: Addressed.** Invoices are issued automatically at pack rather than typed; orders inside price and credit limits confirm without an approval hop; picking is FEFO by lot; receipts allocate oldest bill first; a repeat order is three taps.

**What remains:** target values. Baselines can only be set from pilot measurements.

## Goal 5 — Improve Inventory Accuracy

Maintain accurate inventory across all warehouses, with batch tracking, expiry tracking, reservations, transfers, adjustments and physical verification. 

**Success Indicator:** inventory reflects actual stock with minimal discrepancies.

**Status: Addressed.** Stock lots carry batch, MRP and expiry; reservations, transfers, adjustments and cycle counts are all built. The stock ledger is append-only and balances are derived from it, so a discrepancy is always explainable.

**Not in v1 (unchanged scope):** racks, bins and barcode scanning. The only scanning in v1 is e-invoice QR verification on a supplier bill.

## Goal 6 — Improve Delivery Performance

Digitize delivery: route management, navigation, delivery confirmation, proof of delivery, payment collection and return handling. 

**Success Indicator:** delivery progress is visible throughout the day.

**Status: Partial.** The delivery module is built and verified (2026-09-05): trips, stops, doorstep deliveries with proof of delivery, partial and failed outcomes, returns, van sales, expenses, GPS tracking and cash settlement with variance control.

**Decided 2026-09-05:** **route sequencing is in v1** — stops ordered by distance and time windows, with the driver free to override. This reverses the earlier "route optimisation is out of scope" position and moves it into the new AI module (module 12); it is not built yet.

**Decided 2026-09-04 (binding on this goal):** **only the delivery crew collects money, or the shop pays online.** The salesperson never records a receipt — the sales service has no receipt endpoint and the permission matrix never grants one. The back office may record a payment received at the desk.

## Goal 7 — Strengthen Financial Control

Provide visibility into customer credit, outstanding payments, collections, cash reconciliation and profitability. 

**Success Indicator:** owners can monitor financial exposure and collections in real time.

**Status: Partial.** Credit limits and checks, outstanding with ageing buckets, collections, cheque lifecycle including bounce and reversal, write-offs and cash settlement variance are all built. Every rupee lands in a double-entry journal that must balance at commit — enforced in the database, not in application code.

**Profitability is deliberately restricted.** Purchase cost, landed cost and margin are readable only by owner, manager, accountant and system roles; salesperson, warehouse, delivery and retailer roles cannot read them. That is a database policy with tests, not an app rule.

**Decided 2026-09-05:** the **accountant is a money desk plus reads** — may record office receipts, deposits, cheque bounces and write-offs, and may read and export everything, but has no access to prices, schemes, credit limits, approvals or settings. This narrows the earlier statement that the accountant handles credit approvals.

**What remains:** the profitability and stock-value registers, which arrive with the reporting module.

## Goal 8 — Empower Mobile Workforce

Field users should complete their responsibilities on their own device.

**Decided 2026-09-04, extended 2026-09-05:** the platform ships **seven apps, one per role** — Owner; Manager (shared with the Accountant); Sales; Warehouse; Delivery; Retailer; and **Platform Admin** for Distribution OS staff. The six role apps are each **web + Android + iOS**; the admin console is web. Each app talks to its own backend service, so a role can only reach the endpoints its service mounts, and a per-endpoint permission matrix decides the rest.

**Status: Partial.** All the backend a phone needs is built, including the offline upload contract. No app screen exists yet.

**Decided 2026-09-04:** the apps are **online-first now, with offline for Sales and Delivery before the pilot**; **English only** for the first release. **Decided 2026-09-05:** the visual layout is **A Ledger**, chosen from four candidate directions; the design system is finalised on it and applies to every app.

**What remains:** every screen. Apps start after the backend is complete.

## Goal 9 — Support Business Growth

The platform should scale with the business: multiple warehouses, delivery vehicles, sales teams, manufacturers and thousands of retailers.

**Status: Partial.** The load model the system is designed and tested against is 10,000 distributors, 100,000 staff devices and 2,000,000 retailers, with 5,000 orders per minute at peak. Every table keys on the distributor, every index leads with it, services are stateless, lists are cursor-paginated with hard caps, and long work goes to a background worker.

**Decided 2026-09-05 — this changes the original goal:** **branches are not modelled in v1.** One tenant is one distributorship, which may have many warehouses, vehicles, teams and manufacturers. **Multi-branch is v2**, where each branch becomes its own tenant with an owner-level group view across them. The earlier "multiple branches" line and the branch-manager persona are deferred with it.

## Goal 10 — Ship AI in v1

**Decided 2026-09-05 — this replaces "AI-Ready Platform":** the AI capabilities are **in v1, before the pilot**, not a future phase.

| Capability | Scope in v1 | Status |
| --- | --- | --- |
| Invoice scanning (supplier bills) | LLM vision extraction, validators, SKU match, human review before commit | In progress (docint, module 5) |
| WhatsApp order capture | Free text parsed into a draft order against the shop's own purchase history — **always human-confirmed** | Planned (ai, module 12) |
| Voice order capture | Speech into the same parser, same human confirmation | Planned (ai, module 12) |
| Demand forecasting / reorder suggestions | Purchase planning support for the back office | Planned (ai, module 12) |
| Route sequencing | Stop order by distance and time windows, driver may override | Planned (ai, module 12) |

**Non-negotiable:** document intake and order parsing **never commit on their own**. A human reviews before goods are received or an order is placed. A general-purpose AI assistant is not in v1 scope.

---

# v1 Scope Decisions — 2026-09-05

| Decision | What it means for the goals |
| --- | --- |
| **All AI features in v1** | Goal 10 is a delivery commitment, not readiness; route sequencing returns to scope (Goal 6) |
| **Platform console in v1** | A seventh app and service for distributor onboarding, plans and subscription state, and time-boxed, owner-approved, audited support access. Revenue stays subscription-only; no fintech |
| **One tenant = one distributorship** | Goal 9 drops "branches" for v1 |
| **Multi-branch in v2** | Each branch its own tenant plus an owner group view — an additive change, not a schema rewrite |
| **Multi-industry positioning, FMCG first** | Pharma, electricals, dairy and agri are addressable markets; the product stays FMCG-shaped until a second-industry customer exists |

---

# Technical Goals

| Goal | Status | Evidence |
| --- | --- | --- |
| Scalability | Addressed | Stateless services, tenant-keyed indexes, cursor pagination, background worker; documented load model |
| Reliability | Addressed | Idempotency key on every mutation, append-only ledgers, transactional outbox |
| Security | Addressed | Argon2id passwords, signed tokens with per-device rotating refresh, lockout, forced row-level security, audit log, per-endpoint permission matrix tested for every endpoint × role. Encryption at rest is a deployment concern |
| Extensibility | Addressed | Contract-first modules with enforced boundaries; a new module adds files, it does not edit others |
| Performance | Partial | Bounded lists and indexes in place; no application performance monitoring yet |
| Availability | Planned | Backup and restore drill scheduled; deployment comes after the pilot build |

---

# Business Goals

Distribution OS aims to help distributors increase operational efficiency, reduce manual effort, improve customer service, increase collection efficiency, improve inventory management, reduce operational errors, support expansion and improve decision making. These are unchanged from version 1.0 and remain the commercial case for the subscription.

---

# User Experience Goals

The platform should be easy to learn, fast to use, mobile friendly, consistent across modules, and usable by non-technical staff. **Decided 2026-09-05:** consistency is now concrete — one design system (layout A Ledger) across all seven apps, English only for the first release, and the distributor's own branding inside every app and document.

---

# Long-Term Goals (5–10 Years)

Distribution OS should evolve into a connected distribution ecosystem supporting manufacturer collaboration, retailer self-service, third-party logistics integration, marketplace capabilities and AI-driven optimisation.

Two corrections to version 1.0:

* **Retailer self-service is not long-term — it is in v1.** The retailer app is in scope now: the shop sees its bills and outstanding, reorders, pays online and tracks delivery, with one card per linked distributor.
* **Financial services integration is removed from the long-term list.** No fintech, no payments aggregation, no lending. Revenue is the distributor's subscription.

---

# Non-Goals (Current Scope)

To maintain focus, these are **not** objectives:

* Consumer e-commerce platform or marketplace for end consumers
* Manufacturing ERP
* Full HR management system
* General-purpose accounting software replacement — the journal and Tally export complement the distributor's accountant, they do not replace them
* **Payments aggregation, lending or any fintech product** (added 2026-09-05)
* **Per-distributor custom roles and configurable approval flows** (added 2026-09-05) — there is one fixed role set with one permission matrix tested endpoint by endpoint; states change only through coded state machines
* **Branch hierarchy** in v1 (added 2026-09-05) — deferred to v2 as tenant-per-branch
* Warehouse racks, bins and barcode scanning
* Re-invoicing a sale already billed in a brand's own DMS — those are imported and linked, never issued a second legal invoice

---

# Success Metrics (KPIs)

Each KPI is annotated with whether the data exists in the system today. Full KPI coverage is in the Success Metrics page; the source assessment is `docs/24` §2.2.

| Area | KPI | Measurable today? | Where the data lives |
| --- | --- | --- | --- |
| Order Processing | Average order processing time | Yes | Order submission, state transitions, invoice issue timestamps |
| Inventory | Inventory accuracy (%) | Yes | Cycle count lines: expected vs counted |
| Deliveries | On-time delivery rate | Yes | Stop ETA vs arrival time |
| Finance | Outstanding collection period | Yes | Allocation date minus invoice date |
| Warehouse | Picking accuracy | Partly | Requested vs picked with short reason; wrong-item picks are not captured |
| Sales | Orders processed per day | Yes | Sales order states |
| Productivity | Orders processed per employee | Yes | Salesperson on each order |
| Customer Service | Average issue resolution time | No | No complaint entity exists; not planned for v1 |
| Platform | Active users per day | Yes | Authentication events and sessions |
| Platform | Monthly recurring revenue (MRR) | Not yet | Plan field only; subscription state arrives with the platform console (v1) |

> **Note:** target values are set after the pilot at Tarsun Enterprises establishes baselines. A KPI without a baseline is a guess.

---

# Alignment with Vision

These goals support becoming the operating system for Indian distributors by connecting every department, eliminating fragmented workflows, giving owners real-time intelligence, scaling from one distributorship to many, and — as of 2026-09-05 — shipping the AI capture, forecasting and routing capabilities in the first release rather than promising them later.

---

# Change Log

| Version | Date | Change |
| --- | --- | --- |
| 1.0 | August 2026 | Original goals document, written before implementation |
| 2.0 | September 2026 | Status, serving module and remaining work added to every goal; Goal 8 restated as seven apps each web + Android + iOS; Goal 9 branches deferred to v2; Goal 10 changed from "AI-ready" to "AI in v1"; platform console added to v1; accountant scope and money-collection rule made explicit; non-goals extended (fintech, custom roles, branches); KPIs annotated with data availability; retailer self-service moved from long-term to v1 |
