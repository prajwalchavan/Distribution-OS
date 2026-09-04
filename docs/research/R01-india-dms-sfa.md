# R01 — Teardown of Indian DMS/SFA products for FMCG distributors

Date: 2026-09-04. Author: research subagent. Scope: Bizom, FieldAssist, Botree, BeatRoute, Salescode, Ivy Mobility, Distributo, SalesTrendz, PepUpSales, SpireStock, plus SalesPort, EazyDMS/Recibo, Heera, and two brand-owned systems (HUL Shikhar, HCCB Coke Buddy) that distributors are forced to live with.

## 0. Method and evidence quality

- Vendor sites, pricing pages and product pages were read directly (browser) where the site was JS-rendered.
- Real user complaints were pulled from Google Play (via browser, "most relevant" sort), SoftwareSuggest, Capterra (India + US), Techjockey, SoftwareFinder. **G2, Gartner Peer Insights, Reddit and LinkedIn were blocked (403 / policy) and could not be read**; the "Reddit" claims in vendor blogs are not reproduced here.
- The web-search budget ran out mid-task; the second half of the work used direct fetches and the browser only. Anything I could not open is marked **unverified**.
- SpireStock, SalesTrendz and SalesPort (sortstring.com) publish "comparison" blogs that rank competitors. Their numbers about _other_ vendors are treated as **competitor claims**, not facts.

## 1. The most important structural finding

There are two different markets hiding under the word "DMS", and they have different buyers:

|                 | Brand-side DMS/SFA ("company DMS")                                                 | Distributor-side software                                                                   |
| --------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Who pays        | The manufacturer (Bizom, FieldAssist, Botree, BeatRoute, Salescode, Ivy, EazyDMS)  | The distributor (Distributo, SpireStock, SalesTrendz small-tier, Marg/Busy/Tally — see R02) |
| Who is the user | Brand's salesman + the distributor's billing operator, who is **forced** to use it | Distributor owner/operator/salesman                                                         |
| Scope           | One brand's SKUs, schemes, claims, secondary data upload                           | All brands the distributor carries, purchases, GST, ledger                                  |
| Pricing unit    | Per field user per month, or per "distributor node"                                | Per user, per route, or flat per firm                                                       |

