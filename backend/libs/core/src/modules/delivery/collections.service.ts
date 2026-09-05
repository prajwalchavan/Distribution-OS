import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, desc, eq, lt, sql, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  Collection,
  CollectionsListInput,
  CollectionsListOutput,
  ExpensesListInput,
  ExpensesListOutput,
  RecordCollectionInput,
  RecordCollectionOutput,
  RecordExpenseInput,
  RecordExpenseOutput,
} from '@dos/contracts'
import { collections, tripExpenses, withTenant, type Db } from '@dos/db'
import { currentTenant, DB, idempotent, requireDb, requireRole } from '../../platform/index.js'
import { ReceivablesService, type RecordReceiptResult } from '../receivables/index.js'
import {
  acceptObjectKey,
  assertCrewOrDesk,
  dayWindow,
  defined,
  emitDeliveryEvent,
  findRetailer,
  lockStop,
  lockTrip,
  MONEY_COLLECTORS,
  storeInline,
  TRIP_ON_THE_ROAD,
  whenOr,
  type TripRow,
} from './delivery.internals.js'
import { mapCollections, toExpense } from './delivery.mappers.js'

type RecordIn = z.infer<typeof RecordCollectionInput>
type RecordOut = z.infer<typeof RecordCollectionOutput>
type ListIn = z.infer<typeof CollectionsListInput>
type ListOut = z.infer<typeof CollectionsListOutput>
type ExpenseIn = z.infer<typeof RecordExpenseInput>
type ExpenseOut = z.infer<typeof RecordExpenseOutput>
type ExpensesIn = z.infer<typeof ExpensesListInput>
type ExpensesOut = z.infer<typeof ExpensesListOutput>

/** What one doorstep collection needs from the caller, shared with the van sale. */
export interface DoorstepCollectionInput {
  id: string
  receiptId: string
  idempotencyKey: string
  retailerId: string
  stopId: string | null
  mode: RecordIn['mode']
  amountPaise: number
  reference?: string | undefined
  upiVpa?: string | undefined
  chequeDate?: string | undefined
  bankName?: string | undefined
  proofObjectKey?: string | undefined
  allocations?: { id: string; invoiceId: string; amountPaise: number }[] | undefined
  clientReceiptNo?: string | undefined
  collectedAt?: string | undefined
  note?: string | undefined
  deviceId?: string | undefined
}

/**
 * Money at the door — THE field money path (docs/17 §D4): the delivery crew, plus the desk at the
 * office; the salesperson is in no row of this module. `recordReceipt` writes the numbered receipt,
 * the allocations (oldest bill first unless the crew tagged bills), the realised cash discount and
 * ONE balanced journal entry — cash on a trip lands in CASH_VAN until the settlement hands it over,
 * UPI in UPI, a cheque in CHEQUES. This module only adds the `collections` row the settlement sums.
 *
 * Expenses are the other half of the van's cash story: recorded here with their proof, they hit the
 * books ONCE, at settlement, so the trip is one entry in the journal.
 */
@Injectable()
export class CollectionsService {
  constructor(
    @Optional() @Inject(DB) private readonly db: Db | null,
    private readonly receivables: ReceivablesService,
  ) {}

