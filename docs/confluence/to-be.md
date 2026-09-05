# TO-BE Business Process

## Document Information

| Property     | Value                                  |
| ------------ | -------------------------------------- |
| Document     | TO-BE Business Process                 |
| Product      | Distribution OS                        |
| Version      | 2.0                                    |
| Status       | Active                                 |
| Owner        | Product Management & Business Analysis |
| Last Updated | September 2026                         |

---

# Purpose

This document defines the future-state operational model for distributors using Distribution OS.

Unlike the current paper-centric process, Distribution OS introduces digital workflows, real-time visibility, automation, role-based operations, and event-driven status tracking while remaining flexible enough to support different distributor operating models.

The objective is not only to digitize existing workflows but to redesign them for greater efficiency, accuracy, and scalability.

**New in version 2.0.** The generic stage ladders of version 1.0 are replaced by the **actual flows** the product implements: order to cash across the six role apps, stock-in from supplier bill to goods received, money and who may collect it, and sign-in. The lifecycles are the state machines coded in `backend/libs/domain/src/state-machines/`, not illustrative examples. Nothing that was true in version 1.0 has been deleted; where a dated founder decision changed the answer, the sentence says so and carries its date.

**Status vocabulary.** **BUILT** = a verified backend procedure or table exists · **BUILT, GAP NAMED** = core built, a named part missing · **PLANNED (v1)** = a named module in the build chain covers it before the pilot · **NOT IN V1** = deliberately out of scope, reason stated.

As at 2026-09-05 13:45 IST: **14 backend modules verified, 1,442 automated tests, 1,004 endpoint calls exercised, 0 broken** (Build Status & Roadmap mirrors `docs/18-build-log.md`). **No app screen exists yet** — backend first is a deliberate sequencing decision (2026-09-04). Statuses below describe the backend, not the user interface.

# Guiding Principles

The future process is based on the following principles, all still current:

1. Single source of truth for all business data.
2. Capture data once and reuse it throughout the workflow.
3. Every business activity is tracked through system-defined statuses.
4. Paper documents are outputs, not the operational workflow.
5. Real-time visibility for every stakeholder.
6. Mobile-first experience for field users — **and web for every role** (Decided 2026-09-04: six role apps, each web + Android + iOS, plus a web admin console).
7. Automation wherever practical — **but AI drafts and a human commits** (Decided 2026-09-05).
8. Configurable workflows without custom development — **within fixed rails**. Configurable per distributor: branding, numbering series, credit modes and limits, schemes, settlement tolerance, proof-of-delivery policy, feature flags. Not configurable: state machines, the seven roles, approval kinds, the permission matrix (Decided 2026-09-05, correcting the version 1.0 statement that statuses and approval flows are configurable).

# Who performs the process

Seven applications, each on its own backend service, so a role can only reach the endpoints its service mounts. Six role apps plus a platform-admin console (Decided 2026-09-05). The version 1.0 assumption of a Data Entry Operator who keys orders and generates invoices is removed: there is no such role.

| App                         | Signs in                | Service : port           | What it owns in the process                                                                  |
| --------------------------- | ----------------------- | ------------------------ | -------------------------------------------------------------------------------------------- |
| Distribution OS - Owner     | `owner`                 | owner-service : 3001     | Approvals, prices, schemes, credit, live map, day numbers with graphs, branding, imports     |
| Distribution OS - Manager   | `manager`, `accountant` | manager-service : 3002   | Order queue, GRN review, billing desk, load-sheet approval, day-end, registers, Tally export |
| Distribution OS - Sales     | `salesperson`           | sales-service : 3003     | Beat, shop check-in, order capture, bargain request. Never sees cost, never collects money   |
| Distribution OS - Warehouse | `warehouse`             | warehouse-service : 3004 | Gate count, supplier-bill capture, pick, pack (invoice issued here), load sheets, challans   |
| Distribution OS - Delivery  | `delivery`              | delivery-service : 3005  | Trip, stops, proof of delivery, returns, collections, van sales, settlement                  |
| Distribution OS - Retailer  | `retailer`              | retailer-service : 3006  | Own bills and outstanding, reorder, pay online, track delivery                               |
| Distribution OS - Admin     | `platform_admin`        | admin-service : 3007     | Distributor onboarding, plans, subscription state, time-boxed support access (PLANNED, v1)   |
| Sign-in for all             | every role              | auth-service : 3000      | Username and password, our own tokens, switch distributor                                    |

