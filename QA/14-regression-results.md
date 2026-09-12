# 14 — Regression results

The five regressions of Charter A.12 after every approved change batch. Tests always run against a throwaway copy of
`dos_batch1_template` (never `dos` or `dos_qa`, which the DB-backed specs would pollute). Walkthroughs run against `dos_qa`.

## Batch 1 (approved 2026-09-12: 4 P0 + 30 on-chain P1)

### 0. Baseline before any product change (commit c5c6e03, DB `dos_batch1_baseline`)

The CI chain of CLAUDE.md, run unchanged, so later failures can be told apart from ones that already existed.

| Step | Backend (real run) | Frontend (real run, `--force`, 0 cached) |
|---|---|---|
| format:check | exit 0 (7 s) | exit 0 (5 s) |
| lint | exit 0, 19/19 tasks, 0 cached (47 s) | exit 0, 11/11 (16 s) |
| typecheck | exit 0, 19/19 (18 s) | exit 0, 11/11 (14 s) |
| build | exit 0, 14/14 (5 s) | exit 0, 8/8 — all seven `expo export --platform web` (105 s) |
| docs:readme:check | exit 0 | — |
| db:migrate | exit 0 (43 migrations) | — |
| test | exit 0, **2 381 passed, 0 failed** (51 s) | exit 0, **301 passed** (ui 196, api-client 67, offline 38) |

Backend tests per package: domain 86 · contracts 78 · core 500 · db 101 · auth-service 3 · owner-service 343 ·
manager-service 343 · sales-service 202 · warehouse-service 251 · delivery-service 258 · retailer-service 189 ·
admin-service 23 · worker 3 · all-in-one 1. The `ORPCError: Input validation failed` lines in the delivery-service
log are expected refusals inside passing specs, not failures.
Logs: session scratchpad `baseline/*.log` (summarised here; not kept in the repo).

### 0b. CI chain on merged main — 21 decision-free fixes (merge 2abb27e + README regeneration 0a9deac, DB `dos_batch1_merged`, every step `--force`)

