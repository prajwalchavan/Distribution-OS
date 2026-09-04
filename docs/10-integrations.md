<!-- Derived from the 2026-09-04 architecture synthesis (docs/design/SYNTHESIS.md §10). Edit here; the synthesis is the frozen source. -->

# Integrations

**Tally (R02 §6).** Pilot: "Download Tally XML (masters + vouchers) for a date range" plus a ledger-mapping screen (party → ledger, sales ledger per GST rate or single per the CA's convention, Round Off ledger, free goods as Actual vs Billed quantity, batch names as strings to avoid the 14-digit Excel bug). Vouchers carry a stable `<GUID>` so re-imports never double-post, and balance to the paisa with a Round Off line because Tally rejects the whole voucher otherwise. Acceptance: the CA imports a week of vouchers into a restored backup and the Sales Register matches to the paisa. Post-pilot month 2: Windows **Tally Connector in Node SEA** (single toolchain, resolved over Go/.NET) polling our API and POSTing to `localhost:9000` while TallyPrime is open, reporting `IMPORTRESULT`; signed only if a customer's IT requires it.

**Brand-DMS coexistence.** No brand DMS exposes distributor-facing APIs (R01 §6.2). Coexistence = docint ingestion of the brand's secondary invoices (§5), per-brand secondary-sales and closing-stock CSV exports in the brand's layout, and a Tally-XML-shaped read endpoint so brand extractors that "pull from Tally" can pull from us. `source = brand_dms_import` from day one.

**WhatsApp (R07 §10, R10 §2).** Meta Cloud API direct (no BSP fee); utility templates hi/en submitted in week 18 (approval takes days); "Reply 1 to confirm" keeps replies in the free 24-hour window; inbound webhook for free-text orders; per-tenant quota and per-message cost logged; BSP-swappable adapter. **Volume (resolved):** tiers designed on R07's 300-retailer model (~11k messages ≈ ₹1,265 ≈ $15/month); a Tarsun-sized tenant (~150 retailers, ~600 orders × 4 templates ≈ 2.4k messages ≈ ₹280 ≈ $3.5) sits inside a 3,000-message quota. MyOperator's claim that in-window utility messages become billable from 1 Oct 2026 is unverified on Meta's page; budget the worst case at ₹0.5 per order conversation.

**Maps.** Google Maps mobile SDK (free on native) behind `MapProvider`; Google Routes for stop sequencing within the India free tier; MapLibre + Ola tiles on web; Ola/Mappls swap if pricing changes.

**OTP.** Better Auth send hook → WhatsApp authentication → MSG91 SMS; DLT entity and template registered once.

**E-way bill and e-invoice (R05).** Recipient side: offline RS256 QR verification, IRN hash recompute, optional EWB pull with EWB API credentials only, optional GST taxpayer API session (30-day access, monthly OTP). IRP `Get IRN` is unusable by recipients. Outbound: invoice model IRN-ready (≤ 16-char numbers, HSN, place of supply, EWB fields) but no IRN generation until a tenant crosses ₹5 crore B2B; intra-Maharashtra EWB threshold and the on-hold June 2026 changes are fields, not dependencies. GSP sandboxes post-pilot.

**Imports.** Tally XML masters, Marg Excel, CSV profiles for items, parties, bill-wise outstanding, batch-wise opening stock; rate-limited jobs with checkpoint rows; the outstanding checkpoint is a mandatory sign-off screen.

**ONDC.** Vocabulary only (payment term enum, min_qty/case_size, serviceable pincodes, FSSAI/GST on tenant, `RET10` category mapping); NP-MSN at ~20 tenants; Tarsun can join via the DigiDukaan city partner when it reaches MMR, orders entering through the external-order adapter.
