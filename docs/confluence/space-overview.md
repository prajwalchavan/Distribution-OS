# Distribution OS

## Document Information

| Property     | Value                                                       |
| ------------ | ----------------------------------------------------------- |
| Document     | Space Overview (DistributionOS Home)                        |
| Product      | Distribution OS                                             |
| Version      | 2.0                                                         |
| Status       | Active                                                      |
| Owner        | Prajwal Chavan (Founder)                                    |
| Last Updated | September 2026                                              |

---

## What Distribution OS is

**Distribution OS** is a multi-tenant SaaS that runs an Indian distributor's whole working day — order to cash, and supplier bill to stock — on one Postgres database with append-only stock and money ledgers. **Decided 2026-09-05:** the product name is **Distribution OS**; the apps are "Distribution OS - Owner", "- Manager", "- Sales", "- Warehouse", "- Delivery", "- Retailer", "- Admin". The product is **white-labelled**: the Distribution OS name appears only on the sign-in screen, and every screen and printed document inside shows the distributor's own name and logo (decided 2026-09-04). Revenue is the distributor's subscription; there is no fintech, no payments aggregation, no commission on trade.

## Who it is for

The customer is the **distributor** (manufacturer → distributor → retailer). **One tenant = one distributorship**; multi-branch is v2, each branch its own tenant with an owner group view (decided 2026-09-05). **Decided 2026-09-04:** every role gets its own app on its own backend service — owner; manager (shared with the accountant); sales; warehouse; delivery; retailer — and **decided 2026-09-05** a seventh app, **Admin**, is the Distribution OS platform console (onboarding, plans, time-boxed support access) and is in v1. The six role apps ship as web + Android + iOS; Admin is web. Positioning stays multi-industry — **FMCG first**, pharma, dairy, electricals and agri as later markets — while the product stays FMCG-shaped until a second-industry customer exists (decided 2026-09-05). Pilot customer: **Tarsun Enterprises, Kalyan West**.

## Status — 5 September 2026

Backend first, production grade, on a local database: **13 backend modules verified, 1,254 automated tests, 844 live endpoint calls with 0 broken**, on one Postgres 17 database with forced row-level security and a per-endpoint permission matrix (`docs/18-build-log.md`). Delivery is in its verification gate; docint, integrations, claims, notifications, reporting, incentives, the AI module and the platform console are queued. **No app screen is built yet** — the screen layout **A Ledger** was chosen 2026-09-05 and the six apps start once the backend is complete. Every claim on every page of this space traces to a repo document; where a page and the repo disagree, the repo wins.

---

## Read in this order

| #   | Page                                                                                                                             | Read it for                                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | [Problem Statement](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1081345/Problem+Statement)                 | The validated distributor problems and the feature that answers each one, named by `module.procedure`.          |
| 2   | [Pain Point Analysis](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/2097154/Pain+Point+Analysis)             | Field-observed pain, business impact, root cause, and what is built, planned or deliberately not planned.          |
| 3   | [AS-IS Business Process](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1736714/AS-IS+Business+Process)       | How a distributor works today without the product — the baseline every improvement is measured against.            |
| 4   | [TO-BE Business Process](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1441794/TO-BE+Business+Process)       | The future-state flows as coded: order to cash, supplier bill to stock, and the real state machines.               |
| 5   | [Vision](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1048577/Vision)                                       | Where the product is going, and the multi-industry-with-FMCG-first position.                                        |
| 6   | [Mission](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1605635/Mission)                                     | What the product does for a distributor every day, in plain language.                                               |
| 7   | [Goals](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1212417/Goals)                                         | The measurable objectives for v1 and the explicit non-goals.                                                        |
| 8   | [Success Metrics (KPIs)](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1802241/Success+Metrics+KPIs)         | Each KPI with the table or procedure that can actually produce it — and the ones the product cannot measure.       |
| 9   | [Product Principles](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1900545/Product+Principles)               | The rules every design and engineering decision is checked against, including what is configurable and what is fixed. |
| 10  | [Personas](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1966081/Personas)                                   | Every user, the app and role they sign in as, what they may and may not do.                                         |
| 11  | [Target Market & Customer Segments](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/786434/Target+Market+Customer+Segments.) | Who we sell to, segment by segment, plus the pilot's real setup (TradeEzee ERP, Too Yumm on FieldAssist DMS). |
| 12  | [Home 0.1](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1277953/Home+0.1)                                   | Product and technology reference: modules, apps and services, the stack as actually built, current build status.    |
| 13  | Founder decisions register _(new in this rewrite)_                                                                                | Every founder decision with its date, mirroring the repo's decisions register — the tie-breaker for any dispute.    |

Pages are being brought to **Version 2.0, September 2026** against the repo. Anything still showing Version 1.0 predates the build and should be read with that in mind.

---

## Ground rules that bind every page in this space

- **Six role apps plus the Admin console.** Owner; manager (shared with the accountant); sales; warehouse; delivery; retailer — each on its own service, so a role can only reach the endpoints its service mounts (2026-09-04). Admin is the seventh app, in v1 (2026-09-05).
- **Sign-in is username + password**, on our own token service. OTP over SMS or WhatsApp is a later enhancement layered on top, never a replacement (2026-09-04).
- **Only the delivery crew collects money, or the shop pays online.** The salesperson never records a receipt — the sales service has no receipt endpoint. The back office may record an office payment. The salesperson may *see* a shop's outstanding and credit check (2026-09-04, refined 2026-09-05).
- **The GST invoice is issued at pack**, in the warehouse, from what was actually packed. An issued invoice is never edited; corrections are credit or debit notes.
- **The accountant is the money desk plus reads**: receipts, deposits, cheque bounces, write-offs, and every register and export — but no prices, schemes, credit limits, approvals or settings (2026-09-05). **The manager approves load-out from the manager app**, not by typing a PIN on the warehouse phone (2026-09-05).
- **All AI features are in v1, before the pilot**: WhatsApp free-text and voice order capture (parsed into a draft order, always human-confirmed), demand forecasting and reorder suggestions, and route sequencing the driver may override (2026-09-05).
- **English only for now. Online-first now, with offline for sales and delivery before the pilot.** Screen layout **A Ledger** across all six apps (2026-09-04, 2026-09-05).
- **Data migration is one generic importer** — upload, preview, map columns, save the profile, dry run, commit — for TradeEzee, Marg, Busy, Tally, FieldAssist or plain Excel (2026-09-04). A brand-DMS sale is imported and linked, **never re-invoiced**.
- **Demo and test data covers three distributors**, staff under each, and shops linked to more than one distributor (2026-09-04).

## How this space is kept true

1. `docs/22-source-of-truth.md` in the repository is the single source of truth. Confluence mirrors it; where the two disagree, the repo wins and the page is corrected.
2. `docs/18-build-log.md` holds the live build status and changes several times a day. Status quoted on a Confluence page is a snapshot with its date attached.
3. `docs/24-confluence-alignment.md` is the audit that produced this rewrite: every earlier statement in this space was checked against the code, the 229 contract procedures and the 126 database tables, and marked addressed, partial, planned, not addressed or superseded.
4. A founder decision is written into the repo's decisions register on the day it is made; the Confluence page changes in the same pass and says **"Decided [date]"** in the sentence that changed.

## Open questions for the founder

- Invoice numbering at cut-over from TradeEzee: continue the existing series or start fresh? Configurable either way; an answer is needed before go-live.
- Sample exports from TradeEzee (party master, item master, outstanding) whenever convenient — the importer does not wait for them.
- Which pilot shops, if any, are under the GST composition scheme.