| Step | Backend | Frontend |
|---|---|---|
| format:check | exit 0 | exit 0 |
| lint | exit 0, 19/19, 0 cached | exit 0, 11/11, 0 cached |
| typecheck | exit 0, 19/19 | exit 0, 11/11 |
| build | exit 0, 14/14 | exit 0, 8/8 (seven web exports) |
| docs:readme:check | exit 0 after `pnpm docs:readme` (12 READMEs regenerated for DOS-073's orders.list summary; the first check in the script ran before the build and read stale dist — script ordering, not a product fault) | — |
| db:migrate | exit 0 | — |
| schema drift (`drizzle-kit generate`) | "No schema changes, nothing to migrate" (first attempt used GNU `timeout`, absent on macOS, exit 127; re-run by hand) | — |
| test | exit 0, **2 417 passed, 0 failed** (baseline 2 381: domain 86→95, contracts 78→79, core 500→525, db 101→102) | exit 0, **336 passed** (baseline 301: ui 196→216, api-client 67→72, offline 38, new app specs sales 1, delivery 6, manager 3) |

No test that passed at the baseline fails on merged main. Six existing tests were changed by the fixes; each is reviewed in `QA/13-change-log.md` (five encoded the defect, one fixture unit).

### 1. Focused regression — the fixes, re-walked in the running product

**Part A — web (desk 1280×800 and phone 390×844) outside the manager app, 2026-09-13 00:55–02:25 IST, dos_qa, Opus walkers with their own browsers.**
Totals for part A (web + API): 53 PASS · 3 FAIL · 2 NOT TESTED. The two API FAILs are residual probes, not fixes (below, §5). Full results:
`QA/evidence/batch1/regression/part-a-results.json`; screenshots and saved responses under `QA/evidence/batch1/regression/web-*/`.

| Fix | Group | Platform | Status | What was seen | First evidence |
|---|---|---|---|---|---|
| DOS-039 | warehouse | web-desk 1280x800 | **PASS** | POST /warehouse/load-sheets/374f2089…/confirm returned 200; the request carried countedPackages 35 and countedVanStock []. The toast read 'Vehicle … | `QA/evidence/batch1/regression/web-warehouse/db-039-before.txt` |
| DOS-039 | warehouse | web-phone 390x844 | **NOT TESTED** | The confirm itself was not executed at phone width: only one load sheet may be confirmed in this run, and it was confirmed at desk. What was … | `QA/evidence/batch1/regression/web-warehouse/039-08-confirmed-sheet-phone.png` |
| DOS-040 | warehouse | web-desk 1280x800 | **PASS** | - Not started: chip 'open', 'This sheet has not been started', 6 rows, 0 Picked, 0 Short, no Scan, no 'Take it to packing', 1 'Start picking'. - API … | `QA/evidence/batch1/regression/web-warehouse/040-01-pick-queue-desk.png` |
| DOS-040 | warehouse | web-phone 390x844 | **PASS** | - Not started: scrollWidth 390; 'This sheet has not been started' at y=242; 'Start picking' 358×76 at y=666; 0 Picked/Short, no Scan, no 'Take it to … | `QA/evidence/batch1/regression/web-warehouse/040-04-sheet-not-started-phone.png` |
| DOS-041 | warehouse | web-desk 1280x800 | **PASS** | - HTTP over-ask: 400 'batch GK20260623 on PICK-0082 asks for 20 pcs; 34 were picked'. - Sync over-ask: 200 with accepted 0, rejected pick_rejected … | `QA/evidence/batch1/regression/web-warehouse/041-01-so0883-selected.png` |
| DOS-041 | warehouse | web-phone 390x844 | **PASS** | - The sheet showed 'Requested 12 pc', the pad 20, and the over-ask line 'This batch asks for 12 pc. Count again — more cannot be saved on this line.' … | `QA/evidence/batch1/regression/web-warehouse/041-10-short-sheet-12pc-phone.png` |
| DOS-042 | warehouse | web-desk 1280x800 | **PASS** | - At 3 of 4: picklists.status picking, completed_at NULL; the 12-pc row 0 / NULL / NULL. Screen '3 of 4 picked', chip 'picking', 'Take it to packing' … | `QA/evidence/batch1/regression/web-warehouse/041-09-short-2-saved-desk.png` |
| DOS-042 | warehouse | web-phone 390x844 | **PASS** | - Picked on the 13-pc row: accepted 1. - Phone: '3 of 4 picked', chip 'picking', 'Take it to packing' disabled (163×76 at y=644) with '1 line not yet … | `QA/evidence/batch1/regression/web-warehouse/042-01-three-of-four-phone.png` |
| DOS-042 probe B (refused op on screen) | warehouse | web-desk 1280x800 | **PASS** | - The device upload was rejected with code 'stale', not picklist_closed: the other device had already changed the row, so the LWW veto answers first. … | `QA/evidence/batch1/regression/web-warehouse/042b-01-new-wave-before-pull-desk.png` |
| DOS-094 | retailer | web-desk 1280x800 | **PASS** | All bills: HTTP 200, upi://pay?pa=tarsun%40okhdfcbank&pn=Tarsun%20Enterprise&am=35843.00&tr=PAY-5c0672c7d3e5&tn=PAY-5c0672c7d3e5&cu=INR. One prefix, … | `QA/evidence/batch1/regression/web-retailer/094-01-money-due.png` |
| DOS-094 | retailer | web-phone 390x844 | **PASS** | All bills: 200, am=35843.00&tr=PAY-c978af6c6fdb&tn=PAY-c978af6c6fdb&cu=INR, qr==intent, payee 'Tarsun Enterprise tarsun@okhdfcbank'. Screen: 'Quote … | `QA/evidence/batch1/regression/web-retailer/094-09-money-due-phone.png` |
| DOS-095 | retailer | web-desk 1280x800 | **PASS** | Last 90 days: exactly one GET ?from=2026-06-16&to=2026-09-13&limit=200 returning 53 items with nextCursor null. 53 rows, first INV/0034, last … | `QA/evidence/batch1/regression/web-retailer/095-01-statement-d90-desk.png` |
| DOS-095 | retailer | web-phone 390x844 | **PASS** | One GET limit=200 returning 53 items with nextCursor null. 53 rows; the end of the list reads RCPT-0659 ₹63,535 → RCPT-0668 ₹51,355 → RCPT-0672 … | `QA/evidence/batch1/regression/web-retailer/095-06-statement-d90-phone-top.png` |
| DOS-099 | retailer | web-desk 1280x800 | **PASS** | Open the bill called … | `QA/evidence/batch1/regression/web-retailer/099-01-my-bills-desk.png` |
| DOS-099 | retailer | web-phone 390x844 | **PASS** | Open the bill called window.open('http://127.0.0.1:3006/storage/…/invoice/a924ae38….pdf?expires=1789245002&signature=4b35…'); curl: 200 … | `QA/evidence/batch1/regression/web-retailer/099-07-my-bills-phone.png` |
| DOS-058 | delivery | web-desk 1280x800 | **PASS** | - After '−': exactly one reason control (d4-reason-88a690ee…) reading 'Shop refused it \| Damaged \| Past its date'. The old 'Damaged — into the … | `QA/evidence/batch1/regression/web-delivery/d058-01-stop8-desk.png` |
| DOS-058 | delivery | web-phone 390x844 | **PASS** | - Reason controls on the page: 1. - Chips sit in one row at x=35/159/249 (widths 122/89/106, height 69), inside 390 px, with no horizontal page … | `QA/evidence/batch1/regression/web-delivery/d058-07-stop8-phone.png` |
| DOS-058 | delivery | api | **PASS** | - damaged → HTTP 400 {code:'return_not_saleable', invoiceLineId:'88a690ee-05d7-7410-ad6c-b47411c564ca', reason:'damaged'}, message 'Sunbake Butter … | `QA/evidence/batch1/regression/web-delivery/d058-api-probe-damaged.txt` |
| DOS-061 | delivery | web-desk 1280x800 | **PASS** | - Home: 'TRIP-ACTIVE · 12 Sep 2026 · Today's trip · On the road · 9 of 10 stops done · MH-05-AB-1234'. - Next stop: Laxmi Narayan Stores ₹22,508.00, … | `QA/evidence/batch1/regression/web-delivery/d061-01-home-desk.png` |
| DOS-061 | delivery | web-phone 390x844 | **PASS** | - Home: 'TRIP-ACTIVE · 12 Sep 2026 · Today's trip · On the road · 9 of 10 stops done'; 'Load on board · DC-0081 · 64 cartons on board · Confirmed'. - … | `QA/evidence/batch1/regression/web-delivery/d061-07-home-phone.png` |
| DOS-057 | delivery | web-desk 1280x800 | **PASS** | - Invoice buttons d9-open, d9-print and d9-share were all enabled. - Open → … | `QA/evidence/batch1/regression/web-delivery/d057-01-d9-inv0826-desk.png` |
| DOS-057 | delivery | web-phone 390x844 | **PASS** | - INV/0826 Open and Send → window.open of the absolute :3005 signed URL → 200 application/pdf, 21,840 B; toast 'Nothing was sent'. - CN/9003 sheet → … | `QA/evidence/batch1/regression/web-delivery/d057-07-d9-inv0826-phone.png` |
| DOS-057 | delivery | db | **PASS** | - Exactly one row: aggregate_id receipt:01a09730-2e39-7179-a747-6ac2734d5218:a5:original, event_type DocumentRenderRequested, payload {kind:receipt, … | `QA/evidence/batch1/regression/web-delivery/d057-d060-db-rcpt0701.txt` |
| DOS-060 | delivery | web-desk 1280x800 | **PASS** | - The field is INPUT type=text inputmode=decimal. - Empty → 'Record the payment' disabled. - '22508' → field shows 22508, Record enabled. - '2843.5' … | `QA/evidence/batch1/regression/web-delivery/d060-01-stop3-desk.png` |
| DOS-060 | delivery | web-phone 390x844 | **PASS** | - Field value '2843', Record enabled. - POST :3005/delivery/collections {mode:'cash', amountPaise:284300, stopId:6c4c742c…, tripId:dda35990…} → 200. … | `QA/evidence/batch1/regression/web-delivery/d060-05-d5-phone.png` |
| DOS-073 | sales-owner | api | **PASS** | GET Y, GET D and GET random all 404 'order <id> not found'. Both list calls 200 with 50 items, all salespersonId = Rahul (8760e17e…), no Amit ids, no … | `QA/evidence/batch1/regression/web-sales-owner/DOS-073-api-probes.txt` |
| DOS-073 | sales-owner | web-desk 1280x800 | **PASS** | My orders lists 18 of Rahul's orders (SO-0893…SO-9001); SO-0894 (Amit) is absent. The direct URL shows 'Order — That order is not on this phone', and … | `QA/evidence/batch1/regression/web-sales-owner/DOS-073-01-sales-home-desk.png` |
| DOS-073 | sales-owner | web-phone 390x844 | **PASS** | 'That order is not on this phone' (404 on GET /orders/Y). The Orders list shows 18 order numbers, none of them SO-0894. | `QA/evidence/batch1/regression/web-sales-owner/DOS-073-04-rahul-amit-order-url-phone.png` |
| DOS-075 | sales-owner | api | **PASS** | (a) HTTP 200: gross 2873760, discount 57475, net 2816285, orderRules [{ruleId 6ac23a1a-ce35-76d2-a002-3a7888fc1c65, v1, order_pct, 57475}], … | `QA/evidence/batch1/regression/web-sales-owner/api-quotes.txt` |
| DOS-075 | sales-owner | web-desk 1280x800 | **PASS** | The line reads ₹119.74/pc · 12 pc case, ₹28,162.85, −₹574.75. 'Schemes on this order −₹574.75'; footer 'Items 1 · 20 cs ₹28,162.85 before GST'. … | `QA/evidence/batch1/regression/web-sales-owner/DOS-075-01-shop-card-desk.png` |
| DOS-075 | sales-owner | web-phone 390x844 | **PASS** | Header chip 'Schemes ₹574.75'; the line reads ₹28,162.85 with −₹574.75; 'Schemes on this order −₹574.75'; footer 'Items 1 · 20 cs ₹28,162.85 before … | `QA/evidence/batch1/regression/web-sales-owner/DOS-075-06-oil-20cs-phone-viewport.png` |
| DOS-076 | sales-owner | api | **PASS** | (a) 200: cashDiscountBps 150, cashDiscountPaise 307, orderRules [cash_discount_pct 2bdf40c6… 307]. (b) 200: bps 200, 1409, orderRules [663ad71e… … | `QA/evidence/batch1/regression/web-sales-owner/api-quotes.txt` |
| DOS-076 | sales-owner | web-desk 1280x800 | **PASS** | The card lists 'Too Yumm — 2% cash discount' and 'Rajwadi sodas — 1.5% cash discount'. Lines: Campa ₹22.97/pc, ₹1,102.56, 2 pc free; Too Yumm … | `QA/evidence/batch1/regression/web-sales-owner/DOS-075-01-shop-card-desk.png` |
| DOS-076 | sales-owner | web-phone 390x844 | **PASS** | Footer 'Items 2 · 4 cs ₹1,807.20'; no cash-discount deduction shown. | `QA/evidence/batch1/regression/web-sales-owner/DOS-076-02-basket-b-phone-viewport.png` |
| DOS-077 | sales-owner | web-desk 1280x800 | **PASS** | Rows read 'Campa Cola 1 L / Campa · 24 pc case / 18 cs available / Add a case', and so on, the same sequence as p-03/s-09 (171 items). Name column … | `QA/evidence/batch1/regression/web-sales-owner/DOS-077-01-order-entry-desk.png` |
| DOS-077 | sales-owner | web-phone 390x844 | **FAIL** | The DOM carries name, pack and chip, and the button is label-width (115 px, right edge 361 inside the row's 373). But the visible name column is only … | `QA/evidence/batch1/regression/web-sales-owner/DOS-077-05-catalog-rows-phone-viewport.png` |
| DOS-001 | sales-owner | web-desk 1280x800 | **PASS** | Today: 0–7 23,03,430.00 · 8–15 6,86,688.50 · 16–30 7,99,017.50 · 31–60 4,92,990.00 · 61–90 90,203.00 · 90+ 25,962.00. Money shows the identical six. … | `QA/evidence/batch1/regression/web-sales-owner/DOS-001-01-today-desk.png` |
| DOS-001 | sales-owner | web-phone 390x844 | **PASS** | Money and Today both read 23,03,430.00 / 6,86,688.50 / 7,99,017.50 / 4,92,990.00 / 90,203.00 / 90+ 25,962.00. | `QA/evidence/batch1/regression/web-sales-owner/DOS-001-03-money-phone.png` |
| DOS-001 | sales-owner | db | **PASS** | dos_qa: tarsun as_of 01:30:24 (again 02:00:25) has ageingB90plus 2596200 and no ageingB90Plus key; sai 2460200 and kalyan 2595350, the same shape. … | `QA/evidence/batch1/regression/web-sales-owner/DOS-001-db-owner-summary.txt` |
| DOS-001-seed | sales-owner | db | **NOT TESTED** | No such database exists: dos_qa, dos_batch1_template, dos_b1_e2e and dos_b1_l5 were all seeded before bc1f809. Re-seeding is outside this walker's … | `QA/evidence/batch1/regression/web-sales-owner/DOS-001-db-owner-summary.txt` |
| DOS-005 | sales-owner | web-desk 1280x800 | **PASS** | SO-0896's gate is approvals 01a09748-0341… kind bargain, entity_type bargain_request, entity_id = bargain 01a09747-1a25…. All has 12 rows: Om Sai … | `QA/evidence/batch1/regression/web-sales-owner/DOS-005-03-after-ask-desk.png` |
| DOS-005 | sales-owner | web-phone 390x844 | **PASS** | Rows: Om Sai Provision Store Bargain 39.58; SO-0897 Bargain 45.54; SO-0897 Over credit limit 1,375.00; SO-0896 Bargain 25.00; SO-0895, SO-0887, … | `QA/evidence/batch1/regression/web-sales-owner/DOS-005-13-owner-approvals-all-phone-viewport.png` |
| DOS-020 | sales-owner | web-desk 1280x800 | **PASS** | Confirm is disabled (disabled=true, aria-disabled) with 'Waiting on Over credit limit · Bargain. Decide it on Approvals; the last approval confirms … | `QA/evidence/batch1/regression/web-sales-owner/DOS-020-02-mahalaxmi-placed-desk.png` |
| DOS-020 | sales-owner | web-phone 390x844 | **PASS** | Confirm order is disabled (disabled=true) with 'Waiting on Over credit limit · Bargain. Decide it on Approvals; the last approval confirms the … | `QA/evidence/batch1/regression/web-sales-owner/DOS-020-12-owner-order-panel-phone-viewport.png` |

Notes on the non-PASS rows:
- DOS-039 web-phone NOT TESTED — only one real load sheet was confirmed in this run (at desk); the phone render of the confirmed sheet and the phone confirm dialog were checked, the confirm itself was not re-executed.
- DOS-077 web-phone FAIL — item names clip to 4–5 letters at 390 px. Not caused by the fix: DOS-077 changed only the native Button width and the row's web markup is unchanged (commit f2a36ae). Logged as DOS-128. The Android result for DOS-077 is in §3.
- DOS-001-seed NOT TESTED — no database seeded after the seed-key fix exists yet; the running rollup already writes the correct key (PASS rows). Re-check after the Q5 rebuild of dos_qa.
- DOS-029 end-to-end (manager build, isolated): RED on 2abb27e (10 of 23 assertions failed) → GREEN on d600ab8 (24 of 24); see `QA/13-change-log.md`.

**Part B — manager app (DOS-029 build) and the cross-role chain:** pending.

### 2. Cross-role regression (Phase 2 chain) — pending
### 3. Platform regression (Web, Android, iOS) — pending
### 4. Business regression — orders, inventory, payments, outstanding, delivery and reports reconcile

Read-only SQL audit of dos_qa, 2026-09-13 01:50–01:58 IST (while walkers were writing through the product). Full table, business meaning
and every query with its output: `QA/evidence/batch1/regression/reconcile/SUMMARY.md`.

- **PASS (9):** stock ledger = balances (2 166 lot-locations); load-out moved stock once (DOS-039 on real data: 0 `load_sheet` rows, packed lots' godown balances unchanged); reservations = reserved; every journal balances (2 974 entries); invoices = their lines and payment state = allocations; outstanding agrees three ways for 115 shops; returns/credit notes go to the right bin (DOS-058 confirmed on CN/9004); order totals and state chains valid; no cross-tenant child rows; no goods out without a bill, no bill paid with bounced money, no dispatch on a trip that never left.
- **KNOWN (2):** duplicate receipt numbers — 4 pairs in tarsun, not grown, and each other tenant's next 4 receipts will repeat a number (DOS-032/059, held for the Fable review); one desk damaged line restocked as saleable (DOS-116).
- **FAIL (1):** overdue and ageing are not re-dated at the start of a day — owner overdue understated by ₹1,01,921 (Tarsun), ₹1,09,585 (Sai), ₹8,109 (Kalyan). Not caused by batch 1 (no ageing job exists at any commit). Logged as **DOS-117 (P1)**.
- Money sanity (Phase 1 rule) on the cross-role chain: pending (part B).

### 5. Security regression — permissions and isolation were not weakened

API probes, 2026-09-13 ~01:00–01:30 IST, own fixtures, every request/response saved under `QA/evidence/batch1/regression/api-security/`.
CI: `describePermissionMatrix` passed for every endpoint × role on merged main (§0b). `git diff c5c6e03 HEAD -- permissions.ts` is empty.

| Probe | Status | Result | Evidence |
|---|---|---|---|
| DOS-073 | **PASS** | All 8 mutations and reads returned 404 with body 'order <id> not found', identical to the random id. List over 2 pages: 383 items, all salespersonId = amit (DB count … | `QA/evidence/batch1/regression/api-security/fx-01-rahul-create-X-R0004.txt` |
| DOS-073-residual-warehouse-delivery | **FAIL** | Both cancels returned 200 with state cancelled. DB: cancel transitions under actor_id dinesh (5b6fbe87…) and ganesh (7b2db500…); reservations voided; OrderCancelled … | `QA/evidence/batch1/regression/api-security/fx-04-rahul-create-B-R0015.txt` |
| DOS-020 | **PASS** | Confirm returned 409 CONFLICT with data.code approval_required, approvals [{id 01a09720-9453…, kind credit_limit}] and the message 'SO-0890 is waiting on 1 decision(s) … | `QA/evidence/batch1/regression/api-security/fx-06-rahul-create-C-R0014.txt` |
| DOS-040 | **PASS** | HTTP returned 409 CONFLICT 'picklist PICK-0081 is open; start it before picking'. Sync returned 200 with accepted 0 and rejected code picklist_not_started 'Picklist … | `QA/evidence/batch1/regression/api-security/fx-10-rahul-create-W-R0027.txt` |
| DOS-041 | **PASS** | HTTP returned 400 BAD_REQUEST 'batch GK20260721 on PICK-0081 asks for 6 pcs; 20 were picked'. Sync returned 200 with accepted 0 and rejected code pick_rejected carrying … | `QA/evidence/batch1/regression/api-security/d-06-http-pick-above-row-ask.txt` |
| DOS-058 | **PASS** | damaged → 400 with data.code return_not_saleable, message 'Campa Cola 1 L: damaged goods go to the damaged bin, not back on sale'. expired → 400 return_not_saleable. … | `QA/evidence/batch1/regression/api-security/e-00-db-before-delivery-probes.txt` |
| DOS-058-residual-desk-credit-note | **FAIL** | 200: CN/9005 issued with reason return_damaged. credit_note_lines.saleable = t; stock_ledger sale_return_saleable +2 into Godown (kind warehouse); Godown on_hand 13 → … | `QA/evidence/batch1/regression/api-security/e-06-warehouse-pack-and-bill-W.txt` |
| DOS-034 | **PASS** | Step 2 returned 200 (updated 1, journal 01a09725-2700…, ₹10.00). Step 3 returned 409 'receipt RCPT-0700 is deposited, not collected'. Step 4 returned 409 'idempotencyKey … | `QA/evidence/batch1/regression/api-security/f-01-accountant-create-office-cash-receipt.txt` |
| DOS-094 | **PASS** | Pay everything: am=35843.00, tr=tn=PAY-baa19eda49c7, cu=INR, one prefix, upiIntentUrl identical to the payload, pa tarsun@okhdfcbank, pn 'Tarsun Enterprise'. One bill: … | `QA/evidence/batch1/regression/api-security/g-01-ramesh-outstanding-before.txt` |
| probe-DOS-094-foreign-bill-id | **PASS** | 200 with retailerId R-0010 (her own shop) and bills [], so nothing about INV/0433 leaked. The intent carries PAY-c6c9e5f01ab1 with am=4561.00. | `QA/evidence/batch1/regression/api-security/g-06-retailer-initiate-with-other-shop-invoice.txt` |
| permission-matrix-not-weakened | **PASS** | The diff is empty (0 lines) and no commit between c5c6e03 and HEAD 2c4b721 touches permissions.ts. Contract changes are limited to delivery.ts, orders.ts, pricing.ts and … | `QA/evidence/batch1/regression/api-security/h-01-permissions-diff.txt` |
| isolation-cross-tenant-owner | **PASS** | 404 'order … not found'; 404 'invoice … not found'; 200 {items: [], nextCursor: null}; control 200. | `QA/evidence/batch1/regression/api-security/i-01-sai-owner-get-tarsun-order.txt` |
| isolation-cross-shop-retailer | **PASS** | 404 'invoice … not found' for the invoice, the pdf and the upi-qr; own INV/0838 200. | `QA/evidence/batch1/regression/api-security/i-08-retailer-get-other-shop-invoice.txt` |
| isolation-sales-token-on-owner-service | **PASS** | All three returned 403 'owner-service does not serve the salesperson role'. DB at 01:19: 0 cancel transitions ever on SO-0884; no idempotency row for the probe key. Its … | `QA/evidence/batch1/regression/api-security/i-05-sales-token-on-owner-service-orders.txt` |

The two FAILs are the residuals the verifiers raised, confirmed and logged as new findings: **DOS-115 (P0)** — warehouse and delivery
logins can cancel, re-line and submit any order; **DOS-116 (P1)** — a desk credit note for damaged goods restocks them as saleable.
Neither was introduced by batch 1 (the matrix and the credit-note path are unchanged); both need approval.

