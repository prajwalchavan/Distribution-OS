# Distribution OS — Product Home

## Document Information

| Property     | Value           |
| ------------ | --------------- |
| Document     | Product Home    |
| Product      | Distribution OS |
| Version      | 2.0             |
| Status       | Active          |
| Owner        | Prajwal Chavan  |
| Last Updated | September 2026  |

**Decided 2026-09-05:** the product name is **Distribution OS** (two words). Role apps are named "Distribution OS - Owner", "Distribution OS - Manager", "Distribution OS - Sales", "Distribution OS - Warehouse", "Distribution OS - Delivery", "Distribution OS - Retailer". Earlier drafts of this space used "DistributionOS".

---

# Welcome

Distribution OS is a multi-tenant SaaS platform for distribution businesses — manufacturer to **distributor** to retailer — sold by subscription to the distributor. One distributor is one tenant; every rupee and every piece of stock is written to append-only ledgers under that tenant, on one PostgreSQL database with forced row-level security. Seven applications cover the business: six role apps (owner; manager shared with the accountant; sales; warehouse; delivery; retailer) plus a platform-admin console, each talking to its own backend service so a role can only reach the endpoints its service mounts. The product is **white-labelled**: the distributor's own name and logo appear inside the apps and on every printed document, and Distribution OS branding appears only on the sign-in screen. Positioning is multi-industry with **FMCG first** (Decided 2026-09-05); the pilot customer is Tarsun Enterprises, Kalyan West.

---

# Source of Truth

**Decided 2026-09-05 (this reverses the v1.0 statement on this page).** `docs/22-source-of-truth.md` **in the repository is the single source of truth** for product shape and founder decisions. It is updated in the same turn a decision is made. **This Confluence space mirrors it** and is the readable, shareable view for stakeholders. Where the two disagree, docs/22 wins and the Confluence page is corrected.

| Question                                             | Where the answer lives                                |
| ---------------------------------------------------- | ----------------------------------------------------- |
| What did the founder decide, and when                | `docs/22-source-of-truth.md` §8 (dated register)      |
| What can never be broken                             | `docs/22-source-of-truth.md` §9 (non-negotiables)     |
| What is built right now, with test numbers           | `docs/18-build-log.md` (changes hourly)               |
| Every screen of every app and the endpoints it calls | `docs/23-app-screens-and-api-gaps.md`                 |
| Where this space still disagrees with the build      | `docs/24-confluence-alignment.md` (audit, 2026-09-05) |
| Architecture decisions with rationale                | `docs/adr/` in the repository                         |

---

# Current Status

**Decided 2026-09-04: backend first, production grade on the local database** — every endpoint of every service built and tested — then the six apps one at a time. This replaces the v1.0 "Development: Not Started" line.

| Checkpoint (2026-09-05)        | Backend modules verified | Tests green | Endpoint calls exercised | Broken |
| ------------------------------ | -----------------------: | ----------: | -----------------------: | -----: |
| Platform gaps slice, 10:40 IST |                       13 |       1,254 |                      844 |      0 |
| Delivery module, 13:45 IST     |                       14 |       1,442 |                    1,004 |      0 |

Every number is produced by a verification gate that runs independently of the agent that wrote the code: a forced full build, typecheck, lint and test pass (twice), generated-README and formatting checks, then `pnpm smoke`, which signs in as each service's role, reads that service's own OpenAPI document, and calls **every** operation with the example that document publishes. "0 broken" means no operation failed for a technical reason; correct business refusals (403, 409) are counted separately and expected.

| Area                                                 | Status                                                                                                   |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Product discovery, market research, workflow mapping | Complete                                                                                                 |
| Architecture, domain model, database design          | Complete — 126 tables, 18 migrations applied at the last verified gate, forced RLS                       |
| API design                                           | Complete — 250 procedures declared in one shared contract                                                |
| Backend build                                        | In progress — 14 modules verified, 203 procedures live                                                   |
| Backend remaining                                    | Queued — document intake, integrations, claims, notifications, reporting, incentives, AI, platform admin |
| UI/UX design                                         | Layout **A Ledger** chosen 2026-09-05; design system finalised                                           |
| App screens                                          | Not started — 98 screens inventoried in `docs/23`                                                        |
| Demo data                                            | Pilot tenant live (36 shops); three-distributor demo queued                                              |
| Testing                                              | Continuous — 1,442 tests, permission matrix tested endpoint × role                                       |
| Deployment                                           | Deliberately later — everything runs on the founder's local PostgreSQL today                             |

Document intake (26 procedures) and integrations (21 procedures) are declared in the contract but are not yet implemented or mounted on any service. Nothing is claimed here that a running service does not answer.

---

