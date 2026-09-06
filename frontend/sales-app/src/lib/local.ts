/**
 * The device's own copy of the beat, read through `@dos/offline`.
 *
 * WHY THE FIELD SCREENS READ SQLITE AND NOT THE SERVICE. A rep walks 30–60 shops a day on a cheap
 * Android phone, one hand, in the sun, on a connection that comes and goes (docs/23 §3.4). A screen
 * that calls a service when the doorway has no signal is a screen that is blank in the doorway. So
 * S1, S2, S3, S6, S8, S11 and S12 read the tables `sync.pull` has already put on the phone, and only
 * the screens that are honestly online — targets, the lapsed list, the drafts queue, the inbox, a
 * credit check, the exact open amount of a bill — call sales-service.
 *
 * WHAT THIS FILE IS NOT. It is not a second copy of the wire types: nothing here is a shape
 * `@dos/contracts` already declares. These are the DEVICE rows — snake_case, exactly the columns
 * `GET /sync/manifest` publishes for the salesperson role, decoded by the engine (booleans as
 * booleans, `jsonb` parsed). The manifest is the authority; a column this file names and the manifest
 * drops comes back `undefined`, never a lie.
 *
 * The 21 tables the salesperson's manifest carries, and what this file does with them:
 *   beats · beat_assignments · pjp · retailers · retailer_links → the beat and the shop card
 *   visits                                                      → the visit history and today's ticks
 *   sales_orders · sales_order_lines (the only WRITABLE two)     → my orders and the draft being built
 *   retailer_outstanding_summary · invoices · invoice_lines      → dues, ageing and the shop's bills
 *   tenant_products · product_variants · products · brands · manufacturers → the catalog
 *   price_lists · price_list_items · schemes · retailer_price_overrides · bargain_requests → the price
 */
import { useSyncStatus, useTable } from '@dos/offline/react'
import { useMemo } from 'react'

// ---------------------------------------------------------------------------
// The device rows (the manifest's own column names)
// ---------------------------------------------------------------------------

/** What the engine adds to a row of a writable table: what the outbox is doing with it. */
export interface LocalMeta {
  _pending?: 'queued' | 'sending' | 'rejected' | null
  _local_rev?: number | null
}

export interface LocalRetailer {
  id: string
  code: string | null
  name: string
  owner_name: string | null
  phone: string | null
  alt_phone: string | null
  address: Record<string, string> | null
  lat: number | null
  lng: number | null
  beat_id: string | null
  tier: string | null
  gst_reg_type: string | null
  gstin: string | null
  state_code: string | null
  credit_limit_paise: number | null
  credit_limit_bills: number | null
  credit_days: number | null
  credit_mode: string | null
  payment_terms: string | null
  cash_discount_bps: number | null
  cash_discount_days: number | null
  active: boolean
  updated_at: string | null
}

export interface LocalBeat {
  id: string
  name: string
  area: string | null
  visit_days: number[] | null
  active: boolean
}

export interface LocalBeatAssignment {
  id: string
  beat_id: string
  user_id: string
  valid_from: string
  valid_to: string | null
}

export interface LocalPjp {
  id: string
  beat_id: string
  retailer_id: string
  sequence: number
}

export interface LocalVisit {
  id: string
  retailer_id: string
  user_id: string
  beat_id: string | null
  started_at: string
  ended_at: string | null
  outcome: string | null
  reason: string | null
  lat: number | null
  lng: number | null
  note: string | null
}

export interface LocalOrder extends LocalMeta {
  id: string
  order_no: string | null
  retailer_id: string
  state: string
  source: string | null
  salesperson_id: string | null
  subtotal_paise: number | null
  discount_paise: number | null
  tax_paise: number | null
  round_off_paise: number | null
  total_paise: number | null
  approval_flags: string[] | null
  expected_delivery_date: string | null
  note: string | null
  submitted_at: string | null
  confirmed_at: string | null
  cancelled_at: string | null
  created_at: string
}

