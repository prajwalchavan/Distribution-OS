# Distribution OS — Product Home

## Document Information

| Property     | Value             |
| ------------ | ----------------- |
| Document     | Product Home      |
| Product      | Distribution OS   |
| Version      | 3.1               |
| Status       | Active            |
| Owner        | Prajwal Chavan    |
| Last Updated | 21 September 2026 |

**Decided 2026-09-05:** the product name is **Distribution OS** (two words). **Decided 2026-09-21:** the six role apps become **one** app, listed once in each store as "Distribution OS"; the old per-role names ("Distribution OS - Owner", "- Sales", and the rest) survive only as the role a person signs in as. Earlier drafts of this space used "DistributionOS".

---

# Welcome

Distribution OS is a multi-tenant SaaS platform for distribution businesses — manufacturer to **distributor** to retailer — sold by subscription to the distributor. One distributor is one tenant; every rupee and every piece of stock is written to append-only ledgers under that tenant, on one PostgreSQL database with forced row-level security. Six business roles are served by **one app** — one website, one Android app, one iOS app — that becomes the right app after sign-in; Distribution OS staff use a **separate** platform console. Each role still talks to its own backend service, so a role can only reach the endpoints its service mounts. The product is **white-labelled**: the distributor's own name and logo appear inside the app and on every printed document, and Distribution OS branding appears only on the Welcome and sign-in screens. Positioning is multi-industry with **FMCG first** (Decided 2026-09-05); the pilot customer is Tarsun Enterprises, Kalyan West.

---

# Source of Truth

**Decided 2026-09-05 (this reverses the v1.0 statement on this page).** `docs/22-source-of-truth.md` **in the repository is the single source of truth** for product shape and founder decisions. It is updated in the same turn a decision is made. **This Confluence space mirrors it** and is the readable, shareable view for stakeholders. Where the two disagree, docs/22 wins and the Confluence page is corrected.

| Question                                             | Where the answer lives                                |
| ---------------------------------------------------- | ----------------------------------------------------- |
| What did the founder decide, and when                | `docs/22-source-of-truth.md` §8 (dated register)      |
| What can never be broken                             | `docs/22-source-of-truth.md` §9 (non-negotiables)     |
| What is built right now, with test numbers           | `docs/18-build-log.md` (changes hourly)               |
| What quality work is running today, and what is open | `QA/STATE.md` (current state only)                    |
| The plan to go live, and everything cut from it      | `QA/10-DAY-PLAN.md`                                   |
| Welcome, role election and the one store app         | `docs/29-sign-in-roles-and-one-store-app.md`          |
| Every screen of every role and the endpoints it calls | `docs/23-app-screens-and-api-gaps.md`                 |
| Architecture decisions with rationale                | `docs/adr/` in the repository                         |

---

# Current Status

**The product is built. It is now being proved, and then it goes live.** The 2026-09-04 order of work — backend first, production grade, then the apps — is finished on both sides; what remains is proof, two shipping changes the founder asked for, and hosting.

| Milestone                             | Date       | What it means                                                                                           |
| ------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------- |
| **Backend complete**                  | 2026-09-06 | Every module of every service built, tested and gated — nothing left in the backend queue               |
| **Frontend complete**                 | 2026-09-07 | All seven apps built and gated green, each one codebase serving website + Android + iOS                 |
| **Realistic demo data**               | 2026-09-08 | 174 SKUs across 13 brands, 60 / 40 / 24 shops in named archetypes, 90 / 60 / 45 days of trading history |
| **QA batch 1 approved and fixed**     | 2026-09-12 | The 4 severe and 30 high findings on the order-to-cash chain                                            |
| **QA batch 2 merged**                 | 2026-09-20 | 153 of 158 findings on main, across all 21 work groups                                                  |
| **Programme cut; hosting decided**    | 2026-09-21 | Seven days to launch — live by **Saturday 27 September** on `distributionos.in`                         |

