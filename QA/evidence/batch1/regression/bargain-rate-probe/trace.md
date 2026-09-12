# Approved rate request confirms at the old rate: regression or pre-existing?

**Verdict: PRE-EXISTING.** Batch 1 did not cause it. The same spec ran at c5c6e03 (before batch 1) and 7f2e198
(main with batch 1): every decision path that approves a held order's rate request confirms the line at the
list rate at BOTH commits. Batch 1 changed two things around it and neither affects the line rate:

- **DOS-005 (40fc300) surfaced it.** Before it, an Approvals-tab approval never approved the request
  (`bargain_requests` stayed `requested`), so no approved rate existed anywhere. After it, the request reads
  `approved 4554` next to a 5117 line. That is the mismatch the walker saw on SO-0897.
- **DOS-020 (32315dc) closed one path.** The manager's direct `orders.confirm` used to approve every pending
  gate silently and confirm at 5117. It now answers 409 `approval_required`.

Found by: `QA/evidence/batch1/regression/part-a-results.json` → sales-owner, "Approving a rate request on
Approvals confirms the order at the old rate, not the approved one" (SO-0897).

## Method

- Two throwaway worktrees, now removed: `b1-probe-before` @ c5c6e03 and `b1-probe-after` @ 7f2e198.
- Each ran on its own copy of `dos_batch1_template` (`dos_b1_probe_before` / `_after`), now dropped. The
  migrations are identical at both commits (43 applied).
- `pnpm install --frozen-lockfile --prefer-offline`, then `pnpm exec turbo run build --filter=@dos/core^...`.
- Run: `pnpm --filter @dos/core exec vitest run --reporter=verbose src/modules/orders/bargain-rate-probe.spec.ts`.
- **The spec file is byte-identical at both commits** (`cmp before.spec.ts after.spec.ts` shows no difference).
  - It boots the real Nest app (`bootTestApp([OrdersModule, InventoryModule, SyncModule])`), as orders.spec.ts does.
  - It makes the apps' HTTP calls with signed tokens for rep, owner and manager.
  - It reads the results straight from the database.
- Fixture: Campa Cola 2 L, list 5117 paise a piece, case of 24, GST 12%. The rep asks 4554.
  - Strict shop with a ₹10 limit: every order is held on `credit_limit` + `bargain`.
  - Indicate shop: `bargain` is the only gate.
- The rep flow matches the sales app's network trace (DOS-005-order1-network.json): `POST /pricing/bargains`
  (with `orderId`), then `POST /orders`, then `POST /orders/{id}/submit`.