# Process 1 — Order to Cash

The single loop every order travels. Each step names the actor, the app and the record the system writes.

| #   | Step                                    | Actor · App                                                | System result                                                                                                                                                           | Status                                |
| --- | --------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 1   | Open today's beat                       | Salesperson · Sales                                        | Beat plan with shop sequence and last-order context                                                                                                                     | BUILT                                 |
| 2   | Check in at the shop                    | Salesperson · Sales                                        | Geo-tagged visit — **evidence, never a block** on ordering                                                                                                              | BUILT                                 |
| 3   | Build the order                         | Salesperson · Sales                                        | Reorder-last, suggested list or grid; cases and pieces; live available-to-promise **hint**                                                                              | BUILT                                 |
| 4   | Price and credit check on the device    | System · Sales                                             | `pricing.quote`: tier price → retailer override → schemes → approved bargain → cash discount **reported, not deducted**. Credit exposure checked                        | BUILT                                 |
| 5a  | Inside limits: submit                   | Salesperson · Sales                                        | Order `draft → submitted`                                                                                                                                               | BUILT                                 |
| 5b  | Bargain or over limit: request approval | Salesperson · Sales                                        | Approval request (price variance, credit, minimum order value, bargain)                                                                                                 | BUILT                                 |
| 6   | Approve or reject                       | Owner · Owner                                              | Rejection is a cancel with a reason code                                                                                                                                | BUILT                                 |
| 7   | Confirm                                 | System                                                     | Server **re-prices at the same pricing version** and reserves stock; `submitted → confirmed`                                                                            | BUILT                                 |
| 8   | Fulfilment queue by beat or trip        | Warehouse · Warehouse                                      | Wave of confirmed orders                                                                                                                                                | BUILT                                 |
| 9   | Picklist and pick                       | Warehouse · Warehouse                                      | Consolidated by SKU, FEFO lots, actual lots recorded; `confirmed → picking`                                                                                             | BUILT                                 |
| 10  | Pack per order                          | Warehouse · Warehouse                                      | `picking → packed`. A short pack is a **pack row, never an order edit**                                                                                                 | BUILT                                 |
| 11  | **Invoice issued at pack**              | System · Warehouse                                         | GST tax invoice on the tenant's own series, distributor's name and logo, UPI QR (Decided 2026-09-04: shops are GST-registered, B2B tax invoice is the primary document) | BUILT                                 |
| 12  | Load sheet and manager approval         | Warehouse raises · **Manager approves in the Manager app** | Crew count confirmed by manager PIN given from the manager's own device (Decided 2026-09-05, replacing a PIN typed on the warehouse phone)                              | BUILT                                 |
| 13  | Dispatch                                | Warehouse · Warehouse                                      | `packed → dispatched`; stock moves warehouse → vehicle; delivery challan printed                                                                                        | BUILT                                 |
| 14  | Run the trip                            | Delivery crew · Delivery                                   | Trip and next stop, maps hand-off for navigation                                                                                                                        | BUILT                                 |
| 15a | Deliver in full                         | Delivery crew · Delivery                                   | `delivered` + proof of delivery (signature, photo, per tenant policy)                                                                                                   | BUILT                                 |
| 15b | Deliver in part                         | Delivery crew · Delivery                                   | Per-line quantity and reason → **credit note**, never an invoice edit                                                                                                   | BUILT                                 |
| 15c | Fail the stop                           | Delivery crew · Delivery                                   | Reason recorded, stock stays on the vehicle                                                                                                                             | BUILT                                 |
| 16  | Collect at the door                     | Delivery crew · Delivery                                   | Cash, UPI with UTR, or cheque. Receipt allocated **oldest bill first** unless tagged                                                                                    | BUILT                                 |
| 17  | Van sale from vehicle stock             | Delivery crew · Delivery                                   | Normal invoice series — no separate van-sale numbering (Decided 2026-09-04)                                                                                             | BUILT                                 |
| 18  | Trip check-in                           | Delivery crew · Delivery                                   | Unsold stock counted back in, cash settled; variance beyond the owner's tolerance blocks the close and needs owner approval                                             | BUILT                                 |
| 19  | Day-end                                 | Manager / accountant · Manager                             | Registers, bank deposits, cheques, brand-DMS bills captured                                                                                                             | BUILT                                 |
| 20  | Shop is informed                        | System                                                     | Invoice, proof of delivery and receipt on WhatsApp; the shop can also pay online in the Retailer app                                                                    | PLANNED (v1) — module `notifications` |

