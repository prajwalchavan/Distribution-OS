# AS-IS Business Process

## Document Information

| Property     | Value                  |
| ------------ | ---------------------- |
| Document     | AS-IS Business Process |
| Product      | Distribution OS        |
| Version      | 2.0                    |
| Status       | Active                 |
| Owner        | Business Analysis      |
| Last Updated | September 2026         |

---

# Purpose

This document describes how an Indian FMCG distributor operates **today, without Distribution OS**. It captures existing practices and operational dependencies, and establishes the baseline against which the future state is designed. It is the field truth of the product: every feature in the TO-BE has to point back to a step on this page.

**New in version 2.0.** Version 1.0 described a generic distributor. This version keeps that structure and every observation that is still true, and tightens it with the **named ground truth** from the pilot customer — the actual software, the actual documents, the actual paper. Each step now carries the **pains it produces**, referenced to the ranked pain list in `docs/domain/operational-pain-points.md` (30 pains ranked by source count and recurrence, cited below as P1–P30), and states honestly whether that pain is answered in v1 or deliberately left alone. The product name is **Distribution OS** (decided 2026-09-05); version 1.0 wrote "DistributionOS".

---

# Ground Truth Behind This Document

This is not a composite of interviews. It comes from field observation at the pilot customer, **Tarsun Enterprises, Kalyan West (Thane)**, in August 2026, plus six of their real operating documents:

| Document observed                        | What it fixed for the design                                  |
| ---------------------------------------- | ------------------------------------------------------------- |
| Guru Kripa invoice (MOM makhana)         | Tally-style supplier invoice **without** an e-invoice QR      |
| Reliance Retail invoice (Campa)          | Supplier invoice **with** IRN and signed QR                   |
| Guiltfree Industries invoice (Too Yumm)  | Supplier invoice with IRN, QR and brand-DMS field names       |
| Sneha Logicare lorry receipt             | Transit document, package count, damage remark                |
| Tarsun's own retailer bills, two systems | **TradeEzee ERP** and **FieldAssist DMS** running in parallel |
| Thermal slip for Campa                   | Van / counter sale printed outside both systems               |

These fixed the case-size conventions the product must parse (`x 90`, `_120`, `CS1`), the discount structures on a real bill (secondary %, cash %, free quantity, GST benefit), and the requirement that Distribution OS **coexists** with a brand-mandated DMS rather than replacing it.

The workflow is FMCG-shaped because the pilot is FMCG. The same shape — buy in bulk, break into cases, sell on a beat, collect later — holds in pharma, electricals, dairy and agri distribution; Distribution OS positions across those markets with **FMCG first** (decided 2026-09-05). This page describes **one distributorship**: one tenant is one distributorship and multi-branch is a v2 topic (decided 2026-09-05).

---

# Scope and Current Operational Flow

Manufacturer onboarding · purchase ordering · goods receipt · inventory storage · order capture · scheme application · billing · warehouse dispatch · delivery · payment collection · end-of-day reconciliation · brand claims · returns and expiry · reporting. Version 1.0 stopped at reconciliation; **scheme application at billing, brand claim settlement, and returns / expiry are added in version 2.0** — they are the highest-frequency money-losing steps in the field and were missing from the baseline.

The flow end to end: manufacturer → purchase order by phone or portal → truck dispatch with lorry receipt → goods receipt at the gate → warehouse storage → retailer orders by phone, by a rep on WhatsApp, or into the brand's own DMS → manual data entry → scheme applied by the operator → invoice printed → warehouse picking against that printout → loading → delivery → payment collected at the door → end-of-day cash handover and manual ledger update → month-end claims, returns and reports.

---

# Who Does What Today

In a distributorship of this size these are **hats, not departments** — three to eight people wear all of them, and several sit on the same head.

