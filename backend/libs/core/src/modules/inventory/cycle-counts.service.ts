import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, asc, desc, eq, inArray, lt, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  CountCycleCountInput,
  CountCycleCountOutput,
  CycleCount,
  CycleCountDetail,
  CycleCountGetInput,
  CycleCountGetOutput,
  CycleCountLine,
  CycleCountsListInput,
  CycleCountsListOutput,
  OpenCycleCountInput,
  OpenCycleCountOutput,
  PostCycleCountInput,
  PostCycleCountOutput,
} from '@dos/contracts'
import { uuidv7 } from '@dos/domain'
import {
  cycleCountLines,
  cycleCounts,
  locations,
  stockBalances,
  stockLots,
  withTenant,
  type ActorRole,
  type Db,
} from '@dos/db'
import {
  BACK_OFFICE,
  currentTenant,
  DB,
  idempotent,
  requireDb,
  requireRole,
} from '../../platform/index.js'
import { toEntry } from './inventory.mappers.js'
import { InventoryService, type LedgerEntryInput } from './inventory.service.js'

type OpenIn = z.infer<typeof OpenCycleCountInput>
type OpenOut = z.infer<typeof OpenCycleCountOutput>
type CountIn = z.infer<typeof CountCycleCountInput>
type CountOut = z.infer<typeof CountCycleCountOutput>
type PostIn = z.infer<typeof PostCycleCountInput>
type PostOut = z.infer<typeof PostCycleCountOutput>
type ListIn = z.infer<typeof CycleCountsListInput>
type ListOut = z.infer<typeof CycleCountsListOutput>
type GetIn = z.infer<typeof CycleCountGetInput>
type GetOut = z.infer<typeof CycleCountGetOutput>

type CountRow = typeof cycleCounts.$inferSelect
type LineRow = typeof cycleCountLines.$inferSelect

/** Who opens and counts: the people who physically keep the stock (permissions.ts STOCK_KEEPERS). */
const STOCK_KEEPERS: readonly ActorRole[] = ['owner', 'manager', 'warehouse', 'system']
/** Who reads a count: the keepers plus the accountant and the crew (STOCK_VIEWERS). */
const STOCK_VIEWERS: readonly ActorRole[] = [...STOCK_KEEPERS, 'accountant', 'delivery']

/**
 * A physical count of one location (docs/23 §8.18): `open` freezes what the ledger says per lot,
 * `count` records what the floor found (blind, in as many calls as it takes), `post` writes one
 * `cycle_count` ledger row per line whose variance is not zero — through `InventoryService.post`,
 * which is the only writer of `stock_ledger` and `stock_balances`. Pieces only, never a cost.
 *
 * `open → counted → posted`; a count is never edited after posting and never deleted.
 */
@Injectable()
export class CycleCountsService {
  constructor(
    @Optional() @Inject(DB) private readonly db: Db | null,
    private readonly inventory: InventoryService,
  ) {}

