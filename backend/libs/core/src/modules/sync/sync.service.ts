import { Inject, Injectable, Optional } from '@nestjs/common'
import { and, desc, eq, gte, isNull, lt, type SQL } from 'drizzle-orm'
import { ORPCError } from '@orpc/server'
import type { z } from 'zod'
import {
  SYNC_PROTOCOL_VERSION,
  type SyncErrorsListInput,
  type SyncErrorsListOutput,
  type SyncOp,
  type SyncPullInput,
  type SyncPullOutput,
  type SyncUploadInput,
  type SyncUploadOutput,
} from '@dos/contracts'
import { MAX_CLOCK_SKEW_MS, uuidv7 } from '@dos/domain'
import { syncErrors, syncOps, withTenant, type ActorRole, type Db } from '@dos/db'
import { currentTenant, DB, requireDb, requireRole, STAFF } from '../../platform/index.js'
import { SyncRegistry, SyncRejection } from './sync.registry.js'

type In = z.infer<typeof SyncUploadInput>
type Out = z.infer<typeof SyncUploadOutput>
type Rejection = Out['rejected'][number]
type ErrorsIn = z.infer<typeof SyncErrorsListInput>
type ErrorsOut = z.infer<typeof SyncErrorsListOutput>
type PullIn = z.infer<typeof SyncPullInput>
type PullOut = z.infer<typeof SyncPullOutput>

/** The desk reads everyone's rejections for support triage; a field role reads its own. */
const TRIAGE: readonly ActorRole[] = ['owner', 'manager', 'accountant', 'system']

/**
 * A pull cursor is good to `asOf - PULL_OVERLAP_MS`: a row committed just before the cursor by a
 * transaction that started earlier is still caught by the next pull, at the price of a few rows the
 * device sees twice (it upserts by id, so twice is harmless).
 */
const PULL_OVERLAP_MS = 5_000

@Injectable()
export class SyncService {
  constructor(
    @Optional() @Inject(DB) private readonly db: Db | null,
    private readonly registry: SyncRegistry,
  ) {}

  /**
   * Each op is its own transaction: one bad row must not block the rest of the batch. Outcomes are durable in
   * sync_ops (>= 180 days) so a device that retries after a lost response replays without side effects.
   */
  async upload(input: In): Promise<Out> {
    const db = requireDb(this.db)
    const ctx = currentTenant()
    const out: Out = {
      accepted: 0,
      replayed: 0,
      rejected: [],
      warnings: [],
      upgradeRequired: false,
    }
    if (input.protocol !== SYNC_PROTOCOL_VERSION) {
      // Old app build: answer 2xx so the device queue is not wedged, but reject everything and ask for an upgrade.
      out.upgradeRequired = true
      for (const op of input.ops)
        out.rejected.push(
          reject(op, 'protocol_unsupported', 'App update required', 'ऐप अपडेट ज़रूरी है'),
        )
      return out
    }
    const now = Date.now()
    for (const op of input.ops) {
      if (op.clientTime) {
        const skew = Math.abs(now - Date.parse(op.clientTime))
        if (Number.isFinite(skew) && skew > MAX_CLOCK_SKEW_MS)
          out.warnings.push({
            opId: op.opId,
            code: 'clock_skew',
            messageEn: `device clock is off by ${Math.round(skew / 60_000)} min`,
          })
      }
      const result = await withTenant(db, ctx, async (tx) => {
        const [prior] = await tx
          .select({ outcome: syncOps.outcome })
          .from(syncOps)
          .where(
            and(
              eq(syncOps.tenantId, ctx.tenantId),
              eq(syncOps.deviceId, input.deviceId),
              eq(syncOps.opId, op.opId),
            ),
          )
        if (prior)
          return {
            replayed: true,
            outcome: prior.outcome as { ok: boolean; rejection?: Rejection },
          }
        const handler = this.registry.get(op.table)
        let outcome: { ok: boolean; rejection?: Rejection }
        if (!handler) {
          outcome = {
            ok: false,
            rejection: reject(
              op,
              'unknown_table',
              `No sync handler for ${op.table}`,
              `${op.table} के लिए सिंक समर्थित नहीं`,
            ),
          }
        } else {
          try {
            // Savepoint so a rejected op leaves no partial writes but the sync_ops/sync_errors rows still commit.
            await tx.transaction(async (inner) => handler(inner, op))
            outcome = { ok: true }
          } catch (error) {
            if (error instanceof SyncRejection) {
              outcome = {
                ok: false,
                rejection: reject(op, error.code, error.messageEn, error.messageHi),
              }
            } else if (error instanceof ORPCError && error.status >= 400 && error.status < 500) {
              outcome = {
                ok: false,
                rejection: reject(
                  op,
                  String(error.code).toLowerCase(),
                  error.message,
                  error.message,
                ),
              }
            } else {
              throw error // transient: let the request fail 5xx so the device retries the whole batch
            }
          }
        }
        if (outcome.rejection) {
          const r = outcome.rejection
          await tx.insert(syncErrors).values({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            userId: ctx.actorId,
            deviceId: input.deviceId,
            opId: op.opId,
            tableName: op.table,
            rowId: op.id,
            code: r.code,
            messageHi: r.messageHi,
            messageEn: r.messageEn,
          })
        }
        await tx
          .insert(syncOps)
          .values({ tenantId: ctx.tenantId, deviceId: input.deviceId, opId: op.opId, outcome })
          .onConflictDoNothing()
        return { replayed: false, outcome }
      })
      if (result.replayed) out.replayed += 1
      if (result.outcome.ok) out.accepted += 1
      else if (result.outcome.rejection) out.rejected.push(result.outcome.rejection)
    }
    return out
  }

