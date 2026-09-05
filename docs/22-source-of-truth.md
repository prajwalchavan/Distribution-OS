# Distribution OS — single source of truth

**What this file is.** The one document that survives everything: context compression in Claude sessions, laptop sleeps, model
switches, a new developer. It holds the product's _shape_ (who uses which app, how work and money flow between the apps, the rules
that can never be broken) and the _founder's decisions_, each dated. It is short on purpose, so it is read in full at the start of
every session. Where it points to another document, that document holds the detail; where it states a rule, this file wins.

**How it is kept true.**

1. Any founder decision, correction or new requirement is written into this file **in the same turn it is given** (the decisions
   register in §8 and, if a flow changed, the diagram it changed). The build status is _not_ kept here: that lives in
   `docs/18-build-log.md` and changes every hour; this file changes only when the product changes.
2. Every session reads this file first, before `docs/18-build-log.md` (`CLAUDE.md` says so).
3. Diagrams are Mermaid text, so they diff in git, render on GitHub
   (https://github.com/prajwalchavan/Distribution-OS/blob/main/docs/22-source-of-truth.md) and in the Claude desktop app, and can be
   edited without a drawing tool. `docs/design/five-apps-flow-atlas.html` was the earlier, five-app illustrated version; it is kept
   as history and is superseded by this file wherever the two disagree.
4. The change log in §11 records every edit with its date and source (founder message, review, build).

---

## 1. The product in five lines

Distribution OS is a multi-tenant SaaS for Indian FMCG distributors (manufacturer → **distributor** → retailer), sold by subscription
to the distributor. One distributor is one **tenant**; every rupee and every piece of stock is recorded in append-only ledgers under
that tenant. Six apps, one per role, each talking to its own backend service, all on one Postgres database with row-level security.
The pilot customer is **Tarsun Enterprises, Kalyan West** (Too Yumm on FieldAssist DMS, Campa, MOM makhana; ~36 shops in the demo
data). Solo founder; built for lakhs of users from day one; local database with dummy data first, deployment later.

## 2. People, apps and services

Founder decision (2026-09-04): **every role gets its own app**; the manager and the accountant share one. Each app has its own backend
service so a role can only reach the endpoints its service mounts; the permission matrix then decides per endpoint inside that.

| #   | App (package)                        | Who signs in                              | Device                            | Service : port             | What they do there                                                                                                                          |
| --- | ------------------------------------ | ----------------------------------------- | --------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Owner (`frontend/owner-app`)         | `owner`                                   | Web + phone                       | `owner-service` : 3001     | Day numbers **with graphs** (growth, performance), approvals, live map, prices, schemes, credit, settings, **own branding**, imports        |
| 2   | Manager (`frontend/manager-app`)     | `manager`, `accountant`                   | Web + phone                       | `manager-service` : 3002   | Order queue, GRN review, billing desk, day-end, registers, Tally export (accountant: read + exports)                                        |
| 3   | Sales (`frontend/sales-app`)         | `salesperson`                             | Phone (offline before pilot)      | `sales-service` : 3003     | Beat, shop check-in, order entry, bargain request, visits, own targets. **Never sees cost, never collects money**                           |
| 4   | Warehouse (`frontend/warehouse-app`) | `warehouse`                               | Phone + desk                      | `warehouse-service` : 3004 | Gate count, scan supplier bills, pick, pack (invoice is issued here), load sheets, challans                                                 |
| 5   | Delivery (`frontend/delivery-app`)   | `delivery`                                | Phone (offline before pilot, GPS) | `delivery-service` : 3005  | Trip, stops, proof of delivery, returns, **collect cash / UPI / cheque**, van sales, settlement                                             |
| 6   | Retailer (`frontend/retailer-app`)   | `retailer` (one login, many distributors) | Phone, online only                | `retailer-service` : 3006  | See bills and outstanding, reorder, **pay online**, track delivery; one card per linked distributor                                         |
| 7   | Admin (`frontend/admin-app`)         | `platform_admin` (Distribution OS staff)  | Web                               | `admin-service` : 3007     | Onboard distributors, plans and subscription state, support-access grants (time-boxed, owner-approved, audited). v1 per founder 2026-09-05. |
| —   | Sign-in for all six                  | every role                                | —                                 | `auth-service` : 3000      | Username + password, our own tokens; switch distributor for users with more than one membership                                             |
| —   | Worker (`backend/worker`)            | system                                    | —                                 | pg-boss                    | Outbox relay, retention, document intake jobs, rollups, notifications                                                                       |

Every service has `/health`, `/swagger`, `/docs` and `/docs/openapi.json`. All demo passwords are `Dos@1234`; usernames are in
`docs/18-build-log.md`.

## 3. System map

```mermaid
flowchart LR
  subgraph apps [Six apps · web + Android + iOS]
    OW[Owner]
    MG[Manager / Accountant]
    SA[Sales]
    WH[Warehouse]
    DL[Delivery]
    RT[Retailer]
  end
  AUTH[auth-service :3000<br/>username + password<br/>EdDSA tokens, refresh per device]
  subgraph services [One NestJS service per app · same core library]
    OS[owner-service :3001]
    MS[manager-service :3002]
    SS[sales-service :3003]
    WS[warehouse-service :3004]
    DS[delivery-service :3005]
    RS[retailer-service :3006]
  end
  WK[worker · pg-boss<br/>outbox relay, doc intake, rollups, WhatsApp]
  DB[(Postgres 17<br/>one database, tenant_id + forced RLS<br/>append-only stock + money ledgers)]
  OBJ[(Object storage<br/>invoice photos, POD, PDFs, logos)]
  EXT[Outside: WhatsApp, GST IRP / e-way bill, maps,<br/>brand DMS exports, Tally XML, CSV/Excel imports]

  OW & MG & SA & WH & DL & RT -- sign in --> AUTH
  OW --> OS
  MG --> MS
  SA --> SS
  WH --> WS
  DL --> DS
  RT --> RS
  OS & MS & SS & WS & DS & RS --> DB
  OS & MS & SS & WS & DS & RS --> OBJ
  WK --> DB
  WK <--> EXT
```

Rules that shape the map: a service serves only its roles (any other role gets 403 before business logic); every endpoint has a row in
the permission matrix (`backend/libs/contracts/src/permissions.ts`) and the guard fails closed on an undeclared route; every service is
stateless and can run as many copies as needed; the database is the only shared state.

## 4. The loop every order travels (order to cash)

```mermaid
flowchart TB
  subgraph S [Sales app · salesperson]
    S1[Beat for today] --> S2[Check in at the shop<br/>geo-tag as evidence, never a block]
    S2 --> S3[Order: reorder last / suggested / grid<br/>cases + pieces, live ATP hint]
    S3 --> S4{Price engine + credit check<br/>on the device}
    S4 -- inside limits --> S5[Submit → submitted]
    S4 -- bargain or over limit --> S6[Approval request]
  end
  subgraph R [Retailer app · shop]
    R1[Reorder / free-text on WhatsApp] --> S5
  end
  subgraph O [Owner app]
    S6 --> O1[Approve / reject<br/>price variance, credit, MOV, bargain]
  end
  O1 --> C[Server re-prices at the same version,<br/>reserves stock → confirmed]
  S5 --> C
  subgraph W [Warehouse app]
    C --> W1[Fulfilment queue by beat / trip]
    W1 --> W2[Picklist consolidated by SKU, FEFO lots] --> W3[Pick actual lots → picking]
    W3 --> W4[Pack per order → packed<br/>short-packs are pack rows, never order edits]
    W4 --> W5[GST invoice issued at pack<br/>tenant series, own name and logo, UPI QR]
    W5 --> W6[Load sheet + delivery challan<br/>crew count confirmed by PIN → dispatched<br/>stock: warehouse → vehicle]
  end
  subgraph D [Delivery app · crew]
    W6 --> D1[Trip: next stop, maps hand-off]
    D1 --> D2{At the door}
    D2 -- all --> D3[Delivered + proof of delivery]
    D2 -- part --> D4[Partial: per-line qty, reason → credit note]
    D2 -- none --> D5[Failed: reason, stock stays on vehicle]
    D3 & D4 --> D6[Collect: cash / UPI with UTR / cheque<br/>receipt allocated oldest bill first]
    D1 --> D7[Van sale from vehicle stock<br/>normal invoice series]
    D6 --> D8[Check-in: unsold stock counted back,<br/>cash settlement, variance needs owner]
  end
  subgraph M [Manager app · desk]
    D8 --> M1[Day-end: registers, bank deposits,<br/>cheques, brand-DMS bills captured]
  end
  D6 --> RX[Retailer gets invoice, POD, receipt on WhatsApp;<br/>can also pay online in the retailer app]
```

The three state machines behind this loop are the code in `backend/libs/domain/src/state-machines/` and the apps never set a state
column by hand:

- **Order**: draft → submitted → confirmed → picking → packed → dispatched → delivered | partially_delivered → closed; cancel allowed up to
  confirmed; `return_undelivered` sends dispatched back to packed.
- **Trip**: planned → loading → active → closing → settled | settled_with_variance; **stop**: pending → started → arrived → delivered |
  partial | failed.
- **Invoice**: draft → issued → partially_paid → paid; issued may be written_off or cancelled (before dispatch and before any money);
  once money lands the only correction is a credit note. "Overdue" is computed, never stored.

## 5. Stock in: supplier bill to goods received (zero typing except the gate count)

```mermaid
flowchart LR
  A[Warehouse app: blind gate count,<br/>photograph / share the supplier bill] --> B{QR on the bill?}
  B -- yes --> C[Verify e-invoice signature<br/>IRN, GSTINs, totals]
  B -- no --> D
  C --> D[Worker: vision extraction of every page<br/>pack sizes x90 / _120 / CS1 normalised]
  D --> E[Validators: GST arithmetic, HSN, page completeness,<br/>lines vs QR, three-way match with PO and lorry receipt]
  E --> F[SKU match: aliases → external codes → fuzzy → human]
  F --> G[Review on the phone: line cards with crops,<br/>short / damaged, batch + expiry]
  G --> H[Commit once, idempotent: supplier invoice, lots,<br/>stock ledger GRN rows, purchase cost, AP journal]
  H --> I[Stock visible to sales within one sync]
  J[Too Yumm bills billed in FieldAssist DMS] --> D
  J -.-> K[Committed as brand_dms_import sales:<br/>receivable in, NO stock movement<br/>the brand moved the goods on its own documents.<br/>NEVER a second legal invoice]
```

Purchase cost lands in `tenant_product_costs`, which only owner, manager, accountant and system can read. That is a database rule with
tests, not an app rule.

## 6. Money: who may touch it and where it goes

```mermaid
flowchart LR
  subgraph collect [Who may record a payment]
    DL[Delivery crew at the door<br/>cash · UPI · cheque]
    RT[Retailer pays online<br/>UPI QR / link against own bills]
    DESK[Owner / manager / accountant<br/>payment received at the office]
    SP[Salesperson]:::no
  end
  DL & RT & DESK --> RC[Receipt: append-only, client receipt no,<br/>allocated bill-to-bill oldest first unless tagged]
  RC --> J[(Double-entry journal<br/>must balance at commit, enforced in the database)]
  RC --> OUT[Retailer outstanding + ageing buckets<br/>0-7 · 8-15 · 16-30 · 31-60 · 61-90 · 90+]
  CHQ[Cheque] --> DEP[Deposited] --> BNC{Bounced?}
  BNC -- yes --> REV[Reversal + bank charges, bill reopens]
  CD[Cash discount: shown on the bill,<br/>realised as a credit note only when paid on time]
  WO[Write-off: back office only]
  classDef no fill:#fdd,stroke:#c00,color:#600
```

Founder rule (2026-09-04): **the salesperson never collects money** — the sales service has no receipt endpoint and the matrix never
grants one. Cash on a vehicle counts toward expected cash at settlement; variance beyond the owner's tolerance blocks trip close.

## 7. Sign-in and permissions

```mermaid
sequenceDiagram
  participant App
  participant Auth as auth-service :3000
  participant Svc as role service
  participant DB as Postgres (RLS)
  App->>Auth: POST /auth/login {username, password, deviceId}
  Auth->>DB: verify argon2id hash, lockout after 5 failures / 15 min
  Auth-->>App: access token (15 min) + refresh token (per device, rotating)
  App->>Svc: request with Authorization: Bearer
  Svc->>Svc: verify token, check PERMISSIONS[method + route] for the role
  Svc->>DB: withTenant(): SET LOCAL ROLE app_rw, app.tenant_id, app.actor_id, app.actor_role
  DB-->>Svc: rows the policy allows for that tenant and role
  App->>Auth: POST /auth/refresh (reuse of an old refresh token revokes the session)
  App->>Auth: POST /auth/switch-tenant (retailer or staff with several distributors)
```

OTP (SMS / WhatsApp) is a **later enhancement layered on top** of username + password, not a replacement. Distribution OS branding
appears only on the sign-in screen; inside every app and on every printed document the distributor sees their **own** name and logo.

## 8. Founder decisions register (dated; newest last)

| Date       | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                        | Where it is enforced / detailed                                                              |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 2026-08    | TypeScript everywhere; van sales allowed (vehicle is a stock location); GPS tracking of delivery staff; iOS + Android; revenue = distributor subscription; no fintech                                                                                                                                                                                                                                                                           | docs/15 F-series, ADR 0013                                                                   |
| 2026-08    | Tarsun bills from TradeEzee (Windows ERP); Too Yumm runs on FieldAssist DMS; coexist by import, never a second legal invoice                                                                                                                                                                                                                                                                                                                    | docs/15 F4–F5, ADR 0014, docs/05                                                             |
| 2026-09-04 | Repo root holds only `backend/`, `frontend/`, `docs/`, `CLAUDE.md`; every service and app an independent package                                                                                                                                                                                                                                                                                                                                | docs/19                                                                                      |
| 2026-09-04 | **Six apps, one per role**; manager and accountant share; each app on its own backend service; one Postgres database the founder views in DBeaver                                                                                                                                                                                                                                                                                               | §2 above, docs/19, docs/21                                                                   |
| 2026-09-04 | **Username + password**, our own token service, no third party; OTP and resend-OTP are a future enhancement                                                                                                                                                                                                                                                                                                                                     | auth module, §7                                                                              |
| 2026-09-04 | **Permission matrix**: which role may call which endpoint, tested for every endpoint × every role                                                                                                                                                                                                                                                                                                                                               | `permissions.ts`, `describePermissionMatrix`                                                 |
| 2026-09-04 | **Backend first, production grade on the local database**; every endpoint of every service built and tested; then the six apps one at a time                                                                                                                                                                                                                                                                                                    | CLAUDE.md, docs/18                                                                           |
| 2026-09-04 | Swagger on every service with **sample payloads that actually work** (built from demo rows, not placeholders)                                                                                                                                                                                                                                                                                                                                   | `/swagger`, `pnpm smoke`                                                                     |
| 2026-09-04 | Owner app must have **graphs** wherever possible: growth, how the distributorship is performing                                                                                                                                                                                                                                                                                                                                                 | reporting module serves chart-ready series                                                   |
| 2026-09-04 | UI: Claude proposes the design system, founder reviews; modern look per current standards; **English only** for now; **online-first now, offline for sales + delivery before the pilot**; **Android and iOS**; haptics and "feel good"                                                                                                                                                                                                          | docs/design/UX-00…03                                                                         |
| 2026-09-04 | **3–4 layout mockups as images before any frontend code**; founder picks one letter for all six apps, **after the backend is complete**                                                                                                                                                                                                                                                                                                         | artifact link in docs/18; A Ledger / B Instrument / C Panel / D Signal                       |
| 2026-09-04 | Invoice series: per-tenant configuration, never hard-coded (cut-over series undecided)                                                                                                                                                                                                                                                                                                                                                          | docs/17 §D1, `numbering_series`                                                              |
| 2026-09-04 | Cash discount: not important now; realised at receipt only                                                                                                                                                                                                                                                                                                                                                                                      | docs/17 §D2                                                                                  |
| 2026-09-04 | Shops **are** GST-registered: B2B tax invoice is the primary document; B2C path kept for shops without GSTIN                                                                                                                                                                                                                                                                                                                                    | docs/17 §D3                                                                                  |
| 2026-09-04 | **Only delivery collects money, or the shop pays online; the salesperson never does**; desk may record office payments                                                                                                                                                                                                                                                                                                                          | docs/17 §D4, §6 above                                                                        |
| 2026-09-04 | No van-sale numbering: van sales use the normal invoice series                                                                                                                                                                                                                                                                                                                                                                                  | docs/17 §D5                                                                                  |
| 2026-09-04 | **No brand exists: create one.** Product is **white-labelled**: each distributor sees their own name and logo in the owner app and on every document                                                                                                                                                                                                                                                                                            | docs/17 §D6, `tenant_settings` branding keys                                                 |
| 2026-09-04 | Data migration is a **generic importer** (upload → preview → map columns → save profile → dry run → commit) for any source: TradeEzee, Marg, Busy, Tally, FieldAssist, Excel                                                                                                                                                                                                                                                                    | docs/17 §D7, integrations plan                                                               |
| 2026-09-04 | Demo data must cover **three distributors, staff under each, shops linked to more than one distributor**                                                                                                                                                                                                                                                                                                                                        | CLAUDE.md, chain step 11                                                                     |
| 2026-09-05 | **Keep developing until a hard blocker**; never stop between backend modules; verify, record, launch next in the same turn                                                                                                                                                                                                                                                                                                                      | CLAUDE.md session protocol, docs/18                                                          |
| 2026-09-05 | Commit at module boundaries with a message stating what is complete and what is in progress                                                                                                                                                                                                                                                                                                                                                     | git history                                                                                  |
| 2026-09-05 | This file is the single source of truth; updated in the same turn as any founder decision                                                                                                                                                                                                                                                                                                                                                       | §0 rules, CLAUDE.md                                                                          |
| 2026-09-05 | **Layout chosen: A Ledger** (of A Ledger / B Instrument / C Panel / D Signal). Applies to all six apps; design system finalised on it.                                                                                                                                                                                                                                                                                                          | docs/design/UX-00-design-system.md, layout artifact                                          |
| 2026-09-05 | **Accountant scope = money desk + reads**: may record office receipts, deposits, cheque bounces, write-offs; reads and exports everything; NO prices, schemes, credit limits, approvals or settings.                                                                                                                                                                                                                                            | `permissions.ts` (ACCOUNTANT narrowed), docs/23                                              |
| 2026-09-05 | **Manager PIN for load-out is given in the MANAGER app** (manager approves the load sheet from their own phone or desk; the warehouse device waits for it), not typed on the warehouse phone.                                                                                                                                                                                                                                                   | warehouse `loadSheets.confirm` + manager approval, docs/23                                   |
| 2026-09-05 | docs/23 screen inventory is binding: the retailer app must be able to PLACE orders (`orders.submit` for the retailer role); the salesperson may SEE a shop's outstanding and credit check (never collect); owner Settings needs branding/numbering/settings endpoints; owner graphs need `reporting.series`.                                                                                                                                    | docs/23, platform-gaps slice in the chain                                                    |
| 2026-09-05 | Design system finalised on A Ledger (`docs/design/UX-00-design-system.md`, adversarially reviewed: 17 findings fixed). Brand name still to pick: **Vitran** (recommended) / Bahi / Distribution OS.                                                                                                                                                                                                                                             | UX-00 §3.6, §9, §10                                                                          |
| 2026-09-05 | **Product name: Distribution OS.** App names: "Distribution OS - Owner", "Distribution OS - Manager", "Distribution OS - Sales", "Distribution OS - Warehouse", "Distribution OS - Delivery", "Distribution OS - Retailer" (store listing, app icon label, sign-in screen). Inside the apps the distributor's own name shows (white-label).                                                                                                     | UX-00 §10 brand, app packages                                                                |
| 2026-09-05 | **Branches: one tenant = one distributorship** for pilot and v1. Multi-branch is v2: each branch its own tenant plus an owner group view.                                                                                                                                                                                                                                                                                                       | schema (no branch entity), Confluence Personas                                               |
| 2026-09-05 | **AI features are ALL in v1 (before pilot)**: WhatsApp free-text → draft order (LLM parse against the shop's own SKU history, always human-confirmed), voice order capture (speech → same parser), demand forecasting / reorder suggestions for purchase planning, and route optimisation (stop sequencing by distance and time windows, driver may override). This overrides docs/03 "must not build" for routing and the post-pilot deferral. | new module 12 `ai` (intake parsing, voice, forecasting, routing) in the chain                |
| 2026-09-05 | **Positioning stays multi-industry** (FMCG first; pharma, electricals, dairy, agri as markets) while the product remains FMCG-shaped until a second-industry customer appears.                                                                                                                                                                                                                                                                  | Confluence Vision / Target Market                                                            |
| 2026-09-05 | **Platform console in v1**: a seventh app + service "Distribution OS - Admin" for organisation onboarding, plans and subscription state, support-access grants (time-boxed, owner-approved, audited). Revenue stays subscription; no fintech.                                                                                                                                                                                                   | new module 13 `platform-admin` (admin-service :3007, admin-app)                              |
| 2026-09-05 | Confluence space is rewritten from this file (PM/TPM voice); docs/22 stays the source of truth, Confluence mirrors it.                                                                                                                                                                                                                                                                                                                          | docs/24 audit, Confluence pages                                                              |
| 2026-09-05 | Founder wants to SEE any frontend under development in the browser as it is built (web build of each app via the Browser pane / launch.json).                                                                                                                                                                                                                                                                                                   | frontend workflow: every app slice ends with a browser check and a screenshot to the founder |
| 2026-09-05 | **Deployment, least cost, no funding (docs/26, all six confirmed): dev stays on the founder's Mac (cloud only for test and prod); Postgres self-managed in a container on the VM until ~10 paying tenants, then RDS; an all-in-one process mode (seven services + worker in one container) is built for small deployments, split later; offline sync is OUR OWN delta sync (no PowerSync; docs/07 superseded on that point); Android first for the pilot, iOS after; Lightsail Mumbai as the starting compute, the docs/11 shape (Fargate, ALB, RDS) only with revenue.** |
| 2026-09-05 | **Cost stages (docs/26 §4): stage 0 = first run at ₹0 (free credits, sideloaded APK, stub drivers); stage 1 = 1–10 clients at minimum spend (~$40/mo); stage 2 = thousands, spend to scale. The architecture must carry stage 2 from day one (stateless services, RLS multi-tenancy, replica, S3, expand-only migrations); only the infrastructure under it changes.** |

## 9. Non-negotiables (never list)

1. Purchase cost, landed cost and margin are never readable by salesperson, warehouse, delivery or retailer roles — database policy plus tests.
2. The salesperson never records a receipt.
3. Stock ledger and journal lines are append-only; balances are derived; every mutation carries an idempotency key and a client UUIDv7 id.
4. An issued invoice is never edited; corrections are credit or debit notes; a cancelled invoice keeps its number.
5. A brand-DMS sale (FieldAssist) is never re-invoiced; it is imported and linked to the brand's invoice number.
6. Document intake never commits on its own; a human reviews before GRN.
7. State columns change only through the state machines.
8. Offline upload never answers 4xx; rejections are recorded and shown, never lost.
9. A tenant never sees another tenant's rows; a retailer sees only the rows linked to their own shop.
10. Distribution OS branding never appears inside a distributor's documents.

## 10. Open questions for the founder

Deferred requirements and enhancements are kept in `docs/25-phase-2-enhancements.md` (mirrored on the Confluence page "Phase 2 &
Future Enhancements"); the Confluence space mirrors this file page by page from `docs/confluence/*.md` (see its README).

- Invoice series at cut-over from TradeEzee (continue the old numbers or start fresh)? Configurable either way; answer needed before go-live.
- Sample exports from TradeEzee (party master, item master, outstanding) whenever convenient — the importer does not wait for them.
- Which shops in the pilot are under the GST composition scheme, if any.
- Typeface: IBM Plex Sans (recommended: tabular digits at every weight, rupee glyph, Devanagari sibling with the identical digit
  advance) or Inter as drawn in the mockup. The rest of the design system is finalised on A Ledger; this is the one token still open.
- After development (founder, 2026-09-05): install everything needed to run all apps end to end on the Mac and hand over a clear,
  written view of how the pieces run together (what starts, in which order, which port, which sign-in). Tracked in docs/18.

## 11. Change log

| Date       | Change                                                                                                                                                                                                                                                                                                                                                                                              | Source                                                                                                                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-05 | File created: system map, order-to-cash loop, stock-in, money, sign-in diagrams; decisions register consolidated from docs/15, docs/17 §D and the 2026-09-04/05 build sessions                                                                                                                                                                                                                      | Founder: "keep a single source of truth that survives compression"                                                                                                                                                     |
| 2026-09-05 | §8: founder picked layout **A Ledger** for all six apps                                                                                                                                                                                                                                                                                                                                             | Founder message                                                                                                                                                                                                        |
| 2026-09-05 | §8: accountant scope, manager PIN location, docs/23 gaps made binding                                                                                                                                                                                                                                                                                                                               | Founder answers + screen review                                                                                                                                                                                        |
| 2026-09-05 | §8: product name Distribution OS; per-app names; frontend visible in browser during development                                                                                                                                                                                                                                                                                                     | Founder message                                                                                                                                                                                                        |
| 2026-09-05 | §8: branches later; all AI in v1; multi-industry positioning; platform console in v1; Confluence mirrors this file                                                                                                                                                                                                                                                                                  | Founder answers to the Confluence audit                                                                                                                                                                                |
| 2026-09-05 | §5 CORRECTED: the brand-DMS import posts **a receivable and no stock** — the brand's field force moved the goods on its own documents. The node previously read "stock out + receivable in", which is wrong and had propagated into five Confluence pages (TO-BE, Personas, Apps & Workflows, Pain Points, Open Questions & Risks), all now fixed. §10: typeface added as the one open design token | Editorial review against `docs/plans/billing.md` (`importBrandDms`: "posts **no stock** — the goods moved on the brand's own documents") and `docs/plans/integrations.md` guarantee 6 ("zero new `stock_ledger` rows") |
| 2026-09-05 | §10: deployment constraints (least cost, AWS, no local hosting) recorded with six pending confirmations; post-development task: local end-to-end install + written run-through. New `docs/26-environments-and-configuration.md` (local config, env reference, accounts, least-cost environments, build-vs-buy) | Founder messages ("least cost", "no funding", "use AWS", "install what is needed to run E2E locally … after development") |
| 2026-09-05 | §8: all six deployment items decided (dev local; self-managed Postgres; all-in-one mode; own delta sync replaces PowerSync; Android first; Lightsail first, scale later). §10 entry closed | Founder: "1. yes stays local 2. yes works 3. yes for now, will scale later 4. yes ok 5. OK Android first then IOS 6. yes light as much in beginning will then scale" |
| 2026-09-05 | §8: three cost stages (₹0 first run → minimum spend for 1–10 clients → scale at thousands) with the architecture carrying all three | Founder: "aim is to first run app at 0 cost … architecture must be built to support it" |
