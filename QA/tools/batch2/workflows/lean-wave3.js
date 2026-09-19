export const meta = {
  name: 'qa-batch2-lean-wave3',
  description: 'Lean wave 3: the last 16 batch-2 P2/P3 groups, one lane per group, built test-first with an adversarial verifier, reviewed by Fable as architect, integrated with the full cross-app guards and merged into main in dependency order',
  phases: [
    { title: 'Prepare', detail: 'one worktree, branch and private database per group, from current main' },
    { title: 'Build', detail: 'implementer and adversarial verifier per group, one repair round' },
    { title: 'Review', detail: 'Fable merge review per group — the architect seat, no longer an Opus stand-in' },
    { title: 'Integrate', detail: 'merge main into the lane, resolve every review blocker on HEAD, run the full gates including the kit cross-app guards, then merge into main in dependency order' },
  ],
}

const MAIN = '/Users/prajwalchavan/Desktop/Distribution OS'
const FIND = MAIN + '/QA/findings/12-batch2-new-findings.md'
const VERD = MAIN + '/QA/evidence/batch2/verdicts'
const REV = MAIN + '/QA/evidence/batch2/merge-reviews'
const CO = 'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>'
const LIMIT = 3

/**
 * Wave 3 = the 16 lean groups still unmerged (waves 1 and 2 merged lean-sales-entry, lean-kit-overlays,
 * lean-manager-billing, lean-retailer-shop and lean-backend-platform). `after` is each group's waitsFor
 * narrowed to groups in THIS run; the h-lanes it also waited for are all on main. `defer` is empty: the eleven items once listed in
 * QA/evidence/batch2/lean-founder-questions.md were ALREADY decided by the founder on 2026-09-13
 * (docs/22 §8 carries a row for each of DOS-006, 016, 054, 066, 071, 081, 087, 100, 102, 103, 138)
 * and re-confirmed on 2026-09-19 ("accept all recommended"). Nothing in wave 3 is held.
 */
