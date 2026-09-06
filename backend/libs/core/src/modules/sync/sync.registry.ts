import { Injectable } from '@nestjs/common'
import { getTableColumns, getTableName, sql, type SQL, type Table } from 'drizzle-orm'
import { PERMISSIONS } from '@dos/contracts'
import type { SyncColumn, SyncColumnType, SyncOp, SyncTableManifest } from '@dos/contracts'
import { SYNC_PULL_TABLES, type ActorRole, type Db, type TenantContext } from '@dos/db'

/** Thrown by a handler to reject an op for business reasons (2xx + sync_errors). Anything else is transient (5xx). */
export class SyncRejection extends Error {
  constructor(
    readonly code: string,
    readonly messageEn: string,
    readonly messageHi: string = messageEn,
  ) {
    super(messageEn)
    this.name = 'SyncRejection'
  }
}

/** Runs inside the caller's `withTenant` transaction; must be idempotent by (device, op_id) — the service guarantees replay. */
export type SyncHandler = (tx: Db, op: SyncOp) => Promise<void>

/** What `sync.pull` asks a table for: the rows changed since the cursor, bounded, as the caller (RLS applies). */
export interface PullRequest {
  ctx: TenantContext
  /** Rows with `updated_at` strictly after this instant; null = the full read set. */
  since: Date | null
  /**
   * The SAME instant as `since`, exactly as the cursor carried it: ISO-8601 with MICROseconds
   * (`2026-09-06T04:11:02.985432Z`), which is the resolution `clock_timestamp()` stamps rows with.
   * A JS `Date` truncates to milliseconds, and a truncated bound re-reads every row inside that
   * millisecond on every pull — the device then never gets past it. Predicates use this; `since` is
   * kept for handlers that only want to know whether this is a delta at all.
   */
  sinceText: string | null
  limit: number
}

export interface PullResult {
  /** Rows in the device schema (snake_case columns, as the table has them). */
  rows: Record<string, unknown>[]
  /**
   * Device keys of rows deleted, or moved out of THIS actor's read set, since the cursor — the
   * `sync_tombstones` row_id, which is the row's `id` everywhere except the two composite-key tables
   * (`stock_balances` is `lot_id:location_id`, `retailer_outstanding_summary` is `retailer_id`).
   */
  deleted: string[]
  /**
   * Set when this table has more to give than `limit` allowed — the service turns it into `hasMore`
   * and, with `watermark`, into a cursor that advances (a cursor that did not would hand the device
   * the same page for ever).
   */
  hasMore?: boolean
  /**
   * How far this table is COMPLETE, when `hasMore` is set: the `updated_at` (or `deleted_at`) of the
   * last row this page carried, in the same microsecond ISO form the cursor uses. The service takes
   * the earliest watermark across the saturated tables, because one shared cursor may only move to a
   * point every table has finished. `null` means "cannot say" and pins the cursor where it is.
   */
  watermark?: string | null
}

export type PullHandler = (tx: Db, request: PullRequest) => Promise<PullResult>

export interface PullSpec {
  handler: PullHandler
  /** Which roles hold this table on the device; omitted = every staff role. */
  roles?: readonly ActorRole[]
  /**
   * The device schema of this table for one role — what `sync.manifest` publishes so the phone can
   * CREATE TABLE before its first `pull`. Role-dependent because a pull spec may strip columns for
   * some roles (a scheme's funding source), and the contract is explicit that a column the actor does
   * not receive is absent from its manifest as well, so the device has nowhere to put it.
   *
   * `tablePull()` fills this in from the Drizzle table it reads, which is the only way the two stay
   * honest: the manifest is derived from the same table object the rows come out of, never from a
   * hand-kept list that drifts one migration later.
   */
  describe?: (role: ActorRole) => readonly SyncColumn[]
  /** What the device upserts on; defaults to `sync-tables.ts`'s key for the table, else `['id']`. */
  primaryKey?: readonly string[]
}

/**
 * Modules register a handler per synced table in their `onModuleInit` (e.g. orders registers `sales_orders`
 * and `sales_order_lines`). Unknown tables are rejected, never 4xx. The same registry carries the PULL
 * side of the protocol (docs/23 §8.11): the module that owns a table registers how its device rows are
 * read since a cursor, and `sync.pull` walks every registered table for the actor's role.
 */
