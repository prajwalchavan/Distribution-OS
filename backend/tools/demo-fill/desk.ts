import { contract } from '@dos/contracts'
import type { Ctx } from './context.js'
import { maybe, pages, paymentReference } from './helpers.js'
import { addDays, demoKey, isDemoId, shuffled, unit } from './ids.js'
import { ON_ACCOUNT_DOOR, type ItemInfo } from './plan.js'
import { readTrip } from './road.js'
import type { World } from './world.js'

/**
 * THE DESK: the return the crew raised that waits for the manager, the office's own money (a cheque to bank,
 * a UPI payment still to be matched to a bill), and the supplier side (a bill in review, a lorry at the gate).
 * Money is only ever put against bills the tool made, named explicitly — never "oldest first", which could
 * reach an opening bill (brief rule 3).
 */

/** The bill a door of today's van carries (null when the door or its bill is not there). */
async function doorBill(ctx: Ctx, date: string, driver: 'driver1' | 'driver2', sequence: number) {
  const trip = await readTrip(ctx, ctx.id(date, 'trip', driver))
  const stop = trip?.stops.find((s) => s.sequence === sequence)
  const d = stop?.deliveries[0]
  if (!stop || !d) return null
  return { stop, delivery: d }
}

/**
 * "A return to approve": after the van left, the shop on van 2's sixth door found two torn packets; the driver
 * raises the credit note and leaves it as a draft for the manager to issue.
 */
export async function returnToApprove(ctx: Ctx, date: string): Promise<void> {
  const id = ctx.id(date, 'return', 'driver2')
  if (await maybe(ctx.read(contract.billing.creditNotes.get, { id }))) {
    ctx.summary.foundOne('manager', 'return to approve')
    return
  }
  const door = await doorBill(ctx, date, 'driver2', 6)
  if (!door || door.delivery.outcome !== 'delivered') return
  const bill = await ctx.read(contract.billing.invoices.get, { id: door.delivery.invoiceId })
  const line = bill.item.lines.find((l) => l.qtyPcs >= 2)
  if (!line) return
  await ctx.write(
    'manager',
    'return to approve',
    () => ctx.as('driver2'),
    contract.billing.creditNotes.create,
    {
      idempotencyKey: demoKey(date, 'return', 'driver2'),
      id,
      invoiceId: door.delivery.invoiceId,
      reason: 'return_damaged',
      deliveryId: door.delivery.id,
      note: 'Two packets torn, found after the van left',
      autoIssue: false,
      lines: [
        {
          id: ctx.id(date, 'return', 'driver2', 'line'),
          invoiceLineId: line.id,
          qtyPcs: 2,
          saleable: false,
        },
      ],
    },
  )
}

/**
 * The office's own money today: the shop on van 2's part-delivered door pays its bill by cheque at the counter
 * ("cheques to deposit"), and the shop on van 1's part-delivered door sends a UPI payment the desk has not
 * matched to a bill yet ("collections to match").
 */
export async function officeMoney(ctx: Ctx, date: string): Promise<void> {
  const cheque = ctx.id(date, 'office', 'cheque')
  if (await maybe(ctx.read(contract.receivables.receipts.get, { id: cheque })))
    ctx.summary.foundOne('accountant', 'cheque at the counter')
  else {
    const door = await doorBill(ctx, date, 'driver2', 4)
    const bill = door
      ? await ctx.read(contract.billing.invoices.get, { id: door.delivery.invoiceId })
      : null
    if (door && bill && bill.item.amountDuePaise > 0) {
      // Explicit, to the paisa of the bill: nothing left on account (DOS-312), nothing to recover (DOS-311).
      await ctx.writeReceipt(
        'accountant',
        'cheque at the counter',
        () => ctx.as('accounts'),
        contract.receivables.receipts.create,
        (attempt) => ({
          idempotencyKey: demoKey(date, 'office', 'cheque'),
          id: cheque,
          retailerId: door.stop.retailerId,
          mode: 'cheque' as const,
          amountPaise: bill.item.amountDuePaise,
          reference: paymentReference('cheque', date, cheque, attempt),
          chequeDate: date,
          bankName: 'Cosmos Bank',
          strategy: 'explicit' as const,
          allocations: [
            {
              id: ctx.id(date, 'office', 'cheque', 'allocation'),
              invoiceId: door.delivery.invoiceId,
              amountPaise: bill.item.amountDuePaise,
            },
          ],
        }),
      )
    }
  }
  const upi = ctx.id(date, 'office', 'upi')
  if (await maybe(ctx.read(contract.receivables.receipts.get, { id: upi })))
    ctx.summary.foundOne('accountant', 'payment to match')
  else {
    const [driver, index] = ON_ACCOUNT_DOOR
    const door = await doorBill(ctx, date, driver, index + 1)
    const bill = door
      ? await ctx.read(contract.billing.invoices.get, { id: door.delivery.invoiceId })
      : null
    if (door && bill && bill.item.amountDuePaise > 0) {
      // This money stays ON ACCOUNT overnight, and the product applies money on account to the shop's oldest
      // open bill by itself (DOS-312) and recovers a written-off bill with it first (DOS-311). The plan gave this
      // door a shop that owes nothing on a bill the tool did not make; asked again here, and when that no longer
      // holds the payment is left out today, so the tool's money never reaches a real bill (rule 3b).
      if (!(await ownMoneyStaysOwn(ctx, door.stop.retailerId))) {
        ctx.summary.note(
          `rule 3b: no payment to match on ${date}: the shop at van 1's door ${String(index + 1)} owes on a bill the tool did not make, so the tool leaves no money of its own on account there`,
        )
        return
      }
      await ctx.writeReceipt(
        'accountant',
        'payment to match',
        () => ctx.as('accounts'),
        contract.receivables.receipts.create,
        (attempt) => ({
          idempotencyKey: demoKey(date, 'office', 'upi'),
          id: upi,
          retailerId: door.stop.retailerId,
          mode: 'upi' as const,
          amountPaise: bill.item.amountDuePaise,
          reference: paymentReference('upi', date, upi, attempt),
          strategy: 'none' as const,
          note: 'UPI received, bill not named by the shop',
        }),
      )
    }
  }
}