const GROUPS = [
 {
  "key": "lean-delivery-door",
  "app": "delivery",
  "ids": [
   "DOS-063",
   "DOS-149",
   "DOS-148",
   "DOS-064",
   "DOS-070",
   "DOS-163"
  ],
  "defer": [],
  "model": "opus",
  "after": [],
  "ownsFiles": [
   "backend/libs/core/src/modules/delivery/deliveries.service.ts",
   "backend/libs/core/src/modules/delivery/delivery.spec.ts",
   "frontend/delivery-app/app/_layout.tsx",
   "frontend/delivery-app/app/stop/[id]/collect.tsx",
   "frontend/delivery-app/app/stop/[id]/deliver.tsx",
   "frontend/delivery-app/app/stop/[id]/index.tsx",
   "frontend/delivery-app/src/lib/local.ts",
   "frontend/delivery-app/src/strings.ts",
   "frontend/libs/offline/src/react.tsx"
  ],
  "notes": "No kit file and no engine file. frontend/libs/offline/src/engine.ts belongs to running lane h11-syncpull (commit 38032df changed it), then to lean-libs-offline-boot. deliver.tsx was changed by merged DOS-056 (3d7cb36) and DOS-146; rebase on main. DOS-063 + DOS-149: after a successful delivery or collection, refresh the SQLite stop through the public useSyncEngine().sync() (react.tsx:144). Do not add an engine method to write server rows locally. Show the toast on the stop screen, not on D4 before router.replace; item.creditNote gives the note ref. DOS-148: deliveries.record refuses an undispatched order BEFORE applyFulfilmentEvent and before the photo step, with a driver sentence (never 'cannot apply deliver_partial'). An online pre-check via orders.get is allowed; the spec goes in delivery.spec.ts. DOS-064: pass onOpenPieces + parsePieces. The zero word is an app-level override of the kit's qty.notOrdered and must also read right on van-sale.tsx. No kit qty.ts or money.tsx edit, and a per-instance label (types.ts) is out of bounds. If lean-sales-entry's DOS-085 stepper change merged first, rebase and re-walk. DOS-070: say what the geo proof is (arrival point and time) or send no geo line; no platform location change. DOS-163: do not shorten the shared word.refused key. Do not change kit Segments or Chips (native/controls.tsx belongs to lean-kit-overlays); fit the card at app level on iOS (ios-drive labels) and on the Pixel 7. Walks: web, Android, and iOS for DOS-163/149.",
  "db": "dos_test_b2_delivery_door"
 },
 {
  "key": "lean-libs-offline-boot",
  "app": "kit/libs",
  "ids": [
   "DOS-046",
   "DOS-068",
   "DOS-053",
   "DOS-089",
   "DOS-055"
  ],
  "defer": [],
  "model": "opus",
  "after": [
   "lean-delivery-door"
  ],
  "ownsFiles": [
   "docs/27-offline-sync-client.md",
   "frontend/delivery-app/app/_layout.tsx",
   "frontend/delivery-app/app/trips.tsx",
   "frontend/delivery-app/package.json",
   "frontend/delivery-app/src/lib/ui.tsx",
   "frontend/libs/api-client/src/client.test.ts",
   "frontend/libs/api-client/src/client.ts",
   "frontend/libs/api-client/src/errors.ts",
   "frontend/libs/api-client/src/session.ts",
   "frontend/libs/app-template/app/_layout.tsx",
   "frontend/libs/offline/src/connection.ts",
   "frontend/libs/offline/src/engine.test.ts",
   "frontend/libs/offline/src/engine.ts",
   "frontend/libs/offline/src/react.tsx",
   "frontend/libs/ui/src/root-layout-redirects.test.ts",
   "frontend/manager-app/app/_layout.tsx",
   "frontend/owner-app/app/_layout.tsx",
   "frontend/pnpm-lock.yaml",
   "frontend/pnpm-workspace.yaml",
   "frontend/sales-app/app/_layout.tsx",
   "frontend/warehouse-app/app/_layout.tsx",
   "frontend/warehouse-app/app/pick/attention.tsx",
   "frontend/warehouse-app/app/settings.tsx"
  ],
  "notes": "Waits for h11-syncpull (38032df changed engine.ts, docs/27 and docs/07), for h13 (owner _layout.tsx and the lockfile), and for h10-console (4201823 committed a frontend/pnpm-lock.yaml hunk). DOS-046 WAITS FOR its architect decision (architectQueue), because docs/27 \u00a74 and \u00a711 bind a retry to the same opId. Build DOS-053, DOS-055, DOS-068 and DOS-089 first. If the design confirms the direction: a user retry mints a NEW opId and clears the pulled sync_error; ADR 0007's durable outcomes stay (no sync.service.ts change; h11 owns it); the 'SAME opId' engine.test case (:481) flips; docs/27 lines ~71 and ~168 change. DOS-053: status.rejected must equal needsAttention().length; warehouse settings prints deviceLabel like manager/sales/retailer (reference only). DOS-068: merged DOS-056 already classifies Expo FetchError as network. Add the native radio hint feeding setNetworkHint with @react-native-community/netinfo through the catalog (docs/27:145 names NetInfo; 12.0.1 is in Expo's bundledNativeModules), and stop printing error.kind in delivery ui.tsx. This group owns the pnpm-workspace.yaml and lockfile change; lean-owner-desk waits for it. DOS-089: start the sales engine only after !hydrating (check the _layout comment against session.ts, which sets hydrating only at boot) and refresh proactively from accessExpiresIn. DOS-055: delay router.replace with setTimeout(0) in the sales, owner, manager and warehouse layouts, as the template does. The vitest guard is a NEW file, frontend/libs/ui/src/root-layout-redirects.test.ts; document-urls.test.ts belongs to lean-retailer-shop for DOS-123. Tell the main session to retire the QA/ENV.md:151 workaround (QA/ is not lane-owned). Walks: Android airplane mode and API cut (a-34, a-39), cold start without LogBox, web redirects.",
  "db": "dos_test_b2_libs_offline_boot"
 },
 {
  "key": "lean-owner-desk",
  "app": "owner",
  "ids": [
   "DOS-002",
   "DOS-012",
   "DOS-017",
   "DOS-008",
   "DOS-015",
   "DOS-018"
  ],
  "defer": [],
  "model": "opus",
  "after": [
   "lean-libs-offline-boot"
  ],
  "ownsFiles": [
   "backend/libs/core/src/modules/reporting/registers.service.ts",
   "backend/libs/core/src/modules/reporting/reporting.spec.ts",
   "backend/libs/core/src/modules/reporting/rollup.ts",
   "backend/libs/database/src/seed-demo.test.ts",
   "backend/libs/database/src/seed-demo/delivery-road.ts",
   "backend/libs/database/src/seed-demo/delivery.ts",
   "frontend/libs/ui/src/charts/geometry.test.ts",
   "frontend/libs/ui/src/charts/geometry.ts",
   "frontend/libs/ui/src/tokens.ts",
   "frontend/owner-app/app.json",
   "frontend/owner-app/app/billing/index.tsx",
   "frontend/owner-app/app/index.tsx",
   "frontend/owner-app/app/map.tsx",
   "frontend/owner-app/app/money/index.tsx",
   "frontend/owner-app/app/orders/index.tsx",
   "frontend/owner-app/app/orders/trips.tsx",
   "frontend/owner-app/app/reports/index.tsx",
   "frontend/owner-app/app/staff/index.tsx",
   "frontend/owner-app/package.json",
   "frontend/owner-app/src/lib/ui.tsx",
   "frontend/owner-app/src/strings.ts",
   "frontend/pnpm-lock.yaml"
  ],
  "notes": "Starts after h13-owner-support (DOS-108) merges and after lean-libs-offline-boot (frontend/pnpm-lock.yaml). Through lean-manager-billing, that wait also orders DOS-008 after DOS-026. DOS-012 imports Refusal/stayOpen from the NEW frontend/owner-app/src/lib/refusal.tsx (DOS-108 amendment (a)), never a copy. If the .then(done, done) confirms are swept, sweep only this group's files: billing/index.tsx, orders/index.tsx, money/index.tsx, staff/index.tsx. Leave money/receipts.tsx to DOS-136 (lean-manager-money, per the h1-money-slice2 review), settings/index.tsx to h13, and shops/index.tsx to lean-sales-rep; record the decision. DOS-015: DOS-007 and DOS-117 are merged. Show RebuildAgeingOutput or the refusal instead of closing silently (app-only, no receivables change). DOS-008: a bounded poll or a 'ready, open' button on invoices.pdf, inside the owner app (no backend change, no shared helper). DOS-002: request topGroups 4 and make mixSegments merge an existing Other; no types.ts change. DOS-017: use the existing kit <MapView>. react-native-maps 1.27.2 and maplibre-gl are ALREADY in the frontend catalog (pnpm-workspace.yaml:72-74, :94). Add them to owner-app package.json only: that is an owner-app importer hunk in pnpm-lock.yaml, rebased on h10's and h13's hunks, then pnpm install. Android tiles need a founder-supplied Google Maps key (docs/26). Prove web and iOS tiles and the Android list fallback. DOS-018 (its approvals-wording cause was closed by merged DOS-004): the terms word; TRIP series numbers in the seed, with a seed-demo.test.ts check that no trip_no is TRIP-ACTIVE or TRIP-NEXT; scheme spend filtered to kind scheme in reporting registers.service.ts; the Trips column label; activeTrips = state active in rollup.ts (this also fixes the manager's m1.trips, no manager file); the stock-turns axis. reporting.spec.ts carries the two red cases. Seed change (DOS-018): re-run pnpm db:seed on dos_qa. The iOS in-Sheet dialog check uses the merged DOS-164. Walk web desk + phone and Android; iOS home for the map.",
  "db": "dos_test_b2_owner_desk"
 },
 {
  "key": "lean-warehouse-pick",
  "app": "warehouse",
  "ids": [
   "DOS-047",
   "DOS-051",
   "DOS-165",
   "DOS-118",
   "DOS-119",
   "DOS-120"
  ],
  "defer": [],
  "model": "opus",
  "after": [
   "lean-delivery-door"
  ],
  "ownsFiles": [
   "backend/libs/core/src/modules/warehouse/warehouse.spec.ts",
   "backend/libs/core/src/modules/warehouse/warehouse.sync.ts",
   "frontend/warehouse-app/app/inbound/[id].tsx",
   "frontend/warehouse-app/app/load/index.tsx",
   "frontend/warehouse-app/app/pick/[id].tsx",
   "frontend/warehouse-app/app/pick/index.tsx",
   "frontend/warehouse-app/src/lib/ui.tsx",
   "frontend/warehouse-app/src/strings.ts"
  ],
  "notes": "Waits for lean-kit-overlays, because DOS-152 rewrites the Short sheet footer on the same pick/[id].tsx and the Android Short proof is impossible before it. Also waits for h9-desk (merged d521f84: DOS-044 edited warehouse strings.ts and inbound/[id].tsx). lean-delivery-door is a semantic wait: DOS-163's choice should match DOS-165. It is ordered ahead of the P2-heavy groups because lean-manager-money and lean-warehouse-stock wait on its warehouse.spec.ts and pick files. DOS-051 + DOS-165 land together. The reason chips have NO preselected reason, with no kit Segments/Chips change (native/controls.tsx belongs to lean-kit-overlays). warehouse.sync.ts rejects a device pick below requested with no short_reason as a sync_error, never a 4xx. Fix the gate-count wording (w3.countLabel 'good pieces'), not the reconciled enum. DOS-118: move the over-ask line above the pad (NumberPadProps has no disabled prop; no types.ts change). DOS-119: call the public useSyncEngine().sync() after making a wave, and hide Scan/confirm while the status is unknown (no offline lib edit). DOS-120: use the Start reply only while the local row is still open or undefined. DOS-047: query open/picking and draft first, then finished. Walk web desk + 390, Pixel 7, iOS (ios-drive labels for DOS-165).",
  "db": "dos_test_b2_warehouse_pick"
 },
 {
  "key": "lean-manager-money",
  "app": "manager",
  "ids": [
   "DOS-035",
   "DOS-036",
   "DOS-038",
   "DOS-136",
   "DOS-141"
  ],
  "defer": [],
  "model": "opus",
  "after": [
   "lean-libs-offline-boot",
   "lean-warehouse-pick",
   "lean-delivery-door"
  ],
  "ownsFiles": [
   "backend/libs/core/src/modules/docint/review.service.ts",
   "backend/libs/core/src/modules/orders/approvals.service.ts",
   "backend/libs/core/src/modules/orders/orders.spec.ts",
   "backend/libs/core/src/modules/warehouse/load-sheets.service.ts",
   "backend/libs/core/src/modules/warehouse/warehouse.spec.ts",
   "frontend/libs/api-client/src/errors.ts",
   "frontend/libs/api-client/src/react/index.tsx",
   "frontend/libs/api-client/src/react/refusal.test.ts",
   "frontend/manager-app/app/billing/credit-notes.tsx",
   "frontend/manager-app/app/inbound/documents.tsx",
   "frontend/manager-app/app/money/day-end.tsx",
   "frontend/manager-app/app/money/index.tsx",
   "frontend/manager-app/app/shops/index.tsx",
   "frontend/manager-app/src/lib/ui.tsx",
   "frontend/manager-app/src/strings.ts",
   "frontend/owner-app/app/money/receipts.tsx"
  ],
  "notes": "Rebase first: the money and day-end screens were changed by merged DOS-132/117, credit-notes.tsx by h8 (DOS-116), and documents.tsx and review.service.ts by h9 (DOS-031/037, merged d521f84). DOS-035: formatINR(paise()) like the manager home (reference only). DOS-036: an opening row plus debit/credit/balance columns from RetailerLedgerOutput (no contract change). DOS-038: name is the identity column. Pull the column set into a pure helper with a vitest (the load-out.test.ts pattern); kit list.tsx is unchanged. DOS-136: fix depositedAt, bouncedAt and the line uuidv7 values when the dialog opens, not inside the mutation run. Refetch after a network error, and map the idempotency 409 to a sentence. Repeat on Day-end and on owner receipts, where the O11 .then(done, done) confirms use Refusal from h13's owner refusal.tsx (h1-money-slice2 review). DOS-141: server refusal messages name the SO no, vehicle + date, approver name and IST time (no UUID, no ISO-Z). Both bounce dialogs refuse an empty reason locally through TextInput error. The 'idempotencyKey already used' step belongs to DOS-136. The four DOS-031 sign-off defects in documents.tsx (R1-R4) are not in the inventory and not in scope. Dialogs inside Sheets: iOS walk on the merged DOS-164. Walk web desk + phone and Android.",
  "db": "dos_test_b2_manager_money"
 },
 {
  "key": "lean-sales-rep",
  "app": "sales",
  "ids": [
   "DOS-086",
   "DOS-084",
   "DOS-142",
   "DOS-092",
   "DOS-088",
   "DOS-091",
   "DOS-093"
  ],
  "defer": [],
  "model": "opus",
  "after": [
   "lean-delivery-door",
   "lean-libs-offline-boot"
  ],
  "ownsFiles": [
   "docs/23-app-screens-and-api-gaps.md",
   "frontend/libs/offline/src/engine.test.ts",
   "frontend/libs/offline/src/engine.ts",
   "frontend/libs/offline/src/react.tsx",
   "frontend/owner-app/app/shops/index.tsx",
   "frontend/sales-app/app/index.tsx",
   "frontend/sales-app/app/orders/[id].tsx",
   "frontend/sales-app/app/orders/index.tsx",
   "frontend/sales-app/app/orders/new.tsx",
   "frontend/sales-app/app/shops/[id].tsx",
   "frontend/sales-app/app/shops/catalog.tsx",
   "frontend/sales-app/src/lib/dates.ts",
   "frontend/sales-app/src/lib/local.ts",
   "frontend/sales-app/src/lib/queue.ts",
   "frontend/sales-app/src/lib/ui.tsx",
   "frontend/sales-app/src/nav.ts",
   "frontend/sales-app/src/strings.ts"
  ],
  "notes": "DOS-086 builds on DOS-080 (h11 pull rewrite) and on lean-libs-offline-boot's engine changes. When the draft op is accepted, the device calls the online orders.submit with key `${id}:submit`. orders.sync stays draft-only, so orders.sync.ts is not edited. Expose the accepted-op signal through engine.ts/react.tsx, with an engine.test.ts case (both owned here). Android offline proof. DOS-084: pick the beat for the IST weekday from beat_assignments + beats.visit_days, which are already on the device (screen-only, no schema change). A manual chip sticks for the day (vitest). DOS-142: add cancel_reason to LocalOrder and render it. The pull already carries it (orders.module.ts unchanged); who cancelled is out of scope. DOS-092: cancelLabel 'Keep it' / 'Cancel the order' (DialogProps already has it; no kit change) and a 'say why' line for an empty reason. DOS-088: all live schemes, newest valid_from first. DOS-091: the backend already serves /invoices/{id} and /pdf to the salesperson. Add a bill-detail route modelled on retailer bills/[id].tsx (reference only), with copy that reads the sign of ageDays. Fix the stale docs/23 S12 line (docs/23 was also edited by h9 and h10). DOS-093: in the sales card, handle a 404 behaviour_not_computed as 'new shop'. In the owner shops panel, show '\u2014' as lastOrder already does, with no new owner string key: owner strings.ts belongs to h13 and the owner groups. The DOS-012 confirm sweep does not cover owner shops/index.tsx unless this group takes it with h13's refusal.tsx. The sign-off finding on 'Repeat last order' sorting by _local_rev is not in the inventory. Walk web and Pixel 7; iOS for DOS-091/092/093.",
  "db": "dos_test_b2_sales_rep"
 },
 {
  "key": "lean-warehouse-stock",
  "app": "warehouse",
  "ids": [
   "DOS-048",
   "DOS-121",
   "DOS-140",
   "DOS-049",
   "DOS-052",
   "DOS-072"
  ],
  "defer": [],
  "model": "opus",
  "after": [
   "lean-libs-offline-boot",
   "lean-warehouse-pick",
   "lean-sales-rep"
  ],
  "ownsFiles": [
   "backend/libs/core/src/modules/inventory/inventory.service.ts",
   "backend/libs/core/src/modules/inventory/inventory.spec.ts",
   "backend/libs/core/src/modules/inventory/stock.service.ts",
   "backend/libs/core/src/modules/notifications/messages.service.ts",
   "backend/libs/core/src/modules/notifications/notifications.spec.ts",
   "backend/libs/core/src/modules/retailers/retailers.mappers.ts",
   "backend/libs/core/src/modules/retailers/retailers.module.ts",
   "backend/libs/core/src/modules/retailers/retailers.service.ts",
   "backend/libs/core/src/modules/retailers/retailers.spec.ts",
   "backend/libs/core/src/modules/sync/sync.coverage.spec.ts",
   "docs/23-app-screens-and-api-gaps.md",
   "frontend/warehouse-app/app/load/[id].tsx",
   "frontend/warehouse-app/app/load/check-in.tsx",
   "frontend/warehouse-app/app/load/index.tsx",
   "frontend/warehouse-app/app/load/trips.tsx",
   "frontend/warehouse-app/app/pack/[orderId].tsx",
   "frontend/warehouse-app/app/settings.tsx",
   "frontend/warehouse-app/app/stock/index.tsx",
   "frontend/warehouse-app/src/strings.ts"
  ],
  "notes": "stock.service.ts, inventory.spec.ts and the W8 stock screen were changed by h9 (merged d521f84; DOS-044/037, founder default: only owner/manager add stock). DOS-140: only the raw sellable half is open; the rep/shop half shipped with merged DOS-074+097 (verdict (d), h4 merge review). Filter out damaged, in_transit and customer locations in stock.service.sellable, and keep vehicle rows when a vehicle locationId is asked (no view migration). DOS-048: read the product, batch and location names before the write (the transaction is already aborted after the constraint fires); keep lotId/locationId in data. DOS-121 is app-only: W7 counts van lots and sends countedVanStock (ConfirmLoadSheetInput already has it). Build the van-stock sheet fixture through the API in the walk. Do NOT edit warehouse.spec.ts or load-sheets.service.ts: lean-warehouse-pick and lean-manager-money own them, and lean-manager-money runs unordered with this group. DOS-049: hide per-order cartons until the crew count is keyed. DOS-052 + DOS-072 land together (same toView rule). Return the public retailer shape to warehouse and delivery (RetailerViewSchema is already a union; no contract change). Add a delivery omit on the retailers pull that keeps credit_mode; schemaHash changes and devices re-snapshot. The messages scope narrows the warehouse inbox. The creditCheck output and the retailer-role pull gaps stay out of scope. lean-kit-polish waits on this group because DOS-122 changes the W7 load-out confirm dialog. Walk web and Android.",
  "db": "dos_test_b2_warehouse_stock"
 },
 {
  "key": "lean-orders-panels",
  "app": "owner",
  "ids": [
   "DOS-010",
   "DOS-027",
   "DOS-130",
   "DOS-153",
   "DOS-155",
   "DOS-019"
  ],
  "defer": [],
  "model": "opus",
  "after": [
   "lean-libs-offline-boot",
   "lean-owner-desk",
   "lean-manager-money"
  ],
  "ownsFiles": [
   "frontend/manager-app/app/billing/index.tsx",
   "frontend/manager-app/app/orders/index.tsx",
   "frontend/manager-app/src/strings.ts",
   "frontend/owner-app/app/_layout.tsx",
   "frontend/owner-app/app/approvals.tsx",
   "frontend/owner-app/app/index.tsx",
   "frontend/owner-app/app/orders/index.tsx",
   "frontend/owner-app/src/strings.ts"
  ],
  "notes": "Owner + manager order and approval panels, all on screens rewritten by merged DOS-003 (variantName) and DOS-004 (approvals name shop, order and amount). DOS-010: put the shop into the identity cell on owner Orders, manager Confirmed orders and Billing desk rows. Do NOT make the kit render 'detail' (a shared-kit change). DOS-027: derive 'Waiting on' from orders.approvals.list pending (plus the shop-level credit_limit by retailer), with a pure helper test, not from stored approvalFlags. DOS-130: sum reservation qtyPcs across pages. DOS-153: clear the note on Sheet close or row change (owner) and on Dialog close (manager). DOS-155: on the last pending gate, say that it confirms the order and holds stock, then show a toast from DecideApprovalOutput.order; bargains decided outside a gate never confirm. DOS-019: take the Today count and the rail badge from the same live reads (bounded with '+'), not from the 15-minute owner_summary; no rollup.ts change. The manager decision dialog sits in a Sheet: iOS walk on the merged DOS-164. Walk web, Android, iOS.",
  "db": "dos_test_b2_orders_panels"
 },
 {
  "key": "lean-delivery-collect",
  "app": "delivery",
  "ids": [
   "DOS-062",
   "DOS-065",
   "DOS-067",
   "DOS-066",
   "DOS-071"
  ],
  "defer": [],
  "model": "opus",
  "after": [
   "lean-delivery-door",
   "lean-libs-offline-boot",
   "lean-owner-desk",
   "lean-warehouse-stock"
  ],
  "ownsFiles": [
   "backend/libs/contracts/src/delivery.ts",
   "backend/libs/core/src/modules/delivery/deliveries.service.ts",
   "backend/libs/core/src/modules/delivery/delivery.spec.ts",
   "backend/libs/core/src/modules/delivery/performance.ts",
   "backend/libs/core/src/modules/receivables/credit.ts",
   "backend/libs/core/src/modules/reporting/registers.service.ts",
   "backend/libs/core/src/modules/reporting/reporting.spec.ts",
   "backend/libs/database/src/seed-demo/delivery.ts",
   "frontend/delivery-app/app/expenses.tsx",
   "frontend/delivery-app/app/settings.tsx",
   "frontend/delivery-app/app/share/[invoiceId].tsx",
   "frontend/delivery-app/app/stop/[id]/collect.tsx",
   "frontend/delivery-app/app/stop/[id]/deliver.tsx",
   "frontend/delivery-app/app/stop/[id]/index.tsx",
   "frontend/delivery-app/app/trips.tsx",
   "frontend/delivery-app/src/lib/local.ts",
   "frontend/delivery-app/src/lib/queue.ts",
   "frontend/delivery-app/src/strings.ts"
  ],
  "notes": "WAITS FOR the architect designs of DOS-066 and DOS-071 (architectQueue); build DOS-062, DOS-065 and DOS-067 first inside the group. It waits for lean-backend-platform so the DOS-160 replay fix is on main before any additive output the designs bring. lean-warehouse-stock is a semantic wait: DOS-072 narrows what the crew device holds (credit_mode is kept), and DOS-066's door line may use only what remains (retailer_outstanding_summary overdue_paise/oldest_due_date + credit_mode). DOS-062 is app-only. RecordCollectionInput already takes explicit allocations (contracts delivery.ts:1038) and the output carries invoices[]. Tagging a bill sends allocations; show which bills the money went to, oldest first unless tagged (docs/22:178). The offline receipts op stays FIFO. DOS-065: messages.list with mine=true, receipts.list with tripId. DOS-067: label the KPI as on-time; a stop with no ETA is not late (reporting.spec). The trips list includes future-dated trips. Seed arrival times so the rate is not 0%, then re-run pnpm db:seed on dos_qa. DOS-071 items 2-3 (the stale 'photo required' text, the inert Record button) are app-only; item 1 (the expense proof rule) follows the design, with a delivery.spec.ts case. Walk web and Android.",
  "db": "dos_test_b2_delivery_collect"
 },
 {
  "key": "lean-admin-support",
  "app": "admin",
  "ids": [
   "DOS-110",
   "DOS-111",
   "DOS-113",
   "DOS-114"
  ],
  "defer": [],
  "model": "opus",
  "after": [
   "lean-owner-desk",
   "lean-orders-panels"
  ],
  "ownsFiles": [
   "backend/libs/contracts/src/tenancy.ts",
   "backend/libs/core/src/modules/platform-admin/console.service.ts",
   "backend/libs/core/src/modules/platform-admin/platform-admin.spec.ts",
   "backend/libs/core/src/modules/platform-admin/support-grants.ts",
   "backend/libs/core/src/modules/platform-admin/support.service.ts",
   "backend/libs/core/src/modules/tenancy/support.service.ts",
   "backend/libs/core/src/modules/tenancy/support.spec.ts",
   "backend/libs/core/src/service/support-audit.interceptor.ts",
   "backend/libs/database/src/seed-demo.test.ts",
   "backend/libs/database/src/seed-demo/platform-admin.ts",
   "backend/libs/database/src/seed-demo/tenants.ts",
   "backend/libs/database/src/seed.ts",
   "frontend/admin-app/app/distributors/[id].tsx",
   "frontend/admin-app/app/distributors/index.tsx",
   "frontend/admin-app/app/index.tsx",
   "frontend/admin-app/app/subscriptions.tsx",
   "frontend/admin-app/app/support.tsx",
   "frontend/admin-app/app/users.tsx",
   "frontend/admin-app/src/lib/subscription.tsx",
   "frontend/admin-app/src/lib/support.tsx",
   "frontend/admin-app/src/lib/ui.tsx",
   "frontend/admin-app/src/strings.ts",
   "frontend/owner-app/app/settings/audit.tsx",
   "frontend/owner-app/app/settings/index.tsx",
   "frontend/owner-app/src/lib/ui.tsx",
   "frontend/owner-app/src/strings.ts"
  ],
  "notes": "Four items (size exception): the admin app has few findings, and DOS-112 sits in lean-backend-platform with the other central platform change. DOS-110 WAITS FOR its lean design. The DOS-108 verdict direction: statusOf() derives lapsed on both services, lapsed is excluded from openOnly and status=requested, and READMEs are regenerated. Then delete the askLapsed copies in admin-app and in the owner app (DOS-108 amendment (c)). Contracts tenancy.ts is owned for that design. Build DOS-111, DOS-113 and DOS-114 first. Starts after h10 (4201823 already edits platform-admin support.service.ts and support-audit.interceptor.ts; DOS-114 and DOS-111 build on DOS-109's actor names and DOS-107's unlock). Also after h13 (DOS-108's support-card panels, which DOS-111's read list hangs under). DOS-111: a second insert into the tenant audit_log from support-audit.interceptor under withSystem (no migration). The owner reads it through tenancy.audit.list under the grant, labelled by role or requestedByName. DOS-113: the seed upserts one plan into both columns, and the detail page shows the subscription plan once (seed-demo.test; re-run pnpm db:seed on dos_qa). DOS-114: no entityId '' audit query after hand-back (use useQuery's existing enabled option; no api-client change), a count-aware plural, a name-ordered users keyset on the existing string cursor, and a Subscriptions row that opens the plan dialog. Walk web and Android.",
  "db": "dos_test_b2_admin_support"
 },
 {
  "key": "lean-sales-orders-pricing",
  "app": "sales",
  "ids": [
   "DOS-079",
   "DOS-083",
   "DOS-078",
   "DOS-081",
   "DOS-087",
   "DOS-090"
  ],
  "defer": [],
  "model": "opus",
  "after": [
   "lean-manager-money",
   "lean-sales-rep",
   "lean-orders-panels",
   "lean-delivery-collect",
   "lean-admin-support"
  ],
  "ownsFiles": [
   "backend/libs/contracts/src/orders.ts",
   "backend/libs/contracts/src/pricing.ts",
   "backend/libs/contracts/src/receivables.ts",
   "backend/libs/core/src/modules/billing/billing.internals.ts",
   "backend/libs/core/src/modules/billing/billing.spec.ts",
   "backend/libs/core/src/modules/orders/orders.internals.ts",
   "backend/libs/core/src/modules/orders/orders.service.ts",
   "backend/libs/core/src/modules/orders/orders.spec.ts",
   "backend/libs/core/src/modules/orders/orders.sync.ts",
   "backend/libs/core/src/modules/orders/pricing-lines.ts",
   "backend/libs/core/src/modules/pricing/bargains.service.ts",
   "backend/libs/core/src/modules/pricing/pricing.spec.ts",
   "backend/libs/core/src/modules/pricing/quote.service.ts",
   "backend/libs/core/src/modules/receivables/credit.ts",
   "backend/libs/database/migrations/meta/_journal.json",
   "backend/libs/database/src/schema/orders.ts",
   "backend/libs/database/src/schema/pricing.ts",
   "backend/libs/database/src/seed-demo/pricing.ts",
   "backend/libs/domain/src/pricing/schemes.test.ts",
   "backend/libs/domain/src/pricing/schemes.ts",
   "docs/22-source-of-truth.md",
   "docs/adr/0008-pricing-engine.md",
   "frontend/libs/ui/src/qty.ts",
   "frontend/manager-app/app/orders/index.tsx",
   "frontend/manager-app/src/strings.ts",
   "frontend/owner-app/app/approvals.tsx",
   "frontend/owner-app/src/strings.ts",
   "frontend/sales-app/app/orders/new.tsx",
   "frontend/sales-app/app/shops/[id].tsx",
   "frontend/sales-app/src/lib/pricing.ts",
   "frontend/sales-app/src/strings.ts"
  ],
  "notes": "WAITS FOR the architect designs of DOS-078, DOS-079, DOS-081, DOS-087 and DOS-090. Build DOS-079 before DOS-083 (DOS-083 dependsOn DOS-079). DOS-096's quote deliberately left cess out, so extend that one GST path, never a second pricing engine. pricing.spec.ts and billing.spec.ts prove that a fully packed invoice equals the order total. A migration takes the next free index from _journal.json, with a hand-written guarantees sibling only if grants or policies change; regenerate READMEs after contract changes. Owner and manager strings.ts are owned for the approval-kind and credit-notice wording on owner approvals.tsx and manager orders/index.tsx. That is why this group waits on lean-admin-support, which also owns owner strings. qty.ts (DOS-078), receivables.ts (DOS-081) and schema/pricing.ts (DOS-087) are owned for the designs. DOS-081's rep-side 'held for credit' sentence can be built before the manager-notice decision. The DOS-126 founder defaults apply: confirm applies only rates approved since the draft, and a shop's standalone approved rate is charged at confirm. The docs/22 \u00a78/\u00a711 rows for these decisions are written in-slice; the main session renders and republishes. DOS-087's seed rename or new rule: re-run pnpm db:seed on dos_qa. The DOS-126 sign-off finding (standalone bargains never expire) is not in the inventory. Walk web and Android; iOS for DOS-090's rep flow.",
  "db": "dos_test_b2_sales_orders_pricing"
 },
 {
  "key": "lean-owner-money-approvals",
  "app": "owner",
  "ids": [
   "DOS-006",
   "DOS-013",
   "DOS-014",
   "DOS-016",
   "DOS-011",
   "DOS-033"
  ],
  "defer": [],
  "model": "opus",
  "after": [
   "lean-owner-desk",
   "lean-manager-money",
   "lean-warehouse-stock",
   "lean-orders-panels",
   "lean-delivery-collect",
   "lean-admin-support",
   "lean-sales-orders-pricing"
  ],
  "ownsFiles": [
   "backend/libs/contracts/src/pricing.ts",
   "backend/libs/contracts/src/receivables.ts",
   "backend/libs/contracts/src/reporting.ts",
   "backend/libs/core/src/modules/orders/approvals.service.ts",
   "backend/libs/core/src/modules/orders/orders.internals.ts",
   "backend/libs/core/src/modules/orders/orders.service.ts",
   "backend/libs/core/src/modules/orders/orders.spec.ts",
   "backend/libs/core/src/modules/pricing/pricing.service.ts",
   "backend/libs/core/src/modules/pricing/pricing.spec.ts",
   "backend/libs/core/src/modules/receivables/outstanding.ts",
   "backend/libs/core/src/modules/receivables/receivables.service.ts",
   "backend/libs/core/src/modules/receivables/receivables.spec.ts",
   "backend/libs/core/src/modules/reporting/register-specs.ts",
   "backend/libs/core/src/modules/reporting/registers.service.ts",
   "backend/libs/core/src/modules/reporting/renderers.ts",
   "backend/libs/core/src/modules/reporting/reporting.service.ts",
   "backend/libs/core/src/modules/reporting/reporting.spec.ts",
   "backend/libs/core/src/modules/reporting/rollup.ts",
   "backend/libs/core/src/modules/retailers/retailers.service.ts",
   "backend/libs/database/migrations/meta/_journal.json",
   "backend/libs/database/src/schema/reporting.ts",
   "backend/libs/database/src/seed-demo/reporting.ts",
   "frontend/manager-app/app/money/index.tsx",
   "frontend/manager-app/app/orders/index.tsx",
   "frontend/owner-app/app/approvals.tsx",
   "frontend/owner-app/app/index.tsx",
   "frontend/owner-app/app/money/index.tsx",
   "frontend/owner-app/app/money/receipts.tsx",
   "frontend/owner-app/app/orders/index.tsx",
   "frontend/owner-app/app/prices/index.tsx",
   "frontend/owner-app/app/reports/exports.tsx",
   "frontend/owner-app/src/lib/ui.tsx",
   "frontend/owner-app/src/strings.ts"
  ],
  "notes": "WAITS FOR the architect designs of DOS-006, DOS-011 (which also decides DOS-033), DOS-013, DOS-014 and DOS-016. DOS-004 and DOS-003 are merged (DOS-006 and DOS-013 depended on them). DOS-013 reuses the tenant-catalog variantNames export that DOS-003 added (reference; do not edit tenant-catalog/index.ts). DOS-033 is fixed by DOS-011's additive settled-bill read; the per-allocation invoices.get fallback is the N+1 read DOS-004's design refused. DOS-016: DOS-117 (nightly ageing) and DOS-007 are merged. The net-vs-gross answer must reconcile with Books > Trial balance AR and keep the rollup.ts dues-block precedence (DOS-117 amendment (e)). Any schema/reporting.ts column takes the next _journal.json index. DOS-014: ExportButton needs polling until the job is ready (useQuery has no refetch interval); register specs go in reporting.spec.ts. Any additive output field is exposed to the DOS-160 replay 500 unless lean-backend-platform's DOS-160 fix is merged first; that group is ordered earlier and waited on. Seed change (DOS-006 requestedLimitPaise): re-run pnpm db:seed on dos_qa. Walk web and Android.",
  "db": "dos_test_b2_owner_money_approvals"
 },
 {
  "key": "lean-manager-order-lifecycle",
  "app": "manager",
  "ids": [
   "DOS-009",
   "DOS-145",
   "DOS-139",
   "DOS-138",
   "DOS-030"
  ],
  "defer": [],
  "model": "opus",
  "after": [
   "lean-delivery-door",
   "lean-libs-offline-boot",
   "lean-owner-desk",
   "lean-warehouse-pick",
   "lean-manager-money",
   "lean-orders-panels",
   "lean-sales-orders-pricing",
   "lean-owner-money-approvals",
   "lean-warehouse-stock"
  ],
  "ownsFiles": [
   "backend/libs/contracts/src/billing.ts",
   "backend/libs/contracts/src/docint.ts",
   "backend/libs/core/src/modules/billing/billing.spec.ts",
   "backend/libs/core/src/modules/billing/invoices.service.ts",
   "backend/libs/core/src/modules/delivery/delivery.spec.ts",
   "backend/libs/core/src/modules/delivery/trips.service.ts",
   "backend/libs/core/src/modules/docint/docint.spec.ts",
   "backend/libs/core/src/modules/docint/documents.service.ts",
   "backend/libs/core/src/modules/orders/orders.internals.ts",
   "backend/libs/core/src/modules/orders/orders.service.ts",
   "backend/libs/core/src/modules/orders/orders.spec.ts",
   "backend/libs/core/src/modules/warehouse/picklists.service.ts",
   "backend/libs/core/src/modules/warehouse/warehouse.spec.ts",
   "backend/libs/database/migrations/meta/_journal.json",
   "backend/libs/database/src/schema/billing.ts",
   "backend/libs/database/src/schema/orders.ts",
   "backend/libs/database/src/schema/warehouse.ts",
   "backend/libs/domain/src/state-machines/order.ts",
   "backend/libs/domain/src/state-machines/state-machines.test.ts",
   "docs/22-source-of-truth.md",
   "frontend/manager-app/app/_layout.tsx",
   "frontend/manager-app/app/billing/brand-dms.tsx",
   "frontend/manager-app/app/billing/index.tsx",
   "frontend/manager-app/app/inbound/documents.tsx",
   "frontend/manager-app/app/orders/index.tsx",
   "frontend/manager-app/app/registers/index.tsx",
   "frontend/manager-app/src/strings.ts",
   "frontend/owner-app/app/orders/index.tsx",
   "frontend/owner-app/src/strings.ts",
   "frontend/warehouse-app/app/pick/[id].tsx",
   "frontend/warehouse-app/src/strings.ts"
  ],
  "notes": "WAITS FOR the architect designs of DOS-009, DOS-030, DOS-138 and DOS-139. DOS-145 is grouped here because its newest-first bill register and cursor must use the sort key and (date, id) cursor convention that DOS-009's design picks (DOS-133 used created_at desc, id desc with a row-value cursor). Its global-search routing half is app-only. DOS-139: run the P1 re-bill probe first (reloading or re-billing after cancel could double-sell after DOS-039); if it reproduces, stop and escalate to the full P1 process. DOS-138's interim fix (hide Cancel on picking/packed orders and state the route) needs no design and may ship if the design keeps docs/22's 'cancel up to confirmed'. Put-back lines on W5 pick/[id].tsx use warehouse strings.ts and the warehouse.spec.ts picklist cases, and the owner Orders wording uses owner strings.ts; that is why this group waits on lean-warehouse-stock. DOS-030: an app-only stopgap (hide Book for brand_dms documents, with a reason) can ship first; h9-desk (DOS-031/037, merged) edited the same documents.tsx block. Index or column migrations take the next free _journal.json index. The docs/22 \u00a74/\u00a78 rows for DOS-138/139 are written in-slice; the main session renders and republishes. Cancel dialogs inside Sheets: iOS walk on the merged DOS-164. Walk web and Android.",
  "db": "dos_test_b2_manager_order_lifecycle"
 },
 {
  "key": "lean-retailer-platform",
  "app": "retailer",
  "ids": [
   "DOS-100",
   "DOS-102",
   "DOS-103",
   "DOS-104",
   "DOS-125"
  ],
  "defer": [],
  "model": "opus",
  "after": [
   "lean-warehouse-stock",
   "lean-admin-support",
   "lean-sales-orders-pricing",
   "lean-owner-money-approvals",
   "lean-manager-order-lifecycle"
  ],
  "ownsFiles": [
   "backend/libs/contracts/src/auth.ts",
   "backend/libs/contracts/src/catalog.ts",
   "backend/libs/contracts/src/notifications.ts",
   "backend/libs/contracts/src/permissions.ts",
   "backend/libs/contracts/src/pricing.ts",
   "backend/libs/contracts/src/tenancy.ts",
   "backend/libs/core/src/modules/auth/auth.controller.ts",
   "backend/libs/core/src/modules/auth/auth.service.ts",
   "backend/libs/core/src/modules/auth/auth.spec.ts",
   "backend/libs/core/src/modules/notifications/events.ts",
   "backend/libs/core/src/modules/notifications/inbound.service.ts",
   "backend/libs/core/src/modules/notifications/notifications.spec.ts",
   "backend/libs/core/src/modules/orders/orders.mappers.ts",
   "backend/libs/core/src/modules/pricing/pricing.spec.ts",
   "backend/libs/core/src/modules/pricing/quote.service.ts",
   "backend/libs/core/src/modules/receivables/outstanding.ts",
   "backend/libs/core/src/modules/tenant-catalog/tenant-catalog.service.ts",
   "backend/libs/database/migrations/meta/_journal.json",
   "backend/libs/database/src/rls.test.ts",
   "backend/libs/database/src/schema/notifications.ts",
   "backend/libs/database/src/seed-demo/notifications.ts",
   "backend/libs/database/src/tenant-bootstrap.ts",
   "frontend/libs/ui/package.json",
   "frontend/libs/ui/src/native/charts.tsx",
   "frontend/libs/ui/src/parity.test.ts",
   "frontend/libs/ui/src/platform/links.web.ts",
   "frontend/libs/ui/src/platform/types.ts",
   "frontend/libs/ui/src/types.ts",
   "frontend/libs/ui/src/web/charts.tsx",
   "frontend/owner-app/app/settings/index.tsx",
   "frontend/owner-app/src/strings.ts",
   "frontend/pnpm-lock.yaml",
   "frontend/pnpm-workspace.yaml",
   "frontend/retailer-app/app/bills/[id].tsx",
   "frontend/retailer-app/app/dues.tsx",
   "frontend/retailer-app/app/index.tsx",
   "frontend/retailer-app/app/order.tsx",
   "frontend/retailer-app/app/orders/[id].tsx",
   "frontend/retailer-app/app/pay.tsx",
   "frontend/retailer-app/app/returns.tsx",
   "frontend/retailer-app/app/sign-in.tsx",
   "frontend/retailer-app/src/strings.ts"
  ],
  "notes": "WAITS FOR the architect designs of all five items (contracts, permissions, schema, kit types.ts). permissions.ts is edited by h9 (merged) and h10 (admin rows, uncommitted in 4201823): rebase. Every new route needs a PERMISSIONS row plus the describePermissionMatrix spec. ADR 0006 keeps the credit limit off the retailer app (CREDIT_CHECKERS excludes retailer), so DOS-100's 'credit left' part must respect it; the on-order hold sentence needs no contract change. DOS-102's cross-tenant memberships summary is an auth-service read, with the module boundary and host service set by the design; never switchTenant behind the user's back. DOS-103 adds a retailer write path. Extend backend/libs/database/src/rls.test.ts for any new role-restricted table or policy, and never join retailer_identities from a tenant table (42P17). A new table takes the next _journal.json index plus its FORCE RLS line. The owner setting label uses owner strings.ts, which is why this group waits on lean-manager-order-lifecycle. DOS-104 must not create a second pricing path: priceOrder stays the only engine, with a parity case in pricing.spec.ts. DOS-125: a new kit QR component in types.ts, with web and native renderers on react-native-svg (already in the catalog), parity.test.ts, and a static web hint (links.web.open always reports true). If the design needs a QR encoder dependency, it goes through frontend/pnpm-workspace.yaml, libs/ui package.json and pnpm-lock.yaml; this group owns them and comes after lean-libs-offline-boot and lean-owner-desk. Seed change (DOS-100 template): re-run pnpm db:seed on dos_qa. Walk web, Android, iOS (R2 and pay).",
  "db": "dos_test_b2_retailer_platform"
 },
 {
  "key": "lean-warehouse-rules",
  "app": "warehouse",
  "ids": [
   "DOS-045",
   "DOS-050",
   "DOS-054"
  ],
  "defer": [],
  "model": "opus",
  "after": [
   "lean-warehouse-pick",
   "lean-warehouse-stock",
   "lean-admin-support",
   "lean-manager-order-lifecycle",
   "lean-retailer-platform"
  ],
  "ownsFiles": [
   "backend/libs/contracts/src/inventory.ts",
   "backend/libs/contracts/src/procurement.ts",
   "backend/libs/contracts/src/tenancy.ts",
   "backend/libs/contracts/src/warehouse.ts",
   "backend/libs/core/src/modules/inventory/cycle-counts.service.ts",
   "backend/libs/core/src/modules/inventory/inventory.service.ts",
   "backend/libs/core/src/modules/inventory/inventory.spec.ts",
   "backend/libs/core/src/modules/procurement/grn.service.ts",
   "backend/libs/core/src/modules/procurement/procurement.spec.ts",
   "backend/libs/core/src/modules/warehouse/picklists.service.ts",
   "backend/libs/core/src/modules/warehouse/warehouse.spec.ts",
   "backend/libs/database/migrations/meta/_journal.json",
   "backend/libs/database/src/tenant-bootstrap.ts",
   "frontend/manager-app/app/inbound/gate.tsx",
   "frontend/owner-app/app/settings/index.tsx",
   "frontend/owner-app/src/strings.ts",
   "frontend/warehouse-app/app/index.tsx",
   "frontend/warehouse-app/app/pack/[orderId].tsx",
   "frontend/warehouse-app/app/pack/index.tsx",
   "frontend/warehouse-app/app/pick/[id].tsx",
   "frontend/warehouse-app/app/stock/counts/[id].tsx",
   "frontend/warehouse-app/app/stock/reservations.tsx",
   "frontend/warehouse-app/src/strings.ts"
  ],
  "notes": "Three items (size exception): all three need contract decisions and share files with every other warehouse group, so they run last in the warehouse chain. WAITS FOR the architect designs of DOS-045, DOS-050 and DOS-054. h9 (DOS-044/037, merged d521f84) changed contracts inventory.ts/procurement.ts, cycle-counts.service.ts, grn.service.ts and the stock specs: rebase. DOS-045: the warehouse reply must carry no expected figure or variance, while the manager gate still reads expectedQtyPcs. DOS-050: GRN rows for the warehouse carry the supplier name and bill number but never cost (purchase cost stays behind back-office RLS). Verify the reservations orderNo rendering first; new row words go in warehouse strings.ts. DOS-054: contracts warehouse.ts says 'FEFO warns, it never blocks' (design R03), so the shelf-life rule follows the design. The owner sets it in owner settings/index.tsx and owner strings.ts (reworked by h13 DOS-108), and picking obeys it (warehouse.spec.ts). A column or setting migration takes the next free _journal.json index. Walk web and Android.",
  "db": "dos_test_b2_warehouse_rules"
 },
 {
  "key": "lean-kit-polish",
  "app": "kit/libs",
  "ids": [
   "DOS-122",
   "DOS-069",
   "DOS-150"
  ],
  "defer": [],
  "model": "sonnet",
  "after": [
   "lean-owner-desk",
   "lean-warehouse-stock"
  ],
  "ownsFiles": [
   "frontend/libs/ui/src/money.test.ts",
   "frontend/libs/ui/src/native/feedback.tsx",
   "frontend/libs/ui/src/native/money.tsx",
   "frontend/libs/ui/src/native/shell.tsx",
   "frontend/libs/ui/src/strings.ts",
   "frontend/libs/ui/src/tokens.ts",
   "frontend/libs/ui/src/web/feedback.tsx",
   "frontend/libs/ui/src/web/render.test.tsx",
   "frontend/libs/ui/src/web/viewport.ts"
  ],
  "notes": "P3-only: three kit layout and accessibility-label fixes with no types.ts, contract, logic or money change. Sonnet builder, Opus verifier. Size exception: DOS-158 and DOS-159 moved to lean-kit-overlays (one is a behaviour bug, the other must land with DOS-152). These three cannot join that Opus group without making it wait for the money.tsx and tokens.ts owners. Build on the DOS-164 overlay host (merged 146eed2) and on lean-kit-overlays' Sheet and Button changes. DOS-069: a safe-area inset for the RupeeInput pad Modal. Check on device that the insets context reaches inside an RN Modal. Do not move the pad into the overlay stack; that is the DOS-164 sign-off hazard, which is not in the inventory. DOS-150: an accessibilityLabel on Money's null branch ('not entered', a new kit string), reusing DOS-158's fix for the same Fabric prop-retention class. DOS-122: below 1024 px, stack web Dialog buttons full-width at touch size, keyed on theme.touch because the SSR snapshot is desk. This changes every web app's dialogs at phone width, including the W7 load-out confirm that DOS-121 (lean-warehouse-stock, waited on) touches. There is no native render harness. Prove DOS-069 and DOS-150 with uiautomator dumps and screenshots on Pixel_7_API_36 (-memory 3072) and simctl screenshots on iOS. Prove DOS-122 with render.test.tsx plus a web 390x844 measurement.",
  "db": "dos_test_b2_kit_polish"
 }
]

