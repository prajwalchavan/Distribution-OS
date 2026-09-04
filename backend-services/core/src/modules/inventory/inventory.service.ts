import { Injectable } from '@nestjs/common'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { ORPCError } from '@orpc/server'
import type { StockReason } from '@dos/contracts'
import { uuidv7 } from '@dos/domain'
import { locations, reservations, stockBalances, stockLedger, stockLots, type Db } from '@dos/db'
import { currentTenant } from '../../platform/index.js'

/**
 * The stock ledger (ADR 0003). Every module that moves pieces (procurement on GRN, orders on pick, delivery on
 * van load/unload, returns) calls `post()` with the transaction it already holds from `withTenant`, so the ledger
 * row and the derived balance commit together with the business fact that caused them. Balances never go below
 * zero unless the location allows it (damaged bin); the CHECK constraint is the guarantee, this class turns it
 * into a readable error. Ledger rows carry UNIQUE(tenant_id, idempotency_key), so re-posting the same entry is a
 * harmless no-op and never double-counts.
 */

export type LedgerRow = typeof stockLedger.$inferSelect
export type BalanceRow = typeof stockBalances.$inferSelect
export type LotRow = typeof stockLots.$inferSelect
export type ReservationRow = typeof reservations.$inferSelect

export interface LedgerEntryInput {
  lotId: string
  locationId: string
  /** Signed pieces; never zero. */
  qtyDelta: number
  reason: StockReason
  refType?: string
  refId?: string
  /** Unique per tenant for all time (e.g. `grn:<grnId>:<lineId>:good`). */
  idempotencyKey: string
  note?: string
  occurredAt?: Date
}

export interface PostResult {
  /** Rows actually written this call (replays of an existing key are skipped). */
  entries: LedgerRow[]
  balances: BalanceRow[]
}

export interface LotInput {
  variantId: string
  batchNo?: string | null
  mrpPaise: number
  mfgDate?: string | null
  expiryDate?: string | null
  /** Client-generated id to use if the lot has to be created. */
  id?: string
}

export interface ReserveInput {
  orderLineId: string
  variantId: string
  locationId: string
  qtyPcs: number
}

const balanceKey = (lotId: string, locationId: string) => `${lotId}:${locationId}`

@Injectable()
export class InventoryService {
  /** Append ledger rows and move the balances in the caller's transaction. All-or-nothing with the caller. */
  async post(tx: Db, entries: LedgerEntryInput[]): Promise<PostResult> {
    const { tenantId, actorId } = currentTenant()
    if (entries.length === 0) return { entries: [], balances: [] }
    const locationIds = [...new Set(entries.map((e) => e.locationId))]
    const locs = await tx
      .select({ id: locations.id, negativeAllowed: locations.negativeAllowed })
      .from(locations)
      .where(and(eq(locations.tenantId, tenantId), inArray(locations.id, locationIds)))
    const byLocation = new Map(locs.map((l) => [l.id, l]))
    const written: LedgerRow[] = []
    const balances = new Map<string, BalanceRow>()
    for (const e of entries) {
      if (!Number.isSafeInteger(e.qtyDelta) || e.qtyDelta === 0) {
        throw new ORPCError('BAD_REQUEST', {
          message: `qtyDelta must be a non-zero integer (lot ${e.lotId})`,
        })
      }
      const loc = byLocation.get(e.locationId)
      if (!loc) throw new ORPCError('NOT_FOUND', { message: `location ${e.locationId} not found` })
      const [row] = await tx
        .insert(stockLedger)
        .values({
          id: uuidv7(),
          tenantId,
          occurredAt: e.occurredAt ?? new Date(),
          lotId: e.lotId,
          locationId: e.locationId,
          qtyDelta: e.qtyDelta,
          reason: e.reason,
          refType: e.refType ?? null,
          refId: e.refId ?? null,
          actorId,
          idempotencyKey: e.idempotencyKey,
          note: e.note ?? null,
        })
        .onConflictDoNothing({ target: [stockLedger.tenantId, stockLedger.idempotencyKey] })
        .returning()
      if (!row) continue // already posted under this key; its balance moved then
      written.push(row)
      const balance = await this.applyBalance(tx, {
        lotId: e.lotId,
        locationId: e.locationId,
        onHandDelta: e.qtyDelta,
        reservedDelta: 0,
        negativeAllowed: loc.negativeAllowed,
      })
      balances.set(balanceKey(e.lotId, e.locationId), balance)
    }
    return { entries: written, balances: [...balances.values()] }
  }

