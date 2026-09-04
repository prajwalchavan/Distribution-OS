# R04 — B2B Kirana Marketplaces, ONDC/DigiDukaan, and the Local Distributor (India, Sept 2026)

Research date: 2026-09-04. Everything below is sourced; items marked **[unverified]** could not be confirmed from a primary source within this session. Play Store / App Store figures were scraped live on 2026-09-04.

## 0. Executive summary

1. **The marketplaces have stopped trying to replace distributors and are now trying to _become_ the distributor's order channel.** Udaan (FY25 revenue ₹4,561 Cr, loss ₹1,055 Cr, pre-IPO $160M in July 2026, DRHP not yet filed) shrank revenue 20% by exiting low-margin categories; ElasticRun (FY25 ₹2,653 Cr, loss cut 60%) pivoted to private labels and logistics; Jumbotail (FY25 ₹725 Cr, down 21%) is building franchised J24 stores. None is profitable. All three carry retailer reviews dominated by _fulfilment failures_ (wrong/expired stock, rejected returns, undelivered COD orders).
2. **DigiDukaan (DPIIT + ONDC) is explicitly distributor-inclusive.** Launched Hyderabad 8 March 2026 via Qwipo (10,000+ retailers, 35+ brands), Jaipur 19 June 2026 via Salescode.ai, with Mumbai/Bengaluru/Delhi-NCR next. Its official framing: retailers order digitally, _distributors continue to deliver_, brands see demand. Qwipo's app release notes (19 Aug 2026) say it "introduced wholesaler access alongside distributors" — i.e. local distributors are the sellers on the network.
3. **Plugging a distributor-owned OS into ONDC is technically well-defined and cheap at the network level** (₹1.5 per successful transaction above ₹250; no listing fee) but operationally non-trivial: Ed25519/X25519 keys, `/on_subscribe` challenge, registry, pre-prod certification with log validation, mandatory Reconciliation & Settlement Framework (RSF) and grievance (IGM) handling. Two routes: (a) ride a certified Seller Network Participant/TSP (Bizom, Salescode, Qwipo, Mystore, etc.: 1-4 weeks, ₹0-50k + 1-3%), or (b) register the multi-tenant OS itself as an **NP-MSN** (marketplace seller app) with each distributor as a `provider` — a 3-6 month build. Recommended: (a) first for the pilot city, (b) once ≥20 distributors are live.
4. **Threat assessment: partial bypass is real but bounded.** Brands can and do appoint platforms as distributors; CCI (Udaan v Britannia, 2022) confirmed brands may _refuse_ to supply marketplaces directly and route through authorised distributors. Distributors' durable moat = 30-60 day credit, sub-case quantities, returns absorption, same/next-day frequency, and the beat relationship. AICPDF (4.5 lakh distributors) says margins are 3.5-5% and ₹57 of every ₹100 goes to logistics + manpower — so the moat is real but _economically fragile_; software that cuts order-booking and collection cost is the lever.
5. **Retailer-facing apps exist at scale, but almost all are brand-owned (HUL Shikhar ~1/3 of HUL general-trade sales, ITC Unnati 8 lakh outlets, Coke Buddy 10 lakh retailers) or platform-owned (Bizom 8 lakh retailers).** The revealing pattern in their reviews: the app is fine; the _distributor behind it_ fails ("dealer agent said material not available", "stays in ordered status", "damaged return not adjusted"). Coke Buddy is deployed as per-bottler white-label instances. We found **no published adoption data for an independent small distributor's own white-label app** — the gap the Distribution OS retailer app targets.

---

## 1. Landscape as of September 2026

