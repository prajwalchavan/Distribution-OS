import { Injectable } from '@nestjs/common'
import type { SyncOp } from '@dos/contracts'
import type { Db } from '@dos/db'

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

/**
 * Modules register a handler per synced table in their `onModuleInit` (e.g. orders registers `sales_orders`
 * and `sales_order_lines`). Unknown tables are rejected, never 4xx.
 */
@Injectable()
export class SyncRegistry {
  private readonly handlers = new Map<string, SyncHandler>()

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
}
