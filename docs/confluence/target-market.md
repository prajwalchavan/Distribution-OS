# Target Market & Customer Segments

## Document Information

| Property     | Value                             |
| ------------ | --------------------------------- |
| Document     | Target Market & Customer Segments |
| Product      | Distribution OS                   |
| Version      | 2.2                               |
| Status       | Active                            |
| Owner        | Prajwal Chavan                    |
| Last Updated | 29 September 2026                 |

---

# Purpose

This document defines the target customers for Distribution OS, the industries it serves, and the business segments it is designed to support.

It provides a clear understanding of the ideal customer profile (ICP), target industries, customer sizes, and expansion strategy, so that product development, sales, marketing, and onboarding all aim at the same buyer.

# Positioning in One Line

**The positioning is multi-industry, with local FMCG distribution as the beachhead.** The product is deliberately FMCG-shaped — batch and expiry, case-and-piece quantities, schemes and claims, beat plans, credit and collections — and it stays that way until it serves a customer in a second industry. Adjacent industries are a matter of sequence, not a hedge.

Distribution OS is a **distributor-owned, multi-brand system of record**, sold by subscription to the distributor and free for the retailer. It is not a brand DMS (Botree, FieldAssist, Shikhar serve the manufacturer), not a billing package (Marg, Vyapar, Busy, TradeEzee stop at the invoice), and not a marketplace (Udaan, Jumbotail compete with the distributor).

# Ideal Customer Profile (ICP)

The primary customer for Distribution OS is an organisation that:

- Purchases products from one or more manufacturers or suppliers.
- Stores products in one or more warehouses.
- Sells products to retailers, wholesalers, or institutions.
- Employs sales representatives and/or delivery staff.
- Manages inventory and customer credit.
- Processes recurring daily orders.
- Wants to modernise operations using cloud software.

The paying customer is the distributor or business owner. Revenue is the distributor's subscription only — no payment aggregation, lending, or other fintech revenue.

## Two ICP qualifiers

Two characteristics, drawn from the pilot, are strong buying signals, not edge cases.

1. **The distributor carries at least one brand that forces its own DMS on him.** The pilot bills one brand inside FieldAssist, so the retailer's true outstanding is split across systems that never talk to each other. Distribution OS imports those secondary sales and links them to the brand's invoice number so the ledger is whole — and **never** issues a second legal invoice for the same sale.
2. **The shop buys from several distributors.** One retailer identity spans distributors; the retailer signs in once and sees one card per linked distributor.

# Primary Target Market (Version 1)

Version 1 focuses on small and medium-sized distributors whose operational complexity has outgrown basic billing software.

### Typical characteristics

| Dimension               | Version 1 target range                                    |
| ----------------------- | --------------------------------------------------------- |
| Active retail customers | 500–5,000                                                 |
| SKUs                    | 500–20,000                                                |
| Employees               | 5–200                                                     |
| Warehouses / godowns    | 1–10 (all inside one tenant)                              |
| Delivery vehicles       | 1–20 (a vehicle is a stock location; van sales supported) |
| Sales representatives   | Multiple, on beat plans                                   |
| Order cadence           | Daily                                                     |
| Payment behaviour       | Credit sales with collections and ageing                  |

**One tenant = one distributorship.** Many warehouses, vehicles, and teams live inside a single tenant, but there is no branch entity in v1. Multi-branch groups come after version 1, with each branch its own tenant and a group view for the owner.

Although the first customers are small, the platform is built to its scale rules from day one: a design load of 10,000 distributors, 100,000 staff devices, and 2,000,000 retailers.

# Pilot Customer

| Property               | Value                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------- |
| Business               | Tarsun Enterprises                                                                 |
| Location               | Kalyan West, Thane, Maharashtra                                                    |
| Brands carried         | Too Yumm (Guiltfree Industries), Campa (Reliance Retail), MOM makhana (Guru Kripa) |
| Current billing system | TradeEzee (Windows desktop ERP)                                                    |
| Brand-mandated DMS     | FieldAssist, for the Too Yumm secondary billing                                    |

The pilot is the reference implementation of the ICP: multi-brand, credit-heavy, one brand locked into a foreign DMS, and a billing package that stops at the invoice.

### What makes the product pay for this customer

