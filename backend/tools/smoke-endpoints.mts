/**
 * Endpoint smoke harness — proves every operation of every running service actually answers.
 *
 *   pnpm smoke                     every service, every operation (mutations included)
 *   pnpm smoke --service owner     one service
 *   pnpm smoke --base http://127.0.0.1:3100   ALL-IN-ONE mode: one process, one port, every service
 *                                  behind its own path prefix (/auth, /owner, ... — docs/26 §7)
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
import { isAllowed, permissionFor, type MembershipRole, type PermissionRole } from '@dos/contracts'
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
/**
 * ALL-IN-ONE MODE (founder 2026-09-05, docs/26 §7). With `--base http://127.0.0.1:3100` every service
 * is reached at `<base>/<name>` on ONE port instead of at `localhost:<its port>`; without it, nothing
 * changes. The same harness must pass both ways, because "the same services behind path prefixes" is
 * exactly the claim the deployment mode makes, and a smoke run is the only thing that proves it.
 */
const BASE_URL = flagValue('--base')?.replace(/\/$/, '')
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

/**
 * TOGGLES, whose undo must really run. `admin.tenants.suspend` and `admin.tenants.reactivate` are one
 * pair: the suspend locks a whole distributorship out with 423 and the reactivate two lines later is
 * the only thing that lets it back in. Their request bodies never change, so under the day-stable
 * digest below the SECOND `--destructive` run of a day REPLAYS each stored reply instead of executing
 * it — and a reactivate that never ran still answers `"status":"active"` with a green 200 while the
 * row stays suspended. That is exactly what happened on 2026-09-06: the pilot tenant was left locked
 * out, every one of the seven demo sign-ins answered 423, and the smoke log said OK.
 *
 * Scoping their key to the RUN (not the day) makes the pair honest — the suspend suspends and the
 * reactivate reactivates, on run one and on run fifty. `pnpm db:seed` re-activates a demo tenant as
 * well (`restoreDemoAccess` in `seed-demo/index.ts`), which is the belt to this brace.
 */
const STATE_TOGGLE_OPS = new Set(['admin.tenants.suspend', 'admin.tenants.reactivate'])

function out(line = ''): void {
  process.stdout.write(`${line}\n`)
}

// ---------------------------------------------------------------------------------------------------------------
// services + demo sign-ins

interface ServiceTarget {
  name: string
  port: number
  username: string
  /**
   * The role this service is exercised as. `platform_admin` (module 13) is NOT a membership role: it
   * signs in at `/auth/platform/login`, holds no tenant, and is refused by every one of the six
   * distributor services — which is exactly why admin-service gets its own row here.
   */
  role: PermissionRole
}

const SERVICES: readonly ServiceTarget[] = [
  { name: 'auth', port: 3000, username: 'sunil.tarsun', role: 'owner' },
  { name: 'owner', port: 3001, username: 'sunil.tarsun', role: 'owner' },
  { name: 'manager', port: 3002, username: 'vikas.kadam', role: 'manager' },
  { name: 'sales', port: 3003, username: 'rahul.deshmukh', role: 'salesperson' },
  { name: 'warehouse', port: 3004, username: 'dinesh.patil', role: 'warehouse' },
  { name: 'delivery', port: 3005, username: 'ganesh.more', role: 'delivery' },
  { name: 'retailer', port: 3006, username: 'ramesh.gupta', role: 'retailer' },
  // Module 13, the platform console. `dos.admin` is seeded by `seedPlatformConsole` and is a SUPER
  // administrator with no membership anywhere; it signs in at the platform endpoint (see `login`).
  { name: 'admin', port: 3007, username: 'dos.admin', role: 'platform_admin' },
]

const DEMO_PASSWORD = 'Dos@1234'
/** The seeded console account (`seedPlatformConsole`); it holds no membership anywhere. */
const PLATFORM_ADMIN_USERNAME = 'dos.admin'
const AUTH_URL = BASE_URL ? `${BASE_URL}/auth` : 'http://localhost:3000'
/** Where one service answers: its own port, or its prefix under the all-in-one base. */
const baseUrlFor = (name: string, port: number): string =>
  BASE_URL ? `${BASE_URL}/${name}` : `http://localhost:${String(port)}`
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
  // Module 13. `suspend` is not caught by the pattern and is the sharpest switch in the product: it
  // refuses every sign-in for a whole distributorship until somebody presses reactivate.
  'admin.tenants.suspend':
    'would refuse every sign-in for the demo distributorship until it is reactivated',
}

function destructiveReason(operationId: string): string | undefined {
  if (DESTRUCTIVE_EXTRA[operationId]) return DESTRUCTIVE_EXTRA[operationId]
  if (DESTRUCTIVE_PATTERN.test(operationId)) return `matches /${DESTRUCTIVE_PATTERN.source}/`
  return undefined
}

// ---------------------------------------------------------------------------------------------------------------
// deterministic ids — so a second run replays instead of duplicating

