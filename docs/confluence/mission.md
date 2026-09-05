# Product Mission

## Document Information

| Property     | Value              |
| ------------ | ------------------ |
| Document     | Product Mission    |
| Product      | Distribution OS    |
| Version      | 2.0                |
| Status       | Active             |
| Last Updated | September 2026     |
| Owner        | Product Management |

---

# Purpose

This document defines the mission of Distribution OS.

While the vision describes the long-term destination, the mission explains the platform's day-to-day purpose and the value it delivers to distributors.

It serves as a guiding principle for product decisions, engineering priorities, customer interactions, and future innovation.

Version 2.0 rewrites the August 2026 draft against the product as decided and built. Where a statement changed, the sentence says so and carries the date of the decision. The repository file `docs/22-source-of-truth.md` is the single source of truth; this page mirrors it.

---

# Mission Statement

> **To simplify and modernize distribution businesses by providing a unified, intelligent, and scalable platform that digitizes operations, improves visibility, automates repetitive work, and empowers every stakeholder across the distribution ecosystem.**

The mission statement is unchanged from version 1.0. What changed is our account of how it is delivered: **one app per role**, a single order-to-cash loop that every app works on, and ledgers that make every rupee and every piece of stock traceable.

---

# Our Mission

Distribution OS exists to help distributors move beyond disconnected tools and manual processes by providing a single platform that supports their complete operational lifecycle.

We aim to enable businesses to:

- Operate efficiently with connected workflows.
- Reduce manual effort and operational errors.
- Gain real-time visibility into business performance.
- Improve collaboration across teams.
- Make faster, data-driven decisions.
- Scale confidently as their business grows.

The unit of sale and the unit of isolation is the **distributorship**. Decided 2026-09-05: one tenant is one distributorship for the pilot and v1; multi-branch operation is a v2 capability where each branch is its own tenant with an owner group view. Version 1.0 assumed branches inside one business; there is no branch entity in the product today.

---

# Who We Serve

Distribution OS is built for every participant in the distribution ecosystem. Decided 2026-09-04: **every role gets its own app**, and the manager and the accountant share one. Decided 2026-09-05: a seventh application, the platform console, serves Distribution OS staff. Each app is delivered on web, Android and iOS; the admin console is web only.

| #   | Application                 | Who signs in          | Day-to-day value                                                                                            |
| --- | --------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | Distribution OS - Owner     | Owner                 | Knows the day before the day ends; clears approvals in seconds; sets prices, schemes and credit             |
| 2   | Distribution OS - Manager   | Manager, Accountant   | Runs the desk: order queue, goods received, billing, load-out approval, day-end, registers, Tally export    |
| 3   | Distribution OS - Sales     | Salesperson           | Ninety seconds in a doorway: a repeat order in three taps, priced and credit-checked before it is submitted |
| 4   | Distribution OS - Warehouse | Warehouse staff       | Counts, picks, packs and loads without typing; the invoice comes out of the pack                            |
| 5   | Distribution OS - Delivery  | Delivery crew         | One-handed trip screen; proof of delivery and money collected at the door                                   |
| 6   | Distribution OS - Retailer  | Retailer              | One login across every distributor they buy from: bills, outstanding, reorder, pay online, track delivery   |
| 7   | Distribution OS - Admin     | Distribution OS staff | Onboards distributors, holds plans and subscription state, grants time-boxed audited support access         |

Three persona corrections against version 1.0:

- **Sales Manager, Warehouse Manager, Delivery Manager and Data Entry Operator do not get apps.** Decided 2026-09-04: the first three are the `manager` role in the manager app; the fourth is designed away, because orders arrive from the rep or the shop and the invoice is derived from the pack rather than re-keyed.
- **The Retailer is not a future persona.** Decided 2026-09-04 the retailer gets an app of their own; **decided 2026-09-05** that the retailer may place orders, not only view them.
- **The Super Administrator now has a product.** Decided 2026-09-05: the platform console is in v1. Until then, tenants existed only through seed scripts.

The **Manufacturer** remains a future persona. No manufacturer surface is planned for v1.

---

# The Mission in a Day

The test of this mission is not a feature list; it is whether each person's day gets shorter and more certain.

### Owner

Opens to the day's numbers with graphs — collections, cash in transit, outstanding by ageing bucket, orders dispatched and delivered, stock at risk, trips running. Approvals sit in one tray: price variance, credit, minimum order value, bargains. Decided 2026-09-04: the owner app must carry graphs wherever possible, because growth and performance are the reason an owner opens a phone at all. The owner and the money desk are also the only roles that may see purchase cost and margin.

### Manager

