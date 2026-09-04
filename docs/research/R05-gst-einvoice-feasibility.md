# R05 — GST e-invoice / e-way bill / DPDP feasibility for inbound invoice ingestion

Scope: can Distribution OS automatically ingest supplier invoices that carry an IRN + signed QR (Reliance Consumer Products, Guiltfree Industries) for a distributor recipient such as Tarsun Enterprises, and what are the outbound (IRN, e-way bill) and DPDP obligations. Date of research: 2026-09-04. Everything below is marked **[verified]** (read from the primary source cited) or **[unverified]** (recollection or secondary claim not confirmed in this pass).

Note on method: the session's web-search budget ran out mid-task; the rest of the research was done by fetching primary pages directly (NIC sandbox, GSTN tutorials, e-way bill API docs, GSP developer docs) and decoding sample payloads locally.

---

## 1. What is inside the signed QR code

**[verified]** The QR printed on an e-invoice encodes a JWS/JWT string (three dot-separated Base64url parts). Decoding the sample in NIC's own "QR code procedure" document (updated with a July-2025 sample) and the LogiTax sample gives exactly this structure:

Header:

```json
{
  "alg": "RS256",
  "kid": "4DE1544AE695BDC84EC7BC12F2F57F813F44E301",
  "typ": "JWT",
  "x5t": "TeFUSuaVvchOx7wS8vV_gT9E4wE"
}
```

Payload (note that `data` is a _stringified_ JSON, not a nested object):

```json
{
  "iss": "NIC",
  "data": "{\"SellerGstin\":\"37ARZPT4384Q1MT\",\"BuyerGstin\":\"29AWGPV7107B1Z1\",\"DocNo\":\"Test-00df1\",\"DocTyp\":\"INV\",\"DocDt\":\"14/07/2025\",\"TotInvVal\":2,\"ItemCnt\":1,\"MainHsnCode\":\"010190\",\"Irn\":\"d9476807f5496dea9fc65c6a954887db156022ba4b0d17a3687d43576beb8e17\",\"IrnDt\":\"2025-07-14 12:44:00\"}"
}
```

| Field       | Type / format       | Meaning                                         |
| ----------- | ------------------- | ----------------------------------------------- |
| SellerGstin | 15 chars            | supplier GSTIN                                  |
| BuyerGstin  | 15 chars (or "URP") | recipient GSTIN — must equal the tenant's GSTIN |
| DocNo       | 1–16 chars          | supplier's invoice number                       |
| DocTyp      | INV / CRN / DBN     | tax invoice / credit note / debit note          |
| DocDt       | dd/MM/yyyy          | document date                                   |
| TotInvVal   | number              | total invoice value incl. tax                   |
| ItemCnt     | 1–1000              | number of line items                            |
| MainHsnCode | 4–8 digits          | HSN of the line with the highest taxable value  |
| Irn         | 64 hex              | invoice reference number                        |
| IrnDt       | yyyy-MM-dd HH:mm:ss | IRN generation timestamp                        |

**Line items are NOT in the QR.** Only the ten fields above. Sources: NIC QR procedure PDF https://einvoice1.gst.gov.in/Documents/Qrcode_procedure.pdf ; LogiTax "Get Decrypted Signed QR Code" doc https://docs.logitax.in/Docs/Get_Decrypted_Signed_QR_Code ; field lengths from ClearTax docs https://docs.cleartax.in/cleartax-docs/e-invoicing-api/learn-e-invoicing-api-basics .

Two useful properties confirmed by decoding samples locally:

1. **Signature verification is offline-capable.** The JWT is RS256-signed by the IRP; NIC publishes the public key (.pem) and certificate (.cer) per "IRN generation period" for e-Invoice1, e-Invoice2 and sandbox at https://einvoice1.gst.gov.in/Others/Publickeys **[verified page exists; the key files are loaded by JavaScript, so download them manually once and store them in the backend; other IRPs (Clear, IRIS, EY, Cygnet) publish their own keys — the `kid`/`x5t` header tells you which key]**. The NIC FAQ confirms the printed QR "can be verified by anyone using the offline app".
2. **The IRN is a deterministic hash you can recompute.** Verified against both samples: `IRN = SHA256( SellerGstin + FY + DocTyp + upper(DocNo) )` with FY formatted `YYYY-YY` and no separators, e.g. `SHA256("37ARZPT4384Q1MT2025-26INVTEST-00DF1")` = the IRN above. This means that when the QR is unreadable, OCR'd GSTIN + invoice number + date + printed IRN can be cross-checked with a 256-bit checksum — a very strong validator for the vision-extraction path.

