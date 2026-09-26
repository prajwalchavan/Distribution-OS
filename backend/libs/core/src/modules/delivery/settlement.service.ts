import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  ApprovalStockLine,
  ApprovalTripSettlement,
  SettlementPreviewInput,
  SettlementPreviewOutput,
  SettleTripInput,
  SettleTripOutput,
  StockVarianceLine,
  VanStockLine,
} from '@dos/contracts'
import { businessDate, formatINR, paise, uuidv7 } from '@dos/domain'
import {
  approvals,
  deliveries,
  locations,
  stockBalances,
  tripExpenses,
  trips,
  tripSettlements,
  withTenant,
  type Db,
} from '@dos/db'
import {
  BACK_OFFICE,
  currentTenant,
  DB,
  idempotent,
  isCheckViolation,
  pgMessage,
  requireDb,
  requireRole,
} from '../../platform/index.js'
import { BillingService } from '../billing/index.js'
import { dockLocationId, InventoryService } from '../inventory/index.js'
import type { ApprovalKindHook, ApprovalRow } from '../orders/index.js'
import { TenantCatalogService } from '../tenant-catalog/index.js'
import { ReceivablesService } from '../receivables/index.js'
import {
  assertCrewOrDesk,
  casesAndLoose,
  emitDeliveryEvent,
  findTrip,
  loadLots,
  loadTripPolicy,
  loadVehicle,
  loadVehicles,
  lockTrip,
  MONEY_COLLECTORS,
  stopsOf,
  tripEventPayload,
  tripTransition,
  variantNames,
  type TripRow,
} from './delivery.internals.js'
import { toSettlement } from './delivery.mappers.js'

type PreviewIn = z.infer<typeof SettlementPreviewInput>
type PreviewOut = z.infer<typeof SettlementPreviewOutput>
type SettleIn = z.infer<typeof SettleTripInput>
type SettleOut = z.infer<typeof SettleTripOutput>

interface Cockpit {
  cashCollectedPaise: number
  upiCollectedPaise: number
  chequeCollectedPaise: number
  expensesPaise: number
  expectedCashPaise: number
  tolerancePaise: number
  vanStock: VanStockLine[]
  collectionsCount: number
}

/** The count of one settlement request against the van and the cash: what `settle` and the owner decide on. */
interface SettlementPlan extends Cockpit {
  cashVariancePaise: number
  hasVariance: boolean
  stockVariance: StockVarianceLine[]
  counted: { lotId: string; countedPcs: number }[]
}

/**
 * The check-in: the van counted back into the godown, the cash handed over, one balanced journal
 * entry, and the owner's word when it does not add up.
 *
 *   money taken   Σ the trip's own receipts per mode, however they arrived — the doorstep collection, the
 *                   van sale, the phone's offline `receipts` op, the desk — net of reversals, from
 *                   `ReceivablesService.tripMoney` (QA DOS-169). `collections` rows are stop-level detail and
 *                   are never summed for money: a doorstep payment queued with no signal writes none
 *   expected cash = opening float + Σ cash receipts − Σ expenses (UPI and cheques are reported beside it,
 *                   never netted: they are not in the crew's hand)
 *   variance      = handed over − expected; red beyond `delivery.settlement_tolerance_paise`, and red
 *                   on ANY van stock miscount (coordination §7 q14)
 *   stock         counted pieces leave the vehicle as `van_unload` per lot (key `settle:<tripId>:<lotId>:out`)
 *                   and land in TWO places (QA DOS-195, ruling S1): the pieces of a bill that came back
 *                   UNDELIVERED — its stop ended failed or refused on this trip and the bill is still
 *                   issued — go to the DOCK (`transfer_in` at the tenant's in-transit location, key
 *                   `settle:<tripId>:<lotId>:dock`), staged for the next sheet: the bill is still packed
 *                   and the godown was relieved once, at pack (docs/22 §4 W5). Only the FREE van stock
 *                   goes back to the godown (`transfer_in`, key `settle:<tripId>:<lotId>:in`). A miscount
 *                   writes a `cycle_count` row at the vehicle first so its balance ends at zero
 *                   (coordination §4 item 5); a short count fills the dock first and the rack with the
 *                   rest, so the next load-out refuses the bill by name rather than loading air
 *   journal       Dr CASH (handed over − float) · Dr TRIP_EXPENSES · Dr/Cr CASH_SHORT (the variance)
 *                   · Cr CASH_VAN (the cash receipts counted, so exactly what they debited to it), through
 *                   `ReceivablesService.postEntry`, balanced to the paisa (the float went out of and back
 *                   into the office cash, so it never touches the book)
 *   locks         the trip row `FOR UPDATE`, then the trip's money lock and its receipts `FOR UPDATE`
 *                   (`tripMoney({ lock: true })`, amendment (a)): a receipt racing the count is counted or
 *                   finds the trip settled, and an undo or a deposit of the same money takes turns with it
 *   the owner     a red settlement is 409 `settlement_needs_owner` and files an `approvals` row of
 *                   kind `trip_settlement` for the owner's queue — unless the caller IS the owner and
 *                   sends `acceptVariance`, in which case `approved_by` is the owner and the trip ends
 *                   `settled_with_variance`. `dos_trip_settlement_guard` (migration 0015) enforces the
 *                   same rule in the database.
 *
 * Nothing is held in process memory: every figure is recomputed from the tables on every call.
 */
