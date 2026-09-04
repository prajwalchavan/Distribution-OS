# Completeness critique of SYNTHESIS.md — what a developer still cannot code on Monday

Date: 2026-09-04. Reviewed: `design/SYNTHESIS.md` (629 lines), `CONTEXT.md`, research R01–R10, and the repo skeleton at `/Users/prajwalchavan/Desktop/Distribution OS` (docs/00–15, ADRs 0000–0014, `backend/db` schema + 4 migrations, `shared/domain`, api modules mostly README stubs).

Severity legend: **[BLOCK]** cannot start the affected slice without deciding this; **[MUST]** must be pinned before the slice that uses it ships; **[SHOULD]** quality/robustness, schedule when convenient. Where a fix changes a decision in CONTEXT/SYNTHESIS it is marked **[recommended change]** with the reason.

Two facts already resolved in the repo docs but not in the synthesis (the synthesis still asks them as "questions before week 1"): invoice F is printed by **TradeEzee ERP** (Windows), not Marg; Too Yumm's DMS is **FieldAssist**, confirmed by screenshot. Every mention of a "Marg Excel profile" below therefore means a TradeEzee export profile; get sample exports from Tarsun in week 1.

---

## 1. Brand-DMS coexistence (Too Yumm on FieldAssist)

1. **[BLOCK] DMS invoices only enter the system at "day-end", so delivery, collection and returns for a third of retail billing have no home during the day.** §6 says "Day-end: Too Yumm DMS invoices photographed and committed". But a Too Yumm bill printed at 9 am is loaded on a van at 10 am, delivered at noon and cash collected at the door. If it only exists in our ledger at 7 pm, the delivery app cannot show the stop, the receipt cannot allocate to the bill, and the settlement cockpit's "expected cash" is wrong all day.
   **Fix:** make DMS-invoice capture a _pre-load_ step, not a day-end step. Commit of a `brand_dms_invoice` creates, in one transaction: a `sales_orders` row (`source = brand_dms_import`, state `packed`, no reservation), an `invoices` row in an `external` series carrying the DMS number, and a candidate trip stop. From there pick/load/deliver/collect/return work unchanged. Day-end becomes a _reconciliation_ ("DMS printed 23, we committed 23").

2. **[MUST] Order-less flow is not modelled.** The Too Yumm salesman is manufacturer-employed and books in FieldAssist SFA; we never see the order, so `pending-undelivered`, ATP and "suggested order" are blind for that brand, and the DMS reserves stock we do not know about.
   **Fix:** per-brand `fulfilment_mode enum[own, brand_dms]` on `tenant × brand`. For `brand_dms` brands: ATP shown to our reps/retailers is hidden or marked "billed via brand system"; no reservation step; suggested orders are computed from committed DMS invoices instead of orders. State this explicitly so the sales screens do not show Too Yumm as orderable when the founder does not want that.

3. **[MUST] Stock double-book with the DMS is not addressed.** Our ledger has the GRN (invoice C by photo); FieldAssist has its own stock (the operator keys the primary invoice there, or the brand pushes it). Nothing reconciles the two.
   **Fix:** a weekly "DMS stock reconciliation" screen: our closing stock per Too Yumm variant vs a photographed/typed DMS closing-stock report, with a variance list. Also add the brand's primary invoice number to `supplier_invoices` so the same invoice can be found in both systems.

4. **[MUST] Double posting into Tally.** R02 §8 open question: if the CA already keys DMS invoices into Tally, our Tally export will post them twice.
   **Fix:** per-brand `tally_export_source enum[dos, brand_dms, none]`; the exporter and the GSTR-1-shaped register both filter on it and label rows by `source`.

5. **[MUST] Claims for DMS brands.** Claims for Too Yumm are raised inside FieldAssist (R01 §6.1). The `claims` module will otherwise accrue claims that are settled elsewhere.
   **Fix:** `schemes.claim_channel enum[dos, brand_dms]`; DMS-brand accruals are tracked as `settled_externally` with a reference field, never submitted from our side.

