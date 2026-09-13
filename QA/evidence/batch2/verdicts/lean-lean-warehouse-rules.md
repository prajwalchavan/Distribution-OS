# lean-warehouse-rules — architect lean design (Fable, 2026-09-13)

Run `wf_1c5f484c-b7b`. In lean mode this design IS the signed-off plan for these items. Items marked *needs-founder-decision* are built only after the founder approves the recommended default (or picks an alternative).

## DOS-045 — design-ready

### Design

ROOT CAUSE. (1) backend/libs/core/src/modules/inventory/cycle-counts.service.ts:121-124 snapshots stock_balances.on_hand into cycle_count_lines.expected_qty at open(); count() (:159-199) writes counted_qty only, so post() (:219-224) posts counted minus the OPEN-time figure — a lot that moved between open and count posts the wrong difference. (2) detail() (:340-352) returns expectedPcs/variancePcs to every STOCK_VIEWER including warehouse, and CycleCountLineSchema.expectedPcs (backend/libs/contracts/src/inventory.ts:270) is required, so it cannot be withheld. (3) The gate count does the same: grn.service.ts view() (:690-697) via procurement.mappers.ts toGrnLine returns expectedQtyPcs (GrnLineSchema, procurement.ts:241, required) to the warehouse role, and the short/excess findings in GrnWithLines.discrepancies and grns.discrepancies (:446-466) carry qtyPcs, which is the target in disguise (counted + short = expected).

