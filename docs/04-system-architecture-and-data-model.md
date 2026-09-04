<!-- Derived from the 2026-09-04 architecture synthesis (docs/design/SYNTHESIS.md §4). Edit here; the synthesis is the frozen source. -->

# System architecture

```
                         AWS ap-south-1 (Mumbai)
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │   ECS Fargate ARM                      RDS PostgreSQL 17 (t4g.small, PITR)   │
   │   ┌────────────────────┐  tx + set_config  ┌──────────────────────────────┐   │
   │   │ api  (NestJS 12 /  │ ────────────────► │ RLS FORCE on every tenant    │   │
   │   │  Fastify, oRPC,    │                   │ table; stock_ledger, journal;│   │
   │   │  SSE, /sync/upload,│ LISTEN/NOTIFY     │ pg-boss (outbox); pg_trgm;   │   │
   │   │  /gps/points,      │ (direct conn)     │ publication "powersync"      │   │
   │   │  webhooks)         │                   └───────────┬──────────────────┘   │
   │   ├────────────────────┤                               │ logical replication │
   │   │ worker (same image)│ docint, notify, rollups,      ▼                     │
   │   │  pg-boss consumers │ imports, exports, crons   PowerSync Cloud           │
   │   └────────────────────┘                          (India region verified    │
   │   S3 docs (pre-signed) │ S3 backups (Object Lock) │ wk 1; self-host = exit) │
   │   CloudFront (console PWA, retailer PWA, signed image URLs)   ALB + ACM      │
   └──────────────────────────────────────────────────────────────────────────────┘
        ▲ oRPC/SSE            ▲ oRPC (online-first)         ▲ PowerSync streams + /sync/upload
   Owner console (Vite)   Retailer PWA/native (Expo)    Team app (Expo): owner | sales |
   + Billing desk         + WhatsApp (Meta Cloud API)   warehouse | delivery  (op-sqlite)

   External: Anthropic API (Sonnet 5 default; Gemini 3.x Flash second opinion), Meta WhatsApp Cloud API,
   MSG91 SMS, Google Maps mobile SDK / MapLibre + Ola tiles on web, EAS Build/Update, Grafana Cloud + Sentry;
   later: GSP (EWB/IRN), Windows Tally Connector (Node SEA).
```

One TypeScript monorepo; one NestJS 12 modular monolith on Fastify with a worker from the same image; Postgres 17 as the only stateful system; PowerSync for the Team app only; SSE (not WebSocket) for web realtime; S3 Mumbai for documents and Object-Locked backups.

### 4.1 Modules (bounded contexts; modules talk only through exported application services or outbox events, enforced by `eslint-plugin-boundaries`)