Works a keyboard loop: the submitted-order queue, goods-received review, the billing desk, load-out approval, day-end, registers, Tally export. Decided 2026-09-05: the manager approves the load sheet **from the manager app**, on their own phone or desk, and the warehouse device waits for that approval — the approving PIN is no longer typed on the warehouse phone.

### Accountant

Shares the manager app. Decided 2026-09-05: the accountant's scope is **the money desk plus reads** — office receipts, bank deposits, cheque bounces, write-offs, and exports of everything. The accountant does not set prices, schemes or credit limits, does not approve orders, and does not change settings. Version 1.0 listed credit approvals under this persona; that is superseded.

### Salesperson

Beat for the day, check-in at the shop with a geo-tag that is evidence and never a block, then the order: reorder the last one, take the suggestion, or work the grid in cases and pieces with a live availability hint. Price and credit are checked before submission; inside the limits the order confirms itself, outside them it becomes an approval. Two rules define this role: **the salesperson never sees purchase cost or margin**, and, decided 2026-09-04, **the salesperson never collects money**. They can see what a shop owes; they cannot record a rupee against it.

### Warehouse

Puts it down and picks it up. A blind gate count on inbound, then the supplier bill is photographed rather than typed. Outbound: a picklist consolidated by SKU with the oldest-expiry lots first, a pack per order, and the GST invoice issued at pack, on the distributor's own name, logo and number series. Short packs are recorded as pack rows, never as edits to the order.

### Delivery crew

A single stack that opens on the next stop, designed for one hand because the other is holding cash. Delivered, partial with a per-line reason, or failed with a reason and stock still on the vehicle. Decided 2026-09-04: **money is collected here, or the shop pays online — nowhere else in the field.** At check-in the unsold stock is counted back and the cash is settled; a variance beyond the owner's tolerance blocks the trip from closing.

### Retailer

One login, one card per linked distributor. Bills, outstanding, an order in two taps, online payment against their own bills, and delivery tracking that shows an ETA and never a coordinate. A shop can be linked to several distributors and still sees only its own rows.

### Platform staff

Decided 2026-09-05: onboarding a new distributor, plan and subscription state, and support access that is time-boxed, approved by the owner, and written to the audit log.

---

# The Loop Every Order Travels

One loop connects all six role apps. Everything else in the product exists to serve it.

1. **Captured** — by the rep in the shop, by the shop in the retailer app, or from free text on WhatsApp or by voice. Decided 2026-09-05: WhatsApp and voice capture are in v1, and the parsed result is **always confirmed by a human** before it becomes an order.
2. **Priced and credit-checked at capture.** Inside the limits it confirms; a bargain or an over-limit order raises an approval for the owner.
3. **Confirmed** — the server re-prices at the same rule version and reserves stock.
4. **Picked and packed** — oldest expiry first; the GST invoice is issued at pack in the distributor's own series.
5. **Loaded and dispatched** — the manager approves the load sheet, the crew count is confirmed, and stock moves from warehouse to vehicle.
6. **Delivered** — in full, in part (the shortfall becomes a credit note), or failed with a reason.
7. **Collected** — cash, UPI with its reference, or cheque at the door; or the shop pays online; or the desk records an office payment.
8. **Settled** — the receipt is allocated to the oldest bill first, the double-entry journal must balance before it commits, and outstanding and ageing move the same moment.
9. **Closed** — trip check-in counts stock back and reconciles cash; day-end at the manager desk produces the registers, deposits and the Tally export.

Inbound stock has its own loop, and its promise is **zero typing except the blind gate count**: verify the bill's QR where it exists, extract every page, run GST and completeness validators, match to SKUs, and put a human in front of the result before any goods-received entry is committed.

---

# Our Commitments

We are committed to building a platform that is:

### Simple

Business software should be intuitive and easy to adopt. Decided 2026-09-04: English only for now, one visual system across all six apps, and phone screens sized for a doorway rather than a desk.

### Reliable

Critical business operations should be dependable and consistently available. Stock and money ledgers are append-only, balances are derived, every mutation carries an idempotency key, and an issued invoice is never edited — corrections are credit or debit notes.

### Available in the field

Decided 2026-09-04: the platform is **online-first now, with offline capability for the sales and delivery apps before the pilot**. An offline upload never returns an error to the device; rejections are recorded and shown back, never lost.

### Scalable

The platform should support businesses as they grow. It is built for lakhs of users from day one: stateless services behind a load balancer, one database, tenant isolation enforced by the database itself.

### Secure

Customer data should be protected through strong security and access controls. Decided 2026-09-04: sign-in is **username and password on our own token service**, with one-time passcodes as a later layer rather than a replacement. Every endpoint has a row in a permission matrix that is tested for every role, and purchase cost is unreadable by the sales, warehouse, delivery and retailer roles as a database rule, not an application rule.

### Configurable