THE CHANGE. A. Expected = on-hand at count time. In count(), before the per-line UPDATE, read stock_balances.on_hand for (row.locationId, every lotId in input.lines) in ONE inArray query, and write expectedQty = onHand ?? 0 in the SAME UPDATE as countedQty. open() keeps its snapshot (the desk's 'what the ledger says' before anyone counts); post() is unchanged: it posts counted minus the count-time expected, which lands on_hand = counted + any movement after the count, so a movement between count and post is not double-counted — write that as the doc comment on post(). B. Role-shaped reply, one predicate: blind = !BACK_OFFICE.includes(currentTenant().actorRole) (owner/manager/accountant/system see figures; warehouse and delivery do not). Contract: CycleCountLineSchema.expectedPcs becomes PiecesSchema.nullable() (doc: on-hand at the moment the line was last counted, open-time snapshot until then; null for non-desk roles — a blind count); variancePcs stays nullable (doc: null until counted and always null for non-desk roles). detail() nulls both when blind. GrnLineSchema.expectedQtyPcs becomes PiecesSchema.nullable() with the same doc; grn.service.ts view() and discrepancies() post-map the reply when blind: expectedQtyPcs null on every line, and findings narrowed to kind = 'damaged' (the counter typed those; short/excess are withheld). Do the narrowing in grn.service.ts (owned), leave procurement.mappers.ts alone. C. Screens: frontend/warehouse-app/app/stock/counts/[id].tsx already hides expected — header comment only; frontend/manager-app/app/inbound/gate.tsx:220 renders line.expectedQtyPcs ?? '—' (the manager always gets the number; the type must admit null). The warehouse inbound/[id].tsx findings panel needs no change: it simply receives damaged findings only. D. Contract summaries (inventory.ts:424 'expected pieces frozen per lot' → 'expected pieces taken at count time; blind for the godown'; procurement.ts:453 'Blind gate count'), pnpm docs:readme, docs/23 gap row closed, docs/22 §11 change-log row (no new §8 decision: blind count is the existing docs/23 §8.18 design).

ORDER OF WORK. Red tests (inventory.spec, procurement.spec with a warehouse actor) → contract nullables → cycle-counts.service count() refresh + detail() blind → grn.service view()/discrepancies() blind → gate.tsx type → pnpm docs:readme → pnpm smoke (0 BROKEN) → docs.

### Binding amendments

- (a) The refresh happens in count() only, in the same transaction and the same UPDATE statement as counted_qty; open() keeps its snapshot; post() changes only its doc comment. No new column, no migration.
- (b) A counted lot with no stock_balances row at the location has expected 0 (the 'unrecorded lot' case open() already allows).
- (c) Blindness is decided by the actor's ROLE inside the service (blind = role not in BACK_OFFICE: owner, manager, accountant, system), never by which service mounted the module and never by a second permission list; permissions.ts is not touched.
- (d) For a blind role the GRN reply withholds expectedQtyPcs AND every short/excess finding on grns.open/count/get (view) and grns.discrepancies alike; damaged findings stay. Do it in grn.service.ts; procurement.mappers.ts stays untouched.
- (e) The contract change is .nullable(), not .optional(); the wire shape for every desk role is byte-for-byte unchanged. READMEs regenerate; pnpm smoke must end with 0 BROKEN.
- (f) Do not change inventory.stock.balances visibility for the warehouse role (the Stock tab): that is a separate product question recorded in notes, not built here.
- (g) Rebase on lean-warehouse-pick (DOS-051 touches inbound/[id].tsx and the gate wording) and h9-desk (grn.service.ts, cycle-counts.service.ts) before starting; the backend hunks here do not overlap theirs.

### Files

- `backend/libs/contracts/src/inventory.ts`
- `backend/libs/contracts/src/procurement.ts`
- `backend/libs/core/src/modules/inventory/cycle-counts.service.ts`
- `backend/libs/core/src/modules/procurement/grn.service.ts`
- `backend/libs/core/src/modules/inventory/inventory.spec.ts`
- `backend/libs/core/src/modules/procurement/procurement.spec.ts`
- `frontend/manager-app/app/inbound/gate.tsx`
- `frontend/warehouse-app/app/stock/counts/[id].tsx`
- `backend/*-service/README.md and frontend/*-app/README.md (generated by pnpm docs:readme, never by hand)`
- `docs/22-source-of-truth.md (§11 row)`
- `docs/23-app-screens-and-api-gaps.md (§10 row)`

### Tests and walks

- inventory.spec.ts 'DOS-045: expected is the on-hand at count time — open a count on a lot holding 9, post a −2 damage adjustment on that lot, count 9: the line answers expectedPcs 7 and variancePcs +2, and post writes ONE +2 cycle_count ledger row' (red today: expectedPcs 9, variancePcs 0, no row).
- inventory.spec.ts 'DOS-045: a warehouse token's open, count and get replies carry expectedPcs null and variancePcs null on every line, while the owner's carry the figures' (red today: numbers returned).
- inventory.spec.ts 'DOS-045 guard: a line counted in an earlier call keeps its count-time expected when a later call counts another line' (green after; pins amendment a).
- procurement.spec.ts 'DOS-045: a warehouse token's grns.count and grns.get replies carry expectedQtyPcs null and no short or excess finding; the manager's carry the figure and all findings' (red today).
- procurement.spec.ts 'DOS-045: grns.discrepancies for the warehouse role lists damaged findings only; for the owner all kinds' (red today).
- Platform walk (web 1280 and Android Pixel_7_API_36): warehouse Inbound → Counts → open → key numbers → save, the reply captured from the network has no expected/variance and the screen stays blind; warehouse Inbound → GRN → count, the Findings panel shows damaged only; manager web Inbound → Gate → count a line, 'Expected N' still prints.

### Notes

Open product question, recorded, not built: inventory.stock.balances is STOCK_VIEWERS (includes warehouse), so the Stock tab still shows per-lot on-hand one tap from a count. Whether the warehouse role should lose the per-lot on-hand read belongs in docs/22 §10. No desk app reads cycleCounts today (only the warehouse app), so the nullable change breaks no desk screen. Overlaps DOS-051 (gate semantics) and DOS-050 (same files); build after those lanes merge.

## DOS-050 — design-ready

### Design

ROOT CAUSE. (1) Held rows: frontend/warehouse-app/app/stock/reservations.tsx:48-50 passes the order into ListRow's reason prop, and ListRow prints reason only when state === 'needsAttention' (frontend/libs/ui/src/web/list.tsx:185, native/list.tsx:175) — so the order never renders; ReservationRowSchema (backend/libs/contracts/src/warehouse.ts:486-499) has no shop. (2) Pack list: frontend/warehouse-app/app/pack/index.tsx:28-31 lists queue.list({state:'picking', unpicklistedOnly:false}) under READY TO PACK and prints totalQtyPcs; FulfilmentQueueItemSchema (warehouse.ts:149-165) carries only picklistId, so the app cannot tell a wave still picking from one fully picked; livePicklistByOrder (backend/libs/core/src/modules/warehouse/picklists.service.ts:690-700) returns only the id. (3) Pack dialog: frontend/warehouse-app/app/pack/[orderId].tsx loads orders.get, packs.list, the retailer and the invoice, never the pick, so it cannot say '74 pc short'. (4) Receipt row: GrnSchema (procurement.ts:261-273) has only supplierInvoiceId; supplier_invoices is BACK_OFFICE_ROLES RLS (backend/libs/database/src/schema/procurement.ts:147), so a warehouse-role join is blank; grns (schema/procurement.ts:220-247) carries neither supplier nor bill number; suppliers is staffReadPolicy (tenant-catalog.ts:129) so the name is readable. Home frontend/warehouse-app/app/index.tsx:149-152 prints the COUNT OF GRNs with the word 'lines'.

THE CHANGE. A. Contract warehouse.ts: FulfilmentQueueItemSchema += picklistNo: z.string().nullable(), picklistStatus: PicklistStatusSchema.nullable(), pickedQtyPcs: PiecesSchema (Σ picked on the live wave, 0 when none; short = totalQtyPcs − pickedQtyPcs once picklistStatus is 'picked'). ReservationRowSchema += retailerId: IdSchema.nullable(), retailerName: z.string().nullable(). B. Contract procurement.ts: GrnSchema += supplierId: IdSchema.nullable(), supplierName: z.string().nullable(), supplierInvoiceNo: z.string().nullable(), lineCount: z.number().int(). C. Schema, expand-only: grns gains supplier_id text and supplier_invoice_no text (nullable, comment: denormalised from supplier_invoices, which is back-office RLS, so the gate can read them). Drizzle-generated NNNN_grns_supplier_expand.sql plus hand-written NNNN+1_grns_supplier_guarantees.sql: backfill `update grns g set supplier_id = si.supplier_id, supplier_invoice_no = si.invoice_no from supplier_invoices si where si.id = g.supplier_invoice_id and g.supplier_id is null`, then the FORCE-RLS DO block for grns; both appended to _journal.json at the next free index (0048/0049 today — take what is free at build time). D. Services: grn.service.ts open() writes supplierId/supplierInvoiceNo from the invoice it already loaded (:136); list()/get()/view() left-join suppliers for supplierName and run one grouped count on grn_lines for lineCount; extend procurement.mappers.ts toGrn(row, { supplierName, lineCount }). picklists.service.ts: add liveWaveByOrder(tx, orderIds) → Map<orderId, { picklistId, picklistNo, status, pickedQtyPcs }> as ONE query (pick_lines join picklists, sum(picked_qty_pcs), group by order_id, picklist_id, picklist_no, status, status in LIVE_PICKLIST_STATUSES); queue() maps the three new fields; keep livePicklistByOrder as a thin wrapper for create()'s wave guard. listReservations(): after orderLineOwners, call this.orders.fulfilmentOrders(tx, uniqueOrderIds) (bounded at 200, equal to the page max) and map retailerId/retailerName. E. Screens: reservations.tsx puts 'For SO-0867 · Bhosale Traders' with the pieces and batch in secondary and drops reason; pack/index.tsx splits the first panel into BEING PICKED (picklistStatus open/picking, secondary 'PICK-0078 · 676 of 750 pc') and READY TO PACK (picklistStatus 'picked', secondary '750 pc' or '676 of 750 pc · 74 short') and pushes /pack/{orderId}?picklist={picklistId}; pack/[orderId].tsx reads the picklist param → picklists.get → Σ requested/picked for this orderId → the confirm dialog adds '676 of 750 pc picked · 74 pc short' when short; index.tsx GRN row primary = supplierInvoiceNo · supplierName (fallback w1.receiptAt), secondary = '{lineCount} lines · time', panel meta = new w1.receiptsN/'…one' ('{count} receipts'). New words in frontend/warehouse-app/src/strings.ts. F. Seed: wherever seed-demo inserts grns rows directly, set the two new columns (the backfill covers existing rows, the seed covers fresh databases). G. pnpm docs:readme, docs/23 §10 rows, docs/22 §11 row.

ORDER OF WORK. Red specs → contracts → schema + migration pair + _journal.json → grn.service/mappers + picklists.service → seed → green specs → screens + strings → docs:readme → smoke → walk.

### Binding amendments

- (a) Additive only: no existing field is renamed or removed; picklistId stays; unpicklistedOnly and the queue's paging are unchanged.
- (b) Never cost: the GRN row gains supplier id/name, bill number, line count and pieces only — no totalPaise, no rate. No GRN_VIEWERS path joins supplier_invoices or supplier_invoice_lines (RLS would blank them for the warehouse anyway); the two new grns columns are the ONLY source, filled at open() by the desk and backfilled once by the guarantees migration.
- (c) pickedQtyPcs on a queue row is Σ pick_lines.picked_qty_pcs for that order on its LIVE wave (open/picking/picked), from one grouped query per page — never N+1 and never a second scan of pick_lines.
- (d) The queue does not change what it lists; grouping is the app's: picklistStatus 'picked' → READY TO PACK; 'open'/'picking' → BEING PICKED; every row still opens /pack/[orderId].
- (e) The shop on a reservation row comes from OrdersService.fulfilmentOrders (an exported index.ts surface); warehouse never names sales_orders and orders/fulfilment.ts is not edited.
- (f) On the rows, order and shop go in secondary (or primary), never in reason, which prints only on needsAttention. secondary carries the pieces as today (the kit rule 'never a figure' is already broken there; do not widen it).
- (g) The migration pair takes the next free _journal.json index at build time; the guarantees file ends with the FORCE-RLS DO block for grns; both columns nullable, so the expand step is safe on a live database.
- (h) The seed's GRN rows set supplier_id and supplier_invoice_no; verify-seed stays green.
- (i) The pack dialog's shortage is computed from picklists.get for THIS orderId only (Σ requestedQtyPcs − Σ pickedQtyPcs over its lines), never from the queue page, which is limited and filtered.
- (j) Rebase on lean-warehouse-pick (pack/[orderId].tsx, pick/[id].tsx, strings.ts) and h9-desk (grn.service.ts) first; procurement.mappers.ts is edited here because toGrn lives there and no other group owns it.

### Files

- `backend/libs/contracts/src/warehouse.ts`
- `backend/libs/contracts/src/procurement.ts`
- `backend/libs/core/src/modules/warehouse/picklists.service.ts`
- `backend/libs/core/src/modules/procurement/grn.service.ts`
- `backend/libs/core/src/modules/procurement/procurement.mappers.ts (outside the owned list: toGrn lives here; no other group owns it)`
- `backend/libs/database/src/schema/procurement.ts (outside the owned list: the grns columns; no other group owns it)`
- `backend/libs/database/migrations/NNNN_grns_supplier_expand.sql and NNNN+1_grns_supplier_guarantees.sql (next free index)`
- `backend/libs/database/migrations/meta/_journal.json`
- `backend/libs/database/src/seed-demo*.ts (only if it inserts grns rows directly)`
- `backend/libs/core/src/modules/warehouse/warehouse.spec.ts`
- `backend/libs/core/src/modules/procurement/procurement.spec.ts`
- `frontend/warehouse-app/app/stock/reservations.tsx`
- `frontend/warehouse-app/app/pack/index.tsx`
- `frontend/warehouse-app/app/pack/[orderId].tsx`
- `frontend/warehouse-app/app/index.tsx`
- `frontend/warehouse-app/src/strings.ts`
- `backend/*-service/README.md and frontend/*-app/README.md (generated)`
- `docs/22-source-of-truth.md (§11 row)`
- `docs/23-app-screens-and-api-gaps.md (§10 rows)`

### Tests and walks

- warehouse.spec.ts 'DOS-050: a queue row with no wave carries picklistNo null, picklistStatus null, pickedQtyPcs 0; on a started wave with 676 of 750 picked it carries the PICK number, status picking and pickedQtyPcs 676; once every line is picked, status picked' (red today: fields absent).
- warehouse.spec.ts 'DOS-050: reservations.list with a warehouse token carries retailerId and retailerName of the order holding each row, and still no money' (red today).
- procurement.spec.ts 'DOS-050: grns.open stores supplier_id and supplier_invoice_no from the invoice; grns.list and grns.get with a WAREHOUSE token carry supplierName, supplierInvoiceNo and lineCount, and the row has no rate or total field' (red today).
- procurement.spec.ts 'DOS-050 guard: a grns row with null supplier columns (pre-backfill) still lists, with supplierName null' (pins the nullable contract).
- Migration check on the lane database: after pnpm db:migrate, every pre-existing grns row has supplier_id and supplier_invoice_no filled from its invoice (one SQL assertion in the spec's describeDb setup or the verifier's evidence).
- Platform walk (web 1280 and Android): Held rows read 'For SO-… · shop · pieces · batch'; Pack shows BEING PICKED with '676 of 750 pc' and READY TO PACK only for fully picked orders; the pack dialog names '74 pc short'; Home gate row reads 'GUR/26-27/00490 · Guru Kripa · 4 lines · counting' with the meta '1 receipt'; nothing on any of these screens shows a rupee.

### Notes

The 'tapping a Held row does nothing' remark is left as is: the release is the desk's step and the screen says so; a row without a destination is correct. The lineCount and pickedQtyPcs sampler hints are pieces, which the README sampler already handles by name. Overlaps DOS-045 (same services and contracts; build both in one slice) and DOS-048/051 (warehouse screens; rebase).

## DOS-054 — needs-founder-decision

### Design

ROOT CAUSE. backend/libs/core/src/modules/inventory/inventory.service.ts:341-345 reserve() orders lots by expiry_date only, and backend/libs/core/src/modules/warehouse/warehouse.internals.ts:196-214 fefoLots() does the same for the wave's suggestion and the fefo_override check (picklists.service.ts:744, :769); PickWarningCodeSchema (backend/libs/contracts/src/warehouse.ts:126) knows fefo_override and short_pick only; no tenant setting exists (backend/libs/database/src/tenant-bootstrap.ts:121-135); the pick screen's ExpiryChip is amber and nothing else. Design R03 (warehouse.ts:125) says FEFO warns, it never blocks.

RECOMMENDED DEFAULT (build only after the founder approves). One tenant-wide rule 'inventory.min_shelf_life_days', default 30, set by the owner; FEFO within the rule: reservation at confirm and the wave's suggestion take lots with at least N days left (or no expiry) first and short-dated lots only when nothing else covers the line; picking a short-dated lot is recorded and WARNED (new code short_shelf_life), never blocked; the pick screen shows a red 'Under the N-day rule' chip and the desk sees the flag on the sheet.

THE CHANGE. A. Setting: TENANT_SETTING_KEYS.inventoryMinShelfLifeDays = 'inventory.min_shelf_life_days', DEFAULT_MIN_SHELF_LIFE_DAYS = 30, a row in the tenant-bootstrap doc table and in bootstrapTenant's seed list; absent row = default (existing tenants; pnpm db:seed re-run inserts it, onConflictDoNothing). tenancy.ts gains a doc line naming the key; SettingKeySchema is free text, so no contract shape changes there. B. Reader: InventoryService.minShelfLifeDays(tx) (reads tenant_settings like ewbThresholdPaise; integer ≥ 0; default when absent or invalid) and InventoryService.shelfLifeCutoff(tx) = businessDate() (IST) + N as an ISO date; public methods on the class PicklistsService already injects, so inventory/index.ts is not edited. C. Ordering: reserve()'s SQL becomes `order by (expiry_date is null or expiry_date >= ${cutoff}) desc, expiry_date asc nulls last, lot_id asc`; fefoLots(tx, variantId, locationId, cutoff) gets the same order with cutoff as a parameter, and both callers in picklists.service.ts pass it. D. Pick: PickWarningCodeSchema += 'short_shelf_life'; applyPicks pushes { pickLineId, code: 'short_shelf_life', message: 'batch X expires on D, under the N-day rule' } when lot.expiryDate !== null && lot.expiryDate < cutoff; recorded in the reply, no refusal, no column. E. Detail: PicklistDetailSchema += minShelfLifeDays: z.number().int().nonnegative(); PickLineSchema += shortShelfLife: z.boolean(); ConsolidatedPickLotSchema += shortShelfLife: z.boolean(); picklistDetail() in warehouse.mappers.ts takes { cutoff, minShelfLifeDays } from PicklistsService and sets them from each lot's expiry. F. Screens: frontend/warehouse-app/app/pick/[id].tsx shows a brick StatusChip w5.shortShelfLife ('Under {days}-day rule') beside the ExpiryChip when row.line.shortShelfLife, and treats the short_shelf_life warning like fefo (haptics.warning, the warning strip); frontend/owner-app/app/settings/index.tsx Business tab gains a NumberField 'Minimum shelf life to ship (days)' bound to inventory.min_shelf_life_days through the existing valueOf/edit/save path (showing 30 when the row is absent), string o24.minShelfLife in frontend/owner-app/src/strings.ts. G. Docs: docs/22 §8 decision row (the founder's answer, dated), §11 row, docs/23 rows, pnpm docs:readme.

