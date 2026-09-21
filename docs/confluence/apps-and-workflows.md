# Apps & Workflows

## Document Information

| Property     | Value              |
| ------------ | ------------------ |
| Document     | Apps & Workflows   |
| Product      | Distribution OS    |
| Version      | 3.0                |
| Status       | Active             |
| Owner        | Product Management |
| Last Updated | 21 September 2026  |

---

# Purpose

This page is the map of the product: what each person does, what they get when they sign in, which end-to-end flows they take part in, and — just as important — what they must never be able to do.

**The shape changed on 2026-09-21.** Six business roles are delivered as **one app**: one website at `app.distributionos.in`, one Android app and one iOS app, listed once in each store as "Distribution OS". The person signs in and the app **becomes** the right app — the owner's desk, the rep's beat, the driver's trip — from the role their sign-in elects. Distribution OS staff use a **separate console**, which is not a distributor's app and never appears beside one.

What did not change is the part that keeps distributors safe from each other: **each role still talks to its own backend service**, so a role can only reach the endpoints its service mounts, and a per-endpoint permission matrix then decides what that role may call inside it. The one app changes what a *device* asks for; it changes nothing about what the *server* allows. `docs/22-source-of-truth.md` in the repository is the single source of truth; this page mirrors it.

---

# The six roles in one app

| #   | Role                    | Who signs in                              | Working surface        | Service : port             |                          Screens | Offline                  |
| --- | ----------------------- | ----------------------------------------- | ---------------------- | -------------------------- | -------------------------------: | ------------------------ |
| 1   | Owner                   | `owner`                                   | Desk, phone secondary  | `owner-service` : 3001     |                               26 | Online-first             |
| 2   | Manager (and accountant) | `manager`, `accountant`                   | Desk, three phone jobs | `manager-service` : 3002   |                               21 | Online-first             |
| 3   | Sales                   | `salesperson`                             | Phone                  | `sales-service` : 3003     |                               14 | **Offline before pilot** |
| 4   | Warehouse               | `warehouse`                               | Phone in the aisle     | `warehouse-service` : 3004 |                               12 | Online-first             |
| 5   | Delivery                | `delivery`                                | Phone, one-handed, GPS | `delivery-service` : 3005  |                               12 | **Offline before pilot** |
| 6   | Retailer                | `retailer` (one login, many distributors) | Phone                  | `retailer-service` : 3006  |                               13 | Online only              |
| —   | Sign-in for all six     | every role                                | —                      | `auth-service` : 3000      | Welcome, landing + 4 frame screens | —                        |
| —   | Platform console (separate app) | `platform_admin` (our own staff)  | Web                    | `admin-service` : 3007     |              Not yet inventoried | Online only              |

**One install, not six.** Decided 2026-09-21: the stores charge per developer account, not per app, so the saving is not in fees — it is seven builds, seven review queues, seven update cycles and a distributor's new hire being told *which* of six apps to install. One install that becomes the right app after sign-in is the better product for a pilot.

**The seven per-role web apps are retired at the merge, not kept beside it** — confirmed by the founder on 2026-09-21. Two front doors would be two things to prove, for ever; and nothing is lost, because every screen file moves into the one app unchanged. The console stays separate: platform staff are not the distributor's users.

Availability is uniform — web, Android and iOS from one codebase. The **working surface** is not: the phone for sales, warehouse, delivery and retailer, the desk for owner and manager. The shell follows the viewport, so the same screen is a desk rail at 1280 px and phone tabs at 390 px.

Screen counts are the binding inventory in `docs/23-app-screens-and-api-gaps.md`: 98 role screens plus the four frame screens every role shares (sign-in, forced password change, app chrome, profile and devices), now joined by the Welcome and landing screens below. The console is built but not yet inventoried there.

---

# Welcome, sign-in and role election

Three decisions of **2026-09-21**, designed in `docs/29-sign-in-roles-and-one-store-app.md`.