**Second order source.** The shop itself orders — reorder from the Retailer app or free text on WhatsApp — and joins the same loop at step 5a (Decided 2026-09-05: the Retailer app **places** orders; version 1.0 marked customer self-ordering as "future").

**Order-to-cash exceptions.**

| Exception                          | How the process handles it                                                               | Status                                          |
| ---------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Insufficient stock                 | Available-to-promise hint at capture, authoritative check at confirm, short pack at pack | BUILT                                           |
| Credit limit exceeded              | Approval request to the owner; the order does not silently proceed                       | BUILT                                           |
| Customer unavailable / shop closed | Stop fails with a reason; stock returns on the vehicle                                   | BUILT                                           |
| Partial delivery                   | Per-line quantity and reason → credit note                                               | BUILT                                           |
| Damaged goods                      | Damaged location, inbound discrepancy, `return_damaged`                                  | BUILT                                           |
| Payment mismatch at settlement     | Variance recorded; trip closes as `settled_with_variance` with owner approval            | BUILT                                           |
| Network unavailable                | Offline upload **never** answers 4xx; rejections are recorded and shown, never lost      | BUILT (sales and delivery offline before pilot) |
| Wrong product picked               | Only short pack and FEFO override exist; there is no mis-pick correction step            | GAP NAMED                                       |
| Vehicle breakdown                  | Cancel before departure, or return the trip and fail the open stops                      | BUILT, GAP NAMED                                |

# Process 2 — Stock In: Supplier Bill to Goods Received

"Zero manual entry" has a precise meaning: **zero typing except the blind gate count.** This flow replaces the version 1.0 steps Purchase Planning, Goods Receipt, Quality Check and Warehouse Putaway with what the product actually does.

1. **Blind gate count.** The warehouse counts what arrived without seeing the bill quantities. This is the only typing in the flow.
2. **Capture the bill.** Photograph or share the supplier invoice from the Warehouse app.
3. **QR check.** If the bill carries an e-invoice QR, verify the signature, IRN, both GSTINs and the totals. If it does not, continue.
4. **Vision extraction.** The worker reads every page; pack notations (`x90`, `_120`, `CS1`) are normalised.
5. **Validators.** GST arithmetic, HSN codes, page completeness, lines against the QR payload, and a three-way match with the purchase order and lorry receipt.
6. **SKU match.** Aliases, then the supplier's external codes, then fuzzy match, then a human.
7. **Human review on the phone.** Line cards with image crops; mark short or damaged; enter batch and expiry. **Document intake never commits on its own.**
8. **Commit once, idempotently.** The reviewed document books the supplier invoice; posting the GRN writes the lots, the GRN rows in the stock ledger, the purchase cost and the accounts-payable journal. Every mutation carries an idempotency key, so a repeated press cannot double-receive stock.
9. **Stock is sellable.** Visible to the Sales app within one sync.

