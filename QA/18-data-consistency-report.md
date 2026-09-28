# 18 — Data consistency report: money (Phase 7, money lane)

Run 2026-09-28 on `dos_test_p7_money`, all-in-one API :3630 (worker in process). For every scenario the figures a person
sees were read from the endpoints their screens call — as that person — and set beside SQL on the documents and the
Sundry Debtors lines of the journal. Everything here is a number read from the API or from SQL; the raw pairs are in
`QA/evidence/p7/*.wire.jsonl`, the snapshots in `QA/evidence/p7/results-s1…s6.json`, the reconciliations in
`QA/evidence/p7/recon-*.txt`. Scenario descriptions and verdicts: `QA/10-business-logic-audit.md`. Findings:
`QA/findings/15-money.md`.

**Who reads what.** Owner = `GET /owner/receivables/outstanding/{shop}` and `/owner/receivables/credit-check`; accountant =
the same on `/manager` as `amol.vaidya`; rep = the same on `/sales` as `rahul.deshmukh` (the shop card and the credit verdict
before placing); crew = `GET /delivery/receivables/outstanding/{shop}` as the driver (the money screen at the stop); shop =
`GET /retailer/receivables/outstanding/{shop}` as `ramesh.gupta` (only R-0001 has a shop login; the test shops have none).
SQL = open balance of the shop's issued/partially-paid bills (on the van apart), receipts + credit notes not yet matched,
and Σ AR journal lines with that shop as party.

## 1. Result in one table

| Comparison | Snapshots | Agree | Differ |
| --- | --- | --- | --- |
| Shop dues / money on account / on the van — owner, accountant, rep, crew, shop app vs SQL | 54 | 54 | 0 |
| Net dues (SQL) vs Sundry Debtors (journal) per shop | 54 | 54 | 0 |
| Credit verdict (limit, headroom, breached, reasons) — owner vs accountant vs rep | every snapshot where the rep may see the shop | all | 0 |
| Whole book: Σ shops vs AR account, every entry balanced, trial balance 0 | baseline + after each of 61 scenario steps + final (`recon-*.txt`, 64 files) | 57 of 61 steps + baseline + final | 4 early S2 runs (A8b, A9, A12, A13) broke on R5c = DOS-310 itself and on an R6b checker bug fixed the same hour; otherwise only known rows (DOS-310, DOS-258, DOS-319) |
| Reports vs documents (final read) | 103 figures | 93 | 10 (4 by design / known, 6 = DOS-317, 1 = DOS-321 — see §2) |
| Bills: order vs bill vs recomputation vs PDF vs journal (S5 + S5b) | 132 bills | 131 | 1 (INV/9129, ₹1.00 — DOS-323) |

Every screen agreed with every other screen and with the books at every snapshot. What is wrong is upstream of the screens:
money the product records twice (DOS-310), attributes to the wrong place (DOS-311), counts per batch line (DOS-322), or
does not count where it should (DOS-312, DOS-313) — the screens then faithfully show those numbers.

## 2. Reports against the documents — final read (09:00 IST rollup, every scenario of the day included)

The ten rows that differ: cash in transit vs Cash with delivery crews is the seed's TRIP-20260615-1 (DOS-319; UX-O-14
known); the three MTD rows are the net-of-credit-notes definition (invoiced ₹20,32,152.00 − credited ₹4,551.00 =
₹20,27,601.00, as served — not a discrepancy); six GST document counts are DOS-317; the daily sales register has no
credited field (DOS-321).

