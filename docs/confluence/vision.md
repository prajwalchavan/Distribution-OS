# Product Vision

## Document Information

| Property     | Value             |
| ------------ | ----------------- |
| Document     | Product Vision    |
| Product      | Distribution OS   |
| Version      | 2.2               |
| Status       | Active            |
| Owner        | Prajwal Chavan    |
| Last Updated | 29 September 2026 |

The product name is **Distribution OS** (two words).

There is **one app**, named **Distribution OS**, and it becomes the right app for whoever signs in. The six business roles — owner, manager (with the accountant), sales, warehouse, delivery and retailer — share one application, served as one website and one Android app; the iOS app is built from the same code and is not released yet. The role is chosen at sign-in, and the app opens that role's screens and talks to that role's backend service. The internal platform console is a separate application. There is one listing in each store, one install for a distributor's staff, and one front door.

---

# Purpose

This document defines the long-term vision for Distribution OS.

It establishes why the product exists, the business problems it aims to solve, and the future direction of the platform. Every product, engineering, and business decision should align with this vision.

# Vision Statement

> **To build the world's most intelligent Distribution Management Platform that enables distributors of every size to manage their complete business from a single platform through automation, real-time visibility, and AI-driven decision making.**

Distribution OS is designed to become the digital operating system for distributors by connecting manufacturers, distributors, employees, warehouses, delivery operations, retailers, finance, and analytics into one integrated ecosystem.

# Why Distribution OS Exists

Most distributors today operate using a combination of legacy billing software, WhatsApp, phone calls, Excel spreadsheets, paper invoices, manual registers and human memory.

While these tools allow businesses to function, they create operational inefficiencies, duplicate work, delayed decision-making, and limited visibility into day-to-day operations.

Distribution OS exists to replace fragmented workflows with a single, connected platform that supports the entire distribution lifecycle — and, critically, one the **distributor owns** across every brand he carries.

# The Problem We Are Solving

Distributors face several recurring challenges:

- Orders arrive through multiple channels, making them difficult to track.
- Manual data entry consumes significant operational time — on the way **in** (supplier invoices) as much as on the way out.
- Inventory visibility is often delayed or inaccurate.
- Warehouse activities are difficult to monitor.
- Delivery operations depend on paper documents and phone calls.
- Payment collection and outstanding balances lack real-time visibility.
- Managers have limited insight into daily business performance.
- Existing software focuses primarily on billing rather than end-to-end business operations.
- **Brands force their own DMS on the distributor** (the pilot distributor bills one brand inside FieldAssist), so the retailer's true outstanding is split across systems that never talk to each other.

Distribution OS aims to solve these challenges by providing one unified platform for managing distribution operations.

# What Makes Distribution OS Stand Out for Local FMCG Distribution

The category is crowded, but nobody sells the local distributor a system **he** owns across brands at SMB prices. Brand DMS products (Botree, FieldAssist, Shikhar) serve the manufacturer; billing packages (Marg, Vyapar, Busy, TradeEzee) stop at the invoice; marketplaces (Udaan, Jumbotail) compete with the distributor. These seven capabilities are the difference, and **all of them are in v1**.

| #   | Standout capability                                                                                                                                                                                                                                                                | Why it wins locally                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | **Zero-typing document intake** — photograph the supplier bill; e-invoice QR/IRN verification, LLM vision extraction, GST arithmetic and pack-size validators, SKU matching, human review, then a single idempotent goods-receipt commit. The only typing is the blind gate count. | No Indian DMS or billing product reads purchase invoices.                                            |
| 2   | **Brand-DMS coexistence** — bills raised in a brand's own DMS (FieldAssist) are captured and imported as `brand_dms_import` so stock and receivables stay whole. A brand-DMS sale is **never** re-invoiced.                                                                        | The distributor stops keeping two truths. No competitor treats a rival DMS as a first-class input.   |
| 3   | **White-label by default** — each distributor sees their own name and logo in the app and on every printed document; Distribution OS branding appears only on the sign-in screen. The branding is held in the distributor's settings.                                              | The distributor's customers see the distributor, not a vendor. Retailers trust the bill.             |
| 4   | **Field screens that never block** — no sync button, geo-tag as evidence rather than a gate, offline uploads that never answer an error, rejections recorded and shown instead of lost.                                                                                            | Six years of top-voted complaints against field-force apps are exactly these.                        |
| 5   | **AI order capture** — a free-text WhatsApp message or a spoken order becomes a draft order, parsed against that shop's own purchase history, and is **always confirmed by a human** before it is submitted.                                                                       | Shops already order on WhatsApp and by phone. This removes the re-keying without removing the check. |
| 6   | **Demand forecasting and reorder suggestions** for purchase planning.                                                                                                                                                                                                              | Purchase decisions otherwise rest on memory.                                                         |
| 7   | **Route sequencing** — stops ordered by distance and time window, with a driver override, handing off to the phone's own maps app.                                                                                                                                                 | Without it, delivery order is decided on the van.                                                    |

