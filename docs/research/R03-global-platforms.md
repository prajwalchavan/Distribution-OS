# R03 — Global B2B distribution / route-to-market / DSD platforms: features worth borrowing

Research date: 2026-09-04. Method: web search + full-page reads of vendor docs (Pepperi use-case PDF, SAP DSD application help PDF, Shopify B2B help centre, Salesforce Trailhead, Onfleet, Zoho RouteIQ help, inFlow support, Ordermentum, Choco, Faire, LogiNext). Where a claim rests only on a search snippet or a third-party review site (not a page I read in full), it is marked **[snippet]** or **[third-party]**. Ivy Mobility's own site returned "Access Denied" to every fetch, so Ivy claims rest on a third-party evaluation and marketplace listings.

Scope note: this report does not contradict any decision in CONTEXT.md. Where a global pattern suggests a change, it is flagged under "Recommended changes to earlier decisions" with reasons.

---

## 1. Platform snapshot

| Platform                                 | What it is                                                                                         | Who it serves                               | Standout thing to learn from                                                                                                      |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Pepperi** (now Advantive)              | Unified B2B commerce: rep order-taking app, B2B e-commerce, trade promotions, route accounting/DSD | CPG brands & wholesalers                    | Richest documented promotion taxonomy; small "use-case" features (order cut-offs, reserved orders, max-qty per SKU, MOV override) |
| **Ivy Mobility**                         | Route-to-market suite: SFA, DSD/van sales, DMS, image recognition                                  | Large CPG in emerging markets (incl. India) | Van load request/approval + AI load recommendations; strong offline [third-party]                                                 |
| **Salesforce Consumer Goods Cloud**      | Retail execution + order management on Salesforce; offline mobile app                              | Enterprise CPG                              | "Penny-perfect" offline pricing engine with pricing date, scales, rounding modes; visit/task recommendations                      |
| **Repsly**                               | Retail execution + mobile order entry                                                              | CPG field/merchandising teams               | Store-specific product availability & pricing pushed to field; barcode/visual catalog                                             |
| **Ordermentum** (AU)                     | Wholesale ordering + payments for F&B suppliers & venues                                           | Food/bev suppliers                          | Standing orders, cut-off reminders, credit hold, credit notes auto-applied to next order                                          |
| **Choco** (EU/US)                        | Restaurant→supplier ordering, now AI order-entry ("OrderAgent", "Autopilot")                       | Food distributors                           | Human-review queue → confidence-gated autopilot per customer                                                                      |
| **Faire**                                | Two-sided wholesale marketplace with net-60                                                        | Indie retailers & brands                    | "Restock" tab driven by POS stock; Faire Direct (commission-free for your own customers)                                          |
| **Shopify B2B**                          | Company/location/price-list model inside Shopify (all paid plans since Apr 2026 [snippet])         | Brands selling wholesale                    | Cleanest data model for company→location→price list→quantity rules→terms; checkout-to-draft                                       |
| **Handshake (Shopify)**                  | Wholesale marketplace; shut down late 2023 after Shopify invested in Faire [snippet]               | —                                           | Cautionary tale: ordering tools that depend on a marketplace die with it                                                          |
| **SAP Direct Store Delivery**            | ERP-integrated DSD: presales, delivery, van sales, mixed role, route settlement                    | Large bottlers/bakers/snack cos             | The canonical tour lifecycle: check-out → visits → check-in → settlement with discrepancy reasons                                 |
| **Oracle NetSuite** (WMS / Ship Central) | Distributor ERP with mobile pick/pack/ship                                                         | Mid-market distributors                     | Multi-order picking consolidated by item; wave release                                                                            |
| **Cin7 Core**                            | Inventory/ERP for SMB + B2B portal + WMS                                                           | SMB wholesalers                             | FEFO auto-pick that excludes expired batches, "recommend and warn"                                                                |
| **Unleashed**                            | Inventory + B2B store                                                                              | SMB manufacturers/wholesalers               | Explicit pricing hierarchy (customer price → quantity break → tier) that mirrors our decision                                     |
| **inFlow**                               | SMB inventory with "Showroom" B2B portal                                                           | Small wholesalers                           | Per-customer private showrooms; shows _available_ not on-hand qty                                                                 |
| **Route4Me**                             | Route optimisation SaaS + driver app                                                               | SMB delivery fleets                         | Dynamic dispatch (add/move stops mid-route)                                                                                       |
| **Onfleet**                              | Last-mile dispatch + driver app                                                                    | Delivery ops                                | POD shared to recipient tracking page; hide recipient PII after delivery; end-route tasks                                         |
| **Zoho RouteIQ**                         | Route planning for Zoho CRM field teams                                                            | SMB sales teams                             | Flexible vs scheduled stops; check-in only inside radius; block check-out until form done                                         |
| **Locus** (India)                        | Enterprise dispatch/route optimisation                                                             | FMCG (Unilever, Nestlé), 3PL                | Beat/territory as hard constraint; 30–50 stops/vehicle/day model; measurable results                                              |
| **LogiNext** (India)                     | Last-mile delivery management                                                                      | E-com, retail, FMCG                         | ePOD bundle (image + signature + timestamp + geo) and COD cash tracking                                                           |

