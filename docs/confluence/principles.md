# Product Principles

## Document Information

| Property     | Value              |
| ------------ | ------------------ |
| Document     | Product Principles |
| Product      | Distribution OS    |
| Version      | 2.0                |
| Status       | Active             |
| Owner        | Product Management |
| Last Updated | September 2026     |

---

# Purpose

This document defines the core principles that guide every product, business, architecture, and engineering decision within Distribution OS. They keep the product consistent as features, integrations and customers are added; every proposal, technical decision and roadmap discussion is evaluated against them.

Version 2.0 keeps the twenty principles of the August 2026 draft and states, for each one, how it is actually enforced in the build. Where a principle changed, the sentence says so and carries the date of the decision. Principle 8 was rewritten in full. A new section, **Non-negotiables**, was added: those rules override any principle, including this page.

The repository file `docs/22-source-of-truth.md` is the single source of truth. This page mirrors it; where the two disagree, the repository wins.

---

# Product Philosophy

Distribution OS is not being built as a billing application. It is built as a **Distribution Operating System** — the central system through which a distributor runs every part of the business, and every module should contribute toward that objective. The product is positioned as **multi-industry with FMCG first** (Decided 2026-09-05): pharma, electricals, dairy and agri are named markets, but the product stays FMCG-shaped until a customer from a second industry exists. Principles are written to survive that widening; features are not built ahead of it.

---

# Principle 1 — Business Before Technology

Technology exists to solve business problems. Features are never implemented because they are technically interesting: understand the workflow before designing the software (the pilot at Tarsun Enterprises, Kalyan West, is the reference), validate assumptions with the distributor rather than the roadmap, and prioritise measurable business value.

# Principle 2 — Single Source of Truth

Business information exists once. The same customer, product, order or payment never requires duplicate maintenance.

**In practice:** manufacturers, products and variants are global and curated; retailers, prices, orders and ledgers belong to one tenant. A distributor may propose a catalogue item and use it immediately. Documentation follows the same rule: `docs/22-source-of-truth.md` is the one file every decision is written into, on the day it is made (Decided 2026-09-05).

# Principle 3 — Capture Once, Reuse Everywhere

Information is captured at its point of origin and reused throughout the process. One sales order drives picking, packing, invoicing, delivery planning, stock reservation, payment tracking and analytics with no re-entry.

**Extended 2026-09-05 to inbound stock.** "Zero manual entry" on a supplier bill means zero typing except the blind gate count: QR / IRN verification, then vision extraction, validators, SKU matching, human review, and a single idempotent goods-receipt commit.

# Principle 4 — Digital by Default

Manual and paper processes are replaced with digital workflows wherever practical — delivery confirmation, payment collection, warehouse operations, order approvals, customer communication. Paper is still produced where the law or the trade requires it: the tax invoice, the credit note and the delivery challan are printed documents.

**Decided 2026-09-04:** money is digitised at exactly two points — **only the delivery crew collects at the door (cash, UPI, cheque), or the shop pays online in the retailer app**. The back office may record a payment received at the desk. The salesperson never records a receipt.

# Principle 5 — Mobile First for Field Operations

Field roles work away from a desk, so their screens are designed for a phone first: sales, delivery, warehouse scanning and the retailer.

**Decided 2026-09-04.** Mobile-first no longer means mobile-only. Every one of the six role apps ships as **web, Android and iOS** from the same codebase; the seventh app, the platform console for Distribution OS staff, is web only (decided 2026-09-05). Desk-heavy work (owner analytics, the billing desk, day-end, imports, settings) is designed for the larger screen and remains usable on a phone.

# Principle 6 — Real-Time Visibility

Decisions are made on current operational data, not end-of-day reports: stock, deliveries, collections, orders, staff activity.

**Decided 2026-09-04:** the product is **online-first now, with offline capture for the sales and delivery apps before the pilot**. Offline is not a general platform feature — it is scoped to the two roles that lose signal inside a shop or a lane. An offline upload never returns a 4xx; rejections are recorded, returned and shown, never lost.

# Principle 7 — Automation Wherever Valuable

The system automates repetitive, rule-based work: stock reservation, FEFO lot selection, pick-list consolidation, receipt allocation oldest-bill-first, ageing buckets, overdue flags, scheduled jobs.

**Changed 2026-09-05.** Automation is configurable **only through the settings and flags listed in Principle 8**. It is not configurable by rewriting the workflow: an automation either runs for every tenant or is switched off for a tenant, never re-sequenced per customer. Route sequencing moved from "not planned" into v1 with the AI decision below; the driver may always override the suggested order.

# Principle 8 — Configurable Where It Is Safe, Fixed Where It Must Be

