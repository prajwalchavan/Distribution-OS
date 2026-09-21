# Personas

## Document Information

| Property     | Value              |
| ------------ | ------------------ |
| Document     | User Personas      |
| Product      | Distribution OS    |
| Version      | 2.1                |
| Status       | Active             |
| Owner        | Product Management |
| Last Updated | 21 September 2026  |

---

# Purpose

This document defines every user who interacts with Distribution OS. Each persona represents a real business role within a distribution organization; understanding their responsibilities, objectives, challenges and daily workflows keeps the platform designed around actual operational needs rather than assumptions. These personas guide product design, UI/UX, permissions, mobile applications, API authorization, dashboards, notifications and AI capabilities.

Version 2.0 rewrites the August 2026 draft against the product as decided and built. A persona is now the same thing as **a role plus what the app becomes for it**: since 2026-09-21 the six business roles share one application, the role is elected at sign-in, the app then talks to that role's own backend service, and a per-endpoint permission matrix decides what the role may call. Where a statement changed, the sentence says so and carries the date of the decision. `docs/22-source-of-truth.md` in the repository is the single source of truth; this page mirrors it.

---

# What changed in version 2.0

| Change                                | Detail                                                                                                                                           | Decided                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| One app, six roles                    | The six business roles share ONE app that becomes the right app after sign-in; manager and accountant share one set of screens; the platform console stays separate | 2026-09-04, 2026-09-05, revised 2026-09-21 |
| Everything is web + Android + iOS     | The version 1.0 per-persona "web yes / mobile no" matrix is retired; one codebase serves all three, the console included                          | 2026-09-04                     |
| Salesperson never collects money      | "Collections" removed from Salesperson KPIs; the rep may **see** dues and run a credit check, but only delivery collects or the shop pays online | 2026-09-04, refined 2026-09-05 |
| Accountant = money desk + reads       | Office receipts, deposits, bounces, write-offs, credit notes, every read and export — no prices, schemes, credit limits, approvals or settings   | 2026-09-05                     |
| Retailer is current, not future       | The Retailer app is in v1: one login across distributors, places orders, pays online                                                             | 2026-09-05                     |
| Platform Admin becomes a real app     | A separate application for Distribution OS staff: onboarding, plans, time-boxed support access                                                  | 2026-09-05                     |
| Data Entry Operator removed as a role | The invoice is issued at pack by the warehouse and orders arrive from the rep, the shop or WhatsApp                                              | 2026-09-04                     |
| Four manager personas merged into one | Branch, Sales, Warehouse and Delivery Manager are one `manager` role in one Manager app                                                          | 2026-09-04                     |
| No branch scope                       | One tenant = one distributorship in v1; multi-branch is v2, each branch its own tenant with an owner group view                                  | 2026-09-05                     |
| Manufacturer stays without an app     | Manufacturers reach the product through brand-DMS imports and claims, not a login                                                                | 2026-08, restated 2026-09-05   |

## Retired personas

| Version 1.0 persona                             | What happened to it                                                                                                                                                                                                                                      |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch Manager, Sales Manager, Delivery Manager | Merged into `manager`: beat assignment, price bounds, rep performance, load-out approval, day-end                                                                                                                                                        |
| Warehouse Manager                               | Physical work merged into `warehouse`; the authority steps (approve load-out, cancel a wave) are the manager's                                                                                                                                           |
| Warehouse Staff                                 | Merged into `warehouse` — one role, one set of screens                                                                                                                                                                                                   |
| Data Entry Operator                             | **Removed as a role.** Nobody types orders or bills for a living. The person who did that work becomes a **Manager app user** — the order queue, billing desk and GRN review are still there, they are simply not a separate persona with reduced rights |
| Super Administrator                             | Promoted, not retired: it is now Persona 8, Platform Admin, with an application of its own                                                                                                                                                               |

---

# User Hierarchy

- **Distribution OS staff** — Platform Admin
- **Distributor (one tenant = one distributorship)** — Owner; Manager; Accountant; Salesperson; Warehouse; Delivery Crew
- **External** — Retailer (one login, may be linked to several distributors); Manufacturer (no login)

Decided 2026-09-05: there is no branch entity. A second branch is a second tenant.

---

# Persona 1 — Owner

**Distribution OS, as Owner** · role `owner` · owner-service :3001 · web, Android, iOS

The business owner is the primary customer and the buying decision-maker; the subscription is sold to this person. **Does:** business strategy and manufacturer relationships; prices, schemes and price bounds; credit limits and terms; approvals for price variance, credit, minimum order value and bargains; branding, invoice numbering series, settings and data imports; staff and expansion planning.

