import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Db } from '../client.js'
import type { stockLedger } from '../schema/index.js'
import {
  cycleCountLines,
  cycleCounts,
  packConfirmations,
  pickLines,
  salesOrderLines,
  stockBalances,
  syncErrors,
} from '../schema/index.js'
import { insertMany, postLedger } from './db-helpers.js'
import { demoId } from './ids.js'
import type { PeopleResult } from './people.js'
import type { StockResult } from './stock.js'
import { atIstTime, daysAgo, occurred, TODAY } from './util.js'

/**
 * The rows the platform-gaps procedures (docs/23 §8) answer with, on top of the module seeds:
 *
 *  - the two packs `seedWarehouse` leaves PARKED (`invoice_id` null) get the `pack` stock-ledger rows a
 *    real `packs.confirm` writes, so `billing.invoices.issueForPack` can rebuild the (line × lot)
 *    split and bill one of them;
 *  - an OPEN cycle count of the godown with three lots, so `inventory.cycleCounts.count/post` have a
 *    count to work on and the warehouse home shows one waiting;
 *  - a rejected upload of Rahul's, so `sync.errors.list` has a tray to show even before the smoke
 *    harness has uploaded anything.
 *
 * Idempotent like every other seed module: deterministic ids, `onConflictDoNothing`.
 */
export async function seedPlatformGaps(
  db: Db,
  tenantId: string,
  stock: StockResult,
  people: PeopleResult,
): Promise<void> {
  await packLedgerForParkedPacks(db, tenantId, stock, people)
  await openCycleCount(db, tenantId, stock, people)
  await rejectedUpload(db, tenantId, people)
}

async function packLedgerForParkedPacks(
  db: Db,
  tenantId: string,
  stock: StockResult,
  people: PeopleResult,
): Promise<void> {
  const parked = await db
    .select({
      id: packConfirmations.id,
      orderId: packConfirmations.orderId,
      packedAt: packConfirmations.packedAt,
    })
    .from(packConfirmations)
    .where(and(eq(packConfirmations.tenantId, tenantId), isNull(packConfirmations.invoiceId)))
  if (parked.length === 0) return
  const godown = await godownOf(db, tenantId)
  if (!godown) return
  const orderIds = parked.map((p) => p.orderId)
  // What was picked, where the wave recorded it; the order line itself where the pack was parked
  // straight off the shelf (the billing seed's "packs without a bill" queue has no wave).
  const picks = await db
    .select({
      orderId: pickLines.orderId,
      orderLineId: pickLines.orderLineId,
      lotId: pickLines.lotId,
      qtyPcs: pickLines.pickedQtyPcs,
    })
    .from(pickLines)
    .where(and(eq(pickLines.tenantId, tenantId), inArray(pickLines.orderId, orderIds)))
  const picked = new Set(picks.map((p) => p.orderId))
  const lines = await db
    .select({
      orderId: salesOrderLines.orderId,
      orderLineId: salesOrderLines.id,
      variantId: salesOrderLines.variantId,
      qtyPcs: salesOrderLines.qtyPcs,
      freeQtyPcs: salesOrderLines.freeQtyPcs,
    })
    .from(salesOrderLines)
    .where(
      and(
        eq(salesOrderLines.tenantId, tenantId),
        inArray(
          salesOrderLines.orderId,
          orderIds.filter((id) => !picked.has(id)),
        ),
      ),
    )
  const packedAtOf = new Map(parked.map((p) => [p.orderId, p.packedAt]))
  const rows: (typeof stockLedger.$inferInsert)[] = []
  const push = (orderId: string, orderLineId: string, lotId: string, qtyPcs: number): void => {
    if (qtyPcs <= 0) return
    const key = `pack:${orderId}:${orderLineId}:${lotId}`
    rows.push({
      id: demoId('ledger', key),
      tenantId,
      occurredAt: packedAtOf.get(orderId) ?? atIstTime(daysAgo(1), 11, 30),
      lotId,
      locationId: godown,
      qtyDelta: -qtyPcs,
      reason: 'sale',
      refType: 'pack',
      refId: orderId,
      actorId: people.warehouse.id,
      idempotencyKey: key,
    })
  }
  for (const pick of picks)
    if (pick.lotId) push(pick.orderId, pick.orderLineId, pick.lotId, pick.qtyPcs)
  for (const line of lines) {
    const lot = stock.lotsByVariantId.get(line.variantId)?.[0]
    if (!lot) continue
    push(line.orderId, line.orderLineId, lot.id, line.qtyPcs + line.freeQtyPcs)
  }
  // The pack really takes the pieces off the rack: never more than the godown holds, and always with
  // the balance moved alongside the ledger row.
  const onHand = new Map(
    (
      await db
        .select({ lotId: stockBalances.lotId, onHand: stockBalances.onHand })
        .from(stockBalances)
        .where(and(eq(stockBalances.tenantId, tenantId), eq(stockBalances.locationId, godown)))
    ).map((b) => [b.lotId, b.onHand]),
  )
  const clamped = rows.flatMap((row) => {
    const have = onHand.get(row.lotId) ?? 0
    const qty = Math.min(-row.qtyDelta, have)
    if (qty <= 0) return []
    onHand.set(row.lotId, have - qty)
    return [{ ...row, qtyDelta: -qty }]
  })
  await postLedger(db, tenantId, clamped)
  // The pack records what left the rack, as `packs.confirm` does through `recordPick`.
  for (const line of lines)
    await db
      .update(salesOrderLines)
      .set({ pickedQtyPcs: line.qtyPcs })
      .where(and(eq(salesOrderLines.id, line.orderLineId), eq(salesOrderLines.pickedQtyPcs, 0)))
}