| Report | Figure | Served by the API | SQL (documents / journal) | Difference | Note |
| --- | --- | --- | --- | --- | --- |
| dashboard | today invoiced | 59,609.00 | 59,609.00 | 0 |  |
| dashboard | today credited | 1,639.00 | 1,639.00 | 0 |  |
| dashboard | today collected (receipts not undone) | 114,212.10 | 114,212.10 | 0 |  |
| dashboard | today orders | 171 | 171 | 0 |  |
| dashboard | total outstanding (open bills) | 4,370,178.00 | 4,370,178.00 | 0 |  |
| dashboard | overdue | 4,276,777.00 | 4,276,777.00 | 0 |  |
| dashboard | money on account | 37,534.00 | 37,534.00 | 0 |  |
| dashboard | outstanding − on account vs Sundry Debtors | 4,332,644.00 | 4,332,644.00 | 0 | AR less bills on vans |
| dashboard | cash in transit vs Cash with delivery crews (book) | 0.00 | 152,536.00 | −152,536.00 | UX-O-14 known: the two can differ |
| dashboard | MTD sales | 2,027,601.00 | 2,032,152.00 | −4,551.00 | invoice totals incl. GST, month to date; served figure = invoiced − credited (₹4,551.00) by design (DOS-254): no discrepancy |
| dashboard | MTD sales vs Σ daily_tenant_stats.invoiced this month (the rollup it reads) | 2,027,601.00 | 2,032,152.00 | −4,551.00 | served figure = invoiced − credited (₹4,551.00) by design (DOS-254): no discrepancy |
| dashboard | MTD credited | 4,551.00 | 4,551.00 | 0 |  |
| dashboard | pending approvals | 9 | 9 | 0 |  |
| dashboard | active trips | 1 | 1 | 0 |  |
| dashboard | ageing b0_7 | 608,344.00 | 608,344.00 | 0 |  |
| dashboard | ageing b8_15 | 1,009,616.00 | 1,009,616.00 | 0 |  |
| dashboard | ageing b16_30 | 1,242,055.50 | 1,242,055.50 | 0 |  |
| dashboard | ageing b31_60 | 1,238,500.50 | 1,238,500.50 | 0 |  |
| dashboard | ageing b61_90 | 236,518.00 | 236,518.00 | 0 |  |
| dashboard | ageing b90plus | 35,144.00 | 35,144.00 | 0 |  |
| dashboard | sparkline today invoiced | 59,609.00 | 59,609.00 | 0 |  |
| dashboard | sparkline today collected | 114,212.10 | 114,212.10 | 0 |  |
| collections | today adjustment | 0.00 | 0.00 | 0 |  |
| collections | today bank_transfer | 13,965.00 | 13,965.00 | 0 |  |
| collections | today cash | 55,001.10 | 55,001.10 | 0 |  |
| collections | today cheque | 1,190.00 | 1,190.00 | 0 |  |
| collections | today upi | 44,056.00 | 44,056.00 | 0 |  |
| collections | receipt count | 157 | 157 | 0 |  |
| collections | today total | 114,212.10 | 114,212.10 | 0 |  |
| collections | collector iqbal.shaikh | 595.00 | 595.00 | 0 |  |
| collections | collector ganesh.more | 3,268.10 | 3,268.10 | 0 |  |
| collections | collector amol.vaidya | 109,754.00 | 109,754.00 | 0 |  |
| collections | collector mahesh.sutar | 595.00 | 595.00 | 0 |  |
| ageing register | Σ dues | 4,370,178.00 | 4,370,178.00 | 0 |  |
| ageing register | Σ money on account | 37,534.00 | 37,534.00 | 0 |  |
| ageing register | shops listed with dues | 68 | 68 | 0 |  |
| ageing register | shops holding only money on account, listed | 6 | 6 | 0 | a shop the distributor owes |
| trial balance | AP | −12,211,639.71 | −12,211,639.71 | 0 |  |
| trial balance | AR | 4,332,644.00 | 4,332,644.00 | 0 |  |
| trial balance | BAD_DEBTS | 2,443.00 | 2,443.00 | 0 |  |
| trial balance | BANK | 2,371,379.65 | 2,371,379.65 | 0 |  |
| trial balance | BANK_CHARGES | 1,300.00 | 1,300.00 | 0 |  |
| trial balance | CASH | 3,996,071.52 | 3,996,071.52 | 0 |  |
| trial balance | CASH_DISCOUNT | 22,215.26 | 22,215.26 | 0 |  |
| trial balance | CASH_SHORT | 50.00 | 50.00 | 0 |  |
| trial balance | CASH_VAN | 152,536.00 | 152,536.00 | 0 |  |
| trial balance | CHEQUES | 174,746.98 | 174,746.98 | 0 |  |
| trial balance | CLAIMS_RECEIVABLE | 494.88 | 494.88 | 0 |  |
| trial balance | DAMAGES | −494.88 | −494.88 | 0 |  |
| trial balance | DISCOUNTS | 216,101.35 | 216,101.35 | 0 |  |
| trial balance | INPUT_CESS | 335,645.61 | 335,645.61 | 0 |  |
| trial balance | INPUT_CGST | 710,763.42 | 710,763.42 | 0 |  |
| trial balance | INPUT_IGST | 293,085.18 | 293,085.18 | 0 |  |
| trial balance | INPUT_SGST | 710,763.42 | 710,763.42 | 0 |  |
| trial balance | OPENING | −106,172.00 | −106,172.00 | 0 |  |
| trial balance | OUTPUT_CESS | −366,475.07 | −366,475.07 | 0 |  |
| trial balance | OUTPUT_CGST | −973,022.02 | −973,022.02 | 0 |  |
| trial balance | OUTPUT_IGST | −4,810.67 | −4,810.67 | 0 |  |
| trial balance | OUTPUT_SGST | −973,022.02 | −973,022.02 | 0 |  |
| trial balance | PURCHASES | 10,198,973.02 | 10,198,973.02 | 0 |  |
| trial balance | ROUND_OFF | −16.17 | −16.17 | 0 |  |
| trial balance | SALES | −11,867,552.01 | −11,867,552.01 | 0 |  |
| trial balance | SALES_RETURNS | 20,811.61 | 20,811.61 | 0 |  |
| trial balance | SCHEME_EXPENSE | −157,754.39 | −157,754.39 | 0 |  |
| trial balance | SCHEME_RECEIVABLE | 74,584.19 | 74,584.19 | 0 |  |
| trial balance | STOCK | 0.00 | 0.00 | 0 |  |
| trial balance | TRIP_EXPENSES | 0.00 | 0.00 | 0 |  |
| trial balance | UPI | 3,046,349.85 | 3,046,349.85 | 0 |  |
| trial balance | total of all balances | 0.00 | 0.00 | 0 |  |
| trial balance | Sundry Debtors vs Σ shop nets (docs) | 4,332,644.00 | 4,332,644.00 | 0 |  |
| sales register | rows (incl. the cancelled bill) | 164 | 164 | 0 |  |
| sales register | Σ total | 59,609.00 | 59,609.00 | 0 |  |
| sales register | Σ taxable | 49,804.01 | 49,804.01 | 0 |  |
| GST (billing) | taxable | 49,804.01 | 49,804.01 | 0 |  |
| GST (billing) | CGST | 3,374.13 | 3,374.13 | 0 |  |
| GST (billing) | SGST | 3,374.13 | 3,374.13 | 0 |  |
| GST (billing) | IGST | 1,550.40 | 1,550.40 | 0 |  |
| GST (billing) | cess | 1,500.15 | 1,500.15 | 0 |  |
| GST (billing) | documents (bills issued today, excl. cancelled) | 128 | 163 | -35 |  |
| GST (billing) | credit notes taxable | 1,277.48 | 1,277.48 | 0 |  |
| GST (billing) | credit notes tax (CGST+SGST+IGST+cess) | 360.69 | 360.69 | 0 |  |
| GST (billing) | credit notes documents | 6 | 8 | -2 |  |
| GST (reporting) | taxable | 49,804.01 | 49,804.01 | 0 |  |
| GST (reporting) | CGST | 3,374.13 | 3,374.13 | 0 |  |
| GST (reporting) | SGST | 3,374.13 | 3,374.13 | 0 |  |
| GST (reporting) | IGST | 1,550.40 | 1,550.40 | 0 |  |
| GST (reporting) | cess | 1,500.15 | 1,500.15 | 0 |  |
| GST (reporting) | documents (bills issued today, excl. cancelled) | 128 | 163 | -35 |  |
| GST (reporting) | credit notes taxable | 1,277.48 | 1,277.48 | 0 |  |
| GST (reporting) | credit notes tax (CGST+SGST+IGST+cess) | 360.69 | 360.69 | 0 |  |
| GST (reporting) | credit notes documents | 6 | 8 | -2 |  |
| GST by HSN | taxable | 49,804.01 | 49,804.01 | 0 |  |
| GST by HSN | CGST | 3,374.13 | 3,374.13 | 0 |  |
| GST by HSN | SGST | 3,374.13 | 3,374.13 | 0 |  |
| GST by HSN | IGST | 1,550.40 | 1,550.40 | 0 |  |
| GST by HSN | cess | 1,500.15 | 1,500.15 | 0 |  |
| GST by HSN | documents (bills issued today, excl. cancelled) | 87 | 163 | -76 |  |
| GST by HSN | credit notes taxable | 1,277.48 | 1,277.48 | 0 |  |
| GST by HSN | credit notes tax (CGST+SGST+IGST+cess) | 360.69 | 360.69 | 0 |  |
| GST by HSN | credit notes documents | 6 | 8 | -2 |  |
| daily sales register | invoiced | 59,609.00 | 59,609.00 | 0 |  |
| daily sales register | collected | 114,212.10 | 114,212.10 | 0 |  |
| daily sales register | credited | — | 1,639.00 | not served |  |

