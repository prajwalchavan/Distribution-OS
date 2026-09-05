# Product Vision

## Document Information

| Property | Value |
| --- | --- |
| Document | Product Vision |
| Product | Distribution OS |
| Version | 2.0 |
| Status | Active |
| Owner | Product Management |
| Last Updated | September 2026 |

**Decided 2026-09-05:** the product name is **Distribution OS** (two words). The role apps are named "Distribution OS - Owner", "Distribution OS - Manager", "Distribution OS - Sales", "Distribution OS - Warehouse", "Distribution OS - Delivery", "Distribution OS - Retailer". Earlier drafts of this space used "DistributionOS".

---

# Purpose

This document defines the long-term vision for Distribution OS.

It establishes why the product exists, the business problems it aims to solve, and the future direction of the platform. Every product, engineering, and business decision should align with this vision.

**Decided 2026-09-05:** `docs/22-source-of-truth.md` in the repository is the single source of truth for product shape and founder decisions. This space mirrors it. Where the two disagree, docs/22 wins and this page is corrected.

---

# Vision Statement

> **To build the world's most intelligent Distribution Management Platform that enables distributors of every size to manage their complete business from a single platform through automation, real-time visibility, and AI-driven decision making.**

Distribution OS is designed to become the digital operating system for distributors by connecting manufacturers, distributors, employees, warehouses, delivery operations, retailers, finance, and analytics into one integrated ecosystem.

---

# Why Distribution OS Exists

Most distributors today operate using a combination of legacy billing software, WhatsApp, phone calls, Excel spreadsheets, paper invoices, manual registers and human memory.

While these tools allow businesses to function, they create operational inefficiencies, duplicate work, delayed decision-making, and limited visibility into day-to-day operations.

Distribution OS exists to replace fragmented workflows with a single, connected platform that supports the entire distribution lifecycle — and, critically, one the **distributor owns** across every brand he carries.

---

# The Problem We Are Solving

Distributors face several recurring challenges:

* Orders arrive through multiple channels, making them difficult to track.
* Manual data entry consumes significant operational time — on the way **in** (supplier invoices) as much as on the way out.
* Inventory visibility is often delayed or inaccurate.
* Warehouse activities are difficult to monitor.
* Delivery operations depend on paper documents and phone calls.
* Payment collection and outstanding balances lack real-time visibility.
* Managers have limited insight into daily business performance.
* Existing software focuses primarily on billing rather than end-to-end business operations.
* **Brands force their own DMS on the distributor** (the pilot distributor bills one brand inside FieldAssist), so the retailer's true outstanding is split across systems that never talk to each other.

Distribution OS aims to solve these challenges by providing one unified platform for managing distribution operations.

---

# What Makes Distribution OS Stand Out for Local FMCG Distribution

The category is crowded, but nobody sells the local distributor a system **he** owns across brands at SMB prices. Brand DMS products (Botree, FieldAssist, Shikhar) serve the manufacturer; billing packages (Marg, Vyapar, Busy, TradeEzee) stop at the invoice; marketplaces (Udaan, Jumbotail) compete with the distributor. These seven capabilities are the difference, and **all of them are in v1 (decided 2026-09-05)**.

| # | Standout capability | Why it wins locally | Status |
| --- | --- | --- | --- |
| 1 | **Zero-typing document intake** — photograph the supplier bill; e-invoice QR/IRN verification, LLM vision extraction, GST arithmetic and pack-size validators, SKU matching, human review, then a single idempotent goods-receipt commit. The only typing is the blind gate count. | No Indian DMS or billing product reads purchase invoices. This is the capability the pilot customer converts on. | Contract and database built; extraction module in build |
| 2 | **Brand-DMS coexistence** — bills raised in a brand's own DMS (FieldAssist) are captured and imported as `brand_dms_import` so stock and receivables stay whole. A brand-DMS sale is **never** re-invoiced. | The distributor stops keeping two truths. No competitor treats a rival DMS as a first-class input. | Flow decided and enforced as a non-negotiable |
| 3 | **White-label by default** — each distributor sees their own name and logo in the apps and on every printed document; Distribution OS branding appears only on the sign-in screen. Decided 2026-09-04. | The distributor's customers see the distributor, not a vendor. Retailers trust the bill. | Branding keys in tenant settings |
| 4 | **Field apps that never block** — no sync button, geo-tag as evidence rather than a gate, offline uploads that never answer an error, rejections recorded and shown instead of lost. | Six years of top-voted complaints against field-force apps are exactly these. | Offline contract built; **offline for sales and delivery before the pilot** (decided 2026-09-04) |
| 5 | **AI order capture** — a free-text WhatsApp message or a spoken order becomes a draft order, parsed against that shop's own purchase history, and is **always confirmed by a human** before it is submitted. | Shops already order on WhatsApp and by phone. This removes the re-keying without removing the check. | v1, decided 2026-09-05 |
| 6 | **Demand forecasting and reorder suggestions** for purchase planning. | Purchase decisions today rest on memory. | v1, decided 2026-09-05 |
| 7 | **Route sequencing** — stops ordered by distance and time window, with a driver override, handing off to the phone's own maps app. | Delivery order is currently decided on the van. | v1, decided 2026-09-05 (this reverses the earlier "route optimisation: do not build" position) |