ORDER OF WORK. Founder answer → red specs → setting + reader → reserve()/fefoLots ordering → warning code + detail fields + mappers → green specs → pick screen + owner settings + strings → docs:readme → smoke → walk.

### Binding amendments

- (a) One tenant-wide integer setting in days, default 30, absent = default; no per-category rule and no migration (bootstrapTenant seeds new tenants; the pilot gets the row from pnpm db:seed).
- (b) The rule changes ORDER, never availability: a line reserves and a wave suggests exactly as many pieces as today; only which lots come first changes (FEFO among compliant lots, then FEFO among short-dated). reserve() stays all-or-nothing per line and the confirm-time shortage path in orders is untouched.
- (c) A lot with no expiry date counts as compliant (nothing to judge) and sorts after dated compliant lots, as nulls last does today.
- (d) The cutoff is businessDate() in IST plus N, computed once per request in TypeScript and bound as a parameter; never now() or current_date in SQL.
- (e) short_shelf_life is a warning recorded in the reply and derived on every read from the lot's expiry and the setting; no new column, no migration. fefo_override keeps its meaning: picking the compliant lot the server suggested is not an override; picking the short-dated lot instead raises both warnings.
- (f) The pick screen never blocks; the chip is the brick family and its text names N; the desk sees shortShelfLife on the sheet through picklists.get.
- (g) The owner's field is an integer ≥ 0 saved through tenancy.settings.set like the geofence; 0 switches the rule off (every lot compliant, no warning).
- (h) The builder does not start until the founder's answer is in docs/22 §8; if the founder picks a block variant, the design changes to: applyPicks refuses a short-dated lot without an override reason (400 online, pick_rejected offline) — do not pre-build that.
- (i) The near-expiry list, the expiry write-off flow and the retailer/sales availability hint are not touched.
- (j) Rebase on h13 (DOS-108 reworks owner settings/index.tsx and strings.ts) and lean-warehouse-pick (pick/[id].tsx) first. warehouse.internals.ts and warehouse.mappers.ts are edited because fefoLots and picklistDetail live there and no other group owns them.

