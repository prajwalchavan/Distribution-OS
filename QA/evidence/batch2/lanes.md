# QA batch 2 — implementation lanes

Every in-scope finding (141, see `inventory.md`) sits in exactly one lane (DOS-140 is split: its rep/shop half rides in
b2-h4-stock slice 1, its raw-view half in its own lane). 69 new lanes follow the six held lanes that are already running.

## Rules for every lane

1. **One worktree, one branch, one test database per lane** (`.claude/worktrees/<lane>`, branch `qa/<lane>`, a copy of
   `dos_test_batch2_template`; never `dos_qa`). At most **three lanes run at once** (8 GB RAM, QA/STATE.md:11).
2. **Test first.** Each id gets the failing test named in its test plan, then the fix, then an independent verifier that proves
   red without the fix and green with it, then the platforms listed. `pnpm format`; after a contract change `pnpm docs:readme`.
3. **File ownership.** A lane owns the files its findings list *in a layer the finding changes* (a contract file counts only for a
   finding whose layers include contracts, a kit file only for ui-kit, and so on; files listed only for reference are not owned).
   Generated READMEs, `docs/22-source-of-truth.md` (the main session records founder decisions there) and `QA/*` are owned by no lane.
   `likelyFiles` are the planner's best guess. **If a lane finds it must edit a file another unmerged lane owns, it stops and asks.**