## 3. Rounding, to the paisa

Distribution of differences, paise → number of bills.

| Comparison | S5 batch 1 (66 bills — narrow: 3 products, one quantity, no schemes) | S5b batch 2 (66 bills — 12 variants, 5/12/18/28 %+cess, 15 quantities, 130 discounted lines, 22 inter-state) |
| --- | --- | --- |
| order total vs bill total | 0: 66 | 0: 65 · +100: 1 (INV/9129) |
| independent recomputation (rate × qty − discount, CGST/SGST halves or IGST, cess, round to rupee) vs bill | 0: 66 | 0: 66 |
| independent tax + cess vs header | 0: 66 | 0: 66 |
| printed PDF "TOTAL" vs bill | 0: 66 | 0: 66 |
| Σ line totals + round-off vs header total | 0: 66 | 0: 66 |
| round-off within ±50 paise | 66 | 66 |
| receipt of exactly the total → bill paid, ₹0 left on account | 66 | 66 |
| journal: AR = total, Sales = subtotal, Discounts = discount, output taxes = header (R4b) | all | all |
| sales register rows = bills | all | all |
| GST summary values = Σ lines by rate | equal | equal (docs count: DOS-317) |

**INV/9129 (DOS-323).** Inter-state shop R-9065, order SO-1021:

| Line | Order: qty · taxable · IGST 18 % · line total | Bill: batch · qty · taxable · IGST · line total |
| --- | --- | --- |
| 1 Campa Cola 750 | 7 · ₹154.02 · (28 % + cess) · ₹215.63 | RCP20260822 · 7 · ₹154.02 · ₹43.13 + cess ₹18.48 · ₹215.63 |
| 2 Glucose 55 g | 9 · ₹68.73 · ₹12.37 · ₹81.10 | B20260909 · 1 · ₹7.64 · ₹1.38 · ₹9.02 and SB20260823 · 8 · ₹61.09 · ₹11.00 · ₹72.09 (= ₹81.11) |
| 3 | 13 · ₹225.70 · ₹40.63 · ₹266.33 | SB20260719 · 13 · same |
| 4 | 9 · ₹131.72 · ₹23.71 · ₹155.43 | B20260729 · 9 · same |
| Σ lines → rounded | ₹718.49 → **₹718.00** (−₹0.49) | ₹718.50 → **₹719.00** (+₹0.50) |

**INV/9170 (DOS-322).** 60 pcs of Sunbake Glucose 110 g, company 5 % scheme ₹45.30 on the order line, picked from 6 batches
(1 + 8 + 12 + 8 + 16 + 15): line discounts sum correctly (₹73.96 incl. the 3.33 % order scheme); each of the 6 lines carries
the 5 % rule at ₹45.30 → scheme-spend register ₹271.80, Sunbake claim 6 lines ₹271.80 (`s5c-scheme-spend.json`,
`s5c-claim-lines.json`). Day totals, recorded vs given: 3.33 % order scheme ₹1,094.06 vs ₹907.43; Marie 7.5 % ₹224.25 vs
₹153.12; soap ₹0.37/pc ₹61.79 vs ₹51.06; 7+1 free goods 9 vs 6 pieces (6 actually given).

## 4. Money journal of the doorstep and desk events (examples read from `journal_lines`)

| Event | Journal lines (Dr + / Cr −) | Documents |
| --- | --- | --- |
| A11 UPI ₹595.00 at the door | UPI +595.00 · AR −595.00 | RCPT-9009 allocated ₹595.00 |
| A7a cheque ₹595.00 at the door | CHEQUES +595.00 · AR −595.00 | RCPT-9010 |
| A10 cash ₹583.10 with 2 % discount | CASH_VAN +583.10 · CASH_DISCOUNT +11.90 · AR −595.00 | receipt cash discount ₹11.90, bill paid |
| A7c bounce with ₹250 charge | AR +595.00 · BANK −595.00 · BANK_CHARGES +250.00 · BANK −250.00 | RCPT-9012 = −₹595.00 mirror, bill reopened |
| A8b undo of banked trip cash | AR +595.00 · BANK −595.00 | from Bank, not the van (DOS-170 as ruled) |
| A7d settle ₹545.00 of ₹595.00, then bank | settle: CASH +545.00 · CASH_SHORT +50.00 · CASH_VAN −595.00; bank: BANK +595.00 · CASH −595.00 | Cash in hand −₹50.00 net (DOS-258 known) |
| R10 cancel before dispatch | invoice entry reversed in full (invoice_cancel), AR −595.00 | order cancelled with the bill |

## 5. Stock consequences checked beside the money (returns)