_(Rewritten in full. Decided 2026-09-04 and 2026-09-05; supersedes "Configurable Before Custom".)_

Distributors operate differently, and the platform absorbs that difference as **configuration data, not per-customer code**. But configurability is not a virtue in itself: anything that protects money, stock, tax or privacy is deliberately fixed for every tenant, so it can be tested once and guaranteed everywhere. A new distributor is bootstrapped, never forked.

## 8.1 Fixed for every tenant

| What is fixed         | Detail                                                                                                                                                                                                                                                                                                                                                                                                 | Where it lives                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| **Permission matrix** | Seven roles — owner, manager, accountant, salesperson, warehouse, delivery, retailer. Every one of the ~250 contract procedures has a row saying which roles may call it. A route with no row fails closed. The matrix is tested **endpoint × role**, and each service refuses a role it does not serve before any business logic runs.                                                                | `backend/libs/contracts/src/permissions.ts`, `describePermissionMatrix` |
| **Roles themselves**  | No per-tenant roles, no renamed roles, no custom role builder. The accountant is a money desk plus reads — receipts, deposits, cheque bounces, write-offs, exports — and never prices, schemes, credit limits, approvals or settings (Decided 2026-09-05). An eighth role, `platform_admin`, arrives with the platform console for Distribution OS staff; it does not make the matrix tenant-editable. | `permissions.ts` role groups                                            |
| **State machines**    | Order, trip + stop, and invoice states change only through the coded machines. No tenant adds, renames or reorders a status.                                                                                                                                                                                                                                                                           | `backend/libs/domain/src/state-machines/`                               |
| **Approval kinds**    | A fixed list: credit limit, bargain, below floor, return, scheme override, manual price, trip settlement. Who approves and at what threshold is configurable; inventing a new kind of approval is not.                                                                                                                                                                                                 | `ApprovalKind` enum                                                     |
| **Money custody**     | Only delivery, the retailer paying online, and the back-office desk may record a receipt.                                                                                                                                                                                                                                                                                                              | permission matrix + service composition                                 |
| **Document rules**    | The GST invoice is issued at pack by the warehouse; an issued invoice is never edited; corrections are credit or debit notes; a cancelled invoice keeps its number.                                                                                                                                                                                                                                    | billing module, database triggers                                       |
| **Ledgers**           | Stock ledger and journal lines are append-only, balances derived, journals must balance at commit.                                                                                                                                                                                                                                                                                                     | database triggers                                                       |

## 8.2 Configurable per tenant, by the owner

| Area                   | What the owner sets                                                                                                                                                                         | Stored as                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Branding (white-label) | Business name as printed, logo, invoice footer, seller address block, FSSAI licence                                                                                                         | `tenant_settings` `branding.*`, `seller_fssai` |
| Payments               | The UPI id behind the QR on the invoice; absent means no QR is printed                                                                                                                      | `upi_vpa`                                      |
| Numbering              | Invoice, credit-note and challan series: prefix, start, reset rule. Never hard-coded. Series configuration locks once the first number is issued.                                           | `numbering_series`                             |
| Compliance             | E-way bill intra-state threshold, checked on the vehicle load, not per invoice                                                                                                              | `ewb_intra_state_threshold`                    |
| Delivery               | Cash settlement tolerance, proof-of-delivery policy (always / credit only / never), arrival geofence distance                                                                               | `delivery.*` settings                          |
| Privacy                | How many days raw GPS points are retained                                                                                                                                                   | `dpdp.gps_retention_days`                      |
| Credit                 | Per-retailer credit mode — indicate, strict or stop — plus limit and payment terms                                                                                                          | retailer record                                |
| Commercial             | Price lists and tiers, schemes and their priority, bargain and floor rules                                                                                                                  | pricing module                                 |
| Optional surfaces      | Feature flags, written by the owner only, readable by every role's app                                                                                                                      | `feature_flags`                                |
| Data migration         | Import profiles: upload, preview, map columns, save the profile, dry run, commit — one generic importer for TradeEzee, Marg, Busy, Tally, FieldAssist or a spreadsheet (Decided 2026-09-04) | imports module                                 |

## 8.3 What we do not do

- No per-customer code branches, and no tenant-specific deployment.
- No custom order statuses, custom roles, or tenant-authored approval workflows.
- No configuration that could let a tenant expose purchase cost to a field role, edit an issued invoice, or bypass an append-only ledger — see **Non-negotiables**.

**Test for a new configuration request:** if getting it wrong costs the distributor a rupee, a case of stock, a tax position or a customer's privacy, it is fixed; if it is a name, a threshold, a series or a switch, it is a setting.

