import type { ActorRole } from './client.js'

/**
 * THE READ SETS: which tables a field device keeps in its own SQLite copy, and therefore which tables
 * the database must make pull-able and tombstone-able.
 *
 * Founder decision 2026-09-05 (docs/22 §8, docs/26 §5): offline sync is ours — no PowerSync. The
 * device holds SQLite tables filled by `GET /sync/pull` deltas and writes back through
 * `POST /sync/upload`. A delta is "every row of this table whose `updated_at` is after my cursor",
 * which the database guarantees three ways, all installed by migrations 0038/0039:
 *
 *  1. every table below carries `updated_at`, stamped by ONE shared trigger function
 *     (`dos_touch_updated_at`, `clock_timestamp()`) on INSERT and UPDATE, so the value is the
 *     database's clock and never an app server's or a phone's;
 *  2. every table below carries an index on `(tenant_id, updated_at)` — `(updated_at)` for the four
 *     global curated tables, which have no tenant — so a delta is a range scan, not a table scan
 *     (docs/20: bounded work per request, at lakhs of rows per tenant);
 *  3. a row that is deleted, or that leaves a field role's read set without being deleted, files a
 *     row in `sync_tombstones` through `dos_sync_tombstone()` / `dos_sync_soft_hide()`, because a
 *     row that is gone has no `updated_at` left to find it by.
 *
 * This file is the single list the three of them are checked against: the 0039 assertion refuses to
 * finish unless every table here has the column, the index and the triggers, and `rls.test.ts` walks
 * the same list. `SyncRegistry.registerPull` in `@dos/core` decides what a given role actually
 * receives (and the module that owns a table decides the extra predicate — a rep's own beat, a shop's
 * own orders); RLS decides, underneath both, what the caller may see at all. **No table here carries a
 * purchase cost, a landed cost or a margin**, and none ever may: the cost of goods lives in
 * `tenant_product_costs`, `supplier_invoice_lines`, `grns` and `claim_lines`, which are back-office
 * tables that no device syncs (docs/22 §9 never-list 1).
 */
export interface SyncPullTable {
  /** SQL table name. */
  readonly table: string
  /**
   * Columns whose values, joined by `:`, make a tombstone's `row_id`. `['id']` everywhere except the
   * two summary tables, which are keyed by their business key instead of a UUID.
   */
  readonly key: readonly string[]
  /**
   * `tenant` = the row's own `tenant_id` scopes the tombstone; `global` = the curated catalog, whose
   * tombstones are filed under the sentinel `'*'` and read by every tenant.
   */
  readonly scope: 'tenant' | 'global'
  /** The field roles that hold this table on a device (docs/07, docs/22 §4; `retailer` is online-only today but pulls the same shapes). */
  readonly roles: readonly ActorRole[]
}

const SALES: readonly ActorRole[] = ['salesperson']
const DELIVERY: readonly ActorRole[] = ['delivery']
const WAREHOUSE: readonly ActorRole[] = ['warehouse']
const SHOP: readonly ActorRole[] = ['retailer']
const EVERY_DEVICE: readonly ActorRole[] = ['salesperson', 'delivery', 'warehouse', 'retailer']

const tenantTable = (
  table: string,
  roles: readonly ActorRole[],
  key: readonly string[] = ['id'],
): SyncPullTable => ({ table, key, scope: 'tenant', roles })

const globalTable = (table: string, roles: readonly ActorRole[]): SyncPullTable => ({
  table,
  key: ['id'],
  scope: 'global',
  roles,
})

/**
 * Every pull-able table, with who holds it. Ordered as the apps read them: the shop and its beat, the
 * order, the price, the bill, the money, the road, the godown, the catalog.
 */
export const SYNC_PULL_TABLES: readonly SyncPullTable[] = [
  // The rep's beat and the shops on it; the crew needs the shops of its own stops, the shop its own row.
  tenantTable('retailers', [...SALES, ...DELIVERY, ...SHOP]),
  tenantTable('retailer_links', [...SALES, ...SHOP]),
  tenantTable('beats', SALES),
  tenantTable('beat_assignments', SALES),
  tenantTable('pjp', SALES),
  tenantTable('visits', SALES),
  // Orders: the rep's own shops', the shop's own.
  tenantTable('sales_orders', [...SALES, ...SHOP]),
  tenantTable('sales_order_lines', [...SALES, ...SHOP]),
  // Price on the device, so the rep quotes the same number offline that the server would (ADR 0008).
  tenantTable('price_lists', [...SALES, ...SHOP]),
  tenantTable('price_list_items', [...SALES, ...SHOP]),
  tenantTable('retailer_price_overrides', SALES),
  tenantTable('schemes', [...SALES, ...SHOP]),
  tenantTable('bargain_requests', SALES),
  // Bills and money. The header and the outstanding, never a cost column — invoice lines carry the
  // SELLING rate and the tax, which is what the shop is charged and what the crew shows at the door.
  tenantTable('invoices', [...SALES, ...DELIVERY, ...SHOP]),
  tenantTable('invoice_lines', [...SALES, ...DELIVERY, ...SHOP]),
  tenantTable('credit_notes', [...DELIVERY, ...SHOP]),
  tenantTable('credit_note_lines', [...DELIVERY, ...SHOP]),
  tenantTable('receipts', [...DELIVERY, ...SHOP]),
  tenantTable('retailer_outstanding_summary', [...SALES, ...DELIVERY, ...SHOP], ['retailer_id']),
  // The road.
  tenantTable('trips', DELIVERY),
  tenantTable('trip_stops', DELIVERY),
  tenantTable('deliveries', DELIVERY),
  tenantTable('delivery_lines', DELIVERY),
  tenantTable('vehicles', DELIVERY),
  // Load-out paperwork: written in the godown, carried by the crew.
  tenantTable('load_sheets', [...WAREHOUSE, ...DELIVERY]),
  tenantTable('delivery_challans', [...WAREHOUSE, ...DELIVERY]),
  // The godown floor.
  tenantTable('picklists', WAREHOUSE),
  tenantTable('pick_lines', WAREHOUSE),
  tenantTable('pack_confirmations', WAREHOUSE),
  tenantTable('locations', WAREHOUSE),
  tenantTable('stock_lots', WAREHOUSE),
  tenantTable('stock_balances', WAREHOUSE, ['lot_id', 'location_id']),
  // Catalog: the tenant's listing, then the global master behind it.
  tenantTable('tenant_products', EVERY_DEVICE),
  globalTable('products', EVERY_DEVICE),
  globalTable('product_variants', EVERY_DEVICE),
  globalTable('manufacturers', EVERY_DEVICE),
  globalTable('brands', EVERY_DEVICE),
]

/** Table names only, in the same order — what the migration assertion and `rls.test.ts` walk. */
export const SYNC_PULL_TABLE_NAMES: readonly string[] = SYNC_PULL_TABLES.map((t) => t.table)

/** The pull-able tables a given role's device holds. */
export function syncPullTablesFor(role: ActorRole): readonly SyncPullTable[] {
  return SYNC_PULL_TABLES.filter((t) => t.roles.includes(role))
}

/**
 * Column names that may never appear in anything a device pulls (docs/22 §9 never-list 1). RLS already
 * denies the tables that hold them; this list is what the tests assert the pull-able set against, so a
 * later migration that adds `landed_cost_paise` to `stock_lots` fails CI instead of shipping.
 */
export const FORBIDDEN_PULL_COLUMN_PATTERNS: readonly RegExp[] = [
  /cost/i,
  /margin/i,
  /landed/i,
  /purchase/i,
  /ptd/i,
]