Two further guarantees are structural rather than features, and they matter to the owner more than any screen:

* **Purchase cost, landed cost and margin are unreadable by the salesperson, warehouse, delivery and retailer roles.** This is a database policy with tests, not an application rule.
* **The salesperson never records a receipt.** Only the delivery crew at the door, the shop paying online, or the back office at the desk may take money. Decided 2026-09-04.

---

# Product Philosophy

The design of Distribution OS is guided by the following principles.

### Business First

Business processes should drive technology decisions.

### Single Source of Truth

Operational data should exist only once and be shared across all modules. Stock and money live in append-only ledgers; balances are derived, never edited.

### Mobile First

Field users should be able to perform every essential business activity from a mobile device. **Decided 2026-09-04:** every role gets its own app, and every app ships on **web, Android and iOS** — this replaces the earlier "web for managers, mobile for field" split.

### Real-Time Visibility

Business owners should have immediate access to operational information without waiting for end-of-day reports. **Decided 2026-09-04:** the owner app leads with graphs — growth and performance — not tables alone.

### Automation by Default

Manual processes should be replaced with intelligent workflows wherever possible — but a workflow that moves stock or money always ends at a human confirmation.

### AI in the Product, Not "AI Ready"

**Decided 2026-09-05:** the AI capabilities below are in v1, before the pilot, rather than a later stage:

* WhatsApp free-text order capture (human-confirmed)
* Voice order capture (same parser, human-confirmed)
* Document vision extraction for supplier invoices
* Demand forecasting and reorder suggestions
* Delivery route sequencing

Sales recommendations, credit-risk scoring and a conversational assistant remain later-stage ambitions and are **not** in v1.

---

# Long-Term Product Vision

Distribution OS evolves across the stages below. **Decided 2026-09-05:** stages 1 to 3, plus the AI capabilities from stage 5 listed above, are all v1 — the retailer network is no longer a later stage.

## Stage 1 — Distribution Management (v1)

Sales, purchase, inventory, warehouse, delivery, payments, GST billing, receivables and the double-entry journal.

## Stage 2 — Connected Workforce (v1)

Applications for owner, manager and accountant, sales representatives, warehouse operators and delivery executives.

## Stage 3 — Connected Retail Network (v1, previously "future")

Retailers browse products, **place orders**, track deliveries, view outstanding balances, download invoices and **pay online**. One retailer login can be linked to several distributors, one card each.

## Stage 4 — Platform Console (v1, new)

**Decided 2026-09-05:** a seventh application, "Distribution OS - Admin" (web only, for Distribution OS staff), handles distributor onboarding, plans and subscription state, and time-boxed, owner-approved, audited support access.

## Stage 5 — Manufacturer Collaboration (future)

Manufacturers gain visibility into distributor sales, stock levels, market demand, secondary sales and scheme performance. Not in v1 and not scheduled.

## Stage 6 — Deeper Intelligence (future)

Inventory optimisation, credit-risk analysis, prescriptive business insights and a conversational assistant, built on the operating data v1 accumulates.

---

# Target Industries

**Decided 2026-09-05: the positioning stays multi-industry, with FMCG first.** The product is deliberately FMCG-shaped today — batch, expiry, case-and-piece quantities, schemes and claims, beat plans — and will stay so until a customer in a second industry is signed. Adjacent markets are a sequencing decision, not a hedge.

**First market (v1):**

* FMCG — packaged foods, beverages, bottled water, bakery, chocolates and confectionery, household products, personal care

**Adjacent markets (after the first FMCG customers are live):**

* Dairy, frozen foods and ice cream — the same batch-and-expiry model, with cold-chain fields added
* Electrical goods and consumer durables — serial numbers and warranty tracking would be new
* Agricultural products
* Pharmaceuticals — the most demanding: schedule drugs, licence numbers and stricter traceability

The platform stays configurable enough to support additional industries without re-architecture, but **no industry-specific work is scheduled before FMCG is proven in the pilot**.

---

# Target Customers

The platform is designed for organisations ranging from small distributors to large multi-branch enterprises.

### Small Distributor

* Single warehouse, small team, basic operational requirements

### Growing Distributor

* Multiple sales representatives, larger inventory, delivery management, multiple vehicles

### Enterprise Distributor

* Multiple warehouses, hundreds of employees, high transaction volumes, advanced analytics, integration with external systems
* **Decided 2026-09-05:** for the pilot and v1, **one tenant is one distributorship**. Multi-branch support is v2, where each branch is its own tenant with a group view for the owner. Confluence pages that promised branch-level hierarchy in v1 are corrected by this decision.

