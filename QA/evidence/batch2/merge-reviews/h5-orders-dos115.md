# Slice h5-orders-dos115 — architect merge review (Fable, 2026-09-13)
**Decision:** MERGE — commit 2ec9583 alone (fcb0d77..2ec9583, 11 files), second in the planned order, after h7 DOS-166. One semantic
conflict with h7 must be resolved IN the merge commit (below); nothing in the slice itself needs changing.

## Blockers / majors (must be fixed before merge)
none. The slice is right on its base: one tuple in the matrix (`permissions.ts:296-301` ORDER_PLACERS = owner, manager, salesperson,
retailer), the five rows point at it (:539-546), get/list stay ANY_MEMBER; the core copy (`orders.internals.ts:274-286`, + `system`) is
pinned to the matrix by orders.spec test (c) — no second tuple can drift unnoticed; `requireRole(ORDER_PLACERS)` on exactly the five
methods (`orders.service.ts:144/157/176/237/396`), ORDER_ROLES kept for get/list; `requirePlacer()` is the first statement of both device
handlers (`orders.sync.ts:53-61, 65, 117`) and throws before `putOnly` and any read, inside the per-op savepoint, so a refusal writes only
its sync_errors + sync_ops rows (sync.service.ts:108-152). No 4xx on the upload path (ADR 0007). No caller outside orders.controller uses
the five methods (git grep: none in core/worker); van sales, AI drafts and approvals use insertDraft/writeLines/submitInTx/cancelInTx.

## Minors (may follow)
- docs/22 is not yet clarified: §8 :277 still says "four actions" and only two roles, §7 :215 already names the accountant. The main session
  adds the clarification row (repeatLast counts as create; a device PUT on sales_orders/sales_order_lines is refused the same way; the
  accountant is the architect default under the 2026-09-05 scope row, one tuple change reverses it), widens §7, adds §11, re-renders and
  republishes — same turn as the merge. QA/13 row for DOS-115 in its own commit (CHARTER A.14).
- Accountant manifest (verifier minor): RESOLVED by h7, no follow-up. After DOS-166 `manifest().writable = mayUpload && handler &&
  mayUploadTable` and sales_orders `standsFor: ['orders.create']`, so the accountant's cell turns false the moment ORDER_PLACERS lands; the
  h7 coverage pin compares `mayUploadTable` to `standsFor.every(isAllowed)` for ALL_ROLES, so it holds for the new tuple without an edit.
- Prettier drift on main (`backend/libs/core/src/modules/pricing/pricing.spec.ts`, DOS-096 chain near :604): confirmed with the backend's
  own `prettier --check` on the main tree. No running lane touches that file (h7/h2/h1/h3 name lists checked), so the main session runs
  `pnpm format` in backend/ and commits it on main in the same turn as this merge — before the next `pnpm format:check`.
- Reads stay tenant-wide for the godown and the crew by founder decision (Phase 3 narrowing); record DOS-115 closed on the write half.

## Amendments — satisfied? evidence
(a) yes — tuple :296-301 without accountant, declared apart from DRAFT_ORDER_TAKERS (:311); permissions.test :325-347 refuses warehouse,
    delivery, accountant on the five and allows them on get/list; core copy adds `system` only. (b) yes — one `requirePlacer()` helper,
    first line of both handlers, SyncRejection('forbidden', en, hi); header comment :20-21. (c) yes — manager-app orders/index.tsx:13-16
    comment only, `mayDecide = can('orders.confirm')` untouched; permissions.ts :302-311 and :961-965 reworded. (d) yes — orders.spec
    (c) loops all five paths against `ORDER_PLACERS.filter(r => r !== 'system')`. (e) in-process equivalent run by the verifier (manager
    service booted with amol.vaidya: five 403s with exact messages, GET 200, x-roles); the live :3002/:5174 walk is the main session's.
    (f) docs/23 half done (§4.3 :425-428, §5.3 :491-493, §2 checked); docs/22 half is the follow-up above.
Fail-first was layered and proven per layer (matrix, handler tuple, sync helper each independently necessary) — verifier evidence accepted.

## Merge conflicts with main and how to resolve
1. SEMANTIC, with h7 (ahead of this slice), MANDATORY in the merge commit: h7's `SyncService.upload` refuses `mayUploadTable(table, role)`
   BEFORE the savepoint with code `role_not_allowed` (sync.service.ts, DOS-166), and `orders.module.ts` registers sales_orders/
   sales_order_lines as `standsFor: ['orders.create'] / ['orders.setLines']`. On merged main a warehouse or delivery upload therefore never
   reaches `requirePlacer()`: orders.spec test (b) ("device upload cannot draft or re-line … rejected forbidden") FAILS — it expects
   `'forbidden'` twice per actor and four `sync_errors` rows coded `forbidden`. Resolve in `orders.spec.ts` (DOS-115 block): expect
   `SYNC_REJECTION_CODES.roleNotAllowed` (import from @dos/contracts) for the two rejected ops and in the tray query; then keep the handler
   check proven by adding, in the same test, `tenantStorage.run(storeCtx, () => requirePlacer())` → throws `SyncRejection` with
   `code: 'forbidden'` and `tenantStorage.run({…actorRole:'salesperson'}, () => requirePlacer())` → does not throw (import `requirePlacer`
   from './orders.sync.js', `SyncRejection` from '../sync/index.js'). Rename nothing else; `requirePlacer` stays as defence in depth exactly
   as the DOS-115 verdict said it would become.