6. **[SHOULD] `applied_rules` for DMS lines.** Invoice E carries "Secondary Dis %" and "Cash Dis %" computed by the brand with no scheme id of ours. Define a rule kind `external_dms_discount {label, pct, amount}` so the bill re-prints exactly and the pricing engine never tries to re-derive it.

7. **[SHOULD] Retailer/item id mapping persistence.** `Buyer ERP Id`, `Item ERP Id` are mentioned as "brand-DMS ids" on retailers and `product_external_codes`. Make them a proper table `external_party_codes(tenant_id, system enum[fieldassist, ...], code, retailer_id)` so a second brand DMS (Reliance for Campa) does not need a schema change.

## 2. Case / pieces UoM conversion

8. **[BLOCK] Which case size wins is undefined.** Three candidates exist: `product_variants.default_case_size`, `supplier_pack_configs.pcs_per_case` (per supplier), `tenant_products.case_size_override`. Nothing says which one the order stepper, the picklist, the invoice ("2 cs") and the scheme trigger (`unit:'case'`) use, or what happens when a variant is bought from two suppliers with different cases.
   **Fix:** split the concept: **buy-side pack** (`supplier_pack_configs`, used only in procurement/GRN) and **sell-side pack** (`tenant_products.sell_case_size`, default from `default_case_size`, editable by the owner, used by orders, picklists, invoices, schemes). Document the precedence as one function `sellCaseSize(variant, tenantProduct)` in `shared/domain`.

9. **[MUST] Case size per lot is missing.** R09 §4: promo packs "(16+5.5)" change the case size per batch/MRP. `stock_lots` has batch, MRP, expiry but no pack size, so a picklist consolidated "by SKU" can tell the picker "3 cases" for a lot that has 96, not 120, pieces.
   **Fix:** add `case_size int` to `stock_lots` (copied from the GRN line) and print lot-level case equivalents on picklists.

10. **[MUST] Invoices that state neither pieces nor case size (invoice B: 700 CS1, MRP/Each 15, Rate/Unit 135.43).** Step 6 "triangulate" has no fallback when the printed invoice gives no piece count and the master has no pack config yet.
    **Fix:** define the review-screen rule: case size unknown → red line, reviewer types the case size (the second permitted typed number, measured like the gate count), upsert `supplier_pack_configs`. Say so in §5.1.

11. **[MUST] Rate precision breaks "integer paise everywhere".** 135.43 ₹/case ÷ 12 = 11.2858 ₹/piece; storing that as integer paise loses 0.58 paise/piece × 8,400 pieces = ₹48 on one invoice, so AP and landed cost will not tie to the printed invoice. **[recommended change]** Keep integer paise for _amounts_; store _rates_ as invoiced (`rate` + `rate_basis enum[piece, case]` + `basis_qty`) and derive per-piece cost as `numeric(14,4)` in `tenant_product_costs`. Sell-side rates stay integer paise per piece (invoices E/F print 2-decimal per-piece rates).

12. **[MUST] Order lines do not record how the quantity was entered.** Brand schemes are per case, retailers say "one box", bills print "2 cs + 3 pcs". Add to `sales_order_lines`/`invoice_lines`: `entered_unit enum[piece, inner, case]`, `entered_qty`, `pack_size_at_entry`. Without it the printed "Qty" and the scheme trigger cannot be reconstructed after a case-size change.

13. **[SHOULD] `reward.free_qty` has no unit** in `SchemeRule` (`trigger.unit` has one). Add `reward.unit`. Also define slab semantics (highest achieved slab only, not cumulative) and free-goods distribution for `mix` triggers (fixed `freeVariantId`, else cheapest qualifying line).

## 3. Scheme + discount stacking precedence