const LIMITS = `WHAT THIS RUN MAY NOT DO — the founder's standing rules:
- Never touch the founder's own databases: dos and dos_qa. Your lane has its own copy and nothing else.
- Never force-push, reset --hard, rebase or delete a branch; never rewrite a commit that exists on main.
- Never weaken a test, a validation or a permission to make something pass.
- Never report a command you did not run or an outcome you did not see.`

const RULES = `PRODUCT RULES: backend modules talk only through index.ts exports or outbox events; wire shapes only in backend/libs/contracts; PERMISSIONS is the single matrix; every mutation idempotent with a client UUIDv7 id; states change only through machine.next(); ledgers append-only and journals balance at commit; money integer paise, quantities integer pieces; tenant data only through withTenant; /sync/upload never answers 4xx; screens import only @dos/ui, never react-native or react-dom; universal apps (web + Android + iOS from one codebase).
QA CHARTER: implement exactly the signed-off design; red-first tests named with the finding id; an existing test changes only where the design says so.`

const RESULT = { type: 'object', required: ['group', 'status', 'itemsDone', 'itemsSkipped', 'commits', 'filesChanged', 'deviations', 'followUps'], properties: {
  group: { type: 'string' }, status: { type: 'string', enum: ['fixed', 'partial', 'blocked'] },
  itemsDone: { type: 'array', items: { type: 'object', required: ['id', 'failBefore', 'passAfter', 'test'], properties: { id: { type: 'string' }, failBefore: { type: 'string' }, passAfter: { type: 'string' }, test: { type: 'string' } } } },
  itemsSkipped: { type: 'array', items: { type: 'object', required: ['id', 'why'], properties: { id: { type: 'string' }, why: { type: 'string' } } } },
  commits: { type: 'array', items: { type: 'string' } }, filesChanged: { type: 'array', items: { type: 'string' } },
  deviations: { type: 'string' }, followUps: { type: 'string' } } }

