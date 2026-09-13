# Slice h5-orders-slice3 — architect merge review (Fable, 2026-09-13)
**Decision:** MERGE — 7d67f9c + c58a256 (2ec9583..c58a256, 19 files), last after h2, h1 and h3; the lane merges main into itself first.
Two textual conflicts (below), both mechanical. docs/22 rows and `pnpm docs:readme` are same-turn obligations of the main session.

## Blockers / majors (must be fixed before merge)
none. `priceOrder()` stays the only engine: the reprice runs `quoteInTx` → `priceOrder` (pricing-lines.ts:250-287), never a copy of the
rules; `pricedLineFields` (:126-143) is the ONE line arithmetic for draft and confirm; `orderTotals` (:153-170) keeps subtotal = Σ gross.
Charged once: a line changes only when the engine's bargain ruleId ≠ the stored one AND its net falls (:284) — a rate already carried
(seeded lines store ruleId = request id, seed-demo/sales.ts:691-696), expired or higher writes nothing; the bill's `rate × qty −
(line_total − tax)` (invoices.service.ts:1409-1414) is the scheme discount under both stored conventions, guarded not clamped; credit
notes price from invoice lines. `chargeApprovedRates` runs on the caller's tx after the DOS-020 gate and before any reservation
(orders.service.ts:363-388); the spec proves the 400 rolls gate, request, header, line and reservations back. `idempotent` replays the
stored reply; a confirmed order returns early (:348). Integer paise. Retailer self-submit stays under `asSystem` (:291) so the line UPDATE
passes `staffWritePolicy` while `loadRetailer` still checks the link (quote.service.ts:174-191; test 7). Line ids survive (reservations,
picks, the 0040 touch for the device pull). DOS-098: `lastPlacedOrder` (orders.internals.ts:349-371) is module-internal, on
`sales_orders_retailer_idx`, `state NOT IN (draft, cancelled)`, `coalesce(submitted_at, created_at) DESC, id DESC`, DOS-073 reach for a
rep; `lastPlaced` is a read, ORDER_ROLES + `ANY_MEMBER` beside get/list, approvals stripped, registered before `get`. Device: Home pushes
`/order?repeat=<uuidv7>` with no mutation (index.tsx:135-138); R7 reads `['orders','last-placed', retailerId, nonce]` at `staleTime 0`,
seeds pieces through the stepper's own `enteredFor` with today's case size, keeps only listed items, places through `create` → `submit`
only (order.tsx:342-345); the search box is inside `<Async>` (:580-596 within :444-649), so the `query === ''` gate cannot deadlock.
Screens import only @dos/ui, @dos/api-client/react, @dos/domain, expo-router; wire shapes only in contracts; one matrix row; no migration.

## Minors (may follow)
- docs/22 (DOS-098 (e), DOS-126 follow-up 1): §8 rows marked FOUNDER DEFAULT — Order again = the shop's most recently placed order by
  `coalesce(submitted_at, created_at)`, any author and any placed source, built on the device, nothing written until Place order; at
  confirm the drafted prices plus any rate approved since the draft (a shop's standalone approved rate included) and nothing else, a line
  changes only when its net falls — how §4 "Server re-prices at the same version" is read. §11 lines, render, republish.
- `pnpm docs:readme` on the merged tree (12 READMEs below); `docs:readme:check` fails on this branch until then.
- Walker `QA/tools/e2e/dos-098-order-again.mjs` (amendment (d)) not written (lane may not write QA/): write per the plan's reviewNotes
  steps 1-6, template copy only. No live walk was run in the lane (web, Pixel 7, iOS, smoke, verify B): owed, steps below.
- No spec bills a line charged AT CONFIRM (billing test = C1 path; same `pricedLineFields` shape by construction) and the CONFLICT guard
  (:1411) has no spec — probe B.8 stands in. docs/23 §6.1 R7 still lists `orders.setLines` ✓, which R7 no longer calls.

## Amendments — satisfied? evidence
DOS-098 (a) order.tsx:164-170 reset on a new nonce, :180 waits for `['catalog','']`, :187-202 keeps listed variants and counts the rest,
`r7-repeat-partial` :456-465, one string (strings.ts:135). (b) `awaitingSeed` :156-161 → `<Async state={[…,{ isLoading }]}>` :444; a
failed read sets `r7-failure` :174-178; Place order guarded :342/:433; the seed merges, never replaces :204-207. (c) controller :49-55;
spec asserts both routes and unchanged counts after eight reads (orders.spec.ts:2057-2101). (d) NOT done under QA/ (lane rule) — minor;
`enteredFor` :71-79 and the narrowed `enteredUnit` :63 give the properties. (e) docs/23 done (:539-547, :950); docs/22 half owed.
DOS-126 (a) on the h4-merged files (`quoteInTx` carries DOS-096's GST block, quote.service.ts:86-167; describe after DOS-115's). (b)
`offRate` ([id].tsx:185, :362-375). (c) invoices.service.ts:1411-1414. (d) one `inArray(bargainRequests.status` left, inside
`approvedBargainsFor` (quote.service.ts:365); pricing.spec untouched. (e) `chargeApprovedRates` (orders.service.ts:437-455), exact sentence
+ `reprice_failed`, ninth spec proves the rollback. Verifier reversed the non-test hunks: 2+1 and 8+1 tests RED, GREEN after; A.3 holds.

## Merge conflicts with main and how to resolve
1. orders.service.ts:3 — h2 (f92c47c) rewrites the drizzle import to add `type SQL, type SQLWrapper` and keeps `desc, sql`; we drop
   `desc, sql` (only used by repeatLast's inline select, now `lastPlacedOrder`). Resolve to `import { and, asc, eq, type SQL, type
   SQLWrapper } from 'drizzle-orm'`; keep h2's `orderInState` (import + method between `fulfilmentOrders` and `orderLineOwners`) and ours
   (`lastPlacedOrder` import, `lastPlaced` after `list`, the new confirmInTx). Typecheck after.
2. orders.spec.ts — main's e474288 rewrites the DOS-115 comment (:1889-1890) and upload test (:2150-2208); we insert DOS-098 just above
   that comment (:1887) and append DOS-126 after DOS-115. Three unchanged lines separate them, so git should merge clean; if not: DOS-098,
   main's comment, DOS-115 with main's `role_not_allowed` + `requirePlacer` body, DOS-126. Imports: ours :1, main's :4 and :34-37, keep all.
3. Clean by hunk position: permissions.ts (h2 :635-667 vs ours :539-549), permissions.test.ts (:586-640 vs :292), examples.ts (:3856 vs
   :3626/:5139), invoices.service.ts (h2 :1214 vs ours :1383-1420), docs/23 (:398 vs :539/:950). h1, h3 touch none; h4 is in both.

## What the later fixes must build on
- DOS-009 / docs/23 §10 #8: reuse `lastPlacedOrder`'s sort for `orders.list` so Home's list and the basket agree; no second "newest" rule.
- DOS-101: `enteredFor` is the one conversion; the seed follows it. DOS-082: if it re-prices at submit, revisit the draft-date rule in
  `repriceApprovedBargains` — confirm deliberately keeps drafted prices and charges only the approved rate.
- S-19 (`expires_at`) and S-20 (two bargain conventions): `approvedBargainsFor` is the single applicability rule and `line_total − tax`
  the single taxable; fix expiry there, a backfill keeps that identity. `repeatLast`'s reach gap: pass the rep's id through the same helper.

## READMEs that will change
`pnpm docs:readme` adds `GET /orders/last-placed` to backend/{owner,manager,sales,warehouse,delivery,retailer}-service/README.md and to
the endpoint tables of frontend/{owner,manager,sales,warehouse,delivery,retailer}-app/README.md (admin mounts no orders). Same commit.

## Regression walk, API probes and SQL
R7 web (dos_qa, ramesh.gupta, 1280×800 and 390×844) and Android (Pixel_7_API_36, -memory 3072): plan SQL C (all sales_orders rows of
R-0001 in tarsun) → n; three Order again taps: only GET /orders/last-placed plus catalog/stock/quote (POST /pricing/quote is expected),
never POST /orders, /orders/repeat-last or /orders/{id}/lines; SQL C stays n; skeleton until the basket; IN YOUR ORDER = plan SQL A
(`state not in ('draft','cancelled') order by coalesce(submitted_at, created_at) desc, id desc`, first row per slug) lines and qty_pcs
for tarsun, sai, kalyan; an `inner` line shows as pieces. API :3006 GET /orders/last-placed?retailerId=<R-0001> → SQL A's order,
`approvals: []`; unlinked shop 403; owner :3001 on a no-history shop `{ item: null }`; a rep → own order or null; GET /orders/<id>
unchanged. `pnpm smoke --run-tag <tag>` 0 BROKEN.
DOS-126 (verify B on the rebuilt dos_qa): SO-A bargain→credit, SO-B credit→bargain, SO-C Rate requests→gates, SO-D bargain only, SO-E the
shop's standalone ask approved before its own submit. Last decide reply: confirmed, totalPaise 122400. Plan B.4 SQL on sales_orders ⋈
sales_order_lines → header 122808/13512/13116/122400; line 5117/4554/13512/122412, applied_rules [bargain 13512, ruleId = request id],
price_locked t, `l.updated_at > o.submitted_at` t; 24 pending reservations; ONE `OrderConfirmed` outbox row, payload totalPaise 122400.
Replay the last decide with the same idempotencyKey → identical body, still one event, still 24. Control (no ask): confirmed lines =
draft, `max(l.updated_at) < o.confirmed_at`. Bill after pack (B.8): invoice_lines 4554 / 0 / 109296 / 6558 / 6558, total 122400 = order
total. Rep view desk + phone ₹45.54/pc; retailer web :5178 on SO-E ₹45.54 with no "−₹135.12"; manager Orders ₹1,224.00.

## Defects outside this slice
- orders.service.ts:216-221 + pricing-lines.ts:98-99 — `repeatLast` forwards `enteredUnit` and `packSizeFor` counts `inner` as a case:
  every seeded inner line comes back case-size times too large for API callers (P2).
- orders.service.ts:195 — `repeatLast` calls `lastPlacedOrder` without the rep's id: a salesperson copies a colleague's lines (P3).
- orders.service.ts:213 — `repeatLast` still writes `note: 'Repeat of <uuid>'` (docs/23 §10 #10).
- frontend/retailer-app/app/order.tsx:344 vs :385-387 — a hand-built basket places `priced` while the panel draws only `chosen` (P3).
- frontend/sales-app/src/lib/local.ts:448, :474 — "Repeat last order" sorts `_local_rev DESC` before `created_at`; new.tsx keeps `inner` as `piece` (P3).
