# lean-sales-orders-pricing — architect lean design (Fable, 2026-09-13)

Run `wf_1c5f484c-b7b`. In lean mode this design IS the signed-off plan for these items. Items marked *needs-founder-decision* are built only after the founder approves the recommended default (or picks an alternative).

## DOS-079 — design-ready

### Design

ROOT CAUSE. backend/libs/core/src/modules/pricing/quote.service.ts:123-156 (`quoteInTx`) loads only `gstBps` through `loadGstBps` (:411-441) and computes `taxPaise = percentOf(net, gstBps)`; `sales_order_lines` carries only `gst_bps`/`tax_paise` (backend/libs/database/src/schema/orders.ts:168-170) and `pricedLineFields` (orders/pricing-lines.ts:128-144) copies exactly that. Billing computes cess at pack (`priceOrderLineGroup`, invoices.service.ts:1466-1469, 1504) at the HSN's `cessBps`, so the invoice is ₹ cess higher than the order. INVARIANT THAT MUST HOLD: billing (invoices.service.ts:1446, NOT an owned file), `repriceApprovedBargains` (pricing-lines.ts:300) and the retailer app (retailer-app/app/orders/[id].tsx:374) all read the order line's taxable as `lineTotalPaise − taxPaise`. Therefore cess goes INSIDE `tax_paise` (tax = GST + cess, the invoice's cgst+sgst+igst+cess) with its own breakdown columns; `lineTotal = net + tax` stays true and no consumer outside the group changes. CHANGE, IN ORDER. (1) schema/orders.ts: `salesOrderLines.cessBps bps('cess_bps') notNull default 0`, `salesOrderLines.cessPaise paise('cess_paise') notNull default 0`, `salesOrders.cessPaise paise('cess_paise') notNull default 0`; doc comment on `taxPaise`: 'GST plus compensation cess; cess_paise is the cess share'. (2) contracts/pricing.ts: `QuotedLineSchema` += `cessBps: BpsSchema`, `cessPaise: PaiseSchema`; reword `taxPaise` doc to 'GST plus compensation cess on lineNetPaise at the dated HSN rates (DOS-079)'; `QuoteOutput.totals` += `cessPaise` ('inside taxPaise'). contracts/orders.ts: `OrderLineSchema` += `cessBps`, `cessPaise`; `OrderSchema` += `cessPaise`; `taxPaise` docs say GST + cess. (3) quote.service.ts: rename `loadGstBps` → `loadHsnRates` selecting `hsnRates.cessBps` too (billing has its own copy by design, boundaries forbid sharing); in `quoteInTx` per line `gst = percentOf(net, gstBps)`, `cess = percentOf(net, cessBps)`, `taxPaise = gst + cess`, emit `cessBps`, `cessPaise`, `lineTotalPaise = net + taxPaise`; totals `taxPaise` (sum), `cessPaise` (sum), `roundToRupee(net + taxPaise)`. (4) pricing-lines.ts: `PricedLineFields` += `cessBps`, `cessPaise`; `pricedLineFields` copies them; `OrderTotals`/`ZERO_TOTALS` += `cessPaise`; `orderTotals` sums `cess += line.cessPaise` (subtotal formula unchanged). (5) orders.service.ts:373-387 confirm's per-line update also sets `cessBps`, `cessPaise`. (6) orders.mappers.ts `toOrderLine`/`toOrder` map the three columns (outside the owned list: the mapper is the only way a column reaches the contract; three one-line additions). (7) `pnpm db:generate` ONCE after DOS-078's column is also in schema/orders.ts → `0048_orders_office_signals_expand.sql` + `_journal.json` idx 48 (next free after 0047); no guarantees sibling: no grant, policy or trigger changes, both tables already FORCE RLS; existing rows default 0 (expand-only; an old order keeps the tax it was quoted). (8) `pnpm docs:readme`. The device pull (`tablePull(salesOrderLines)`, orders.module.ts:53-62) selects whole rows, so the columns reach phones without manifest work; the on-device `quoteOnDevice` has no GST and is untouched — DOS-083's online payable comes from `pricing.quote` and carries cess automatically. Labels: owner/manager order lists print `order.taxPaise` under a 'GST' head; it now includes cess for aerated drinks — rename that column head to 'Tax' in manager orders/index.tsx (owned); owner's is a follow-up note, not a blocker.

### Binding amendments

- (a) `tax_paise` on `sales_order_lines` and `sales_orders` is DEFINED as GST + cess; `cess_paise` is the breakdown, never an addition on top. `lineTotalPaise − taxPaise` must equal the taxable on every stored line — pin it in orders.spec.
- (b) `pricing.quote` is the only place cess is computed for an order (the DOS-096 GST path); no cess arithmetic in pricing-lines.ts or orders.service.ts beyond copying the quoted fields.
- (c) One generated expand migration for the group's schema edits (DOS-079 + DOS-078; DOS-081's column only if approved by then), next free index from `_journal.json`; no hand-written sibling. If a later approval adds a column after 0048 exists, it takes the next free index — never edit 0048 after it is applied anywhere.
- (d) The demo seed writes order lines by hand in seed-demo/sales.ts and seed-demo/billing.ts (outside the owned list): where a seeded line sets `tax_paise` for an HSN with cess, it must also set `cess_bps`/`cess_paise` and fold cess into `tax_paise`; then re-run `pnpm db:seed` on dos_qa. Touch nothing else in those files.
- (e) The QuotedLine doc line 'Cess is not included (DOS-079)' is removed; READMEs regenerated; the manager orders list's tax column head becomes 'Tax'.
- (f) No screen re-derives an order total from subtotal − discount + tax by hand; screens read `totalPaise`. Verify with a grep before finishing.

