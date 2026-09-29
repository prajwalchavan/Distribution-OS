# Distribution OS — Product Home

## Document Information

| Property     | Value             |
| ------------ | ----------------- |
| Document     | Product Home      |
| Product      | Distribution OS   |
| Version      | 3.2               |
| Status       | Active            |
| Owner        | Prajwal Chavan    |
| Last Updated | 29 September 2026 |

---

# Welcome

Distribution OS is a multi-tenant SaaS platform for distribution businesses — manufacturer to **distributor** to retailer — sold by subscription to the distributor. One distributor is one tenant; every rupee and every piece of stock is written to append-only ledgers under that tenant, on one PostgreSQL database with forced row-level security. Six business roles are served by **one app** — one website and one Android app, with the iOS app built from the same code and not released yet — that becomes the right app after sign-in; Distribution OS staff use a **separate** platform console. Each role still talks to its own backend service, so a role can only reach the endpoints its service mounts. The product is **white-labelled**: the distributor's own name and logo appear inside the app and on every printed document, and Distribution OS branding appears only on the Welcome and sign-in screens. Positioning is multi-industry with **FMCG first**; the pilot customer is Tarsun Enterprises, Kalyan West.

---

# One App, Six Roles, and a Console

**Every role gets its own view, and the manager and accountant share one. They are delivered as ONE app.** One install, one website at `www.distributionos.in`, one Android build, listed as "Distribution OS"; the iOS build comes from the same code and is not released yet. The person signs in and the app _becomes_ the right app — the owner's desk, the rep's beat, the driver's trip. There is one build, one review queue and one update cycle, and a distributor's new hire is never told _which_ of six apps to install.

**Welcome and landing.** The app opens on a **Welcome** screen — the Distribution OS mark, one line and one **Sign in** button — shown once per device until a session exists, never on every launch, so a driver at 6 am opens straight into the trip. After sign-in comes a **landing** moment: the distributor's logo and name (the shop's, for a retailer), the person's name, and the role the app has opened as — then the home screen.

**Role election at sign-in, downward only.** After the password, a person whose membership permits more than one role chooses one at **Continue as**, and the auth service grants it only downward — an owner may act as manager, accountant, warehouse, delivery or salesperson; a manager as warehouse, delivery or salesperson; other staff only as themselves plus the _extra roles_ the owner or manager grants them; a retailer or platform admin never as anything else. The token carries the **elected** role, so the services, the permission matrix and row-level security are untouched, and the person stays the actor on every audit row. A field role's screens never run on an owner token: a van phone must never hold a key to owner-service.

| #   | Role                            | Who signs in            | Working surface                 | Service : port           | What they do there                                                                                        |
| --- | ------------------------------- | ----------------------- | ------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------- |
| 1   | Owner                           | `owner`                 | Desk, phone secondary           | owner-service : 3001     | Day numbers with graphs, approvals, live map, prices, schemes, credit, settings, own branding, imports    |
| 2   | Manager (and accountant)        | `manager`, `accountant` | Desk, a few phone jobs          | manager-service : 3002   | Order queue, GRN review, billing desk, trip planning, load-out approval, day-end, registers, Tally export |
| 3   | Sales                           | `salesperson`           | Phone; works offline            | sales-service : 3003     | Beat, shop check-in, order entry, bargain request, visits, targets. Never sees cost, never collects money |
| 4   | Warehouse                       | `warehouse`             | Phone in the aisle              | warehouse-service : 3004 | Gate count, scan supplier bills, pick, pack (the invoice is issued here), load sheets, challans           |
| 5   | Delivery                        | `delivery`              | Phone, one-handed, GPS; offline | delivery-service : 3005  | Trip, stops, proof of delivery, returns, collect cash / UPI / cheque, van sales, settlement               |
| 6   | Retailer                        | `retailer`              | Phone; online only              | retailer-service : 3006  | See bills and outstanding, reorder, pay online, track delivery; one card per linked distributor           |
| —   | Platform console (separate app) | `platform_admin`        | Web                             | admin-service : 3007     | Onboard distributors, plans and subscription state, time-boxed owner-approved support access              |
| —   | Sign-in for all                 | every role              | —                               | auth-service : 3000      | Username + password, our own tokens, role election, switch distributor                                    |
| —   | Worker                          | system                  | —                               | pg-boss                  | Outbox relay, retention, document intake, rollups, notifications                                          |

The console is separate; platform staff are not a distributor's users.

The **retailer role** is part of the product: the shop places its own orders and pays online. The **platform console** is part of v1.