14. **[BLOCK] "Schemes stack" has no arithmetic.** Two `line_pct` rules: additive (5%+3% = 8% of gross) or compounding (gross × 0.95 × 0.97)? Invoice E applies "Secondary Dis %" then "Cash Dis %" sequentially on the running net (compounding). Golden tests "from invoices E/F" cannot be written until this is fixed.
    **Fix — canonical order, one pure function `priceOrder()` in `shared/domain`:**
    1. `unit_price` = retailer override else tier price (per piece, integer paise).
    2. `gross` = unit_price × billed qty (free qty excluded from billed qty, printed in its own column).
    3. Line schemes in `priority asc, id asc`: `free_qty` first (money-neutral unless `net_scheme_amount`), then each `line_pct`/flat rule applied to the running net, **compounding**, rounded half-up to paise per step; the first rule with `final = true` stops the chain.
    4. Order-level rules (`order_pct`, `net_scheme_amount`, value slabs) computed on Σ scoped line nets and **allocated to lines by largest remainder** (`allocate()`), so taxable value is per line and per GST rate.
    5. Approved bargain last, per line, on the running net, within the rep's bound.
    6. Cash discount per mode (see 16).
    7. Tax per line at the lot's dated HSN rate, half-up to paise; footer sums by rate; invoice total rounded to the nearest rupee (s.170) with the residue posted to Round Off.
    8. Guard: net rate ≤ MRP per piece (Legal Metrology) → warn.
       Replace the current `resolvePrice()` in `shared/domain/src/pricing` (it takes one line, has no order context, no slabs, no priority, no allocation) with this function; keep it as a thin wrapper only if tests depend on it.

15. **[MUST] Bargain bound basis is undefined.** "Discounts within owner-set limits" — % of net, ₹ per case, or a floor price? Define `rep_auto_approve_bounds(rep_id, scope, max_pct_bps, max_per_piece_paise, floor_basis enum[tier_price, ptr])`; the request stores the basis it was evaluated on.

16. **[MUST] Cash discount has two legal shapes and the synthesis picks only one.** ADR 0004 says CD is "conditional realised at receipt"; invoice E prints "Cash Dis %" _on the invoice_, reducing taxable value at supply (s.15(3)(a)). A post-supply CD needs a (financial) credit note. **[recommended change]** per tenant × brand `cash_discount_mode enum[on_invoice, at_receipt_financial_cn]`; both stamp `applied_rules`; the receipts screen realises the conditional kind and issues the CN automatically inside the window.

17. **[SHOULD] Applicability set algebra.** `applicability: {tiers?, retailerIds?, beatIds?}` — union or intersection? Define: any listed dimension restricts; multiple dimensions intersect; empty = all. Also define scope overlap: a brand rule and a variant rule both matching stack unless one is `final`.

18. **[SHOULD] GST on free goods and registers.** `gstOnFreeGoods` exists but the register/print behaviour is not stated: 10+1 on the same invoice = composite supply, free line printed at ₹0 with qty, HSN summary counts _actual_ qty (Tally Actual vs Billed). Write it into the invoice field spec.

## 4. GST invoice numbering

19. **[BLOCK] Offline legal numbering for van sales is impossible with the current design.** ADR 0001 allocates numbers server-side under `SELECT … FOR UPDATE`; §4.4 says van-sales orders are invoiced at delivery _from the vehicle_ — offline. The crew cannot print a legal invoice.
    **Fix [recommended change]:** Rule 46(b) allows multiple series. Add `numbering_series.allocation_mode enum[server, device]`; per-vehicle series (`V1/`, `V2/`) are allocated on the issuing device (exactly one "issuer" device per vehicle per trip, chosen at trip start; the second phone cannot issue) and reconciled on upload; server series remain for warehouse billing. CI test: replay two trips' uploads and assert no duplicate `(tenant, series, fy, no)`.

20. **[MUST] Rule 46 character set, gaps and cancellation.** Not stated: numbers are ≤16 chars from `[A-Za-z0-9/-]`, consecutive per series per FY, never reused; a number is allocated only at _issue_ (pack), never at draft, so abandoned drafts leave no gaps. Invoices cancelled before dispatch (order cancelled after pack, before GSTR-1) keep their number with `status = cancelled` and reverse stock/AR by compensating rows; after dispatch only a credit note. The synthesis's "never regenerated, credit notes instead" needs this `cancelled` state or the manager will be forced to issue a CN for a bill that never left the godown.

21. **[MUST] Financial year and timezone.** Nothing in the synthesis names `Asia/Kolkata`. FY rolls at 00:00 IST on 1 April; a pack at 23:40 IST on 31 March (18:10 UTC) must land in the old FY; ageing buckets, day-end, `reporting.rollup` and "collected today" are all IST dates. Devices may carry wrong clocks.
    **Fix:** one `businessDate(ts)` helper in `shared/domain` pinned to IST; server assigns invoice date/FY for server series; for device series the device timestamp is used and a clock-skew check on upload (> 10 min) raises a `sync_errors` warning (never 4xx).