### Files

- `backend/libs/database/src/schema/orders.ts`
- `backend/libs/database/migrations/0048_orders_office_signals_expand.sql`
- `backend/libs/database/migrations/meta/_journal.json`
- `backend/libs/contracts/src/pricing.ts`
- `backend/libs/contracts/src/orders.ts`
- `backend/libs/core/src/modules/pricing/quote.service.ts`
- `backend/libs/core/src/modules/orders/pricing-lines.ts`
- `backend/libs/core/src/modules/orders/orders.service.ts`
- `backend/libs/core/src/modules/orders/orders.mappers.ts`
- `backend/libs/core/src/modules/orders/orders.spec.ts`
- `backend/libs/core/src/modules/pricing/pricing.spec.ts`
- `backend/libs/core/src/modules/billing/billing.spec.ts`
- `backend/libs/database/src/seed-demo/sales.ts`
- `backend/libs/database/src/seed-demo/billing.ts`
- `frontend/manager-app/app/orders/index.tsx`
- `frontend/manager-app/src/strings.ts`
- `backend/*-service/README.md (generated)`
- `docs/22-source-of-truth.md`

### Tests and walks

- orders.spec.ts 'DOS-079: an order line on a 28% + 12% cess HSN stores cess inside its tax and the header carries the cess share' — fixture: new HSN code with an hsn_rates row gstBps 2800 cessBps 1200 and a variant on it; rep creates 48 pcs at ₹22.97 (taxable 110256): expect line gstBps 2800, cessBps 1200, cessPaise 13231, taxPaise 44103, lineTotalPaise 154359; header cessPaise 13231, taxPaise 44103, roundOffPaise 41, totalPaise 154400; and `lineTotalPaise − taxPaise === 110256`. RED today (no cess columns; taxPaise 30872).
- pricing.spec.ts 'DOS-079: a quote for a cess item carries cessBps/cessPaise inside taxPaise and the rupee-rounded payable' — extends the DOS-096 quote test with the cess HSN; RED today (no cessBps on the quoted line).
- billing.spec.ts 'DOS-079: a fully packed invoice for a cess item equals the order total' — same order, pack all 48 through issueForPack: invoice line taxable 110256, cgst+sgst 30872, cess 13231, invoice totalPaise === order totalPaise (154400); assert equality of the two stored totals, not only hand-typed constants. RED today (invoice ₹132.31 higher).
- Existing DOS-126 billing test 'invoice taxable equals the order line's taxable' stays green (pins amendment a).
- Platform walk (web): sales web app places an order with Campa Cola 750 ml; manager web opens it — total, Tax column; warehouse web packs it; manager opens the invoice: the two totals agree.

### Notes

Depends on DOS-096 (merged). Build FIRST in the group: DOS-083 depends on the quote's cess fields and DOS-078 shares the migration. orders.mappers.ts and the two seed files are outside the owned list; the edits are additive one-liners and no other lane owns them. Correction, not a decision: one docs/22 §11 change-log row.

## DOS-078 — design-ready

### Design