# Principle 9 — Modular by Design

Every business capability is an independent module with clear responsibilities — catalogue, retailers, pricing, inventory, orders, procurement, warehouse, billing, receivables, delivery, and the rest.

**In practice:** modules talk only through exported application services or outbox events, never another module's tables, and the boundary is enforced by lint rules rather than convention. Cross-module references in the schema point one way, downstream only.

# Principle 10 — API First

Every business capability is reachable through a documented API, and the API is designed before the implementation.

**In practice:** the contract is written first, in one shared package, and both the services and the apps are generated from it. Every service publishes OpenAPI, Swagger and Scalar documentation, and each operation carries the roles allowed to call it. **Decided 2026-09-04:** the published sample payloads must actually work — they are built from real seeded rows and are exercised as a suite, not written by hand.

# Principle 11 — Multi-Tenant by Design

Distribution OS is a SaaS platform: multiple distributors, one database, strict isolation.

**In practice:** every tenant table carries a tenant id and row-level security is enabled and forced; all data access runs inside a transaction that sets the tenant, actor and role, so even the owning database connection obeys the policies. Isolation is proven by tests, not by review.

**Decided 2026-09-05:** **one tenant = one distributorship.** Multi-branch is v2 — each branch becomes its own tenant with a group view for the owner. There is no branch entity in v1. Tenant-specific _configuration_ is supported (Principle 8); tenant-specific _permissions_ are not.

# Principle 12 — Security by Design

Security is built into every layer: authentication, authorisation, encryption in transit, audit logging, least privilege.

**Decided 2026-09-04:** sign-in is **our own username and password service** issuing short-lived access tokens and rotating per-device refresh tokens; reuse of an old refresh token revokes the session. **OTP over SMS or WhatsApp is a later layer on top, not a replacement.** Authorisation is checked twice — the permission matrix in the service, then the database policy — and the field roles cannot read purchase cost at either level.

# Principle 13 — Performance Matters

Common operations — product search, order creation, dashboards, stock updates — stay fast as volumes grow.

**In practice:** the scale rules in `docs/20-scale-rules.md` are applied while a module is written, not after: every list is paginated with a cursor, every hot query has its index, services hold no state so any number of copies may run, and heavy work goes to the background worker. The target is lakhs of users from day one.

# Principle 14 — Audit Everything Important

Critical activity is traceable: who did it, what changed, when, and the previous value where it applies.

**In practice:** stock movements and journal lines are append-only by database trigger, order state transitions are recorded, and settings, price and credit changes are logged. Support access to a distributor's data by Distribution OS staff will be time-boxed, owner-approved and audited when the platform console ships (Decided 2026-09-05).

# Principle 15 — AI as an Assistant, Not a Replacement

AI assists; a person decides. This principle is unchanged — its scope is not.

**Decided 2026-09-05: all AI capabilities are in v1, before the pilot** — WhatsApp free-text order capture, voice order capture, demand forecasting and reorder suggestions for purchase planning, and delivery route sequencing. This supersedes the earlier plan to defer them until after the pilot.

Every one of them is confirmed by a human before it changes a record:

- A parsed WhatsApp or voice order becomes a **draft** the salesperson or the shop confirms.
- Forecasts produce a **suggestion** on a purchase plan, never an order.
- A suggested route is a **sequence the driver may override**.
- Document intake never commits on its own — a person reviews before the goods receipt.

# Principle 16 — Scalability Without Re-Architecture

The platform grows from one distributor to many without a redesign: stateless services behind a load balancer, one database with isolation enforced in the database, background work on a durable queue, and a partitioning plan for the ledgers before they need it.

**Clarified 2026-09-05:** growth to multiple branches and regions is a **tenant-shaped** expansion (branch = tenant, plus a group view), which is why no branch entity was added to v1.

# Principle 17 — User Experience Over Feature Count

A small set of intuitive screens beats a large set of complex ones. Every screen minimises clicks, typing, navigation and training.

**Decided 2026-09-05:** one screen layout, **A Ledger**, was chosen from four candidates and applies to all six role apps, so a user who learns one app can read another. **English only for now** (Decided 2026-09-04); additional languages are a later decision, not a v1 scope item. Distribution OS branding appears only on the sign-in screen — inside the app and on every document the distributor sees their own name.

# Principle 18 — Data-Driven Decisions

The platform exposes insight, not just storage: slow-moving stock, outstanding collections, purchase trends, delivery performance, sales growth.

**Decided 2026-09-04:** the owner app carries **graphs wherever they help** — growth and how the distributorship is performing — served as chart-ready series by the reporting module. **Status: not built.** Reporting is one of the queued backend modules; today the underlying data exists and the aggregates do not.