| Player                                                    | Model                                                                                       | Scale / latest financials                                                                                                                                                                                                                 | Status Sept 2026                                                                                                                                                                                                                                                                                  | Relationship to local distributors                                                                                                                                                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Udaan** (Hiveloop)                                      | Inventory-led eB2B, "cluster model", essentials-only                                        | FY25 revenue ₹4,561.4 Cr (−20% YoY), loss ₹1,055.4 Cr (−37%); FY24 rev ₹5,706.6 Cr. Series G $114M Jun 2025 (~$1.8B val). Pre-IPO $160M (equity+debt+bond conversion) 14 Jul 2026 led by M&G.                                             | NCLT-approved consolidation into Hiveloop Ecommerce (Jan 2025). ShopKirana acquired all-stock Jul 2025 (Info Edge valued its stake at $23.13M). DRHP **not filed** (Inc42 tracker). Mgmt guides group EBITDA-profitable in 12-18 months. Play Store 4.2★, 1.24 lakh reviews, updated 31 Jul 2026. | Competes with distributors; but where brands refuse direct supply (CCI case) Udaan buys _from authorised distributors_. Its captive NBFC (Hiveloop Capital) has **completely phased out on-Udaan retailer financing** (ICRA, Dec 2025). |
| **Jumbotail**                                             | eB2B marketplace + own logistics + J24 franchised stores + fintech                          | FY25 revenue ₹725.1 Cr (−20.6% from ₹913.8 Cr). $120M Series C led by SC Ventures Jun 2025 → unicorn. NEC strategic investment Mar 2026. Claims 250k+ kiranas, 50+ cities.                                                                | Play Store 4.1★, updated 26 Aug 2026. Focus shifting to store-ops tech (GoldenEye OS) with NEC.                                                                                                                                                                                                   | Bypass model (brand → Jumbotail → kirana). Sells sub-case quantities ("90% of FMCG orders < 1 case").                                                                                                                                   |
| **ElasticRun**                                            | Rural eB2B, now private label + regional brands + logistics                                 | FY25 gross revenue ₹2,653 Cr (+9%), loss ₹145 Cr (−60% from ₹360 Cr) after a ~49% revenue collapse in FY24. Net take rate up ~50% on private labels. Logistics shipments +35%; building white-label 2-hour delivery.                      | Alive, stabilised, smaller than 2022 peak.                                                                                                                                                                                                                                                        | Rural bypass model; increasingly a logistics vendor. Low overlap with an urban Thane distributor.                                                                                                                                       |
| **JioMart Partner** (Reliance Retail)                     | Reliance buys from brands, sells to kiranas at deep discounts (20-25% historically claimed) | 200+ cities. Reliance targets 13M kiranas.                                                                                                                                                                                                | Live (com.jio.bapp). Consumer JioMart reviews poor (PissedConsumer 1.4★/623) — B2B-specific reviews not separable. The Ken (paywalled) reported kiranas "not quite convinced".                                                                                                                    | Explicit bypass; distributor trade bodies retaliated (2021). Brands sometimes appoint Reliance as a direct distributor.                                                                                                                 |
| **Flipkart Wholesale**                                    | Digital B2B (ex-Walmart Best Price), credit-led                                             | No 2025-26 financials found. Closed some cash-and-carry stores to go digital. Positions credit as "primary growth lever".                                                                                                                 | Live.                                                                                                                                                                                                                                                                                             | Bypass model.                                                                                                                                                                                                                           |
| **Qwipo** (Xavica Software, Hyderabad)                    | ONDC Seller Network Participant; DigiDukaan Hyderabad partner                               | 10,000+ retailers, 35+ brands onboarded (Mar–Jun 2026). Play Store "Qwipo DigiDukaan" 4.2★, 1.04K reviews, 10K+ downloads, updated 31 Aug 2026. App Store 4.3★ (15 ratings).                                                              | Active DigiDukaan operator. v4.1.93 (19 Aug 2026): "introduced wholesaler access alongside distributors".                                                                                                                                                                                         | **Distributor-inclusive**: distributors/wholesalers are sellers; Qwipo is the app + onboarding layer.                                                                                                                                   |
| **Kirana King** (Jaipur)                                  | Retail-as-a-Service aggregator; branded kirana network, central procurement                 | FY25 revenue ₹383 Cr (Tracxn) **[unverified]**; 76 employees; $3.31M raised.                                                                                                                                                              | Named participant in DPIIT/ONDC DigiDukaan roundtable (Jun 2026).                                                                                                                                                                                                                                 | Acts as buying group for its stores — a partial distributor substitute in Jaipur.                                                                                                                                                       |
| **Kirana Club** → **Meesho**                              | Community app + D2R marketplace ("brands and distributors")                                 | 4.1M registered retailers; FY26 revenue ₹15.84 Cr, loss ₹30 lakh. Meesho acquiring 100% for ₹202.08 Cr (approved 12 Jun 2026, closes by FY27).                                                                                            | Will run independently inside Meesho.                                                                                                                                                                                                                                                             | Marketplace lists "brands and distributors"; primarily brand-monetised.                                                                                                                                                                 |
| **Salescode.ai**                                          | eB2B/SFA/DMS SaaS; ONDC NP                                                                  | DigiDukaan Jaipur launch partner (19 Jun 2026).                                                                                                                                                                                           | Active.                                                                                                                                                                                                                                                                                           | Serves brands _and_ distributors; a candidate TSP for us.                                                                                                                                                                               |
| **Bizom** (Mobisy)                                        | SFA/DMS + Retailer App + ONDC Seller App                                                    | Claims 8 lakh retailers on retailer app, 40+ brands. Demoed at Jaipur DigiDukaan launch.                                                                                                                                                  | Active; sells to brands, distributors, retailers.                                                                                                                                                                                                                                                 | Direct competitor as DMS; also a possible TSP.                                                                                                                                                                                          |
| **Brand eB2B apps** (HUL Shikhar, ITC Unnati, Coke Buddy) | Brand-owned retailer ordering; **distributor fulfils**                                      | Shikhar: 1.4M retailers, ~1/3 of HUL sales from neighbourhood retailers; Play 3.8★/41.9K. Unnati: 8 lakh outlets; Play 4.5★/47.8K. Coke Buddy: 10 lakh retailers; deployed per bottler (Diamond Beverages 10K+, Ludhiana Beverages 50K+). | All updated Jul–Aug 2026.                                                                                                                                                                                                                                                                         | "Distributor-inclusive" by design; distributors were bypassed for order-taking but keep delivery/credit. Maharashtra distributors struck against Shikhar in 2022.                                                                       |

Sources: Business Standard (Udaan/ShopKirana; NCLT), Inc42 (IPO tracker; ShopKirana; Jumbotail profile), Bloomberg/Newskart (Udaan $160M), Snackfax/Lapaas (Udaan FY25), ICRA (Hiveloop Capital), Entrackr/Business Standard (ElasticRun FY25; Meesho–Kirana Club), Tribune/ANI (Jumbotail–NEC), PIB/Inc42/ANI/KNN (DigiDukaan), Tracxn (Kirana King), Play Store/App Store scrapes. URLs in §9.

---

## 2. What retailers love and hate (review evidence)

Method: Play Store/App Store review text visible on listing pages (scraped 4 Sept 2026), plus reported journalism. Sample sizes are small for text; star ratings are the population-level signal.

### 2.1 What they value (recurring across Udaan, Qwipo, Shikhar, Coke Buddy, Kirana Club, Jumbotail)

