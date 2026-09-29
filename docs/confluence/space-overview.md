# Distribution OS

## Document Information

| Property     | Value                                |
| ------------ | ------------------------------------ |
| Document     | Space Overview (DistributionOS Home) |
| Product      | Distribution OS                      |
| Version      | 4.0                                  |
| Status       | Active                               |
| Owner        | Prajwal Chavan                       |
| Last Updated | 29 September 2026                    |

---

## What Distribution OS is

**Distribution OS** runs a distributor's whole working day — order to cash, and supplier bill to stock. Every rupee and every piece of stock is recorded in a ledger that is only ever added to, so the books can always be traced back to the document that moved them.

The six business roles — owner, manager (with the accountant), sales, warehouse, delivery and the shopkeeper — use **one app**, listed once in each store as "Distribution OS" and served as one website. A person signs in and the app **becomes** the right app for their role: the owner's desk, the rep's beat, the driver's trip. Distribution OS staff use a **separate console**, which is not a distributor's app and never appears beside one.

The product is **white-labelled**: the Distribution OS name appears only on the welcome and sign-in screens, and every screen and printed document inside shows the distributor's own name and logo. It is sold to the distributor by subscription; there is no fintech, no payments aggregation and no commission on trade.

## Who it is for

The customer is the **distributor** (manufacturer → distributor → retailer). One distributorship is one account, with its own staff, shops, prices, stock and books, kept apart from every other distributor's. The product is built for **FMCG first**; pharma, dairy, electricals and agri are later markets.

## The roles and what each does in the app

| Role                  | Works on                          | What they do there                                                                                                          |
| --------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Owner                 | Website, Android                  | The day's numbers with graphs, approvals, live map, prices, schemes, credit, settings, the distributor's own branding, imports |
| Manager               | Website, Android                  | Order queue, review of goods received, billing desk, day-end, registers, Tally export                                       |
| Accountant            | Website, Android                  | The money desk — receipts, deposits, cheque bounces, write-offs — and every register and export                             |
| Salesperson           | Android, website; works offline   | Beat, shop check-in, order entry, bargain request, visits, own targets. Never sees cost, never collects money               |
| Warehouse             | Android, website                  | Gate count, scanning supplier bills, pick, pack (the invoice is issued here), load sheets, challans                         |
| Delivery              | Android, website; works offline   | Trip, stops, proof of delivery, returns, collecting cash, UPI or cheque, van sales, settlement                              |
| Shopkeeper (retailer) | Android, website                  | Order and reorder, see bills and dues, pay online, track a delivery; one card for each distributor the shop buys from       |
| Distribution OS staff | The console (separate, web only)  | Onboard distributors, plans and subscription state, time-boxed support access that the owner approves                       |

## Where to use it

- **Website:** `www.distributionos.in`. **Android:** the Distribution OS app. The iOS app is built from the same code and is not released yet.
- **Sign-in is a username and a password.** A person who may work in more than one role chooses one at **Continue as** after the password. An owner may act as manager, accountant, warehouse, delivery or salesperson; a manager as the field roles; everyone else as their own role plus any extra role the owner or manager has given them.
- A shopkeeper who buys from more than one distributor has **one login** and switches between distributors inside the app.

## The rules every screen follows

- **Each role reaches only its own part of the system.** The server refuses a role at a door that is not its own before any business logic runs, and a permission list decides every action inside.
- **Purchase cost is never shown** to a salesperson, a driver or a shopkeeper.
- **Only the delivery crew collects money, or the shop pays online.** The salesperson never records a receipt. The back office may record a payment made at the office. The salesperson may _see_ a shop's dues and its credit check.
- **The GST invoice is issued at pack**, in the warehouse, from what was actually packed. An issued invoice is never edited; corrections are credit or debit notes.
- **The accountant is the money desk plus reads**: no prices, schemes, credit limits, approvals or settings. **The manager approves load-out from the manager's screens**, not by typing a PIN on the warehouse phone.
- **AI assists, a person confirms.** An order sent as WhatsApp text or voice is read into a draft order that a person always confirms; demand forecasts and reorder suggestions are suggestions; the route order is a proposal the driver may override.
- **Sales and delivery keep working without signal** and send their work when it returns. The other roles work online. The app is in English.
- **Data comes in through one importer** — upload, preview, map columns, save the mapping, dry run, commit — for TradeEzee, Marg, Busy, Tally, FieldAssist or plain Excel. A sale already invoiced in a brand's own system is imported and linked, **never invoiced a second time**.

---

## Documentation map

| #   | Page                                                                                                                                           | Read it for                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1   | [Distribution OS — Product Home](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1277953)                                   | Product and technology reference: modules, roles and services, and the stack.                                                |
| 2   | [Apps & Workflows](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/10453020)                                                | Each role's scope, device, screens and offline stance, and the workflows that cross from one role to the next.               |
| 3   | [Personas](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1966081/Personas)                                                | Every user, the role they sign in as, what they may and may not do, and their working surface.                               |
| 4   | [TO-BE Business Process](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1441794/TO-BE+Business+Process)                    | The flows as the product runs them: order to cash, supplier bill to stock, and the states a document moves through.          |
| 5   | [AS-IS Business Process](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1736714/AS-IS+Business+Process)                    | How a distributor works without the product — the baseline every improvement is measured against.                            |
| 6   | [Problem Statement](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1081345/Problem+Statement)                              | The distributor's problems and the feature that answers each one.                                                            |
| 7   | [Pain Point Analysis](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/2097154/Pain+Point+Analysis)                          | Pain seen in the field, its business impact and root cause, and how the product answers it.                                  |
| 8   | [Vision](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1048577/Vision)                                                    | Where the product is going.                                                                                                  |
| 9   | [Mission](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1605635/Mission)                                                  | What the product does for a distributor every day, in plain language.                                                        |
| 10  | [Goals](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1212417/Goals)                                                      | The measurable objectives of version 1 and what is outside it.                                                               |
| 11  | [Success Metrics (KPIs)](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1802241/Success+Metrics+KPIs)                      | Each KPI and where in the product its number comes from.                                                                     |
| 12  | [Product Principles](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/1900545/Product+Principles)                            | The rules every design and engineering choice is checked against, including what is configurable and what is fixed.          |
| 13  | [Target Market & Customer Segments](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/786434/Target+Market+Customer+Segments) | Who the product is sold to, segment by segment.                                                                              |
| 14  | [Architecture & Technology](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/10518600)                                       | The services, the stack, the hosting, and how the modules are kept apart.                                                    |
| 15  | [Data, Security & Multi-tenancy](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/10321935)                                  | How one distributor's data is kept from another's, the permission list, what each role can never see, and retention.         |
| 16  | [Design System & Brand](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/10453060)                                           | Layout, the two densities, palette, type, numbers and haptics — the contract every screen follows.                           |
| 17  | [Integrations & Data Migration](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/10453040)                                   | The importer, the Tally export and how the product lives beside a brand's own system.                                        |
| 18  | [Phase 2 & Future Enhancements](https://prajwalchavan18.atlassian.net/wiki/spaces/Distributi/pages/10420246)                                   | What comes after version 1.                                                                                                  |