export interface LocalOrderLine extends LocalMeta {
  id: string
  order_id: string
  line_no: number | null
  variant_id: string
  entered_qty: number
  entered_unit: string
  pack_size_at_entry: number | null
  qty_pcs: number | null
  free_qty_pcs: number | null
  list_rate_paise: number | null
  rate_paise: number | null
  discount_paise: number | null
  gst_bps: number | null
  tax_paise: number | null
  line_total_paise: number | null
}

export interface LocalOutstanding {
  retailer_id: string
  outstanding_paise: number
  overdue_paise: number
  unallocated_credit_paise: number
  open_bills: number
  oldest_due_date: string | null
  oldest_invoice_date: string | null
  last_receipt_at: string | null
  last_receipt_paise: number | null
  bucket_0_7_paise: number
  bucket_8_15_paise: number
  bucket_16_30_paise: number
  bucket_31_60_paise: number
  bucket_61_90_paise: number
  bucket_90_plus_paise: number
  as_of: string | null
}

export interface LocalInvoice {
  id: string
  invoice_no: string | null
  invoice_date: string
  due_date: string | null
  retailer_id: string
  order_id: string | null
  state: string
  total_paise: number
  cash_discount_bps: number | null
  cash_discount_until: string | null
}

export interface LocalTenantProduct {
  id: string
  variant_id: string
  listed: boolean
  local_alias: string | null
  case_size_override: number | null
  min_order_qty: number
  order_increment: number
  max_per_order: number | null
  sort_order: number | null
}

export interface LocalVariant {
  id: string
  product_id: string
  name: string
  net_qty: number | null
  net_unit: string | null
  default_case_size: number
  hsn_code: string | null
  mrp_paise: number | null
  status: string
}

export interface LocalProduct {
  id: string
  brand_id: string | null
  manufacturer_id: string | null
  name: string
  category: string | null
  status: string
}

export interface LocalBrand {
  id: string
  manufacturer_id: string | null
  name: string
}

export interface LocalPriceList {
  id: string
  name: string
  tier: string | null
  is_default: boolean
  valid_from: string | null
  valid_to: string | null
  active: boolean
}

export interface LocalPriceListItem {
  id: string
  price_list_id: string
  variant_id: string
  rate_paise: number
  inclusive_of_gst: boolean
}

export interface LocalSchemeRow {
  id: string
  name: string
  brand_id: string | null
  scope: Record<string, unknown> | null
  trigger_kind: string
  trigger_min: number
  trigger_unit: string
  slabs: { min: number; value: number; freeVariantId?: string }[] | null
  reward_kind: string
  reward_value: number
  free_variant_id: string | null
  applicability: Record<string, unknown> | null
  valid_from: string
  valid_to: string
  priority: number | null
  version: number
  stackable: boolean
  final: boolean
  gst_on_free_goods: boolean
  pricing_date_mode: string
  active: boolean
}

export interface LocalOverride {
  id: string
  retailer_id: string
  variant_id: string
  rate_paise: number
  final: boolean
  valid_from: string
  valid_to: string | null
}

export interface LocalBargain {
  id: string
  retailer_id: string
  variant_id: string
  order_id: string | null
  requested_by: string | null
  list_rate_paise: number
  asked_rate_paise: number
  approved_rate_paise: number | null
  status: string
  expires_at: string | null
  note: string | null
  created_at: string
}

// ---------------------------------------------------------------------------
// Is the device actually holding anything?
// ---------------------------------------------------------------------------

export interface LocalState {
  /** The engine has created its tables and knows what it holds. */
  ready: boolean
  /** A pull has completed at least once: an empty table now MEANS empty. */
  hydrated: boolean
  /** The radio is on and the last call reached a service. */
  online: boolean
  /** False for the memory adapter — the strip has to say so, and so does an empty screen. */
  persistent: boolean
  pending: number
  rejected: number
}

/**
 * The one honest answer to "is this screen empty, or is the phone still filling up?".
 *
 * Without it every list on this app would print "No shops on this beat" for the first few seconds of
 * a cold start, which is the single most damaging thing a field app can say to a rep standing in a
 * doorway.
 */