**Purchase cost is invisible by construction.** It lands in `tenant_product_costs`, readable only by owner, manager, accountant and system. That is a database policy with tests, not a hidden field in a screen.

**Brand-DMS lane (pilot reality).** Too Yumm is billed by the brand in FieldAssist DMS. Those bills are captured before loading and committed as `source = brand_dms_import` — **a receivable in; no stock movement**, because the brand's field force already moved the goods on its own documents — and are **never re-issued as a second legal invoice**.

**Status.** Steps 1, 8 and 9 are BUILT (gate count, GRN post, `sellable_stock`). Steps 3–7 are PLANNED (v1) — module 5 `docint`, whose contract, permission rows and migrations are already in the repository. Purchase planning and reorder suggestion arrive with the AI module below. **NOT IN V1:** racks and bins, barcode scanning of picks, and a separate quality-check state — short and damaged are handled at the gate and in review.

# Process 3 — Money: Who May Collect

| Channel         | Who records it             | App            | Result                                                                                   |
| --------------- | -------------------------- | -------------- | ---------------------------------------------------------------------------------------- |
| At the door     | Delivery crew              | Delivery       | Cash, UPI with UTR, or cheque                                                            |
| Online          | The shop itself            | Retailer       | UPI QR or link against its own bills                                                     |
| At the office   | Owner, manager, accountant | Owner, Manager | Payment received at the desk                                                             |
| **Salesperson** | **Never**                  | —              | The sales service has **no receipt endpoint** and the permission matrix never grants one |

**Decided 2026-09-04: only delivery collects money, or the shop pays online; the salesperson never does.** This replaces the version 1.0 persona statement that collections are a sales-representative responsibility. The salesperson may **see** a shop's outstanding and its credit check (Decided 2026-09-05) — visibility without a cash box.

Rules that follow every receipt:

1. Receipts are append-only, carry a client receipt number, and are allocated bill to bill, **oldest first**, unless the payer tags a bill.
2. Every receipt posts to a double-entry journal that **must balance at commit** — enforced by a database trigger, not by application code.
3. Outstanding and ageing are recomputed into buckets 0–7, 8–15, 16–30, 31–60, 61–90 and 90+ days. "Overdue" is derived, never stored as a state.
4. A cheque moves collected → deposited; a bounce posts a reversal plus bank charges and reopens the bill.
5. Cash discount is shown on the bill and realised as a credit note **only when the payment arrives on time** (Decided 2026-09-04).
6. Write-off is back-office only.
7. Cash on a vehicle counts toward expected cash at settlement; variance beyond the owner's tolerance blocks the trip close.

**NOT IN V1:** bank-statement reconciliation. The version 1.0 payment ladder's "Verified" and "Reconciled" stages do not exist; receipt status is collected, deposited, bounced or cancelled. Distribution OS also does not move money itself — no payments aggregation, no lending, no fintech.

# Process 4 — Sign-In and Permissions

1. The app posts username, password and a device id to auth-service :3000. **Decided 2026-09-04: username and password with our own token service; OTP over SMS or WhatsApp is a later layer on top, not a replacement.**
2. The password is verified against an argon2id hash; five failures lock the account for fifteen minutes.
3. The service returns a 15-minute access token and a rotating per-device refresh token. Reuse of an old refresh token revokes the session.
4. Every request to a role service is checked twice: the service refuses roles it does not serve **before any business logic**, then the permission matrix decides the specific endpoint. The guard fails closed on an undeclared route.
5. The database transaction sets the tenant, actor and role, and row-level security returns only the rows that tenant and role may see.
6. A user with more than one distributor — a shop buying from several, or shared staff — switches distributor without signing in again.