ROOT CAUSE. `confirmInTx` (backend/libs/core/src/modules/orders/orders.service.ts:391-413) reserves what exists and computes `shortages`, but stores nothing; `submitInTx` (:289-295) auto-confirms and returns only `confirmed.item`, so the rep's reply, the order detail and the manager's list carry no stock signal. The device half landed with DOS-074 (`useGodownStock.availableOf` returns 0 for an absent item after a complete read; the suggestion row shows a brick '0 cs available' chip and the stepper warns) — what is still missing is the office's and the rep's record on the ORDER. BEHAVIOUR (already decided, no new stock rule): UX-00 §6.4 'over-available is accepted, never blocked', docs/22 §4 W4 'short-packs are pack rows, never order edits' and confirm's own comment 'never refused: the warehouse decides what to do with a shortage'. So the order confirms with a short reservation and the shortage is RECORDED on the order, visible to staff before pack. Not a stock approval (a new gate would hold every routine short order in the owner's queue) and not a cap on the phone (contradicts §6.4). CHANGE, IN ORDER. (1) schema/orders.ts: `export interface StockShortage { lineId; variantId; requestedPcs; reservedPcs; shortQtyPcs }` (keep identical to the contract, like AppliedRule) and `salesOrders.stockShortages jsonb('stock_shortages').$type<StockShortage[]>().notNull().default('[]')`. (2) contracts/orders.ts: move `OrderShortageSchema` above `OrderSchema`; `OrderSchema` += `stockShortages: z.array(OrderShortageSchema)` (doc: 'lines the godown could not fully hold at confirm; empty until confirmed; office-only, [] for the shop'); `ConfirmOrderOutput.shortages` stays (same list). (3) orders.service.ts `confirmInTx`: write `stockShortages: shortages` in the header update (:414-424); the early return for an already-confirmed order (:349) returns `order.stockShortages`, not []. `submitInTx` needs no change beyond returning the detail (it now carries the field). (4) orders.mappers.ts: `toOrder(row, office: boolean)` maps `stockShortages` and returns [] for a retailer caller; `loadDetail` passes its `withApprovals` flag, `listOrders` (orders.internals.ts:336) passes `currentTenant().actorRole !== 'retailer'` (mappers file outside the owned list; additive). (5) Migration: the shared generated 0048 (see DOS-079 amendment c). (6) Sales app new.tsx: `place` returns the submit reply's `item`; the placed panel lists `item.stockShortages` (name from `byVariant`, `caseLine(shortQtyPcs, caseSize)` from @dos/ui qty.ts; reservedPcs 0 reads 'none in stock') under a short line 'The godown is short on N items — the shop gets the rest'. Strings in sales strings.ts. qty.ts is NOT changed (its `qty.*` strings live in the kit's strings.ts, outside the group). (7) Manager orders/index.tsx: a `StatusChip` 'Short N' (ochre) on rows with `stockShortages.length > 0` and a 'Short at the godown' field in the detail listing each line; strings in manager strings.ts. (8) `pnpm docs:readme`; docs/22 §8 row (architect default, enforcement column) + §11.

### Binding amendments

- (a) The shortage is recorded, never acted on: no cap, no clamp, no new approval_kind, no migration of the enum, no change to what is reserved. `orderMachine` and the reservation arithmetic are untouched.
- (b) `stockShortages` is office-only like `approvals`: a retailer-role caller reads [] on get, list and lastPlaced. Pin it.
- (c) Every confirm path stores it: submit's auto-confirm (rep and shop via asSystem), the desk's `orders.confirm`, and the last approval decided through `ApprovalsService.decide` (which calls the same confirmInTx). One test per path, or one parameterised test.
- (d) An idempotent re-confirm returns the stored list; cancel leaves it as history (reservations are released, the record stays).
- (e) The manager chip and the rep's placed panel read only `stockShortages`; no screen recomputes shortage from reservations.
- (f) No change to `approval_flags` (gates only) and no outbox payload change.

### Files

- `backend/libs/database/src/schema/orders.ts`
- `backend/libs/database/migrations/0048_orders_office_signals_expand.sql`
- `backend/libs/database/migrations/meta/_journal.json`
- `backend/libs/contracts/src/orders.ts`
- `backend/libs/core/src/modules/orders/orders.service.ts`
- `backend/libs/core/src/modules/orders/orders.internals.ts`
- `backend/libs/core/src/modules/orders/orders.mappers.ts`
- `backend/libs/core/src/modules/orders/orders.spec.ts`
- `frontend/sales-app/app/orders/new.tsx`
- `frontend/sales-app/src/strings.ts`
- `frontend/manager-app/app/orders/index.tsx`
- `frontend/manager-app/src/strings.ts`
- `backend/*-service/README.md (generated)`
- `docs/22-source-of-truth.md`

