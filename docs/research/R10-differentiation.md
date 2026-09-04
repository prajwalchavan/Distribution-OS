# R10 — Differentiation opportunities for a distributor-owned OS (India)

Date: 2026-09-04. Prepared for the Distribution OS project (see CONTEXT.md). Intended target path was `scratchpad/research/R10-differentiation.md`; plan mode was activated mid-task, so the report is written here instead.

## 0. Method and caveats

- The session's WebSearch budget was already exhausted (200/200) when this task started. Research was done with WebFetch on Brave/Bing result pages, Google News RSS (with URL decoding), archive.org copies, and direct fetches of vendor/developer docs. Every claim below is tagged **[verified]** (read on the cited page this session) or **[unverified]** (memory, secondary listing, or page could not be fetched).
- Several vendor pages returned 404/403 (Bizom claims page, FieldAssist IRIS, Marg pricing, Tally help sub-pages). Where a competitor feature could not be confirmed, it is marked as such rather than assumed.
- Effort scale for a solo developer on top of the already-planned core (orders, ledger, invoices, GST, WhatsApp/SMS): **S** = under 2 weeks, **M** = 2-6 weeks, **L** = 6+ weeks or needs ongoing ops. Value to the distributor owner: **H/M/L**.

## 1. Summary table

| #   | Capability                                             | Any competitor does it?                                                                                                                                                             | Solo-dev effort                            | Value to owner                               | Verdict                                                             |
| --- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------- |
| 1   | WhatsApp-native ordering (Flows / catalog / free-text) | Yes: Bizom WhatsApp Ordering Bot, FieldAssist retailer app "app or WhatsApp-based workflows", JioMart consumer flow [verified]                                                      | M                                          | H                                            | Build; do free-text + voice-note parsing first, Flows second        |
| 2   | Voice order entry (Hindi/Marathi) + LLM parsing        | No Indian DMS/SFA found doing it; B2Bee (non-India) does WhatsApp voice-to-ERP [verified]                                                                                           | M                                          | H (salesman + retailer)                      | Build; strongest visible differentiator                             |
| 3   | AI suggested order per shop                            | Yes, but enterprise-tier: Bizom "Suggested Order" is in its top "Power" tier; FieldAssist ARS/Product Recommendations [verified]                                                    | S (heuristic) -> M (model)                 | H                                            | Build heuristic v1 (last-N-orders + cadence) now                    |
| 4   | Scheme/claim automation (claim files to brands)        | Brand-side only: Bizom "Claims" in Basic tier, FieldAssist "click-to-claim… Rs 20 Cr+ claims settled monthly" [verified]. Nobody found doing it distributor-side for non-DMS brands | M                                          | H                                            | Build; unique for multi-brand distributors                          |
| 5   | Near-expiry liquidation suggestions                    | FieldAssist DMS "expiry alerts and damage tracking" [verified]; Marg expiry mgmt [unverified]                                                                                       | S                                          | M-H                                          | Build (cheap once batch ledger exists)                              |
| 6   | Automatic e-way bill                                   | Yes: Distributo Basic plan, Botree MyDMS, Vyapar Gold [verified]                                                                                                                    | M (via GSP)                                | M (only bills > Rs 1 lakh intra-Maharashtra) | Build via GSP, phase 2                                              |
| 7   | Retailer credit-risk scoring (analytics only)          | No distributor SaaS found; marketplaces do it for lending (Udaan, Bizom retailer credit via partners) [verified/partial]                                                            | S-M                                        | H                                            | Build simple score from payment behaviour                           |
| 8   | Route optimisation + loading sheet                     | Yes: FieldAssist route optimisation and "auto-generated load sheets cut prep time by 80%" [verified]                                                                                | M (VROOM/OSRM or Google)                   | M-H                                          | Build loading sheet (S) now; optimisation later                     |
| 9   | Trip-end cash reconciliation                           | Yes: FieldAssist van sales "end-of-day settlement… auto reconciliation" [verified]                                                                                                  | S                                          | H                                            | Build early (it is table stakes in delivery app)                    |
| 10  | Geo-verified shop photos                               | Yes: FieldAssist "98% geo-verified adherence", Distributo geofencing [verified]                                                                                                     | S                                          | M                                            | Build (trivial once GPS is in)                                      |
| 11  | Manufacturer DMS sync/export                           | Partial: Botree MyDMS (brand-paid, Nestle) tackles multi-company distributors; brand DMS exports are brand-controlled [verified]                                                    | M-L (per format)                           | H                                            | Build importers for Tarsun's actual brand DMS invoices first        |
| 12  | Tally push                                             | Yes: Distributo (Advanced), Botree MyDMS, FieldAssist DMS, Marg -> Tally XML [verified]                                                                                             | S-M                                        | H (CA/accountant asks for it)                | Build XML export early; direct push later                           |
| 13  | UPI collect via QR on invoice                          | Yes in principle (Distributo/Vyapar print UPI QR) [unverified for them]; aggregators charge 0.99-2% [verified]                                                                      | S (static/dynamic QR) / M (reconciliation) | H                                            | Build: own-VPA QR + UTR capture; no aggregator                      |
| 14  | Multi-distributor retailer app                         | Yes at brand/marketplace level: Bizom retailer app "40+ FMCG brands, 800,000+ retailers", FieldAssist eB2B, Udaan, Kirana Club 4.1M [verified]                                      | L                                          | M (H for retention)                          | Keep as planned but ship as WhatsApp/PWA first, not app-store first |
| 15  | Shelf-photo / brand-visibility analytics               | Yes, brand-side: ParallelDots ShelfWatch, Infilect InfiViz, HUL Envision (~2.5 crore images/month) [verified]                                                                       | L                                          | L for distributor owner                      | Do not build; at most store photos for brands                       |