| Theme                                                        | Evidence                                                                                                                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Not having to travel to the wholesale market; order any time | Qwipo review: "previously my self going and buy the stock it takes lot of time… Qwipo resolved this problem". Cornell (May 2026): owners value "24/7 ordering instead of weekly salesman visits". |
| Price transparency / comparing sources                       | Kirana owners "compare prices across 3-4 sources before purchasing" (Pratik Chandak). Qwipo: "price is very good". Kirana Club's growth was built on price/scheme discovery.                      |
| Scheme visibility                                            | DigiDukaan's stated retailer benefit is "better visibility of schemes"; SalesPort/FieldAssist cite scheme display as the #1 nudge for larger baskets.                                             |
| Next-day delivery, high fill rate                            | Fairdeal.Market's stack ranks "procurement reliability — fill rate, on-time delivery, predictable pricing" first. Udaan CY24: 70% growth in daily buyers.                                         |
| Credit                                                       | Historically Udaan's biggest hook; Flipkart Wholesale calls credit the "primary growth lever". Note: Udaan Capital no longer finances on-platform purchases (see §4).                             |
| Sub-case quantities                                          | Jumbotail: 90% of FMCG orders are under one case; small stores (250-500 sq ft) will not buy slow movers by the case.                                                                              |

### 2.2 What they hate

| Complaint                                                         | Where seen                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wrong / expired / damaged goods, returns rejected on technicality | Udaan Play Store: "9/10 times I get different items"; "one complete packet of 24 piece was missing… they said return period is over"; "expired products… won't be returned if not checked within three days" (consumercomplaints.in). Qwipo: "worst quality products and if you ask for return they won't answer your calls".                                                 |
| Order shown delivered / settled but never arrived                 | Qwipo: "they didn't deliver any product and they showing order was delivered… thank god I placed COD". Coke Buddy (Ludhiana Beverages): "status shows ordered settled and product never delivered".                                                                                                                                                                           |
| Settlement and offer disputes                                     | Udaan: "give offers on call for full settlement and then say you are not eligible… after a year they are asking me to pay the remaining amount".                                                                                                                                                                                                                              |
| The distributor behind the brand app does not execute             | Shikhar: "when I order by shikhar app dealer agent said material not available"; "damage material return approx Rs 10,000 — no adjustment". Unnati: "it just stays in ordered status… I get messages that the salesperson will not come so use the app"; "registration pending from 30 days". Coke Buddy: "Orders are not executed as per app. We have to remind personally". |
| Prices not actually wholesale                                     | Qwipo: "it's prices are not wholesale only retail prices looking".                                                                                                                                                                                                                                                                                                            |
| Customer support unreachable, app crashes when raising complaint  | Udaan, JioMart (PissedConsumer), Qwipo.                                                                                                                                                                                                                                                                                                                                       |
| Minimum order / case-lot rules; no udhaar                         | The Ken / Jumbotail commentary; kiranas reject 1.5% payment fees on 5-10% margins.                                                                                                                                                                                                                                                                                            |

**Takeaway for the product:** the star ratings of the _ordering_ apps are fine (4.1-4.5). The 1-star reviews are almost all about the physical back-end: picking accuracy, expiry, returns, delivery confirmation, and the human at the distributor not acting on the order. A distributor-owned OS that guarantees picklist → packing → delivery-state → return-credit-note integrity solves precisely the failures retailers complain about on every other app.

---

## 3. DigiDukaan and the ONDC B2B protocol

### 3.1 What DigiDukaan is

- A DPIIT-led programme using the ONDC network for **kirana B2B procurement**: retailers order stock from brands/distributors through any ONDC-ready app; distributors keep delivering; brands get demand signals. No consumer app; access is via city onboarding partners. Joining is free for retailers (Zobaze guide, PIB).
- Stated benefit for distributors (PIB/Inc42, June 2026): "wider market reach without additional field costs through order and collection digitisation".
- Rollout: Hyderabad launched 8 March 2026 via Qwipo — 10,000+ retailers, 35+ brands; Jaipur 19 June 2026 via Salescode.ai; Mumbai, Bengaluru, Delhi-NCR "in the coming months" (no Mumbai date found as of Sept 2026 — **[unverified]** whether it has launched). Roundtable 12-13 June 2026 chaired by DPIIT Addl Secretary Ateesh Kumar Singh with HUL, ITC, Coca-Cola, TCPL, CavinKare, Marico, Bikano, L'Oréal, Moon Beverages, Anmol, Nestlé, Kirana King; Qwipo and Bizom gave live interoperability demos.
- ONDC context: 616 cities, 7.64 lakh sellers, 21.8 crore transactions in FY26; ₹220 Cr raised May 2026 (Zoho ₹70 Cr, Uber ₹60 Cr, Paytm ₹60 Cr, BSE ₹30 Cr) for "ONDC 2.0" incl. DigiCatalog (national catalogue infrastructure — relevant to our shared product master). The Ken characterises ONDC's first (B2C) act as "stalled" and DigiDukaan/B2B as its second script.

### 3.2 The protocol a distributor seller app must speak

From the ONDC-RET-Specifications repo, branch `release-2.0.2` (B2B Retail, on Beckn core 1.x; 2.0.1 deprecated):

