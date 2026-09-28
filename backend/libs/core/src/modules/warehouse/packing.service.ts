import { Inject, Injectable, Optional, type OnModuleInit } from '@nestjs/common'
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
  UnpackOrderInput,
  UnpackOrderOutput,
} from '@dos/contracts'
import type { OrderState } from '@dos/domain'
import { loadSheets, packConfirmations, pickLines, withTenant, type Db } from '@dos/db'
import { istDateWord } from '../../platform/refusal-words.js'
import { currentTenant, DB, idempotent, requireDb, requireRole } from '../../platform/index.js'
import { BillingService, type IssueForPackLine } from '../billing/index.js'
import { coverFromDock, dockLocationId, InventoryService } from '../inventory/index.js'
import { OrdersService, type FulfilmentLine } from '../orders/index.js'
import { LoadSheetsService } from './load-sheets.service.js'
import { PicklistsService } from './picklists.service.js'
import {
  activeWarehouseLocation,
  damagedBin,
  dayWindow,
  FULFILMENT_READERS,
  isUniqueViolation,
  loadLots,
  loadVariantInfo,
  MAX_PICK_ROWS,
  pgConstraint,
  PIN_HOLDERS,
  WAREHOUSE_DESK,
  writeAudit,
} from './warehouse.internals.js'
import {
  assertPackWithinShare,
  batchWords,
  expiredBatch,
  isExpired,
  todayIst,
} from './stock-guards.js'
import { packLines, toPackConfirmation, type PackRow } from './warehouse.mappers.js'

type ConfirmIn = z.infer<typeof ConfirmPackInput>
type ConfirmOut = z.infer<typeof ConfirmPackOutput>
type ListIn = z.infer<typeof PacksListInput>
type ListOut = z.infer<typeof PacksListOutput>
type GetIn = z.infer<typeof PackGetInput>
type GetOut = z.infer<typeof PackGetOutput>
type UnpackIn = z.infer<typeof UnpackOrderInput>
type UnpackOut = z.infer<typeof UnpackOrderOutput>

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
export class PackingService implements OnModuleInit {
  constructor(
    @Optional() @Inject(DB) private readonly db: Db | null,
    private readonly orders: OrdersService,
    private readonly inventory: InventoryService,
    private readonly billing: BillingService,
    private readonly picklists: PicklistsService,
    /** Same module, no cycle: `packs.list?status=awaiting_load` asks it which bills are on the road. */
    private readonly loadSheets: LoadSheetsService,
  ) {}

  /** Vans and trips 4: the desk's cancel of a packed order undoes its pack first, or names its bill. */
  onModuleInit(): void {
    this.orders.registerPackedCancel((tx, order, reason) =>
      this.undoPack(tx, order, reason, 'cancel').then(() => undefined),
    )
  }

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
        // QA DOS-252: an order the picker came back from empty-handed has nothing to tape shut or to bill.
        if (packs.every((p) => p.picks.every((pick) => pick.qtyPcs <= 0)))
          throw new ORPCError('CONFLICT', {
            message: `nothing of ${order.orderNo ?? order.id} was picked, so there is nothing to pack or bill; the desk cancels the order or it is picked again`,
            data: { code: 'nothing_picked' },
          })
        await this.assertStockRules(tx, order, locationId, packs)

        // 1 + 2: the pieces leave, the holds close, the order line records what was taken.
        const billingLines: IssueForPackLine[] = []
        for (const pack of packs) {
          await this.inventory.postPick(tx, {
            orderLineId: pack.line.orderLineId,
            locationId,
            picks: pack.picks,
            refType: 'pack',
            refId: order.id,
            // The pack's own id in the key (vans and trips 4): a pack undone by `unpack` and packed again moves its
            // pieces a second time under a key of its own. Every reader keys on the `pack:<order>:<line>:` prefix.
            idempotencyKey: `pack:${order.id}:${pack.line.orderLineId}:${input.id}`,
          })
          billingLines.push(...this.splitPaidAndFree(pack))
        }
        // QA DOS-247: the pieces that just reached the dock stand there for THIS bill, not for whichever
        // load sheet asks for the batch first.
        await this.inventory.holdOnDock(
          tx,
          packs.flatMap((p) =>
            p.picks.map((pick) => ({
              orderLineId: p.line.orderLineId,
              lotId: pick.lotId,
              qtyPcs: pick.qtyPcs,
            })),
          ),
        )
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