@Injectable()
export class SyncRegistry {
  private readonly handlers = new Map<string, SyncHandler>()
  private readonly pulls = new Map<string, PullSpec>()

  register(table: string, handler: SyncHandler): void {
    if (this.handlers.has(table)) throw new Error(`sync handler for ${table} already registered`)
    this.handlers.set(table, handler)
  }

  get(table: string): SyncHandler | undefined {
    return this.handlers.get(table)
  }

  tables(): string[] {
    return [...this.handlers.keys()]
  }

  registerPull(table: string, spec: PullSpec): void {
    if (this.pulls.has(table)) throw new Error(`sync pull for ${table} already registered`)
    this.pulls.set(table, spec)
  }

  pull(table: string): PullSpec | undefined {
    return this.pulls.get(table)
  }

  pullTables(role: ActorRole): string[] {
    return [...this.pulls.entries()]
      .filter(([, spec]) => !spec.roles || spec.roles.includes(role))
      .map(([table]) => table)
  }

  /**
   * The device schema `sync.manifest` answers with: every table THIS server can actually serve a pull
   * for, in registration order. It is the registry and not `SYNC_PULL_TABLES` on purpose — that list
   * is what the DATABASE guarantees is pull-able (column, index, tombstone trigger), while this is
   * what a running service will really answer rows for. Publishing the database's list instead would
   * hand a phone tables it then creates locally and no `pull` ever fills.
   *
   * `writable` is not a flag anybody sets: a table may go back through `sync.upload` exactly when an
   * upload handler is registered for it — the same map the uploader itself consults — AND this role
   * may call `sync.upload` at all. Prices, schemes and the catalog have no handler and are therefore
   * download-only, as docs/07 §7.3 says.
   */
  manifest(role: ActorRole): SyncTableManifest[] {
    const uploads = mayUpload(role)
    return this.pullTables(role).map((table) => {
      const spec = this.pulls.get(table)
      return {
        table,
        primaryKey: [...(spec?.primaryKey ?? deviceKey(table))],
        columns: [...(spec?.describe?.(role) ?? [])],
        writable: uploads && this.handlers.has(table),
      }
    })
  }
}

/**
 * WRITABLE IS ALSO A QUESTION ABOUT THE CALLER, not only about the table. The shopkeeper is the case
 * that makes the second half necessary: `permissions.ts` keeps `sync.upload` and `sync.errors.list`
 * at STAFF while `manifest` and `pull` are ANY_MEMBER (docs/07 §0 — "a shop places an order online
 * through `orders.*` and never carries a device queue"), so a manifest that advertised `receipts`,
 * `sales_orders` and `sales_order_lines` as writable to a shop would have its app build a write queue
 * whose every flush comes back 403. A 4xx to the uploader is the one answer this protocol may never
 * give, because it wedges the queue for good (docs/07 §7.3 rule 5) — and on `receipts` it would also
 * be the app offering a shopkeeper a way to record a payment, which only the delivery crew does
 * (docs/17 §D4).
 *
 * It is read out of the permission matrix rather than written as a list of roles here, so the day the
 * founder lets a shop queue writes, both halves of the protocol move together.
 */
function mayUpload(role: ActorRole): boolean {
  const rule = PERMISSIONS['sync.upload']
  if (rule === 'public' || rule === 'authenticated') return true
  return (rule as readonly string[]).includes(role)
}

/** `sync-tables.ts` is where the device key of a table is decided (two are keyed by business key). */
function deviceKey(table: string): readonly string[] {
  return SYNC_PULL_TABLES.find((t) => t.table === table)?.key ?? ['id']
}

/**
 * A Drizzle column's JSON type as the contract names it — derived from the SCHEMA, never from a
 * Postgres catalogue lookup, so the manifest costs no query and cannot disagree with the rows the
 * same table object produces. `integer` is what the device stores as an integer (paise, pieces, basis
 * points, a case size); a timestamp and a uuid are `string`, which is what `tx.execute` hands back and
 * what JSON carries. A `jsonb` column is published as `object`: the schema knows it is jsonb and not
 * whether the value inside is an array, and `object` is the shape a device stores as text either way.
 */
