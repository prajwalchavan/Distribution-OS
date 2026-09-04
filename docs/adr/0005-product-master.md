# ADR 0005: Product master

Status: accepted (2026-09-04). Irreversible after first real data; changing it means a migration of ledgers, ids or the sync wire protocol.

## Decision

**Resolved for B's shape with A's pack hierarchy:**

```sql
products(id, manufacturer_id, brand_id, name, status enum[active, proposed, merged_into], merged_into NULL, ondc_category, fssai_relevant)
product_variants(id, product_id, net_qty, net_unit, promo_extra NULL, default_case_size, hsn_code, ean NULL)
product_packs(variant_id, level enum[piece, inner, case], qty_in_parent int)
supplier_pack_configs(tenant_id, supplier_id, variant_id, pcs_per_case, supplier_code, margin_basis)
tenant_products(tenant_id, variant_id, listed, local_alias, case_size_override NULL, min_order_qty, order_increment, max_per_order NULL)
tenant_product_costs(tenant_id, variant_id, lot_id NULL, purchase_rate, landed_cost, ptd, updated_from_grn_id)
```

`supplier_pack_configs` models Guru Kripa "x 90" vs Guiltfree "_120" vs Reliance "CS1". Curator merges set `merged_into` and rewrite aliases, external codes and `tenant_products`, never ledger rows. Distributor proposals are usable immediately as `proposed` and enter the console's curation queue.

## Source

Synthesis §4.2 (docs/design/SYNTHESIS.md); research R07 §3.2, R08 §2–3.
