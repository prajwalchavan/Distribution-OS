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
  return runIdempotent(tx, currentTenant().tenantId, key, request, false, fn)
}

/**
 * The same guarantee for the PLATFORM CONSOLE (module 13), whose session has no tenant of its own.
 * `admin.subscriptions.upsert`, `admin.support.request` and `admin.tenants.suspend` each name the
 * distributor they act on in their input, and that is the tenant the key is filed under — so two
 * consoles retrying the same onboarding collide on the primary key exactly as two salespeople
 * retrying the same order do.
 *
 * It is a separate function, not an optional argument, for two reasons. "Which tenant is this key
 * for" must be a deliberate answer: reading it from the ambient context is right for every
 * tenant-scoped handler and impossible for a console one. And the row is marked `platform_scoped`,
 * which is what keeps the STORED REPLY out of the distributor's own reach — `response` holds what the
 * console was told, and what the console is told about a subscription is our price to them, which
 * their owner is deliberately not shown.
 */
export async function platformIdempotent<T>(
  tx: Db,
  tenantId: string,
  key: string,
  request: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  return runIdempotent(tx, tenantId, key, request, true, fn)
}

async function runIdempotent<T>(
  tx: Db,
  tenantId: string,
  key: string,
  request: unknown,
  platformScoped: boolean,
  fn: () => Promise<T>,
): Promise<T> {
  const requestHash = createHash('sha256').update(JSON.stringify(request)).digest('hex')
  const inserted = await tx
    .insert(idempotencyKeys)
    .values({ tenantId, key, requestHash, platformScoped })
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