const VERDICT = { type: 'object', required: ['group', 'verdict', 'itemsChecked', 'problems', 'evidence'], properties: {
  group: { type: 'string' }, verdict: { type: 'string', enum: ['pass', 'fail'] },
  itemsChecked: { type: 'array', items: { type: 'object', required: ['id', 'redProven', 'greenProven', 'detail'], properties: { id: { type: 'string' }, redProven: { type: 'boolean' }, greenProven: { type: 'boolean' }, detail: { type: 'string' } } } },
  problems: { type: 'array', items: { type: 'object', required: ['severity', 'file', 'detail'], properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, file: { type: 'string' }, detail: { type: 'string' } } } },
  evidence: { type: 'string' } } }

const REVIEW = { type: 'object', required: ['decision', 'blockers', 'minors', 'conflicts', 'walks', 'unfiledDefects'], properties: {
  decision: { type: 'string', enum: ['MERGE', 'MERGE AFTER FIXES', 'DO NOT MERGE'] }, blockers: { type: 'array', items: { type: 'string' } }, minors: { type: 'array', items: { type: 'string' } },
  conflicts: { type: 'array', items: { type: 'string' } }, walks: { type: 'array', items: { type: 'string' } }, unfiledDefects: { type: 'array', items: { type: 'string' } } } }

