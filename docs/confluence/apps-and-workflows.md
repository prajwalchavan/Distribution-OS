# Seven Apps & Workflows

## Document Information

| Property     | Value                  |
| ------------ | ---------------------- |
| Document     | Seven Apps & Workflows |
| Product      | Distribution OS        |
| Version      | 2.0                    |
| Status       | Active                 |
| Owner        | Product Management     |
| Last Updated | September 2026         |

---

# Purpose

This page is the map of the product: which application each person opens, on which device, against which backend service, what screens that application contains, which end-to-end flows it takes part in, and — just as important — what it must never be able to do.

The shape is a founder decision of **2026-09-04**, extended on **2026-09-05**: **every role gets its own application**, the manager and the accountant share one, and a seventh application serves Distribution OS staff. Each application talks to **its own backend service**, so a role can only reach the endpoints its service mounts; a per-endpoint permission matrix then decides what that role may call inside it. `docs/22-source-of-truth.md` in the repository is the single source of truth; this page mirrors it.

---

# The seven applications at a glance

| #   | Application                 | Who signs in                              | Device                            | Service : port             |                Screens | Offline                  |
| --- | --------------------------- | ----------------------------------------- | --------------------------------- | -------------------------- | ---------------------: | ------------------------ |
| 1   | Distribution OS - Owner     | `owner`                                   | Web + Android + iOS · desk        | `owner-service` : 3001     |                     26 | Online-first             |
| 2   | Distribution OS - Manager   | `manager`, `accountant`                   | Web + Android + iOS · desk        | `manager-service` : 3002   |                     21 | Online-first             |
| 3   | Distribution OS - Sales     | `salesperson`                             | Web + Android + iOS · phone       | `sales-service` : 3003     |                     14 | **Offline before pilot** |
| 4   | Distribution OS - Warehouse | `warehouse`                               | Web + Android + iOS · phone       | `warehouse-service` : 3004 |                     12 | Online-first             |
| 5   | Distribution OS - Delivery  | `delivery`                                | Web + Android + iOS · phone (GPS) | `delivery-service` : 3005  |                     12 | **Offline before pilot** |
| 6   | Distribution OS - Retailer  | `retailer` (one login, many distributors) | Web + Android + iOS · phone       | `retailer-service` : 3006  |                     13 | Online only              |
| 7   | Distribution OS - Admin     | `platform_admin` (our own staff)          | Web only                          | `admin-service` : 3007     |    Not yet inventoried | Online only              |
| —   | Sign-in for all seven       | every role                                | —                                 | `auth-service` : 3000      | 4 shared frame screens | —                        |

Decided 2026-09-04: each of the six role applications ships as **web, Android and iOS from one codebase** — the earlier "some personas get web, some get mobile" split is retired. Availability is uniform; the **working surface** is not: the phone for sales, warehouse, delivery and retailer, and the desk for owner and manager. Decided 2026-09-05: the **Admin console is web only**, and it is in v1 rather than post-pilot.

Screen counts are the binding inventory in `docs/23-app-screens-and-api-gaps.md`: 98 role screens plus 4 frame screens shared by every application (sign-in, forced password change, app chrome, profile and devices).

---

# Rules that bind all seven applications

1. **Sign-in is username + password** against `auth-service` :3000, with our own EdDSA tokens and a per-device rotating refresh token (decided 2026-09-04). OTP over SMS or WhatsApp is a **later layer on top**, not a replacement.
2. **A service serves only its own roles.** Any other role is refused with 403 before a single line of business logic runs. That is why the manager's load-out approval cannot happen on the warehouse device (see Workflow D).
3. **Every endpoint has a row in the permission matrix**, tested for every endpoint against every role; the guard fails closed on an undeclared route. Permissions are one fixed table — decided 2026-09-04, they are **not** customisable per distributor.
4. **White-label.** Distribution OS branding appears only on the sign-in screen. Inside every application and on every printed document, the distributor sees their own name and logo (decided 2026-09-04).
5. **State columns change only through the state machines** — order, trip and stop, invoice. No screen sets a state by hand.
6. **English only for now** (decided 2026-09-04); the layout for all six role applications is **A Ledger** (decided 2026-09-05); the admin console adopts the desk density of the same system when it is designed.
7. **One tenant = one distributorship** in v1 (decided 2026-09-05). Multi-branch is v2, each branch its own tenant with an owner group view.