22. **[MUST] Document types beyond Tax Invoice.** Missing entirely: **Delivery Challan** (Rule 55) for stock moving to a vehicle for van sales and for godown transfers — goods on a van without an invoice need one; **Bill of Supply** (if any tenant is composition/exempt — flag as later); **consolidated daily B2C invoice** (s.31(3)(b)) if the Campa thermal slip G is treated as a < ₹200 cash memo rather than an invoice. Decide for the pilot: van slips are tax invoices from the vehicle series (simplest), and every van load prints a delivery challan from the load sheet.

23. **[SHOULD] Series seeding and external series.** Migration must continue TradeEzee's `GL/` series (start at 1687) or start `DOS/1` — CA decision; add `starting_no` to the import. DMS invoices need a `series_code = 'EXT-FA'` with `allocation_mode = external` so the uniqueness index `(tenant, series, fy, no)` holds and no number is generated.

## 5. E-way bill

24. **[MUST] Van loads and godown transfers are the only movements likely to cross ₹1 lakh, and they are not covered.** §10 treats EWB as "fields, not dependencies", but a mixed van load can exceed the Maharashtra intra-state threshold on day one.
    **Fix:** at check-out compute the load value (delivery challan value incl. tax, excl. exempt goods) against `tenant_settings.ewb_intra_state_threshold` (default ₹1,00,000, state-configurable); above it, the load sheet is blocked until the manager records an EWB number generated manually on the portal (pilot path), with the GSP path replacing the manual entry later. Same check per invoice for the rare large B2B bill.

25. **[SHOULD] Inbound EWB usage.** Record `validUpto` from inbound EWB numbers (invoices B, C) and flag arrivals after validity on the LR panel — it is evidence for transporter claims.

## 6. Retailer identity across distributors

26. **[MUST] Person vs shop is conflated.** `retailer_identities` is keyed on one phone; a shop has an owner and a counter boy, and one person owns two shops. As designed, a second phone for the same shop cannot log in, and the two-shop owner sees one card.
    **Fix:** identity = person (phone); tenant `retailers` = shop; `retailer_links(identity_id, tenant_id, retailer_id, role enum[owner, staff], status)` allows N identities per shop and N shops per identity. The PWA shows one card per link.

27. **[MUST] Existence leak at onboarding.** A rep entering a phone that already exists globally must not learn it is another distributor's retailer. Define: rep onboarding always creates the tenant `retailers` row; the global identity is created/linked server-side on the retailer's first OTP login; the rep UI never queries the global table.

28. **[MUST] Recycled numbers.** Indian numbers are reissued. Define: OTP login on a number whose links have been inactive > 6 months requires the distributor to re-confirm the link (approval item) before ledger data is shown.

29. **[MUST] Per-link consent, not per-identity.** DPDP notice names the fiduciary (each distributor); one consent version on `retailer_identities` cannot cover tenant B. Move `consent_version/at` to `retailer_links`.

30. **[SHOULD] Duplicate retailers within a tenant.** Reps will create "Shree Shakti" twice. Add `retailers.merged_into` with the same rule as products: rewrite links/codes, never ledger rows; outstanding is summed by the view.

31. **[SHOULD] Directory projection.** Specify exactly what a discovering distributor sees (shop name, area/pincode, category, opt-in date) and never sees (other tenants, outstanding, tier, credit), and whether an unlinked retailer may self-sign-up on the PWA (recommend yes: directory only).

## 7. GPS privacy for employees (DPDP)

32. **[MUST] Basis and refusal path.** The synthesis says "consent recorded once". Under s.7(i) the basis is employment; the instrument is a _notice_ plus proportionality, and the staff member cannot meaningfully "refuse" while doing the job. Define: `location_consents` stores the acknowledgement of the notice (hi/en text, version, time, device); if OS permission is denied or revoked, the trip still starts with a visible "location unavailable" flag to the owner — never block work.

