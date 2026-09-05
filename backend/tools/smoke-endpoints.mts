/**
 * Endpoint smoke harness — proves every operation of every running service actually answers.
 *
 *   pnpm smoke                     every service, every operation (mutations included)
 *   pnpm smoke --service owner     one service
 *   pnpm smoke --only GET          reads only, nothing is written
 *   pnpm smoke --destructive       also run cancel/delete/revoke/… (breaks shared demo state)
 *   pnpm smoke --verbose           print the request body of every call
 *
 * For each service it signs in against auth-service (:3000) as that service's primary demo role,
 * reads THAT service's own /docs/openapi.json (so it tests exactly what the service serves), and
 * calls every operation. Request bodies come from the operation's OpenAPI `example` when the
 * contract carries one; otherwise a local generator walks the JSON Schema and fills ids from the
 * seeded demo data read straight out of Postgres. Results are classified OK / EXPECTED / BROKEN,
 * printed as a table per service, and written in full to backend/.smoke/<service>.json.
 * Exit code is non-zero when anything is BROKEN, so this can become a CI gate.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { isAllowed, permissionFor, type MembershipRole } from '@dos/contracts'
import { loadDotenv } from '../libs/database/src/env.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, '.smoke')

// ---------------------------------------------------------------------------------------------------------------
// CLI

const argv = process.argv.slice(2)
function flagValue(name: string): string | undefined {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const ONLY_SERVICE = flagValue('--service')
const ONLY_METHOD = flagValue('--only')?.toUpperCase()
const VERBOSE = argv.includes('--verbose')
const DESTRUCTIVE = argv.includes('--destructive')
const REQUEST_TIMEOUT_MS = 20_000
/**
 * Everything the harness creates is seeded with this, so two runs that share it write the same rows
 * and the second one replays. It defaults to the business date: re-run as often as you like today
 * and the demo database does not grow. `--run-tag <anything>` forces a fresh set of rows.
 */
const RUN_TAG = flagValue('--run-tag') ?? istDate()
/**
 * The order lifecycle is once-through — a draft that has been submitted cannot be re-submitted — so
 * the order chain alone is scoped to this single run: one throwaway order per service walked from
 * draft to confirmed, instead of a permanent 409 on every run after the first.
 */
const RUN_NONCE = new Date().toISOString()
const RUN_SCOPED_OPS = new Set(['orders.create', 'orders.repeatLast'])

function out(line = ''): void {
  process.stdout.write(`${line}\n`)
}

// ---------------------------------------------------------------------------------------------------------------
// services + demo sign-ins

interface ServiceTarget {
  name: string
  port: number
  username: string
  role: MembershipRole
}

const SERVICES: readonly ServiceTarget[] = [
  { name: 'auth', port: 3000, username: 'sunil.tarsun', role: 'owner' },
  { name: 'owner', port: 3001, username: 'sunil.tarsun', role: 'owner' },
  { name: 'manager', port: 3002, username: 'vikas.kadam', role: 'manager' },
  { name: 'sales', port: 3003, username: 'rahul.deshmukh', role: 'salesperson' },
  { name: 'warehouse', port: 3004, username: 'dinesh.patil', role: 'warehouse' },
  { name: 'delivery', port: 3005, username: 'ganesh.more', role: 'delivery' },
  { name: 'retailer', port: 3006, username: 'ramesh.gupta', role: 'retailer' },
]

const DEMO_PASSWORD = 'Dos@1234'
const AUTH_URL = 'http://localhost:3000'
/** One stable device per role, so re-running the harness reuses the same session row. */
const deviceIdFor = (username: string) => stableUuid(`smoke-device:${username}`)

// ---------------------------------------------------------------------------------------------------------------
// what we refuse to press without --destructive

/** The founder's rule: nothing that destroys shared demo state runs unless it is asked for. */
const DESTRUCTIVE_PATTERN = /cancel|delete|revoke|writeOff|disable/i
/**
 * Not caught by the pattern but just as damaging: these change the credentials every other agent,
 * app and demo script signs in with, or drop the session this run is using.
 */
const DESTRUCTIVE_EXTRA: Record<string, string> = {
  'auth.changePassword': 'would change the demo password every other tool signs in with',
  'tenancy.staff.setPassword': 'would change a demo user password',
  'tenancy.staff.setStatus': 'would disable a demo user',
  'retailers.linkIdentity':
    'would invite a made-up phone into a demo shop and add a retailer_links row every run',
  // Both permanently undo real demo money. The receipts.reverse chain below is different: it only ever
  // reverses the throwaway receipt this run created, so it leaves the seeded ledger exactly as it was.
  'receivables.receipts.bounce':
    'would return a seeded cheque and book a real bank charge against the demo books',
  'receivables.allocations.remove':
    'would delete a seeded allocation and reopen the bill it settled',
}

function destructiveReason(operationId: string): string | undefined {
  if (DESTRUCTIVE_EXTRA[operationId]) return DESTRUCTIVE_EXTRA[operationId]
  if (DESTRUCTIVE_PATTERN.test(operationId)) return `matches /${DESTRUCTIVE_PATTERN.source}/`
  return undefined
}

// ---------------------------------------------------------------------------------------------------------------
// deterministic ids — so a second run replays instead of duplicating

/** A stable UUIDv7-shaped id derived from a seed string. Same seed, same row, every run. */
function stableUuid(seed: string): string {
  const h = createHash('sha256').update(seed).digest()
  const b = Buffer.from(h.subarray(0, 16))
  b[6] = (b[6]! & 0x0f) | 0x70 // version 7
  b[8] = (b[8]! & 0x3f) | 0x80 // RFC 4122 variant
  const hex = b.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * A fresh client id for a row THIS run creates, stable within the run so a replay addresses the same
 * row. Used where the published example's own id would be spent after the first Execute.
 */
function runScopedId(ctx: { service: string; operationId: string }): string {
  // RUN_NONCE, not RUN_TAG: the row this id creates (a wave, a pack, a load sheet, a repeat order) is
  // spent by the first run, and its target moves between runs (the next packable order), so the same
  // id under a new idempotency key on the second run of the day was a permanent 409.
  return stableUuid(`${RUN_NONCE}:${ctx.service}:${ctx.operationId}:client-id`)
}

/**
 * Stable per (service, procedure, request): pressing the same call twice replays the stored result
 * instead of writing a second row. The request is folded in because `idempotent()` refuses a key
 * that comes back with a different input — and the row a step targets legitimately moves between
 * runs (yesterday's draft order is today's confirmed one), which would otherwise be a permanent 409.
 * The placeholder below is what the generator writes; `sealIdempotency` replaces it once the rest
 * of the body is known.
 */
const IDEMPOTENCY_PLACEHOLDER = 'smoke:pending'
const idempotencyKeyFor = (service: string, operationId: string) =>
  `${IDEMPOTENCY_PLACEHOLDER}:${service}:${operationId}`

/** Rewrites the placeholder key into a digest of the request this call actually makes. */
function sealIdempotency(
  body: unknown,
  service: string,
  operationId: string,
  method: string,
  url: string,
): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body
  const record = body as Record<string, unknown>
  if (typeof record.idempotencyKey !== 'string') return body
  const { idempotencyKey: _drop, ...rest } = record
  const digest = createHash('sha256')
    .update(`${method} ${url} ${RUN_TAG} ${JSON.stringify(rest)}`)
    .digest('hex')
    .slice(0, 16)
  return { ...record, idempotencyKey: `smoke:${service}:${operationId}:${digest}` }
}

/** 1-7, one reserved phone/username slot per service in the +9191000000NN block. */
const servicePhoneSlot = (service: string) =>
  Math.max(1, SERVICES.findIndex((s) => s.name === service) + 1)

