# Distribution OS — Build Status & Roadmap

## Document Information

| Property     | Value                  |
| ------------ | ---------------------- |
| Document     | Build Status & Roadmap |
| Product      | Distribution OS        |
| Version      | 3.0                    |
| Status       | Active                 |
| Owner        | Prajwal Chavan         |
| Last Updated | 21 September 2026      |

**Decided 2026-09-05:** this page mirrors `docs/18-build-log.md` and `QA/STATE.md` in the repository, which are the live build and quality records. Product shape and founder decisions live in `docs/22-source-of-truth.md`. Where this page and those files disagree, the repository wins and this page is corrected. Every number below was produced by a verification gate or a measured walk, not by an estimate.

---

# Where the build stands

**The product is built. It is now being proved, and then it goes live.**

| Milestone                                                | Date       | What it means                                                                                                                                                                             |
| -------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Backend complete**                                     | 2026-09-06 | Every module of every service built, tested and gated — nothing left in the backend queue                                                                                                 |
| **Frontend complete**                                    | 2026-09-07 | All seven apps built and gated green, each one codebase serving website + Android + iOS                                                                                                   |
| **Realistic demo data**                                  | 2026-09-08 | 174 SKUs across 13 brands, 60 / 40 / 24 shops in named archetypes, 90 / 60 / 45 days of trading history, 120 seed invariants green                                                        |
| **QA batch 1 approved and fixed**                        | 2026-09-12 | The 4 severe and 30 high findings on the order-to-cash chain, all fixed                                                                                                                  |
| **QA batch 2 approved**                                  | 2026-09-13 | Founder: *"I want to fix everything identified."* Every open finding, severe to cosmetic                                                                                                 |
| **QA batch 2 merged**                                    | 2026-09-20 | 153 of 158 findings on main across all 21 work groups                                                                                                                                    |
| **Programme cut to seven days; hosting decided**         | 2026-09-21 | Live by **Saturday 27 September** on `distributionos.in`, if Thursday evening's books balance                                                                                            |

## The build, in numbers

| What                                        | Count | Where it comes from                                                              |
| ------------------------------------------- | ----: | -------------------------------------------------------------------------------- |
| Business modules                            |    23 | `backend/libs/core/src/modules` (plus health and identity, which are plumbing)   |
| Services running independently              |     8 | auth, owner, manager, sales, warehouse, delivery, retailer, platform console     |
| Database tables                             |   139 | seeded twice with identical row counts across every one of them                  |
| Migrations applied                          |    48 | expand-only; a re-run is a no-op                                                 |
| Apps                                        |     7 | owner, manager (accountant on it), sales, warehouse, delivery, retailer, console |
| Module specs                                |   646 | plus the permission matrix in all seven services and the database guarantee tests |
| Endpoint calls exercised, ending "0 broken" | 1,618 | `pnpm smoke` on a fresh database                                                 |

**QA findings so far: 34 fixed in batch 1, 158 raised in batch 2 of which 153 are merged.** Five are still in flight, three of them raised on 20 September. The severe sign-out defect (DOS-167) — a shared phone showing the next person the previous rep's shops, orders and dues — is **closed on measured evidence across Android, iOS and the browser**: a person's unsent work survives sign-out on that device, goes first at that person's next sign-in, and never reaches anybody else.

Everything still runs on the founder's local PostgreSQL 17. **Nothing is deployed yet — that changes on day 7 of the plan below.**

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

The gate finds real defects, and they are fixed before the module is called done — four at the platform-gaps checkpoint, four at the delivery checkpoint, five at the platform-console checkpoint (each with a test so it cannot return). That is the point of the gate.

**Decided 2026-09-21:** the smoke gate is worked **failure by failure**, not as an all-or-nothing bar. Every broken call is investigated on its own merits — a real fault, a case the demo data cannot satisfy, or a wrong published example — and nothing waits for a perfect run before it can proceed.

**Since 12 September a second method sits on top of the gate: the walk.** An app screen is not called fixed because the code reads right; someone drives it in a real browser at desk and phone width, and on the Pixel 7, against the running services, and records what was measured. One walk overturned its own finding honestly rather than quietly. Claims that were never run are reported as "not tested".