## 2. Detail by capability

### 2.1 WhatsApp-native ordering (no app install)

**What exists.** Bizom sells a "WhatsApp Ordering Bot" that is "Integrated with Bizom SFA and DMS" and lets retailers order "anytime in case of stockouts" (bizom.com/whatsapp-ordering-bot) [verified]. FieldAssist's retailer app states "Retailers can place orders anytime through app or WhatsApp-based workflows" and "works across Android app, PWA, and WhatsApp" (fieldassist.com/retailer-app) [verified]. JioMart on WhatsApp (Meta + Jio, Aug 2022) was the first end-to-end grocery flow: "Shoppers can add items to their cart and make a payment to complete the purchase — all without leaving the WhatsApp chat"; JioMart later reported a "sevenfold increase in monthly orders through WhatsApp" (Sept 2023) but stopped reporting the channel separately afterwards [verified via Meta newsroom and markhub24 summary]. Wholesale-specific: b2b.store documents in-message ordering with WhatsApp Flows (browse products, enter quantities, order summary, confirm) [verified].

**Platform facts (Meta docs, verified).** WhatsApp Flows are a native form UI inside the consumer app. Component limits: Dropdown max 200 options (100 with images), CheckboxGroup/RadioButtonsGroup max 20 options, max 50 components per screen, Flow JSON up to 10 MB, max 10 routing branches. Reply buttons max 3. A 200-option dropdown is enough for a per-retailer "your usual items" list but not a full 1,500-SKU catalog, so design the flow as: usual items (pre-filled from history) -> search screen -> confirm.

**Pricing (India, 2026).** BSP rate cards agree: marketing template ~Rs 0.8631, utility ~Rs 0.115, authentication ~Rs 0.115 per delivered message; free-form replies inside the 24-hour customer-service window are free (chatmaxima, telecrm, wabaconnect, myoperator) [verified on those pages]. Meta's own pricing page confirms "Utility template messages sent within an open customer service window are free" and that India moved to INR billing (July 2026; migration deadline Dec 31 2026) [verified]. **Conflict to flag:** MyOperator claims service messages and in-window utility messages become billable at Rs 0.115 from Oct 1 2026; Meta's "updates to pricing" page fetched this session does not list that change. Treat as unverified and budget for it anyway (worst case ~Rs 0.5 per order conversation).

**The behavioural point.** HublerX's 2026 write-up puts it bluntly: "A kirana store owner or FMCG distributor who texts informally won't follow a chatbot flow"; real orders look like "bhai 200 amul 1L, deliver kal" [verified]. That argues for accepting free text, voice notes and photos of handwritten lists as first-class order inputs, with Flows/catalog as the structured fallback, not the other way round.

**Effort:** M. Cloud API webhook + template approval + an order-intake parser (see 2.2) + a Flow for confirmation. **Value:** H — it removes the retailer-app install barrier entirely and turns the salesman visit into a confirmation rather than data entry.

### 2.2 Voice order entry (Hindi/Marathi) + LLM parsing into order lines

**Competitors.** No Bizom/FieldAssist/Distributo/Marg page or news item found describing voice order entry in Indian languages. The only concrete example is B2Bee (b2bee.net): "NORA" AI takes WhatsApp text or voice ("same as last week"), transcribes, validates against "price lists, availability, delivery rules, and minimum order quantities" and writes orders to the ERP; pilot claims 80% less order-processing time, 34% higher AOV, 3-7 day setup [verified, vendor claims, not India]. This is a genuine gap in the Indian distributor market.

**STT options (verified this session):**