@Injectable()
export class SettlementService {
  constructor(
    @Optional() @Inject(DB) private readonly db: Db | null,
    private readonly inventory: InventoryService,
    private readonly receivables: ReceivablesService,
    /** The lines of a bill that came back undelivered: which lots, how many pieces (QA DOS-195). */
    private readonly billing: BillingService,
    /** What a lot that did not tally is worth, for the owner deciding it (QA DOS-235). */
    private readonly tenantCatalog: TenantCatalogService,
  ) {}

  async preview(input: PreviewIn): Promise<PreviewOut> {
    requireRole(MONEY_COLLECTORS)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const trip = await findTrip(tx, input.id)
      assertCrewOrDesk(trip, BACK_OFFICE)
      return this.cockpit(tx, trip)
    })
  }

  async settle(input: SettleIn): Promise<SettleOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    // The refusal below rolls the transaction back, so the approval it files must live in its own.
    const refusal = await withTenant(db, ctx, async (tx) => {
      const trip = await findTrip(tx, input.tripId)
      if (trip.state !== 'closing') return null
      const existing = await this.settlementOf(tx, trip.id)
      if (existing) return null
      // lock-free: this count only decides whether to file the approval; the settlement counts again under the locks
      const plan = await this.plan(tx, trip, input, { lock: false })
      if (!plan.hasVariance) return null
      if (ctx.actorRole === 'owner' && input.acceptVariance) return null
      return plan
    })
    if (refusal) {
      const approvalId = await withTenant(db, ctx, (tx) => this.fileApproval(tx, input, refusal))
      throw new ORPCError('CONFLICT', {
        message: refusalWords(refusal, ctx.actorRole === 'owner'),
        data: {
          code: 'settlement_needs_owner',
          approvalId,
          cashVariancePaise: refusal.cashVariancePaise,
          tolerancePaise: refusal.tolerancePaise,
          stockVariance: refusal.stockVariance,
        },
      })
    }
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const trip = await lockTrip(tx, input.tripId)
        const existing = await this.settlementOf(tx, trip.id)
        if (existing) {
          if (existing.id !== input.id)
            throw new ORPCError('CONFLICT', {
              message: `trip ${trip.tripNo ?? trip.id} is already settled (${existing.id})`,
            })
          return {
            item: toSettlement(existing, (await this.cockpit(tx, trip)).chequeCollectedPaise),
            tripState: trip.state,
            stockAdjustments: existing.stockVariance.map((v) => ({
              ...v,
              deltaPcs: v.countedPcs - v.expectedPcs,
            })),
          }
        }
        if (trip.state !== 'closing')
          throw new ORPCError('CONFLICT', {
            message: `trip ${trip.tripNo ?? trip.id} is ${trip.state}; a trip is settled after it returns (closing)`,
          })
        // Under the trip row lock taken above: the trip's money lock, then its receipts `FOR UPDATE` (amendment (a)),
        // so a receipt racing this count is counted or finds the trip settled, and an undo or a deposit of the same
        // money waits for this settlement to commit, or it waits for them.
        const plan = await this.plan(tx, trip, input, { lock: true })
        if (plan.hasVariance && !(ctx.actorRole === 'owner' && input.acceptVariance))
          throw new ORPCError('CONFLICT', {
            message: 'the settlement has a variance and needs the owner',
            data: { code: 'settlement_needs_owner' },
          })
        return this.settleInTx(tx, trip, input, plan, ctx.actorId)
      }),
    )
  }

  /**
   * The settlement itself, under the trip row lock the caller holds and with the plan it counted there:
   * stock, the balanced journal entry, the `trip_settlements` row, the approval closed and the trip moved.
   * `settledBy` is who counted it — the desk that filed the variance, when the owner's approval settles it.
   */
  private async settleInTx(
    tx: Db,
    trip: TripRow,
    input: SettleIn,
    plan: SettlementPlan,
    settledBy: string | null,
  ): Promise<SettleOut> {
    const ctx = currentTenant()
    {
      {
        const vehicle = await loadVehicle(tx, trip.vehicleId)
        const godown = await this.warehouseLocation(tx)
        const now = new Date()

        // stock: the miscount first (so the van never dips below zero), then the unload
        const adjustments = plan.stockVariance.filter((v) => v.deltaPcs !== 0)
        if (adjustments.length > 0)
          await this.inventory.post(
            tx,
            adjustments.map((v) => ({
              lotId: v.lotId,
              locationId: vehicle.locationId,
              qtyDelta: v.deltaPcs,
              reason: 'cycle_count' as const,
              refType: 'trip_settlement',
              refId: input.id,
              idempotencyKey: `settle:${trip.id}:${v.lotId}:count`,
              note: `van count at check-in of ${trip.tripNo ?? trip.id}`,
            })),
          )
        const unloads = plan.counted.filter((c) => c.countedPcs > 0)
        if (unloads.length > 0) {
          // The bills that came back on this van are still issued and still packed: their cartons are
          // staged on the DOCK for the next sheet, never put back on the rack (QA DOS-195, ruling S1).
          // Everything the crew counted beyond them is free van stock and goes home to the godown.
          const undelivered = await this.cameBackUndelivered(tx, trip.id)
          const dock = undelivered.size > 0 ? await dockLocationId(tx) : null
          await this.inventory.post(
            tx,
            unloads.flatMap((c) => {
              const toDock = Math.min(c.countedPcs, undelivered.get(c.lotId) ?? 0)
              const toRack = c.countedPcs - toDock
              return [
                {
                  lotId: c.lotId,
                  locationId: vehicle.locationId,
                  qtyDelta: -c.countedPcs,
                  reason: 'van_unload' as const,
                  refType: 'trip_settlement',
                  refId: input.id,
                  idempotencyKey: `settle:${trip.id}:${c.lotId}:out`,
                },
                ...(toDock > 0 && dock !== null
                  ? [
                      {
                        lotId: c.lotId,
                        locationId: dock,
                        qtyDelta: toDock,
                        reason: 'transfer_in' as const,
                        refType: 'trip_settlement',
                        refId: input.id,
                        idempotencyKey: `settle:${trip.id}:${c.lotId}:dock`,
                        note: `undelivered bill staged for its next trip at check-in of ${trip.tripNo ?? trip.id}`,
                      },
                    ]
                  : []),
                ...(toRack > 0
                  ? [
                      {
                        lotId: c.lotId,
                        locationId: godown,
                        qtyDelta: toRack,
                        reason: 'transfer_in' as const,
                        refType: 'trip_settlement',
                        refId: input.id,
                        idempotencyKey: `settle:${trip.id}:${c.lotId}:in`,
                      },
                    ]
                  : []),
              ]
            }),
          )
        }

        // money: one balanced entry (a trip that moved no cash at all — nothing collected, nothing
        // spent, no float — has no entry to post)
        const journalLines = [
          {
            accountCode: 'CASH',
            amountPaise: input.handedOverCashPaise - trip.openingCashPaise,
            memo: 'cash handed over, net of the float',
          },
          {
            accountCode: 'TRIP_EXPENSES',
            amountPaise: plan.expensesPaise,
            memo: 'trip expenses',
          },
          {
            accountCode: 'CASH_SHORT',
            amountPaise: -plan.cashVariancePaise,
            memo: plan.cashVariancePaise < 0 ? 'cash short' : 'cash over',
          },
          {
            accountCode: 'CASH_VAN',
            amountPaise: -plan.cashCollectedPaise,
            memo: 'cash collected on the trip',
          },
        ]
        if (journalLines.some((l) => l.amountPaise !== 0))
          await this.receivables.postEntry(tx, {
            entryDate: businessDate(now).date,
            refType: 'trip_settlement',
            refId: input.id,
            narration: `settlement of trip ${trip.tripNo ?? trip.id}`,
            idempotencyKey: `journal:trip_settlement:${input.id}`,
            lines: journalLines,
          })

        const owner = ctx.actorRole === 'owner' && plan.hasVariance
        let row
        try {
          ;[row] = await tx
            .insert(tripSettlements)
            .values({
              id: input.id,
              tenantId: ctx.tenantId,
              tripId: trip.id,
              expectedCashPaise: plan.expectedCashPaise,
              handedOverCashPaise: input.handedOverCashPaise,
              cashVariancePaise: plan.cashVariancePaise,
              upiCollectedPaise: plan.upiCollectedPaise,
              expensesPaise: plan.expensesPaise,
              stockVariance: adjustments.map((v) => ({
                lotId: v.lotId,
                expectedPcs: v.expectedPcs,
                countedPcs: v.countedPcs,
              })),
              hasVariance: plan.hasVariance,
              settledBy: ctx.actorRole === 'system' ? null : settledBy,
              settledAt: now,
              approvedBy: owner ? ctx.actorId : null,
              approvedAt: owner ? now : null,
              note: input.note ?? null,
            })
            .returning()
        } catch (err) {
          if (isCheckViolation(err))
            throw new ORPCError('CONFLICT', {
              message: pgMessage(err),
              data: { code: 'settlement_needs_owner' },
            })
          throw err
        }
        if (!row)
          throw new ORPCError('INTERNAL_SERVER_ERROR', {
            message: 'settlement insert returned nothing',
          })
        if (plan.hasVariance) await this.closeApproval(tx, trip.id, input.note ?? null)
        const to = tripTransition(trip.state, plan.hasVariance ? 'settle_with_variance' : 'settle')
        const [settled] = await tx
          .update(trips)
          .set({ state: to, updatedAt: now })
          .where(eq(trips.id, trip.id))
          .returning()
        const next = settled ?? trip
        await emitDeliveryEvent(
          tx,
          'trip',
          trip.id,
          plan.hasVariance ? 'TripSettlementVariance' : 'TripSettled',
          {
            ...tripEventPayload(next),
            settlementId: row.id,
            expectedCashPaise: plan.expectedCashPaise,
            handedOverCashPaise: input.handedOverCashPaise,
            cashVariancePaise: plan.cashVariancePaise,
            hasVariance: plan.hasVariance,
            stockVariance: adjustments,
          },
        )
        return {
          item: toSettlement(row, plan.chequeCollectedPaise),
          tripState: next.state,
          stockAdjustments: adjustments,
        }
      }
    }
  }

  // -------------------------------------------------------------------------------------------------------------

  private async cockpit(tx: Db, trip: TripRow): Promise<PreviewOut> {
    const existing = await this.settlementOf(tx, trip.id)
    const live = await this.figures(tx, trip, { lock: false })
    // A settled trip reports the figures it settled with (QA DOS-169 (g)): cash, UPI, expenses and the expected cash
    // come from its settlement row, so an undo after the close never moves them. The row has no cheque column, so
    // the cheques stay live, and so does the count of the trip's receipts.
    const figures: Cockpit = existing
      ? {
          ...live,
          cashCollectedPaise:
            existing.expectedCashPaise - trip.openingCashPaise + existing.expensesPaise,
          upiCollectedPaise: existing.upiCollectedPaise,
          expensesPaise: existing.expensesPaise,
          expectedCashPaise: existing.expectedCashPaise,
        }
      : live
    const stops = await stopsOf(tx, trip.id)
    return {
      tripId: trip.id,
      tripState: trip.state,
      openingCashPaise: trip.openingCashPaise,
      cashCollectedPaise: figures.cashCollectedPaise,
      upiCollectedPaise: figures.upiCollectedPaise,
      chequeCollectedPaise: figures.chequeCollectedPaise,
      expensesPaise: figures.expensesPaise,
      expectedCashPaise: figures.expectedCashPaise,
      tolerancePaise: figures.tolerancePaise,
      expectedVanStock: figures.vanStock,
      stopsPlanned: stops.length,
      stopsDelivered: stops.filter((s) => s.state === 'delivered').length,
      stopsPartial: stops.filter((s) => s.state === 'partial').length,
      stopsFailed: stops.filter((s) => s.state === 'failed').length,
      collectionsCount: figures.collectionsCount,
      settlement: existing ? toSettlement(existing, figures.chequeCollectedPaise) : null,
    }
  }

  /**
   * The trip's figures, live: its receipts per mode however they arrived, net of reversals (QA DOS-169 (d)), its
   * expenses and the van's stock. `lock: true` is the settlement's own count, taken after the trip row lock; the
   * cockpit and the refusal pre-check read without locks.
   */
  private async figures(tx: Db, trip: TripRow, opts: { lock: boolean }): Promise<Cockpit> {
    const money = await this.receivables.tripMoney(tx, trip.id, opts)
    const [spent] = await tx
      .select({ total: sql<number>`coalesce(sum(${tripExpenses.amountPaise}), 0)` })
      .from(tripExpenses)
      .where(eq(tripExpenses.tripId, trip.id))
    const expensesPaise = Number(spent?.total ?? 0)
    const policy = await loadTripPolicy(tx)
    const vehicle = await loadVehicle(tx, trip.vehicleId)
    return {
      cashCollectedPaise: money.cashPaise,
      upiCollectedPaise: money.upiPaise,
      chequeCollectedPaise: money.chequePaise,
      expensesPaise,
      expectedCashPaise: trip.openingCashPaise + money.cashPaise - expensesPaise,
      tolerancePaise: policy.settlementTolerancePaise,
      vanStock: await this.vanStock(tx, vehicle.locationId),
      collectionsCount: money.count,
    }
  }

  /** What the van still holds per lot: `stock_balances.on_hand` at the vehicle, cases from THAT lot's case size. */
  private async vanStock(tx: Db, locationId: string): Promise<VanStockLine[]> {
    const rows = await tx
      .select({ lotId: stockBalances.lotId, onHand: stockBalances.onHand })
      .from(stockBalances)
      .where(and(eq(stockBalances.locationId, locationId), gt(stockBalances.onHand, 0)))
      .orderBy(asc(stockBalances.lotId))
    const lots = await loadLots(
      tx,
      rows.map((r) => r.lotId),
    )
    const variants = await variantNames(
      tx,
      [...lots.values()].map((l) => l.variantId),
    )
    const out: VanStockLine[] = []
    for (const r of rows) {
      const lot = lots.get(r.lotId)
      if (!lot) continue
      const variant = variants.get(lot.variantId)
      const caseSize = lot.caseSize ?? variant?.sellCaseSize ?? null
      out.push({
        lotId: r.lotId,
        variantId: lot.variantId,
        variantName: variant?.name ?? '',
        batchNo: lot.batchNo === '' ? null : lot.batchNo,
        expiryDate: lot.expiryDate,
        caseSize,
        expectedPcs: r.onHand,
        ...casesAndLoose(r.onHand, caseSize),
      })
    }
    return out.sort(
      (a, b) => a.variantName.localeCompare(b.variantName) || (a.lotId < b.lotId ? -1 : 1),
    )
  }

  private async plan(
    tx: Db,
    trip: TripRow,
    input: SettleIn,
    opts: { lock: boolean },
  ): Promise<SettlementPlan> {
    const figures = await this.figures(tx, trip, opts)
    const onVan = new Map(figures.vanStock.map((l) => [l.lotId, l.expectedPcs]))
    const countedByLot = new Map<string, number>()
    for (const c of input.counted) {
      if (countedByLot.has(c.lotId))
        throw new ORPCError('BAD_REQUEST', { message: `lot ${c.lotId} is counted twice` })
      if (!onVan.has(c.lotId) && c.countedPcs > 0)
        throw new ORPCError('BAD_REQUEST', {
          message: `lot ${c.lotId} is not on this vehicle; a count names a lot the van holds`,
          data: { lotId: c.lotId },
        })
      countedByLot.set(c.lotId, c.countedPcs)
    }
    const stockVariance: StockVarianceLine[] = figures.vanStock.map((l) => {
      const countedPcs = countedByLot.get(l.lotId) ?? 0
      return {
        lotId: l.lotId,
        expectedPcs: l.expectedPcs,
        countedPcs,
        deltaPcs: countedPcs - l.expectedPcs,
      }
    })
    const cashVariancePaise = input.handedOverCashPaise - figures.expectedCashPaise
    const hasVariance =
      Math.abs(cashVariancePaise) > figures.tolerancePaise ||
      stockVariance.some((v) => v.deltaPcs !== 0)
    return {
      ...figures,
      cashVariancePaise,
      hasVariance,
      stockVariance,
      counted: stockVariance.map((v) => ({ lotId: v.lotId, countedPcs: v.countedPcs })),
    }
  }

  /**
   * One pending approval per trip, and it carries the LATEST count (QA DOS-235). A second refusal with the
   * same figures answers the approval already waiting; a recount with different figures expires that one
   * (the only change the desk may make to an approval) and files the new count, so the owner never decides
   * a count the desk has since corrected. The payload is everything the owner's Approve needs to settle the
   * trip exactly as counted — the full per-lot count included — and nothing that carries purchase cost:
   * every staff role can read an approval row, so the lots' value is read when the queue is asked.
   */
  private async fileApproval(tx: Db, input: SettleIn, plan: SettlementPlan): Promise<string> {
    const ctx = currentTenant()
    const trip = await findTrip(tx, input.tripId)
    const stockVariance = plan.stockVariance
      .filter((v) => v.deltaPcs !== 0)
      .map((v) => ({ lotId: v.lotId, expectedPcs: v.expectedPcs, countedPcs: v.countedPcs }))
    const payload: TripSettlementPayload = {
      settlementId: input.id,
      tripNo: trip.tripNo,
      openingCashPaise: trip.openingCashPaise,
      cashCollectedPaise: plan.cashCollectedPaise,
      upiCollectedPaise: plan.upiCollectedPaise,
      chequeCollectedPaise: plan.chequeCollectedPaise,
      expensesPaise: plan.expensesPaise,
      expectedCashPaise: plan.expectedCashPaise,
      handedOverCashPaise: input.handedOverCashPaise,
      cashVariancePaise: plan.cashVariancePaise,
      tolerancePaise: plan.tolerancePaise,
      counted: plan.counted,
      stockVariance,
      note: input.note ?? null,
    }
    const [pending] = await tx
      .select({ id: approvals.id, payload: approvals.payload })
      .from(approvals)
      .where(
        and(
          eq(approvals.kind, 'trip_settlement'),
          eq(approvals.entityId, input.tripId),
          eq(approvals.status, 'pending'),
        ),
      )
      .limit(1)
    if (pending) {
      if (sameCount(readPayload(pending.payload), payload)) return pending.id
      const now = new Date()
      await tx
        .update(approvals)
        .set({
          status: 'expired',
          decisionNote: 'counted again; the new count is waiting for the owner',
          decidedAt: now,
          updatedAt: now,
        })
        .where(eq(approvals.id, pending.id))
    }
    const id = uuidv7()
    await tx.insert(approvals).values({
      id,
      tenantId: ctx.tenantId,
      kind: 'trip_settlement',
      entityType: 'trip',
      entityId: input.tripId,
      requestedBy: ctx.actorId,
      status: 'pending',
      payload: { ...payload },
    })
    return id
  }

  /**
   * THE OWNER'S DECISION ON A TRIP SETTLEMENT (QA DOS-235), registered with the approvals queue by the
   * module. Approve settles the trip in the decision's own transaction, as the owner, with the count the
   * desk filed: `approved_by` is the owner (the 0015 guard insists), `settled_by` the desk that counted.
   * Reject leaves the trip `closing` for the desk to count again. Only the owner decides one — the
   * database refuses anyone else's signature on a variance, and a manager's Approve used to be recorded as
   * "approved" while the trip stayed `closing`.
   */
  approvalHook(): ApprovalKindHook {
    return {
      decide: (tx, approval, decision, note) => this.decideApproval(tx, approval, decision, note),
      describe: (tx, rows) => this.describeApprovals(tx, rows),
    }
  }

  private async decideApproval(
    tx: Db,
    approval: ApprovalRow,
    decision: 'approve' | 'reject',
    note: string | null,
  ): Promise<{ trip: { id: string; tripNo: string | null; state: string } | null }> {
    const ctx = currentTenant()
    if (ctx.actorRole !== 'owner' && ctx.actorRole !== 'system')
      throw new ORPCError('FORBIDDEN', {
        message: "only the owner accepts or turns down a trip's variance",
        data: { code: 'owner_only', kind: 'trip_settlement' },
      })
    const trip = await lockTrip(tx, approval.entityId)
    const tripOut = (row: TripRow) => ({ id: row.id, tripNo: row.tripNo, state: row.state })
    if (decision === 'reject') return { trip: tripOut(trip) }
    const payload = readPayload(approval.payload)
    const name = trip.tripNo ?? trip.id
    if (payload === null)
      throw new ORPCError('CONFLICT', {
        message: `this request for ${name} carries no count; ask the desk to settle it again`,
        data: { code: 'settlement_request_unreadable' },
      })
    const existing = await this.settlementOf(tx, trip.id)
    if (existing) return { trip: tripOut(trip) }
    if (trip.state !== 'closing')
      throw new ORPCError('CONFLICT', {
        message: `trip ${name} is ${trip.state}; only a trip that has come back is settled`,
      })
    const said = note ?? payload.note
    const input: SettleIn = {
      id: payload.settlementId,
      idempotencyKey: `approval:${approval.id}`,
      tripId: trip.id,
      handedOverCashPaise: payload.handedOverCashPaise,
      counted: await this.countOf(tx, trip, payload),
      acceptVariance: true,
      ...(said === null || said === '' ? {} : { note: said }),
    }
    const plan = await this.plan(tx, trip, input, { lock: true })
    // The owner accepts the figures on the screen and no others: money or stock that moved since the desk
    // counted is a different settlement, which the desk counts again.
    if (
      plan.cashVariancePaise !== payload.cashVariancePaise ||
      !sameStock(
        plan.stockVariance.filter((v) => v.deltaPcs !== 0),
        payload.stockVariance,
      )
    )
      throw new ORPCError('CONFLICT', {
        message: `${name} has changed since it was counted (cash ${offWords(plan.cashVariancePaise)} now, ${offWords(payload.cashVariancePaise)} then, or a lot moved); ask the desk to count it again — this request stays open`,
        data: { code: 'settlement_changed' },
      })
    if (!plan.hasVariance)
      throw new ORPCError('CONFLICT', {
        message: `${name} tallies now; the desk can settle it without you`,
        data: { code: 'settlement_changed' },
      })
    const settled = await this.settleInTx(tx, trip, input, plan, approval.requestedBy)
    return { trip: { id: trip.id, tripNo: trip.tripNo, state: settled.tripState } }
  }

  /**
   * The per-lot count the owner settles with. Filed since QA DOS-235, it is the payload's own `counted`; an
   * older request carried only the lots that did not tally, so every other lot on the van is taken as
   * counted in full — which is what that request said.
   */
  private async countOf(
    tx: Db,
    trip: TripRow,
    payload: TripSettlementPayload,
  ): Promise<{ lotId: string; countedPcs: number }[]> {
    if (payload.counted !== null) return payload.counted
    const off = new Map(payload.stockVariance.map((v) => [v.lotId, v.countedPcs]))
    const vehicle = await loadVehicle(tx, trip.vehicleId)
    return (await this.vanStock(tx, vehicle.locationId)).map((l) => ({
      lotId: l.lotId,
      countedPcs: off.get(l.lotId) ?? l.expectedPcs,
    }))
  }

  /** What the owner's queue shows for a page of trip-settlement requests: the trip, the cash, the lots and their value. */
  private async describeApprovals(
    tx: Db,
    rows: readonly ApprovalRow[],
  ): Promise<Map<string, ApprovalTripSettlement>> {
    const out = new Map<string, ApprovalTripSettlement>()
    const payloads = rows.flatMap((row) => {
      const payload = readPayload(row.payload)
      return payload === null ? [] : [{ row, payload }]
    })
    if (payloads.length === 0) return out
    const tripIds = [...new Set(payloads.map((p) => p.row.entityId))]
    const tripRows = await tx.select().from(trips).where(inArray(trips.id, tripIds))
    const tripById = new Map(tripRows.map((t) => [t.id, t]))
    const vehicleRows = await loadVehicles(
      tx,
      tripRows.map((t) => t.vehicleId),
    )
    const lotIds = [
      ...new Set(payloads.flatMap((p) => p.payload.stockVariance.map((v) => v.lotId))),
    ]
    const lots = await loadLots(tx, lotIds)
    const variantIds = [...new Set([...lots.values()].map((l) => l.variantId))]
    const [names, lotCosts, skuCosts] = await Promise.all([
      variantNames(tx, variantIds),
      this.tenantCatalog.costsForLots(tx, lotIds),
      this.tenantCatalog.costsForVariants(tx, variantIds),
    ])
    const unitCost = (c: { landedCostPaise: number; purchaseRatePaise: number } | undefined) =>
      c ? c.landedCostPaise || c.purchaseRatePaise : null
    for (const { row, payload } of payloads) {
      const trip = tripById.get(row.entityId)
      const lines: ApprovalStockLine[] = payload.stockVariance.map((v) => {
        const lot = lots.get(v.lotId)
        const variant = lot ? names.get(lot.variantId) : undefined
        const cost = lot
          ? (unitCost(lotCosts.get(v.lotId)) ?? unitCost(skuCosts.get(lot.variantId)))
          : null
        const deltaPcs = v.countedPcs - v.expectedPcs
        return {
          lotId: v.lotId,
          variantName: variant?.name ?? '',
          batchNo: lot === undefined || lot.batchNo === '' ? null : lot.batchNo,
          caseSize: lot?.caseSize ?? variant?.sellCaseSize ?? null,
          expectedPcs: v.expectedPcs,
          countedPcs: v.countedPcs,
          deltaPcs,
          valuePaise: cost === null ? null : deltaPcs * cost,
        }
      })
      const valued = lines.filter((l) => l.valuePaise !== null)
      out.set(row.id, {
        tripId: row.entityId,
        tripNo: trip?.tripNo ?? payload.tripNo,
        tripDate: trip?.tripDate ?? null,
        tripState: trip?.state ?? null,
        vehicleRegNo: trip ? (vehicleRows.get(trip.vehicleId)?.regNo ?? null) : null,
        openingCashPaise: payload.openingCashPaise ?? trip?.openingCashPaise ?? null,
        cashCollectedPaise: payload.cashCollectedPaise,
        expensesPaise: payload.expensesPaise,
        expectedCashPaise: payload.expectedCashPaise,
        handedOverCashPaise: payload.handedOverCashPaise,
        cashVariancePaise: payload.cashVariancePaise,
        tolerancePaise: payload.tolerancePaise,
        upiCollectedPaise: payload.upiCollectedPaise,
        chequeCollectedPaise: payload.chequeCollectedPaise,
        stockVariance: lines,
        stockVarianceValuePaise:
          valued.length === 0 ? null : valued.reduce((sum, l) => sum + (l.valuePaise ?? 0), 0),
      })
    }
    return out
  }

  /** The owner closed the variance: the approval it raised is decided in the same transaction. */
  private async closeApproval(tx: Db, tripId: string, note: string | null): Promise<void> {
    const ctx = currentTenant()
    const now = new Date()
    await tx
      .update(approvals)
      .set({
        status: 'approved',
        decidedBy: ctx.actorId,
        decidedAt: now,
        decisionNote: note ?? 'variance accepted at settlement',
        updatedAt: now,
      })
      .where(
        and(
          eq(approvals.kind, 'trip_settlement'),
          eq(approvals.entityId, tripId),
          eq(approvals.status, 'pending'),
        ),
      )
  }

  /**
   * The pieces per lot of every bill that CAME BACK on this trip: a `deliveries` row of the trip whose
   * outcome is `failed` — `stops.fail` marks the planned rows so, and `deliveries.record` derives it from
   * an all-zero door (QA DOS-195) — and whose bill is still issued. A bill cancelled while the van was out
   * is not staged for anything. Summed per lot across the bills, so two refused bills drawn from one
   * batch fill the dock once with both.
   */
  private async cameBackUndelivered(tx: Db, tripId: string): Promise<Map<string, number>> {
    const { tenantId } = currentTenant()
    const rows = await tx
      .select({ invoiceId: deliveries.invoiceId })
      .from(deliveries)
      .where(
        and(
          eq(deliveries.tenantId, tenantId),
          eq(deliveries.tripId, tripId),
          eq(deliveries.outcome, 'failed'),
        ),
      )
      .orderBy(asc(deliveries.id))
    const need = new Map<string, number>()
    for (const invoiceId of new Set(rows.map((r) => r.invoiceId))) {
      const invoice = await this.billing.invoiceForDelivery(tx, invoiceId)
      if (invoice.state === 'cancelled') continue
      for (const line of invoice.lines) {
        if (line.lotId === null) continue
        const pcs = line.qtyPcs + line.freeQtyPcs
        if (pcs <= 0) continue
        need.set(line.lotId, (need.get(line.lotId) ?? 0) + pcs)
      }
    }
    return need
  }

  private async settlementOf(tx: Db, tripId: string) {
    const [row] = await tx
      .select()
      .from(tripSettlements)
      .where(eq(tripSettlements.tripId, tripId))
      .limit(1)
    return row
  }

  private async warehouseLocation(tx: Db): Promise<string> {
    const { tenantId } = currentTenant()
    const [row] = await tx
      .select({ id: locations.id })
      .from(locations)
      .where(
        and(
          eq(locations.tenantId, tenantId),
          eq(locations.kind, 'warehouse'),
          eq(locations.active, true),
        ),
      )
      .orderBy(asc(locations.id))
      .limit(1)
    if (!row)
      throw new ORPCError('BAD_REQUEST', {
        message: 'this distributor has no active warehouse location (bootstrap it first)',
      })
    return row.id
  }
}