const PREP = { type: 'object', required: ['status', 'worktree', 'branch', 'base', 'notes'], properties: {
  status: { type: 'string', enum: ['ready', 'blocked'] }, worktree: { type: 'string' }, branch: { type: 'string' }, base: { type: 'string' }, notes: { type: 'string' } } }
const INTEG = { type: 'object', required: ['status', 'headCommit', 'conflicts', 'fixes', 'testsRun', 'notes'], properties: {
  status: { type: 'string', enum: ['ready', 'blocked'] }, headCommit: { type: 'string' }, conflicts: { type: 'array', items: { type: 'string' } },
  fixes: { type: 'array', items: { type: 'string' } }, testsRun: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } } }
const IVERDICT = { type: 'object', required: ['verdict', 'problems', 'evidence'], properties: {
  verdict: { type: 'string', enum: ['pass', 'fail'] }, evidence: { type: 'string' },
  problems: { type: 'array', items: { type: 'object', required: ['severity', 'detail'], properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, detail: { type: 'string' } } } } } }
const MERGED = { type: 'object', required: ['status', 'mainHead', 'pushed', 'notes'], properties: { status: { type: 'string', enum: ['merged', 'blocked'] }, mainHead: { type: 'string' }, pushed: { type: 'boolean' }, notes: { type: 'string' } } }

