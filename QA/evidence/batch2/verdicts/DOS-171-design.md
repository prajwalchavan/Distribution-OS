# DOS-171 — architect design (Fable, 2026-09-14)

Run `wf_4254a4ee-d2f`. P1, confirmed on the API by probe and skeptic (QA/evidence/batch2/suspects/S-28), NOT yet approved by the founder. Read-only design; nothing is built before approval.

## Summary for the founder

At the van door the crew's phone shows the price before GST as the sale total, so on a Rs 248 bill they ask the shop for Rs 221.40 and the shop is left owing Rs 26.60 it never meant to owe; the money books themselves are right.
Fix: the van-sale screen shows the bill's own figure, GST and rounding included, with the make-up under it, and after billing it stays on screen with the bill number and amount; the "owed on the bills here" figure on the money screen now includes a van-sale bill, which it counted as nothing.
One question for you: fizzy-drink cess is not in the quote yet (a separate P2 fix); build this now and let that fix close the last gap, or hold this until both land together.

## Root cause

Confirmed by reading main at 331f4d0 (/Users/prajwalchavan/Desktop/Distribution OS), consistent with S-28's executed probe and the skeptic's re-run:

1. THE WRONG FIELD. `frontend/delivery-app/app/stop/[id]/van-sale.tsx:193` reads `quote.data?.totals.netPaise` — documented "Before GST." at `backend/libs/contracts/src/pricing.ts:354-355` — and prints it at :217 under `d6.total` = 'Sale total' (`src/strings.ts:283`). Each line (:263) prints `lineNetPaise`, also before GST. The header comment (:13-15) promises the bill's figure "to the paisa". DOS-096 added `totals.totalPaise` ("What the shop pays", pricing.ts:360-361, computed with the bill's own `roundToRupee` at `quote.service.ts:158-166`) and never touched this screen.
2. THE BILL IS RIGHT. `vansales.service.ts:97-104` bills through `BillingService.issueFromLocation`; `invoices.service.ts:1548-1559` sums taxable + CGST + SGST + IGST + cess and rounds once. Order, invoice, `retailer_outstanding_summary` and the `VanSaleInvoiced` event all carry 24 800; collecting the shown 22 140 leaves 2 660 due and the bill `partially_paid`.
3. THE MONEY SCREEN HAS NO FALLBACK. D5 (`collect.tsx:100`) prints `stop.planned_collection_paise ?? dues.outstanding_paise` as "Owed on the bills here". That column is `notNull().default(0)` (`schema/delivery.ts:257`), so `??` never falls through: a stop planned with no bills is written as 0 (`trips.service.ts:1139-1140` sums an empty list) and a stop the sale creates is written as 0 (`vansales.service.ts:256`). Nothing adds the van-sale bill to it afterwards, so D5 reads Rs 0.00 at that door; D3's bills-panel meta (:313) and D1's "to collect today" sum (`index.tsx:111`) read the same column.
4. THE TOAST IS LOST. D6 sets the "Bill INV/…" toast and `router.replace`s away in the same tick (:183-184), the DOS-149 pattern, so the crew never sees a figure from the bill itself.

Cess and the intra-state split are known residues, not the cause: `QuotedLine.taxPaise` excludes cess (pricing.ts:331, DOS-079 P2 in lean-sales-orders-pricing), and `splitGst` rounds each CGST/SGST half separately (`domain/src/gst.ts:22-24`), so an intra-state line's bill tax can sit one paisa under the quote's (S-28: 2 656 vs 2 657, both totals 24 800).

## Design

Build order below. Paths from /Users/prajwalchavan/Desktop/Distribution OS. Test-first: every step names its test; write it, see it red, make it green. No contract, schema, migration, PERMISSIONS or README change; `pnpm smoke` is unaffected.

THE SHAPE: the crew reads the quote's PAYABLE figure before billing, reads the BILL's figure after billing, and the money screen counts the van-sale bill. Three small pieces, one per screen state.

STEP 1 — the pure figure (frontend/delivery-app/src/lib/van-sale.ts, new).
`export interface SaleFigures { billPaise, beforeGstPaise, gstPaise, roundOffPaise, cashDiscountPaise: number }`; `saleFigures(quote: Quote | undefined): SaleFigures | null` (type `Quote` from `@dos/contracts`) → `{ billPaise: totals.totalPaise, beforeGstPaise: totals.netPaise, gstPaise: totals.taxPaise, roundOffPaise: totals.roundOffPaise, cashDiscountPaise }`, null when there is no quote. `lineFigure(quote, lineId): number | null` → that line's `lineTotalPaise`. No React, no network; the screen never reads a totals field except through these two.