### Pilot customer

Tarsun Enterprises, Kalyan West — a working FMCG distributorship billing today on TradeEzee, with one brand (Too Yumm) mandated onto FieldAssist DMS, carrying Campa and MOM alongside, and roughly 36 shops in the demonstration data. The pilot is the design constraint, not an afterthought.

---

# Success Metrics

Success is measured by the ability to improve operational efficiency and business visibility. Detailed, measurable definitions live on the **Success Metrics** page; the objectives here are the direction those metrics serve.

* Reduce manual order-entry effort, inbound and outbound
* Increase order processing speed
* Improve inventory accuracy
* Improve on-time delivery rates
* Reduce payment collection delays
* Improve order tracking
* Increase customer satisfaction
* Provide real-time business dashboards

**Pilot conversion criteria.** The pilot distributor is expected to pay when three things are visibly true within two weeks of a parallel run:

1. Inbound stock enters by photograph with no typing except the blind gate count.
2. The physical pending-bills file is on his phone — per-retailer ledger, ageing buckets, his own UPI QR on every bill, WhatsApp reminders with the PDF.
3. His chartered accountant receives Tally XML that imports cleanly, unasked.

Everything else is retention and is sequenced behind these three.

---

# What Distribution OS Is Not

Distribution OS is not intended to be:

* A simple billing application
* Only an inventory management tool
* Only a CRM
* Only a warehouse system
* Only an accounting package — the journal and Tally export **complement** the distributor's accountant, they never replace him
* A brand DMS — those serve the manufacturer; Distribution OS serves the distributor and coexists with them
* A marketplace — it never competes with the distributor for his retailers
* A payments business — **no aggregation, wallet, lending or BNPL**. Revenue is the distributor's subscription. Collections use the distributor's own UPI VPA. Decided 2026-08, unchanged.

Two further boundaries are worth stating because earlier drafts implied otherwise:

* **Roles and permissions are not customisable per organisation.** There is one fixed permission matrix, tested for every endpoint against every role. Decided 2026-09-04.
* **Business states are not configurable.** Order, trip, stop and invoice states change only through coded state machines.

---

# Strategic Design Principles

Every architectural and product decision should align with these principles:

1. Multi-tenant SaaS architecture — one tenant per distributorship, isolated in the database itself by row-level security, not by application code.
2. Modular design based on business domains, with enforced module boundaries.
3. API-first development: the contract is declared once and both the services and the apps are generated against it.
4. Security and privacy by design — per-endpoint permission matrix that fails closed, cost data invisible to field roles as a database guarantee.
5. Mobile-first experience for field users; every role app on web, Android and iOS.
6. Cloud-native deployment, built for lakhs of users from day one.
7. Extensible integration framework — **decided 2026-09-04:** data migration is a generic importer (upload, preview, map columns, save profile, dry run, commit) for any source, rather than per-vendor readers.
8. Event-driven business workflows where appropriate.
9. Complete auditability: append-only stock and money ledgers, every mutation idempotent, an issued invoice never edited.
10. Design for long-term scalability rather than short-term convenience.
11. **White-label** — the distributor's identity, never ours, inside the product and on every document.
12. **English only for now** (decided 2026-09-04); translation keys exist from day one so other languages are a data change, not a rewrite.

---

# Where the Vision Stands Today

Honest status as of **5 September 2026**, from `docs/18-build-log.md`:

| Area | Status |
| --- | --- |
| Backend | 13 of 19 modules verified on one Postgres database with forced row-level security — 1254 tests, 844 live endpoint calls, 0 broken. The delivery module cleared its gate the same day. |
| Authentication | Built: username and password with our own token service. **OTP is a later layer on top, not a replacement** (decided 2026-09-04). |
| Remaining backend | Document intake, integrations, claims, notifications, reporting, incentives; then the AI module and the platform console. |
| Applications | **No screen is built yet.** Backend first was a deliberate decision (2026-09-04). The visual layout was chosen on 2026-09-05 (direction "A Ledger") and applies to all apps. |
| Deployment | Local database with demonstration data first; hosting comes after the apps. |
| Demonstration data | Three distributors, staff under each, and shops linked to more than one distributor — so multi-tenancy is proven with data, not asserted. |

---

# Vision Summary

Distribution OS aims to become the digital operating system for distribution businesses by replacing disconnected tools with an integrated platform that connects people, processes, inventory, logistics, finance, and intelligence.

The near-term objective is narrower and sharper than the long-term one: **win the local FMCG distributor by removing the typing on the way in, making his outstanding whole across every brand he carries — including the brands that force their own DMS on him — and putting his business on his own phone under his own name.** The long-term objective is to build a scalable, cloud-native platform capable of serving distributors of all sizes across several industries, with the flexibility to expand into manufacturer collaboration, retailer engagement, and AI-powered business optimisation.
