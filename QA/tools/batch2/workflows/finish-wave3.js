export const meta = {
  name: 'qa-batch2-finish-wave3',
  description: 'Finish the ten lean wave-3 lanes that did not reach main: four are integration-verified and only need a refreshed merge, four carry real defects and get a repair round, two owe a measured walk that this run is allowed to perform',
  phases: [
    { title: 'Repair', detail: 'the four lanes whose verifier found a real defect: fix, re-verify, re-review with Fable' },
    { title: 'Walk', detail: 'the two lanes whose only debt is an unmeasured claim — this run MAY start services, the browser and the Pixel 7' },
    { title: 'Integrate', detail: 'merge current main into each lane, run the full gates on the merged tree, verify, then merge into main one lane at a time' },
  ],
}

/**
 * Why this run exists. `lean-wave3.js` (wf_2c3fe029-0c9) merged 6 of its 16 groups and stopped the other
 * ten. Reading its journal, they stopped for three different reasons, and only one of them was real:
 *
 *  (a) FOUR lanes were stopped by MY OWN gate, not by a defect. `serious()`/`ivBad()` in that runner
 *      treated ANY problem above 'minor' as a stop, so an integration verdict of **pass** whose single
 *      major was "the platform walks are still owed" halted a lane its own architect had cleared. That is
 *      the same over-strict stop condition already corrected once, on the DOS-167 amendments lane. It is
 *      corrected here: a lane stops on verdict !== 'pass' or on a 'blocker'. A major is carried, logged
 *      and owed — never silently dropped, and never a reason to hold a merge the architect approved.
 *  (b) FOUR lanes carry genuine defects their verifier proved: a credit limit and outstanding leaking to
 *      the shop's own device through sync.pull; a deferred item built against an explicit prohibition; a
 *      production line that survives deletion with the suite green; an app half calling the wrong service.
 *      Those get a repair round, a re-verify and a fresh Fable review before anything merges.
 *  (c) TWO lanes owe a MEASUREMENT nobody was allowed to take — every lane environment in that run was
 *      forbidden to start a server. This run lifts that for the walk stage only, under the port rule.
 *
 * Nothing here loosens what "proven" means. It removes a gate that was stopping proven work and adds the
 * one capability whose absence made a whole class of proof impossible.
 */

const MAIN = '/Users/prajwalchavan/Desktop/Distribution OS'
const FIND = MAIN + '/QA/findings/12-batch2-new-findings.md'
const VERD = MAIN + '/QA/evidence/batch2/verdicts'
const REV = MAIN + '/QA/evidence/batch2/merge-reviews'
const WALKS = MAIN + '/QA/evidence/batch2/walks'
const CO = 'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>'
const LIMIT = 3