---

# 1. Owner application

**Who:** the distributor-owner. **Device:** desk-primary with graphs, phone-secondary for four zero-tap answers. **Service:** `owner-service` :3001, role `owner`. **26 screens.**

**Screens (grouped).** Today · Growth and performance (the graphs screen) · Approvals queue · Live map · Profit view (an owner-only route, never bundled into a shared screen) · Orders register · Retailers · Beats and staff · Prices and schemes · Catalog, costs and suppliers · Money: outstanding and ageing · Money: receipts, banking, cheques · Books: trial balance and day book · Billing register and GST · Credit notes · Stock · Inbound: supplier invoices, GRNs, purchase orders · Documents inbox · Delivery: trips, settlements, expenses, collections · Claims · Incentives · Imports wizard · Exports and Tally · Notifications and templates · Settings · Audit and security.

**Flows it takes part in:** approves what is outside the rules in Workflow A (price variance, credit, minimum order value, bargain, red settlement, GRN exception); watches the road in Workflow C; owns branding, numbering series, credit terms, prices, schemes and feature flags; runs data migration through the generic importer.

**Graphs are a requirement, not a nice-to-have** (decided 2026-09-04): sales trend, month-on-month and year-on-year growth, brand / beat / rep comparison, collections and outstanding trends, fill rate, delivery performance, margin by brand.

**It must never:** edit an issued invoice (corrections are credit notes); set a state column directly; see another tenant's rows. Margin and purchase cost live on owner-service alone — that is a database policy with tests, not a screen rule.

---

# 2. Manager application (shared with the accountant)

**Who:** the manager, and the accountant in the same application with a narrower hand. **Device:** desk-primary, with three phone surfaces (bill capture, gate count, pick and pack). **Service:** `manager-service` :3002, roles `manager` and `accountant`. **21 screens.**