/**
 * May the tool leave its own money on account with this shop (rule 3b)? Only when every open bill of the shop is
 * the tool's and no bill of it stands written off: then whatever the product applies that money to by itself is a
 * bill of the tool.
 */
export async function ownMoneyStaysOwn(ctx: Ctx, retailerId: string): Promise<boolean> {
  const open = await pages((cursor) =>
    ctx.read(contract.billing.invoices.list, {
      retailerId,
      openOnly: true,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    }),
  )
  if (open.some((b) => !isDemoId(b.orderId) && b.amountDuePaise > 0)) return false
  const written = await ctx.read(contract.billing.invoices.list, {
    retailerId,
    state: 'written_off',
    limit: 1,
  })
  return written.items.length === 0
}

// ------------------------------------------------------------------------------------- supplier side

interface BillLine {
  id: string
  lineNo: number
  description: string
  supplierCode: string
  variantId: string | null
  hsnCode: string | null
  batchNo: string
  expiryDate: string
  mrpPaise: number | null
  printedQty: number
  printedUnit: string
  qtyPcs: number
  ratePaise: number
  gstBps: number
  taxablePaise: number
  taxPaise: number
  lineTotalPaise: number
}

/** A supplier's own item code as printed: the first eight hex digits of our variant id, upper case. */
export function supplierCodeOf(variantId: string): string {
  return variantId.replace(/-/g, '').slice(0, 8).toUpperCase()
}

/** Lines for a supplier bill: the items with the least stock that have a purchase rate, at that rate. */
export function supplierLines(
  date: string,
  kind: string,
  items: readonly ItemInfo[],
  skip: ReadonlySet<string>,
  count: number,
  lineId: (n: number) => string,
): BillLine[] {
  const pool = [...items]
    .filter(
      (i) => i.costPaise !== null && i.costPaise > 0 && i.gstBps !== null && !skip.has(i.variantId),
    )
    .sort((a, b) => a.available - b.available || a.variantId.localeCompare(b.variantId))
    .slice(0, count * 3)
  return shuffled(pool, `${date}:${kind}:supply`, (i) => i.variantId)
    .slice(0, count)
    .map((item, n) => {
      const qty = 24 * (1 + Math.floor(unit(`${date}:${kind}:${item.variantId}`) * 3))
      const rate = item.costPaise ?? 0
      const taxable = rate * qty
      const tax = Math.round((taxable * (item.gstBps ?? 0)) / 10_000)
      return {
        id: lineId(n),
        lineNo: n + 1,
        description: `Item ${supplierCodeOf(item.variantId)}`,
        supplierCode: supplierCodeOf(item.variantId),
        variantId: item.variantId,
        hsnCode: item.hsnCode,
        batchNo: `B${date.replace(/-/g, '').slice(2)}${String(n + 1)}`,
        expiryDate: addDays(date, 240),
        mrpPaise: item.mrpPaise,
        printedQty: qty,
        printedUnit: 'pcs',
        qtyPcs: qty,
        ratePaise: rate,
        gstBps: item.gstBps ?? 0,
        taxablePaise: taxable,
        taxPaise: tax,
        lineTotalPaise: taxable + tax,
      }
    })
}