- **Goals and pains** — know the day before the day ends; grow sales and protect margin; collect faster. Today: numbers arrive days late, reporting is manual, stock counts drift.
- **KPIs** — daily sales and dispatched value; **gross margin (owner-only)**; outstanding by ageing bucket (0–7, 8–15, 16–30, 31–60, 61–90, 90+) and cash in transit; inventory value and at-risk stock; fill rate; delivery performance; customer growth.
- **Devices** — desk-primary with graphs, phone-secondary for approvals and the day view. Decided 2026-09-04: the Owner app must carry graphs wherever possible, showing growth and how the distributorship is performing.
- **Permissions** — everything the tenant can do, plus the owner-only writes: price bounds, ageing rebuild, incentive targets and statements, claim policies. Cost, landed cost and margin are readable by owner, manager and accountant only — a database rule with tests, not an app rule.

# Persona 2 — Manager

**Distribution OS, as Manager** · role `manager` · manager-service :3002 · web, Android, iOS

Decided 2026-09-04: the Branch, Sales, Warehouse and Delivery Managers of version 1.0 are **one role**. The manager runs the desk and supervises every operational team.

- **Does** — confirms orders into fulfilment and decides approvals and bargains; opens and posts GRNs and settles gate-count discrepancies; runs the billing desk, credit notes and e-way bill entry; creates and cancels picking waves; **approves load-out from the Manager app** (decided 2026-09-05: the manager's PIN is given on the manager's own phone or desk and the warehouse device waits for it, instead of a manager walking to the godown); closes the day with registers, bank deposits, cheques and brand-DMS bills; creates staff, beats and beat assignments.
- **Goals** — meet targets, keep the day moving, resolve exceptions before they reach the owner.
- **KPIs** — order fulfilment and fill rate; dispatch time; delivery performance; collections and outstanding; team productivity.
- **Permissions** — everything except the owner-only writes above. Holds the "PIN" powers: cancel a numbered document, approve or cancel a load sheet, cancel a picking wave, cancel a trip.

# Persona 3 — Accountant

**Distribution OS, as Manager (the accountant shares those screens)** · role `accountant` · manager-service :3002 · web, Android, iOS

Decided 2026-09-05: the accountant's scope is **the money desk plus reads**. Version 1.0 listed "Credit approvals" among this persona's permissions; that is superseded — credit terms and approvals belong to the owner and the manager.

- **Does** — records payments received at the office and reverses keying errors; banks cheques and marks bounces with the resulting reversal and bank charges; allocates receipts bill-to-bill, oldest first unless tagged; raises credit notes; writes off a debt; sends statements; reads and exports everything, including the Tally export.
- **KPIs** — outstanding and ageing; collection efficiency; payment accuracy; deposit and bounce turnaround.
- **May not** — price lists, schemes, overrides, retailer credit limits, approval and bargain decisions, order confirmation, catalog edits, settings, staff management, or cancelling a numbered document. The Manager app hides these controls for the accountant rather than greying them.

# Persona 4 — Salesperson

**Distribution OS, as Sales** · role `salesperson` · sales-service :3003 · web, Android, iOS (phone-first)

The primary field user. Version 1.0 called this persona "Sales Representative" and gave it Android only; every role app is now web + Android + iOS, with the phone as the working surface.

**Daily workflow:** open today's beat → check in at the shop (the geo-tag is evidence, never a block) → take the order by reorder, suggestion or grid, in cases and pieces, with a live availability hint → the price engine and credit check run on the device, so an order inside the limits is submitted and one outside them becomes an approval or bargain request → record the visit outcome and market information.

- **Goals and pains** — maximize sales, complete the beat, build shop relationships. Today: repeated typing, no product information at the counter, no idea what the shop owes.
- **KPIs** — orders booked; visit completion; sales value; new retailers. **"Collections" is removed:** decided 2026-09-04, the salesperson never collects money — the sales service has no receipt endpoint and the permission matrix never grants one.
- **Sees dues** — decided 2026-09-05, the rep may read a shop's outstanding, statement and credit check. The rule is "never collects", not "never sees".
- **Never sees** — purchase cost, landed cost or margin.
- **Offline** — decided 2026-09-04: online-first now, **offline before the pilot** for Sales and Delivery. An offline upload never fails with a 4xx; rejections are recorded and shown, never lost.
- **AI in v1 (2026-09-05)** — WhatsApp free-text and voice order capture, parsed into a draft order against the shop's own purchase history and **always human-confirmed**; reorder suggestions.

# Persona 5 — Warehouse

**Distribution OS, as Warehouse** · role `warehouse` · warehouse-service :3004 · web, Android, iOS (phone + desk)

Decided 2026-09-04: Warehouse Manager and Warehouse Staff are one role; supervision that needs authority sits with the manager.