  async open(input: OpenIn): Promise<OpenOut> {
    requireRole(STOCK_KEEPERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const [location] = await tx
          .select({ id: locations.id })
          .from(locations)
          .where(and(eq(locations.tenantId, ctx.tenantId), eq(locations.id, input.locationId)))
          .limit(1)
        if (!location)
          throw new ORPCError('NOT_FOUND', { message: `location ${input.locationId} not found` })
        const [clash] = await tx
          .select({ id: cycleCounts.id })
          .from(cycleCounts)
          .where(and(eq(cycleCounts.tenantId, ctx.tenantId), eq(cycleCounts.id, input.id)))
          .limit(1)
        if (clash)
          throw new ORPCError('CONFLICT', { message: `cycle count ${input.id} already exists` })
        const balances = await tx
          .select({ lotId: stockBalances.lotId, onHand: stockBalances.onHand })
          .from(stockBalances)
          .where(
            and(
              eq(stockBalances.tenantId, ctx.tenantId),
              eq(stockBalances.locationId, input.locationId),
              input.lotIds && input.lotIds.length > 0
                ? inArray(stockBalances.lotId, input.lotIds)
                : undefined,
            ),
          )
          .orderBy(asc(stockBalances.lotId))
          .limit(500)
        // A lot the location has never held may still be counted (it may be sitting there unrecorded).
        const known = new Set(balances.map((b) => b.lotId))
        const extra = (input.lotIds ?? []).filter((id) => !known.has(id))
        if (extra.length > 0) {
          const lots = await tx
            .select({ id: stockLots.id })
            .from(stockLots)
            .where(and(eq(stockLots.tenantId, ctx.tenantId), inArray(stockLots.id, extra)))
          if (lots.length !== extra.length)
            throw new ORPCError('BAD_REQUEST', { message: 'unknown lotId in lotIds' })
        }
        const expected = [
          ...balances.map((b) => ({ lotId: b.lotId, expectedQty: b.onHand })),
          ...extra.map((lotId) => ({ lotId, expectedQty: 0 })),
        ]
        if (expected.length === 0)
          throw new ORPCError('BAD_REQUEST', {
            message: 'nothing to count: the location holds no lot and lotIds is empty',
          })
        const [row] = await tx
          .insert(cycleCounts)
          .values({
            id: input.id,
            tenantId: ctx.tenantId,
            locationId: input.locationId,
            status: 'open',
            note: input.note ?? null,
          })
          .returning()
        if (!row)
          throw new ORPCError('INTERNAL_SERVER_ERROR', {
            message: 'cycle count insert returned nothing',
          })
        await tx.insert(cycleCountLines).values(
          expected.map((e) => ({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            cycleCountId: row.id,
            lotId: e.lotId,
            expectedQty: e.expectedQty,
            countedQty: null,
          })),
        )
        return { item: await this.detail(tx, row) }
      }),
    )
  }

  /** The blind count. Lines may arrive in several calls; the count becomes `counted` once every line has a number. */
  async count(input: CountIn): Promise<CountOut> {
    requireRole(STOCK_KEEPERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const row = await this.lock(tx, input.id)
        if (row.status !== 'open' && row.status !== 'counted')
          throw new ORPCError('CONFLICT', {
            message: `cycle count ${row.id} is ${row.status}; only an open count takes numbers`,
          })
        const lines = await this.lines(tx, row.id)
        const byLot = new Map(lines.map((l) => [l.lotId, l]))
        const now = new Date()
        for (const entry of input.lines) {
          const line = byLot.get(entry.lotId)
          if (!line)
            throw new ORPCError('BAD_REQUEST', {
              message: `lot ${entry.lotId} is not on cycle count ${row.id}`,
            })
          await tx
            .update(cycleCountLines)
            .set({ countedQty: entry.countedPcs, updatedAt: now })
            .where(eq(cycleCountLines.id, line.id))
          line.countedQty = entry.countedPcs
        }
        const complete = lines.every((l) => l.countedQty !== null)
        const [updated] = await tx
          .update(cycleCounts)
          .set({
            status: complete ? 'counted' : 'open',
            countedBy: ctx.actorId,
            countedAt: now,
            updatedAt: now,
          })
          .where(eq(cycleCounts.id, row.id))
          .returning()
        return { item: await this.detail(tx, updated ?? row) }
      }),
    )
  }

  /**
   * Posts the differences: one `cycle_count` ledger row per line whose variance is not zero, keyed
   * `cycle_count:<countId>:<lotId>` so a replay writes nothing twice. Back office only: this is the
   * step that changes the books' quantity.
   */
  async post(input: PostIn): Promise<PostOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const row = await this.lock(tx, input.id)
        if (row.status === 'posted') return { item: await this.detail(tx, row), entries: [] }
        if (row.status !== 'counted')
          throw new ORPCError('CONFLICT', {
            message: `cycle count ${row.id} is ${row.status}; every line must be counted before posting`,
          })
        const lines = await this.lines(tx, row.id)
        const entries: LedgerEntryInput[] = lines
          .filter((l) => l.countedQty !== null && l.countedQty - l.expectedQty !== 0)
          .map((l) => ({
            lotId: l.lotId,
            locationId: row.locationId,
            qtyDelta: (l.countedQty ?? 0) - l.expectedQty,
            reason: 'cycle_count' as const,
            refType: 'cycle_count',
            refId: row.id,
            idempotencyKey: `cycle_count:${row.id}:${l.lotId}`,
            ...(row.note ? { note: row.note } : {}),
          }))
        const posted = await this.inventory.post(tx, entries)
        const now = new Date()
        const [updated] = await tx
          .update(cycleCounts)
          .set({ status: 'posted', postedBy: ctx.actorId, postedAt: now, updatedAt: now })
          .where(eq(cycleCounts.id, row.id))
          .returning()
        return { item: await this.detail(tx, updated ?? row), entries: posted.entries.map(toEntry) }
      }),
    )
  }

  async list(input: ListIn): Promise<ListOut> {
    requireRole(STOCK_VIEWERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      const filters: (SQL | undefined)[] = [
        eq(cycleCounts.tenantId, ctx.tenantId),
        input.locationId ? eq(cycleCounts.locationId, input.locationId) : undefined,
        input.status ? eq(cycleCounts.status, input.status) : undefined,
        input.cursor ? lt(cycleCounts.id, input.cursor) : undefined,
      ]
      const rows = await tx
        .select()
        .from(cycleCounts)
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(desc(cycleCounts.id))
        .limit(input.limit + 1)
      const page = rows.slice(0, input.limit)
      const counts = await this.lineCounts(
        tx,
        page.map((r) => r.id),
      )
      const last = page[page.length - 1]
      return {
        items: page.map((r) => toCount(r, counts.get(r.id) ?? 0)),
        nextCursor: rows.length > input.limit && last ? last.id : null,
      }
    })
  }

  async get(input: GetIn): Promise<GetOut> {
    requireRole(STOCK_VIEWERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      const [row] = await tx
        .select()
        .from(cycleCounts)
        .where(and(eq(cycleCounts.tenantId, ctx.tenantId), eq(cycleCounts.id, input.id)))
        .limit(1)
      if (!row) throw new ORPCError('NOT_FOUND', { message: `cycle count ${input.id} not found` })
      return { item: await this.detail(tx, row) }
    })
  }

  // -------------------------------------------------------------------------------------------------------------

  private async lock(tx: Db, id: string): Promise<CountRow> {
    const { tenantId } = currentTenant()
    const [row] = await tx
      .select()
      .from(cycleCounts)
      .where(and(eq(cycleCounts.tenantId, tenantId), eq(cycleCounts.id, id)))
      .for('update')
    if (!row) throw new ORPCError('NOT_FOUND', { message: `cycle count ${id} not found` })
    return row
  }

  private lines(tx: Db, cycleCountId: string): Promise<LineRow[]> {
    return tx
      .select()
      .from(cycleCountLines)
      .where(eq(cycleCountLines.cycleCountId, cycleCountId))
      .orderBy(asc(cycleCountLines.lotId))
  }

  private async lineCounts(tx: Db, ids: readonly string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map()
    const rows = await tx
      .select({ id: cycleCountLines.cycleCountId })
      .from(cycleCountLines)
      .where(inArray(cycleCountLines.cycleCountId, [...ids]))
    const out = new Map<string, number>()
    for (const r of rows) out.set(r.id, (out.get(r.id) ?? 0) + 1)
    return out
  }

  private async detail(tx: Db, row: CountRow): Promise<CycleCountDetail> {
    const lines = await this.lines(tx, row.id)
    const lots = new Map(
      (
        await tx
          .select({
            id: stockLots.id,
            variantId: stockLots.variantId,
            batchNo: stockLots.batchNo,
            expiryDate: stockLots.expiryDate,
          })
          .from(stockLots)
          .where(
            inArray(
              stockLots.id,
              lines.map((l) => l.lotId),
            ),
          )
      ).map((l) => [l.id, l]),
    )
    const items: CycleCountLine[] = lines.map((l) => {
      const lot = lots.get(l.lotId)
      return {
        id: l.id,
        lotId: l.lotId,
        variantId: lot?.variantId ?? '',
        batchNo: lot?.batchNo ?? '',
        expiryDate: lot?.expiryDate ?? null,
        expectedPcs: l.expectedQty,
        countedPcs: l.countedQty,
        variancePcs: l.countedQty === null ? null : l.countedQty - l.expectedQty,
      }
    })
    return { ...toCount(row, items.length), lines: items }
  }
}

function toCount(row: CountRow, lineCount: number): CycleCount {
  return {
    id: row.id,
    locationId: row.locationId,
    status: row.status,
    lineCount,
    countedBy: row.countedBy,
    countedAt: row.countedAt?.toISOString() ?? null,
    postedBy: row.postedBy,
    postedAt: row.postedAt?.toISOString() ?? null,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  }
}