**Screens (grouped).** Today · Order queue (submitted to confirmed) · Inbound documents: capture and review · Supplier invoices, GRN open and post, discrepancies, purchase orders · Fulfilment desk (queue to wave) · Billing desk · Load-out and challans · Credit notes · Receipts and allocations · Day-end: banking, cheques, trip settlement · Brand-DMS bills · Registers (the accountant's home) · Tally export and mapping · Retailers and credit · Prices and schemes · Stock · Claims · Notifications · Phone: gate count · Phone: pick and pack · Team performance.

**Flows:** the desk of Workflow A (confirm, bill, load out), the review-and-commit half of Workflow B, and the day-end of Workflow C.

**Accountant scope, decided 2026-09-05: money desk plus reads.** The accountant may record office receipts, deposits, cheque bounces, write-offs and credit notes, and may read and export everything. The accountant has **no** access to prices, schemes, credit limits, approvals or settings — a narrowing of the earlier "accountant approves credit" statement.

**It must never:** re-invoice a brand-DMS sale — a bill already raised in the brand's own DMS (Too Yumm on FieldAssist) is imported and linked, never issued a second time; edit an issued invoice; commit a scanned supplier document without a human review.

---

# 3. Sales application

**Who:** the salesperson, standing in a shop doorway. **Device:** phone. **Service:** `sales-service` :3003, role `salesperson`. **14 screens, 4 tabs** (Beat, Orders, Shops, Me). Target: a repeat order in three taps, a modified order in fifteen.

**Screens (grouped).** Today's beat · Shop card · Order entry (reorder last, suggested, grid; case and piece stepper; live availability hint) · Bargain request · Submit and status ("needs attention" tray) · My orders · New shop · Visits history · Performance · Lapsed shops · Catalog and stock browse · Pending bills of a shop (read-only) · Inbox · Me.

**Flows:** the front of Workflow A — check in, price on the device, credit-check on the device, submit or raise an approval.

**Offline is mandatory before the pilot** (decided 2026-09-04). The device holds the rep's own beats and shops, the catalog without cost, sellable stock, price lists, schemes and overrides, own orders for 90 days, visits and bargains; writes queue and upload later. **An offline upload never answers a 4xx** — rejections come back as recorded errors and are shown, never lost.

**It must never:** see purchase cost, landed cost or margin; **record a receipt of any kind** (decided 2026-09-04 — the sales service has no receipt endpoint and the matrix never grants one); link a shop's phone identity, because a rep must not learn whether that phone exists in another distributor's network; treat a failed geo-tag at check-in as a block — it is evidence, never a gate.

Refined 2026-09-05: the rep **may see** a shop's outstanding, its ageing and the credit-check result. The rule is "never collects", not "never sees dues".

---

# 4. Warehouse application

**Who:** the godown staff. **Device:** phone in the aisle, desk for the queue. Large targets, no Save step, a full-screen keypad for counting. **Service:** `warehouse-service` :3004, role `warehouse`. **12 screens, 4 tabs** (Inbound, Pick, Pack, Load).

**Screens (grouped).** Home queues · Capture supplier bill · Gate count · Fulfilment queue to wave · Picking sheet (consolidated by SKU, FEFO lots, actual lot, short reason) · Pack per order · Load sheet with crew blind count and challan · Stock · Van check-in count · Trips: create and start loading · Reservations · Me and inbox.

**Flows:** the receiving end of Workflow B (blind gate count, capture the bill) and the middle of Workflow A (pick, pack, dispatch).

**The invoice is issued here, at pack** (decided 2026-08, restated 2026-09-04) — not by a data-entry desk before picking. A short pack is recorded as a pack row; the order is never edited to match what went in the carton.

**It must never:** see purchase cost or margin; open or post a GRN (the desk does that after review); **confirm its own load-out** — decided 2026-09-05, the manager approves the load sheet from the Manager application and the warehouse device waits for it (see Workflow D); edit an order to fix a short pack.

---

# 5. Delivery application

**Who:** the delivery crew. **Device:** phone, one-handed, with the other hand full; GPS running. No tab bar — a single stack that opens on the next stop. **Service:** `delivery-service` :3005, role `delivery`. **12 screens.**

**Screens (grouped).** Today's trip · Start trip (consent, odometer, opening cash, depart) · Stop · At the door: deliver, partial or failed, with proof of delivery · Collect (cash, UPI with UTR, cheque) · Van sale · Expenses · Day summary and check-in · Share invoice, POD or receipt · Needs attention (sync rejections) · Trip history · Me and inbox.

**Flows:** the last mile of Workflow A and the collecting end of Workflow C.

**Offline is mandatory before the pilot.** The device holds today's trip and stops, the bills and shops of those stops, the vehicle's stock snapshot, pricing inputs for van sales and the tenant's settlement and proof-of-delivery policy. GPS points bypass the offline queue and post to their own endpoint.

**It must never:** see purchase cost or margin; settle its own trip — the crew hands over, the desk settles, and a variance beyond the owner's tolerance blocks the close; bill a van sale on a separate number series (decided 2026-09-04: van sales use the tenant's normal invoice series); pre-fill the amount collected; keep GPS beyond the tenant's retention setting or without a granted consent.

---

# 6. Retailer application

**Who:** the shopkeeper. **Device:** phone, online only. One login that spans every distributor the shop buys from, one card per linked distributor. **Service:** `retailer-service` :3006, role `retailer`. **13 screens, no tab bar.** Decided 2026-09-05, this application is **in v1** — the earlier "Retailer (Future)" label is retired.

**Screens (grouped).** Sign-in and deep link · Distributor cards · Outstanding (the pending-bills file) · Bill detail · Pay online · Statement of account · Reorder and order editor · Order status and delivery tracking · Deals · Request a discount · Shop profile self-edit · Notifications · Receipts.

**Flows:** an entry point into Workflow A (the shop places its own order, decided 2026-09-05) and into Workflow C (the shop pays online against its own bills).

**It must never:** see another shop's rows or any other distributor's data than the one whose card is open; see purchase cost or margin; see the internal approval trail on its own order; edit its own credit limit, credit days or price tier; place an order that skips the server's re-price — the shop's draft is priced again server-side at confirmation, exactly like the rep's.