**Branding.** Distribution OS appears only on the sign-in screen. Inside every app and on every printed document the distributor's own name and logo appear (Decided 2026-09-04, white-label).

# AI Steps in the Process

**Decided 2026-09-05: all four AI capabilities ship in v1, before the pilot** — the first four rows below; the fifth, vision extraction, was always part of document intake. This reverses the earlier plan to defer voice, WhatsApp parsing, forecasting and routing, and version 1.0's marking of voice and WhatsApp ordering as "future". The guardrail is fixed: **AI drafts, a human commits.**

| Capability                                 | Where it sits in the process          | Guardrail                                                                                                       | Status                           |
| ------------------------------------------ | ------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| WhatsApp free-text order capture           | Before step 5a of Process 1           | Parsed against that shop's own SKU and order history into a **draft**; always human-confirmed before submission | PLANNED (v1) — module 12 `ai`    |
| Voice order capture                        | Before step 5a, in the Sales app      | Speech to text into the same parser and the same human confirmation                                             | PLANNED (v1) — module 12 `ai`    |
| Demand forecasting and reorder suggestions | Purchase planning, ahead of Process 2 | A suggested purchase quantity a buyer edits and approves; never an automatic purchase order                     | PLANNED (v1) — module 12 `ai`    |
| Route sequencing                           | Between steps 13 and 14 of Process 1  | Stops ordered by distance and time windows; **the driver may override any sequence**                            | PLANNED (v1) — module 12 `ai`    |
| Supplier-bill vision extraction            | Step 4 of Process 2                   | Human review before every GRN commit                                                                            | PLANNED (v1) — module 5 `docint` |

# Core Business Object Lifecycles

These are the coded state machines. Application code calls the machine; **no screen and no service ever writes a state column by hand.** Version 1.0's ladders are replaced here; states it named that do not exist are listed at the end.

**Sales Order** — `draft → submitted → confirmed → picking → packed → dispatched → delivered | partially_delivered → closed`

| Rule                        | Detail                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Cancellation                | Allowed up to `confirmed`, not after                                                                           |
| Reservation                 | Posts as a side effect of `confirm`; it is not a state                                                         |
| Goods returning undelivered | `dispatched → packed` — back to the warehouse, not to the shop                                                 |
| Network orders              | Mapped to ONDC vocabulary (Created / Accepted / In-progress / Completed / Cancelled) without renaming anything |

**Trip** — `planned → loading → active → closing → settled | settled_with_variance`; cancellable from `planned` or `loading`.

**Stop** — `pending → started → arrived → delivered | partial | failed`. Payment is a receipt, not a stop state; there is no driver "accepted" step.

**Invoice** — `draft → issued → partially_paid → paid`. An `issued` invoice may be `written_off`, or `cancelled` before dispatch and before a single rupee is allocated — the number survives cancellation. Once money lands, the only correction is a credit note. An issued invoice is never edited or regenerated.

**Supplier document (intake)** — `uploaded → verifying → extracting → extracted | needs_review → reviewed → committed`, with `rejected` and `failed` reachable from any non-terminal state. Only a human review can reach `committed`.

**Purchase Order** — a status list (`draft`, `sent`, `partially_received`, `received`, `cancelled`), not yet a state machine. Version 1.0's Submitted, Approved and Closed stages do not exist. **GAP NAMED.**

**States named in version 1.0 that are not states:** Validated and Reserved (both collapse into `confirmed`), Loaded (it is the load sheet), Accepted (no driver acceptance step), Payment Collected (a receipt, not a stop state), Verified and Reconciled (no bank reconciliation).

# Steps From Version 1.0 That Are Not in v1