function columnType(column: { dataType: string; columnType: string }): SyncColumnType {
  switch (column.dataType) {
    case 'boolean':
      return 'boolean'
    case 'array':
      return 'array'
    case 'json':
      return 'object'
    case 'bigint':
      return 'integer'
    case 'number':
      return INTEGER_COLUMN_TYPES.has(column.columnType) ? 'integer' : 'number'
    default:
      return 'string'
  }
}

/** Drizzle `columnType` values that are whole numbers in Postgres; everything else numeric is `number`. */
const INTEGER_COLUMN_TYPES = new Set([
  'PgInteger',
  'PgSmallInt',
  'PgBigInt53',
  'PgSerial',
  'PgSmallSerial',
  'PgBigSerial53',
])

/** The manifest columns of a Drizzle table, minus whatever the pull spec strips for this role. */
function describeColumns(table: Table, omitted: ReadonlySet<string>): SyncColumn[] {
  // `getTableColumns` is generic over the table, so its values arrive as `Column<any, …>`; the three
  // fields the manifest needs are read structurally rather than through that `any`.
  const columns: { name: string; notNull: boolean; dataType: string; columnType: string }[] =
    Object.values(getTableColumns(table))
  return columns
    .filter((column) => !omitted.has(column.name))
    .map((column) => ({
      name: column.name,
      type: columnType(column),
      nullable: !column.notNull,
    }))
}

/**
 * WHO HOLDS A TABLE. `sync-tables.ts` names the FIELD roles a table's rows belong on (the rep's beat,
 * the crew's road, the godown floor, the shop's own bills); the desk — owner, manager, accountant —
 * holds the tenant's whole read set on its own device, and `system` rides along for the worker. So the
 * roles of a pull spec are the database's list plus the desk, and a table the shop's list does not
 * name is a table `sync.pull` never offers a shopkeeper: RLS would narrow most of them to nothing
 * anyway, but `beats` and `price_lists` would not, and a shop is a customer of the distributorship,
 * not a member of it (never-list 9).
 */
export const DESK_DEVICE_ROLES: readonly ActorRole[] = ['owner', 'manager', 'accountant', 'system']

export function pullRolesFor(table: string): readonly ActorRole[] {
  const entry = SYNC_PULL_TABLES.find((t) => t.table === table)
  return entry ? [...DESK_DEVICE_ROLES, ...entry.roles] : DESK_DEVICE_ROLES
}

/**
 * The generic pull spec a module hands its OWN table to:
 *
 *   `select * from <table> where [tenant_id = $tenant and] updated_at > $since [and <extra>]
 *    order by updated_at, <key> limit $limit`
 *
 * with the `omit`ted columns stripped from every row (a scheme's funding source, for one). RLS still
 * decides which rows exist for the caller; the module decides the extra predicate (a rep's own-beat
 * shops). Three shapes of the read set are served by the same function, because all three are in it:
 *
 *  - **tenant tables**, keyed by `id` — the 31 ordinary ones;
 *  - **the two composite-key tables** — `stock_balances` (`lot_id`, `location_id`) and
 *    `retailer_outstanding_summary` (`retailer_id`) have no `id` column at all, so the sort key and
 *    the device key both come from `SYNC_PULL_TABLES[].key`;
 *  - **the four global curated tables** — `products`, `product_variants`, `manufacturers`, `brands`
 *    have no `tenant_id` column, so the tenant predicate is left out and their tombstones are filed
 *    under the sentinel `'*'`.
 *
 * It returns the whole `PullSpec`, not just the reader, so `sync.manifest` describes the table from
 * the SAME object the rows come out of and with the SAME `omit`: one call site, one truth, and a
 * column added by a migration appears in both halves or in neither. Spread it to override `roles`.
 */