const LANES = [
 {
  "key": "lean-kit-polish",
  "app": "kit/libs",
  "ids": [
   "DOS-122",
   "DOS-069",
   "DOS-150"
  ],
  "defer": [],
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
  "db": "dos_test_b2_kit_polish",
  "notes": "P3-only: three kit layout and accessibility-label fixes with no types.ts, contract, logic or money change. Sonnet builder, Opus verifier. Size exception: DOS-158 and DOS-159 moved to lean-kit-overlays (one is a behaviour bug, the other must land with DOS-152). These three cannot join that Opus group without making it wait for the money.tsx and tokens.ts owners. Build on the DOS-164 overlay host (merged 146eed2) and on lean-kit-overlays' Sheet and Button changes. DOS-069: a safe-area inset for the RupeeInput pad Modal. Check on device that the insets context reaches inside an RN Modal. Do not move the pad into the overlay stack; that is the DOS-164 sign-off hazard, which is not in the inventory. DOS-150: an accessibilityLabel on Money's null branch ('not entered', a new kit string), reusing DOS-158's fix for the same Fabric prop-retention class. DOS-122: below 1024 px, stack web Dialog buttons full-width at touch size, keyed on theme.touch because the SSR snapshot is desk. This changes every web app's dialogs at phone width, including the W7 load-out confirm that DOS-121 (lean-warehouse-stock, waited on) touches. There is no native render harness. Prove DOS-069 and DOS-150 with uiautomator dumps and screenshots on Pixel_7_API_36 (-memory 3072) and simctl screenshots on iOS. Prove DOS-122 with render.test.tsx plus a web 390x844 measurement.",
  "after": [
   "lean-owner-desk",
   "lean-warehouse-stock"
  ],
  "model": "sonnet",
  "track": "merge",
  "carry": [
   {
    "severity": "major",
    "detail": "Device proof is still owed for all three findings and cannot be produced by this run (it is forbidden to start emulators/simulators/dev servers). The binding review's decision is MERGE with DOS-122/069/150 staying OPEN until three walks pass, so this is an accepted post-merge obligation, NOT an unresolved merge blocker \u2014 but it must be scheduled on the merged tree or none of the three can close. Owed: (1) Android Pixel_7_API_36 (-memory 3072), delivery ganesh.more -> stop -> Take money -> Amount taken, screenshot taken AFTER the slide animation showing the title BELOW the status-bar clock (DOS-069, re-shoot a-17/a-18) and the Done/Clear row above the gesture bar, plus a uiautomator dump after 4 7 5 6 / Clear / Done where the '\u2014' node's content-desc reads 'Not entered' (DOS-150, re-dump delivery-060-08); (2) iOS simulator headless via simctl, same pad on a notched iPhone, title below the notch; (3) web 390x844, warehouse load/[id] 'Check out MH-05-BQ-4471?' stacked full-width 76 px with confirm above Cancel and focus on confirm, owner web 390 -> 63 px stacked, owner web 1280 -> 32 px pair unchanged. The specific mechanism the review flags as unproven \u2014 a nested SafeAreaProvider receiving a REAL native onInsetsChange inside an RN Modal's own window on API 36 edge-to-edge \u2014 is pinned by source-reading specs only (money.test.ts), which prove the source text, not the device behaviour. The lane does not overclaim this; it is correctly disclosed."
   }
  ],
  "lastStage": "integration-verify-failed",
  "headAt": "d0ac739"
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
  "db": "dos_test_b2_manager_money",
  "notes": "Rebase first: the money and day-end screens were changed by merged DOS-132/117, credit-notes.tsx by h8 (DOS-116), and documents.tsx and review.service.ts by h9 (DOS-031/037, merged d521f84). DOS-035: formatINR(paise()) like the manager home (reference only). DOS-036: an opening row plus debit/credit/balance columns from RetailerLedgerOutput (no contract change). DOS-038: name is the identity column. Pull the column set into a pure helper with a vitest (the load-out.test.ts pattern); kit list.tsx is unchanged. DOS-136: fix depositedAt, bouncedAt and the line uuidv7 values when the dialog opens, not inside the mutation run. Refetch after a network error, and map the idempotency 409 to a sentence. Repeat on Day-end and on owner receipts, where the O11 .then(done, done) confirms use Refusal from h13's owner refusal.tsx (h1-money-slice2 review). DOS-141: server refusal messages name the SO no, vehicle + date, approver name and IST time (no UUID, no ISO-Z). Both bounce dialogs refuse an empty reason locally through TextInput error. The 'idempotencyKey already used' step belongs to DOS-136. The four DOS-031 sign-off defects in documents.tsx (R1-R4) are not in the inventory and not in scope. Dialogs inside Sheets: iOS walk on the merged DOS-164. Walk web desk + phone and Android.",
  "after": [
   "lean-libs-offline-boot",
   "lean-warehouse-pick",
   "lean-delivery-door"
  ],
  "model": "opus",
  "track": "merge",
  "carry": [
   {
    "severity": "major",
    "detail": "The binding review's \"Walks owed\" section is still owed in full \u2014 nobody has run them (builder, integrator, or me; no lane environment may start servers, emulators or simulators). DOS-035/036/038/141 are proven on this tree only by pure-helper vitests plus static reading; no pixel of the manager or owner screen has been seen. Specifically still owed, and they must travel with the merge: (1) Web desk 1280x800, manager AND accountant \u2014 Shops -> overdue as money (DOS-035); the statement's three heads + opening row and the last balance (DOS-036); Money -> RCPT -> \"Bank it\" with the reply dropped (route abort), press again -> 200 Banked, dialog closes, panel Banked (DOS-136); \"Cheque returned\" with an empty reason -> field error \"Write what the bank said\", no POST (DOS-141); the same two on Day-end; Owner O11 receipts \u2014 a refused deposit stays open with the sentence. (2) Web phone 390x844 \u2014 shop rows read \"name \u00b7 policy\"; the three-column statement fits with no horizontal scroll. (3) Pixel 7 (DOS-038's own platform) \u2014 Shops list names via the native ListRow; the bounce field error under the native TextInput. (4) iOS sanity \u2014 the bounce dialog inside the Money sheet (DOS-164 dialogs-in-sheets), Expo Go. I reduced the risk rather than discharging it: I read the kit's actual narrow-Register rule on HEAD (frontend/libs/ui/src/web/list.tsx:513-517 and frontend/libs/ui/src/native/list.tsx:394-396) and it is exactly identity -> primary, first 'value' -> trailing, 'chip' -> secondary, which is what frontend/manager-app/src/lib/shops.ts:134-141 phoneRow restates; SHOP_COLUMNS declares no 'value' column, so the web half's `{...(value ? { trailing } : {})}` omits the prop and the phone row is name + chip with no figure. I also confirmed Money value={null} renders the token money.none = '\u2014' on both halves (web/money.tsx:88, native/money.tsx:88, strings.ts:30), which is the DOS-036 zero-cell claim. That is the mechanism, not the walk."
   }
  ],
  "lastStage": "integration-verify-failed",
  "headAt": "a14ff9a"
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
  "db": "dos_test_b2_sales_rep",
  "notes": "DOS-086 builds on DOS-080 (h11 pull rewrite) and on lean-libs-offline-boot's engine changes. When the draft op is accepted, the device calls the online orders.submit with key `${id}:submit`. orders.sync stays draft-only, so orders.sync.ts is not edited. Expose the accepted-op signal through engine.ts/react.tsx, with an engine.test.ts case (both owned here). Android offline proof. DOS-084: pick the beat for the IST weekday from beat_assignments + beats.visit_days, which are already on the device (screen-only, no schema change). A manual chip sticks for the day (vitest). DOS-142: add cancel_reason to LocalOrder and render it. The pull already carries it (orders.module.ts unchanged); who cancelled is out of scope. DOS-092: cancelLabel 'Keep it' / 'Cancel the order' (DialogProps already has it; no kit change) and a 'say why' line for an empty reason. DOS-088: all live schemes, newest valid_from first. DOS-091: the backend already serves /invoices/{id} and /pdf to the salesperson. Add a bill-detail route modelled on retailer bills/[id].tsx (reference only), with copy that reads the sign of ageDays. Fix the stale docs/23 S12 line (docs/23 was also edited by h9 and h10). DOS-093: in the sales card, handle a 404 behaviour_not_computed as 'new shop'. In the owner shops panel, show '\u2014' as lastOrder already does, with no new owner string key: owner strings.ts belongs to h13 and the owner groups. The DOS-012 confirm sweep does not cover owner shops/index.tsx unless this group takes it with h13's refusal.tsx. The sign-off finding on 'Repeat last order' sorting by _local_rev is not in the inventory. Walk web and Pixel 7; iOS for DOS-091/092/093.",
  "after": [
   "lean-delivery-door",
   "lean-libs-offline-boot"
  ],
  "model": "opus",
  "track": "merge",
  "carry": [
   {
    "severity": "major",
    "detail": "Every item in the review's \"Walks still owed\" section is still unexecuted, including the walk that would confirm the one blocker fix on a rendered screen. The review asks for: web 390x844 + 1280 (beat chip, scheme count, new-shop line, S12b bills, cancel dialog), the Playwright setOffline DOS-086 run plus the >50-op straddle, the Pixel 7 SQLite run with an app kill between upload and pull, and the iOS simctl checks. The blocker is proven only at the strings/outcome layer (dos-086-placed-copy.guard.test.ts reads strings.ts; outcome.ts names the keys) \u2014 no screen was mounted, because the app's ESLint forbids a renderer in app sources and this lane's rules forbid starting a dev server, emulator or simulator. The integrator states this plainly in their notes (\"Treat the lane as merge-ready but its rendered half as unwalked\"), and the review did not list the walks as blockers, so it does not fail the lane \u2014 but the debt must be carried to whoever can start a browser and a device, and it should not be recorded as walked."
   }
  ],
  "lastStage": "integration-verify-failed",
  "headAt": "1876dd0"
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
  "db": "dos_test_b2_owner_money_approvals",
  "notes": "WAITS FOR the architect designs of DOS-006, DOS-011 (which also decides DOS-033), DOS-013, DOS-014 and DOS-016. DOS-004 and DOS-003 are merged (DOS-006 and DOS-013 depended on them). DOS-013 reuses the tenant-catalog variantNames export that DOS-003 added (reference; do not edit tenant-catalog/index.ts). DOS-033 is fixed by DOS-011's additive settled-bill read; the per-allocation invoices.get fallback is the N+1 read DOS-004's design refused. DOS-016: DOS-117 (nightly ageing) and DOS-007 are merged. The net-vs-gross answer must reconcile with Books > Trial balance AR and keep the rollup.ts dues-block precedence (DOS-117 amendment (e)). Any schema/reporting.ts column takes the next _journal.json index. DOS-014: ExportButton needs polling until the job is ready (useQuery has no refetch interval); register specs go in reporting.spec.ts. Any additive output field is exposed to the DOS-160 replay 500 unless lean-backend-platform's DOS-160 fix is merged first; that group is ordered earlier and waited on. Seed change (DOS-006 requestedLimitPaise): re-run pnpm db:seed on dos_qa. Walk web and Android.",
  "after": [
   "lean-owner-desk",
   "lean-manager-money",
   "lean-warehouse-stock",
   "lean-orders-panels",
   "lean-delivery-collect",
   "lean-admin-support",
   "lean-sales-orders-pricing"
  ],
  "model": "opus",
  "track": "merge",
  "carry": [
   {
    "severity": "major",
    "detail": "OWED, NOT A MERGE BLOCKER: the entire Walks section of the review and the lane smoke are still unexecuted (owner web desk + phone + Pixel_7_API_36, the manager Money walk, the iOS Chips-in-Dialog pass, and pricing.priceLists.*, receivables.receipts.get, receivables.outstanding.list, reporting.dashboard.owner, reporting.exports.request). This run is forbidden to start services, browsers, emulators or simulators, so I could not close it either. Consequence: the founder-visible sentences this lane adds are proven only as SOURCE. In particular the blocker fix (dialog hides the period, summary reads 'whole register') is guarded by regexes over exports.tsx, never by a rendered dialog. I checked the integrator's claim that this is forced rather than lazy: the source-as-text guard is repo-wide convention (13+ existing owner-app guards and several manager-app ones read their screen with readFileSync; not one test in any app imports an app screen), and app screens pull expo-router -> Flow-typed react-native, which vitest's esbuild transform cannot read. So the guard style is correct precedent, but the pixels remain owed at the lean gate."
   }
  ],
  "lastStage": "integration-verify-failed",
  "headAt": "bb70a18"
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
  "db": "dos_test_b2_warehouse_pick",
  "notes": "Waits for lean-kit-overlays, because DOS-152 rewrites the Short sheet footer on the same pick/[id].tsx and the Android Short proof is impossible before it. Also waits for h9-desk (merged d521f84: DOS-044 edited warehouse strings.ts and inbound/[id].tsx). lean-delivery-door is a semantic wait: DOS-163's choice should match DOS-165. It is ordered ahead of the P2-heavy groups because lean-manager-money and lean-warehouse-stock wait on its warehouse.spec.ts and pick files. DOS-051 + DOS-165 land together. The reason chips have NO preselected reason, with no kit Segments/Chips change (native/controls.tsx belongs to lean-kit-overlays). warehouse.sync.ts rejects a device pick below requested with no short_reason as a sync_error, never a 4xx. Fix the gate-count wording (w3.countLabel 'good pieces'), not the reconciled enum. DOS-118: move the over-ask line above the pad (NumberPadProps has no disabled prop; no types.ts change). DOS-119: call the public useSyncEngine().sync() after making a wave, and hide Scan/confirm while the status is unknown (no offline lib edit). DOS-120: use the Start reply only while the local row is still open or undefined. DOS-047: query open/picking and draft first, then finished. Walk web desk + 390, Pixel 7, iOS (ios-drive labels for DOS-165).",
  "after": [
   "lean-delivery-door"
  ],
  "model": "opus",
  "track": "walk",
  "carry": [
   {
    "severity": "major",
    "detail": "DOS-118's residual is MITIGATED BUT NOT MEASURED, and this lane's own DOS-165 fix made the geometry it depends on worse. The finding's acceptance is 'the reason is visible without scrolling, next to the figure or the Short button', and the group note \u00a79 requires a walk at web desk + 390, the Pixel 7 and iOS. No walk was run \u2014 this run's environment forbids starting servers, emulators and simulators, so neither the implementer nor I observed a pixel, and the implementer correctly reported status 'partial' rather than claiming one. Meanwhile the DOS-165 fix replaced ONE segmented row with THREE full-width ListRows plus a 'Why is it short?' heading, adding roughly 3 rows of height above a keypad inside a sheet that already scrolls on both renderers (native/feedback.tsx ScrollView maxHeight 86%, web/feedback.tsx overflowY 80vh) and that DOS-152 measured overflowing on a Pixel 7. So the exact mechanism DOS-118 measured \u2014 the refusal laid out beyond the fold from the button that was pressed \u2014 is untouched; only a second copy of the message was added on the pad's own button (doneLabel, 15-16 chars, plausible on a full-width floor-size Button but unverified at 390/402 px). Both source-shape tests pass with the geometry still wrong, by construction: they read file offsets, not layout. This is the same major the previous review raised, and it is still not proven closed."
   }
  ],
  "lastStage": "not-verified",
  "headAt": null
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
  "db": "dos_test_b2_delivery_collect",
  "notes": "WAITS FOR the architect designs of DOS-066 and DOS-071 (architectQueue); build DOS-062, DOS-065 and DOS-067 first inside the group. It waits for lean-backend-platform so the DOS-160 replay fix is on main before any additive output the designs bring. lean-warehouse-stock is a semantic wait: DOS-072 narrows what the crew device holds (credit_mode is kept), and DOS-066's door line may use only what remains (retailer_outstanding_summary overdue_paise/oldest_due_date + credit_mode). DOS-062 is app-only. RecordCollectionInput already takes explicit allocations (contracts delivery.ts:1038) and the output carries invoices[]. Tagging a bill sends allocations; show which bills the money went to, oldest first unless tagged (docs/22:178). The offline receipts op stays FIFO. DOS-065: messages.list with mine=true, receipts.list with tripId. DOS-067: label the KPI as on-time; a stop with no ETA is not late (reporting.spec). The trips list includes future-dated trips. Seed arrival times so the rate is not 0%, then re-run pnpm db:seed on dos_qa. DOS-071 items 2-3 (the stale 'photo required' text, the inert Record button) are app-only; item 1 (the expense proof rule) follows the design, with a delivery.spec.ts case. Walk web and Android.",
  "after": [
   "lean-delivery-door",
   "lean-libs-offline-boot",
   "lean-owner-desk",
   "lean-warehouse-stock"
  ],
  "model": "opus",
  "track": "repair",
  "carry": [
   {
    "severity": "major",
    "detail": "NEW REGRESSION in this group's own file, introduced by the repair round and not covered by its own proof. backend/libs/database/src/seed-demo/delivery.ts:522 is the one clock left on the PRE-FIX base: the failed stop's `deliveries.deliveredAt` still reads `atIstTime(day, 9 + Math.floor((sequence - 1) / 2), ((sequence - 1) % 2) * 30 + 25)`, while `stopEta` (new, :410-412) moved every ETA 30 minutes later. Algebraically delivered_at = eta_new - 5 and the failed stop's arrived_at = eta_new + 10, so the delivery is stamped 15 minutes BEFORE the crew reached the door. MEASURED on a fresh `pnpm db:migrate && pnpm db:seed` of HEAD 153d8c7 into dos_test_b2_delivery_collect: 64 failed deliveries, 64 of them delivered_before_arrival, min and max gap exactly 15.0 minutes. Example row: sequence 1, eta 09:30, started 09:05, arrived 09:40, delivered 09:25. Before this branch the same pair was correct (old delivered_at = eta_old+25 vs old arrived_at = eta_old+10), so the re-base created the inversion. The integrator's \"Arithmetic proof run over 25 stops: zero ordering violations\" is true for the three invariants it names and for `trip_stops` alone; it never looked at the `deliveries` row for a failed stop. Impact is demo data only, but it is what every walk and every re-seed of dos_qa will show on D3/D9 for a failed door."
   },
   {
    "severity": "major",
    "detail": "Blocker 3 of QA/evidence/batch2/merge-reviews/lean-delivery-collect.md is still open in its last clause, and with it the whole \"Walks\" section. The gate half IS now green on the merged tree (I ran it myself, see evidence), but `pnpm db:seed` on dos_qa and every screen walk (D3/D4/D5/D7/D9/D11/D12 at 1280x800, 360 px and on the Pixel 7) have never been run, and this lane cannot run them: the run forbids dev servers and emulators, and dos_qa is the founder's database. The obligation GREW in this round and nobody has looked at any of it: blocker 1's `d5.leftOpen` second line in D3's applied panel has unit-test evidence only; D5 gained four unseen behaviours \u2014 the settled chip's new words (\"Cancelled\"/\"Written off\", neutral instead of moss), the longer label \"Owed on the bills here, as billed\" which must not wrap badly at 360 px beside the money figure and appears BOTH in the bottom bar (collect.tsx:395-399) and in RupeeInput.expectedLabel (:541), and a tag that vanishes when a refreshed office answer drops the bill (liveTags, :204); and every ETA moved 30 minutes later, so D11's on-time figure and the day screen's ETAs no longer match the review's walk script. On a fresh seed of HEAD the register-rule rate is 78.7% (1118 on time of 1420 with an ETA), non-zero as DOS-067 intends, but it is not the number the walk script was written against."
   }
  ],
  "lastStage": "integration-verify-failed",
  "headAt": "153d8c7"
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
  "db": "dos_test_b2_sales_orders_pricing",
  "notes": "WAITS FOR the architect designs of DOS-078, DOS-079, DOS-081, DOS-087 and DOS-090. Build DOS-079 before DOS-083 (DOS-083 dependsOn DOS-079). DOS-096's quote deliberately left cess out, so extend that one GST path, never a second pricing engine. pricing.spec.ts and billing.spec.ts prove that a fully packed invoice equals the order total. A migration takes the next free index from _journal.json, with a hand-written guarantees sibling only if grants or policies change; regenerate READMEs after contract changes. Owner and manager strings.ts are owned for the approval-kind and credit-notice wording on owner approvals.tsx and manager orders/index.tsx. That is why this group waits on lean-admin-support, which also owns owner strings. qty.ts (DOS-078), receivables.ts (DOS-081) and schema/pricing.ts (DOS-087) are owned for the designs. DOS-081's rep-side 'held for credit' sentence can be built before the manager-notice decision. The DOS-126 founder defaults apply: confirm applies only rates approved since the draft, and a shop's standalone approved rate is charged at confirm. The docs/22 \u00a78/\u00a711 rows for these decisions are written in-slice; the main session renders and republishes. DOS-087's seed rename or new rule: re-run pnpm db:seed on dos_qa. The DOS-126 sign-off finding (standalone bargains never expire) is not in the inventory. Walk web and Android; iOS for DOS-090's rep flow.",
  "after": [
   "lean-manager-money",
   "lean-sales-rep",
   "lean-orders-panels",
   "lean-delivery-collect",
   "lean-admin-support"
  ],
  "model": "opus",
  "track": "repair",
  "carry": [
   {
    "severity": "major",
    "detail": "NEW LEAK: the shop's credit limit and outstanding reach the shop's own device through sync.pull. DOS-081 added `credit_notice` (creditMode, reasons, outstandingPaise, creditLimitPaise, headroomPaise, overdueDays, orderTotalPaise) and DOS-078 added `stock_shortages` to `sales_orders` (schema/orders.ts, migrations 0049/0050). Both are stripped on the oRPC path \u2014 toOrder(row, office) returns [] / null for a retailer \u2014 but `sales_orders` is also registered as a sync pull with NO `omit`: orders.module.ts:46 `tablePull(salesOrders, { extra: \u2026 })`. I proved it against the built dist rather than by reading: `pullRolesFor('sales_orders')` = [\"owner\",\"manager\",\"accountant\",\"system\",\"salesperson\",\"retailer\"], and `tablePull(salesOrders).describe('retailer')` lists both `credit_notice` and `stock_shortages`; tablePull's handler is `select *` minus the (empty) omit set, so the manifest and the rows agree. `sync.manifest` and `sync.pull` are ANY_MEMBER (permissions.ts:502-503) and retailer-service (definitions.ts:324-344, roles ['retailer']) mounts both OrdersModule and SyncModule, so a retailer token on :3006 can fetch these columns for its own orders (RLS permits its own rows). This contradicts the signed-off design's binding amendments DOS-081 (e) and DOS-078 (b) \u2014 \"office-only \u2026 pin it\" \u2014 the repo's own rule quoted in orders.mappers.ts loadDetail (\"the shop's credit limit and outstanding \u2026 never reach the retailer app (ADR 0006)\"), and the founder's answer to Q8/DOS-100 (\"never a credit limit or credit-available figure\"). It is the exact shape of QA DOS-072, whose fix set `omit` on the retailers pull with the note \"'no screen draws it' is not the same as 'it is not on the phone'\" (retailers.module.ts:33-48). Nothing in the lane's tests covers the device path, and sync.coverage.spec.ts passes because FORBIDDEN_PULL_COLUMN_PATTERNS only matches cost/margin/landed/purchase/ptd. Fix: `omit: (role) => (role === 'retailer' ? ['credit_notice', 'stock_shortages'] : [])` on that pull, plus a spec pinning it. orders.module.ts is outside this group's owned list, so the integrator must place it \u2014 but the lane opened the hole and did not flag it."
   }
  ],
  "lastStage": "not-verified",
  "headAt": null
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
  "db": "dos_test_b2_manager_order_lifecycle",
  "notes": "WAITS FOR the architect designs of DOS-009, DOS-030, DOS-138 and DOS-139. DOS-145 is grouped here because its newest-first bill register and cursor must use the sort key and (date, id) cursor convention that DOS-009's design picks (DOS-133 used created_at desc, id desc with a row-value cursor). Its global-search routing half is app-only. DOS-139: run the P1 re-bill probe first (reloading or re-billing after cancel could double-sell after DOS-039); if it reproduces, stop and escalate to the full P1 process. DOS-138's interim fix (hide Cancel on picking/packed orders and state the route) needs no design and may ship if the design keeps docs/22's 'cancel up to confirmed'. Put-back lines on W5 pick/[id].tsx use warehouse strings.ts and the warehouse.spec.ts picklist cases, and the owner Orders wording uses owner strings.ts; that is why this group waits on lean-warehouse-stock. DOS-030: an app-only stopgap (hide Book for brand_dms documents, with a reason) can ship first; h9-desk (DOS-031/037, merged) edited the same documents.tsx block. Index or column migrations take the next free _journal.json index. The docs/22 \u00a74/\u00a78 rows for DOS-138/139 are written in-slice; the main session renders and republishes. Cancel dialogs inside Sheets: iOS walk on the merged DOS-164. Walk web and Android.",
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
  "model": "opus",
  "track": "repair",
  "carry": [
   {
    "severity": "major",
    "detail": "A DEFERRED ITEM WAS BUILT ANYWAY, against an explicit prohibition in the signed-off design. QA/evidence/batch2/verdicts/lean-lean-manager-order-lifecycle.md, DOS-030 Notes: 'the app-only stopgap (hide Book for brand documents) is superseded by this design and should not be shipped separately.' Commits 3e721a6 and 96a912e ship exactly that stopgap (documents.tsx gate on doc.kind !== 'brand_dms_invoice', strings.ts m3.brandDmsRoute, plus the lane's own guard test), while the lane simultaneously reports DOS-030 as skipped and OPEN. The change is behaviourally safer than the status quo (the button could only ever 501) and is red-proven, typecheck/lint/prettier clean \u2014 but it is a user-visible product-copy decision about Too Yumm bills, which the architect and docs/22 own, taken on the implementer's own judgement after being offered a revert. Both commit subjects read 'fix(DOS-030): \u2026', so a merge subject or build-log row could read the finding as closed. The architect/merge gate must rule: keep or revert. Revert is clean \u2014 `git revert 96a912e 3e721a6` removes only the m3 hunk from strings.ts and leaves the m2/m6 copy DOS-138/DOS-139 added to the same file."
   },
   {
    "severity": "major",
    "detail": "A production line survives deletion with the whole warehouse suite green, and the test named for it proves a different mechanism. picklists.service.ts:432-433 \u2014 `for (const orderId of cancelled) await this.putBackOrder(tx, orderId, 'the order was cancelled before picking started')` inside `start` \u2014 is the design's amendment (c) fallback for a service that mounts orders WITHOUT warehouse (sales, retailer), where no hook is registered. I deleted those two lines, rebuilt @dos/core and ran the full file: 46/46 PASSED. The test that claims to cover it, warehouse.spec 'DOS-138: an order cancelled from confirmed while it sits on an OPEN wave no longer breaks the wave \u2014 start marks its lines put-back\u2026', cancels through the manager on an app that mounts both OrdersModule and WarehouseModule, so the registered hook has already written cancelled_at before `start` runs (LIVE_PICKLIST_STATUSES is ['open','picking','picked'] \u2014 it includes 'open', so the hook fires on an open sheet). Only the `continue` that skips applyFulfilmentEvent is actually exercised. The untested path is real: a rep cancels a confirmed order from the sales app (sales-service mounts OrdersModule with no WarehouseModule, definitions.ts:177-191), the godown then starts that wave from warehouse-service; without the reconcile the dead order's lines keep cancelled_at null, the picker is asked to pick an order that no longer exists and refreshCompletion/markPackedIfComplete hang the sheet on it. Needs a case that drives a cancel with no hook registered."
   }
  ],
  "lastStage": "not-verified",
  "headAt": null
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
  "db": "dos_test_b2_retailer_platform",
  "notes": "WAITS FOR the architect designs of all five items (contracts, permissions, schema, kit types.ts). permissions.ts is edited by h9 (merged) and h10 (admin rows, uncommitted in 4201823): rebase. Every new route needs a PERMISSIONS row plus the describePermissionMatrix spec. ADR 0006 keeps the credit limit off the retailer app (CREDIT_CHECKERS excludes retailer), so DOS-100's 'credit left' part must respect it; the on-order hold sentence needs no contract change. DOS-102's cross-tenant memberships summary is an auth-service read, with the module boundary and host service set by the design; never switchTenant behind the user's back. DOS-103 adds a retailer write path. Extend backend/libs/database/src/rls.test.ts for any new role-restricted table or policy, and never join retailer_identities from a tenant table (42P17). A new table takes the next _journal.json index plus its FORCE RLS line. The owner setting label uses owner strings.ts, which is why this group waits on lean-manager-order-lifecycle. DOS-104 must not create a second pricing path: priceOrder stays the only engine, with a parity case in pricing.spec.ts. DOS-125: a new kit QR component in types.ts, with web and native renderers on react-native-svg (already in the catalog), parity.test.ts, and a static web hint (links.web.open always reports true). If the design needs a QR encoder dependency, it goes through frontend/pnpm-workspace.yaml, libs/ui package.json and pnpm-lock.yaml; this group owns them and comes after lean-libs-offline-boot and lean-owner-desk. Seed change (DOS-100 template): re-run pnpm db:seed on dos_qa. Walk web, Android, iOS (R2 and pay).",
  "after": [
   "lean-warehouse-stock",
   "lean-admin-support",
   "lean-sales-orders-pricing",
   "lean-owner-money-approvals",
   "lean-manager-order-lifecycle"
  ],
  "model": "opus",
  "track": "repair",
  "carry": [
   {
    "severity": "major",
    "detail": "DOS-102's app half calls the WRONG SERVICE and can never work. Line 130: `api.api.auth.memberships.summary()`. `api.api` is the apiClient, built in client.ts over the FULL contract with `url: join(options.apiUrl, options.prefix)` \u2014 and retailer-app/src/api.ts passes `apiUrl: API_URL` = EXPO_PUBLIC_API_URL, default http://127.0.0.1:3006. retailer-service serves neither the auth module nor the 'auth' contract key (core/src/service/definitions.ts:328-360), and `grep -c 'auth/memberships' backend/retailer-service/README.md` is 0 while auth-service's README serves it at http://localhost:3000/auth/memberships/summary. The auth-bound client is `api.auth` (client.ts builds authLink at `options.authUrl`), and this is the ONLY `api.api.auth.*` call in the whole frontend \u2014 every other app uses `api.auth.sessions()` / `api.auth.me()` (manager, sales, warehouse, delivery, owner, admin, and retailer-app's own settings.tsx:86). It typechecks only because the full contract re-exports `auth: authContract`. Failure scenario: ramesh.gupta signs in, the query 404s, `across.data` stays undefined, and the panel falls back through `?? 0` \u2014 so the r2-total line reads 'You owe \u20b90.00 across 3 distributors' to a shop that owes \u20b991,494, every non-open card shows no dues, and every card reads 'No bills yet' with no van line. That is the entire user-visible payoff of DOS-102, and it shows a WRONG MONEY FIGURE rather than an error. Fix is one word: `api.auth.memberships.summary()`. Nothing caught this because retailer-app has no test harness and no platform walk was run."
   },
   {
    "severity": "major",
    "detail": "DOS-102's 'lands where it left off' half does not survive an app restart on Android or iOS \u2014 the platform the retailer app is built for. `rememberDistributor` writes `dos.lastTenantId` with `storage.setItemSync` (line 20) and `distributorToOpen` reads it with `storage.getItemSync` (line 37), but the key was never added to `PERSISTED_KEYS` in frontend/retailer-app/src/api.ts:20, which is the only argument `storage.prime()` receives at boot (api.ts:23). In libs/ui/src/platform/storage.native.ts, `getItemSync` returns `cache.get(key) ?? null` and the cache is populated ONLY by `prime()` or by writes in the same process; expo-secure-store itself is async. Failure scenario: a shopkeeper who buys from three distributors opens Sai, kills the app, reopens it and signs in \u2014 `distributorToOpen` reads null from an unprimed cache, returns null, and the app lands in the first membership again, which is precisely the bug DOS-102 is named for. storage.web.ts reads localStorage synchronously, so the web build works and the native build silently does not; the divergence is invisible without a device walk, and none was run. Every other `getItemSync` call in the repo reads a PERSISTED_KEY, so there is no precedent excusing this. Fix: add LAST_TENANT_KEY to PERSISTED_KEYS (that file is owned by no group)."
   }
  ],
  "lastStage": "not-verified",
  "headAt": null
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
  "db": "dos_test_b2_warehouse_rules",
  "notes": "Three items (size exception): all three need contract decisions and share files with every other warehouse group, so they run last in the warehouse chain. WAITS FOR the architect designs of DOS-045, DOS-050 and DOS-054. h9 (DOS-044/037, merged d521f84) changed contracts inventory.ts/procurement.ts, cycle-counts.service.ts, grn.service.ts and the stock specs: rebase. DOS-045: the warehouse reply must carry no expected figure or variance, while the manager gate still reads expectedQtyPcs. DOS-050: GRN rows for the warehouse carry the supplier name and bill number but never cost (purchase cost stays behind back-office RLS). Verify the reservations orderNo rendering first; new row words go in warehouse strings.ts. DOS-054: contracts warehouse.ts says 'FEFO warns, it never blocks' (design R03), so the shelf-life rule follows the design. The owner sets it in owner settings/index.tsx and owner strings.ts (reworked by h13 DOS-108), and picking obeys it (warehouse.spec.ts). A column or setting migration takes the next free _journal.json index. Walk web and Android.",
  "after": [
   "lean-warehouse-pick",
   "lean-warehouse-stock",
   "lean-admin-support",
   "lean-manager-order-lifecycle",
   "lean-retailer-platform"
  ],
  "model": "opus",
  "track": "walk",
  "carry": [
   {
    "severity": "major",
    "detail": "`pnpm smoke` ending 0 BROKEN is a BINDING amendment of this lane's design (DOS-045 amendment (e): \"READMEs regenerate; pnpm smoke must end with 0 BROKEN\"), and it is not run \u2014 nor are the four platform walks the review lists (warehouse web 1280 + Pixel 7, manager Inbound gate, owner Settings\u2192Business including the blocker case, iOS Expo Go boot). This is NOT a lane failure: both need a running service/emulator, which this lane is explicitly forbidden to start, and the integrator disclosed it honestly rather than faking a substitute. But it means the nine reshaped wire shapes are proven only against spec fixtures, never against the SEEDED PILOT TENANT. What I independently confirmed reduces the risk but does not close it: examples.spec.ts (35/35) asserts every contract procedure has an example and that each validates against the procedure's schema \u2014 those are the exact payloads smoke sends \u2014 and the module specs drive real HTTP through the real TenantGuard via app.inject. Owed to the merge coordinator after this lands: procurement.grns.*, warehouse.queue.list, warehouse.reservations.list, warehouse.picklists.get on a fresh seed and on a replay."
   }
  ],
  "lastStage": "integration-verify-failed",
  "headAt": "121795a"
 }
]

