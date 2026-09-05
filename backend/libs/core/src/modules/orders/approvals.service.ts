import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, desc, eq, lt, ne, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  ApprovalsListInput,
  ApprovalsListOutput,
  DecideApprovalInput,
  DecideApprovalOutput,
} from '@dos/contracts'
import { approvals, withTenant, type Db } from '@dos/db'
import {
  BACK_OFFICE,
  currentTenant,
  DB,
  idempotent,
  requireDb,
  requireRole,
} from '../../platform/index.js'
import { toApproval, type ApprovalRow } from './orders.mappers.js'
import { OrdersService } from './orders.service.js'

type ListIn = z.infer<typeof ApprovalsListInput>
type ListOut = z.infer<typeof ApprovalsListOutput>
type DecideIn = z.infer<typeof DecideApprovalInput>
type DecideOut = z.infer<typeof DecideApprovalOutput>

/** Reason recorded on an order cancelled because the owner turned its approval down. */
export const APPROVAL_REJECTED = 'approval_rejected'

/**
 * The owner's approvals queue (docs/06): credit, bargain and below-floor gates raised at submit. Approving the
 * last one confirms the order (which reserves stock); rejecting any of them cancels it, because the rep must
 * see one clear outcome rather than an order stuck between states.
 */
@Injectable()
export class ApprovalsService {
  constructor(
    @Optional() @Inject(DB) private readonly db: Db | null,
    private readonly orders: OrdersService,
  ) {}

  async list(input: ListIn): Promise<ListOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const filters: (SQL | undefined)[] = [
        input.status ? eq(approvals.status, input.status) : undefined,
        input.orderId ? eq(approvals.orderId, input.orderId) : undefined,
        input.kind ? eq(approvals.kind, input.kind) : undefined,
        input.cursor ? lt(approvals.id, input.cursor) : undefined,
      ]
      const rows = await tx
        .select()
        .from(approvals)
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(desc(approvals.id))
        .limit(input.limit + 1)
      const items = rows.slice(0, input.limit).map(toApproval)
      const last = items[items.length - 1]
      return { items, nextCursor: rows.length > input.limit && last ? last.id : null }
    })
  }

  async decide(input: DecideIn): Promise<DecideOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const [approval] = await tx
          .select()
          .from(approvals)
          .where(eq(approvals.id, input.id))
          .for('update')
        if (!approval)
          throw new ORPCError('NOT_FOUND', { message: `approval ${input.id} not found` })
        if (approval.status !== 'pending')
          throw new ORPCError('CONFLICT', {
            message: `approval ${approval.id} was already ${approval.status}`,
          })
        const now = new Date()
        const [decided] = await tx
          .update(approvals)
          .set({
            status: input.decision === 'approve' ? 'approved' : 'rejected',
            decidedBy: ctx.actorId,
            decidedAt: now,
            decisionNote: input.note ?? null,
            updatedAt: now,
          })
          .where(eq(approvals.id, approval.id))
          .returning()
        const item = toApproval(decided ?? approval)
        if (!approval.orderId) return { item, order: null }

        const order = await this.orders.lockOrder(tx, approval.orderId)
        if (input.decision === 'reject') {
          const cancelled = await this.orders.cancelInTx(
            tx,
            order,
            APPROVAL_REJECTED,
            input.deviceId ?? null,
          )
          return { item, order: cancelled }
        }
        if (await this.stillPending(tx, approval.orderId, approval.id))
          return { item, order: await this.orders.detail(tx, order) }
        const confirmed = await this.orders.confirmInTx(tx, order, input.deviceId ?? null)
        return { item, order: confirmed.item }
      }),
    )
  }

  /** Any other gate on the same order still waiting; the order only confirms when they are all cleared. */
  private async stillPending(tx: Db, orderId: string, exceptId: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: approvals.id })
      .from(approvals)
      .where(
        and(
          eq(approvals.orderId, orderId),
          eq(approvals.status, 'pending'),
          ne(approvals.id, exceptId),
        ),
      )
      .limit(1)
    return row !== undefined
  }
}

export type { ApprovalRow }