/** What a `trip_settlement` approval carries (QA DOS-235). Fields added since are null on an older request. */
interface TripSettlementPayload {
  settlementId: string
  tripNo: string | null
  openingCashPaise: number | null
  cashCollectedPaise: number | null
  upiCollectedPaise: number | null
  chequeCollectedPaise: number | null
  expensesPaise: number | null
  expectedCashPaise: number
  handedOverCashPaise: number
  cashVariancePaise: number
  tolerancePaise: number
  counted: { lotId: string; countedPcs: number }[] | null
  stockVariance: { lotId: string; expectedPcs: number; countedPcs: number }[]
  note: string | null
}

const intOr = <T extends number | null>(value: unknown, fallback: T): number | T =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : fallback

/** The lot rows of a JSON array, each an object naming its lot; null when the value is not an array. */
function lotRows(value: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(value)) return null
  const out: Record<string, unknown>[] = []
  for (const item of value as unknown[]) {
    if (typeof item !== 'object' || item === null) continue
    const row = item as Record<string, unknown>
    if (typeof row.lotId === 'string') out.push(row)
  }
  return out
}

/** The payload read defensively: it is a JSON column, and an unreadable one is refused by name, never guessed. */
function readPayload(raw: unknown): TripSettlementPayload | null {
  if (typeof raw !== 'object' || raw === null) return null
  const p = raw as Record<string, unknown>
  const expected = intOr(p.expectedCashPaise, null)
  const handed = intOr(p.handedOverCashPaise, null)
  const variance = intOr(p.cashVariancePaise, null)
  if (
    typeof p.settlementId !== 'string' ||
    expected === null ||
    handed === null ||
    variance === null
  )
    return null
  const counted = lotRows(p.counted)
  return {
    settlementId: p.settlementId,
    tripNo: typeof p.tripNo === 'string' ? p.tripNo : null,
    openingCashPaise: intOr(p.openingCashPaise, null),
    cashCollectedPaise: intOr(p.cashCollectedPaise, null),
    upiCollectedPaise: intOr(p.upiCollectedPaise, null),
    chequeCollectedPaise: intOr(p.chequeCollectedPaise, null),
    expensesPaise: intOr(p.expensesPaise, null),
    expectedCashPaise: expected,
    handedOverCashPaise: handed,
    cashVariancePaise: variance,
    tolerancePaise: intOr(p.tolerancePaise, 0),
    counted:
      counted === null
        ? null
        : counted.map((l) => ({ lotId: String(l.lotId), countedPcs: intOr(l.countedPcs, 0) })),
    stockVariance: (lotRows(p.stockVariance) ?? []).map((l) => ({
      lotId: String(l.lotId),
      expectedPcs: intOr(l.expectedPcs, 0),
      countedPcs: intOr(l.countedPcs, 0),
    })),
    note: typeof p.note === 'string' ? p.note : null,
  }
}

