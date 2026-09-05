import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, eq } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  PushTokenRegisterInput,
  PushTokenRegisterOutput,
  PushTokenUnregisterInput,
  PushTokenUnregisterOutput,
} from '@dos/contracts'
import { pushTokens, withTenant, type Db } from '@dos/db'
import {
  currentTenant,
  DB,
  idempotent,
  isPrivilegeViolation,
  isUniqueViolation,
  requireDb,
  requireRole,
  STAFF,
} from '../../platform/index.js'
import { toPushToken } from './notifications.mappers.js'

type RegisterIn = z.infer<typeof PushTokenRegisterInput>
type RegisterOut = z.infer<typeof PushTokenRegisterOutput>
type UnregisterIn = z.infer<typeof PushTokenUnregisterInput>
type UnregisterOut = z.infer<typeof PushTokenUnregisterOutput>

/**
 * A staff phone's push token, one row per (tenant, user, device): a re-register from the same phone
 * refreshes the token in place. `userId` is ALWAYS the caller — the input has no such field and the
 * database (`push_tokens_own_*`, migration 0024) refuses any other user id, so nobody registers or
 * removes a device for a co-worker. The shop has no push (docs/06: WhatsApp / PWA first).
 */
@Injectable()
export class PushTokensService {
  constructor(@Optional() @Inject(DB) private readonly db: Db | null) {}

  async register(input: RegisterIn): Promise<RegisterOut> {
    requireRole(STAFF)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const own = and(
          eq(pushTokens.tenantId, ctx.tenantId),
          eq(pushTokens.userId, ctx.actorId),
          eq(pushTokens.deviceId, input.deviceId),
        )
        const at = new Date()
        const [existing] = await tx.select().from(pushTokens).where(own).limit(1)
        try {
          if (existing) {
            const [updated] = await tx
              .update(pushTokens)
              .set({ token: input.token, platform: input.platform, lastSeenAt: at, updatedAt: at })
              .where(eq(pushTokens.id, existing.id))
              .returning()
            if (!updated) throw new ORPCError('NOT_FOUND', { message: 'push token vanished' })
            return { item: toPushToken(updated), created: false }
          }
          const [inserted] = await tx
            .insert(pushTokens)
            .values({
              id: input.id,
              tenantId: ctx.tenantId,
              userId: ctx.actorId,
              deviceId: input.deviceId,
              token: input.token,
              platform: input.platform,
              lastSeenAt: at,
            })
            .returning()
          if (!inserted)
            throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'insert returned nothing' })
          return { item: toPushToken(inserted), created: true }
        } catch (error) {
          if (isUniqueViolation(error))
            throw new ORPCError('CONFLICT', {
              message: `push token ${input.id} already exists under another device or user`,
            })
          if (isPrivilegeViolation(error))
            throw new ORPCError('FORBIDDEN', { message: 'this role registers no push token' })
          throw error
        }
      }),
    )
  }

  /** Sign-out / uninstall: delete the caller's own row. Somebody else's token is NOT_FOUND; a row already gone is fine. */
  async unregister(input: UnregisterIn): Promise<UnregisterOut> {
    requireRole(STAFF)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const [row] = await tx
          .select({ id: pushTokens.id, userId: pushTokens.userId })
          .from(pushTokens)
          .where(and(eq(pushTokens.tenantId, ctx.tenantId), eq(pushTokens.id, input.id)))
          .limit(1)
        if (!row) return { ok: true as const }
        if (row.userId !== ctx.actorId)
          throw new ORPCError('NOT_FOUND', { message: `push token ${input.id} not found` })
        await tx.delete(pushTokens).where(eq(pushTokens.id, row.id))
        return { ok: true as const }
      }),
    )
  }
}