2. Textual, none expected: h7 shares no file with this slice; h2 (after us) touches permissions.ts at the delivery block (:635-667),
   permissions.test.ts at :586/:621, orders.service.ts imports (:3, :62) + a new `orderInState` method (:510), docs/23 :398 — all different
   hunks from ours (:283-311, :531-548, :961; :322-347, :1217; :52-55 + five one-liners; :423/:488). Git auto-merges; if the
   orders.service.ts import block does conflict, keep BOTH our `ORDER_PLACERS,` and h2's `orderInState,`. h1, h3: no shared file;
   h2 no longer touches warehouse-service/src/service.spec.ts (DOS-043 is merged), so our test there merges clean.
3. Migrations: none in this slice; 0045/0046 (h7) and h2's 0045 renumbering are unaffected.

## What the later fixes must build on
- DOS-098 (lane tip 7d67f9c, not in this merge) already sits on 2ec9583: it adds `'orders.lastPlaced': ANY_MEMBER` directly under the
  rewritten orders block comment and edits the repeatLast body; the role line stays `requireRole(ORDER_PLACERS)`. When the lane merges main
  it must take h7's orders.module.ts `standsFor` registration and h2's `orderInState` as-is.
- DOS-126 (confirmInTx) appends to orders.spec.ts: append AFTER the DOS-115 describe, use phone suffixes 8+, and do not read variantA
  stock at `godown` without accounting for DOS-115's +5 opening pieces and its cancelled `cancelDraft` (own lot/variant is safer).
- DOS-116 edits billing.spec.ts near the van-sale fixture (:907/:937 now create as `manager`); keep that actor.
- DOS-037/DOS-044 change other permissions.ts rows: add tuples, never widen ORDER_PLACERS; the orders.spec pin will fail if they do.
- DOS-080 edits the PULL half of sync.service.ts/engine.ts — the upload half (DOS-166 check + this slice's handler rule) is not its to touch.

## READMEs that will change
backend/{owner,manager,sales,warehouse,delivery,retailer}-service/README.md — the five order-write rows lose accountant, warehouse and
delivery and their matrix cells turn ✓ → –. No app README carries those rows (grep). One `pnpm docs:readme` on merged main, then
`pnpm docs:readme:check`; never hand-edit. (DOS-098's `orders.lastPlaced` row arrives with the lane's later merge.)

## Regression walk, API probes and SQL
Web (dinesh.patil :3004, ganesh.more :3005, amol.vaidya :3002): POST /orders, /orders/{id}/lines, /orders/repeat-last, /orders/{id}/submit,
/orders/{id}/cancel → 403 `the <role> role may not call POST /orders[/:id/…]`; GET /orders/{id} and GET /orders?limit=5 → 200; GET
/docs/openapi.json x-roles on the five POSTs = [owner, manager, salesperson, retailer], GET /orders lists all seven. Sales app :5175
(rahul.deshmukh): New order online → confirmed; airplane mode → draft queued → back online → accepted (salesperson ∈ ORDER_PLACERS and
`mayUploadTable('sales_orders','salesperson')` is true after h7). Retailer app :5178: Order → place → submit; open the order → Cancel → 200
cancelled. Warehouse device: POST :3004/sync/upload with a sales_orders PUT → 200, accepted 0, code `role_not_allowed` (post-h7; `forbidden`
only if this merged before h7). Van sale on :5177 and the Pixel 7 → 200, source van_sale, INV number. Warehouse Pack detail :5176 loads.
Scoped smoke: `pnpm smoke --service warehouse --run-tag dos115`, same for delivery → 0 BROKEN, five rows EXPECTED.
SQL (dos_qa, read-only): `select event, actor_id from order_state_transitions where order_id in (A,B,C) order by id` — no 5b6fbe87/7b2db500
rows; `select count(*) from outbox_events where aggregate_id = A and event_type = 'OrderCancelled'` = 0; `select r.state from reservations r
join sales_order_lines l on l.id = r.order_line_id where l.order_id = A` still held; `select code, table_name, user_id from sync_errors where
device_id in ('qa-dos115-w','qa-dos115-d')` → role_not_allowed rows; `select state, total_paise from sales_orders where id = B` unchanged.

## Defects outside this slice
- backend/libs/core/src/modules/orders/orders.sync.ts:107 — `source: (str(data.source) ?? 'salesperson') as 'salesperson'` inserts any
  uploaded string into the `order_source` enum: an unknown value raises Postgres 22P02, which is neither a SyncRejection nor a 4xx ORPCError,
  so the whole batch answers 5xx and the device retries it forever (ADR 0007 rule 5); a device may also label its draft `van_sale` or
  `brand_dms_import`. Sanitise to the device-allowed subset (salesperson, retailer_app) and reject the rest as `source_not_allowed`.
- docs/22-source-of-truth.md:277 — the §8 DOS-115 row names four actions and two roles while §7 :215 names three roles; internally
  inconsistent until the clarification row lands (follow-up above).