| The build, in numbers                       | Count |
| ------------------------------------------- | ----: |
| Business modules                            |    23 |
| Services running independently              |     8 |
| Database tables                             |   139 |
| Migrations applied (expand-only)            |    48 |
| Module specs                                |   646 |
| Endpoint calls exercised by the smoke run   | 1,618 |

**Quality so far: 34 findings fixed in batch 1; 158 raised in batch 2, of which 153 are merged.** Five are still in flight, three of them raised on 20 September. The severe sign-out defect — a shared phone showing the next person the previous rep's shops, orders and dues — is **closed on measured evidence across Android, iOS and the browser**. The full scoreboard is on **Build Status & Roadmap**.

## The seven days to go live

**Decided 2026-09-21.** The founder cut the remaining quality programme from thirty days to ten, then to five, and then added two back so that role election and the one app land **before** launch — so the business simulation runs on the app that actually ships.

| Day             | What runs                                                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1 — Sun 21      | The cross-role chain across the seven apps as they are · Welcome and landing · role election starts · deployment plumbing starts |
| 2 — Mon 22      | Role election lands after architect review · the one app starts                                                                 |
| 3 — Tue 23      | The one app is finished and gated; the per-role web apps retired; the chain re-walked on it                                     |
| 4–5 — Wed 24–Thu 25 | **The seven-day business simulation, on the one app** — two full days, blind auditor, arithmetic verdict                     |
| 6 — Fri 26      | Fix what the simulation found; check only where it pointed                                                                      |
| 7 — Sat 27      | Android basics · the security slice public URLs require · **go live** · the architect's audit with the handover                 |

**The simulation is the gate.** Seven simulated trading days driven by real people doing real jobs — onboarding shops, orders, approvals, picking and packing, deliveries and payments, a price change, returns and a failed delivery, then reconciliation — and it ends in arithmetic: **opening stock + receipts − sales − damage − returns = closing stock**, per SKU per batch, and **revenue = payments + outstanding**. Any drift is a stop-the-line defect. **Live by Saturday 27 September if Thursday evening's books balance** — four days of scheduled work and one day of the unknown, and the founder hears on Thursday night if they do not.

## Where it will run

**Decided 2026-09-21, on verified terms.** Free *managed* PostgreSQL turned out to be impossible for this schema: creating the worker role that bypasses row-level security needs a superuser, and Neon, Supabase and RDS all withhold it. The isolation model is not bent to fit a hosting bill, so **PostgreSQL 17 is self-hosted** alongside the services on an **Oracle Cloud Always Free** instance (2 OCPU / 12 GB ARM) in the **Mumbai** region, the apps go on **Cloudflare Pages**, backups are kept **off Oracle** on Cloudflare R2, and the domain is **distributionos.in** (about ₹690 a year, bought on Hostinger on 21 September 2026 with its nameservers moving to Cloudflare) — the website is **www.distributionos.in**, the bare domain redirects to it, and `api.` is the services. Running cost at the pilot: ₹0 a month plus the domain.

Stated plainly: **nothing is deployed yet**, and on 21 September there was **no working path from the repository to a server** — no built container image, no TLS front, no migration or backup step. Building that path is one of day 1's lanes. Until it lands, everything runs on the founder's local PostgreSQL.

---

# One App, Six Roles, and a Console

**Decided 2026-09-04: every role gets its own view, and the manager and accountant share one. Decided 2026-09-21: they are delivered as ONE app.** One install, one website, one Android build, one iOS build, listed once as "Distribution OS". The person signs in and the app *becomes* the right app — the owner's desk, the rep's beat, the driver's trip. The stores charge per developer account rather than per app, so the saving is not fees: it is seven builds, seven review queues, seven update cycles, and a distributor's new hire being told *which* of six apps to install.