Two further guarantees are structural rather than features, and they matter to the owner more than any screen:

- **Purchase cost, landed cost and margin are unreadable by the salesperson, warehouse, delivery and retailer roles.** This is a database policy with tests, not an application rule.
- **The salesperson never records a receipt.** Only the delivery crew at the door, the shop paying online, or the back office at the desk may take money.

# Product Philosophy

The design of Distribution OS is guided by the following principles.

### Business First

Business processes should drive technology decisions.

### Single Source of Truth

Operational data should exist only once and be shared across all modules. Stock and money live in append-only ledgers; balances are derived, never edited.

### Mobile First

Field users should be able to perform every essential business activity from a mobile device. Every role's full job is on the phone as well as on the web: the product is one website and one Android app, and the iOS app is built from the same code and is not released yet. The six business roles share **one** app that becomes the right app after sign-in.

### Real-Time Visibility

Business owners should have immediate access to operational information without waiting for end-of-day reports. The owner's screens lead with graphs — growth and performance — not tables alone.

### Automation by Default

Manual processes should be replaced with intelligent workflows wherever possible — but a workflow that moves stock or money always ends at a human confirmation.

### AI in the Product, Not "AI Ready"

The AI capabilities below are part of v1:

- WhatsApp free-text order capture (human-confirmed)
- Voice order capture (same parser, human-confirmed)
- Document vision extraction for supplier invoices
- Demand forecasting and reorder suggestions
- Delivery route sequencing

Sales recommendations, credit-risk scoring and a conversational assistant are **not** in v1; they come after version 1.

# Long-Term Product Vision

Distribution OS evolves across the stages below. Stages 1 to 4, plus the AI capabilities listed above, are all v1.

| Stage                          | Scope                                                                                                                                                                                                                                        | Timing                                            |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 1 — Distribution Management    | Sales, purchase, inventory, warehouse, delivery, payments, GST billing, receivables and the double-entry journal                                                                                                                             | v1                                                |
| 2 — Connected Workforce        | One app for owner, manager and accountant, sales representatives, warehouse operators and delivery executives                                                                                                                                | v1                                                |
| 3 — Connected Retail Network   | Retailers browse products, **place orders**, track deliveries, view outstanding balances, download invoices and **pay online**; one retailer login can be linked to several distributors, one card each                                      | v1                                                |
| 4 — Platform Console           | "Distribution OS - Admin", a separate application for Distribution OS staff, one codebase for web, Android and iOS like the rest: distributor onboarding, plans and subscription state, time-boxed and owner-approved audited support access | v1                                                |
| 5 — Manufacturer Collaboration | Manufacturer visibility into distributor sales, stock levels, market demand, secondary sales and scheme performance                                                                                                                          | After version 1                                   |
| 6 — Deeper Intelligence        | Inventory optimisation, credit-risk analysis, prescriptive insights, conversational assistant                                                                                                                                                | After version 1, built on the data v1 accumulates |

---

# Target Industries

**The positioning is multi-industry, with FMCG first.** The product is deliberately FMCG-shaped — batch, expiry, case-and-piece quantities, schemes and claims, beat plans — and the other industries are later markets.

**First market (v1):** FMCG — packaged foods, beverages, bottled water, bakery, chocolates and confectionery, household products, personal care.

**Adjacent markets, after FMCG:**

- Dairy, frozen foods and ice cream — the same batch-and-expiry model, with cold-chain fields added
- Electrical goods and consumer durables — serial numbers and warranty tracking would be new
- Agricultural products; pharmaceuticals is the most demanding (schedule drugs, licence numbers, stricter traceability)

The platform stays configurable enough to support additional industries without re-architecture; industry-specific features for them are not available yet.

---

# Target Customers

The platform is designed for organisations ranging from small distributors to large multi-branch enterprises.

### Small Distributor

- Single warehouse, small team, basic operational requirements

