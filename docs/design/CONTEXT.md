# Distribution OS — shared context for all agents (read fully before working)

## What is being built

A multi-tenant SaaS "operating system" for Indian FMCG distributors (manufacturer -> distributor -> retailer/kirana). Paying customer: the distributor (subscription). Retailers use it free. Founder is a SOLO developer building daily; may hire 1-2 people after a base exists. Wants production-grade, reliable, scalable (target: lakhs of users eventually) — NOT a demo. Wants a frontend + backend architecture and folder structure to start coding from.

Pilot customer: the founder's friend, "Tarsun Enterprises", a new distributor in Kalyan West, Thane, Maharashtra (GST registered). Brands carried: Campa water (via Reliance Consumer Products / Reliance Retail), Too Yumm (Guiltfree Industries, RP-Sanjiv Goenka), MOM makhana snacks (bought via a sub-distributor Guru Kripa Enterprises, a UDYAM micro enterprise), Balaji, Alan's / Masti Oye namkeen, others.

## Five apps decided (final, confirmed twice by founder)

1. Distributor (owner) app: live dashboard (sales, stock movement, orders, payments for day/month), approvals queue, team + area coverage tracking, profit view, price control, live delivery map, manufacturer directory, incentives.
2. Salesperson app: take orders at shops, discounts within owner-set limits, bargain requests, live catalog with stock/price, my retailers + territory, my orders, performance/incentive.
3. Manager (warehouse) app: stock entry by scanning manufacturer invoice (zero manual entry), order queue, picklist, packing confirmation, billing / invoice generation.
4. Delivery app: trip stops, delivery states (started / in progress / delivered / partial), on-spot orders, navigation, collect payment (cash/UPI), returns, end-of-trip summary. GPS tracking of delivery staff required by owner.
5. Retailer (shopkeeper) app: wholesale shopping-app experience from the retailer's own distributors, browse catalog with deals, order status, outstanding payments, request discount, discover distributors (opt-in directory per distributor; new relationships start cash/prepaid).

## Decisions already made in the earlier design chat (Aug 2026)

- Sales Order is the primary aggregate; invoice is a derived financial artifact. Three independent state machines: order fulfilment / delivery / invoice-payment.
- Inventory = append-only stock ledger with derived balances (never a mutable stock row).
- Retailer and Manufacturer are separate aggregate roots. Pricing engine is a domain service (price list tier -> retailer-specific override wins -> schemes stack unless flagged final).
- Manufacturer + Product master are SHARED/global across tenants (so every distributor does not re-create "Campa 1L"). Retailers, sales reps, prices, orders are tenant-isolated. Retailer login identity is separate from any one distributor's record (a shop can be linked to many distributors).
- Bargain = request/approve flow, opt-in per retailer, per-rep auto-approve bound set by owner. Not live chat.
- Incentives = targets + achievement + computed amount only; no payroll.
- Retailer can self-edit shop details but can never touch credit limit / price tier (server-enforced).
- GST: CGST/SGST vs IGST split on invoices, e-way bill fields, UPI QR on every invoice. Sales returns -> credit notes. Batch numbers. Per-line discount, free qty, schemes. Transport receipt (LR) is its own document type.
- Document Intelligence: photo -> LLM vision extraction -> human review -> commit. Never auto-commit. Full-quality images.
- Trade credit (running tab/outstanding) yes; loans/lending NO.
- Offline-first field apps; WhatsApp/SMS over push for retailers; Hindi + English first.
- Migration playbook: reference data first, outstanding balances reconciled with mandatory human checkpoint, parallel-run 1-2 weeks, Tally/Marg/CSV importers, background rate-limited imports.
- Hard test: a salesperson must never see purchase price / margin (a real Vyapar failure caused staff to quit).
- Open question never answered: van sales (salesman carries stock and sells from vehicle)?
- Founder said "no phases, build all 5 at once" but is solo; sequencing by dependency is still needed.

## Founder's answers today (2026-09-04)

- Payments/fintech NOT a focus now. Revenue = subscription from distributors.
- Retailers pay in bulk every 2-3 orders; today pending bills sit in a physical file.
- Distributor owns pricing and discounts.
- Salespersons: some employed by the manufacturer, some by the distributor on incentives — depends on brand.
- Damages/returns: some manufacturers take them back, some do not — per brand policy.
- Delivery: multiple vehicles, teams of two per vehicle, multiple trips per day depending on return time.
- Devices: iPhone AND Android. Languages: Hindi + English now.
- GPS tracking of delivery people required.

## REAL INVOICES observed (6 photos, Aug 2026) — ground truth for document intelligence

