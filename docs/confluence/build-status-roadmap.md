# Distribution OS — Build Status & Roadmap

## Document Information

| Property     | Value                  |
| ------------ | ---------------------- |
| Document     | Build Status & Roadmap |
| Product      | Distribution OS        |
| Version      | 2.0                    |
| Status       | Active                 |
| Owner        | Prajwal Chavan         |
| Last Updated | September 2026         |

**Decided 2026-09-05:** this page mirrors `docs/18-build-log.md` in the repository, which is the live build record and changes several times a day. Product shape and founder decisions live in `docs/22-source-of-truth.md`. Where this page and those files disagree, the repository wins and this page is corrected. Every number below was produced by a verification gate, not by an estimate.

---

# Where the build stands

**Decided 2026-09-04: backend first, production grade on the local database** — every endpoint of every service built and tested — then the six role apps one at a time. This replaces the v1.0 space status of "Development — Not Started".

| Checkpoint (2026-09-05)        | Modules verified | Tests green | Endpoint calls exercised | Broken |
| ------------------------------ | ---------------: | ----------: | -----------------------: | -----: |
| Platform-gaps slice, 10:40 IST |               13 |       1,254 |                      844 |      0 |
| Delivery module, 13:45 IST     |               14 |       1,442 |                    1,004 |      0 |

Supporting counts at the delivery checkpoint: **126 tables**, **18 migrations applied** (a re-run is a no-op), **250 procedures declared** in one shared contract of which **203 are live** on a running service, **48 of 48 build/typecheck/lint/test tasks green**, and `db:seed` run twice producing identical row counts across all 126 tables.

Everything runs on the founder's local PostgreSQL 17. **Nothing is deployed, deliberately.**

---

# What "verified" means

A module is not counted above until an **independent gate agent** — not the agent that wrote the code — has run the whole chain on the founder's database and it came back clean:

1. `pnpm install` with the lockfile unchanged.
2. A **forced** full build, typecheck, lint and test pass, then a second one, both green.
3. Generated-README check and formatting check in sync.
4. `pnpm smoke`: sign in as each service's role, read that service's own OpenAPI document, and call **every** operation with the example that document publishes. "0 broken" means no operation failed for a technical reason; correct business refusals (403, 409) are counted separately and expected.
5. `pnpm smoke --destructive`, then re-seed, then `pnpm smoke` again — proving the demo database survives the destructive path.
6. `pnpm db:seed` twice with identical row counts, and `pnpm db:migrate` a no-op.
7. Every service's `/health` and `/docs/openapi.json` checked against the coordination contract, so no module is silently mounted on a service that must not serve it.

The gate finds real defects, and they are fixed before the module is called done — four at the platform-gaps checkpoint, four at the delivery checkpoint (each with a test so it cannot return). That is the point of the gate.

---

# Modules complete

Listed in build order. "Procedures" counts the routes that module declares in the shared contract as of 2026-09-05, including what the platform-gaps slice added to it; the column sums to the 203 live procedures.

| #   | Module                                                                                    |    Procedures | What it gives the business                                                                                                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------------- | ------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Platform — tenancy, identity, idempotency, sync, outbox, retention, object storage, files |            21 | Multi-tenant isolation with forced row-level security, idempotent writes, the sync endpoint that never answers 4xx, own object-storage driver (local by default, S3 SigV4 signed by hand)                                                                                                                             |
| 2   | Auth                                                                                      |            11 | Username + password (argon2id), EdDSA access tokens, rotating refresh token per device, switch distributor, forgot / reset password                                                                                                                                                                                   |
| 3   | Catalog                                                                                   |             3 | The global curated product master, searchable; a distributor may propose a missing product and use it immediately                                                                                                                                                                                                     |
| 4   | Tenant catalog                                                                            |            12 | The distributor's own listings, suppliers, costs, brands, pack configurations, rep authorisations                                                                                                                                                                                                                     |
| 5   | Retailers                                                                                 |            12 | Shop master, beats, credit terms, retailer identities linked across distributors                                                                                                                                                                                                                                      |
| 6   | Pricing                                                                                   |            13 | Tier prices, retailer overrides, stacked schemes, bargain approvals — one engine, `priceOrder()`, used by every surface                                                                                                                                                                                               |
| 7   | Inventory                                                                                 |            13 | Locations, lots, append-only stock ledger, derived balances, sellable stock                                                                                                                                                                                                                                           |
| 8   | Procurement                                                                               |            15 | Purchase orders, supplier invoices, GRN posting, purchase cost in a back-office-only table                                                                                                                                                                                                                            |
| 9   | Orders                                                                                    |            10 | The primary aggregate: capture, credit check, approval, confirmation, state machine                                                                                                                                                                                                                                   |
| 10  | Receivables                                                                               |            21 | Receipts, oldest-bill-first allocation, ageing in six buckets, cheques and bounces, write-offs, double-entry journal that must balance at commit                                                                                                                                                                      |
| 11  | Billing                                                                                   |            18 | GST invoice issued at pack, credit notes, UPI QR, e-way bill entry, GSTR-1-shaped registers                                                                                                                                                                                                                           |
| 12  | Warehouse                                                                                 |            22 | Fulfilment queue, FEFO picklists, pack (**the invoice is issued here**), load sheets, delivery challans                                                                                                                                                                                                               |
| 13  | Platform gaps — a cross-cutting slice, not a new namespace                                | counted above | The 38 procedures the screen inventory asked for, spread across the modules above, plus the `files` module and a dependency-free PDF renderer: signed upload / read URLs, white-labelled invoice, credit note, Rule 55 challan and receipt PDFs, tenant settings and branding, numbering series, feature flags, audit |
| 14  | Delivery                                                                                  |            32 | Vehicles and consents, trips and stops, proof of delivery, doorstep collections, van sales, expenses, settlement, GPS points                                                                                                                                                                                          |