Practical scanning note **[verified]**: ClearTax's guidance says the QR should be printed at least 2 in × 2 in to scan reliably; the JWT is 600–900 characters, i.e. a dense QR. On-device decoding (ML Kit / ZXing) on a full-resolution photo is the right approach; do not decode from a compressed thumbnail.

---

## 2. How a RECIPIENT can obtain the full e-invoice JSON with line items

### 2.1 What the full e-invoice JSON contains

**[verified]** The `SignedInvoice` JWT returned by the IRP carries the complete schema v1.1 payload: `TranDtls`, `DocDtls`, `SellerDtls`, `BuyerDtls`, `DispDtls`, `ShipDtls`, `ItemList[]`, `ValDtls`, `PayDtls`, `RefDtls`, `EwbDtls`. Per line item the schema has: `SlNo`, `PrdDesc` (3–300 chars, optional), `IsServc`, `HsnCd`, `Barcde`, `Qty`, `FreeQty`, `Unit` (UQC master, e.g. PCS/BOX/CTN), `UnitPrice`, `TotAmt`, `Discount`, `PreTaxVal`, `AssAmt`, `GstRt`, `IgstAmt/CgstAmt/SgstAmt`, cess fields, `OthChrg`, `TotItemVal`, `OrdLineRef`, `OrgCntry`, `PrdSlNo`, `BchDtls{Nm, ExpDt, WrDt}`, `AttribDtls[{Nm,Val}]`. Schema-required item fields are only `SlNo, IsServc, HsnCd, UnitPrice, TotAmt, AssAmt, GstRt, TotItemVal`; validations add "Quantity and UQC are mandatory for goods". Source: https://einv-apisandbox.nic.in/version1.03/generate-irn.html .

Implications for our invoices: the JSON will reliably give description, HSN, qty, UQC, rate, discount, taxable, GST split and totals. It will **not** give MRP (no schema field), case size (only if embedded in `PrdDesc`, as in "…_120" / "x 90"), scheme "GST benefit %", or batch numbers unless the seller fills `BchDtls` **[unverified whether Reliance/Guiltfree populate BchDtls/FreeQty/AttribDtls; check on the first real pull]**.

### 2.2 The channels, ranked

| Channel                                                                                                                                    | Who can call                                                                              | Item-level?                                                                                                                                          | Window                                                                                             | Auth                                                                           | Verdict                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| A. GST portal e-Invoice "Received" tab (einvoice.gst.gov.in) — JSON/PDF/Excel download                                                     | supplier **and recipient**                                                                | Yes (signed e-invoice JSON)                                                                                                                          | 6 months from IRN date                                                                             | GST portal login (web UI)                                                      | Manual fallback; cross-IRP; **[verified]**                                                                         |
| B. GST common-portal taxpayer APIs exposed through a GSP/ASP: **Get e-Invoice by IRN**, **List Purchase e-Invoices (job)**                 | "authenticated taxpayer has to be a party — seller **or buyer**"                          | Yes (returns `SignedInvoice` + `SignedQRCode`)                                                                                                       | last 6 months                                                                                      | GST portal API access enabled + OTP session                                    | **Primary structured pull** **[verified via sandbox.co.in docs, which wrap the GSTN G2B API]**                     |
| C. IRP "Get IRN Details" (NIC core API)                                                                                                    | generator side; error 2226 "You are not authorised to get IRN data" for others            | Yes                                                                                                                                                  | 3 days                                                                                             | IRP API credentials of the _generator_                                         | Not usable by the recipient — see §3                                                                               |
| D. IRIS IRP "My Purchases – Download JSON" Data API                                                                                        | recipient, but only for IRNs generated **on IRIS IRP** and only if the supplier consented | Yes                                                                                                                                                  | t+2 days unless supplier opted into longer storage                                                 | IRIS consent + OTP                                                             | Niche; depends on the supplier's IRP choice **[verified]**                                                         |
| E. e-Way Bill API **GetEwayBill** (by EWB no) and **GetEwayBillsofOtherParty** (by date)                                                   | "Requestor GSTIN has to be supplier GSTIN or recipient GSTIN or transporter"              | Yes — `itemList[]` with productName, productDesc, hsnCode, quantity, qtyUnit, rates, taxableAmount                                                   | list API: any date within the last 3 days excluding today; GetEwayBill by number: no window stated | EWB API credentials (client id/secret via GSP + EWB sub-user; no per-call OTP) | Strong secondary source for shipments ≥ ₹50k; gives an _expected delivery_ feed before goods arrive **[verified]** |
| F. GSTR-2B API                                                                                                                             | recipient                                                                                 | **No** — invoice-level (ctin, inum, dt, val, pos, itc flags) plus rate-wise `items[]` with only rate/taxable/tax amounts; no HSN, description or qty | monthly, generated on the 14th                                                                     | GST API session                                                                | Reconciliation only **[verified via sandbox.co.in schema]**                                                        |
| G. IMS (Invoice Management System, live since 1/14 Oct 2024) APIs: Get Invoices, Save Status (accept/reject/pending), Reset, Supplier view | recipient                                                                                 | **No** item data; invoice-level with action status; data appears only after the supplier _saves/files_ in GSTR-1/IFF/1A                              | monthly cycle                                                                                      | GST API session                                                                | ITC workflow only, far too late for goods receipt **[verified]**                                                   |