| Scenario | Stock ledger (lot → location, pieces) | Credit note (incl. GST) |
| --- | --- | --- |
| R2 part return, saleable | +6 van (sale_return_saleable) → godown at settlement | CN/9003 ₹53.00 |
| R3 wrong item, saleable | +2 van → godown at settlement | CN/9004 ₹64.00 |
| R4 damaged + expired | +3, +2 damaged bin (sale_return_damaged); never back on the rack | CN/9005 ₹97.00 |
| R1/R1b refused | stays on the van; at check-in staged on the dock (in_transit) for its bill | none — bill undelivered (DOS-197) |
| R1c whole came-back bill credited | dock −12/−24 → godown +12/+24 | CN/9010 ₹595.00 |
| R6 desk return | +6 godown | CN/9006 ₹53.00 |
| R7 return on a paid bill | +12 godown | ₹384.00 to money on account |
| R8 scheme lines | +12, +6 godown | ₹273.00 (soap at the 10 %-off rate; Glucose at the line value over 28 pieces incl. free) |
| R10 cancel before dispatch | dock → godown (lot 43e143: dock 816 → 804, godown 5,898 → 5,910) | invoice_cancel |

## 6. Every snapshot, shop by shop

Columns: SQL dues / money on account / on the van; net = dues + van − on account; Sundry Debtors = Σ AR journal lines of the
shop; each screen shows dues / on account / on the van as served; "All agree" compares every screen and the journal.
"ERR 403" for the rep after C4's reactivation: the test's partial upsert removed the shop from the rep's beat, so the rep is
(correctly) refused its dues.

#### A1 — Payment in full, cash at the door

| Snapshot | Shop | SQL dues / on account / on van | Net (SQL) | Sundry Debtors (journal) | Owner | Accountant | Rep | Crew | Shop app | Credit check (limit · headroom · breached) | All agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| after full payment | R-9027 | 0.00 / 0.00 / 0.00 | 0.00 | 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | n/a | 50,000.00 · 50,000.00 · no | yes |

#### A2 — Part payment, cash at the door (₹200 of the bill)

| Snapshot | Shop | SQL dues / on account / on van | Net (SQL) | Sundry Debtors (journal) | Owner | Accountant | Rep | Crew | Shop app | Credit check (limit · headroom · breached) | All agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| after part payment | R-9028 | 395.00 / 0.00 / 0.00 | 395.00 | 395.00 | 395.00 / 0.00 / 0.00 | 395.00 / 0.00 / 0.00 | 395.00 / 0.00 / 0.00 | 395.00 / 0.00 / 0.00 | n/a | 50,000.00 · 49,605.00 · no | yes |

#### A3 — Over-payment, cash at the door (bill + ₹105)

| Snapshot | Shop | SQL dues / on account / on van | Net (SQL) | Sundry Debtors (journal) | Owner | Accountant | Rep | Crew | Shop app | Credit check (limit · headroom · breached) | All agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| after over-payment | R-9029 | 0.00 / 105.00 / 0.00 | -105.00 | -105.00 | 0.00 / 105.00 / 0.00 | 0.00 / 105.00 / 0.00 | 0.00 / 105.00 / 0.00 | 0.00 / 105.00 / 0.00 | n/a | 50,000.00 · 50,000.00 · no | yes |

#### A10 — Cash discount: shop on 2% / 7 days pays the bill less 2% at the door, inside the window

| Snapshot | Shop | SQL dues / on account / on van | Net (SQL) | Sundry Debtors (journal) | Owner | Accountant | Rep | Crew | Shop app | Credit check (limit · headroom · breached) | All agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| after discounted payment | R-9032 | 0.00 / 0.00 / 0.00 | 0.00 | 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | n/a | 50,000.00 · 50,000.00 · no | yes |

#### A7c — The banked cheque bounces (₹250 bank charge)

| Snapshot | Shop | SQL dues / on account / on van | Net (SQL) | Sundry Debtors (journal) | Owner | Accountant | Rep | Crew | Shop app | Credit check (limit · headroom · breached) | All agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| after bounce | R-9031 | 595.00 / 0.00 / 0.00 | 595.00 | 595.00 | 595.00 / 0.00 / 0.00 | 595.00 / 0.00 / 0.00 | 595.00 / 0.00 / 0.00 | 595.00 / 0.00 / 0.00 | n/a | 50,000.00 · 49,405.00 · no | yes |

#### S1-close — All six shops after settlement, banking and the bounce

| Snapshot | Shop | SQL dues / on account / on van | Net (SQL) | Sundry Debtors (journal) | Owner | Accountant | Rep | Crew | Shop app | Credit check (limit · headroom · breached) | All agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| close | R-9027 | 0.00 / 0.00 / 0.00 | 0.00 | 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | n/a | 50,000.00 · 50,000.00 · no | yes |
| close | R-9028 | 395.00 / 0.00 / 0.00 | 395.00 | 395.00 | 395.00 / 0.00 / 0.00 | 395.00 / 0.00 / 0.00 | 395.00 / 0.00 / 0.00 | 395.00 / 0.00 / 0.00 | n/a | 50,000.00 · 49,605.00 · no | yes |
| close | R-9029 | 0.00 / 105.00 / 0.00 | -105.00 | -105.00 | 0.00 / 105.00 / 0.00 | 0.00 / 105.00 / 0.00 | 0.00 / 105.00 / 0.00 | 0.00 / 105.00 / 0.00 | n/a | 50,000.00 · 50,000.00 · no | yes |
| close | R-9030 | 0.00 / 0.00 / 0.00 | 0.00 | 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | n/a | 50,000.00 · 50,000.00 · no | yes |
| close | R-9031 | 595.00 / 0.00 / 0.00 | 595.00 | 595.00 | 595.00 / 0.00 / 0.00 | 595.00 / 0.00 / 0.00 | 595.00 / 0.00 / 0.00 | 595.00 / 0.00 / 0.00 | n/a | 50,000.00 · 49,405.00 · no | yes |
| close | R-9032 | 0.00 / 0.00 / 0.00 | 0.00 | 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | n/a | 50,000.00 · 50,000.00 · no | yes |

#### A7e — Late cash for a settled trip: refused at the door; the cashier records it at the office