/** The same lots off by the same pieces, in any order. */
function sameStock(
  a: readonly { lotId: string; expectedPcs: number; countedPcs: number }[],
  b: readonly { lotId: string; expectedPcs: number; countedPcs: number }[],
): boolean {
  const key = (l: { lotId: string; expectedPcs: number; countedPcs: number }) =>
    `${l.lotId}:${String(l.expectedPcs)}:${String(l.countedPcs)}`
  const left = a.map(key).sort()
  const right = b.map(key).sort()
  return left.length === right.length && left.every((k, i) => k === right[i])
}

/** Two requests that would settle the trip identically: same cash handed over, same variance, same lots. */
function sameCount(was: TripSettlementPayload | null, now: TripSettlementPayload): boolean {
  if (was === null) return false
  return (
    was.handedOverCashPaise === now.handedOverCashPaise &&
    was.cashVariancePaise === now.cashVariancePaise &&
    sameStock(was.stockVariance, now.stockVariance)
  )
}

function rupees(value: number): string {
  return formatINR(paise(Math.abs(value)))
}

/** "₹200.00 short", "₹50.00 over", "exact" — never paise, never a minus sign. */
function offWords(variancePaise: number): string {
  if (variancePaise === 0) return 'exact'
  return `${rupees(variancePaise)} ${variancePaise < 0 ? 'short' : 'over'}`
}