const wt = (g) => MAIN + '/.claude/worktrees/b2-' + g.key
const branchOf = (g) => 'qa/b2-' + g.key
const build = (g) => g.ids.filter((id) => !g.defer.includes(id))

const blocks = (g) => build(g).map((id) => `n=$(grep -n '^### ${id} ' "${FIND}" | head -1 | cut -d: -f1); if [ -n "$n" ]; then sed -n "$n,\\$p" "${FIND}" | awk 'NR>1 && /^### DOS-/{exit} {print}'; else grep -n '^| ${id} ' "${FIND}"; fi`).join(' ; ')

const LIMITS = `HOUSE RULES OF THIS PROGRAMME — they override any habit:
- Never report a command you did not run or an outcome you did not see. "not-tested" is an honest answer and is always accepted; an invented one is the only unforgivable result.
- Test data only. Destructive work only on a database whose name carries "test". dos and dos_qa are never touched from a lane.
- zsh here has no \${PIPESTATUS[0]}: capture an exit code with "cmd > log 2>&1; echo $?".
- vitest 4: run one file as "pnpm --filter <pkg> exec vitest run <file>".
- If a git operation is refused by the tool permission layer, try twice, then return blocked with the exact command — do not work around it.`

const RULES = `PRODUCT RULES that outrank any instruction below:
- docs/22-source-of-truth.md is what the founder has decided; read it before changing behaviour, never a note elsewhere.
- Money is integer paise, quantities integer pieces, business dates IST. Mutations are idempotent and carry the client UUIDv7 id.
- A screen imports only @dos/ui (plus expo-router, @dos/api-client, @dos/offline, @dos/domain, @dos/contracts) — never react-native or react-dom.
- Never widen a permission, a policy or a validation to make a test pass. Purchase cost never reaches a salesperson, delivery or retailer role; a shop's credit limit and outstanding never reach the shop's own device.
- Never say work is saved when it is not, and never claim a reading the device did not take.`