1. **Inbound stock enters by photograph**, with no typing except the blind gate count.
2. **The pending-bills file is on the owner's phone**: per-retailer ledger, ageing buckets, a UPI QR with his own VPA on every bill, and WhatsApp reminders with the PDF attached.
3. **The chartered accountant receives Tally XML** that imports cleanly, unasked. Everything else is retention.

# Target Industries

## Phase 1 — Launch (v1)

High-frequency FMCG distribution, where the workflows are shared and reusable:

- Packaged snacks, namkeen, dry foods
- Bottled water, soft drinks and beverages
- Biscuits and bakery
- Chocolates and confectionery
- Grocery distribution
- Household cleaning products
- Personal care products

## Phase 2 — After the first FMCG customers are live

- Dairy, frozen foods and ice cream — the same batch-and-expiry model, plus cold-chain fields
- Electrical products, consumer electronics and durables — serial numbers and warranty tracking would be new
- Hardware, packaging materials, stationery, kitchen products, pet food and supplies

## Phase 3 — Long-term

- Agriculture and seeds
- Pharmaceutical distribution and medical supplies (the most demanding: schedule drugs, licence numbers, stricter traceability)
- Industrial products, automotive spare parts, building materials

Industry-specific regulatory or operational requirements are evaluated before support is added. The platform stays configurable enough to absorb them without re-architecture.

# Business Size Segments

## Small Distributor

- Single warehouse, single beat or two, 5–20 employees, basic delivery operations
- Common challenges: manual processes, paper records, limited reporting
- What they buy first: billing that is legally correct, stock that is real, and outstanding they can see

## Medium Distributor

- Multiple sales representatives, multiple delivery vehicles, larger catalogue, higher daily volumes
- Common needs: inventory visibility, delivery management, financial control, operational reporting
- What they buy first: control — approvals, credit limits, trip settlement, and day-end registers

## Enterprise Distributor

- Multiple warehouses, large workforce, high transaction volume, advanced reporting, external integrations
- Typical requirements: role-based permissions, integrations, performance at scale, audit and compliance
- "Multiple branches" is served after version 1 as one tenant per branch plus an owner group view — not as a branch hierarchy inside a single tenant
- Permissions are a **fixed matrix** of seven roles tested endpoint by endpoint. Per-tenant custom roles and configurable approval flows are not offered; what is configurable is settings, numbering series, credit modes, schemes, settlement tolerance and proof-of-delivery policy

# Geographic Focus

## Initial market: India

The product supports Indian business practice as a first-class requirement, not a localisation layer: GST (B2B tax invoice is the primary document, with a B2C path for shops without a GSTIN), rupee amounts held as integer paise, credit sales, beat plans, case-and-piece quantities, and IST business dates and financial years.

**The app is in English only.** Hindi and Marathi are not available yet.

## Future markets

The architecture keeps international expansion open — multiple currencies, multiple tax systems, localisation, and regional business configuration — but no non-Indian market is scheduled.

# Buyer Personas

**Primary buyer:** the owner or managing director of the distributorship. In this segment the owner is the decision maker, the budget holder, and usually a daily user.

**Influencers:** accountant (or the external CA), warehouse in-charge, sales manager.

**Daily users map one-to-one to the roles, and they all share one app.** The distributor's staff use **one** application, "Distribution OS", and it becomes the right app for whoever signs in. It is served as a website and an Android app; the iOS app is built from the same code and is not released yet. The platform console for Distribution OS staff is a separate application.

| What the app becomes                       | Who signs in                            | What they do                                                                                       |
| ------------------------------------------ | --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Owner                                      | Owner                                   | Day numbers with graphs, approvals, live map, prices, schemes, credit, settings, branding, imports |
| Manager                                    | Manager, accountant                     | Order queue, GRN review, billing desk, load-out approval, day-end, registers, Tally export         |
| Sales                                      | Salesperson                             | Beat, shop check-in, order entry, bargain requests, own targets                                    |
| Warehouse                                  | Warehouse staff                         | Gate count, supplier bill capture, pick, pack, load sheets, challans                               |
| Delivery                                   | Delivery crew                           | Trip, stops, proof of delivery, returns, collections, van sales, settlement                        |
| Retailer                                   | Retailer (one login, many distributors) | Bills and outstanding, reorder, pay online, track delivery                                         |
| Distribution OS - Admin (separate console) | Distribution OS staff                   | Onboard distributors, plans and subscription state, time-boxed support access                      |

Two points about these roles:

- **There is no "Data Entry Operator" role.** The invoice is issued at pack by the warehouse; inbound bills are captured by photograph and reviewed, not typed.
- **The salesperson never collects money.** Only the delivery crew collects at the door, or the shop pays online; the back office may record an office payment. The sales service has no receipt endpoint at all.

# Business Maturity Levels

Distribution OS is designed to accept customers at any of four stages of digital maturity. Migration from whatever they use today is handled by a **generic importer** — upload, preview, map columns, save the profile, dry run, then commit — rather than a per-vendor connector. It is aimed at TradeEzee, Marg, Busy, Tally, FieldAssist exports, and plain Excel.

| Stage                     | Where they are today                                   | What they need first                                                         |
| ------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 1 — Manual operations     | Paper records, phone calls, WhatsApp, Excel            | Digitise the core loop: order, invoice, stock, outstanding                   |
| 2 — Basic software        | A billing package on a desktop, limited reporting      | Connect the processes; import the masters and open balances                  |
| 3 — Growing business      | Multiple teams, higher volumes, operational complexity | Automation, approvals, analytics, workflow control                           |
| 4 — Enterprise operations | Large workforce, advanced requirements                 | Scale, integrations, governance, group visibility (branches after version 1) |

# Customer Pain Profile

Distribution OS is built for organisations experiencing one or more of the following:

- Heavy manual data entry — on the way **in** (supplier invoices) as much as on the way out.
- Multiple disconnected systems, including **a brand-mandated DMS that splits the retailer's true outstanding**.
- Paper-based warehouse and delivery workflows.
- Poor inventory visibility, and no reliable view of what is actually sellable.
- Difficult payment tracking; ageing known only from a physical pending-bills file.
- Delivery coordination by phone call, and cash on vehicles that is reconciled from memory.
- Schemes and claims left unraised — a large share of distributor income, and no distributor-side tool that tracks it across brands.
- Rapid growth outpacing existing software.

# Customers Not Initially Targeted

- Retail stores without distribution operations
- Manufacturing ERP replacements
- Consumer e-commerce businesses
- Pure accounting firms
- Logistics companies without inventory management

These segments may be evaluated in later phases. Two related non-goals: **no fintech** (no payments aggregation or lending) and **no brand DMS sold to manufacturers** — that market is served by existing products, and this one belongs to the distributor. Sharing data back to a brand is a collaboration feature that is not available yet, not a change of customer.

# Customer Success Criteria

A customer is successful with Distribution OS when they can:

- Run the full daily loop on the platform — order, pick, pack, invoice, deliver, collect, settle.
- Receive stock by photographing the supplier bill, typing nothing but the blind gate count.
- See accurate stock, including what is reserved and what is on a vehicle.
- See every retailer's outstanding and ageing in one place, across every brand, including brand-DMS sales.
- Reconcile delivery cash against expectation, with variance shown and owner-approved.
- Hand their accountant a clean Tally export without being asked.
- Make daily decisions from graphs on the owner's screens rather than from memory.

# Market Expansion Strategy

Each stage builds on the existing capability set rather than introducing a separate product:

1. Local FMCG distributor (beachhead — Kalyan pilot)
2. Food and beverage distribution more broadly
3. Multi-category distributor
4. Multi-branch and enterprise distribution (branch = tenant)
5. Manufacturer collaboration
6. Retailer self-service at scale
7. Network-level intelligence across many connected distributors

The AI capabilities inside a distributor's own business are **part of v1, not a later stage** — WhatsApp free-text and voice order capture (always human-confirmed), demand forecasting and reorder suggestions, and delivery route sequencing. Stage 7 above refers to intelligence that only becomes possible once many distributors are on the platform. The platform console for onboarding distributors, plans and subscription state is also part of v1, so signing a new distributor does not depend on manual database work.

# Summary

Distribution OS targets Indian small and medium distributors who have outgrown billing software and need one platform they own across every brand they carry. **Local FMCG distribution is the beachhead and the pilot is Tarsun Enterprises in Kalyan**; the positioning stays multi-industry, and adjacent industries follow only once FMCG is proven.

For v1, one tenant is one distributorship with many warehouses, vehicles, and teams; multi-branch groups come after version 1 as one tenant per branch with an owner group view. The architecture is built for lakhs of users from day one, so growth into larger customers, more industries, and eventually other markets is a sequencing decision rather than a rewrite.