STEP 2 — D6 before billing (van-sale.tsx).
2a. Bottom bar: label `d6.total` reworded 'Bill total' over `<Money value={figures?.billPaise} size="moneyL" testID="d6-total" />`. Same testID, so the S-28 assertion can be re-run on the screen.
2b. "This sale" panel: meta `d6.quote` reworded 'Priced by the office rules, GST included'; each `ListRow` `trailingMoney={lineFigure(quote.data, line.variantId)}`; the free-goods chip stays. The `Group` gets a `footer` of three rows built from `Row`/`Txt`/`Money` inside the screen: `d6.beforeGst` 'Before GST' (beforeGstPaise, testID d6-before-gst), `d6.gst` 'GST' (gstPaise, testID d6-gst), `d6.roundOff` 'Round-off' (roundOffPaise, testID d6-round-off, only when ≠ 0). One extra moss `Txt` line `d6.cashDiscount` 'Paid now, {amount} comes off the bill' when cashDiscountPaise > 0 (testID d6-cash-discount).
2c. Header comment (:13-15) rewritten: the quote's `totalPaise` is the bill's payable figure for every GST-only item; cess (DOS-079) and the one-paisa CGST/SGST half rounding are why the bill is shown again after issue.

STEP 3 — D6 after billing (van-sale.tsx).
3a. New state `billed: { no: string; totalPaise: number } | null`. `onSuccess` sets it from `result.invoice` (`invoiceNo ?? id.slice(0, 8)`, `totalPaise`), calls `haptics.success()`, and `void engine?.sync('van-sale')` where `engine = useSyncEngine()` (`@dos/offline/react`, public, react.tsx:216). No `router.replace` and no toast in onSuccess.
3b. While `billed !== null` the stock panel and the lines panel are hidden; a `Panel` (testID d6-billed) prints `d6.billed` 'Bill {no} issued' with `<Money value={billed.totalPaise} size="moneyL" testID="d6-billed-total" />` and `d6.billedNext` 'Take the money on the stop screen'. The bottom bar becomes one `Button` `d6.back` 'Back to the stop' (testID d6-back) → `router.replace('/stop/<id>')`. The 'Bill it and hand it over' button is not rendered in this state, so a second tap cannot issue a second bill.

STEP 4 — the money screen counts the bill (backend/libs/core/src/modules/delivery/vansales.service.ts).
After `issueFromLocation` returns and `invoice` is loaded (:112), in the same transaction: `UPDATE trip_stops SET planned_collection_paise = planned_collection_paise + <invoice.totalPaise>, updated_at = now() WHERE tenant_id = ctx.tenantId AND id = stop.id` (drizzle `sql` increment, never read-then-write). Applies to the caller's stop, the shop's open stop and a stop `stopFor` just created (its 0 becomes the bill). `lockTrip` (:63) already serialises van sales on one trip; `idempotent()` makes a replay add nothing. `updated_at` moving is what puts the row in the device's next delta pull (`sync.service.ts:358`). The column's meaning is unchanged: "the bills at this door plus agreed old dues" (contracts/delivery.ts:340) — a van sale is a bill at this door. `collect.tsx` is NOT edited: `planned_collection_paise` is now right there, and D3's meta, D1's sum and `day.tsx` follow the same column.

STEP 5 — strings (frontend/delivery-app/src/strings.ts, the d6 block only): reword `d6.total`, `d6.quote`; add `d6.beforeGst`, `d6.gst`, `d6.roundOff`, `d6.cashDiscount`, `d6.billed`, `d6.billedNext`, `d6.back`. `d6.collectNow` (unused) is left alone.