33. **[MUST] Trace access audit.** Audit log is listed for approvals, price, credit, cost views — not for GPS traces. Add `audit_log` rows on every trace/live-map read by owner/manager; only owner + manager roles; the retailer gets ETA only, never a trace (say this in the notice since it is a disclosure to a third party).

34. **[MUST] What survives 90 days.** `dpdp.gps_retention` drops raw `trip_points`; trip summaries, stop lat/lng and `pod_evidence` coordinates are business records kept with the invoice. Write the retention table (data class → period → basis) into `docs/compliance/retention.md`, including rep check-in geo-tags.

35. **[SHOULD] Ex-employee rights.** `dpdp.erasure` is scoped to retailers in the text. Add the employee case: on membership end, traces older than the retention window are already gone; identity rows are pseudonymised after 1 year; the runbook lists what cannot be erased (ledger rows carry `actor_id` — keep the id, drop the profile).

## 8. Hindi UX

36. **[MUST] Script policy is undecided.** The synthesis itself writes "Aaj ka beat" (Hindi in Latin script) while shipping a `hi` Devanagari locale. Field staff often read Hinglish faster than Devanagari; retailers in Kalyan may want Marathi. Decide with Tarsun's crew in week 6: locales `en`, `hi` (Devanagari), and `hi-Latn` (Hinglish) as the staff default candidate; Latin numerals always; dates `dd/MM/yyyy`; brand and product names untouched.

37. **[MUST] Retailer language preference is not stored.** WhatsApp templates are per-language; add `retailer_links.preferred_lang` (default per tenant) and a `tenant_settings.default_lang`.

38. **[MUST] PDF renderer and Devanagari embedding are unspecified.** "PDF rendered by the API" — with what? Shop names will be in Devanagari; Marg-shaped tables need page breaks; van slips need 58/80 mm layouts.
    **Fix:** decide now: HTML templates + headless Chromium (Playwright) in the _worker_, Noto Sans Devanagari embedded, `@page` variants A4 and 80 mm, PDF cached in S3 keyed by `(invoice_id, version)`. Snapshot-test the PDFs.

39. **[SHOULD] Search tolerance.** Product search on device (SQLite) and server (`pg_trgm`) must match "campa", "कैम्पा", "kampa". Add Devanagari/Latin aliases to `product_aliases` and a normalised search column on the synced `tenant_products_sell_view`.

40. **[SHOULD] Translation workflow for one developer.** en keys authored by the dev, hi/hi-Latn generated by LLM and reviewed by Tarsun's staff; CI fails on missing keys; template bodies share keys with the UI (already stated). Amount-in-words stays English.

## 9. Backup / restore drills

41. **[MUST] The drill is named, not specified.** Write the runbook now (ticket 8 below): restore PITR to a scratch RDS → run migrations check → run `SELECT` checksums (Σ `stock_balances`, AR per party, invoice counts per series) against the production values captured at the same LSN → boot the API against it → **re-create the PowerSync replication slot and prove a device resyncs** (this is the scary half; after a real restore every device does a full resync and re-uploads its queue, which is why the idempotency keys exist) → record RTO measured. Monthly, result in `docs/pilot/`.

42. **[MUST] Object Lock retention and blast radius.** State the retention period (recommend 35 days compliance mode), that the backups bucket lives in a separate AWS account or at least a separate KMS key and deny-delete policy, and that S3 `docs` has versioning + 90-day noncurrent expiry. RPO 5 min assumes WAL archiving is on Single-AZ — verify in the drill.

43. **[SHOULD] Per-tenant undo and tenant export.** PITR is whole-database; a bad import for one tenant is undone by batch id (compensating rows), never by PITR — say so and make every import reversible by `import_job_id`. Add a "export all my data (CSV bundle)" job: DPDP portability, churn insurance, and a sales argument against Marg lock-in.

## 10. Data migration from TradeEzee / FieldAssist / the physical file