  async record(input: RecordIn): Promise<RecordOut> {
    requireRole(MONEY_COLLECTORS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const trip = await lockTrip(tx, input.tripId)
        assertCrewOrDesk(trip, MONEY_COLLECTORS)
        if (!TRIP_ON_THE_ROAD.has(trip.state))
          throw new ORPCError('CONFLICT', {
            message: `trip ${trip.tripNo ?? trip.id} is ${trip.state}; money is collected while the trip is out`,
          })
        return this.collectInTx(tx, trip, {
          ...input,
          stopId: input.stopId ?? null,
        })
      }),
    )
  }

  /** The transaction-scoped collection, shared with `vanSales.create`. */
  async collectInTx(
    tx: Db,
    trip: TripRow,
    input: DoorstepCollectionInput,
  ): Promise<RecordOut & { item: Collection }> {
    const ctx = currentTenant()
    await findRetailer(tx, input.retailerId)
    if (input.stopId) {
      const stop = await lockStop(tx, input.stopId)
      if (stop.tripId !== trip.id || stop.retailerId !== input.retailerId)
        throw new ORPCError('BAD_REQUEST', {
          message: `stop ${stop.id} is not this shop's stop on trip ${trip.id}`,
        })
    }
    const [existing] = await tx
      .select()
      .from(collections)
      .where(eq(collections.id, input.id))
      .limit(1)
    if (existing) {
      const receipt = await this.receivables.recordReceipt(tx, this.receiptInput(input, trip))
      return this.reply(tx, existing, receipt)
    }
    const receipt = await this.receivables.recordReceipt(tx, this.receiptInput(input, trip))
    const collectedAt = whenOr(input.collectedAt, new Date())
    const [row] = await tx
      .insert(collections)
      .values({
        id: input.id,
        tenantId: ctx.tenantId,
        tripId: trip.id,
        stopId: input.stopId,
        retailerId: input.retailerId,
        receiptId: receipt.item.id,
        mode: input.mode,
        amountPaise: input.amountPaise,
        collectedBy: ctx.actorRole === 'system' ? null : ctx.actorId,
        collectedAt,
      })
      .onConflictDoNothing()
      .returning()
    const collection =
      row ??
      (
        await tx
          .select()
          .from(collections)
          .where(eq(collections.receiptId, receipt.item.id))
          .limit(1)
      )[0]
    if (!collection)
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: 'collection insert returned nothing',
      })
    await emitDeliveryEvent(tx, 'collection', collection.id, 'CollectionRecorded', {
      collectionId: collection.id,
      receiptId: receipt.item.id,
      tripId: trip.id,
      retailerId: input.retailerId,
      mode: input.mode,
      amountPaise: input.amountPaise,
    })
    return this.reply(tx, collection, receipt)
  }

  /** `totals` are over the whole filter, not the page (the crew's day summary, the accountant's cash in transit). */
  async list(input: ListIn): Promise<ListOut> {
    requireRole(MONEY_COLLECTORS)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const filters: (SQL | undefined)[] = [
        input.tripId ? eq(collections.tripId, input.tripId) : undefined,
        input.retailerId ? eq(collections.retailerId, input.retailerId) : undefined,
        input.mode ? eq(collections.mode, input.mode) : undefined,
        ...dayWindow(collections.collectedAt, input.from, input.to),
      ]
      const rows = await tx
        .select()
        .from(collections)
        .where(
          and(
            ...defined([...filters, input.cursor ? lt(collections.id, input.cursor) : undefined]),
          ),
        )
        .orderBy(desc(collections.id))
        .limit(input.limit + 1)
      const page = rows.slice(0, input.limit)
      const [totals] = await tx
        .select({
          cashPaise: sql<number>`coalesce(sum(${collections.amountPaise}) filter (where ${collections.mode} = 'cash'), 0)`,
          upiPaise: sql<number>`coalesce(sum(${collections.amountPaise}) filter (where ${collections.mode} = 'upi'), 0)`,
          chequePaise: sql<number>`coalesce(sum(${collections.amountPaise}) filter (where ${collections.mode} = 'cheque'), 0)`,
        })
        .from(collections)
        .where(and(...defined(filters)))
      const items = await mapCollections(tx, page)
      const last = items[items.length - 1]
      return {
        items,
        nextCursor: rows.length > input.limit && last ? last.id : null,
        totals: {
          cashPaise: Number(totals?.cashPaise ?? 0),
          upiPaise: Number(totals?.upiPaise ?? 0),
          chequePaise: Number(totals?.chequePaise ?? 0),
        },
      }
    })
  }

  // -------------------------------------------------------------------------------------------------------------
  // expenses

  async recordExpense(input: ExpenseIn): Promise<ExpenseOut> {
    requireRole(MONEY_COLLECTORS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, () => this.recordExpenseInTx(tx, input)),
    )
  }

  async recordExpenseInTx(tx: Db, input: ExpenseIn): Promise<ExpenseOut> {
    const ctx = currentTenant()
    {
      {
        const trip = await lockTrip(tx, input.tripId)
        assertCrewOrDesk(trip, MONEY_COLLECTORS)
        if (!TRIP_ON_THE_ROAD.has(trip.state))
          throw new ORPCError('CONFLICT', {
            message: `trip ${trip.tripNo ?? trip.id} is ${trip.state}; an expense belongs to a trip that is out`,
          })
        const [existing] = await tx
          .select()
          .from(tripExpenses)
          .where(eq(tripExpenses.id, input.id))
          .limit(1)
        if (existing) return { item: toExpense(existing) }
        let proofObjectKey: string | null = null
        if (input.inline)
          proofObjectKey = await storeInline(tx, {
            domain: 'expense',
            entityId: input.id,
            fileId: input.id,
            mimeType: input.inline.mimeType,
            contentBase64: input.inline.contentBase64,
          })
        else if (input.proofObjectKey)
          proofObjectKey = await acceptObjectKey(tx, input.proofObjectKey, 'expense')
        const [row] = await tx
          .insert(tripExpenses)
          .values({
            id: input.id,
            tenantId: ctx.tenantId,
            tripId: trip.id,
            kind: input.kind,
            amountPaise: input.amountPaise,
            proofObjectKey,
            note: input.note ?? null,
            recordedBy: ctx.actorRole === 'system' ? null : ctx.actorId,
            createdAt: whenOr(input.incurredAt, new Date()),
          })
          .returning()
        if (!row)
          throw new ORPCError('INTERNAL_SERVER_ERROR', {
            message: 'expense insert returned nothing',
          })
        return { item: toExpense(row) }
      }
    }
  }

  async listExpenses(input: ExpensesIn): Promise<ExpensesOut> {
    requireRole(MONEY_COLLECTORS)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const filters: (SQL | undefined)[] = [
        input.tripId ? eq(tripExpenses.tripId, input.tripId) : undefined,
        input.kind ? eq(tripExpenses.kind, input.kind) : undefined,
        ...dayWindow(tripExpenses.createdAt, input.from, input.to),
      ]
      const rows = await tx
        .select()
        .from(tripExpenses)
        .where(
          and(
            ...defined([...filters, input.cursor ? lt(tripExpenses.id, input.cursor) : undefined]),
          ),
        )
        .orderBy(desc(tripExpenses.id))
        .limit(input.limit + 1)
      const page = rows.slice(0, input.limit)
      const [total] = await tx
        .select({ totalPaise: sql<number>`coalesce(sum(${tripExpenses.amountPaise}), 0)` })
        .from(tripExpenses)
        .where(and(...defined(filters)))
      const items = page.map(toExpense)
      const last = items[items.length - 1]
      return {
        items,
        nextCursor: rows.length > input.limit && last ? last.id : null,
        totalPaise: Number(total?.totalPaise ?? 0),
      }
    })
  }

  // -------------------------------------------------------------------------------------------------------------

  private receiptInput(input: DoorstepCollectionInput, trip: TripRow) {
    const ctx = currentTenant()
    return {
      id: input.receiptId,
      idempotencyKey: `collection:${input.id}`,
      retailerId: input.retailerId,
      mode: input.mode,
      amountPaise: input.amountPaise,
      receivedAt: input.collectedAt,
      receivedBy: ctx.actorRole === 'system' ? undefined : ctx.actorId,
      reference: input.reference ?? null,
      upiVpa: input.upiVpa ?? null,
      chequeDate: input.chequeDate ?? null,
      bankName: input.bankName ?? null,
      tripId: trip.id,
      deviceId: input.deviceId ?? null,
      clientReceiptNo: input.clientReceiptNo ?? null,
      note: input.note ?? null,
      proofObjectKey: input.proofObjectKey ?? null,
      strategy:
        input.allocations && input.allocations.length > 0
          ? ('explicit' as const)
          : ('fifo' as const),
      allocations: input.allocations,
    }
  }

  private async reply(
    tx: Db,
    row: typeof collections.$inferSelect,
    receipt: RecordReceiptResult,
  ): Promise<RecordOut & { item: Collection }> {
    const [item] = await mapCollections(tx, [row])
    if (!item)
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: 'collection mapper returned nothing',
      })
    return {
      item,
      receipt: receipt.item,
      allocations: receipt.allocations,
      invoices: receipt.invoices,
      cashDiscountPaise: receipt.cashDiscountPaise,
      unallocatedPaise: receipt.unallocatedPaise,
      outstanding: receipt.outstanding,
    }
  }
}
