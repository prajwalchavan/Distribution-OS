import { Inject, Injectable, Optional } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'
import { ORPCError } from '@orpc/server'
import type { z } from 'zod'
import {
  SYNC_PROTOCOL_VERSION,
  type SyncOp,
  type SyncUploadInput,
  type SyncUploadOutput,
} from '@dos/contracts'
import { MAX_CLOCK_SKEW_MS, uuidv7 } from '@dos/domain'
import { syncErrors, syncOps, withTenant, type Db } from '@dos/db'
import { currentTenant, DB, requireDb } from '../../platform/index.js'
import { SyncRegistry, SyncRejection } from './sync.registry.js'

type In = z.infer<typeof SyncUploadInput>
type Out = z.infer<typeof SyncUploadOutput>
type Rejection = Out['rejected'][number]

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
}

function reject(op: SyncOp, code: string, messageEn: string, messageHi: string): Rejection {
  return { opId: op.opId, table: op.table, rowId: op.id, code, messageEn, messageHi }
}
