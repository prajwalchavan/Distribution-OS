# ADR 0003: Stock ledger

Status: accepted (2026-09-04). Irreversible after first real data; changing it means a migration of ledgers, ids or the sync wire protocol.

## Decision

B's SQL with A's pack hierarchy and C's durable idempotency index:

```sql
stock_lots(id, tenant_id, variant_id, batch_no, mrp numeric(10,2), expiry date, mfg date,
           UNIQUE(tenant_id, variant_id, batch_no, mrp))
stock_ledger(id, tenant_id, occurred_at, lot_id, location_id, qty_delta int,
  reason enum[grn, sale, sale_return_saleable, sale_return_damaged, damage, expiry_writeoff,
              transfer_out, transfer_in, van_load, van_unload, adjustment, cycle_count, opening],
  ref_type, ref_id, actor_id, idempotency_key, created_at, UNIQUE(tenant_id, idempotency_key))
stock_balances(tenant_id, lot_id, location_id, on_hand int CHECK (on_hand >= 0 OR negative_allowed),
  reserved int, version int, PRIMARY KEY(tenant_id, lot_id, location_id))
reservations(id, tenant_id, order_line_id, lot_id NULL, location_id, qty, state enum[pending, posted, voided])
```

Pieces only; cases are display; MRP and expiry are lot attributes **[CHANGE]** (R09 §13). Balance updated in the same transaction with `RETURNING`; nightly re-derivation alarms on drift; corrections are compensating rows. ATP = `on_hand − reserved` through a `sellable_stock` view, the only stock surface reps and retailers see. Leading `(tenant_id, occurred_at)` so monthly partitioning is a data move.

## Source

Synthesis §4.2 (docs/design/SYNTHESIS.md); research R07 §3.2, R08 §2–3.