- Domain code for grocery is **`ONDC:RET10`**; city codes like `std:022` (Mumbai) / `std:0251` (Kalyan) **[verify STD mapping for Kalyan]**.
- Flows: `search/on_search` (catalog, incl. serviceability by pincode/city), `select/on_select` (quote), `init/on_init` (order + payment terms), `confirm/on_confirm`, `status/on_status` (incl. **proforma invoice**, picked up, out for delivery, delivered), `update/on_update`, `cancel/on_cancel` with cancellation terms, plus IGM (grievance) and RSF (settlement).
- B2B-specific constructs that map directly onto our domain model:
  - `quantity.minimum` / `maximum` per item → **MOQ and case-lot**; `unitized.measure` → pack size.
  - `payments[].type` = `PRE-FULFILLMENT` / `ON-FULFILLMENT` / `POST-FULFILLMENT` → prepaid / COD / **credit**; `collected_by: BPP` lets the _seller_ (distributor) collect, not the buyer app.
  - `seller_terms.gst_credit_invoice: Y`, `buyer_id_code: gst` → GST invoice to a GST-registered buyer (our retailers are mostly unregistered; the spec allows other id codes).
  - RFQ vs non-RFQ journeys, and the **seller-led journey** (Apr 2024 addendum): buyer app sends one `select` per onboarded buyer with a 6-month TTL so a _known_ seller keeps quoting to a _known_ buyer — i.e. "my regular distributor's live catalogue and my price" rather than anonymous discovery. This is the mode that matches distributor–retailer relationships.
  - `bpp_terms` (max liability, arbitration, court jurisdiction, delay interest) and `@ondc/org/settlement_window`, `withholding_amount`, `buyer_app_finder_fee_*` (example shows 0% for B2B).
- Fulfilment types `Delivery` and `Self-Pickup`; FSSAI licence fields on the provider.

### 3.3 Network participant roles and eligibility (ONDC Network Policy, Chapter 1, v2.1 Dec 2024)