| Module                                                   | Owns                                                                                                                                                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `platform`                                               | `tenants`, `tenant_settings`, `feature_flags`, `idempotency_keys` (online, 24 h), `sync_ops` (device_id, op_id; durable), `sync_errors`, `audit_log`, `numbering_series`                         |
| `identity`                                               | Better Auth tables, `devices`, `location_consents`, `otp_rate_limits`                                                                                                                            |
| `retailers`                                              | global `retailer_identities`; tenant `retailers`, `retailer_links`, `beats`, `beat_assignments`, `pjp`, `visits`, `directory_optins`                                                             |
| `catalog` (global)                                       | `manufacturers`, `brands`, `products`, `product_variants`, `product_packs`, `product_external_codes`, `product_aliases`, `hsn_rates` (dated), `product_proposals`                                |
| `tenant_catalog`                                         | `suppliers`, `return_policies` (tenant × brand), `tenant_products`, `supplier_pack_configs`, `tenant_product_costs` (owner/manager/accountant RLS), `rep_product_authorisations`                 |
| `pricing`                                                | `price_lists`, `price_list_items`, `retailer_price_overrides`, **`schemes`** (single typed table), `bargain_requests`, `rep_auto_approve_bounds`                                                 |
| `orders`                                                 | `sales_orders` (source enum, pricing_date_mode, payment_term, fulfil_from_location), `sales_order_lines` (`applied_rules` jsonb), `order_state_transitions`, `approvals`                         |
| `inventory`                                              | `locations` (warehouse, vehicle, damaged, in_transit), `stock_lots`, `stock_ledger`, `stock_balances`, `reservations`, `cycle_counts`                                                            |
| `procurement`                                            | `purchase_orders`, `supplier_invoices` (+ lines), `lorry_receipts`, `grns`, `grn_lines`, `inbound_discrepancies`                                                                                 |
| `warehouse`                                              | `picklists`, `pick_lines`, `pack_confirmations`, `load_sheets`                                                                                                                                   |
| `billing`                                                | `invoices` (derived; series, GST split, IRN-ready + EWB fields, UPI QR payload, FSSAI), `invoice_lines` (`applied_rules`), `credit_notes`                                                        |
| `receivables`                                            | `accounts` (seeded chart), `journal_entries`, `journal_lines`, `receipts`, `allocations`, `ageing_snapshots`, `cash_discount_conditions`                                                         |
| `delivery`                                               | `vehicles`, `trips`, `trip_stops`, `deliveries`, `delivery_lines`, `pod_evidence`, `collections`, `trip_expenses`, `trip_settlements`, `trip_points`, `vehicle_positions` (one row per vehicle)  |
| `docint` (thin module over the `backend/docint` library) | `documents`, `document_pages`, `extractions`, `extraction_checks`, `sku_match_candidates`, `review_sessions` (single-writer lock), `corrections_log`, `engine_disagreements`, `supplier_aliases` |
| `claims` (schema now, UI post-pilot)                     | `claims`, `claim_lines`, `claim_evidence`, `claim_statements`                                                                                                                                    |
| `notifications`                                          | `templates` (hi/en/mr), `messages` (channel, status, cost), `whatsapp_windows`, `inbound_messages`, `push_tokens`                                                                                |
| `reporting`                                              | `daily_tenant_stats`, `daily_rep_stats`, `retailer_behaviour`, `owner_summary` (synced), materialized views, SSE hub                                                                             |
| `integrations`                                           | `tally_mappings`, `tally_sync_ledger` (GUID, LASTVCHID), `export_jobs`, `import_jobs`, `import_rows`; later `gsp_credentials` (KMS envelope), `ewb_documents`, `external_channel_orders`         |
| `incentives`                                             | `targets`, `achievements`, `computed_payouts`                                                                                                                                                    |

### 4.2 Data model: the irreversible eight (ADRs 0001–0008, written in weeks 1–3)

**ADR 0001 — IDs.** UUIDv7 as `id text` on every synced table, generated on the client for offline creation (PowerSync requires text ids, R07 §3.2). Human numbers (`GL/1686`, `GRN-0042`) are separate server-assigned columns from `numbering_series(tenant_id, series_code, fy, next_no)` under `SELECT … FOR UPDATE` at commit, ≤ 16 characters, unique per series per FY (IRN-ready, R05 §4).

**ADR 0002 — Tenancy.** Shared schema, `tenant_id uuid NOT NULL` on every tenant table, `ENABLE` + `FORCE ROW LEVEL SECURITY`, two DB roles (`app_owner` for migrations, `app_rw` for API/worker with no `BYPASSRLS`), every unit of work inside a transaction that starts with `set_config('app.tenant_id'|'app.actor_role'|'app.actor_id', …, true)`; policies read `(SELECT current_setting(...))`; every index leads with `tenant_id`; Drizzle adds `WHERE tenant_id = ?` as defence in depth (R08 §2.2). Global tables have no `tenant_id`; writes only under `actor_role = 'curator'` or the identity service. `tenant_product_costs` carries an extra role predicate so the Vyapar failure is a database guarantee; CI dumps a salesperson device after full sync and every oRPC response for that role and asserts no cost or margin column or value appears.

**ADR 0003 — Stock ledger.** B's SQL with A's pack hierarchy and C's durable idempotency index:

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

**ADR 0004 — Money ledger.** `accounts` seeded per tenant (AR, Cash, UPI clearing per VPA, Sales @ rate, Output CGST/SGST/IGST, Discounts, Sales returns, Round off, Scheme receivable per manufacturer, Claims receivable); `journal_entries` + `journal_lines` balancing to the paisa (service check plus deferred constraint trigger; `UNIQUE(tenant_id, idempotency_key)`); `receipts` + `allocations` — invoices are never mutated for payment state. Outstanding = AR balance per party; ageing = open invoices minus allocations. Cash discount is a conditional realised at receipt within the window (R09 §12.20). Credit notes reverse at the original rate.

**ADR 0005 — Product master.** **Resolved for B's shape with A's pack hierarchy:**

