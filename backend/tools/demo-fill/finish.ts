import { contract } from '@dos/contracts'
import type { Ctx } from './context.js'
import { pack, wave } from './day.js'
import { openGate, ownMoneyStaysOwn, supplierCodeOf } from './desk.js'
import { earlier, pages, paymentReference } from './helpers.js'
import { addDays, demoIdDate, demoKey, isDemoId } from './ids.js'
import { loadAndDepart, returnTrip, settleTrip, workDoors, type DriverKey } from './road.js'
import { signOffAndLoad } from './road.js'

/**
 * FINISH YESTERDAY: everything the tool left open under an earlier date is carried to its end the way a crew
 * and a desk would — the held orders decided, the vans' last doors delivered, the vans checked in and settled
 * with the cash handed over, the waves picked and packed (their bills ride today's vans), the supplier bills
 * matched and their goods counted and posted, the draft return issued, the money matched and banked, and a
 * week-old tool bill paid off by bank transfer. Nothing of `date` itself is touched.
 */
export async function finishEarlier(ctx: Ctx, date: string): Promise<void> {
  await decideHeldOrders(ctx, date)
  await finishTrips(ctx, date)
  await finishWaves(ctx, date)
  await finishSupplierBills(ctx, date)
  await issueReturns(ctx, date)
  await matchAndBank(ctx, date)
  await payOldBills(ctx, date)
}

// ------------------------------------------------------------------------------------- held orders

async function decideHeldOrders(ctx: Ctx, date: string): Promise<void> {
  const pending = await pages((cursor) =>
    ctx.read(contract.orders.approvals.list, {
      status: 'pending',
      limit: 200,
      ...(cursor ? { cursor } : {}),
    }),
  )
  for (const a of pending) {
    if (!earlier(a.orderId, date)) continue
    // The shop over its limit is refused until it pays; a rate asked for a regular shop is granted.
    const reject = a.kind === 'credit_limit'
    await ctx.write(
      'yesterday',
      reject ? 'held order refused' : 'held order approved',
      () => ctx.as('manager'),
      contract.orders.approvals.decide,
      {
        idempotencyKey: demoKey(date, 'approval', a.id),
        id: a.id,
        decision: reject ? 'reject' : 'approve',
        note: reject
          ? 'Over the credit limit: collect the dues first'
          : 'Rate agreed for a regular shop',
      },
    )
  }
  // An order an earlier run left as a draft (a crash between create and submit) is placed now.
  const drafts = await pages((cursor) =>
    ctx.read(contract.orders.list, { state: 'draft', limit: 200, ...(cursor ? { cursor } : {}) }),
  )
  for (const o of drafts)
    if (earlier(o.id, date))
      await ctx.write(
        'yesterday',
        'draft placed',
        () => ctx.as('manager'),
        contract.orders.submit,
        {
          idempotencyKey: demoKey(date, 'finish', 'submit', o.id),
          id: o.id,
        },
      )
}

// ------------------------------------------------------------------------------------------- trips

async function finishTrips(ctx: Ctx, date: string): Promise<void> {
  const open = await pages((cursor) =>
    ctx.read(contract.delivery.trips.list, {
      states: ['planned', 'loading', 'active', 'closing'],
      to: addDays(date, -1),
      limit: 200,
      ...(cursor ? { cursor } : {}),
    }),
  )
  for (const t of open) {
    if (!isDemoId(t.id) || t.tripDate >= date) continue
    const driver: DriverKey = t.driverId === ctx.userIds.get('driver2') ? 'driver2' : 'driver1'
    if (t.state === 'planned' || t.state === 'loading') await loadAndDepart(ctx, t.id, driver, date)
    await workDoors(ctx, t.id, driver, date, true)
    await returnTrip(ctx, t.id, driver, date)
    await settleTrip(ctx, t.id, date)
  }
}

// ------------------------------------------------------------------------------------------- waves