| Role                                                                | Who                                                                                            | Eligibility                                                                                                        |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **NP-ISN** — inventory-based seller app (a single seller's own app) | One distributor exposing its own inventory                                                     | Any registered business with active PAN + TAN + GST                                                                |
| **NP-MSN** — marketplace seller app (many sellers on one app)       | **Our multi-tenant OS** (each distributor = a `provider`)                                      | Must be an incorporated _company_ with PAN + TAN                                                                   |
| NP-BN — buyer app                                                   | Retailer-side app (Qwipo, Bizom retailer app, etc.)                                            | Company                                                                                                            |
| TSP — technology service provider                                   | Bizom, Salescode, Pirimid, Mystore, eSamudaay, SellerApp, GoFrugal, CostBo, Rapidor, SignCatch | Applicants onboarding via an ONDC-certified TSP may be **exempted from technical certification** (Cl. 1.3.4(v)(a)) |

Note: a single entity may hold both seller and buyer roles with separate key pairs (useful later: our retailer app as a BN so a retailer could also reach _other_ distributors on the network — consistent with the "discover distributors" feature already decided).

### 3.4 Onboarding steps, technical requirements, fees, timeline

**Process (policy + developer-docs):**

1. Sign up on portal.ondc.org; submit Expression of Interest (legal name per GSTN, PAN, TAN, GST, address). Complete profile; raise "environment access request" — whitelisting takes **6-48 hours**.
2. Role selection (MSN/ISN/BN), domain (`ONDC:RET10`), subscriber_id = your FQDN (e.g. `ondc.yourdomain.in`), separate key pairs per role.
3. Technical: valid SSL cert (OCSP-checked); **Ed25519** signing key pair; **X25519** encryption key pair (libsodium; DER-encoded public key); host `https://<subscriber_id>/ondc-site-verification.html` containing the signed request_id; implement `/on_subscribe` that AES-decrypts ONDC's challenge using the shared secret; call `/subscribe` on the registry (`preprod.registry.ondc.org` → `prod.registry.ondc.org`; **staging is decommissioned**). Every message signed (Authorization header with `keyId="<subscriber_id>|<ukId>|ed25519"`, BLAKE2b digest).
4. Pre-production: run end-to-end flows against ONDC reference buyer app; submit logs to the **log-validation-utility**; demo; then certification, policy/operational compliance certification, e-sign of the Network Participant Agreement, registration fee "if any" (currently none published).
5. Mandatory integrations: **RSF** (Reconciliation & Settlement Framework; nodal/settlement account) and **IGM** (grievance). Bizom/Codingclave list GST-compliant invoice generation, order state machine, returns, audit logs as production requirements.
6. Rate limits: `/subscribe` 10 rpm, `/lookup` 7,600 rpm.

**Network cost:** ₹1.5 (plus taxes) per successful transaction above ₹250 since 1 Jan 2025, charged to network participants (buyer and seller side; exact split per side **[unverified]**). No listing fee. Buyer-app finder fee is negotiated in-protocol (B2B examples show 0%). SNPs/TSPs that host you charge their own 1-3% or subscription (Codingclave; vendor pages disclose no B2B pricing).

**Build vs buy (Codingclave 2026 estimates — vendor figures, treat as order-of-magnitude):**

| Route                                                                                           | Timeline                                     | Cost                                                                                                                                                |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Onboard each distributor as a seller on an existing SNP/TSP (Bizom, Salescode, Qwipo, Mystore…) | 1-4 weeks                                    | ₹0-50,000 setup + 1-3% per transaction                                                                                                              |
| Build our own NP-MSN seller app on the OS                                                       | 3-5 months MVP; 6-12 months production-grade | ₹5-25 lakh build (~22-34 engineer-weeks: protocol layer 4-6 wks, catalog 2-3, order mgmt 3-4, fulfilment 2-3, admin 3-4) + ₹45k-1.65 lakh/month ops |

For a solo founder whose OS _already_ has catalog, pricing, order state machines and invoices, the incremental work is the protocol adapter (signing, registry, async callbacks with dedupe/out-of-order handling), RSF, IGM and certification — realistically 6-10 weeks of focused work after the core OS exists, not a separate product.

### 3.5 Recommended integration architecture for the Distribution OS

- **Phase A (pilot, Thane/Kalyan):** do _not_ build. When DigiDukaan reaches Mumbai MMR, onboard Tarsun as a seller through the city partner's seller app (likely Qwipo/Salescode/Bizom). Build a thin **"external order intake"** adapter in the OS (webhook/CSV/API from the partner) so those orders flow into the same Sales Order aggregate and picklist. Cost ≈ zero; learn real order shapes.
- **Phase B (≥20 distributors live):** register the OS as **NP-MSN** in `ONDC:RET10` B2B; each tenant distributor is a `provider` with its own `locations`, serviceable pincodes, catalogue (from the shared product master — aligns with ONDC DigiCatalog direction), price list tier for network buyers, MOQ from case size, `POST-FULFILLMENT` payment only for retailers already on credit in that tenant, `ON-FULFILLMENT` (COD/UPI) for new ones — exactly the "new relationships start cash/prepaid" rule already decided. Implement `on_status` transitions from the existing delivery state machine, `on_cancel` from return/credit-note flow, proforma invoice from the derived invoice artefact.
- **Phase C (optional):** register the retailer app as NP-BN so a shop can discover _other_ ONDC distributors — only if founder wants the "distributor directory" to extend beyond tenants.

---

## 4. Threat assessment: will marketplaces bypass local distributors?

### 4.1 Evidence that bypass happens

- Brands **do** appoint platforms as direct distributors (JioMart Partner, Udaan in some categories) — Kotak Insights, Apr 2026: FMCG companies "now appoint platforms as direct distributors, circumventing traditional three-tier chains".
- Brand-owned eB2B apps already took the _order-booking_ function away from distributor salesmen for a large share of volume (Shikhar ≈ 1/3 of HUL neighbourhood-retail sales; Unnati 8 lakh outlets; Coke Buddy 10 lakh retailers). This is exactly what Tarsun sees with Too Yumm's mandated DMS.
- Cornell (May 2026): 42% of FMCG executives report friction with channel partners; 49% cite channel conflict; ~2 lakh kiranas shut in the year to Oct 2024 (Kotak/AICPDF), general trade Diwali sales down 25-30% in 2024.
- Meesho (Kirana Club, 4.1M retailers) and Udaan (ShopKirana) are consolidating retailer access; quick commerce reaches only 5-6% of homes but 7% of a $45B addressable market and is squeezing distributor margins indirectly.

### 4.2 Evidence that the bypass is bounded

- **Law:** CCI, _Hiveloop (Udaan) v Britannia_ (16 June 2022) — brands may choose distributors and the mode of distribution; marketplaces have no right to direct supply. Udaan then sources such brands _via authorised distributors_.
- **Economics:** every pure-bypass player shrank or restructured: Udaan −20% revenue FY25 after exiting categories, Jumbotail −21%, ElasticRun −49% in FY24 then +9%. None is profitable after 8-10 years and >$3B of combined capital. Udaan Capital has stopped financing on-platform purchases (ICRA, Dec 2025), removing the platform's strongest hook (credit) from its own balance sheet.
- **Physical reality of the kirana:** 250-500 sq ft, 5-10% margin, buys below case lots, needs 30-60 days credit, returns near-expiry stock, orders 2-3 times a week. Distributors carry all of this today (Kotak; Pratik Chandak; Fairdeal.Market's 5-layer stack).
- **Policy:** DigiDukaan — the government's own kirana programme — is designed _around_ distributors continuing to deliver and collect. Qwipo lists distributors and wholesalers as suppliers; Kirana Club's marketplace lists "brands and distributors".
- **Retailer behaviour:** reviews across every app converge on "the app ordered, nobody delivered / wrong stock / no return credit". The relationship that survives is with whoever reliably fixes those.

### 4.3 What makes the local distributor durable (and what erodes it)

| Durable if the distributor…                                                   | Eroded when…                                                                 |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Extends and _tracks_ credit cleanly (today: a physical file of pending bills) | Retailer credit moves to fintech/BNPL on a platform                          |
| Delivers sub-case, same/next day, multiple trips                              | Platform offers next-day at sub-case with equal fill rate                    |
| Takes back damages/near-expiry and issues credit notes fast                   | Brand DMS or platform handles claims directly with retailer                  |
| Gives the retailer scheme visibility and honest pricing                       | Retailer sees better schemes on Shikhar/Unnati/Qwipo than from the salesman  |
| Owns the beat relationship and demand data                                    | Brand app owns the order and the data; distributor becomes a delivery vendor |
| Keeps cost-to-serve below the 3.5-5% margin                                   | Order-booking + collection labour (₹57/₹100 per AICPDF) exceeds margin       |

**Net assessment for a Kalyan-type distributor (2026-2029):** low risk of losing _delivery and credit_ to marketplaces; **high risk of losing order-capture and data** to brand apps and ONDC buyer apps, which then commoditise the distributor. The OS's job is to make the distributor the _system of record_ for the retailer relationship (credit, returns, schemes, delivery proof) so that whichever channel captures the order, the distributor's OS fulfils and settles it.

---

## 5. Distributor-owned / white-label retailer apps: evidence and adoption

### 5.1 What exists

| App                                      | Owner / builder                                                                                                                                   | Scale                                                                                       | Adoption signal                                                                                                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HUL **Shikhar**                          | Brand; distributor fulfils                                                                                                                        | 1.4M retailers; ~1/3 of HUL sales from neighbourhood retailers (HUL 2025; Cornell May 2026) | Play 3.8★ / 41.9K reviews. Complaints centre on distributor non-execution and damage returns. Maharashtra distributors struck in 2022 over bypass.                                                      |
| ITC **Unnati**                           | Brand; built by Applicate                                                                                                                         | 8 lakh+ outlets (ITC annual report)                                                         | Play 4.5★ / 47.8K. Complaints: registration pending 30 days; orders stuck in "ordered"; "salesperson will not come, use the app".                                                                       |
| **Coke Buddy**                           | Coca-Cola India; **white-labelled per bottler** by Applicate (e.g. "Coke Buddy – Diamond Beverages" 10K+, "Coke Buddy – Ludhiana Beverages" 50K+) | 10 lakh retailers, monthly repeat orders (Nov 2025)                                         | Play 4.3★ both instances. Complaints: "status shows settled, product never delivered"; "we have to remind personally". Direct evidence that per-entity white-label retailer apps are a working pattern. |
| **Bizom Retailer App**                   | SaaS; brands pay                                                                                                                                  | 8 lakh retailers, 40+ brands                                                                | Claims "76% drop in returns, 55% sales growth" (vendor). Markets "distributor-free ordering" — i.e. optimised for brands, not distributors.                                                             |
| **SalesPort** (Sortstring)               | SaaS retailer ordering app                                                                                                                        | 2.3 lakh app users, 45 companies, ₹8,572 Cr GMV (vendor)                                    | Drivers listed: scheme visibility, one-tap reorder, audit trail vs lost WhatsApp messages.                                                                                                              |
| **Marg eOrder / iamretailer / Biizline** | Billing-software vendors' retailer ordering add-ons                                                                                               | iamretailer Distributor App: 100+ installs, 3.3★ (Sept 2026)                                | Tiny adoption — evidence that bolt-on retailer apps from billing vendors do not get used.                                                                                                               |
| **Kirana King** (Jaipur)                 | Aggregator RaaS                                                                                                                                   | 200+ stores (2021); FY25 ₹383 Cr                                                            | Works as buying group, not a per-distributor app.                                                                                                                                                       |

### 5.2 What we could **not** find

No published case study or adoption number for an _independent small distributor's_ own white-label retailer app (searched Bizom, FieldAssist, Salescode, SalesPort, PepUpSales, Marg, Biizline, news). FieldAssist's own blog concedes retailer-app adoption "often plateaus below expectations" without quantifying. Treat the retailer app for Tarsun as a **hypothesis to be measured**, not a proven pattern. **[gap]**

### 5.3 Adoption lessons that transfer

1. Adoption follows _fulfilment reliability_, not UI. Every 1-star review on brand apps is a distributor failing to pick/deliver/credit. The distributor OS controls all three, so its retailer app can be the first one that "just works".
2. Retailers keep using apps that show **schemes and price** honestly and allow **one-tap reorder** (Shikhar Smart Basket; Coke Buddy AI suggestions; SalesPort).
3. Registration friction kills it (Unnati "pending 30 days"). Onboard the retailer in-beat from the salesperson app; no self-KYC.
4. Retailers ask for **bill payment and split/installment payments** inside the app (Shikhar review). Outstanding view + UPI QR on invoice (already decided) satisfies this without lending.
5. WhatsApp remains the fallback channel (Coke Buddy accepts WhatsApp orders; kiranas order via WhatsApp per Chandak) — consistent with the WhatsApp-first decision.
6. Brand-mandated DMS (Too Yumm case) will not go away; the OS must _ingest_ those secondary invoices (Document Intelligence already covers this) so the retailer's outstanding is complete regardless of which system billed.

---

## 6. Recommendations for the Distribution OS (concrete)

1. **Do not build an ONDC seller app in the pilot.** Add an "external channel order" entity with `source ∈ {salesperson, retailer_app, delivery_onspot, whatsapp, brand_dms, ondc_partner}` on the Sales Order aggregate now, so orders from Qwipo/Salescode/Bizom or a brand DMS can be imported later without schema change. (Extends, does not contradict, the "Sales Order is the primary aggregate" decision.)
2. **Design the product master, prices and order model to be ONDC-B2B-shaped from day one** (cheap, high option value): per-item `min_qty`/`case_size`/`unitized measure`, per-provider `serviceable pincodes`, payment term enum `PRE|ON|POST_FULFILLMENT`, order status vocabulary that maps to `on_status` states, cancellation/return terms per item, FSSAI and GST identifiers on tenant. Keep a mapping table to `ONDC:RET10` category codes (e.g. `RET10-1042`) in the shared product master.
3. **Plan Phase B (NP-MSN) at ≥20 tenants**: the OS company (must be a Pvt Ltd with TAN) registers once; every distributor becomes a provider. Budget ~8-10 engineer-weeks + certification; run costs ₹1.5/txn network fee. This is a differentiator no small-distributor billing tool offers.
4. **Make "retailer trust" features first-class because that is where every competitor fails**: delivery proof with photo + retailer OTP/UPI confirmation; return/damage capture at doorstep with instant credit-note; outstanding ledger visible to the retailer; scheme transparency on every line. These directly answer the top complaints in §2.2.
5. **Position against bypass by owning the retailer ledger**: even when the order comes from Shikhar/Unnati/DigiDukaan, the distributor's OS should be where the invoice, credit, return and settlement live. Import brand-DMS invoices (Too Yumm) via Document Intelligence so the retailer's outstanding is unified.
6. **Measure retailer-app adoption from week 1** (share of orders self-placed vs salesperson-captured; reorder rate; time-to-first-order after in-beat onboarding). No public benchmark exists; the founder's pilot will produce one.
7. **Watch list (next 6 months):** DigiDukaan Mumbai launch date and its seller-app partner; ONDC B2B spec 2.0.3+/catalog caching addendum; ONDC's DigiCatalog (could replace our shared product master's image/attribute layer); Udaan DRHP disclosures (first public look at eB2B kirana unit economics); AICPDF August 2026 protest outcome (margin revisions change distributors' willingness to pay for software).

**Flagged recommended change to existing decisions:** none contradict CONTEXT.md. One _addition_: the retailer identity being separate from any one distributor (already decided) is what makes a future NP-BN registration possible; keep retailer identity keyed on phone + optional GSTIN, since ONDC B2B uses `buyer_id_code: gst` but our retailers are mostly unregistered.

---

## 7. Open questions / unverified

- Exact per-side split of the ₹1.5 ONDC network fee between buyer and seller NPs in B2B; whether DigiDukaan transactions are fee-waived. **[unverified]**
- Whether Qwipo/Salescode charge distributors a commission or subscription under DigiDukaan; no pricing published. **[unverified]**
- Whether DigiDukaan Mumbai has launched (planned "coming months" after June 2026); which SNP will run it. **[unverified]**
- Kirana King FY25 revenue ₹383 Cr is a Tracxn figure; not cross-checked. **[unverified]**
- JioMart Partner's current discount depth and kirana adoption (The Ken piece paywalled; 2021 claims of 20-25% may be stale). **[unverified]**
- Udaan may still offer retailer credit through third-party lenders after its captive NBFC exited on-platform lending; not confirmed. **[unverified]**
- Adoption rate of any independent distributor's white-label retailer app: no public data found. **[gap]**

---

## 8. Sources

DigiDukaan / ONDC

- PIB: https://www.pib.gov.in/PressReleasePage.aspx?PRID=2272311&reg=3&lang=2
- Inc42, How ONDC plans to digitise B2B procurement through DigiDukaan: https://inc42.com/buzz/how-ondc-plans-to-digitise-b2b-procurement-for-kirana-stores-through-digidukaan/
- ANI (12 Jun 2026): https://aninews.in/news/business/india-prepares-for-digidukaan-expansion-to-digitise-14-crore-kirana-stores20260612205459/
- KNN India roundtable report: https://knnindia.co.in/news/newsdetails/sectors/dpiit-ondc-hold-discussion-on-digitising-indias-kirana-trade
- Multibagg (Jaipur launch, Bizom/Qwipo demos): https://www.multibagg.ai/market-pulse/articles/digidukaan-expansion-jaipur-launch-2026-cmqbuerg401rms60je6w6wod7
- Zobaze DigiDukaan guide: https://zobaze.com/blog/digidukaan
- Inc42, ONDC raises ₹220 Cr: https://inc42.com/buzz/ondc-raises-%E2%82%B9220-cr-from-uber-zoho-paytm/
- The Ken, ONDC's second act (paywalled): https://the-ken.com/story/ondcs-first-act-stalled-its-second-comes-with-rs-220-crore-and-a-new-script/
- ONDC Network Policy Ch.1 (onboarding, certification) PDF: https://ondc-static-website-media.s3.ap-south-1.amazonaws.com/ondc-website-media/downloads/governance-and-policies/CHAPTER-%5B1-Onboarding-Complianc-Requirements-and-Certification-Requirements.pdf
- ONDC developer docs, Onboarding of Participants: https://github.com/ONDC-Official/developer-docs/blob/main/registry/Onboarding%20of%20Participants.md
- ONDC-RET-Specifications release-2.0.2 (B2B): https://github.com/ONDC-Official/ONDC-RET-Specifications (README, `api/components/Examples/B2B/*`)
- ONDC log validation utility: https://github.com/ONDC-Official/log-validation-utility
- ONDC fee from Jan 2025: https://sellersetu.in/blog/ondc-to-charge-fees ; https://treelife.in/reports/open-network-for-digital-commerce-ondc/
- Codingclave ONDC integration guide 2026 (cost/timeline estimates): https://codingclave.com/blog/ondc-integration-guide-india-2026
- CostBo ONDC seller providers 2026: https://www.costbo.com/post/best-ondc-seller-provider-in-2026-features-pros-cons
- Bizom ONDC seller registration / challenges: https://bizom.com/ondc-seller-registration/ ; https://bizom.com/blog/top-challenges-of-joining-ondc/
- Protean RSF 2.0: https://www.proteantech.in/articles/protean-RSF-02-04-2025/
- Qwipo DigiDukaan (Play/App Store): https://play.google.com/store/apps/details?id=com.qwipo.b2b ; https://apps.apple.com/in/app/qwipo/id1444169919

Marketplaces

- Business Standard, Udaan acquires ShopKirana: https://www.business-standard.com/industry/news/udaan-acquires-shopkirana-ahead-of-ipo-125071800825_1.html
- Inc42, Udaan buys ShopKirana: https://inc42.com/buzz/udaan-buys-shopkirana-to-boost-profitability-fmcg-play/
- Inc42 IPO tracker 2026 (Udaan DRHP "yet to file"): https://inc42.com/features/indian-startup-ipo-tracker-2026/
- Bloomberg, Udaan $160M pre-IPO (14 Jul 2026): https://www.bloomberg.com/news/articles/2026-07-14/india-s-udaan-secures-160-million-to-boost-finances-before-ipo
- Business Standard, NCLT clears Udaan restructuring: https://www.business-standard.com/industry/news/udaan-set-for-ipo-as-nclt-clears-demerger-plan-for-corporate-restructuring-125011401049_1.html
- Udaan FY25 results: https://voice.lapaas.com/udaan-fy25-financial-results-loss-reduction-ipo-roadmap/ ; https://snackfax.com/business/udaan-cuts-losses-sharply-in-fy25-as-revenue-slides-after-strategic-pullback/
- ICRA, Hiveloop Capital rating (Dec 2025): https://www.icra.in/Rating/ShowRationalReportFilePdfViewer/139654
- CCI Udaan v Britannia (Mondaq): https://www.mondaq.com/india/antitrust-eu-competition-/1213500/
- Udaan Play Store: https://play.google.com/store/apps/details?id=com.udaan.android
- Udaan complaints: https://www.consumercomplaints.in/bycompany/udaan-a513872.html
- Inc42 Jumbotail profile (FY25 ₹725.1 Cr): https://inc42.com/company/jumbotail/
- Jumbotail–NEC (Mar 2026): https://www.tribuneindia.com/news/business/jumbotail-and-nec-announce-strategic-collaboration-to-transform-indias-mass-market-kirana-retail-ecosystem/
- ElasticRun FY25: https://entrackr.com/fintrackr/kirana-commerce-unicorn-elasticrun-narrows-losses-by-60-in-fy25-10904407 ; https://www.business-standard.com/companies/news/elasticrun-fy25-loss-narrows-revenue-grows-private-labels-logistics-125112000736_1.html
- JioMart Partner: https://www.business-standard.com/podcast/current-affairs/why-is-jiomart-s-b2b-model-bad-news-for-wholesale-distributors-121121300057_1.html ; https://the-ken.com/tradetricks/jiomart-ups-its-b2b-service-but-kiranas-arent-quite-convinced/ ; https://www.medianama.com/2021/12/223-jiomart-kirana-distributors-challenges/
- Flipkart Wholesale: https://m.dailyhunt.in/news/india/english/yourstory-epaper-yourstory/credit+is+now+a+primary+growth+lever+flipkart+wholesale+on+the+future+of+b2b+commerce-newsid-n706652828
- Meesho–Kirana Club: https://entrackr.com/news/meesho-to-acquire-kirana-club-in-rs-202-cr-deal-12031243 ; https://kirana.club/marketplace
- Kirana King: https://tracxn.com/d/companies/kirana-king/__XduLSL7IL8UFyWA4IwmQkVXKn1mv7cRQfpk9VVooSCg ; https://inc42.com/startups/can-jaipur-based-kirana-king-become-the-oyo-for-kirana-stores-in-india/
- Inc42, The battle for India's kirana stores (23 Jun 2026): https://inc42.com/features/the-battle-for-indias-kirana-stores-has-begun/

Distributor economics / durability

- Kotak Insights (27 Apr 2026): https://kotakinsights.substack.com/p/fmcg-distributor-disruption-quick-commerce
- Business Today, AICPDF warning (8 Jun 2026): https://www.businesstoday.in/india/story/give-us-margin-support-or-risk-rural-stockouts-distributors-warn-indias-fmcg-giants-535639-2026-06-08
- Outlook Business, AICPDF protest deadline (9 Jun 2026): https://www.outlookbusiness.com/news/fmcg-distributors-association-warns-of-protests-over-margins
- Pratik Chandak, Why kirana tech is hard (2022): https://pratikchandak.substack.com/p/why-kirana-tech-is-so-difficult-to
- Cornell, India's digital pull revolution (13 May 2026): https://business.cornell.edu/article/2026/05/indias-digital-pull-revolution/
- Biizline FMCG distribution trends 2026: https://biizline.com/fmcg-distribution-trends-india-2026/

Retailer apps / white-label

- HUL Shikhar: https://www.hul.co.in/news/news-search/2025/the-future-is-phygital-how-shikhar-is-redefining-retail-for-indias-kirana-stores/ ; https://play.google.com/store/apps/details?id=com.hul.sambhav
- ITC Unnati: https://play.google.com/store/apps/details?id=com.applicate.ITCloyalty.app ; ITC Q4 FY26 release: https://itcportal.com/content/dam/itc-corporate/pdfs/financial-result/quarterly-results-2025-2026/march-2026/ITC-Press-Release-Q4-FY2026.pdf
- Coke Buddy: https://www.tribuneindia.com/news/business/coke-buddy-turns-indias-corner-stores-into-smart-retail-hubs ; https://play.google.com/store/apps/details?id=com.applicate.dbpl.app ; https://play.google.com/store/apps/details?id=com.applicate.lbpl.app
- Bizom retailer app: https://bizom.com/retailer-app/
- SalesPort retailer ordering: https://sortstring.com/use-cases/retailer-ordering-app
- FieldAssist retailer ordering apps: https://www.fieldassist.com/blog/the-ultimate-guide-to-retailer-ordering-apps-for-fmcg-brands ; https://www.fieldassist.com/blog/digital-vs-traditional-ordering-in-fmcg
- iamretailer Distributor App: https://play.google.com/store/apps/details?id=com.iamretailer.distributor