# Principle 19 — Extensibility

The platform expands without a redesign. Two extensions moved from "future" into **v1** (Decided 2026-09-05):

- **Retailer self-service** — the shop's own app: bills, outstanding, reorder, online payment, delivery tracking, one card per linked distributor.
- **Platform console** — a seventh app and service for Distribution OS staff: distributor onboarding, plans and subscription state, time-boxed support access.

Still genuinely future: manufacturer portal, marketplace, ERP connectors beyond Tally export, IoT. Permanently out of scope: **financial services of any kind** — no lending, no payments aggregation, no float. Revenue is the distributor's subscription.

# Principle 20 — Continuous Improvement

The product evolves through customer feedback, operational observation, product analytics, new technology and regulatory change. The roadmap is reviewed regularly. Every decision that changes the product is written into the source-of-truth register on the day it is made, with its date.

---

# Non-negotiables

These ten rules override every principle above, every roadmap item and every customer request. Each is enforced in the database or the domain layer with tests, not by a reviewer remembering it. Source: `docs/22-source-of-truth.md` §9.

| #   | Rule                                                                                                                                          | Enforced by                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1   | Purchase cost, landed cost and margin are never readable by the salesperson, warehouse, delivery or retailer roles                            | Database policy plus tests                                   |
| 2   | The salesperson never records a receipt                                                                                                       | Permission matrix; the sales service has no receipt endpoint |
| 3   | Stock ledger and journal lines are append-only, balances are derived, and every mutation carries an idempotency key and a client-generated id | Database triggers, unique keys                               |
| 4   | An issued invoice is never edited; corrections are credit or debit notes; a cancelled invoice keeps its number                                | Immutability trigger, billing module                         |
| 5   | A brand-DMS sale is never re-invoiced; it is imported and linked to the brand's own invoice number                                            | Inbound pipeline, import source type                         |
| 6   | Document intake never commits on its own; a human reviews before the goods receipt                                                            | Document intake workflow                                     |
| 7   | State columns change only through the state machines                                                                                          | Domain layer; no direct state writes                         |
| 8   | An offline upload never answers 4xx; rejections are recorded and shown, never lost                                                            | Sync module contract                                         |
| 9   | A tenant never sees another tenant's rows; a retailer sees only rows linked to its own shop                                                   | Forced row-level security, isolation tests                   |
| 10  | Distribution OS branding never appears inside a distributor's documents                                                                       | White-label settings; branding is read, never hard-coded     |

---

# Decision Framework

Every significant product or technical decision should answer:

1. Does it solve a real business problem for a distributor we can name?
2. Is it aligned with the product vision?
3. Does it break a **non-negotiable**? If yes, stop.
4. Is it a fixed rule or a per-tenant setting — and is that the right side of Principle 8?
5. Can it scale to lakhs of users without a re-architecture?
6. Does it simplify rather than complicate the day's work?
7. Does it work for the role's device — phone in the field, desk in the office?
8. Is it expressed in the API contract before it is implemented?
9. Is it auditable, and does it keep least-privilege access intact?
10. Will it still be valuable in five years?

If several answers are "no", the proposal is reconsidered. If the answer to 3 is "yes", it is refused.

---

# Summary

These principles define how Distribution OS evolves, and give product, engineering, design and support one framework for deciding. The shortest form: **configure what is safe, fix what protects money, stock, tax and privacy, and never let a principle override a non-negotiable.**

They are partly a description of what exists and partly a commitment about what will be built, and the pages say which is which. As at 2026-09-05 13:45 IST: **14 backend modules verified, 1,442 automated tests, 1,004 endpoint calls exercised, 0 broken** (Build Status & Roadmap mirrors `docs/18-build-log.md`). The permission matrix covers every procedure and is tested endpoint × role. **No app screen is built yet** — backend first is a deliberate sequencing decision (2026-09-04). The build log is the honest scoreboard.

---

# Change Log

| Version | Date           | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | August 2026    | Original twenty principles, written before implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2.0     | September 2026 | Principle 8 rewritten as fixed-versus-configurable with the actual permission matrix, state machines, approval kinds and tenant settings; Non-negotiables section added from the source of truth; Principle 5 restated as six role apps on web, Android and iOS from one codebase with the admin console web only; Principle 6 online-first with offline for sales and delivery; Principle 11 one tenant = one distributorship, branches v2; Principle 12 username and password now, OTP later; Principle 15 all AI in v1 with human confirmation; Principle 17 layout A Ledger and English only; Principle 19 retailer app and platform console moved into v1, fintech ruled out; enforcement and build status added throughout |
