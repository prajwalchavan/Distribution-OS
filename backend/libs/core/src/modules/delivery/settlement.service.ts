import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, asc, eq, gt, sql } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  SettlementPreviewInput,
  SettlementPreviewOutput,
  SettleTripInput,
  SettleTripOutput,
  StockVarianceLine,
  VanStockLine,
} from '@dos/contracts'
import { businessDate, uuidv7 } from '@dos/domain'
import {
  approvals,
  collections,
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
import { InventoryService } from '../inventory/index.js'
import { ReceivablesService } from '../receivables/index.js'
import {
  assertCrewOrDesk,
  casesAndLoose,
  emitDeliveryEvent,
  findTrip,
  loadLots,
  loadTripPolicy,
  loadVehicle,
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

/**
 * The check-in: the van counted back into the godown, the cash handed over, one balanced journal
 * entry, and the owner's word when it does not add up.
 *
 *   expected cash = opening float + Σ cash collections − Σ expenses (UPI and cheques are reported
 *                   beside it, never netted: they are not in the crew's hand)
 *   variance      = handed over − expected; red beyond `delivery.settlement_tolerance_paise`, and red
 *                   on ANY van stock miscount (coordination §7 q14)
 *   stock         counted pieces move vehicle → godown as `van_unload` + `transfer_in` per lot (keys
 *                   `settle:<tripId>:<lotId>:out|in`); a miscount writes a `cycle_count` row at the
 *                   vehicle so its balance ends at zero (coordination §4 item 5)
 *   journal       Dr CASH (handed over − float) · Dr TRIP_EXPENSES · Dr/Cr CASH_SHORT (the variance)
 *                   · Cr CASH_VAN (cash collected), through `ReceivablesService.postEntry`, balanced
 *                   to the paisa (the float went out of and back into the office cash, so it never
 *                   touches the book)
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
      const plan = await this.plan(tx, trip, input)
      if (!plan.hasVariance) return null
      if (ctx.actorRole === 'owner' && input.acceptVariance) return null
      return plan
    })
    if (refusal) {
      const approvalId = await withTenant(db, ctx, (tx) => this.fileApproval(tx, input, refusal))
      throw new ORPCError('CONFLICT', {
        message:
          ctx.actorRole === 'owner'
            ? `cash is ${String(refusal.cashVariancePaise)} paise off (tolerance ${String(refusal.tolerancePaise)}) or the van stock does not tally; resend with acceptVariance to close it as a variance settlement`
            : `cash is ${String(refusal.cashVariancePaise)} paise off (tolerance ${String(refusal.tolerancePaise)}) or the van stock does not tally; the owner has to accept the variance`,
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
        const plan = await this.plan(tx, trip, input)
        if (plan.hasVariance && !(ctx.actorRole === 'owner' && input.acceptVariance))
          throw new ORPCError('CONFLICT', {
            message: 'the settlement has a variance and needs the owner',
            data: { code: 'settlement_needs_owner' },
          })
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
        if (unloads.length > 0)
          await this.inventory.post(
            tx,
            unloads.flatMap((c) => [
              {
                lotId: c.lotId,
                locationId: vehicle.locationId,
                qtyDelta: -c.countedPcs,
                reason: 'van_unload' as const,
                refType: 'trip_settlement',
                refId: input.id,
                idempotencyKey: `settle:${trip.id}:${c.lotId}:out`,
              },
              {
                lotId: c.lotId,
                locationId: godown,
                qtyDelta: c.countedPcs,
                reason: 'transfer_in' as const,
                refType: 'trip_settlement',
                refId: input.id,
                idempotencyKey: `settle:${trip.id}:${c.lotId}:in`,
              },
            ]),
          )

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
              settledBy: ctx.actorRole === 'system' ? null : ctx.actorId,
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
      }),
    )
  }

  // -------------------------------------------------------------------------------------------------------------

  private async cockpit(tx: Db, trip: TripRow): Promise<PreviewOut> {
    const figures = await this.figures(tx, trip)
    const stops = await stopsOf(tx, trip.id)
    const existing = await this.settlementOf(tx, trip.id)
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

  private async figures(tx: Db, trip: TripRow): Promise<Cockpit> {
    const money = await tx
      .select({ mode: collections.mode, amountPaise: collections.amountPaise })
      .from(collections)
      .where(eq(collections.tripId, trip.id))
    const sum = (mode: string) =>
      money.filter((m) => m.mode === mode).reduce((n, m) => n + m.amountPaise, 0)
    const [spent] = await tx
      .select({ total: sql<number>`coalesce(sum(${tripExpenses.amountPaise}), 0)` })
      .from(tripExpenses)
      .where(eq(tripExpenses.tripId, trip.id))
    const expensesPaise = Number(spent?.total ?? 0)
    const cashCollectedPaise = sum('cash')
    const policy = await loadTripPolicy(tx)
    const vehicle = await loadVehicle(tx, trip.vehicleId)
    return {
      cashCollectedPaise,
      upiCollectedPaise: sum('upi'),
      chequeCollectedPaise: sum('cheque'),
      expensesPaise,
      expectedCashPaise: trip.openingCashPaise + cashCollectedPaise - expensesPaise,
      tolerancePaise: policy.settlementTolerancePaise,
      vanStock: await this.vanStock(tx, vehicle.locationId),
      collectionsCount: money.length,
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
  ): Promise<
    Cockpit & {
      cashVariancePaise: number
      hasVariance: boolean
      stockVariance: StockVarianceLine[]
      counted: { lotId: string; countedPcs: number }[]
    }
  > {
    const figures = await this.figures(tx, trip)
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

  /** One pending approval per trip: a second refusal does not file a second row. */
  private async fileApproval(
    tx: Db,
    input: SettleIn,
    plan: {
      cashVariancePaise: number
      tolerancePaise: number
      stockVariance: StockVarianceLine[]
      expectedCashPaise: number
    },
  ): Promise<string> {
    const ctx = currentTenant()
    const [pending] = await tx
      .select({ id: approvals.id })
      .from(approvals)
      .where(
        and(
          eq(approvals.kind, 'trip_settlement'),
          eq(approvals.entityId, input.tripId),
          eq(approvals.status, 'pending'),
        ),
      )
      .limit(1)
    if (pending) return pending.id
    const id = uuidv7()
    await tx.insert(approvals).values({
      id,
      tenantId: ctx.tenantId,
      kind: 'trip_settlement',
      entityType: 'trip',
      entityId: input.tripId,
      requestedBy: ctx.actorId,
      status: 'pending',
      payload: {
        settlementId: input.id,
        expectedCashPaise: plan.expectedCashPaise,
        handedOverCashPaise: input.handedOverCashPaise,
        cashVariancePaise: plan.cashVariancePaise,
        tolerancePaise: plan.tolerancePaise,
        stockVariance: plan.stockVariance.filter((v) => v.deltaPcs !== 0),
        note: input.note ?? null,
      },
    })
    return id
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