### Growing Distributor

- Multiple sales representatives, larger inventory, delivery management, multiple vehicles

### Enterprise Distributor

- Multiple warehouses, hundreds of employees, high transaction volumes, advanced analytics, integration with external systems
- In v1, **one tenant is one distributorship**; there is no branch-level hierarchy. Multi-branch support comes after version 1: each branch is its own tenant, with a group view for the owner.

### Pilot customer

Tarsun Enterprises, Kalyan West — a working FMCG distributorship that came to the product from TradeEzee billing, with one brand (Too Yumm) mandated onto FieldAssist DMS, carrying Campa and MOM alongside. The pilot is the design constraint, not an afterthought.

---

# Success Metrics

Success is measured by the ability to improve operational efficiency and business visibility. Detailed, measurable definitions live on the **Success Metrics** page; the objectives here are the direction those metrics serve.

- Reduce manual order-entry effort, inbound and outbound
- Increase order processing speed
- Improve inventory accuracy
- Improve on-time delivery rates
- Reduce payment collection delays
- Improve order tracking
- Increase customer satisfaction
- Provide real-time business dashboards

**Conversion criteria.** A distributor is expected to pay when three things are visibly true:

1. Inbound stock enters by photograph with no typing except the blind gate count.
2. The physical pending-bills file is on his phone — per-retailer ledger, ageing buckets, his own UPI QR on every bill, WhatsApp reminders with the PDF.
3. His chartered accountant receives Tally XML that imports cleanly, unasked.

Everything else is retention.

---

# What Distribution OS Is Not

Distribution OS is not intended to be:

- A simple billing application
- Only an inventory management tool
- Only a CRM
- Only a warehouse system
- Only an accounting package — the journal and Tally export **complement** the distributor's accountant, they never replace him
- A brand DMS — those serve the manufacturer; Distribution OS serves the distributor and coexists with them
- A marketplace — it never competes with the distributor for his retailers
- A payments business — **no aggregation, wallet, lending or BNPL**. Revenue is the distributor's subscription. Collections use the distributor's own UPI VPA.

Two further boundaries are worth stating:

- **Roles and permissions are not customisable per organisation.** There is one fixed permission matrix, tested for every endpoint against every role.
- **Business states are not configurable.** Order, trip, stop and invoice states change only through coded state machines.

---

# Strategic Design Principles

Every architectural and product decision should align with these principles:

1. Multi-tenant SaaS architecture — one tenant per distributorship, isolated in the database itself by row-level security, not by application code.
2. Modular design based on business domains, with enforced module boundaries.
3. API-first development: the contract is declared once and both the services and the apps are generated against it.
4. Security and privacy by design — sign-in is a username and a password on the product's own token service (one-time passcodes are not available yet, and when added they sit on top of the password rather than replacing it); role election at sign-in goes downward only; a per-endpoint permission matrix that fails closed; cost data invisible to field roles as a database guarantee.
5. Mobile-first experience for field users; one app, on the web and on Android, which becomes the right app for the role that signs in, on one layout, A Ledger.
6. Cloud-native deployment, built for lakhs of users from day one: independently running services on one PostgreSQL 17 database with forced row-level security, hosted on Oracle Cloud in Mumbai, with the website on Cloudflare Pages at `www.distributionos.in`.
7. Extensible integration framework — data migration is a generic importer (upload, preview, map columns, save profile, dry run, commit) for any source, rather than per-vendor readers.
8. Event-driven business workflows where appropriate.
9. Complete auditability: append-only stock and money ledgers, every mutation idempotent, an issued invoice never edited.
10. Design for long-term scalability rather than short-term convenience.
11. **White-label** — the distributor's identity, never ours, inside the product and on every document.
12. **English** — the app is in English; translation keys exist from day one so other languages are a data change, not a rewrite.

---

# Vision Summary

Distribution OS aims to become the digital operating system for distribution businesses by replacing disconnected tools with an integrated platform that connects people, processes, inventory, logistics, finance, and intelligence.

The near-term objective is narrower and sharper than the long-term one: **win the local FMCG distributor by removing the typing on the way in, making his outstanding whole across every brand he carries — including the brands that force their own DMS on him — and putting his business on his own phone under his own name.** The long-term objective is to build a scalable, cloud-native platform capable of serving distributors of all sizes across several industries, with the flexibility to expand into manufacturer collaboration, retailer engagement, and AI-driven business optimisation.