---

# 7. Admin application (platform console)

**Who:** Distribution OS staff. **Device:** web only. **Service:** `admin-service` :3007, role `platform_admin`. Decided 2026-09-05: this console is in **v1**, replacing the earlier position that tenants are created by a seeding script and there is no platform console.

**Scope.** Onboard a distributor organisation · plans and subscription state · time-boxed, owner-approved, audited **support-access grants**.

**Flows:** it sits outside every tenant flow. It creates the tenant that Workflows A to D then run inside.

**It must never:** read a distributor's business data without a support grant that the owner approved, that expires on its own, and that is written to the audit log; appear anywhere in a distributor's documents or applications; take a payment — revenue is the distributor's subscription, and there is no fintech in the product.

**Honest status:** the screen inventory in `docs/23` covers the six role applications. The Admin console's screens are not inventoried yet; it is queued as backend module 13.

---

# Workflow A — Order to cash

| Step | App                       | What happens                                                                                     | Order state                     |
| ---- | ------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------- |
| 1    | Sales                     | Beat for today; check in at the shop (geo-tagged as evidence, never a block)                     | —                               |
| 2    | Sales or Retailer         | Order built: reorder last, suggested, or grid; cases and pieces; live availability hint          | draft                           |
| 3    | Sales                     | Price engine and credit check run on the device                                                  | draft                           |
| 4    | Sales, or Owner / Manager | Inside the rules: submitted. Outside: bargain or approval request first                          | submitted                       |
| 5    | Server                    | Re-prices at the same rule version and reserves stock                                            | confirmed                       |
| 6    | Warehouse or Manager      | Fulfilment queue grouped by beat or trip; picklist consolidated by SKU, FEFO lots                | picking                         |
| 7    | Warehouse                 | Pack per order; short packs are pack rows, never order edits                                     | packed                          |
| 8    | Warehouse                 | **GST invoice issued at pack** on the tenant's own series, own name and logo, UPI QR             | packed                          |
| 9    | Manager                   | Load sheet approved (Workflow D), crew count confirmed, challan printed                          | dispatched                      |
| 10   | Delivery                  | Stop by stop: delivered, partial (per-line quantity and reason, becomes a credit note) or failed | delivered / partially_delivered |
| 11   | Delivery                  | Collect cash, UPI with UTR, or cheque; receipt allocated oldest bill first                       | —                               |
| 12   | Delivery, then Manager    | Check-in: unsold stock counted back, cash settled; variance beyond tolerance goes to the owner   | closed                          |

Cancellation is allowed up to `confirmed`. A dispatched order that comes back becomes `packed` again. An issued invoice is never edited; a cancelled invoice keeps its number.

---

# Workflow B — Stock in (zero typing except the gate count)

1. **Warehouse** does a blind gate count and photographs or shares the supplier bill.
2. If the bill carries a QR, the e-invoice signature, IRN, GSTINs and totals are verified.
3. The worker reads every page by vision extraction and normalises pack sizes.
4. Validators check GST arithmetic, HSN, page completeness, lines against the QR, and the three-way match with the purchase order and lorry receipt.
5. SKU matching runs: aliases, then external codes, then fuzzy, then a human.
6. **Manager** reviews on the phone or desk — line cards with crops, short or damaged, batch and expiry.
7. One idempotent commit writes the supplier invoice, the lots, the stock-ledger receipt rows, the purchase cost and the payables journal.
8. Stock becomes visible to the Sales application within one sync.

**Document intake never commits on its own.** A brand-DMS bill (Too Yumm on FieldAssist) enters the same pipeline and is committed as an import — **a receivable in; no stock movement**, because the brand's field force already moved the goods on its own documents — and is **never** issued as a second legal invoice.

---

# Workflow C — Money