---

## 2. The 24 features worth borrowing

Cost legend for a solo developer on the already-decided architecture (order aggregate, append-only stock ledger, pricing domain service, offline-first field apps):

- **Cheap** = days; mostly schema + one screen + a rule.
- **Medium** = 1–3 weeks; a state machine, a sync path, or a rules engine.
- **Expensive** = a month+ or needs ML/data/3rd-party service.

| #   | Feature                                                                                             | Who does it well                                                                           | Why it matters for an Indian FMCG distributor OS                                                                                                                                         | Cost                                                                   |
| --- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1   | Reorder from last order / saved order lists                                                         | Pepperi (predefined lists), Shopify B2B (duplicate past order), Cin7 (Favourites, Reorder) | Kirana orders are ~80% repeats. Retailer app and rep app both start from "last 3 orders" not an empty catalog.                                                                           | Cheap                                                                  |
| 2   | Quick-order grid (SKU + qty, no product pages)                                                      | Shopify B2B "quick order lists", Pepperi "quick order"                                     | Reps at a counter type 15 lines in 60 seconds; browsing is for discovery only.                                                                                                           | Cheap                                                                  |
| 3   | Quantity rules: min / max / increment (case multiples)                                              | Shopify B2B                                                                                | Real invoices show cases of 90/120 pcs and CS1 UOM. Enforce "order in case multiples or loose pcs" per SKU per tier.                                                                     | Cheap                                                                  |
| 4   | Order cut-off time per delivery route/beat                                                          | Pepperi (F&B distributor reduced routes), Ordermentum (cut-off reminders)                  | Tarsun runs multiple trips/day; cut-offs let the warehouse plan picking and trips. Send WhatsApp "order by 6pm for tomorrow's Aadharwadi trip".                                          | Cheap                                                                  |
| 5   | Standing orders (recurring)                                                                         | Ordermentum                                                                                | Water (Campa 1L) and staple namkeen have weekly rhythms; auto-drafted orders retailers confirm with one tap.                                                                             | Cheap–Medium                                                           |
| 6   | Minimum order value with rep override                                                               | Pepperi                                                                                    | Small drops kill delivery margin; owner sets MOV per tier, rep can override — logs it as an approval item.                                                                               | Cheap                                                                  |
| 7   | Per-SKU max qty per order (anti-hoarding)                                                           | Pepperi                                                                                    | Scheme-driven SKUs ("buy 10 get 1") get hoarded by one retailer; cap per order per SKU-warehouse.                                                                                        | Cheap                                                                  |
| 8   | Backorder visibility during order taking                                                            | Pepperi                                                                                    | Reps re-order what's already pending → duplicates. Show "pending undelivered qty" on the product row.                                                                                    | Cheap                                                                  |
| 9   | Store-specific authorised product lists & availability windows                                      | Repsly, Salesforce CGC ("authorized product lists", "closed listing")                      | Manufacturer-employed reps must only sell their brand; some SKUs only in some beats; seasonal SKUs appear/disappear automatically.                                                       | Cheap                                                                  |
| 10  | Credit hold: block ordering when overdue / over limit, server-enforced                              | Ordermentum, Cin7 [snippet]                                                                | Directly addresses "pending bills in a physical file". Credit limit and tier are never client-editable (already decided).                                                                | Cheap                                                                  |
| 11  | Credit note auto-applied to next order                                                              | Ordermentum                                                                                | Returns → credit notes is decided; applying them automatically at next invoice keeps ledgers clean.                                                                                      | Cheap                                                                  |
| 12  | Promotion taxonomy (12 types) with stacking rules                                                   | Pepperi                                                                                    | Real invoices show scheme free-qty, secondary %, cash %, GST benefit %. Model promotions as typed rules, not free-text.                                                                  | Medium                                                                 |
| 13  | Penny-perfect _offline_ pricing with pricing date, scale bases, rounding modes                      | Salesforce CGC                                                                             | Rep must show the exact invoice total offline. Pricing date (order vs delivery date) matters when schemes change month-end.                                                              | Medium                                                                 |
| 14  | Rep discount within margin guideline                                                                | Pepperi                                                                                    | Reps apply line/order discounts "while enforcing profit margin guideline" — without ever seeing cost. Our bargain flow already does this; the guideline enforcement is the reusable bit. | Cheap                                                                  |
| 15  | Vehicle as a stock location: check-out / check-in with supervisor signature and discrepancy reasons | SAP DSD                                                                                    | Solves the open van-sales question without a separate module: load = ledger transfer to vehicle; on-spot sale = sale from vehicle; check-in = counted return with reasons.               | Medium                                                                 |
| 16  | Route settlement cockpit: cash + stock + expenses reconciled per trip with traffic-light status     | SAP DSD (Settlement Cockpit), LogiNext (COD tracking)                                      | Teams of two per vehicle collecting cash/UPI across multiple trips — end-of-trip summary must reconcile expected vs collected vs returned with reasons before the trip closes.           | Medium                                                                 |
| 17  | Visit outcome reason codes and unplanned visits                                                     | SAP DSD                                                                                    | "Shop closed", "owner absent", "no cash" are data, not free text; unplanned/one-time-customer visits are allowed but flagged.                                                            | Cheap                                                                  |
| 18  | ePOD bundle (photo + signature + timestamp + GPS) configurable by risk, shared back to the retailer | LogiNext, Onfleet (POD on tracking page), Locus                                            | Disputes on partial deliveries are the #1 reason bills stay unpaid. Send POD to retailer via WhatsApp automatically.                                                                     | Cheap                                                                  |
| 19  | Hide retailer phone/PII from driver after delivery; end-route tasks                                 | Onfleet                                                                                    | Delivery staff churn; protect the retailer relationship. End-route checklist = cash handover, returns, fuel.                                                                             | Cheap                                                                  |
| 20  | FEFO auto-pick with "recommend and warn"                                                            | Cin7 Core                                                                                  | Snacks carry batch numbers and expiry (invoice C). Pick oldest batch first; warn, don't block, if manager overrides.                                                                     | Medium                                                                 |
| 21  | Multi-order picking consolidated by item, then sort to order                                        | NetSuite WMS                                                                               | Many small kirana orders of the same 40 SKUs → pick by SKU, then split to order at the packing bench.                                                                                    | Medium                                                                 |
| 22  | Flexible vs scheduled stops; check-in only inside geofence; block check-out until form complete     | Zoho RouteIQ                                                                               | Cheap route sequencing (no VRP) plus honest GPS evidence for the owner's coverage tracking.                                                                                              | Cheap                                                                  |
| 23  | Suggested order (pre-filled basket) from purchase history with promotion-spike normalisation        | Ivy Mobility [third-party], BeatRoute, Pepperi "Kai" [snippet]                             | Reps "start at 80% done". v1 is a heuristic (last 3 orders, frequency, days-since-last), not ML.                                                                                         | Medium (heuristic) / Expensive (ML)                                    |
| 24  | AI order capture from WhatsApp/voice/photo with human review queue → per-customer autopilot         | Choco (OrderAgent, Autopilot), Pepperi "Ella"                                              | Retailers already send orders on WhatsApp. Same review-then-commit pattern already chosen for Document Intelligence.                                                                     | Expensive (extraction) / Medium if reusing the invoice-vision pipeline |