Key sources:

- GSTN FAQ/manual "e-Invoice JSON download" (Advisory 605, Oct 2023): "Registered taxpayers, both suppliers and recipients … can download the e-Invoice"; "This facility is also accessible through G2B APIs and can be accessed via the GSP/ASP route. However, in API access, users will need to authenticate their credentials as well." https://tutorial.gst.gov.in/einvoice/files/FAQs_Manual_e-Invoice%20JSON%20download%20functionality.pdf
- sandbox.co.in (ASP on a licensed GSP) taxpayer e-invoice endpoints: `GET /gst/compliance/tax-payer/e-invoice/{irn}` — "To fetch an e-Invoice, the authenticated taxpayer has to be a party in the transaction, either the seller or the buyer"; "Only e-Invoices within the last 6 months can be fetched"; `POST /gst/compliance/tax-payer/e-invoices/{year}/{month}/purchases?supply_type=B2B` async job → signed JSON URL. https://developer.sandbox.co.in/api-reference/gst/compliance/guides/taxpayer/e-invoice/overview.md and https://developer.sandbox.co.in/recipes/gst/e-invoice/get_e_invoice_using_taxpayer_api.md
- IRIS IRP Data APIs: https://einvoice6.gst.gov.in/content/kb/my-purchases-view-invoices-download-json/ and https://einvoice6.gst.gov.in/content/kb/overview-of-data-apis/
- EWB APIs: https://docs.ewaybillgst.gov.in/apidocs/version1.03/get-eway-bill-details.html and https://docs.ewaybillgst.gov.in/apidocs/version1.03/get-other-party-eway-bill.html
- GSTR-2B / IMS: https://developer.sandbox.co.in/reference/gstr-2b-api ; https://developer.sandbox.co.in/api-reference/gst/compliance/guides/taxpayer/invoice-management-system/overview ; https://cleartax.in/s/invoice-management-system-ims-process-flow

### 2.3 Authentication for channel B (GST taxpayer APIs) — the operational reality

**[verified]** Flow as documented by sandbox.co.in (identical in substance for any GSP):