### Files

- `backend/libs/contracts/src/warehouse.ts`
- `backend/libs/contracts/src/tenancy.ts (doc comment naming the key)`
- `backend/libs/core/src/modules/inventory/inventory.service.ts`
- `backend/libs/core/src/modules/warehouse/picklists.service.ts`
- `backend/libs/core/src/modules/warehouse/warehouse.internals.ts (outside the owned list: fefoLots)`
- `backend/libs/core/src/modules/warehouse/warehouse.mappers.ts (outside the owned list: picklistDetail/toPickLine/consolidate)`
- `backend/libs/database/src/tenant-bootstrap.ts`
- `backend/libs/core/src/modules/inventory/inventory.spec.ts`
- `backend/libs/core/src/modules/warehouse/warehouse.spec.ts`
- `frontend/warehouse-app/app/pick/[id].tsx`
- `frontend/warehouse-app/src/strings.ts`
- `frontend/owner-app/app/settings/index.tsx`
- `frontend/owner-app/src/strings.ts`
- `backend/*-service/README.md and frontend/*-app/README.md (generated)`
- `docs/22-source-of-truth.md (§8 decision row, §11 row)`
- `docs/23-app-screens-and-api-gaps.md`

### Tests and walks

- inventory.spec.ts 'DOS-054: with inventory.min_shelf_life_days = 30, reserve on a variant holding a 16-day lot and a 90-day lot takes the 90-day lot first; with the setting 0 it takes the 16-day lot first (plain FEFO); when only the 16-day lot can cover the line it is taken and the line is fully reserved' (red today: the 16-day lot is taken first).
- inventory.spec.ts 'DOS-054: an absent setting row reads as 30; a lot with no expiry sorts after dated compliant lots and before short-dated ones' (guard).
- warehouse.spec.ts 'DOS-054: a wave suggests the compliant lot; a pick of the short-dated lot answers short_shelf_life together with fefo_override, writes no ledger row, and picklists.get carries minShelfLifeDays 30 and shortShelfLife true on that line and its consolidated lot, false on the compliant one' (red today: no such code or field).
- warehouse.spec.ts 'DOS-054: with the setting 0 the same pick answers no short_shelf_life warning' (guard for amendment g).
- tenant-bootstrap (database test or seed verify): bootstrapTenant seeds inventory.min_shelf_life_days = 30 (red today: key absent).
- Platform walk: owner web Settings → Business → set 30 → Save → reload shows 30; warehouse web 1280 and Android pick screen shows the red 'Under 30-day rule' chip on the 16-day lot and the warning after picking it; manager desk sees the flagged line on the sheet.

### Founder question

**Below how many days of remaining shelf life should the godown stop sending a batch to shops — and is that a warning the picker can go past, or a block that needs a reason or a manager?**

Recommended default: One number for the whole business, 30 days, set in owner Settings. Stock reservation and the pick sheet pass over such batches whenever another batch can cover the line; a picker who still takes one gets a red warning the desk can see, but is not stopped (FEFO warns, it never blocks — the rule the warehouse already follows).

- Alternative: Block unless the picker records an override reason on that line (refused online, a recorded sync rejection offline), the desk sees the reason.
- Alternative: Block, and only the owner or manager may approve it from the manager app, like load-out.
- Alternative: A different number per product category (needs a category attribute on the catalog first — phase 2).
- Alternative: No rule: keep the amber expiry badge as today.

### Notes

P3, lean mode, batch-2 size once the founder answers: no schema change, no permission change, one setting, one warning code, three additive detail fields. If the founder chooses a block variant, the design above changes at applyPicks and RecordPickLineInput only (an override reason), and the offline pick handler already turns a business fault into pick_rejected; report back before building that. Overlaps DOS-051 (pick screen) and DOS-050 (same contract file); build after those lanes merge.