44. **[MUST] Three sources of outstanding, one truth.** Outstanding lives in TradeEzee, FieldAssist and the physical file; CONTEXT says the file is what Tarsun trusts. The synthesis names `retailer_ledger_migration` with a checkpoint but not the procedure.
    **Fix:** per retailer, import open bills from both systems (bill no, date, amount, `source`), compare the sum to the file, owner resolves each variance on the checkpoint screen, then **WhatsApp each retailer its opening balance with "Reply 1 to confirm"** — doubles as retailer onboarding and DPDP notice delivery. Disputed balances stay `unconfirmed` and are excluded from reminders.

45. **[MUST] Opening stock has no batches.** TradeEzee likely holds SKU-level stock. Define the `opening` lot convention (`batch_no = 'OPENING'`, MRP required, expiry nullable), that FEFO ignores unknown expiry, and that opening lots must be counted (cycle count) in week 21.

46. **[MUST] Sales history for suggested orders.** "Suggested v1 (median inter-purchase gap)" needs 6–12 months of history that the OS will not have at launch. Import TradeEzee bill headers + lines into `retailer_purchase_history` (no ledger effect, `source = migration`) rather than as invoices.

47. **[MUST] Item mapping reuses the docint matcher.** TradeEzee item names → global variants is the same problem as SKU matching; say the import profile calls `backend/docint/matcher` with the same bands and review chips, so masters are not mapped twice by hand.

48. **[SHOULD] Cut-over runbook.** One page: freeze TradeEzee at time T, final outstanding + stock snapshot, series decision (23), first bill from the OS, TradeEzee kept read-only for 30 days, rollback criteria (e.g. two consecutive days of unreconciled cash). Parallel run: who double-keys, and the daily reconciliation report format (bills, totals, outstanding delta, stock delta).

## 11. Test strategy

49. **[MUST] Golden fixtures have no format or home.** "100+ golden tests from invoices E/F" — define `docs/fixtures/pricing/*.json` as `{inputs: {lines, schemes, retailer, date}, expected: {lines[], footer}}` typed from the printed invoices to the paisa, and the docint ground truth as R06 §8 JSON. Fixtures are the spec; write E and F in week 6 before the engine.

50. **[MUST] Acceptance thresholds for docint are missing.** "Scored in week 10" against what? Recommend: line recall ≥ 98 %, amount fields ≥ 99.5 %, ≤ 1.5 reviewer edits per 10-line invoice, zero unflagged hallucinated lines on the eval set; below that the pipeline ships in "assist" mode with typing allowed and measured.

51. **[MUST] "10× Tarsun" has no numbers.** Fix the load model: ~150 retailers, 8 staff, ~30 orders/day, 3 vehicles → k6 at 300 orders/day, 80 devices syncing, 3,000 GPS points/hour, 50 concurrent `/sync/upload`, docint 50 pages/hour. Put it in `infra/scripts/k6/README`.

52. **[SHOULD] Missing test kinds:** property-based tests (fast-check) for `allocate()`, GST split and rounding; expand/contract check in CI (previous image's API against the new schema); PDF snapshot tests; a test that enumerates every table with `tenant_id` and asserts FORCE RLS + policy (the repo's `rls.test.ts` is the seed); Maestro on a local emulator before each store release, not per PR (runner cost); a Tarsun-shaped seed (`db:seed`) with fixed counts used by integration, Maestro and k6.

## 12. Security (margin leak and more)

53. **[MUST] Purchase price leaks through the document store.** A salesperson with a pre-signed URL to an inbound invoice image sees every purchase rate. §11 says "short-TTL signed URLs" but not role scoping.
    **Fix:** URL signing is an oRPC procedure that checks the CASL ability on the _document type_ (`supplier_invoice` images: owner/manager/accountant only); `documents` rows are absent from `rep_scope`; the role-leak CI dump also asserts no `documents` metadata reaches the salesperson device.

54. **[MUST] Scheme funding fields leak the margin structure.** `fundingSource`, `claimable`, `claimWindowDays` and claim amounts tell a rep that "the company funds 8.33 %". The `tenant_sell_side` stream must project `schemes` through a view without those columns; claims never sync to reps.

55. **[MUST] Local database at rest.** The rep's phone holds every retailer's phone and outstanding; B deferred SQLCipher "until a customer demands". **[recommended change]** enable SQLCipher via op-sqlite from day one with a key in Keychain/Keystore — it cannot be retrofitted without re-creating every device DB, and DPDP Rules list encryption among "reasonable safeguards". Wipe on device revocation at next connect.

