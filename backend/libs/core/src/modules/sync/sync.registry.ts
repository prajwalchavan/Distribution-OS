import { Injectable } from '@nestjs/common'
import { getTableName, sql, type SQL, type Table } from 'drizzle-orm'
import type { SyncOp } from '@dos/contracts'
import type { ActorRole, Db, TenantContext } from '@dos/db'

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
}

/**
 * The generic pull reader a module hands its OWN table to: `select * from <table> where tenant_id =
 * $tenant and updated_at > $since [and <extra>] order by updated_at, id limit $limit`, columns
 * `omit`ted stripped from every row (a scheme's funding source, for one). RLS still decides which
 * rows exist for the caller; the module decides the extra predicate (a rep's own-beat shops).
 */
export function tablePull(
  table: Table,
  options: {
    extra?: (request: PullRequest) => SQL | undefined
    omit?: readonly string[]
  } = {},
): PullHandler {
  const name = getTableName(table)
  return async (tx, request) => {
    const extra = options.extra?.(request)
    const result = await tx.execute(sql`
      select * from ${sql.identifier(name)}
       where tenant_id = ${request.ctx.tenantId}
         ${request.since ? sql`and updated_at > ${request.since}` : sql``}
         ${extra ? sql`and (${extra})` : sql``}
       order by updated_at asc, id asc
       limit ${request.limit}`)
    const omit = new Set(options.omit ?? [])
    const rows = result.rows.map((row) => {
      if (omit.size === 0) return row
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(row)) if (!omit.has(k)) out[k] = v
      return out
    })
    return { rows, deleted: [] }
  }
}