const env = (g, walk) => `ENVIRONMENT — read carefully:
- Your worktree is "${wt(g)}" on branch ${branchOf(g)}. Start EVERY Bash command with: cd "${wt(g)}" && export PATH=/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/bin:$PATH && eval "$(fnm env)" && fnm use 24 >/dev/null && export DATABASE_POOL_MAX=3 && export DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/${g.db}
- NEVER edit, commit, reset or checkout anything in the main checkout "${MAIN}" or in another worktree — other lanes are live there. You MAY READ ${MAIN}/QA/.
- Database: ${g.db} is a copy of dos_test_batch2b_template; you may drop and recreate ONLY it. Never connect to dos, dos_qa or a template.
- 8 GB RAM shared with other agents: ONE spec or test file per command unless a step names a wider gate.
- Libraries are consumed from dist: after editing @dos/contracts or @dos/core rebuild them (cd backend && pnpm exec turbo run build --filter=<pkg>...).
- No git stash, reset --hard, rebase, push or branch deletion.
- Do NOT edit docs/22, docs/18, CLAUDE.md or anything under QA/ except the one output file a step names.
${walk ? `- THIS STAGE MAY START SERVICES. Port rule, absolute: if :3000-:3007 are already held, do NOT kill what you did not start — run the all-in-one process on :3100 (cd backend && PORT_BASE unset; pnpm --filter @dos/all-in-one dev, or the service you need on its own free port) and point the app at it with EXPO_PUBLIC_API_URL. Stop only what you started, before you return.
- Android: export ANDROID_HOME=$HOME/Library/Android/sdk; export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home; export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$JAVA_HOME/bin:$PATH"; emulator -avd Pixel_7_API_36 -memory 3072 -no-snapshot-save. iOS: drive the simulator headlessly with xcrun simctl only — NEVER open the simulator panel in the Claude app.` : '- Do NOT start dev servers, emulators or simulators.'}
- THIS LANE OWNS THESE FILES; another lane owns every other file:
${g.ownsFiles.map((f) => '  ' + f).join('\n')}`

const carried = (g) => g.carry.map((p, i) => `(${i + 1}) [${p.severity}] ${p.detail}`).join('\n\n')

const repairPrompt = (g) => `You are repairing lean group ${g.key} for Distribution OS. Its adversarial verifier proved real defects in the work on this branch. Fix them properly — at the cause, test-first — or say honestly that you could not.

