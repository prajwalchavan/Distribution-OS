# Phase 8 — Pricing, schemes, discounts and GST (API + database)

Lane `pricing`, 2026-09-28 (IST business date). Environment: database `dos_test_p8_pricing` (from `dos_test_batch2b_template`,
`pnpm db:migrate` "migrations applied", `pnpm db:seed` exit 0), the all-in-one API on :3650 with `DOS_MODE=all WORKER_INLINE=1`
(the first start had no `DOS_MODE=all`, so the worker did not run and no PDF rendered; restarted with it at 08:33 so the outbox relay
renders bills). Platform: API and SQL only. No product code changed.

Tools: `QA/tools/p8/` — `oracle.mjs` (independent, written from docs/22 and the header comment of `pricing/schemes.ts`, never calls
or copies the engine), `inputs.mjs` (reads only the oracle's inputs), `cases.mjs` + `run-orders.mjs` (108 generated orders, each
on its own fresh shop with its own schemes), `layers.mjs` (the layer-by-layer comparison), `in-flight.mjs`, `roles.mjs`,
`tax-edge.mjs`, `priority-probe.mjs`, `scheme-spend.mjs`, `claim-probe.mjs`, `summary.mjs`, `compact-wire.mjs`.
Evidence: `QA/evidence/p8/` — `summary.json` (distribution of every check over all 108 orders), `orders-all.json` / `orders-T0.json`
/ `orders-L09.json` (per order: oracle, quote, order, bill, journal, register, outstanding, PDF figures, and only the rows that
differ), `in-flight.json`, `roles.json`, `tax-edge.json`, `priority-probe.json`, `scheme-spend.json`, `claim-probe.json`, `*.log`,
and `*.wire.jsonl` (every call; 2xx kept as method/url/status, refusals kept with body and reply).

## Coverage

Every order ran quote (as the rep) → oracle → order (create + submit, gates approved by the owner) → pick/pack (invoice issued at
pack) → invoice lines/tax/round-off → journal of the bill → sales register row → outstanding → printed PDF. 108 orders, 108 bills,
184 order lines.

| Area | Orders | Oracle vs bill total | Order total vs bill total | Order tax vs bill tax | Notes |
| --- | --- | --- | --- | --- | --- |
| Base tier price (tiers A, B, C; cases and pieces) | 6 | 0 | 0 | 5 bills, 1–2 p | DOS-332 |
| Shop override (final / not final, above tier, expired, future, + bill scheme, + bargain) | 8 | 0 | 0 | 0 | final blocks line and bill schemes as written; final + bargain: question Q4 |
| Slab boundaries (one under / at / over; case, pcs, ₹ triggers; slabs) | 17 | 0 | 0 | 10 bills | all 17 at the right side of the boundary |
| Percentage and flat (line %, ₹ per multiple, ₹ per unit, per-unit slabs, flat slab once) | 6 | 0 | 0 | 2 | |
| Free goods (same item, other item, slab with other item, + %, gstOnFreeGoods, bought + free, IGST) | 7 | 0 | 0 | 3 | DOS-330 (lot copies), DOS-337, DOS-338 |
| Exclusive (worth more, worth less, tie, final + bargain, + bill scheme, seeded one ending today) | 6 | 1 (X04, DOS-219) | 0 | 4 | DOS-219 known: measured below |
| Stacked (7.5 % + 2.5 %, % + ₹/pc, three %, seeded + own) | 4 | 0 | 0 | 2 | DOS-334 |
| Bill-level (3.33 % largest remainder, threshold exact / +1 p, brand scope, exclusive + final lines, mix trigger, two stacked) | 9 | 1 (L05, DOS-219) | 0 | 7 | |
| Validity (to today, ended yesterday, from tomorrow, delivery-dated, seeded ended yesterday, inactive) | 6 | 0 | 0 | 2 | IST dates correct in all six |
| Bargains (inside bound, owner-approved, held on gate, rejected, ₹0.01, + scheme, other rate, on override, above list) | 9 | 0 | 0 | 2 | DOS-335, DOS-336 |
| Cash discount (two brand offers, shop terms, own scheme) | 3 | 0 (quote = oracle) | 0 | 1 | DOS-333 |
| GST place of supply (Gujarat reg / URP, Maharashtra URP, scheme + bill scheme, cess only, tier A) | 6 | 0 | 0 | 5 | IGST vs CGST+SGST right in all; B2B/B2C right |
| Halves of a paisa (CGST 94.5 p, 61.5 p, 25.5 p, 143.5 p; 50.5 p discount; round-off exactly 50 p) | 9 | 0 | 0 | 7 | |
| Order total vs bill total at the rupee boundary (built after the first run) | 5 | 0 | **4 of 5, ±₹1** | 4 | DOS-332 |
| Cases + pieces (same item on two lines, seeded Atta, seeded Campa under/at 5 cases) | 5 | 0 | 0 | 2 | Q10 |
| Tax edge (100 % scheme line, flat ₹ larger than the line) | 2 | 0 | 0 | 0 | line floors at ₹0, never negative |
| **Total** | **108** | **2 (both DOS-219)** | **4** | **56 bills** | |