Businesses should adapt the product to their operation without custom development — within a boundary we state openly. **Configurable:** branding, invoice number series, credit modes and limits, schemes and price lists, settlement tolerance, proof-of-delivery policy, feature flags. **Fixed:** the order, trip and invoice state machines, the set of roles, the approval kinds, and the permission matrix. Version 1.0 implied per-organisation custom roles; that is not built and is not planned.

### Intelligent

Decided 2026-09-05: **all AI features are in v1, before the pilot** — WhatsApp and voice order capture, demand forecasting and reorder suggestions for purchase planning, and route sequencing that the driver may override. Every one of them proposes; a person decides. This supersedes the earlier plan to defer routing and AI capture until after the pilot.

### White-labelled

Decided 2026-09-04: the distributor's own name and logo appear inside the apps and on every printed document. The product brand appears on the sign-in screen and in the store listing, and nowhere else.

---

# Core Values

- **Customer-Centric** — product decisions begin with a real business problem, validated with the pilot distributor.
- **Business-Driven** — technology exists to support business outcomes, not to add complexity.
- **Simplicity** — complex processes are made easier by design, not by training.
- **Transparency** — accurate, real-time information; anything derived is computed, never stored stale.
- **Continuous Improvement** — the product improves from field feedback and operating data.
- **Innovation with Purpose** — new technology is adopted when it removes work a person is doing by hand.

---

# How We Deliver the Mission

Distribution OS fulfills its mission by providing:

- End-to-end distribution management on one order-to-cash loop.
- Six role applications plus a platform console, each on web, Android and iOS (console on web).
- One backend service per application, so a role can only reach the endpoints its own service serves.
- Real-time registers today and chart-ready dashboards for the owner as reporting lands.
- Workflow automation where the rule is unambiguous: auto-confirmation inside limits, oldest-expiry picking, oldest-bill allocation.
- Role-based access enforced at the endpoint and again in the database.
- Cloud-ready, stateless scalability on a single tenant-isolated database.
- Coexistence with what the distributor already runs: a generic importer for any source, and brand-DMS bills captured and linked rather than re-invoiced.

Decided 2026-09-05: positioning stays **multi-industry with FMCG first** — pharma, electricals, dairy and agri are addressable markets, while the product stays FMCG-shaped until a customer in a second industry exists.

---

# Mission in Practice

Every new feature should support at least one of the following outcomes:

- Simplify business operations.
- Reduce manual work.
- Improve operational visibility.
- Increase business efficiency.
- Strengthen collaboration.
- Support business growth.
- Enhance customer experience.
- Enable better decision-making.

If a proposed feature does not contribute to these outcomes, its priority should be reconsidered.

### What the mission does not include

Stating the boundary is part of the mission. We will not build payments aggregation, lending or any other fintech product; revenue is the distributor's subscription. We will not issue a second legal invoice for a sale a brand's own system has already billed. We will not let a document-intake pipeline commit stock without a human review. We will not let any role but the money desk and the delivery crew record a receipt. And we will not show one tenant another tenant's data — a shop linked to three distributors sees three separate ledgers.

---

# Where the Mission Stands Today

Honest status as of 5 September 2026, from the build log:

- **Backend:** As at 2026-09-05 13:45 IST: **14 backend modules verified, 1,442 automated tests, 1,004 endpoint calls exercised, 0 broken** (Build Status & Roadmap mirrors `docs/18-build-log.md`). Modules for document intake, integrations, claims, notifications, reporting, incentives, the AI module and the platform console are in progress or queued.
- **Applications:** no app screen is built yet. The founder's sequence is backend first, then the six apps one at a time. The screen inventory (26 owner, 21 manager, 14 sales, 12 warehouse, 12 delivery, 13 retailer) and the visual system are settled.
- **Reporting and graphs:** registers are live; the owner dashboard and chart series are planned, not built.
- **AI features:** decided for v1 on 2026-09-05; not yet built.
- **Pilot:** Tarsun Enterprises, Kalyan West. Demo data will cover three distributors, staff under each, and shops linked to more than one distributor.

---

# Sources

| Statement area                          | Source in the repository                 |
| --------------------------------------- | ---------------------------------------- |
| Apps, roles, services, dated decisions  | `docs/22-source-of-truth.md` §2, §8, §9  |
| Order-to-cash and inbound stock loops   | `docs/22-source-of-truth.md` §4, §5, §6  |
| Sign-in and permissions                 | `docs/22-source-of-truth.md` §7          |
| Per-app screens and value               | `docs/23-app-screens-and-api-gaps.md`    |
| Persona corrections against version 1.0 | `docs/24-confluence-alignment.md` §3, §6 |
| Build status and numbers                | `docs/18-build-log.md`                   |
