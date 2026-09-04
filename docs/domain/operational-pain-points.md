<!-- Extracted from docs/research/R09-domain-operations.md (2026-09-04). Marketing-sourced numbers are directional. -->

# Operational pain points, ranked by frequency (most sources + daily recurrence first), with product implication

Ranking basis: number of independent sources naming the issue, plus whether it recurs per bill/day vs per month. Judgment call, not a survey.

1. **Scheme misapplied or missed at billing** (every bill; 6 sources) — scheme engine evaluates all active schemes per line at billing, stamps scheme ids on lines, never lets a salesman type a free-form discount.
2. **Claims never raised or raised late** (monthly; 5 sources; "30-50% missed") — auto-accrue a claim the moment a company-funded discount/free qty/return is booked; per-brand claim window countdown with WhatsApp nudges.
3. **Claims rejected for missing evidence** (monthly; 4 sources) — claim dossier builder: photos with batch/MRP, GRN remark, invoice refs, calc sheet, exported in the brand's template.
4. **Retailer outstanding sprawl; bills in a physical file** (daily; founder + 5 sources) — per-retailer ledger with aging, bill-to-bill default, credit-limit block at billing, collection on delivery app, UPI QR on every bill.
5. **Book stock vs physical stock mismatch** (daily; 3 sources) — append-only ledger with GRN variance, pick/pack confirmations, van load/unload and damage as explicit movements; cycle counts.
6. **Case vs pieces confusion** (every inbound and outbound document; ground truth invoices) — pack hierarchy per SKU with supplier-specific conversion, invoice extraction that parses "x 90"/"_120"/CS1 and asks the reviewer to confirm.
7. **Three billing systems in parallel because brands mandate their DMS** (daily; ground truth) — import brand-DMS invoices (E) as photos/CSV so the distributor still gets one ledger; never assume our system is the only invoice source.
8. **Forced primary / auto-generated orders / month-end dumping** (monthly; AICPDF/Tata case) — PO-vs-invoice matching on inbound; days-of-stock per SKU visible to the owner before accepting primary; record disputed receipts.
9. **Expiry write-offs because near-expiry was not flagged inside the brand's RTV window** (weekly; 4 sources) — batch/expiry captured at GRN, FEFO picking, alerts at 60/30/15/7 days tuned to the brand's return band.
10. **Van/delivery blind spot: what did the van sell, what is left, where is the cash** (daily; founder wants GPS; 4 sources) — trip object with load sheet, per-stop status, on-vehicle invoicing, EOD stock and cash close.
11. **End-of-trip cash reconciliation and cash leakage** (daily; 3 sources) — expected-vs-collected per trip, deposit confirmation by manager, variance log.
12. **Short/partial delivery disputes hold up payment** (daily; 3 sources) — partial-delivery state producing a corrected invoice, OTP/photo POD.
13. **Salesman attrition destroys beat knowledge** (quarterly; 2 sources but severe) — retailer master, outlet class and history owned by the tenant, not the rep; new rep inherits beats with last-order context.
14. **Beats built on habit, stale outlet master, no visit proof** (weekly; 4 sources) — beat/PJP objects, GPS check-in, coverage vs universe, outlet class-driven frequency.
15. **Secondary data nobody trusts; brand reports take 3-5 days a month** (monthly; 3 sources) — brand-wise secondary sales/closing stock export in the formats brands ask for.
16. **Credit-note failures and GST Section 34 deadlines** (monthly) — credit notes linked to original invoice and its original tax rate; deadline tracking per FY.
17. **GST/MRP rate change on stock in hand** (episodic but large — Sept 2025) — batch-level MRP and dated HSN rates; price-protection claim generator.
18. **Transit damage not noted at unloading on the LR** (per inbound truck) — LR as a document type with mandatory damage remark + photos before GRN close.
19. **Ambiguous scheme stacking** (per scheme circular) — scheme definition carries stacking rule and "final" flag (already decided in CONTEXT).
20. **Cash discount given but payment still late** (per bill) — CD as a conditional discount realised only on payment within window; else auto-reversal via credit note logic.
21. **Role leak: salesman sees purchase price/margin** (Vyapar failure in CONTEXT) — field-level authorisation enforced server-side; separate price-list views.
22. **FOC/free-goods accounting wrong (10+1 booked as 10%)** (per scheme) — compute effective scheme cost on units delivered; ITC handling for true samples.
23. **Delivery windows and multi-trip sequencing** (daily) — trip planner with stop windows; load last-stop-first order.
24. **E-way bill for high-value inbound and inter-godown moves** (weekly) — EWB fields on inbound docs; threshold check (Rs 1 lakh MH intra-state) on any outbound consignment.
25. **FSSAI number missing on bills; unregistered retailers** (per bill) — mandatory FSSAI on invoice template; URP handling.
26. **Retailers order in pieces below case MOQ; broken cases** (per order) — sell-UoM vs stock-UoM; loose-piece stock balance per SKU.
27. **Doorstep price disputes ("salesman promised a scheme")** (daily) — scheme shown to retailer in-app at order time; order confirmation shared on WhatsApp with prices.
28. **Saleable vs damaged returns mixed up** (per trip) — return reason codes at pickup, separate stock buckets, brand-claim eligibility flag.
29. **Multiple MRPs of the same SKU in stock** (weekly) — stock lots keyed by batch+MRP; bill shows the MRP of the lot picked.
30. **Owner has no live view; learns at month end** (daily) — the owner dashboard already decided; feed it from the ledgers above rather than from DSR compilation.