| Snapshot | Shop | SQL dues / on account / on van | Net (SQL) | Sundry Debtors (journal) | Owner | Accountant | Rep | Crew | Shop app | Credit check (limit · headroom · breached) | All agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| after late cash | R-9067 | 0.00 / 10.00 / 0.00 | -10.00 | -10.00 | 0.00 / 10.00 / 0.00 | 0.00 / 10.00 / 0.00 | 0.00 / 10.00 / 0.00 | 0.00 / 10.00 / 0.00 | n/a | 50,000.00 · 50,000.00 · no | yes |

#### A4a — One desk receipt against outstanding, no bill named: allocated oldest bill first (seeded R-0020, 6 open bills)

| Snapshot | Shop | SQL dues / on account / on van | Net (SQL) | Sundry Debtors (journal) | Owner | Accountant | Rep | Crew | Shop app | Credit check (limit · headroom · breached) | All agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| before | R-0020 | 1,21,522.00 / 0.00 / 0.00 | 1,21,522.00 | 1,21,522.00 | 1,21,522.00 / 0.00 / 0.00 | 1,21,522.00 / 0.00 / 0.00 | 1,21,522.00 / 0.00 / 0.00 | 1,21,522.00 / 0.00 / 0.00 | n/a | 1,80,000.00 · 58,478.00 · no (overdue_days_exceeded) | yes |
| after FIFO receipt | R-0020 | 73,529.00 / 0.00 / 0.00 | 73,529.00 | 73,529.00 | 73,529.00 / 0.00 / 0.00 | 73,529.00 / 0.00 / 0.00 | 73,529.00 / 0.00 / 0.00 | 73,529.00 / 0.00 / 0.00 | n/a | 1,80,000.00 · 1,06,471.00 · no (overdue_days_exceeded) | yes |

#### A4b — One desk receipt hand-picked to the newest and a middle bill (seeded R-0015, 5 open bills)

| Snapshot | Shop | SQL dues / on account / on van | Net (SQL) | Sundry Debtors (journal) | Owner | Accountant | Rep | Crew | Shop app | Credit check (limit · headroom · breached) | All agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| after hand-picked receipt | R-0015 | 64,866.00 / 0.00 / 0.00 | 64,866.00 | 64,866.00 | 64,866.00 / 0.00 / 0.00 | 64,866.00 / 0.00 / 0.00 | 64,866.00 / 0.00 / 0.00 | 64,866.00 / 0.00 / 0.00 | n/a | 1,80,000.00 · 1,15,134.00 · no (overdue_days_exceeded) | yes |

#### A6 — Receipt kept on account (strategy none), then the accountant allocates it, then removes one allocation

| Snapshot | Shop | SQL dues / on account / on van | Net (SQL) | Sundry Debtors (journal) | Owner | Accountant | Rep | Crew | Shop app | Credit check (limit · headroom · breached) | All agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| on account | R-0020 | 73,529.00 / 300.00 / 0.00 | 73,229.00 | 73,229.00 | 73,529.00 / 300.00 / 0.00 | 73,529.00 / 300.00 / 0.00 | 73,529.00 / 300.00 / 0.00 | 73,529.00 / 300.00 / 0.00 | n/a | 1,80,000.00 · 1,06,471.00 · no (overdue_days_exceeded) | yes |
| after remove | R-0020 | 73,529.00 / 300.00 / 0.00 | 73,229.00 | 73,229.00 | 73,529.00 / 300.00 / 0.00 | 73,529.00 / 300.00 / 0.00 | 73,529.00 / 300.00 / 0.00 | 73,529.00 / 300.00 / 0.00 | n/a | 1,80,000.00 · 1,06,471.00 · no (overdue_days_exceeded) | yes |

#### A5a — Payment before delivery: bill packed, the shop pays by UPI at the office, then the van delivers

| Snapshot | Shop | SQL dues / on account / on van | Net (SQL) | Sundry Debtors (journal) | Owner | Accountant | Rep | Crew | Shop app | Credit check (limit · headroom · breached) | All agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| after delivery of a prepaid bill | R-9033 | 0.00 / 0.00 / 0.00 | 0.00 | 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | n/a | 50,000.00 · 50,000.00 · no | yes |

#### A5b — Advance: the shop pays ₹1,000 before any order; the order is then placed, billed and delivered

| Snapshot | Shop | SQL dues / on account / on van | Net (SQL) | Sundry Debtors (journal) | Owner | Accountant | Rep | Crew | Shop app | Credit check (limit · headroom · breached) | All agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| after advance | R-9034 | 0.00 / 1,000.00 / 0.00 | -1,000.00 | -1,000.00 | 0.00 / 1,000.00 / 0.00 | 0.00 / 1,000.00 / 0.00 | 0.00 / 1,000.00 / 0.00 | 0.00 / 1,000.00 / 0.00 | n/a | 1,000.00 · 405.00 · no | yes |
| advance + new bill | R-9034 | 595.00 / 1,000.00 / 0.00 | -405.00 | -405.00 | 595.00 / 1,000.00 / 0.00 | 595.00 / 1,000.00 / 0.00 | 595.00 / 1,000.00 / 0.00 | 595.00 / 1,000.00 / 0.00 | n/a | 1,000.00 · -190.00 · yes (limit_exceeded) | yes |
| advance applied | R-9034 | 0.00 / 405.00 / 0.00 | -405.00 | -405.00 | 0.00 / 405.00 / 0.00 | 0.00 / 405.00 / 0.00 | 0.00 / 405.00 / 0.00 | 0.00 / 405.00 / 0.00 | n/a | 1,000.00 · 1,000.00 · no | yes |

#### A8 — A desk cash receipt allocated across two bills is reversed

| Snapshot | Shop | SQL dues / on account / on van | Net (SQL) | Sundry Debtors (journal) | Owner | Accountant | Rep | Crew | Shop app | Credit check (limit · headroom · breached) | All agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| after reversal | R-9035 | 798.00 / 0.00 / 0.00 | 798.00 | 798.00 | 798.00 / 0.00 / 0.00 | 798.00 / 0.00 / 0.00 | 798.00 / 0.00 / 0.00 | 798.00 / 0.00 / 0.00 | n/a | 50,000.00 · 49,202.00 · no | yes |