function istDate(offsetDays = 0): string {
  const ms = Date.now() + offsetDays * 86_400_000 + 5.5 * 3600 * 1000
  return new Date(ms).toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------------------------------------------
// demo fixtures, read straight from Postgres

type Row = Record<string, unknown>

class Fixtures {
  private constructor(
    private readonly pool: pg.Pool,
    readonly tenantId: string,
  ) {}

  static async open(tenantId: string): Promise<Fixtures> {
    loadDotenv(root)
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) throw new Error('DATABASE_URL is not set (repo-root .env)')
    const pool = new pg.Pool({ connectionString, max: 2 })
    return new Fixtures(pool, tenantId)
  }

  async close(): Promise<void> {
    await this.pool.end()
  }

  async rows(sql: string, params: unknown[] = []): Promise<Row[]> {
    const res = await this.pool.query(sql, params)
    return res.rows as Row[]
  }

  /** First column of the first row, or null. Cached: fixtures do not move inside one run. */
  private cache = new Map<string, string | null>()
  async scalar(key: string, sql: string, params: unknown[] = []): Promise<string | null> {
    if (this.cache.has(key)) return this.cache.get(key) ?? null
    const rows = await this.rows(sql, params)
    const first = rows[0] ? (Object.values(rows[0])[0] as string | null) : null
    this.cache.set(key, first)
    return first
  }

  /** Same as `scalar` but never cached: order/GRN states move as the harness runs. */
  async liveScalar(sql: string, params: unknown[] = []): Promise<string | null> {
    const rows = await this.rows(sql, params)
    return rows[0] ? ((Object.values(rows[0])[0] as string | null) ?? null) : null
  }

  private t = () => [this.tenantId]

  retailerId = () =>
    this.scalar(
      'retailer',
      `select id from retailers where tenant_id=$1 and active order by code limit 1`,
      this.t(),
    )
  retailerWithHistory = () =>
    this.scalar(
      'retailerHistory',
      `select retailer_id from sales_orders where tenant_id=$1 and state::text in ('closed','delivered')
       group by retailer_id order by count(*) desc limit 1`,
      this.t(),
    )
  variantId = () =>
    this.scalar(
      'variant',
      `select tp.variant_id from tenant_products tp where tp.tenant_id=$1 and tp.listed
       order by tp.sort_order nulls last, tp.created_at limit 1`,
      this.t(),
    )
  tenantProductId = () =>
    this.scalar(
      'tenantProduct',
      `select id from tenant_products where tenant_id=$1 and listed limit 1`,
      this.t(),
    )
  locationId = () =>
    this.scalar(
      'location',
      `select id from locations where tenant_id=$1 and active order by (kind='warehouse') desc, created_at limit 1`,
      this.t(),
    )
  locationIdAlt = () =>
    this.scalar(
      'locationAlt',
      `select id from locations where tenant_id=$1 and active order by (kind='warehouse') asc, created_at limit 1`,
      this.t(),
    )
  supplierId = () =>
    this.scalar(
      'supplier',
      `select id from suppliers where tenant_id=$1 and active limit 1`,
      this.t(),
    )
  priceListId = () =>
    this.scalar(
      'priceList',
      `select id from price_lists where tenant_id=$1 and active order by is_default desc limit 1`,
      this.t(),
    )
  schemeId = () =>
    this.scalar('scheme', `select id from schemes where tenant_id=$1 and active limit 1`, this.t())
  beatId = () =>
    this.scalar('beat', `select id from beats where tenant_id=$1 and active limit 1`, this.t())
  brandId = () =>
    this.scalar('brand', `select brand_id from products where brand_id is not null limit 1`)
  manufacturerId = () =>
    this.scalar('manufacturer', `select id from manufacturers order by name limit 1`)
  globalVariantId = () =>
    this.scalar(
      'globalVariant',
      `select id from product_variants where status::text='active' order by created_at limit 1`,
    )
  /**
   * The lot with the most stock in a real storage location. Both halves must come from the SAME row
   * — a lot id paired with a location that does not hold it fails every stock guard — and the order
   * has to be deterministic, or two calls in one run can disagree about which lot they mean. The
   * damaged bin is ranked last: goods sitting there are the ones you least want a demo to move.
   */
  private lotBalance = () =>
    this.rows(
      `select sb.lot_id, sb.location_id, (sb.on_hand - sb.reserved) as available
         from stock_balances sb join locations l on l.id = sb.location_id
        where sb.tenant_id=$1 and (sb.on_hand - sb.reserved) > 0
        order by (l.kind::text = 'damaged') asc, available desc, sb.lot_id
        limit 1`,
      this.t(),
    )
  lotId = async () => ((await this.lotBalance())[0]?.lot_id as string | undefined) ?? null
  lotLocationId = async () =>
    ((await this.lotBalance())[0]?.location_id as string | undefined) ?? null
  supplierInvoiceId = () =>
    this.scalar(
      'supplierInvoice',
      `select id from supplier_invoices where tenant_id=$1 order by created_at limit 1`,
      this.t(),
    )
  supplierInvoiceLineId = async () => {
    const invoice = await this.supplierInvoiceId()
    if (!invoice) return null
    return this.scalar(
      'supplierInvoiceLine',
      `select id from supplier_invoice_lines where tenant_id=$1 and supplier_invoice_id=$2 order by line_no limit 1`,
      [this.tenantId, invoice],
    )
  }
  grnId = () =>
    this.scalar(
      'grn',
      `select id from grns where tenant_id=$1 order by created_at desc limit 1`,
      this.t(),
    )
  staffUserId = (role: MembershipRole) =>
    this.scalar(
      `staff:${role}`,
      `select user_id from memberships where tenant_id=$1 and role::text=$2 and status::text='active' limit 1`,
      [this.tenantId, role],
    )
  gstin = () =>
    this.scalar(
      'gstin',
      `select gstin from retailers where tenant_id=$1 and gstin is not null limit 1`,
      this.t(),
    )
  purchaseOrderId = () =>
    this.scalar(
      'purchaseOrder',
      `select id from purchase_orders where tenant_id=$1 limit 1`,
      this.t(),
    )
  documentId = () =>
    this.scalar('document', `select id from documents where tenant_id=$1 limit 1`, this.t())
  vehicleLocationId = () =>
    this.scalar(
      'vehicleLocation',
      `select id from locations where tenant_id=$1 and active and kind::text='vehicle' order by created_at limit 1`,
      this.t(),
    )

  /** The shop a retailer-role user is linked to: everything that user may read is scoped to it. */
  linkedRetailerFor = (username: string) =>
    this.scalar(
      `linkedRetailer:${username}`,
      `select rl.retailer_id from retailer_links rl
         join users u on u.id = rl.user_id
        where rl.tenant_id=$1 and u.username=$2 limit 1`,
      [this.tenantId, username],
    )

  // live lookups — these move while the harness runs
  /**
   * `retailerId` non-null means the caller is a shopkeeper: it sees only its own shop, and only the
   * orders its own app placed, so the fixture is narrowed the same way the service narrows it.
   */
  orderInState = (state: string, retailerId?: string | null) =>
    this.liveScalar(
      `select id from sales_orders
        where tenant_id = $1 and state::text = $2
          and ($3::text is null or (retailer_id = $3::text and source::text = 'retailer_app'))
        order by created_at desc limit 1`,
      [this.tenantId, state, retailerId ?? null],
    )
  anyOrderId = (retailerId?: string | null) =>
    this.liveScalar(
      `select id from sales_orders
        where tenant_id = $1
          and ($2::text is null or (retailer_id = $2::text and source::text = 'retailer_app'))
        order by created_at desc limit 1`,
      [this.tenantId, retailerId ?? null],
    )
  /** Statuses are 'counting' | 'reconciled' | 'posted' | 'cancelled' — nothing is ever 'open'/'counted'. */
  grnInStatus = (statuses: string[]) =>
    this.liveScalar(
      `select id from grns where tenant_id=$1 and status::text = any($2) order by created_at limit 1`,
      [this.tenantId, statuses],
    )
  /** `matchLine` freezes the lines of a received/cancelled invoice, so pick one still open. */
  matchableInvoice = () =>
    this.liveScalar(
      `select si.id from supplier_invoices si
        where si.tenant_id=$1 and si.status::text not in ('received','cancelled')
          and exists (select 1 from supplier_invoice_lines l where l.supplier_invoice_id = si.id)
        order by si.created_at limit 1`,
      this.t(),
    )
  matchableInvoiceLine = (invoice: string) =>
    this.liveScalar(
      `select id from supplier_invoice_lines where tenant_id=$1 and supplier_invoice_id=$2
        order by line_no limit 1`,
      [this.tenantId, invoice],
    )
  /** `grns.open` needs an approved invoice that no live GRN has claimed. */
  invoiceReadyForGrn = () =>
    this.liveScalar(
      `select si.id from supplier_invoices si
        where si.tenant_id=$1 and si.status::text = 'approved'
          and not exists (select 1 from grns g
                           where g.supplier_invoice_id = si.id and g.status::text <> 'cancelled')
        order by si.created_at limit 1`,
      this.t(),
    )
  /** A location the lot is NOT in, that goods may legally move to (never the damaged bin). */
  transferTarget = (from: string) =>
    this.liveScalar(
      `select id from locations
        where tenant_id=$1 and active and kind::text in ('warehouse','vehicle') and id <> $2
        order by (kind::text='vehicle') desc, created_at limit 1`,
      [this.tenantId, from],
    )
  /**
   * A staff member `setStatus`/`setPassword` may legally be pointed at. Two rules bind at once:
   * nobody may change their OWN membership (and the demo tenant has two owners, so "not the primary
   * owner" is not the same as "not me"), and a MANAGER may only administer salesperson, warehouse or
   * delivery members. A junior member other than the caller satisfies both, for every back-office role.
   */
  staffOtherThan = (username: string) =>
    this.liveScalar(
      `select m.user_id from memberships m join users u on u.id = m.user_id
        where m.tenant_id=$1 and m.status='active'
          and m.role::text in ('salesperson','warehouse','delivery') and u.username <> $2
        order by m.created_at limit 1`,
      [this.tenantId, username],
    )
  bargainAskedRate = (id: string) =>
    this.liveScalar(`select asked_rate_paise from bargain_requests where tenant_id=$1 and id=$2`, [
      this.tenantId,
      id,
    ])
  grnLineOf = (grn: string) =>
    this.liveScalar(
      `select id from grn_lines where tenant_id=$1 and grn_id=$2 order by created_at limit 1`,
      [this.tenantId, grn],
    )
  bargainInStatus = (statuses: string[]) =>
    this.liveScalar(
      `select id from bargain_requests where tenant_id=$1 and status::text = any($2) order by created_at desc limit 1`,
      [this.tenantId, statuses],
    )
  /** Any receipt the caller may see; a shopkeeper sign-in is narrowed to its own shop. */
  receiptFor = (retailerId?: string | null) =>
    this.liveScalar(
      `select id from receipts
        where tenant_id = $1 and ($2::text is null or retailer_id = $2::text)
        order by received_at desc limit 1`,
      [this.tenantId, retailerId ?? null],
    )
  /**
   * A receipt with money still on account AND an open bill of the SAME shop, taken from one row so the
   * two always belong together — an allocation across shops is refused, and rightly so.
   */
  allocatablePair = async (): Promise<{ receiptId: string; invoiceId: string } | null> => {
    const rows = await this.rows(
      `select r.id as receipt_id, i.id as invoice_id
         from receipts r
         join invoices i on i.tenant_id = r.tenant_id and i.retailer_id = r.retailer_id
              and i.state::text in ('issued', 'partially_paid')
         left join lateral (
           select coalesce(sum(a.amount_paise), 0) as allocated
             from allocations a where a.tenant_id = r.tenant_id and a.receipt_id = r.id) ra on true
         left join lateral (
           select coalesce(sum(b.amount_paise), 0) as allocated
             from allocations b where b.tenant_id = i.tenant_id and b.invoice_id = i.id) ia on true
        where r.tenant_id = $1 and r.status::text = 'collected' and r.amount_paise > 0
          and (r.amount_paise + r.cash_discount_paise) - ra.allocated > 0
          and i.total_paise - ia.allocated > 0
        order by r.received_at desc limit 1`,
      this.t(),
    )
    const row = rows[0]
    return row ? { receiptId: row.receipt_id as string, invoiceId: row.invoice_id as string } : null
  }
  /**
   * BILLING. An invoice is the one document every role may read, so a shopkeeper sign-in is narrowed to
   * its own shop exactly the way the service narrows it — a 404 from this harness then means a real
   * fault, not "you asked for someone else's bill".
   */
  invoiceFor = (retailerId?: string | null) =>
    this.liveScalar(
      `select id from invoices
        where tenant_id = $1 and state::text <> 'draft'
          and ($2::text is null or retailer_id = $2::text)
        order by invoice_date desc, id desc limit 1`,
      [this.tenantId, retailerId ?? null],
    )
  creditNoteFor = (retailerId?: string | null) =>
    this.liveScalar(
      `select id from credit_notes
        where tenant_id = $1 and ($2::text is null or retailer_id = $2::text)
        order by note_date desc, id desc limit 1`,
      [this.tenantId, retailerId ?? null],
    )
  /** An order the billing desk could still bill: confirmed/picking/packed with no live invoice. */
  billableOrder = (source: string) =>
    this.liveScalar(
      `select o.id from sales_orders o
        where o.tenant_id = $1 and o.state::text in ('confirmed','picking','packed')
          and o.source::text = $2
          and not exists (select 1 from invoices i
                           where i.tenant_id = o.tenant_id and i.order_id = o.id
                             and i.state::text not in ('cancelled','draft'))
        order by o.created_at limit 1`,
      [this.tenantId, source],
    )
  invoiceLineOf = (invoiceId: string) =>
    this.liveScalar(
      `select id from invoice_lines where tenant_id=$1 and invoice_id=$2 order by line_no limit 1`,
      [this.tenantId, invoiceId],
    )
  /**
   * WAREHOUSE. The godown's five tables are all rows the seed writes, so every `{id}` route can be
   * pointed at a real one; the mutations are pointed at rows where the answer is honest — a wave that
   * is genuinely open to picking, an order that genuinely has no pack confirmation yet.
   */
  picklistId = () =>
    this.liveScalar(
      `select id from picklists where tenant_id=$1 order by pick_date desc, id desc limit 1`,
      this.t(),
    )
  picklistInStatus = (status: string) =>
    this.liveScalar(
      `select id from picklists where tenant_id=$1 and status::text=$2 order by id desc limit 1`,
      [this.tenantId, status],
    )
  pickLineOf = async (picklistId: string) => {
    const rows = await this.rows(
      `select id, order_line_id, lot_id, requested_qty_pcs from pick_lines
        where tenant_id=$1 and picklist_id=$2 and lot_id is not null
        order by line_no, id limit 1`,
      [this.tenantId, picklistId],
    )
    const row = rows[0]
    return row
      ? {
          id: row.id as string,
          orderLineId: row.order_line_id as string,
          lotId: row.lot_id as string,
          requestedQtyPcs: Number(row.requested_qty_pcs),
        }
      : null
  }
  packConfirmationId = () =>
    this.liveScalar(
      `select id from pack_confirmations where tenant_id=$1 order by packed_at desc, id desc limit 1`,
      this.t(),
    )
  loadSheetId = () =>
    this.liveScalar(
      `select id from load_sheets where tenant_id=$1 order by sheet_date desc, id desc limit 1`,
      this.t(),
    )
  draftLoadSheet = async () => {
    const rows = await this.rows(
      `select id, expected_packages from load_sheets
        where tenant_id=$1 and status::text='draft' order by sheet_date desc, id desc limit 1`,
      this.t(),
    )
    const row = rows[0]
    return row ? { id: row.id as string, expectedPackages: Number(row.expected_packages) } : null
  }
  challanId = () =>
    this.liveScalar(
      `select id from delivery_challans where tenant_id=$1 order by challan_date desc, id desc limit 1`,
      this.t(),
    )
  /** A confirmed order no live wave has claimed yet. */
  waveableOrder = () =>
    this.liveScalar(
      `select o.id from sales_orders o
        where o.tenant_id=$1 and o.state::text='confirmed'
          and exists (select 1 from sales_order_lines l where l.order_id = o.id)
          and not exists (select 1 from pick_lines pl join picklists p on p.id = pl.picklist_id
                           where pl.order_id = o.id and p.status::text in ('open','picking','picked'))
        order by o.created_at limit 1`,
      this.t(),
    )
  /** An order the godown could still tape shut: nothing has been packed for it yet. */
  packableOrder = () =>
    this.liveScalar(
      `select o.id from sales_orders o
        where o.tenant_id=$1 and o.state::text in ('confirmed','picking')
          and o.source::text = 'salesperson'
          and exists (select 1 from sales_order_lines l where l.order_id = o.id)
          and not exists (select 1 from pack_confirmations pc where pc.order_id = o.id)
          and not exists (select 1 from invoices i
                           where i.tenant_id = o.tenant_id and i.order_id = o.id
                             and i.state::text not in ('cancelled','draft'))
        order by o.created_at limit 1`,
      this.t(),
    )
  /** A packed order with its confirmation, not already on a live load sheet. */
  loadableOrder = () =>
    this.liveScalar(
      `select o.id from sales_orders o
        join pack_confirmations pc on pc.order_id = o.id
        where o.tenant_id=$1 and o.state::text='packed'
          and not exists (select 1 from load_sheets ls, jsonb_array_elements_text(ls.order_ids) x
                           where ls.tenant_id = o.tenant_id and ls.status::text <> 'cancelled'
                             and x.value = o.id)
        order by o.created_at limit 1`,
      this.t(),
    )
  approvalInStatus = (statuses: string[]) =>
    this.liveScalar(
      `select id from approvals where tenant_id=$1 and status::text = any($2) order by created_at desc limit 1`,
      [this.tenantId, statuses],
    )
}