const wt = (g) => MAIN + '/.claude/worktrees/b2-' + g.key
const branchOf = (g) => 'qa/b2-' + g.key
const build = (g) => g.ids.filter((id) => !g.defer.includes(id))

const blocks = (g) => build(g).map((id) => `n=$(grep -n '^### ${id} ' "${FIND}" | head -1 | cut -d: -f1); if [ -n "$n" ]; then sed -n "$n,\\$p" "${FIND}" | awk 'NR>1 && /^### DOS-/{exit} {print}'; else grep -n '^| ${id} ' "${FIND}"; fi`).join(' ; ')

const env = (g) => `ENVIRONMENT — read carefully:
- Your worktree is "${wt(g)}" on branch ${branchOf(g)}. Start EVERY Bash command with: cd "${wt(g)}" && export PATH=/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/bin:$PATH && eval "$(fnm env)" && fnm use 24 >/dev/null && export DATABASE_POOL_MAX=3 && export DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/${g.db}
- NEVER edit, commit, reset or checkout anything in the main checkout "${MAIN}" or in another worktree — other groups are live there. You MAY READ ${MAIN}/QA/.
- Database: ${g.db} is a copy of dos_test_batch2b_template; you may drop and recreate ONLY it. Never connect to dos, dos_qa or a template.
- 8 GB RAM shared with other agents: ONE spec or test file per command unless a step names a wider gate; typecheck and lint only the packages you touched.
- Libraries are consumed from dist: after editing @dos/contracts or @dos/core rebuild them (cd backend && pnpm exec turbo run build --filter=<pkg>...).
- No git stash, reset --hard, rebase, push or branch deletion.
- Do NOT start dev servers, emulators or simulators. Do NOT edit docs/22, docs/18, CLAUDE.md or anything under QA/.
- THIS GROUP OWNS THESE FILES; another group owns every other file. Staying inside them is what keeps 16 lanes mergeable:
${g.ownsFiles.map((f) => "  " + f).join("\n")}`