| Function    | Who wears it                    | Responsibility                                              |
| ----------- | ------------------------------- | ----------------------------------------------------------- |
| Procurement | Owner                           | Decides what and how much to buy; negotiates with the brand |
| Warehouse   | 1–2 staff                       | Receive, count, store, pick, load                           |
| Sales       | 2–4 representatives             | Visit shops on a beat, take orders                          |
| Billing     | 1 operator                      | Key orders in, apply schemes, print invoices                |
| Delivery    | 1–2 crews                       | Deliver, collect cash, bring unsold stock back              |
| Accounts    | Owner or a part-time accountant | Post collections, track outstanding, file GST               |
| Management  | Owner                           | Watches everything, usually after the fact                  |

**What changes in the TO-BE.** These become seven roles across six role apps plus an internal platform console: owner; manager and accountant sharing one app; sales; warehouse; delivery; retailer; and "Distribution OS - Admin" for onboarding, plans and support access (six apps decided 2026-09-04, the seventh decided 2026-09-05). The **Billing Operator hat is deliberately not carried forward** — the invoice is issued by the warehouse at pack time from what was actually packed, so nobody re-types an order (decided 2026-09-04).

---

# Systems in Use Today

| System                                               | What it holds                                      | Who touches it                            | What it cannot do                                                                    |
| ---------------------------------------------------- | -------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------ |
| **TradeEzee ERP** (Windows desktop, keyboard-driven) | The distributor's own stock, parties, bills        | Billing operator, on the warehouse laptop | Not reachable from a phone; no field access; data leaves only through report exports |
| **FieldAssist DMS** (brand-mandated, Too Yumm)       | Orders and invoices for that brand only            | The same operator, in a second window     | The distributor's own books never see these sales unless re-keyed                    |
| **Thermal slip printer**                             | Van and counter sales for Campa                    | Delivery crew                             | No record beyond the paper slip                                                      |
| **WhatsApp**                                         | Orders, shop-location photos, "paid" confirmations | Everyone                                  | No structure, no audit trail, messages scroll away                                   |
| **Excel**                                            | Ad-hoc registers, claim workings, brand reports    | Owner                                     | Rebuilt by hand every month                                                          |
| **A physical file of pending bills**                 | Retailer outstanding                               | Owner                                     | The real receivables ledger of the business is paper                                 |

No integrated workflow exists between any two of these. **Three billing systems run in parallel because brands mandate their own DMS** — the one structural fact the design must accept rather than fight.

---

# Detailed Workflow

## Step 1 — Manufacturer Onboarding

**Owner and the manufacturer's sales representative.** The relationship is agreed in person; distribution agreement, territory, commercial terms, credit terms and the product catalogue with pricing and schemes are exchanged as PDFs, printouts and WhatsApp messages. The catalogue then exists in the brand's format, not the distributor's.

**Pains carried.** Scheme circulars arrive as unstructured documents interpreted by one person, and stacking rules are ambiguous (P19). If the brand mandates its DMS, a second billing system arrives with the relationship (P7).

## Step 2 — Purchase Ordering

**Owner, sometimes purchase staff.** Stock levels are reviewed by walking the godown and by memory. Quantities are estimated from experience. The order goes by phone, WhatsApp or the brand's portal; the manufacturer confirms dispatch.

**Pains carried.** Forecasting is experience only — no demand prediction, no reorder suggestion. Brands push **forced primary orders and month-end dumping** and the distributor has no days-of-stock view to argue with (P8). Slow movers are discovered near expiry, not at purchase (P9).

**Changed for v1.** Demand forecasting and reorder suggestions for purchase planning are **in v1, before the pilot** (decided 2026-09-05), overriding the earlier plan that deferred forecasting past the pilot.

## Step 3 — Goods Receipt

**Warehouse staff.** The truck arrives with the lorry receipt; boxes are unloaded and counted; the supplier invoice is checked line by line against what came off the truck. Damage is noted verbally or not at all. Goods move into the godown and the invoice is typed into TradeEzee later — often the next day, which is when stock updates.