/**
 * WHAT THE DESK IS TOLD WHEN A COUNT GOES TO THE OWNER (QA DOS-235, the wording of DOS-236): rupees, not
 * paise; short or over, not a minus sign; and the cash and the stock each said only when they are off.
 */
function refusalWords(
  plan: { cashVariancePaise: number; tolerancePaise: number; stockVariance: StockVarianceLine[] },
  owner: boolean,
): string {
  const parts: string[] = []
  if (Math.abs(plan.cashVariancePaise) > plan.tolerancePaise)
    parts.push(
      `cash is ${offWords(plan.cashVariancePaise)} (allowed ${rupees(plan.tolerancePaise)})`,
    )
  const off = plan.stockVariance.filter((v) => v.deltaPcs !== 0)
  if (off.length > 0) {
    const missing = off.reduce((n, v) => n + Math.max(0, -v.deltaPcs), 0)
    const extra = off.reduce((n, v) => n + Math.max(0, v.deltaPcs), 0)
    const pieces = [
      missing > 0 ? `${String(missing)} pieces missing` : null,
      extra > 0 ? `${String(extra)} pieces extra` : null,
    ].filter((p): p is string => p !== null)
    parts.push(
      `the van count does not tally on ${String(off.length)} ${off.length === 1 ? 'lot' : 'lots'} (${pieces.join(', ')})`,
    )
  }
  const joined = parts.join(' and ')
  const what = joined.charAt(0).toUpperCase() + joined.slice(1)
  return owner
    ? `${what}; settle again accepting the variance to close it`
    : `${what} — sent to the owner, who settles it by approving`
}