// ---------------------------------------------------------------------------------------------------------------
// JSON Schema walk — build a request body from the contract's example, else from real demo ids

interface JsonSchema {
  type?: string
  format?: string
  pattern?: string
  enum?: unknown[]
  const?: unknown
  default?: unknown
  example?: unknown
  examples?: unknown[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  anyOf?: JsonSchema[]
  oneOf?: JsonSchema[]
  allOf?: JsonSchema[]
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  minItems?: number
  additionalProperties?: JsonSchema | boolean
  $ref?: string
}

interface GenContext {
  service: string
  operationId: string
  fx: Fixtures
  role: MembershipRole
  /**
   * The one shop a retailer-role sign-in may see. Null for staff. Every retailer-scoped fixture
   * uses it, so a 404 from this harness means a real fault, not "you asked for someone else's row".
   */
  scopeRetailerId: string | null
  /** The resolved request path, folded into generated ids so two orders never share a line id. */
  urlSeed: string
  /** Values the operation's override already decided, keyed by property name. */
  pinned: Record<string, unknown>
}

/** The value an OpenAPI node carries as an example, if any (several shapes are in the wild). */
function exampleOf(
  node:
    | {
        example?: unknown
        examples?: unknown
        schema?: JsonSchema
      }
    | undefined,
): unknown {
  if (!node) return undefined
  if (node.example !== undefined) return node.example
  if (Array.isArray(node.examples) && node.examples.length > 0) return node.examples[0]
  if (node.examples && typeof node.examples === 'object') {
    const first = Object.values(node.examples as Record<string, { value?: unknown }>)[0]
    if (first && typeof first === 'object' && 'value' in first) return first.value
  }
  return schemaExample(node.schema)
}

function schemaExample(schema: JsonSchema | undefined): unknown {
  if (!schema) return undefined
  if (schema.example !== undefined) return schema.example
  if (Array.isArray(schema.examples) && schema.examples.length > 0) return schema.examples[0]
  return undefined
}

/** Enum choices that are safe and meaningful against the demo data. */
const ENUM_PREFERENCE: Record<string, string[]> = {
  role: ['salesperson'],
  status: ['active'],
  source: ['phone', 'salesperson'],
  reason: ['adjustment'],
  kind: ['warehouse'],
  tier: ['B'],
  creditMode: ['indicate'],
  paymentTerms: ['ON'],
  gstRegType: ['unregistered'],
  enteredUnit: ['case', 'piece'],
  platform: ['web'],
  locale: ['en-IN'],
  decision: ['approve'],
  outcome: ['ordered', 'no_order'],
  rateBasis: ['piece'],
}

/** UUID-typed field names we can answer with a real row from the demo tenant. */
async function uuidFixture(name: string, ctx: GenContext): Promise<string | null> {
  const fx = ctx.fx
  switch (name) {
    case 'retailerId':
      return ctx.scopeRetailerId ?? (await fx.retailerId())
    case 'variantId':
    case 'freeVariantId':
    case 'productVariantId':
      return fx.variantId()
    case 'tenantProductId':
      return fx.tenantProductId()
    case 'locationId':
    case 'fulfilFromLocationId':
    case 'fromLocationId':
      return fx.locationId()
    case 'toLocationId':
      return fx.locationIdAlt()
    case 'supplierId':
      return fx.supplierId()
    case 'priceListId':
      return fx.priceListId()
    case 'schemeId':
      return fx.schemeId()
    case 'beatId':
      return fx.beatId()
    case 'brandId':
      return fx.brandId()
    case 'manufacturerId':
      return fx.manufacturerId()
    case 'lotId':
      return fx.lotId()
    case 'orderId':
      return fx.anyOrderId(ctx.scopeRetailerId)
    case 'supplierInvoiceId':
      return fx.supplierInvoiceId()
    case 'supplierInvoiceLineId':
      return fx.supplierInvoiceLineId()
    case 'grnId':
      return fx.grnId()
    case 'purchaseOrderId':
      return fx.purchaseOrderId()
    case 'documentId':
      return fx.documentId()
    case 'invoiceId':
      return fx.invoiceFor(ctx.scopeRetailerId)
    case 'vehicleLocationId':
      return fx.vehicleLocationId()
    case 'restockLocationId':
      return fx.locationId()
    case 'tenantId':
      return fx.tenantId
    case 'userId':
    case 'salespersonId':
    case 'assigneeId':
    case 'requestedBy':
    case 'approvedBy':
    case 'decidedBy':
      return fx.staffUserId('salesperson')
    default:
      return null
  }
}

/** Plain (non-uuid) strings whose name tells us what they should look like. */
function stringHint(name: string, schema: JsonSchema, ctx: GenContext): string | undefined {
  const lower = name.toLowerCase()
  if (name === 'idempotencyKey') return idempotencyKeyFor(ctx.service, ctx.operationId)
  if (name === 'deviceId') return deviceIdFor(ctx.service)
  if (schema.pattern === '^\\d{4}-\\d{2}-\\d{2}$') return istDate()
  if (schema.format === 'date') return istDate()
  // Pinned to 09:00 IST today rather than "now": two runs in the same day produce the same body,
  // so the idempotency digest matches and the second run replays instead of writing again.
  if (schema.format === 'date-time') return `${istDate()}T03:30:00.000Z`
  // One reserved number per service — a phone is unique platform-wide, so a shared one would make
  // six services fight over the same staff record.
  if (lower.includes('phone')) return `+91910000000${String(servicePhoneSlot(ctx.service))}`
  if (lower === 'invoiceno' || lower === 'externalinvoiceno')
    return `SMOKE-${ctx.service.toUpperCase()}-1`
  if (lower.includes('gstin')) return '27AAAPZ1234C1ZV'
  if (lower === 'statecode' || lower.endsWith('statecode')) return '27'
  if (lower === 'pincode') return '421301'
  if (lower === 'hsncode' || lower === 'hsn') return '19059040'
  if (lower === 'username') return `smoke.${ctx.service}`
  if (lower === 'code' || lower === 'suppliercode') return `SMOKE-${ctx.service.toUpperCase()}`
  if (lower.includes('password')) return DEMO_PASSWORD
  if (lower === 'lineid' || lower === 'opid' || lower === 'clientid') return 'L1'
  // Names are unique per tenant for beats, price lists and the like, so scope them exactly the way
  // the generated id is scoped: name and id move together, and six services creating "Smoke Probe"
  // never collide with each other — which would look like a defect and is not one.
  if (lower === 'name' || lower.endsWith('name')) return `Smoke ${ctx.service} ${RUN_TAG}`
  if (lower === 'note' || lower === 'description' || lower === 'reason')
    return 'created by pnpm smoke'
  if (lower === 'batchno') return 'SMOKE-B1'
  if (lower === 'table') return 'sales_orders'
  return undefined
}

/** Keeps a hint inside the schema's own length bounds instead of tripping a validation error. */
function clampString(value: string, schema: JsonSchema): string {
  let text = schema.maxLength !== undefined ? value.slice(0, schema.maxLength) : value
  if (schema.minLength !== undefined && text.length < schema.minLength) {
    text = text.padEnd(schema.minLength, 'x')
  }
  return text
}

function numberHint(name: string, schema: JsonSchema): number {
  const lower = name.toLowerCase()
  const min = schema.minimum ?? 0
  const max = schema.maximum ?? Number.MAX_SAFE_INTEGER
  const clamp = (v: number) => Math.min(Math.max(v, min), max)
  if (lower.endsWith('bps')) return clamp(0)
  if (lower.endsWith('paise')) return clamp(10_000)
  if (lower.includes('qty') || lower.includes('pcs') || lower.includes('count')) return clamp(1)
  if (lower === 'limit') return clamp(5)
  if (lower === 'priority' || lower === 'version' || lower === 'protocol') return clamp(1)
  if (lower === 'lat') return 19.24
  if (lower === 'lng') return 73.13
  if (lower === 'sequence' || lower === 'lineno') return clamp(1)
  return clamp(1)
}

const isNullSchema = (s: JsonSchema) => s.type === 'null'

async function generate(
  schema: JsonSchema | undefined,
  name: string,
  pointer: string,
  ctx: GenContext,
): Promise<unknown> {
  if (!schema) return undefined
  if (schema.const !== undefined) return schema.const
  const ex = schemaExample(schema)
  if (ex !== undefined) return ex

  // `allOf` is usually extra CONSTRAINTS on the same value (Zod emits a second `pattern` that way),
  // not a composition of objects. Only merge when the node has no type of its own to generate from.
  if (schema.allOf?.length && schema.type === undefined && !schema.enum) {
    const merged: Record<string, unknown> = {}
    for (const part of schema.allOf) {
      const value = await generate(part, name, pointer, ctx)
      if (value && typeof value === 'object') Object.assign(merged, value)
    }
    return merged
  }

  const union = schema.anyOf ?? schema.oneOf
  if (union?.length) {
    const nullable = union.some(isNullSchema)
    const concrete = union.filter((s) => !isNullSchema(s))
    // A nullable field only gets a value when the field name tells us a real one; otherwise null,
    // which keeps generated payloads minimal and therefore likely to be accepted.
    if (nullable) {
      for (const branch of concrete) {
        const hinted = await generate(branch, name, pointer, ctx)
        const strong =
          branch.format === 'uuid' ? ((await uuidFixture(name, ctx)) ?? null) : (hinted ?? null)
        if (strong !== null && strong !== undefined) return strong
      }
      return null
    }
    return generate(concrete[0], name, pointer, ctx)
  }

  if (schema.enum?.length) {
    for (const preferred of ENUM_PREFERENCE[name] ?? []) {
      if (schema.enum.includes(preferred)) return preferred
    }
    return schema.enum[0]
  }

  switch (schema.type) {
    case 'object': {
      const required = new Set(schema.required ?? [])
      const obj: Record<string, unknown> = {}
      for (const [key, propSchema] of Object.entries(schema.properties ?? {})) {
        if (key in ctx.pinned) {
          obj[key] = ctx.pinned[key]
          continue
        }
        // Only required properties are generated: a minimal body is the one most likely to be
        // accepted, and an optional field we invent is an invitation to a spurious BROKEN.
        if (!required.has(key)) continue
        const value = await generate(propSchema, key, `${pointer}/${key}`, ctx)
        if (value !== undefined) obj[key] = value
      }
      return obj
    }
    case 'array': {
      const count = Math.max(schema.minItems ?? 0, 0)
      if (count === 0) return []
      const items: unknown[] = []
      for (let i = 0; i < count; i++) {
        items.push(await generate(schema.items, singular(name), `${pointer}/${i}`, ctx))
      }
      return items
    }
    case 'boolean':
      return schema.default ?? true
    case 'integer':
    case 'number':
      return schema.default ?? numberHint(name, schema)
    case 'null':
      return null
    case 'string':
    default: {
      if (schema.format === 'uuid' || (schema.type === undefined && schema.format === 'uuid')) {
        const real = await uuidFixture(name, ctx)
        if (real) return real
        // A client-generated UUIDv7. Seeded by the run tag so a rerun addresses the same row, and by
        // the request path so the same field on two different targets never collides (a line id is
        // unique across orders, not just within one).
        const scope = RUN_SCOPED_OPS.has(ctx.operationId) ? RUN_NONCE : RUN_TAG
        return stableUuid(`${ctx.service}:${ctx.operationId}:${ctx.urlSeed}:${pointer}:${scope}`)
      }
      const hint = stringHint(name, schema, ctx)
      if (hint !== undefined) return clampString(hint, schema)
      if (schema.default !== undefined) return schema.default
      return 'smoke'
    }
  }
}

const singular = (name: string) => (name.endsWith('s') ? name.slice(0, -1) : name)

// ---------------------------------------------------------------------------------------------------------------
// per-operation overrides — the handful the generic walker cannot know about

interface Operation {
  operationId: string
  method: string
  path: string
  summary: string
  parameters: {
    name: string
    in: string
    required?: boolean
    schema?: JsonSchema
    example?: unknown
    examples?: unknown
  }[]
  requestSchema: JsonSchema | undefined
  requestNode: { example?: unknown; examples?: unknown; schema?: JsonSchema } | undefined
}

interface Plan {
  skip?: string
  /** Values pinned into the generated body by property name. */
  pinned?: Record<string, unknown>
  /** Path parameter values by parameter name; null means "no demo row qualifies". */
  pathParams?: Record<string, string | null>
  /** Replaces the generated body outright. */
  body?: unknown
  /** Extra query parameters. */
  query?: Record<string, string>
}

/** Mutable state that chained procedures pass to each other within one service run. */
interface RunChain {
  refreshToken: string | null
  sessionId: string | null
  tenantId: string
  /** The throwaway order this run created, walked draft → submitted → confirmed. */
  orderId: string | null
  /** The throwaway receipt this run created, walked collected → deposited → reversed. */
  receiptId: string | null
}

/** Runs later than its position in the document, because it invalidates what earlier ones need. */
const ORDER_HINT: Record<string, number> = {
  'auth.login': 1,
  'auth.refresh': 2,
  'auth.switchTenant': 3,
  'auth.me': 4,
  'auth.sessions': 5,
  'auth.revokeSession': 90,
  'auth.logout': 95,
  'auth.changePassword': 96,
  // Bank the throwaway receipt this run created, then reverse it, so the pair nets to nothing in the
  // books: DR Cash / CR AR, DR Bank / CR Cash, then the mirror entry that undoes both.
  'receivables.receipts.deposit': 60,
  'receivables.receipts.reverse': 70,
}

async function planFor(
  op: Operation,
  ctx: GenContext,
  chain: RunChain,
  target: ServiceTarget,
): Promise<Plan> {
  const fx = ctx.fx
  switch (op.operationId) {
    // --- auth: a throwaway session so the run never revokes the token it is using ---------------
    case 'auth.login':
      return {
        body: {
          username: target.username,
          password: DEMO_PASSWORD,
          deviceId: stableUuid(`smoke-throwaway:${target.username}`),
          deviceName: 'pnpm smoke',
          platform: 'web',
        },
      }
    case 'auth.refresh':
      return chain.refreshToken
        ? {
            body: {
              refreshToken: chain.refreshToken,
              deviceId: stableUuid(`smoke-throwaway:${target.username}`),
            },
          }
        : { skip: 'no refresh token: auth.login did not succeed earlier in this run' }
    case 'auth.switchTenant':
      return chain.refreshToken
        ? {
            body: {
              refreshToken: chain.refreshToken,
              deviceId: stableUuid(`smoke-throwaway:${target.username}`),
              tenantId: chain.tenantId,
            },
          }
        : { skip: 'no refresh token: auth.login did not succeed earlier in this run' }
    case 'auth.logout':
      return chain.refreshToken
        ? { body: { refreshToken: chain.refreshToken } }
        : { skip: 'no refresh token: auth.login did not succeed earlier in this run' }
    case 'auth.revokeSession':
      return chain.sessionId
        ? { body: { sessionId: chain.sessionId } }
        : { skip: 'no throwaway session id to revoke' }

    // --- orders: each step needs a row in the right state ---------------------------------------
    case 'orders.create':
      // A shopkeeper's own order must say it came from the retailer app (docs/17); staff may not.
      //
      // The `id` is pinned to this run's own slot for the same reason the warehouse creates below are:
      // the published example walks `examples.ts`'s free-slot table, and on this database that table
      // keeps offering an id the demo tenant already holds — so every run after the first is a 409 the
      // harness reports as BROKEN. Reported to the main session; the harness must not depend on it.
      return {
        pinned: {
          id: runScopedId(ctx),
          ...(ctx.role === 'retailer' ? { source: 'retailer_app' } : {}),
        },
      }
    case 'orders.setLines':
      // Lines are only editable while the order is a draft, so walk the one this run just created.
      return {
        pathParams: { id: chain.orderId ?? (await fx.orderInState('draft', ctx.scopeRetailerId)) },
      }
    case 'orders.submit':
      return {
        pathParams: { id: chain.orderId ?? (await fx.orderInState('draft', ctx.scopeRetailerId)) },
      }
    case 'orders.confirm':
      return {
        pathParams: {
          id: chain.orderId ?? (await fx.orderInState('submitted', ctx.scopeRetailerId)),
        },
      }
    case 'orders.cancel':
      return {
        pathParams: { id: chain.orderId ?? (await fx.orderInState('draft', ctx.scopeRetailerId)) },
      }
    case 'orders.get':
      return { pathParams: { id: chain.orderId ?? (await fx.anyOrderId(ctx.scopeRetailerId)) } }
    case 'orders.repeatLast':
      return {
        pinned: {
          id: runScopedId(ctx),
          retailerId:
            ctx.scopeRetailerId ?? (await fx.retailerWithHistory()) ?? (await fx.retailerId()),
          ...(ctx.role === 'retailer' ? { source: 'retailer_app' } : {}),
        },
      }

    // --- pricing: `scope` is an all-optional object with a cross-field rule ----------------------
    case 'pricing.schemes.upsert':
      return { pinned: { scope: { all: true } } }

    // --- approvals / bargains: only a pending row can be decided --------------------------------
    case 'orders.approvals.decide':
      return { pathParams: { id: await fx.approvalInStatus(['pending']) } }
    case 'pricing.bargains.decide': {
      // The ceiling is the list rate of the bargain's OWN variant, so approve what it actually asked
      // for; the document's rate belongs to whichever bargain the document named, not to this one.
      const id = await fx.bargainInStatus(['requested', 'pending'])
      if (!id) return { skip: 'no bargain is awaiting a decision' }
      const asked = await fx.bargainAskedRate(id)
      return {
        pathParams: { id },
        pinned: asked === null ? {} : { approvedRatePaise: Number(asked) },
      }
    }

    // --- procurement ----------------------------------------------------------------------------
    // Each step of the inbound chain is legal in exactly one GRN state, and the enum is
    // counting → reconciled → posted (never 'open'/'counted'): `count` takes counting|reconciled,
    // `post` takes reconciled and replies 200 for an already posted one.
    case 'procurement.grns.count': {
      const id = await fx.grnInStatus(['counting', 'reconciled'])
      if (!id) return { skip: 'no GRN is counting or reconciled — nothing legitimately qualifies' }
      const line = await fx.grnLineOf(id)
      return {
        pathParams: { id },
        pinned: line ? { lines: [{ grnLineId: line, countedQtyPcs: 1 }] } : {},
      }
    }
    case 'procurement.grns.post': {
      const id = (await fx.grnInStatus(['reconciled'])) ?? (await fx.grnInStatus(['posted']))
      if (!id) return { skip: 'no GRN is reconciled or posted — nothing legitimately qualifies' }
      return { pathParams: { id } }
    }
    case 'procurement.supplierInvoices.matchLine': {
      const id = await fx.matchableInvoice()
      if (!id) {
        return { skip: 'every supplier invoice is received or cancelled — its lines are frozen' }
      }
      return { pathParams: { id, lineId: await fx.matchableInvoiceLine(id) } }
    }
    case 'procurement.grns.get':
      return { pathParams: { id: await fx.grnId() } }
    case 'procurement.grns.open': {
      const supplierInvoiceId = await fx.invoiceReadyForGrn()
      if (!supplierInvoiceId) {
        return { skip: 'no approved supplier invoice is still without a GRN' }
      }
      // The GRN id is derived from the invoice it receives, so the two always move together: the
      // document's own id belongs to the invoice the document named, and pinning a different invoice
      // under that id is exactly the collision that used to come back as a duplicate-key 500.
      return {
        pinned: {
          id: stableUuid(`smoke-grn:${supplierInvoiceId}`),
          supplierInvoiceId,
          locationId: await fx.locationId(),
        },
      }
    }
    case 'procurement.supplierInvoices.get':
      return { pathParams: { id: await fx.supplierInvoiceId() } }

    // --- inventory: the lot has to actually sit in that location --------------------------------
    case 'inventory.stock.adjust':
      return {
        pinned: { lotId: await fx.lotId(), locationId: await fx.lotLocationId(), qtyDelta: 1 },
      }
    case 'inventory.stock.transfer': {
      // `locationIdAlt` was "the oldest non-warehouse", which on this demo tenant is the damaged bin
      // — where the lot with the most stock already sits, so the call refused itself as from === to.
      const fromLocationId = await fx.lotLocationId()
      if (!fromLocationId) return { skip: 'no lot has stock to transfer' }
      const toLocationId = await fx.transferTarget(fromLocationId)
      if (!toLocationId) return { skip: 'the tenant has only one storage location to move between' }
      return {
        pinned: { lotId: await fx.lotId(), fromLocationId, toLocationId, qtyPcs: 1 },
      }
    }

    // --- retailers / pricing --------------------------------------------------------------------
    case 'retailers.get':
    case 'retailers.setCredit':
    case 'retailers.linkIdentity':
      return { pathParams: { id: ctx.scopeRetailerId ?? (await fx.retailerId()) } }
    case 'retailers.beats.assign':
      return { pathParams: { id: await fx.beatId() } }
    case 'pricing.priceLists.setItems':
      return { pathParams: { priceListId: await fx.priceListId() } }
    case 'catalog.propose':
      return { pinned: { manufacturerId: await fx.manufacturerId() } }

    // --- receivables: the money chain walks the receipt this run created, never a seeded one -------
    // A role that may NOT call one of these must still be pressed, or the 403 the permission matrix
    // promises goes untested; only a role that WOULD be allowed is skipped for want of a fixture.
    case 'receivables.receipts.get':
      return {
        pathParams: { id: chain.receiptId ?? (await fx.receiptFor(ctx.scopeRetailerId)) },
      }
    case 'receivables.receipts.deposit':
      // Only cash and cheques are banked, and only while they are still `collected`.
      if (chain.receiptId) return { pinned: { receiptIds: [chain.receiptId] } }
      return isAllowed(permissionFor(op.operationId), ctx.role)
        ? { skip: 'no throwaway receipt to bank: receivables.receipts.create did not run' }
        : {}
    case 'receivables.receipts.reverse':
      if (chain.receiptId) {
        return { pathParams: { id: chain.receiptId }, pinned: { id: chain.receiptId } }
      }
      return isAllowed(permissionFor(op.operationId), ctx.role)
        ? { skip: 'no throwaway receipt to reverse: receivables.receipts.create did not run' }
        : {}
    case 'receivables.allocations.create': {
      const pair = await fx.allocatablePair()
      if (!pair) {
        return isAllowed(permissionFor(op.operationId), ctx.role)
          ? { skip: 'no receipt has money on account against an open bill' }
          : {}
      }
      return {
        pinned: {
          sourceType: 'receipt',
          sourceId: pair.receiptId,
          'lines[0].invoiceId': pair.invoiceId,
          // One paisa: enough to prove the endpoint, small enough to leave the demo numbers readable.
          'lines[0].amountPaise': 1,
        },
      }
    }
    case 'receivables.outstanding.get':
    case 'receivables.ledger.get':
      return { pathParams: { retailerId: ctx.scopeRetailerId ?? (await fx.retailerId()) } }

    // --- billing: an invoice and a credit note are ROWS, and the route needs a real one -----------
    // Without these the generated `{id}` is a made-up uuid, every read is a 404, and the harness
    // reports a working endpoint as broken. `examples.ts`'s `pathIdFor()` has no `/invoices/` case
    // either, so the fixture has to come from here.
    case 'billing.invoices.get':
    case 'billing.invoices.upiQr':
    case 'billing.invoices.pdf':
    case 'billing.invoices.setEwayBill':
    case 'billing.invoices.requestIrn':
    case 'billing.invoices.cancel': {
      const id = await fx.invoiceFor(ctx.scopeRetailerId)
      return id ? { pathParams: { id } } : { skip: 'no invoice in the demo data' }
    }
    case 'billing.creditNotes.get':
    case 'billing.creditNotes.issue':
    case 'billing.creditNotes.cancel': {
      const id = await fx.creditNoteFor(ctx.scopeRetailerId)
      return id ? { pathParams: { id } } : { skip: 'no credit note in the demo data' }
    }
    case 'billing.creditNotes.create': {
      // A note is capped by what the bill still has left to credit, so both halves come from ONE bill.
      const invoiceId = await fx.invoiceFor(ctx.scopeRetailerId)
      if (!invoiceId) return { skip: 'no invoice to credit' }
      const lineId = await fx.invoiceLineOf(invoiceId)
      if (!lineId) return { skip: 'the demo invoice has no lines' }
      return {
        pinned: {
          invoiceId,
          reason: 'short_delivery',
          'lines[0].invoiceLineId': lineId,
          'lines[0].qtyPcs': 1,
        },
      }
    }
    // `billing.invoices.issue` is GONE (coordination §4 step 3). The pack invoice is issued by
    // `warehouse.packs.confirm` below, which is where the fixture for it now lives.
    case 'billing.invoices.issueVanSale': {
      const orderId = await fx.billableOrder('van_sale')
      const vehicleLocationId = await fx.vehicleLocationId()
      return orderId && vehicleLocationId
        ? { pinned: { orderId, vehicleLocationId } }
        : isAllowed(permissionFor(op.operationId), ctx.role)
          ? { skip: 'no unbilled van-sale order, or no vehicle location' }
          : {}
    }
    case 'billing.registers.gstSummary':
    case 'billing.registers.salesRegister':
      // A one-day window returns almost nothing; the demo data covers the last fortnight.
      return { query: { from: istDate(-14), to: istDate() } }

    // --- warehouse: the godown's paperwork, pointed at rows where the answer is honest -----------
    // Every create below pins its OWN client id. The published example carries one derived from the
    // procedure, and `examples.ts` walks a free slot only for the procedures listed in its
    // `freeSlots` map — the warehouse creates are not in it yet, so the example's id is spent the
    // first time anything presses Execute and is a permanent 409 afterwards. Reported to the main
    // session; here the run tag gives a fresh id per run and the same one on a replay.
    case 'warehouse.picklists.get':
    case 'warehouse.picklists.cancel': {
      const id = await fx.picklistId()
      return id ? { pathParams: { id }, pinned: { id } } : { skip: 'no picklist in the demo data' }
    }
    case 'warehouse.picklists.start': {
      const id = (await fx.picklistInStatus('open')) ?? (await fx.picklistId())
      if (!id) return { skip: 'no picklist in the demo data' }
      // The published example invents an `assignedTo`; a wave is handed to someone who works here.
      const assignedTo = (await fx.staffUserId('warehouse')) ?? (await fx.staffUserId('manager'))
      return { pathParams: { id }, pinned: assignedTo ? { id, assignedTo } : { id } }
    }
    case 'warehouse.picklists.pick': {
      const id = await fx.picklistInStatus('picking')
      if (!id) return { skip: 'no wave is being picked right now' }
      const line = await fx.pickLineOf(id)
      if (!line) return { skip: 'the live wave has no pick lines' }
      return {
        pathParams: { id },
        pinned: {
          id,
          lines: [
            {
              id: line.id,
              orderLineId: line.orderLineId,
              lotId: line.lotId,
              pickedQtyPcs: line.requestedQtyPcs,
            },
          ],
        },
      }
    }
    case 'warehouse.picklists.create': {
      const orderId = await fx.waveableOrder()
      return orderId
        ? { pinned: { id: runScopedId(ctx), orderIds: [orderId] } }
        : { skip: 'every confirmed order in the demo data is already on a wave' }
    }
    case 'warehouse.packs.confirm': {
      // This is the ONLY way a pack invoice is issued now, so the harness exercises the real thing:
      // it packs one order that has never been packed, exactly as the godown would.
      const orderId = await fx.packableOrder()
      return orderId
        ? { pathParams: { orderId }, pinned: { id: runScopedId(ctx), packages: 1 } }
        : { skip: 'every order in the demo data has already been packed' }
    }
    case 'warehouse.packs.get': {
      const id = await fx.packConfirmationId()
      return id ? { pathParams: { id } } : { skip: 'no pack confirmation in the demo data' }
    }
    case 'warehouse.loadSheets.create': {
      const toLocationId = await fx.vehicleLocationId()
      if (!toLocationId) return { skip: 'no vehicle location in the demo data' }
      const orderId = await fx.loadableOrder()
      return orderId
        ? { pinned: { id: runScopedId(ctx), toLocationId, orderIds: [orderId] } }
        : { skip: 'every packed order in the demo data is already on a load sheet' }
    }
    case 'warehouse.loadSheets.get':
    case 'warehouse.loadSheets.cancel': {
      const id = await fx.loadSheetId()
      return id
        ? { pathParams: { id }, pinned: { id } }
        : { skip: 'no load sheet in the demo data' }
    }
    case 'warehouse.loadSheets.confirm': {
      const sheet = await fx.draftLoadSheet()
      return sheet
        ? {
            pathParams: { id: sheet.id },
            pinned: {
              id: sheet.id,
              challanId: runScopedId(ctx),
              countedPackages: sheet.expectedPackages,
            },
          }
        : { skip: 'no draft load sheet is waiting at the gate' }
    }
    case 'warehouse.challans.get':
    case 'warehouse.challans.recordEwb': {
      const id = await fx.challanId()
      return id ? { pathParams: { id }, pinned: { id } } : { skip: 'no challan in the demo data' }
    }
    case 'warehouse.reservations.release': {
      // Freeing a live hold would change shared demo state, so this is pointed at an order past
      // picking, where the refusal IS the correct answer and the endpoint is still proven.
      const orderId = await fx.orderInState('packed')
      return orderId ? { pinned: { orderId } } : {}
    }

    // --- staff: never point a status/password change at the account this run is signed in as -----
    case 'tenancy.staff.setStatus':
    case 'tenancy.staff.setPassword': {
      const userId = await fx.staffOtherThan(target.username)
      if (!userId) return { skip: 'no staff member other than the signed-in user' }
      return { pinned: { userId } }
    }
    default:
      return {}
  }
}

// ---------------------------------------------------------------------------------------------------------------
// running one operation

type Classification = 'OK' | 'EXPECTED' | 'BROKEN' | 'SKIPPED'

interface Result {
  service: string
  operationId: string
  method: string
  path: string
  url: string
  summary: string
  status: number | null
  ms: number
  classification: Classification
  message: string
  reason: string
  requestBody?: unknown
  responseSample?: unknown
  exampleSource: 'contract' | 'generated' | 'override' | 'none'
}

interface ErrorBody {
  code?: string
  status?: number
  message?: string
  error?: string
  statusCode?: number
  data?: { issues?: { path?: unknown[]; message?: string }[] }
}

function messageOf(body: unknown): string {
  if (typeof body === 'string') return body.slice(0, 200)
  const b = body as ErrorBody | null
  if (!b || typeof b !== 'object') return ''
  const issues = b.data?.issues
  if (issues?.length) {
    return issues
      .map((i) => `${(i.path ?? []).join('.') || '(root)'}: ${i.message ?? ''}`)
      .join('; ')
      .slice(0, 300)
  }
  return (b.message ?? b.error ?? '').slice(0, 300)
}

/** Did the server refuse because OUR body was wrong (our fault) or because of a business rule? */
function isInputValidation(body: unknown): boolean {
  const b = body as ErrorBody | null
  return Boolean(
    b && typeof b === 'object' && Array.isArray(b.data?.issues) && b.data.issues.length > 0,
  )
}

function classify(
  op: Operation,
  status: number,
  body: unknown,
  role: MembershipRole,
  usedRealIds: boolean,
  exampleSource: Result['exampleSource'],
): { classification: Classification; reason: string } {
  if (status >= 200 && status < 300) return { classification: 'OK', reason: '' }

  // The founder's rule for the docs: pressing Try it out twice must still work. A published example
  // that hard-codes the id of the row it creates succeeds exactly once and then refuses for ever,
  // so that refusal is a defect of the example, not a business rule doing its job.
  if (
    exampleSource === 'contract' &&
    /already exists|already recorded|already taken/i.test(messageOf(body))
  ) {
    return {
      classification: 'BROKEN',
      reason:
        'the example creates a hard-coded id this database already holds under another key — reseed, or give the example a fresh id',
    }
  }

  const permission = permissionFor(op.operationId)
  const allowed = isAllowed(permission, role)

  if (status === 403) {
    return allowed
      ? { classification: 'BROKEN', reason: `403 although PERMISSIONS allows the ${role} role` }
      : { classification: 'EXPECTED', reason: `role ${role} may not call this procedure` }
  }
  if (status === 401) {
    return {
      classification: 'BROKEN',
      reason: '401 although the request carried a fresh access token',
    }
  }
  if (status === 404) {
    return usedRealIds
      ? { classification: 'BROKEN', reason: '404 on an id read from the demo database' }
      : { classification: 'EXPECTED', reason: 'no demo row qualifies for this call' }
  }
  if (status === 400 || status === 422) {
    return isInputValidation(body)
      ? {
          classification: 'BROKEN',
          reason: 'the request body the docs offer fails the input schema',
        }
      : { classification: 'EXPECTED', reason: 'business refusal with a clear message' }
  }
  if (status === 409 || status === 423) {
    return { classification: 'EXPECTED', reason: 'business refusal on a row that does not qualify' }
  }
  if (status >= 500) return { classification: 'BROKEN', reason: `server error ${status}` }
  return { classification: 'BROKEN', reason: `unexpected status ${status}` }
}

async function callJson(
  url: string,
  init: RequestInit,
): Promise<{ status: number | null; body: unknown; ms: number; transport?: string }> {
  const started = Date.now()
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    const text = await res.text()
    let body: unknown = text
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      /* keep the raw text */
    }
    return { status: res.status, body, ms: Date.now() - started }
  } catch (err) {
    return {
      status: null,
      body: null,
      ms: Date.now() - started,
      transport: err instanceof Error ? err.message : String(err),
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// the run

interface LoginResult {
  accessToken: string
  refreshToken: string
  tenantId: string
  role: MembershipRole
}

async function login(username: string): Promise<LoginResult> {
  const res = await callJson(`${AUTH_URL}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username,
      password: DEMO_PASSWORD,
      deviceId: deviceIdFor(username),
      deviceName: 'pnpm smoke',
      platform: 'web',
    }),
  })
  if (res.status !== 200) {
    throw new Error(
      `sign-in failed for ${username}: HTTP ${String(res.status)} ${messageOf(res.body)}`,
    )
  }
  const body = res.body as {
    accessToken: string
    refreshToken: string
    tenant: { id: string }
    role: MembershipRole
  }
  return {
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    tenantId: body.tenant.id,
    role: body.role,
  }
}

function readOperations(doc: {
  paths: Record<string, Record<string, Record<string, unknown>>>
}): Operation[] {
  const ops: Operation[] = []
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const [method, raw] of Object.entries(item)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue
      const op = raw as unknown as {
        operationId?: string
        summary?: string
        parameters?: Operation['parameters']
        requestBody?: {
          content?: Record<string, { schema?: JsonSchema; example?: unknown; examples?: unknown }>
        }
      }
      const node = op.requestBody?.content?.['application/json']
      ops.push({
        operationId: op.operationId ?? `${method}:${path}`,
        method: method.toUpperCase(),
        path,
        summary: op.summary ?? '',
        parameters: op.parameters ?? [],
        requestSchema: node?.schema,
        requestNode: node,
      })
    }
  }
  return ops.sort((a, b) => (ORDER_HINT[a.operationId] ?? 50) - (ORDER_HINT[b.operationId] ?? 50))
}

async function runService(target: ServiceTarget, fx: Fixtures): Promise<Result[]> {
  const base = `http://localhost:${String(target.port)}`
  const session = await login(target.username)
  const authHeaders = {
    authorization: `Bearer ${session.accessToken}`,
    'content-type': 'application/json',
  }

  // `?fresh=1`, not the cached document. A service caches its OpenAPI document for the life of the
  // process, and the examples that CREATE a row carry an id taken from the free slots of the moment
  // the document was built. Once something spends those slots — a reader pressing Execute in Swagger,
  // an earlier run of this harness — the cached example is a permanent 409, and the harness would be
  // reporting the staleness of its own copy as a broken endpoint. Rebuilding is also the honest test:
  // it is exactly the document a reader gets when they open /docs after a re-seed.
  const docRes = await callJson(`${base}/docs/openapi.json?fresh=1`, {
    headers: { accept: 'application/json' },
  })
  if (docRes.status !== 200) {
    throw new Error(
      `${target.name}-service: GET /docs/openapi.json → HTTP ${String(docRes.status)}`,
    )
  }
  const operations = readOperations(docRes.body as Parameters<typeof readOperations>[0])

  const scopeRetailerId =
    session.role === 'retailer' ? await fx.linkedRetailerFor(target.username) : null
  const chain: RunChain = {
    refreshToken: null,
    sessionId: null,
    tenantId: session.tenantId,
    orderId: null,
    receiptId: null,
  }
  const results: Result[] = []

  for (const op of operations) {
    if (ONLY_METHOD && op.method !== ONLY_METHOD) continue

    const base0: Result = {
      service: target.name,
      operationId: op.operationId,
      method: op.method,
      path: op.path,
      url: base + op.path,
      summary: op.summary,
      status: null,
      ms: 0,
      classification: 'SKIPPED',
      message: '',
      reason: '',
      exampleSource: 'none',
    }

    const destructive = destructiveReason(op.operationId)
    if (destructive && !DESTRUCTIVE) {
      results.push({ ...base0, reason: `destructive, needs --destructive (${destructive})` })
      continue
    }

    const ctx: GenContext = {
      service: target.name,
      operationId: op.operationId,
      fx,
      role: session.role,
      scopeRetailerId,
      urlSeed: op.path,
      pinned: {},
    }
    const plan = await planFor(op, ctx, chain, target)
    if (plan.skip) {
      results.push({ ...base0, reason: plan.skip })
      continue
    }
    ctx.pinned = plan.pinned ?? {}

    // --- path + query -------------------------------------------------------------------------
    let usedRealIds = false
    let missingFixture: string | null = null
    let url = op.path
    const query = new URLSearchParams(plan.query ?? {})
    for (const param of op.parameters) {
      const fromContract = exampleOf(param)
      let value: unknown = plan.pathParams?.[param.name]
      if (value === undefined) value = fromContract
      if (value === undefined && param.in === 'path') {
        value = (await uuidFixture(param.name, ctx)) ?? undefined
      }
      if (param.in === 'path') {
        if (value === null) {
          missingFixture = `no demo row for path parameter {${param.name}}`
          break
        }
        if (value === undefined) {
          value = await generate(param.schema, param.name, `/${param.name}`, ctx)
        } else {
          usedRealIds = true
        }
        url = url.replace(`{${param.name}}`, encodeURIComponent(String(value)))
        continue
      }
      // query: required parameters only, plus a small `limit` so responses stay readable
      if (param.required) {
        const v = value ?? (await generate(param.schema, param.name, `/${param.name}`, ctx))
        const text = queryValue(v)
        if (text !== null) query.set(param.name, text)
      } else if (param.name === 'limit') {
        query.set('limit', '5')
      }
    }
    if (missingFixture) {
      results.push({ ...base0, reason: missingFixture })
      continue
    }
    ctx.urlSeed = url

    // --- body ----------------------------------------------------------------------------------
    let body: unknown
    let exampleSource: Result['exampleSource'] = 'none'
    if (plan.body !== undefined) {
      body = plan.body
      exampleSource = 'override'
    } else if (op.requestSchema) {
      const contractExample = exampleOf(op.requestNode)
      if (contractExample !== undefined) {
        body = contractExample
        exampleSource = 'contract'
        // Even a contract example must be idempotent to press twice.
        if (
          body &&
          typeof body === 'object' &&
          'idempotencyKey' in (body as Record<string, unknown>)
        ) {
          body = { ...(body as Record<string, unknown>), ...ctx.pinned }
        }
      } else {
        body = await generate(op.requestSchema, '(body)', '', ctx)
        exampleSource = 'generated'
        usedRealIds = true
      }
    }

    const qs = query.toString()
    const fullUrl = `${base}${url}${qs ? `?${qs}` : ''}`
    body = sealIdempotency(
      body,
      target.name,
      op.operationId,
      op.method,
      `${url}${qs ? `?${qs}` : ''}`,
    )
    const res = await callJson(fullUrl, {
      method: op.method,
      headers:
        op.operationId === 'auth.jwks' || op.operationId === 'auth.login'
          ? { 'content-type': 'application/json' }
          : authHeaders,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

    if (res.status === null) {
      results.push({
        ...base0,
        url: fullUrl,
        ms: res.ms,
        classification: 'BROKEN',
        message: res.transport ?? 'no response',
        reason: 'no response (hang, timeout or connection refused)',
        requestBody: body,
        exampleSource,
      })
      continue
    }

    const { classification, reason } = classify(
      op,
      res.status,
      res.body,
      session.role,
      usedRealIds,
      exampleSource,
    )
    results.push({
      ...base0,
      url: fullUrl,
      status: res.status,
      ms: res.ms,
      classification,
      reason,
      message: messageOf(res.body),
      requestBody: body,
      responseSample: sample(res.body),
      exampleSource,
    })

    // feed the auth chain
    if (
      op.operationId === 'auth.login' ||
      op.operationId === 'auth.refresh' ||
      op.operationId === 'auth.switchTenant'
    ) {
      const b = res.body as { refreshToken?: string } | null
      if (b?.refreshToken) chain.refreshToken = b.refreshToken
    }
    if (op.operationId === 'orders.create' || op.operationId === 'orders.repeatLast') {
      const b = res.body as { item?: { id?: string } } | null
      if (b?.item?.id && !chain.orderId) chain.orderId = b.item.id
    }
    if (op.operationId === 'receivables.receipts.create') {
      const b = res.body as { item?: { id?: string } } | null
      if (b?.item?.id) chain.receiptId = b.item.id
    }
    if (op.operationId === 'auth.sessions') {
      const b = res.body as { items?: { id: string; current: boolean }[] } | null
      chain.sessionId = b?.items?.find((s) => !s.current)?.id ?? null
    }
  }

  return results
}

/** A query string carries scalars; anything else is dropped rather than stringified to junk. */
function queryValue(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

/** A small, readable slice of the response — enough to see the call really returned data. */
function sample(body: unknown): unknown {
  const text = JSON.stringify(body)
  if (text === undefined) return body
  return text.length <= 600 ? body : `${text.slice(0, 600)}…`
}

// ---------------------------------------------------------------------------------------------------------------
// reporting

const MARK: Record<Classification, string> = {
  OK: 'OK      ',
  EXPECTED: 'EXPECTED',
  BROKEN: 'BROKEN  ',
  SKIPPED: 'SKIPPED ',
}

function pad(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value + ' '.repeat(width - value.length)
}

function printTable(service: string, results: Result[]): void {
  out()
  out(`── ${service}-service ${'─'.repeat(Math.max(0, 96 - service.length))}`)
  out(
    `${pad('METHOD', 7)} ${pad('PATH', 46)} ${pad('STATUS', 6)} ${pad('MS', 6)} ${pad('CLASS', 8)} MESSAGE`,
  )
  for (const r of results) {
    const note = r.classification === 'SKIPPED' ? r.reason : r.message || r.reason
    out(
      `${pad(r.method, 7)} ${pad(r.path, 46)} ${pad(r.status === null ? '-' : String(r.status), 6)} ${pad(
        String(r.ms),
        6,
      )} ${MARK[r.classification]} ${note.slice(0, 80)}`,
    )
    if (VERBOSE && r.requestBody !== undefined)
      out(`        body: ${JSON.stringify(r.requestBody)}`)
  }
  const counts = tally(results)
  out(
    `   ${service}: ${String(counts.OK)} OK · ${String(counts.EXPECTED)} expected · ${String(counts.BROKEN)} BROKEN · ${String(counts.SKIPPED)} skipped  (of ${String(results.length)})`,
  )
}

function tally(results: Result[]): Record<Classification, number> {
  const counts: Record<Classification, number> = { OK: 0, EXPECTED: 0, BROKEN: 0, SKIPPED: 0 }
  for (const r of results) counts[r.classification] += 1
  return counts
}

async function main(): Promise<void> {
  const targets = ONLY_SERVICE ? SERVICES.filter((s) => s.name === ONLY_SERVICE) : SERVICES
  if (targets.length === 0) {
    console.error(
      `unknown --service ${String(ONLY_SERVICE)}; known: ${SERVICES.map((s) => s.name).join(', ')}`,
    )
    process.exit(2)
  }

  const owner = await login('sunil.tarsun')
  const fx = await Fixtures.open(owner.tenantId)
  mkdirSync(outDir, { recursive: true })

  out(`smoke: ${targets.length} service(s), tenant ${owner.tenantId}`)
  if (ONLY_METHOD) out(`       --only ${ONLY_METHOD}: nothing else is called`)
  if (!DESTRUCTIVE)
    out(`       destructive procedures are skipped (pass --destructive to include them)`)

  const all: Result[] = []
  const failures: string[] = []
  for (const target of targets) {
    let results: Result[]
    try {
      results = await runService(target, fx)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      failures.push(`${target.name}: ${message}`)
      out(`\n── ${target.name}-service — COULD NOT RUN: ${message}`)
      continue
    }
    printTable(target.name, results)
    writeFileSync(
      resolve(outDir, `${target.name}.json`),
      `${JSON.stringify({ service: target.name, ranAt: new Date().toISOString(), summary: tally(results), results }, null, 2)}\n`,
    )
    all.push(...results)
  }

  await fx.close()

  const skipped = all.filter((r) => r.classification === 'SKIPPED')
  if (skipped.length > 0) {
    out()
    out(`── skipped (${String(skipped.length)}) — nothing is skipped silently ${'─'.repeat(40)}`)
    for (const r of skipped) out(`   ${pad(`${r.service}/${r.operationId}`, 46)} ${r.reason}`)
  }

  const broken = all.filter((r) => r.classification === 'BROKEN')
  if (broken.length > 0) {
    out()
    out(`── BROKEN (${String(broken.length)}) ${'─'.repeat(80)}`)
    for (const r of broken) {
      const origin =
        r.exampleSource === 'contract'
          ? ' [body: the contract example]'
          : r.exampleSource === 'generated'
            ? ' [body: generated from demo data]'
            : ''
      out(`   ${pad(`${r.service}/${r.operationId}`, 46)} ${String(r.status)} ${r.reason}${origin}`)
      if (r.message) out(`        ${r.message.slice(0, 160)}`)
    }
  }

  const counts = tally(all)
  out()
  out(
    `TOTAL ${String(all.length)} calls · ${String(counts.OK)} OK · ${String(counts.EXPECTED)} expected · ${String(counts.BROKEN)} BROKEN · ${String(counts.SKIPPED)} skipped`,
  )
  out(`JSON written to ${outDir}`)

  if (failures.length > 0) {
    for (const f of failures) console.error(`service could not be reached: ${f}`)
  }
  process.exit(counts.BROKEN > 0 || failures.length > 0 ? 1 : 0)
}

await main()