---

# Modules complete

Listed in build order. "Procedures" counts the routes that module declares in the shared contract as of 2026-09-05.

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

**Decided 2026-09-05 (from the screen inventory in `docs/23`, now binding):** the retailer app places its own orders; the salesperson may see a shop's outstanding and credit check but never records a receipt; the **accountant is money desk plus reads** (office receipts, deposits, cheque bounces, write-offs, every export — no prices, schemes, credit limits, approvals or settings); and the **manager approves load-out from the manager app**, with the warehouse device waiting for it.

## The rest of the backend, finished 2026-09-05 → 06

Everything this page previously listed as "in progress" or "queued" is built, gated and pushed.

| Module                     | What it gives the business                                                                                                                                                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Document intake**        | "Zero manual entry": blind gate count → QR / IRN verification → vision extraction → validators → SKU match → human review on the phone → one idempotent goods receipt. **A human always reviews before the GRN is posted**              |
| **Integrations**           | One generic importer for any source — TradeEzee, Marg, Busy, Tally, FieldAssist, Excel (upload → preview → map columns → save profile → dry run → commit) — plus Tally export and the export-job queue every later module uses          |
| **Claims**                 | Scheme, damage and expiry claims to brands, built on billing's registers                                                                                                                                                              |
| **Notifications**          | WhatsApp / SMS adapters, event-driven sends, templates — the invoice, proof of delivery and receipt to the shop, and the password-reset channel                                                                                        |
| **Reporting**              | Dashboards, registers and chart-ready series — the graphs the owner app was promised                                                                                                                                                   |
| **Incentives**             | Plans, targets, slabs and statements; closes the salesperson's own-targets screens                                                                                                                                                     |
| **AI**                     | WhatsApp free-text and voice order capture, demand forecasting and reorder suggestions, route sequencing. Drafts are **always human-confirmed**; the driver may override a suggested route                                             |
| **Platform admin (:3007)** | Distributor onboarding, plans and subscription state, and **time-boxed, owner-approved, audited** support access. The console reads counts, never trade; suspension stops every sign-in for that distributorship with a 423 and a reason |
| **Three-distributor demo** | Three distributors, staff under each, shops linked to more than one — the only honest way to prove tenant isolation and a shopkeeper's multi-distributor sign-in                                                                        |

## Progress, checkpoint by checkpoint

| Checkpoint                      | Tests | Smoke calls |
| ------------------------------- | ----: | ----------: |
| Swagger phase complete          |   534 |         369 |
| Receivables                     |     — |         445 |
| Billing                         |   828 |         517 |
| Warehouse                       |   962 |         610 |
| Platform gaps                   | 1,254 |         844 |
| Delivery                        | 1,442 |       1,004 |
| Backend complete (AI + console) | 2,381 |       1,588 |
| QA batch 2, on a fresh seed     |     — |       1,618 |

---

# In progress — day 1 of seven

Five pieces of work are running on the founder's machine today (Sunday 21 September):

| Lane                                 | What it is                                                                                                                                                      |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The cross-role chain**             | One order carried by real people through every app, end to end, then the days that go wrong, then a blind verifier. This is also the full regression            |
| **Welcome and landing screens**      | Every app opens on a Distribution OS welcome, and lands after sign-in on the distributor's logo and name, the person's name and which app this is               |
| **Role election at sign-in**         | The auth change that lets one person act as a lower role. Stops after integration for the architect to review by hand — it touches a contract and permissions   |
| **Deployment plumbing**              | The path from repository to server, which did not exist: a Dockerfile that builds, compose for the VM, TLS, the migration step, backups, secrets, the web pipeline |
| **The one-app layout plan**          | Planning only: how six apps become one. Approved by the architect before a single screen moves                                                                  |

---

# The seven days to go-live

**Decided 2026-09-21, twice in one day.** The QA programme was cut from thirty days to ten, then to five — the founder has one week of architect subscription left and wants this closed this month. It then moved back to **seven**, because he asked for role election and the one store app **before** go-live, for the website as well as the phones: *"make sure of role election and one store app for both APPS and website before go live."* That costs about two days and it is the right order — what gets proved is then what ships.