#### A9 — The same receipt twice: same idempotency key; then a new key with the same cheque number; then the same paper receipt from a device

| Snapshot | Shop | SQL dues / on account / on van | Net (SQL) | Sundry Debtors (journal) | Owner | Accountant | Rep | Crew | Shop app | Credit check (limit · headroom · breached) | All agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| after duplicates | R-9036 | 0.00 / 645.00 / 0.00 | -645.00 | -645.00 | 0.00 / 645.00 / 0.00 | 0.00 / 645.00 / 0.00 | 0.00 / 645.00 / 0.00 | 0.00 / 645.00 / 0.00 | n/a | 50,000.00 · 50,000.00 · no | yes |

#### A12 — Refund / return of money on account (S1 shop PA3 holds ₹105)

| Snapshot | Shop | SQL dues / on account / on van | Net (SQL) | Sundry Debtors (journal) | Owner | Accountant | Rep | Crew | Shop app | Credit check (limit · headroom · breached) | All agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PA3 after refund attempts | R-9029 | 0.00 / 105.00 / 0.00 | -105.00 | -105.00 | 0.00 / 105.00 / 0.00 | 0.00 / 105.00 / 0.00 | 0.00 / 105.00 / 0.00 | 0.00 / 105.00 / 0.00 | n/a | 50,000.00 · 50,000.00 · no | yes |

#### A13 — Bad-debt write-off of the rest of a bill, then the shop pays it after all

| Snapshot | Shop | SQL dues / on account / on van | Net (SQL) | Sundry Debtors (journal) | Owner | Accountant | Rep | Crew | Shop app | Credit check (limit · headroom · breached) | All agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| after write-off | R-9037 | 0.00 / 0.00 / 0.00 | 0.00 | 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | n/a | 50,000.00 · 50,000.00 · no | yes |
| after the late payment | R-9037 | 0.00 / 395.00 / 0.00 | -395.00 | -395.00 | 0.00 / 395.00 / 0.00 | 0.00 / 395.00 / 0.00 | 0.00 / 395.00 / 0.00 | 0.00 / 395.00 / 0.00 | n/a | 50,000.00 · 50,000.00 · no | yes |
| next bill after the recovered money | R-9037 | 595.00 / 395.00 / 0.00 | 200.00 | 200.00 | 595.00 / 395.00 / 0.00 | 595.00 / 395.00 / 0.00 | 595.00 / 395.00 / 0.00 | 595.00 / 395.00 / 0.00 | n/a | 50,000.00 · 49,405.00 · no | yes |

#### A9b — The same UPI UTR recorded twice (same shop), then once more against another shop

| Snapshot | Shop | SQL dues / on account / on van | Net (SQL) | Sundry Debtors (journal) | Owner | Accountant | Rep | Crew | Shop app | Credit check (limit · headroom · breached) | All agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| after duplicate UTRs | R-9068 | 0.00 / 105.00 / 0.00 | -105.00 | -105.00 | 0.00 / 105.00 / 0.00 | 0.00 / 105.00 / 0.00 | 0.00 / 105.00 / 0.00 | 0.00 / 105.00 / 0.00 | n/a | 50,000.00 · 50,000.00 · no | yes |
| after duplicate UTRs | R-9036 | 0.00 / 750.00 / 0.00 | -750.00 | -750.00 | 0.00 / 750.00 / 0.00 | 0.00 / 750.00 / 0.00 | 0.00 / 750.00 / 0.00 | 0.00 / 750.00 / 0.00 | n/a | 50,000.00 · 50,000.00 · no | yes |

#### C1 — Warn-only shop (indicate): an order over the limit goes through with a credit notice

| Snapshot | Shop | SQL dues / on account / on van | Net (SQL) | Sundry Debtors (journal) | Owner | Accountant | Rep | Crew | Shop app | Credit check (limit · headroom · breached) | All agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| before | R-9038 | 0.00 / 0.00 / 0.00 | 0.00 | 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | n/a | 500.00 · -95.00 · no (limit_exceeded) | yes |

#### C2 — Hold shop (strict): just under, exactly at, and just over the limit; the held one approved

| Snapshot | Shop | SQL dues / on account / on van | Net (SQL) | Sundry Debtors (journal) | Owner | Accountant | Rep | Crew | Shop app | Credit check (limit · headroom · breached) | All agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| limit = order exactly | R-9039 | 0.00 / 0.00 / 0.00 | 0.00 | 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | n/a | 595.00 · 0.00 · no | yes |
| held | R-9039 | 0.00 / 0.00 / 0.00 | 0.00 | 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | n/a | 594.99 · -0.01 · yes (limit_exceeded) | yes |

#### C3 — Strict shop, ₹1,000 limit: two ₹595 orders placed before either is billed

| Snapshot | Shop | SQL dues / on account / on van | Net (SQL) | Sundry Debtors (journal) | Owner | Accountant | Rep | Crew | Shop app | Credit check (limit · headroom · breached) | All agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| first confirmed, not billed | R-9040 | 0.00 / 0.00 / 0.00 | 0.00 | 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | n/a | 1,000.00 · 405.00 · no | yes |
| both billed | R-9040 | 1,190.00 / 0.00 / 0.00 | 1,190.00 | 1,190.00 | 1,190.00 / 0.00 / 0.00 | 1,190.00 / 0.00 / 0.00 | 1,190.00 / 0.00 / 0.00 | 1,190.00 / 0.00 / 0.00 | n/a | 1,000.00 · -190.00 · yes (limit_exceeded) | yes |

#### C4 — Blocked shop (stop): over the limit; the manager and the owner decide; then the shop is reactivated

| Snapshot | Shop | SQL dues / on account / on van | Net (SQL) | Sundry Debtors (journal) | Owner | Accountant | Rep | Crew | Shop app | Credit check (limit · headroom · breached) | All agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| after reactivation | R-9041 | 0.00 / 0.00 / 0.00 | 0.00 | 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | ERR 403 a salesperson se | 0.00 / 0.00 / 0.00 | n/a | 500.00 · -95.00 · no (limit_exceeded) | yes |