Every enterprise vendor openly admits the consequence: multi-brand distributors refuse to run one DMS per brand. Bizom's own blog says multi-brand distributors are "20% of the group" and "cannot afford to use multiple systems" ([bizom.com](https://bizom.com/blog/online-mobile-first-dms-might-best-bet-indian-fmcg-companies/)). BeatRoute's guide: "Distributors resist multiple systems. One DMS per brand is not practical" and they "prefer existing tools like Tally or Busy" ([beatroute.io](https://beatroute.io/channel-engagement/distributor-management-system-guide-for-fmcg-companies/)). Salescode's DMS page lists the standard-DMS failure modes as: "Operator dependency makes DMS unviable for small distributors" and "Doesn't talk to accounting systems. Duplicate work between DMS and books" ([salescode.ai](https://salescode.ai/products/distributor-management-system)).

The brand-side vendors' answer to this is **not** to give the distributor a better multi-brand tool; it is to _extract data out of the distributor's Tally/Busy_ (Botree FlexiDMS, BeatRoute Tally/Busy plugins, Salescode native Tally/Zoho Books, FieldAssist FAIS) so the brand gets secondary data without the distributor changing behaviour. The only enterprise product that is explicitly a multi-company DMS for the distributor is **Botree MyDMS**, and it is sold to the brand (launched with Nestlé as a "Re-distributor Management Solution" for rural sub-stockists) ([botree.ai/mydms](https://www.botree.ai/dms/botree-mydms)). Heera Software sells a "multi-company billing DMS for sub-stockists" for the same reason ([heerasoftware.com](https://heerasoftware.com/why-does-a-multi-company-billing-dms-make-sense-for-a-sub-stockist-in-india/)).

This gap — a distributor-owned, multi-brand system that still satisfies each brand's DMS mandate — is exactly where Distribution OS sits. The rest of the report supports that.

## 2. Product-by-product teardown

### 2.1 Bizom (Mobisy Technologies, Bengaluru)

- **Target:** large/mid CPG brands (ITC, Marico, Godrej are cited by third parties); "750+ brands, 250k+ salesforce, 300k+ channel partners, 8M+ retailers" ([SoftwareSuggest](https://www.softwaresuggest.com/bizom)). DMS page claims "2.5L online DMS users, 8M outlets, $500M orders/month" ([bizom.com DMS](https://bizom.com/distributor-management-system/)).
- **Core DMS features (vendor page):** primary order & billing, GRNs, distributor ledgers, bill-to-retailer with customised invoicing; claims settlement ("submit claims to brands on price change, product return, damages, promotion"); schemes at distributor and warehouse level; partial deliveries and returns; collections & banking; retailer self-ordering/counter sales.
- **Standout:** retail-intelligence/image-recognition and analytics depth; "Bizom Next" app generation; gamification. Third parties call it the enterprise reference brand.
- **Pricing:** not published. Third-party listings: **$60/user/month Starter (1-250 users), $54 Pro (250-1000), $48 Enterprise (1000+)** ([SoftwareFinder](https://softwarefinder.com/field-service/bizom)). Competitor blogs guess Rs 20k-50k/month for mid-size firms (SpireStock, unverified). Techjockey/SoftwareSuggest: quote only, no trial, "APIs: not supported" per TechnologyCounter listing (treat as listing metadata, not fact).
- **Onboarding:** third parties say 3-6 months for enterprise rollouts (SpireStock; competitor claim). No vendor figure found.
- **Offline:** vendor blog claims "robust offline capabilities" for the mobile DMS; field reviews contradict this in practice (see complaints).
- **Integrations:** SAP/Oracle/Dynamics/Tally connectors claimed by third parties; SalesTrendz rates Bizom's Tally/ERP integration as "Partial" (competitor claim).
- **Real complaints (Google Play, Bizom app 4.6 stars / 29.4K reviews / 5L+ installs; Bizom Next 4.4 / 1.39K / 1L+):**
  - "you have to sync data after every outlet" and phone heats/hangs (Aug 2022, 104 helpful votes).
  - Battery drain from background sync, "Tracking & syncing at midnight… Looks like a spy" (Aug 2020).
  - Geo-fence mismatch: "I am in location of store but application showing too far" (Jun 2026).
  - Bizom Next (Jul 2026): "slow, unstable… reported multiple issues, but there has been no proper response"; (Aug 2026) "processes the data hours after attendance is marked, resulting in a very low travel allowance"; "daily sync take too much time".
  - Gartner reviewers (via search summary, page itself blocked): "works very slow whenever it communicates with backend server, especially at end of day (EOD)"; support "forced users to give good ratings even if the issue was not resolved".
  - SoftwareSuggest (4.7/5, 9 reviews): "mobile app… UI is not up to industry standards"; install failure on Oppo A37f.
  - Sources: [Play Store Bizom](https://play.google.com/store/apps/details?id=in.bizom.android), [Play Store Bizom Next](https://play.google.com/store/apps/details?id=co.bizom.apps), [SoftwareSuggest reviews](https://www.softwaresuggest.com/bizom/reviews).

### 2.2 FieldAssist (Flick2Know Technologies, Gurgaon)

- **Target:** CPG brands with 50+ reps; "600+ CPG customers", "75 lakh retail outlets daily", 10+ countries. Named customers on its Microsoft Marketplace listing include **Too Yumm!**, Haldiram's, Bisleri, Adani Wilmar, Emami, Jockey, Mamaearth, Danone ([Microsoft Marketplace listing](https://marketplace.microsoft.com/en-us/product/saas/fieldassist-5050577.sol-3235-mwk?tab=overview)). Retailer-app page adds Coca-Cola, Unilever, Parle, Mars ([fieldassist.com/retailer-app](https://www.fieldassist.com/retailer-app)).
- **Core DMS features:** GST invoices with batch/expiry, e-invoice + e-way bill generated together, "online and offline", load sheets, QR/barcode dispatch, expiry/damage alerts, auto-replenishment, "click-to-claim" with ERP sync, retailer eB2B app, van sales, delivery app (separate Play Store app), loyalty. Operating stats from the listing: "Rs 20 Cr+ claims settled monthly, 10 lakh invoices processed daily, 18,000 e-invoices/e-way bills daily, 1100 distributor nodes deployed in under two months, 200 invoices in under 5 minutes".
- **Integrations:** FAIS iPaaS with SAP, Oracle, Tally, Microsoft Dynamics, HRMS/BI; "at day-end, invoices are pushed back to the ERP" (the brand's ERP) with e-invoice acknowledgments kept for audit ([DMS guide](https://www.fieldassist.com/blog/distribution-management-system-dms-guide-2025), [integration platform](https://www.fieldassist.com/integration-platform)). No public API docs found.
- **Pricing:** page lists Starter / Business / Enterprise AI tiers with "Request pricing" only ([fieldassist.com/pricing](https://www.fieldassist.com/pricing)). Reviewers: "a little pricey for small businesses". Competitor blogs guess Rs 8k entry, Rs 10-30k/month mid (unverified).
- **Onboarding:** third parties: 4-8 weeks (SalesPort/SpireStock claims). Vendor's own "1100 distributor nodes in under two months" is the only first-party number.
- **Real complaints (Google Play "General Trade by FieldAssist" 4.1 / 3.01K / 1L+; "DMS" app 4.0 / 59 / 10K+):**
  - "extremely slow, hangs all the time, and frequently crashes during important work" (May 2026, 169 helpful).
  - "Lag, Lag, Lag… In middle of putting order app just stop working. Some time it doesn't capture GPS" (Apr 2025, 80 helpful).
  - "standing in front of the shop and this application… saying I'm 7 km away" (May 2024).
  - "Your executives calling for change the review without any changes in app" (Dec 2023, 108 helpful).
  - "app continues to close on background and I have to wait extra 5 minutes" because the company mandates 5 min per shop (Sep 2025).
  - "every day app want to open setting and permission" (Dec 2025).
  - DMS app: "after the update app is working too slow" (Mar 2025); "too much bug".
  - SoftwareSuggest (4.8/5, 16 reviews): "app consumes a lot of battery"; "if any issue is shared with the technical team, it takes time to get resolved"; wants "more Excel-based reporting".
  - Capterra (4.3/5, 3 reviews): "not enterprise ready… Limited features" (2022).
  - Sources: [Play Store GT](https://play.google.com/store/apps/details?id=com.flick2know.gt), [Play Store DMS](https://play.google.com/store/apps/details?id=com.flick2know.fieldassist.dms), [SoftwareSuggest](https://www.softwaresuggest.com/fieldassist/reviews), [Capterra](https://www.capterra.com/p/157892/FieldAssist/).

### 2.3 Botree Software (Chennai, since 1997)

- **Target:** the largest legacy conglomerates: "6 of top 10 CPG companies", 100K+ distributors, Nestlé, Dabur, Jyothy Labs (2000+ distributors), Amul, HMD, Cipla Health ([botree.ai DMS](https://www.botree.ai/dms/botree-dms), [FlexiDMS](https://www.botree.ai/dms/botree-flexi-dms)).
- **Product family (this matters for the distributor's experience):**
  - **Botree DMS** — the classic desktop/web DMS the brand installs at the distributor: master data, order/return with GST credit notes, scheme & claims, ARS replenishment, inventory, GST/e-invoicing/tax config.
  - **Botree FlexiDMS** — _no DMS at the distributor at all_: remote install + "seamless data extraction from Tally or Busy", AI auto-mapping of the distributor's product names to the brand's SKUs, "zero change management for distributors". Onboarding starts by collecting company GSTIN/PAN and the distributor's accounting software name.
  - **Botree MyDMS** — multi-company DMS for sub-distributors: "convert multi-company orders into a single bill with just a click", Tally/Busy purchase extraction for GST reports, e-invoice, e-way bill in one click, salesman can edit prices/discounts during booking.
  - **Botree Mobile DMS, Retailer App, SFA** (page 429'd; not read).
- **Pricing:** on request everywhere. Techjockey: "price available on request"; competitor blogs guess Rs 30-80k/month (unverified). Effectively brand-paid.
- **Offline:** desktop DMS historically offline-first; SFA is online-heavy (see complaints).
- **Real complaints:** the richest distributor-side signal in this study. SoftwareSuggest shows **91 reviews, almost all "Owner/Proprietor" posted in a two-week window (30 Apr-21 May 2025)** — i.e. solicited from distributors forced onto the DMS. Even in that solicited set, the cons are consistent:
  - "GST Report… need downloading capability" / "GST report, collection report, claim generation, and retail adding" / "GST Report, Ledger Report, Stock Details, Claim Generation, and SFA" — **seven-plus reviewers ask for GST reports and ledger/balance/pending-amount views** (May 2025).
  - "O2b [order-to-bill] process is very slow from DMS"; "sync process takes a long time"; "sync process is very slow".
  - "Scanner missing" (barcode).
  - Capterra India (5.0/5, 6 reviews, mid-2025): "search result comes very late. There is a lot of dependence on network connectivity"; "the DMS is very slow sometimes the sync is not properly done".
  - Google Play "Botree SFA" unified app: **3.1 stars / 35 reviews / 5K+** — "Auto-logout issue during call", "battery drain very soon high data consuming", "login issue", multiple "3rd class app" (Jun-Aug 2026).
  - Techjockey: customer support rated 3.7/5, lowest of its sub-scores.
  - Sources: [SoftwareSuggest reviews](https://www.softwaresuggest.com/botree-dms/reviews), [Capterra India](https://www.capterra.in/software/1027106/botree-dms), [Play Store Botree SFA](https://play.google.com/store/apps/details?id=com.botree.mobilitysfa.botreeunified), [Techjockey](https://www.techjockey.com/detail/botree).

### 2.4 BeatRoute (Gurgaon)

- **Target:** brands with "goal-driven" field teams; 200+ brands, 20+ countries, 6,000+ channel partners; customers Colgate-Palmolive, Perfetti, JSW Paints, Danone ([beatroute.io/ai-info](https://beatroute.io/ai-info/)).
- **Core DMS features:** distributor self-serve or sales-led onboarding, ERP master sync, inventory norms + automated primary order triggers, in-bill secondary schemes, credit limit/receivable rules, Order AI Agent, secondary invoice generation with auto schemes, van stock and cash reconciliation, distributor statement of account, KPIs incl. "claim turnaround" ([beatroute.io DMS](https://beatroute.io/distributor-management-system/)).
- **Standout:** the "distributor doesn't have to change" layer — **Tally and Busy plugins** for multi-brand distributors and WhatsApp/mobile ordering for remote distributors, with full DMS only for single-brand partners ([guide](https://beatroute.io/channel-engagement/distributor-management-system-guide-for-fmcg-companies/)). Capterra lists Tally, SAP HANA Cloud, NetSuite, Power BI, WhatsApp, Zapier, n8n integrations.
- **Pricing:** Starter / Business / Enterprise packs on an India pricing page with no numbers ([pricing-plans-india](https://beatroute.io/pricing-plans-india)); "priced per user and module on annual contracts… no public self-serve tier". Third-party figures: **Rs 700-1,470/user/month** (SalesPort matrix) and Rs 599/699 (search-result snippet, source page not retrievable — unverified). Startup programme for teams under 50 reps.
- **Onboarding:** "first results within the first quarter"; competitor estimate 2-5 weeks.
- **Real complaints (Google Play BeatRoute SFA 4.6 / 3.58K / 1L+):** geo-fence "Retailers can't be accessed even when I'm clearly within the location" after an update (Jul 2025); product search broken after update (Nov 2025); "will not make payment, generate receipt for retailers" after update (Dec 2024); crashes/camera problems; "my old Customer profile image, Name and contact number is automatically deleted… my state is Tamilnadu, but the Beatroute automatically changed to Andhrapradesh" (Dec 2020). Capterra India (4.3/5, 35): "deleting data isn't very straightforward"; "Need the reports in system, support team issue". Sources: [Play Store](https://play.google.com/store/apps/details?id=com.gz.vitalwires), [Capterra India](https://www.capterra.in/software/181686/beatroute).

### 2.5 Salescode.ai (Gurgaon; ex-Coca-Cola/PepsiCo founders)

- **Target:** large CPG ("85+ top CPG brands", 3M+ users, 25+ countries; Saudi, Indonesia, Philippines, Nigeria, Vietnam, Egypt presence).
- **Core DMS features:** AI primary order from predicted secondary, GRN with invoice management, batch/expiry, saleable vs non-saleable stock, market returns, automated reconciliation with audit trail, AI-predicted secondary orders with confirm/edit/partial confirm, bulk GST invoicing with e-invoice and e-way bill, multi-mode collections, outlet and distributor ledger.
- **Standout:** "No dedicated DMS operator required" (AI nudges replace the operator), **native Tally and Zoho Books integration, multi-company operations**, "Live in 3 hours", offline-first rural variant, UPI/WhatsApp connectors, "3% minimum sales uplift, contractually guaranteed" ([salescode.ai DMS](https://salescode.ai/products/distributor-management-system)).
- **Pricing / onboarding:** not published; brand-paid. No independent reviews found (no Play Store listing located; G2 blocked). **Unverified beyond vendor claims.**

### 2.6 Ivy Mobility (Chennai / global)

- **Target:** multi-country CPG ("100+ CPG brands", DSD-heavy). India-born but priced for global enterprises.
- **Core DMS features:** master data, credit limits with alerts, shelf-life and inventory aging, saleable/damaged stock, inter-distributor transfers, picklists and load schedules, SKU swapping when out of stock, trade promotions with payout structures, smart purchase orders, financial reporting ([ivymobility.com DMS](https://ivymobility.com/distribution-management-system/)).
- **Pricing:** none public; third parties say "can exceed Rs 1 lakh/month" and undisclosed implementation/AI add-on fees (competitor and RFP-wiki claims, **unverified**). Gartner/G2/Capterra review pages were blocked. Irrelevant for a distributor buyer; included for completeness.

### 2.7 Distributo (BlueSapling Technologies, Bengaluru)

- **Target:** the distributor directly — super stockists, stockists, wholesalers, agencies; FMCG, F&B, telecom, textiles, electricals.
- **Core features:** order taking with e-catalogue, purchase orders and invoice tracking, GST billing, e-invoice and e-way bill, multi-warehouse inventory with batch/serial/IMEI, salesman GPS tracking, beats, payment collection and outstanding, returns, van sales, **multi-brand and multi-branch**, schemes, SMS notifications, GST return reports, Tally export via XML "for your auditors and CAs" ([distributo.com](https://distributo.com/), [Tally page](https://distributo.com/tally-integration)).
- **Pricing:** not public ("request demo"). One Play Store reviewer: "this year they have doubled the subscription fees for the same features" (Sep 2024).
- **Offline:** not claimed anywhere on the site or listing.
- **Real feedback (Google Play 4.7 / 147 / 5K+; strongly positive on support):** "Stock counts do not update instantly, leading to accidental orders of out-of-stock items" (Jul 2026); "Few features of accounting compare to tally is missing"; "currently not working on both iPhone and tablet" (Apr 2026); "they lack with introduction of new feature. A feature request page is also unavailable" (Mar 2025); "Need better interface to find products by category or brand instantly". Source: [Play Store](https://play.google.com/store/apps/details?id=com.bluesapling.dms.production).
- **Why it matters:** this is the closest existing analogue to Distribution OS's buyer (distributor pays, multi-brand, GST-native) and its weaknesses are exactly stock-freshness, iOS, and feature velocity.

### 2.8 SalesTrendz (Mumbai)

- **Target:** small-to-mid distributors and brands, 5-30 reps, first-time digitisers.
- **Core features:** GPS attendance and live tracking, beat planning, order booking (offline sync claimed), expense submission, product feedback, distributor portal ("DMS") receiving rep orders with stock confirmation, "DMS Connect" bidirectional bridge, "Tally integration for each distributor" ([run-your-distributors page](https://www.salestrendz.com/run-your-distributors-field-reps-on-one-app/)).
- **Pricing:** their own blog says Indian SFA "typically" costs **Rs 200-300/user/month** and that pricing is "transparent per-user", yet no number is published; 21-day free trial ([SalesTrendz vs FA vs Bizom](https://www.salestrendz.com/salestrendz-vs-fieldassist-vs-bizom-which-wins/)). SoftwareSuggest: quote only, zero reviews.
- **Onboarding:** "live within days".
- **Complaints:** none independently found (no reviews on SoftwareSuggest; Play Store not examined). Competitor blog claims "may not scale beyond 50-100 users; business-hours support" (unverified).

### 2.9 PepUpSales (Quy Technology, Noida)

- **Target:** small brands/first-time SFA buyers across industries (automotive, tea, pharma listed among customers); "1,000+ brands, 200K+ users".
- **Core features:** SFA, DMS (distributor stock/pending orders visibility), van sales, retailer app, dealer portal, in-store promoter app, route optimisation, sales/damage returns, discounts and schemes, attendance ([pepupsales.com](https://www.pepupsales.com/)). Claims SOC 2, ISO 27001.
- **Pricing:** "available on request" (Techjockey). One Play Store reviewer paid **"Rs 60,000 (one time + 3 month subscription)"** and "used their app for just 1 day"; "They don't pick up any calls after you subscribe" (Jun 2023). Third-party claims of Rs 100-200/user/month are unverified.
- **Real feedback (Google Play 4.8 / 211 / 10K+):** "touch sensitivity is not working properly" after update (Mar 2026); the refund complaint above. Note: a cluster of near-identical 5-star reviews dated 7-9 Aug 2025 suggests solicited reviews. Techjockey (4.2/5, 11): "Initial setup was a bit confusing", "Could have better analytics". Sources: [Play Store](https://play.google.com/store/apps/details?id=com.quytech.secondarysale), [Techjockey](https://www.techjockey.com/detail/pepupsales-sfa).

### 2.10 SpireStock

- **Target:** distributor-paid; FMCG/dairy; positions on returnable-crate tracking and Hindi/regional support.
- **Pricing (published, the most transparent in the set):** per user/month excl. GST — **Starter Rs 499 (Rs 399 annual; min 3 users, 1 warehouse, 500 outlets), Growth Rs 999 (Rs 799; min 5), Scale Rs 1,799 (Rs 1,499; min 10; multi-brand workspaces, SAP/Oracle, REST API 10k req/day), Enterprise custom.** Add-ons: GST e-invoice module Rs 999/month, WhatsApp API Rs 1,499/month + Rs 1/msg, Tally connector Rs 4,999 one-time, multi-brand workspaces Rs 1,999/brand/month, premium onboarding Rs 24,999 ([spirestock.com/pricing](https://spirestock.com/pricing)).
- **Claimed features:** offline-first order/delivery/payments app, two-way Tally Prime sync, IRN/QR and e-way bill automation, crate tracking with OTP handoffs, 11 Indian languages, Android 8+/2 GB RAM phones, ~5 MB data/day, go-live 3-7 days single depot ([FAQ](https://spirestock.com/faq)).
- **Caveats:** the FAQ says pricing is "based on routes and active retailers, not per-seat" while the pricing page is per-user; trial is "14-day" on the site and "30-day" in its blog. No independent reviews, no Play Store listing found, no named customers. Its blogs are heavy SEO content ranking competitors. **Treat as an early-stage entrant whose claims are unverified**, but its price list is a useful anchor for what a distributor-paid SaaS is being priced at in 2026.

### 2.11 Others found

- **SalesPort (sortstring.com):** brand-side DMS+SFA+milk procurement, **fixed pricing: Rs 1.5 lakh+ one-time deployment plus Rs 15,000/month AMC (<30 field users) or Rs 35,000/month (<100)**, "45 live deployments, 24,000+ distributors", bidirectional Tally/SAP B1/HANA, 4-8 weeks ([sortstring DMS](https://sortstring.com/distributor-management-system)).
- **EazyDMS + Recibo SFA:** brand-side; "45,000+ distributors", Philips Signify, MDH, Henkel, Goodyear; auto claims, regional languages, 15-minute critical-issue SLA claimed ([eazydms.com](https://www.eazydms.com/sfa/)). One FieldAssist Play Store reviewer says "Recibo is much better".
- **Heera Software:** multi-company billing DMS for sub-stockists; single mixed invoice across companies ([heerasoftware.com](https://heerasoftware.com/why-does-a-multi-company-billing-dms-make-sense-for-a-sub-stockist-in-india/)).
- **RebateLedger (ex-ClaimDS):** stand-alone scheme/claim settlement engine issuing GST-compliant credit notes under Section 34 / Rule 53(1A), hash-chained audit trail ([rebateledger.com](https://rebateledger.com/industries/fmcg)) — evidence that claims reconciliation is painful enough to be its own product.
- **FieldMax, Delta Sales App, Unolo, Kladana:** mentioned in comparison blogs; not examined.

## 3. Pricing summary (what a distributor actually faces)

| Product      | Unit                      | Published?      | Figure                                        |
| ------------ | ------------------------- | --------------- | --------------------------------------------- |
| Bizom        | per user/month            | No              | ~$48-60 (third party); brand pays             |
| FieldAssist  | per user / per node       | No              | quote only; "pricey for small business"       |
| Botree       | per distributor node      | No              | quote only; brand pays                        |
| BeatRoute    | per user + module, annual | No (tiers only) | Rs 700-1,470 (third party)                    |
| Salescode    | —                         | No              | brand pays                                    |
| Ivy Mobility | —                         | No              | enterprise; "> Rs 1 lakh/month" (unverified)  |
| SalesPort    | flat                      | Yes             | Rs 1.5L setup + Rs 15k/35k per month          |
| SpireStock   | per user/month            | Yes             | Rs 399-1,799 + add-ons                        |
| Distributo   | per firm/year (inferred)  | No              | reviewer: fees doubled in 2024                |
| SalesTrendz  | per user/month            | No              | "Rs 200-300" market range claimed             |
| PepUpSales   | per user + setup          | No              | one buyer paid Rs 60,000 for setup + 3 months |

Practical reading: for a distributor with 3 salesmen, 1 operator, 2 delivery teams and an owner (~8 seats), distributor-paid tools in India cluster at **Rs 3,000-8,000/month all-in**; anything priced like Bizom/FieldAssist is out of reach and is in any case not sold to distributors.

## 4. Table stakes vs rare features

**Table stakes — every serious player has these (a new entrant is not credible without them):**

1. Salesman order booking against a live catalogue with scheme visibility, beat/route plan, GPS attendance and outlet geo-tag.
2. Secondary invoice generation that is GST-correct (CGST/SGST/IGST, HSN), with batch and free-quantity lines; e-invoice IRN/QR and e-way bill (FieldAssist, Botree, Salescode, SpireStock, Distributo, MyDMS all claim one-click).
3. Scheme engine (slab, free qty, secondary discount, cash discount) applied at billing; claims raised against the brand from within the system (Bizom, FieldAssist, Botree, BeatRoute, Salescode).
4. Stock ledger with saleable/damaged split, expiry, GRN against primary invoice, returns with credit notes.
5. Outstanding/collections with retailer ledger; partial delivery.
6. Tally connector of some form (every vendor claims one; quality varies from XML export (Distributo) to plugin extraction (Botree Flexi, BeatRoute) to two-way sync (SpireStock, SalesPort, Salescode)).
7. Some offline claim for the field app (universal claim, universally complained about).
8. Retailer self-ordering app (Bizom, FieldAssist eB2B, Botree Retailer App, BeatRoute WhatsApp ordering, PepUpSales retailer app; brand-owned Shikhar and Coke Buddy).

**Rare or absent (differentiation space):**

| Feature                                                                    | Who has it                                                                                                                                      | Evidence              |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Multi-company / multi-brand billing in one invoice, for the distributor    | Botree MyDMS (brand-sold), Heera, Distributo (multi-brand), SpireStock (paid add-on Rs 1,999/brand/month)                                       | vendor pages          |
| Distributor operates with **no DMS operator**                              | Salescode only (claim)                                                                                                                          | vendor page           |
| Purchase-invoice scan → stock entry (document intelligence)                | **None found.** Botree reviewers ask for "Scanner missing"; FieldAssist has barcode dispatch scanning only                                      | reviews, vendor pages |
| Delivery app with trip states, cash/UPI collection, GPS of delivery staff  | FieldAssist has a separate Delivery App; Salescode "AI Native Delivery App"; SpireStock claims delivery recording; BeatRoute van reconciliation | listings              |
| iOS parity                                                                 | Distributo reviewer: "not working on both iPhone and tablet"; FieldAssist reviewer: tablet unsupported; most listings Android-first             | Play Store            |
| Role-based price/margin hiding for salesmen                                | not marketed by anyone (MyDMS lets salesmen edit prices, the opposite)                                                                          | vendor pages          |
| Downloadable GST/ledger/claim reports for the distributor from a brand DMS | requested repeatedly in Botree reviews; absent                                                                                                  | SoftwareSuggest       |
| Retailer bill-payment / split-instalment inside the app                    | requested on Shikhar (Jul 2026); HUL added "Ushop"                                                                                              | Play Store            |
| Real-time stock accuracy shown to retailer/salesman                        | complained about on Shikhar, Coke Buddy, Distributo                                                                                             | Play Store            |
| Transparent public pricing for distributors                                | SpireStock, SalesPort only                                                                                                                      | pricing pages         |

## 5. Documented complaints that remain unaddressed (across vendors, 2020-2026)

1. **Sync is the product's failure point.** "Sync after every outlet" (Bizom 2022), "daily sync take too much time" (Bizom Next Aug 2026), "sync process is very slow" (Botree distributors May 2025), "sync is not properly done" (Botree Capterra Jun 2025), "after the update app is working too slow" (FieldAssist DMS 2025). Six years of the same complaint on the two market leaders. Design implication: local-first data with background delta sync and no blocking "sync now" step.
2. **Geo-fence false negatives block work.** Bizom (Jun 2026), FieldAssist (May 2024, Apr 2025, Aug 2026), BeatRoute (Jul 2025). Reps standing at the shop are told they are 7 km away and cannot bill. Implication: geo-tag as evidence, never as a hard gate; allow override with a flag for the owner.
3. **Battery and background tracking.** Bizom (2020, 2025), FieldAssist (SoftwareSuggest 2021), Botree SFA (Jul 2026). Implication: trip-scoped GPS for delivery staff (the owner requires tracking) rather than all-day polling; explain what is tracked.
4. **Auto-logout / permission nagging / crash on phone call.** Botree SFA "auto-logout during call" (Jul 2026), Bizom Next "once I receive phone calls I have to start… over again" (Aug 2026), FieldAssist "every day app want to open setting and permission" (Dec 2025).
5. **Updates that break core flows.** BeatRoute search/payments broken after updates (2023-2025); PepUpSales touch after update (2026); FieldAssist "same repeated errors… 5th time writing review".
6. **Support that asks for 5 stars instead of fixing.** FieldAssist (Dec 2023, 108 votes), Bizom (Gartner), PepUpSales refund refusal (2023), Bizom Next "no one has taken ownership" (Jul 2026), Distributo "no feature request page".
7. **Distributors cannot get their own data out of the brand DMS.** Botree reviewers (7+) ask for downloadable GST, ledger, collection, claim and pending-amount reports; Bizom reviewers want Excel reports. Implication: exports (Excel/Tally XML/JSON) and GST-return-ready reports are a selling point, not a chore.
8. **Stock shown ≠ stock available**, causing partial bills and cancelled orders: Shikhar (2019, 2020, 2022), Coke Buddy (2023, 2025), Distributo (2026). Implication: the append-only stock ledger with reservations must drive what the retailer app shows.
9. **"Delivered" status without delivery** and scheme shown in app not honoured on bill: Coke Buddy (2023-2026), Shikhar (2021-2023). Implication: delivery states must be set by the delivery app at the stop (with proof), and invoice pricing must be computed by the same engine the retailer saw.
10. **Price hikes with no new features** (Distributo 2024) and opaque pricing everywhere else.

## 6. Brand-mandated DMS from the distributor's side

### 6.1 How it actually works

- The brand licenses a DMS (Botree, FieldAssist, Bizom, Salescode, BeatRoute…) and installs a "distributor node" at each distributor; the brand pays the vendor, the distributor supplies a PC/phone and an operator. FieldAssist's "1100 distributor nodes deployed in under two months" describes exactly this rollout. SpireStock's HUL guide (competitor content, plausible but unverified) puts distributor tech/licence spend at Rs 60,000-2.5 lakh and states "every secondary sale must flow through" the brand system ([spirestock HUL blog](https://spirestock.com/blog/hul-distributorship-india-cost-margin-process)).
- Order flow: brand salesman (or retailer app) books the order → it lands in the brand DMS at the distributor → operator confirms stock and bills → invoice printed from the brand DMS (this is Tarsun's invoice E: "Buyer ERP Id FO_GFIL_…", "SO-…", "IN-…", "Item ERP Id", "Beat Name", salesman name — field names consistent with FieldAssist DMS, and FieldAssist lists Too Yumm! as a customer; **the specific vendor behind Guiltfree's DMS is highly likely FieldAssist but not confirmed by Guiltfree**).
- Claims: schemes are configured by the brand; claims for scheme cost, damages/expiry returns and price changes are raised inside the DMS and settled by the brand as credit notes to the distributor ledger (Bizom "Claims Settlement", FieldAssist "click-to-claim… settles payouts 2X faster", Botree "claim validation", FieldAssist "Rs 20 Cr+ claims settled monthly"). Independent claim engines (RebateLedger) exist because reconciliation of over-claims/duplicates across schemes is still manual for many brands. FieldAssist's own blog lists the four claim types: scheme/promotion, margin, return, custom (incentive/expense) ([fieldassist claims blog](https://www.fieldassist.com/blog/streamlined-distributor-claims-settlement-fieldassist-dms)).
- Retailer-facing brand apps sit on top: **HUL Shikhar** (launched 2019 as a "distributor inclusive model"; 1.4M retailers; orders route to the retailer's mapped HUL distributor; shows MOC-wise claims, schemes, Ushop bill payment, ShopKhata) ([hul.co.in 2025](https://www.hul.co.in/news/news-search/2025/the-future-is-phygital-how-shikhar-is-redefining-retail-for-indias-kirana-stores/), [Play Store](https://play.google.com/store/apps/details?id=com.hul.sambhav)); **HCCB Coke Buddy** (WhatsApp/web/app ordering, 95.4K reviews) ([Play Store](https://play.google.com/store/apps/details?id=com.applicate.kbuddy.app)).
- What those retailer reviews show about the distributor's position: Shikhar 3.8 stars/41.9K; Coke Buddy 4.5/95.4K. The recurring 1-star themes are all distributor-execution failures that the brand app cannot see: "dealer agent said material not available… damage material return approx Rs 10,000… no adjustment" (Jul 2026), "distributor itself doesn't know that he has got online order" (2022), "Showing bill not made by me… we are cash party… why pending bills?" (2022), "Expiry return amount not credited even after 6 months" (2023), "Orders are marked as delivered without actual delivery" (Coke Buddy Apr 2026), "scheme shows in app are different in billing" (Coke Buddy 2023), "distributor name showing wrong in my account… sales manager… unable to update" (2025). The brand answers every one with the same template email. **The distributor is the accountable party but has no tooling of its own in that loop.**

### 6.2 Do brand DMSs expose APIs, exports or claim submission to the distributor?

Evidence found:

- **Inbound to the brand DMS, yes (brand-controlled):** Botree FlexiDMS and BeatRoute plugins _pull_ invoices/stock from the distributor's Tally or Busy; Salescode has native Tally/Zoho Books sync; FieldAssist FAIS connects SAP/Oracle/Tally (for the brand). Distributo and SpireStock export/sync _to_ Tally from the distributor side. So the de-facto integration bus between a distributor's own system and a brand DMS is **Tally-shaped data (vouchers, stock items, ledgers)**, not REST.
- **Outbound from the brand DMS to the distributor, weak:** no brand DMS publishes distributor-facing API documentation. FieldAssist says day-end invoices are pushed to _the brand's_ ERP. Botree distributors explicitly complain they cannot download GST, ledger and claim reports. SpireStock's Scale tier advertises "open REST API 10k req/day", the only public API statement in the set — and that is a distributor-paid product, not a brand DMS.
- **Claims:** submitted inside the brand DMS UI; no evidence of an external claim-submission API for distributors.
- **Data ownership:** brand DMS invoices carry brand ERP IDs for retailers and items (invoice E), meaning the distributor's retailer master and the brand's retailer master are different records that must be mapped — the same "auto data mapping" problem Botree FlexiDMS solves in the other direction.

**Conclusion:** a distributor-owned system cannot expect to call a brand DMS API. Realistic integration paths, in order: (1) import the brand DMS's printed/PDF secondary invoices via document intelligence (the founder already planned this for purchase invoices; extend it to _own_ invoices issued by brand DMSs so the distributor's ledger, stock and retailer outstanding stay complete); (2) Tally-compatible XML export so brand tools like FlexiDMS/BeatRoute plugins can extract from Distribution OS as if it were Tally (this turns "we don't use your DMS" into "extract from ours"); (3) Excel/CSV exports matching brand claim templates. Item (2) is a recommended addition to the decisions list: **expose a Tally-XML-compatible export/endpoint as a first-class integration surface**, because that is what every brand-side extractor already speaks.

## 7. Implications for Distribution OS (concrete)

1. **Position as the distributor's system of record across brands, not as "another DMS".** Nobody sells that to distributors at SMB price except Distributo and (unproven) SpireStock; the enterprise vendors concede the need and solve it by extraction from Tally.
2. **Sync architecture is the differentiator field users notice first.** Local-first, delta sync, never a blocking sync button, no geo-gating of billing. Six years of top-voted complaints on Bizom/FieldAssist/Botree are about this.
3. **Trip-scoped GPS for delivery, not all-day rep surveillance.** Meets the owner's requirement while avoiding the battery/spy complaints.
4. **Build exports early:** GST-return-ready reports (GSTR-1 style), retailer ledger with pending amounts, claim statements, Tally XML. This is the single most repeated distributor-side ask in Botree reviews.
5. **Stock shown to retailer/salesman must be reservation-aware**, else you inherit the Shikhar/Coke Buddy/Distributo complaint.
6. **Delivery state only from the delivery app at the stop** (with photo/OTP for partial), and pricing engine shared between retailer app and invoice so the bill equals the quote.
7. **Do not gate on iOS parity claims you cannot keep** — Distributo lost trust with "not working on iPhone and tablet".
8. **Publish pricing.** SpireStock (Rs 399-1,799/user) and SalesPort (flat) are the only transparent ones; distributors are visibly angry about opaque hikes.
9. **Recommended change to decisions (flagged):** add "Tally-XML-compatible export/endpoint" and "ingest own invoices issued by brand DMSs via document intelligence" to the integration scope, for the reasons in 6.2.

## 8. Open questions

- Which vendor runs Guiltfree/Too Yumm's DMS (likely FieldAssist) and Reliance Consumer Products' Campa distributor system — ask Tarsun for the login screen/brand name.
- Whether HUL's distributor-side DMS is still a proprietary in-house system (commonly referred to as "Leveredge"/Shikhar distributor portal in industry talk — **unverified**) and whether it runs on Botree in some regions.
- Real per-user pricing for Bizom/FieldAssist/BeatRoute in India (only third-party figures exist).
- Whether Salescode's "no operator" DMS is deployed in Maharashtra GT and how distributors rate it (no reviews found).
- Reddit/LinkedIn distributor threads could not be read; a manual pass would add colour but is unlikely to change the pattern above.

## 9. Sources

- Bizom: https://bizom.com/distributor-management-system/ ; https://bizom.com/blog/online-mobile-first-dms-might-best-bet-indian-fmcg-companies/ ; https://www.softwaresuggest.com/bizom ; https://www.softwaresuggest.com/bizom/reviews ; https://softwarefinder.com/field-service/bizom ; https://technologycounter.com/products/bizom ; https://play.google.com/store/apps/details?id=in.bizom.android ; https://play.google.com/store/apps/details?id=co.bizom.apps
- FieldAssist: https://www.fieldassist.com/pricing ; https://www.fieldassist.com/online-distributor-management-system ; https://www.fieldassist.com/integration-platform ; https://www.fieldassist.com/retailer-app ; https://www.fieldassist.com/blog/distribution-management-system-dms-guide-2025 ; https://www.fieldassist.com/blog/streamlined-distributor-claims-settlement-fieldassist-dms ; https://marketplace.microsoft.com/en-us/product/saas/fieldassist-5050577.sol-3235-mwk?tab=overview ; https://www.softwaresuggest.com/fieldassist/reviews ; https://www.capterra.com/p/157892/FieldAssist/ ; https://play.google.com/store/apps/details?id=com.flick2know.gt ; https://play.google.com/store/apps/details?id=com.flick2know.fieldassist.dms
- Botree: https://www.botree.ai/dms/botree-dms ; https://www.botree.ai/dms/botree-flexi-dms ; https://www.botree.ai/dms/botree-mydms ; https://www.softwaresuggest.com/botree-dms/reviews ; https://www.capterra.in/software/1027106/botree-dms ; https://www.techjockey.com/detail/botree ; https://play.google.com/store/apps/details?id=com.botree.mobilitysfa.botreeunified
- BeatRoute: https://beatroute.io/pricing-plans-india ; https://beatroute.io/ai-info/ ; https://beatroute.io/distributor-management-system/ ; https://beatroute.io/channel-engagement/distributor-management-system-guide-for-fmcg-companies/ ; https://www.capterra.in/software/181686/beatroute ; https://play.google.com/store/apps/details?id=com.gz.vitalwires
- Salescode: https://salescode.ai/products/distributor-management-system
- Ivy Mobility: https://ivymobility.com/distribution-management-system/
- Distributo: https://distributo.com/ ; https://distributo.com/tally-integration ; https://play.google.com/store/apps/details?id=com.bluesapling.dms.production
- SalesTrendz: https://www.salestrendz.com/best-sales-force-automation-software/ ; https://www.salestrendz.com/salestrendz-vs-fieldassist-vs-bizom-which-wins/ ; https://www.salestrendz.com/run-your-distributors-field-reps-on-one-app/ ; https://www.softwaresuggest.com/salestrendz
- PepUpSales: https://www.pepupsales.com/ ; https://www.pepupsales.com/mobile-sfa-for-fmcg.php ; https://www.techjockey.com/detail/pepupsales-sfa ; https://play.google.com/store/apps/details?id=com.quytech.secondarysale
- SpireStock: https://spirestock.com/pricing ; https://spirestock.com/faq ; https://spirestock.com/blog/top-10-dms-software-india-2026-comparison ; https://spirestock.com/blog/hul-distributorship-india-cost-margin-process ; https://spirestock.com/blog/fmcg-distributor-appointment-criteria-india
- SalesPort: https://sortstring.com/distributor-management-system ; https://sortstring.com/blogs/fieldassist-vs-bizom-vs-beatroute-vs-salesport-2026-matrix
- EazyDMS: https://www.eazydms.com/sfa/ ; Heera: https://heerasoftware.com/why-does-a-multi-company-billing-dms-make-sense-for-a-sub-stockist-in-india/ ; RebateLedger: https://rebateledger.com/industries/fmcg ; Tally-integrated DMS explainer: https://sawindia.com/tally-integrated-distributor-management-system
- Brand systems: https://play.google.com/store/apps/details?id=com.hul.sambhav ; https://www.unilever.com/news/news-search/2023/the-inhouse-developed-app-thats-transforming-a-traditional-sales-model/ ; https://www.hul.co.in/news/news-search/2025/the-future-is-phygital-how-shikhar-is-redefining-retail-for-indias-kirana-stores/ ; https://play.google.com/store/apps/details?id=com.applicate.kbuddy.app ; https://www.hccb.in/coke-buddy