**Pains carried.** Every line is re-typed, the largest single typing load in the business. **Case-versus-pieces confusion** on documents that print `x 90`, `_120` or `CS1` (P6). Book and physical stock drift because the update is late (P5). **Transit damage is not recorded on the lorry receipt** before it is signed, so the transporter claim is lost (P18). No barcode scanning. E-way bill numbers on high-value inbound are not tracked (P24).

## Step 4 — Inventory Storage

**Warehouse staff.** Stock is placed where there is space; the location lives in the head of whoever put it there. There is usually **no rack, bin or zone management**, and no batch or expiry record beyond what is printed on the carton.

**Pains carried.** Slow picking and total dependence on the person who stored it (P13). Multiple MRPs of the same SKU sit in one stack (P29). Near-expiry stock is invisible until the brand's return window has closed (P9).

**Not carried into v1.** Rack, bin and zone management and barcode scanning are **deliberately out of scope**. V1 records stock against a location (godown, vehicle, damaged) with batch, MRP and expiry per lot and picks FEFO, but there is no bin entity and no scanner. Named as a gap, not promised.

## Step 5 — Order Collection

The most critical process, and the one with the most channels.

**Sources (observed, not measured).** Phone calls roughly 60%, sales representatives on a beat roughly 40%. Orders for brand-DMS lines never enter the distributor's own system at all: the brand's salesman books them in the brand's SFA app and they land in the brand's DMS. A typical rep message reads:

> ABC Stores
> Campa Cola 24 x 10
> Water 20 Boxes

**Pains carried.** Multiple channels with no single queue; duplicate orders, missed messages, free text interpreted by the operator. The rep promises a scheme at the door the operator may not apply (P27). Beats are built on habit with a stale outlet master and no proof of visit (P14). When a salesman leaves, the beat knowledge leaves with him (P13). Retailers ask for quantities below a full case (P26).

**Changed for v1.** WhatsApp free-text and **voice order capture** are in v1: the message or the spoken order becomes a **draft** parsed against that shop's own purchase history, and a human always confirms before submission (decided 2026-09-05). This overrides the earlier decision to defer both past the pilot. Nothing is auto-committed.

## Step 6 — Data Entry

**Billing operator.** Read the WhatsApp messages, take the phone orders off a notepad, open TradeEzee, type the order, check stock on screen, switch to FieldAssist DMS for the brand's lines and type those there, generate the invoice.

**Pains carried.** Heavy typing, human error, duplicate effort across two systems (P7), and a bottleneck that gates dispatch — nothing moves in the warehouse until the operator is finished.

## Step 7 — Scheme and Price Application

**Billing operator.** The operator recalls or looks up the active brand schemes, decides which apply, and types the discount. Secondary discount %, cash discount %, free quantity and GST benefit are each entered by hand.

**Pains carried.** **Scheme misapplied or missed — the highest-frequency pain in the business, on every bill (P1).** Stacking of two schemes is the operator's judgement (P19). Free goods are booked as a percentage instead of units, so the claim later fails (P22). Cash discount is printed on the bill and given whether or not the retailer pays on time (P20). The rep's doorstep promise and the printed bill disagree (P27).

**New in version 2.0.** This step happens in the field but was absent from the version 1.0 baseline. It is the strongest single justification for a server-side pricing engine.

## Step 8 — Invoice Generation

The invoice is printed and becomes the operational document for everything downstream. It simultaneously serves as **bill, pick list, packing list, delivery note, payment record and delivery confirmation**.

**Pains carried.** Every downstream process is coupled to one sheet of paper, so nothing can be tracked in flight and any correction means a reprint. Credit notes are raised late or not at all and the GST Section 34 deadline is missed (P16). FSSAI number and unregistered-retailer handling vary by whoever set up the template (P25). Purchase cost is visible on screens a salesman can see (P21).