4. **Depends on** names the lanes that must be merged into main before this lane starts, with the reason: `file:` (both edit that
   file; the earlier lane goes first), `finding:` (a record's `dependsOn` / `foldedInto`), or `held merge order`. Implied
   dependencies are left out. Two lanes with no path between them never own the same file (checked by script).
5. **Swap rule for architect waits.** A `file:` dependency on a lane marked **[WAITS lane]** that has not started yet is not a
   blocker: the READY lane may take the file first and the waiting lane rebases on it when its design lands. A `finding:`
   dependency is always a blocker.
6. **Data.** After b2-h1-money slice 1 (DOS-032+059) merges, dos_qa is rebuilt from the fixed seed (founder Q5). Lanes that change
   seed data after that (DOS-007, 018, 067, 087, 100, 105, 113, 123) re-run `pnpm db:seed` on dos_qa when they merge (idempotent).

## Overview

| lane | ids | top | status | depends on | size |
|---|---|---|---|---|---|
| H6 `b2-h6-admin` | 106 | P0 | running | H5b | ~1 d |
| H1a `b2-h1-money · slice 1` | 032, 059 | P1 | running | — | ~1.5 d |
| H4a `b2-h4-stock · slice 1` | 074, 097 | P1 | running | H1a | ~1 d |
| H4b `b2-h4-stock · slice 2` | 096 | P1 | running | H4a | ~0.5 d |
| H5a `b2-h5-orders · slice 1` | 003 | P1 | running | H4b | ~0.25 d |
| H5b `b2-h5-orders · slice 2` | 004 | P1 | running | H4b, H5a | ~0.5 d |
| H2 `b2-h2-trips` | 043 | P1 | running | H6 | ~0.5 d |
| H1b `b2-h1-money · slice 2` | 007 | P1 | running | H1a, H2 | ~0.5 d |
| H3 `b2-h3-doorstep` | 056, 156 | P1 | running | H1b | ~1.25 d |
| L01 `b2-01-order-roles` | 115 | P0 | READY | H2 | ~0.5 d |
| L02 `b2-02-plan-a-trip` | 131, 137 | P0 | READY | H2, L03 | ~1.25 d |
| L03 `b2-03-packs-awaiting-load` | 133 | P1 | READY | — | ~0.5 d |
| L04 `b2-04-approval-reprice` | 126, 127 | P1 | READY | H4b, L01 | ~1 d |
| L05 `b2-05-money-trip-cash-ageing` | 132, 117 | P1 | READY | H1b | ~1 d |
| L06 `b2-06-credit-note-damaged-pdf-glyphs` | 116, 151 | P1 | READY | — | ~0.5 d |
| L07 `b2-07-order-again` | 098 | P1 | READY | L04 | ~0.5 d |
| L08 `b2-08-docint-review-pod-url` | 031, 123 | P1 | READY | — | ~0.5 d |
| L09 `b2-09-support-access-owner` | 108, 110 | P1 | READY | H6 | ~1 d |
| L10 `b2-10-sync-pull-storm` | 080 | P1 | READY | H3 | ~1 d |
| L11 `b2-11-amount-fields` | 146, 124, 154 | P1 | READY | L07, L08 | ~0.75 d |
| L12 `b2-12-kit-modal-host` | 164 | P1 | WAITS | L02, L05 | ~1 d |
| L13 `b2-13-accountant-scope` | 037 | P1 | WAITS | L01 | ~0.5 d |
| L14 `b2-14-warehouse-adjust-rule` | 044 | P1 | WAITS | L13 | ~0.5 d |
| L15 `b2-15-admin-unlock-audit-names` | 107, 109 | P1 | WAITS | H6, L13 | ~1 d |
| L16 `b2-16-order-register-columns` | 027, 010 | P2 | READY | H5b, L08, L09, L12 | ~0.75 d |
| L17 `b2-17-audit-and-replay` | 028, 160 | P2 | READY | H3, L07 | ~1 d |
| L18 `b2-18-offline-retry-counts` | 046, 053 | P2 | READY | L10 | ~1 d |
| L19 `b2-19-kit-sheet-footer-keyboard` | 152, 159 | P2 | WAITS | L12 | ~1 d |
| L20 `b2-20-kit-small-fixes` | 157, 122, 162 | P2 | READY | L12 | ~0.75 d |
| L21 `b2-21-stop-screen-refresh` | 063, 149 | P2 | READY | L18 | ~0.75 d |
| L22 `b2-22-collect-and-papers` | 062, 065 | P2 | READY | L21 | ~0.75 d |
| L23 `b2-23-door-quantities-reasons` | 064, 070, 163 | P2 | READY | L22 | ~1 d |
| L24 `b2-24-delivery-refusal-history` | 148, 067 | P2 | READY | L06, L08, L23 | ~1 d |
| L25 `b2-25-native-offline-hint` | 068 | P2 | READY | H3, L24 | ~0.5 d |
| L26 `b2-26-order-entry-layout` | 128, 147, 129 | P2 | READY | H4a | ~1 d |
| L27 `b2-27-order-entry-footer-pieces` | 161, 085 | P2 | READY | L11, L23, L26 | ~1 d |
| L28 `b2-28-owner-refusals-results` | 012, 008, 015 | P2 | READY | H1b, L16 | ~0.75 d |
| L29 `b2-29-rep-price-diff-beat` | 082, 084 | P2 | READY | L27 | ~0.75 d |
| L30 `b2-30-rep-offline-submit` | 086, 142, 092 | P2 | READY | L16, L25, L29 | ~1 d |
| L31 `b2-31-shop-pieces-short-pick` | 101, 144 | P2 | READY | L27 | ~1 d |
| L32 `b2-32-support-audit-path-ids` | 111, 112 | P2 | READY | L15, L17, L28 | ~1 d |
| L33 `b2-33-owner-charts-map` | 002, 017 | P2 | READY | L20, L32 | ~0.75 d |
| L34 `b2-34-billing-desk-queue` | 022, 145, 026 | P2 | READY | L30 | ~1.25 d |
| L35 `b2-35-fulfilment-desk` | 024, 134 | P2 | READY | L31, L34 | ~0.75 d |
| L36 `b2-36-manager-money-panels` | 033, 136 | P2 | READY | L35 | ~0.75 d |
| L37 `b2-37-manager-shop-panel` | 035, 036, 038 | P2 | READY | L28, L35 | ~0.75 d |
| L38 `b2-38-warehouse-lists-vanstock` | 047, 121, 049 | P2 | READY | L14, L35 | ~1 d |
| L39 `b2-39-inventory-refusals-sellable` | 048, 140 | P2 | READY | H4a, L38 | ~1 d |
| L40 `b2-40-approval-credit-limit` | 006 | P2 | WAITS | H5b, L16, L17 | ~0.5 d |
| L41 `b2-41-names-and-sort-keys` | 013, 009 | P2 | WAITS | H5a, L34, L40 | ~0.75 d |
| L42 `b2-42-shop-hold-rate-read` | 100, 104 | P2 | WAITS | H4a, H4b, L31, L41 | ~1 d |
| L43 `b2-43-shop-multi-distributor-home` | 102 | P2 | WAITS | L05, L07, L15 | ~1 d |
| L44 `b2-44-shop-contact-returns` | 103 | P2 | WAITS | L32, L42 | ~1 d |
| L45 `b2-45-kit-upi-qr` | 125 | P2 | WAITS | L20, L42 | ~1 d |
| L46 `b2-46-bill-cancel-order-state` | 139 | P2 | WAITS | L41 | ~0.5 d |
| L47 `b2-47-cancel-after-picking` | 138 | P2 | WAITS | L19, L28, L46 | ~1 d |
| L48 `b2-48-owner-exports` | 014 | P2 | WAITS | L33, L47 | ~0.5 d |
| L49 `b2-49-receivables-views` | 011, 016 | P2 | WAITS | L36, L43, L48 | ~1 d |
| L50 `b2-50-brand-dms-commit` | 030 | P2 | WAITS | L36, L37, L46 | ~1 d |
| L51 `b2-51-count-expected` | 045 | P2 | WAITS | L39 | ~0.5 d |
| L52 `b2-52-door-credit-expense-rules` | 066, 071 | P2 | WAITS | L24 | ~0.75 d |
| L53 `b2-53-stock-credit-signals` | 078, 081 | P2 | WAITS | H4a, L47, L52 | ~1 d |
| L54 `b2-54-cess-on-orders` | 079 | P2 | WAITS | H4b, L42, L53 | ~1 d |
| L55 `b2-55-scheme-bargain-semantics` | 087, 090 | P2 | WAITS | L54 | ~1 d |
| L56 `b2-56-rep-bill-total` | 083 | P2 | WAITS | H4b, L54, L55 | ~0.5 d |
| L57 `b2-57-owner-today-labels` | 018, 019 | P3 | READY | H5b, L49, L55 | ~1 d |
| L58 `b2-58-order-panel-approvals` | 130, 153, 155 | P3 | READY | L50, L57 | ~1 d |
| L59 `b2-59-admin-console-polish` | 113, 114 | P3 | READY | L32 | ~0.75 d |
| L60 `b2-60-desk-refusal-sentences` | 141 | P3 | READY | L49, L54 | ~0.5 d |
| L61 `b2-61-short-sheet-reasons` | 051, 165, 118 | P3 | READY | L38, L60 | ~1 d |
| L62 `b2-62-pick-sheet-status` | 119, 120 | P3 | READY | L61 | ~0.5 d |
| L63 `b2-63-staff-role-narrowing` | 052, 072 | P3 | READY | L39, L62 | ~1 d |
| L64 `b2-64-app-boot-refresh` | 055, 089 | P3 | READY | L57 | ~0.75 d |
| L65 `b2-65-kit-native-a11y-insets` | 069, 158, 150 | P3 | READY | L19, L27 | ~0.75 d |
| L66 `b2-66-rep-shop-card` | 088, 091, 093 | P3 | READY | L37, L44, L56, L63 | ~1 d |
| L67 `b2-67-shop-wording-dates` | 105, 143 | P3 | READY | L45, L59, L66 | ~0.75 d |
| L68 `b2-68-warehouse-queue-rows` | 050 | P3 | WAITS | L51, L67 | ~1 d |
| L69 `b2-69-shelf-life-rule` | 054 | P3 | WAITS | L68 | ~1 d |

## Held nine — already running, merge in the architect's order

Order (QA/evidence/batch1/held-review-brief.md:346): **H1a → H4a → H4b → H5a → H5b → H6 → H2 → H1b → H3**. These lanes started in
parallel before this plan, so some of them own the same files (permissions.ts: H4a, H6, H2; orders.spec.ts: H4b, H5a, H5b;
delivery.spec.ts: H1a, H2, H3). Merge them one at a time in this order and rebase the next lane on main before its merge.

### H6 · `b2-h6-admin` — P0 · READY NOW — running (wf_beb0d5ef-504)

- **DOS-106** (P0 security, L, held-plan): The "support" console level has every power of the "super" level, including…
- **Depends on:** H5b (held merge order)
- **Owns:** `backend/libs/contracts/src/permissions.ts`, `backend/libs/core/src/modules/auth/auth.service.ts`, `backend/libs/core/src/modules/platform-admin/console.service.ts`, `backend/libs/core/src/modules/platform-admin/internals.ts`, `backend/libs/core/src/modules/platform-admin/platform-admin.spec.ts`, `backend/libs/core/src/modules/platform-admin/subscriptions.service.ts`, `backend/libs/core/src/modules/platform-admin/support.service.ts`, `backend/libs/core/src/modules/platform-admin/tenants.service.ts`
- **Prove on:** web, android
- **Test plan:**
  - DOS-106: Red-then-green in platform-admin.spec.ts: with a support-level token, onboarding, subscriptions.upsert, suspend and disabling a super all return 200 today and must return 403, and the super must still sign in; permissions.test.ts must fail whenever an admin.* path has no ADMIN_LEVELS row.

### H1a · `b2-h1-money · slice 1` — P1 · READY NOW — running (wf_beb0d5ef-504)

- **DOS-032** (P1 bug, M, held-plan): Two receipts carry the same number: RCPT-0696 exists twice, and the next three…
- **DOS-059** (P1 business-logic, L, held-plan): Receipt numbers are issued twice: RCPT-0696 … RCPT-0699 each exist twice, and…
- **Depends on:** none
- **Owns:** `backend/libs/core/src/modules/delivery/delivery.spec.ts`, `backend/libs/core/src/modules/receivables/receivables.service.ts`, `backend/libs/core/src/modules/receivables/receivables.spec.ts`, `backend/libs/core/src/platform/numbering.ts`, `backend/libs/core/src/platform/pg-errors.ts`, `backend/libs/database/migrations/meta/_journal.json`, `backend/libs/database/src/rls.test.ts`, `backend/libs/database/src/schema/receivables.ts`, `backend/libs/database/src/seed-demo.test.ts`, `backend/libs/database/src/seed-demo/receivables.ts`
- **Prove on:** web, android
- **Test plan:**
  - DOS-032: Per the amended plan. rls.test: a second receipt with the same (tenant, series, fy, receipt_no) is refused, and the same number is accepted in the next FY. receivables.spec: a desk receipt drawn from a lagging RCPT counter gets max+1 in the same transaction plus an audit row (not a 409). Add the 1 April 00:00-05:30 IST FY boundary spec. seed-demo.test: every RCPT counter ends past the highest seeded number.
  - DOS-059: rls.test.ts 'DOS-032 DOS-059 refuses a second receipt number in one series and FY' plus delivery.spec.ts 'a doorstep collection drawn from a lagging RCPT counter self-heals to max+1 with an audit row' fail before and pass after migrations 0043/0044 and the numbering fix; seed-demo.test.ts proves every RCPT counter ends past the highest seeded number.

### H4a · `b2-h4-stock · slice 1` — P1 · READY NOW — running (wf_beb0d5ef-504)

- **DOS-074** (P1 business-logic, M, architect-design): "N cs available" on the order screen is wrong: the app reads only the first 500…
- **DOS-097** (P1 bug, M, held-plan): "Stock not known" for 14 of 171 products because the stock hint reads only the…
- **DOS-140** (partial): rep/shop half only (architect amendment d); the raw-view half is in its own lane
- **Depends on:** H1a (held merge order)
- **Owns:** `backend/libs/contracts/src/inventory.ts`, `backend/libs/contracts/src/permissions.ts`, `backend/libs/core/src/modules/inventory/inventory.controller.ts`, `backend/libs/core/src/modules/inventory/inventory.mappers.ts`, `backend/libs/core/src/modules/inventory/stock.service.ts`, `backend/libs/core/src/modules/orders/orders.internals.ts`, `frontend/libs/api-client/src/pages.ts`, `frontend/retailer-app/app/order.tsx`, `frontend/sales-app/app/orders/new.tsx`, `frontend/sales-app/app/shops/catalog.tsx`
- **Prove on:** web, android, ios
- **Test plan:**
  - DOS-074: availability.spec.ts 'DOS-074: stock.availability returns one godown total per item even when its lots run past the 500th sellable row' (505-lot fixture): red against today's sum of the first sellable page, green on the new read.
  - DOS-097: availability.spec 'DOS-097: a retailer gets one godown total per item even when lots run past the 500th sellable row' fails today (the procedure does not exist), passes after; then walk R7 and check that Cheese Slices and Dairy Whitener show a stock line, not 'Stock not known'.
  - DOS-140 (rep/shop half): proved by the DOS-074 availability.spec case that excludes vehicle, damaged, in-transit and second-warehouse stock.

### H4b · `b2-h4-stock · slice 2` — P1 · READY NOW — running (wf_beb0d5ef-504)

- **DOS-096** (P1 business-logic, M, held-plan): The order screen prices everything before GST: "You pay ₹5,237.68" became an…
- **Depends on:** H4a (held merge order; file: order.tsx)
- **Owns:** `backend/libs/contracts/src/pricing.ts`, `backend/libs/core/src/modules/orders/orders.spec.ts`, `backend/libs/core/src/modules/orders/pricing-lines.ts`, `backend/libs/core/src/modules/pricing/pricing.spec.ts`, `backend/libs/core/src/modules/pricing/quote.service.ts`, `frontend/retailer-app/app/order.tsx`, `frontend/retailer-app/app/orders/[id].tsx`, `frontend/retailer-app/src/strings.ts`
- **Prove on:** web, android
- **Test plan:**
  - DOS-096: pricing.spec 'DOS-096: a shop's quote carries GST at the dated HSN rate and the rupee-rounded payable' and orders.spec 'what the shop is quoted is what its placed order carries' fail today, pass after; then walk R7 on web and Android and check 'You pay' equals the placed SO total.

### H5a · `b2-h5-orders · slice 1` — P1 · READY NOW — running (wf_beb0d5ef-504)

- **DOS-003** (P1 bug, S, held-plan): Order detail lists quantities and money but no product names
- **Depends on:** H4b (held merge order; file: orders.spec.ts; finding: DOS-003 needs DOS-096)
- **Owns:** `backend/libs/contracts/src/orders.ts`, `backend/libs/core/src/modules/orders/orders.mappers.ts`, `backend/libs/core/src/modules/orders/orders.spec.ts`, `backend/libs/core/src/modules/tenant-catalog/import.ts`, `backend/libs/core/src/modules/tenant-catalog/index.ts`, `frontend/manager-app/app/orders/index.tsx`, `frontend/owner-app/app/orders/index.tsx`
- **Prove on:** web, android
- **Test plan:**
  - DOS-003: orders.spec.ts › 'DOS-003: order lines carry variantName — tenant alias first, global name otherwise, and an item delisted after ordering is still named' fails on today's OrderLineSchema and passes after; then SO-0854's panel names all six lines with '10 pc free' in owner and manager, on web and the Pixel 7.

### H5b · `b2-h5-orders · slice 2` — P1 · READY NOW — running (wf_beb0d5ef-504)

- **DOS-004** (P1 ux, M, held-plan): Approvals never say which shop, order or amount is being approved
- **Depends on:** H4b (file: orders.spec.ts; finding: DOS-004 needs DOS-096); H5a (held merge order; file: orders.ts, orders.mappers.ts, orders.spec.ts, index.tsx)
- **Owns:** `backend/libs/contracts/src/orders.ts`, `backend/libs/core/src/modules/orders/approvals.service.ts`, `backend/libs/core/src/modules/orders/orders.mappers.ts`, `backend/libs/core/src/modules/orders/orders.spec.ts`, `backend/libs/core/src/modules/retailers/import.ts`, `frontend/manager-app/app/orders/index.tsx`, `frontend/owner-app/app/approvals.tsx`, `frontend/owner-app/app/index.tsx`
- **Prove on:** web, android
- **Test plan:**
  - DOS-004: Three orders.spec.ts DOS-004 specs fail on today's ApprovalSchema and pass after: the queue names the shop, order no and total; a payload with no order no still gets them from the order; a non-order approval lists nulls. Then the owner Approvals row and panel and the manager 'Waiting for a decision' card read 'Laxmi Narayan Stores · SO-0868 · ₹17,736' on web and Android.

### H2 · `b2-h2-trips` — P1 · READY NOW — running (wf_beb0d5ef-504)

- **DOS-043** (P1 security, M, held-plan): A warehouse user can start loading and send a trip out in one tap each, two…
- **Depends on:** H6 (held merge order; file: permissions.ts)
- **Owns:** `backend/libs/contracts/src/permissions.test.ts`, `backend/libs/contracts/src/permissions.ts`, `backend/libs/core/src/modules/delivery/delivery.spec.ts`, `backend/libs/core/src/modules/delivery/trips.service.ts`, `backend/libs/core/src/modules/warehouse/load-sheets.service.ts`, `backend/warehouse-service/src/service.spec.ts`, `frontend/warehouse-app/app/load/trips.tsx`, `frontend/warehouse-app/src/strings.ts`
- **Prove on:** web, android, ios
- **Test plan:**
  - DOS-043: delivery.spec.ts DOS-043 case: a warehouse token is refused on trips.depart, and depart answers 409 load_sheet_not_confirmed while a draft sheet holds one of the trip's stop orders even when trip_id is null; start-loading and depart write audit rows. Red today, green after.

### H1b · `b2-h1-money · slice 2` — P1 · READY NOW — running (wf_beb0d5ef-504)

- **DOS-007** (P1 bug, M, held-plan): "Send statement" says it queued a statement; nothing is ever sent
- **Depends on:** H1a (file: receivables.service.ts; finding: DOS-007 needs DOS-032; finding: DOS-007 needs DOS-059); H2 (held merge order)
- **Owns:** `backend/libs/contracts/src/notifications.ts`, `backend/libs/core/src/modules/notifications/worker.ts`, `backend/libs/core/src/modules/receivables/receivables.queries.ts`, `backend/libs/core/src/modules/receivables/receivables.service.ts`, `backend/libs/database/src/seed-demo/notifications.ts`, `backend/worker/src/jobs/notifications.ts`, `frontend/owner-app/app/money/index.tsx`, `frontend/owner-app/app/shops/index.tsx`
- **Prove on:** web
- **Test plan:**
  - DOS-007: notifications.test.ts › 'DOS-007: registering the notifications jobs gives StatementRequested an outbox relay handler' and notifications.spec › 'a statement request queues ONE statement message…' fail today and pass after; then Shops → Prerna → Send statement shows the result on web, and a messages row appears within one relay tick.

### H3 · `b2-h3-doorstep` — P1 · READY NOW — running (wf_beb0d5ef-504)

- **DOS-056** (P1 reliability, L, held-plan): A delivery recorded without network is lost: Android drops it silently, web…
- **DOS-156** (P2 bug, S, covered-by-other): Android manager app: a write pressed with no connection says 'Something could… — folded into DOS-056; verify by name
- **Depends on:** H1b (held merge order)
- **Owns:** `backend/libs/core/src/modules/delivery/delivery.spec.ts`, `backend/libs/core/src/modules/delivery/delivery.sync.ts`, `backend/libs/core/src/modules/files/files.service.ts`, `backend/libs/core/src/service/bootstrap.ts`, `docs/27-offline-sync-client.md`, `frontend/delivery-app/app/attention.tsx`, `frontend/delivery-app/app/stop/[id]/deliver.tsx`, `frontend/libs/api-client/src/errors.test.ts`, `frontend/libs/api-client/src/errors.ts`
- **Prove on:** web, android, ios
- **Test plan:**
  - DOS-056: delivery.spec.ts 'DOS-056 an offline delivery for a credit shop, queued with its photo inline, is accepted from /sync/upload and pod_evidence holds only an object key' plus errors.test.ts 'Expo FetchError fetch failed is network, never unknown' fail before and pass after, then the Android offline walk (a-41..a-44) and the manager app's no-connection sentence on Android (DOS-156).
  - DOS-156: errors.test.ts: an Expo FetchError ('fetch failed: …', and the deadline abort) maps to kind 'network', not 'unknown' (red today at errors.ts:157-161), then Android manager app with the API cut shows 'No connection. Check the signal, then press again.' in the open dialog.

## P0 lanes

### L01 · `b2-01-order-roles` — P0 · READY NOW

- **DOS-115** (P0 security, M, architect-design): Warehouse and delivery logins can cancel, re-line and submit any order in the…
- **Depends on:** H2 (file: permissions.test.ts, permissions.ts)
- **Owns:** `backend/libs/contracts/src/permissions.test.ts`, `backend/libs/contracts/src/permissions.ts`, `backend/libs/core/src/modules/orders/orders.service.ts`, `backend/libs/core/src/modules/orders/orders.spec.ts`, `backend/libs/core/src/modules/orders/orders.sync.ts`, `docs/23-app-screens-and-api-gaps.md`
- **Prove on:** web
- **Test plan:**
  - DOS-115: Permission-matrix and orders spec: a warehouse or delivery token on POST /orders, /orders/{id}/lines, /submit, /cancel and repeatLast gets 403 (today 200) while orders.get/list stay 200; a sales_orders op uploaded through /sync/upload from a warehouse device becomes a sync_error.

### L02 · `b2-02-plan-a-trip` — P0 · READY NOW

- **DOS-131** (P0 missing-feature, L, architect-design): No screen in any app can create a delivery trip or add a stop, so a newly…
- **DOS-137** (P2 bug, S, covered-by-other): A load sheet built in the warehouse app is never linked to its trip, so the… — folded into DOS-131; verify by name
- **Depends on:** H2 (file: trips.tsx; finding: DOS-131 needs DOS-043); L03 (file: index.tsx)
- **Owns:** `frontend/delivery-app/app/index.tsx`, `frontend/manager-app/app/fulfilment/load-out.tsx`, `frontend/manager-app/src/lib/load-out.ts`, `frontend/owner-app/app/orders/trips.tsx`, `frontend/warehouse-app/app/load/index.tsx`, `frontend/warehouse-app/app/load/trips.tsx`
- **Prove on:** web, android, ios
- **Test plan:**
  - DOS-131: Chain walk: pack an order today, then use Plan a trip on M7 and W10 (date, vehicle, driver, float, the packed bill). POST /delivery/trips must return 200 with a stop and a planned delivery row. Add a late bill through stops.add. Build the W7 sheet with tripId and check load_sheets.trip_id is set. Today no such control exists.
  - DOS-137: warehouse.spec.ts: loadSheets.create with a tripId, then approve and confirm; delivery.trips.get must return that sheet in loadSheetIds and a set loadConfirmedAt. Web chain: build the sheet in W7 for a planned trip, and the crew's D1 shows the challan instead of 'not confirmed'.

## P1 lanes

### L03 · `b2-03-packs-awaiting-load` — P1 · READY NOW

- **DOS-133** (P1 bug, M, architect-design): Warehouse Load screen offers 50 arbitrary old packs as 'Packed orders'; today's…
- **Depends on:** none
- **Owns:** `backend/libs/contracts/src/warehouse.ts`, `backend/libs/core/src/modules/warehouse/packing.service.ts`, `backend/libs/core/src/modules/warehouse/warehouse.spec.ts`, `frontend/warehouse-app/app/load/index.tsx`
- **Prove on:** web, android
- **Test plan:**
  - DOS-133: Warehouse spec with seeded hash-id old packs plus two packed today: packs.list({status:'awaiting_load'}) returns today's two first and excludes dispatched packs and packs on a draft sheet (today: id-ordered old packs). W7 on web lists today's orders.

### L04 · `b2-04-approval-reprice` — P1 · READY NOW

- **DOS-126** (P1 business-logic, M, architect-design): Approving a rate request on Approvals confirms the order at the old rate, not…
- **DOS-127** (P2 bug, M, no design): A shop's own cancellation leaves the order's approvals pending, and the owner…
- **Depends on:** H4b (file: orders.spec.ts, pricing-lines.ts, quote.service.ts; finding: DOS-126 needs DOS-096); L01 (file: orders.service.ts, orders.spec.ts)
- **Owns:** `backend/libs/core/src/modules/orders/approvals.service.ts`, `backend/libs/core/src/modules/orders/orders.internals.ts`, `backend/libs/core/src/modules/orders/orders.service.ts`, `backend/libs/core/src/modules/orders/orders.spec.ts`, `backend/libs/core/src/modules/orders/pricing-lines.ts`, `backend/libs/core/src/modules/pricing/bargains.service.ts`, `backend/libs/core/src/modules/pricing/quote.service.ts`
- **Prove on:** web
- **Test plan:**
  - DOS-126: Orders spec built from the bargain-rate-probe: approve the rate request after submit, then approve the last gate. Expect rate_paise 4554, line total 122412 and a bargain applied_rule (today 5117 / 137545 / no rule) on all four approval paths plus the after-create control. price_locked lines stay unchanged.
  - DOS-127: orders.spec.ts: a retailer cancels its held order that has a pending bargain gate. Expect the approval to become expired and to leave orders.approvals.list(status=pending); today it stays pending. Also: deciding a pending gate whose order is already cancelled expires it instead of answering 409.

### L05 · `b2-05-money-trip-cash-ageing` — P1 · READY NOW

- **DOS-132** (P1 business-logic, M, architect-design): Day-end offers cash still out with a delivery crew, and trip receipts of…
- **DOS-117** (P1 bug, M, architect-design): Overdue and ageing stop moving on days a shop has no posting: no nightly ageing…
- **Depends on:** H1b (file: receivables.service.ts, notifications.ts)
- **Owns:** `backend/libs/core/package.json`, `backend/libs/core/src/modules/delivery/settlement.service.ts`, `backend/libs/core/src/modules/receivables/index.ts`, `backend/libs/core/src/modules/receivables/outstanding.ts`, `backend/libs/core/src/modules/receivables/receivables.service.ts`, `backend/libs/core/src/modules/receivables/receivables.spec.ts`, `backend/libs/core/src/modules/reporting/rollup.ts`, `backend/worker/src/jobs/notifications.ts`, `backend/worker/src/jobs/reporting.ts`, `backend/worker/src/main.ts`, `frontend/manager-app/app/money/day-end.tsx`, `frontend/manager-app/app/money/index.tsx`, `frontend/owner-app/app/money/receipts.tsx`
- **Prove on:** web, android
- **Test plan:**
  - DOS-132: Receivables spec: depositing a cash receipt whose trip is active gets 409 trip_cash_not_settled (today 200, CASH_VAN credited). After the trip settles, the deposit nets CASH_VAN to zero and credits CASH. Day-end at 1280 and 390 hides TRIP-ACTIVE receipts for manager and accountant.
  - DOS-117: Worker spec on a template copy: an invoice falls due yesterday with no posting, then the 00:20 finalize ageing step runs. Expect retailer_outstanding_summary.as_of=today, overdue equal to the live recompute and an ageing_snapshots row for today (today it stays at yesterday). Also: worker start catches up when the latest as_of is older than today.

### L06 · `b2-06-credit-note-damaged-pdf-glyphs` — P1 · READY NOW

- **DOS-116** (P1 business-logic, S, architect-design): A desk credit note for damaged goods puts the pieces back into saleable stock…
- **DOS-151** (P3 bug, S, no design): Invoice and credit-note PDFs print '?' for the em dash in the tenant's own…
- **Depends on:** none
- **Owns:** `backend/libs/contracts/src/billing.ts`, `backend/libs/contracts/src/delivery.ts`, `backend/libs/core/src/documents/documents.spec.ts`, `backend/libs/core/src/documents/pdf.ts`, `backend/libs/core/src/modules/billing/billing.spec.ts`, `backend/libs/core/src/modules/billing/credit-notes.service.ts`, `backend/libs/core/src/modules/delivery/deliveries.service.ts`
- **Prove on:** web, android
- **Test plan:**
  - DOS-116: billing.spec: create a return_damaged credit note with saleable omitted and autoIssue. Expect credit_note_lines.saleable=false and a sale_return_damaged row into the damaged bin (today: sale_return_saleable into the godown). Explicit saleable:true gets 400 return_not_saleable. The doorstep damaged-return spec still passes.
  - DOS-151: documents.spec. Red: escapePdfText('A — B') yields '?'. Green: it yields the WinAnsi byte 0x97, and textWidth measures the em dash at 1000/1000 em. Then re-render INV/0826 and read its footer.

### L07 · `b2-07-order-again` — P1 · READY NOW

- **DOS-098** (P1 business-logic, M, no design): "Order again" repeats a random old order (a rep's order from 30 July), not the…
- **Depends on:** L04 (file: orders.internals.ts, orders.service.ts, orders.spec.ts)
- **Owns:** `backend/libs/core/src/modules/orders/orders.internals.ts`, `backend/libs/core/src/modules/orders/orders.service.ts`, `backend/libs/core/src/modules/orders/orders.spec.ts`, `frontend/retailer-app/app/index.tsx`, `frontend/retailer-app/app/order.tsx`, `frontend/retailer-app/app/orders/[id].tsx`, `frontend/retailer-app/src/strings.ts`
- **Prove on:** web, android
- **Test plan:**
  - DOS-098: orders.spec 'DOS-098: repeatLast copies the shop's newest order by created_at even when an older order has a higher id' fails today, passes after; walking web and Android, 'Order again' shows the SO-0885 basket and sales_orders gains no row until Place order.

### L08 · `b2-08-docint-review-pod-url` — P1 · READY NOW

- **DOS-031** (P1 reliability, S, no design): "Start reviewing" on an already-reviewed document throws an unhandled error and…
- **DOS-123** (P2 bug, S, no design): Retailer bill screen: the proof-of-delivery photo never loads on the web; the…
- **Depends on:** none
- **Owns:** `backend/libs/database/src/seed-demo/delivery.ts`, `frontend/manager-app/app/inbound/documents.tsx`, `frontend/manager-app/src/lib/ui.tsx`, `frontend/manager-app/src/strings.ts`, `frontend/retailer-app/app/bills/[id].tsx`, `frontend/retailer-app/src/config.ts`
- **Prove on:** web, android
- **Test plan:**
  - DOS-031: Red: open GUR/26-27/00490 (Reviewed) on the manager web dev build; Start reviewing is enabled and returns 409. Green: the button is disabled with its reason unless status is extracted or needs_review, no #error-overlay appears, and Book, the tabs and Close stay clickable. Back it with a pure status-gate unit test in manager-app src/lib, then repeat the walk on Android.
  - DOS-123: Extend document-urls.test.ts to Img sources built from readUrl: it fails on retailer bills/[id].tsx:301 today and passes after absoluteUrl(). Web walk of INV/0830 as retailer shows the POD image loading from the service origin (naturalWidth>0). A seeded demo bill shows 'no photo', not a broken image.

### L09 · `b2-09-support-access-owner` — P1 · READY NOW

- **DOS-108** (P1 bug, M, no design): The owner app never shows the "Support access" tab, so no owner can approve or…
- **DOS-110** (P2 business-logic, M, no design): A request the console calls "Lapsed" is still "requested" to the owner's…
- **Depends on:** H6 (file: support.service.ts)
- **Owns:** `backend/libs/core/src/modules/platform-admin/support-grants.ts`, `backend/libs/core/src/modules/platform-admin/support.service.ts`, `backend/libs/core/src/modules/tenancy/support.service.ts`, `backend/libs/core/src/modules/tenancy/support.spec.ts`, `frontend/admin-app/app/index.tsx`, `frontend/admin-app/app/support.tsx`, `frontend/admin-app/src/lib/ui.tsx`, `frontend/owner-app/app/_layout.tsx`, `frontend/owner-app/app/settings/index.tsx`, `frontend/owner-app/src/nav.ts`, `frontend/owner-app/src/strings.ts`
- **Prove on:** web, android
- **Test plan:**
  - DOS-108: Owner walker at 1280 and 390 widths. Today Settings has no reachable Support access view. After the fix it lists a waiting request with its reason, Approve (hours capped at the ask) and Refuse, and approving makes the console show the window open.
  - DOS-110: Red-then-green in tenancy support.spec.ts and platform-admin.spec.ts: an ask whose requestedAt + requestedHours has passed lists as 'requested' on both services today. After the fix it lists as lapsed, is excluded from status=requested and openOnly, and owner approve still returns 409 request_expired.

### L10 · `b2-10-sync-pull-storm` — P1 · READY NOW

- **DOS-080** (P1 performance, L, no design): Sync pull storm: hundreds of /sync/pull calls per sign-in and ~55 per screen…
- **Depends on:** H3 (file: docs/27-offline-sync-client.md)
- **Owns:** `backend/libs/core/src/modules/sync/sync.registry.ts`, `backend/libs/core/src/modules/sync/sync.service.ts`, `backend/libs/core/src/modules/sync/sync.spec.ts`, `backend/libs/database/src/sync-tables.ts`, `docs/27-offline-sync-client.md`, `frontend/libs/offline/src/engine.test.ts`, `frontend/libs/offline/src/engine.ts`
- **Prove on:** web, android
- **Test plan:**
  - DOS-080: sync.spec.ts: a salesperson read set of ~1,000 rows written in a few-ms burst, pulled from no cursor with limit 500, is red today (hundreds of calls of ~22 rows each) and green when it completes in about ceil(rows/500)+1 calls with no row skipped.

### L11 · `b2-11-amount-fields` — P1 · READY NOW

- **DOS-146** (P1 bug, S, architect-design): Trip-start 'Cash handed to you' cannot hold any amount except the planned…
- **DOS-124** (P2 ux, S, no design): Money due → 'Pay this bill' → 'Start the payment' forgets the bill: the Pay…
- **DOS-154** (P3 ux, S, no design): Retailer Pay screen: ticking bills disables the amount field but it keeps…
- **Depends on:** L07 (file: strings.ts); L08 (file: [id].tsx)
- **Owns:** `frontend/delivery-app/app/day.tsx`, `frontend/delivery-app/app/trip/start.tsx`, `frontend/delivery-app/src/lib/trip-choice.test.ts`, `frontend/libs/ui/src/native/money.tsx`, `frontend/retailer-app/app/bills/[id].tsx`, `frontend/retailer-app/app/dues.tsx`, `frontend/retailer-app/app/pay.tsx`, `frontend/retailer-app/src/strings.ts`
- **Prove on:** web, android, ios
- **Test plan:**
  - DOS-146: Android Pixel_7: TRIP-NEXT, Cash handed to you, Clear, type 4756, Done. The field shows ₹4,756.00 and trips.start sends openingCashPaise 475600 (today ₹3,000 or ₹3,00,04,756). A delivery-app vitest on the extracted value helper checks that a cleared field stays empty.
  - DOS-124: Web desk: Money due, INV/0433 Pay this bill, Start the payment. /pay?bill=<id> opens with INV/0433 ticked and ₹4,561.00; Start sends payments.initiate with invoiceIds [INV/0433] and 456100 (today nothing ticked, ₹35,843). Same from bill detail r4-pay.
  - DOS-154: Pay everything, then tick INV/0433. Red: the field reads ₹35,843.00 with 'Leave it as it is…'. Green: it reads ₹4,561.00 with a ticked-bills helper, matching the bottom bar and the intent amount.

### L12 · `b2-12-kit-modal-host` — P1 · WAITS FOR ARCHITECT (DOS-164)

- **DOS-164** (P1 bug, L, no design): iOS: a Dialog opened while a Sheet is open never appears (UIKit refuses the…
- **Depends on:** L02 (file: load-out.tsx); L05 (file: index.tsx)
- **Owns:** `frontend/libs/ui/src/native/feedback.tsx`, `frontend/libs/ui/src/parity.test.ts`, `frontend/libs/ui/src/types.ts`, `frontend/manager-app/app/fulfilment/load-out.tsx`, `frontend/manager-app/app/money/index.tsx`, `frontend/manager-app/app/orders/index.tsx`, `frontend/owner-app/app/approvals.tsx`, `frontend/owner-app/app/orders/index.tsx`
- **Prove on:** web, android, ios
- **Test plan:**
  - DOS-164: iOS simulator in Expo Go: manager opens an order Sheet with two gates and taps Approve. The decision dialog must appear and POST /approvals/{id}/decide must be sent (today: UIKit 'already presenting', 0 POST). Accountant Bank it inside a receipt Sheet must send the deposit. Page-level dialogs must still work without a relaunch. Android and web unchanged.

### L13 · `b2-13-accountant-scope` — P1 · WAITS FOR ARCHITECT (DOS-037)

- **DOS-037** (P1 security, M, no design): The accountant can adjust stock and book supplier bills (app offers it, server…
- **Depends on:** L01 (file: permissions.test.ts, permissions.ts)
- **Owns:** `backend/libs/contracts/src/permissions.test.ts`, `backend/libs/contracts/src/permissions.ts`, `backend/libs/core/src/modules/docint/docint.internals.ts`, `backend/libs/core/src/modules/inventory/stock.service.ts`, `backend/libs/core/src/modules/procurement/grn.service.ts`, `backend/libs/core/src/modules/procurement/supplier-invoice.service.ts`, `frontend/manager-app/app/stock/index.tsx`
- **Prove on:** web, android
- **Test plan:**
  - DOS-037: Red: add inventory.stock.adjust and inventory.stock.transfer, plus whichever procurement and docint writes the founder removes, to accountantMustNot in permissions.test.ts. Green after narrowing: POST /inventory/adjustments as meena.joshi returns 403, and her Stock panel and Documents panel show no write controls on web and Android.

### L14 · `b2-14-warehouse-adjust-rule` — P1 · WAITS FOR ARCHITECT (DOS-044)

- **DOS-044** (P1 business-logic, M, no design): The warehouse can create stock out of nothing: +1,00,000 pieces posted as…
- **Depends on:** L13 [WAITS lane] (file: stock.service.ts)
- **Owns:** `backend/libs/contracts/src/inventory.ts`, `backend/libs/core/src/modules/inventory/inventory.spec.ts`, `backend/libs/core/src/modules/inventory/stock.service.ts`, `frontend/warehouse-app/app/stock/index.tsx`, `frontend/warehouse-app/src/strings.ts`
- **Prove on:** web, android
- **Test plan:**
  - DOS-044: inventory.spec: a warehouse token posting +100000 'opening' through inventory.stock.adjust is refused (or parked) and the lot balance is unchanged. Red today: 200 and +100000.

### L15 · `b2-15-admin-unlock-audit-names` — P1 · WAITS FOR ARCHITECT (DOS-107, DOS-109)

- **DOS-107** (P1 missing-feature, M, no design): "Lock this login" has no undo anywhere in the product
- **DOS-109** (P1 security, M, no design): The audit trail cannot say WHO did anything: every row reads "Distribution OS…
- **Depends on:** H6 (file: permissions.ts, console.service.ts, platform-admin.spec.ts, tenants.service.ts; finding: DOS-107 needs DOS-106); L13 [WAITS lane] (file: permissions.ts)
- **Owns:** `backend/libs/contracts/src/admin.ts`, `backend/libs/contracts/src/permissions.ts`, `backend/libs/core/src/modules/platform-admin/console.service.ts`, `backend/libs/core/src/modules/platform-admin/platform-admin.controller.ts`, `backend/libs/core/src/modules/platform-admin/platform-admin.spec.ts`, `backend/libs/core/src/modules/platform-admin/tenants.service.ts`, `frontend/admin-app/app/audit.tsx`, `frontend/admin-app/app/users.tsx`, `frontend/admin-app/src/strings.ts`
- **Prove on:** web, android
- **Test plan:**
  - DOS-107: Red-then-green in platform-admin.spec.ts: disable a throwaway user, then POST /admin/users/{id}/enable as super. Today there is no route; after the fix it returns 200, users.status is active, a user.enabled platform_audit row is written and the user signs in again. A support-level caller gets 403.
  - DOS-109: Red-then-green in platform-admin.spec.ts: two console accounts each act; admin.audit.list rows must carry an actorName naming each account (absent today), and an actorId or action filter returns only that staffer's rows. Walker: the Audit Who column shows the name, the reason and before→after.

## P2 lanes

### L16 · `b2-16-order-register-columns` — P2 · READY NOW

- **DOS-027** (P2 bug, M, no design): Orders "Waiting on" column is blank for an order with two pending approvals
- **DOS-010** (P2 ux, S, no design): At phone width the Orders list drops the shop name
- **Depends on:** H5b (file: index.tsx; finding: DOS-027 needs DOS-004); L08 (file: strings.ts); L09 (file: strings.ts); L12 [WAITS lane] (file: index.tsx, index.tsx)
- **Owns:** `frontend/manager-app/app/billing/index.tsx`, `frontend/manager-app/app/orders/index.tsx`, `frontend/manager-app/src/strings.ts`, `frontend/owner-app/app/orders/index.tsx`, `frontend/owner-app/src/strings.ts`
- **Prove on:** web, android
- **Test plan:**
  - DOS-027: Red: a pure helper test mapping pending approvals (by orderId, plus shop-level credit_limit by retailer) to 'Waiting on' labels. Green: the manager and owner web registers show 'Below floor · Credit limit' on SO-0449 (Sai) and blank once both are decided; repeat on Android.
  - DOS-010: At 390x844 on web and on the Pixel 7, owner Orders rows read 'SO-0689 · <shop>' with state and value (today there is no shop), and so do the manager's Confirmed orders and Billing desk rows. Red before, green after.

### L17 · `b2-17-audit-and-replay` — P2 · READY NOW

- **DOS-028** (P2 tech-debt, M, no design): Manager actions leave no audit trail (confirm, implicit approvals)
- **DOS-160** (P2 tech-debt, M, architect-design): An idempotent replay is re-validated against the newer contract, so any…
- **Depends on:** H3 (file: bootstrap.ts); L07 (file: orders.service.ts, orders.spec.ts)
- **Owns:** `backend/libs/core/src/modules/orders/approvals.service.ts`, `backend/libs/core/src/modules/orders/orders.service.ts`, `backend/libs/core/src/modules/orders/orders.spec.ts`, `backend/libs/core/src/platform/audit.ts`, `backend/libs/core/src/platform/idempotency.ts`, `backend/libs/core/src/service/bootstrap.ts`, `backend/tools/smoke-endpoints.mts`, `frontend/owner-app/app/settings/audit.tsx`
- **Prove on:** web
- **Test plan:**
  - DOS-028: Red in orders.spec: after a manager decides both approvals of a held order (the last one confirms it), audit_log has zero rows for the tenant. Green: one approval decision row per approval plus an order.confirm row, each with the manager's actor id and before/after state. The owner web Settings › Audit lists them.
  - DOS-160: DB-backed spec next to orders.spec.ts:303 'replays create with the same key': strip one required output field from the stored idempotency_keys.response, then replay the same key and payload. Today that answers 500 'Output validation failed' (red); after the fix it answers 200 with the stored order id (green).

### L18 · `b2-18-offline-retry-counts` — P2 · READY NOW

- **DOS-046** (P2 reliability, M, no design): "Try it again" on a refused change replays the same stored rejection forever
- **DOS-053** (P3 ux, M, no design): Settings and the attention strip disagree with themselves
- **Depends on:** L10 (file: docs/27-offline-sync-client.md, engine.test.ts, engine.ts)
- **Owns:** `docs/27-offline-sync-client.md`, `frontend/libs/offline/src/connection.ts`, `frontend/libs/offline/src/engine.test.ts`, `frontend/libs/offline/src/engine.ts`, `frontend/libs/offline/src/react.tsx`, `frontend/manager-app/app/settings.tsx`, `frontend/warehouse-app/app/pick/attention.tsx`, `frontend/warehouse-app/app/settings.tsx`
- **Prove on:** web, android
- **Test plan:**
  - DOS-046: engine.test.ts: flip the 'SAME opId' retry case (:481). Once the rejection's cause is gone, a retry uploads a new opId and is accepted, and the old pulled sync_error does not come back. Red today: the old opId is replayed with the stored rejection.
  - DOS-053: engine.test.ts: with one outbox rejection and one server-pulled sync_error, status.rejected equals needsAttention().length (red today). Walk: Signed-in devices reads like 'Browser on Mac', not a User-Agent string.

### L19 · `b2-19-kit-sheet-footer-keyboard` — P2 · WAITS FOR ARCHITECT (indirect: needs the DOS-164 design)

- **DOS-152** (P2 bug, M, no design): Android W5 Short sheet: the Short (save) button and the pad's last row sit…
- **DOS-159** (P3 ux, M, no design): Android credit-note Sheet: after typing a bill number the matching bill row…
- **Depends on:** L12 [WAITS lane] (file: feedback.tsx; finding: DOS-152 needs DOS-164; finding: DOS-159 needs DOS-164)
- **Owns:** `frontend/libs/ui/src/native/feedback.tsx`, `frontend/warehouse-app/app/pick/[id].tsx`
- **Prove on:** android, ios
- **Test plan:**
  - DOS-152: uiautomator on Pixel_7_API_36: open the W5 Short sheet on a lot row. The Short button must be inside the ScrollView viewport, or a slow drag must scroll to it, and tapping Short saves. Today Short's top is at 2293 against a 2075 viewport, slow drags do not scroll, and the tap lands on Close.
  - DOS-159: Credit notes, Draft, type INV/0634 with Gboard open. Red: the suggestion row is laid out under the keyboard and a tap opens Clipboard. Green: the row sits above the keyboard and a tap picks the bill. Recheck the last line's decimal pad with its red error.

### L20 · `b2-20-kit-small-fixes` — P2 · READY NOW

- **DOS-157** (P2 ux, S, no design): Android Load-out: the 'Not out of the godown yet' row collapses its status chip…
- **DOS-122** (P3 ux, S, no design): The irreversible load-out confirm dialog puts 'Send the vehicle out' and…
- **DOS-162** (P3 bug, S, no design): Cancelling the iOS print dialog raises an uncaught PrintIncompleteException…
- **Depends on:** L12 [WAITS lane] (file: parity.test.ts)
- **Owns:** `frontend/libs/ui/src/native/list.tsx`, `frontend/libs/ui/src/parity.test.ts`, `frontend/libs/ui/src/platform/documents.native.test.ts`, `frontend/libs/ui/src/platform/documents.native.ts`, `frontend/libs/ui/src/platform/types.ts`, `frontend/libs/ui/src/tokens.ts`, `frontend/libs/ui/src/web/feedback.tsx`, `frontend/libs/ui/src/web/render.test.tsx`, `frontend/libs/ui/src/web/viewport.ts`
- **Prove on:** web, android, ios
- **Test plan:**
  - DOS-157: Pixel_7 M7 Load-out waiting row: uiautomator content-desc reads '13 Sep, ￼, 1375 rupees' with a '…' chip (red), then 'Waiting for your approval' (green). Add a kit source-reading spec that ListRow never puts a ReactNode secondary inside a numberOfLines Txt.
  - DOS-122: render.test.tsx: a web Dialog under the floor theme at phone width renders confirm and cancel stacked full-width at min-height 76px (red: size='desk', 32px), then web warehouse 390x844 measures 'Send the vehicle out' at 76 px or more.
  - DOS-162: documents.native.test with expo-print's printAsync mocked to reject PrintIncompleteException. Red: documents.print rejects. Green: it resolves while other errors still reject. Then on the iOS simulator, Print then Cancel shows no red toast.

### L21 · `b2-21-stop-screen-refresh` — P2 · READY NOW

- **DOS-063** (P2 bug, S, no design): The stop screen does not refresh after recording a delivery or a payment
- **DOS-149** (P3 ux, M, no design): Stop screen stays stale for ~40 s after a successful delivery, still offering…
- **Depends on:** L18 (file: engine.ts, react.tsx)
- **Owns:** `frontend/delivery-app/app/stop/[id]/collect.tsx`, `frontend/delivery-app/app/stop/[id]/deliver.tsx`, `frontend/delivery-app/app/stop/[id]/index.tsx`, `frontend/delivery-app/src/lib/local.ts`, `frontend/libs/offline/src/engine.ts`, `frontend/libs/offline/src/react.tsx`
- **Prove on:** web, android, ios
- **Test plan:**
  - DOS-063: Web Playwright walk fails first: record a delivery on stop 4 and the stop screen must read 'Delivered' with no reload; take money and 'Owes' must drop to ₹67,372 with no reload. Then the same on Android stop 7.
  - DOS-149: On the Pixel 7, part-deliver Meghana. Red: the stop screen still reads 'Not started · Deliver this bill' for about 40 s and shows no toast. Green: it reads 'Part delivered', the new dues and 'This stop is finished' at once, with the credit-note toast on the stop screen.

### L22 · `b2-22-collect-and-papers` — P2 · READY NOW

- **DOS-062** (P2 ux, M, no design): Money taken "for this bill" is booked against June's bill, the screen never…
- **DOS-065** (P2 ux, S, no design): The driver's inbox and the "Send the papers" screen list every shop's messages…
- **Depends on:** L21 (file: collect.tsx, local.ts)
- **Owns:** `frontend/delivery-app/app/settings.tsx`, `frontend/delivery-app/app/share/[invoiceId].tsx`, `frontend/delivery-app/app/stop/[id]/collect.tsx`, `frontend/delivery-app/src/lib/local.ts`, `frontend/delivery-app/src/lib/queue.ts`, `frontend/delivery-app/src/strings.ts`
- **Prove on:** web, android
- **Test plan:**
  - DOS-062: A delivery-app vitest for a pure helper fails first: given a RecordCollectionOutput whose invoices[] pays INV/0099 and leaves INV/0825 open, it yields 'applied to INV/0099 … INV/0825 still open', tagging a bill sends allocations:[{invoiceId}], and paid bills drop out of 'Owed on the bills here'. Then the web and Android walks on stops 4 and 7.
  - DOS-065: Web walk as ganesh.more fails first (d-39 lists 20 shop SMS). After the fix: the Me inbox request carries mine=true and lists only rows with recipientUserId = self; the D9 receipts request carries tripId and lists only this trip's receipt; older messages sit behind a fold. Recheck on Android.

### L23 · `b2-23-door-quantities-reasons` — P2 · READY NOW

- **DOS-064** (P2 ux, M, no design): Quantities move by whole cases only; a line under one case can only go to zero;…
- **DOS-070** (P3 ux, S, no design): "Where you were is attached as proof" while the browser has no location: the…
- **DOS-163** (P3 ux, S, no design): iOS delivery return reasons: the three-segment control overflows the line card…
- **Depends on:** L22 (file: strings.ts)
- **Owns:** `frontend/delivery-app/app/_layout.tsx`, `frontend/delivery-app/app/stop/[id]/deliver.tsx`, `frontend/delivery-app/src/strings.ts`, `frontend/manager-app/app/billing/credit-notes.tsx`, `frontend/warehouse-app/app/pack/[orderId].tsx`
- **Prove on:** web, android, ios
- **Test plan:**
  - DOS-064: A delivery-app vitest fails first: a pieces entry of 70 on a 75 pc line with a 24 pc case gives deliveredQtyPcs 70 and returnedQtyPcs 5 (via parsePieces), and a 5 pc line taken to zero reads 'Nothing dropped', not 'Not ordered'. Then walk INV/0825 and INV/0826 on web and Android.
  - DOS-070: Web walk with geolocation denied fails first (d-01 plus api-01 claim 'Where you were'): record a delivery on a stop whose arrival carries coordinates, and the screen must say what the position is (arrival position with its time) or send no geo line, with podKinds in the request matching. Repeat on Android with location refused.
  - DOS-163: On the iPhone 16 Pro simulator, go to TRIP-NEXT stop 4, Deliver this bill, Campa Cola 'One case less'. Run `node QA/tools/ios-drive.mjs labels`. Red today: the 'Past its date' rect ends at x 423 on a 402-pt screen. Green: all three reason rects sit inside the line card, and `tap 'Past its date'` changes the d4-disposition caption to 'Into the damaged / expiry bin'. Repeat on the Pixel 7 and on web at 375 px.

### L24 · `b2-24-delivery-refusal-history` — P2 · READY NOW

- **DOS-148** (P2 ux, M, no design): Delivering a bill whose order was never dispatched fails only after the photo,…
- **DOS-067** (P2 bug, M, no design): Trip history says "Delivered on the first attempt 0%" for a driver with 104 of…
- **Depends on:** L06 (file: deliveries.service.ts); L08 (file: delivery.ts); L23 (file: deliver.tsx, strings.ts)
- **Owns:** `backend/libs/core/src/modules/delivery/deliveries.service.ts`, `backend/libs/core/src/modules/delivery/delivery.spec.ts`, `backend/libs/core/src/modules/delivery/performance.ts`, `backend/libs/core/src/modules/reporting/registers.service.ts`, `backend/libs/core/src/modules/reporting/reporting.spec.ts`, `backend/libs/database/src/seed-demo/delivery.ts`, `frontend/delivery-app/app/stop/[id]/deliver.tsx`, `frontend/delivery-app/app/stop/[id]/index.tsx`, `frontend/delivery-app/app/trips.tsx`, `frontend/delivery-app/src/lib/local.ts`, `frontend/delivery-app/src/strings.ts`
- **Prove on:** web, android
- **Test plan:**
  - DOS-148: delivery.spec.ts: deliveries.record for a bill whose order is still packed is refused before any write, with a driver sentence instead of 'cannot apply "deliver_partial"'. Android D3/D4: the sentence or a disabled Deliver shows before the photo step.
  - DOS-067: reporting.spec.ts fails first: a driver with two stops completed before their ETA and one with no ETA gets onTimeRate 1 (the no-ETA stop is not counted late), and the D11 KPI is labelled as on-time. Then a web walk shows TRIP-NEXT (14 Sep) in the D11 list.

### L25 · `b2-25-native-offline-hint` — P2 · READY NOW

- **DOS-068** (P2 ux, M, no design): On the phone the app never says it is offline; reads fail with "unknown"
- **Depends on:** H3 (file: errors.ts; finding: DOS-068 needs DOS-056); L24 (file: trips.tsx)
- **Owns:** `frontend/delivery-app/app/_layout.tsx`, `frontend/delivery-app/app/trips.tsx`, `frontend/delivery-app/package.json`, `frontend/delivery-app/src/lib/ui.tsx`, `frontend/libs/api-client/src/errors.ts`, `frontend/libs/offline/src/engine.ts`, `frontend/libs/offline/src/react.tsx`, `frontend/pnpm-workspace.yaml`
- **Prove on:** web, android, ios
- **Test plan:**
  - DOS-068: An offline engine vitest fails first: a native network source reporting down makes status.online false so the strip reads 'Offline since', and a read that fails with Expo FetchError renders d.noConnectionRead, not 'unknown'. Then Android airplane-mode and API-cut walks (a-34, a-39).

### L26 · `b2-26-order-entry-layout` — P2 · READY NOW

- **DOS-128** (P2 ux, M, no design): Sales web app at phone width: catalog rows clip the item name to 4–5 letters
- **DOS-147** (P2 ux, S, no design): Android order entry: with the stock chip shown, item names and pack sizes are…
- **DOS-129** (P3 ux, S, no design): Order footer counts cases with the first line's case size
- **Depends on:** H4a (file: new.tsx)
- **Owns:** `frontend/sales-app/app/orders/new.tsx`, `frontend/sales-app/src/order-entry-layout.test.ts`, `frontend/sales-app/src/strings.ts`
- **Prove on:** web, android
- **Test plan:**
  - DOS-128: Measure the first six catalog rows at 390x844 on the web sales app: the name column is at least about 150 px wide and 'brand · N pc case' is unclipped (today 32-56 px), and the 1280 px desk layout is unchanged. Add a source assertion to order-entry-layout.test.ts.
  - DOS-147: uiautomator on Pixel_7_API_36 with the '18 cs available' chip shown: the Neelam and Campa rows show the full variant name and 'brand · N pc case' unclipped, with a name column well above today's 70-80 dp.
  - DOS-129: Vitest unit test on a summary helper extracted under sales-app/src: 2 cs of a 24-pc case plus 1 cs of a 48-pc case reads '3 cs' (red: '4 cs'), and 21 mixed single-case lines read '21 cs'.

### L27 · `b2-27-order-entry-footer-pieces` — P2 · READY NOW

- **DOS-161** (P2 ux, M, no design): iOS sales order entry: the fixed header and footer leave a 267-pt scroll…
- **DOS-085** (P2 ux, M, no design): Quantity entry: no keypad, pieces only go up, and "one case less" at 0 cs…
- **Depends on:** L11 (file: money.tsx); L23 (file: credit-notes.tsx); L26 (file: new.tsx, order-entry-layout.test.ts, strings.ts)
- **Owns:** `frontend/libs/ui/src/native/money.tsx`, `frontend/libs/ui/src/qty.test.ts`, `frontend/libs/ui/src/qty.ts`, `frontend/libs/ui/src/web/money.tsx`, `frontend/manager-app/app/billing/credit-notes.tsx`, `frontend/sales-app/app/orders/new.tsx`, `frontend/sales-app/src/order-entry-layout.test.ts`, `frontend/sales-app/src/strings.ts`
- **Prove on:** web, android, ios
- **Test plan:**
  - DOS-161: Source-reading spec in order-entry-layout.test.ts: the phone bottomBar of new.tsx is a single compact row, not the 3-line Stack plus before-GST hint (red today). Then on the iPhone 16 Pro simulator the scroll window is well over 267 pt and 19 taps on 'One case more' give 19 cs.
  - DOS-085: vitest: 18 pcs with case size 24 plus 'one case less' is red today (stepByCase gives 0 and the line is removed) and green when it asks first; a pieces sheet parsing '18' with parsePieces sets 18 pcs, and a piece-minus exists.

### L28 · `b2-28-owner-refusals-results` — P2 · READY NOW

- **DOS-012** (P2 ux, S, no design): "Cancel bill" is offered on a paid, delivered bill; the server refuses and the…
- **DOS-008** (P3 bug, S, no design): "Open bill" keeps saying "being prepared" after the PDF is ready, until the…
- **DOS-015** (P3 bug, S, no design): "Rebuild ageing" does nothing
- **Depends on:** H1b (file: index.tsx; finding: DOS-015 needs DOS-007); L16 (file: index.tsx, strings.ts)
- **Owns:** `frontend/manager-app/src/lib/ui.tsx`, `frontend/owner-app/app/billing/index.tsx`, `frontend/owner-app/app/money/index.tsx`, `frontend/owner-app/app/orders/index.tsx`, `frontend/owner-app/src/lib/ui.tsx`, `frontend/owner-app/src/strings.ts`
- **Prove on:** web, android
- **Test plan:**
  - DOS-012: On owner web: Billing → INV/0817 (paid, delivered) → Cancel bill → confirm. Today the dialog closes silently; after, it stays open with the server's 409 sentence, and the order panel's disabled Confirm and Cancel say why. Repeat on Android.
  - DOS-008: Bill with no pdf_object_key, worker running: press Open bill once. 'Being prepared' shows, then with no reload the panel re-asks GET /invoices/{id}/pdf until status is ready and opens or offers the PDF. Red on main: the message stays until a reload.
  - DOS-015: Money, Rebuild ageing, confirm: the network shows POST /receivables/ageing/rebuild 200, the screen states the result from RebuildAgeingOutput (as-of date, shops, overdue) or the server's refusal, and the ladder refetches. Red on main: the dialog shows only '2026-09-12' and closes with no message.

### L29 · `b2-29-rep-price-diff-beat` — P2 · READY NOW

- **DOS-082** (P2 business-logic, M, no design): A price changed by the office lands silently: the rep quoted ₹1,877.76, the…
- **DOS-084** (P2 ux, S, no design): "Today's beat" is not today's beat: the home opens on Station Road every day
- **Depends on:** L27 (file: new.tsx, strings.ts)
- **Owns:** `frontend/sales-app/app/index.tsx`, `frontend/sales-app/app/orders/new.tsx`, `frontend/sales-app/src/lib/dates.ts`, `frontend/sales-app/src/lib/local.ts`, `frontend/sales-app/src/lib/pricing.ts`, `frontend/sales-app/src/strings.ts`
- **Prove on:** web, android, ios
- **Test plan:**
  - DOS-082: sales-app vitest: a helper compares device quote lines with the orders.create reply (Neelam Neem Soap 26.08 on the device, 27.50 from the server). Red today (no diff); green when it names '26.08 → 27.50' before submit is sent.
  - DOS-084: sales-app vitest on a beat-for-day picker: Station Road [1,4], Kalyan West Market [2,5], Khadakpada [3,6] on IST Saturday 2026-09-12 is red today (Station Road) and green (Khadakpada); a manual chip choice sticks for that IST day.

### L30 · `b2-30-rep-offline-submit` — P2 · READY NOW

- **DOS-086** (P2 ux, M, no design): Offline orders park as drafts the rep must remember to submit by hand
- **DOS-142** (P3 ux, S, no design): The manager's cancellation reason never reaches the rep's order screen,…
- **DOS-092** (P3 ux, S, no design): Cancel dialog offers "Cancel" and "Cancel order"
- **Depends on:** L16 (file: strings.ts); L25 (file: engine.ts); L29 (file: index.tsx, new.tsx, local.ts, strings.ts)
- **Owns:** `frontend/libs/offline/src/engine.ts`, `frontend/manager-app/src/strings.ts`, `frontend/sales-app/app/index.tsx`, `frontend/sales-app/app/orders/[id].tsx`, `frontend/sales-app/app/orders/index.tsx`, `frontend/sales-app/app/orders/new.tsx`, `frontend/sales-app/src/lib/local.ts`, `frontend/sales-app/src/lib/queue.ts`, `frontend/sales-app/src/strings.ts`
- **Prove on:** web, android, ios
- **Test plan:**
  - DOS-086: Web offline walk (setOffline), place, reconnect: red today (draft with no number until 'Submit order' in My orders); green when the accepted upload triggers orders.submit with key `${id}:submit` and an SO number appears untouched. Plus an engine.test.ts case for the accepted-op signal.
  - DOS-142: Manager cancels an SO with a reason. After the rep's next pull, the sales SO screen shows the reason under Cancelled (red: state chip only), and on Android it still shows offline after that pull.
  - DOS-092: On sales :5175, open a submitted order and press 'Cancel this order'. The dialog buttons must read 'Keep it' / 'Cancel the order'. Confirming with an empty reason shows a 'say why' line and sends no POST /orders/{id}/cancel; with a reason it answers 200 and the order is cancelled. Repeat on Pixel 7. Today the buttons read 'Cancel' / 'Cancel order' and an empty reason is a silent no-op.

### L31 · `b2-31-shop-pieces-short-pick` — P2 · READY NOW

- **DOS-101** (P2 missing-feature, M, no design): The shop can order only whole cases: no pieces, so "Only 9 pc left" items…
- **DOS-144** (P3 ux, M, no design): After a short pick the shop's order page still says 'You pay Rs 6,753.00' and…
- **Depends on:** L27 (file: credit-notes.tsx)
- **Owns:** `frontend/manager-app/app/billing/credit-notes.tsx`, `frontend/retailer-app/app/order.tsx`, `frontend/retailer-app/app/orders/[id].tsx`, `frontend/retailer-app/src/strings.ts`
- **Prove on:** web, android
- **Test plan:**
  - DOS-101: Walk R7 on web and Android. Today the UHT Milk row has no pieces control. After the fix, open pieces entry, type 9, place, and the DB line reads 9 pc with enteredUnit piece; the existing qty.test.ts parsePieces specs stay green.
  - DOS-144: Red: SO-0903 (60 pc ordered, 6 short, INV/9010) shows '60 pc' and 'You pay Rs 6,753.00'. Green: the line reads 54 of 60 with 6 short and not billed, and the bar shows INV/9010's amount due with a link to the bill.

### L32 · `b2-32-support-audit-path-ids` — P2 · READY NOW

- **DOS-111** (P2 security, M, no design): The distributor never learns what support read under the window it approved
- **DOS-112** (P2 tech-debt, M, no design): Per-record mutations ignore the `{id}` in the path and act on the body `id`,…
- **Depends on:** L15 [WAITS lane] (file: console.service.ts, platform-admin.spec.ts, tenants.service.ts); L17 (file: bootstrap.ts, audit.tsx); L28 (file: ui.tsx, strings.ts)
- **Owns:** `backend/libs/core/src/docs/readme.ts`, `backend/libs/core/src/modules/platform-admin/console.service.ts`, `backend/libs/core/src/modules/platform-admin/platform-admin.spec.ts`, `backend/libs/core/src/modules/platform-admin/tenants.service.ts`, `backend/libs/core/src/modules/tenancy/support.spec.ts`, `backend/libs/core/src/modules/tenancy/tenant.guard.ts`, `backend/libs/core/src/service/bootstrap.ts`, `backend/libs/core/src/service/support-audit.interceptor.ts`, `backend/libs/core/src/testing/app.ts`, `frontend/owner-app/app/settings/audit.tsx`, `frontend/owner-app/app/settings/index.tsx`, `frontend/owner-app/src/lib/ui.tsx`, `frontend/owner-app/src/strings.ts`
- **Prove on:** web, android
- **Test plan:**
  - DOS-111: Red-then-green in platform-admin.spec.ts: read GET /retailers through an approved pass, then poll the tenant's audit_log. Today it has 0 support.read rows; after the fix it has one carrying the grant id, route and actor, and the owner's tenancy.audit.list filtered by the grant returns it.
  - DOS-112: Red-then-green in the specs: POST /admin/tenants/{real}/suspend with a different body id returns 500 today and must return 400 (mismatch). Path = body = a random uuid must return 404, not 500. Repeat for users.disable and tenancy.support.approve.

### L33 · `b2-33-owner-charts-map` — P2 · READY NOW

- **DOS-002** (P2 bug, S, no design): Brand mix shows two different "Other" slices and hides the 4th and 5th brands…
- **DOS-017** (P2 missing-feature, M, no design): "Live map" has no map
- **Depends on:** L20 (file: tokens.ts); L32 (file: strings.ts)
- **Owns:** `frontend/libs/ui/src/charts/geometry.test.ts`, `frontend/libs/ui/src/charts/geometry.ts`, `frontend/libs/ui/src/tokens.ts`, `frontend/owner-app/app.json`, `frontend/owner-app/app/index.tsx`, `frontend/owner-app/app/map.tsx`, `frontend/owner-app/app/reports/index.tsx`, `frontend/owner-app/package.json`, `frontend/owner-app/src/strings.ts`
- **Prove on:** web, android, ios
- **Test plan:**
  - DOS-002: geometry.test.ts › 'mixSegments never makes a second Other: brands plus the API's other group give exactly one Other segment' fails today (two Others) and passes after; the owner's Today and Reports brand mix read Campa, Sunbake, Godavari, Neelam and one Other on web and Android.
  - DOS-017: On owner web, Today → Live map today shows only the register under 'Map tiles arrive with the MapView component'; after the fix a MapLibre map draws one labelled pin per vehicle from delivery.vehicles.positions above the register. Android and iOS builds show pins, or the kit's list fallback where the native engine or key is missing.

### L34 · `b2-34-billing-desk-queue` — P2 · READY NOW

- **DOS-022** (P2 ux, M, no design): "9 left to bill" counts orders that cannot be billed; the one order that needs…
- **DOS-145** (P3 ux, M, no design): The manager cannot open a given bill from search: global search lands on…
- **DOS-026** (P2 bug, S, no design): "Print the challan" does nothing visible
- **Depends on:** L30 (file: strings.ts)
- **Owns:** `backend/libs/core/src/modules/billing/billing.spec.ts`, `backend/libs/core/src/modules/billing/invoices.service.ts`, `frontend/manager-app/app/_layout.tsx`, `frontend/manager-app/app/billing/index.tsx`, `frontend/manager-app/app/fulfilment/load-out.tsx`, `frontend/manager-app/app/index.tsx`, `frontend/manager-app/app/registers/index.tsx`, `frontend/manager-app/src/strings.ts`
- **Prove on:** web, android
- **Test plan:**
  - DOS-022: Red in billing.spec: billing.invoices.queue returns confirmed and picking orders. Green: the queue lists only a packed order without a live bill (e.g. one whose bill was cancelled), and issueForPack on that pack issues a new numbered bill. Web desk: 'left to bill', the home tile and the rail badge all read 1 (SO-9001), with an Issue bill action that bills it.
  - DOS-145: billing.spec: a from/to list returns today's invoice before a 21 Aug one even when its id sorts lower (red with desc(id)). Web: global search 'INV/9014' opens /billing on Bills issued with the bill panel open.
  - DOS-026: Red: on the manager web Load-out, open a confirmed sheet whose challan PDF was never rendered and press Print the challan; nothing appears. Green: a 'being prepared' line shows, the PDF opens without a reload once the worker renders it (~40 s), and a failed call shows an error. Android opens it through documents.open.

### L35 · `b2-35-fulfilment-desk` — P2 · READY NOW

- **DOS-024** (P2 bug, S, no design): "Waiting to be picked" offers orders that are already packed and billed; the…
- **DOS-134** (P2 bug, M, no design): Manager Pick & pack cannot record a part-case pick row after DOS-041: whole…
- **Depends on:** L31 (file: credit-notes.tsx); L34 (file: strings.ts)
- **Owns:** `frontend/manager-app/app/billing/credit-notes.tsx`, `frontend/manager-app/app/fulfilment/index.tsx`, `frontend/manager-app/app/fulfilment/pack.tsx`, `frontend/manager-app/src/strings.ts`, `frontend/warehouse-app/app/pick/index.tsx`
- **Prove on:** web, android
- **Test plan:**
  - DOS-024: Red: the manager web Fulfilment → Waves queue lists SO-0845, SO-0850 and SO-9001 (packed). Green: only confirmed orders not on a live sheet are listed, a confirmed order still waves, and a stale-row 409 shows in the wave Refusal. Repeat on Android.
  - DOS-134: Manager web, desk and phone, on a FEFO-split sheet (rows asking 6 and 18 pc): enter 6 pc through the pieces entry and Record pick. Expect 200 and picked_qty_pcs = 6; today only 0 or 24 can be entered and the save is a 400.

### L36 · `b2-36-manager-money-panels` — P2 · READY NOW

- **DOS-033** (P2 bug, S, no design): A receipt shows the bill it settled as a UUID
- **DOS-136** (P2 bug, M, no design): After a lost reply, pressing Bank it again says 'idempotencyKey was already…
- **Depends on:** L35 (file: credit-notes.tsx)
- **Owns:** `frontend/libs/api-client/src/errors.ts`, `frontend/libs/api-client/src/react/index.tsx`, `frontend/libs/api-client/src/react/refusal.test.ts`, `frontend/manager-app/app/billing/credit-notes.tsx`, `frontend/manager-app/app/inbound/documents.tsx`, `frontend/manager-app/app/money/day-end.tsx`, `frontend/manager-app/app/money/index.tsx`, `frontend/owner-app/app/money/receipts.tsx`
- **Prove on:** web, android
- **Test plan:**
  - DOS-033: Red: the manager web Money receipt panel for Patil's RCPT-0696 shows 'f2863866-…' under Put against. Green: it shows 'OPEN/0005 — ₹9,182.00', also for a FIFO receipt spread over several bills. Repeat on Android.
  - DOS-136: Playwright on the manager desk: press Bank it with the reply aborted by page.route, then press again. Expect a 200 replay and the panel showing Banked; today the second press gets 409 'idempotencyKey was already used with a different request' and the panel still says Collected. Repeat for Day-end and the owner's receipts.

### L37 · `b2-37-manager-shop-panel` — P2 · READY NOW

- **DOS-035** (P2 bug, S, no design): Shop panel prints the overdue amount in raw paise
- **DOS-036** (P2 ux, S, no design): The shop's "Statement of account" shows a running balance in the amount column…
- **DOS-038** (P2 bug, S, no design): On a phone the Shops list has no shop names
- **Depends on:** L28 (file: ui.tsx); L35 (file: strings.ts)
- **Owns:** `frontend/manager-app/app/index.tsx`, `frontend/manager-app/app/shops/index.tsx`, `frontend/manager-app/src/lib/load-out.test.ts`, `frontend/manager-app/src/lib/ui.tsx`, `frontend/manager-app/src/strings.ts`, `frontend/owner-app/app/shops/index.tsx`
- **Prove on:** web, android, ios
- **Test plan:**
  - DOS-035: Red: Shops → Patil General Store reads '6042250 overdue' as vikas.kadam and meena.joshi. Green: it reads '₹60,422.50 overdue' for both on web and Android.
  - DOS-036: Red: Patil's Statement of account shows 'INV/0037 ₹17,197.00' with no opening row. Green: the first row is 'Opening balance ₹9,182.00', then INV/0037 debit ₹8,015.00 / balance ₹17,197.00 and RCPT-0040 credit ₹1,107.00 / balance ₹21,682.00, under column headers, on web and Android.
  - DOS-038: Red then green: a manager-app vitest on the Shops column set (pulled into a small pure helper, the way DOS-025 did load-out.test.ts) asserts the identity column is `name` and that neither `code` nor `limit` takes the identity or value slot. It fails today (code is identity, limit is value) and passes after the fix. Then, as vikas.kadam at web 390x844 (QA/tools/pw.mjs phone) and on the Pixel 7, the rows read 'Patil General Store' with the credit-mode chip, and tapping that text opens shop-panel.

### L38 · `b2-38-warehouse-lists-vanstock` — P2 · READY NOW

- **DOS-047** (P2 ux, S, no design): The Pick and Load lists hide the waves and sheets that need work
- **DOS-121** (P2 missing-feature, M, no design): Load-out in the warehouse app always sends countedVanStock [] and has no…
- **DOS-049** (P3 ux, S, no design): "Blind" counts show the answer on the same screen
- **Depends on:** L14 [WAITS lane] (file: strings.ts); L35 (file: index.tsx)
- **Owns:** `frontend/warehouse-app/app/load/[id].tsx`, `frontend/warehouse-app/app/load/check-in.tsx`, `frontend/warehouse-app/app/load/index.tsx`, `frontend/warehouse-app/app/pick/index.tsx`, `frontend/warehouse-app/src/strings.ts`
- **Prove on:** web, android, ios
- **Test plan:**
  - DOS-047: No app test harness, so a red-then-green walk on web and Android: the Pick tab lists PICK-0078 (picking) and PICK-0079 (open) above the finished waves, and the Load tab lists the draft sheet first.
  - DOS-121: Create and approve a sheet via the API with vanStock [{lot, 12}]. W7 shows a count for the van lot; count 12 and confirm. The request carries countedVanStock [{lotId, qtyPcs:12}] and stock_ledger gets exactly one transfer_out/transfer_in pair godown to vehicle (today countedVanStock [] and no transfer).
  - DOS-049: Walk on web and Android: an approved draft sheet shows no per-order carton figure until the crew count is keyed, and W9 shows a lot's expected pieces only after that lot is counted back. Red today.

### L39 · `b2-39-inventory-refusals-sellable` — P2 · READY NOW

- **DOS-048** (P2 ux, M, no design): Server refusals are shown verbatim with UUIDs
- **DOS-140** (P2 business-logic, M, covered-by-other): The sellable-stock API offers damaged-bin lots to reps and shops as available
- **Depends on:** H4a (file: stock.service.ts; finding: DOS-140 needs DOS-074; finding: DOS-140 needs DOS-097); L38 (file: [id].tsx)
- **Owns:** `backend/libs/core/src/modules/inventory/inventory.service.ts`, `backend/libs/core/src/modules/inventory/inventory.spec.ts`, `backend/libs/core/src/modules/inventory/stock.service.ts`, `frontend/warehouse-app/app/load/[id].tsx`, `frontend/warehouse-app/app/load/trips.tsx`, `frontend/warehouse-app/app/pack/[orderId].tsx`, `frontend/warehouse-app/app/stock/index.tsx`
- **Prove on:** web, android
- **Test plan:**
  - DOS-048: inventory.spec: a -100 adjustment on a 5-pc lot is refused with the product name, batch and location name and no UUID in the message, while data still carries lotId and locationId. Red today: raw UUID sentence.
  - DOS-140: inventory.spec.ts: a lot holding stock in a 'damaged' location is absent from inventory.stock.sellable for the salesperson and retailer roles (today listed with available 32). Van-sale's sellable call with a vehicle locationId must still return the vehicle rows.

### L40 · `b2-40-approval-credit-limit` — P2 · WAITS FOR ARCHITECT (DOS-006)

- **DOS-006** (P2 business-logic, M, no design): Approving "Over credit limit" confirms the order but never changes the limit…
- **Depends on:** H5b (file: approvals.service.ts, orders.spec.ts, index.tsx, approvals.tsx; finding: DOS-006 needs DOS-004); L16 (file: index.tsx); L17 (file: approvals.service.ts, orders.service.ts, orders.spec.ts)
- **Owns:** `backend/libs/core/src/modules/orders/approvals.service.ts`, `backend/libs/core/src/modules/orders/orders.internals.ts`, `backend/libs/core/src/modules/orders/orders.service.ts`, `backend/libs/core/src/modules/orders/orders.spec.ts`, `backend/libs/core/src/modules/retailers/retailers.service.ts`, `backend/libs/database/src/seed-demo/reporting.ts`, `frontend/manager-app/app/orders/index.tsx`, `frontend/owner-app/app/approvals.tsx`
- **Prove on:** web, android
- **Test plan:**
  - DOS-006: orders.spec: approve a credit_limit gate raised at submit. If the answer is per-order release: the order confirms, retailers.credit_limit_paise is unchanged, and the owner and manager dialogs say only this order is let through. If it is a limit change: credit_limit_paise becomes the approved figure with a retailers.setCredit audit row. seed-demo test: no credit_limit approval payload carries a requestedLimitPaise the product never acts on.

### L41 · `b2-41-names-and-sort-keys` — P2 · WAITS FOR ARCHITECT (DOS-013, DOS-009)

- **DOS-013** (P2 bug, S, no design): The Default price list shows an id ("1c3586ee") instead of "Chamak Glass…
- **DOS-009** (P2 ux, M, no design): Orders, Bills and Trips lists are in no order
- **Depends on:** H5a (file: orders.spec.ts, index.ts; finding: DOS-013 needs DOS-003); L34 (file: billing.spec.ts, invoices.service.ts); L40 [WAITS lane] (file: orders.internals.ts, orders.spec.ts)
- **Owns:** `backend/libs/contracts/src/pricing.ts`, `backend/libs/core/src/modules/billing/billing.spec.ts`, `backend/libs/core/src/modules/billing/invoices.service.ts`, `backend/libs/core/src/modules/delivery/delivery.spec.ts`, `backend/libs/core/src/modules/delivery/trips.service.ts`, `backend/libs/core/src/modules/orders/orders.internals.ts`, `backend/libs/core/src/modules/orders/orders.spec.ts`, `backend/libs/core/src/modules/pricing/pricing.service.ts`, `backend/libs/core/src/modules/pricing/pricing.spec.ts`, `backend/libs/core/src/modules/tenant-catalog/index.ts`, `backend/libs/database/src/schema/billing.ts`, `backend/libs/database/src/schema/orders.ts`, `frontend/owner-app/app/prices/index.tsx`
- **Prove on:** web, android
- **Test plan:**
  - DOS-013: pricing.spec › 'DOS-013: priceLists.list items carry variantName for an item the tenant does not list' fails today (no field) and passes after; Prices → Default Price List reads 'Chamak Glass Cleaner 500 ml 68.03' instead of '1c3586ee'.
  - DOS-009: One spec each for orders.list, billing.invoices.list and delivery.trips.list: a row with an older business date but a higher id comes after newer-dated rows, and the page-2 cursor continues with no gap or repeat. Fails today (id order), passes after; the owner's Orders, Bills and Trips read newest first on web and Android.

### L42 · `b2-42-shop-hold-rate-read` — P2 · WAITS FOR ARCHITECT (DOS-100, DOS-104)

- **DOS-100** (P2 ux, M, no design): The shop is never told its order is on credit hold, and hears nothing when the…
- **DOS-104** (P3 performance, M, no design): The price list loads 171 quotes and 500 stock rows (233 KB) on every open of…
- **Depends on:** H4a (file: order.tsx; finding: DOS-104 needs DOS-097); H4b (file: pricing.ts, quote.service.ts, order.tsx, [id].tsx, strings.ts; finding: DOS-104 needs DOS-096); L31 (file: order.tsx, [id].tsx, strings.ts); L41 [WAITS lane] (file: pricing.ts)
- **Owns:** `backend/libs/contracts/src/catalog.ts`, `backend/libs/contracts/src/notifications.ts`, `backend/libs/contracts/src/pricing.ts`, `backend/libs/core/src/modules/notifications/events.ts`, `backend/libs/core/src/modules/notifications/notifications.spec.ts`, `backend/libs/core/src/modules/orders/orders.mappers.ts`, `backend/libs/core/src/modules/pricing/quote.service.ts`, `backend/libs/core/src/modules/tenant-catalog/tenant-catalog.service.ts`, `backend/libs/database/src/seed-demo/notifications.ts`, `frontend/retailer-app/app/order.tsx`, `frontend/retailer-app/app/orders/[id].tsx`, `frontend/retailer-app/src/strings.ts`
- **Prove on:** web, android
- **Test plan:**
  - DOS-100: notifications.spec 'DOS-100: a submitted order held by an approval flag queues a shop message for the retailer' fails today (handleOrderSubmitted only pushes to back-office devices), passes after; walking R8 for a credit-held order shows the waiting sentence with the overdue amount.
  - DOS-104: Capture the network on R7 open. Today it sends a 171-line pricing.quote and a 500-row sellable page (about 233 KB); after the fix there is no whole-catalogue quote and no per-lot stock rows, plus a spec that the new rate read equals the qty-1 quote rate per variant.

### L43 · `b2-43-shop-multi-distributor-home` — P2 · WAITS FOR ARCHITECT (DOS-102)

- **DOS-102** (P2 ux, L, no design): One home for three distributors, but only the active one shows what is owed;…
- **Depends on:** L05 (file: outstanding.ts); L07 (file: index.tsx); L15 [WAITS lane] (file: permissions.ts)
- **Owns:** `backend/libs/contracts/src/auth.ts`, `backend/libs/contracts/src/permissions.ts`, `backend/libs/core/src/modules/auth/auth.controller.ts`, `backend/libs/core/src/modules/auth/auth.service.ts`, `backend/libs/core/src/modules/auth/auth.spec.ts`, `backend/libs/core/src/modules/receivables/outstanding.ts`, `frontend/retailer-app/app/index.tsx`, `frontend/retailer-app/app/sign-in.tsx`
- **Prove on:** web, android, ios
- **Test plan:**
  - DOS-102: auth.spec 'DOS-102: the memberships summary returns dues, last bill and on-the-way per membership for a three-distributor shop, and nothing for a tenant the user does not belong to' fails today (no procedure), passes after; R2 then shows three amounts and the total of 91,494.

### L44 · `b2-44-shop-contact-returns` — P2 · WAITS FOR ARCHITECT (DOS-103)

- **DOS-103** (P2 missing-feature, L, no design): No way to contact the distributor, complain or ask for a return from the app
- **Depends on:** L32 (file: index.tsx); L42 [WAITS lane] (file: notifications.ts)
- **Owns:** `backend/libs/contracts/src/notifications.ts`, `backend/libs/contracts/src/tenancy.ts`, `backend/libs/core/src/modules/notifications/inbound.service.ts`, `backend/libs/database/src/schema/notifications.ts`, `backend/libs/database/src/tenant-bootstrap.ts`, `frontend/owner-app/app/settings/index.tsx`, `frontend/retailer-app/app/bills/[id].tsx`, `frontend/retailer-app/app/returns.tsx`
- **Prove on:** web, android
- **Test plan:**
  - DOS-103: Spec 'DOS-103: a retailer's report lands in notifications.inbound.list for staff, and branding.get carries the distributor phone' fails today, passes after; walking R2/R4, tap-to-call opens the dialer and the report appears in the manager messages screen.

### L45 · `b2-45-kit-upi-qr` — P2 · WAITS FOR ARCHITECT (DOS-125)

- **DOS-125** (P2 missing-feature, L, no design): Web pay screens give a shop nothing to scan or tap: no QR image, a raw upi://…
- **Depends on:** L20 (file: types.ts); L42 [WAITS lane] (file: strings.ts)
- **Owns:** `frontend/libs/ui/src/native/charts.tsx`, `frontend/libs/ui/src/platform/links.web.ts`, `frontend/libs/ui/src/platform/types.ts`, `frontend/libs/ui/src/types.ts`, `frontend/libs/ui/src/web/charts.tsx`, `frontend/retailer-app/app/dues.tsx`, `frontend/retailer-app/app/pay.tsx`, `frontend/retailer-app/src/strings.ts`
- **Prove on:** web, android, ios
- **Test plan:**
  - DOS-125: Kit render test: the new QR component draws an SVG module grid that matches a reference encoding of a upi:// intent. Then a web walk at 1280 and 390 px: r3-qr-sheet and r5-intent show a QR, the intent string wraps inside 390 px, and the web hint is visible. Today there is no QR and the string is clipped.

### L46 · `b2-46-bill-cancel-order-state` — P2 · WAITS FOR ARCHITECT (DOS-139)

- **DOS-139** (P2 business-logic, M, no design): Cancelling a bill before dispatch returns the stock and the money but leaves…
- **Depends on:** L41 [WAITS lane] (file: billing.spec.ts, invoices.service.ts)
- **Owns:** `backend/libs/core/src/modules/billing/billing.spec.ts`, `backend/libs/core/src/modules/billing/invoices.service.ts`, `backend/libs/core/src/modules/orders/orders.service.ts`, `backend/libs/domain/src/state-machines/order.ts`, `backend/libs/domain/src/state-machines/state-machines.test.ts`
- **Prove on:** web
- **Test plan:**
  - DOS-139: billing.spec.ts: cancel a pre-dispatch pack bill. Expect the order to leave 'packed' in the same transaction (to cancelled or confirmed, per the decision) and billing.invoices.queue to stop listing it; today it stays packed and listed.

### L47 · `b2-47-cancel-after-picking` — P2 · WAITS FOR ARCHITECT (DOS-138)

- **DOS-138** (P2 missing-feature, L, no design): Once picking has started no one can cancel an order; the manager is offered…
- **Depends on:** L19 [WAITS lane] (file: [id].tsx); L28 (file: index.tsx); L46 [WAITS lane] (file: orders.service.ts, order.ts)
- **Owns:** `backend/libs/core/src/modules/orders/orders.service.ts`, `backend/libs/core/src/modules/warehouse/picklists.service.ts`, `backend/libs/database/src/schema/warehouse.ts`, `backend/libs/domain/src/state-machines/order.ts`, `frontend/manager-app/app/orders/index.tsx`, `frontend/owner-app/app/orders/index.tsx`, `frontend/warehouse-app/app/pick/[id].tsx`
- **Prove on:** web, android
- **Test plan:**
  - DOS-138: If cancel is allowed: orders.spec.ts, the manager cancels a picking order and gets 200 cancelled, reservations released and open pick lines closed (today 409 'cannot apply "cancel" in state "picking"'). If not: a manager and owner web walk shows no Cancel on a picking order and shows the route sentence instead.

### L48 · `b2-48-owner-exports` — P2 · WAITS FOR ARCHITECT (DOS-014)

- **DOS-014** (P2 ux, M, no design): "Request export" and "Export CSV" fire a fixed export with no choice and no…
- **Depends on:** L33 (file: strings.ts); L47 [WAITS lane] (file: index.tsx)
- **Owns:** `backend/libs/contracts/src/reporting.ts`, `backend/libs/core/src/modules/reporting/register-specs.ts`, `backend/libs/core/src/modules/reporting/registers.service.ts`, `backend/libs/core/src/modules/reporting/renderers.ts`, `frontend/owner-app/app/orders/index.tsx`, `frontend/owner-app/app/reports/exports.tsx`, `frontend/owner-app/src/lib/ui.tsx`, `frontend/owner-app/src/strings.ts`
- **Prove on:** web
- **Test plan:**
  - DOS-014: On owner web: Reports → Exports → Request export opens a register-and-period dialog, and the new job reads queued, then Download (today: no dialog, a fixed GST job). Orders → Export CSV produces a downloadable file (today: a silent Daily sales job). Add a reporting spec if an orders register is added.

### L49 · `b2-49-receivables-views` — P2 · WAITS FOR ARCHITECT (DOS-011, DOS-016)

- **DOS-011** (P2 missing-feature, M, no design): A receipt does not show which bills it settled or the cash discount given
- **DOS-016** (P2 business-logic, M, no design): Dashboard "Outstanding" counts ₹35,080 the business has already received on…
- **Depends on:** L36 (file: index.tsx, receipts.tsx); L43 [WAITS lane] (file: outstanding.ts); L48 [WAITS lane] (file: reporting.ts)
- **Owns:** `backend/libs/contracts/src/receivables.ts`, `backend/libs/contracts/src/reporting.ts`, `backend/libs/core/src/modules/receivables/outstanding.ts`, `backend/libs/core/src/modules/receivables/receivables.service.ts`, `backend/libs/core/src/modules/receivables/receivables.spec.ts`, `backend/libs/core/src/modules/reporting/reporting.service.ts`, `backend/libs/core/src/modules/reporting/rollup.ts`, `frontend/manager-app/app/money/index.tsx`, `frontend/owner-app/app/index.tsx`, `frontend/owner-app/app/money/index.tsx`, `frontend/owner-app/app/money/receipts.tsx`
- **Prove on:** web, android
- **Test plan:**
  - DOS-011: receivables.spec › 'DOS-011: receipts.get names the bills a receipt settled (invoice number and amount)' fails on today's ReceiptGetOutput and passes after. RCPT-0699's panel reads 'Settles INV/0824 ₹73,245.00 — ₹71,780.10 received + ₹1,464.90 cash discount' on owner web and Android, and the manager panel shows INV/0824 instead of a uuid.
  - DOS-016: reporting.spec › 'DOS-016: the owner dashboard carries on-account credit, and outstanding − onAccount equals the journal AR balance' fails today (the field is absent) and passes after; Today's Outstanding tile and the Money totals reconcile with Books → Trial balance AR ₹43,89,294 on web and Android.

### L50 · `b2-50-brand-dms-commit` — P2 · WAITS FOR ARCHITECT (DOS-030)

- **DOS-030** (P2 bug, L, no design): A brand-DMS document offers "Book it as a supplier bill", which the server will…
- **Depends on:** L36 (file: documents.tsx); L37 (file: strings.ts); L46 [WAITS lane] (file: invoices.service.ts)
- **Owns:** `backend/libs/contracts/src/billing.ts`, `backend/libs/contracts/src/docint.ts`, `backend/libs/core/src/modules/billing/invoices.service.ts`, `backend/libs/core/src/modules/docint/docint.spec.ts`, `backend/libs/core/src/modules/docint/documents.service.ts`, `frontend/manager-app/app/billing/brand-dms.tsx`, `frontend/manager-app/app/inbound/documents.tsx`, `frontend/manager-app/src/strings.ts`
- **Prove on:** web, android
- **Test plan:**
  - DOS-030: Red in docint.spec: committing a reviewed brand_dms_invoice document returns 501. Green: it lands as the founder decides (e.g. a brand_dms_import invoice with no stock rows and no counter advance, document marked committed). The web panel for FA/TY/26-27/1187 no longer offers 'Book it as a supplier bill'.

### L51 · `b2-51-count-expected` — P2 · WAITS FOR ARCHITECT (DOS-045)

- **DOS-045** (P2 business-logic, M, no design): Counts compare against a stale "expected" figure, and the expected figure is…
- **Depends on:** L39 (file: inventory.spec.ts)
- **Owns:** `backend/libs/contracts/src/inventory.ts`, `backend/libs/contracts/src/procurement.ts`, `backend/libs/core/src/modules/inventory/cycle-counts.service.ts`, `backend/libs/core/src/modules/inventory/inventory.spec.ts`, `backend/libs/core/src/modules/procurement/grn.service.ts`, `backend/libs/core/src/modules/procurement/procurement.spec.ts`, `frontend/manager-app/app/inbound/gate.tsx`, `frontend/warehouse-app/app/stock/counts/[id].tsx`
- **Prove on:** web, android
- **Test plan:**
  - DOS-045: inventory.spec: open a count, post a -2 damage on a lot, then count it. The line's expected must equal on-hand at count time, and a warehouse-token reply must carry no expected or variance. Red today: expected is frozen at open and returned.

### L52 · `b2-52-door-credit-expense-rules` — P2 · WAITS FOR ARCHITECT (DOS-066, DOS-071)

- **DOS-066** (P2 missing-feature, M, no design): Nothing at the door says the shop is overdue: ₹52,176 of Vaibhav's ₹75,228 is…
- **DOS-071** (P3 ux, S, no design): Small door-screen defects: expense needs no proof, stale "photo required" text…
- **Depends on:** L24 (file: deliveries.service.ts, deliver.tsx, index.tsx, local.ts, strings.ts)
- **Owns:** `backend/libs/contracts/src/delivery.ts`, `backend/libs/core/src/modules/delivery/deliveries.service.ts`, `backend/libs/core/src/modules/receivables/credit.ts`, `frontend/delivery-app/app/expenses.tsx`, `frontend/delivery-app/app/stop/[id]/collect.tsx`, `frontend/delivery-app/app/stop/[id]/deliver.tsx`, `frontend/delivery-app/app/stop/[id]/index.tsx`, `frontend/delivery-app/src/lib/local.ts`, `frontend/delivery-app/src/strings.ts`
- **Prove on:** web, android
- **Test plan:**
  - DOS-066: A delivery-app vitest fails first: Vaibhav's summary (overdue 5217600, oldest_due_date 2026-07-10) renders 'Overdue ₹52,176 · oldest due 10 Jul', and a credit_mode 'stop' shop gets the treatment the founder picks. Then web and Android walks on stop 4 and stop 9 (Khan, stop).
  - DOS-071: Web walk on a credit shop fails first (d-08, d-09): before a photo the Record button is disabled and says why; after 'Photo attached' the footer no longer says a photo is required. Then a delivery.spec.ts case for the expense rule the founder picks, e.g. an expense with no proof refused when proof is mandated.

### L53 · `b2-53-stock-credit-signals` — P2 · WAITS FOR ARCHITECT (DOS-078, DOS-081)

- **DOS-078** (P2 business-logic, M, no design): Items with zero stock and quantities beyond stock are accepted silently; the…
- **DOS-081** (P2 business-logic, M, no design): Credit holds and over-limit warnings never reach the rep: "Order placed" for…
- **Depends on:** H4a (file: orders.internals.ts, new.tsx; finding: DOS-078 needs DOS-074); L47 [WAITS lane] (file: orders.service.ts); L52 [WAITS lane] (file: credit.ts)
- **Owns:** `backend/libs/contracts/src/orders.ts`, `backend/libs/core/src/modules/orders/orders.internals.ts`, `backend/libs/core/src/modules/orders/orders.service.ts`, `backend/libs/core/src/modules/orders/orders.spec.ts`, `backend/libs/core/src/modules/receivables/credit.ts`, `backend/libs/database/src/schema/orders.ts`, `frontend/sales-app/app/orders/new.tsx`, `frontend/sales-app/app/shops/[id].tsx`, `frontend/sales-app/src/strings.ts`
- **Prove on:** web, android
- **Test plan:**
  - DOS-078: orders.spec.ts: a rep submits 12 cs against 10 cs available plus 1 cs of a zero-stock item. Red today (only credit flags, no shortage on the order detail); green when the chosen stock signal is on the order before pack.
  - DOS-081: sales-app vitest: a submit reply of state submitted with approvalFlags ['credit_limit'] renders 'held for credit', not the unconditional 'Order placed' (red today). If a manager notice is chosen, add an orders.spec case for an indicate-mode shop over its limit.

### L54 · `b2-54-cess-on-orders` — P2 · WAITS FOR ARCHITECT (DOS-079)

- **DOS-079** (P2 business-logic, L, no design): The order total omits compensation cess, so the rep's total differs from the…
- **Depends on:** H4b (file: pricing.ts, orders.spec.ts, pricing-lines.ts, quote.service.ts; finding: DOS-079 needs DOS-096); L42 [WAITS lane] (file: pricing.ts, quote.service.ts); L53 [WAITS lane] (file: orders.ts, orders.spec.ts, orders.ts)
- **Owns:** `backend/libs/contracts/src/orders.ts`, `backend/libs/contracts/src/pricing.ts`, `backend/libs/core/src/modules/billing/billing.internals.ts`, `backend/libs/core/src/modules/orders/orders.spec.ts`, `backend/libs/core/src/modules/orders/pricing-lines.ts`, `backend/libs/core/src/modules/pricing/quote.service.ts`, `backend/libs/database/migrations/meta/_journal.json`, `backend/libs/database/src/schema/orders.ts`
- **Prove on:** web
- **Test plan:**
  - DOS-079: orders.spec.ts: order an item whose HSN has 28% GST + 12% cess. Red today (order total lacks cess and differs from the issueForPack invoice); green when the line stores cess and the order total equals the fully packed invoice total.

### L55 · `b2-55-scheme-bargain-semantics` — P2 · WAITS FOR ARCHITECT (DOS-087, DOS-090)

- **DOS-087** (P2 business-logic, M, no design): "₹15 off per case on 2+" gives ₹15 in total
- **DOS-090** (P3 tech-debt, M, no design): A bargain request points at an order id that does not exist
- **Depends on:** L54 [WAITS lane] (file: pricing.ts)
- **Owns:** `backend/libs/contracts/src/pricing.ts`, `backend/libs/core/src/modules/orders/orders.internals.ts`, `backend/libs/core/src/modules/orders/orders.service.ts`, `backend/libs/core/src/modules/orders/orders.sync.ts`, `backend/libs/core/src/modules/pricing/bargains.service.ts`, `backend/libs/database/src/seed-demo/pricing.ts`, `backend/libs/domain/src/pricing/schemes.test.ts`, `backend/libs/domain/src/pricing/schemes.ts`, `docs/adr/0008-pricing-engine.md`, `frontend/manager-app/app/orders/index.tsx`, `frontend/owner-app/app/approvals.tsx`, `frontend/sales-app/app/orders/new.tsx`
- **Prove on:** web, android, ios
- **Test plan:**
  - DOS-087: schemes.test.ts: 2 cs under triggerMin 2 case with a ₹15 net_scheme_amount is red today (discount ₹15) and green at the decided figure (₹30, or unchanged with the scheme renamed '₹15 off per 2 cases').
  - DOS-090: pricing/orders spec: the rep requests a bargain whose orderId is a draft id never uploaded. Assert the chosen behaviour: today order_id points at no sales_orders row and GET /orders/{id} is 404 for the manager. Then submit that id and expect exactly one bargain gate naming the request; DOS-005 spec 1 stays green.

### L56 · `b2-56-rep-bill-total` — P2 · WAITS FOR ARCHITECT (indirect: needs the DOS-079 design)

- **DOS-083** (P2 ux, M, no design): The rep never sees the bill total: order screen is "before GST", the detail…
- **Depends on:** H4b (finding: DOS-083 needs DOS-096); L54 [WAITS lane] (finding: DOS-083 needs DOS-079); L55 [WAITS lane] (file: new.tsx)
- **Owns:** `frontend/sales-app/app/orders/new.tsx`, `frontend/sales-app/src/lib/pricing.ts`, `frontend/sales-app/src/strings.ts`
- **Prove on:** web, android
- **Test plan:**
  - DOS-083: S3 walk plus a sales-app vitest on the payable summary. SO-0879's 12 lines online are red today (footer ₹28,739.70 'before GST', placed at once); green when a confirm step shows net + GST (+cess) equal to the order detail's total, with free goods, before submit.

## P3 lanes

### L57 · `b2-57-owner-today-labels` — P3 · READY NOW

- **DOS-018** (P3 ux, M, no design): Internal labels leak onto the owner's screens
- **DOS-019** (P3 ux, M, no design): "Needs you (5)" lists six rows; the badge stays at 5 after two decisions
- **Depends on:** H5b (file: approvals.tsx, index.tsx; finding: DOS-018 needs DOS-004; finding: DOS-019 needs DOS-004); L49 [WAITS lane] (file: rollup.ts, index.tsx); L55 [WAITS lane] (file: approvals.tsx)
- **Owns:** `backend/libs/core/src/modules/reporting/registers.service.ts`, `backend/libs/core/src/modules/reporting/rollup.ts`, `backend/libs/database/src/seed-demo/delivery-road.ts`, `backend/libs/database/src/seed-demo/delivery.ts`, `frontend/owner-app/app/_layout.tsx`, `frontend/owner-app/app/approvals.tsx`, `frontend/owner-app/app/index.tsx`, `frontend/owner-app/app/orders/index.tsx`, `frontend/owner-app/app/orders/trips.tsx`, `frontend/owner-app/app/reports/index.tsx`, `frontend/owner-app/src/strings.ts`
- **Prove on:** web, android, ios
- **Test plan:**
  - DOS-018: reporting.spec: an invoice whose applied_rules carry an override or bargain rule adds no scheme-spend row, and a planned trip is not counted in activeTrips (both red on main). seed-demo test: no trip_no of TRIP-ACTIVE or TRIP-NEXT. Then walk web, Android and iOS: order panel terms, Trips column label, Stock turns axis and the Approvals dialog (after DOS-004) show no enum or uuid text.
  - DOS-019: With 5 pending approvals plus 1 ungated rate request, the Today heading matches what it lists (or says how many more there are). Decide two on Approvals and return to Today with no reload and the worker stopped: the heading and the rail badge both drop by two. Red on main: both stay at 5.

### L58 · `b2-58-order-panel-approvals` — P3 · READY NOW

- **DOS-130** (P3 ux, S, no design): Owner order panel 'Stock held' shows the number of reservation rows, not the…
- **DOS-153** (P3 bug, S, no design): Owner Approvals: a note typed for one approval carries into the next approval…
- **DOS-155** (P3 ux, M, no design): Owner approve dialog on an order's last approval does not say it will confirm…
- **Depends on:** L50 [WAITS lane] (file: strings.ts); L57 (file: approvals.tsx, index.tsx, strings.ts)
- **Owns:** `frontend/manager-app/app/orders/index.tsx`, `frontend/manager-app/src/strings.ts`, `frontend/owner-app/app/approvals.tsx`, `frontend/owner-app/app/orders/index.tsx`, `frontend/owner-app/src/strings.ts`
- **Prove on:** web, android, ios
- **Test plan:**
  - DOS-130: Web owner: a confirmed SO holding 1 cs (24 pc) across 5 lots shows 'Stock held 24 pc' (red: '5'), and the manager panel's 'Held for this order' shows the same.
  - DOS-153: Type a note on SO-0910, close the panel, open Om Sai. Red: the note box carries the text. Green: it is empty. Repeat with the manager decision dialog: Cancel on one gate, then open another.
  - DOS-155: On an order whose only pending gate is a bargain: red, the dialog reads only 'Approve SO-0910 · Bargain · ₹44.80' and nothing follows. Green, the dialog says SO-0910 will be confirmed and stock held, and a toast 'SO-0910 confirmed' follows the 200 (order.state confirmed). An order with two gates shows no such line.

### L59 · `b2-59-admin-console-polish` — P3 · READY NOW

- **DOS-113** (P3 ux, S, no design): Every distributor shows two different plans: the tenant's and the subscription's
- **DOS-114** (P3 ux, M, no design): Console polish: a 400 after hand-back, "1 support requests", an unsorted People…
- **Depends on:** L32 (file: console.service.ts)
- **Owns:** `backend/libs/core/src/modules/platform-admin/console.service.ts`, `backend/libs/database/src/seed-demo.test.ts`, `backend/libs/database/src/seed-demo/platform-admin.ts`, `backend/libs/database/src/seed-demo/tenants.ts`, `backend/libs/database/src/seed.ts`, `frontend/admin-app/app/distributors/[id].tsx`, `frontend/admin-app/app/distributors/index.tsx`, `frontend/admin-app/app/index.tsx`, `frontend/admin-app/app/subscriptions.tsx`, `frontend/admin-app/app/users.tsx`, `frontend/admin-app/src/lib/subscription.tsx`, `frontend/admin-app/src/lib/support.tsx`, `frontend/admin-app/src/strings.ts`
- **Prove on:** web, android
- **Test plan:**
  - DOS-113: Red-then-green in seed-demo.test.ts: after pnpm db:seed, every tenant's tenants.plan must equal subscriptions.plan. Today Tarsun (pilot vs pro) and Kalyan (growth vs standard) fail. Walker: the distributor detail shows the plan once.
  - DOS-114: Walker network log on Tarsun detail: hand-back fires a 400 GET /admin/audit with entityId= today and no failed request after. Home tile reads '1 support request'. In platform-admin.spec.ts, the admin.users.list first page is name-ordered and the cursor pages without gaps. A Subscriptions row opens the plan dialog.

### L60 · `b2-60-desk-refusal-sentences` — P3 · READY NOW

- **DOS-141** (P3 ux, M, no design): Refusals now reach the desk as machine sentences: record UUIDs, UTC ISO times…
- **Depends on:** L49 [WAITS lane] (file: index.tsx); L54 [WAITS lane] (file: orders.spec.ts)
- **Owns:** `backend/libs/core/src/modules/docint/review.service.ts`, `backend/libs/core/src/modules/orders/approvals.service.ts`, `backend/libs/core/src/modules/orders/orders.spec.ts`, `backend/libs/core/src/modules/warehouse/load-sheets.service.ts`, `backend/libs/core/src/modules/warehouse/warehouse.spec.ts`, `frontend/libs/api-client/src/errors.ts`, `frontend/manager-app/app/money/day-end.tsx`, `frontend/manager-app/app/money/index.tsx`
- **Prove on:** web
- **Test plan:**
  - DOS-141: Specs: a stale approve of a decided approval, an already-approved load sheet and a held review lock each answer 409 with no UUID or ISO-Z timestamp (naming SO no, vehicle reg + date, approver name, IST 'until 12 Oct') (red today). Web manager: an empty bounce reason sends no POST and shows a field error.

### L61 · `b2-61-short-sheet-reasons` — P3 · READY NOW

- **DOS-051** (P3 ux, M, no design): Short-pick and gate-count semantics: a silent default reason, and damaged…
- **DOS-165** (P3 ux, S, no design): iOS W5 Short sheet: the third reason chip is clipped to 'Batcl' at iPhone width…
- **DOS-118** (P3 ux, S, no design): Phone Short sheet: the 'this batch asks for N pc' refusal line is laid out…
- **Depends on:** L38 (file: strings.ts); L60 (file: warehouse.spec.ts)
- **Owns:** `backend/libs/core/src/modules/warehouse/warehouse.spec.ts`, `backend/libs/core/src/modules/warehouse/warehouse.sync.ts`, `frontend/manager-app/app/billing/credit-notes.tsx`, `frontend/warehouse-app/app/inbound/[id].tsx`, `frontend/warehouse-app/app/pick/[id].tsx`, `frontend/warehouse-app/src/lib/ui.tsx`, `frontend/warehouse-app/src/strings.ts`
- **Prove on:** web, android, ios
- **Test plan:**
  - DOS-051: warehouse.spec: a device pick with picked below requested and no short_reason is rejected (accepted today). Walk: Short cannot save with no reason chosen; a gate count of 142 good + 2 damaged on a 144 line raises no excess; a counted GRN is not shown as 'reconciled — nothing to count'.
  - DOS-165: On the iOS simulator, sign in as dinesh.patil, open PICK-0091 and press Short on lot AN20260613. Run `ios-drive labels`. Red today: 'Batch held back' spans x 331-487 on a 402-pt screen, and a tap at its centre (409) leaves 'Not on the rack' selected. Green: the chip rect is fully on screen, a centre tap selects it, and after saving, pick_lines.short_reason reads 'Batch held back'. Repeat on the Pixel 7 once DOS-152 lets Short be pressed, and on web at 375 px.
  - DOS-118: Web 390x844: key 20 on a 12-pc lot row. The w5-short-over line lies inside the viewport and above w5-short-pad (red: y=836-880, below Short), then repeat on Pixel_7.

### L62 · `b2-62-pick-sheet-status` — P3 · READY NOW

- **DOS-119** (P3 ux, S, no design): A freshly made wave opens as 'Nothing here yet · 0 of 0 picked' with Scan and…
- **DOS-120** (P3 ux, S, no design): After 'Start picking' the sheet's status chip keeps saying 'picking' next to 'N…
- **Depends on:** L61 (file: [id].tsx, strings.ts)
- **Owns:** `frontend/warehouse-app/app/pick/[id].tsx`, `frontend/warehouse-app/app/pick/index.tsx`, `frontend/warehouse-app/src/strings.ts`
- **Prove on:** web, android
- **Test plan:**
  - DOS-119: Web desk: Make a wave, then within 2 s of the 200 reply w5-scan and w5-confirm are absent and a waiting line shows (red: enabled 'Take it to packing' at +1.6 s), and Start appears once the triggered pull lands.
  - DOS-120: Web desk: Start picking, then the server closes the wave (second device through the API). After the next pull the w5-screen chip reads 'picked' without reopening (red: 'picking' for 13 s next to '7 of 7 picked').

### L63 · `b2-63-staff-role-narrowing` — P3 · READY NOW

- **DOS-052** (P3 security, M, no design): The warehouse role receives retailer credit terms, and its "Inbox" is the…
- **DOS-072** (P3 security, M, no design): The crew receives the shop's credit limit and credit days
- **Depends on:** L39 (file: [orderId].tsx); L62 (file: strings.ts)
- **Owns:** `backend/libs/core/src/modules/notifications/messages.service.ts`, `backend/libs/core/src/modules/notifications/notifications.spec.ts`, `backend/libs/core/src/modules/retailers/retailers.mappers.ts`, `backend/libs/core/src/modules/retailers/retailers.module.ts`, `backend/libs/core/src/modules/retailers/retailers.service.ts`, `backend/libs/core/src/modules/retailers/retailers.spec.ts`, `backend/libs/core/src/modules/sync/sync.coverage.spec.ts`, `docs/23-app-screens-and-api-gaps.md`, `frontend/warehouse-app/app/pack/[orderId].tsx`, `frontend/warehouse-app/app/settings.tsx`, `frontend/warehouse-app/src/strings.ts`
- **Prove on:** web, android
- **Test plan:**
  - DOS-052: retailers.spec: retailers.get with a warehouse token returns the public shape (no creditLimitPaise, creditDays, creditMode or tier). notifications.spec: messages.list for a warehouse token returns only rows addressed to that user. Both red today.
  - DOS-072: Red then green: in retailers.spec.ts, GET /retailers/{id} and GET /retailers with a delivery token must return no creditLimitPaise, creditLimitBills, creditDays or tier (today they come back, e.g. 18000000), while owner and salesperson still get them. In sync.coverage.spec.ts, the crew's manifest and pulled rows for `retailers` must drop credit_limit_paise, credit_limit_bills and credit_days and keep credit_mode.

### L64 · `b2-64-app-boot-refresh` — P3 · READY NOW

- **DOS-055** (P3 reliability, S, no design): Android dev build: a React warning pops up over the whole screen on the first…
- **DOS-089** (P3 reliability, M, no design): Every screen open after 15 minutes fires a 401 on /sync/manifest before the…
- **Depends on:** L57 (file: _layout.tsx)
- **Owns:** `frontend/delivery-app/app/_layout.tsx`, `frontend/libs/api-client/src/client.test.ts`, `frontend/libs/api-client/src/client.ts`, `frontend/libs/api-client/src/session.ts`, `frontend/libs/app-template/app/_layout.tsx`, `frontend/manager-app/app/_layout.tsx`, `frontend/owner-app/app/_layout.tsx`, `frontend/sales-app/app/_layout.tsx`, `frontend/warehouse-app/app/_layout.tsx`
- **Prove on:** web, android, ios
- **Test plan:**
  - DOS-055: Red first: add a vitest guard in frontend/libs/ui/src next to document-urls.test.ts that reads every frontend/*-app/app/_layout.tsx and fails if router.replace(redirectTo) is not inside a setTimeout behind the redirectTo === pathname early return. It fails today on warehouse, sales, owner and manager and passes after the fix. Then on the Pixel 7, cold-start and sign in as dinesh.patil, tap Pick: no LogBox, and adb logcat | grep "hasn't mounted" is empty. On web, check the redirects still work: signed-out deep link goes to /sign-in, sign-in lands on /, and the change-password gate still holds.
  - DOS-089: Add a client.test.ts spec: a client whose access token is missing (boot) or past accessExpiresIn calls api.sync.manifest, and the fetch stub must record POST /auth/refresh before GET /sync/manifest with zero 401s (today it records 401, then refresh, then 200). Then reload sales :5175 after 15 min and confirm no 401 on /sync/manifest.

### L65 · `b2-65-kit-native-a11y-insets` — P3 · READY NOW

- **DOS-069** (P3 ux, S, no design): The amount keypad sheet draws under the status bar on Android
- **DOS-158** (P3 bug, S, no design): Android: a dialog's confirm button keeps the accessibility description 'busy'…
- **DOS-150** (P3 ux, S, no design): Emptied amount field still announces the previous amount to screen readers ('—'…
- **Depends on:** L19 [WAITS lane] (file: feedback.tsx); L27 (file: money.tsx)
- **Owns:** `frontend/libs/ui/src/money.test.ts`, `frontend/libs/ui/src/native/controls.tsx`, `frontend/libs/ui/src/native/feedback.tsx`, `frontend/libs/ui/src/native/money.tsx`, `frontend/libs/ui/src/native/shell.tsx`, `frontend/libs/ui/src/strings.ts`
- **Prove on:** android, ios
- **Test plan:**
  - DOS-069: Pixel 7 API 36 screenshot fails first: Take money, then Amount taken, and the keypad title must sit below the status-bar clock (a-17 shows the overlap). Then the same on the iOS simulator via simctl.
  - DOS-158: Manager Waves: tick packed SO-0850, then 'Make a picking sheet', which answers 409. Red: uiautomator content-desc 'busy' on the settled button. Green: 'Make a picking sheet'. Re-check after a 200 and after the offline press.
  - DOS-150: uiautomator dump on Collect after 4-7-5-6, Clear, Done. Red: content-desc '4756 rupees'. Green: an explicit 'not entered' label. The kit has no native render harness, so this is a device dump.

### L66 · `b2-66-rep-shop-card` — P3 · READY NOW

- **DOS-088** (P3 ux, S, no design): Deals to pitch: the shop card lists 6 of 14 live schemes and hides launches and…
- **DOS-091** (P3 missing-feature, M, no design): The rep can list a shop's bills but cannot open or show one; "Due 10 Sep · 2…
- **DOS-093** (P3 bug, S, no design): A brand-new shop's card throws a 404 for its behaviour block
- **Depends on:** L37 (file: index.tsx); L44 [WAITS lane] (file: [id].tsx); L56 [WAITS lane] (file: strings.ts); L63 (file: docs/23-app-screens-and-api-gaps.md)
- **Owns:** `docs/23-app-screens-and-api-gaps.md`, `frontend/delivery-app/app/share/[invoiceId].tsx`, `frontend/owner-app/app/shops/index.tsx`, `frontend/retailer-app/app/bills/[id].tsx`, `frontend/sales-app/app/shops/[id].tsx`, `frontend/sales-app/app/shops/catalog.tsx`, `frontend/sales-app/src/lib/local.ts`, `frontend/sales-app/src/lib/ui.tsx`, `frontend/sales-app/src/nav.ts`, `frontend/sales-app/src/strings.ts`
- **Prove on:** web, android, ios
- **Test plan:**
  - DOS-088: sales-app vitest on the shop-card scheme selector: 14 live schemes with empty applicability are red today (6 returned, in id order) and green when all 14 come back newest valid_from first.
  - DOS-091: Sign in as rahul.deshmukh on :5175, shop Bills tab: INV/0753 must read '2 days overdue' and a bill not yet due 'due in N days'. Tapping a bill opens a detail screen (GET /invoices/{id} 200) and its PDF (GET /invoices/{id}/pdf returns a url or queued). Today there is no tap target and the copy is 'Due … · 2 days'. Walk it on Pixel 7 too.
  - DOS-093: Sales :5175: add a new shop, open its card. 'How this shop buys' must read a 'new shop, no orders yet' line with no error panel or Retry; today a 404 on GET /reporting/retailers/{id}/behaviour lands in Async's ErrorState. An existing shop still shows its four figures. Repeat on Pixel 7.

### L67 · `b2-67-shop-wording-dates` — P3 · READY NOW

- **DOS-105** (P3 ux, M, no design): Words that mislead a shopkeeper: credit notes "To pay", a cancelled order "You…
- **DOS-143** (P3 bug, S, no design): Retailer 'My orders' prints the UTC date: an order placed at 3:05 am IST on 13…
- **Depends on:** L45 [WAITS lane] (file: strings.ts); L59 (file: index.tsx); L66 (file: [id].tsx)
- **Owns:** `backend/libs/core/src/modules/notifications/events.ts`, `backend/libs/core/src/modules/notifications/notifications.spec.ts`, `backend/libs/database/src/seed-demo/notifications.ts`, `frontend/admin-app/app/distributors/index.tsx`, `frontend/owner-app/app/reports/incentives.tsx`, `frontend/retailer-app/app/bills/[id].tsx`, `frontend/retailer-app/app/deals.tsx`, `frontend/retailer-app/app/index.tsx`, `frontend/retailer-app/app/orders/[id].tsx`, `frontend/retailer-app/app/orders/index.tsx`, `frontend/retailer-app/app/returns.tsx`, `frontend/retailer-app/src/lib/dates.ts`, `frontend/retailer-app/src/strings.ts`, `frontend/sales-app/app/me/index.tsx`, `frontend/warehouse-app/app/index.tsx`, `frontend/warehouse-app/app/pack/index.tsx`
- **Prove on:** web, android
- **Test plan:**
  - DOS-105: notifications.spec 'DOS-105: dues_reminder renders oldestDueDate as 6 Aug 2026, never ISO' fails today, passes after; walking web and Android: credit notes read 'Credited', the cancelled SO-0310 shows no 'You pay', rep bargains say the salesperson asked, and the cancel dialog reads 'Keep it'.
  - DOS-143: Red: an order with createdAt 2026-09-12T21:35:33Z shows 'Placed 12 Sep 2026' on My orders and Home. Green: it shows '13 Sep 2026' through businessDate. retailer-app has no test script, so prove it with a web walk, or add a vitest dates spec.

### L68 · `b2-68-warehouse-queue-rows` — P3 · WAITS FOR ARCHITECT (DOS-050)

- **DOS-050** (P3 ux, L, no design): Queue rows do not say what they are: reservations without an order, "Ready to…
- **Depends on:** L51 [WAITS lane] (file: procurement.ts, grn.service.ts); L67 (file: index.tsx, index.tsx)
- **Owns:** `backend/libs/contracts/src/procurement.ts`, `backend/libs/contracts/src/warehouse.ts`, `backend/libs/core/src/modules/procurement/grn.service.ts`, `backend/libs/core/src/modules/warehouse/picklists.service.ts`, `frontend/warehouse-app/app/index.tsx`, `frontend/warehouse-app/app/pack/[orderId].tsx`, `frontend/warehouse-app/app/pack/index.tsx`, `frontend/warehouse-app/app/stock/reservations.tsx`
- **Prove on:** web, android
- **Test plan:**
  - DOS-050: warehouse.spec and procurement.spec with a warehouse token: queue.list 'picking' rows carry picked and short pieces (or an all-picked flag), reservation rows carry the shop, and grns.list rows carry supplier name and bill number with no cost. Red today.

### L69 · `b2-69-shelf-life-rule` — P3 · WAITS FOR ARCHITECT (DOS-054)

- **DOS-054** (P3 business-logic, L, no design): FEFO hands the picker a lot that expires in 16 days with no minimum-shelf-life…
- **Depends on:** L68 [WAITS lane] (file: warehouse.ts, picklists.service.ts)
- **Owns:** `backend/libs/contracts/src/tenancy.ts`, `backend/libs/contracts/src/warehouse.ts`, `backend/libs/core/src/modules/inventory/inventory.service.ts`, `backend/libs/core/src/modules/warehouse/picklists.service.ts`, `backend/libs/database/src/tenant-bootstrap.ts`, `frontend/owner-app/app/settings/index.tsx`, `frontend/warehouse-app/app/pick/[id].tsx`
- **Prove on:** web, android
- **Test plan:**
  - DOS-054: inventory.spec: with the tenant minimum shelf life set to 30 days, confirming an order does not reserve (or flags) a lot expiring in 16 days when a later lot exists. Red today: FEFO takes the 16-day lot.

## What waits on the architect

| waiting lane | its findings | lanes that depend on it (reason) |
|---|---|---|
| L12 `b2-12-kit-modal-host` | DOS-164 | L16 (file order, swap rule applies); L19 (finding); L20 (file order, swap rule applies) |
| L13 `b2-13-accountant-scope` | DOS-037 | L14 (file order, swap rule applies); L15 (file order, swap rule applies) |
| L14 `b2-14-warehouse-adjust-rule` | DOS-044 | L38 (file order, swap rule applies) |
| L15 `b2-15-admin-unlock-audit-names` | DOS-107, DOS-109 | L32 (file order, swap rule applies); L43 (file order, swap rule applies) |
| L40 `b2-40-approval-credit-limit` | DOS-006 | L41 (file order, swap rule applies) |
| L41 `b2-41-names-and-sort-keys` | DOS-013, DOS-009 | L42 (file order, swap rule applies); L46 (file order, swap rule applies) |
| L42 `b2-42-shop-hold-rate-read` | DOS-100, DOS-104 | L44 (file order, swap rule applies); L45 (file order, swap rule applies); L54 (file order, swap rule applies) |
| L43 `b2-43-shop-multi-distributor-home` | DOS-102 | L49 (file order, swap rule applies) |
| L44 `b2-44-shop-contact-returns` | DOS-103 | L66 (file order, swap rule applies) |
| L45 `b2-45-kit-upi-qr` | DOS-125 | L67 (file order, swap rule applies) |
| L46 `b2-46-bill-cancel-order-state` | DOS-139 | L47 (file order, swap rule applies); L50 (file order, swap rule applies) |
| L47 `b2-47-cancel-after-picking` | DOS-138 | L48 (file order, swap rule applies); L53 (file order, swap rule applies) |
| L48 `b2-48-owner-exports` | DOS-014 | L49 (file order, swap rule applies) |
| L49 `b2-49-receivables-views` | DOS-011, DOS-016 | L57 (file order, swap rule applies); L60 (file order, swap rule applies) |
| L50 `b2-50-brand-dms-commit` | DOS-030 | L58 (file order, swap rule applies) |
| L51 `b2-51-count-expected` | DOS-045 | L68 (file order, swap rule applies) |
| L52 `b2-52-door-credit-expense-rules` | DOS-066, DOS-071 | L53 (file order, swap rule applies) |
| L53 `b2-53-stock-credit-signals` | DOS-078, DOS-081 | L54 (file order, swap rule applies) |
| L54 `b2-54-cess-on-orders` | DOS-079 | L55 (file order, swap rule applies); L56 (finding); L60 (file order, swap rule applies) |
| L55 `b2-55-scheme-bargain-semantics` | DOS-087, DOS-090 | L56 (file order, swap rule applies); L57 (file order, swap rule applies) |
| L68 `b2-68-warehouse-queue-rows` | DOS-050 | L69 (file order, swap rule applies) |
| L69 `b2-69-shelf-life-rule` | DOS-054 | — |