| Who may record money       | Where                               | Note                                                 |
| -------------------------- | ----------------------------------- | ---------------------------------------------------- |
| Delivery crew              | At the door, in the Delivery app    | Cash, UPI with UTR, cheque                           |
| The shop itself            | Retailer app, against its own bills | UPI QR or link, payee is the distributor             |
| Owner, manager, accountant | Manager or Owner app                | Payments received at the office                      |
| Salesperson                | **Nowhere**                         | Decided 2026-09-04 — no endpoint exists for the role |

Every receipt is append-only, carries a client receipt number, and allocates bill-to-bill oldest first unless it is tagged. Every receipt posts to a double-entry journal that must balance at commit — enforced in the database, not the application. Cheques move to deposited, and a bounce reverses with bank charges and reopens the bill. Cash discount is shown on the bill and realised as a credit note only when paid on time. Write-offs are back-office only.

---

# Workflow D — Load-out approval across two apps

Decided 2026-09-05: **the manager's approval for load-out is given in the Manager application**, not typed on the warehouse phone.

1. **Warehouse** builds the load sheet, last stop first, and records the crew's blind count.
2. The warehouse screen then shows "waiting for manager" and is read-only.
3. **Manager** opens the sheet in their own application, on phone or desk, checks the e-way bill gate and confirms.
4. Stock moves from godown to vehicle, the challan prints, and the orders become dispatched.

This follows from rule 2 above: warehouse-service serves only the warehouse role, so a manager's token is refused there before any business logic. Keeping the approval in the manager's own app needs no new backend surface.

---

# AI in the flows

Decided 2026-09-05: **all AI features are in v1, before the pilot** — this overrides the earlier position that route optimisation was out of scope and that voice and WhatsApp parsing were post-pilot.

| Capability                                 | Where it lands                       | Rule                                                                                                         |
| ------------------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| WhatsApp free text becomes a draft order   | Enters Workflow A at step 2          | Parsed against that shop's own purchase history; **always confirmed by a person** before it becomes an order |
| Voice order capture                        | Sales app, order entry               | Speech into the same parser, same human confirmation                                                         |
| Demand forecasting and reorder suggestions | Owner and Manager, purchase planning | A suggestion, never an automatic purchase order                                                              |
| Route sequencing                           | Manager load-out, Delivery trip      | Stops sequenced by distance and time window; the driver may override                                         |

These are queued as backend module 12 and are not built yet; the screens that host them are not yet in the screen inventory.

---

# What is not built yet

As at 2026-09-05 13:45 IST: **14 backend modules verified, 1,442 automated tests, 1,004 endpoint calls exercised, 0 broken** (Build Status & Roadmap mirrors `docs/18-build-log.md`). Against this page:

- **No application screen exists yet.** Backend first is a deliberate sequencing decision (2026-09-04). The layout **A Ledger** was chosen 2026-09-05; the applications are then built one at a time, each against its own service.
- **Six backend modules remain** before the applications start: document intake, integrations, claims, notifications, reporting and incentives — plus the AI module and the Admin console.
- **Owner graphs** need a reporting series endpoint that is specified but not built: month grain, year-on-year comparison and grouping by beat do not exist today.
- **Printing** — the invoice, credit-note and challan documents carry the distributor's seller block, but the PDF renderer for the challan is still open.
- **Retailer sign-in** has no forgotten-password or one-time-link path yet; a shop has nobody to ask for a reset. Flagged for the founder before the pilot.

---

# Summary

Seven applications; seven role services plus `auth-service`, and a worker — eight service packages when `admin-service` lands, seven today; one database. A person's job decides their application; their application decides which service they can reach; the permission matrix decides what they may call there; and row-level security decides which rows come back. The four workflows above are the only paths a piece of stock or a rupee can travel, and each one crosses application boundaries at a named handoff — order to confirmation, pack to invoice, load sheet to manager, door to receipt, receipt to ledger.

**Sources:** `docs/22-source-of-truth.md` §2 (people, apps and services), §4 (order to cash), §5 (stock in), §6 (money), §7 (sign-in), §8 (dated founder decisions), §9 (non-negotiables); `docs/23-app-screens-and-api-gaps.md` (screen inventory, permission cross-checks, offline and white-label surfaces per app); `docs/24-confluence-alignment.md` §3 and §5; `docs/18-build-log.md` (status).