The numbers in that table are simply the order the modules landed in. The **In progress** and **Queued** sections below use the build chain's own step numbers, which start at receivables (step 1) and count only the ten chained modules — so delivery was step 4 and document intake is step 5.

**Decided 2026-09-05 (from the screen inventory in `docs/23`, now binding):** the retailer app places its own orders; the salesperson may see a shop's outstanding and credit check but never records a receipt; the **accountant is money desk plus reads** (office receipts, deposits, cheque bounces, write-offs, every export — no prices, schemes, credit limits, approvals or settings); and the **manager approves load-out from the manager app**, with the warehouse device waiting for it. All four were implemented in the platform-gaps slice.

## Progress, checkpoint by checkpoint

| Checkpoint             | Tests | Smoke calls |
| ---------------------- | ----: | ----------: |
| Swagger phase complete |   534 |         369 |
| Receivables            |     — |         445 |
| Billing                |   828 |         517 |
| Warehouse              |   962 |         610 |
| Platform gaps          | 1,254 |         844 |
| Delivery               | 1,442 |       1,004 |

---

# In progress

| Module                             | State                                                                                                                                                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Document intake** (step 5 of 10) | Contract declared (26 procedures), migrations for the pipeline written and applied, extraction internals in the working tree. The module itself is being built now and is **mounted on no service yet.** |

Document intake is the "zero manual entry" promise: blind gate count → QR / IRN verification → LLM vision extraction → validators → SKU match → human review on the phone → one idempotent GRN commit. **A human always reviews before the GRN is posted** — the pipeline never commits on its own.

---

# Queued, in order

The build order is fixed by the coordination contract, which resolved collisions between the independently written module briefs (six of them claimed the same migration number; seven shared services were each about to be built two or three times). Integrations moved ahead of claims and reporting because both need its export-job queue.

| Step | Module                                                                                                            | Why it is where it is                                                                                                                                                                                                                                                                                                                       |
| ---- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6    | **Integrations** — generic mapped importer, Tally export, FieldAssist import                                      | Contract declared (21 procedures) and migrations written; builds the export queue every later module uses. **Decided 2026-09-04:** data migration is one generic importer (upload → preview → map columns → save profile → dry run → commit) for any source — TradeEzee, Marg, Busy, Tally, FieldAssist, Excel — not a per-vendor connector |
| 7    | **Claims** — scheme, damage and expiry claims to brands                                                           | Consumes billing's registers and integrations' exports                                                                                                                                                                                                                                                                                      |
| 8    | **Notifications** — WhatsApp / SMS adapters, event-driven sends, templates                                        | Carries the invoice, POD and receipt to the shop; also the password-reset channel                                                                                                                                                                                                                                                           |
| 9    | **Reporting** — dashboards, registers, chart-ready series                                                         | **Decided 2026-09-04:** the owner app must have graphs wherever possible (growth, how the distributorship is performing); those series come from here                                                                                                                                                                                       |
| 10   | **Incentives** — plans, targets, slabs, statements                                                                | Closes the salesperson's own-targets screens                                                                                                                                                                                                                                                                                                |
| 11   | **Three-distributor demo data**                                                                                   | **Decided 2026-09-04:** three distributors, staff under each, and shops linked to more than one distributor — the only honest way to prove tenant isolation and the retailer's multi-distributor sign-in                                                                                                                                    |
| 12   | **AI** — WhatsApp free-text and voice order capture, demand forecasting and reorder suggestions, route sequencing | **Decided 2026-09-05: all AI features are in v1, before the pilot.** This reverses the earlier "must not build" line on route optimisation and the post-pilot deferral of voice and WhatsApp parsing. Order drafts from WhatsApp or voice are **always human-confirmed**; the driver may override a suggested route                         |
| 13   | **Platform admin** — admin-service : 3007                                                                         | **Decided 2026-09-05: the platform console is in v1** — distributor onboarding, plans and subscription state, and time-boxed, owner-approved, audited support access. Revenue stays subscription; no fintech                                                                                                                                |

Steps 5 to 11 are chained into one workflow with a hard verification gate between each; steps 12 and 13 launch immediately after it reports, followed by a demo-data refresh and a final gate. **Standing instruction from the founder (2026-09-05): keep developing until a hard blocker** — a turn never ends with nothing running while backend modules remain.