### Tests and walks

- orders.spec.ts 'DOS-078: a rep's order beyond the godown's stock confirms short and the shortage is recorded on the order' — retailer A (indicate, within limit): line 1 variant with 10 cs available ordered as 12 cs, line 2 a fixture variant with no stock ordered as 1 cs; submit → 200, state confirmed, `item.stockShortages` has both lines with reservedPcs 0 for the zero-stock one and the exact short count for the other; GET /orders/{id} as manager and GET /orders list carry the same list. RED today (no field).
- orders.spec.ts 'DOS-078: the shop reads no shortage on its order' — the same order read by the linked retailer login: `stockShortages` []. RED today.
- orders.spec.ts 'DOS-078: confirm through the last approval records the shortage' — extend the DOS-020 shortage test (:946): `confirmed.body.item.stockShortages` equals `confirmed.body.shortages`; a second confirm returns the same stored list. RED today.
- Platform walk (web + Android): sales app adds 12 cs of a 10-cs item and 1 cs of a zero-stock item, places the order, the placed panel names both shortages; manager app orders list shows 'Short 2' and the detail lists the lines.

### Notes

Depends on DOS-074 (merged in batch 1, though inventory.json still says 'not implemented'). Build after DOS-079 so both columns share migration 0048. The sales order detail screen (orders/[id].tsx) is not owned; listing shortages there is a follow-up for the group that owns it. Record in docs/22 §8 as an architect enforcement of the existing §4 rule, not a new decision.

## DOS-081 — needs-founder-decision

### Design