const preparePrompt = (g) => `Prepare an isolated lane for Distribution OS QA batch 2, lean group ${g.key}. Mechanical setup only — write no product code.

${LIMITS}

1. cd "${MAIN}" && git rev-parse --short main — record it as the base.
2. If "${wt(g)}" does not exist: git -C "${MAIN}" worktree add -b ${branchOf(g)} "${wt(g)}" main. If it exists, cd into it, confirm the branch is ${branchOf(g)} and git merge --ff-only main (return blocked if it cannot fast-forward).
3. Database: dropdb -h 127.0.0.1 -p 5439 -U dos --force ${g.db} 2>/dev/null; createdb -h 127.0.0.1 -p 5439 -U dos -T dos_test_batch2b_template ${g.db}
4. In the worktree: printf 'DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/${g.db}\n' > backend/.env.local if the repo uses one, else make sure backend/.env in THIS worktree points at ${g.db} and nothing else.
5. cd backend && pnpm install && pnpm exec turbo run build --filter='./libs/*' && pnpm db:migrate ; cd ../frontend && pnpm install
6. git status --short must be clean apart from the .env you pointed at your own database. Return the structured result.`

const implPrompt = (g) => `You are fixing a batch of small, already-triaged defects in Distribution OS, in an isolated worktree, as a careful senior engineer. Group: ${g.key} (${g.app}). Items: ${build(g).join(", ")}.

${env(g)}

${RULES}

${LIMITS}

${g.defer.length ? "DO NOT BUILD these items — their design still waits on a founder answer: " + g.defer.join(", ") + ". Leave their code untouched and list them in itemsSkipped." : ""}
${g.notes ? "GROUP NOTES from the planner: " + g.notes : ""}

INPUTS (read all before editing):
  cat "${VERD}/lean-${g.key}.md"   # the Fable design for this group; binding
  ${blocks(g)}
Re-read every source file before editing: main has moved a long way since the designs were written.

For EACH item, in the order listed:
STEP 1: write the red-first test the design names (its name carries the finding id), run it, and confirm it FAILS for the design's reason. Keep the excerpt.
STEP 2: make the smallest fix that turns it green, inside this group's own files.
STEP 3: run that test file whole, then typecheck and lint the packages you touched; prettier --write on touched files.
STEP 4: commit that item alone: "fix(<ID>): <one line>" + two sentences + "Test: <file> › <name>" + ${CO}.
If an item's design is wrong once you read the code, fix the real cause and say so in deviations. If an item cannot be done without leaving this group's files, skip it and say why — do not reach into another group's files.
Finish with git status clean and return the structured result.`

const verifyPrompt = (g, impl) => `You are the adversarial verifier of lean group ${g.key} for Distribution OS. Assume every item is wrong until proven right. You make no commits.

${env(g)}

${RULES}

${LIMITS}

Implementer report:
${JSON.stringify(impl, null, 1)}

Design and findings:
  cat "${VERD}/lean-${g.key}.md"
  ${blocks(g)}

1. git log --oneline main..HEAD — one commit per item, and no file outside this group's owned list.
2. PROVE RED, per item commit C: git diff C^ C -- . ':(exclude)**/*.spec.ts' ':(exclude)**/*.test.ts' ':(exclude)**/*.test.tsx' ':(exclude)**/pnpm-lock.yaml' ':(exclude)**/package.json' ':(exclude)docs/**' ':(exclude)**/README.md' | git apply -R ; rebuild any affected library; run that item's test and confirm it FAILS for the finding's reason; restore with git checkout -- . , delete untracked leftovers, rebuild.
3. PROVE GREEN: each item's test, then every whole test file the group touched.
4. Hunt: a test weakened rather than a fix made; an assertion that would pass with the bug still present; a fix outside the owned files; a screen importing react-native or react-dom; money not in paise; a mutation without idempotency; a permission or validation relaxed; a deferred item built anyway.
5. git status clean at the end.
verdict 'pass' only when every built item was red before and green after and no blocker or major remains.`

const repairPrompt = (g, impl, v) => `You are repairing lean group ${g.key} for Distribution OS after an adversarial review.

${env(g)}

${RULES}

${LIMITS}

Implementer report: ${JSON.stringify(impl, null, 1)}
Verifier verdict: ${JSON.stringify(v, null, 1)}

Fix every blocker and major with NEW commits "fix(<ID>): address review — <short>" (${CO}); never rewrite history. Re-run the affected tests, the whole touched test files, typecheck and lint. git status clean. Return the updated structured result.`

const reviewPrompt = (g, built) => `You are Fable, the ARCHITECT of the Distribution OS QA programme. Review one lean group before it merges into main. Read-only: edit nothing except the ONE output file below; run no builds, tests or git writes; do not touch .claude/worktrees.

GROUP ${g.key} (${g.app}), branch ${branchOf(g)}:
  git -C "${MAIN}" log --oneline main..${branchOf(g)} ; git -C "${MAIN}" diff main...${branchOf(g)}
Design and findings:
  cat "${VERD}/lean-${g.key}.md"
  ${blocks(g)}
Build reports: ${JSON.stringify(built, null, 1)}
${g.defer.length ? "Items deliberately NOT built (awaiting a founder answer): " + g.defer.join(", ") + ". Their absence is correct; say so rather than raising it." : ""}

Judge: the fix matches the design and the product rules; the tests would fail without the fix and are not weakened; nothing leaked outside this group's owned files; conflicts with main now and with the groups still to merge; which platform walks (web, Android, iOS) this group still needs; any real defect you see outside the group, with file:line.
Be adversarial — you are the last reader before main.

Write ${REV}/${g.key}.md (under 80 lines: **Decision:** MERGE | MERGE AFTER FIXES | DO NOT MERGE; Blockers with file:line and the exact fix; Minors; Conflicts; Walks; Defects outside) and return the structured summary.`