**1. Welcome, then who-you-are.** The app opens on a **Welcome** screen — the Distribution OS mark, one line, this app's name and icon, and a single **Sign in** button. It is shown once per device until a session exists, never on every launch: a driver at 6 am opens straight into the trip. After sign-in comes a **landing** moment — the distributor's logo and name (the shop's, for a retailer), the person's name, and which app this is — then the home screen. It is not a screen to tap through; it is a statement of where you are. White-label inside the app is unchanged: Distribution OS shows itself on Welcome and sign-in and nowhere else.

**2. Role election, downward only.** A membership is one person in one distributorship with one role, and real distributorships do not work that way — the owner drives some mornings, the warehouse man delivers on Tuesdays. So the device asks for the role it needs and the auth service grants it **only downward**:

| The person's role                                  | May sign in as                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| Owner                                              | Manager, accountant, warehouse, delivery, salesperson                |
| Manager                                            | Warehouse, delivery, salesperson                                     |
| Accountant, warehouse, delivery, salesperson       | Their own role, plus any **extra roles** the owner or manager grants |
| Retailer, platform admin                           | Never anything else                                                  |

The token carries the **elected** role, so the services, the permission matrix and row-level security are untouched; the person stays the actor on every audit row, every receipt and every delivery — the token says only *as what*. A refused election is a plain sentence, never a silent downgrade: *"Your login at Tarsun is a salesperson; ask the owner to add delivery to it."* Extra roles are set on the staff screen; the manager may not grant owner or manager. And the rule that matters most: **an owner token is never let into a field app** — a van phone is shared and droppable, and it must never hold a key to owner-service.

**3. Both land before go-live.** The founder moved role election and the one app ahead of launch on 2026-09-21 ("make sure of role election and one store app for both APPS and website before go live"), so the business simulation runs on the merged app and what is proven is what ships. Cost, stated plainly: about two days.

---

# Rules that bind every role

1. **Sign-in is username + password** against `auth-service` :3000, with our own EdDSA tokens and a per-device rotating refresh token (decided 2026-09-04). OTP over SMS or WhatsApp is a **later layer on top**, not a replacement.
2. **A service serves only its own roles.** Any other role is refused with 403 before a single line of business logic runs. Role election does not bend this — it decides which token you get, not which door it opens.
3. **Every endpoint has a row in the permission matrix**, tested for every endpoint against every role; the guard fails closed on an undeclared route. **Offline uploads are checked against the same matrix** (decided 2026-09-13): what a role may not do online it cannot do through `/sync/upload` either — the upload records a rejection, never a silent write. Permissions are one fixed table, not customisable per distributor.
4. **White-label.** Distribution OS branding appears only on the Welcome and sign-in screens. Inside the app and on every printed document, the distributor sees their own name and logo.
5. **State columns change only through the state machines** — order, trip and stop, invoice. No screen sets a state by hand.
6. **English only for now**; the layout is **A Ledger** and the typeface **IBM Plex Sans**, for every role and the console.
7. **One tenant = one distributorship** in v1. Multi-branch is v2, each branch its own tenant with an owner group view.
8. **A device holds one person's work, and only theirs** (decided 2026-09-13, closed 2026-09-20). Sign-out leaves nothing of the previous person or distributor behind. Changes not yet sent stay on that phone for **that person only** and go first at their next sign-in there; nobody else can see or send them, and nothing is thrown away.
9. **The app never claims work is safe when it is not** (decided 2026-09-19). A browser or phone that cannot keep an offline copy says so on every screen, no button reads "Saved on this phone" over work that dies with the tab, and an order placed without signal keeps saying so until the office actually confirms it.

---

# 1. Owner

**Who:** the distributor-owner. **Surface:** desk with graphs, phone for four zero-tap answers. **Service:** `owner-service` :3001, role `owner`. **26 screens.**

**Screens (grouped).** Today · Growth and performance (the graphs screen) · Approvals queue · Live map · Profit view (an owner-only route, never bundled into a shared screen) · Orders register · Retailers · Beats and staff · Prices and schemes · Catalog, costs and suppliers · Money: outstanding and ageing · Money: receipts, banking, cheques · Books: trial balance and day book · Billing register and GST · Credit notes · Stock · Inbound: supplier invoices, GRNs, purchase orders · Documents inbox · Delivery: trips, settlements, expenses, collections · Claims · Incentives · Imports wizard · Exports and Tally · Notifications and templates · Settings · Audit and security.

**In the flows:** approves what is outside the rules in Workflow A (price variance, credit, minimum order value, bargain, red settlement, GRN exception); may cancel an order while it is being picked; watches the road in Workflow C; owns branding, numbering series, credit terms, prices, schemes, the minimum shelf life to ship, the office phone number a shop sees, the expense-photo threshold, staff extra roles and feature flags; runs data migration through the generic importer.

**Graphs are a requirement, not a nice-to-have:** sales trend, month-on-month and year-on-year growth, brand / beat / rep comparison, collections and outstanding trends, fill rate, delivery performance, margin by brand.

**Approving is narrow, on purpose (2026-09-13).** Approving an "over credit limit" request lets **that one order** through; the shop's credit limit stays as it is and is changed on the shop's own page, audited. "Outstanding" on the owner's home stays the total of open bills, with money already received shown beside it, so the net always matches Sundry Debtors in the books.

**Must never:** edit an issued invoice (corrections are credit notes); set a state column directly; see another tenant's rows. Margin and purchase cost live on owner-service alone — a database policy with tests, not a screen rule.

---

# 2. Manager (shared with the accountant)

**Who:** the manager, and the accountant beside them with a narrower hand. **Surface:** desk, with three phone jobs (bill capture, gate count, pick and pack). **Service:** `manager-service` :3002, roles `manager` and `accountant`. **21 screens.**

**Screens (grouped).** Today · Order queue (submitted to confirmed) · Inbound documents: capture and review · Supplier invoices, GRN open and post, discrepancies, purchase orders · Fulfilment desk and the **trip planning board** · Billing desk · Load-out and challans · Credit notes · Receipts and allocations · Day-end: banking, cheques, trip settlement · Brand-DMS bills · Registers (the accountant's home) · Tally export and mapping · Retailers and credit · Prices and schemes · Stock · Claims · Notifications · Phone: gate count · Phone: pick and pack · Team performance.

**In the flows:** the desk of Workflow A (confirm, bill, plan the trip, approve the load-out), the review-and-commit half of Workflow B, and the day-end of Workflow C.

**Accountant scope: money desk plus reads.** The accountant may record office receipts, deposits, cheque bounces, write-offs and credit notes, and may read and export everything — including supplier bills, goods receipts, inbound documents and stock, which they view without changing (2026-09-13). The accountant has **no** access to prices, schemes, credit limits, approvals or settings, **cannot create, re-line, submit or cancel an order**, and is not a stock adder.

**Must never:** re-invoice a brand-DMS sale — a bill already raised in the brand's own DMS (Too Yumm on FieldAssist) is imported and linked, never issued a second time; edit an issued invoice; commit a scanned supplier document without a human review; bank a trip's cash or cheques before that trip has settled.

---

# 3. Sales

**Who:** the salesperson, standing in a shop doorway. **Surface:** phone. **Service:** `sales-service` :3003, role `salesperson`. **14 screens, 4 tabs** (Beat, Orders, Shops, Me). Target: a repeat order in three taps, a modified order in fifteen.

**Screens (grouped).** Today's beat · Shop card · Order entry (order again, suggested, grid; case and piece stepper; live availability hint) · Bargain request · Submit and status ("needs attention" tray) · My orders · New shop · Visits history · Performance · Lapsed shops · Catalog and stock browse · Pending bills of a shop (read-only) · Inbox · Me.

**In the flows:** the front of Workflow A — check in, price on the device, credit-check on the device, submit or raise an approval.

**Offline is mandatory before the pilot.** The device holds the rep's own beats and shops, the catalog without cost, sellable stock, price lists, schemes and overrides, own orders for 90 days, visits and bargains; writes queue and upload later. **An offline upload never answers a 4xx** — rejections come back as recorded errors and are shown, never lost.

**"Order again" repeats the shop's last placed order** (2026-09-13), whoever placed it — rep, shop, phone, WhatsApp or van sale — never a draft; the basket is built on the device and nothing is written until Place order. The rep reads what the shop pays, GST and compensation cess included, before placing.

**Must never:** see purchase cost, landed cost or margin; **record a receipt of any kind** — the sales service has no receipt endpoint, the matrix never grants one, the database refuses the insert and the offline upload door refuses it too; link a shop's phone identity, because a rep must not learn whether that phone exists in another distributor's network; treat a failed geo-tag at check-in as a block — it is evidence, never a gate.

The rep **may see** a shop's outstanding, its ageing and the credit-check result. The rule is "never collects", not "never sees dues".

---

# 4. Warehouse

**Who:** the godown staff. **Surface:** phone in the aisle, desk for the queue. Large targets, no Save step, a full-screen keypad for counting. **Service:** `warehouse-service` :3004, role `warehouse`. **12 screens, 4 tabs** (Inbound, Pick, Pack, Load).

**Screens (grouped).** Home queues · Capture supplier bill · Gate count · Fulfilment queue to wave · Picking sheet (consolidated by SKU, FEFO lots, actual lot, short reason, put-back group) · Pack per order · **Trip planning board** · Load sheet per trip, with crew blind count and challan · Stock · Van check-in count · Reservations · Me and inbox.

**In the flows:** the receiving end of Workflow B (blind gate count, capture the bill) and the middle of Workflow A (pick, pack, plan, load).

**The invoice is issued here, at pack** — not by a data-entry desk before picking — and the packed goods leave the godown at that moment, once. A short pack is recorded as a pack row; the order is never edited to match what went in the carton. An order the godown cannot fill **confirms short**, and the shortfall is recorded on the order for the desk and the owner to read; it is never a cap on what may be ordered.

**Shelf life warns, it never blocks (2026-09-13).** One minimum shelf life per distributor, 30 days unless the owner changes it: reservation and the pick sheet pass over a batch with fewer days left whenever another batch can cover the line, and a picker who still takes one gets a red warning the desk can see.

**Must never:** see purchase cost or margin; open or post a GRN (the desk does that after review); add stock or post opening stock — only the owner and the manager do that, and new stock arrives only on a goods receipt; **confirm its own load-out** (Workflow D); **depart a trip** — the warehouse role builds and loads, the owner, manager or crew send it out; create, re-line, submit or cancel an order; edit an order to fix a short pack.

---

# 5. Delivery

**Who:** the delivery crew. **Surface:** phone, one-handed, with the other hand full; GPS running. No tab bar — a single stack that opens on the next stop. **Service:** `delivery-service` :3005, role `delivery`. **12 screens.**

**Screens (grouped).** Today's trip · Start trip (consent, odometer, opening cash, depart) · Stop · At the door: deliver, partial or failed, with proof of delivery · Collect (cash, UPI with UTR, cheque) · Van sale · Expenses · Day summary and check-in · Share invoice, POD or receipt · Needs attention (sync rejections and refused payments) · Trip history · Me and inbox.

**In the flows:** the last mile of Workflow A and the collecting end of Workflow C.

**Offline is mandatory before the pilot.** The device holds today's trip and stops, the bills and shops of those stops, the vehicle's stock snapshot, pricing inputs for van sales and the tenant's settlement and proof-of-delivery policy. A doorstep delivery made with no signal carries its proof photo inside the queued operation. GPS points bypass the offline queue and post to their own endpoint.

**The stop tells the crew what it needs to know (2026-09-13).** Overdue amount, the oldest due date, the days late; a shop on credit mode "stop" also gets a "Credit stopped" chip and "take the money before the goods go in". Nothing blocks the delivery — the goods are already billed and loaded, and the credit check stays at order submit. A trip expense of ₹200 or more needs a photo of its bill (the owner may change the figure). A van sale's headline is the bill total **with** GST and cess, which is what the shop actually pays.

**Must never:** see purchase cost or margin; settle its own trip — the crew hands over, the desk settles, and a variance beyond the owner's tolerance blocks the close; bill a van sale on a separate number series; pre-fill the amount collected; **check the van in while the phone still holds unsent payments**; **offer money for deletion** — a payment the office refuses is kept and handed to the cashier, never discarded; keep GPS beyond the tenant's retention setting or without a granted consent; create, re-line, submit or cancel an order (van sales are the crew's only selling route).

---

# 6. Retailer

**Who:** the shopkeeper. **Surface:** phone, online only. One login that spans every distributor the shop buys from. **Service:** `retailer-service` :3006, role `retailer`. **13 screens, no tab bar.**

**Screens (grouped).** Sign-in and deep link · Home across distributors · Outstanding (the pending-bills file) · Bill detail · Pay online · Statement of account · Reorder and order editor · Order status and delivery tracking · Deals · Request a discount · Shop profile self-edit · Notifications · Receipts.

**In the flows:** an entry point into Workflow A (the shop places its own order) and into Workflow C (the shop pays online against its own bills).

**A shop that buys from several distributors lands where it was last (2026-09-13).** One home shows each distributor's dues, last bill and any van on the way, plus the total owed; there is no "choose your distributor" screen. A held order is answered **in the app only** — "We have your order, {distributor} will confirm shortly" — never a paid WhatsApp or SMS, and the order screen shows the overdue amount with a Pay button, never a credit limit. One office number, set by the owner, drives Call and WhatsApp; "Report a problem / ask for a return" lands in the office's inbound queue.

**Must never:** see another shop's rows, or any distributor's data other than the one whose card is open; see purchase cost or margin; see the internal approval trail on its own order; edit its own credit limit, credit days or price tier; place an order that skips the server's re-price.

---

# 7. Platform console (Distribution OS staff)

**Who:** our own staff. **Surface:** web. **Service:** `admin-service` :3007, role `platform_admin` — **not** a membership role, with its own sign-in. It is a separate app and stays separate when the six merge.

**Scope.** Onboard a distributor organisation · plans and subscription state · time-boxed, owner-approved, audited **support-access grants** · lock and unlock a login.

**Three levels, enforced on the server (2026-09-12).** **Super** does everything — onboard, suspend and reactivate, plans, lock and unlock logins, support access. **Support** reads everything and may only ask for and hand back support access. **Billing** reads everything and may only change a distributor's plan. Only a super administrator unlocks a login, with a written reason, audited; an unlock restores the login and nothing else.

**How support access actually works.** The console **asks**; only the distributor's own owner opens the window. An approved window becomes a five-minute signed pass that acts as that owner, read-only while the scope is read-only, and writes one audit row per call. The console reads **counts** of a distributor's size and never a rupee of its trade. Suspending a distributorship refuses every sign-in.

**In the flows:** it sits outside every tenant flow. It creates the tenant that Workflows A to D then run inside.

**Must never:** read a distributor's business data without an approved, expiring, audited grant; appear anywhere in a distributor's documents or screens; take a payment — revenue is the distributor's subscription, and there is no fintech in the product.

---

# Workflow A — Order to cash

| Step | App surface                 | What happens                                                                                                             | Order state                     |
| ---- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| 1    | Sales                       | Beat for today; check in at the shop (geo-tagged as evidence, never a block)                                             | —                               |
| 2    | Sales or Retailer           | Order built: order again, suggested, or grid; cases and pieces; live availability hint                                   | draft                           |
| 3    | Sales                       | Price engine and credit check run on the device                                                                          | draft                           |
| 4    | Sales, or Owner / Manager   | Inside the rules: submitted. A "warn" shop over its limit submits too, with a **credit notice** the desk sees. A "strict" or "stop" shop, or a bargain, needs approval first | submitted                       |
| 5    | Server                      | Re-prices and reserves stock. A line changes only where a rate approved since the draft lowers it; a mid-week price-list edit does not re-price a held order. An order the godown cannot fill confirms **short**, with the shortfall recorded | confirmed                       |
| 6    | Warehouse or Manager        | Fulfilment queue grouped by beat or trip; picklist consolidated by SKU, FEFO lots, short-shelf-life batches last         | picking                         |
| 7    | Warehouse                   | Pack per order; short packs are pack rows, never order edits                                                             | packed                          |
| 8    | Warehouse                   | **GST invoice issued at pack** on the tenant's own series, own name and logo, UPI QR; the packed goods leave the godown here, once | packed                          |
| 9    | Warehouse or Manager        | **Trip planned from the planning board**: the crew for the date and the packed bills not yet on a trip. A bill rides on one open trip at most | packed                          |
| 10   | Warehouse, then Manager     | **Load sheet built for that trip**, crew blind count confirmed, manager approves (Workflow D), challan printed           | packed                          |
| 11   | Owner, Manager or Delivery  | Trip departs. Never while its load sheet is a draft, never with a bill no load sheet counted out; the warehouse role cannot depart. A trip may leave before its planned date, and "departed early" is recorded | dispatched                      |
| 12   | Delivery                    | Stop by stop: delivered, partial (per-line quantity and reason, becomes a credit note), or failed. The stop shows overdue dues; a credit-stopped shop is told to pay first — the goods still go | delivered / partially_delivered |
| 13   | Delivery                    | Collect cash, UPI with UTR, or cheque; receipt allocated oldest bill first                                               | —                               |
| 14   | Delivery, then Manager      | Check-in: unsold stock counted back — not while the phone still holds unsent payments — and the trip settles on every payment it took, however it reached the office; variance beyond tolerance goes to the owner | closed                          |

**Cancelling, as decided.** A shop may cancel while its order is a draft or submitted; a rep up to confirmed; the desk — owner or manager — **up to picking**, with the picker told which lines to put back. A packed order is cancelled only through its bill, and cancelling that bill before dispatch cancels the order in the same step: the bill keeps its number, the stock goes back on the rack, nothing is left in the billing queue and the shop that still wants the goods gets a fresh order. After dispatch, only a credit note corrects anything.

**Undelivered goods.** A failed stop's stock stays on the vehicle and its bill waits there until the van is checked in; then the bill returns to the planning board and goes out on a fresh load sheet for its next trip. An issued invoice is never edited.

---

# Workflow B — Stock in (zero typing except the gate count)

1. **Warehouse** does a blind gate count and photographs or shares the supplier bill.
2. If the bill carries a QR, the e-invoice signature, IRN, GSTINs and totals are verified.
3. The worker reads every page by vision extraction and normalises pack sizes.
4. Validators check GST arithmetic, HSN, page completeness, lines against the QR, and the three-way match with the purchase order and lorry receipt.
5. SKU matching runs: aliases, then external codes, then fuzzy, then a human.
6. **Manager** reviews on the phone or desk — line cards with crops, short or damaged, batch and expiry.
7. One idempotent commit writes the supplier invoice, the lots, the stock-ledger receipt rows, the purchase cost and the payables journal.
8. Stock becomes visible to the sales role within one sync.

**Document intake never commits on its own.** A brand-DMS bill (Too Yumm on FieldAssist) enters the same pipeline and is committed as an import — **a receivable in; no stock movement**, because the brand's field force already moved the goods on its own documents — and is **never** issued as a second legal invoice.

**Who may add stock (2026-09-13).** Goods from a supplier arrive only on a goods receipt. By hand, only the owner or a manager adds stock or posts opening stock; the warehouse login only takes stock off (damaged, expired, a correction, a count found short), and more on the rack than the books show is a cycle count the desk posts. A damaged or expired return never goes back into saleable stock, at the desk or at the door.

---

# Workflow C — Money

| Who may record money       | Where                                  | Note                                                 |
| -------------------------- | -------------------------------------- | ---------------------------------------------------- |
| Delivery crew              | At the door                            | Cash, UPI with UTR, cheque                           |
| The shop itself            | Retailer screens, against its own bills | UPI QR or link, payee is the distributor             |
| Owner, manager, accountant | The desk                               | Payments received at the office                      |
| Salesperson                | **Nowhere**                            | No endpoint exists for the role, online or offline   |

Every receipt is append-only, carries a client receipt number, and allocates bill-to-bill oldest first unless it is tagged. A receipt number never repeats per distributor, series and financial year — the database enforces it. Every receipt posts to a double-entry journal that must balance at commit, enforced in the database, not the application. Cheques move to deposited, and a bounce reverses with bank charges and reopens the bill. Cash discount is shown on the bill and realised as a credit note only when paid on time. Write-offs are back-office only. Ageing runs 0–7 · 8–15 · 16–30 · 31–60 · 61–90 · 90+, rebuilt nightly for every distributor, with money on account shown beside the outstanding so the net matches the books.

**Money moves exactly once (2026-09-14).** Banking a receipt, undoing it and settling its trip all **lock** it, so only one of them can win. Day-end counts every payment a trip took, however it reached the office — online, or from a phone that had no signal — net of anything undone. An undo takes the money from wherever it is now: the van before day-end, the office till after it, the bank once banked.

**Late payments go to the cashier, not into the void (2026-09-14).** Cash or a cheque handed over after its trip has already settled is refused on the phone, which tells the driver to hand the money to the cashier; a UPI payment is accepted, because that money is already in the account. Either way the entry is **kept** — a payment the office refuses is never offered for deletion.

**Trip money banks only after the trip settles (2026-09-13).** The day-end bank register leaves out receipts whose trip has not settled, and the server refuses to deposit them.

---

# Workflow D — Load-out approval, and who sends the van out

**The manager's approval for load-out is given on the manager's own screens**, not typed on the warehouse phone.

1. **Warehouse** plans the trip from the planning board, builds the load sheet for it — last stop first — and records the crew's blind count.
2. The warehouse screen then shows "waiting for manager" and is read-only.
3. **Manager** opens the sheet on phone or desk, checks the e-way bill gate and confirms. Stock moves from godown to vehicle and the challan prints.
4. **Owner, manager or the delivery crew** depart the trip, and the orders become dispatched. The **warehouse role cannot depart** (2026-09-12), no trip departs while its load sheet is a draft, and **no van leaves with a bill nobody counted out** (2026-09-14) — so every van carries a challan and gets the e-way bill check.

This follows from rule 2: warehouse-service serves only the warehouse role, so a manager's token is refused there before any business logic. Keeping the approval on the manager's side needs no new backend surface — and role election does not change it, because the token the device holds carries the elected role and the matrix reads that.

---

# AI in the flows

All AI features are in v1, before the pilot.

| Capability                                 | Where it lands                       | Rule                                                                                                         |
| ------------------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| WhatsApp free text becomes a draft order   | Enters Workflow A at step 2          | Parsed against that shop's own purchase history; **always confirmed by a person** before it becomes an order |
| Voice order capture                        | Sales order entry                    | Speech into the same parser, same human confirmation                                                         |
| Demand forecasting and reorder suggestions | Owner and manager, purchase planning | A suggestion, never an automatic purchase order                                                              |
| Route sequencing                           | Manager load-out, delivery trip      | Stops sequenced by distance and time window; the driver may override                                         |

The intake pipeline and the module that hosts these are built and run on deterministic engines; a live model key is added when the founder wants a real bill photo read, and nothing in the build waits on it.

---

# Where the build stands (21 September 2026)

**Both halves are built.** Backend: 23 modules, eight services, 139 tables, ~2 400 automated tests, and a smoke run that calls every published operation of every service. Frontend: all seven per-role apps were built and gated green on 2026-09-07 — each a single Expo codebase serving website, Android and iOS, each walked screen by screen at desk and phone widths against the live services. The statement on the previous version of this page that "no application screen exists yet" is retired.

**Quality work is the current programme.** QA batch 2 has 153 of its 158 findings merged; what remains is a handful of open items and their platform proofs. Every founder decision that batch produced is on this page.

**The seven days to go live** (`QA/10-DAY-PLAN.md`, cut from thirty to ten and then to five, then extended by two when role election and the one app moved ahead of launch):

| Day        | What runs                                                                                                      |
| ---------- | -------------------------------------------------------------------------------------------------------------- |
| 1 (Sun 21) | The cross-role chain on the seven apps as they are · Welcome and landing · role election starts · deployment plumbing |
| 2 (Mon 22) | Role election lands after architect review · **the one app** starts: six role groups in one project             |
| 3 (Tue 23) | The one app finishes and is gated; the seven per-role web apps retired; the chain re-walked on the one app      |
| 4–5 (Wed–Thu) | **The seven-day business simulation, on the one app** — two full days, a blind auditor, an arithmetic verdict |
| 6 (Fri 26) | Fix what it found; check only where it pointed                                                                  |
| 7 (Sat 27) | Android basics · the security slice public URLs require · **go live** at `app.distributionos.in` · audit and handover |

**Live by Saturday 27 September if Thursday evening's books balance.** The verdict is arithmetic, not opinion: opening stock + receipts − sales − damage − returns = closing stock per SKU per batch, and revenue = payments + outstanding. Any drift is a P0. The honest shape is six days of scheduled work and one day of unknown — day 6 is the only day set aside for repairing what days 4–5 find, and the founder hears on Thursday night whether the date holds.

**Still open against this page:** iOS is validated completely at the end, with basics until then (Android is the pilot platform); the console's screens are not yet in the binding inventory; and the invoice series at cut-over from the old system is a founder answer owed before go-live.

---

# Summary

Six business roles in **one app** — one website, one Android app, one iOS app — plus a separate console for Distribution OS staff. Six role services plus `auth-service` and the console's own, a worker, and one database. A person's sign-in elects their role; that role decides which service they can reach; the permission matrix decides what they may call there; and row-level security decides which rows come back. The four workflows above are the only paths a piece of stock or a rupee can travel, and each one crosses a named handoff — order to confirmation, pack to invoice, load sheet to manager, manager to departure, door to receipt, receipt to ledger.

**Sources:** `docs/22-source-of-truth.md` §2 (people, apps and services), §4 (order to cash), §5 (stock in), §6 (money), §7 (sign-in), §8 (dated founder decisions), §9 (non-negotiables); `docs/29-sign-in-roles-and-one-store-app.md` (Welcome and landing, role election, one store app); `docs/23-app-screens-and-api-gaps.md` (screen inventory, permission cross-checks, offline and white-label surfaces); `docs/18-build-log.md` and `QA/STATE.md` (status); `QA/10-DAY-PLAN.md` (the days to go live).
