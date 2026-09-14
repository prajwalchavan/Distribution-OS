import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, desc, eq, isNotNull, isNull, sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  ConfirmPackInput,
  ConfirmPackOutput,
  PackGetInput,
  PackGetOutput,
  PacksListInput,
  PacksListOutput,
} from '@dos/contracts'
import type { OrderState } from '@dos/domain'
import { loadSheets, packConfirmations, pickLines, withTenant, type Db } from '@dos/db'
import { currentTenant, DB, idempotent, requireDb, requireRole } from '../../platform/index.js'
import { BillingService, type IssueForPackLine } from '../billing/index.js'
import { InventoryService } from '../inventory/index.js'
import { OrdersService, type FulfilmentLine } from '../orders/index.js'
import { LoadSheetsService } from './load-sheets.service.js'
import { PicklistsService } from './picklists.service.js'
import {
  activeWarehouseLocation,
  dayWindow,
  FULFILMENT_READERS,
  isUniqueViolation,
  MAX_PICK_ROWS,
  pgConstraint,
  WAREHOUSE_DESK,
} from './warehouse.internals.js'
import { packLines, toPackConfirmation, type PackRow } from './warehouse.mappers.js'

type ConfirmIn = z.infer<typeof ConfirmPackInput>
type ConfirmOut = z.infer<typeof ConfirmPackOutput>
type ListIn = z.infer<typeof PacksListInput>
type ListOut = z.infer<typeof PacksListOutput>
type GetIn = z.infer<typeof PackGetInput>
type GetOut = z.infer<typeof PackGetOutput>

/** An order may be packed from any state where the goods are still in the godown. */
const PACKABLE_STATES = new Set<OrderState>(['confirmed', 'picking', 'packed'])

interface LinePack {
  line: FulfilmentLine
  picks: { lotId: string; qtyPcs: number }[]
  paidQtyPcs: number
  freeQtyPcs: number
}

/**
 * THE HAND-OVER FROM BILLING (docs/plans/00-coordination.md §4, cycle 2, step 3).
 *
 * Until this file existed, `billing.invoices.issue` did the stock-and-state half of packing itself
 * because the warehouse module did not exist. That procedure is now DELETED. `packs.confirm` is the
 * only way a pack invoice is issued, and it does everything in ONE transaction, in this order:
 *
 *   1. the picked pieces leave as `sale` ledger rows and the holds close — `InventoryService.postPick`,
 *      keyed `pack:<orderId>:<orderLineId>`, so a retry writes nothing a second time;
 *   2. `OrdersService.recordPick` writes back `sales_order_lines.picked_qty_pcs`;
 *   3. the `pack_confirmations` row is inserted — `UNIQUE(tenant_id, order_id)` is what makes "one
 *      invoice per order, for ever" a database guarantee rather than a code convention;
 *   4. `OrdersService.applyFulfilmentEvent('pack')` moves the order, writing its transition row and the
 *      `OrderPacked` outbox event;
 *   5. `BillingService.issueForPack` issues the document FROM THE SAME LOT QUANTITIES, so the invoice
 *      lines equal the ledger rows to the piece.
 *
 * STOCK LEAVES EXACTLY ONCE. Two HTTP callers each posting `sale` rows for one order is the bug this
 * ordering exists to prevent; adding a second caller re-creates it.
 */
@Injectable()
export class PackingService {
  constructor(
    @Optional() @Inject(DB) private readonly db: Db | null,
    private readonly orders: OrdersService,
    private readonly inventory: InventoryService,
    private readonly billing: BillingService,
    private readonly picklists: PicklistsService,
    /** Same module, no cycle: `packs.list?status=awaiting_load` asks it which bills are on the road. */
    private readonly loadSheets: LoadSheetsService,
  ) {}

