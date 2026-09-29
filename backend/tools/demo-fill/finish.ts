import { contract } from '@dos/contracts'
import type { Ctx } from './context.js'
import { pack, wave } from './day.js'
import { openGate, ownMoneyStaysOwn, supplierCodeOf } from './desk.js'
import { belowCost, earlier, pages, paymentReference } from './helpers.js'
import { addDays, demoIdDate, demoKey, isDemoId } from './ids.js'
import { loadAndDepart, returnTrip, settleTrip, workDoors, type DriverKey } from './road.js'
import { signOffAndLoad } from './road.js'

/**
 * FINISH YESTERDAY: everything the tool left open under an earlier date is carried to its end the way a crew
 * and a desk would — the held orders decided, the vans' last doors delivered, the vans checked in and settled
 * with the cash handed over, the waves picked and packed (their bills ride today's vans), the supplier bills
 * matched and their goods counted and posted, the draft return issued, the money matched and banked, and a
 * week-old tool bill paid off by bank transfer. Nothing of `date` itself is touched — except the open trips of
 * tester logins the tool no longer uses (D6), which are finished or cancelled whatever their date.
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
    // A rate below what the item cost is the owner's alone to approve, knowingly (prices and tax, DOS-335): the
    // desk leaves it for the owner, as the product tells a manager to, and the owner finds it waiting.
    if (belowCost(a)) {
      ctx.log(`  left for the owner: a rate below cost on ${a.orderNo ?? a.orderId}`)
      continue
    }
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
  // Every open trip of the tool, whatever its date: a former driver's van load planned for the day AFTER `date`
  // (the tool before 2026-09-29 plans tomorrow's van 1 tonight) is cancelled in this same run, so that the login
  // can be switched off at its end (D6: healed in one run).
  const open = await pages((cursor) =>
    ctx.read(contract.delivery.trips.list, {
      states: ['planned', 'loading', 'active', 'closing'],
      limit: 200,
      ...(cursor ? { cursor } : {}),
    }),
  )
  // Oldest first: a van's earlier trip is settled before a later one of it is loaded (a van carries one trip).
  const ordered = [...open].sort(
    (a, b) => a.tripDate.localeCompare(b.tripDate) || a.id.localeCompare(b.id),
  )
  for (const t of ordered) {
    if (!isDemoId(t.id)) continue
    const driver = ctx.crewDriverOf(t.driverId)
    if (!driver) {
      await finishFormerTrip(ctx, t, date)
      continue
    }
    if (t.tripDate >= date) continue
    if (t.state === 'planned' || t.state === 'loading') await loadAndDepart(ctx, t.id, driver, date)
    await workDoors(ctx, t.id, driver, date, true)
    await returnTrip(ctx, t.id, driver, date)
    await settleTrip(ctx, t.id, date)
  }
}

/**
 * D6: a trip of a driver the tool no longer has (a former tester login). A trip that has not left — the van load a
 * former crew planned for the next morning, whatever its date — is CANCELLED by the desk (its draft sheet with it)
 * and its bills go back on the planning board, where the vans of the next day the new crew makes carry them: the
 * work goes to the new drivers. A trip that has left cannot be handed to anyone — no procedure changes a trip's
 * driver — so its own driver finishes it, signed in as that former login before it is switched off: the last doors
 * delivered, the van checked in; the accountant settles it. That includes a trip of `date` itself (a date the former
 * logins made): the van must be back before today's crew takes it out on its own shift. When the former login
 * cannot be signed in at all, the desk does the doorstep steps (the product gives the owner and the manager every
 * one of them) and the report says so.
 */
async function finishFormerTrip(
  ctx: Ctx,
  t: { id: string; tripDate: string; state: string; vehicleId: string; driverId: string | null },
  date: string,
): Promise<void> {
  const desk = (): ReturnType<Ctx['as']> => ctx.as('manager')
  const van: DriverKey = ctx.vanOfVehicle(t.vehicleId) ?? 'driver1'
  if (t.state === 'planned') {
    await ctx.write(
      'yesterday',
      'trip of a former driver cancelled, its bills back on the board',
      desk,
      contract.delivery.trips.cancel,
      {
        idempotencyKey: demoKey(date, 'trip', t.id, 'cancel'),
        id: t.id,
        reason: 'The driver has left: the bills go out on another van',
      },
    )
    return
  }
  const driverId = t.driverId ?? ''
  const own = ctx.commit ? await ctx.asFormer(driverId) : null
  const who = ctx.former.find((f) => f.member.userId === driverId)?.member.username ?? driverId
  const actor = own ? () => Promise.resolve(own) : desk
  if (ctx.commit)
    ctx.summary.note(
      own
        ? `trip ${t.id} of ${t.tripDate} (${t.state}) cannot be handed to another driver: ${who} finishes it before the login is switched off`
        : `trip ${t.id} of ${t.tripDate} (${t.state}) cannot be handed to another driver and ${who} could not be signed in: the desk finishes it`,
    )
  // Loading (loaded: the product cancels no loaded trip): the driver takes it out and brings it back.
  if (t.state === 'loading') await loadAndDepart(ctx, t.id, van, date, actor)
  await workDoors(ctx, t.id, van, date, true, actor)
  await returnTrip(ctx, t.id, van, date, actor)
  await settleTrip(ctx, t.id, date)
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
        idempotencyKey: ctx.dayKey(date, 'finish', 'deposit'),
        id: ctx.dayId(date, 'deposit'),
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
    const id = ctx.dayId(date, 'transfer', retailerId)
    const amount = bills.reduce((n, b) => n + b.amountDuePaise, 0)
    // Explicit, to the paisa of the tool's own bills: nothing left on account (DOS-312), nothing to recover a
    // write-off with (DOS-311), so no real bill is touched (rule 3b).
    await ctx.writeReceipt(
      'yesterday',
      'old bills paid by transfer',
      () => ctx.as('accounts'),
      contract.receivables.receipts.create,
      (attempt) => ({
        idempotencyKey: ctx.dayKey(date, 'transfer', retailerId),
        id,
        retailerId,
        mode: 'bank_transfer' as const,
        amountPaise: amount,
        reference: paymentReference('bank_transfer', date, id, null, attempt),
        strategy: 'explicit' as const,
        allocations: bills.map((b) => ({
          id: ctx.dayId(date, 'transfer', retailerId, b.id),
          invoiceId: b.id,
          amountPaise: b.amountDuePaise,
        })),
      }),
    )
  }
}

export { signOffAndLoad }
