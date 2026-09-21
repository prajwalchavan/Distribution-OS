# Distribution OS

## Document Information

| Property     | Value                                |
| ------------ | ------------------------------------ |
| Document     | Space Overview (DistributionOS Home) |
| Product      | Distribution OS                      |
| Version      | 3.0                                  |
| Status       | Active                               |
| Owner        | Prajwal Chavan (Founder)             |
| Last Updated | 21 September 2026                    |

---

## What Distribution OS is

**Distribution OS** is a multi-tenant SaaS that runs an Indian distributor's whole working day — order to cash, and supplier bill to stock — on one Postgres database with append-only stock and money ledgers. **Decided 2026-09-05:** the product name is **Distribution OS**. **Decided 2026-09-21:** the six business roles — owner, manager (with the accountant), sales, warehouse, delivery and the shopkeeper — are delivered as **ONE app**, listed once in each store as "Distribution OS" and served as one website. The person signs in and the app **becomes** the right app for the role their sign-in elects: the owner's desk, the rep's beat, the driver's trip. Distribution OS staff use a **separate console**, which is not a distributor's app and never appears beside one. So: one app and a console — not seven apps. The product is **white-labelled**: the Distribution OS name appears only on the welcome and sign-in screens, and every screen and printed document inside shows the distributor's own name and logo (decided 2026-09-04). Revenue is the distributor's subscription; there is no fintech, no payments aggregation, no commission on trade.

## Who it is for

The customer is the **distributor** (manufacturer → distributor → retailer). **One tenant = one distributorship**; multi-branch is v2, each branch its own tenant with an owner group view (decided 2026-09-05). **Decided 2026-09-04:** every role has its own backend service — owner; manager (shared with the accountant); sales; warehouse; delivery; retailer — and a service refuses every other role before any business logic runs; **decided 2026-09-05** the **console** (onboarding, plans, time-boxed support access) is the Distribution OS platform's own surface and is in v1. **Decided 2026-09-21:** those six roles reach the distributor as one app — one website, one Android app, one iOS app — while the console stays separate and web-only. **Role election at sign-in grants a role only downward:** an owner may act as manager, accountant, warehouse, delivery or salesperson; a manager as the field roles; everyone else as their own role plus any extra roles the owner or manager grants them. Positioning stays multi-industry — **FMCG first**, pharma, dairy, electricals and agri as later markets — while the product stays FMCG-shaped until a second-industry customer exists (decided 2026-09-05). Pilot customer: **Tarsun Enterprises, Kalyan West**.

## Status — 21 September 2026

**The product is built. It is now being proved, and then it goes live.** The backend was completed on 2026-09-06 and the frontend on 2026-09-07: **23 business modules across 8 independently running services, 139 database tables, 646 module specs and 1,618 live endpoint calls ending "0 broken"**, and all seven apps gated green by an independent gate that walked every screen at desk and phone widths against the running services (Build Status & Roadmap mirrors `docs/18-build-log.md` and `QA/STATE.md`).

**Quality.** QA batch 1 closed with its 34 findings fixed; **QA batch 2 is merged — 153 of its 158 findings are on `main`**, five still in flight. The severe shared-device sign-out defect, where a second person on the same phone could see the first person's shops and dues, is closed on measured evidence.

**The plan is seven days and it ends live (founder, 2026-09-21).** Day 1 one order walked through every app; day 2 role election at sign-in; day 3 the six business apps merged into the one app, gated; days 4–5 a **seven-day business simulation** settled by arithmetic — stock in equals stock out, revenue equals payments plus outstanding, any drift is a stop-the-line defect; day 6 repairs; day 7 Android basics, the security work public URLs need, and **go live at `app.distributionos.in`**. **Live by Saturday 27 September**, if Thursday evening's books balance.