## Step 9 — Warehouse Picking

**Warehouse staff.** They receive a stack of printed invoices, find the products, pick the quantities, eyeball the result and stage the shipment.

**Pains carried.** No verification step, no second count, no record of which batch was picked (P5, P29). Wrong picks are discovered at the shop. No FEFO discipline, so near-expiry stock stays on the shelf (P9). Shorts are handled by scribbling on the invoice.

## Step 10 — Loading

**Warehouse staff and the delivery crew.** Goods are loaded into the vehicle and the driver receives the invoices and the goods. **There is usually no digital confirmation and no counter-signature** — a handover of several lakh rupees of stock leaves no record.

**Pains carried.** Nobody can say what went onto the vehicle, which is where the van and delivery blind spot begins (P10). Stops are ordered by the driver's habit and the load is not packed last-stop-first (P23).

## Step 11 — Delivery

**Delivery crew.** The driver visits shops in whatever order he prefers. The shop's location is often a photo shared on WhatsApp and he calls the retailer for directions. Delivery is confirmed verbally. He may collect cash or UPI, or leave the bill on credit; "paid" is written on the invoice.

**Pains carried.** No live visibility of the trip for the office or the shop (P10). Partial deliveries and shortages are argued at the door and hold up payment (P12). Returns come back in the same crate whether saleable or damaged (P28). Delivery windows and multi-trip sequencing are guesswork (P23).

**Founder rule for the TO-BE.** Only the delivery crew collects at the door, or the shop pays online — **the salesperson never collects** (decided 2026-09-04). Where a distributor lets the rep collect today, that practice is not carried forward.

**Changed for v1.** Route sequencing — ordering stops by distance and time window, with the driver free to override — is **in v1** (decided 2026-09-05), overriding the earlier "must not build" entry for routing.

## Step 12 — End-of-Day Return

**Delivery crew, then the owner or accountant.** The driver returns to the office and hands over invoices, cash and payment details. Unsold stock goes back into the godown, usually uncounted. Accounts updates the billing software and the outstanding balances by hand.

**Pains carried.** **Cash reconciliation and leakage at trip close** — expected cash is never computed, so a variance is noticed only if it is large (P11). **Retailer outstanding sprawls across a physical file of pending bills (P4).** Van sales printed on a thermal slip may never reach the books at all.

## Step 13 — Reporting

**Owner.** Sales, outstanding and stock are read from TradeEzee's report screens; anything else is rebuilt in Excel.

**Pains carried.** **The owner learns what happened yesterday, tomorrow (P30).** Brand-facing secondary sales and closing stock reports take three to five days a month to compile and nobody fully trusts them (P15). There is no view of order lifecycle, delivery status, warehouse productivity or employee performance.

**Changed for v1.** The owner app must show **graphs** — growth and how the distributorship is performing — not only tables (decided 2026-09-04).

## Step 14 — Brand Claims

**Owner, monthly.** He reconstructs from invoices and Excel what the brand owes for schemes, damages, expiry returns and price protection, and files the claim in the brand's format or inside the brand's DMS.

**Pains carried.** **Claims are never raised or raised late — the field estimate is 30–50% missed (P2).** Those that are raised get rejected for missing evidence: no batch photo, no goods-receipt remark, no calculation sheet (P3). A GST or MRP rate change on stock in hand creates a price-protection claim nobody computes (P17). New in version 2.0: this step is pure margin and was missing from the baseline.

## Step 15 — Returns, Damages and Expiry

**Delivery crew, warehouse staff, owner.** Goods come back from shops mixed together in a crate; someone decides later whether each item is saleable or damaged. Expiry returns are gathered when the brand's representative asks for them.

**Pains carried.** Saleable and damaged returns are mixed, so brand-claim eligibility per item is lost (P28). Stock is written off at expiry because the return window closed before anyone noticed (P9). The return often never reaches the retailer's ledger as a credit note (P16).

