# ADR 0008: Pricing engine

Status: accepted (2026-09-04). Irreversible after first real data; changing it means a migration of ledgers, ids or the sync wire protocol.

## Decision

`priceOrder(order, priceLists, overrides, schemes, clock, pricingDate)` is a pure function in `backend/libs/domain` with zero runtime dependencies, identical on device and server. Order fixed by CONTEXT: price list tier → retailer override wins → schemes stack unless `final` → cash discount conditional at receipt.

```ts
type SchemeRule = {
  id; tenantId; scope: {brand?|category?|variantIds?|all};
  trigger: {kind:'qty'|'value'|'mix'; min:number; unit:'pcs'|'case'|'inr'; slabs?:Slab[]};
  reward: {kind:'free_qty'|'line_pct'|'order_pct'|'cash_discount_pct'|'net_scheme_amount'|'per_unit_amount'; value:number; freeVariantId?};
  applicability: {tiers?:string[]; retailerIds?:string[]; beatIds?:string[]};
  validFrom; validTo; version:number; stackable:boolean; final:boolean;
  fundingSource:'company'|'distributor'; claimable:boolean; brandId?; claimWindowDays?;
  gstOnFreeGoods:boolean; pricingDateMode:'order'|'delivery';
}
```

**Reward kinds that pay money.** `net_scheme_amount` pays its value once per MULTIPLE of the trigger
("₹15 for every 2 cases"). `per_unit_amount` (DOS-087; founder, 2026-09-13) pays its value on EVERY
whole trigger unit once `triggerMin` is reached — "₹15 off per case on 2+" is ₹30 on two cases and
₹45 on three, which is the commonest flat trade scheme in Indian FMCG. Whole units only: 2 cs + 6
loose pieces on a per-case scheme pays for two cases. A slab REPLACES the per-unit amount (it does
not multiply it), and a rupee (`inr`) trigger is refused by the contract and by the engine — there is
no unit to pay per.

Every order and invoice line stores `applied_rules jsonb [{rule_id, version, kind, amount|free_qty}]` (from C) so the bill prints Free / Scheme % / Disc ₹ / Cash Dis % exactly as invoices E and F do and claims reconstruct later. **Resolved: one `schemes` table in `pricing`** read by the engine and referenced by `claims`; B's `promotion_rules` + `schemes` split is a duplication.

## Source

Synthesis §4.2 (docs/design/SYNTHESIS.md); research R07 §3.2, R08 §2–3.