Roles the product does not have: **Data Entry Operator** (orders are captured by the salesperson, the shop, or the manager's desk — nobody re-keys an invoice), **Branch Manager** (see Branches below), **Manufacturer portal** (out of scope), and separate **Warehouse Manager / Warehouse Staff** (one `warehouse` role).

---

# How Work Flows

**The invoice is issued at pack, by the warehouse, after picking**, because a short pack must change the bill, not the order.

1. **Order** — the salesperson captures it on the beat, the shop places it in the retailer view, or the desk keys a phone order. The price engine and credit check run before submit.
2. **Approve** — only if a bargain, a credit breach or a minimum-order-value rule needs it. Otherwise the order auto-confirms and stock is reserved.
3. **Pick** — consolidated picklist by SKU, FEFO lots, actual lots recorded.
4. **Pack** — per order; short packs are pack rows, never order edits. **The GST invoice is issued here**, on the distributor's own numbering series, with their name, logo and UPI QR.
5. **Load out** — the trip is planned from a planning board, then a load sheet plus delivery challan; **the manager approves the load-out** and the warehouse device waits for it; stock moves warehouse → vehicle. **No van leaves with a bill nobody counted out**.
6. **Deliver** — trip and stops, proof of delivery, partial delivery becomes a credit note, failed delivery leaves stock on the vehicle.
7. **Collect** — **only the delivery crew collects money, or the shop pays online**. The salesperson never records a receipt; the back office may record an office payment. Receipts allocate oldest bill first into a double-entry journal that must balance at commit.
8. **Settle and reconcile** — vehicle check-in, cash settlement with an owner-set variance tolerance, day-end registers, bank deposits. Money moves exactly once: banking, undoing and settling a receipt lock it, so only one of them can win.

Stock comes in through a **zero-typing pipeline**: blind gate count → QR / IRN verification → LLM vision extraction → validators → SKU match → human review on the phone → one idempotent GRN commit. A human always reviews before the GRN is posted. Bills a brand raises in its own DMS are **imported, never re-invoiced**.

---

# Technology Stack

**TypeScript everywhere.** No Flutter, no Next.js, no Redis, no BullMQ, no AWS SDK.

| Layer                  | Technology                                                                                                | Note                                                                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Language               | TypeScript 6.0, Node 24                                                                                   | exactly one TypeScript version per workspace                                                                                              |
| Backend services       | NestJS 12 on Fastify 5                                                                                    | eight service packages — seven role services plus `auth-service` — and a worker; ~20 lines each, composed from shared libraries           |
| API                    | oRPC 1.15, contract-first, Zod 4 schemas                                                                  | one shared contract; OpenAPI, Swagger UI and Scalar generated from it                                                                     |
| Database               | PostgreSQL 17, one database                                                                               | `tenant_id` on every tenant table, RLS enabled and FORCED                                                                                 |
| ORM and migrations     | Drizzle ORM + drizzle-kit                                                                                 | migrations are expand-only                                                                                                                |
| Background jobs        | pg-boss on the same PostgreSQL                                                                            | outbox relay, retention sweep, PDF rendering, document intake                                                                             |
| Cache and queue        | **None**                                                                                                  | PostgreSQL is the only shared state; services are stateless                                                                               |
| Object storage         | Own driver — local filesystem by default, S3 SigV4 signed by hand                                         | invoice photos, proof of delivery, PDFs, logos; no cloud account needed to develop                                                        |
| Authentication         | Own auth service — username + password (argon2id), EdDSA access tokens, rotating refresh token per device | OTP is not available yet; it is meant as a layer on top, not a replacement                                                                |
| Authorisation          | Per-endpoint permission matrix, seven roles, plus PostgreSQL row-level security                           | tested for every endpoint × every role; the elected role is what the token carries                                                        |
| Documents              | Own dependency-free PDF renderer                                                                          | invoice A4 / A5 / thermal, credit note, Rule 55 challan, receipt — all white-labelled                                                     |
| Apps                   | Expo (React Native) + expo-router, one codebase = website + Android + iOS                                 | a screen imports only the shared kit, never `react-native` or `react-dom`; the shell follows the viewport, desk at 1024 px and up         |
| Offline                | Our own delta-sync client on SQLite; the upload endpoint never answers 4xx                                | sales and delivery work offline; no third-party sync engine                                                                               |
| Hosting                | Oracle Cloud (Mumbai) + Cloudflare Pages + R2 backups; Caddy with automatic Let's Encrypt                 | PostgreSQL is self-hosted, because managed PostgreSQL services withhold the superuser needed to create the row-level-security bypass role |
| CI                     | GitHub Actions; one arm64 container image, all-in-one process mode                                        | the image is built on the Mac or in CI and shipped as an artifact — never built on the server, which has too little memory                |
| Monitoring and logging | Kept to what the hosting needs                                                                            | more comes after version 1                                                                                                                |

**Where it runs.** PostgreSQL 17 is self-hosted alongside the services on an Oracle Cloud instance (2 OCPU / 12 GB ARM) in the **Mumbai** region; the creation of the worker role that bypasses row-level security needs a superuser, which managed PostgreSQL services (Neon, Supabase, RDS) withhold, and the isolation model is not bent to fit a hosting provider. The apps are served from **Cloudflare Pages**, and backups are kept **off Oracle** on Cloudflare R2. The website is **www.distributionos.in**, the bare domain `distributionos.in` redirects to it, and `api.` is the services.

---

# Scope

## In v1

Identity and access, tenancy and settings, catalog (global curated plus per-distributor overlay), retailers, pricing and schemes, inventory, procurement and goods receipt, orders, warehouse, billing, receivables, delivery, document intake, integrations (generic importer, Tally export, brand-DMS import), claims, notifications, reporting, incentives, and the platform console.

Also in v1: the **Welcome screen and landing moment**; **role election at sign-in**, downward only, with extra roles an owner or manager may grant; and **one app in the store and one website** that becomes the right app after sign-in.

**All AI features are in v1** — WhatsApp free-text and voice order capture parsed into a draft order and **always human-confirmed**, demand forecasting and reorder suggestions for purchase planning, and route sequencing that the driver may override.

Data migration from any source (TradeEzee, Marg, Busy, Tally, FieldAssist, Excel) is one **generic importer** — upload, preview, map columns, save the profile, dry run, commit — not a per-vendor connector.

## Not in v1

- **Branches.** One tenant = one distributorship, with many warehouses, vehicles and teams. Multi-branch comes after version 1 — each branch its own tenant plus an owner group view. There is no branch entity and no Branch Manager role.
- **Fintech.** Revenue is the distributor's subscription. No lending, no payment aggregation.
- **Per-tenant custom roles.** One fixed, tested permission matrix. Settings, feature flags, numbering series, credit modes, schemes and tolerances are configurable; roles, state machines and approval kinds are not.
- **Racks, bins and barcode scanning.** The only QR read is the supplier e-invoice.
- **Languages other than English.** The app is in English.

---

# Non-Negotiables

These are enforced in the database with tests, not by app-layer convention.

1. Purchase cost, landed cost and margin are never readable by the salesperson, warehouse, delivery or retailer roles.
2. The salesperson never records a receipt — the permission matrix, the database policy and the offline upload door all say so.
3. Stock ledger and journal lines are append-only; balances are derived; every mutation carries an idempotency key and a client-generated id.
4. An issued invoice is never edited. Corrections are credit or debit notes; a cancelled invoice keeps its number.
5. A sale a brand raised in its own DMS is never re-invoiced.
6. Document intake never commits on its own; a human reviews before the goods receipt.
7. State columns change only through the coded state machines.
8. An offline upload never answers 4xx; rejections are recorded and shown, never lost.
9. A tenant never sees another tenant's rows; a shop sees only rows linked to itself.
10. Distribution OS branding never appears inside a distributor's documents.
11. Sign-out leaves nothing of the previous person or distributor on a device; the next person to sign in sees only their own data.
12. The app never tells someone their work is saved on the device when it is not, and never says an order reached the office before it did.
13. Money a person has entered is never offered for deletion; a payment the office refuses is kept and routed to the cashier.

---

# Product Principles

Cloud-first multi-tenant SaaS; modular design with modules talking only through published services or events; contract-first API; mobile-first for field users; security and auditability by design; performance and reliability at scale (built for lakhs of users from day one); extensibility for integrations; AI where it removes typing, always with a human confirmation. The full list, with what is configurable and what is fixed, is on the **Product Principles** page.

---

# Documentation Map

| Page                                                                                                           | What it answers                                                                           |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [Vision](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1048577)                           | Where the product is going and why                                                        |
| [Mission](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1605635)                          | What we do every day to get there                                                         |
| [Goals](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1212417)                            | Business and product goals, and their non-goals                                           |
| [Problem Statement](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1081345)                | The problems being solved, traced to modules and procedures                               |
| [Pain Point Analysis](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/2097154)              | Observed pain points, prioritised                                                         |
| [Target Market & Customer Segments](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/786434) | Who buys, the pilot customer, segment characteristics                                     |
| [Personas](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1966081)                         | The seven roles, what each may and may not do, and what they see                          |
| [Product Principles](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1900545)               | The rules every design decision is measured against                                       |
| [Success Metrics (KPIs)](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1802241)           | What we measure, and where each number comes from                                         |
| [AS-IS Business Process](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1736714)           | How distributors work today                                                               |
| [TO-BE Business Process](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1441794)           | How the product changes that                                                              |
| [Apps & Workflows](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/10453020)                | The six roles in one app, what each may do, and the workflows that cross between roles    |
| [Architecture & Technology](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/10518600)       | Repository layout, the service and port map, the stack as built, and the deployment shape |
| [Data, Security & Multi-tenancy](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/10321935)  | Tenancy, forced RLS, the permission matrix, retention and the DPDP commitments            |
| [Design System & Brand](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/10453060)           | Layout A Ledger, the two densities, palette, type, numbers, haptics                       |
| [Integrations & Data Migration](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/10453040)   | The generic importer, Tally export, brand-DMS coexistence, no vendor API                  |
| [Phase 2 & Future Enhancements](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/10420246)   | What is deliberately after v1, and why each item waits                                    |