export function tablePull(
  table: Table,
  options: {
    extra?: (request: PullRequest) => SQL | undefined
    /** Columns the device never receives; a function when that depends on who is asking. */
    omit?: readonly string[] | ((role: ActorRole) => readonly string[])
  } = {},
): PullSpec {
  const name = getTableName(table)
  const numbers = numericColumns(table)
  const entry = SYNC_PULL_TABLES.find((t) => t.table === name)
  const key = entry?.key ?? ['id']
  const global = entry?.scope === 'global'
  const omittedFor = (role: ActorRole): ReadonlySet<string> =>
    new Set(typeof options.omit === 'function' ? options.omit(role) : (options.omit ?? []))
  const order = sql.join(
    key.map((column) => sql`${sql.identifier(column)} asc`),
    sql`, `,
  )
  const keyExpr = keyExpression(key)
  return {
    roles: pullRolesFor(name),
    primaryKey: key,
    handler: async (tx, request) => {
      const extra = options.extra?.(request)
      const scope = global ? sql`true` : sql`tenant_id = ${request.ctx.tenantId}`
      const where = sql`${scope}
         ${request.sinceText ? sql`and updated_at > ${request.sinceText}::timestamptz` : sql``}
         ${extra ? sql`and (${extra})` : sql``}`
      // One row over the budget, so "there is more" is known without a second count. `__sync_at` is
      // the row's own `updated_at` to the MICROsecond, which is what the next cursor is made of.
      const page = (
        await tx.execute(sql`
      select *, ${INSTANT_TEXT(sql`updated_at`)} as __sync_at from ${sql.identifier(name)}
       where ${where}
       order by updated_at asc, ${order}
       limit ${request.limit + 1}`)
      ).rows
      const hasMore = page.length > request.limit
      const raw = page.slice(0, request.limit)
      let watermark = instantOf(raw[raw.length - 1])
      if (hasMore && watermark) {
        // TIES. The cursor is one instant, so the page may not stop in the MIDDLE of a group of rows
        // that share an `updated_at` — the next pull asks for `> that instant` and the rest of the
        // group would be skipped for ever. Migration 0038 backfilled the column with `now()`, which
        // is one value for a whole table, so this is a real shape and not a theoretical one. The
        // group is therefore finished off here, ordered by the same key, before the page closes.
        // Every device key in `SYNC_PULL_TABLES` is a text column; anything else cannot page.
        const lastValue = raw[raw.length - 1]?.[key[0] ?? 'id']
        const lastKey = typeof lastValue === 'string' ? lastValue : ''
        const rest = (
          await tx.execute(sql`
      select *, ${INSTANT_TEXT(sql`updated_at`)} as __sync_at from ${sql.identifier(name)}
       where ${where} and updated_at = ${watermark}::timestamptz and ${keyExpr} > ${lastKey}
       order by ${order}
       limit ${TIE_COMPLETION_LIMIT}`)
        ).rows
        raw.push(...rest)
        // Only if a single instant holds more rows than the cap can the cursor not pass it. Then it
        // stays put and the device asks again — visible, and never a silently dropped row.
        if (rest.length >= TIE_COMPLETION_LIMIT) watermark = null
      }
      const omit = omittedFor(request.ctx.actorRole)
      const rows = raw.map((row) => {
        const out: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(row))
          if (k !== '__sync_at' && !omit.has(k)) out[k] = numbers.has(k) ? asNumber(v) : v
        return out
      })
      const deleted = await readTombstones(tx, { table: name, key, global, request, extra })
      return {
        rows,
        deleted: deleted.ids,
        hasMore: hasMore || deleted.hasMore,
        // One cursor covers rows and tombstones, so it may only move to the earlier of the two.
        watermark: combineWatermarks(
          hasMore ? watermark : undefined,
          deleted.hasMore ? deleted.watermark : undefined,
        ),
      }
    },
    describe: (role) => describeColumns(table, omittedFor(role)),
  }
}

/**
 * MONEY MUST NOT ARRIVE AS A STRING. Paise are `bigint` in Postgres, and `tx.execute` hands a bigint
 * back as a STRING (node-postgres will not silently narrow a 64-bit integer), while `columnType()`
 * publishes that same column to the device as `integer`. Left alone, the manifest and the rows
 * disagree on every money column of every table: a phone told to create an INTEGER column receives
 * `"9300"`, its offline total concatenates instead of adding, and `'9300' > '10000'` is true.
 *
 * The set is derived from the SAME `columnType()` the manifest publishes, so what is narrowed here is
 * exactly what was promised there — never guessed from a value that merely looks numeric (a shop
 * code, a phone, a GSTIN, an HSN are all `string` in both halves, and a `numeric` column stays a
 * string on purpose, because that is the shape that does not lose a paisa).
 */