const integratePrompt = (g, repairOf) => `You are the INTEGRATOR of lean group ${g.key} for Distribution OS. Merge main into the lane, resolve every review blocker, prove the merged tree green and commit. You do NOT merge into main.

${env(g)}
- INTEGRATOR git: you may merge main INTO ${branchOf(g)}, use checkout --ours/--theirs while resolving, and merge --abort.

${RULES}

${LIMITS}

REVIEW (binding): cat "${REV}/${g.key}.md"
Every Blocker there was raised against the branch AS REVIEWED: a commit that already existed when the review was written is NEVER its fix. Resolve each with a new commit — a test that fails for the blocker's reason, then the fix — or return blocked with the reason.
STEPS:
1. git merge main -m "Merge main into ${branchOf(g)} before merging it back" (resolve keeping both sides; merge --abort and return blocked if a conflict is not explained by this group).
2. cd backend && pnpm install && pnpm exec turbo run build --filter='./libs/*'; recreate ${g.db} from the template and pnpm db:migrate; cd ../frontend && pnpm install (commit a changed lockfile).
3. The review blockers, as above; apply a minor only when it is one line inside this group's files.
4. Gates on the merged tree:
   - backend, if touched: every spec file the group touched (one per command); pnpm --filter @dos/core exec vitest run src/docs/examples.spec.ts; the service spec of every service that mounts a touched module; typecheck and lint for touched packages; pnpm docs:readme then pnpm docs:readme:check (commit changed READMEs).
   - frontend, if touched: pnpm lint; pnpm typecheck; pnpm exec turbo run test --continue --concurrency=1 — this includes the kit's CROSS-APP GUARDS (document-urls.test.ts, parity.test.ts and the rest), which a wave-1 integration skipped and turned main red; pnpm format:check; pnpm exec turbo run build --concurrency=1, then remove untracked build output.
   A red test or guard is a blocker unless the identical command shows the identical failure on main — then return blocked and say so in notes.
5. git status clean. Return the structured result with headCommit = git rev-parse --short HEAD.${repairOf ? "\n\nREPAIR ROUND: the integration verifier found problems; fix every blocker and major with new commits and return the updated result:\n" + JSON.stringify(repairOf, null, 1) : ""}`

const iverifyPrompt = (g, r) => `You verify the integration of lean group ${g.key} before it merges into main. Assume something was dropped or a review blocker is still open. You make no commits.

${env(g)}

${LIMITS}

Integrator report: ${JSON.stringify(r, null, 1)}
1. git log --oneline -20; HEAD equals ${r.headCommit}; tree clean.
2. For each merge commit: git show --cc; every hunk from both sides survived in the conflicted files.
3. REVIEW BLOCKERS: read them yourself (cat "${REV}/${g.key}.md"). For EACH, read the file:line it names ON HEAD and show the code that resolves it; a commit that existed when the review was written never counts unless the review says so; prove one blocker fix red by reversing its non-test change, then restore.
4. Re-run the group's own test files; for a frontend group also pnpm exec turbo run test --continue --concurrency=1 in frontend; for a backend group the touched spec files and docs:readme:check.
verdict 'pass' only when nothing was dropped, every blocker is resolved on HEAD and the tests pass.`

const mergePrompt = (g, r) => `Merge the verified lean group ${g.key} into main for Distribution OS. Only git in "${MAIN}" (quote the path); never build, test or touch worktrees.
0. While "${MAIN}/.git/index.lock" exists, wait 20 s and check again, for up to 10 minutes.
1. git -C "${MAIN}" rev-parse --abbrev-ref HEAD prints main; git -C "${MAIN}" status --short shows changes only under QA/ (else return blocked).
2. git -C "${MAIN}" rev-parse --short ${branchOf(g)} equals ${r.headCommit} (else blocked).
3. git -C "${MAIN}" merge-tree --write-tree main ${branchOf(g)} reports no conflict (else blocked). If any commit in git -C "${MAIN}" log ${branchOf(g)}..main touches a file this branch changed, return blocked: it needs re-integration.
4. git -C "${MAIN}" merge --no-ff ${branchOf(g)} -m "Merge QA batch 2 lean group ${g.key}: ${build(g).join(", ")}

Built test-first with an adversarial verifier; merge review by Fable (architect) at QA/evidence/batch2/merge-reviews/${g.key}.md; integration verified on the merged tree with the full frontend gate including the kit cross-app guards.

${CO}"
5. On any conflict: git -C "${MAIN}" merge --abort and return blocked.
6. git -C "${MAIN}" push -q origin main (retry once). Return mainHead = git -C "${MAIN}" rev-parse --short HEAD.`

const serious = (v) => !v || v.verdict !== 'pass' || v.problems.some((p) => p.severity !== 'minor')
const ivBad = (x) => !x || x.verdict !== 'pass' || x.problems.some((p) => p.severity !== 'minor')

let slots = LIMIT
const waiters = []
const acquire = () => (slots > 0 ? ((slots -= 1), Promise.resolve()) : new Promise((res) => waiters.push(res)))
const release = () => { const w = waiters.shift(); if (w) w(); else slots += 1 }
let mergeChain = Promise.resolve()
const serialized = (fn) => { const p = mergeChain.then(fn, fn); mergeChain = p.catch(() => {}); return p }
const settled = {}
const settle = {}
for (const g of GROUPS) settled[g.key] = new Promise((res) => { settle[g.key] = res })

async function runGroup(g) {
  const out = { group: g.key, app: g.app, ids: g.ids, deferred: g.defer }
  try {
    if (g.after.length) log(`${g.key}: waiting for ${g.after.join(", ")}`)
    await Promise.all(g.after.map((k) => settled[k]))
    await acquire()
    try {
      const prep = await agent(preparePrompt(g), { label: `prep:${g.key}`, phase: 'Prepare', schema: PREP, model: 'sonnet', effort: 'low' })
      if (!prep || prep.status !== 'ready') { out.final = 'prepare-blocked'; out.prepare = prep; return out }
      out.base = prep.base

      let b = await agent(implPrompt(g), { label: `impl:${g.key}`, phase: 'Build', schema: RESULT, model: g.model })
      if (!b) { out.final = 'agent-failed'; return out }
      let v = await agent(verifyPrompt(g, b), { label: `verify:${g.key}`, phase: 'Build', schema: VERDICT, model: g.model })
      if (serious(v)) {
        const r = await agent(repairPrompt(g, b, v), { label: `repair:${g.key}`, phase: 'Build', schema: RESULT, model: g.model })
        if (r) { b = r; v = await agent(verifyPrompt(g, b), { label: `reverify:${g.key}`, phase: 'Build', schema: VERDICT, model: g.model }) }
      }
      out.impl = b
      out.verdict = v
      if (serious(v)) { out.final = 'not-verified'; return out }

      const built = { commits: b.commits, itemsDone: b.itemsDone, itemsSkipped: b.itemsSkipped, deviations: b.deviations, verifier: { verdict: v.verdict, problems: v.problems } }
      const review = await agent(reviewPrompt(g, built), { label: `review:${g.key}`, phase: 'Review', schema: REVIEW, model: 'fable' })
      out.review = review
      if (!review || review.decision === 'DO NOT MERGE') { out.final = 'review-blocked'; return out }
    } finally {
      release()
    }

    const m = await serialized(async () => {
      await acquire()
      try {
        log(`${g.key}: integrating`)
        let integ = await agent(integratePrompt(g, null), { label: `integrate:${g.key}`, phase: 'Integrate', schema: INTEG, model: 'opus' })
        if (!integ || integ.status !== 'ready') return { final: 'integration-blocked', integration: integ }
        let iv = await agent(iverifyPrompt(g, integ), { label: `integ-verify:${g.key}`, phase: 'Integrate', schema: IVERDICT, model: 'opus' })
        if (ivBad(iv)) {
          const again = await agent(integratePrompt(g, iv), { label: `integrate-repair:${g.key}`, phase: 'Integrate', schema: INTEG, model: 'opus' })
          if (again && again.status === 'ready') {
            integ = again
            iv = await agent(iverifyPrompt(g, integ), { label: `integ-reverify:${g.key}`, phase: 'Integrate', schema: IVERDICT, model: 'opus' })
          }
        }
        if (ivBad(iv)) return { final: 'integration-verify-failed', integration: integ, integrationVerdict: iv }
        const merged = await agent(mergePrompt(g, integ), { label: `merge:${g.key}`, phase: 'Integrate', schema: MERGED, model: 'sonnet', effort: 'low' })
        log(`${g.key}: ${merged && merged.status === "merged" ? "merged " + merged.mainHead : "merge blocked"}`)
        return { final: merged && merged.status === 'merged' ? 'merged' : 'merge-blocked', integration: integ, integrationVerdict: iv, merge: merged }
      } finally {
        release()
      }
    })
    Object.assign(out, m)
    return out
  } catch (e) {
    out.final = 'error'
    out.error = String(e)
    return out
  } finally {
    settle[g.key]()
  }
}

const results = await parallel(GROUPS.map((g) => () => runGroup(g)))
return { wave: 3, groups: results, merged: results.filter((r) => r && r.final === 'merged').map((r) => r.group) }
