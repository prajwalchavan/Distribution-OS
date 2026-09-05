import { Injectable } from '@nestjs/common'
import { getTableColumns, getTableName, sql, type SQL, type Table } from 'drizzle-orm'
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
  limit: number
}

export interface PullResult {
  /** Rows in the device schema (snake_case columns, as the table has them). */
  rows: Record<string, unknown>[]
  /** Ids of rows deleted or moved out of the actor's read set since the cursor. */
  deleted: string[]
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
   * upload handler is registered for it, which is the same map the uploader itself consults. Prices,
   * schemes and the catalog have no handler and are therefore download-only, as docs/07 §7.3 says.
   */
  manifest(role: ActorRole): SyncTableManifest[] {
    return this.pullTables(role).map((table) => {
      const spec = this.pulls.get(table)
      return {
        table,
        primaryKey: [...(spec?.primaryKey ?? deviceKey(table))],
        columns: [...(spec?.describe?.(role) ?? [])],
        writable: this.handlers.has(table),
      }
    })
  }
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
 * The generic pull spec a module hands its OWN table to: `select * from <table> where tenant_id =
 * $tenant and updated_at > $since [and <extra>] order by updated_at, id limit $limit`, columns
 * `omit`ted stripped from every row (a scheme's funding source, for one). RLS still decides which
 * rows exist for the caller; the module decides the extra predicate (a rep's own-beat shops).
 *
 * It returns the whole `PullSpec`, not just the reader, so `sync.manifest` describes the table from
 * the SAME object the rows come out of and with the SAME `omit`: one call site, one truth, and a
 * column added by a migration appears in both halves or in neither. Spread it to add `roles`.
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
  const omittedFor = (role: ActorRole): ReadonlySet<string> =>
    new Set(typeof options.omit === 'function' ? options.omit(role) : (options.omit ?? []))
  return {
    handler: async (tx, request) => {
      const extra = options.extra?.(request)
      const result = await tx.execute(sql`
      select * from ${sql.identifier(name)}
       where tenant_id = ${request.ctx.tenantId}
         ${request.since ? sql`and updated_at > ${request.since}` : sql``}
         ${extra ? sql`and (${extra})` : sql``}
       order by updated_at asc, id asc
       limit ${request.limit}`)
      const omit = omittedFor(request.ctx.actorRole)
      const rows = result.rows.map((row) => {
        if (omit.size === 0) return row
        const out: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(row)) if (!omit.has(k)) out[k] = v
        return out
      })
      return { rows, deleted: [] }
    },
    describe: (role) => describeColumns(table, omittedFor(role)),
  }
}