A. Guru Kripa Enterprises -> Tarsun (MOM makhana). Tally-style "Tax Invoice". NO e-invoice IRN/QR (micro supplier, UDYAM). Columns: Description of Goods, HSN/SAC, MRP/Marginal, Quantity (Pcs), Rate, per, Disc %, Amount. Line names like "MOM Makhana 12g - Himalayan Salt N Paper x 90" with "2 Case" noted under each line, 180 pcs => case size 90. Some lines have Disc % 8.33. CGST 2.5% + SGST 2.5%. Multi-page ("continued to page number 2"). Header: invoice no 1038/2026-27, date, "Other References: 19 Case".
B. Reliance Retail Ltd (Reliance Consumer Products, Campa) -> Tarsun. Has IRN (64 hex), QR code, e-way bill no, Delivery No, Article Code 494607257, "SURE WATER BY CAMPA 1L 2.0", Quantity 700 UOM CS1 (cases), MRP/Each 15.00, Rate/Unit 135.43, Base Value 94,801, Discount 42,801.66, Taxable 51,997.14, Tax 2,599.86, Total 54,597. Page 1 of 2. SAP-style.
C. Guiltfree Industries Ltd (Too Yumm) -> Tarsun. Has IR Number + QR + EWB, PO no, Sales Order, Transporter Sneha Logicare LLP, LR no, Vehicle no, Delivery Number. Page 1 of 5. Columns: Product Code, HSN, Description e.g. "TY! Wafers Chilli 21.5G(16+5.5)_120", QTY (Pcs) 120, Boxes 1, Batch No (N526205...), MRP 10, Base Cost 8.14, Total Cost, Disc %, GST Bnft %, Net Cost, Tax Rate 5, IGST/CGST/SGST, Total.
D. Sneha Logicare LLP Lorry Receipt (GR No 26840): consignor Guiltfree, consignee Tarsun, 48 packages "food", invoice IS2726003926, weight 240, vehicle MH04LE3184, receiver signature. Separate doc type (transport LR) used to reconcile arrival.
E. Tarsun -> Dhanlaxmi Super Market (retailer). "Seller Copy 1/3". Generated by a MANUFACTURER DMS: Buyer ERP Id "FO_GFIL_66305628", SO No "SO-16379462-0271", Invoice No "IN-16379462-0269", Item ERP Id, Beat Name "AADHARWADI RUNAK CITY (K-WEST)", Salesman Name, Employee contact. Items: Bhoot Karare, KR Chilli Achari, Korean Karare, TY! Puffcorn, TY! Kids Cheese Balls (all Too Yumm). Columns: MRP, Free Qty, Invoice/Delivery Qty (pcs), Price/Piece, Net Amt, Secondary Dis %, Cash Dis %, Taxable, GST %, GST Amt, Total. => Too Yumm MANDATES its DMS on the distributor; the distributor's secondary invoices for that brand come out of the brand's DMS. Retailer has no GSTIN/PAN (unregistered).
F. Tarsun -> Shree Shakti Provision Store (retailer). "GST TAX INVOICE / ORIGINAL", Bill No GL/1686, Date + Due Date (same day), retailer Code 14023, Alan's & Masti Oye Rs 5 packs, columns: HSN, Product Name, Qty, Free, MRP, Rate 3.81, Scheme, Disc Amt, Taxable, SGST%, CGST%, Net Amt. Different billing software than E. Retailer unregistered.
G. A small thermal-printer slip from Tarsun to a retailer for "SURE WATER BY CAMPA" (third billing format).
=> Conclusion: the distributor already runs at least 3 billing systems in parallel (brand DMS for Too Yumm, own billing software, thermal slip for Campa). Inbound invoices split into (1) large manufacturers WITH IRN/QR e-invoice and (2) small suppliers WITHOUT. Quantities are ordered in cases but invoiced in pcs; case sizes are embedded in names ("x 90", "_120", CS1). Batch numbers exist for snacks. Discount structures are complex (base -> discount -> taxable; secondary discount + cash discount; scheme free qty; GST benefit).

## Competitors already identified

India DMS/SFA: Bizom, FieldAssist, Botree, BeatRoute, Distributo, SalesTrendz, PepUpSales, SpireStock, Salescode. Billing/ERP: Marg ERP, Vyapar, Busy, Tally, Logic ERP, Billdev, ERP Group, Gofrugal. Marketplaces: Udaan (acquired ShopKirana), Jumbotail, ElasticRun, JioMart Partner, Flipkart Wholesale, Qwipo; ONDC DigiDukaan (govt B2B kirana procurement, 2026 rollouts). Brand DMS: HUL Shikhar. Global: Pepperi, Ivy Mobility, Salesforce Consumer Goods Cloud, Repsly.
Documented complaints: Bizom = complex setup, internet-dependent, slow at EOD, pricing not for small distributors. FieldAssist = pricing high for small biz, support slow. Vyapar = role leak (salesman saw margins), compresses invoice photos, mouse-dependent entry, per-device licenses. Marg = feature bloat needs training, support ping-pong between Marg and resellers, price creep.