- Assertions state the product expectation (docs/22 §4 "Server re-prices at the same version, reserves stock →
  confirmed"). `expect.soft` reports every miss.

Expected, approved rate: rate 4554, discount 13512, tax 13116, line_total **122412**, applied_rules
`[bargain 13512]`, price_locked true, order total 122400.
Wrong, list rate: rate 5117, discount 0, tax 14737, line_total **137545**, applied_rules `[]`, price_locked false,
order total 137500 (SO-0897's exact numbers).

## Results (before.out / after.out, `PROBE_SUMMARY` line)

| Path | c5c6e03 (before batch 1) | 7f2e198 (main, batch 1) |
|---|---|---|
| S1 Approvals: bargain gate, then credit gate (SO-0897 walk) | confirmed, **5117 / 137545 / []**; request stays `requested`, approved rate null | confirmed, **5117 / 137545 / []**; request `approved 4554` |
| S2 Approvals: credit gate, then bargain gate (confirms in the bargain decision's tx) | confirmed, **5117 / 137545 / []**; request `requested`/null | confirmed, **5117 / 137545 / []**; request `approved 4554` |
| S3 Rate requests approve, then Approvals: bargain gate, credit gate | confirmed, **5117 / 137545 / []**; request `approved 4554` | confirmed, **5117 / 137545 / []**; request `approved 4554` |
| S4 Rate requests approve, then manager `orders.confirm` | 200 confirmed (both gates silently approved), **5117 / 137545 / []**; request `approved 4554` | **409 approval_required**; order stays `submitted`, 0 reserved: path closed by DOS-020 |
| S5 bargain is the only gate (indicate shop), Approvals approve | confirmed, **5117 / 137545 / []**; request `requested`/null | confirmed, **5117 / 137545 / []**; request `approved 4554` |
| C1 control: request approved BEFORE the order is created | confirmed, **4554 / 122412 / [bargain 13512]**, locked | confirmed, **4554 / 122412 / [bargain 13512]**, locked |
| C2 control: approved AFTER create, BEFORE submit | confirmed, **5117 / 137545 / []**; request `approved 4554` | confirmed, **5117 / 137545 / []**; request `approved 4554` |
| vitest | 6 failed / 2 passed (print + C1) | 5 failed / 3 passed (print + S4's 409 branch + C1) |

Every confirmed order reserved 24 pieces. The only difference between the commits is what the request row
records (S1/S2/S5) and whether S4 can confirm. The charged line is identical.

## Code path (file:line)

### Where the rate is decided (same at both commits)

`priceOrderLines` runs only when lines are written to a draft:

- `OrdersService.writeLines`: HEAD orders.service.ts:597 → :599; c5c6e03 :558 → :560.
- It is called from create :148, setLines :167, repeatLast :216, sync orders.sync.ts:143, van sale
  delivery/vansales.service.ts:87 and AI drafts ai/drafts.service.ts:157.
- Nothing after draft calls it.

The chain from there:

- `priceOrderLines` (pricing-lines.ts:139, unchanged) calls `quotes.quote()` (:157).
- `QuoteService.loadInputs` (quote.service.ts:199, unchanged) selects approved bargains at :286-312. The rules:
  - same shop, a variant on the order, status `approved`/`auto_approved` (:298), not expired;
  - `order_id` null or this order (:300-302);
  - newest per variant (:312).
- `priceOrder()` step 4 (schemes.ts HEAD :301-318, c5c6e03 :294) matches the bargain **by variantId** (:304),
  not by line or bargain id.
- The line stores `rate_paise` (pricing-lines.ts:192), `applied_rules` (:198) and `price_locked` (:200).
- A bargain still `requested` at draft time is simply absent, so the line is priced at list.

### c5c6e03 (before)

- **Submit.** `submitInTx` (orders.service.ts:252) reads the stored lines and does not re-price.
  - `approvalFlags` (:266; orders.internals.ts:140) raises `bargain` via `hasPendingBargain` (:148/:159).
  - Gates are inserted with `entity_type 'sales_order'` (:288).
- **Approvals.** `ApprovalsService.decide` (approvals.service.ts:67-115) updates only the approval row. The
  bargain request is not touched. The last approval calls `confirmInTx` (:111).
- **Rate requests.** `BargainsService.decide` (bargains.service.ts:144-179) updates only `bargain_requests`
  (:163-174). No gate, no order, no re-price.
- **Confirm.** `confirmInTx` (orders.service.ts:322) blanket-approves pending gates (:327-330), then reserves
  (:345). No re-price.

### 7f2e198 / HEAD (after)

- **Submit.** `submitInTx` (orders.service.ts:254) does not re-price. `approvalFlags` (:268;
  orders.internals.ts:120) gets `bargainIds` from `pendingBargainsForOrder` (:128). There is one gate per request
  with `entity_type 'bargain_request'` (:292-307).
- **Approvals.** `ApprovalsService.decide` (approvals.service.ts:70).
  - It calls `bargains.decideInTx` (:102-112), which sets `status`/`approved_rate_paise` only
    (bargains.service.ts:164, update :186).
  - `stillPending` (:126), then `confirmInTx` (:128).
- **Confirm.** `confirmInTx` (orders.service.ts:337) refuses while gates are pending (:340-351, DOS-020).
  - It then loads the stored lines and reserves them as they are (:353-381, reserve :367), then flips the order
    to confirmed (:382-389).
  - **No re-price.** This is the root cause.

### Downstream (code read, not executed)

The invoice copies the order line: `i.orderLine.ratePaise` and `appliedRules` at
billing/invoices.service.ts:1419, :1447 and :1458. The file is unchanged between the commits, so the bill
would carry 5117 too.

## Root cause at HEAD

An approved bargain is applied to a line only when the line is PRICED, and lines are priced only while the
order is a draft (`writeLines`, orders.service.ts:597-599). Submit, both decision paths and `confirmInTx`
(orders.service.ts:337-391) all work on the stored draft-time lines. So any approval that lands after the draft
was priced is never charged: S1, S2, S3, S5 and C2. docs/22 §4's "Server re-prices at the same version" step is
not implemented at confirm.

## Smallest correct fix

1. **Where.** In `OrdersService.confirmInTx` (orders.service.ts:337), after the DOS-020 pending check (:340-351)
   and before the reservation loop (:353). Every confirm funnels through here: auto-confirm at submit, the last
   `approvals.decide`, and `orders.confirm`.
2. **What.** Re-price the order's stored lines through the existing engine (`priceOrderLines` → `priceOrder()`,
   whose step 4 already takes the approved bargain for this order).
   - Update the lines in place, keeping their ids: rate, discount, tax, line_total, applied_rules, price_locked.
   - Update the header totals.
   - Then reserve and emit `OrderConfirmed` with the new total.
   - All of it in the same transaction as the reservation.
3. **Trap: the quote must read through the caller's transaction.**
   - `QuoteService.quote()` opens its OWN `withTenant(db, …)` transaction (quote.service.ts:67/:71).
   - Called inside `approvals.decide`'s transaction, it reads committed rows only. It would miss the bargain
     approved by that same decision: S2 and S5, where the bargain gate is the last approval and confirm runs in
     the deciding transaction.
   - So add a transaction-scoped quote (`loadRetailer`/`loadVariants`/`loadInputs` already take `tx`, :135/:162/:199).
     Have the confirm-time re-price call it.
4. **"Same version".** `quote()` defaults the pricing date to `todayIst()` (:73), and `sales_orders` stores no
   pricing date (only `pricing_date_mode`, schema orders.ts:86).
   - Pass the date the draft was priced on: the IST business date of `created_at`, or the delivery date in
     `delivery` mode.
   - Then the only difference between the draft price and the confirm price is the newly approved bargain.
   - Keep `price_locked` lines as they are.
   - A bargain only lowers the total, so the credit decision stays valid. If a re-price ever raised the total,
     refuse instead of confirming silently.
5. **Optional.** Also re-price when a bargain on a still-submitted order is approved (`approvals.decide` /
   `pricing.bargains.decide`), so the credit gate and the order panel show the real total before the last
   decision.
6. **Spec.** Promote S1, S2, S3, S5 and C2 into orders.spec.ts, asserting rate_paise 4554, line_total 122412,
   applied_rules carrying the bargain, and order total 122400 after the last approval.

## Files

- `before.spec.ts`, `after.spec.ts`: the probe (identical).
- `before.out`: vitest output at c5c6e03.
- `after.out`: vitest output at 7f2e198.
- Worktrees removed and databases dropped after the runs. Nothing committed; no product code changed.