| Provider                 | Price                                                                                         | Hindi                               | Marathi                                                                 | Notes                                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Sarvam Saaras v3 (India) | Rs 30/hour STT (Rs 0.50/min); Rs 45/hour with diarization; Rs 100 free credit                 | Yes                                 | Yes, "Minglish" code-mixing, WebSocket streaming "sub-250ms first byte" | Built for Indian accents/code-mixing; INR billing                                                                                   |
| Google Cloud STT V2      | $0.016/min standard; $0.003/min dynamic batch; free tier exists                               | hi-IN on chirp_3/chirp_2/long/short | mr-IN on chirp_3/chirp_2/long/short (EU region only)                    | Marathi only in `eu` region -> latency                                                                                              |
| Deepgram Nova-3          | $0.0048/min mono, $0.0058/min multilingual (promo); $200 free credit                          | hi                                  | mr                                                                      | Cheapest hosted; Hindi/Marathi quality unbenchmarked here                                                                           |
| OpenAI                   | Whisper $0.006/min; gpt-4o-mini-transcribe ~$0.003/min                                        | Yes                                 | Yes (Whisper)                                                           | Hinglish product names are the risk, not the language                                                                               |
| AI4Bharat IndicConformer | Free, MIT licence, self-host                                                                  | Yes                                 | Yes                                                                     | 22 languages; RNN-T; needs a GPU box; no WER published on the repo                                                                  |
| Bhashini (govt)          | Free APIs are "for the purposes of PoC only… reach out to Bhashini team for the paid version" | Yes                                 | Yes                                                                     | Not usable in production without a commercial agreement. Note bhashini.ai is a separate private company, not the government service |

**Design implication.** Raw STT will mangle SKU names ("Bhoot Karare 5 rupaye wala 2 peti"). The workable pipeline is STT -> LLM with the retailer's own last-90-day SKU list and case sizes injected as context -> structured order lines with confidence -> human confirm (salesman or retailer taps "haan"). LLM cost is negligible (gpt-4o-mini $0.15/$0.60 per 1M tokens; Sarvam 105B Rs 29/Rs 73 per 1M tokens) [verified]. At ~30 seconds of audio per order, Sarvam costs ~Rs 0.25 per order.

**Effort:** M (2-4 weeks for a usable v1 given the catalog and retailer history already exist). **Value:** H for the salesman (faster than tapping 15 lines), H for retailers who will never install an app, and it doubles as the WhatsApp voice-note intake in 2.1.

### 2.3 AI suggested orders per shop

**Competitors.** Bizom's "Suggested Order" uses "advanced AI models for demand forecasting… the next right order for every outlet" but sits only in its **Power** tier (above Basic and Growth) [verified, bizom.com/pricing and /suggested-order]. FieldAssist lists "ARS (Auto Replenishment System)" and "Product Recommendations" and claims "AI-led auto-replenishment logic reduces stockouts by up to 30%" [verified]. HUL's Shikhar does this at brand level. So the feature exists, but it is priced for brands with 100+ users, not a Rs 1,500/month distributor.

**What to build.** A deterministic v1: for each retailer, per SKU, median inter-purchase interval and median quantity from the ledger; flag SKUs that are "due" (days since last purchase >= interval) and pre-fill the order. Add scheme-aware upsell (if a slab is 2 cases away, suggest it). That is one SQL view plus a UI, and it is exactly the input a salesman's or a WhatsApp Flow's "usual order" needs. A learned model can come later once there are thousands of orders. **Effort:** S for heuristic, M for model. **Value:** H — it raises lines per order and is the feature owners can see working on day one.

### 2.4 Scheme / claim automation

**Competitors.** Claims exist in brand DMS products: Bizom includes "Claims" even in its Basic tier; FieldAssist advertises "Click-to-claim interface with ERP sync settles payouts 2X faster" and "Rs. 20 Cr+ Claims settled monthly" [verified]. Botree MyDMS gives distributors "scheme visibility… credit notes" [verified]. **But all of these run on the brand's DMS and only for that brand.** From the Tarsun invoices: Too Yumm is on a brand DMS (invoice E), while Guru Kripa/MOM, Balaji, Alan's/Masti Oye are billed on the distributor's own software (invoices A, F). For those brands, scheme reimbursements (secondary discount, free-qty schemes, cash discount, damage returns) are compiled by hand today.