ROOT CAUSE. Rep side: frontend/sales-app/app/orders/new.tsx:203-215 sets `placed` from the id only and the panel prints 's3.placedTitle/Body' unconditionally, although the submit reply already carries `item.state` ('submitted' = held) and `item.approvalFlags`; nothing runs `receivables.creditCheck` on the device although the rep is in CREDIT_CHECKERS (permissions.ts:614) and the shop card says the office checks 'not here' ('s2.creditRunsAtSubmit'). Office side: backend/libs/core/src/modules/receivables/credit.ts:100 breaches only for strict/stop (docs/plans/receivables.md §4.14: 'indicate annotates only'), so an indicate-mode shop over its limit confirms with no record anywhere; docs/22 §4 draws an approval for every mode — the diagram and the plan disagree and the founder must pick. REP SIDE (build now, no decision needed). (1) new.tsx: `place` returns `{ id, queued, item }`; a pure helper `placedCopy(item, t)` in a NEW file frontend/sales-app/src/lib/placed.ts maps state+flags to title/body: confirmed → 'Order placed'; submitted + credit_limit → 'Held for credit — the office decides before it ships'; + bargain → 'Waiting on the rate you asked for'; + below_floor → 'Waiting for the office (price below floor)'; the button label follows (s3.held). (2) Before submit, online only: `useQuery(['receivables','creditCheck', retailerId, rupeeTotal], () => api.api.receivables.creditCheck({ retailerId, orderTotalPaise: netPaise }))` keyed on the whole-rupee net so it is not a call per keystroke, staleTime 30 s; under the total a chip: strict/stop with reasons → brick 'Will be held for credit: over the limit by ₹X / N days overdue'; indicate with reasons → ochre 'Over the credit limit by ₹X (warn only)'; no reasons → nothing. Place stays enabled: stop/strict hold, they never block at the doorway (§4.14). Offline: no chip. The figure is before GST until DOS-083 supplies the payable; say '(before GST)'. (3) shops/[id].tsx: replace 's2.creditRunsAtSubmit' with the live verdict when online (creditCheck with orderTotalPaise 0: 'Headroom ₹X' / 'Over the limit by ₹X · {mode}') and, offline, 'Owes ₹X of ₹Y limit — checked again at submit' from the device rows the card already reads. OFFICE SIDE (after the founder's answer; recommended default = notice, not a gate). (4) schema/orders.ts: `export interface CreditNotice { creditMode; reasons: string[]; outstandingPaise; creditLimitPaise; headroomPaise; overdueDays; orderTotalPaise }` and `salesOrders.creditNotice jsonb('credit_notice').$type<CreditNotice>()` nullable. (5) contracts/orders.ts: `CreditNoticeSchema = CreditCheckOutput.pick({...those seven})` (import from './receivables.js'); `OrderSchema` += `creditNotice: CreditNoticeSchema.nullable()` (office-only, null for the shop). (6) orders.internals.ts `approvalFlags()` returns `creditNotice = credit.reasons.length > 0 ? pick(credit) : null` for EVERY mode; `submitInTx` writes it in the header update (:275-285). approval_flags and the gates are unchanged: strict/stop still raise `credit_limit`; indicate raises nothing. (7) orders.mappers.ts maps it and strips for the retailer (same `office` flag as DOS-078). (8) Manager orders/index.tsx: chip 'Over limit · warn only' (ochre) when `creditNotice !== null` and no credit gate, 'Over limit · held' (brick) when the gate is pending; the detail shows the notice's numbers; strings in manager strings.ts; owner strings get the same word keys for its order list if it prints flags. (9) Migration: shares 0048 if approved before it is generated, else next free index. (10) docs/22 §4: S4 becomes 'over limit: strict/stop → approval; warn → order confirms with a credit notice the desk sees'; §8 row; §11.

### Binding amendments

- (a) Build the rep side first and independently; it changes no contract. The office side waits for the founder's answer and is one column + one contract field + one internals change.
- (b) The device never re-implements the credit rule: it shows `receivables.creditCheck`'s own reasons and headroom; the server's submit-time check stays the decision.
- (c) The credit chip never disables Place: stop and strict hold the order (docs/plans/receivables.md §4.14), the doorway does not refuse it.
- (d) `approvalFlags` keeps meaning gates: an indicate breach must not add a flag, or submit's `flags.length === 0` auto-confirm and the DOS-126 flag assertions break. The notice is its own field.
- (e) `creditNotice` is office-only like approvals: null for a retailer-role reader on get, list and lastPlaced; pin it.
- (f) No new notification template in batch 2; the manager's list chip and detail are the 'office is told' surface. A push for indicate breaches is recorded as a follow-up in the notes, not built.

### Files

- `frontend/sales-app/app/orders/new.tsx`
- `frontend/sales-app/app/shops/[id].tsx`
- `frontend/sales-app/src/strings.ts`
- `frontend/sales-app/src/lib/placed.ts (new)`
- `frontend/sales-app/src/lib/placed.test.ts (new)`
- `backend/libs/database/src/schema/orders.ts`
- `backend/libs/database/migrations/meta/_journal.json`
- `backend/libs/contracts/src/orders.ts`
- `backend/libs/contracts/src/receivables.ts`
- `backend/libs/core/src/modules/orders/orders.internals.ts`
- `backend/libs/core/src/modules/orders/orders.service.ts`
- `backend/libs/core/src/modules/orders/orders.mappers.ts`
- `backend/libs/core/src/modules/receivables/credit.ts`
- `backend/libs/core/src/modules/orders/orders.spec.ts`
- `frontend/manager-app/app/orders/index.tsx`
- `frontend/manager-app/src/strings.ts`
- `frontend/owner-app/src/strings.ts`
- `docs/22-source-of-truth.md`

### Tests and walks

- sales-app vitest placed.test.ts 'DOS-081: a submit reply of state submitted with approvalFlags [credit_limit] reads held for credit, not Order placed' — plus cases for bargain, below_floor and confirmed. RED today (no helper; the panel copy is unconditional).
- sales-app vitest 'DOS-081: the credit chip copy for strict/stop with limit_exceeded says the order will be held, for indicate says warn only, and is absent with no reasons' — over a pure `creditChipCopy(verdict, t)` in placed.ts. RED today.
- orders.spec.ts 'DOS-081: an indicate-mode shop over its limit confirms and the order carries a credit notice the desk reads' (office side, after approval) — retailer A with outstanding pushed past its limit: submit → confirmed, approvalFlags [], `creditNotice.reasons` ['limit_exceeded'], creditMode 'indicate'; the same read as the retailer login → null; a strict shop's held order carries both the gate and the notice. RED today (no field, nothing recorded).
- Platform walk (web + Android): sales app on Navjeevan (warn, over limit) shows the ochre chip before Place and 'Order placed' after; on Shree Ganesh (strict) the brick chip before and 'Held for credit' after; manager app orders list shows the warn-only chip on Navjeevan's order.

### Founder question

**When a shop set to 'Warn at the limit' places an order that takes it past its credit limit, should the order go through and the office see a warning on it, be held for approval like a strict shop, or should only the rep be warned?**

Recommended default: The order goes through (no hold) and carries a credit notice: the rep sees 'over the limit — warn only' before placing, and the manager's order list and detail show the same notice on the confirmed order. Strict and stop keep holding as today. docs/22 §4 is corrected to say so.

- Alternative: Hold warn-mode breaches for approval too (docs/22 §4 read literally) — this makes 'warn' identical to 'strict', so the mode would have no meaning.
- Alternative: Warn the rep only and record nothing for the office (the code today); docs/22 §4 is corrected the other way.

### Notes

The rep-side half is decision-free and should be built with the group now. Choosing the default adds a `credit_notice` column: if the answer arrives before DOS-079/078 run `pnpm db:generate`, it rides migration 0048; otherwise it takes the next free index. A desk push for warn-mode breaches (notifications module, `OrderConfirmed` payload) is a follow-up, not batch 2.

## DOS-087 — needs-founder-decision

### Design

ROOT CAUSE. `evaluateTrigger` (backend/libs/domain/src/pricing/schemes.ts:493-495) returns `multiples = floor(measured / triggerMin)` and `net_scheme_amount` pays `rewardValue × multiples` (:644-654, :720-721); schemes.test.ts:138 pins 'per multiple of the trigger' (the ₹ twin of a 12 + 1). The seeded scheme 'Annapurna Atta — ₹15 off per case on 2+' (seed-demo/pricing.ts:459-480: triggerMin 2 case, net_scheme_amount 1500) therefore pays ₹15 per pair of cases; the name and the shop card promise ₹15 on every case once two are bought. The engine has no 'per unit above a threshold' reward, which is the most common flat trade scheme in Indian FMCG ('₹X off per case on N+'). RECOMMENDED DEFAULT (A): add the reward kind `per_unit_amount` = paise off per trigger unit on EVERY whole unit measured, once `triggerMin` is reached; slabs give the per-unit amount of the highest slab reached; `net_scheme_amount` keeps its per-multiple meaning. CHANGE, IN ORDER. (1) domain schemes.ts: `SchemeRewardKind` += 'per_unit_amount'; `isLineLevel` includes it (non-mix); a helper `units(scheme, lines) = measure(scheme.triggerUnit, lines)` (whole cases per line for 'case', pieces for 'pcs'; 'inr' is refused with a PricingError); `lineRewardValue`/`orderRewardValue` return `reward.value × units`; `applyLineReward` adds `addDiscount(line, reward.value × units(line))` with an AppliedRule {kind 'scheme', rewardKind 'per_unit_amount', amountPaise}; `orderReward` (mix) spreads `reward.value × units(scope)` with `spread()`; capped at gross by `addDiscount` as today. (2) contracts/pricing.ts: `SchemeRewardKindSchema` += 'per_unit_amount'; `UpsertSchemeInput` refine: per_unit_amount requires triggerUnit pcs|case; doc 'paise per unit'. (3) schema/pricing.ts: `schemeRewardKind` enum += 'per_unit_amount'; `pnpm db:generate` → `ALTER TYPE scheme_reward_kind ADD VALUE 'per_unit_amount'` (precedent 0014 for approval_kind), next free index; no guarantees sibling. (4) seed-demo/pricing.ts: the Annapurna scheme becomes `rewardKind: 'per_unit_amount', rewardValue: 1_500` (name unchanged); re-run `pnpm db:seed` on dos_qa. (5) Frontend wording: `word.per_unit_amount` = 'Per case/piece off' in owner, manager and sales strings (owned); owner-app/app/prices/index.tsx:170-176 and manager-app/app/prices/index.tsx:95-101 format the new kind as ₹ per unit like net_scheme_amount (outside the owned list, two lines each); retailer-app/src/lib/offer.ts:68-100 switch gains a case 'per_unit_amount' → 'r9.perUnitAmount' ('₹15 off per case on 2+') and slabSentence treats it as money (outside the owned list; the switch has no default so TS refuses the build without it); sales-app catalog.tsx prints raw reward_value for non-pct kinds already — DOS-088's group fixes that wording, coordinate the key name. (6) docs/adr/0008-pricing-engine.md reward list; docs/22 §8 row + §11. ALTERNATIVE (B): keep the engine, rename the seed to 'Annapurna Atta — ₹15 off per 2 cases' and record in docs/22 §8 that a flat ₹ scheme pays per multiple of its trigger; touches only seed-demo/pricing.ts and docs.

### Binding amendments

- (a) `net_scheme_amount` semantics do not change; schemes.test.ts:138 stays green as written.
- (b) Per-unit counts WHOLE trigger units: 2 cs + 6 loose pcs on a per-case scheme pays for 2 cases; a 'pcs' unit pays per piece. Loose pieces never round up.
- (c) The device prices with the same engine (sales-app lib/pricing.ts casts reward_kind from the row) — no device code, only the strings; verify a dos_qa order for 2 cs Annapurna Atta 5 kg shows −₹30 on the phone and on the server.
- (d) The enum value is added in its own generated statement; the seed that uses it runs after migrate (Postgres refuses a new enum value inside the transaction that added it).
- (e) The contract refine refuses per_unit_amount with triggerUnit 'inr' and the engine throws PricingError for it; pin both.
- (f) If the founder picks (B), only seed-demo/pricing.ts and docs change and the schemes.test addition asserts today's ₹15 with the new name.

### Files

- `backend/libs/domain/src/pricing/schemes.ts`
- `backend/libs/domain/src/pricing/schemes.test.ts`
- `backend/libs/contracts/src/pricing.ts`
- `backend/libs/database/src/schema/pricing.ts`
- `backend/libs/database/migrations/meta/_journal.json`
- `backend/libs/database/src/seed-demo/pricing.ts`
- `backend/libs/core/src/modules/pricing/pricing.spec.ts`
- `docs/adr/0008-pricing-engine.md`
- `docs/22-source-of-truth.md`
- `frontend/sales-app/src/strings.ts`
- `frontend/manager-app/src/strings.ts`
- `frontend/owner-app/src/strings.ts`
- `frontend/owner-app/app/prices/index.tsx`
- `frontend/manager-app/app/prices/index.tsx`
- `frontend/retailer-app/src/lib/offer.ts`
- `backend/*-service/README.md (generated)`

### Tests and walks

- schemes.test.ts 'DOS-087: per_unit_amount pays on every whole case once the trigger is met' — ₹15 per case, triggerMin 2 case: 1 cs → ₹0, 2 cs → ₹30, 3 cs → ₹45, 2 cs + 6 pcs → ₹30; capped at gross. RED today (unknown reward kind).
- schemes.test.ts 'DOS-087: per_unit_amount slabs replace the per-unit amount and a mix trigger spreads it' — slabs {2:1500, 4:2000}: 4 cs → ₹80; mix scope of two lines 1 cs + 1 cs → ₹30 allocated to the paisa. RED today.
- schemes.test.ts 'DOS-087: per_unit_amount refuses an inr trigger' and the contract refine test in pricing.spec.ts (400 on upsert). RED today.
- pricing.spec.ts 'DOS-087: the seeded Annapurna scheme quotes ₹30 on 2 cases' against a re-seeded database. RED today (₹15).
- Platform walk (web): sales web app, Navjeevan, 2 cs Annapurna Chakki Fresh Atta 5 kg: the line reads −₹30; owner prices register shows 'Per case off: ₹15.00'.

### Founder question

**'₹15 off per case on 2+': is that ₹15 on every case once the shop buys two or more (₹30 on 2 cases, ₹45 on 3), or ₹15 for every two cases (today's engine)?**

Recommended default: ₹15 on every case once two are bought. The engine gains a 'per unit amount' reward (per case or per piece, above a threshold, with slabs), the seeded scheme is moved to it, and flat 'per multiple' schemes keep working as they do.

- Alternative: Keep the engine and rename the seeded scheme to '₹15 off per 2 cases' (cheapest: seed and docs only; the product then cannot express per-case-off schemes).

### Notes

Overlaps DOS-075 (§10 open question) and DOS-088 (shop-card scheme wording, another group): agree the string key for the new kind with DOS-088's builder. Three files outside the owned list (owner and manager prices screens, retailer offer.ts) are two-to-six-line additions the build needs to compile and to print the new kind; no other lane owns them.

## DOS-090 — design-ready

### Design

ROOT CAUSE. `BargainSheet` (frontend/sales-app/app/orders/new.tsx:637-645) sends `orderId: draft.id` while the draft exists only on the phone; `place()` (:182-197) later creates the server order with the SAME id, so a placed draft links on its own and its gate is raised at submit (`pendingBargainsForOrder`, bargains.service.ts:240-258, DOS-005). The plain `order_id` (schema/pricing.ts:227-228, no FK by design) is the right shape; what is wrong is (i) nothing tells the office that a request's order is still on the rep's phone, and (ii) a request whose draft is abandoned dangles as `requested` for ever. THE ALTERNATIVES ARE WORSE. Saving the draft server-side before the first ask would make `place()`'s `orders.create` collide (createDraft :80-81 → 409) and litter the server with drafts nobody cancels. Sending the request unattached would turn every auto-approved ask into a standalone rate that prices EVERY future order of the shop (DOS-126 default 2, `approvedBargainsFor` :367-369) with no expiry — a pricing leak the DOS-126 sign-off already flagged. A timed lapse cannot be added either: an expired request behind a pending gate makes `ApprovalsService.decide` approve the gate while `decideInTx(ifStillRequested)` returns null, so the order confirms at list price after the desk said yes. DESIGN. (1) Keep the link at request time; no backend behaviour change. Contract docs only: `RequestBargainInput.orderId` and `BargainSchema.orderId` say 'the client's order id; may not be on the server yet (a draft on the phone); the request waits for that order and prices nothing else'; bargains.service.ts comment says the same. (2) Pin the semantics in orders.spec.ts (see tests). (3) Office screens say what the id means: manager orders/index.tsx (Rate requests rows :330-338) and owner approvals.tsx (:141-155) resolve each un-gated request's `orderId` through `orders.get` (one query per distinct id on the page, cached 60 s, `Promise.allSettled`): 404 → 'Not placed yet — on the rep's phone', 200 → '{orderNo ?? Draft} · {state}', null → 'Any order of this shop'; the row shows 'asked {when}' so a stale ask is visible and rejectable there. Strings in manager and owner strings.ts. (4) The rep flow is unchanged; new.tsx gains a comment. (5) docs/22 §10 open question: 'should a rate request for a draft that is never placed lapse on its own, and after how long?'; §11 row.

### Binding amendments

- (a) `order_id` stays a plain id with no FK and no nullable-until-submit change; a request tied to an order id never prices or gates any other order.
- (b) No automatic expiry of requests in batch 2 (it breaks the DOS-005 gate/request pairing); rejection from the Rate requests tab is the only way a dangling ask closes, and the screens make that a one-tap action with the age shown.
- (c) The office screens never link to a 404: an unresolved order id renders the 'not placed yet' label with no navigation.
- (d) DOS-005 spec 1 and the DOS-126 bargain blocks in orders.spec.ts stay green unchanged.
- (e) Resolution calls are bounded by the page (20 manager, 100 owner) and cached; no per-render calls.

### Files

- `backend/libs/contracts/src/pricing.ts`
- `backend/libs/core/src/modules/pricing/bargains.service.ts`
- `backend/libs/core/src/modules/orders/orders.spec.ts`
- `backend/libs/core/src/modules/pricing/pricing.spec.ts`
- `frontend/sales-app/app/orders/new.tsx`
- `frontend/manager-app/app/orders/index.tsx`
- `frontend/manager-app/src/strings.ts`
- `frontend/owner-app/app/approvals.tsx`
- `frontend/owner-app/src/strings.ts`
- `backend/*-service/README.md (generated)`
- `docs/22-source-of-truth.md`

### Tests and walks

- orders.spec.ts 'DOS-090: a rate asked on a draft still on the phone waits for that draft and gates exactly one order' — rep requests a bargain with orderId = a UUIDv7 never uploaded (over bound → requested): the row stores that id, GET /orders/{id} is 404 for the manager; a second order of the same shop and item with another id submits with no bargain gate and at list rate; then create + submit the order WITH that id → exactly one bargain gate naming the request (DOS-005 spec 1 stays green). The middle assertion is RED today only if no test pins it; if DOS-005 already does, the test stands as the DOS-090 pin.
- pricing.spec.ts 'DOS-090: bargains.list returns the request with its unplaced orderId' — RED only for the new contract doc if snapshot-tested; otherwise a pin.
- owner/manager vitest (a pure `orderLabel(resolution, t)` helper next to the screen's lib) 'DOS-090: a request whose order is not on the server reads not placed yet; one whose order exists reads its number and state; one with no order reads any order of this shop'. RED today (no helper, no label).
- Platform walk (web + Android, iOS for the rep flow): sales app, fresh draft, Ask a rate over the bound → manager app Rate requests shows 'Not placed yet'; place the order → the row becomes the gate naming SO-xxxx; the owner app shows the same.

### Notes

P3, tech-debt. Interacts with DOS-005 (merged) and DOS-126 (merged); no contract shape or schema change, so no migration and no permission change. READMEs regenerate only for the doc text.