async function finishWaves(ctx: Ctx, date: string): Promise<void> {
  // Asked per status: the waves still on the floor are a handful, whatever the history behind them.
  for (const status of ['open', 'picking', 'picked'] as const) {
    const live = await ctx.read(contract.warehouse.picklists.list, { status, limit: 200 })
    for (const pl of live.items) if (earlier(pl.id, date)) await finishWave(ctx, date, pl.id)
  }
  // Earlier orders confirmed and on no wave (a rate approved this morning): one wave, picked and packed.
  const queue = await pages((cursor) =>
    ctx.read(contract.warehouse.queue.list, {
      state: 'confirmed',
      unpicklistedOnly: true,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    }),
  )
  const left = queue.filter((q) => earlier(q.orderId, date)).map((q) => q.orderId)
  if (left.length > 0) await wave(ctx, date, 'carried', left, 'packed')
  // A picked order whose pack never landed (a crash): pack it.
  const picking = await pages((cursor) =>
    ctx.read(contract.orders.list, { state: 'picking', limit: 200, ...(cursor ? { cursor } : {}) }),
  )
  for (const o of picking) if (earlier(o.id, date)) await pack(ctx, date, o.id)
}

async function finishWave(ctx: Ctx, date: string, id: string): Promise<void> {
  let pl = await ctx.read(contract.warehouse.picklists.get, { id })
  if (pl.item.status === 'open') {
    const started = await ctx.write(
      'yesterday',
      'wave started',
      () => ctx.as('godown'),
      contract.warehouse.picklists.start,
      {
        idempotencyKey: demoKey(date, 'finish', 'wave', id, 'start'),
        id,
        assignedTo: ctx.userIds.get('godown'),
      },
    )
    if (!started) return
    pl = started
  }
  if (pl.item.status === 'picking') {
    const todo = pl.item.lines.filter((l) => l.pickedAt === null && (l.lotId ?? l.suggestedLotId))
    if (todo.length > 0) {
      const picked = await ctx.write(
        'yesterday',
        'wave picked',
        () => ctx.as('godown'),
        contract.warehouse.picklists.pick,
        {
          idempotencyKey: demoKey(date, 'finish', 'wave', id, 'pick'),
          id,
          lines: todo.map((l) => ({
            id: l.id,
            orderLineId: l.orderLineId,
            lotId: (l.lotId ?? l.suggestedLotId) as string,
            pickedQtyPcs: l.requestedQtyPcs,
          })),
        },
      )
      if (!picked) return
      pl = { item: picked.item }
    }
  }
  for (const o of pl.item.orders) await pack(ctx, date, o.orderId)
}

// ----------------------------------------------------------------------------------- supplier bills