---

# Current Pain Points

| Area          | Problem today                                         | Answered in v1?                                                                                         |
| ------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Orders        | Multiple channels: phone, WhatsApp, rep, brand DMS    | Partly — one order queue, plus AI-drafted WhatsApp and voice capture, always human-confirmed            |
| Schemes       | Applied from memory at billing; free goods mis-booked | Yes — server-side pricing engine, rules stamped on every line                                           |
| Billing       | Keyed by hand, twice, into two systems                | Yes — invoice derived from what was packed; brand-DMS bills imported, never re-invoiced                 |
| Inventory     | Updated a day late from a typed invoice               | Yes — append-only stock ledger per movement                                                             |
| Warehouse     | Manual picking, no batch record, no verification      | Partly — FEFO picklists and pack confirmation; **no bins, no barcode**                                  |
| Delivery      | No tracking, no proof, no sequence                    | Partly — trips, stops, GPS and proof of delivery built; route sequencing planned in v1 (module 12 `ai`) |
| Payments      | Cash written on paper; outstanding in a physical file | Yes — receipts, allocation oldest bill first, double-entry journal                                      |
| Claims        | Reconstructed monthly in Excel; 30–50% missed         | Planned in v1 — claims module, queued behind the core modules                                           |
| Reports       | End-of-day at best, month-end in practice             | Planned in v1 — reporting module with owner graphs                                                      |
| Communication | Phone and WhatsApp dependency                         | Partly — outbound documents on WhatsApp, inbound capture                                                |

---

# Current Business KPIs

**Tracked today.** Daily sales · outstanding · stock on hand · collections.

**Not visible today.** Order lifecycle and where an order is right now · delivery status · warehouse productivity · employee performance · scheme cost actually given away · claim recovery rate · true margin after schemes and damages.

---

# Key Observations

**The invoice is the operating system.** One printed document carries order, picking, packing, delivery and payment. Every process is coupled to paper, which is why nothing can be tracked in flight and a correction means a reprint.

**The real receivables ledger is a physical file.** Not the ERP. Any migration has to reconcile that file against the software, per retailer, with a human checkpoint — it cannot be imported blindly.

**The distributor runs three billing systems because brands mandate their own.** A product that assumes it is the only invoice source in the building is wrong on day one. Brand-DMS sales are imported and linked to the brand's invoice number; a second legal invoice is never created.

**Operational knowledge lives in people, not systems.** Beat knowledge, stock locations, scheme interpretation and which retailer pays late are all held by individuals. That is the ceiling on growth and the cost of attrition.

**The field is not a desktop.** Everyone except the billing operator works on a phone, standing up, often on poor signal, while the current stack is a Windows desktop in the office. Distribution OS ships every role app on web, Android and iOS (decided 2026-09-04), in **English only for now** (decided 2026-09-04) — an honest constraint for staff who work in Marathi and Hindi, and the first candidate for a post-pilot enhancement.

---

# Improvement Opportunities

**Carried into v1.** Digitize order capture across every channel · remove re-typing on both the inbound and outbound side · workflow status tracking instead of paper · batch, MRP and expiry per lot with FEFO picking · live delivery visibility with proof of delivery · digital collection with the receivables ledger inside the system · scheme rules applied by the server, never typed · demand forecasting and reorder suggestions · WhatsApp and voice order drafts, always human-confirmed · route sequencing.

**Deliberately not built.** Rack, bin and zone management · barcode or carton scanning · per-tenant custom roles and configurable order states · payments aggregation or lending of any kind · multi-branch inside one tenant. Each is a recorded decision, not an oversight.

These opportunities are specified as the future state in **TO-BE Business Process**.

---

# Related Documents

- Problem Statement · Pain Point Analysis · Personas · Vision · Mission · Product Goals · Success Metrics · Product Principles
- **TO-BE Business Process** — the future state designed against this baseline