  /**
   * The "Needs attention" tray after the upload response is gone (docs/23 §8.11). A field role always
   * reads its OWN rows — `user_id = actor` is forced here and RLS says the same — and the desk reads
   * everyone's for support triage. Newest first, cursor on the row id.
   */
  async listErrors(input: ErrorsIn): Promise<ErrorsOut> {
    requireRole(STAFF)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      const filters: (SQL | undefined)[] = [
        eq(syncErrors.tenantId, ctx.tenantId),
        TRIAGE.includes(ctx.actorRole) ? undefined : eq(syncErrors.userId, ctx.actorId),
        input.deviceId ? eq(syncErrors.deviceId, input.deviceId) : undefined,
        input.since ? gte(syncErrors.createdAt, new Date(input.since)) : undefined,
        input.unresolvedOnly ? isNull(syncErrors.resolvedAt) : undefined,
        input.cursor ? lt(syncErrors.id, input.cursor) : undefined,
      ]
      const rows = await tx
        .select()
        .from(syncErrors)
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(desc(syncErrors.id))
        .limit(input.limit + 1)
      const page = rows.slice(0, input.limit)
      const last = page[page.length - 1]
      return {
        items: page.map((r) => ({
          id: r.id,
          opId: r.opId,
          table: r.tableName,
          rowId: r.rowId,
          code: r.code,
          messageHi: r.messageHi,
          messageEn: r.messageEn,
          deviceId: r.deviceId,
          createdAt: r.createdAt.toISOString(),
          resolved: r.resolvedAt !== null,
          resolvedAt: r.resolvedAt?.toISOString() ?? null,
        })),
        nextCursor: rows.length > input.limit && last ? last.id : null,
      }
    })
  }

  /**
   * The delta download (docs/23 §8.11): every table registered for the actor's role (or the ones the
   * device names), rows changed since the cursor, `limit` rows in total. RLS narrows every table to
   * what the actor may hold — a rep never receives a cost column because no pulled table has one.
   * `cursor` is the server clock at the start of the read minus an overlap; the device sends it back
   * as `since`. `hasMore` means at least one table hit its share of the limit: pull again with the
   * SAME cursor until it is false, then keep the cursor for the next delta.
   */
  async pull(input: PullIn): Promise<PullOut> {
    requireRole(STAFF)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    const since = decodeCursor(input.since)
    const registered = this.registry.pullTables(ctx.actorRole)
    const tables = input.tables ? input.tables.filter((t) => registered.includes(t)) : registered
    const startedAt = new Date()
    const perTable = Math.max(1, Math.floor(input.limit / Math.max(1, tables.length)))
    return withTenant(db, ctx, async (tx) => {
      const changes: PullOut['changes'] = []
      let hasMore = false
      for (const table of tables) {
        const spec = this.registry.pull(table)
        if (!spec) continue
        const result = await spec.handler(tx, { ctx, since, limit: perTable + 1 })
        const rows = result.rows.slice(0, perTable)
        if (result.rows.length > perTable) hasMore = true
        if (rows.length > 0 || result.deleted.length > 0 || since === null)
          changes.push({ table, rows, deleted: result.deleted })
      }
      // When a table still has more, the cursor stays where it was so the next pull continues from
      // the same point; only a complete pull advances it.
      const asOf = new Date(startedAt.getTime() - PULL_OVERLAP_MS)
      const cursor = hasMore ? (input.since ?? encodeCursor(new Date(0))) : encodeCursor(asOf)
      return { changes, cursor, hasMore, asOf: startedAt.toISOString() }
    })
  }
}

function reject(op: SyncOp, code: string, messageEn: string, messageHi: string): Rejection {
  return { opId: op.opId, table: op.table, rowId: op.id, code, messageEn, messageHi }
}

function encodeCursor(at: Date): string {
  return Buffer.from(JSON.stringify({ v: 1, t: at.toISOString() })).toString('base64url')
}

function decodeCursor(cursor: string | undefined): Date | null {
  if (!cursor) return null
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { t?: string }
    const at = parsed.t ? new Date(parsed.t) : null
    if (!at || Number.isNaN(at.getTime())) throw new Error('bad cursor')
    return at
  } catch {
    throw new ORPCError('BAD_REQUEST', { message: 'since is not a cursor this server issued' })
  }
}