let godownCache: string | null | undefined
async function godownOf(db: Db, tenantId: string): Promise<string | null> {
  if (godownCache !== undefined) return godownCache
  const [row] = (
    await db.execute(
      sql`select id from locations where tenant_id = ${tenantId} and kind = 'warehouse' and active order by id limit 1`,
    )
  ).rows as { id: string }[]
  godownCache = row?.id ?? null
  return godownCache
}

async function openCycleCount(
  db: Db,
  tenantId: string,
  stock: StockResult,
  people: PeopleResult,
): Promise<void> {
  const balances = await db
    .select({ lotId: stockBalances.lotId, onHand: stockBalances.onHand })
    .from(stockBalances)
    .where(
      and(
        eq(stockBalances.tenantId, tenantId),
        eq(stockBalances.locationId, stock.godownId),
        sql`${stockBalances.onHand} > 0`,
      ),
    )
    .orderBy(stockBalances.lotId)
    .limit(3)
  if (balances.length === 0) return
  const id = demoId('cycle-count', 'godown-weekly')
  await insertMany(db, cycleCounts, [
    {
      id,
      tenantId,
      locationId: stock.godownId,
      status: 'open',
      note: 'Weekly count of the fast movers',
      createdAt: occurred(atIstTime(TODAY, 8, 15)),
    },
  ])
  await insertMany(
    db,
    cycleCountLines,
    balances.map((b) => ({
      id: demoId('cycle-count-line', `${id}:${b.lotId}`),
      tenantId,
      cycleCountId: id,
      lotId: b.lotId,
      expectedQty: b.onHand,
      countedQty: null,
    })),
  )
  void people
}

async function rejectedUpload(db: Db, tenantId: string, people: PeopleResult): Promise<void> {
  const rahul = people.salespeople.rahul
  await insertMany(db, syncErrors, [
    {
      id: demoId('sync-error', 'rahul-visit-note'),
      tenantId,
      userId: rahul.id,
      deviceId: demoId('device', 'rahul-phone'),
      opId: 'demo-visit-1',
      tableName: 'visits',
      rowId: demoId('visit', 'rahul-rejected'),
      code: 'note_required',
      messageEn: 'Visit note is required',
      messageHi: 'Visit note is required',
      createdAt: atIstTime(daysAgo(1), 17, 42),
    },
  ])
}
