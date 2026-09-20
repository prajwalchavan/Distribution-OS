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
import { orderMachine } from '@dos/domain'
import { approvals, salesOrders, withTenant, type Db } from '@dos/db'
import {
  BACK_OFFICE,
  MANAGEMENT,
  currentTenant,
  DB,
  idempotent,
  requireDb,
  requireRole,
  writeAudit,
} from '../../platform/index.js'
import { istMoment, personWord } from '../../platform/refusal-words.js'
import { BargainsService } from '../pricing/index.js'
import { retailerRefs } from '../retailers/index.js'
import { userLabels } from '../tenancy/index.js'
import { toApproval, toApprovalQueueItem, type ApprovalRow } from './orders.mappers.js'
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
 * see one clear outcome rather than an order stuck between states. A bargain gate names the request it waits on
 * (`entity_type = 'bargain_request'`), and its decision decides that request in the same transaction (DOS-005).
 */
@Injectable()
export class ApprovalsService {
  constructor(
    @Optional() @Inject(DB) private readonly db: Db | null,
    private readonly orders: OrdersService,
    private readonly bargains: BargainsService,
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
      // The approval's own order (this module's table) carries its number, total and shop, so the queue names what
      // is being decided whatever the payload holds; the shop's name comes from the retailers module's batch
      // lookup, one query for the page (DOS-004).
      const rows = await tx
        .select({
          approval: approvals,
          orderNo: salesOrders.orderNo,
          orderTotalPaise: salesOrders.totalPaise,
          retailerId: salesOrders.retailerId,
        })
        .from(approvals)
        .leftJoin(
          salesOrders,
          and(eq(salesOrders.tenantId, approvals.tenantId), eq(salesOrders.id, approvals.orderId)),
        )
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(desc(approvals.id))
        .limit(input.limit + 1)
      const page = rows.slice(0, input.limit)
      const shops = await retailerRefs(
        tx,
        page.flatMap((r) => (r.retailerId === null ? [] : [r.retailerId])),
      )
      const items = page.map((r) =>
        toApprovalQueueItem(r.approval, {
          orderNo: r.orderNo,
          orderTotalPaise: r.orderTotalPaise,
          retailerId: r.retailerId,
          retailerName: r.retailerId === null ? null : (shops.get(r.retailerId)?.name ?? null),
        }),
      )
      const last = items[items.length - 1]
      return { items, nextCursor: rows.length > input.limit && last ? last.id : null }
    })
  }

  /** Owner and manager decide; the accountant reads the queue and decides nothing (docs/22 2026-09-05). */
  async decide(input: DecideIn): Promise<DecideOut> {
    requireRole(MANAGEMENT)
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
          throw new ORPCError('CONFLICT', { message: await this.decidedWords(tx, approval) })
        const now = new Date()

        // The order this gate waits on may already be terminal — the shop cancelled it, or another gate on the
        // same order was rejected first — before this decision lands (DOS-127). `cancelInTx`/`confirmInTx` would
        // answer 409 for a move `orderMachine` no longer allows; a stale gate would then be undecidable forever.
        // Expire it instead, exactly as the order's own cancel would have, and leave the order as it is.
        const order = approval.orderId ? await this.orders.lockOrder(tx, approval.orderId) : null
        if (order && orderMachine.isTerminal(order.state)) {
          const [expired] = await tx
            .update(approvals)
            .set({
              status: 'expired',
              decisionNote: input.note ?? null,
              decidedAt: now,
              updatedAt: now,
            })
            .where(eq(approvals.id, approval.id))
            .returning()
          return {
            item: toApproval(expired ?? approval),
            order: await this.orders.detail(tx, order),
          }
        }

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
        // A credit release or a below-floor sale is exactly the kind of decision an owner later needs to trace
        // to a name (DOS-028); `decided?.status` is the real outcome, `approval.status` only if the row somehow
        // came back empty.
        await writeAudit(tx, {
          action: 'approval.decide',
          entityType: 'approval',
          entityId: approval.id,
          before: { status: 'pending', kind: approval.kind },
          after: { status: decided?.status ?? approval.status, decision: input.decision },
          deviceId: input.deviceId ?? null,
        })
        // The same answer decides the request a bargain gate names, so its Rate requests copy closes with it and
        // the rep and the shop read the outcome (DOS-005). Approve takes the asked rate; a request already
        // decided elsewhere keeps its outcome; a missing one is a 404 that rolls this decision back.
        if (approval.kind === 'bargain' && approval.entityType === 'bargain_request')
          await this.bargains.decideInTx(
            tx,
            ctx,
            {
              id: approval.entityId,
              decision: input.decision,
              ...(input.note ? { note: input.note } : {}),
            },
            { ifStillRequested: true },
          )
        const item = toApproval(decided ?? approval)
        if (!approval.orderId || !order) return { item, order: null }

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

  /**
   * WHAT A SECOND DESK IS TOLD when the gate in front of it has already been decided (DOS-141).
   *
   * Two managers open the queue, both press Approve, and the second one used to read "approval
   * 01a09766-114f-73f5-b1fc-9d9cab81e82e was already approved" — a row id, no order, no name, no time,
   * nothing to say to the rep waiting on the phone. This sentence names the gate, the order it holds,
   * who decided it and when, in IST.
   */
  private async decidedWords(tx: Db, approval: ApprovalRow): Promise<string> {
    const gate = approval.kind.replace(/_/g, ' ')
    const [order] = approval.orderId
      ? await tx
          .select({ orderNo: salesOrders.orderNo })
          .from(salesOrders)
          .where(eq(salesOrders.id, approval.orderId))
          .limit(1)
      : []
    const on = order?.orderNo ? ` on ${order.orderNo}` : ''
    if (approval.decidedBy === null || approval.decidedAt === null)
      return `the ${gate} gate${on} was already ${approval.status}`
    const names = await userLabels(tx, [approval.decidedBy])
    const by = personWord(names.get(approval.decidedBy))
    return `the ${gate} gate${on} was already ${approval.status} by ${by} on ${istMoment(approval.decidedAt)}`
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