| Version 1.0 step                                           | Decision                                                                                                                                 |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Purchase Planning                                          | Replaced by AI reorder suggestions (module 12); no separate planning workflow                                                            |
| Quality Check as a stage                                   | Handled as short and damaged at the gate and in review; no QC state                                                                      |
| Warehouse Putaway, racks, bins, barcode scanning           | NOT IN V1 — stock lands in the godown location; the only QR in the product is e-invoice verification                                     |
| Analytics as a workflow stage                              | Reporting is a module (planned), not a step in the loop; the owner's graphs are its first consumer                                       |
| Per-organisation custom roles, statuses and approval flows | NOT IN V1 — one fixed matrix over seven roles, fixed state machines, fixed approval kinds                                                |
| Multiple branches                                          | **Decided 2026-09-05:** one tenant = one distributorship for v1; multi-branch is v2, each branch its own tenant with an owner group view |

# The Nine Business Domains

Version 1.0 organised the business into nine domains. All nine survive; the table states how each is covered today.

| Domain           | Coverage in Distribution OS                                                                                           | Status                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Procurement      | Suppliers, pack configurations, purchase orders, supplier invoices, GRN, discrepancies, returns to supplier           | BUILT + `docint` PLANNED (v1)                       |
| Inventory        | Locations, lots, batches, expiry, transfers, adjustments, cycle counts, reservations — **no bins**                    | BUILT                                               |
| Sales            | Rep capture, shop self-order, WhatsApp and voice capture, imports; call-centre orders are the desk placing an order   | BUILT + `ai` PLANNED (v1)                           |
| Order Fulfilment | The twenty steps of Process 1                                                                                         | BUILT                                               |
| Logistics        | Vehicles, trips, stops, GPS, live tracking, delivery confirmation, route sequencing                                   | BUILT + routing PLANNED (v1)                        |
| Finance          | Receivables, receipts, credit, collections, credit notes and reversals, journals, Tally export                        | BUILT                                               |
| CRM              | Retailers, contacts, visits, schemes, promotions — **complaints not modelled**                                        | BUILT, GAP NAMED                                    |
| Analytics        | KPIs, registers, owner graphs, forecasts, alerts                                                                      | PLANNED (v1) — modules `reporting`, `notifications` |
| Administration   | Users, the seven fixed roles, permission matrix, organisation settings, numbering, feature flags, audit, integrations | BUILT                                               |

# Automation and Real-Time Visibility

Automation that exists today: stock reserved on confirm; picklists generated and FEFO lots chosen; the invoice issued automatically at pack; overdue flagged by computation; ageing recomputed on every receipt; the permission decision made before business logic. Planned for v1: customer notifications and payment reminders, commission and incentive calculation, reporting and the owner's graphs, low-stock alerts, and the AI steps above.

At any moment the system answers: where is the order (order state and stop state); where is the crew (GPS points and the owner's live map); what stock is available; which shops are overdue and by how much; which deliveries failed and why; which salesperson is behind target. Every activity also writes an event to an outbox that drives notifications, integrations, audit and dashboards — the event-driven design of version 1.0, now with a named mechanism.

# Success Criteria

The future-state workflow succeeds when: orders are captured digitally at source; the only typing on the inbound side is the gate count; inventory is accurate in real time and cost stays invisible to field roles; delivery progress and proof are visible as they happen; every rupee is on an append-only ledger with a balancing journal entry; the distributor can coexist with a brand's DMS without ever issuing a second legal invoice; and the platform scales from one distributor to lakhs of users without a change of shape.

# Related Documents

AS-IS Business Process · Pain Point Analysis · Personas · Product Principles · Product Goals · Success Metrics (KPIs) · Problem Statement · Founder Decisions Register.

**Source of truth.** This page mirrors `docs/22-source-of-truth.md` in the repository (§4 order to cash, §5 stock in, §6 money, §7 sign-in, §8 dated decisions, §9 non-negotiables). Where this page and that file disagree, the file wins and this page is corrected. Build status figures come from `docs/18-build-log.md`; screen-level detail from `docs/23-app-screens-and-api-gaps.md`.