async function finishSupplierBills(ctx: Ctx, date: string): Promise<void> {
  const review = await ctx.read(contract.procurement.supplierInvoices.list, {
    status: 'in_review',
    limit: 200,
  })
  const catalog = await pages((cursor) =>
    ctx.read(contract.tenantCatalog.list, {
      listedOnly: false,
      limit: 500,
      ...(cursor ? { cursor } : {}),
    }),
  )
  for (const si of review.items) {
    if (!earlier(si.id, date)) continue
    const full = await ctx.read(contract.procurement.supplierInvoices.get, { id: si.id })
    for (const line of full.item.lines.filter((l) => l.variantId === null)) {
      // The desk recognises the supplier's code: the item it was printed for.
      const hit = catalog.find((c) => supplierCodeOf(c.variantId) === line.supplierCode)
      if (!hit) continue
      await ctx.write(
        'yesterday',
        'supplier line matched',
        () => ctx.as('manager'),
        contract.procurement.supplierInvoices.matchLine,
        {
          idempotencyKey: demoKey(date, 'finish', 'match', line.id),
          id: si.id,
          lineId: line.id,
          variantId: hit.variantId,
        },
      )
    }
  }
  // Every approved earlier bill without a receipt gets one; every earlier receipt is counted and posted.
  const approved = await ctx.read(contract.procurement.supplierInvoices.list, {
    status: 'approved',
    limit: 200,
  })
  for (const si of approved.items) if (earlier(si.id, date)) await openGate(ctx, date, si.id)
  for (const status of ['counting', 'reconciled'] as const) {
    const grns = await ctx.read(contract.procurement.grns.list, { status, limit: 200 })
    for (const g of grns.items) {
      if (!isDemoId(g.supplierInvoiceId) || (demoIdDate(g.supplierInvoiceId) ?? date) >= date)
        continue
      if (g.status === 'counting') {
        const bill = await ctx.read(contract.procurement.supplierInvoices.get, {
          id: g.supplierInvoiceId,
        })
        const grn = await ctx.read(contract.procurement.grns.get, { id: g.id })
        const lines = grn.item.lines.map((l) => {
          const printed = bill.item.lines.find((b) => b.id === l.supplierInvoiceLineId)
          return {
            grnLineId: l.id,
            countedQtyPcs: (printed?.qtyPcs ?? 0) + (printed?.freeQtyPcs ?? 0),
            damagedQtyPcs: 0,
          }
        })
        const counted = await ctx.write(
          'yesterday',
          'goods counted at the gate',
          () => ctx.as('godown'),
          contract.procurement.grns.count,
          {
            idempotencyKey: demoKey(date, 'finish', 'count', g.id),
            id: g.id,
            lines,
          },
        )
        if (!counted || counted.item.status !== 'reconciled') continue
      }
      await ctx.write(
        'yesterday',
        'goods receipt posted',
        () => ctx.as('manager'),
        contract.procurement.grns.post,
        {
          idempotencyKey: demoKey(date, 'finish', 'post', g.id),
          id: g.id,
        },
      )
    }
  }
}

// ------------------------------------------------------------------------------------------ returns

async function issueReturns(ctx: Ctx, date: string): Promise<void> {
  const drafts = await ctx.read(contract.billing.creditNotes.list, { state: 'draft', limit: 200 })
  for (const n of drafts.items) {
    if (!earlier(n.id, date)) continue
    // Issued, a note meets its own bill first; what that bill no longer owes goes to the shop's OLDEST open bills
    // by the product's own hand (DOS-312). When that could reach a bill the tool did not make, the manager does
    // not issue the return: it is cancelled, and the tool's credit never touches a real bill (rule 3b).
    const bill = await ctx.read(contract.billing.invoices.get, { id: n.invoiceId })
    if (bill.item.amountDuePaise < n.totalPaise && !(await ownMoneyStaysOwn(ctx, n.retailerId))) {
      await ctx.write(
        'yesterday',
        'return not accepted',
        () => ctx.as('manager'),
        contract.billing.creditNotes.cancel,
        {
          idempotencyKey: demoKey(date, 'finish', 'return', n.id, 'cancel'),
          id: n.id,
          reason: 'Bill already settled: the shop takes the packets back instead',
        },
      )
      continue
    }
    await ctx.write(
      'yesterday',
      'return issued',
      () => ctx.as('manager'),
      contract.billing.creditNotes.issue,
      {
        idempotencyKey: demoKey(date, 'finish', 'return', n.id),
        id: n.id,
      },
    )
  }
}

// -------------------------------------------------------------------------------------------- money