- **Does** — blind gate count on inbound goods, then photographs or shares the supplier bill for automated extraction; reviews the extracted lines, batches and expiry and commits the GRN; picks against a consolidated picklist in FEFO order; packs per order — **the GST invoice is issued here, at pack**, on the tenant's own series with the distributor's name, logo and UPI QR; builds load sheets and delivery challans and hands over once the manager has approved the load-out.
- **KPIs** — picking and packing accuracy; stock variance; dispatch time; gate-count discrepancies.
- **Permissions** — stock, picking waves, packs, load sheets, challans, GRNs and invoice issue at pack. Never sees purchase cost or margin, and cannot approve its own load-out.
- **Not in v1** — no bin locations and no barcode scanning; the only QR read is the e-invoice on a supplier bill.

# Persona 6 — Delivery Crew

**Distribution OS, as Delivery** · role `delivery` · delivery-service :3005 · web, Android, iOS (phone-first, GPS)

- **Does** — runs the trip stop by stop with a maps hand-off and live position; delivers in full, in part (per-line quantity and reason, which raises a credit note) or records a failure with its reason; captures proof of delivery; **collects money at the door in cash, UPI with UTR, or cheque**, allocated oldest bill first; makes van sales from vehicle stock on the normal invoice series; checks in at the end of the day with unsold stock counted back and cash settled.
- **Goals and pains** — deliver on time and collect what is due. Today: finding shops, manual payment records, inefficient routes.
- **KPIs** — deliveries completed; on-time rate; proof-of-delivery coverage; collection rate; failed deliveries; settlement variance.
- **Permissions** — one of only two field paths to money, the other being the shop paying online. Cash on the vehicle counts toward expected cash at settlement, and variance beyond the owner's tolerance blocks the trip close. Sees a shop's dues and credit mode; never purchase cost or margin.
- **Offline** — required before the pilot: trip, stops, deliveries, proof of delivery and collections work with no network and sync when the signal returns. GPS points bypass the queue.
- **AI in v1 (2026-09-05)** — route sequencing by distance and time windows, which the driver may override. Version 1.0 listed this as "Future AI".

# Persona 7 — Retailer

**Distribution OS, as Retailer** · role `retailer` · retailer-service :3006 · web, Android, iOS (online only)

Decided 2026-09-05: the Retailer app is **in v1**, not future. One shop login can be linked to several distributors and switches between them without signing in again; the app shows one card per linked distributor.

- **Does** — places and repeats orders; tracks the order and the delivery; views invoices, credit notes, outstanding and statement; **pays online** against its own bills by UPI QR or link.
- **Goals** — easy ordering, fast delivery, transparent account information.
- **KPIs** — orders placed; repeat rate; on-time delivery received; outstanding and overdue days.
- **Permissions** — sees only rows linked to its own shop; never a credit limit, purchase cost or margin; cannot touch its own credit terms. A tenant never sees another tenant's rows and a shop never sees another shop's — enforced by row-level security in the database.
- **White-label** — every card, document and payee name carries **that distributor's** name and logo. Decided 2026-09-04: Distribution OS branding appears on the sign-in screen only.
- **Not in v1** — complaints.

# Persona 8 — Platform Admin

**Distribution OS - Admin**, a separate console · role `platform_admin` (Distribution OS staff) · admin-service :3007 · web, Android, iOS

Decided 2026-09-05: the "Super Administrator" of version 1.0 becomes a real application of its own, in v1. Version 1.0 described the responsibility; there was no console, and now there is one, built.

- **Does** — onboards a distributor (tenant, owner, chart of accounts, locations, numbering series); manages plans and subscription state; grants **time-boxed, owner-approved, audited** support access into a tenant; monitors the platform.
- **KPIs** — active distributors; onboarding time; open support grants and their expiry; platform uptime; subscription revenue.
- **Permissions** — full platform administration, and **no access to any tenant's business data** unless an owner has granted a support session, with every action inside it audited. Revenue stays subscription-only: no payments aggregation and no fintech.

# Persona 9 — Manufacturer

**No app in v1.** Manufacturers are present in the product without signing in.

- **Brand-DMS imports** — bills a brand raises in its own DMS (for the pilot, Too Yumm on FieldAssist) are captured and imported as **a receivable in; no stock movement** — the brand's field force already moved the goods on its own documents — linked to the brand's own invoice number. A brand-DMS sale is **never re-invoiced**; there is never a second legal invoice for the same goods.
- **Claims** — scheme and damage claims against a manufacturer are raised, evidenced and tracked from the distributor's side.
- **Supply** — purchase orders and supplier bills arrive against the manufacturer or its super-stockist.
- **Future** — a manufacturer-facing view of secondary sales and stock movement remains a later idea, not a v1 commitment.

---

# Persona-to-Application Mapping