56. **[MUST] Platform `support` role.** Curator/support can read tenant data; define time-boxed "support access grants" approved by the owner and audited, or the first security questionnaire from a brand fails.

57. **[SHOULD] Owner phone app-lock** (biometric/PIN) for the `costs` stream and profit view — the owner's phone is routinely handed to staff. PowerSync JWT TTL (recommend 5 min) vs long staff sessions; document the revocation latency.

## 13. Other gaps found while reading

58. **[MUST] WhatsApp opt-in.** Meta requires opt-in for business-initiated templates. Record opt-in at rep onboarding (notice + checkbox) and via the first "Reply 1" confirmation; handle STOP; per-retailer `whatsapp_optin_at`. Not in the schema list.

59. **[MUST] Delivery challan for van loads** (see 22) and the check-out transaction: `transfer_out/transfer_in` posts stock but the load sheet is not a legal document today.

60. **[SHOULD] Invoice `status = cancelled`** and a `cancellations` reason enum (see 20); GSTR-1 register shows cancelled numbers.

61. **[SHOULD] TDS/TCS (194Q/206C(1H))** only bite above ₹50 lakh per party per FY — irrelevant for kiranas but a sub-distributor sale could; keep as fields on `retailers` (PAN) and later.

62. **[SHOULD] Retailer app authentication for the PWA on a shared shop phone** — long sessions on a device that several people use; recommend 30-day sessions with re-OTP for ledger screens.

---

## 14. The exact first 10 tickets (calibrated to the skeleton already in the repo)

The repo already has: monorepo + CI, Postgres 17 Compose, `backend/db` schema for all modules with migrations 0000–0003 (FORCE RLS, ledgers, views), `withTenant()`, header-trusting `TenantGuard`, oRPC `health`/`tenancy`/`catalog`/`tenant-catalog`, `shared/domain` money/GST/ids/quantity/state machines/`resolvePrice`, three frontend app shells, a worker with an outbox relay. Everything below builds on that; each ticket is ≤ 3 days and has a testable "done".