#### C6 — Bill-count limit and overdue days (seeded R-0017, strict, 5 open bills)

| Snapshot | Shop | SQL dues / on account / on van | Net (SQL) | Sundry Debtors (journal) | Owner | Accountant | Rep | Crew | Shop app | Credit check (limit · headroom · breached) | All agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| big limit, 6-bill cap, 7 credit days | R-0017 | 24,365.00 / 0.00 / 0.00 | 24,365.00 | 24,365.00 | 24,365.00 / 0.00 / 0.00 | 24,365.00 / 0.00 / 0.00 | 24,365.00 / 0.00 / 0.00 | 24,365.00 / 0.00 / 0.00 | n/a | 1,00,00,000.00 · 99,75,040.00 · yes (overdue_days_exceeded) | yes |
| 5-bill cap with 5 open bills | R-0017 | 24,365.00 / 0.00 / 0.00 | 24,365.00 | 24,365.00 | 24,365.00 / 0.00 / 0.00 | 24,365.00 / 0.00 / 0.00 | 24,365.00 / 0.00 / 0.00 | 24,365.00 / 0.00 / 0.00 | n/a | 1,00,00,000.00 · 99,75,040.00 · yes (bill_count_exceeded) | yes |

#### C7 — Limit lowered below what the shop already owes (CR3 owes ₹1,190)

| Snapshot | Shop | SQL dues / on account / on van | Net (SQL) | Sundry Debtors (journal) | Owner | Accountant | Rep | Crew | Shop app | Credit check (limit · headroom · breached) | All agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| limit ₹200 on ₹1,190 owed | R-9040 | 1,190.00 / 0.00 / 0.00 | 1,190.00 | 1,190.00 | 1,190.00 / 0.00 / 0.00 | 1,190.00 / 0.00 / 0.00 | 1,190.00 / 0.00 / 0.00 | 1,190.00 / 0.00 / 0.00 | n/a | 200.00 · -991.00 · yes (limit_exceeded) | yes |

#### C8 — Every screen for a shop with its own login (seeded R-0001, ramesh.gupta, strict)

| Snapshot | Shop | SQL dues / on account / on van | Net (SQL) | Sundry Debtors (journal) | Owner | Accountant | Rep | Crew | Shop app | Credit check (limit · headroom · breached) | All agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R-0001 as seeded | R-0001 | 35,843.00 / 0.00 / 0.00 | 35,843.00 | 35,843.00 | 35,843.00 / 0.00 / 0.00 | 35,843.00 / 0.00 / 0.00 | 35,843.00 / 0.00 / 0.00 | 35,843.00 / 0.00 / 0.00 | 35,843.00 / 0.00 / 0.00 | 50,000.00 · 13,562.00 · yes (overdue_days_exceeded) | yes |
| R-0001 after a rep order | R-0001 | 35,843.00 / 0.00 / 0.00 | 35,843.00 | 35,843.00 | 35,843.00 / 0.00 / 0.00 | 35,843.00 / 0.00 / 0.00 | 35,843.00 / 0.00 / 0.00 | 35,843.00 / 0.00 / 0.00 | 35,843.00 / 0.00 / 0.00 | 50,000.00 · 13,562.00 · yes (overdue_days_exceeded) | yes |

#### C9 — Seeded R-0047 Mangal Traders: ₹5,000 on account, one ₹867 bill overdue, strict — what the gate and the screens say

| Snapshot | Shop | SQL dues / on account / on van | Net (SQL) | Sundry Debtors (journal) | Owner | Accountant | Rep | Crew | Shop app | Credit check (limit · headroom · breached) | All agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| as seeded | R-0047 | 867.00 / 5,000.00 / 0.00 | -4,133.00 | -4,133.00 | 867.00 / 5,000.00 / 0.00 | 867.00 / 5,000.00 / 0.00 | ERR 403 a salesperson se | 867.00 / 5,000.00 / 0.00 | n/a | 50,000.00 · 48,538.00 · yes (overdue_days_exceeded) | yes |

#### R1 — Full return at the door: the shop refuses everything (delivered 0, all returned, saleable)

| Snapshot | Shop | SQL dues / on account / on van | Net (SQL) | Sundry Debtors (journal) | Owner | Accountant | Rep | Crew | Shop app | Credit check (limit · headroom · breached) | All agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| after the door | R-9058 | 0.00 / 0.00 / 595.00 | 595.00 | 595.00 | 0.00 / 0.00 / 595.00 | 0.00 / 0.00 / 595.00 | 0.00 / 0.00 / 595.00 | 0.00 / 0.00 / 595.00 | n/a | 1,00,000.00 · 99,405.00 · no | yes |

#### R2 — Part return at the door: 6 of 24 Glucose back, saleable

| Snapshot | Shop | SQL dues / on account / on van | Net (SQL) | Sundry Debtors (journal) | Owner | Accountant | Rep | Crew | Shop app | Credit check (limit · headroom · breached) | All agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| after the door | R-9054 | 542.00 / 0.00 / 0.00 | 542.00 | 542.00 | 542.00 / 0.00 / 0.00 | 542.00 / 0.00 / 0.00 | 542.00 / 0.00 / 0.00 | 542.00 / 0.00 / 0.00 | n/a | 1,00,000.00 · 99,458.00 · no | yes |

#### R3 — Wrong item at the door: 2 Cola sent back as wrong item, saleable

| Snapshot | Shop | SQL dues / on account / on van | Net (SQL) | Sundry Debtors (journal) | Owner | Accountant | Rep | Crew | Shop app | Credit check (limit · headroom · breached) | All agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| after the door | R-9055 | 531.00 / 0.00 / 0.00 | 531.00 | 531.00 | 531.00 / 0.00 / 0.00 | 531.00 / 0.00 / 0.00 | 531.00 / 0.00 / 0.00 | 531.00 / 0.00 / 0.00 | n/a | 1,00,000.00 · 99,469.00 · no | yes |

#### R4 — Damaged and expired at the door: 3 Marie damaged, 2 Glucose expired, not saleable

