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


**Which code the walkers actually used (checked 2026-09-13 ~05:15 IST, because QA's Metro servers run with `CI=1` and never reload):**
the seven main Metro servers (:5173–:5179) were started at 00:57:56 IST from the main checkout — after the last lane merge (2abb27e, 00:51:23)
and the README regeneration (0a9deac, 00:56:53); the only later main-tree changes before any walk were QA documents and QA tools. Runtime
observations that exist only in post-fix code confirm it: the warehouse sheet's "This sheet has not been started" + "Start picking" (DOS-040),
one return-reason control (DOS-058), the statement's single `limit=200` read (DOS-095), and a label-width "Add a case" on web and Android (DOS-077).
A text search of the served sales bundle for the DOS-077 comment and prop was inconclusive (comments are stripped, props reformatted), so the
runtime observations are the evidence. The :5174 manager server serves main without DOS-029 (0 `useRefusal` in its bundle, as expected); the
DOS-029 manager build walked on web and Android is the :5274 server started at 02:14:43 from the DOS-029 worktree at d600ab8.

### 0c. CI chain after merging DOS-029 + DOS-135 (merge d8ae49e, 2026-09-13 08:46 IST, every step `--force`)

| Step | Result |
|---|---|
| frontend install (`--frozen-lockfile`) | exit 0 |
| frontend format:check | exit 0 |
| frontend lint | exit 0, 11/11, 0 cached |
| frontend typecheck | exit 0, 11/11, 0 cached |
| frontend test | exit 0, 6/6 packages, **341 passed** (api-client 77, ui 216, offline 38, delivery-app 6, manager-app 3, sales-app 1) |
| frontend build | exit 0, 8/8 (seven web exports) |
| backend docs:readme:check | exit 0 (DOS-029/135 touched no backend or contract) |

The backend was not re-run: the merge changed only `frontend/libs/api-client` and `frontend/manager-app` (24 files). The seven main Metro servers
were restarted on the merged code at 08:48 IST with `--clear`; **manager :5174 bundle 7606031B useRefusal=9 onItsWrite=3** (DOS-029 and DOS-135 present). The :5274 branch server is
stopped, the branch worktree and its test database are removed, the branch is kept (merged).

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

**Part B — manager app on the DOS-029 build (http://localhost:5274, d600ab8, same services and dos_qa), desk and phone, manager vikas.kadam and accountant meena.joshi, 2026-09-13 ~02:25–03:30 IST.** 21 PASS · 5 FAIL. Full results: `QA/evidence/batch1/regression/part-b-web-results.json`; evidence under `QA/evidence/batch1/regression/web-manager/`.

| Check | Status | What was seen | First evidence |
|---|---|---|---|
| DOS-020-web-desk | **PASS** | The panel lists 'Waiting on: Over credit limit [Approve][Reject], Bargain [Approve][Reject]'. Confirm has aria-disabled=true with 'Waiting on Over … | `QA/evidence/batch1/regression/web-manager/api-X-mahalaxmi-create-bargain-submit.txt` |
| DOS-020-web-phone | **PASS** | SO-0900: Confirm is disabled, with 'Waiting on Bargain. Approve or reject each one first; the last approval confirms the order.' directly under the … | `QA/evidence/batch1/regression/web-manager/020-10-SO-0900-panel-confirm-disabled-phone-viewport.png` |
| DOS-005-web-desk | **PASS** | The queue shows 'SO-0899 · Asked rate ₹45.54' once, SO-0899's credit gate as a separate card, and SO-0900's bargain once. The Approve went to POST … | `QA/evidence/batch1/regression/web-manager/005-01-queue-card-approve-dialog-desk.png` |
| DOS-005-web-phone | **PASS** | SO-0900 appeared once in the queue. POST /approvals/01a09766-11e6-730f-9015-f55e91d39c7a/decide → 200. The panel showed Cancelled, and SO-0900 is … | `QA/evidence/batch1/regression/web-manager/005-10-orders-queue-phone.png` |
| DOS-021-web-desk | **PASS** | Each line shows 'Pieces to credit' with a helper: Sunbake '40 pc left to credit'; Campa Lemon '2 cs · 48 pc · 2 pc free … 50 pc left to credit'. No … | `QA/evidence/batch1/regression/web-manager/021-01-bill-lines-left-to-credit-desk.png` |
| DOS-021-web-phone | **PASS** | Helpers: Sunbake 'Already credited in full', Campa Lemon '50 pc left to credit', Ghee '20 pc left to credit'. 21 → 'Only 20 pc left to credit on this … | `QA/evidence/batch1/regression/web-manager/021-10-draft-sheet-lines-phone-viewport.png` |
| DOS-023-web-desk | **PASS** | Before, the top row was PICK-0083. POST /warehouse/picklists → 200 PICK-0084 (open). Row 1 became 'PICK-0084 Open 1 24 0 — 13 Sep' and is still row 1 … | `QA/evidence/batch1/regression/web-manager/023-01-sheet-made-top-row-desk.png` |
| DOS-023-web-phone | **PASS** | Order: PICK-0084 (Packed), 0083, 0082, 0081, 0080, 0079. The tap fired GET /warehouse/picklists/{id} 200, and 'Sheet PICK-0084' opened with State … | `QA/evidence/batch1/regression/web-manager/023-10-sheets-newest-first-phone-viewport.png` |
| DOS-025-web-desk | **PASS** | Network: GET /warehouse/load-sheets?status=draft&limit=100 200 and ?limit=100 200. 'loadout-waiting' precedes the history. The waiting row reads '13 … | `QA/evidence/batch1/regression/web-manager/api-025-dinesh-pack-and-draft-load-sheet.txt` |
| DOS-025-web-phone | **PASS** | The waiting panel is the first content (top 374 px): 'Not out of the godown yet \| 13 Sep \| Waiting for your approval \| 1,375.00'. POST …/approve → … | `QA/evidence/batch1/regression/web-manager/025-03-load-out-waiting-first-phone-viewport.png` |
| DOS-041-web-desk | **PASS** | Request body: lines[0].id = 01a0976a-a7ab-7170-a208-29775363b9ac (the row's own id), pickedQtyPcs 24. Response: 400 'batch RCP20260710 on PICK-0084 … | `QA/evidence/batch1/regression/web-manager/041-01-M20-row6-stepped-one-case-desk.png` |
| DOS-041-web-phone | **PASS** | Request lines[0].id = 01a0976a-a7ab-7171-b79c-9754d91a4a72 (the row's own id). Response: 400 'batch RCP20260724 on PICK-0084 asks for 18 pcs; 24 were … | `QA/evidence/batch1/regression/web-manager/041-10-M20-row18-stepped-phone-viewport.png` |
| DOS-034-web-desk-manager | **FAIL** | Actions pass: - The Mode column is only Cash and Cheque, and Cheques in hand and Trips coming back sit above the register. - With the row ticked, the … | `QA/evidence/batch1/regression/web-manager/034-01-manager-day-end-desk.png` |
| DOS-034-web-phone-manager | **FAIL** | Order by top offset: KPIs 247, cheques 488, trips 1014, register 1240. The ticked bar '1 receipts · ₹7,224.00 \| Bank this batch' shows at y 705–768. … | `QA/evidence/batch1/regression/web-manager/034-20-manager-day-end-top-phone-viewport.png` |
| DOS-034-web-desk-accountant | **FAIL** | Modes are only Cash and Cheque. Bounce: POST /receipts/0c5f27b0…/bounce → 200. The card left, and Cheques in hand went from ₹1,73,556.98 (6 rows) to … | `QA/evidence/batch1/regression/web-manager/034-10-accountant-day-end-desk.png` |
| DOS-034-web-phone-accountant | **PASS** | Cheques in hand starts at 488 px. On RCPT-0680, Bank it and Mark bounced are both enabled and inside the viewport. The blank reason sent a POST → … | `QA/evidence/batch1/regression/web-manager/034-40-accountant-day-end-phone-viewport.png` |
| DOS-029a-web-desk | **PASS** | POST /warehouse/picklists → 409. wave-refusal reads 'only a confirmed order can be waved; SO-0850 is packed' at y 414, inside the open dialog; no … | `QA/evidence/batch1/regression/web-manager/029a-01-wave-dialog-SO-0850-desk.png` |
| DOS-029a-web-phone | **PASS** | 409. 'only a confirmed order can be waved; SO-0850 is packed' at y 434–478 of 844, the dialog stayed open, and the reopened dialog had no stale line. | `QA/evidence/batch1/regression/web-manager/029a-10-wave-409-refusal-phone-viewport.png` |
| DOS-029b-web-desk | **PASS** | 400 'only 0 pcs of Sunbake Glucose 55 g are left to credit on INV/0634' (note-refusal) directly above Draft and in view. The panel stayed open, and … | `QA/evidence/batch1/regression/web-manager/029b-021-deskB-race-400-above-draft-desk.png` |
| DOS-029b-web-phone | **PASS** | 400 'only 0 pcs of Campa Lemon 750 ml are left to credit on INV/0634' at y 757–801, above Draft, inside the viewport; the sheet stayed open. | `QA/evidence/batch1/regression/web-manager/029b-021-phone-race-400-above-draft-phone-viewport.png` |
| DOS-029c-web-desk | **PASS** | POST /docint/documents/0400aea1-7e63-7119-af27-05db2a4307ad/approve → 501. docint-refusal reads 'a brand-DMS bill is committed through … | `QA/evidence/batch1/regression/web-manager/029c-00-documents-register-desk.png` |
| DOS-029c-web-phone | **PASS** | 501. The same sentence shows at y 412–500 of 844, the dialog is open, no overlay, no uncaught error. | `QA/evidence/batch1/regression/web-manager/029c-brand-dms-501-refusal-phone-viewport.png` |
| DOS-029d-web-desk | **PASS** | The line appeared 127 ms after the press: 'No connection. Check the signal, then press again.' The dialog stayed open, 'This will send when the … | `QA/evidence/batch1/regression/web-manager/029d-no-connection-wave-desk-viewport.png` |
| DOS-029d-web-phone | **PASS** | The same sentence appeared 68 ms after the press, in view; the dialog stayed open with no false promise. | `QA/evidence/batch1/regression/web-manager/029d-no-connection-wave-phone-viewport.png` |
| DOS-029e-web-desk | **FAIL** | Control: 409, and 'Sunil Tarsun is reviewing this document (until 2026-10-12T00:00:00.000Z)' showed above Start reviewing. Overlapped: Start … | `QA/evidence/batch1/regression/web-manager/029e-01-control-start-review-409-desk-viewport.png` |
| DOS-029e-web-phone | **FAIL** | Control: the 409 sentence showed in view. Overlapped: Start reviewing 409 in 80 ms, and refusal count 0 while pending, 0 after rematch returned 200, … | `QA/evidence/batch1/regression/web-manager/029e-01-control-start-review-409-phone-viewport.png` |

Non-PASS rows (re-graded after the before/after comparison, `QA/evidence/batch1/regression/part-b-regression-status.md`): **DOS-034 FAIL ×3 → PASS within DOS-034's approved scope** (its text named UPI/bank-transfer rows; actions, bar and refusals all passed). The failing part is trip cash, a pre-existing root cause that DOS-034 made easy to reach — companion finding DOS-132 (P1), which the DOS-034 plan asked to file at the same gate and QA did not until now. Original wording: — Bank it / Mark bounced are now in sight and work, but the in-hand register still offers cash that is out with a delivery crew and receipts of settled trips for banking (deposit credits CASH_VAN) → DOS-132. **DOS-029e FAIL ×2** — the verifier's residual reproduced in the running app: a refusal that arrives while another write on the same documents panel is still in flight is never shown → DOS-135 (P2). DOS-029 a–d (409 wave, 400 credit-note race, 501 brand-DMS on dos_qa, no connection) PASS at both widths.


**DOS-135 re-check (repair of DOS-029, 8161f21), 2026-09-13 ~05:10 IST:** the DOS-029e scenario PASSES on the repaired build at desk and phone (before: the refusal never appeared on d600ab8; after: shown once the sibling write settled, hidden by a press, not brought back by a success). Evidence `QA/evidence/batch1/dos-135/`. Environment note: every Metro started by QA runs with `CI=1`, which disables reloads, so a served build changes only when its Metro is restarted — the :5274 manager build still carried d600ab8 during this check (used as the live BEFORE), and a second Metro on :5374 served 8161f21 for the AFTER.

### 2. Cross-role regression — the Phase 2 chain on merged main (web; manager on the DOS-029 build)

One chain walker, tenant tarsun, 2026-09-13 ~03:00–03:45 IST, every hop checked in UI (screenshot), API and DB. 16 PASS · 3 FAIL.
Evidence under `QA/evidence/batch1/regression/web-chain/`.

| Hop / wrong day | Status | What was seen | First evidence |
|---|---|---|---|
| chain-hop-1-sales-order | **PASS** | SO-0903 created, submitted and auto-confirmed (no approvals). Subtotal Rs 5,805.84, scheme -Rs 82.77 on the Balaji line (applied_rules 5df0af82), GST Rs 1,030.16, … | `QA/evidence/batch1/regression/web-chain/c11-sales-order-final-lines-desk.png` |
| chain-hop-2-manager-sees-order | **PASS** | Row: SO-0903, Balaji Wholesale Stores, Rahul Deshmukh, Rs 6,753.00, Confirmed. Panel: credit (owes Rs 7,20,804.00, limit Rs 10,00,000.00), subtotal, discount Rs 82.77, … | `QA/evidence/batch1/regression/web-chain/c16-manager-orders-confirmed-desk.png` |
| chain-hop-3-pick-short-pack-invoice | **PASS** | All 15 /sync/upload ops accepted. pick_lines 25/31 with short_reason stored; picklist 'picked'. Pack returned 200 and issued INV/9010 for Rs 6,679.00: taxable 5,660.55, … | `QA/evidence/batch1/regression/web-chain/c22-warehouse-PICK-0085-sheet-before-start-desk.png` |
| chain-hop-4a-manager-plans-trip | **FAIL** | No screen can create a trip or add a stop; the chain continued only through the API (200, TRIP-0001 planned, one plan row per stop). The only server writers of … | `QA/evidence/batch1/regression/web-chain/c34-manager-fulfilment-desk.png` |
| chain-hop-4b-warehouse-builds-load-sheet | **FAIL** | The panel lists 50 old packs (SO-0798 4 Sep ... SO-0070 22 Jun) and none of today's four. The API returns rows in id order with a nextCursor, and the screen never pages. … | `QA/evidence/batch1/regression/web-chain/c38-warehouse-load-build-before-desk.png` |
| chain-hop-4c-manager-approves-load-out | **PASS** | The sheet was listed (4 orders, 6 packages, Rs 16,163.00). Approve returned 200 with approvedBy Vikas Kadam, and the panel reads 'Approved · the godown may check it out'. | `QA/evidence/batch1/regression/web-chain/c42-manager-load-sheet-panel-desk.png` |
| chain-hop-4d-warehouse-load-out-confirm | **PASS** | 200: confirmed, challan DC-0084, counted 6. No stock_ledger rows for the sheet; godown on-hand of the 9 SKUs was 6,819 before and after. SO-0903 to SO-0906 went to … | `QA/evidence/batch1/regression/web-chain/c46-warehouse-count-6-desk.png` |
| chain-hop-5-delivery-crew-departs | **PASS** | POST depart 200: active, start_odometer_km 45210, opening_cash_paise 50000. Five seconds later the home still showed 'Being loaded / Float Rs 0.00 / Start this trip'; … | `QA/evidence/batch1/regression/web-chain/c49-delivery-home-before-depart-desk.png` |
| chain-hop-6a-deliver-in-full-with-pod | **PASS** | files/upload-url 200, then storage PUT of 38,641 bytes, then POST /delivery/deliveries 200 (outcome delivered). pod_evidence photo row exists and the file is on disk. … | `QA/evidence/batch1/regression/web-chain/c59-delivery-d4-ready-desk.png` |
| chain-hop-6b-partial-cash-payment | **PASS** | POST /delivery/collections 200: RCPT-0704 (one row with that number), cash 400000, linked to the trip. R-0010 outstanding 72,748,300 -> 72,348,300 paise, exactly -Rs … | `QA/evidence/batch1/regression/web-chain/c64-delivery-collect-ready-desk.png` |
| chain-hop-7-retailer-sees-delivery-bill- … | **PASS** | Home: 'You owe Rs 7,23,483.00', last bill INV/9010, last payment Rs 4,000.00 at 3:41 am. SO-0903 is Delivered, with a timeline from 3:05 to 3:40 and POD 'Signed for by … | `QA/evidence/batch1/regression/web-chain/c68-retailer-home-desk.png` |
| chain-hop-8-owner-sees-revenue-stock-out … | **PASS** | Invoiced today Rs 18,205.00: baseline 2,042 plus my four live bills 16,163 (cancelled INV/9014 excluded); equals the sum of today's non-cancelled invoices, 1,820,500 … | `QA/evidence/batch1/regression/web-chain/c03-owner-baseline-today-desk.png` |
| chain-money-sanity-six-places | **PASS** | Order Rs 6,753.00 is identical on the sales, manager and retailer screens, API and DB. Invoice Rs 6,679.00 = the order minus the 6 short pieces (6 x 10.42 + 18% GST = … | `QA/evidence/batch1/regression/web-chain/db-03-INV-9010-after-pack.txt` |
| wrong-day-1-manager-cancels-before-picki … | **PASS** | 200 cancelled. Transition confirmed->cancelled by vikas.kadam with the reason; reservation voided (144 pc), lot reserved 0; no invoice and no ledger rows. The rep's … | `QA/evidence/batch1/regression/web-chain/w1-sales-R0002-reject-before-pick-order-placed.png` |
| wrong-day-2-order-cancelled-mid-pick | **FAIL** | Order cancel returns 409 'order: cannot apply "cancel" in state "picking"', shown verbatim in the dialog (the DOS-029 build surfaces the refusal). 'Cancel the sheet' is … | `QA/evidence/batch1/regression/web-chain/w2-03-warehouse-mid-pick-one-line-picked-desk.png` |
| wrong-day-3-failed-delivery-shop-closed | **PASS** | Sync op accepted. trip_stops failed (shop_closed, note stored); deliveries outcome failed. SO-0904 went dispatched -> packed (return_undelivered). No credit note and no … | `QA/evidence/batch1/regression/web-chain/w3-03-delivery-fail-dialog-desk.png` |
| wrong-day-4-damaged-return-at-door | **PASS** | Request line: reason damaged, returnedSaleable false. 200, outcome partial. CN/9008 return_damaged issued for Rs 1,241.00 (taxable 1,051.56). stock_ledger … | `QA/evidence/batch1/regression/web-chain/w4-02-delivery-stop3-damaged-line-ready-desk.png` |
| wrong-day-4b-return-after-delivery-desk- … | **PASS** | POST /credit-notes sent qtyPcs 6 with saleable:false (typed pieces accepted; '58 pc left to credit' shown). Issue 200: CN/9010, Rs 106.00. stock_ledger … | `QA/evidence/batch1/regression/web-chain/w4-11-manager-credit-note-draft-6pc-damaged-desk.png` |
| wrong-day-5-retailer-refuses-part-at-doo … | **PASS** | 200, outcome partial. CN/9009 return_saleable Rs 569.00. stock_ledger sale_return_saleable +34 into Vehicle MH-05-EF-9012. R-0015 outstanding 8,236,100 -> 8,179,200 … | `QA/evidence/batch1/regression/web-chain/w5-03-delivery-stop4-refuse-line-ready-desk.png` |

- **The chain cannot be completed from the screens alone.** No app can create a delivery trip or add a stop (**DOS-131, P0**), and the warehouse Load screen lists 50 old packs instead of today's (**DOS-133, P1**); the walker created the trip and the load sheet through the product API with the same bodies the screens send, and everything downstream worked. Both PRE-EXISTING (never built / unchanged since c5c6e03), exposed because DOS-039 let the chain pass load-out.
- **Money sanity (Phase 1 rule), six places — PASS:** SO-0903 ₹6,753.00 is the same on the sales, manager and retailer screens, the API and the DB; INV/9010 ₹6,679.00 = the order less the 6 short pieces; the partial cash receipt RCPT-0704 ₹4,000 moved R-0010 outstanding by exactly ₹4,000; the owner's "invoiced today" rose by exactly the chain's four live bills.
- Stock moved once at pack and not again at load-out (DOS-039 held on a fresh order); a failed stop sent the order back to packed with nothing billed as delivered; a damaged doorstep return went to the damaged bin (DOS-058); a desk return typed in pieces with saleable:false went to the damaged bin; a partial refusal at the door restocked the vehicle.
- Wrong day 2 (cancel mid-pick) FAIL: docs/22 §4 allows cancel only up to confirmed, so the refusal follows the state machine; the defect is the offered button and the missing mid-pick workflow (DOS-138, P2).
- Not run in this pass: the platform-split chain (rep on Android, warehouse/delivery on Android/iOS) — the emulator was busy with the Android focused pass; it belongs to Phase 2.

### 3. Platform regression — Web, Android, iOS

Web: §1 (desk and phone widths) and §2. Android and iOS are walked separately; nothing is inferred from web or API.

**Android part 1 — sales and delivery apps, emulator Pixel_7_API_36 (API 36, 3 GB), 2026-09-13 ~02:30–03:32 IST.** 7 PASS · 0 FAIL.
Evidence: `QA/evidence/batch1/regression/android/`; results `QA/evidence/batch1/regression/android-1-sales-delivery-results.json`.

| Fix | User | Status | What was seen | First evidence |
|---|---|---|---|---|
| DOS-077 | Sales | **PASS** | Rows are no longer blank. Online rows show name, pack and chip, with valid bounds, e.g. 'Campa Cola 2 L' [77,866][290,982], '7 cs available' … | `QA/evidence/batch1/regression/android/sales-00-01-signed-in-home.png` |
| DOS-075 | Sales | **PASS** | Device shows header chip 'Schemes ₹574.75', line '−₹574.75' at ₹119.74/pc (₹28,162.85 net), and group footer 'Schemes on this order −₹574.75'. Server … | `QA/evidence/batch1/regression/android/sales-075-01-shree-ganesh-card.png` |
| DOS-073 | Sales | **PASS** | The Android 'All' list showed 56 distinct numbers (SO-0803…SO-0901, SO-9001). SQL: all 56 have salesperson rahul.deshmukh; none of Amit's recent … | `QA/evidence/batch1/regression/android/sales-073-01-orders-list.png` |
| DOS-060 | Delivery | **PASS** | Pad layout 1–9 / . 0 ⌫ / [Clear \| Done]. 4756 → preview '₹4,756' (content-desc '4756 rupees'). '. 5 0' → '₹4,756.50' ('4756 rupees 50 paise'); extra … | `QA/evidence/batch1/regression/android/delivery-060-01-stop7-nakshatra.png` |
| DOS-061 | Delivery | **PASS** | Home: 'TRIP-ACTIVE · 12 Sep 2026 · Today's trip · On the road · 10 of 10 stops done'. Load panel 'Load on board · Godown confirmed the load 11 Sep, … | `QA/evidence/batch1/regression/android/delivery-00-01-signed-in-home.png` |
| DOS-058 | Delivery | **PASS** | After '−': 'Taken back · 24 pc', ONE segmented row [Shop refused it \| Damaged \| Past its date], caption 'Can be sold again'; only one 'Damaged' … | `QA/evidence/batch1/regression/android/delivery-058-02-d4-open.png` |
| DOS-057 | Delivery | **PASS** | Open → com.android.intentresolver 'Sharing 1 file · INV-0826.pdf' (Quick Share, Print, Drive, Messages, Bluetooth); GET … | `QA/evidence/batch1/regression/android/delivery-057-01-stop5-joshi.png` |

The two defects that existed only on native are fixed on Android: DOS-077 (catalog rows no longer blank; names and packs show, though narrow beside the stock chip — DOS-147) and DOS-060 (the pad enters rupees: 4-7-5-6 → ₹4,756, paise only after "."). Environment note: the emulator went down twice during this pass because the walker prompt's proxy cleanup `lsof -ti tcp:8081 | xargs kill` also kills the emulator's own processes (a QA harness mistake, now recorded in QA/ENV.md); it was restarted and a watchdog keeps it up for the rest of the pass.

**Android part 2 — retailer, warehouse and owner apps, same emulator, 2026-09-13 ~03:35–04:50 IST.** 9 PASS · 0 FAIL. Results: `QA/evidence/batch1/regression/android-1-results.json`.

| Fix | User | Status | What was seen | First evidence |
|---|---|---|---|---|
| DOS-094 | Retailer | **PASS** | Pay everything: 'Paying Tarsun Enterprise ₹35,843.00' with … | `QA/evidence/batch1/regression/android/retailer-094-03-money-due.png` |
| DOS-099 | Retailer | **PASS** | 'Open the bill' opened the Android share sheet 'Sharing 1 file · INV-0753.pdf' (Quick Share, Print, Drive, Messages, Bluetooth). logcat has … | `QA/evidence/batch1/regression/android/retailer-099-01-my-bills.png` |
| DOS-095 | Retailer | **PASS** | Opening balance ₹5,242.00. The device lists 53 entries in exactly the API's order, first INV/0034, last … RCPT-0659 ₹63,535.00 → RCPT-0668 ₹51,355.00 … | `QA/evidence/batch1/regression/android/retailer-095-01-statement-top.png` |
| DOS-040 | Warehouse | **PASS** | PICK-0089 (16 lot rows, 337 pc) opened with chip 'open', 'This sheet has not been started' and rows showing item/batch/expiry/MRP/pieces with no … | `QA/evidence/batch1/regression/android/warehouse-040-01-pick-queue.png` |
| DOS-041 | Warehouse | **PASS** | Sheet: 'Requested 7 pc', pad 20. Below the Short button, in brick red: 'This batch asks for 7 pc. Count again — more cannot be saved on this line.' … | `QA/evidence/batch1/regression/android/warehouse-041-01-short-sheet-7pc-row.png` |
| DOS-042 | Warehouse | **PASS** | At 15 of 16: screen '15 of 16 picked', chip 'picking', 'Take it to packing' DISABLED with '1 line not yet picked'. DB: PICK-0089 picking, … | `QA/evidence/batch1/regression/android/warehouse-042-01-fifteen-of-sixteen.png` |
| DOS-001 | Owner | **PASS** | Today: 0–7 22,76,528.00 · 8–15 6,86,008.50 · 16–30 8,32,936.50 · 31–60 5,00,785.00 · 61–90 90,203.00 · 90+ 25,962.00. Money → Outstanding shows the … | `QA/evidence/batch1/regression/android/owner-001-00-signed-in-today.png` |
| DOS-005 | Owner | **PASS** | All: Om Sai Provision Store Bargain 39.58 ×1, SO-0910 Bargain 44.80 ×1, SO-0898 Bargain 20.14 ×1, then credit-limit rows, with no unnamed duplicates. … | `QA/evidence/batch1/regression/android/owner-005-api-01-fixture-order-with-bargain.txt` |
| DOS-020 | Owner | **PASS** | Panel: 'Confirm order' DISABLED, with 'Waiting on Bargain. Decide it on Approvals; the last approval confirms the order.' under it; 'Release stock' … | `QA/evidence/batch1/regression/android/owner-020-02-orders-submitted.png` |

Every merged fix outside the manager app holds on Android: 16 of 16. The emulator went down once more from the same proxy-kill command and the watchdog restarted it within 30 s (04:29:45 → 04:30:14).

**Android manager app — DOS-029 build on :5274, manager vikas.kadam and accountant meena.joshi, 2026-09-13 ~04:55–05:25 IST.** 12 PASS · 1 FAIL. Results: `QA/evidence/batch1/regression/android-manager-results.json`.

| Check | Status | What was seen | First evidence |
|---|---|---|---|
| DOS-020 | **PASS** | Sheet showed 'Waiting on: Over credit limit [Approve][Reject] · Bargain [Approve][Reject]', State Submitted. Confirm order was en=false, with … | `QA/evidence/batch1/regression/android/manager-020-api-A-mahalaxmi-create-bargain-submit.txt` |
| DOS-005 | **PASS** | Queue cards, top to bottom: - ₹39.58 (no order) - SO-0911 Asked rate ₹45.54 - SO-0911 Over credit limit ₹1,375.00 - SO-0898 ₹20.14 - SO-0887, … | `QA/evidence/batch1/regression/android/manager-005-02-queue-SO-0911-cards.png` |
| DOS-021 | **PASS** | Lines: - Sunbake Glucose 55 g · 40 pc · 40 pc left to credit - Campa Lemon 750 ml · 2 cs · 48 pc · 2 pc free · 50 pc left to credit - Godavari Cow … | `QA/evidence/batch1/regression/android/manager-021-02-draft-sheet-open.png` |
| DOS-023 | **PASS** | Before: PICK-0089, 0088, 0087, 0086, 0085, 0084, 0083 (same order as the DB). POST /warehouse/picklists → 200. Row 1 became 'PICK-0090 Open', above … | `QA/evidence/batch1/regression/android/manager-023-02-picking-sheets-before.png` |
| DOS-025 | **PASS** | Network: GET /warehouse/load-sheets?status=draft&limit=100 → 200 and ?limit=100 → 200. Under the PIN hint the first panel is 'Not out of the godown … | `QA/evidence/batch1/regression/android/manager-025-029-db-before.txt` |
| DOS-041 | **PASS** | POST /warehouse/picklists/01a097f8-e09f-7377-9869-6da81af8843e/pick → 400 (61 ms). The dialog stayed open with 'batch RCP20260731 on PICK-0090 asks … | `QA/evidence/batch1/regression/android/manager-041-db-PICK-0090-before.txt` |
| DOS-029a | **PASS** | POST /warehouse/picklists → 409 (33 ms). The dialog '1 orders · 390 pc' stayed open with 'only a confirmed order can be waved; SO-0850 is packed' in … | `QA/evidence/batch1/regression/android/manager-029a-01-wave-dialog-SO-0850.png` |
| DOS-029b | **PASS** | POST /credit-notes → 400. 'only 1 pcs of Sunbake Glucose 55 g are left to credit on INV/0634' showed directly above Draft (y 1943–2059), and the … | `QA/evidence/batch1/regression/android/manager-021-11-server-refusal-above-draft.png` |
| DOS-029c | **PASS** | Panel title 'Guiltfree Industries — Gurugram · FA/TY/26-27/1187'. POST /docint/documents/0400aea1-7e63-7119-af27-05db2a4307ad/approve → 501 (86 ms). … | `QA/evidence/batch1/regression/android/manager-029c-135-db-documents-before.txt` |
| DOS-029d | **FAIL** | Both cuts: the dialog stayed open but showed 'Something could not be completed. Try again.' (the api-client's 'unknown' default). It was there at +3 … | `QA/evidence/batch1/regression/android/manager-029d-01-wave-dialog-before-cut.png` |
| DOS-135 | **PASS** | Control: POST …/review → 409, and 'Sunil Tarsun is reviewing this document (until 2026-10-12T00:00:00.000Z)' showed above Start reviewing. Overlap … | `QA/evidence/batch1/regression/android/manager-135-02-ALA-panel-buttons-nodes.txt` |
| DOS-034-manager | **PASS** | Day-end: CASH TO BANK ₹41,07,486.52 'more than 200 rows', CHEQUES IN HAND ₹1,46,305.98 '4 rows', TRIPS COMING BACK 0. Cheque cards carry 'Tap a … | `QA/evidence/batch1/regression/android/manager-034-db-receipts-before.txt` |
| DOS-034-accountant | **PASS** | Bounce: POST /receipts/ab309aeb-5f40-7bc0-a9c3-e558891f5157/bounce → 200. The card left, and CHEQUES IN HAND went from ₹1,46,305.98 · 4 rows to … | `QA/evidence/batch1/regression/android/manager-034-20-accountant-signed-in-home.png` |

- **DOS-029d FAIL on Android only:** with the connection cut (the walker routed :3002 through a host forwarder and killed it, because radios-off does not cut adb-reverse traffic), the dialog stayed open but said "Something could not be completed. Try again." instead of "No connection. Check the signal, then press again." Web PASSES. Root cause is the one the held DOS-056 plan fixes in the api-client (native fetch failure not recognised as no signal) → DOS-156, folded into DOS-056 for the Fable review.
- **DOS-135 PASS on Android, with a provenance caveat:** the :5274 Metro had been started at 02:14 on d600ab8 in CI mode, and its Android bundle was first built during this walk, after 8161f21 was committed; which of the two the Android bundle carried cannot be proven afterwards. The DOS-135 repair itself is proven by the unit spec and the web before/after; iOS walks it on the :5274 server restarted on 8161f21 (served bundle verified to contain the repaired rule).
- Nested dialogs open from inside Sheets render on Android (DOS-020 decision dialog, DOS-034 Bank it / Mark bounced).

**iOS — iPhone 16 Pro simulator (iOS 18.0), Expo Go, Appium/XCUITest, 2026-09-13 05:35–08:05 IST.** Main app servers for sales, delivery, retailer, warehouse and owner; the manager app from the DOS-029 + DOS-135 build on :5274. Results: `QA/evidence/batch1/regression/ios-results.json`; screenshots `QA/evidence/batch1/regression/ios/`.

Sales, delivery, retailer — 9 PASS · 1 BLOCKED:

| Check | Status | What was seen | First evidence |
|---|---|---|---|
| DOS-077 | **PASS** | Rows are no longer blank. Page source lists every row with a name, pack and chip: e.g. 'Campa Cola 1 L' [29,496], '18 cs available' [103,497], 'Campa … | `QA/evidence/batch1/regression/ios/sales-077-01-home.png` |
| DOS-075 | **PASS** | Device: header chip 'Schemes ₹574.75', line ₹28,162.85 with '−₹574.75' at ₹119.74/pc, '20 cs = 240 pc · 19 cs available', group footer 'Schemes on … | `QA/evidence/batch1/regression/ios/sales-075-04-20cs.png` |
| DOS-073 | **PASS** | The iOS 'All' list rendered 97 distinct orders (SO-0912 … SO-0740, SO-9001). SQL: all 97 belong to rahul.deshmukh; 97 of 97 of Rahul's numbered … | `QA/evidence/batch1/regression/ios/sales-073-01-orders-list.png` |
| DOS-060 | **PASS** | Keypad (1–9 / . 0 back / Clear Done) preview: 4756 → '₹4,756' ('4756 rupees'); Clear → ₹0; '. 5 0' → '₹4,756.50'; the extra 5 is ignored; back ×3 → … | `QA/evidence/batch1/regression/ios/delivery-060-01-take-money.png` |
| DOS-061 | **PASS** | Home: 'TRIP-ACTIVE · 12 Sep 2026 · Today's trip · On the road · 10 of 10 stops done', still to collect ₹0, collected today ₹20,211, float ₹5,000; … | `QA/evidence/batch1/regression/ios/delivery-061-01-home.png` |
| DOS-058 | **BLOCKED** | UI half PASSES on iOS: after '−' the line reads '3 cs + 4 pc = 76 pc · Taken back · 24 pc', 'Will be recorded as Part delivered · 24 pc short', and … | `QA/evidence/batch1/regression/ios/delivery-058-02-arrived.png` |
| DOS-057 | **PASS** | Open → iOS share sheet 'INV-0826 · PDF Document · 22 KB' (Copy, Markup, Print, Save to Files); log GET /storage/…/documents/invoice/89e7513d….pdf 200 … | `QA/evidence/batch1/regression/ios/delivery-057-01-send-the-papers.png` |
| DOS-094 | **PASS** | Pay everything: 'Paying Tarsun Enterprise ₹35,843.00', string … | `QA/evidence/batch1/regression/ios/retailer-094-03-money-due.png` |
| DOS-099 | **PASS** | 'Open the bill' → iOS sheet 'INV-0753 · PDF Document · 21 KB' (Copy, Markup, Print, Save to Files); retailer-service GET … | `QA/evidence/batch1/regression/ios/retailer-099-01-my-bills.png` |
| DOS-095 | **PASS** | Opening balance ₹5,242. 53 entries on iOS in exactly the API's order, 53 of 53 running balances equal the API's balancePaise (first INV/0034 ₹17,205 … | `QA/evidence/batch1/regression/ios/retailer-095-01-statement-top.png` |

Warehouse, owner, manager — 11 PASS · 2 FAIL · 1 NOT TESTED · 1 BLOCKED:

| Check | Status | What was seen | First evidence |
|---|---|---|---|
| DOS-040 | **PASS** | Right after Make a wave the screen showed 'Nothing here yet · 0 of 0 picked' with Scan and an enabled 'Take it to packing' for ~25 s (DOS-119, … | `QA/evidence/batch1/regression/ios/warehouse-db-00-fixture-SO-0913.txt` |
| DOS-041 | **PASS** | Sheet 'Requested 3 pc', pad 4; after scrolling, red line 'This batch asks for 3 pc. Count again — more cannot be saved on this line.' directly under … | `QA/evidence/batch1/regression/ios/warehouse-041-01-short-sheet.png` |
| DOS-042 | **PASS** | At 4 of 5: chip 'picking', header '4 of 5 picked', 'Take it to packing' disabled with '1 line not yet picked'. After the last Short 0/'Batch held … | `QA/evidence/batch1/regression/ios/warehouse-042-01-four-of-five-picking.png` |
| DOS-001 | **PASS** | Today: 0–7 22,76,528.00 · 8–15 6,86,008.50 · 16–30 8,41,479.50 · 31–60 5,00,785.00 · 61–90 90,203.00 · 90+ 25,962.00. Money -> Outstanding shows the … | `QA/evidence/batch1/regression/ios/owner-001-01-today-top.png` |
| DOS-005 | **PASS** | SO-0914 'Bargain ₹9.99' appears exactly once in All, once in Order approvals and once in Rate requests; no unnamed bargain_request rows (All: Om Sai … | `QA/evidence/batch1/regression/ios/owner-005-020-fixture-api-log.json` |
| DOS-020-owner | **PASS** | Panel: State Submitted, Stock held 0, 'Confirm order' disabled with 'Waiting on Bargain. Decide it on Approvals; the last approval confirms the … | `QA/evidence/batch1/regression/ios/owner-020-01-SO-0914-panel.png` |
| DOS-020-manager | **FAIL** | Sheet: 'Waiting on: Over credit limit [Approve][Reject] · Bargain [Approve][Reject]', 'Confirm order' disabled with 'Waiting on Over credit limit · … | `QA/evidence/batch1/regression/ios/manager-020-db-before-SO-0915.txt` |
| DOS-021 | **PASS** | Lines: Sunbake 40 pc · '40 pc left to credit'; Campa Lemon 750 ml '2 cs · 48 pc · 2 pc free' · 50 left; Godavari Cow Ghee 20 left; Konkan Farsan Mix … | `QA/evidence/batch1/regression/ios/manager-021-01-credit-notes.png` |
| DOS-023 | **PASS** | POST /warehouse/picklists 200 -> PICK-0092. 'Picking sheets' row 1 PICK-0092, row 2 PICK-0091. Tap -> 'Sheet PICK-0092 · State Open · Where Godown · … | `QA/evidence/batch1/regression/ios/manager-023-db-before.txt` |
| DOS-025 | **PASS** | Under 'Your approval IS the PIN…' the first panel is 'Not out of the godown yet' with one row '13 Sep · Approved · the godown may c… · 1,375.00' … | `QA/evidence/batch1/regression/ios/manager-025-db-before.txt` |
| DOS-041-manager | **PASS** | Dialog stayed open with red 'batch B20260902 on PICK-0092 asks for 24 pcs; 48 were picked' above the button; background stepper '2 cs = 48 pc'. | `QA/evidence/batch1/regression/ios/manager-041-api-start-PICK-0092.txt` |
| DOS-029a | **PASS** | Dialog stayed open with red 'only a confirmed order can be waved; SO-0850 is packed' above the button. Reopened dialog frames at +128, +283 and +514 … | `QA/evidence/batch1/regression/ios/manager-029-02-SO-0850-ticked.png` |
| DOS-029c | **BLOCKED** | The panel opened (title FA/TY/26-27/1187; label lists Start reviewing, Match the items again, Book it as a supplier bill, Reject the document) but … | `QA/evidence/batch1/regression/ios/manager-135-029c-db-before.txt` |
| DOS-135 | **NOT TESTED** | Control only: the 409 sentence 'Sunil Tarsun is reviewing this document (until 2026-10-12T00:00:00.000Z)' appeared in red directly above Start … | `QA/evidence/batch1/regression/ios/manager-135-02-documents.png` |
| DOS-034 | **FAIL** | RCPT-0688 Sheet: State Collected, 'Bank it' enabled, 'Mark bounced' with 'Only a cheque in hand or banked can bounce'. Bank it pressed -> no dialog, … | `QA/evidence/batch1/regression/ios/manager-034-db-before.txt` |

- **iOS FAIL on DOS-020 (manager half) and DOS-034 (in-Sheet dialogs):** UIKit refuses to present a Dialog while a Sheet is open ("Attempt to present RCTFabricModalHostViewController … which is already presenting"), and every later dialog on that screen stays dead until relaunch → **DOS-164 (P1)**, a pre-existing @dos/ui native kit defect that the new buttons of both fixes rely on. The owner's decision dialog (page-level) and the Day-end cheque card's dialog work on iOS.
- DOS-135 NOT TESTED on iOS: the overlap cannot be staged (Expo Go reaches the services directly; the app's API URL is fixed at bundle time; Appium taps are ~1 s apart). The repair is proven by the unit spec and the web before/after.
- DOS-029c and DOS-058 (recorded return) BLOCKED by the harness, not by the product: synthesized drags do not scroll that Sheet body; the DOS-058 screen itself passed.
- The own-order cancel positive control of DOS-073 was not run on iOS (the tool refused the tap chain); web and Android ran it.

**Fix × platform (all regression passes; details in the rows above and in §1/§2):**

| Fix | Web | Android | iOS | API |
|---|---|---|---|---|
| DOS-039 | PASS desk; phone NOT TESTED (one sheet) | not walked (server-side; one real sheet only) | not walked (same) | — (reconciliation + chain confirm stock moves once) |
| DOS-040 | PASS | PASS | PASS | PASS |
| DOS-041 | PASS | PASS | PASS | PASS |
| DOS-042 | PASS | PASS | PASS | — |
| DOS-023 | PASS | PASS | PASS | — |
| DOS-025 | PASS | PASS | PASS | — |
| DOS-058 | PASS | PASS | screen PASS; recorded return BLOCKED (harness) | PASS (residual desk path → DOS-116) |
| DOS-060 | PASS | PASS | PASS | — |
| DOS-057 | PASS | PASS | PASS | — |
| DOS-099 | PASS | PASS | PASS | — |
| DOS-061 | PASS | PASS | PASS | — |
| DOS-094 | PASS | PASS | PASS | PASS |
| DOS-095 | PASS | PASS | PASS | — |
| DOS-021 | PASS | PASS | PASS | — |
| DOS-034 | PASS (scope) — trip cash = DOS-132 | PASS | page-level PASS; in-Sheet dialogs FAIL → DOS-164 | PASS |
| DOS-073 | PASS | PASS | PASS | PASS (residual warehouse/delivery → DOS-115) |
| DOS-075 | PASS | PASS | PASS | PASS |
| DOS-076 | PASS | not walked (server quote; device pricing covered by DOS-075) | not walked (same) | PASS |
| DOS-020 | PASS | PASS | owner PASS; manager FAIL → DOS-164 | PASS |
| DOS-005 | PASS | PASS | PASS | — |
| DOS-077 | PASS desk; phone clipping pre-existing (DOS-128) | PASS | PASS | — |
| DOS-001 | PASS* | PASS | PASS | — |
| DOS-029 | PASS (a–d); e → DOS-135 | PASS* a–c; d FAIL → DOS-156 (held DOS-056) | PASS* | — |
| DOS-135 | PASS (live before/after, desk + phone; unit red→green) | PASS (bundle provenance uncertain) | NOT TESTED (overlap cannot be staged) | — |

`*` = at least one related check was NOT TESTED or BLOCKED on that platform. API = the security probes of §5.


### 4. Business regression — orders, inventory, payments, outstanding, delivery and reports reconcile

Read-only SQL audit of dos_qa, 2026-09-13 01:50–01:58 IST (while walkers were writing through the product). Full table, business meaning
and every query with its output: `QA/evidence/batch1/regression/reconcile/SUMMARY.md`.

- **PASS (9):** stock ledger = balances (2 166 lot-locations); load-out moved stock once (DOS-039 on real data: 0 `load_sheet` rows, packed lots' godown balances unchanged); reservations = reserved; every journal balances (2 974 entries); invoices = their lines and payment state = allocations; outstanding agrees three ways for 115 shops; returns/credit notes go to the right bin (DOS-058 confirmed on CN/9004); order totals and state chains valid; no cross-tenant child rows; no goods out without a bill, no bill paid with bounced money, no dispatch on a trip that never left.
- **KNOWN (2):** duplicate receipt numbers — 4 pairs in tarsun, not grown, and each other tenant's next 4 receipts will repeat a number (DOS-032/059, held for the Fable review); one desk damaged line restocked as saleable (DOS-116).
- **FAIL (1):** overdue and ageing are not re-dated at the start of a day — owner overdue understated by ₹1,01,921 (Tarsun), ₹1,09,585 (Sai), ₹8,109 (Kalyan). Not caused by batch 1 (no ageing job exists at any commit). Logged as **DOS-117 (P1)**.
- **Money sanity on the cross-role chain: PASS** — order, bill, receipt, retailer outstanding, owner report and DB agree to the paisa (§2).

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