  async confirm(input: ConfirmIn): Promise<ConfirmOut> {
    requireRole(WAREHOUSE_DESK)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const order = await this.orders.lockOrder(tx, input.orderId)
        if (!PACKABLE_STATES.has(order.state))
          throw new ORPCError('CONFLICT', {
            message: `order ${order.orderNo ?? order.id} is ${order.state}; cartons are taped shut while it is confirmed, picking or packed`,
          })
        await this.assertNotAlreadyPacked(tx, order.id)
        const locationId = order.fulfilFromLocationId ?? (await activeWarehouseLocation(tx))
        const packs = await this.whatLeftTheRack(tx, order.id, locationId)

        // 1 + 2: the pieces leave, the holds close, the order line records what was taken.
        const billingLines: IssueForPackLine[] = []
        for (const pack of packs) {
          await this.inventory.postPick(tx, {
            orderLineId: pack.line.orderLineId,
            locationId,
            picks: pack.picks,
            refType: 'pack',
            refId: order.id,
            idempotencyKey: `pack:${order.id}:${pack.line.orderLineId}`,
          })
          billingLines.push(...this.splitPaidAndFree(pack))
        }
        await this.orders.recordPick(
          tx,
          order.id,
          packs.map((p) => ({ orderLineId: p.line.orderLineId, pickedQtyPcs: p.paidQtyPcs })),
        )

        // 3: the row that makes a second pack of this order impossible.
        const shortPacked = packs.some((p) => p.paidQtyPcs < p.line.qtyPcs)
        const picklistId = await this.picklistOf(tx, order.id)
        const row = await this.insertPack(tx, {
          id: input.id,
          orderId: order.id,
          picklistId,
          packages: input.packages,
          weightGrams: input.weightGrams ?? null,
          shortPacked,
        })

        // 4: the order moves. `orderMachine` has no `confirmed → packed` edge, so an order packed
        // straight off the shelf still walks through `picking` — the transitions are the audit trail.
        const deviceId = input.deviceId ?? null
        if (order.state === 'confirmed')
          await this.orders.applyFulfilmentEvent(tx, order.id, 'start_picking', deviceId, null)
        await this.orders.applyFulfilmentEvent(tx, order.id, 'pack', deviceId, null)

        // 5: the document, from exactly the quantities that just left.
        let invoice: ConfirmOut['invoice'] = null
        if (input.issueInvoice && billingLines.length > 0) {
          const issued = await this.billing.issueForPack(tx, {
            orderId: order.id,
            packConfirmationId: row.id,
            lines: billingLines,
            issuedBy: ctx.actorId,
            deviceId,
          })
          await tx
            .update(packConfirmations)
            .set({ invoiceId: issued.id, updatedAt: new Date() })
            .where(eq(packConfirmations.id, row.id))
          row.invoiceId = issued.id
          invoice = {
            id: issued.id,
            invoiceNo: issued.invoiceNo,
            totalPaise: issued.totalPaise,
          }
        }
        if (picklistId !== null) await this.picklists.markPackedIfComplete(tx, picklistId)

        return {
          item: toPackConfirmation(row),
          lines: await packLines(tx, order.id, this.orders),
          invoice,
        }
      }),
    )
  }

  async list(input: ListIn): Promise<ListOut> {
    requireRole(FULFILMENT_READERS)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const filters: (SQL | undefined)[] = [
        ...dayWindow(packConfirmations.packedAt, input.from, input.to),
        input.picklistId ? eq(packConfirmations.picklistId, input.picklistId) : undefined,
        input.orderId ? eq(packConfirmations.orderId, input.orderId) : undefined,
        input.invoiced === undefined
          ? undefined
          : input.invoiced
            ? isNotNull(packConfirmations.invoiceId)
            : isNull(packConfirmations.invoiceId),
        /*
         * `awaiting_load` is loadSheets.create's own acceptance rule (DOS-133): the order is still `packed`
         * — asked of the orders module, which owns `sales_orders` — AND it is on no DRAFT sheet, AND its
         * bill is not riding back on a van that has not checked in (QA DOS-172, applied to the page below:
         * delivery answers it). A confirmed sheet holds nothing: `return_undelivered` puts an order back to
         * `packed` while its confirmed sheet still lists it, and once its trip checks in it is loaded again
         * on a fresh sheet.
         */
        input.status === 'awaiting_load'
          ? this.orders.orderInState(packConfirmations.orderId, 'packed')
          : undefined,
        input.status === 'awaiting_load'
          ? sql`not ${onDraftLoadSheet(packConfirmations.orderId)}`
          : undefined,
        /*
         * Keyset on the cursor pack's own (created_at, id), read inside this tenant's transaction, so the
         * comparison keeps Postgres's microseconds. No filter in the subquery: a pack that went onto a
         * sheet between two pages still anchors the next one. An unknown cursor matches nothing.
         */
        input.cursor
          ? sql`(${packConfirmations.createdAt}, ${packConfirmations.id}) < (select c.created_at, c.id from pack_confirmations c where c.id = ${input.cursor})`
          : undefined,
      ]
      const rows = await tx
        .select()
        .from(packConfirmations)
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        /*
         * Newest first by SERVER time (DOS-133, the DOS-023 rule for picklists). Ids are made on the
         * device and the demo seed's are hashes, so id order is not age: a pack made today sorted below
         * every seeded pack and never reached W7's first page. `pack_confirmations_created_idx` serves it.
         */
        .orderBy(desc(packConfirmations.createdAt), desc(packConfirmations.id))
        .limit(input.limit + 1)
      const scanned = rows.slice(0, input.limit)
      // QA DOS-172: a bill riding back on a van that has not checked in is scanned and left out — one batched
      // question to delivery per page. `nextCursor` stays the last SCANNED pack, so a page may hold fewer
      // than `limit` while it is set (the planning board's own convention).
      const onTheRoad =
        input.status === 'awaiting_load'
          ? await this.loadSheets.heldOnTheRoad(
              tx,
              scanned.map((p) => p.invoiceId).filter((id): id is string => id !== null),
            )
          : new Map<string, unknown>()
      const page = scanned.filter((p) => p.invoiceId === null || !onTheRoad.has(p.invoiceId))
      const orders = await this.orders.fulfilmentOrders(
        tx,
        page.map((p) => p.orderId),
      )
      const byOrder = new Map(orders.map((o) => [o.orderId, o]))
      const invoices = await this.billing.invoiceRefs(
        tx,
        page.map((p) => p.invoiceId).filter((id): id is string => id !== null),
      )
      const lastScanned = scanned[scanned.length - 1]
      return {
        items: page.map((p) => {
          const order = byOrder.get(p.orderId)
          return {
            ...toPackConfirmation(p),
            orderNo: order?.orderNo ?? null,
            retailerId: order?.retailerId ?? p.orderId,
            retailerName: order?.retailerName ?? '',
            invoiceNo: p.invoiceId ? (invoices.get(p.invoiceId)?.invoiceNo ?? null) : null,
          }
        }),
        nextCursor: rows.length > input.limit && lastScanned ? lastScanned.id : null,
      }
    })
  }

  async get(input: GetIn): Promise<GetOut> {
    requireRole(FULFILMENT_READERS)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const [row] = await tx
        .select()
        .from(packConfirmations)
        .where(eq(packConfirmations.id, input.id))
      if (!row)
        throw new ORPCError('NOT_FOUND', { message: `pack confirmation ${input.id} not found` })
      return { item: toPackConfirmation(row), lines: await packLines(tx, row.orderId, this.orders) }
    })
  }

  // -------------------------------------------------------------------------------------------------------------

  /**
   * What is physically going into the cartons, line by line and lot by lot.
   *
   * The recorded picks are the truth where a wave exists. Where one does not — a two-person distributor
   * packing straight off the order, and the seed's own history — the pieces the order has HELD since
   * confirm are what is on the shelf for it, and `postPick` closes exactly those holds. Either way the
   * quantities that leave, the quantities written back to the order line and the quantities billed are
   * the same three numbers.
   */
  private async whatLeftTheRack(tx: Db, orderId: string, locationId: string): Promise<LinePack[]> {
    const lines = await this.orders.fulfilmentLines(tx, [orderId])
    const picked = await tx
      .select({
        orderLineId: pickLines.orderLineId,
        lotId: pickLines.lotId,
        qtyPcs: sql<number>`sum(${pickLines.pickedQtyPcs})`,
      })
      .from(pickLines)
      .where(and(eq(pickLines.orderId, orderId), sql`${pickLines.pickedQtyPcs} > 0`))
      .groupBy(pickLines.orderLineId, pickLines.lotId)
    const byLine = new Map<string, { lotId: string; qtyPcs: number }[]>()
    for (const row of picked) {
      if (row.lotId === null) continue
      const group = byLine.get(row.orderLineId) ?? []
      group.push({ lotId: row.lotId, qtyPcs: Number(row.qtyPcs) })
      byLine.set(row.orderLineId, group)
    }
    const unpicked = lines.filter((l) => !byLine.has(l.orderLineId))
    if (unpicked.length > 0) {
      const held = await this.inventory.listReservations(tx, {
        orderLineIds: unpicked.map((l) => l.orderLineId),
        locationId,
        state: 'pending',
        limit: MAX_PICK_ROWS,
      })
      for (const hold of [...held].reverse()) {
        if (hold.lotId === null) continue
        const group = byLine.get(hold.orderLineId) ?? []
        group.push({ lotId: hold.lotId, qtyPcs: hold.qtyPcs })
        byLine.set(hold.orderLineId, group)
      }
    }
    return lines.map((line) => {
      const picks = byLine.get(line.orderLineId) ?? []
      const total = picks.reduce((n, p) => n + p.qtyPcs, 0)
      const paidQtyPcs = Math.min(total, line.qtyPcs)
      return {
        line,
        picks,
        paidQtyPcs,
        freeQtyPcs: Math.min(total - paidQtyPcs, line.freeQtyPcs),
      }
    })
  }

  /**
   * The invoice bills the PAID pieces and lists the free ones beside them, per lot. Paid pieces come
   * off the rack first (the same rule the wave used when it spread the ask across lots), so a short
   * pick costs the shop its free case before it costs it a billed one.
   */
  private splitPaidAndFree(pack: LinePack): IssueForPackLine[] {
    let paidLeft = pack.paidQtyPcs
    let freeLeft = pack.freeQtyPcs
    const out: IssueForPackLine[] = []
    for (const pick of pack.picks) {
      const qtyPcs = Math.min(paidLeft, pick.qtyPcs)
      paidLeft -= qtyPcs
      const freeQtyPcs = Math.min(pick.qtyPcs - qtyPcs, freeLeft)
      freeLeft -= freeQtyPcs
      if (qtyPcs === 0 && freeQtyPcs === 0) continue
      out.push({ orderLineId: pack.line.orderLineId, lotId: pick.lotId, qtyPcs, freeQtyPcs })
    }
    return out
  }

  private async assertNotAlreadyPacked(tx: Db, orderId: string): Promise<void> {
    const [existing] = await tx
      .select({ id: packConfirmations.id })
      .from(packConfirmations)
      .where(eq(packConfirmations.orderId, orderId))
      .limit(1)
    if (existing)
      throw new ORPCError('CONFLICT', {
        message: `order ${orderId} was already packed as ${existing.id}; a second pack would issue a second invoice`,
      })
  }

  /** The live wave this order was picked on, if any — stamped on the confirmation for the day list. */
  private async picklistOf(tx: Db, orderId: string): Promise<string | null> {
    const live = await this.picklists.livePicklistByOrder(tx, [orderId])
    return live.get(orderId) ?? null
  }

  private async insertPack(
    tx: Db,
    values: {
      id: string
      orderId: string
      picklistId: string | null
      packages: number
      weightGrams: number | null
      shortPacked: boolean
    },
  ): Promise<PackRow> {
    const { tenantId, actorId } = currentTenant()
    try {
      const [row] = await tx
        .insert(packConfirmations)
        .values({ ...values, tenantId, packedBy: actorId, packedAt: new Date() })
        .returning()
      if (!row)
        throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'pack insert returned nothing' })
      return row
    } catch (err) {
      if (isUniqueViolation(err)) {
        if (pgConstraint(err) === 'pack_confirmations_order_uniq')
          throw new ORPCError('CONFLICT', {
            message: `order ${values.orderId} already has a pack confirmation`,
          })
        throw new ORPCError('CONFLICT', {
          message: `pack confirmation ${values.id} already exists; generate a new id`,
        })
      }
      throw err
    }
  }
}

/**
 * "This order is on a DRAFT load sheet", as a correlated predicate for `packs.list?status=awaiting_load`
 * (DOS-133). Only a draft holds an order (QA DOS-172): a confirmed sheet is the record of one load-out, and
 * a packed order it lists came back undelivered. The SAME rule as `LoadSheetsService.onADraftSheet`
 * (load-sheets.service.ts), which `loadSheets.create` refuses on. The rule exists twice; the DOS-133 spec in
 * warehouse.spec.ts is the tie (create accepts every row the list offers), so a change to one changes both.
 * The tenant fence is literal, as in `onADraftSheet`.
 */
function onDraftLoadSheet(orderId: SQLWrapper): SQL {
  const { tenantId } = currentTenant()
  return sql`exists (select 1 from ${loadSheets} ls where ls.tenant_id = ${tenantId} and ls.status = 'draft' and ls.order_ids @> jsonb_build_array(${orderId}))`
}