# The Seven Applications

**Decided 2026-09-04: every role gets its own app**, and the manager and accountant share one. **Decided 2026-09-05:** a seventh **platform console** joins v1. Every role app ships as **web + Android + iOS from one codebase**; the working surface is the phone for sales, warehouse, delivery and retailer and the desk for owner and manager. The admin console is web only. This replaces the v1.0 "admin portal plus mobile apps" model.

| #   | App                         | Who signs in            | Device                            | Service : port           | What they do there                                                                                        |
| --- | --------------------------- | ----------------------- | --------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------- |
| 1   | Distribution OS - Owner     | `owner`                 | Web + Android + iOS · desk        | owner-service : 3001     | Day numbers with graphs, approvals, live map, prices, schemes, credit, settings, own branding, imports    |
| 2   | Distribution OS - Manager   | `manager`, `accountant` | Web + Android + iOS · desk        | manager-service : 3002   | Order queue, GRN review, billing desk, load-out approval, day-end, registers, Tally export                |
| 3   | Distribution OS - Sales     | `salesperson`           | Web + Android + iOS · phone       | sales-service : 3003     | Beat, shop check-in, order entry, bargain request, visits, targets. Never sees cost, never collects money |
| 4   | Distribution OS - Warehouse | `warehouse`             | Web + Android + iOS · phone       | warehouse-service : 3004 | Gate count, scan supplier bills, pick, pack (the invoice is issued here), load sheets, challans           |
| 5   | Distribution OS - Delivery  | `delivery`              | Web + Android + iOS · phone (GPS) | delivery-service : 3005  | Trip, stops, proof of delivery, returns, collect cash / UPI / cheque, van sales, settlement               |
| 6   | Distribution OS - Retailer  | `retailer`              | Web + Android + iOS · phone       | retailer-service : 3006  | See bills and outstanding, reorder, pay online, track delivery; one card per linked distributor           |
| 7   | Distribution OS - Admin     | `platform_admin`        | Web only                          | admin-service : 3007     | Onboard distributors, plans and subscription state, time-boxed owner-approved support access              |
| —   | Sign-in for all             | every role              | —                                 | auth-service : 3000      | Username + password, our own tokens, switch distributor                                                   |
| —   | Worker                      | system                  | —                                 | pg-boss                  | Outbox relay, retention, document intake, rollups, notifications                                          |

**Decided 2026-09-05:** the **retailer app is in scope now**, not "future" as v1.0 stated — the shop places its own orders and pays online. **Decided 2026-09-05:** the **admin console is v1**; v1.0 had no platform administration surface. Services 3000-3006 are running today; admin-service is decided and not yet built.