export function useLocalState(): LocalState {
  const status = useSyncStatus()
  return {
    ready: status.ready,
    hydrated: status.lastPulledAt !== null,
    online: status.online,
    persistent: status.persistent,
    pending: status.pending,
    rejected: status.rejected,
  }
}

// ---------------------------------------------------------------------------
// The beat
// ---------------------------------------------------------------------------

export function useBeats(): LocalBeat[] {
  return useTable<LocalBeat>('beats', { orderBy: 'name ASC' }).rows
}

/**
 * The beats this rep is on today.
 *
 * `beat_assignments` is a date RANGE per rep per beat, and the pull already scopes it to the signed-in
 * user — but a rep who has worked a beat since January has one row and a rep moved twice has three,
 * so the same beat arrives more than once and the list has to be made a set. `valid_to` is null for
 * "still on it".
 */
export function useMyBeatIds(userId: string | null, onDate: string): string[] {
  const { rows } = useTable<LocalBeatAssignment>('beat_assignments', {
    where: 'user_id = ? AND valid_from <= ? AND (valid_to IS NULL OR valid_to >= ?)',
    params: [userId ?? '', onDate, onDate],
  })
  return useMemo(() => [...new Set(rows.map((row) => row.beat_id))], [rows])
}

/** The shops of one beat, in the order the round is walked (`pjp.sequence`), then by name. */
export function useBeatShops(beatId: string | null): {
  shops: LocalRetailer[]
  loading: boolean
} {
  const retailers = useTable<LocalRetailer>('retailers', {
    where: 'beat_id = ? AND active = 1',
    params: [beatId ?? ''],
    orderBy: 'name ASC',
  })
  const pjp = useTable<LocalPjp>('pjp', {
    where: 'beat_id = ?',
    params: [beatId ?? ''],
    orderBy: 'sequence ASC',
  })
  const shops = useMemo(() => {
    const order = new Map(pjp.rows.map((row) => [row.retailer_id, row.sequence]))
    return [...retailers.rows].sort((a, b) => {
      const left = order.get(a.id) ?? Number.MAX_SAFE_INTEGER
      const right = order.get(b.id) ?? Number.MAX_SAFE_INTEGER
      return left === right ? a.name.localeCompare(b.name) : left - right
    })
  }, [retailers.rows, pjp.rows])
  return { shops, loading: retailers.loading || pjp.loading }
}

/** Every shop the device holds, for the Shops tab's search. */
export function useAllShops(): { shops: LocalRetailer[]; loading: boolean } {
  const { rows, loading } = useTable<LocalRetailer>('retailers', {
    where: 'active = 1',
    orderBy: 'name ASC',
  })
  return { shops: rows, loading }
}

export function useShop(retailerId: string | null): LocalRetailer | null {
  const { rows } = useTable<LocalRetailer>('retailers', {
    where: 'id = ?',
    params: [retailerId ?? ''],
    limit: 1,
  })
  return rows[0] ?? null
}

/** Today's visits by this rep, keyed by shop — the ticks down the beat list. */
export function useVisitsByShop(userId: string | null, sinceIso: string): Map<string, LocalVisit> {
  const { rows } = useTable<LocalVisit>('visits', {
    where: 'user_id = ? AND started_at >= ?',
    params: [userId ?? '', sinceIso],
    orderBy: 'started_at DESC',
  })
  return useMemo(() => {
    const byShop = new Map<string, LocalVisit>()
    for (const visit of rows)
      if (!byShop.has(visit.retailer_id)) byShop.set(visit.retailer_id, visit)
    return byShop
  }, [rows])
}