---

# Then: the apps

**Decided 2026-09-05: layout A Ledger**, chosen from four rendered directions (A Ledger, B Instrument, C Panel, D Signal) built at desk width and phone width on real pilot data. The design system is finalised on it and was adversarially reviewed, with 17 findings fixed. **98 screens across the six role apps are inventoried** in `docs/23` with the exact procedures each screen calls — 26 owner, 21 manager, 14 sales, 12 warehouse, 12 delivery, 13 retailer.

App work starts **only when the backend is complete**, then proceeds **one app at a time to done**, not six half-apps. **Decided 2026-09-05:** every app slice ends with the app running in a browser and a screenshot to the founder — the founder sees what is being built while it is being built.

Sequence (owner first because its shell already signs in and lists the pilot's 36 shops; the rest is a plan, not a decision):

1. **Owner** — day numbers with graphs, approvals, live map, prices, schemes, credit, settings, own branding, imports.
2. **Manager** (shared with the accountant) — order queue, GRN review, billing desk, load-out approval, day-end, registers, Tally export.
3. **Sales** — beat, check-in, order entry, bargain request. Never sees cost, never collects money.
4. **Warehouse** — gate count, scan supplier bills, pick, pack, load sheets, challans.
5. **Delivery** — trip, stops, proof of delivery, returns, collections, van sales, settlement.
6. **Retailer** — bills and outstanding, reorder, pay online, track delivery.
7. **Admin console** (web only) — after the six, from the platform-admin service.

Every role app ships as **web + Android + iOS**; the admin console is web. **English only for now.**

---

# Then: offline, pilot, deployment

| Phase                                        | Scope                                                                                                                                                                                                                                                                                                                                 | Gate to the next phase                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Offline**                                  | **Decided 2026-09-04: online-first now, offline for sales and delivery before the pilot** — the two roles that work where there is no signal. The upload endpoint already never answers 4xx: rejections are recorded and shown, never lost. Device-side sync is scoped per role and per beat so a phone syncs kilobytes, not a tenant | A salesperson and a delivery crew complete a full day with the network off, and every rejection is visible afterwards |
| **Pilot at Tarsun Enterprises, Kalyan West** | Real beats, real shops, real money, alongside the existing ERP. Bills the brand raises in its own DMS are imported and linked, **never re-invoiced**                                                                                                                                                                                  | The distributor's day closes in Distribution OS: registers tie, cash settles, outstanding matches                     |
| **Deployment**                               | Cloud, monitoring and logging are **not chosen yet** — deliberately. A Dockerfile exists but has never been built on this machine; CI is the first place it runs                                                                                                                                                                      | Pilot stable                                                                                                          |

The scale rules are already binding on every module rather than being a later phase: stateless services, cursor-paginated lists with hard caps, idempotent mutations, per-tenant fairness, `tenant_id` leading every index, append-only ledgers ready to partition by month, and two connection pools so reads can move to replicas. The load model to design against is 10,000 distributors, 100,000 staff devices, 2,000,000 retailers.

---

# Open decisions and known gaps

Honest list. None of these blocks the current work.

**Waiting on the founder**

1. **Invoice series at cut-over** from the existing ERP — continue the old numbers or start fresh. Configurable either way; the answer is needed before go-live.
2. **Sample exports** from the existing ERP (party master, item master, outstanding) whenever convenient — the importer does not wait for them.
3. **Which pilot shops, if any, are under the GST composition scheme.**
4. **Should a pack that holds no stock be refused?** Today it records a 100 % short pack that can never be billed.

**Carried forward in the build**

- The password-reset token has no delivery channel until notifications is built.
- Logo upload accepts JPEG only.
- On the S3 driver, an uploaded file's status needs a bucket notification or a confirm call; the local driver already flips it.
- Two row-level-security policies to widen in the next schema regeneration (a retailer cancelling a submitted order, and the order-state-transition write path).

**Not in v1, on purpose**

Branches — **decided 2026-09-05: one tenant is one distributorship**; multi-branch is v2, where each branch is its own tenant plus an owner group view. Also out: per-tenant custom roles and configurable order states (one fixed permission matrix tested endpoint × role, state columns change only through the coded state machines), warehouse racks, bins and barcode scanning, a manufacturer portal, and any payments aggregation or lending.

---

# Where the live numbers are

| Question                                               | Source                                                |
| ------------------------------------------------------ | ----------------------------------------------------- |
| What is built right now, with test and endpoint counts | `docs/18-build-log.md` (changes hourly)               |
| What the founder decided, and when                     | `docs/22-source-of-truth.md` §8                       |
| What can never be broken                               | `docs/22-source-of-truth.md` §9                       |
| Every screen of every app and the procedures it calls  | `docs/23-app-screens-and-api-gaps.md`                 |
| The rules a module must follow to be called stable     | `docs/20-scale-rules.md`                              |
| Where this space still disagrees with the build        | `docs/24-confluence-alignment.md` (audit, 2026-09-05) |