Additional, smaller items worth noting: Pepperi "reserved orders" (retailer reserves scheme stock in distributor warehouse for later release — Medium, niche); Pepperi item restriction by geography (Cheap; useful for brand-territory rules); Shopify "checkout to draft" (order goes to approval queue based on company location — Cheap, maps to the owner approvals queue); Shopify PO numbers on orders (Cheap; modern trade needs it); inFlow "available qty not on-hand" (Cheap; derive from ledger minus reserved); Onfleet "avoid tolls / balance tasks across routes" (route settings, Cheap if using a routing API).

---

## 3. Order-taking UX

**What the best platforms converge on.** Three entry points, in this priority order: (1) reorder/last order, (2) quick-order grid or barcode scan, (3) browse catalog with images. Pepperi lists "Quick order", "Predefined order lists", "Barcode scanning", "Multiple images per item", "Smart search & dynamic filters", "Multiple UOM support with pricing at unit level", and "Backorders" as its order-taking core (https://www.pepperi.com/mobile-order-taking/). Repsly emphasises that "High quality product images make it easy to select the right item, even when names are similar" and scanning "off the shelf" with the phone camera or a Bluetooth scanner (https://www.repsly.com/product/mobile-order-entry-software). Shopify's B2B quick order list lets buyers "add multiple variants of a product to their cart in one click" (https://help.shopify.com/en/manual/b2b/getting-started/features).

**Concrete details from Pepperi's use-case guide** (https://www.pepperi.com/wp-content/uploads/2024/09/Advanced-Ordering-Features.pdf, read in full):

- _Multi-store buyer with one login_: one buyer switches between branches, each with its own catalog/pricing/promotions. Our retailer identity being separate from any single distributor's record already supports the mirror image (one shop, many distributors); the multi-branch case (a retailer with 2–3 shops) should also be modelled.
- _Predefined order lists_: unlimited named lists, visible on the homepage, copied into a new order in one tap.
- _Order maximum limitation_: "maximum quantity for each warehouse SKU combination can be set in a single sales order" to stop hoarding.
- _Minimum order value_: below-MOV order triggers a notification and "a rep is authorized to make exceptions and override the MOV".
- _Backorders_: while ordering, reps see "items and their quantities that were backordered in the past… a safeguard against placing duplicate orders."
- _Order cut-off times_: "Each buyer is assigned to a delivery route… Buyers are given a cutoff time before which all their orders need to be submitted"; it "effectively reduce[d] the number of delivery routes."
- _Item availability by delivery date_: red X next to items unavailable until the delivery date; the buyer must remove them or move the date.

**Salesforce CGC order flow** (https://trailhead.salesforce.com/content/learn/modules/order-management-for-sales-reps-in-consumer-goods-cloud/complete-the-order-taking-process): select items (or scan barcode) → Order Overview → notes for invoice/delivery → Preview PDF → calculate (pricing conditions from the order template) → collect payment (cash etc.) → Release, which "trigger[s] inventory checks and signature capture before the order moves to supervisor approval." Order templates distinguish standard vs return orders; admins can set "closed listing" so reps only order listed products.

**For us.** The salesperson app's order screen should open on "Last order / Suggested" with editable quantities, a case/pcs toggle per line (case sizes parsed from manufacturer invoices: "x 90", "_120", CS1), pending-undelivered qty shown inline, and a quick-add search bar. Barcode scanning is Cheap with any camera library; keep it optional because kirana counters rarely have shelf access.

---

## 4. Offline

Every serious field platform claims full offline with auto-sync: Pepperi "Full offline functionality with Auto Sync"; Salesforce CGC "take orders fully offline with penny perfect price and promotion driven orders" using a "Mobile Pricing Engine with performance optimized for a single user offline device" (https://trailhead.salesforce.com/content/learn/modules/penny-perfect-pricing-with-consumer-goods-cloud-offline-mobile-app/explore-pricing-conditions); SAP DSD explicitly supports an "occasionally connected scenario" where the device can add customers/orders mid-tour when it gets signal (SAP DSD Application Help PDF, https://help.sap.com/doc/fb8c9956bd704afe9dd92a0bd96c1d42/2.0.0.0/en-US/sap_dsd_1.0_application_help_en.pdf). Ivy's strongest third-party score is offline (4.6/5) but "conflict-resolution behavior during extended offline periods lacks public documentation" (https://www.rfp.wiki/retail-ecommerce/direct-store-delivery-software/ivy-mobility).

**What this implies technically:** the pricing engine and promotion rules must be _evaluable on the device_, i.e. pricing is data (rules + price lists synced down), not a server call. This is the single biggest architectural consequence of studying these platforms: if the pricing domain service is server-only, the rep app cannot quote a correct total offline. Recommendation: implement the pricing engine as a pure, dependency-free module that runs identically on server (authoritative) and client (preview), with the server recomputing on sync and flagging differences as a review item. Cost: Medium, but it is a design choice made once.

---

## 5. Suggested / AI ordering

Three tiers exist in the market:

1. **Heuristic basket** — BeatRoute's Order AI Agent builds "a recommended basket for every outlet using purchase history, seasonality, similar-customer behavior, and live promotions"; it normalises promotion spikes across "three-month, six-month, and prior-year" windows so "a spike should not skew future recommendations"; reps "start at 80% done, not zero" with "quantity recommendations [that] refresh every visit" (https://beatroute.io/resources/blog/automation-to-intelligence-route-to-market/). Ivy is credited with "AI next-best SKU suggestions" but "recommendation quality depends on data maturity" [third-party, rfp.wiki].
2. **Visit/task recommendations** — Salesforce Einstein recommends which stores to visit "based on multiple criteria, such as store priority, territory performance, and current quarter sales performance" and which tasks to do in-store, set up via Next Best Action strategies [snippet, Trailhead]. Repsly's Territory Advisor (July 2025) detects "workload imbalances and coverage gaps" and suggests when to "merge, split or rebalance territories" [snippet, BusinessWire].
3. **Order extraction from unstructured input** — Choco OrderAgent ingests "emails, texts, PDFs, voicemails, WhatsApp messages, photos of handwritten notes, even faxed POs", maps informal phrases ("five of the usual") to SKUs using each customer's history, shows a review UI where staff "verify and approve them in under 30 seconds", and offers "Autopilot" that auto-processes when "the order matches past behaviour, contains no anomalies, and meets confidence thresholds"; distributors choose "which customers are autopiloted" (https://choco.com/us/stories/suppliers/orderagent-the-ai-order-processing-engine-thats-powering-the-future-of-food-distribution; Autopilot details [snippet] from https://choco.com/us/press/autopilot). Pepperi's "Ella" does the same for emailed/scanned POs and "Kai" does product recommendations [snippet, wizcommerce/Pepperi].

**For us.** Ship tier 1 as a heuristic first (Medium): per retailer × SKU, compute average qty per order over last N orders, median inter-order gap, days since last; suggest SKUs whose gap has elapsed, cap by MOV/credit. Exclude quantities ordered under a scheme from the average (mirror BeatRoute's spike normalisation). Tier 3 is Expensive as a new pipeline but Medium if it reuses the already-decided photo→LLM vision→human review→commit pipeline: a WhatsApp voice note or text becomes a _draft order in the approvals queue_, never a committed one. Choco's per-customer autopilot is the eventual path but conflicts with "never auto-commit" — see recommended changes.

---

## 6. Trade promotions and pricing engines

**Promotion taxonomy** (Pepperi, https://www.pepperi.com/b2b-trade-promotions/): item promotions ("Buy 'X or more'… get Discount %, Discount Price, Total Price, Additional item(s) free (same or other)"), package ("Pick any 5 items… for $25"), bundle, total-order ("Buy '$X or more' and get…"), gift with purchase, category discount ("Max discount provided for a category"), quantity discount ("Buy X items get X free"), mix & match, end-of-order, category threshold, "supermarket variety" ("Order 'X' and 'Y' and offer 'Z' for free"), assortment pricing (quantity breaks across grouped items). Reps can add "additional discounts… at the line or order level, while enforcing profit margin guideline."

**Pricing hierarchy** (Unleashed, https://support.unleashedsoftware.com/hc/en-us/articles/900002579026-What-is-the-Customer-Pricing-Hierarchy [snippet]): customer-specific price (with valid-from/to) → quantity price break (with min qty and dates) → customer's sell price tier. This is exactly the CONTEXT decision (tier → retailer override wins → schemes stack unless final), which is reassuring; add _validity dates_ on every level.

**Pricing conditions** (Salesforce CGC, Trailhead page above): pricing date = order date or delivery date; scale bases on quantity, amount, weight, volume; automatic UOM conversion when the condition UOM differs from the ordered UOM; rounding modes (none, commercial, up, down); free items and returns are "neutral" (excluded from surcharge bases). Shopify adds volume pricing "when they purchase a certain quantity of a product in the same order" and payment terms Net 7–90 at company-location level.

**Mapping to the real invoices in CONTEXT.** Invoice E (Too Yumm DMS) has Free Qty, Secondary Dis %, Cash Dis %; invoice F has Scheme + Disc Amt; invoice C (inbound) has Disc %, GST Bnft %, Net Cost. The engine therefore needs at least: (a) free-qty scheme (item promotion with free same/other item), (b) percentage secondary discount at line level, (c) cash discount conditional on payment (order-level, applied at settlement), (d) a "GST benefit" style post-tax adjustment on inbound only. Represent each as a typed rule with: scope (SKU/brand/category/all), trigger (qty / value / mix), reward (%, amount, free qty of SKU), validity dates, tier/retailer applicability, `stackable` flag, and `pricing_date` mode. Cost: Medium; it is the core domain object of the product, so invest here rather than in ML.

---

## 7. DSD and van sales — the SAP tour lifecycle

SAP's DSD help (PDF read in full) is the most precise public description of the process and answers the open van-sales question with a pattern, not a new module.

Roles: _preseller_ (takes orders, delivered later), _delivery driver_ (delivers presold orders), _van seller_ ("sells goods to customers from a speculative load on the vehicle"), and _mixed role_ combining all three. Tarsun's delivery teams already take "on-spot orders" — that is the mixed role.

Lifecycle (verbatim structure from the PDF):

1. **Data synchronization** — tour, visit list, shipment (load) to device.
2. **Start-of-day** — driver/co-driver/vehicle, "vehicle security checks, and odometer reading".
3. **Check-out** — "Mobile users check what was loaded onto their vehicles. This can include both materials and cash. One or more supervisors confirm a check-out by using signature capture." Materials "are counted (in base or sales units) and reasons can be recorded if check-out discrepancies arise."
4. **Tour processing** — per visit: deliver presold order ("add items and change item quantities", "return of goods (for example, spoiled goods, incorrect items) and the return of empties"), sell from van, "Invoice and print invoices", "Collect payments for current deliveries as well as outstanding open items", change payment terms/method on device, capture signature. Or mark visit not done "with a reason code… (for example, customer was closed or a driver ran out of time)". Drivers "can change the sequence of the visits" and "create new, unplanned visits" including for a one-time customer. Inventory adjustments "by recording breakages or by transferring unreserved stock from one vehicle to another". "Mobile users can record cash expenses incurred on their tour… highway tolls, gas, and parking… used in the end-of-day discrepancy calculation."
5. **Check-in** — "materials and empties returned to the warehouse are validated… verified and confirmed by supervisors."
6. **End-of-day** — final odometer, "confirmation of check-in materials (including returns, damaged goods, and empties), cash, and expenses. Reasons can be recorded for any check-in discrepancies."
7. **Upload → Settlement** — "invoices and collected payments are settled in the Settlement Cockpit and Route Accounting." The cockpit shows a green/yellow/red status per settlement [snippet, SAP Community].

Ivy adds a **load request/approval** step: sellers "pick a load type and get their quantity selection approved by a higher authority", with "intelligent load recommendations" from historical sales [snippet, Ivy blog]. Pepperi's route accounting page lists "Load van", "Unload van", "Payment collection: Accept cash and payments of any type", GPS navigation, and electronic signatures (https://www.pepperi.com/route-accounting-dsd/).

**For us (Medium).** Model each vehicle as a stock location in the append-only ledger. A trip = {vehicle, crew (2), planned stops (presold orders), load lines}. Check-out = ledger transfer warehouse→vehicle with counted qty and supervisor PIN/signature; on-spot order = sales order fulfilled from the vehicle location (same order aggregate, `fulfilled_from = vehicle`); returns = vehicle←retailer lines with reason; check-in = counted transfer vehicle→warehouse; any difference posts to a "trip variance" account with a reason code. This uses the three existing state machines and needs no separate van-sales product. Multiple trips per day = multiple trip records per vehicle per day.

---

## 8. Delivery proof and the retailer-facing side of delivery

- Evidence types: LogiNext lists "signatures, images, scans, timestamps, and location data" plus OTP, and argues "Not every shipment deserves the same level of scrutiny" — evidence requirements should be configured by delivery risk (https://www.loginextsolutions.com/blog/electronic-proof-of-delivery-the-50b-last-mile-lie/). Locus: "signature, stamp, photo, geotag, timestamp, barcode scan, or electronic acceptance workflow" [snippet]. Onfleet: photo, barcode (multiple, can be mandatory), signature, age/ID, notes (https://onfleet.com/proof-of-delivery).
- **Share POD with the recipient**: Onfleet 2025 "Share PODs Automatically on Customer Tracking Pages" so recipients "can view photos and the signature captured" (https://onfleet.com/blog/2025-whats-new-in-onfleet/). For us: WhatsApp the delivery photo + invoice PDF + UPI QR to the retailer on completion — this doubles as the payment nudge.
- **Privacy**: Onfleet "Hide Personal Recipient Information From Drivers Post-Delivery".
- **End Route Tasks** guide drivers through end-of-day steps — our end-of-trip summary should be a checklist (cash counted, UPI total, returns handed over, damaged goods photographed), not just a report.
- **Partial delivery**: our delivery state machine already has "partial"; borrow SAP's requirement that the driver can change quantities on the delivery and that every short line carries a reason code, so the invoice (derived artifact) is regenerated from delivered quantities, not ordered ones.

All of the above is Cheap given GPS tracking is already required.

---

## 9. Cash reconciliation

SAP DSD's model is the reference: cash is _checked out_ (float) and _checked in_ with supervisor confirmation, expenses are recorded by type and "used in the end-of-day discrepancy calculation", and reasons are mandatory for discrepancies. Ivy's third-party review notes "dedicated cash/check/variance settlement accounting is less explicitly documented" — i.e. even big vendors under-build this, which is an opening. LogiNext's driver app will "Track cash collected in case of cash on delivery, providing a complete financial overview" (https://apps.apple.com/us/app/loginext-mile/id6474857757). Ordermentum solves the problem upstream with auto-pay on due date, automatic retries of failed payments, and "prevent overdue customers from placing additional orders" (https://www.ordermentum.com/supplier/features/payments) — the auto-pay part is fintech (out of scope), the credit-hold part is not.

**For us (Medium):** per trip, `expected = Σ cash marked collected on stops`; `declared = crew count at check-in`; `variance = declared − expected + expenses`; status green (0), yellow (within owner tolerance), red (beyond). A red trip cannot close without an owner approval item. UPI collections reconcile against the payment reference typed/scanned by the driver; the owner dashboard shows "cash in transit" per vehicle live. Keep it as an accounting view over payment events — no wallet, no lending.

---

## 10. Pick, pack, invoice

- **Cin7 Core**: "Auto-pick actions choose stock in line with FIFO/FEFO costing methods, excluding expired stock"; with "Recommend and warn", the picker is directed to the first-expiring bin and gets a warning at authorisation if they picked otherwise, which they may ignore or fix [snippet, Cin7 help]. Authorised orders reserve inventory before pick.
- **NetSuite**: "multi-order picking and packing prompts staff to pick all like items for multiple orders at once… consolidated by item" and wave release "releases like orders together" [snippet, netsuite.com]. Pick/Packed/Shipped are distinct transaction stages.
- **inFlow Showroom** shows "available quantity, not the quantity on hand" to customers (https://www.inflowinventory.com/support/cloud/showroom-inflows-b2b-portal/).

**For us:** picklist generation per trip (wave = trip) consolidated by SKU with batch suggestion (FEFO, expiry from inbound invoice batch numbers), then a packing confirmation per order that records actual batch and qty; invoice is generated from packed quantities. Available-to-promise = ledger balance − reserved by authorised orders. Cin7's "warn, don't block" is the right default for a two-person warehouse. Medium.

---

## 11. Route optimisation and territory

- **Locus** replaces "static beats with algorithmic route planning that accounts for load type, time windows, capacity, and service levels" and treats "territory structure as a hard constraint" for "30-50 stops per vehicle per day" models [snippet]; an Indonesian FMCG distributor case reported "30% reduction in total plan numbers, 12% increase in serviceability ratio, 20% reduction in distribution costs" (https://locus.sh/case-studies/how-to-eliminate-human-dependency-in-retail-or-fmcg-sales-beat-planning/).
- **Route4Me** offers dynamic dispatch: "assign or adjust stops mid-route while routes are in progress" and reoptimise instantly [snippet].
- **Onfleet 2025**: optimise "based on available vehicles" without pre-assigning drivers; "Avoid Tolls" and "Balance Tasks Across Routes"; "Predictive ETA Delay" webhooks.
- **Zoho RouteIQ** (https://help.zoho.com/portal/en/kb/routeiq/introduction/articles/routeiq-feature-list): flexible stops ("specified duration" but no fixed time) vs scheduled stops; "automatically rearranges stops' order in routes with flexible timing to minimize the travel distance"; "Allow your field agents to check-in/out only if they are located within the allowed radius"; "Restrict check-out… until they have completed filling up a form"; time & mileage tracking; hand-off to Google Maps/Waze/Apple Maps.

**For us:** do not build a VRP solver. v1 (Cheap): beats are owner-defined (matches the "Beat Name" on invoice E); a trip's stops are sequenced by nearest-neighbour or Google Routes/OSRM matrix; navigation hands off to Google Maps. Geofenced check-in/out on both rep and delivery apps gives the owner's coverage tracking real evidence. v2 (Expensive): capacity-aware multi-trip planning — only when a customer has more than ~5 vehicles.

---

## 12. Retailer self-service apps

- **Ordermentum venue app**: "standing orders and cut-off reminders mean you'll never run out of essentials"; instant order edits; team approvals and shared carts; price-change tracking; supplier discovery with "regular, tailored recommendations" (https://www.ordermentum.com/venue/features/procurement).
- **Faire**: retailers get free returns on first order from a new brand and net-60 (Faire carries the credit risk and "pays brands promptly after their orders ship"); brands pay 15% commission on marketplace orders but "Orders that come through a brand's Faire Direct link are completely commission-free" (https://www.faire.com/how-faire-works). March 2025: POS-powered reordering — retailers "can see which previously purchased products are running low and reorder best sellers using the restock tab" [snippet].
- **Shopify B2B**: company → up to 50 locations, each with its own price list, payment terms, tax settings; "Choose whether you want to require B2B customer orders to be placed as drafts based on company location"; PO numbers; reorder by duplicating a past order (https://help.shopify.com/en/manual/b2b/getting-started/features).
- **Cin7/inFlow/Unleashed portals**: assigned catalog + price tier per customer, stock visibility, order status, reorder/favourites, guest access.
- **Handshake** lesson: a Shopify-owned wholesale ordering tool was shut down when strategy shifted to Faire [snippet]. Retailer value must live in the distributor relationship, not a marketplace layer.

**For us:** the retailer app home = per-distributor cards with "Reorder", "Running low" (from suggested-order heuristic), "Deals this week", "You owe ₹X — pay via UPI", and cut-off countdown for the next trip. Discovery directory stays opt-in per distributor with new relationships cash/prepaid (already decided) — that is Faire Direct without Faire's credit. Everything here is Cheap once the order aggregate and pricing engine exist.

---

## 13. Recommended changes / clarifications to earlier decisions

1. **Van sales (open question) → answer "yes, as mixed role", not as a separate app.** Evidence: SAP DSD's mixed role; Tarsun crews already take on-spot orders. Implement vehicle-as-stock-location (Section 7). No new app, one new location type and a trip aggregate.
2. **Pricing engine must run on-device.** CONTEXT says pricing is a domain service; it should be a pure module shipped to the field apps, with server recompute on sync. Without this, "offline-first" and "exact total at the counter" cannot both be true (Section 4).
3. **"Never auto-commit" — keep for now, but log confidence and corrections from day one.** Choco's per-customer Autopilot (50% of orders at early adopters) is where document intelligence and WhatsApp order capture end up. Storing extraction confidence + human edits now makes a future opt-in autopilot per supplier/retailer possible without rework. Not a change to the rule, a change to what is logged.
4. **Add validity dates to every price/promotion level and a `pricing_date` mode per distributor** (order date vs delivery date). Schemes in Indian FMCG change at month-end; orders taken on the 30th and delivered on the 2nd need a defined rule (Section 6).
5. **Sequencing hint for the solo build:** the 24 features cluster on three domain objects — order aggregate (features 1–11, 17, 23), pricing/promotion rules (12–14), trip/settlement (15–16, 18–19, 22). Build the order + pricing core first; delivery/trip second; pick/pack (20–21) third. Everything AI (23-ML, 24) last.

---

## 14. What not to borrow

- **Wireless DEX** (Ivy): a US retailer EDI standard for DSD invoices; irrelevant in India.
- **Image recognition / planogram compliance** (Ivy Eye, Repsly, Salesforce): built for brand merchandising teams, not distributors; vendor accuracy claims are "vendor-stated and should be verified in pilots" [rfp.wiki]. Expensive and off-target.
- **Marketplace-financed net terms** (Faire net-60, Ordermentum auto-pay): fintech is explicitly out of scope; borrow only the _credit hold_ and _credit-note auto-apply_ behaviours.
- **Full VRP optimisation** (Locus, Route4Me): valuable at hundreds of vehicles, not at 2–5. Use a routing API for sequencing only.
- **No-code back-office configurability** as a selling point (Pepperi's "without writing a single line of code"): great for Pepperi, but a solo dev should ship opinionated defaults and add configuration only where Tarsun actually diverges.

---

## 15. Sources

Read in full:

- Pepperi Advanced Ordering Features PDF — https://www.pepperi.com/wp-content/uploads/2024/09/Advanced-Ordering-Features.pdf
- Pepperi mobile order taking — https://www.pepperi.com/mobile-order-taking/
- Pepperi trade promotions — https://www.pepperi.com/b2b-trade-promotions/
- Pepperi route accounting / DSD — https://www.pepperi.com/route-accounting-dsd/
- SAP Direct Store Delivery Application Help (PDF) — https://help.sap.com/doc/fb8c9956bd704afe9dd92a0bd96c1d42/2.0.0.0/en-US/sap_dsd_1.0_application_help_en.pdf
- Shopify B2B features overview — https://help.shopify.com/en/manual/b2b/getting-started/features
- Salesforce CGC complete the order-taking process — https://trailhead.salesforce.com/content/learn/modules/order-management-for-sales-reps-in-consumer-goods-cloud/complete-the-order-taking-process
- Salesforce CGC pricing conditions (penny-perfect offline) — https://trailhead.salesforce.com/content/learn/modules/penny-perfect-pricing-with-consumer-goods-cloud-offline-mobile-app/explore-pricing-conditions
- Repsly mobile order entry — https://www.repsly.com/product/mobile-order-entry-software
- Ordermentum payments — https://www.ordermentum.com/supplier/features/payments
- Ordermentum venue procurement — https://www.ordermentum.com/venue/features/procurement
- Choco OrderAgent — https://choco.com/us/stories/suppliers/orderagent-the-ai-order-processing-engine-thats-powering-the-future-of-food-distribution
- Choco sales rep app press release — https://www.prnewswire.com/news-releases/choco-introduces-new-sales-rep-app-for-food-distributors-302282130.html
- Faire how it works — https://www.faire.com/how-faire-works
- Onfleet proof of delivery — https://onfleet.com/proof-of-delivery
- Onfleet 2025 what's new — https://onfleet.com/blog/2025-whats-new-in-onfleet/
- LogiNext ePOD article — https://www.loginextsolutions.com/blog/electronic-proof-of-delivery-the-50b-last-mile-lie/
- LogiNext Mile App Store listing — https://apps.apple.com/us/app/loginext-mile/id6474857757
- Locus DSD examples — https://locus.sh/blogs/direct-store-delivery-examples/
- Locus beat planning case study — https://locus.sh/case-studies/how-to-eliminate-human-dependency-in-retail-or-fmcg-sales-beat-planning/
- Zoho RouteIQ feature list — https://help.zoho.com/portal/en/kb/routeiq/introduction/articles/routeiq-feature-list
- inFlow Showroom — https://www.inflowinventory.com/support/cloud/showroom-inflows-b2b-portal/
- BeatRoute Order AI Agent — https://beatroute.io/resources/blog/automation-to-intelligence-route-to-market/
- rfp.wiki Ivy Mobility evaluation [third-party] — https://www.rfp.wiki/retail-ecommerce/direct-store-delivery-software/ivy-mobility

Snippet-level only (not read in full; treat as medium confidence):

- Choco Autopilot — https://choco.com/us/press/autopilot
- Cin7 pick / FEFO — https://help.core.cin7.com/hc/en-us/articles/10848183141519-Pick-items-for-a-sale and https://help.core.cin7.com/hc/en-us/articles/11073339845135-Product-and-measurement-settings
- Cin7 B2B portal reorder — https://help.core.cin7.com/hc/en-us/articles/9034604614543-Using-the-B2B-Portal
- Unleashed pricing hierarchy — https://support.unleashedsoftware.com/hc/en-us/articles/900002579026-What-is-the-Customer-Pricing-Hierarchy
- NetSuite pick pack ship / multi-order picking — https://www.netsuite.com/portal/products/erp/warehouse-fulfillment/pick-pack-ship.shtml
- Route4Me dynamic dispatch — https://support.route4me.com/faq/route-optimization-with-dynamic-dispatch/
- Ivy DMS marketplace listing — https://azuremarketplace.microsoft.com/en-us/marketplace/apps/ivymobiletechnologiespteltd1707402442190.ivymobility-distribution-management-system?tab=overview
- Ivy van sales blog — https://ivymobility.com/blog/van-sales-software-for-improved-order-and-delivery-management/
- Salesforce Einstein visit recommendations — https://trailhead.salesforce.com/content/learn/modules/visit-and-task-recommendations-for-admins-with-consumer-goods-cloud/explore-einstein-for-consumer-goods-cloud
- Repsly Territory Advisor — https://www.businesswire.com/news/home/20260716553921/en/Repsly-Introduces-Territory-Advisor-to-Provide-Real-Time-Data-Driven-Retail-Merchandiser-Optimization
- Faire POS-powered reordering — https://www.faire.com/en-gb/blog/for-brands/release-notes-2025
- Handshake shutdown — https://resolvepay.com/blog/handshake-shopify-wholesale
- SAP Settlement Cockpit status — https://community.sap.com/t5/enterprise-resource-planning-q-a/dsd-settlement-cockpit/qaq-p/4971061
- Pepperi Kai/Ella — https://wizcommerce.com/blog/pepperi-pricing/
- Shopify B2B on all plans (Apr 2026) — https://www.sparklayer.io/blog/2026/04/03/shopify-b2b-all-plans/