WHAT THIS DOES NOT DO: no bill-and-collect in one tap (the API's `collect` block stays unused by the screen; a Phase-2 line, not a fix); no cess in the quote (DOS-079); no change to D5's own cash-discount arithmetic (the crew is told the bill total on planned stops too — the allocation engine settles the bill when the shop pays total minus discount inside the window, `allocation.ts:286-296`; a separate S-item for the main session); no offline van sale.

## Binding amendments

- (a) The headline is `totals.totalPaise` under the words 'Bill total' — the same field the retailer order screen prints as 'You pay' (DOS-096). 'Sale total' is retired. Only `saleFigures`/`lineFigure` read the quote's money fields.
- (b) The make-up under the lines is Before GST, GST, Round-off (only when non-zero), from `netPaise`, `taxPaise`, `roundOffPaise`. GST is one word on the phone; CGST/SGST or IGST is the bill's business. Lines show `lineTotalPaise` (GST included), the bill's own line total.
- (c) Schemes, bargains and order-level rules are already inside `lineNetPaise` (order-level rules are allocated into lines by `priceOrder()`, schemes.ts:334-348), so the lines add up to Before GST; free goods keep their chip at no value. Cash discount is reported (ADR 0004), never deducted from Bill total.
- (d) The figure the crew TAKES is the bill's: after issue D6 stays on screen with `result.invoice.invoiceNo` and `totalPaise`, and offers only 'Back to the stop'. No toast-then-replace (DOS-149's pattern).
- (e) `onSuccess` calls the public `useSyncEngine()?.sync('van-sale')`; no engine or react.tsx change. If a pull is already running the call is a no-op and the next poll catches up; the billed state carries the figure regardless.
- (f) `VanSalesService.create` increments `trip_stops.planned_collection_paise` by `invoice.totalPaise` and bumps `updated_at`, in-transaction, as a SQL increment. No contract, schema, migration or PERMISSIONS change; the retailer mapper still answers null (`delivery.mappers.ts:174`).
- (g) IGST: identical rate, identical total for an inter-state shop. Intra-state: the halves round separately, so quote and bill can differ by one paisa per line and, rarely, by ₹1 after rupee rounding; the bill wins and is shown (d). Handed to the DOS-079 design: when the quote's GST path is extended to cess, compute its tax with `splitGst(seller state, place of supply)` so quote = bill to the paisa.
- (h) Cess: `QuoteOutput` excludes it until DOS-079 (lean-sales-orders-pricing, P2). Until then a cess item's Bill total on D6 is short by the cess; D5, D3 and D1 are right because they read the bill. DOS-171 does not add cess to the quote: without DOS-079's order columns the sales and retailer apps' quote would stop matching the order they place.
- (i) Backend tests go in a NEW `vansales.spec.ts` so `delivery.spec.ts` (owned by lean-delivery-door, lean-delivery-collect and lean-manager-order-lifecycle) merges untouched; its fixture is the S-28 probe's.
- (j) Screens import only `@dos/ui`, `@dos/offline/react`, `@dos/api-client/react`, `@dos/domain`, `@dos/contracts` (types) and expo-router; the money rows are built in the screen from `Row`/`Txt`/`Money`. No kit change; `src/lib/ui.tsx` (lean-libs-offline-boot's) is not edited.
- (k) Files outside the list are not edited. docs/22 rows go to the main session; docs/23 needs nothing (D6's calls are unchanged).

## Files

- `backend/libs/core/src/modules/delivery/vansales.service.ts`
- `backend/libs/core/src/modules/delivery/vansales.spec.ts (new)`
- `frontend/delivery-app/app/stop/[id]/van-sale.tsx`
- `frontend/delivery-app/src/lib/van-sale.ts (new)`
- `frontend/delivery-app/src/lib/van-sale.test.ts (new)`
- `frontend/delivery-app/src/strings.ts (d6 block only)`

## Tests

- frontend/delivery-app/src/lib/van-sale.test.ts — 'DOS-171 the figure under the van-sale button is the quote's payable total, GST and rounding included': S-28's totals {gross 22140, discount 0, bargain 0, net 22140, tax 2657, roundOff 3, total 24800} → `saleFigures().billPaise === 24800`, beforeGst 22140, gst 2657, roundOff 3; undefined quote → null. Red: the module does not exist (and the screen's own figure is 22140).
- van-sale.test.ts — 'DOS-171 a line shows its GST-inclusive amount': S-28's line → `lineFigure(quote, lineId) === 24797`, unknown lineId → null. Red: module missing.
- backend vansales.spec.ts — 'DOS-171 the delivery role's quote for a van sale is the bill's payable total': `POST /pricing/quote` as the driver (the D6 body) then `POST /delivery/van-sales` (the D6 body, no collect): `invoice.totalPaise === quote.totals.totalPaise` and `!== quote.totals.netPaise`, `taxPaise > 0`. Green today (S-28 proved it); it stays as the guard that D6's field is the right one.
- vansales.spec.ts — 'DOS-171 a van sale adds its bill to what is owed at that door': stop planned with one bill (planned = billA total) → after the sale `GET /delivery/trips/:id` stop.plannedCollectionPaise === billA total + invoice.totalPaise; a second sale for a shop with NO stop on the trip → the created stop's plannedCollectionPaise === its invoice.totalPaise. Red today: unchanged and 0.
- vansales.spec.ts — 'DOS-171 the device's next pull carries the new figure': cursor from `POST /sync/pull` as the driver before the sale; after it, the `trip_stops` delta holds the stop with `planned_collection_paise` === the new total and `updated_at` moved. Red today: the row arrives (walkStop moves the state) carrying 0.
- vansales.spec.ts — 'DOS-171 a replayed van sale adds once': the same body and idempotencyKey again → same invoice, plannedCollectionPaise unchanged. Red today only for the add (0 stays 0); kept as the idempotency guard.
- Handed to DOS-079 (not in this slice, written in vansales.spec.ts by that builder): 'DOS-079 a van sale of a cess item bills the quote's total' — HSN at 28 % + 12 % cess, `invoice.totalPaise === quote.totals.totalPaise`. Red until DOS-079 lands.

## Platform proof

All three on dos_qa (never the founder's `dos`): services :3000–:3007 + worker (QA/tools/start-services.sh), delivery Metro `pnpm --filter @dos/delivery-app web` on :5177. Sign in `ganesh.more` / `Dos@1234` (today's active trip has `van_sales_enabled` and the tempo holds the last load sheet's lots, seed-demo/delivery-road.ts). Before the walk: pick an item on the van with a plain rate (`select v.id, v.name, r.gst_bps, r.cess_bps from product_variants v join products p on p.id = v.product_id join hsn_rates r on r.hsn_code = p.hsn_code where r.cess_bps = 0 and r.effective_to is null` intersected with `sellable_stock` at the tempo's location) and a stop of the active trip; read `trip_stops.planned_collection_paise` (P0) and call `/pricing/quote` with the driver's token (QA/tools/tok.sh) for 12 pc → Q = totals.totalPaise. Evidence to QA/evidence/batch2/dos-171/{web,android,ios}/ with a SUMMARY.md the main session writes.
- WEB (shared Chromium via `PW_PORT=9341 node QA/tools/pw-server.mjs`, desk 1280x800 and phone 390x844): stop → 'Sell from the van' → 12 pc → `d6-total` text equals ₹Q, `d6-before-gst` + `d6-gst` + `d6-round-off` sum to Q, each `d6-line-*` trailing equals that line's lineTotalPaise. 'Bill it and hand it over' → `d6-billed` reads 'Bill INV/nnnn issued', `d6-billed-total` equals the SQL `invoices.total_paise` of that number (= Q for a GST-only item); SQL `trip_stops.planned_collection_paise` = P0 + total. 'Back to the stop' → within 5 s D3's bills meta reads ₹(P0 + total) and the new bill row appears; 'Take money' → `d5-expected` reads ₹(P0 + total) under 'Owed on the bills here', the 'Owes' chip grew by the total; home D1 'to collect today' grew by the total. Screenshots at every step; the raw texts pasted into SUMMARY.md.
- ANDROID (Pixel_7_API_36 with `-memory 3072`, JDK 21 shell as in CLAUDE.md): `QA/tools/android-login.sh delivery 5177 ganesh.more Delivery`; drive with `python3 QA/tools/ui.py texts|text`; the stepper's plus twelve times (or the node's content-desc); `ui.py texts` must contain 'Bill total' and the ₹Q string and never 'Sale total'; after billing 'Bill INV/' and the bill's rupee string; D3 and D5 as on web. `adb exec-out screencap -p` at each step.
- iOS (simulator through `xcrun simctl` + Appium :4723 + QA/tools/ios-drive.mjs, never the simulator panel): `node QA/tools/ios-login.mjs 5177 ganesh.more delivery`; `ios-drive.mjs tap "Sell from the van"`, `labels` to find the stepper, `has "Bill total"` exit 0, `has "Sale total"` exit 1, `has "<₹Q>"` exit 0; after `tap "Bill it and hand it over"` `has "Bill INV/"` and the bill's amount; `tap "Back to the stop"`, `tap "Take money"`, `has "Owed on the bills here"` with the amount. `xcrun simctl io booted screenshot` at each step.

## Founder question

**Compensation cess (fizzy drinks: 28 % GST + 12 % cess) is not in the quote yet — that is DOS-079, a P2 in a later lean group. Build the van-door fix now, or hold it until both land together?**

Recommended: build now (A). Every GST-only item — the whole catalogue but aerated drinks — is exact at the door at once; on a cess item the screen is short only by the cess until DOS-079, and the bill's own figure is shown right after billing, so the crew still asks for the right money. Holding it (B) keeps every van sale wrong by the full GST for weeks to spare a smaller error on one product family.

## Rows already written

No correcting entry. Every van-sale bill, order, outstanding row and receipt in dos_qa and the founder's `dos` carries the true GST-inclusive total (S-28 read them back); the only wrong figure is `trip_stops.planned_collection_paise` on stops where a van sale was made through the API — in dos_qa those came from QA probes on throwaway tenants (dropped) and the seed's own van sale sits on a settled past-day trip with no open stop; the pilot has no live van sale. Check: `select count(*) from deliveries d join sales_orders o on o.id = d.order_id join trips t on t.id = d.trip_id where o.source = 'van_sale' and t.state in ('planned','loading','active','closing')` — 0 means nothing to touch; otherwise one idempotent UPDATE (planned += that stop's van-sale invoice totals) on those open trips only.

## Lane advice

One lane `b2-dos171`, worktree from current main, branch `qa/b2-dos171`, DB `createdb -T dos_test_batch2b_template dos_test_b2_dos171`. Opus builder test-first, Opus verifier, my merge review, then the platform proof. Size about 0.75 d: backend 0.15, D6 0.2, proof 0.4 (web 0.1, Android 0.15, iOS 0.15). Order: (1) van-sale.ts + test; (2) vansales.spec.ts red → vansales.service.ts; (3) van-sale.tsx + strings; (4) `cd backend && pnpm --filter @dos/core test -- src/modules/delivery` then `cd frontend && pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm format`; (5) proof. Merge before lean-delivery-door starts. docs/22 rows for the main session: §8 "2026-09-14 — At the van door the crew sees and takes the bill's own figure: the van-sale screen shows the GST-inclusive bill total with its make-up and stays on the bill after issue, and a van sale adds its bill to what is owed at that stop (QA DOS-171, P1)"; §11 change log.

## Conflicts with lean groups

- lean-delivery-door (order 2) owns `collect.tsx`, `stop/[id]/index.tsx`, `deliveries.service.ts`, `delivery.spec.ts`, delivery `strings.ts`, `react.tsx`: DOS-171 edits none of them except the d6 block of strings.ts (their DOS-064 note says the zero word "must also read right on van-sale.tsx" — a QtyStepper-prop hunk, disjoint from the quote/bottom-bar/lines hunks here). Sequence: DOS-171 first; lean-delivery-door rebases (one trivial strings.ts merge at most). Their DOS-063/149 refresh uses the same public `useSyncEngine().sync()` D6 now uses.
- lean-delivery-collect (14) owns `collect.tsx`, `contracts/delivery.ts`, `delivery.spec.ts`, delivery `strings.ts`: untouched but strings.ts (d6 block). It inherits a D5 that is already right for van-sale stops.
- lean-sales-orders-pricing (16) owns `contracts/pricing.ts`, `quote.service.ts`, `pricing.spec.ts`: untouched. Two hand-offs into its DOS-079 design: the cess assertion for vansales.spec.ts and the `splitGst` alignment (g).
- lean-libs-offline-boot (5) owns `src/lib/ui.tsx` and `react.tsx`: untouched. lean-manager-order-lifecycle (18) owns `trips.service.ts`: untouched.
- DOS-167: merged (199952b); the pending web store-name repair (ruling 2) touches `@dos/offline` only. Nothing here waits on it.
- Not a lane conflict but S-items for the main session: (1) D5 tells the crew the bill total on a cash-discount shop while the allocation engine settles the bill at total minus discount inside the window; (2) D6 bill-and-collect in one tap (the API's `collect` block) as a Phase-2 line.