Decided 2026-09-04, revised 2026-09-21: **everything is delivered on web, Android and iOS from one codebase**, and the six business roles now share **one app** that becomes the right app after sign-in. The version 1.0 matrix of per-persona web-or-mobile availability is retired. Availability is uniform; the **working surface** is not — the phone for sales, warehouse, delivery and retailer, and the desk for owner and manager.

| Persona        | What the app becomes               | Role             | Service                 | Web | Android | iOS | Working surface |
| -------------- | ---------------------------------- | ---------------- | ----------------------- | --- | ------- | --- | --------------- |
| Owner          | Owner                              | `owner`          | owner-service :3001     | Yes | Yes     | Yes | Desk            |
| Manager        | Manager                            | `manager`        | manager-service :3002   | Yes | Yes     | Yes | Desk            |
| Accountant     | Manager (shared screens)           | `accountant`     | manager-service :3002   | Yes | Yes     | Yes | Desk            |
| Salesperson    | Sales                              | `salesperson`    | sales-service :3003     | Yes | Yes     | Yes | Phone           |
| Warehouse      | Warehouse                          | `warehouse`      | warehouse-service :3004 | Yes | Yes     | Yes | Phone           |
| Delivery Crew  | Delivery                           | `delivery`       | delivery-service :3005  | Yes | Yes     | Yes | Phone           |
| Retailer       | Retailer                           | `retailer`       | retailer-service :3006  | Yes | Yes     | Yes | Phone           |
| Platform Admin | Distribution OS - Admin (separate) | `platform_admin` | admin-service :3007     | Yes | Yes     | Yes | Desk            |
| Manufacturer   | None in v1                         | —                | —                       | —   | —       | —   | —               |

Every role signs in through one shared authentication service. Decided 2026-09-04: **username and password**, our own token service, no third party; one-time passwords are a later enhancement layered on top, not a replacement. A user with more than one membership — a shop linked to several distributors, or staff working for two — switches distributor without signing in again.

---

# Role-Based Access Principles

- A role's elected sign-in decides which service the app talks to, and that service **mounts only the endpoints that role needs**. A token from any other role is refused before any business logic runs. **Decided 2026-09-21:** the role is elected downward only — an owner may act as manager, accountant, warehouse, delivery or salesperson, a manager as warehouse, delivery or salesperson, every other staff role only as itself plus the extra roles the owner or manager grants; retailer and platform admin never act as anything else, and an owner token is never let into a field app.
- Every endpoint has a row in a **permission matrix** naming the roles allowed to call it. The matrix is tested for every endpoint against every role and the guard fails closed: an endpoint with no row can be called by nobody.
- Beneath the matrix the database enforces the same rules with row-level security — tenant isolation, cost invisibility, and a shop that reads only its own rows.
- **Changed in 2.0:** version 1.0 said permissions "can be customized by each organization". They cannot. There is one fixed matrix over seven tenant roles plus the platform role; there are no per-tenant custom roles, and object states and approval kinds are fixed enums driven by state machines.
- Sensitive actions are audited, and the money rules are structural rather than configurable: the salesperson has no receipt endpoint at all, an issued invoice is never edited (corrections are credit notes), and stock and money ledgers are append-only.

---

# Where these personas stand today

As at 21 September 2026: **23 backend modules across 8 services, 646 module specs, 1,618 endpoint calls exercised, 0 broken** (Build Status & Roadmap mirrors `docs/18-build-log.md`), and every persona above has the screens it needs — all seven apps were built and gated green on 2026-09-07, on the **A Ledger** layout chosen 2026-09-05. Owner graphs, the AI capabilities, the Platform Admin console and white-label chrome are all built. What is still ahead of these personas:

- **The six apps become one app** and the role is elected at sign-in (decided 2026-09-21). Both land before go-live, and the business simulation then runs on the merged app, so what is proved is what ships.
- **The proof, not the build.** A cross-role walk of one order through every role, then a seven-day business simulation whose verdict is arithmetic: stock and money must reconcile to the rupee and the piece.
- **Nothing is live yet.** Go-live is targeted for **Saturday 27 September 2026** on `distributionos.in`.

---

# Summary

These nine personas — eight who sign in and one who does not — are the complete user set of Distribution OS. Every screen, endpoint and permission traces back to one of them. When a new module is proposed it is validated against this list: which persona asks for it, under which role, on which service, and what the permission matrix must say.

**Sources:** `docs/22-source-of-truth.md` §2, §4–§7, §8 (dated founder decisions), §9 (non-negotiables); `docs/24-confluence-alignment.md` §3 and §5; `docs/23-app-screens-and-api-gaps.md` (screen inventory, permission cross-checks); `docs/18-build-log.md` (status).