Layer checks that held on every bill (108/108): quote = order (rate, list rate, line net, line tax, free qty, applied rules, total,
tax, round-off); order header = Σ lines + round-off; invoice qty, free qty, taxable and rate = order line; invoice header = Σ its
lines (taxable, CGST, SGST, IGST, cess); invoice total = taxable + taxes + round-off, whole rupees, |round-off| ≤ 50 p; CGST = SGST
(bill and every line); journal balances, AR = bill total, OUTPUT_CGST/SGST/IGST/CESS = the bill, ROUND_OFF = −round-off, and
SALES + DISCOUNTS = −taxable (the journal posts sales at the gross with the scheme discount on DISCOUNTS); sales register row = bill
(taxable, CGST, SGST, IGST, cess, round-off, total, inter-state, B2B/B2C); outstanding = bill total; printed PDF total, taxable,
CGST, SGST, IGST, cess and round-off = the bill; the one bill with a cash-discount offer prints it.

Distribution of differences (paise, count), from `QA/evidence/p8/summary.json`:

| Check | Distribution |
| --- | --- |
| quote ↔ oracle, per line: rate, gross, bargain, free qty, GST rate, cess, other-item free goods | 0 × 180 each |
| quote ↔ oracle, scheme discount / line net | 0 × 176; +1424, +570 (the exclusive lines of X04, L05: DOS-219); ±1 (the other lines' share of the same bill scheme) |
| quote ↔ oracle, payable total | 0 × 102; −1600 (X04), −600 (L05), ±100 × 4 (the T rupee-boundary orders: DOS-332) |
| quote ↔ oracle, cash-discount paise | 0 × 108 |
| order ↔ quote, every field | 0 |
| invoice ↔ order, line tax | 0 × 105, +1 × 53, −1 × 23, −2 × 2, +6 × 1 (DOS-332) |
| invoice ↔ order, bill tax | 0 × 52, +1 × 31, −1 × 17, +2, −2 × 3, +4, +6 × 3 |
| invoice ↔ order, bill total | 0 × 104, +100 × 3, −100 × 1 (DOS-332) |
| invoice ↔ oracle, total | 0 × 106, −1600, −600 (DOS-219) |
| invoice ↔ oracle, CGST / SGST / IGST / cess | 0 × 102–106; ±1…3 on multi-lot lines (the bill rounds each lot line's CGST and SGST; the oracle rounds per order line); −85, −34 (DOS-219) |
| journal, registers, outstanding, PDF | 0 on every bill |

DOS-219 (known, not re-filed), measured: X04, a 10 % "on its own" line of ₹791.20 also got ₹14.24 of the 2 % bill scheme and the
bill came to ₹1,165 instead of ₹1,181 (−₹16); L05, an 8 % "on its own" line got ₹5.70 of the bill scheme, bill ₹1,083 instead of
₹1,089 (−₹6). A FINAL override line (O05, L05) correctly got no share. `orders-all.json` rows X04, L05.

Price changes in flight (`in-flight.json`): the bill always carries the rate the order was placed at and nobody is told.
IF1 tier list raised ₹1.11 after confirm → billed at the old ₹7.02; IF2 shop override ₹13.00 set after confirm → billed at the old
₹14.24; IF3 10 % scheme created after confirm → billed without it; IF4 list −₹2, override −₹3 and a 10 % scheme after the bill →
invoice and order rows unchanged (immutable); IF5 order held on a strict credit gate: list lowered (a), list raised (b), scheme
added (d) → confirmed at the drafted rate, as docs/22 2026-09-13 (DOS-126) says; the shop's own override lowered while held (c) →
also NOT applied (question Q2); IF6 `orders.setLines` re-prices every time: 2 cs (5 % = ₹50.54) → 143 pcs (rule gone) → 2 cs after
a new 2 % scheme (₹69.75 = oracle); IF7 a draft priced at ₹14.24, the list raised to ₹15.74, then submitted → confirmed at ₹14.24
(question Q3). No order flag, approval, transition reason or message is raised by any of these changes.

Who may discount (`roles.json`, every call by raw HTTP through the role's own service):

| Lever | owner | manager | accountant | salesperson | warehouse | delivery | retailer |
| --- | --- | --- | --- | --- | --- | --- | --- |
| price list create / set rate | 200 | 200 | 403 | 403 | 403 | 403 | 403 |
| shop override | 200 | 200 | 403 | 403 | 403 | 403 | 403 |
| scheme create | 200 | 200 | 403 | 403 | 403 | 403 | 403 |
| rate request (bargain) | 200 (approved at once) | 200 (approved at once) | **200 requested** | 200 (auto inside 3 %) | **200 requested** | **200 requested** | 200 requested (own shop); 403 for another shop |
| decide a rate request | 200 | 200 | 403 | 403 | 403 | 403 | 403 |
| rep bound | 200 | 403 | 403 | 403 | 403 | 403 | 403 |
| order line with `ratePaise` / `discountPaise` / `discountBps` / `appliedRules` / `priceLocked` in the body | 200, **ignored** | 200, ignored | 403 | 200, ignored | 403 | 403 | 200, ignored |
| approve an order gate | 200 | 200 | 403 | 403 | 403 | 403 | 403 |

Smuggled price fields are dropped on create and on `setLines` (the retailer's clean shop stored list ₹7.02, rate ₹7.02, discount 0);
the rates the owner, manager and rep rows show come from approved rate requests on the probe shop, not from the body. The
accountant and warehouse rows are DOS-336.

Tax edge (`tax-edge.json`): a free-goods reward line is billed qty 0, free N, rate ₹0, taxable ₹0, tax ₹0 (DOS-185 as built); a
100 % scheme line bills taxable ₹0 and tax ₹0 beside a paid line; a flat ₹100 on an ₹11.16 line floors at ₹0; an HSN with no rate
row (09011110, proposed by the owner, listed, priced ₹180) is refused by `pricing.quote` and `orders.create` with 400 "no GST rate
for HSN 09011110 on 2026-09-28" and `data.hsnCodes` — never a silent 0 %; registered shops bill B2B with the GSTIN, unregistered
B2C, Gujarat shops IGST only (G01–G05, F07, H07, T05). Returns at the door: one trip, six bills, a third of every line refused,
six credit notes issued (CN/9003–9008): each credited line is within 1 paisa of what the shop paid for those pieces (the product
floors the per-piece value; question Q7), at the bill's own GST and cess rates, CGST+SGST in Maharashtra and IGST for Gujarat
(G04/CN/9004) — except the free-goods lot line (DOS-337). GST summary (`billing.registers.gstSummary`, by rate and by HSN),
`reporting.registers.gstSalesRegister` and the accountant's copy: taxable, CGST, SGST, IGST and cess equal the SQL sums of the
day's 119 invoices to the paisa; `documentCount` reads 77 (DOS-317, money lane, reproduced).

---

> **Judged by the main session, 2026-09-28.** DOS-330 is CONFIRMED in SQL on `dos_test_p8_pricing`: INV/9047 carries ₹200.00 of discount on its lines and ₹1,200.00 of rule amounts; INV/9059 ₹228.51 against ₹1,142.55. DOS-331 on live, read over SSH (global rate table only): all 84 listed items resolve to rows dated 2025-09-22 (5 % for 69, 40 % for 15) that came from the founder's own ERP list; none resolves to a 2017 row, so no live bill is on a 2017 rate today. The demo seed is what carries the old rates. The legal rates themselves are the CA's to confirm. Rulings for every finding and question of this file: docs/22 §8, row "Architect rulings, prices and tax". Nothing is fixed yet.

### DOS-330 — A bill split across batches repeats every scheme's full amount on each batch line: brand claims and the scheme-spend register are multiplied (₹1,341.90 claimed for ₹268.38 given)
**Status (2026-09-29): FIXED on main (merge of `fix/prices-and-tax`); LIVE since 30 Sep 08:25 IST.** Proven by three blind checks, the last on speed; details in `QA/13-change-log.md`, 29 Sep.
Category: business-logic | Priority: P0 | Role: Owner / Accountant (claims), Owner (scheme spend) | Platform: API

User: Owner (sunil.tarsun)
Platform: API (all-in-one :3650), SQL
Environment: dos_test_p8_pricing, demo seed, 2026-09-28
Steps:
  1. As the rep, order 12 × Godavari Cow Ghee 500 ml for a new shop (X05). The seeded company-funded, claimable "Godavari Ghee — 6 %
     exclusive" gives ₹228.51 off (quote, order and bill agree). Pack: the 12 pieces leave five batches, so the bill INV/9059 has five
     ghee lines (1 + 3 + 3 + 3 + 2 pcs) whose `discountPaise` add up to ₹228.51.
  2. SQL: each of the five invoice lines carries the order line's whole rule `{ruleId: 2891ee90…, amountPaise: 22851}`; summed over the
     bill that is ₹1,142.55. The same holds for 12 of the day's 120 bills: those 12 carry ₹3,640.06 of scheme amounts for ₹959.44 of
     discount actually on them (SQL over `invoice_lines.applied_rules` against `discount_paise`, run 2026-09-28).
  3. `GET /owner/reporting/registers/scheme-spend?from=2026-09-28&to=2026-09-28`: "QA P8 P06 flat slabs" (₹200 given once, bill
     INV/9047 split over six batches) is reported at `amountPaise: 120000` = ₹1,200; "QA P8 F04 5 %" ₹133.92 against ₹44.64 given
     (`scheme-spend.json`).
  4. `POST /owner/claims` (Godavari, scheme, today) then `POST /owner/claims/{id}/build`: 10 claim lines, **claimed ₹1,341.90**.
     INV/9059: 5 lines, ₹1,142.55 claimed for ₹228.51 given; INV/9064 (UHT, seeded company 2 % beside a distributor 1.5 %): 5 lines,
     ₹199.35 claimed for ₹39.87 of company-funded discount (`claim-probe.json`). Company-funded discount on the two bills: ₹268.38;
     claimed ₹1,341.90; over-claim ₹1,073.52.
  5. Free goods: the trigger rule's `freeQty` is copied the same way — F04's 12 + 1 gave 10 free pieces, the invoice lines' rules say
     30; F03's slab gave 5 salt, the rules say 15. The claim builder reads `rule.freeQty` per invoice line
     (`claims/build.service.ts:419-421`), so a company-funded free-goods scheme would be claimed ×(number of batches). NOT TESTED live:
     every free-goods scheme in this lane was distributor-funded.
Expected: a scheme's money and free pieces are counted once per order line (DOS-185: "the brand claim and the owner's scheme-spend
register count the gift once"): the claim for INV/9059 is ₹228.51.
Actual: each batch line of the bill carries a full copy of the order line's rules, and the claim and the scheme-spend register sum
them, multiplying by the number of batches the goods left (5× here).
Business impact: the distributor submits inflated claims to the manufacturer (₹1,073.52 over on two bills of one brand in one day in
this test). They are rejected at audit, or paid and clawed back, and the brand relationship suffers. The owner's scheme-spend
figures overstate what the schemes cost (₹3,640.06 against ₹959.44 on the 12 split bills today). Every item that is picked from more than one batch is
affected, and FEFO picking makes that common.
Evidence: QA/evidence/p8/claim-probe.json, QA/evidence/p8/scheme-spend.json, QA/evidence/p8/orders-all.json (X05, K04, P06, F03, F04
invoice lines), QA/evidence/p8/tax-edge.log
Suggested fix: when an order line is split into batch lines at issue, split each applied rule's `amountPaise` (largest remainder on
the pieces) and `freeQty` over the batch lines as `discountPaise` already is, or keep the rule only on the first batch line with a
pointer on the others; add a spec that Σ rule amounts over a bill = Σ `discount_paise`.

### DOS-331 — The HSN rate table carries only its 2017 rates; project documents say several changed on 22 Sep 2025 — question for the founder and his CA
**Status (2026-09-29): OPEN, the CA's to confirm.** The demo seed now carries dated rows of 22 Sep 2025 from the project's own research; no live rate was changed.
Category: business-logic | Priority: P1 (pending the CA's answer) | Role: Owner / Accountant | Platform: API (global data)

User: Owner
Platform: SQL + API (bills)
Environment: dos_test_p8_pricing, demo seed, 2026-09-28
Steps:
  1. SQL `hsn_rates`: every row has `effective_from = 2017-07-01` and no later row. Examples: 1905 "Biscuits and extruded / expanded
     savoury snacks" 18 %; 2106 namkeen (not pre-packed) 18 %; 21069099 namkeen pre-packed 12 %; 2201 packaged drinking water 18 %;
     2202 aerated waters 28 % + 12 % cess; 22029920 fruit drinks 12 %; 0405 butter and ghee 12 %; 3305 / 3306 / 3401 18 %.
  2. The seed writes exactly these: `backend/libs/database/src/seed-demo/catalog.ts:496-525` (HSN_RATES, e.g. `hsn-1905` 1800 bps,
     `hsn-2202-carbonated` 2800 + 1200) with `effectiveFrom: '2017-07-01'` at `:699`.
  3. The project's own documents describe different rates from 22 Sep 2025:
     - `docs/research/R09-domain-operations.md:132` (GST 2.0) lists namkeen/bhujia (2106) 5 %, biscuits (1905) 5 %, packaged
       drinking water (2201) 5 %, sweetened/flavoured drinks (2202) 40 %.
     - `docs/32-legacy-import.md:71` imports its rates effective `--rates-from` 2025-09-22, "the GST 2.0 slab date".
     - `docs/32-legacy-import.md:266` asks the founder to "confirm with the CA the rates in the list (5 % and 40 % from 2025-09-22)".
  4. Today's bills in this database were taxed on the 2017 rows. For example, 91 lines under 1905 (taxable ₹29,013.94) carry
     ₹5,222.62 of GST at 18 %. 45 lines under 2202 carry 28 % GST plus 12 % compensation cess, shown on the bill under two heads
     (`tax-edge.json` `billsTodayByHsn`).
Expected: the founder and his CA confirm which rates apply on and after 22 Sep 2025. If they differ, dated rows are added, and a
bill dated after the change resolves to the new row (the resolver already reads `effective_from`).
Actual: the curated table and the seed have no row after 2017. **This lane does not state the correct legal rate.** It reports what
the data carries and what the project's own documents say.
Business impact, **only if the CA confirms R09's figures**:
  - Today's 1905 lines would have been taxed ₹1,450.70 at 5 % instead of ₹5,222.62 at 18 %. The shop is over-charged ₹3,771.92, and
    output tax is misreported on a legal document.
  - The 2202 total would be the same 40 %, but the cess head (₹1,527.87 today) would have to be GST instead, which changes the
    GSTR-1 columns.
  - This is P0 wherever a live tenant's items resolve to these rows. The legacy importer adds 2025-09-22 rows only for the headings
    in its own list.
Evidence: QA/evidence/p8/tax-edge.json (`hsnRatesDb`, `hsnRatesSeedLines`, `billsTodayByHsn`), QA/evidence/p8/orders-all.json
Suggested fix: after the CA answers, add dated `hsn_rates` rows (expand-only), and correct the seed's HSN_RATES and the
catalog-extra rows. Also check `dos_live` / `dos_demo` for headings whose only row is 2017. This lane was not allowed to read those
databases.

### DOS-332 — The order shows one tax figure and the bill another; at a rupee boundary the bill total differs from the order total by ₹1
**Status (2026-09-29): FIXED on main (merge of `fix/prices-and-tax`); LIVE since 30 Sep 08:25 IST.** Proven by three blind checks, the last on speed; details in `QA/13-change-log.md`, 29 Sep.
Category: business-logic | Priority: P1 | Role: Salesperson, Owner, Retailer (order screen) vs every reader of the bill | Platform: API

User: Salesperson (rahul.deshmukh)
Platform: API, SQL
Environment: dos_test_p8_pricing, 2026-09-28
Steps:
  1. Quote and order a ₹10.25 item at 12 % plus a ₹10.01 item at 0 % (T01, shop override rates). The quote and order compute GST
     on the combined 12 %: 12 % of ₹10.25 = 123.0 p. The exact total is ₹21.49, so the order total is **₹21.00**.
  2. Pack. The bill computes CGST 6 % and SGST 6 % separately: 61.5 p rounds to 62 p, twice = 124 p. The exact total is ₹21.50, so
     the bill total is **₹22.00** (INV of SO-0994).
  3. T02 (18 %, ₹10.50): order ₹22 → bill ₹23. T03 (18 %, ₹10.25): order ₹23 → bill ₹22. T04 (six 18 % lines): order ₹84 →
     bill ₹85. T05, the same items for a Gujarat shop (IGST, no split): order = bill.
  4. Over the 108 generated bills, 56 carry a different tax from their order (1–6 paise), on 79 of 184 lines. The difference comes
     from the half-rate split plus the rounding of each batch line.
Expected: one GST convention from quote to bill. The figure the rep reads and the shop agrees to, "what the shop pays" (DOS-083),
is the figure billed.
Actual: `pricing.quote` and the order store `taxPaise` from the combined rate on the whole line. The invoice rounds CGST and SGST
separately on each batch line. 52 % of bills differ in tax, and some differ by ₹1 in total. In every checked case the bill equals
the independent oracle's split computation.
Business impact: up to ₹1 per bill between the order (credit check, the rep's and the shop's screens, the owner's order list) and
the bill (receivable, collection, the doorstep "to collect"). A shop told ₹21 is asked for ₹22 at the door, or the other way round.
Small money, but the two figures disagree on documents the shop sees.
Evidence: QA/evidence/p8/orders-T0.json, QA/evidence/p8/summary.json (`invoice↔order tax`, `invoice↔order total`),
QA/evidence/p8/orders-all.json (B01: order line tax 937 p, bill 469 + 469 = 938 p)
Suggested fix: compute order and quote tax the way the bill does, as CGST and SGST (or IGST) per line at half rate each. Then
either split batch lines' tax from the order line's already-rounded CGST/SGST by largest remainder, or have the bill take its total
from the order. Pin it with a quote = order = bill spec over half-paisa cases.

### DOS-333 — The brand's cash-discount offer the quote reports never reaches the bill; the shop's own cash-discount terms reach the bill but not the quote
**Status (2026-09-29): OPEN, left out on purpose.** It needs a schema change (the order stores no offer) and two product decisions; founder, 4 Sep: not important now.
Category: business-logic | Priority: P1 | Role: Salesperson / Retailer / Accountant | Platform: API

User: Salesperson; Owner reading the bill
Platform: API, PDF
Environment: dos_test_p8_pricing, 2026-09-28
Steps:
  1. C01: order 95 Too Yumm Makhana and 60 Rajwadi soda. The seeded offers are Too Yumm 2 % and Rajwadi 1.5 % cash discount.
     `pricing.quote` reports `cashDiscountBps 200`, `cashDiscountPaise 3775` (₹37.75), the better offer, which matches the oracle.
  2. Pack. Bill INV/9088 has `cashDiscountBps 0` and `cashDiscountUntil null`, and its PDF prints no cash-discount line.
  3. Same for C03 (own 3 % cash-discount scheme, quote ₹55.88, bill 0) and V05 (Rajwadi 1.5 %, quote ₹24.68, bill 0).
  4. C02: a shop whose own terms are 2.5 % in 7 days, with no scheme. The quote says 0 / ₹0. Bill INV/9089 prints "Cash discount
     2.5 % if paid by 05-Oct-2026 (given as a credit note on receipt)".
Expected (docs/22 §6 "Cash discount: shown on the bill, realised as a credit note only when paid on time"; engine rule 5): the
offer the engine chooses is the one printed on the bill, and the shop sees the same figure on the order.
Actual: the bill takes `cashDiscountBps` only from `retailers.cash_discount_bps` (`billing/invoices.service.ts:1866`). The engine's
scheme offer is reported on the quote and then dropped.
Business impact: a shop that pays on time is not offered the brand's cash discount on its tax invoice (₹37.75, ₹55.88 and ₹24.68
on three test bills), although the rep was shown it. Whether the receipt then realises it: NOT TESTED. The desk has no printed
basis for giving it. The founder's 2026-09-04 row ("Cash discount: not important now") may lower this; the lane rule puts it at P1
because two layers disagree.
Evidence: QA/evidence/p8/orders-all.json (C01, C02, C03, V05: `quote.cdBps/cdPaise`, `invoice.cdBps/cdUntil`, `pdf`)
Suggested fix: decide which source rules (scheme offer, shop terms, or the better of the two), carry it from the quote to the order
and the bill, and print it.

### DOS-334 — The owner cannot set which scheme applies first; `priority` is silently dropped and the stacking order falls to creation order
**Status (2026-09-29): FIXED on main (merge of `fix/prices-and-tax`); LIVE since 30 Sep 08:25 IST.** Proven by three blind checks, the last on speed; details in `QA/13-change-log.md`, 29 Sep.
Category: missing-feature | Priority: P2 | Role: Owner | Platform: API

User: Owner
Platform: API, SQL
Environment: dos_test_p8_pricing, 2026-09-28
Steps:
  1. `POST /owner/pricing/schemes` ₹5 off every piece with `priority: 50`, then a 10 % scheme with `priority: 1`. The owner wants the
     10 % first. Both return 200; the reply has no priority field; SQL `schemes.priority` = 0 for both.
  2. Quote 48 Garam Masala (gross ₹3,577.92): the discount is ₹573.79 (flat first, then 10 %). With the order the owner asked for it
     would be ₹597.79, a ₹24.00 difference on one line.
  3. Priorities in the table: 88 schemes at 0 (everything made through the API), and seeded or imported ones at 5, 10, 15, 20 and 30.
     So every owner-made scheme always stacks before every seeded or imported one.
Expected (engine rule 3: "stacked in priority, id order", review item 14): the owner can set the order.
Actual: `UpsertSchemeInput` has no `priority` (contracts/src/pricing.ts:246-271), so zod strips it. The order is the UUIDv7 id,
which is creation time.
Business impact: when a percentage and a flat scheme meet on one line, the discount depends on which was typed first. The owner
cannot fix it and the screen cannot show it (₹24 on a ₹3,578 line here).
Evidence: QA/evidence/p8/priority-probe.json, QA/evidence/p8/priority-probe.wire.jsonl
Suggested fix: add `priority` to the upsert input and to `SchemeSchema`, default it, and show it in the owner's scheme screen. Or
state a fixed rule (for example, money schemes by kind) and document it.

### DOS-335 — No floor on an approved rate: ₹0.01 a piece bills goods listed at ₹112.25 for ₹0.00, and below-cost rates pass with no warning
**Status (2026-09-29): FIXED on main (merge of `fix/prices-and-tax`); LIVE since 30 Sep 08:25 IST.** Proven by three blind checks, the last on speed; details in `QA/13-change-log.md`, 29 Sep.
Category: business-logic | Priority: P2 | Role: Owner / Manager | Platform: API

User: Owner (also Manager, the same endpoint)
Platform: API, SQL, PDF
Environment: dos_test_p8_pricing, 2026-09-28
Steps:
  1. N05: the rep asks for ₹0.01 a piece of Sunbake Marie (tier ₹22.45). The owner approves at the asked rate. The order of 5 pieces
     prices at ₹0.05, and bill INV/9083 reads taxable ₹0.05, CGST ₹0.00, SGST ₹0.00, round-off −₹0.05, **TOTAL Rs 0.00** ("Rupees
     Zero Only").
  2. N09: the owner tries to approve ₹24.00. The API refuses it with 400 "Approved rate cannot exceed the list rate". The request
     stays open, the order is held on its "bargain" gate, and approving the gate bills the asked ₹20.00 a piece. N02 bills ₹20.20.
     Marie's landed cost in `tenant_product_costs` is ₹20.37, so both are sold below cost.
  3. roles.mjs: the owner and the manager each approve a ₹0.01 request (200). An approved request with no order has no expiry
     (S-19, known), so ₹0.01 then prices every later order of that shop for that item: the owner's and manager's probe orders priced
     at ₹0.01.
Expected: a sanity bound on an approved rate (not below landed cost without an explicit "sell below cost" confirmation; never
₹0.00–₹0.01), and the queue showing the margin a decision gives away.
Actual: the only checks are "asked < current rate" and "approved ≤ list rate".
Business impact: one mistyped approval (1 instead of 2,010) bills goods for ₹0, and every later order of that shop keeps that price
because of S-19. Below-cost sales (N02, N09: 17–37 paise a piece under landed cost) go through unflagged.
Evidence: QA/evidence/p8/orders-all.json (N02, N05, N09), QA/evidence/p8/roles.json, SQL `tenant_product_costs` for
3cb5e1c4-c6b4-70ec-9af7-17287907a43a (purchase ₹20.07, landed ₹20.37)
Suggested fix: refuse or double-confirm an approved rate below landed cost or below a tenant-set floor percentage. Show the cost and
margin (back office only) on the approval.

### DOS-336 — The accountant, the godown and the delivery crew can file rate requests; the order gate they raise names the rep and shows neither item nor rate, and approving it applies their discount
**Status (2026-09-29): FIXED on main (merge of `fix/prices-and-tax`); LIVE since 30 Sep 08:25 IST.** Proven by three blind checks, the last on speed; details in `QA/13-change-log.md`, 29 Sep.
Category: security | Priority: P2 | Role: Accountant, Warehouse, Delivery | Platform: API

User: Delivery (ganesh.more)
Platform: API
Environment: dos_test_p8_pricing, 2026-09-28
Steps:
  1. As delivery, `POST /delivery/pricing/bargains` for a new shop: Chamak Dishwash 300 g at ₹12.56 (tier ₹20.94, 40 % off), no
     order. 200, `requested`.
  2. The rep places 10 pieces for that shop. The order is held with flag `bargain`.
  3. As owner, `GET /owner/approvals?orderId=…`: kind `bargain`, payload `{flag, orderNo: SO-1006, totalPaise: 24700}`,
     `requestedBy` = rahul.deshmukh (the rep). No item, no asked rate, and no sign that the delivery crew asked.
  4. Approve. The order line is rate ₹12.56 with a bargain of ₹83.80 before GST; the order goes from ₹247 to ₹148 (line total
     ₹148.21).
  5. roles.mjs: the accountant (`/manager`), warehouse (`/warehouse`) and delivery (`/delivery`) each file a 20 % and a 2 % request:
     200 `requested` in all six cases. The warehouse service answers `/warehouse/pricing/*`, although `contracts/src/pricing.ts`
     says warehouse does not mount pricing. The permission matrix gives `pricing.bargains.request` to ANY_MEMBER.
Expected (docs/22 2026-09-05: the accountant has "NO prices …"; §4: the bargain is the rep's request from the shop): only the rep
and the shop ask for a rate. The gate shows who asked, which item, the asked rate and what it costs.
Actual: any staff login can ask. The owner approves a discount he is not shown, attributed to the rep.
Business impact: a desk or van login can plant a discount that looks like the rep's and rides through with the next order's
approval: ₹99 off a ₹247 order here (₹83.80 before GST). The owner's decision is uninformed. UX-O-9 (the queue shows no item) is related but did not
cover who may ask.
Evidence: QA/evidence/p8/tax-edge.json (`crewRateRequest`), QA/evidence/p8/roles.json, QA/evidence/p8/roles.wire.jsonl
Suggested fix: narrow `pricing.bargains.request` to owner, manager, salesperson and retailer. Carry the requester, item, list and
asked rate on the gate payload. Stop mounting pricing on the warehouse service, or say it does.

### DOS-337 — Returned pieces of a free-goods item are credited at a different value depending on which batch line they come from
**Status (2026-09-29): FIXED on main (merge of `fix/prices-and-tax`); LIVE since 30 Sep 08:25 IST.** Proven by three blind checks, the last on speed; details in `QA/13-change-log.md`, 29 Sep.
Category: business-logic | Priority: P2 | Role: Delivery (doorstep return) / Accountant | Platform: API

User: Delivery (mahesh.sutar)
Platform: API, SQL
Environment: dos_test_p8_pricing, 2026-09-28
Steps:
  1. F04: 120 Sunbake Glucose with 12 + 1 free and 5 % off, so 10 free. The bill INV/9051 splits the item over three batches: 48 pcs,
     65 pcs, and 7 pcs **+ all 10 free**. Taxable: ₹339.26, ₹459.42, ₹49.48.
  2. On a trip, the shop refuses a third of each line: 16 of the 48, 21 of the 65, and 2 paid + 2 free of the last.
  3. CN/9005 credits ₹7.07 a piece on the first two lines, but ₹2.91 a piece on the last (4 pieces, ₹11.64). The last line's taxable
     is spread over 17 pieces.
Expected: one credit value per returned piece of the same item on the same bill, whichever batch it came from. A rule for returned
free pieces is also needed (see Q8).
Actual: the free pieces of the whole order line are put on one batch line, so that line's per-piece value is 2.4× lower, and the
credit depends on which batch the crew marks.
Business impact: small per piece, but systematic. The shop is under-credited (or over-credited) depending on batch order, and the
credit note is not reproducible from the scheme terms.
Evidence: QA/evidence/p8/tax-edge.json (`creditNotes`, case F04), QA/evidence/p8/orders-all.json (F04 invoice lines)
Suggested fix: spread free pieces over the batch lines in proportion (or keep them on a separate zero-rate line). Credit returns at
the order line's paid value per piece.

### DOS-338 — "GST on free goods" does nothing, and the free line carries 0 % on the order but 28 % on the bill
**Status (2026-09-29): FIXED on main (merge of `fix/prices-and-tax`); LIVE since 30 Sep 08:25 IST.** Proven by three blind checks, the last on speed; details in `QA/13-change-log.md`, 29 Sep.
Category: bug | Priority: P3 | Role: Owner | Platform: API

User: Owner
Platform: API, SQL
Environment: dos_test_p8_pricing, 2026-09-28
Steps:
  1. F05: a scheme with `gstOnFreeGoods: true` gives 2 Campa 200 ml free per case of Glucose 32 g.
  2. Order SO-0924: the reward line has `gst_bps 0`, tax 0. Bill INV/9052: the reward line has `gstBps 2800`, taxable 0, tax 0. The
     bill total equals the order total and the oracle (₹632).
Expected: either the flag changes the tax treatment of the free pieces (the owner set it for a reason), or it does not exist. The
free line carries one GST rate on order and bill.
Actual: the flag is stored and ignored. The same line has 0 % on the order and 28 % on the bill.
Business impact: no rupee today (₹0 taxable either way). An owner who ticks "GST on free goods" believes tax is being handled that
is not.
Evidence: QA/evidence/p8/orders-all.json (F05, the one `invoice↔order gst rate` difference)
Suggested fix: the founder/CA rule (Q6) first. Then implement it or remove the flag, and store the reward item's rate on the order
line as the bill does.

---

## NOT TESTED

- Web, Android and iOS screens: this lane is API + SQL by brief. What the rep and shop screens show for tax (DOS-332) and cash
  discount (DOS-333) was not looked at.
- Van-sale pricing (`invoices.issueVanSale`), offline order upload re-pricing (`sync.upload`), `orders.repeatLast`, WhatsApp/AI
  orders, and brand-DMS imported bills.
- Whether a receipt paid on time realises a cash discount for C01/C03/V05. No receipts were recorded.
- A company-funded FREE-GOODS claim, live. The multiplication in DOS-330 is shown for money schemes by `claims.build`, and for free
  pieces only in the invoice lines' rules.
- `inclusiveOfGst` price-list items (none in the seed, none created); cess on anything but 2202; composition-scheme shops.
- Oracle branches that no case reached: a scope naming two lists (brands AND variants); a measure at or above `triggerMin` but below
  every slab; a mix-triggered free-goods scheme; an exclusive free-goods scheme compared on worth; two overlapping overrides.
- The legal rate for any HSN (DOS-331): not ours to state.

## Questions for the founder

1. **GST rates (DOS-331).** Does the CA confirm the rates effective 22 Sep 2025 for the headings the demo and live catalogues use?
   Which headings in `dos_live` still resolve to a 2017 row?
2. **Held order, shop override lowered while held (IF5c).** docs/22 2026-09-13 says confirm applies "the rates approved since it was
   drafted, including a shop's own approved rate". A shop override set by the owner while the order was held was NOT applied at
   confirm. Is an override one of those rates, or only approved rate requests?
3. **Drafts and later price changes (IF7).** A draft priced before a price-list change is submitted and confirmed at the old price,
   with no notice (IF1–IF3: the same after confirm, up to the bill). Should a draft older than N days, or priced before a list
   change, re-price or warn at submit?
4. **A `final` shop override plus an approved rate request (O07).** Rule 2 says "nothing stacks on top" of a final override; the
   product applies the bargain (₹21.50 under a final ₹22.00). Should a final override block bargains too?
5. **Rounding (silent in docs/22).** The product and the oracle agree on half-up for percentages and for the rupee round-off (H08:
   exactly 50 p rounds up). Which GST convention is the rule for the order: combined rate, or CGST/SGST each (DOS-332)?
6. **GST on free goods.** What should `gstOnFreeGoods` do (DOS-338)? Today free goods carry ₹0 taxable.
7. **Credit-note rounding.** The credited value per returned piece is floored (1 paisa under the proportional value on 11 of 15
   lines). Is floor the rule?
8. **Partial acceptance of a free-goods order.** When a shop refuses part of the trigger quantity at the door, it keeps all the free
   pieces (F02: 64 of 192 butter refused, all 6 free dahi kept, although 128 pieces earn 3). Should the entitlement be recomputed?
9. **Scheme stacking order (DOS-334).** Should the owner set priority, or should a fixed rule (free goods, then %, then flat)
   decide?
10. **Same item on two lines (M01).** 1 case + 60 pieces of Marie on two lines does not reach a "2+ cases" scheme, because the rule
    measures per line. Should lines of the same item be added up first?
11. **Seeded free goods from an expired batch.** F02's free dahi left batch B20260812 printed "Exp 02-Sep-2026" on a 28-Sep bill. This
    is the DOS-261 ruling (expired batches still reservable) as it reaches free goods.

## Environment notes (not product findings)

- The template-built database keeps the old seeded Atta scheme as `net_scheme_amount` (₹15 per 2 cases). The seed source now says
  `per_unit_amount` (DOS-087), but the seed only inserts rows that are missing. M03 was checked against the row as stored.
- The brief's start command lacks `DOS_MODE=all`, so the inline worker did not start and bills had no PDF until the API was
  restarted with it (08:33).
- The scratchpad `api.log` name was shared with another lane's process. This lane's own log is `p8-api.log`.