| #   | Ticket                                                                                                                                                                                                                                                                                                                                | Done when                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Stack spike on the real skeleton**: Better Auth (`phoneNumber`, `organization`, `jwt`) mounted in `modules/identity` on NestJS 12/Fastify; pg-boss 12 and Drizzle 0.45 already run — add Sentry + `@nestjs/observe`; PowerSync India-region check; ADR 0011 updated with the outcome                                                | Login by OTP (stubbed sender) returns a JWT with `{sub, tenant_id, role, beat_ids}`; a PowerSync `auth.parameter('tenant_id')` query accepts it (spike repo or Node SDK); ADR 0011 says "Nest 12" or "Nest 11" |
| 2   | **Replace header trust with identity**: `TenantGuard` resolves tenant/actor/role from the Better Auth session/JWT; `withTenant()` sets the three settings; membership table + roles seeded (`owner, manager, salesperson, delivery, accountant, retailer`, platform `curator, support`)                                               | RLS suite: cross-tenant read fails; `salesperson` transaction gets 0 rows from `tenant_product_costs`; `/health` still unguarded                                                                               |
| 3   | **Idempotency + `sync_ops` + `/sync/upload` v1 skeleton**: `IdempotencyInterceptor` (Stripe semantics, 409 on hash mismatch, 24 h), `sync_ops(tenant, device, op_id, outcome)` ≥ 180 d, `POST /sync/upload` with `X-Sync-Protocol: 1` that dispatches a `PlaceOrder` no-op command and writes `sync_errors` for business rejections   | Contract snapshot test for the upload envelope; replaying a recorded upload twice yields identical DB state; a business rejection returns 2xx + `sync_errors` row; no 4xx path exists in the handler           |
| 4   | **Numbering + business date**: `numbering_series.allocation_mode enum[server, device, external]`, `starting_no`; `businessDate()`/FY helper in `shared/domain` pinned to `Asia/Kolkata`; allocation under `FOR UPDATE` at issue only                                                                                                  | Unit tests: 31 Mar 23:40 IST → old FY; 100 concurrent allocations produce 100 consecutive numbers; device-series reconciliation rejects duplicates into `sync_errors`                                          |
| 5   | **Pricing engine v1 `priceOrder()`** per §3 fix 14: `SchemeRule` type, priority, compounding, `final`, slabs, order-level allocation via `allocate()`, bargain last, `cash_discount_mode`, per-line tax + s.170 rounding, `applied_rules` output; golden fixtures for invoices E and F typed to the paisa in `docs/fixtures/pricing/` | E and F reproduce to the paisa; property test: Σ allocated = header discount; `resolvePrice()` deleted or reduced to a wrapper                                                                                 |
| 6   | **Product master + pack precedence**: `sell_case_size` on `tenant_products`, `case_size` on `stock_lots`, `entered_unit/entered_qty/pack_size_at_entry` on order and invoice lines, `sellCaseSize()` in domain; seed the six invoices' SKUs (x 90, _120, CS1) into the global catalog + Tarsun overlay                                | Migration applies expand-only; "Campa 1L" exists once globally with three supplier pack configs; `formatQty()` prints "2 cs + 3 pcs" using the sell-side size                                                  |
| 7   | **Retailer identity per §6**: `retailer_links` with `role`, `preferred_lang`, `consent_version/at`, `whatsapp_optin_at`; `retailers.merged_into`; onboarding procedure that never touches the global table from a rep context                                                                                                         | RLS negative: retailer role cannot update `credit_limit`/`tier`; rep-role query against `retailer_identities` returns 0 rows; two identities link to one shop                                                  |
| 8   | **Backups + first restore drill**: nightly `pg_dump` to Object-Locked bucket (35 d), `backup.verify` job, `infra/scripts/restore-drill.sh`, `infra/runbooks/restore.md` including the PowerSync slot re-create step; run it once against staging                                                                                      | Drill log in `docs/pilot/` with measured RTO, checksum match, and a device resync recorded                                                                                                                     |
| 9   | **Team app dev build with login + role routing + `reference` stream**: EAS dev build (iOS + Android), Better Auth OTP screen, root layout mounts only permitted route groups, `frontend/packages/offline` with the PowerSync schema for global catalog tables, SQLCipher on, status dot, i18n `en`/`hi` scaffold with Noto Devanagari | Login on a physical Android and an iPhone; `products` visible offline after first sync; role-leak dump script runs against the device DB and finds no cost column; CI fails on a missing translation key       |
| 10  | **Docint eval set kickoff (no code) + PDF renderer decision**: collect 50–100 Tarsun inbound invoices and 30 DMS/TradeEzee retailer bills, redact, label 10 in R06 §8 JSON; decide and prototype the PDF path (Chromium in worker, Devanagari embedded, A4 + 80 mm) with one Marg-shaped invoice from fixture F                       | `docs/fixtures/invoices/` has ≥ 50 images + 10 labels; `pnpm --filter @dos/worker pdf:demo` renders F-shaped A4 and 80 mm PDFs with a Devanagari shop name; ADR for the renderer                               |

Tickets 4, 5, 6, 7 close the [BLOCK] items above; 8 and 9 close the "production-grade" bar's two hardest lines (restore and role-leak) before any business feature exists.

---

## Summary

The synthesis is complete at the level of _what_ and _why_; it is under-specified at the level of _rules a function must implement_. Twelve items block coding on Monday: DMS invoices must enter before loading, not at day-end (1); sell-side vs buy-side case size and lot-level case size (8, 9); the stacking arithmetic, allocation and rounding of the pricing engine (14); offline legal numbering for van sales, cancellation semantics and the IST/FY rule (19–21); delivery challans and the EWB check on van loads (22, 24); person-vs-shop identity (26); the pricing golden-fixture format (49). Five recommendations change decisions and are flagged: rate precision for costs (11), `cash_discount_mode` (16), device-allocated vehicle series (19), SQLCipher from day one (55), and TradeEzee replacing "Marg Excel" everywhere. The rest are one-paragraph definitions the developer would otherwise invent under time pressure — most cheaply written into the ADRs and `docs/domain/` this week, before slices 2–4 start.