**Hosting is decided and costs ₹0 a month (2026-09-21).** Postgres 17 is **self-hosted** on an Oracle Cloud Always Free instance in Mumbai — no free managed Postgres can run this schema, because creating the worker role that bypasses row-level security needs a superuser that Neon, Supabase and RDS all withhold — with the apps on Cloudflare Pages and backups held off the Oracle account. The only running cost is the domain `distributionos.in`, about ₹690 a year.

**Nothing is deployed yet**; everything still runs on the founder's local PostgreSQL 17, with forced row-level security and a per-endpoint permission matrix. Every claim on every page of this space traces to a repo document; where a page and the repo disagree, the repo wins.

---

## Read in this order

| #   | Page                                                                                                                                            | Read it for                                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | [Build Status & Roadmap](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/10485781)                                           | The only page that carries live numbers — verified modules, tests, endpoint calls, migrations and what is queued next. It mirrors `docs/18-build-log.md` and `QA/STATE.md`; read it before you quote a figure from anywhere else. |
| 2   | [Problem Statement](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1081345/Problem+Statement)                               | The validated distributor problems and the feature that answers each one, named by `module.procedure`.                                                                                                          |
| 3   | [Pain Point Analysis](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/2097154/Pain+Point+Analysis)                           | Field-observed pain, business impact, root cause, and what is built, planned or deliberately not planned.                                                                                                       |
| 4   | [AS-IS Business Process](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1736714/AS-IS+Business+Process)                     | How a distributor works today without the product — the baseline every improvement is measured against.                                                                                                         |
| 5   | [TO-BE Business Process](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1441794/TO-BE+Business+Process)                     | The future-state flows as coded: order to cash, supplier bill to stock, and the real state machines.                                                                                                            |
| 6   | [Vision](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1048577/Vision)                                                     | Where the product is going, and the multi-industry-with-FMCG-first position.                                                                                                                                    |
| 7   | [Mission](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1605635/Mission)                                                   | What the product does for a distributor every day, in plain language.                                                                                                                                           |
| 8   | [Goals](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1212417/Goals)                                                       | The measurable objectives for v1 and the explicit non-goals.                                                                                                                                                    |
| 9   | [Success Metrics (KPIs)](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1802241/Success+Metrics+KPIs)                       | Each KPI with the table or procedure that can actually produce it — and the ones the product cannot measure.                                                                                                    |
| 10  | [Product Principles](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1900545/Product+Principles)                             | The rules every design and engineering decision is checked against, including what is configurable and what is fixed.                                                                                           |
| 11  | [Personas](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1966081/Personas)                                                 | Every user, the app and role they sign in as, what they may and may not do, and their working surface.                                                                                                          |
| 12  | [Target Market & Customer Segments](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/786434/Target+Market+Customer+Segments.) | Who we sell to, segment by segment, plus the pilot's real setup (TradeEzee ERP, Too Yumm on FieldAssist DMS).                                                                                                   |
| 13  | [Seven Apps & Workflows](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/10453020)                                           | Each role's scope, device, screen count and offline stance, plus the four workflows that cross a role boundary at a named handoff — and how the six now sit inside one app.                                     |
| 14  | [Architecture & Technology](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/10518600)                                        | The repository layout, the service and port map, the stack as actually built, the hosting decided on 21 September, and how backend modules are kept from reading each other's tables.                          |
| 15  | [Data, Security & Multi-tenancy](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/10321935)                                   | Tenancy, forced row-level security, the permission matrix, what each role can never see, retention, and the DPDP commitments.                                                                                   |
| 16  | [Design System & Brand](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/10453060)                                            | Layout A Ledger, the two densities, palette, type, numbers and haptics — the contract the first screen and the two-hundredth both follow.                                                                       |
| 17  | [Integrations & Data Migration](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/10453040)                                    | The generic mapped importer, Tally export, brand-DMS coexistence, and why no vendor API is called.                                                                                                              |
| 18  | [Open Questions & Risks](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/10321956)                                           | Everything still undecided, unbuilt or risky, with a default for each open question and a mitigation for each risk.                                                                                             |
| 19  | [Phase 2 & Future Enhancements](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/10420246)                                    | What is deliberately after v1, and the reason each item is not in v1.                                                                                                                                           |
| 20  | [Distribution OS — Product Home](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1277953)                                    | Product and technology reference: modules, apps and services, the stack as actually built, and what changed from version 1.0.                                                                                   |
| 21  | [Decisions Log](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/10518639)                                                    | Every founder decision with its date, why it was made and where it is enforced, mirroring the repo's register — the tie-breaker for any dispute.                                                                |