Roles that v1.0 listed and the product does not have: **Data Entry Operator** (orders are captured by the salesperson, the shop, or the manager's desk — nobody re-keys an invoice), **Branch Manager** (see Branches below), **Manufacturer portal** (out of scope), and separate **Warehouse Manager / Warehouse Staff** (one `warehouse` role).

---

# How Work Flows

The v1.0 flow on this page read "Sales Order → Invoice → Picking". That is corrected: **the invoice is issued at pack, by the warehouse, after picking** (docs/15 D15), because a short pack must change the bill, not the order.

1. **Order** — the salesperson captures it on the beat, the shop places it in the retailer app, or the desk keys a phone order. The price engine and credit check run before submit.
2. **Approve** — only if a bargain, a credit breach or a minimum-order-value rule needs it. Otherwise the order auto-confirms and stock is reserved.
3. **Pick** — consolidated picklist by SKU, FEFO lots, actual lots recorded.
4. **Pack** — per order; short packs are pack rows, never order edits. **The GST invoice is issued here**, on the distributor's own numbering series, with their name, logo and UPI QR.
5. **Load out** — load sheet plus delivery challan; **the manager approves the load-out from the manager app** (Decided 2026-09-05), the warehouse device waits for it; stock moves warehouse → vehicle.
6. **Deliver** — trip and stops, proof of delivery, partial delivery becomes a credit note, failed delivery leaves stock on the vehicle.
7. **Collect** — **only the delivery crew collects money, or the shop pays online** (Decided 2026-09-04). The salesperson never records a receipt; the back office may record an office payment. Receipts allocate oldest bill first into a double-entry journal that must balance at commit.
8. **Settle and reconcile** — vehicle check-in, cash settlement with an owner-set variance tolerance, day-end registers, bank deposits.

Stock comes in through a **zero-typing pipeline**: blind gate count → QR / IRN verification → LLM vision extraction → validators → SKU match → human review on the phone → one idempotent GRN commit. A human always reviews before the GRN is posted. Bills a brand raises in its own DMS are **imported, never re-invoiced**.

---

# Technology Stack

**Decided 2026-09-04 (this replaces the v1.0 stack table entirely): TypeScript everywhere.** No Flutter, no Next.js, no Redis, no BullMQ, no AWS SDK.

| Layer                      | Technology                                                                                                | Note                                                                                                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language                   | TypeScript 6.0, Node 24                                                                                   | exactly one TypeScript version per workspace                                                                                                                           |
| Backend services           | NestJS 12 on Fastify 5                                                                                    | seven role services plus `auth-service`, and a worker — eight service packages when `admin-service` lands, seven today; ~20 lines each, composed from shared libraries |
| API                        | oRPC 1.15, contract-first, Zod 4 schemas                                                                  | one shared contract; OpenAPI, Swagger UI and Scalar generated from it                                                                                                  |
| Database                   | PostgreSQL 17, one database                                                                               | `tenant_id` on every tenant table, RLS enabled and FORCED                                                                                                              |
| ORM and migrations         | Drizzle ORM + drizzle-kit                                                                                 | 126 tables, 18 migrations applied at the last verified gate, expand-only once deployed                                                                                 |
| Background jobs            | pg-boss on the same PostgreSQL                                                                            | outbox relay, retention sweep, PDF rendering, document intake                                                                                                          |
| Cache and queue            | **None**                                                                                                  | PostgreSQL is the only shared state; services are stateless                                                                                                            |
| Object storage             | Own driver — local filesystem by default, S3 SigV4 signed by hand                                         | invoice photos, proof of delivery, PDFs, logos; no cloud account needed to develop                                                                                     |
| Authentication             | Own auth service — username + password (argon2id), EdDSA access tokens, rotating refresh token per device | **Decided 2026-09-04:** OTP is a later layer on top, not a replacement                                                                                                 |
| Authorisation              | Per-endpoint permission matrix, seven roles, plus PostgreSQL row-level security                           | tested for every endpoint × every role                                                                                                                                 |
| Documents                  | Own dependency-free PDF renderer                                                                          | invoice A4 / A5 / thermal, credit note, Rule 55 challan, receipt — all white-labelled                                                                                  |
| Web apps                   | Vite 8 + React 19                                                                                         | owner app runs locally today                                                                                                                                           |
| Mobile apps                | Expo (React Native), Android + iOS                                                                        | not started; screens follow the backend                                                                                                                                |
| Offline                    | Own sync endpoint that never answers 4xx                                                                  | **Decided 2026-09-04:** online-first now, offline for sales and delivery before the pilot                                                                              |
| CI                         | GitHub Actions; a Dockerfile exists for other machines                                                    |                                                                                                                                                                        |
| Cloud, monitoring, logging | Not chosen yet                                                                                            | deployment is deliberately later; everything runs locally                                                                                                              |

---

# Scope

## In v1

Identity and access, tenancy and settings, catalog (global curated plus per-distributor overlay), retailers, pricing and schemes, inventory, procurement and goods receipt, orders, warehouse, billing, receivables, delivery, document intake, integrations (generic importer, Tally export, brand-DMS import), claims, notifications, reporting, incentives, and the platform console.

**Decided 2026-09-05: all AI features are in v1, before the pilot** — WhatsApp free-text and voice order capture parsed into a draft order and **always human-confirmed**, demand forecasting and reorder suggestions for purchase planning, and route sequencing that the driver may override. This overrides the earlier deferral of voice, parsing and routing.

**Decided 2026-09-04:** data migration from any source (TradeEzee, Marg, Busy, Tally, FieldAssist, Excel) is one **generic importer** — upload, preview, map columns, save the profile, dry run, commit — not a per-vendor connector.

## Not in v1

- **Branches.** **Decided 2026-09-05:** one tenant = one distributorship, with many warehouses, vehicles and teams. Multi-branch is v2 — each branch its own tenant plus an owner group view. v1.0 personas assumed a Branch Manager role; there is no branch entity.
- **Fintech.** Revenue is the distributor's subscription. No lending, no payment aggregation.
- **Per-tenant custom roles.** One fixed, tested permission matrix. Settings, feature flags, numbering series, credit modes, schemes and tolerances are configurable; roles, state machines and approval kinds are not.
- **Racks, bins and barcode scanning.** The only QR read is the supplier e-invoice.
- **Languages other than English.** **Decided 2026-09-04:** English only for now.

---

# Non-Negotiables

These are enforced in the database with tests, not by app-layer convention.

1. Purchase cost, landed cost and margin are never readable by the salesperson, warehouse, delivery or retailer roles.
2. The salesperson never records a receipt.
3. Stock ledger and journal lines are append-only; balances are derived; every mutation carries an idempotency key and a client-generated id.
4. An issued invoice is never edited. Corrections are credit or debit notes; a cancelled invoice keeps its number.
5. A sale a brand raised in its own DMS is never re-invoiced.
6. Document intake never commits on its own; a human reviews before the goods receipt.
7. State columns change only through the coded state machines.
8. An offline upload never answers 4xx; rejections are recorded and shown, never lost.
9. A tenant never sees another tenant's rows; a shop sees only rows linked to itself.
10. Distribution OS branding never appears inside a distributor's documents.

---

# Product Principles

Cloud-first multi-tenant SaaS; modular design with modules talking only through published services or events; contract-first API; mobile-first for field users; security and auditability by design; performance and reliability at scale (built for lakhs of users from day one); extensibility for integrations; AI where it removes typing, always with a human confirmation. The full list, with what is configurable and what is fixed, is on the **Product Principles** page.

---

# Documentation Map

| Page                                                                                                           | What it answers                                                                          |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Build Status & Roadmap                                                                                         | The live scoreboard: verified modules, tests, endpoint calls, migrations, what is queued |
| [Vision](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1048577)                           | Where the product is going and why                                                       |
| [Mission](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1605635)                          | What we do every day to get there                                                        |
| [Goals](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1212417)                            | Business and product goals, and their non-goals                                          |
| [Problem Statement](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1081345)                | The problems being solved, traced to modules and procedures                              |
| [Pain Point Analysis](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/2097154)              | Observed pain points, prioritised                                                        |
| [Target Market & Customer Segments](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/786434) | Who buys, the pilot customer, segment characteristics                                    |
| [Personas](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1966081)                         | The seven roles, what each may and may not do, and their app                             |
| [Product Principles](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1900545)               | The rules every design decision is measured against                                      |
| [Success Metrics (KPIs)](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1802241)           | What we measure, and where each number comes from                                        |
| [AS-IS Business Process](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1736714)           | How distributors work today                                                              |
| [TO-BE Business Process](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1441794)           | How the product changes that                                                             |
| Seven Apps & Workflows                                                                                         | Each app's scope, device, screens and offline stance, and the four cross-app workflows   |
| Architecture & Technology                                                                                      | Repository layout, the service and port map, the stack as actually built                 |
| Data, Security & Multi-tenancy                                                                                 | Tenancy, forced RLS, the permission matrix, retention and the DPDP commitments           |
| Design System & Brand                                                                                          | Layout A Ledger, the two densities, palette, type, numbers, haptics                      |
| Integrations & Data Migration                                                                                  | The generic importer, Tally export, brand-DMS coexistence, no vendor API                 |
| Open Questions & Risks                                                                                         | What is still undecided, unbuilt or risky, with defaults and mitigations                 |
| Phase 2 & Future Enhancements                                                                                  | What is deliberately after v1, and why each item waits                                   |
| Founder Decisions Register                                                                                     | Every dated decision that binds the space (mirroring `docs/22` §8)                       |

---

# Open Questions

1. **Invoice series at cut-over** from the pilot's existing ERP: continue the old numbers or start fresh? Configurable either way; needed before go-live.
2. **Sample exports** from the pilot's ERP (party master, item master, outstanding) — the generic importer does not wait for them.
3. **GST composition scheme**: which pilot shops, if any, are under it.

---

# What Changed in Version 2.0

| Changed         | From (v1.0, August 2026)                                        | To (September 2026)                                                                                                 |
| --------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Source of truth | This Confluence space                                           | `docs/22-source-of-truth.md`; this space mirrors it                                                                 |
| Project status  | Development not started                                         | 14 backend modules verified, 1,442 tests, 1,004 endpoint calls, 0 broken                                            |
| Applications    | Admin portal plus five mobile apps; retailer "future"           | Seven apps, each on its own service; retailer and platform admin both in v1                                         |
| Technology      | Flutter, Next.js, Redis, BullMQ, S3, AWS                        | TypeScript everywhere: NestJS 12 on Fastify, oRPC, Drizzle, PostgreSQL 17, pg-boss, own auth and own object storage |
| Order flow      | Sales Order → Invoice → Picking                                 | Invoice issued at pack, after picking, by the warehouse                                                             |
| Money           | Sales representative collections                                | Only delivery collects, or the shop pays online                                                                     |
| Roles           | Ten user types including Data Entry Operator and Branch Manager | Seven roles plus platform admin; no operator, no branch entity in v1                                                |
| AI              | "AI-ready architecture", features deferred                      | All AI features in v1, always human-confirmed                                                                       |

Product name and app names set 2026-09-05. Layout direction **A Ledger** chosen 2026-09-05 and applied to all six role apps.