  /** Lot identity is (variant, batch, MRP); expiry/mfg are filled in when first known. */
  async findOrCreateLot(tx: Db, input: LotInput): Promise<{ lot: LotRow; created: boolean }> {
    const { tenantId } = currentTenant()
    const batchNo = input.batchNo ?? ''
    const identity = and(
      eq(stockLots.tenantId, tenantId),
      eq(stockLots.variantId, input.variantId),
      eq(stockLots.batchNo, batchNo),
      eq(stockLots.mrpPaise, input.mrpPaise),
    )
    const [existing] = await tx.select().from(stockLots).where(identity)
    if (existing) {
      const fill = {
        ...(existing.expiryDate === null && input.expiryDate
          ? { expiryDate: input.expiryDate }
          : {}),
        ...(existing.mfgDate === null && input.mfgDate ? { mfgDate: input.mfgDate } : {}),
      }
      if (Object.keys(fill).length === 0) return { lot: existing, created: false }
      const [updated] = await tx
        .update(stockLots)
        .set({ ...fill, updatedAt: new Date() })
        .where(eq(stockLots.id, existing.id))
        .returning()
      return { lot: updated ?? existing, created: false }
    }
    const [row] = await tx
      .insert(stockLots)
      .values({
        id: input.id ?? uuidv7(),
        tenantId,
        variantId: input.variantId,
        batchNo,
        mrpPaise: input.mrpPaise,
        mfgDate: input.mfgDate ?? null,
        expiryDate: input.expiryDate ?? null,
      })
      .onConflictDoNothing({
        target: [stockLots.tenantId, stockLots.variantId, stockLots.batchNo, stockLots.mrpPaise],
      })
      .returning()
    if (row) return { lot: row, created: true }
    const [raced] = await tx.select().from(stockLots).where(identity)
    if (!raced)
      throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'lot vanished after upsert' })
    return { lot: raced, created: false }
  }

  /**
   * Hold pieces for a confirmed order line, FEFO across the lots of `sellable_stock` at the location (earliest
   * expiry first, then the oldest lot). All-or-nothing: if the location cannot cover the line nothing is held.
   * Calling again for a line that already has pending reservations returns them (idempotent).
   */
  async reserve(tx: Db, input: ReserveInput): Promise<ReservationRow[]> {
    const { tenantId } = currentTenant()
    if (!Number.isSafeInteger(input.qtyPcs) || input.qtyPcs <= 0)
      throw new ORPCError('BAD_REQUEST', { message: 'qtyPcs must be a positive integer' })
    const pending = await this.pendingReservations(tx, input.orderLineId)
    if (pending.length > 0) return pending
    const candidates = (
      await tx.execute(sql`
        select lot_id, available from sellable_stock
        where tenant_id = ${tenantId} and variant_id = ${input.variantId} and location_id = ${input.locationId}
        order by expiry_date asc nulls last, lot_id asc`)
    ).rows as { lot_id: string; available: number }[]
    let remaining = input.qtyPcs
    const picked: { lotId: string; qty: number }[] = []
    for (const c of candidates) {
      if (remaining <= 0) break
      const take = Math.min(remaining, Number(c.available))
      if (take <= 0) continue
      // the WHERE re-checks availability under the row lock, so two concurrent reservations never overbook
      const [held] = await tx
        .update(stockBalances)
        .set({
          reserved: sql`${stockBalances.reserved} + ${take}`,
          version: sql`${stockBalances.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(stockBalances.tenantId, tenantId),
            eq(stockBalances.lotId, c.lot_id),
            eq(stockBalances.locationId, input.locationId),
            sql`${stockBalances.onHand} - ${stockBalances.reserved} >= ${take}`,
          ),
        )
        .returning({ lotId: stockBalances.lotId })
      if (!held) continue
      picked.push({ lotId: c.lot_id, qty: take })
      remaining -= take
    }
    if (remaining > 0) {
      throw new ORPCError('BAD_REQUEST', {
        message: `insufficient sellable stock for variant ${input.variantId} at location ${input.locationId}: short by ${remaining} pcs`,
        data: {
          variantId: input.variantId,
          locationId: input.locationId,
          requested: input.qtyPcs,
          available: input.qtyPcs - remaining,
        },
      })
    }
    return tx
      .insert(reservations)
      .values(
        picked.map((p) => ({
          id: uuidv7(),
          tenantId,
          orderLineId: input.orderLineId,
          variantId: input.variantId,
          lotId: p.lotId,
          locationId: input.locationId,
          qty: p.qty,
          state: 'pending' as const,
        })),
      )
      .returning()
  }

  /** Give the held pieces back (order cancelled / line edited). Returns how many reservations were voided. */
  async releaseReservation(tx: Db, orderLineId: string): Promise<number> {
    const pending = await this.pendingReservations(tx, orderLineId)
    for (const r of pending) {
      if (!r.lotId) continue
      await this.applyBalance(tx, {
        lotId: r.lotId,
        locationId: r.locationId,
        onHandDelta: 0,
        reservedDelta: -r.qty,
        negativeAllowed: false,
      })
    }
    if (pending.length > 0) {
      await tx
        .update(reservations)
        .set({ state: 'voided', updatedAt: new Date() })
        .where(
          inArray(
            reservations.id,
            pending.map((r) => r.id),
          ),
        )
    }
    return pending.length
  }

  /** Pick confirmed: the held pieces leave stock as `sale` rows and the reservations are closed. */
  async postReservationAsSale(
    tx: Db,
    orderLineId: string,
    refType: string,
    refId: string,
    idempotencyKey: string,
  ): Promise<PostResult> {
    const pending = await this.pendingReservations(tx, orderLineId)
    const withLot = pending.filter((r): r is ReservationRow & { lotId: string } => r.lotId !== null)
    const result = await this.post(
      tx,
      withLot.map((r) => ({
        lotId: r.lotId,
        locationId: r.locationId,
        qtyDelta: -r.qty,
        reason: 'sale' as const,
        refType,
        refId,
        idempotencyKey: `${idempotencyKey}:${r.id}`,
      })),
    )
    for (const r of withLot) {
      await this.applyBalance(tx, {
        lotId: r.lotId,
        locationId: r.locationId,
        onHandDelta: 0,
        reservedDelta: -r.qty,
        negativeAllowed: false,
      })
    }
    if (pending.length > 0) {
      await tx
        .update(reservations)
        .set({ state: 'posted', updatedAt: new Date() })
        .where(
          inArray(
            reservations.id,
            pending.map((r) => r.id),
          ),
        )
    }
    return result
  }

  private async pendingReservations(tx: Db, orderLineId: string): Promise<ReservationRow[]> {
    const { tenantId } = currentTenant()
    return tx
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.tenantId, tenantId),
          eq(reservations.orderLineId, orderLineId),
          eq(reservations.state, 'pending'),
        ),
      )
      .orderBy(reservations.id)
  }

  /**
   * Move the balance row and RETURN it. UPDATE first: Postgres evaluates CHECK constraints on the proposed
   * INSERT row before it looks for a conflict, so `INSERT ... ON CONFLICT DO UPDATE` with a negative delta would
   * trip `on_hand >= 0` even when the existing row has plenty. A fresh row is inserted only when none exists.
   */
  private async applyBalance(
    tx: Db,
    b: {
      lotId: string
      locationId: string
      onHandDelta: number
      reservedDelta: number
      negativeAllowed: boolean
    },
  ): Promise<BalanceRow> {
    const { tenantId } = currentTenant()
    const where = and(
      eq(stockBalances.tenantId, tenantId),
      eq(stockBalances.lotId, b.lotId),
      eq(stockBalances.locationId, b.locationId),
    )
    const move = () =>
      tx
        .update(stockBalances)
        .set({
          onHand: sql`${stockBalances.onHand} + ${b.onHandDelta}`,
          reserved: sql`${stockBalances.reserved} + ${b.reservedDelta}`,
          version: sql`${stockBalances.version} + 1`,
          updatedAt: new Date(),
        })
        .where(where)
        .returning()
    try {
      let [row] = await move()
      if (!row) {
        ;[row] = await tx
          .insert(stockBalances)
          .values({
            tenantId,
            lotId: b.lotId,
            locationId: b.locationId,
            onHand: b.onHandDelta,
            reserved: b.reservedDelta,
            negativeAllowed: b.negativeAllowed,
            version: 1,
          })
          .onConflictDoNothing()
          .returning()
      }
      if (!row) [row] = await move() // lost the race to create the row; it exists now
      if (!row)
        throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'balance upsert returned nothing' })
      return row
    } catch (err) {
      const constraint = pgConstraint(err)
      if (constraint === 'stock_balances_on_hand_nonneg') {
        throw new ORPCError('BAD_REQUEST', {
          message: `insufficient stock: lot ${b.lotId} at location ${b.locationId} would go below zero (delta ${b.onHandDelta})`,
          data: { lotId: b.lotId, locationId: b.locationId, qtyDelta: b.onHandDelta },
        })
      }
      if (constraint === 'stock_balances_reserved_nonneg') {
        throw new ORPCError('BAD_REQUEST', {
          message: `reserved pieces of lot ${b.lotId} at location ${b.locationId} would go below zero`,
          data: { lotId: b.lotId, locationId: b.locationId },
        })
      }
      throw err
    }
  }
}

/** Drizzle wraps driver errors; the CHECK/UNIQUE name is on `cause.constraint`. */
export function pgConstraint(err: unknown): string | undefined {
  const e = err as { constraint?: string; cause?: { constraint?: string } }
  return e.cause?.constraint ?? e.constraint
}