1. The distributor logs into gst.gov.in → My Profile → **Manage API Access** → Enable API Request = Yes → choose duration. Duration options range from **6 hours to 30 days**; the practical setting is 30 days. (learn.quicko.com, gstzen.in, cleartax.in/s/gst-api-access)
2. Our backend authenticates to the GSP with its API key/secret (24-hour JWT in sandbox.co.in's case).
3. Backend calls Generate OTP with the taxpayer's **GST portal username + GSTIN** (no password ever). OTP goes to the registered mobile/email.
4. Distributor types the OTP into our app → Verify OTP → taxpayer access token, **valid 6 hours**, refreshable without user action "until the maximum session duration set on the GST Portal is reached" (i.e. up to 30 days), after which a fresh OTP is needed.

Design consequence: the structured pull needs a recurring monthly "re-authorize GST" step by the owner, and the session must be refreshed by a scheduler every <6 h. The pipeline must degrade gracefully when the session has lapsed (fall back to QR + vision, queue the structured pull, and reconcile when the session is restored).

Latency: the GSTN FAQ says the JSON is available for "6 months from the date of IRN generation" but does not state how soon after generation the received IRN becomes visible on the GST side **[unverified; expect near-real-time to same-day since IRPs push to GSTN, but confirm with the first real invoice]**.

### 2.4 GSP/ASP pricing and sandboxes

- **[verified]** GSTN: "All the Core e-Invoice APIs are available Free of Cost on the respective IRPs" (https://tutorial.gst.gov.in/downloads/news/e-invoice_api_integration_guide_irps.pdf). The IRPs charge nothing; only the GSP/ASP middle layer (which handles encryption, tokens, the common-portal APIs) charges.
- **[verified]** No GSP publishes a rate card. TaxPro: "No onboarding charges! Free integration support!!" but pricing on request (https://taxpro.co.in/einvoice). MasterGST: contact sales (https://mastergst.com/gst/e-invoice-api.html). Masters India: "Cost is very minimal" (https://www.mastersindia.co/e-invoicing-api/). sandbox.co.in: plan + per-API cost calculator, enterprise on request (https://sandbox.co.in/pricing). ClearTax: contact-sales.
- **[unverified, market hearsay for budgeting only]** small-volume GSP/ASP access is typically priced as an annual plan in the low tens of thousands of rupees plus roughly ₹0.10–₹1 per API call; request quotes from TaxPro, MasterGST, sandbox.co.in, Adaequare (ugsp.adaequare.com) and Vayana before committing.
- **Sandboxes [verified]**: NIC sandbox (https://einv-apisandbox.nic.in) issues credentials to GSPs/ERPs and to taxpayers "with turnover above Rs 5 Cr"; testing uses GSP virtual GSTINs; no IP whitelisting on sandbox. IRIS IRP sandbox is open to solution providers (https://einvoice6.gst.gov.in/content/kb/manage-sandbox-access/); Clear IRP sandbox at https://irp-sandbox.clear.in/app/onboarding ; Cygnet at https://sandbox.einvoice3.gst.gov.in ; EY at https://sandbox.einvoice5.gst.gov.in . sandbox.co.in offers `test-api.sandbox.co.in`. MasterGST provides sandbox credentials via support. e-Way Bill pre-production access is requested by email from the registered ID (https://docs.ewaybillgst.gov.in/apidocs/on-boarding-process.html).
- Production onboarding at NIC requires a test summary report and IP whitelisting (up to 4 static IPs), 4–5 days; via a GSP the GSP holds the whitelisting and the taxpayer just creates "For GSP" API user credentials on the e-invoice / e-way bill portals (https://einv-apisandbox.nic.in/onboarding.html).

---

## 3. "Get IRN Details" on the IRP — generator only

**[verified]** NIC core API `GET /api/Invoice/irn/<irn>` requires the caller's IRP credentials (`client_id`, `client_secret`, `Gstin`, `user_name`, `AuthToken`; `sup_gstin` is allowed only for e-commerce operators). Validation: "IRN can be retrieved using this API within three days from the date of generation of IRN" (error 2283 "IRN details cannot be provided as it is generated more than {0} days prior"). Ownership errors exist: 2143 "Invoice does not belongs to the user GSTIN" and 2226 "You are not authorised to get IRN data — user is trying to get IRN details which he is not supposed to". Vayana's enriched "Verify e-invoice by IRN" describes the same call as "seller consent based" with a 3-day window. Sources: https://einv-apisandbox.nic.in/version1.03/get-eInvoicedetails.html ; https://einvoice1.gst.gov.in/others/geterrorcodes/INV ; https://docs.enriched-api.vayana.com/routes/enriched/Trade-Verification-Service/Verify%20EInvoice/apis/Verify-EInvoice-By-Irn/verify-einvoice-by-irn/

Conclusion: the distributor cannot use the IRP's Get-IRN API for Reliance's or Guiltfree's invoices. The recipient-side equivalents are channel B (GST taxpayer API, 6 months) and channel E (e-way bill API).

---

## 4. Outbound: when the distributor itself must generate IRNs

**[verified]** Applicability: e-invoicing is mandatory for registered persons whose aggregate turnover exceeds ₹5 crore (effective 1 Aug 2023), for **B2B supplies and exports only** — the IRP explicitly rejects B2C: "the API interface should not request for IRN for these transactions" (https://cleartax.in/s/e-invoicing-gst ; https://einv-apisandbox.nic.in/version1.03/generate-irn.html). **[unverified detail]** the enabling notification is No. 10/2023-Central Tax dated 10 May 2023 and the test is turnover in _any_ preceding FY from 2017-18. For Tarsun this matters in two ways: (a) most retailers in the observed invoices are unregistered, so those invoices never need an IRN; (b) only invoices to GST-registered retailers (e.g. Dhanlaxmi Super Market if it registers) need IRNs, and only from the FY after Tarsun crosses ₹5 crore.

Additional rules **[verified]**: 6-digit HSN is required on e-invoices for AATO > ₹5 crore (einvoice1 announcement, Notification 78/2020); the 30-day time limit for reporting invoices to the IRP applies from 1 Apr 2025 to taxpayers with AATO ≥ ₹10 crore (GSTN advisory 5 Nov 2024, per cleartax.in/s/e-invoicing-gst) — design the invoice pipeline to report same-day anyway; IRN generation only accepts document dates on/after 1 Apr 2025 today; cancellation of an IRN is allowed within 24 hours and a cancelled document number can never be re-registered (error 2278); max 1000 items per invoice.

IRN generation flow (NIC v1.03, mirrored by every IRP/GSP) **[verified]**:

1. Authenticate (client_id/secret + per-GSTIN username/password, encrypted app key) → `AuthToken` + `Sek` (AES session key); NIC advises reusing the token until expiry (TaxPro/MasterGST report ~6 h in production).
2. Build schema v1.1 JSON: `Version:"1.1"`, `TranDtls{TaxSch:"GST", SupTyp:"B2B"}`, `DocDtls{Typ:"INV", No (≤16 chars), Dt dd/MM/yyyy}`, `SellerDtls`, `BuyerDtls{Gstin, LglNm, Pos, Addr1, Loc, Pin, Stcd}`, `ItemList[]` (per §2.1, sums must reconcile within ±1 per item / ±2 on totals), `ValDtls`, optional `EwbDtls` to generate the e-way bill in the same call.
3. POST encrypted payload → response `Irn`, `AckNo`, `AckDt`, `SignedInvoice`, `SignedQRCode`, `Status:"ACT"`, `EwbNo/EwbDt/EwbValidTill`.
4. Render `SignedQRCode` as a QR (≥2 in × 2 in) on the printed/PDF invoice, store `SignedInvoice`, and expose IRN + Ack on the invoice.
5. Cancel IRN within 24 h if needed (must cancel any EWB first, error 2230).

Cost and access **[verified]**: IRP core APIs are free. NIC and Cygnet IRPs only give "Direct API" registration to taxpayers with turnover ≥ ₹100 crore, so a ₹5–100 crore distributor goes either through a GSP/ASP (paid, contact-sales) or **directly to Clear IRP or IRIS IRP, which are "open to direct integration for all B2B taxpayers with e-invoicing enabled"** (GSTN IRP comparison PDF). For Distribution OS as a multi-tenant vendor, the cleanest path is to register once as a solution provider/ASP (IRIS IRP "API Integrators" registration, Clear IRP onboarding, or a GSP such as TaxPro/MasterGST/sandbox.co.in) and onboard each distributor GSTIN under that partner; each distributor still creates its own API user on the IRP/e-way bill portal ("For GSP" option) and shares only the API username/password with us.

---

## 5. e-Way bill basics for outbound deliveries

**[verified]** From the official FAQ (https://ewaybillgst.gov.in/Staticpages/faq.aspx) and API docs (https://docs.ewaybillgst.gov.in/apidocs/):

- Required when consignment value exceeds ₹50,000 for inter-state movement; intra-state thresholds are set by each state ("please refer to the relevant statute/provisions passed by the respective States"). **[unverified]** Maharashtra's intra-state threshold is ₹1 lakh — confirm before hard-coding, because almost all of Tarsun's retailer deliveries are intra-state and below either number, so outbound EWBs will be rare; inbound EWBs from manufacturers are common (invoices B and C both carried EWB numbers).
- Part A (document, parties, HSN/items, value) + Part B (vehicle number or transport document). Part-A slip can be created with a transporter ID; validity starts on the first Part-B entry. Validity: 1 day per 200 km (or part), ODC 1 day per 20 km; expires at midnight of the last day; extension within 8 h before/after expiry by the transporter. Cancellation within 24 h of generation. Recipient can reject an EWB generated on its GSTIN (the "Get e-way bills generated on you by other parties" API exists "for rejecting the e-way bill, if required"). Sub-supply type 10 "Line Sales" exists for van sales (same pincode, up to 300 km) — relevant to the open van-sales question.
- Recent hardening **[verified]**: 2FA/MFA mandatory for all portal users from 1 Apr 2025; EWB generation restricted to documents dated within 180 days; extensions capped at 360 days (https://docs.ewaybillgst.gov.in/Documents/Advisory_on_Updates_to_EWB-updated.pdf). The June 2026 changes (mandatory Ship-to GSTIN in ExpShipDtls, voluntary "EWB closure" API after delivery, planned for 1 Aug 2026) were **put on hold by NIC on 30 Jul 2026** and marked "Withdrawn" on the sandbox announcements page (https://einv-apisandbox.nic.in/announcements.html ; advisory text at https://tutorial.gst.gov.in/downloads/news/advisory_einvoice_api_ewb_by_irn_approved.pdf). Keep the `ExpShipDtls.Gstin`/closure fields in the data model but do not depend on them.
- API mechanics: header `client-id`, `client-secret`, `gstin`, `authtoken`; body `{action:"GENEWAYBILL", data: AES(sek, base64(json))}`; response `ewbNo`, `ewayBillDate`, `validUpto`. Generate-by-IRN (`ewaybill-generation-irn`) is the simplest path when an IRN exists. Direct EWB API access is meant for ≥10,000 transactions/month per GSTIN with up to 3 whitelisted IPs, otherwise go through a GSP (https://docs.ewaybillgst.gov.in/apidocs/pre-requisites.html). Multi-vehicle: delivery challan per vehicle, last vehicle carries the invoice.

---

## 6. DPDP Act 2023 obligations relevant to retailer phone numbers and employee GPS traces

**[verified]** From PRS (https://prsindia.org/billtrack/digital-personal-data-protection-bill-2023) and Wikipedia's commencement table (https://en.wikipedia.org/wiki/Digital_Personal_Data_Protection_Act,_2023): the Act applies to digital personal data processed in India; consent must follow a notice describing the data and purpose and is withdrawable; "legitimate uses" without consent include data voluntarily provided for a specified purpose and processing "for employment purposes"; data fiduciaries must keep data accurate, maintain "reasonable security safeguards", notify the Data Protection Board and affected persons of breaches, and erase data "once the purpose has been met"; principals have rights to access, correction, erasure, nomination and grievance redressal; penalties up to ₹250 crore for failing security safeguards and ₹200 crore for breach-notification and children's-data failures. Commencement: Board and definitional sections from 13 Nov 2025; consent-manager provisions from 13 Nov 2026; **all remaining substantive obligations from 13 May 2027**. DPDP Rules 2025 were notified 14 Nov 2025 (Wikipedia; cleartax.in/s/dpdp-rules-2025) requiring precise notices, easy withdrawal, breach reporting to the Board and users "within specified timelines", and listing safeguards (encryption, access control, logging, backups, incident response). **[unverified]** Rule 7 sets the detailed breach report to the Board at 72 hours (extendable) — confirm against the gazette text before writing the incident-response SOP.

What this means for Distribution OS (a "data fiduciary" for the SaaS; the distributor is arguably a joint fiduciary for its own retailer/employee data — the contract should allocate roles):

| Data                                                                | Basis                                                                                                                                                                  | Concrete obligation to build now                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Retailer owner/shopkeeper mobile numbers, names, shop GPS           | Consent at onboarding (retailer self-signup) or s.7(a) voluntary provision for the specified purpose of ordering/delivery; a sole proprietor's number is personal data | Itemised notice at signup (purpose: orders, delivery, payment reminders); one-tap withdrawal that stops marketing messages; do not reuse numbers across tenants without consent; retention/erasure rules when a retailer is inactive; access/correction screen (already planned as self-edit); grievance contact in the app. Adjacent (not DPDP): TRAI DLT registration for promotional SMS **[unverified detail]** |
| Delivery/sales staff live GPS                                       | s.7(i) employment purposes, but proportionality applies                                                                                                                | Tell staff in writing what is tracked, when (duty hours only), who sees it, and for how long; hard-stop tracking outside shifts; role-limited access (owner + manager); retention cap (e.g. 90 days raw traces, aggregates thereafter); encryption at rest and in transit; audit log of who viewed traces                                                                                                           |
| Supplier/retailer contact fields inside e-invoice JSON (`Ph`, `Em`) | incidental                                                                                                                                                             | Minimise: strip or mask before storing the parsed invoice; keep the raw signed JWT encrypted for audit                                                                                                                                                                                                                                                                                                              |
| Breach handling                                                     | Rules 2025                                                                                                                                                             | Incident log, Board + user notification runbook, backups and access logging — the safeguards list from the Rules                                                                                                                                                                                                                                                                                                    |
| Children                                                            | s.9                                                                                                                                                                    | Not expected; block under-18 accounts in signup                                                                                                                                                                                                                                                                                                                                                                     |

The Act does not restrict cross-border storage except to notified countries, so an Indian-region cloud deployment is recommended but not strictly required **[verified]**.

---

## 7. Recommended inbound invoice architecture

Design principle: **QR first, structured pull where a session exists, vision extraction always, human commit always** (consistent with the "never auto-commit" decision).

```
photo/PDF captured (full quality)  ──►  Stage 1: on-device QR decode + JWT verify
                                          │  10 fields: IRN, GSTINs, DocNo/Dt, TotInvVal, ItemCnt, MainHSN
                                          │  dedupe on IRN, resolve supplier by SellerGstin,
                                          │  reject if BuyerGstin ≠ tenant GSTIN
                                          ▼
                     Stage 2a (async, if GST API session live): Get e-Invoice by IRN via GSP
                         → SignedInvoice JWT → verify RS256 → ItemList (authoritative financial skeleton)
                     Stage 2b (if EWB no. printed/known): EWB GetEwayBill → itemList (name/HSN/qty/UQC/taxable)
                     Stage 2c (pre-arrival feed): daily GetEwayBillsofOtherParty → "expected deliveries"
                                          ▼
                     Stage 3: LLM vision extraction on the full image (always)
                         → captures what JSON lacks: MRP, case size, batch/expiry, free qty, scheme %, GST-benefit %
                         → hard constraints from Stage 1/2: line count == ItemCnt, totals == TotInvVal ±2,
                           per-line AssAmt/GstRt/Qty must match JSON when present,
                           recomputed IRN hash must equal printed IRN when QR failed
                                          ▼
                     Stage 4: merge → SKU mapping (case-size parser: "x 90", "_120", UOM CS1) → review UI → commit to stock ledger
```

Stage details and what is certain vs not:

1. **Capture**: keep full-resolution images (decision already made). Also accept supplier PDFs (share-to-app / email-in) — SAP/DMS invoices from Reliance and Guiltfree are almost certainly also delivered as PDFs, and a vector PDF makes the QR decode and OCR near-perfect **[unverified that they email PDFs; ask Tarsun]**.
2. **QR decode + verify** (no network, no GST login): gives instant dedupe (IRN unique), supplier identity, header totals, and lets the app show "Verified e-invoice from Reliance Retail ₹54,597, 1 item" before any extraction runs. Verify the signature against the cached IRP public key; on `kid` mismatch, fetch/refresh keys. Treat an unverifiable QR as "unverified" but continue.
3. **Structured pull** (needs the distributor to enable Manage API Access for 30 days and pass an OTP once a month): one call per IRN, item list with HSN/qty/UQC/rates/discount. Retain the signed JWT as the audit copy. Expect gaps: MRP and scheme fields absent; batch numbers only if `BchDtls` filled; `PrdDesc` may be truncated at 300 chars. Budget: one GSP API call per inbound invoice plus OTP/refresh calls — trivial volume.
4. **EWB path**: works without the GST-portal OTP dance (EWB API user credentials only), gives item names/HSN/qty/unit/taxable for every shipment ≥ ₹50k, and the by-date list shows shipments generated on the tenant's GSTIN up to 3 days back — a natural "expected deliveries" inbox and the reconciliation anchor against the LR (document type D). It does not carry unit price/discount/MRP.
5. **LLM vision extraction** (Document Intelligence decision): still required for (a) suppliers without IRN (Guru Kripa, any micro supplier), (b) fields absent from the JSON, (c) multi-page invoices where page 2 is a photo. The QR/JSON fields become validators, which is what makes review fast: a line-count and total match should be shown as green checks.
6. **Review + commit**: keep human commit. Recommended change for later (flagged, not a decision): allow a one-tap "accept all" when the JSON signature verified, every line mapped to a known SKU, and Stage 3 agreed with Stage 2 — still a human tap, but 5 seconds instead of 5 minutes.
7. **Reconciliation jobs (monthly)**: purchase e-invoice list job (6-month window) → detect invoices received but never scanned; GSTR-2B/IMS → ITC status for the accountant. Not part of goods receipt.

Verified vs uncertain, in one place:

| Claim                                                                                                      | Status                                                                                                         |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| QR = RS256 JWT with 10 header fields, no line items                                                        | verified (decoded NIC + LogiTax samples)                                                                       |
| IRN = SHA256(GSTIN+FY+DocTyp+upper(DocNo))                                                                 | verified on two samples                                                                                        |
| Recipient can download full received e-invoice JSON on GST portal for 6 months; G2B API exists via GSP/ASP | verified (GSTN FAQ)                                                                                            |
| A GSP exposes buyer-side Get e-Invoice by IRN with 6-month window                                          | verified (sandbox.co.in docs); other GSPs presumably expose the same GSTN API — confirm with the chosen vendor |
| IRP Get-IRN is generator-only, 3-day window                                                                | verified                                                                                                       |
| EWB GetEwayBill returns itemList and allows recipient GSTIN                                                | verified                                                                                                       |
| GSTR-2B/IMS are invoice-level only                                                                         | verified                                                                                                       |
| GST API session: enable on portal (6h–30 days), OTP, 6-hour tokens, refresh                                | verified                                                                                                       |
| IRP core APIs free; Clear/IRIS IRP direct API for any enabled taxpayer; NIC direct needs ≥₹100 Cr          | verified                                                                                                       |
| GSP price points                                                                                           | unverified (no public rate cards)                                                                              |
| Latency between IRN generation and availability to the recipient on the GST side                           | unverified                                                                                                     |
| Whether Reliance/Guiltfree fill BchDtls / FreeQty / AttribDtls                                             | unverified                                                                                                     |
| Maharashtra intra-state EWB threshold ₹1 lakh                                                              | unverified                                                                                                     |
| DPDP Rule 7's 72-hour breach report                                                                        | unverified                                                                                                     |
| e-invoice enabling notification no. 10/2023-CT                                                             | unverified (threshold and date verified)                                                                       |

---

## 8. Build-order recommendations

1. Ship Stage 1 (QR decode/verify) and Stage 3 (vision) first — no external accounts needed; they cover 100% of invoices, including non-IRN suppliers.
2. In parallel, open sandbox accounts: NIC e-invoice sandbox (as ERP/solution provider), Clear IRP or IRIS IRP sandbox, one GSP/ASP with taxpayer APIs (sandbox.co.in exposes the buyer-side e-invoice and IMS/2B calls in test), and EWB pre-production by email. Get written quotes for per-call pricing.
3. Add Stage 2b (EWB) before Stage 2a — lower auth friction and it yields the "expected deliveries" feature for the manager app.
4. Add Stage 2a with a monthly re-authorisation UX for the owner; never make it a prerequisite for receiving stock.
5. Outbound IRN/EWB generation is not needed for Tarsun until it crosses ₹5 crore and sells to registered retailers; keep the invoice model IRN-ready (16-char invoice numbers, 6-digit HSN, UQC codes, item-level discount, ±1/±2 rounding rules, seller/buyer PIN and state codes) so the switch is a configuration change.
6. Write the DPDP notice text for retailers and staff now (it is cheap) and set retention defaults for GPS traces; the hard deadline for full compliance is 13 May 2027, but breach-safeguard hygiene should be in place from day one.