export function useMyVisits(userId: string | null, limit = 200): LocalVisit[] {
  return useTable<LocalVisit>('visits', {
    where: 'user_id = ?',
    params: [userId ?? ''],
    orderBy: 'started_at DESC',
    limit,
  }).rows
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

/**
 * My orders, newest first — and a row this device has just written above every one of them.
 *
 * `_local_rev DESC` is not decoration: a queued draft carries a fresh UUIDv7 whose id can sort below
 * ninety days of seeded orders, and the one row the rep is looking for is the one they just made.
 */
export function useMyOrders(limit = 200): { orders: LocalOrder[]; loading: boolean } {
  const { rows, loading } = useTable<LocalOrder>('sales_orders', {
    orderBy: '_local_rev DESC, created_at DESC, id DESC',
    limit,
  })
  return { orders: rows, loading }
}

/**
 * Every order this device holds for a KNOWN set of shops — the beat's shops — newest first.
 *
 * Why not `useMyOrders()` with a cap: the beat screen used the newest 200 of the rep's orders to
 * work out when each shop last bought, and ninety days of a busy beat is far more than 200. On the
 * pilot data (442 orders on the device) that window ended inside 5 September, so six of the nine
 * shops on the round were labelled **"No order yet"** while the shop's own card, three taps away,
 * said "Last order 4 Sep" — the line a rep uses to decide where the next ten minutes go, wrong in
 * the direction that costs an order. Scoping by shop instead of capping by count makes the answer
 * exact and the query smaller: one beat is a few dozen shops, never the whole ninety days.
 */
export function useOrdersForShops(retailerIds: readonly string[]): LocalOrder[] {
  const ids = retailerIds.length === 0 ? [''] : [...retailerIds]
  return useTable<LocalOrder>('sales_orders', {
    where: `retailer_id IN (${ids.map(() => '?').join(', ')})`,
    params: ids,
    orderBy: 'created_at DESC, id DESC',
  }).rows
}

export function useShopOrders(retailerId: string | null, limit = 50): LocalOrder[] {
  return useTable<LocalOrder>('sales_orders', {
    where: 'retailer_id = ?',
    params: [retailerId ?? ''],
    orderBy: '_local_rev DESC, created_at DESC, id DESC',
    limit,
  }).rows
}

export function useOrder(orderId: string | null): LocalOrder | null {
  const { rows } = useTable<LocalOrder>('sales_orders', {
    where: 'id = ?',
    params: [orderId ?? ''],
    limit: 1,
  })
  return rows[0] ?? null
}

export function useOrderLines(orderId: string | null): LocalOrderLine[] {
  return useTable<LocalOrderLine>('sales_order_lines', {
    where: 'order_id = ?',
    params: [orderId ?? ''],
    orderBy: 'line_no ASC, id ASC',
  }).rows
}

/** The shop's last order that was not cancelled — what "repeat last order" copies. */
export function useLastOrderOf(retailerId: string | null): LocalOrder | null {
  const orders = useShopOrders(retailerId, 20)
  return useMemo(
    () => orders.find((order) => order.state !== 'cancelled' && order.state !== 'draft') ?? null,
    [orders],
  )
}

// ---------------------------------------------------------------------------
// Money the rep may see: dues, ageing, bills. Never a cost, never a margin (docs/23 §3.3).
// ---------------------------------------------------------------------------

export function useOutstanding(retailerId: string | null): LocalOutstanding | null {
  const { rows } = useTable<LocalOutstanding>('retailer_outstanding_summary', {
    where: 'retailer_id = ?',
    params: [retailerId ?? ''],
    limit: 1,
  })
  return rows[0] ?? null
}

/** Dues for a whole beat in one query, so the beat list can carry a figure per row. */
export function useOutstandingByShop(): Map<string, LocalOutstanding> {
  const { rows } = useTable<LocalOutstanding>('retailer_outstanding_summary', {})
  return useMemo(() => new Map(rows.map((row) => [row.retailer_id, row])), [rows])
}

export function useShopInvoices(retailerId: string | null, limit = 50): LocalInvoice[] {
  return useTable<LocalInvoice>('invoices', {
    where: 'retailer_id = ?',
    params: [retailerId ?? ''],
    orderBy: 'invoice_date DESC, id DESC',
    limit,
  }).rows
}

// ---------------------------------------------------------------------------
// The catalog, joined on the device
// ---------------------------------------------------------------------------

/** One sellable line of this distributor's catalog, as the order screen needs it. */
export interface CatalogItem {
  variantId: string
  tenantProductId: string
  /** The local alias if the distributor set one, else the variant's own name. */
  name: string
  variantName: string
  productName: string
  brandId: string | null
  brandName: string | null
  category: string | null
  /** Sell-side: `case_size_override` else `default_case_size` (docs/17 B). */
  caseSize: number
  mrpPaise: number | null
  hsnCode: string | null
  minOrderQty: number
  orderIncrement: number
  maxPerOrder: number | null
  sortOrder: number
}

export function useCatalog(): { items: CatalogItem[]; loading: boolean } {
  const tenantProducts = useTable<LocalTenantProduct>('tenant_products', {
    where: 'listed = 1',
  })
  const variants = useTable<LocalVariant>('product_variants', {})
  const products = useTable<LocalProduct>('products', {})
  const brands = useTable<LocalBrand>('brands', {})

  const items = useMemo(() => {
    const byVariant = new Map(variants.rows.map((row) => [row.id, row]))
    const byProduct = new Map(products.rows.map((row) => [row.id, row]))
    const byBrand = new Map(brands.rows.map((row) => [row.id, row]))
    const out: CatalogItem[] = []
    for (const tp of tenantProducts.rows) {
      const variant = byVariant.get(tp.variant_id)
      if (variant === undefined || variant.status === 'merged') continue
      const product = byProduct.get(variant.product_id)
      const brand = product?.brand_id === null ? undefined : byBrand.get(product?.brand_id ?? '')
      out.push({
        variantId: variant.id,
        tenantProductId: tp.id,
        name: tp.local_alias ?? variant.name,
        variantName: variant.name,
        productName: product?.name ?? variant.name,
        brandId: product?.brand_id ?? null,
        brandName: brand?.name ?? null,
        category: product?.category ?? null,
        caseSize: tp.case_size_override ?? variant.default_case_size,
        mrpPaise: variant.mrp_paise,
        hsnCode: variant.hsn_code,
        minOrderQty: tp.min_order_qty,
        orderIncrement: tp.order_increment,
        maxPerOrder: tp.max_per_order,
        sortOrder: tp.sort_order ?? 0,
      })
    }
    out.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    return out
  }, [tenantProducts.rows, variants.rows, products.rows, brands.rows])

  return {
    items,
    loading: tenantProducts.loading || variants.loading || products.loading || brands.loading,
  }
}

/**
 * The catalog as a lookup — a register row carries a bare `variant_id` and the screen has to print
 * the name on the case.
 */
export function useCatalogIndex(): {
  byVariant: Map<string, CatalogItem>
  items: CatalogItem[]
  loading: boolean
} {
  const { items, loading } = useCatalog()
  const byVariant = useMemo(() => new Map(items.map((item) => [item.variantId, item])), [items])
  return { byVariant, items, loading }
}

// ---------------------------------------------------------------------------
// The pricing inputs (fed to `priceOrder()` in src/lib/pricing.ts)
// ---------------------------------------------------------------------------

export function usePriceLists(): { lists: LocalPriceList[]; items: LocalPriceListItem[] } {
  const lists = useTable<LocalPriceList>('price_lists', { where: 'active = 1' })
  const items = useTable<LocalPriceListItem>('price_list_items', {})
  return { lists: lists.rows, items: items.rows }
}

export function useSchemes(): LocalSchemeRow[] {
  return useTable<LocalSchemeRow>('schemes', { where: 'active = 1', orderBy: 'id ASC' }).rows
}

export function useOverrides(retailerId: string | null): LocalOverride[] {
  return useTable<LocalOverride>('retailer_price_overrides', {
    where: 'retailer_id = ?',
    params: [retailerId ?? ''],
    orderBy: 'id DESC',
  }).rows
}

export function useBargains(retailerId: string | null): LocalBargain[] {
  return useTable<LocalBargain>('bargain_requests', {
    where: 'retailer_id = ?',
    params: [retailerId ?? ''],
    orderBy: 'created_at DESC, id DESC',
  }).rows
}

export function useAllBargains(limit = 100): LocalBargain[] {
  return useTable<LocalBargain>('bargain_requests', {
    orderBy: 'created_at DESC, id DESC',
    limit,
  }).rows
}