${env(g)}

${RULES}

${LIMITS}

WHAT THE VERIFIER PROVED (binding; every one of these must end resolved or explicitly returned as blocked):

${carried(g)}

Design and findings for context:
  cat "${VERD}/lean-${g.key}.md"
  ${blocks(g)}

For EACH problem above, in order:
STEP 1: reproduce it. Write or run the test that fails for the verifier's stated reason and keep the excerpt. If you cannot reproduce it, say so with the evidence rather than "fixing" it blind.
STEP 2: fix the real cause, inside this lane's own files. A leak is closed by not sending the field, never by hiding it in the app. A test that proves a different mechanism than its name claims is rewritten to prove the named one. An item the design forbade is REMOVED, not kept.
STEP 3: run the whole test file, then typecheck and lint the packages you touched; prettier --write on touched files.
STEP 4: commit it alone: "fix(<ID>): address verification — <one line>" + two sentences + "Test: <file> › <name>" + ${CO}. Never rewrite history.
Finish with git status clean and return the structured result.`

const reverifyPrompt = (g, r) => `You are the adversarial verifier of lean group ${g.key} for Distribution OS, second round. The lane has just been repaired after you (or your predecessor) proved defects in it. Assume the repair is cosmetic until you prove otherwise. You make no commits.

${env(g)}