function numericColumns(table: Table): ReadonlySet<string> {
  const columns: { name: string; dataType: string; columnType: string }[] = Object.values(
    getTableColumns(table),
  )
  return new Set(
    columns.filter((c) => ['integer', 'number'].includes(columnType(c))).map((c) => c.name),
  )
}

/**
 * `Number.isSafeInteger` is the guard: paise up to 2^53 is ₹90,071,992,547,409, past any distributor
 * that will ever exist, and a value beyond it is passed through as the string it came as, so an
 * impossible number is visible rather than silently rounded.
 */
function asNumber(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const n = Number(value)
  return Number.isSafeInteger(n) ? n : value
}

/**
 * How many rows sharing one `updated_at` a single pull will finish off. Above it the cursor cannot
 * advance past that instant; only a bulk backfill stamping one value on thousands of rows of ONE
 * table can reach it (`clock_timestamp()` gives every trigger call its own microsecond).
 */
const TIE_COMPLETION_LIMIT = 2000

/**
 * A timestamp as the cursor carries it: ISO-8601 in UTC to the microsecond, which is both what
 * Postgres stores and a string JS can compare, sort and hand straight back as a bound. `to_char` is
 * used rather than `::text` because the session's time zone must not decide the shape of a cursor.
 */
const INSTANT_TEXT = (column: SQL): SQL =>
  sql`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`