**Welcome and landing.** Every app opens on a **Welcome** screen — the Distribution OS mark, one line, this app's name and icon, one **Sign in** button — shown once per device until a session exists, never on every launch, so a driver at 6 am opens straight into the trip. After sign-in comes a **landing** moment: the distributor's logo and name (the shop's, for a retailer), the person's name, and which app this is — then the home screen.

**Role election at sign-in, downward only.** A device asks for the role it needs and the auth service grants it only downward — an owner may act as manager, accountant, warehouse, delivery or salesperson; a manager as warehouse, delivery or salesperson; other staff only as themselves plus the *extra roles* the owner or manager grants them; a retailer or platform admin never as anything else. The token carries the **elected** role, so the services, the permission matrix and row-level security are untouched, and the person stays the actor on every audit row. An owner token is never let into a field app: a van phone must never hold a key to owner-service.

| #   | Role                      | Who signs in            | Working surface                   | Service : port           | What they do there                                                                                        |
| --- | ------------------------- | ----------------------- | --------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------- |
| 1   | Owner                     | `owner`                 | Desk, phone secondary             | owner-service : 3001     | Day numbers with graphs, approvals, live map, prices, schemes, credit, settings, own branding, imports    |
| 2   | Manager (and accountant)  | `manager`, `accountant` | Desk, a few phone jobs            | manager-service : 3002   | Order queue, GRN review, billing desk, trip planning, load-out approval, day-end, registers, Tally export |
| 3   | Sales                     | `salesperson`           | Phone; works offline              | sales-service : 3003     | Beat, shop check-in, order entry, bargain request, visits, targets. Never sees cost, never collects money |
| 4   | Warehouse                 | `warehouse`             | Phone in the aisle                | warehouse-service : 3004 | Gate count, scan supplier bills, pick, pack (the invoice is issued here), load sheets, challans           |
| 5   | Delivery                  | `delivery`              | Phone, one-handed, GPS; offline   | delivery-service : 3005  | Trip, stops, proof of delivery, returns, collect cash / UPI / cheque, van sales, settlement               |
| 6   | Retailer                  | `retailer`              | Phone; online only                | retailer-service : 3006  | See bills and outstanding, reorder, pay online, track delivery; one card per linked distributor           |
| —   | Platform console (separate app) | `platform_admin`  | Web                               | admin-service : 3007     | Onboard distributors, plans and subscription state, time-boxed owner-approved support access              |
| —   | Sign-in for all           | every role              | —                                 | auth-service : 3000      | Username + password, our own tokens, role election, switch distributor                                    |
| —   | Worker                    | system                  | —                                 | pg-boss                  | Outbox relay, retention, document intake, rollups, notifications                                          |

**The seven per-role web apps are retired when the one app lands, not kept beside it** — confirmed by the founder on 2026-09-21. Two front doors would be two things to prove, for ever, and nothing is lost: every screen file moves into the one app unchanged. The console stays separate; platform staff are not a distributor's users.

**Decided 2026-09-05:** the **retailer role is in scope now**, not "future" as v1.0 stated — the shop places its own orders and pays online. **Decided 2026-09-05:** the **platform console is v1**; v1.0 had no platform administration surface.

Roles that v1.0 listed and the product does not have: **Data Entry Operator** (orders are captured by the salesperson, the shop, or the manager's desk — nobody re-keys an invoice), **Branch Manager** (see Branches below), **Manufacturer portal** (out of scope), and separate **Warehouse Manager / Warehouse Staff** (one `warehouse` role).

---

# How Work Flows

The v1.0 flow on this page read "Sales Order → Invoice → Picking". That is corrected: **the invoice is issued at pack, by the warehouse, after picking** (docs/15 D15), because a short pack must change the bill, not the order.

1. **Order** — the salesperson captures it on the beat, the shop places it in the retailer view, or the desk keys a phone order. The price engine and credit check run before submit.
2. **Approve** — only if a bargain, a credit breach or a minimum-order-value rule needs it. Otherwise the order auto-confirms and stock is reserved.
3. **Pick** — consolidated picklist by SKU, FEFO lots, actual lots recorded.
4. **Pack** — per order; short packs are pack rows, never order edits. **The GST invoice is issued here**, on the distributor's own numbering series, with their name, logo and UPI QR.
5. **Load out** — the trip is planned from a planning board, then a load sheet plus delivery challan; **the manager approves the load-out** (Decided 2026-09-05) and the warehouse device waits for it; stock moves warehouse → vehicle. **No van leaves with a bill nobody counted out** (Decided 2026-09-14).
6. **Deliver** — trip and stops, proof of delivery, partial delivery becomes a credit note, failed delivery leaves stock on the vehicle.
7. **Collect** — **only the delivery crew collects money, or the shop pays online** (Decided 2026-09-04). The salesperson never records a receipt; the back office may record an office payment. Receipts allocate oldest bill first into a double-entry journal that must balance at commit.
8. **Settle and reconcile** — vehicle check-in, cash settlement with an owner-set variance tolerance, day-end registers, bank deposits. Money moves exactly once: banking, undoing and settling a receipt lock it, so only one of them can win (Decided 2026-09-14).

Stock comes in through a **zero-typing pipeline**: blind gate count → QR / IRN verification → LLM vision extraction → validators → SKU match → human review on the phone → one idempotent GRN commit. A human always reviews before the GRN is posted. Bills a brand raises in its own DMS are **imported, never re-invoiced**.

---

# Technology Stack

**Decided 2026-09-04 (this replaces the v1.0 stack table entirely): TypeScript everywhere.** No Flutter, no Next.js, no Redis, no BullMQ, no AWS SDK.

| Layer                      | Technology                                                                                                | Note                                                                                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Language                   | TypeScript 6.0, Node 24                                                                                   | exactly one TypeScript version per workspace                                                                                                |
| Backend services           | NestJS 12 on Fastify 5                                                                                    | eight service packages — seven role services plus `auth-service` — and a worker; ~20 lines each, composed from shared libraries            |
| API                        | oRPC 1.15, contract-first, Zod 4 schemas                                                                  | one shared contract; OpenAPI, Swagger UI and Scalar generated from it                                                                       |
| Database                   | PostgreSQL 17, one database                                                                               | `tenant_id` on every tenant table, RLS enabled and FORCED                                                                                   |
| ORM and migrations         | Drizzle ORM + drizzle-kit                                                                                 | 139 tables, 48 migrations, expand-only                                                                                                      |
| Background jobs            | pg-boss on the same PostgreSQL                                                                            | outbox relay, retention sweep, PDF rendering, document intake                                                                               |
| Cache and queue            | **None**                                                                                                  | PostgreSQL is the only shared state; services are stateless                                                                                 |
| Object storage             | Own driver — local filesystem by default, S3 SigV4 signed by hand                                         | invoice photos, proof of delivery, PDFs, logos; no cloud account needed to develop                                                          |
| Authentication             | Own auth service — username + password (argon2id), EdDSA access tokens, rotating refresh token per device | **Decided 2026-09-04:** OTP is a later layer on top, not a replacement                                                                      |
| Authorisation              | Per-endpoint permission matrix, seven roles, plus PostgreSQL row-level security                           | tested for every endpoint × every role; the elected role is what the token carries                                                          |
| Documents                  | Own dependency-free PDF renderer                                                                          | invoice A4 / A5 / thermal, credit note, Rule 55 challan, receipt — all white-labelled                                                       |
| Apps                       | Expo (React Native) + expo-router, one codebase = website + Android + iOS                                 | a screen imports only the shared kit, never `react-native` or `react-dom`; the shell follows the viewport, desk at 1024 px and up           |
| Offline                    | Our own delta-sync client on SQLite; the upload endpoint never answers 4xx                                | sales and delivery work offline; no third-party sync engine                                                                                 |
| Hosting                    | Oracle Cloud Always Free (Mumbai) + Cloudflare Pages + R2 backups; Caddy with automatic Let's Encrypt      | **Decided 2026-09-21**; PostgreSQL self-hosted because free managed PostgreSQL cannot create the row-level-security bypass role             |
| CI                         | GitHub Actions; one arm64 container image, all-in-one process mode for the pilot                          | the image is built on the Mac or in CI and shipped as an artifact — never built on the free VM, which has too little memory                 |
| Monitoring and logging     | Cut to what hosting needs for the pilot                                                                   | returns at go-live and grows with the customer count                                                                                        |

---

# Scope

## In v1

Identity and access, tenancy and settings, catalog (global curated plus per-distributor overlay), retailers, pricing and schemes, inventory, procurement and goods receipt, orders, warehouse, billing, receivables, delivery, document intake, integrations (generic importer, Tally export, brand-DMS import), claims, notifications, reporting, incentives, and the platform console.

**Decided 2026-09-21, and ahead of go-live:** the **Welcome screen and landing moment** in every app; **role election at sign-in**, downward only, with extra roles an owner or manager may grant; and **one app in the store and one website** that becomes the right app after sign-in.

**Decided 2026-09-05: all AI features are in v1, before the pilot** — WhatsApp free-text and voice order capture parsed into a draft order and **always human-confirmed**, demand forecasting and reorder suggestions for purchase planning, and route sequencing that the driver may override. This overrides the earlier deferral of voice, parsing and routing.

**Decided 2026-09-04:** data migration from any source (TradeEzee, Marg, Busy, Tally, FieldAssist, Excel) is one **generic importer** — upload, preview, map columns, save the profile, dry run, commit — not a per-vendor connector.

## Not in v1

- **Branches.** **Decided 2026-09-05:** one tenant = one distributorship, with many warehouses, vehicles and teams. Multi-branch is v2 — each branch its own tenant plus an owner group view. v1.0 personas assumed a Branch Manager role; there is no branch entity.
- **Fintech.** Revenue is the distributor's subscription. No lending, no payment aggregation.
- **Per-tenant custom roles.** One fixed, tested permission matrix. Settings, feature flags, numbering series, credit modes, schemes and tolerances are configurable; roles, state machines and approval kinds are not.
- **Racks, bins and barcode scanning.** The only QR read is the supplier e-invoice.
- **Languages other than English.** **Decided 2026-09-04:** English only for now.

### Cut from the launch programme on 2026-09-21, with the event that brings each back

The founder cut the quality programme to fit the launch date. Everything below is cut **for this pilot**, not for ever.

| Cut                                                         | Comes back                                          |
| ----------------------------------------------------------- | ---------------------------------------------------- |
| Performance, database tuning and search                     | Before about ten paying tenants                     |
| Accessibility and a hardened public surface                 | Before a public product or public sign-up           |
| Observability and DevOps beyond what hosting needs          | At go-live                                          |
| Localization, and the TradeEzee import                      | At cut-over, when the founder moves his real book   |
| A larger automated test suite                               | Before customer number two                          |
| iOS beyond a boot check, and full device validation         | One complete Android and iOS pass at the end        |

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

| Page                                                                                                           | What it answers                                                                          |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Build Status & Roadmap                                                                                         | The live scoreboard: what is built, what is proven, the seven days, and where it is hosted |
| [Vision](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1048577)                           | Where the product is going and why                                                       |
| [Mission](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1605635)                          | What we do every day to get there                                                        |
| [Goals](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1212417)                            | Business and product goals, and their non-goals                                          |
| [Problem Statement](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1081345)                | The problems being solved, traced to modules and procedures                              |
| [Pain Point Analysis](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/2097154)              | Observed pain points, prioritised                                                        |
| [Target Market & Customer Segments](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/786434) | Who buys, the pilot customer, segment characteristics                                    |
| [Personas](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1966081)                         | The seven roles, what each may and may not do, and what they see                         |
| [Product Principles](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1900545)               | The rules every design decision is measured against                                      |
| [Success Metrics (KPIs)](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1802241)           | What we measure, and where each number comes from                                        |
| [AS-IS Business Process](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1736714)           | How distributors work today                                                              |
| [TO-BE Business Process](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1441794)           | How the product changes that                                                             |
| Seven Apps & Workflows                                                                                         | The six roles in one app, what each may do, and the cross-app workflows                  |
| Architecture & Technology                                                                                      | Repository layout, the service and port map, the stack as built, and the deployment shape |
| Data, Security & Multi-tenancy                                                                                 | Tenancy, forced RLS, the permission matrix, retention and the DPDP commitments           |
| Design System & Brand                                                                                          | Layout A Ledger, the two densities, palette, type, numbers, haptics                      |
| Integrations & Data Migration                                                                                  | The generic importer, Tally export, brand-DMS coexistence, no vendor API                 |
| Open Questions & Risks                                                                                         | What is still undecided, unbuilt or risky, with defaults and mitigations                 |
| Phase 2 & Future Enhancements                                                                                  | What is deliberately after v1, and why each item waits                                   |
| Founder Decisions Register                                                                                     | Every dated decision that binds the space (mirroring `docs/22` §8)                       |

---

# Open Questions

1. **Invoice series at cut-over** from the pilot's existing ERP: continue the old numbers or start fresh? Configurable either way; needed before go-live.
2. **The real data extract.** What it turns out to be decides the work: a Distribution OS book is re-checked for money errors on a copy, trip by trip, with the founder signing off; an old-system export (TradeEzee, Tally, Excel) is an import through the generic importer. Nothing is read in place. A prior read-only check found **no real trade** in the founder's own database — every row came from the demo seed — so the open question is whether a real book exists anywhere yet.
3. **Sample exports** from the pilot's ERP (party master, item master, outstanding) — the generic importer does not wait for them.
4. **GST composition scheme**: which pilot shops, if any, are under it.
5. **Rate requests on drafts that are never placed**: should such a request lapse on its own, and after how long? Today it simply waits and the desk reads "Not placed yet".
6. **Accounts and choices owed before go-live**: an Oracle Cloud account in the Mumbai region (it requires a real credit card — PIN-debit, prepaid and virtual cards are refused), a Cloudflare account and API token, and whether the pilot URL is gated or public (gated recommended). The **domain is done** — `distributionos.in`, bought on Hostinger on 21 September 2026, with its nameservers now moving to Cloudflare.

---

# What Changed in Version 3.0

| Changed              | From (v2.0, 5 September 2026)                                    | To (21 September 2026)                                                                                                     |
| -------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Project status       | 14 backend modules verified; "app screens not started"           | Backend and frontend both complete; 23 modules, 139 tables, all seven apps gated green                                     |
| Quality              | Verification gates per module                                    | Two QA batches: 34 findings fixed in batch 1, 153 of 158 merged in batch 2                                                 |
| Shape of the product | Seven applications, one per role                                 | **One app** — one install, one website — that becomes the right app after sign-in; the console stays separate              |
| Sign-in              | Username and password, one role per membership                   | Welcome screen, landing moment, and **role election downward only**, with extra roles an owner or manager grants           |
| Plan                 | No date; deployment deliberately later                           | **Seven days, live by Saturday 27 September**, gated by a seven-day business simulation that ends in arithmetic            |
| Hosting              | Not chosen                                                       | Oracle Cloud Always Free (Mumbai) + Cloudflare Pages + self-hosted PostgreSQL 17, at `distributionos.in`                    |
| Non-negotiables      | Ten                                                              | Thirteen — a shared device keeps nothing of the last person, the app never claims work is safe when it is not, and entered money is never deletable |

The version 1.0 corrections recorded in version 2.0 still stand: the source of truth moved to the repository, the technology stack became TypeScript end to end, the invoice is issued at pack rather than before picking, only delivery collects money, and the Data Entry Operator and Branch Manager roles do not exist.

Product name and app names were set on 5 September 2026, and layout **A Ledger** was chosen the same day and applied to every screen. The one app, role election and the go-live date were set on 21 September 2026; this page is next due for review the morning after go-live.