/** Earlier UPI still on account is matched to the same shop's open tool bills; earlier cash and cheques are banked. */
async function matchAndBank(ctx: Ctx, date: string): Promise<void> {
  const onAccount = await pages((cursor) =>
    ctx.read(contract.receivables.receipts.list, {
      unallocatedOnly: true,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    }),
  )
  for (const r of onAccount) {
    if (
      !earlier(r.id, date) ||
      r.unallocatedPaise <= 0 ||
      (r.status !== 'collected' && r.status !== 'deposited')
    )
      continue
    const bills = await openToolBills(ctx, r.retailerId)
    let left = r.unallocatedPaise
    const lines: { id: string; invoiceId: string; amountPaise: number }[] = []
    for (const b of bills) {
      if (left <= 0) break
      const amount = Math.min(left, b.amountDuePaise)
      if (amount <= 0) continue
      lines.push({ id: ctx.id(date, 'match', r.id, b.id), invoiceId: b.id, amountPaise: amount })
      left -= amount
    }
    if (lines.length === 0) continue
    await ctx.write(
      'yesterday',
      'payment matched to a bill',
      () => ctx.as('accounts'),
      contract.receivables.allocations.create,
      {
        idempotencyKey: demoKey(date, 'finish', 'match', r.id),
        id: ctx.id(date, 'match', r.id),
        sourceType: 'receipt',
        sourceId: r.id,
        lines,
      },
    )
  }
  // Cash and cheques are banked, and UPI is confirmed at Day-end against the bank or the UPI app (DOS-256: UPI
  // money reaches the bank only when the accountant confirms it; the same call moves it out of UPI clearing).
  const inHand: string[] = []
  for (const mode of ['cash', 'cheque', 'upi'] as const) {
    const rows = await pages((cursor) =>
      ctx.read(contract.receivables.receipts.list, {
        status: 'collected',
        mode,
        withCrew: false,
        limit: 200,
        ...(cursor ? { cursor } : {}),
      }),
    )
    for (const r of rows) if (earlier(r.id, date)) inHand.push(r.id)
  }
  if (inHand.length > 0)
    await ctx.write(
      'yesterday',
      'cash and cheques banked',
      () => ctx.as('accounts'),
      contract.receivables.receipts.deposit,
      {
        idempotencyKey: demoKey(date, 'finish', 'deposit'),
        id: ctx.id(date, 'deposit'),
        receiptIds: inHand.sort(),
        depositAccountCode: 'BANK',
        depositedAt: new Date().toISOString(),
        depositRef: `SLIP-${date.replace(/-/g, '')}`,
      },
    )
}

/** A shop's open bills that the tool made (its order carries the marker), oldest first. */
async function openToolBills(ctx: Ctx, retailerId: string) {
  const bills = await ctx.read(contract.billing.invoices.list, {
    retailerId,
    openOnly: true,
    limit: 200,
  })
  return bills.items
    .filter((b) => b.orderId !== null && isDemoId(b.orderId) && b.amountDuePaise > 0)
    .sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate) || a.id.localeCompare(b.id))
}

/** Tool bills a week old or more are paid off by bank transfer, so the tool's own dues stay a week deep. */
async function payOldBills(ctx: Ctx, date: string): Promise<void> {
  const cutoff = addDays(date, -7)
  const open = await pages((cursor) =>
    ctx.read(contract.billing.invoices.list, {
      openOnly: true,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    }),
  )
  const byShop = new Map<string, { id: string; amountDuePaise: number }[]>()
  for (const b of open) {
    if (!b.orderId || !isDemoId(b.orderId) || b.amountDuePaise <= 0) continue
    const made = demoIdDate(b.orderId)
    if (!made || made > cutoff) continue
    byShop.set(b.retailerId, [...(byShop.get(b.retailerId) ?? []), b])
  }
  for (const [retailerId, bills] of [...byShop.entries()].sort()) {
    const id = ctx.id(date, 'transfer', retailerId)
    const amount = bills.reduce((n, b) => n + b.amountDuePaise, 0)
    // Explicit, to the paisa of the tool's own bills: nothing left on account (DOS-312), nothing to recover a
    // write-off with (DOS-311), so no real bill is touched (rule 3b).
    await ctx.writeReceipt(
      'yesterday',
      'old bills paid by transfer',
      () => ctx.as('accounts'),
      contract.receivables.receipts.create,
      (attempt) => ({
        idempotencyKey: demoKey(date, 'transfer', retailerId),
        id,
        retailerId,
        mode: 'bank_transfer' as const,
        amountPaise: amount,
        reference: paymentReference('bank_transfer', date, id, null, attempt),
        strategy: 'explicit' as const,
        allocations: bills.map((b) => ({
          id: ctx.id(date, 'transfer', retailerId, b.id),
          invoiceId: b.id,
          amountPaise: b.amountDuePaise,
        })),
      }),
    )
  }
}

export { signOffAndLoad }