  /**
   * UNDO A PACK THAT HAS NO BILL (architect ruling of 2026-09-28, vans and trips 4; QA verify 2, M1). The desk's
   * "Unpack" on the billing desk's Packed, not billed: `undoPack` puts every piece back and clears the pack, and the
   * order moves `packed → confirmed` through its machine, so the godown waves and picks it again from an in-date
   * batch. Owner and manager only; audited; a replay answers the first reply.
   */
  async unpack(input: UnpackIn): Promise<UnpackOut> {
    requireRole(PIN_HOLDERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const order = await this.orders.lockOrder(tx, input.orderId)
        const name = order.orderNo ?? 'This order'
        if (order.state !== 'packed')
          throw new ORPCError('CONFLICT', {
            message:
              order.state === 'confirmed' || order.state === 'picking'
                ? `${name} is ${order.state}: it has no pack to undo.`
                : `${name} is ${order.state}: only a packed order that has no bill is unpacked.`,
            data: { code: 'not_packed', orderState: order.state },
          })
        const returned = await this.undoPack(tx, order, input.reason, 'unpack')
        const moved = await this.orders.applyFulfilmentEvent(
          tx,
          order.id,
          'unpack',
          input.deviceId ?? null,
          input.reason,
        )
        return { orderId: order.id, orderNo: order.orderNo, orderState: moved.state, returned }
      }),
    )
  }

  /**
   * THE PACK UNDONE (vans and trips 4: "a pack without a bill can be undone by the desk — cancel or unpack — its
   * pieces go back from the dock to the godown, expired ones to the expiry bin, and nothing stays held"). Shared by
   * `unpack` and the desk's `orders.cancel` of a packed order (registered hook), in the caller's transaction and
   * before the order moves:
   *
   *   - a pack with a live bill is refused 409 `cancel_the_bill`, naming the bill — its cancel takes the order with
   *     it; a draft load sheet carrying the order is refused 409 `on_draft_sheet` (cancel the sheet first);
   *   - per (order line, batch), what the pack put on the dock and no undo has taken back yet (its `pack` rows, less
   *     its `unpack` rows) comes off the dock — covered by the line's own dock holds, then by pieces the dock holds
   *     for nobody, never by another bill's; a dock that no longer holds them is 409 `dock_short` and NOTHING moves;
   *   - the pieces go back to the place the pack took them from, or — the batch having expired (before today, IST)
   *     — into the damaged / expiry bin, as `transfer_out` + `transfer_in` under `ref_type = 'unpack'` (keys per
   *     line, pack and batch, so a replay moves nothing twice and `packedLotsByOrder` nets them out);
   *   - the order's dock holds are voided, its pick rows are put back (every sheet), its lines' picked pieces go
   *     back to zero and its pack record is deleted (the device drops it on its next pull), so the order can be
   *     waved, picked and packed again — or is cancelled by the caller.
   *
   * Returns what went where. An order packed with no pack record (none the godown wrote) has nothing to undo.
   */
  private async undoPack(
    tx: Db,
    order: { id: string; orderNo: string | null },
    reason: string,
    how: 'unpack' | 'cancel',
  ): Promise<UnpackOut['returned']> {
    const name = order.orderNo ?? 'This order'
    const [pack] = await tx
      .select()
      .from(packConfirmations)
      .where(eq(packConfirmations.orderId, order.id))
      .limit(1)
      .for('update')
    if (!pack) return []
    if (pack.invoiceId !== null) {
      const bill = (await this.billing.invoiceRefs(tx, [pack.invoiceId])).get(pack.invoiceId)
      if (bill !== undefined && bill.state !== 'cancelled' && bill.state !== 'draft')
        throw new ORPCError('CONFLICT', {
          message:
            how === 'cancel'
              ? `order ${name} is packed and billed (${bill.invoiceNo ?? 'its bill'}): cancel the bill and the order goes with it`
              : `${name} is packed and billed (${bill.invoiceNo ?? 'its bill'}), so it is not unpacked: cancel the bill on the billing desk (the order goes with it), or credit it.`,
          data: { code: 'cancel_the_bill', invoiceId: pack.invoiceId },
        })
    }
    const onDraft = await this.loadSheets.ordersOnADraftSheet(tx, [order.id])
    const first = onDraft[0]
    if (first !== undefined)
      throw new ORPCError('CONFLICT', {
        message: `${name} is on the load sheet for ${first.vehicleRegNo ?? 'a vehicle'} that the godown has not counted out. Cancel that sheet under Load-out first, then ${how === 'cancel' ? 'cancel the order' : 'unpack it'}.`,
        data: { code: 'on_draft_sheet', loadSheetIds: onDraft.map((d) => d.sheetId) },
      })

    // What the pack put on the dock per (line, batch), less what an earlier undo already took back.
    const packRows = await this.inventory.ledgerRowsByRef(tx, { refType: 'pack', refId: order.id })
    const undoRows = await this.inventory.ledgerRowsByRef(tx, {
      refType: 'unpack',
      refId: order.id,
    })
    const claims = new Map<string, { lineId: string; lotId: string; pcs: number; from: string }>()
    const lineOf = (key: string): string => key.split(':')[2] ?? ''
    for (const r of packRows) {
      if (r.qtyDelta >= 0) continue
      const k = `${lineOf(r.idempotencyKey)}:${r.lotId}`
      const was = claims.get(k)
      claims.set(k, {
        lineId: lineOf(r.idempotencyKey),
        lotId: r.lotId,
        pcs: (was?.pcs ?? 0) - r.qtyDelta,
        from: was?.from ?? r.locationId,
      })
    }
    for (const r of undoRows) {
      if (r.qtyDelta <= 0) continue
      const was = claims.get(`${lineOf(r.idempotencyKey)}:${r.lotId}`)
      if (was) was.pcs -= r.qtyDelta
    }
    const open = [...claims.values()].filter((c) => c.pcs > 0 && c.lineId !== '')
    const lines = await this.orders.fulfilmentLines(tx, [order.id])
    const lineIds = lines.map((l) => l.orderLineId)
    const lots = await loadLots(
      tx,
      open.map((c) => c.lotId),
    )
    const items = await loadVariantInfo(
      tx,
      [...lots.values()].map((l) => l.variantId),
    )
    const label = (lotId: string): string => {
      const lot = lots.get(lotId)
      return lot ? batchWords(lot, items.get(lot.variantId)?.variantName) : `batch ${lotId}`
    }
    const returned: UnpackOut['returned'] = []
    if (open.length > 0) {
      const held = await this.inventory.dockHeldFor(tx, lineIds)
      const covers = coverFromDock(
        open.map((c) => ({
          key: `${c.lineId}:${c.lotId}`,
          lotId: c.lotId,
          neededPcs: c.pcs,
          heldPcs: held.get(c.lineId)?.get(c.lotId) ?? 0,
        })),
        await this.inventory.dockBalances(
          tx,
          open.map((c) => c.lotId),
        ),
      )
      const short = covers.filter((c) => c.shortPcs > 0)
      if (short.length > 0)
        throw new ORPCError('CONFLICT', {
          message: `${short.map((c) => `Only ${String(c.neededPcs - c.shortPcs)} pc of ${label(c.lotId)} are on the dock for ${name}, and its pack put ${String(c.neededPcs)} there`).join('; ')}. They were moved off the dock some other way, so the pack is not undone as it stands — nothing moved. Count the dock on the Stock screen first.`,
          data: {
            code: 'dock_short',
            lots: short.map((c) => ({
              lotId: c.lotId,
              neededPcs: c.neededPcs,
              onDockPcs: c.neededPcs - c.shortPcs,
            })),
          },
        })
      await this.inventory.closeDockHolds(tx, lineIds, 'voided')
      const today = todayIst()
      const expired = open.some((c) => {
        const lot = lots.get(c.lotId)
        return lot !== undefined && isExpired(lot, today)
      })
      const bin = expired ? await damagedBin(tx) : null
      const dock = await dockLocationId(tx)
      const places = await this.inventory.locationNames(tx, [
        ...open.map((c) => c.from),
        ...(bin ? [bin.id] : []),
      ])
      const entries: Parameters<InventoryService['post']>[1] = []
      for (const c of open) {
        const lot = lots.get(c.lotId)
        const toBin = bin !== null && lot !== undefined && isExpired(lot, today)
        const to = toBin ? bin.id : c.from
        const key = `unpack:${order.id}:${c.lineId}:${pack.id}:${c.lotId}`
        const note = toBin
          ? `${how === 'cancel' ? 'order cancelled' : 'unpacked'}: ${name}'s pieces expired on ${istDateWord(lot?.expiryDate ?? null)}, into the expiry bin`
          : `${how === 'cancel' ? 'order cancelled' : 'unpacked'}: ${name}'s pieces back from the dock`
        entries.push(
          {
            lotId: c.lotId,
            locationId: dock,
            qtyDelta: -c.pcs,
            reason: 'transfer_out',
            refType: 'unpack',
            refId: order.id,
            idempotencyKey: `${key}:out`,
            note,
          },
          {
            lotId: c.lotId,
            locationId: to,
            qtyDelta: c.pcs,
            reason: 'transfer_in',
            refType: 'unpack',
            refId: order.id,
            idempotencyKey: `${key}:in`,
            note,
          },
        )
        returned.push({
          lotId: c.lotId,
          label: label(c.lotId),
          qtyPcs: c.pcs,
          to: toBin ? 'expiry_bin' : 'godown',
          locationId: to,
          locationName: places.get(to) ?? '',
        })
      }
      await this.inventory.post(tx, entries)
    } else {
      await this.inventory.closeDockHolds(tx, lineIds, 'voided')
    }

    // The picks are history: put back on a live wave (which closes if nothing is left on it), and struck on every
    // other sheet, so a new wave can take the order and its next pack reads only its new picks.
    await this.picklists.putBackOrder(tx, order.id, reason)
    const now = new Date()
    await tx
      .update(pickLines)
      .set({ cancelledAt: now, updatedAt: now })
      .where(and(eq(pickLines.orderId, order.id), isNull(pickLines.cancelledAt)))
    await this.orders.recordPick(
      tx,
      order.id,
      lines.map((l) => ({ orderLineId: l.orderLineId, pickedQtyPcs: 0 })),
    )
    await tx.delete(packConfirmations).where(eq(packConfirmations.id, pack.id))
    await writeAudit(tx, {
      action: how === 'cancel' ? 'warehouse.packs.undo_for_cancel' : 'warehouse.packs.unpack',
      entityType: 'sales_order',
      entityId: order.id,
      before: { packConfirmationId: pack.id, packages: pack.packages, packedAt: pack.packedAt },
      after: {
        reason,
        returned: returned.map((r) => ({ lotId: r.lotId, qtyPcs: r.qtyPcs, to: r.to })),
      },
    })
    return returned
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
        // QA DOS-355: a pack with no bill is not awaiting a load, it is awaiting its bill (the billing desk's
        // "Packed, not billed"); `loadSheets.create` refuses it, so W7 never offers it. A bill cancelled since
        // is dropped from the page below, with the bills still on the road.
        input.status === 'awaiting_load' ? isNotNull(packConfirmations.invoiceId) : undefined,
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
      const invoices = await this.billing.invoiceRefs(
        tx,
        scanned.map((p) => p.invoiceId).filter((id): id is string => id !== null),
      )
      const billLive = (invoiceId: string | null): boolean => {
        const state = invoiceId === null ? undefined : invoices.get(invoiceId)?.state
        return state !== undefined && state !== 'draft' && state !== 'cancelled'
      }
      const page = scanned.filter((p) =>
        input.status === 'awaiting_load'
          ? billLive(p.invoiceId) && !onTheRoad.has(p.invoiceId ?? '')
          : true,
      )
      const orders = await this.orders.fulfilmentOrders(
        tx,
        page.map((p) => p.orderId),
      )
      const byOrder = new Map(orders.map((o) => [o.orderId, o]))
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
    /*
     * Every RECORDED pick row (`picked_at` set: picked, or shorted with a reason), including the ones that
     * took nothing. QA DOS-252: this read used to keep only `picked_qty_pcs > 0`, so a line the picker
     * shorted in full ("Not on the rack", 0 picked) looked unanswered, fell through to the holds below and
     * was billed and moved in full — INV/9052 charged Ekta ₹2,142.00 for 12 toor that never went into a
     * carton. A line with a recorded row is ANSWERED: its picks are what it took, even when that is nothing.
     */
    const picked = await tx
      .select({
        orderLineId: pickLines.orderLineId,
        lotId: pickLines.lotId,
        qtyPcs: sql<number>`sum(${pickLines.pickedQtyPcs})`,
      })
      .from(pickLines)
      .where(
        and(
          eq(pickLines.orderId, orderId),
          sql`(${pickLines.pickedAt} is not null or ${pickLines.pickedQtyPcs} > 0)`,
          isNull(pickLines.cancelledAt),
        ),
      )
      .groupBy(pickLines.orderLineId, pickLines.lotId)
    const byLine = new Map<string, { lotId: string; qtyPcs: number }[]>()
    for (const row of picked) {
      const group = byLine.get(row.orderLineId) ?? []
      const qtyPcs = Number(row.qtyPcs)
      if (row.lotId !== null && qtyPcs > 0) group.push({ lotId: row.lotId, qtyPcs })
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
   * THE PICK IS RE-JUDGED BEFORE ANYTHING MOVES (architect rulings 3 and 7 of 2026-09-28), so a pick recorded
   * before those rules existed — or the holds of an order packed straight off the shelf — cannot become a bill:
   *
   *  - QA DOS-351: no piece of a batch whose expiry is before today (IST) is packed or billed. The refusal names
   *    the order, the item, the batch and the date; the short-dated batch still only warns at pick.
   *  - QA DOS-353: per batch, the pieces leaving the rack are at most what the godown holds for this order plus
   *    what it holds for nobody (read under the balance rows' lock; `postPick` moves them in this transaction),
   *    so an order confirmed first keeps the pieces it was promised. The refusal names the order holding them.
   */
  private async assertStockRules(
    tx: Db,
    order: { id: string; orderNo: string | null },
    locationId: string,
    packs: readonly LinePack[],
  ): Promise<void> {
    const lots = await loadLots(
      tx,
      packs.flatMap((p) => p.picks.map((pick) => pick.lotId)),
    )
    const items = await loadVariantInfo(
      tx,
      [...lots.values()].map((l) => l.variantId),
    )
    const itemOf = (variantId: string): string | undefined => items.get(variantId)?.variantName
    const today = todayIst()
    for (const pack of packs)
      for (const pick of pack.picks) {
        const lot = lots.get(pick.lotId)
        if (pick.qtyPcs <= 0 || lot === undefined || lot.expiryDate === null) continue
        if (!isExpired(lot, today)) continue
        throw expiredBatch({
          what: batchWords(lot, itemOf(lot.variantId)),
          expiryDate: lot.expiryDate,
          pcs: pick.qtyPcs,
          orderNo: order.orderNo,
          atPack: true,
        })
      }
    await assertPackWithinShare(
      tx,
      { inventory: this.inventory, orders: this.orders },
      order,
      locationId,
      packs.map((p) => ({ orderLineId: p.line.orderLineId, picks: p.picks })),
      lots,
      itemOf,
    )
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