function billTotals(lines: readonly BillLine[]) {
  const subtotal = lines.reduce((n, l) => n + l.taxablePaise, 0)
  const tax = lines.reduce((n, l) => n + l.taxPaise, 0)
  const cgst = Math.floor(tax / 2)
  const exact = subtotal + tax
  const total = Math.round(exact / 100) * 100
  return { subtotal, cgst, sgst: tax - cgst, roundOff: total - exact, total }
}

/**
 * Two supplier bills a day, typed at the desk by the manager: one with a line the desk has not matched to an
 * item yet ("a supplier bill in review"), and one fully matched whose lorry is at the gate ("goods at the gate
 * to count"). Tomorrow's run finishes both: the line matched, the gate count taken, the receipt posted.
 */
export async function supplierBills(ctx: Ctx, date: string, world: World): Promise<void> {
  const suppliers = world.suppliers.filter((s) => s.active)
  if (suppliers.length === 0) {
    ctx.summary.refusedOne('manager', 'supplier bill', 'no supplier')
    return
  }
  const pick = (kind: string) =>
    shuffled(suppliers, `${date}:${kind}:supplier`, (s) => s.id)[0] ?? suppliers[0]
  const used = new Set<string>()
  for (const kind of ['review', 'gate'] as const) {
    const id = ctx.id(date, 'supplier-bill', kind)
    const have = await maybe(ctx.read(contract.procurement.supplierInvoices.get, { id }))
    let status = have?.item.status ?? null
    if (!have) {
      const lines = supplierLines(date, kind, world.items, used, kind === 'review' ? 3 : 4, (n) =>
        ctx.id(date, 'supplier-bill', kind, 'line', String(n)),
      )
      if (lines.length === 0) {
        ctx.summary.refusedOne(
          kind === 'review' ? 'manager' : 'godown',
          'supplier bill',
          'no item with a purchase rate',
        )
        continue
      }
      for (const l of lines) used.add(l.variantId ?? '')
      // The review bill's last line is printed with the supplier's code alone: not matched yet.
      const sent = lines.map((l, n) =>
        kind === 'review' && n === lines.length - 1 ? { ...l, variantId: null } : l,
      )
      const t = billTotals(sent)
      const supplier = pick(kind)
      const no = 400 + Math.floor(unit(`${id}:no`) * 5000)
      const made = await ctx.write(
        kind === 'review' ? 'manager' : 'godown',
        kind === 'review' ? 'supplier bill in review' : 'supplier bill for the gate',
        () => ctx.as('manager'),
        contract.procurement.supplierInvoices.create,
        {
          idempotencyKey: demoKey(date, 'supplier-bill', kind),
          id,
          supplierId: supplier?.id ?? '',
          source: 'manual',
          invoiceNo: `SB/${date.slice(2, 4)}-${String(Number(date.slice(2, 4)) + 1)}/${String(no).padStart(4, '0')}`,
          invoiceDate: date,
          placeOfSupplyState: '27',
          subtotalPaise: t.subtotal,
          cgstPaise: t.cgst,
          sgstPaise: t.sgst,
          roundOffPaise: t.roundOff,
          totalPaise: t.total,
          dueDate: addDays(date, 30),
          lines: sent,
        },
      )
      if (!made) continue
      status = made.item.status
    } else ctx.summary.foundOne(kind === 'review' ? 'manager' : 'godown', 'supplier bill')
    if (kind === 'gate' && status === 'approved') await openGate(ctx, date, id)
  }
}

/** The lorry is at the gate: the manager opens the receipt; the godown will count it blind. */
export async function openGate(ctx: Ctx, date: string, supplierInvoiceId: string): Promise<void> {
  const grns = await ctx.read(contract.procurement.grns.list, { supplierInvoiceId, limit: 5 })
  if (grns.items.some((g) => g.status !== 'cancelled')) return
  const locations = await ctx.read(contract.inventory.locations.list, {
    kind: 'warehouse',
    activeOnly: true,
  })
  const godown = [...locations.items].sort((a, b) => a.id.localeCompare(b.id))[0]
  if (!godown) return
  await ctx.write(
    'godown',
    'goods at the gate',
    () => ctx.as('manager'),
    contract.procurement.grns.open,
    {
      idempotencyKey: demoKey(date, 'grn', supplierInvoiceId),
      id: ctx.id(date, 'grn', supplierInvoiceId),
      supplierInvoiceId,
      locationId: godown.id,
    },
  )
}