function instantOf(row: Record<string, unknown> | undefined): string | null {
  const value = row?.__sync_at
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * How far this table is complete when it could not deliver everything: `undefined` = this half did
 * not run out of room and has nothing to say, `null` = it did and cannot say how far it got (the
 * cursor must not move), a date = complete to there. The earlier of the two wins, and a `null`
 * outranks any date.
 */
function combineWatermarks(
  a: string | null | undefined,
  b: string | null | undefined,
): string | null {
  if (a === undefined) return b ?? null
  if (b === undefined) return a
  if (a === null || b === null) return null
  // Fixed-width UTC ISO strings: lexicographic order IS chronological order.
  return a <= b ? a : b
}

/** The device key of a row as SQL: `id`, or the key parts joined by `:` for the two composite tables. */
function keyExpression(key: readonly string[]): SQL {
  if (key.length === 1) return sql`${sql.identifier(key[0] ?? 'id')}::text`
  return sql.join(
    key.map((column) => sql`${sql.identifier(column)}::text`),
    sql` || ':' || `,
  )
}

/**
 * WHAT THE DEVICE MUST FORGET. A row that is deleted has no `updated_at` left to find it by, and a row
 * that merely LEAVES this reader's scope (the shop moved to another rep's beat, the trip closed, the
 * link was cut) simply stops appearing — which is silent, and silence leaves it on the phone for ever.
 * So the database files both in `sync_tombstones` (migration 0040: `dos_sync_tombstone` on delete,
 * `dos_sync_soft_hide` on the four updates that hide a row), and the pull reads them back.
 *
 * Two subtleties decide the shape:
 *
 *  1. **A soft hide is per-reader, not per-tenant.** The shop that left rep A's beat joined rep B's,
 *     and both devices pull the same tombstone. So the ids are checked against the caller's CURRENT
 *     read set — same predicate, same RLS — and an id that is still visible here is dropped from
 *     `deleted`. (The device is told to apply `deleted` BEFORE `rows`, so a row that both moved and is
 *     still visible survives; that rule is in docs/07 §0.)
 *  2. **A full snapshot needs none of them.** With no cursor the device is building its tables from
 *     nothing; there is no row to delete. Tombstones are read only for a delta.
 */
async function readTombstones(
  tx: Db,
  input: {
    table: string
    key: readonly string[]
    global: boolean
    request: PullRequest
    extra: SQL | undefined
  },
): Promise<{ ids: string[]; hasMore: boolean; watermark: string | null }> {
  const { table, key, global, request, extra } = input
  if (!request.sinceText) return { ids: [], hasMore: false, watermark: null }
  const tenantScope = global ? sql`t.tenant_id = '*'` : sql`t.tenant_id = ${request.ctx.tenantId}`
  const page = (
    await tx.execute(sql`
      select t.row_id, ${INSTANT_TEXT(sql`t.deleted_at`)} as __sync_at from sync_tombstones t
       where ${tenantScope} and t.table_name = ${table}
         and t.deleted_at > ${request.sinceText}::timestamptz
       order by t.deleted_at asc, t.row_id asc
       limit ${request.limit + 1}`)
  ).rows as { row_id: string; __sync_at: string }[]
  if (page.length === 0) return { ids: [], hasMore: false, watermark: null }
  const hasMore = page.length > request.limit
  const rows = page.slice(0, request.limit)
  let watermark = instantOf(rows[rows.length - 1])
  if (hasMore && watermark) {
    // Same tie rule as the rows: a group of tombstones filed at one instant is never cut in half.
    const lastKey = String(rows[rows.length - 1]?.row_id ?? '')
    const rest = (
      await tx.execute(sql`
      select t.row_id, ${INSTANT_TEXT(sql`t.deleted_at`)} as __sync_at from sync_tombstones t
       where ${tenantScope} and t.table_name = ${table}
         and t.deleted_at = ${watermark}::timestamptz and t.row_id > ${lastKey}
       order by t.row_id asc
       limit ${TIE_COMPLETION_LIMIT}`)
    ).rows as { row_id: string; __sync_at: string }[]
    rows.push(...rest)
    if (rest.length >= TIE_COMPLETION_LIMIT) watermark = null
  }
  const candidates = rows.map((r) => r.row_id)
  // Still in this reader's scope? Then it moved, it did not go: the device keeps it.
  const scope = global ? sql`true` : sql`tenant_id = ${request.ctx.tenantId}`
  const keyExpr = keyExpression(key)
  const alive = (
    await tx.execute(sql`
      select ${keyExpr} as row_id from ${sql.identifier(table)}
       where ${scope} and ${keyExpr} in ${candidates}
         ${extra ? sql`and (${extra})` : sql``}`)
  ).rows as { row_id: string }[]
  const survivors = new Set(alive.map((r) => r.row_id))
  return { ids: candidates.filter((id) => !survivors.has(id)), hasMore, watermark }
}

/**
 * LAST WRITE WINS, WITH THE SERVER HOLDING THE VETO (docs/07 §0). A device op that EDITS a row carries
 * `baseUpdatedAt` — the `updated_at` its copy had when the user made the change, exactly as `pull`
 * delivered it. If the server's row has moved on since, the edit is refused: it comes back as a
 * `stale` rejection with a `sync_errors` row, still 2xx, and the device re-reads the row before
 * offering the edit again.
 *
 * It lives here, called once by `SyncService.upload` for every op of every table, rather than inside
 * each module's handler: a rule that has to be remembered per module is a rule that is eventually
 * forgotten in one of them, and the forgotten one is a silent overwrite of somebody's work.
 *
 * An INSERT carries no base and cannot be vetoed; neither can an insert-only table (a receipt, a
 * visit, a delivery), and neither can a row the caller cannot see — RLS returns no row, the handler
 * decides what that means. The table name is looked up in `SYNC_PULL_TABLES`, so the identifier
 * interpolated here is always one of the 37 the database published, never a string from a device.
 */
export async function vetoIfStale(
  tx: Db,
  op: { table: string; id: string; baseUpdatedAt?: string | undefined },
): Promise<void> {
  if (!op.baseUpdatedAt) return
  const entry = SYNC_PULL_TABLES.find((t) => t.table === op.table)
  if (!entry || entry.key.length !== 1 || entry.key[0] !== 'id') return
  const base = Date.parse(op.baseUpdatedAt)
  if (!Number.isFinite(base)) return
  const rows = (
    await tx.execute(sql`
      select updated_at from ${sql.identifier(op.table)} where id = ${op.id} limit 1`)
  ).rows as { updated_at: Date | string | null }[]
  const current = rows[0]?.updated_at
  if (!current) return
  const serverAt = current instanceof Date ? current.getTime() : Date.parse(String(current))
  if (!Number.isFinite(serverAt) || serverAt <= base) return
  throw new SyncRejection(
    'stale',
    `This ${op.table.replace(/_/g, ' ')} changed on the server after your copy; open it again`,
    'यह रिकॉर्ड सर्वर पर बदल चुका है; दोबारा खोलें',
  )
}