| Snapshot | Shop | SQL dues / on account / on van | Net (SQL) | Sundry Debtors (journal) | Owner | Accountant | Rep | Crew | Shop app | Credit check (limit · headroom · breached) | All agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| after the door | R-9056 | 432.00 / 0.00 / 0.00 | 432.00 | 432.00 | 432.00 / 0.00 / 0.00 | 432.00 / 0.00 / 0.00 | 432.00 / 0.00 / 0.00 | 432.00 / 0.00 / 0.00 | n/a | 1,00,000.00 · 99,568.00 · no | yes |

#### R1b — The shop refuses at the door without a delivery record: stop failed "refused" (the bill comes back)

| Snapshot | Shop | SQL dues / on account / on van | Net (SQL) | Sundry Debtors (journal) | Owner | Accountant | Rep | Crew | Shop app | Credit check (limit · headroom · breached) | All agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| failed stop, still on the van | R-9059 | 0.00 / 0.00 / 595.00 | 595.00 | 595.00 | 0.00 / 0.00 / 595.00 | 0.00 / 0.00 / 595.00 | 0.00 / 0.00 / 595.00 | 0.00 / 0.00 / 595.00 | n/a | 1,00,000.00 · 99,405.00 · no | yes |

#### S4-settle — Check in and settle: what the van carries back and where each returned batch ends up

| Snapshot | Shop | SQL dues / on account / on van | Net (SQL) | Sundry Debtors (journal) | Owner | Accountant | Rep | Crew | Shop app | Credit check (limit · headroom · breached) | All agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| after check-in (bill undelivered) | R-9059 | 0.00 / 0.00 / 595.00 | 595.00 | 595.00 | 0.00 / 0.00 / 595.00 | 0.00 / 0.00 / 595.00 | 0.00 / 0.00 / 595.00 | 0.00 / 0.00 / 595.00 | n/a | 1,00,000.00 · 99,405.00 · no | yes |

#### R6 — Return after delivery, at the desk: RT8 returns 6 Glucose (saleable) — credit note restocks the godown

| Snapshot | Shop | SQL dues / on account / on van | Net (SQL) | Sundry Debtors (journal) | Owner | Accountant | Rep | Crew | Shop app | Credit check (limit · headroom · breached) | All agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| after desk return | R-9061 | 542.00 / 0.00 / 0.00 | 542.00 | 542.00 | 542.00 / 0.00 / 0.00 | 542.00 / 0.00 / 0.00 | 542.00 / 0.00 / 0.00 | 542.00 / 0.00 / 0.00 | n/a | 1,00,000.00 · 99,458.00 · no | yes |

#### R7 — Return after payment: RT7 paid in full, then returns 12 Cola (saleable) at the desk

| Snapshot | Shop | SQL dues / on account / on van | Net (SQL) | Sundry Debtors (journal) | Owner | Accountant | Rep | Crew | Shop app | Credit check (limit · headroom · breached) | All agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| after return on a paid bill | R-9060 | 0.00 / 384.00 / 0.00 | -384.00 | -384.00 | 0.00 / 384.00 / 0.00 | 0.00 / 384.00 / 0.00 | 0.00 / 384.00 / 0.00 | 0.00 / 384.00 / 0.00 | n/a | 1,00,000.00 · 1,00,000.00 · no | yes |

#### R8 — Return of scheme lines at the desk: RT4 returns 12 of 24 Glucose (12+2 free) and 6 of 12 soap (10% off)

| Snapshot | Shop | SQL dues / on account / on van | Net (SQL) | Sundry Debtors (journal) | Owner | Accountant | Rep | Crew | Shop app | Credit check (limit · headroom · breached) | All agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| after scheme returns | R-9057 | 182.00 / 0.00 / 0.00 | 182.00 | 182.00 | 182.00 / 0.00 / 0.00 | 182.00 / 0.00 / 0.00 | 182.00 / 0.00 / 0.00 | 182.00 / 0.00 / 0.00 | n/a | 1,00,000.00 · 99,818.00 · no | yes |

#### R10 — Bill cancelled before dispatch (RT9: packed, billed, never loaded)

| Snapshot | Shop | SQL dues / on account / on van | Net (SQL) | Sundry Debtors (journal) | Owner | Accountant | Rep | Crew | Shop app | Credit check (limit · headroom · breached) | All agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| after cancel | R-9062 | 0.00 / 0.00 / 0.00 | 0.00 | 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | n/a | 1,00,000.00 · 1,00,000.00 · no | yes |

#### R11 — Bill cancelled after payment was taken (RT10 paid ₹595 by UPI at the office, bill still in the godown)

| Snapshot | Shop | SQL dues / on account / on van | Net (SQL) | Sundry Debtors (journal) | Owner | Accountant | Rep | Crew | Shop app | Credit check (limit · headroom · breached) | All agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| after cancel attempt on a paid bill | R-9063 | 0.00 / 0.00 / 0.00 | 0.00 | 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | n/a | 1,00,000.00 · 1,00,000.00 · no | yes |

#### R1c — Full refusal, final: the desk credits the whole came-back bill (RT5) — stock back from the dock, dues cleared

| Snapshot | Shop | SQL dues / on account / on van | Net (SQL) | Sundry Debtors (journal) | Owner | Accountant | Rep | Crew | Shop app | Credit check (limit · headroom · breached) | All agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RT5 after the whole-bill credit | R-9058 | 0.00 / 0.00 / 0.00 | 0.00 | 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | n/a | 1,00,000.00 · 1,00,000.00 · no | yes |

#### R1d — The other refused bill (RT6) goes out again on a new trip, is delivered and paid in cash

| Snapshot | Shop | SQL dues / on account / on van | Net (SQL) | Sundry Debtors (journal) | Owner | Accountant | Rep | Crew | Shop app | Credit check (limit · headroom · breached) | All agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RT6 after re-delivery | R-9059 | 0.00 / 0.00 / 0.00 | 0.00 | 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | n/a | 1,00,000.00 · 1,00,000.00 · no | yes |
