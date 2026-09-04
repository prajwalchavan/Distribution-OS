import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { ORPCError } from '@orpc/server'
import { idempotencyKeys, type Db } from '@dos/db'
import { currentTenant } from './tenant-context.js'

/**
 * Online idempotency (ADR 0007 / D16). Call inside `withTenant`: the key row is inserted first, so a concurrent
 * retry blocks on the primary key until the first attempt commits, then sees the stored response.
 *  - same key + same request hash  → stored response, no side effects
 *  - same key + different hash     → 409 (client bug)
 * Rows are pruned after 24 h by the worker; offline sync uses sync_ops instead (durable).
 */
export async function idempotent<T>(
  tx: Db,
  key: string,
  request: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  const { tenantId } = currentTenant()
  const requestHash = createHash('sha256').update(JSON.stringify(request)).digest('hex')
  const inserted = await tx
    .insert(idempotencyKeys)
    .values({ tenantId, key, requestHash })
    .onConflictDoNothing()
    .returning({ key: idempotencyKeys.key })
  if (inserted.length === 0) {
    const [existing] = await tx
      .select({ requestHash: idempotencyKeys.requestHash, response: idempotencyKeys.response })
      .from(idempotencyKeys)
      .where(sql`${idempotencyKeys.tenantId} = ${tenantId} AND ${idempotencyKeys.key} = ${key}`)
    if (!existing)
      throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'idempotency row vanished' })
    if (existing.requestHash !== requestHash) {
      throw new ORPCError('CONFLICT', {
        message: 'idempotencyKey was already used with a different request',
      })
    }
    return existing.response as T
  }
  const result = await fn()
  await tx
    .update(idempotencyKeys)
    .set({ response: result })
    .where(sql`${idempotencyKeys.tenantId} = ${tenantId} AND ${idempotencyKeys.key} = ${key}`)
  return result
}