Pages carrying an August 2026 date predate the build and should be read with that in mind.

---

## Ground rules that bind every page in this space

- **Six roles in one app, plus the Distribution OS console.** Owner; manager (shared with the accountant); sales; warehouse; delivery; retailer — each still on its own service, so a role can only reach the endpoints its service mounts (2026-09-04), and the six merge into one store app and one website before go-live (2026-09-21). The console is separate and in v1 (2026-09-05).
- **Sign-in is username + password**, on our own token service. OTP over SMS or WhatsApp is a later enhancement layered on top, never a replacement (2026-09-04).
- **Only the delivery crew collects money, or the shop pays online.** The salesperson never records a receipt — the sales service has no receipt endpoint. The back office may record an office payment. The salesperson may _see_ a shop's outstanding and credit check (2026-09-04, refined 2026-09-05).
- **The GST invoice is issued at pack**, in the warehouse, from what was actually packed. An issued invoice is never edited; corrections are credit or debit notes.
- **The accountant is the money desk plus reads**: receipts, deposits, cheque bounces, write-offs, and every register and export — but no prices, schemes, credit limits, approvals or settings (2026-09-05). **The manager approves load-out from the manager app**, not by typing a PIN on the warehouse phone (2026-09-05).
- **All AI features are in v1, before the pilot**: WhatsApp free-text and voice order capture (parsed into a draft order, always human-confirmed), demand forecasting and reorder suggestions, and route sequencing the driver may override (2026-09-05).
- **English only for now. Online-first now, with offline for sales and delivery before the pilot.** Screen layout **A Ledger** across all six role apps (2026-09-04, 2026-09-05).
- **Data migration is one generic importer** — upload, preview, map columns, save the profile, dry run, commit — for TradeEzee, Marg, Busy, Tally, FieldAssist or plain Excel (2026-09-04). A brand-DMS sale is imported and linked, **never re-invoiced**.
- **Demo and test data covers three distributors**, staff under each, and shops linked to more than one distributor (2026-09-04).

## How this space is kept true

1. `docs/22-source-of-truth.md` in the repository is the single source of truth. Confluence mirrors it; where the two disagree, the repo wins and the page is corrected.
2. `docs/18-build-log.md` and `QA/STATE.md` hold the live build and quality status and change several times a day. Status quoted on a Confluence page is a snapshot with its date attached.
3. `docs/24-confluence-alignment.md` is the audit that produced this rewrite: every earlier statement in this space was checked against the code, the 229 contract procedures and the 126 database tables, and marked addressed, partial, planned, not addressed or superseded.
4. A founder decision is written into the repo's decisions register on the day it is made; the Confluence page changes in the same pass and says **"Decided [date]"** in the sentence that changed.

## Open questions for the founder

Three things are owed before day 7, and only the founder can do them:

- An **Oracle Cloud account** in the Mumbai region, with an API key. It needs a **real credit card** — PIN-debit, prepaid and virtual cards are refused — and the home region cannot be changed later.
- A **Cloudflare account** with an API token, for the web apps and the backups.
- The **domain `distributionos.in`** bought, with its nameservers left on "custom" so they can be pointed at Cloudflare.

The product questions still open — the invoice series at cut-over from TradeEzee, the sample exports, and which pilot shops are under the GST composition scheme — are carried with their defaults on [Open Questions & Risks](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/10321956).