| Day                   | What runs                                                                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — Sun 21**        | The cross-role chain on the seven apps as they are · welcome + landing · role election starts · deployment plumbing starts in parallel                                       |
| **2 — Mon 22**        | Role election lands after the architect's review · **the one app** starts: one project, six role groups, one website + one Android + one iOS                                 |
| **3 — Tue 23**        | The one app finishes and is gated; the seven per-role web apps are retired · smoke and the chain re-walked **on** the one app                                                |
| **4–5 — Wed 24 / Thu 25** | **The seven-day business simulation, on the one app** — two full days, a blind auditor, an arithmetic verdict                                                            |
| **6 — Fri 26**        | Fix what the simulation found; check only where it pointed                                                                                                                  |
| **7 — Sat 27**        | Android basics · the security slice public URLs require · **go live** at `app.distributionos.in` and `api.distributionos.in` · the architect's audit, folded into the handover |

**The honest shape is six days of scheduled work and one day of unknown.** Day 6 is the only day set aside for repairing what days 4–5 find. If Thursday evening's books balance, Saturday is live. If they do not, the unknown is the repair — likely about eight days rather than seven — and the founder hears that on Thursday night, not on Saturday with his URLs half-built.

## The business simulation, and why it is the centre

Seven simulated trading days driven against the running services, with real people doing real jobs in the app — not a script calling endpoints. Onboarding and stock; reps ordering, the manager approving, the warehouse processing; deliveries, payments and outstanding; a price change and a new scheme; returns, damaged goods, a failed delivery, a partial payment; high volume, concurrent operations, network failures; then reconciliation.

**It ends in arithmetic, and the arithmetic is the verdict:**

- **opening stock + receipts − sales − damage − returns = closing stock**, per SKU per batch
- **revenue = payments + outstanding**

Any drift is a severe finding. Not a discussion, not a rounding note. It was moved from the end of the programme to the middle on the founder's word — *"Business simulation is imp"* — precisely because it is the test most likely to find something structural, and a structural fault found on the last day cannot be fixed on the last day.

---

# The apps, and the one app that replaces them

All seven apps are built and gated green (2026-09-07): owner, manager (with the accountant on it), sales, warehouse, delivery, retailer, and the admin console. Each is a **single Expo codebase serving website + Android + iOS**, built on layout **A Ledger** and the design system finalised on it. Each was verified by an independent gate that walked every screen of its section of `docs/23` in a real browser at desk and phone widths — measuring rather than eyeballing — and drove it on the Pixel 7.

Three sign-in decisions of 2026-09-21 change what a person installs and what they can do, without changing one line of the server's security model:

1. **Every app opens on a Welcome screen, then lands on who-you-are.** The Distribution OS mark, one line, this app's name, one Sign in button — shown once per device, never on every launch. After sign-in: the distributor's (or shop's) logo and name, the person's name, and which app this is. White label inside the app is unchanged.
2. **Role election at sign-in, downward only.** *"Owner can use every role, others can use specific roles."* An owner may act as manager, accountant, warehouse, delivery or salesperson; a manager as warehouse, delivery or salesperson; everyone else only as themselves plus the extra roles the owner or manager grants. The token carries the **elected** role, so services, the permission matrix and row-level security are untouched, and the person stays the actor on every audit row. **An owner token never enters a field app** — a van phone must not hold a key to the owner service.
3. **One app in the store, "Distribution OS", which becomes the right app after sign-in.** The saving is not store fees ($25 once for Google, $99 a year for Apple, any number of apps) — it is seven builds, seven review queues, seven update cycles, and a new hire being told which of six apps to install. **The seven per-role web apps are retired at the merge, not kept beside it** (founder confirmed, 2026-09-21): two front doors would be two things to prove for ever, and nothing is lost because every screen lives in the one app. The console stays separate — platform staff are not the distributor's users.

**Android is the pilot platform.** iOS beyond boot sits outside the seven days; the complete validation of both platforms is a block of its own, run once, when the product is otherwise right (decided 2026-09-21, which turned the standing iOS gap into scheduled work rather than a running debt).

---

# Then: offline, pilot, deployment

| Phase                                        | Where it stands                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Offline**                                  | **Built and proved.** The upload endpoint never answers 4xx: rejections are recorded and shown, never lost — and every upload is checked against the same permission matrix the server enforces, so no role can do by sync what it cannot do online. A device's offline copy belongs to **one person in one distributorship**, is checked before anything is shown and deleted at sign-out; unsent changes stay with that person and go first at their next sign-in. When a browser or phone cannot keep an offline copy, **every** screen says so — the app never claims work is safe when it is not |
| **Pilot at Tarsun Enterprises, Kalyan West** | Next, after go-live. Real beats, real shops, real money, alongside the existing ERP. Bills the brand raises in its own DMS are imported and linked, **never re-invoiced**. Gate: the distributor's day closes in Distribution OS — registers tie, cash settles, outstanding matches                                                                                                                                             |
| **Deployment**                               | **Decided 2026-09-21, on verified terms** — see below. Day 7 of the plan                                                                                                                                                                                                                                                                                                                                                       |

## Hosting, decided on verified terms

The earlier plan (2026-09-05) was AWS Lightsail with managed Postgres to follow. **It was dropped on 2026-09-21 for a reason that was checked rather than assumed: free managed Postgres cannot run this schema at all.** The database creates a worker role that bypasses row-level security, which requires a superuser — and Neon, Supabase and RDS all withhold it. Any hosting that starts with managed Postgres either fails at the first migration or forces the tenancy model to be rewritten.

| Piece                  | Choice                                                                                                                       | Why                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Server                 | **Oracle Cloud Always Free** — 2 OCPU / 12 GB ARM, home region **Mumbai** (irreversible once chosen)                          | The only free tier large enough to run the services and the database beside them, in India           |
| Database               | **PostgreSQL 17, self-hosted on that VM**                                                                                    | The schema needs a superuser; no free managed service grants one                                    |
| Apps (web)             | **Cloudflare Pages**                                                                                                         | Unlimited bandwidth, no card required                                                                |
| Backups                | **Cloudflare R2**, off the Oracle account                                                                                    | A backup on the same account as the thing it protects is not a backup                               |
| Domain                 | **`distributionos.in`** — `app.` for the apps, `api.` for the services                                                       | Checked available; about **₹690 a year**                                                             |
| Monthly cost           | **₹0**                                                                                                                       | The domain is the only recurring spend                                                               |

**The known risk, named:** Oracle reclaims idle Always Free instances, and it halved this shape on 15 June 2026 without announcement. Mitigation is pay-as-you-go inside the free limits plus backups that live off Oracle. **Builds must never run on the free VM** — it will run out of memory; artifacts are built on the Mac or in CI and shipped.

**Owed by the founder before day 7:** an Oracle account (Mumbai region, a **real credit card** — PIN-debit, prepaid and virtual cards are refused) with an API key; a Cloudflare account with an API token; the domain bought with its nameservers left on "custom"; and the answer to whether the pilot URLs are gated or public (gated is recommended).

The scale rules remain binding on every module rather than being a later phase: stateless services, cursor-paginated lists with hard caps, idempotent mutations, per-tenant fairness, `tenant_id` leading every index, append-only ledgers ready to partition by month, and two connection pools so reads can move to replicas. The load model to design against is 10,000 distributors, 100,000 staff devices, 2,000,000 retailers.

---

# What is cut for the pilot, and what brings each one back

The thirty-day quality programme became seven days by removing work, not by claiming the work got faster. Everything below is cut **for a single-distributor pilot**, and each row names the event that brings it back.

| Cut                                                 | Why it is safe for this pilot                                                                                                     | Comes back                           |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| **Performance, database tuning and search**         | One distributor, ~36 shops. Performance is not the risk at this size, and the architecture was built for scale from day one       | Before about 10 paying tenants       |
| **Accessibility and a hardened public surface**     | Every app gate already walked desk and phone widths. Accessibility is real work and not a pilot blocker                            | Before a public product              |
| **Observability and DevOps**                        | Cut to exactly what hosting needs; nothing here loses money in a pilot                                                            | At go-live                           |
| **Localization and the TradeEzee import**           | English-only pilot by decision. The import is a **cut-over** task, not a quality phase — it happens when the founder moves his book | At cut-over                          |
| **A larger automated test suite**                   | 646 module specs, seven permission matrices and the database guarantee tests already exist. More tests are not what is missing     | Before customer #2                   |

What stays is what can lose money, stock or another tenant's data, plus the proof that the product works end to end for real people.

---

# Open decisions and known gaps

Honest list.

**Waiting on the founder**

1. **The real data extract**, promised on 20 September. What it *is* decides which job runs: a Distribution OS book (a dump carrying rows the apps wrote) means a read-only money check against a copy, signed off trip by trip; an old-system export (TradeEzee, Tally, Excel) means nothing in Distribution OS is wrong and the work is an import through the generic importer. Either way it is copied before it is read and never edited in place.
2. **Invoice series at cut-over** from the existing ERP — continue the old numbers or start fresh. Configurable either way; the answer is needed before go-live.
3. **Sample exports** from the existing ERP (party master, item master, outstanding) whenever convenient — the importer does not wait for them.
4. **Which pilot shops, if any, are under the GST composition scheme.**
5. **Should a rate request attached to a draft that is never placed lapse on its own, and after how long?** Today it simply waits and the desk reads "Not placed yet".
6. **Two design questions** raised by the warehouse gate: is the touch floor a height or a size, and may the gate-count pad scroll on a phone.
7. **The hosting accounts** listed under Deployment above.

**Carried forward in the build**

- **Sixteen backend gaps** the app gates recorded rather than worked around, because each changes a contract the other apps share — mostly lists that return an identifier where a screen needs a name, and lists that page by record id where they should page by date. Three are already closed by quality fixes; the rest are one slice of work.
- **Three demo-data items**: the smoke run leaves its own calls behind in the pilot distributor (hundreds of ₹1 receipts and around 400 pending approvals, so every approvals and money screen opens on noise); the seed's gross margin for the current month is negative and needs a decision on whether that is wrong data or a true story; and two demo distributors carry a trial date written by an older seed that reads "Trial ended 25 Jan 2018".
- **Five quality findings still in flight**, three of them raised on 20 September; and one clause of the sign-out finding — the reconnect-while-signed-in path on phones — is still unwired.
- The password-reset token's delivery channel, logo upload accepting JPEG only, and two row-level-security policies to widen.

**Not in v1, on purpose**

Branches — **one tenant is one distributorship**; multi-branch is v2, where each branch is its own tenant plus an owner group view. Also out: per-tenant custom roles and configurable order states, warehouse racks, bins and barcode scanning, a manufacturer portal, and any payments aggregation or lending. A **permanent public link** to a shop's invoices, receipts or statement is refused outright — papers are shared as files from the phone; if a link is ever wanted it must expire and be signed.

---

# Where the live numbers are

| Question                                                     | Source                                                |
| ------------------------------------------------------------ | ----------------------------------------------------- |
| What is built right now, with test and endpoint counts       | `docs/18-build-log.md`                                |
| Where quality stands today, and what is running              | `QA/STATE.md`                                         |
| The seven days to go-live, and everything that was cut       | `QA/10-DAY-PLAN.md`                                   |
| What the founder decided, and when                           | `docs/22-source-of-truth.md` §8                       |
| What can never be broken                                     | `docs/22-source-of-truth.md` §9                       |
| Welcome, role election and the one store app                 | `docs/29-sign-in-roles-and-one-store-app.md`          |
| Every screen of every app and the procedures it calls        | `docs/23-app-screens-and-api-gaps.md`                 |
| The rules a module must follow to be called stable           | `docs/20-scale-rules.md`                              |
| Where this space still disagrees with the build              | `docs/24-confluence-alignment.md` (audit, 2026-09-05) |