/** The one vehicle every service's throwaway trip is planned on; it never carries stock. */
const SMOKE_VEHICLE_ID = '01920000-0000-7000-8000-00000000c0de'

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
  const scope = STATE_TOGGLE_OPS.has(operationId) ? RUN_NONCE : RUN_TAG
  const digest = createHash('sha256')
    .update(`${method} ${url} ${scope} ${JSON.stringify(rest)}`)
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
   * `salespersonId` non-null means the caller is a rep: it reaches only the orders credited to it
   * (DOS-073), so the fixture is narrowed to those.
   */
  orderInState = (state: string, retailerId?: string | null, salespersonId?: string | null) =>
    this.liveScalar(
      `select id from sales_orders
        where tenant_id = $1 and state::text = $2
          and ($3::text is null or (retailer_id = $3::text and source::text = 'retailer_app'))
          and ($4::text is null or salesperson_id = $4::text)
        order by created_at desc limit 1`,
      [this.tenantId, state, retailerId ?? null, salespersonId ?? null],
    )
  anyOrderId = (retailerId?: string | null, salespersonId?: string | null) =>
    this.liveScalar(
      `select id from sales_orders
        where tenant_id = $1
          and ($2::text is null or (retailer_id = $2::text and source::text = 'retailer_app'))
          and ($3::text is null or salesperson_id = $3::text)
        order by created_at desc limit 1`,
      [this.tenantId, retailerId ?? null, salespersonId ?? null],
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
  // --- delivery: the road, read live because every trip step moves the next one's row -------------
  userIdOf = (username: string) =>
    this.scalar(`user:${username}`, `select id from users where username=$1 limit 1`, [username])
  /** The retailer at the top of the list who is NOT the retailer app's shop: a throwaway stop for it. */
  stopRetailerId = () =>
    this.scalar(
      'stopRetailer',
      `select id from retailers where tenant_id=$1 and active order by code desc limit 1`,
      this.t(),
    )
  /** A bill that is packed or dispatched and rides on no trip: the one planned delivery this run makes. */
  freeInvoice = () =>
    this.rows(
      `select i.id, i.retailer_id from invoices i join sales_orders o on o.id = i.order_id
        where i.tenant_id=$1 and o.state::text in ('packed','dispatched')
          and i.state::text in ('issued','partially_paid')
          and not exists (select 1 from deliveries d where d.invoice_id = i.id)
        order by i.id desc limit 1`,
      this.t(),
    ).then((r) => (r[0] ? { id: r[0].id as string, retailerId: r[0].retailer_id as string } : null))
  invoiceLinesOf = (invoiceId: string) =>
    this.rows(
      `select id, qty_pcs, free_qty_pcs from invoice_lines where tenant_id=$1 and invoice_id=$2 order by line_no`,
      [this.tenantId, invoiceId],
    )
  /** A trip the signed-in user may read: the desk any, the crew one it is on. */
  visibleTrip = (actorId: string | null, crewOnly: boolean, states?: string[]) =>
    this.liveScalar(
      `select id from trips where tenant_id=$1
          and ($2::text is null or not $3::boolean or driver_id=$2 or helper_id=$2)
          and ($4::text[] is null or state::text = any($4))
        order by (state::text='active') desc, trip_date desc, id desc limit 1`,
      [this.tenantId, actorId, crewOnly, states ?? null],
    )
  /** The stop of a trip that still has to be visited; `withBill` = one with a planned delivery on it. */
  openStopOf = (tripId: string, withBill: boolean) =>
    this.liveScalar(
      `select s.id from trip_stops s where s.tenant_id=$1 and s.trip_id=$2
          and s.state::text in ('pending','started','arrived')
          and ($3::boolean = exists (select 1 from deliveries d where d.stop_id = s.id and d.outcome is null))
        order by s.sequence limit 1`,
      [this.tenantId, tripId, withBill],
    )
  anyStopOf = (tripId: string) =>
    this.liveScalar(
      `select id from trip_stops where tenant_id=$1 and trip_id=$2 order by sequence limit 1`,
      [this.tenantId, tripId],
    )
  stopSequence = (stopId: string) =>
    this.liveScalar(`select sequence from trip_stops where tenant_id=$1 and id=$2`, [
      this.tenantId,
      stopId,
    ])
  plannedDeliveryOf = (tripId: string) =>
    this.rows(
      `select d.id, d.stop_id, d.invoice_id, d.retailer_id from deliveries d
        where d.tenant_id=$1 and d.trip_id=$2 and d.outcome is null order by d.id limit 1`,
      [this.tenantId, tripId],
    ).then((r) =>
      r[0]
        ? {
            id: r[0].id as string,
            stopId: r[0].stop_id as string,
            invoiceId: r[0].invoice_id as string,
            retailerId: r[0].retailer_id as string,
          }
        : null,
    )
  /** A delivery the signed-in user may open: the shop its own, the crew its trip's, the desk any. */
  visibleDelivery = (actorId: string | null, crewOnly: boolean, scopeRetailerId: string | null) =>
    this.liveScalar(
      `select d.id from deliveries d join trips t on t.id = d.trip_id
        where d.tenant_id=$1 and d.outcome is not null
          and ($2::text is null or d.retailer_id=$2)
          and ($3::text is null or not $4::boolean or t.driver_id=$3 or t.helper_id=$3)
        order by d.id desc limit 1`,
      [this.tenantId, scopeRetailerId, actorId, crewOnly],
    )
  /**
   * An ACTIVE trip with van sales on whose vehicle holds sellable pieces (the crew's own when
   * `crewOnly`), and the variant with the most of them: a one-piece van sale from the real van.
   */
  vanSaleLine = (actorId: string | null, crewOnly: boolean) =>
    this.rows(
      `select t.id as trip_id, l.variant_id, (sb.on_hand - sb.reserved) as available
         from trips t join vehicles v on v.id = t.vehicle_id
         join stock_balances sb on sb.location_id = v.location_id and sb.tenant_id = t.tenant_id
         join stock_lots l on l.id = sb.lot_id
        where t.tenant_id=$1 and t.state::text = 'active' and t.van_sales_enabled
          and ($2::text is null or not $3::boolean or t.driver_id=$2 or t.helper_id=$2)
          and (sb.on_hand - sb.reserved) > 0
        order by available desc, t.id, sb.lot_id limit 1`,
      [this.tenantId, actorId, crewOnly],
    ).then((r) =>
      r[0] ? { tripId: r[0].trip_id as string, variantId: r[0].variant_id as string } : null,
    )
  vehicleId = () =>
    this.scalar(
      'vehicle',
      `select id from vehicles where tenant_id=$1 and active order by reg_no limit 1`,
      this.t(),
    )
  tripState = (tripId: string) =>
    this.liveScalar(`select state::text from trips where tenant_id=$1 and id=$2`, [
      this.tenantId,
      tripId,
    ])
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

  /**
   * The one support request the owner can still APPROVE: not yet answered, not closed, and its window
   * has not lapsed. Once the demo one is answered there is nothing left to press — which is a SKIP,
   * not a fault, so the plan says so rather than sending a made-up id into a permanent 404.
   */
  approvableSupportGrant = () =>
    this.liveScalar(
      `select id from support_grants
        where tenant_id=$1 and approved_at is null and revoked_at is null and expires_at > now()
        order by requested_at limit 1`,
      [this.tenantId],
    )

  /**
   * A grant the owner can still SHUT — a request it has not answered, or a window it has opened.
   * Wider than the one above on purpose: revoking an APPROVED grant is the more interesting half of
   * the flow, and it is the half `--destructive` should actually exercise.
   */
  revocableSupportGrant = () =>
    this.liveScalar(
      `select id from support_grants where tenant_id=$1 and revoked_at is null
        order by approved_at nulls first, requested_at limit 1`,
      [this.tenantId],
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
  /**
   * The rep's own user id for a salesperson sign-in, null otherwise. The orders service keeps a rep to
   * the orders credited to it (DOS-073), so an order fixture for a rep is narrowed the same way.
   */
  scopeSalespersonId: string | null
  /** The resolved request path, folded into generated ids so two orders never share a line id. */
  urlSeed: string
  /** Values the operation's override already decided, keyed by property name. */
  pinned: Record<string, unknown>
  /**
   * A POST to THIS service under THIS session, for the one plan that needs a row created just before
   * it can run (`trips.cancel` cancels a plan of its own, never the demo's).
   */
  post: (path: string, body: Record<string, unknown>) => Promise<CallResult>
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
  /**
   * A CONSOLE session's refresh token (module 13). `auth.platformRefresh` will not take a tenant
   * session's — a console account is a member of nobody and the two sign-ins are separate on purpose
   * — so `auth.platformLogin` earlier in the run is what fills this.
   */
  platformRefreshToken: string | null
  sessionId: string | null
  tenantId: string
  /** The throwaway order this run created, walked draft → submitted → confirmed. */
  orderId: string | null
  /** The throwaway receipt this run created, walked collected → deposited → reversed. */
  receiptId: string | null
  /**
   * The throwaway trip this run planned on the smoke vehicle and walked planned → loading → active →
   * closing → settled, with one stop carrying a real bill (delivered at the door) and one to fail.
   */
  tripId: string | null
  /** Days from today the throwaway trip is dated; the plan `trips.cancel` throws away sits the day after. */
  tripDayOffset: number | null
  stopWithBill: string | null
  deliveryId: string | null
  /**
   * The body this run sent to `integrations.imports.create` (the seeded file key and profile the
   * published example re-stages), so `imports.cancel` can stage a throwaway import of its own and
   * abandon THAT — never the demo's staged job, which is what the published example points at.
   */
  importCreateBody: Record<string, unknown> | null
}

/** Runs later than its position in the document, because it invalidates what earlier ones need. */
const ORDER_HINT: Record<string, number> = {
  'auth.login': 1,
  'auth.platformLogin': 1,
  'auth.platformRefresh': 2,
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
  // The road, in the order a day happens: the smoke vehicle, the plan with its two stops, the load,
  // the departure, the door (bill, proof, money, van sale, expense, breadcrumbs, a shop closed), the
  // return and the settlement. Each step needs the row the one before it left behind.
  'delivery.vehicles.upsert': 20,
  'delivery.trips.create': 21,
  'delivery.stops.reorder': 22,
  'delivery.trips.startLoading': 23,
  'delivery.trips.depart': 24,
  // after depart: the crew may add a stop only to its ACTIVE trip (a van-sale shop)
  'delivery.stops.add': 25,
  'delivery.stops.start': 26,
  'delivery.stops.arrive': 27,
  'delivery.deliveries.record': 28,
  'delivery.deliveries.addPod': 29,
  'delivery.collections.record': 30,
  'delivery.vanSales.create': 31,
  'delivery.expenses.record': 32,
  'delivery.gps.points': 33,
  'delivery.stops.fail': 34,
  'delivery.trips.return': 40,
  'delivery.trips.settlementPreview': 41,
  'delivery.trips.settle': 42,
  'delivery.gps.trace': 43,
  'delivery.deliveries.get': 44,
  'delivery.deliveries.list': 44,
  'delivery.trips.get': 44,
  'delivery.stops.next': 44,
  // The inbound bill, in the order it happens: capture (create → slots → page → QR → submit), then the
  // desk's SKU picks, a re-read, a review taken and released, a save and a submit on the held
  // session, the approval, and last the reads and the reject of the duplicate.
  'docint.documents.create': 20,
  'docint.documents.pageUploadUrl': 21,
  'docint.documents.addPage': 22,
  'docint.documents.verifyQr': 23,
  'docint.documents.submit': 24,
  'docint.matches.reject': 30,
  'docint.matches.accept': 31,
  'docint.matches.choose': 32,
  'docint.matches.rerun': 33,
  'docint.extractions.run': 34,
  'docint.review.start': 35,
  'docint.review.heartbeat': 36,
  'docint.review.save': 37,
  'docint.review.submit': 38,
  'docint.review.release': 39,
  'docint.documents.approve': 40,
  'docint.documents.reject': 60,
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
    // --- module 13: the console signs in at its own endpoint, and refreshes with its own token ----
    case 'auth.platformLogin':
      return {
        body: {
          username: PLATFORM_ADMIN_USERNAME,
          password: DEMO_PASSWORD,
          deviceId: stableUuid(`smoke-throwaway-platform:${PLATFORM_ADMIN_USERNAME}`),
          deviceName: 'pnpm smoke',
          platform: 'web',
        },
      }
    case 'auth.platformRefresh':
      return chain.platformRefreshToken
        ? {
            body: {
              refreshToken: chain.platformRefreshToken,
              deviceId: stableUuid(`smoke-throwaway-platform:${PLATFORM_ADMIN_USERNAME}`),
            },
          }
        : {
            skip: 'no console refresh token: auth.platformLogin did not succeed earlier in this run',
          }
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
        pathParams: {
          id:
            chain.orderId ??
            (await fx.orderInState('draft', ctx.scopeRetailerId, ctx.scopeSalespersonId)),
        },
      }
    case 'orders.submit':
      return {
        pathParams: {
          id:
            chain.orderId ??
            (await fx.orderInState('draft', ctx.scopeRetailerId, ctx.scopeSalespersonId)),
        },
      }
    case 'orders.confirm':
      return {
        pathParams: {
          id: chain.orderId ?? (await fx.orderInState('submitted', ctx.scopeRetailerId)),
        },
      }
    case 'orders.cancel':
      return {
        pathParams: {
          id:
            chain.orderId ??
            (await fx.orderInState('draft', ctx.scopeRetailerId, ctx.scopeSalespersonId)),
        },
      }
    case 'orders.get':
      return {
        pathParams: {
          id: chain.orderId ?? (await fx.anyOrderId(ctx.scopeRetailerId, ctx.scopeSalespersonId)),
        },
      }
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

    // --- platform support access: the owner answers the ONE open request, or there is nothing ----
    case 'tenancy.support.approve': {
      const id = await fx.approvableSupportGrant()
      return id
        ? { pathParams: { id } }
        : { skip: 'no support request is waiting for the owner to answer' }
    }
    case 'tenancy.support.revoke': {
      const id = await fx.revocableSupportGrant()
      return id ? { pathParams: { id } } : { skip: 'no support grant is still open' }
    }

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

    // --- reporting: the one read whose optional filter is not optional for the back office ------
    // `userId` is optional in the schema (a rep's own token supplies it), so the harness — which
    // sends required parameters only — would ask the owner for "everyone's day" and get the 400 the
    // brief demands. Naming a rep exercises the answer instead of the refusal; a salesperson's own
    // token overrides it back to itself, so the same query is right on every service that serves it.
    case 'reporting.dashboard.rep': {
      const userId = await fx.staffUserId('salesperson')
      return userId ? { query: { userId } } : {}
    }

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

    // --- delivery: one throwaway day on the road per run, on a smoke vehicle with no stock --------
    // Like the order chain, the trip is once-through (settled trips do not reopen), so its ids are
    // scoped to THIS run (`RUN_NONCE`): every run plans, drives and settles a fresh throwaway trip.
    // ONE smoke vehicle for the whole harness, created by the first PIN_HOLDER service to run
    // (owner), so the delivery service — which may not add a vehicle — still plans on a van that
    // carries no stock. A real vehicle would carry the demo's van stock, and a settlement that counts
    // nothing would write it off as a miscount.
    case 'delivery.vehicles.upsert':
      return {
        pinned: {
          id: SMOKE_VEHICLE_ID,
          regNo: 'MH-05-SM-0001',
          name: 'Smoke van',
          kind: 'pickup',
        },
      }
    case 'delivery.trips.create': {
      if (!isAllowed(permissionFor(op.operationId), ctx.role)) return {}
      const crewId =
        ctx.role === 'delivery'
          ? await fx.userIdOf(target.username)
          : await fx.userIdOf('santosh.kamble')
      const vehicle = await fx.liveScalar(`select id from vehicles where tenant_id=$1 and id=$2`, [
        fx.tenantId,
        SMOKE_VEHICLE_ID,
      ])
      const retailerId = await fx.stopRetailerId()
      if (!crewId || !vehicle || !retailerId)
        return {
          skip: 'no smoke vehicle yet (owner-service creates it in delivery.vehicles.upsert) or no crew',
        }
      // stop 1 carries one real packed bill (delivered at the door later in the run) when any is
      // free to ride; stop 2 carries nothing and is the one the crew fails ("shop closed")
      const bill = await fx.freeInvoice()
      // A driver is on one trip a day, so each run walks the date forward: slot per service, seven
      // days per earlier run of the day, never a date two runs or two services share.
      const earlier = await fx.liveScalar(
        `select count(*) from trips where tenant_id=$1 and driver_id=$2 and created_at::date = current_date`,
        [fx.tenantId, crewId],
      )
      const dayOffset = 2 + servicePhoneSlot(target.name) + 7 * Number(earlier ?? 0)
      chain.tripDayOffset = dayOffset
      const tripDate = istDate(dayOffset)
      return {
        body: {
          idempotencyKey: 'sealed below',
          id: stableUuid(`${RUN_NONCE}:${target.name}:trip`),
          tripDate,
          vehicleId: vehicle,
          driverId: crewId,
          vanSalesEnabled: true,
          openingCashPaise: 0,
          stops: [
            ...(bill
              ? [
                  {
                    id: stableUuid(`${RUN_NONCE}:${target.name}:trip:stop-1`),
                    sequence: 1,
                    retailerId: bill.retailerId,
                    invoiceIds: [bill.id],
                  },
                ]
              : []),
            {
              id: stableUuid(`${RUN_NONCE}:${target.name}:trip:stop-2`),
              sequence: 2,
              retailerId,
              invoiceIds: [],
            },
          ],
        },
      }
    }
    // A cancelled trip is terminal and the idempotent seed never recreates one, so pointing this at
    // the demo's planned trip (the published example) would take the delivery app's "tomorrow" away
    // for good on the first `--destructive` run. The run cancels a plan of its own instead: a second
    // throwaway trip on the smoke vehicle, dated the day after this run's day trip so the same
    // driver is free, with one stop and no bill. Nothing outside the smoke vehicle is touched.
    case 'delivery.trips.cancel': {
      if (!isAllowed(permissionFor(op.operationId), ctx.role))
        return { pathParams: { id: await fx.visibleTrip(null, false) } }
      if (!chain.tripId || chain.tripDayOffset === null)
        return { skip: 'no throwaway trip: delivery.trips.create did not run' }
      const crewId =
        ctx.role === 'delivery'
          ? await fx.userIdOf(target.username)
          : await fx.userIdOf('santosh.kamble')
      const retailerId = await fx.stopRetailerId()
      if (!crewId || !retailerId) return { skip: 'no crew or no shop for a plan to cancel' }
      const id = stableUuid(`${RUN_NONCE}:${target.name}:trip-to-cancel`)
      const planned = await ctx.post('/delivery/trips', {
        idempotencyKey: `smoke:${target.name}:trip-to-cancel:${RUN_NONCE}`,
        id,
        tripDate: istDate(chain.tripDayOffset + 1),
        vehicleId: SMOKE_VEHICLE_ID,
        driverId: crewId,
        vanSalesEnabled: true,
        openingCashPaise: 0,
        stops: [
          {
            id: stableUuid(`${RUN_NONCE}:${target.name}:trip-to-cancel:stop-1`),
            sequence: 1,
            retailerId,
            invoiceIds: [],
          },
        ],
      })
      if (planned.status !== 200)
        return {
          skip: `could not plan a trip to cancel: delivery.trips.create → HTTP ${String(planned.status)} ${messageOf(planned.body)}`,
        }
      return { pathParams: { id }, pinned: { id, reason: 'pnpm smoke: a plan that never left' } }
    }
    case 'delivery.stops.add': {
      if (!chain.tripId)
        return isAllowed(permissionFor(op.operationId), ctx.role)
          ? { skip: 'no throwaway trip: delivery.trips.create did not run' }
          : { pathParams: { id: await fx.visibleTrip(null, false) } }
      const retailerId = await fx.stopRetailerId()
      return {
        pathParams: { id: chain.tripId },
        body: {
          idempotencyKey: 'sealed below',
          id: chain.tripId,
          stop: {
            id: stableUuid(`${RUN_NONCE}:${target.name}:trip:stop-3`),
            sequence: 3,
            retailerId: retailerId ?? '',
            invoiceIds: [],
          },
        },
      }
    }
    case 'delivery.stops.reorder': {
      const tripId = chain.tripId ?? (await fx.visibleTrip(null, false))
      if (!tripId) return { skip: 'no trip in the demo data' }
      const stopId = await fx.anyStopOf(tripId)
      const sequence = stopId ? await fx.stopSequence(stopId) : null
      if (!stopId || sequence === null) return { skip: 'the trip has no stop to reorder' }
      return {
        pathParams: { id: tripId },
        body: {
          idempotencyKey: 'sealed below',
          id: tripId,
          order: [{ stopId, sequence: Number(sequence) }],
        },
      }
    }
    // The three moves only ever touch THIS run's throwaway trip: pointed at a demo trip they would
    // take the founder's active trip off the road. A role that may not call them is still pressed
    // (against any trip it can see) so the 403 the matrix promises is proven.
    case 'delivery.trips.startLoading':
    case 'delivery.trips.depart':
    case 'delivery.trips.return': {
      if (chain.tripId) return { pathParams: { id: chain.tripId }, pinned: { id: chain.tripId } }
      if (isAllowed(permissionFor(op.operationId), ctx.role))
        return { skip: 'no throwaway trip: delivery.trips.create did not run' }
      const any = await fx.visibleTrip(null, false)
      return any ? { pathParams: { id: any }, pinned: { id: any } } : {}
    }
    case 'delivery.trips.get':
    case 'delivery.trips.settlementPreview':
    case 'delivery.stops.next':
    case 'delivery.gps.trace': {
      const actor = await fx.userIdOf(target.username)
      const tripId = chain.tripId ?? (await fx.visibleTrip(actor, ctx.role === 'delivery'))
      return tripId ? { pathParams: { id: tripId } } : { skip: 'no trip in the demo data' }
    }
    case 'delivery.stops.start':
    case 'delivery.stops.arrive': {
      const tripId = chain.tripId
      const stopId = tripId ? await fx.openStopOf(tripId, true) : null
      if (!stopId)
        return isAllowed(permissionFor(op.operationId), ctx.role)
          ? { skip: 'no open stop with a bill on the throwaway trip' }
          : { pathParams: { id: await fx.anyStopOf((await fx.visibleTrip(null, false)) ?? '') } }
      return {
        pathParams: { id: stopId },
        pinned: {
          id: stopId,
          ...(op.operationId === 'delivery.stops.arrive' ? { lat: 19.2437, lng: 73.1355 } : {}),
        },
      }
    }
    case 'delivery.stops.fail': {
      const stopId = chain.tripId ? await fx.openStopOf(chain.tripId, false) : null
      if (!stopId)
        return isAllowed(permissionFor(op.operationId), ctx.role)
          ? { skip: 'no open stop without a bill on the throwaway trip' }
          : { pathParams: { id: await fx.anyStopOf((await fx.visibleTrip(null, false)) ?? '') } }
      return {
        pathParams: { id: stopId },
        body: {
          idempotencyKey: 'sealed below',
          id: stopId,
          failureReason: 'shop_closed',
        },
      }
    }
    case 'delivery.deliveries.record': {
      const planned = chain.tripId ? await fx.plannedDeliveryOf(chain.tripId) : null
      if (!planned)
        return isAllowed(permissionFor(op.operationId), ctx.role)
          ? {
              skip: 'no planned bill on the throwaway trip (no packed bill was free to ride on it)',
            }
          : {}
      const lines = await fx.invoiceLinesOf(planned.invoiceId)
      return {
        body: {
          idempotencyKey: 'sealed below',
          id: planned.id,
          tripId: chain.tripId,
          stopId: planned.stopId,
          invoiceId: planned.invoiceId,
          receiverName: 'Shop staff',
          lines: lines.map((l, i) => ({
            id: stableUuid(`${RUN_NONCE}:${target.name}:delivery-line:${String(i)}`),
            invoiceLineId: l.id,
            deliveredQtyPcs: Number(l.qty_pcs) + Number(l.free_qty_pcs),
            returnedQtyPcs: 0,
          })),
          pod: [
            {
              id: stableUuid(`${RUN_NONCE}:${target.name}:pod`),
              kind: 'signature',
              inline: {
                mimeType: 'image/png',
                contentBase64:
                  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
              },
            },
          ],
        },
      }
    }
    case 'delivery.deliveries.addPod': {
      const actor = await fx.userIdOf(target.username)
      const deliveryId =
        chain.deliveryId ??
        (await fx.visibleDelivery(actor, ctx.role === 'delivery', ctx.scopeRetailerId))
      if (!deliveryId) return { skip: 'no delivery in the demo data' }
      return {
        pathParams: { id: deliveryId },
        pinned: {
          id: deliveryId,
          'evidence.id': stableUuid(`${RUN_NONCE}:${target.name}:pod-geo`),
        },
      }
    }
    case 'delivery.deliveries.get': {
      const actor = await fx.userIdOf(target.username)
      const deliveryId =
        chain.deliveryId ??
        (await fx.visibleDelivery(actor, ctx.role === 'delivery', ctx.scopeRetailerId))
      return deliveryId
        ? { pathParams: { id: deliveryId } }
        : { skip: 'no delivery in the demo data' }
    }
    case 'delivery.collections.record': {
      if (!chain.tripId)
        return isAllowed(permissionFor(op.operationId), ctx.role)
          ? { skip: 'no throwaway trip: delivery.trips.create did not run' }
          : {}
      const stopId = await fx.anyStopOf(chain.tripId)
      const retailerId = stopId
        ? await fx.liveScalar(`select retailer_id from trip_stops where id=$1`, [stopId])
        : null
      if (!retailerId) return { skip: 'the throwaway trip has no stop' }
      return {
        body: {
          idempotencyKey: 'sealed below',
          id: stableUuid(`${RUN_NONCE}:${target.name}:collection`),
          receiptId: stableUuid(`${RUN_NONCE}:${target.name}:collection-receipt`),
          tripId: chain.tripId,
          stopId,
          retailerId,
          mode: 'cash',
          // One rupee, on account when the shop owes nothing: enough to prove the receipt and the
          // journal entry, small enough to leave the demo books readable.
          amountPaise: 100,
        },
      }
    }
    case 'delivery.vanSales.create': {
      // The smoke vehicle carries no stock, so the van sale is made from the real active trip's
      // van (the tempo the warehouse seed loaded): one piece, so the demo van never runs dry.
      const actor = await fx.userIdOf(target.username)
      const line = await fx.vanSaleLine(actor, ctx.role === 'delivery')
      const retailerId = await fx.stopRetailerId()
      if (!line || !retailerId)
        return isAllowed(permissionFor(op.operationId), ctx.role)
          ? { skip: 'no active trip with van sales on and stock on its vehicle' }
          : {}
      return {
        body: {
          idempotencyKey: 'sealed below',
          id: stableUuid(`${RUN_TAG}:${target.name}:van-sale`),
          tripId: line.tripId,
          retailerId,
          invoiceId: stableUuid(`${RUN_TAG}:${target.name}:van-sale-invoice`),
          deliveryId: stableUuid(`${RUN_TAG}:${target.name}:van-sale-delivery`),
          lines: [
            {
              id: stableUuid(`${RUN_TAG}:${target.name}:van-sale-line`),
              variantId: line.variantId,
              enteredQty: 1,
              enteredUnit: 'piece',
            },
          ],
        },
      }
    }
    case 'delivery.expenses.record': {
      const tripId = chain.tripId ?? (await fx.visibleTrip(null, false, ['active', 'closing']))
      if (!tripId) return { skip: 'no trip on the road' }
      return {
        pinned: {
          id: stableUuid(`${RUN_NONCE}:${target.name}:expense`),
          tripId,
          amountPaise: 100,
        },
      }
    }
    case 'delivery.gps.points': {
      const actor = await fx.userIdOf(target.username)
      const tripId = chain.tripId ?? (await fx.visibleTrip(actor, true, ['active']))
      if (!tripId)
        return isAllowed(permissionFor(op.operationId), ctx.role)
          ? { skip: 'no active trip the signed-in user is crew on' }
          : {}
      const at = `${istDate()}T04:00:00.000Z`
      return {
        body: {
          idempotencyKey: 'sealed below',
          tripId,
          deviceId: deviceIdFor(target.username),
          points: [
            { recordedAt: at, lat: 19.2455, lng: 73.1305, accuracyM: 8, speedMps: 3 },
            { recordedAt: `${istDate()}T04:00:30.000Z`, lat: 19.2458, lng: 73.131, accuracyM: 8 },
          ],
        },
      }
    }
    case 'delivery.trips.settle': {
      if (!chain.tripId)
        return isAllowed(permissionFor(op.operationId), ctx.role)
          ? { skip: 'no throwaway trip: delivery.trips.create did not run' }
          : {}
      // Handed over exactly what the cockpit expects: opening 0 + the one-rupee collection − the
      // one-rupee expense. Nothing sits on the smoke vehicle, so no lot is counted.
      const expected = await fx.liveScalar(
        `select t.opening_cash_paise
              + coalesce((select sum(c.amount_paise) from collections c where c.trip_id=t.id and c.mode='cash'), 0)
              - coalesce((select sum(e.amount_paise) from trip_expenses e where e.trip_id=t.id), 0)
           from trips t where t.tenant_id=$1 and t.id=$2`,
        [fx.tenantId, chain.tripId],
      )
      return {
        pathParams: { id: chain.tripId },
        body: {
          idempotencyKey: 'sealed below',
          id: stableUuid(`${RUN_NONCE}:${target.name}:settlement`),
          tripId: chain.tripId,
          handedOverCashPaise: Math.max(0, Number(expected ?? 0)),
          counted: [],
          note: 'pnpm smoke: the throwaway trip, settled to the paisa',
        },
      }
    }

    // --- staff: never point a status/password change at the account this run is signed in as -----
    case 'tenancy.staff.setStatus':
    case 'tenancy.staff.setPassword': {
      const userId = await fx.staffOtherThan(target.username)
      if (!userId) return { skip: 'no staff member other than the signed-in user' }
      return { pinned: { userId } }
    }

    // --- integrations: a cancelled import is terminal and the idempotent seed never recreates one, so
    // pointing this at the demo's staged party master (the published example) would take the owner
    // app's review screen away for good on the first `--destructive` run — and every later lane's
    // `imports.create` would then have no seeded file to re-stage and land `failed`. The run stages a
    // throwaway import of its own from the same file and profile and abandons THAT one instead.
    case 'integrations.imports.cancel': {
      if (!isAllowed(permissionFor(op.operationId), ctx.role)) return {}
      const created = chain.importCreateBody
      if (!created) return { skip: 'no throwaway import: integrations.imports.create did not run' }
      const id = stableUuid(`${RUN_NONCE}:${target.name}:import-to-cancel`)
      const staged = await ctx.post('/integrations/imports', {
        idempotencyKey: `smoke:${target.name}:import-to-cancel:${RUN_NONCE}`,
        id,
        source: created.source,
        target: created.target,
        sourceObjectKey: created.sourceObjectKey,
        fileName: 'pnpm-smoke-import-to-cancel.csv',
        ...(created.profileId !== undefined ? { profileId: created.profileId } : {}),
      })
      if (staged.status !== 200)
        return {
          skip: `could not stage an import to cancel: integrations.imports.create → HTTP ${String(staged.status)} ${messageOf(staged.body)}`,
        }
      return {
        pathParams: { id },
        pinned: { id, reason: 'pnpm smoke: a file that was never right' },
      }
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

interface CallResult {
  status: number | null
  body: unknown
  ms: number
  transport?: string
}

async function callJson(url: string, init: RequestInit): Promise<CallResult> {
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
  /** The tenant of the session; for a console session, the pilot's, so bodies can name a real one. */
  tenantId: string
  role: PermissionRole
}

/**
 * `platformTenantId` is the tenant the CONSOLE's examples act on. A console session has no tenant of
 * its own — that is the whole point of `platform_admin` — but the harness still needs one id to fill
 * a `{tenantId}` body field with, and it is the pilot's, the same one every published example names.
 */
let platformTenantId: string | null = null

async function login(username: string, platform = false): Promise<LoginResult> {
  // Module 13 signs in at its OWN endpoint: a console account is a member of no distributor, so
  // `/auth/login` correctly answers "use POST /auth/platform/login" and there is no tenant to return.
  const path = platform ? '/auth/platform/login' : '/auth/login'
  const res = await callJson(`${AUTH_URL}${path}`, {
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
    tenant?: { id: string }
    role: PermissionRole
  }
  return {
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    tenantId: body.tenant?.id ?? platformTenantId ?? '',
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
  const base = baseUrlFor(target.name, target.port)
  const session = await login(target.username, target.role === 'platform_admin')
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
  const scopeSalespersonId =
    session.role === 'salesperson' ? await fx.userIdOf(target.username) : null
  const chain: RunChain = {
    refreshToken: null,
    platformRefreshToken: null,
    sessionId: null,
    tenantId: session.tenantId,
    orderId: null,
    receiptId: null,
    tripId: null,
    tripDayOffset: null,
    stopWithBill: null,
    deliveryId: null,
    importCreateBody: null,
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
      scopeSalespersonId,
      urlSeed: op.path,
      pinned: {},
      post: (path, body) =>
        callJson(`${base}${path}`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify(body),
        }),
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
    if (op.operationId === 'auth.platformLogin' || op.operationId === 'auth.platformRefresh') {
      const b = res.body as { refreshToken?: string } | null
      if (b?.refreshToken) chain.platformRefreshToken = b.refreshToken
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
    if (op.operationId === 'delivery.trips.create') {
      const b = res.body as { item?: { id?: string } } | null
      if (b?.item?.id) chain.tripId = b.item.id
    }
    if (op.operationId === 'delivery.deliveries.record') {
      const b = res.body as { item?: { id?: string } } | null
      if (b?.item?.id) chain.deliveryId = b.item.id
    }
    if (op.operationId === 'integrations.imports.create' && body && typeof body === 'object') {
      chain.importCreateBody = body as Record<string, unknown>
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

/**
 * A service whose role cannot finish the day leaves its throwaway trip open: the godown plans and
 * departs but never returns (not DOORSTEP), the crew returns but never settles (not the money desk).
 * Left alone those trips pile up as `active` / `closing` rows dated weeks ahead and crowd the trip
 * board and the docs. So the run ends the way a day does: the owner returns whatever is still out on
 * the smoke vehicle and settles whatever is closing, to the paisa (nothing sits on that van, so no lot
 * is counted); a plan that never left is cancelled. Nothing outside the smoke vehicle is touched.
 */
async function sweepSmokeTrips(owner: LoginResult, fx: Fixtures): Promise<void> {
  const open = await fx.rows(
    `select t.id, t.state::text as state, t.opening_cash_paise,
            coalesce((select sum(c.amount_paise) from collections c where c.trip_id = t.id and c.mode = 'cash'), 0) as cash,
            coalesce((select sum(e.amount_paise) from trip_expenses e where e.trip_id = t.id), 0) as spent
       from trips t join vehicles v on v.id = t.vehicle_id
      where t.tenant_id = $1 and (v.id = $2 or v.reg_no like 'MH-05-SM-%')
        and t.state::text in ('planned', 'loading', 'active', 'closing')
      order by t.id`,
    [fx.tenantId, SMOKE_VEHICLE_ID],
  )
  if (open.length === 0) return
  const headers = {
    authorization: `Bearer ${owner.accessToken}`,
    'content-type': 'application/json',
  }
  const base = baseUrlFor('owner', SERVICES.find((s) => s.name === 'owner')?.port ?? 3001)
  const post = (path: string, body: Record<string, unknown>) =>
    callJson(`${base}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ idempotencyKey: `smoke:sweep:${RUN_NONCE}:${path}`, ...body }),
    })
  let swept = 0
  for (const trip of open) {
    const id = trip.id as string
    let state = trip.state as string
    if (state === 'planned' || state === 'loading') {
      const res = await post(`/delivery/trips/${id}/cancel`, { id, reason: 'pnpm smoke: sweep' })
      if (res.status === 200) swept += 1
      continue
    }
    if (state === 'active') {
      const res = await post(`/delivery/trips/${id}/return`, { id })
      if (res.status !== 200) continue
      state = 'closing'
    }
    if (state === 'closing') {
      const expected = Number(trip.opening_cash_paise) + Number(trip.cash) - Number(trip.spent)
      const res = await post(`/delivery/trips/${id}/settle`, {
        id: stableUuid(`${RUN_NONCE}:sweep:settlement:${id}`),
        tripId: id,
        handedOverCashPaise: Math.max(0, expected),
        counted: [],
        acceptVariance: true,
        note: 'pnpm smoke: sweep of a throwaway trip left open by a role that cannot settle',
      })
      if (res.status === 200) swept += 1
    }
  }
  out()
  out(
    `   sweep: ${String(swept)} of ${String(open.length)} throwaway trip(s) on the smoke vehicle closed by the owner`,
  )
}

/**
 * THE LAST THING THE HARNESS DOES: prove the demo distributorship still signs in.
 *
 * `--destructive` presses switches that can lock the whole rig — `admin.tenants.suspend` answers 423
 * to every sign-in of a distributorship until somebody reactivates it — and the undo answering 200 is
 * NOT proof the undo ran (an idempotency replay answers 200 too, from a reply it stored on an earlier
 * run). On 2026-09-06 that combination left every demo login refused with a fully green smoke log.
 * So the run ends by actually signing in again: the one check that cannot be satisfied by a
 * remembered answer. If it fails the run fails, and `pnpm db:seed` puts the demo back.
 */
async function demoSignInStillWorks(): Promise<string | null> {
  try {
    await login('sunil.tarsun')
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
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
  platformTenantId = owner.tenantId
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

  await sweepSmokeTrips(owner, fx)
  await fx.close()

  const demoLocked = await demoSignInStillWorks()
  if (demoLocked) {
    failures.push(
      `the demo distributorship no longer signs in after this run (${demoLocked}) — run \`pnpm db:seed\` to put it back`,
    )
  }

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
    for (const f of failures) console.error(`FAILED: ${f}`)
  }
  process.exit(counts.BROKEN > 0 || failures.length > 0 ? 1 : 0)
}

await main()