```sql
products(id, manufacturer_id, brand_id, name, status enum[active, proposed, merged_into], merged_into NULL, ondc_category, fssai_relevant)
product_variants(id, product_id, net_qty, net_unit, promo_extra NULL, default_case_size, hsn_code, ean NULL)
product_packs(variant_id, level enum[piece, inner, case], qty_in_parent int)
supplier_pack_configs(tenant_id, supplier_id, variant_id, pcs_per_case, supplier_code, margin_basis)
tenant_products(tenant_id, variant_id, listed, local_alias, case_size_override NULL, min_order_qty, order_increment, max_per_order NULL)
tenant_product_costs(tenant_id, variant_id, lot_id NULL, purchase_rate, landed_cost, ptd, updated_from_grn_id)
```

`supplier_pack_configs` models Guru Kripa "x 90" vs Guiltfree "_120" vs Reliance "CS1". Curator merges set `merged_into` and rewrite aliases, external codes and `tenant_products`, never ledger rows. Distributor proposals are usable immediately as `proposed` and enter the console's curation queue.

**ADR 0006 — Retailer identity.** `retailer_identities` (global; E.164 phone unique; optional GSTIN/FSSAI; consent version and timestamps) ↔ `retailers` (tenant private record: code, tier, credit limit amount/bills/days, `credit_mode enum[indicate, strict, stop]`, `payment_terms enum[PRE, ON, POST_FULFILLMENT]`, beat, lat/lng from device, `gst_reg_type`, `tally_ledger_name`, brand-DMS ids) ↔ `retailer_links(identity_id, tenant_id, retailer_id, linked_by enum[rep_onboarding, directory_optin, import], status)`. Better Auth memberships list a retailer's tenants; the PWA shows one card each. Credit, tier, band and code are absent from every retailer-role write contract and from the retailer `WITH CHECK` policy. Directory links start `stop`/`PRE`.

**ADR 0007 — Sync write protocol.** `POST /sync/upload` with `X-Sync-Protocol: 1`; 2xx + `sync_errors` for business rejections, 5xx only for transient faults; `sync_ops(tenant_id, device_id, op_id)` unique, retained ≥ 180 days (§7).

**ADR 0008 — Pricing engine.** `priceOrder(order, priceLists, overrides, schemes, clock, pricingDate)` is a pure function in `shared/domain` with zero runtime dependencies, identical on device and server. Order fixed by CONTEXT: price list tier → retailer override wins → schemes stack unless `final` → cash discount conditional at receipt.

```ts
type SchemeRule = {
  id; tenantId; scope: {brand?|category?|variantIds?|all};
  trigger: {kind:'qty'|'value'|'mix'; min:number; unit:'pcs'|'case'|'inr'; slabs?:Slab[]};
  reward: {kind:'free_qty'|'line_pct'|'order_pct'|'cash_discount_pct'|'net_scheme_amount'; value:number; freeVariantId?};
  applicability: {tiers?:string[]; retailerIds?:string[]; beatIds?:string[]};
  validFrom; validTo; version:number; stackable:boolean; final:boolean;
  fundingSource:'company'|'distributor'; claimable:boolean; brandId?; claimWindowDays?;
  gstOnFreeGoods:boolean; pricingDateMode:'order'|'delivery';
}
```

Every order and invoice line stores `applied_rules jsonb [{rule_id, version, kind, amount|free_qty}]` (from C) so the bill prints Free / Scheme % / Disc ₹ / Cash Dis % exactly as invoices E and F do and claims reconstruct later. **Resolved: one `schemes` table in `pricing`** read by the engine and referenced by `claims`; B's `promotion_rules` + `schemes` split is a duplication.

### 4.3 State vocabularies (fixed now, ONDC-shaped)

- **Fulfilment:** `draft → submitted → confirmed → picking → packed → dispatched → delivered | partially_delivered → closed | cancelled`. Approvals gate `submitted → confirmed`; reservations post on `confirmed`. ONDC `on_status`: Created/Accepted (submitted/confirmed), In-progress (picking…dispatched), Completed, Cancelled (R04 §6). B's `authorised` and C's `approved/reserved` are side effects, not states.
- **Delivery stop:** `pending → started → arrived → delivered | partial | failed[reason]`, monotonic, server-enforced.
- **Invoice-payment:** `issued → partially_paid → paid → written_off`; credit notes are separate documents.
- **Trip:** `planned → loading → active → closing → settled | settled_with_variance`.

### 4.4 Invoice timing (resolved; Judge 3)

Invoices are issued at **pack** for pre-sold orders — numbered, printed, possibly e-way-billed, travelling with the goods — and **never regenerated**. Shortfall or doorstep return produces a **credit note** at the original rate and posts pieces back from the vehicle. Van-sales orders are invoiced at delivery from the vehicle. A's and C's "delivered quantities regenerate the invoice" is rejected: an issued GST invoice is immutable.