${RULES}

${LIMITS}

The problems the repair was asked to close:

${carried(g)}

Repair report: ${JSON.stringify(r, null, 1)}

1. git log --oneline main..HEAD — the repair commits exist and touch only this lane's owned files.
2. For EACH problem above: read the code ON HEAD that is supposed to close it and show it. Then prove it red: reverse that commit's non-test change (git diff C^ C -- . ':(exclude)**/*.spec.ts' ':(exclude)**/*.test.ts' ':(exclude)**/*.test.tsx' | git apply -R), rebuild any affected library, run the test, confirm it FAILS for the right reason, restore with git checkout -- . and rebuild.
3. Re-run every whole test file this lane touched.
4. Hunt again: a test weakened instead of a fix made; a leak moved rather than closed; a permission or validation relaxed; a deferred item still present; a claim in the report that the code does not support.
verdict 'pass' only when every listed problem is closed on HEAD and proven. A remaining MAJOR that is purely a walk still owed is reported as a major and does NOT by itself make the verdict 'fail' — say plainly that it is owed, not done.`

const rereviewPrompt = (g, r, v) => `You are Fable, the ARCHITECT of the Distribution OS QA programme. You reviewed lean group ${g.key} before; its verifier then proved defects, and the lane has been repaired. Review the repaired branch before it merges into main. Read-only: edit nothing except the ONE output file below; run no builds, tests or git writes.

GROUP ${g.key} (${g.app}), branch ${branchOf(g)}:
  git -C "${MAIN}" log --oneline main..${branchOf(g)} ; git -C "${MAIN}" diff main...${branchOf(g)}
Your earlier review: cat "${REV}/${g.key}.md"
Design and findings:
  cat "${VERD}/lean-${g.key}.md"
  ${blocks(g)}

The defects the repair was asked to close:

${carried(g)}

Repair report: ${JSON.stringify(r, null, 1)}
Re-verification: ${JSON.stringify(v, null, 1)}

Judge: is each proven defect actually closed at the cause, or moved? Does the repair break anything the first review approved? Does the branch still match the design and the founder's decisions in docs/22? What must still be walked, and on which platform?
Be adversarial — you are the last reader before main.

Rewrite ${REV}/${g.key}.md (under 80 lines, and keep a two-line "First review" note at the top saying what changed since): **Decision:** MERGE | MERGE AFTER FIXES | DO NOT MERGE; Blockers with file:line and the exact fix; Minors; Conflicts; Walks; Defects outside. Return the structured summary.`

const walkPrompt = (g) => `You are settling the one debt lean group ${g.key} still owes Distribution OS: a claim nobody has been allowed to MEASURE. Every earlier stage of this lane was forbidden to start a server, so the proof could not exist. You may start what you need.

${env(g, true)}

${RULES}

${LIMITS}

WHAT IS OWED (binding):

${carried(g)}

Also read the architect's review for the exact walks it lists: cat "${REV}/${g.key}.md"
And the findings themselves: ${blocks(g)}

HOW TO SETTLE IT:
1. Bring the lane up: cd backend && pnpm install && pnpm exec turbo run build --filter='./libs/*'; recreate ${g.db} from dos_test_batch2b_template; pnpm db:migrate && pnpm db:seed. Start ONLY the services the walk needs, on free ports per the port rule above.
2. Walk what the review names, at the widths it names, on the platforms it names. MEASURE rather than eyeball: read the rendered geometry (element boxes, scroll offsets, what is inside the viewport) and say the numbers. A screenshot goes to ${WALKS}/${g.key}-<platform>-<screen>.png.
3. If the lane's debt is the SMOKE gate, run it the way the architect reshaped it on 2026-09-19 (QA/evidence/batch2/verdicts/DOS-175-177-blocker2-ruling.md, and QA/STATE.md "The smoke gate, reshaped"): the design's NAMED operations must read OK — never EXPECTED, never a 409 counted as green — on a fresh seed AND on a replay; no NEW BROKEN against main at the merge base with the same seed and the same --run-tag; nothing turns BROKEN on the replay. Absolute "0 BROKEN" is NOT this lane's bar and nobody may be held to it.
4. If the walk shows the claim is FALSE, say so plainly, fix it inside this lane's own files test-first, commit ("fix(<ID>): <one line>" + ${CO}) and walk again.
5. Write ${WALKS}/${g.key}.md: what you started and on which ports, each walk with its measured numbers, each screenshot path, and what is still not proven. Stop everything you started.
Return the structured result. "not-proven" for something you could not measure is an accepted answer; an invented measurement is not.`

const integratePrompt = (g, repairOf) => `You are the INTEGRATOR of lean group ${g.key} for Distribution OS. Main has moved since this lane was last integrated. Merge current main into the lane, resolve every remaining review blocker, prove the merged tree green and commit. You do NOT merge into main.

${env(g)}
- INTEGRATOR git: you may merge main INTO ${branchOf(g)}, use checkout --ours/--theirs while resolving, and merge --abort.

${RULES}

${LIMITS}

REVIEW (binding): cat "${REV}/${g.key}.md"
Every Blocker there was raised against the branch AS REVIEWED: a commit that already existed when the review was written is NEVER its fix. Resolve each with a new commit — a test that fails for the blocker's reason, then the fix — or return blocked with the reason.
A MAJOR that is purely "a platform walk is still owed" is NOT a blocker: carry it, name it in notes, and keep going. That distinction is the whole reason this run exists.

STEPS:
1. git merge main -m "Merge main into ${branchOf(g)} before merging it back" (resolve keeping both sides; merge --abort and return blocked if a conflict is not explained by this lane).
2. cd backend && pnpm install && pnpm exec turbo run build --filter='./libs/*'; recreate ${g.db} from the template and pnpm db:migrate; cd ../frontend && pnpm install (commit a changed lockfile).
3. The review blockers, as above; apply a minor only when it is one line inside this lane's files.
4. Gates on the merged tree:
   - backend, if touched: every spec file the lane touched (one per command); pnpm --filter @dos/core exec vitest run src/docs/examples.spec.ts; the service spec of every service that mounts a touched module; typecheck and lint for touched packages; pnpm docs:readme then pnpm docs:readme:check (commit changed READMEs).
   - frontend, if touched: pnpm lint; pnpm typecheck; pnpm exec turbo run test --continue --concurrency=1 --force — the --force matters: a turbo cache hit cannot prove the kit's CROSS-APP GUARDS (S-155); pnpm format:check; pnpm exec turbo run build --concurrency=1, then remove untracked build output.
   A red test or guard is a blocker unless the identical command shows the identical failure on main — then return blocked and say so in notes.
5. git status clean. Return the structured result with headCommit = git rev-parse --short HEAD.${repairOf ? '\n\nREPAIR ROUND: the integration verifier found problems; fix every blocker with new commits and return the updated result:\n' + JSON.stringify(repairOf, null, 1) : ''}`

const iverifyPrompt = (g, r) => `You verify the integration of lean group ${g.key} before it merges into main. Assume something was dropped or a review blocker is still open. You make no commits.

${env(g)}

${LIMITS}

Integrator report: ${JSON.stringify(r, null, 1)}
1. git log --oneline -20; HEAD equals ${r.headCommit}; tree clean.
2. For each merge commit: git show --cc; every hunk from both sides survived in the conflicted files.
3. REVIEW BLOCKERS: read them yourself (cat "${REV}/${g.key}.md"). For EACH, read the file:line it names ON HEAD and show the code that resolves it; prove one blocker fix red by reversing its non-test change, then restore.
4. Re-run the lane's own test files; for a frontend lane also pnpm exec turbo run test --continue --concurrency=1 --force in frontend; for a backend lane the touched spec files and docs:readme:check.
verdict 'pass' only when nothing was dropped, every blocker is resolved on HEAD and the tests pass. A walk still owed is a major to be named, not a reason to fail the verdict.`

const mergePrompt = (g, r) => `Merge the verified lean group ${g.key} into main for Distribution OS. Only git in "${MAIN}" (quote the path); never build, test or touch worktrees.
0. While "${MAIN}/.git/index.lock" exists, wait 20 s and check again, for up to 10 minutes.
1. git -C "${MAIN}" rev-parse --abbrev-ref HEAD prints main; git -C "${MAIN}" status --short shows changes only under QA/ (else return blocked).
2. git -C "${MAIN}" rev-parse --short ${branchOf(g)} equals ${r.headCommit} (else blocked).
3. git -C "${MAIN}" merge-tree --write-tree main ${branchOf(g)} reports no conflict (else blocked). If any commit in git -C "${MAIN}" log ${branchOf(g)}..main touches a file this branch changed, return blocked: it needs re-integration.
4. git -C "${MAIN}" merge --no-ff ${branchOf(g)} -m "Merge QA batch 2 lean group ${g.key}: ${build(g).join(', ')}

Built test-first with an adversarial verifier; merge review by Fable (architect) at QA/evidence/batch2/merge-reviews/${g.key}.md; integration verified on the merged tree with the full frontend gate including the kit cross-app guards.

${CO}"
5. On any conflict: git -C "${MAIN}" merge --abort and return blocked.
6. git -C "${MAIN}" push -q origin main (retry once). Return mainHead = git -C "${MAIN}" rev-parse --short HEAD.`

const RESULT = {
  type: 'object',
  properties: {
    group: { type: 'string' },
    status: { type: 'string', enum: ['fixed', 'partial', 'blocked'] },
    itemsDone: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, test: { type: 'string' }, failBefore: { type: 'string' }, passAfter: { type: 'string' } }, required: ['id', 'test', 'failBefore', 'passAfter'] } },
    itemsSkipped: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, why: { type: 'string' } }, required: ['id', 'why'] } },
    commits: { type: 'array', items: { type: 'string' } },
    filesChanged: { type: 'array', items: { type: 'string' } },
    deviations: { type: 'string' },
    followUps: { type: 'array', items: { type: 'string' } },
  },
  required: ['group', 'status', 'itemsDone', 'itemsSkipped', 'commits', 'deviations'],
}

const VERDICT = {
  type: 'object',
  properties: {
    group: { type: 'string' },
    verdict: { type: 'string', enum: ['pass', 'fail'] },
    itemsChecked: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, redProven: { type: 'boolean' }, greenProven: { type: 'boolean' }, note: { type: 'string' } }, required: ['id', 'redProven', 'greenProven'] } },
    problems: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, detail: { type: 'string' } }, required: ['severity', 'detail'] } },
    evidence: { type: 'string' },
  },
  required: ['group', 'verdict', 'problems', 'evidence'],
}

const REVIEW = {
  type: 'object',
  properties: {
    group: { type: 'string' },
    decision: { type: 'string', enum: ['MERGE', 'MERGE AFTER FIXES', 'DO NOT MERGE'] },
    blockers: { type: 'array', items: { type: 'string' } },
    minors: { type: 'array', items: { type: 'string' } },
    walks: { type: 'array', items: { type: 'string' } },
    defectsOutside: { type: 'array', items: { type: 'string' } },
    file: { type: 'string' },
  },
  required: ['group', 'decision', 'blockers', 'file'],
}

const WALK = {
  type: 'object',
  properties: {
    group: { type: 'string' },
    status: { type: 'string', enum: ['proven', 'partly-proven', 'not-proven', 'claim-false-and-fixed'] },
    started: { type: 'string' },
    walks: { type: 'array', items: { type: 'object', properties: { what: { type: 'string' }, platform: { type: 'string' }, measured: { type: 'string' }, screenshot: { type: 'string' }, verdict: { type: 'string' } }, required: ['what', 'platform', 'measured', 'verdict'] } },
    stillNotProven: { type: 'array', items: { type: 'string' } },
    commits: { type: 'array', items: { type: 'string' } },
    file: { type: 'string' },
  },
  required: ['group', 'status', 'walks', 'stillNotProven', 'file'],
}

const INTEG = {
  type: 'object',
  properties: {
    group: { type: 'string' },
    status: { type: 'string', enum: ['ready', 'blocked'] },
    headCommit: { type: 'string' },
    mergedMainAt: { type: 'string' },
    blockersResolved: { type: 'array', items: { type: 'string' } },
    gates: { type: 'array', items: { type: 'object', properties: { command: { type: 'string' }, outcome: { type: 'string' } }, required: ['command', 'outcome'] } },
    carriedMajors: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['group', 'status', 'notes'],
}

const IVERDICT = {
  type: 'object',
  properties: {
    group: { type: 'string' },
    verdict: { type: 'string', enum: ['pass', 'fail'] },
    problems: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, detail: { type: 'string' } }, required: ['severity', 'detail'] } },
    evidence: { type: 'string' },
  },
  required: ['group', 'verdict', 'problems', 'evidence'],
}

const MERGED = {
  type: 'object',
  properties: { group: { type: 'string' }, status: { type: 'string', enum: ['merged', 'blocked'] }, mainHead: { type: 'string' }, reason: { type: 'string' } },
  required: ['group', 'status'],
}

// A lane stops on a failed verdict or a blocker. A MAJOR is carried and logged — never dropped, never a
// silent merge, but never a reason to hold work its own architect has cleared. This is the corrected form
// of the gate that stopped four proven lanes in wf_2c3fe029-0c9.
const stops = (v) => !v || v.verdict !== 'pass' || v.problems.some((p) => p.severity === 'blocker')

let slots = LIMIT
const waiters = []
const acquire = () => (slots > 0 ? ((slots -= 1), Promise.resolve()) : new Promise((res) => waiters.push(res)))
const release = () => { const w = waiters.shift(); if (w) w(); else slots += 1 }
let mergeChain = Promise.resolve()
const serialized = (fn) => { const p = mergeChain.then(fn, fn); mergeChain = p.catch(() => {}); return p }

async function runLane(g) {
  const out = { group: g.key, track: g.track, ids: g.ids, carriedIn: g.carry.length }
  try {
    await acquire()
    try {
      if (g.track === 'repair') {
        const r = await agent(repairPrompt(g), { label: `repair:${g.key}`, phase: 'Repair', schema: RESULT, model: 'opus' })
        if (!r) { out.final = 'agent-failed'; return out }
        out.repair = r
        const v = await agent(reverifyPrompt(g, r), { label: `reverify:${g.key}`, phase: 'Repair', schema: VERDICT, model: 'opus' })
        out.verdict = v
        if (stops(v)) { out.final = 'repair-not-verified'; return out }
        const rev = await agent(rereviewPrompt(g, r, v), { label: `re-review:${g.key}`, phase: 'Repair', schema: REVIEW, model: 'fable' })
        out.review = rev
        if (!rev || rev.decision === 'DO NOT MERGE') { out.final = 'review-blocked'; return out }
      }
      if (g.track === 'walk') {
        const w = await agent(walkPrompt(g), { label: `walk:${g.key}`, phase: 'Walk', schema: WALK, model: 'opus' })
        out.walk = w
        if (!w || w.status === 'not-proven') { out.final = 'walk-not-proven'; return out }
      }
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
        if (stops(iv)) {
          const again = await agent(integratePrompt(g, iv), { label: `integrate-repair:${g.key}`, phase: 'Integrate', schema: INTEG, model: 'opus' })
          if (again && again.status === 'ready') {
            integ = again
            iv = await agent(iverifyPrompt(g, integ), { label: `integ-reverify:${g.key}`, phase: 'Integrate', schema: IVERDICT, model: 'opus' })
          }
        }
        if (stops(iv)) return { final: 'integration-verify-failed', integration: integ, integrationVerdict: iv }
        const merged = await agent(mergePrompt(g, integ), { label: `merge:${g.key}`, phase: 'Integrate', schema: MERGED, model: 'sonnet', effort: 'low' })
        log(`${g.key}: ${merged && merged.status === 'merged' ? 'merged ' + merged.mainHead : 'merge blocked'}`)
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
  }
}

const results = await parallel(LANES.map((g) => () => runLane(g)))
return {
  run: 'finish-wave3',
  lanes: results,
  merged: results.filter((r) => r && r.final === 'merged').map((r) => r.group),
  stillOpen: results.filter((r) => !r || r.final !== 'merged').map((r) => ({ group: r && r.group, final: r && r.final })),
}