**What to build.** Scheme master per brand (slab, period, free qty, secondary %, cash %), auto-attribution of each invoice line to the scheme that produced its discount, then a per-brand, per-period claim statement (PDF + Excel in the brand's column layout) with the supporting invoice list. Botree/Bizom/FieldAssist export formats for claim upload are not public; get one real claim sheet from each of Tarsun's brands and template it. **Effort:** M. **Value:** H — unclaimed or late claims are direct margin loss, and no distributor-side tool found does this across brands.

### 2.5 Near-expiry liquidation suggestions

**Competitors.** FieldAssist DMS: "expiry alerts and damage tracking to prevent write-offs" [verified]. Marg ERP has expiry/batch management (pharma heritage) [unverified this session]. Bizom: no page found.

**What to build.** Batch numbers are already in the design and appear on the Guiltfree invoice (N526205…). Given batch + shelf life per SKU (or manufacturing date), compute days-to-expiry per batch; when < brand's saleable window (often 60-90 days for snacks), (a) push those batches first in picklists (FEFO), (b) suggest a per-retailer clearance offer on the salesman/WhatsApp order, (c) show the owner a "Rs at risk" tile. **Effort:** S. **Value:** M-H (higher for snacks/water with short shelf life; per-brand return policy differs, which the founder confirmed).

### 2.6 Automatic e-way bill

**Rules (verified).** Inter-state threshold Rs 50,000; Maharashtra intra-state threshold Rs 1 lakh (notification of 30 June 2018); MFA mandatory for all users since 1 Apr 2025; EWB can only be generated within 180 days of invoice date; backup portal ewaybill2.gst.gov.in since 1 Jul 2025 (saginfotech summary). NIC's API portal shows continuing rule churn (Jan 2026 HSN validation relaxation; May/Jul 2026 changes put on hold) [verified on docs.ewaybillgst.gov.in].

**API access (verified on NIC docs).** Direct API needs "at least around 10 thousand transactions per month per GSTIN", an SSL domain, up to 3 whitelisted static Indian IPs and a pre-production test cycle. A small distributor cannot qualify, so the OS must integrate through a GSP/ASP (ClearTax, Masters India, IRIS, etc.) where the distributor registers "For GSP" on the EWB portal. GSP pricing was not retrievable this session [unverified].

**Competitors.** Distributo has E-Way Bill in its Rs 750/month Basic plan; Vyapar Gold includes "unlimited E-way bill generation"; Botree MyDMS and FieldAssist DMS advertise it [verified]. It is table stakes, not differentiation. **Effort:** M (GSP integration, error handling, Part-B vehicle updates). **Value:** M — most secondary invoices to kiranas are far below Rs 1 lakh; it matters for inbound/stock transfers and large modern-trade bills.

### 2.7 Retailer credit-risk scoring (analytics only, no lending)

**Competitors.** No Bizom/FieldAssist/Distributo page found offering a retailer payment-behaviour score for the distributor. Distributo has "Credit Control — set credit limits per customer" [verified]. Marketplaces do scoring to lend: Bizom's retailer app offers "instant, hassle-free working capital" via partners [verified]; Udaan's stickiness is attributed to "Credit, return flexibility and freedom from… minimum order quantities" (Inc42, Jun 2026) [verified].

**What to build.** From the payment ledger (the founder said retailers pay in bulk every 2-3 orders and pending bills sit in a physical file): days-sales-outstanding per retailer, % of invoices paid within terms, trend, partial-payment frequency, bounce/return count. Show a simple A/B/C band on the salesman's order screen and a "collect before delivering" flag in the delivery app; let the owner set credit limit by band. No bureau data, no lending, so no licence issue. **Effort:** S-M. **Value:** H — bad debt and slow collection are the owner's real cash problem, and this makes the running-tab feature safe to offer.

### 2.8 Route optimisation and loading-sheet generation

**Competitors.** FieldAssist: AI routing claims "30% reduction in travel and operational expense", beat planning "increase coverage by up to 20%"; DMS "auto-generated load sheets cut prep time by 80%"; van sales "Auto-suggested loadouts" [verified]. Distributo: "Beat Routes" in Basic plan [verified].

**Build options.** Loading sheet = group confirmed orders by trip/vehicle, sum by SKU and case/pc, sort by drop sequence — S effort, immediate value for the 2-person vehicle teams doing multiple trips a day. Sequencing: VROOM (BSD-2, C++, supports time windows, capacities, skills, multi-vehicle; backends OSRM/Valhalla/ORS) self-hosted [verified], or Google Route Optimization API (single-vehicle $10 per 1,000 shipments after 5,000 free/month; fleet $30 per 1,000 after 1,000 free; Routes API $5 per 1,000 after 10,000 free) [verified]. At Tarsun's scale Google's free tier covers it; VROOM avoids a per-tenant cost later. **Effort:** S for loading sheet, M for optimisation. **Value:** M-H.

### 2.9 Trip-end cash reconciliation

**Competitors.** FieldAssist van sales: "Capture cash, cheque, or digital payments instantly", "OTP and geo-verification validate every collection", "End-of-Day Settlement… auto reconciliation" [verified]. Bizom van sales page 404'd [unverified]. Mastercard/Boost (Dec 2024) exists precisely because FMCG distribution cash collection is still largely manual [page blocked; unverified].

**What to build.** Expected cash per trip = sum of cash collections logged at stops; at trip end the delivery person enters denominations/handover amount, the manager confirms, and any gap becomes an exception on the owner dashboard. Pair with UPI (2.13) so digital collections reconcile automatically by UTR. **Effort:** S. **Value:** H — leakage between vehicle and counter is the owner's second cash problem after receivables.

### 2.10 Geo-verified shop photos

FieldAssist claims "98% geo-verified adherence"; Distributo Advanced has "Geofencing… restrict sales team from transactions outside set location" [verified]. Take a photo at shop onboarding and at each delivery/collection with device GPS + timestamp stored server-side; reject or flag if outside the geofence. Also useful as proof-of-delivery in disputes. **Effort:** S. **Value:** M.

### 2.11 Manufacturer DMS sync / export

**The problem is confirmed by a competitor.** Botree (Oct 2024) launched MyDMS because "distributors handling multiple companies (brands) often work independently and are reluctant to adopt separate applications for each brand"; MyDMS offers "a single invoice for multi-company orders", scheme/credit-note visibility, e-invoice/e-way bill and "seamless Tally integration"; Nestle deployed it for rural sub-distributors [verified]. Note MyDMS is still sold to and controlled by the brand.

**What we know from Tarsun's invoices.** Invoice E (Too Yumm) carries Buyer ERP Id "FO_GFIL_…", SO/IN numbers, Item ERP Id, Beat Name, Salesman Name — a brand DMS export with a stable schema. The specific DMS vendor is not identifiable from the invoice [unverified]. Public import/export specs for Bizom, Botree and Salesforce Consumer Goods Cloud were not found; these are customer-only documents.

**What to build.** (1) Inbound: the planned photo -> LLM -> review pipeline already handles purchase invoices; add a "brand DMS secondary invoice" document type so Too Yumm bills generated outside the OS can be ingested (PDF/print) and matched to retailers, closing the double-entry gap without any API. (2) Outbound: a per-brand secondary-sales export (CSV/Excel) with the columns brands typically ask for (outlet code, beat, SKU code, qty, free qty, scheme, invoice no/date) so the distributor can upload to whichever DMS demands it. (3) Only if a brand exposes an API, integrate. **Effort:** M for (1)+(2), L per real API. **Value:** H — this is the single biggest daily pain visible in the ground-truth documents (three billing systems in parallel).

### 2.12 Tally push

TallyPrime imports masters and vouchers from Excel (any layout, via mapping templates), XML and, from Release 7.0, JSON; the help site explicitly documents importing Marg-exported XML [verified on help.tallysolutions.com]. Distributo lists "Tally Export" in its Advanced plan; FieldAssist and Botree list Tally integration [verified]. Build a Tally XML export of sales/purchase/receipt vouchers with ledger mapping first (S); a direct push over TallyPrime's HTTP/XML interface on the accountant's PC can come later [the HTTP-9000 method is standard practice but its help page was not fetched this session — unverified]. **Value:** H — the CA will demand it at first GST filing.

### 2.13 UPI collect via QR on invoice (no fintech licence)

**Facts (verified).** RBI policy makes UPI MDR zero; aggregators still charge a platform fee: Razorpay lists UPI at 2% platform fee and UPI QR at 0.99% per transaction, with webhooks and dynamic/static QR APIs. WhatsApp Payments in India supports "Razorpay, PayU, Billdesk, and Zaakpay" deep integrations or a "UPI Intent Mode" with any gateway, via `order_details` messages. Dynamic QR on B2C invoices is a GST requirement only above Rs 500 crore turnover (CBIC Circular 156) — not applicable here.

**Design.** Generating a `upi://pay?pa=<distributor VPA>&pn=<name>&am=<amount>&tn=<invoice no>&cu=INR` QR on every invoice is free, needs no licence, and pays straight into the distributor's bank. Reconciliation is the gap: without an aggregator there is no webhook, so capture the UTR (delivery person types/scans the 12-digit UTR or the retailer sends the screenshot on WhatsApp) and match to the invoice; later add bank-statement CSV matching. Aggregator QR (0.99%) is a distributor-optional upgrade for those who want automatic matching. At a typical 5-8% distributor margin, 0.99% is a real cost, so make it opt-in. **Effort:** S for QR + UTR capture, M for statement matching. **Value:** H.

### 2.14 Multi-distributor retailer app

**Competitors.** Bizom retailer app: "40+ FMCG brands onboarded", "800,000+ retailers", schemes, digital invoices, credit, ONDC selling [verified]. FieldAssist eB2B: Android app + PWA + WhatsApp [verified]. Udaan: ~15,000 stores transact daily in Bengaluru, "90% repeat rate", MOQ as low as Rs 3,000, next-day delivery for 90%+ of items [verified, JPMorgan story]. Kirana Club: 4.1 million registered retailers, acquired by Meesho (Jun 2026) [verified].

**Assessment.** The planned retailer app is right, but the evidence says the install-and-learn barrier is the killer. Ship the retailer surface as WhatsApp first (2.1) and a PWA second; put the native app behind demand. The multi-distributor identity decision already made (retailer identity separate from any one distributor) is the correct architecture for this and should be kept. **Effort:** L (full app). **Value:** M for the paying owner directly; H for lock-in once several distributors in a town use it.

### 2.15 Brand-visibility / shelf-photo analytics

ParallelDots ShelfWatch (share of shelf, OSA, planogram; "95%" accuracy; "5M+ images processed monthly" for one confectionery brand), Infilect InfiViz (">97% accuracy… ~5 million images per month… 400,000 stores") and HUL's Envision ("~2.5 crore images every month") all sell to **brands** [verified]. FieldAssist IRIS exists (page 404) [unverified]. A distributor owner gains little from it, and the models cost real money. Do not build; optionally store geo-tagged shelf photos so a brand can buy them later. **Effort:** L. **Value:** L.

## 3. Adoption tactics that made OkCredit / Khatabook / Udaan / Kirana Club stick

All from primary interviews or company pages fetched this session.

- **Replicate the paper artefact, do not redesign it.** Khatabook's MVP "was replicating India's bahi khata… within the app"; "Even today, there is a notebook-style transaction record page"; a big UI change once made users think "it's not the same Khatabook app anymore" and they dropped off, so "product journey needed to be incremental, not radical" (YourStory, Aug 2021). For this OS: the retailer's outstanding screen should look like the physical pending-bills file Tarsun keeps today.
- **Migrate the old book with a camera.** OkCredit "added a camera feature to help the store owner migrate the old 'Udhar Khata'"; "It took us two to three hours to help shift all his old accounts. Once he was convinced, he referred us to three of his relatives" (YourStory, Mar 2021). The planned document-intelligence pipeline should be pointed at the distributor's existing ledgers/outstanding registers on day one.
- **Reminders/receipts over WhatsApp and SMS, with a payment link.** OkCredit moved from calls to "SMS or WhatsApp alerts… added a payment link within SMS"; they were "early adopters of WhatsApp business APIs". Khatabook's automated collection reminders "resulted in better cash flow"; OkCredit's Hindi site now says "collect money 3x faster" and "1 crore+" users [verified via search snippet]. For this OS: every invoice and every payment receipt goes to the retailer on WhatsApp automatically; that is how the retailer learns the distributor "is on the app" without installing anything.
- **Vernacular is not optional.** OkCredit went from Hindi/English to 11 languages; Khatabook introduced 13 Indian languages early; Kirana Club: "more than 70% kirana store owners on the platform are from Tier III cities" and "the language that a Kirana store owner understands is the language of business". Hindi + English first (already decided) is right; add Marathi soon because the pilot is in Thane.
- **Offline-first.** OkCredit: "Enabling our users to keep using OkCredit even in areas with patchy internet connectivity… has been one of the biggest problems we have had to solve." Already decided for field apps; keep it for the retailer surface too (WhatsApp is offline-tolerant by nature).
- **Support channel that matches the user.** OkCredit: "call-based support to chat-first… then WhatsApp-based support". Run support on WhatsApp from day one.
- **Referral is word of mouth, seeded in existing groups.** OkCredit posted registration videos in WhatsApp groups; Kirana Club "started leveraging these Facebook groups" and seeded WhatsApp/Telegram/YouTube content before ads; Khatabook: "word of mouth works exceptionally well in India's MSME retail community". For a distributor product the loop is: distributor onboards -> their retailers get WhatsApp invoices -> other distributors serving the same retailers see it.
- **Economic hooks beat features.** Udaan retention (90% repeat) is explained by price, on-time next-day delivery and small MOQs; Inc42 (2026): trust is built on "Credit, return flexibility and freedom from… minimum order quantities". A distributor OS can offer the retailer the same three levers (running tab, easy returns, small orders) inside the existing relationship.
- **Scale signals.** OkCredit had 2.4 crore registered users and 5.5 lakh daily transacting users by 2020; Khatabook 10 million MAU with 264 million customers by 2021; Kirana Club 15 lakh stores in two years, 30% QoQ growth [verified]. Kirana adoption willingness: 70% of kirana stores in major cities willing to adopt technology vs 3% tech-enabled in 2018 (RedSeer, via Cornell 2026) [verified]; distributor friction: "42% of leaders reported friction with existing channel partners when introducing digital platforms" (BeatRoute 2025 survey via Cornell) [verified].

## 4. Selling subscriptions to Tier-2 distributors: pricing benchmarks

| Vendor                   | Public price                                                                                                                                                                                                                       | Notes                                                                                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Distributo (Bluesapling) | Free plan (25 bills/month); Basic Rs 750/month; Advanced Rs 1,500/month (billed annually; up to 25% off vs monthly); extra app user Rs 166-250/month; extra full user Rs 333-500/month; Enterprise custom for 50+ teams [verified] | Closest direct comparable for a distributor-paid product. E-way bill in Basic; schemes, e-invoice, batch, credit control, geofence, Tally export in Advanced |
| Vyapar                   | Silver desktop Rs 3,419/yr, desktop+mobile Rs 3,959/yr; Gold Rs 3,689 / Rs 4,319/yr; 3-year packs Rs 6,879-7,919 [verified via SoftwareSuggest listing]                                                                            | Sets the "billing software" price anchor at ~Rs 300-400/month                                                                                                |
| Marg ERP                 | Not retrievable this session (pricing page 404). Three editions Basic/Silver/Gold; commonly listed around Rs 8,100 / 12,600 / 25,200 per year single-user [unverified]                                                             | Complaints in CONTEXT.md: price creep, reseller support ping-pong                                                                                            |
| Bizom                    | Quote-only; tiers Basic (up to 100 users), Growth (100+), Power. FY25 revenue Rs 90.9 Cr, net loss Rs 13.6 Cr, ~570 employees [verified, Inc42 financials]                                                                         | Enterprise brand product; suggested order only in top tier                                                                                                   |
| FieldAssist              | Quote-only; 700+ brands, 190,000 users, 8.9M outlets; est. ARR $38.3M (GetLatka estimate) [verified pages; ARR is an estimate]                                                                                                     | Derived ARPU ~US$200/user/year (~Rs 1,400/user/month) if the estimate holds — low confidence                                                                 |
| WhatsApp cost per order  | ~Rs 0.115 per utility template; free in-window replies [verified]                                                                                                                                                                  | ~Rs 0.5-1 per order conversation worst case                                                                                                                  |
| STT cost per voice order | Sarvam Rs 30/hour = ~Rs 0.25 per 30-second order [verified]                                                                                                                                                                        | Negligible vs subscription                                                                                                                                   |

**Implications for pricing.** A distributor-paid product must land between Vyapar's ~Rs 350/month and Distributo's Rs 750-1,500/month plus per-user add-ons, unless it can show margin recovered (claims, expiry, bad debt). Suggested structure: a per-distributor base (Rs 1,500-2,500/month for owner + manager + billing) with field seats (Rs 150-300/month each) and unlimited retailers free, plus a "claims and collections" tier justified by rupee outcomes visible on the dashboard (claims filed, days-sales-outstanding reduced, expiry avoided). Keep annual-only billing for the lower tiers, as Distributo does. Free tier capped by bills/month (Distributo: 25) is a proven trial mechanism.

**How to sell.** (1) Sell to the owner on money, not features: unclaimed schemes, receivables aging, expiry losses — all of which the OS can quantify from their own data within a week of parallel run. (2) Migration as the wedge: the OkCredit lesson is that whoever digitises the existing register wins; offer "we key in your outstanding file and Tally masters" as onboarding. (3) Use the retailer's WhatsApp invoices as the referral surface. (4) Regional language sales collateral and WhatsApp support. (5) Do not compete with brand DMS for DMS-mandated brands (Too Yumm); ingest their invoices instead, and position the OS as the distributor's single book across brands, which is exactly what Botree's MyDMS pitch concedes distributors want.

## 5. Recommended changes to existing decisions (flagged, with reasons)

1. **Retailer surface order: WhatsApp -> PWA -> native app**, not native app first. CONTEXT lists the retailer app as one of five apps built together; evidence (HublerX, FieldAssist's own WhatsApp/PWA channels, Kirana Club/Udaan adoption drivers) says installs are the barrier and a WhatsApp + voice intake serves 80% of the retailer job. This does not change the five-app decision, only the sequencing of the retailer one.
2. **Add Marathi to the language list for the pilot geography** (Kalyan/Thane). Sarvam, Google and Deepgram all support Marathi STT; Khatabook/Kirana Club data shows vernacular drives retention.
3. **Treat scheme/claim generation and retailer credit banding as first-class modules**, not reports. They are the two capabilities with no distributor-side competitor evidence and the clearest rupee value to the paying customer.
4. **UPI QR on invoice should be own-VPA, aggregator optional.** The GST decision "UPI QR on every invoice" stands; add UTR capture for reconciliation and avoid a mandatory 0.99-2% aggregator fee.
5. **Do not build shelf-photo analytics.** It is brand-side, model-heavy and low value to the owner.

## 6. Open questions

- Which DMS vendor generates Too Yumm's invoice E (FO_GFIL_ id format) and whether it offers a distributor-side export or API.
- GSP pricing per e-way bill / e-invoice for a small tenant base (ClearTax/Masters India pages were not reachable).
- Whether Meta will charge for in-window service/utility messages from Oct 2026 (BSP claim not confirmed on Meta's page).
- Real-world Hindi/Marathi STT accuracy on SKU names; needs a 100-utterance benchmark with Tarsun's salesmen before choosing Sarvam vs Deepgram vs self-hosted IndicConformer.
- Van sales (still unanswered in CONTEXT): FieldAssist's van-sales feature set (auto-suggested loadouts, on-spot billing offline, OTP/geo-verified collections, EOD settlement) is a ready checklist if the answer is yes.

## 7. Sources

- Bizom WhatsApp ordering bot: https://bizom.com/whatsapp-ordering-bot/
- Bizom retailer app: https://bizom.com/retailer-app/
- Bizom suggested order: https://bizom.com/suggested-order/
- Bizom pricing tiers: https://bizom.com/pricing/
- Bizom financials (Inc42): https://inc42.com/company/bizom/financials/
- FieldAssist home/modules: https://fieldassist.com/
- FieldAssist DMS: https://fieldassist.com/online-distributor-management-system
- FieldAssist route optimisation: https://fieldassist.com/route-optimization-software
- FieldAssist van sales: https://fieldassist.com/van-sales-automation-software
- FieldAssist retailer app: https://fieldassist.com/retailer-app
- FieldAssist ARR estimate (GetLatka): https://getlatka.com/companies/fieldassist.com
- Distributo pricing: https://distributo.com/price-and-plans
- Distributo FMCG features: https://distributo.com/fmcg-distributor
- Vyapar pricing (SoftwareSuggest): https://www.softwaresuggest.com/vyapar
- Botree MyDMS launch (ANI, Oct 2024): https://www.aninews.in/news/business/botree-software-launches-mydms-a-game-changer-for-companies-and-their-multi-company-distributors-in-rurban-markets20241023110407
- HUL AI / Shikhar / Envision (Jul 2025): https://www.hul.co.in/news/news-search/2025/how-ai-is-powering-huls-consumer-customer-and-operational-ecosystems/
- WhatsApp Flows components: https://developers.facebook.com/docs/whatsapp/flows/reference/components
- WhatsApp Flow JSON: https://developers.facebook.com/docs/whatsapp/flows/reference/flowjson
- WhatsApp pricing (Meta): https://developers.facebook.com/docs/whatsapp/pricing and https://developers.facebook.com/docs/whatsapp/pricing/updates-to-pricing
- WhatsApp Payments India: https://developers.facebook.com/docs/whatsapp/cloud-api/payments-api/payments-in
- WhatsApp India rates (BSPs): https://myoperator.com/blog/whatsapp-business-api-pricing-india-2026 ; https://chatmaxima.com/whatsapp-api-pricing/india/ ; https://telecrm.in/blog/whatsapp-business-api-pricing/
- WhatsApp Flows for wholesale orders: https://www.b2b.store/how-to-generate-in-message-whatsapp-orders/
- HublerX on informal WhatsApp ordering: https://www.hublerx.ai/resources/blog/top-whatsapp-order-management-software-manufacturers-india-2026
- B2Bee voice/text to ERP: https://www.b2bee.net/whatsapp-b2b-ecommerce
- JioMart on WhatsApp (Meta, Aug 2022): https://about.fb.com/news/2022/08/shop-on-whatsapp-with-jiomart-in-india/ ; follow-up: https://www.markhub24.com/post/jiomart-s-whatsapp-based-ordering-innovation
- Sarvam pricing: https://docs.sarvam.ai/api-reference-docs/pricing ; Marathi STT: https://www.sarvam.ai/apis/speech-to-text/marathi
- Google STT pricing: https://cloud.google.com/speech-to-text/pricing ; languages: https://docs.cloud.google.com/speech-to-text/docs/speech-to-text-supported-languages
- Deepgram pricing: https://deepgram.com/pricing ; languages: https://developers.deepgram.com/docs/models-languages-overview
- OpenAI pricing: https://developers.openai.com/api/docs/pricing
- AI4Bharat IndicConformer: https://github.com/AI4Bharat/IndicConformerASR
- Bhashini API terms (PoC only): https://bhashini.gitbook.io/bhashini-apis
- NIC e-way bill API docs: https://docs.ewaybillgst.gov.in/apidocs/ (pre-requisites.html, on-boarding-process.html)
- E-way bill thresholds and 2025 changes: https://blog.saginfotech.com/gst-e-way-bill-latest-notification
- Dynamic QR on B2C invoices (Circular 156): https://blog.saginfotech.com/gst-circular-no-156-dynamic-qr-code-b2c-invoices
- Razorpay QR docs: https://razorpay.com/docs/payments/qr-codes/ ; pricing: https://razorpay.com/pricing/
- Google Maps Route Optimization pricing: https://developers.google.com/maps/billing-and-pricing/pricing ; usage: https://developers.google.com/maps/documentation/route-optimization/usage-and-billing
- VROOM: https://github.com/VROOM-Project/vroom
- TallyPrime import: https://help.tallysolutions.com/getting-started-with-importing-data-into-tallyprime ; https://help.tallysolutions.com/import-data-from-xml-or-json
- ParallelDots ShelfWatch: https://www.paralleldots.com/shelfwatch ; Infilect: https://www.infilect.com/
- OkCredit product roadmap (YourStory, Mar 2021, via archive.org): https://yourstory.com/2021/03/product-roadmap-fintech-startup-okcredit-800-million-transactions
- Khatabook product roadmap (YourStory, Aug 2021, via archive.org): https://yourstory.com/2021/08/product-roadmap-fintech-startup-khatabook-10-million-msme-users
- Kirana Club growth (BestMediaInfo, Oct 2023): https://bestmediainfo.com/2023/10/here-s-how-kirana-club-is-emerging-as-the-linkedin-for-momandpop-shops-in-india ; Meesho acquisition (Jun 2026): https://www.adgully.com/post/16804/meesho-acquires-kirana-club-to-expand-digital-commerce-access-for-indias-13-million-kiranas
- Udaan retention (JPMorganChase, Aug 2025): https://www.jpmorganchase.com/newsroom/stories/powering-indias-growth
- Kirana battle 2026 (Inc42): https://inc42.com/features/the-battle-for-indias-kirana-stores-has-begun/
- Kirana digitisation stats (Cornell, May 2026): https://business.cornell.edu/centers/2026/05/13/indias-digital-pull-revolution/
