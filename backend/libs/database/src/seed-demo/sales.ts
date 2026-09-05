/** Orders -> invoices -> receipts -> journal (ADR 0001/0004/0008), for the last 14 days. */
import { insertMany } from './db-helpers.js'
import { paise, percentOf, roundToRupee } from '@dos/domain'
import { eq, sql } from 'drizzle-orm'
import {
  accounts,
  ageingSnapshots,
  allocations,
  cashDiscountConditions,
  creditNoteLines,
  creditNotes,
  invoiceLines,
  invoices,
  journalEntries,
  journalLines,
  numberingSeries,
  orderStateTransitions,
  receipts,
  salesOrderLines,
  salesOrders,
} from '../schema/index.js'
import type { Db } from '../client.js'
import type { AppliedRule } from '../schema/orders.js'
import { type VariantRow } from './catalog.js'
import { demoId } from './ids.js'
import type { PeopleResult } from './people.js'
import type { PricingResult } from './pricing.js'
import type { RetailerRow, RetailersResult } from './retailers.js'
import type { StockResult } from './stock.js'
import {
  atIstTime,
  daysAgo,
  FY,
  isoDate,
  makeRng,
  nth,
  pick,
  randChance,
  randInt,
  TODAY,
  workingDaysBack,
} from './util.js'

type FinalOrderState =
  | 'draft'
  | 'submitted'
  | 'confirmed'
  | 'picking'
  | 'packed'
  | 'dispatched'
  | 'delivered'
  | 'closed'
  | 'cancelled'

const INVOICE_ELIGIBLE = new Set<FinalOrderState>(['packed', 'dispatched', 'delivered', 'closed'])

export interface OrderRecord {
  id: string
  orderNo: string | null
  retailerId: string
  retailerCode: string
  beatIndex: number
  salespersonId: string | null
  createdBy: string
  source: 'salesperson' | 'retailer_app' | 'van_sale'
  state: FinalOrderState
  day: Date
  subtotalPaise: number
  taxPaise: number
  roundOffPaise: number
  totalPaise: number
  lineCount: number
}

function ageDaysOf(day: Date): number {
  return Math.round((TODAY.getTime() - day.getTime()) / 86_400_000)
}

export interface InvoiceRecord {
  id: string
  invoiceNo: string
  orderId: string
  retailerId: string
  retailerCode: string
  beatIndex: number
  invoiceDate: Date
  ageDays: number
  totalPaise: number
  state: 'issued' | 'partially_paid' | 'paid'
  /** Per line: what was billed, what the godown actually picked, and the ex-GST value (for the day rollups). */
  lines: {
    invoiceLineId: string
    variantId: string
    qtyPcs: number
    freeQtyPcs: number
    pickedQtyPcs: number
    ratePaise: number
    taxablePaise: number
  }[]
}

export interface RetailerOutstanding {
  outstandingPaise: number
  openBills: number
  oldestDueDate: string | null
  items: { outstandingPaise: number; dueDate: string }[]
}

export interface ShortDelivery {
  invoiceId: string
  shortPcs: number
}

export interface SalesResult {
  orders: OrderRecord[]
  invoices: InvoiceRecord[]
  outstandingByRetailer: Map<string, RetailerOutstanding>
  shortDeliveries: ShortDelivery[]
}

const TOO_YUMM_SCHEME_ID = demoId('scheme', 'campa-750-12-plus-1')
const SELLER_FSSAI = '11525012000456'

function rateForRetailer(
  tier: RetailerRow['tier'],
  rates: PricingResult['ratesByVariantId'],
  variantId: string,
) {
  const r = rates.get(variantId)
  if (!r) throw new Error(`no price for variant ${variantId}`)
  if (tier === 'A') return r.aPaise
  if (tier === 'B') return r.bPaise
  return r.defaultPaise
}

/** `next_no` only ever moves forward: another seed module, the app or the smoke harness may be ahead. */
async function bumpSeries(
  db: Db,
  tenantId: string,
  seriesCode: string,
  prefix: string,
  nextNo: number,
): Promise<void> {
  await db
    .insert(numberingSeries)
    .values({ tenantId, seriesCode, fy: FY, prefix, nextNo })
    .onConflictDoUpdate({
      target: [numberingSeries.tenantId, numberingSeries.seriesCode, numberingSeries.fy],
      set: { nextNo: sql`greatest(${numberingSeries.nextNo}, ${nextNo})` },
    })
}

export async function seedSales(
  db: Db,
  tenantId: string,
  variants: VariantRow[],
  retailersRes: RetailersResult,
  pricing: PricingResult,
  stock: StockResult,
  people: PeopleResult,
): Promise<SalesResult> {
  const accountRows = await db.select().from(accounts).where(eq(accounts.tenantId, tenantId))
  const accountId = new Map(accountRows.map((a) => [a.code, a.id]))
  const acc = (code: string): string => {
    const id = accountId.get(code)
    if (!id) throw new Error(`chart of accounts missing ${code}; run bootstrapTenant first`)
    return id
  }

  const rng = makeRng('dos-demo:sales')
  const retailersByBeat: RetailerRow[][] = [[], [], [], []]
  for (const r of retailersRes.retailers) {
    const bucket = retailersByBeat[r.beatIndex]
    if (bucket) bucket.push(r)
  }
  const tooYummVariants = variants.filter((v) => v.brandKey === 'tooyumm')
  const campa750 = variants.filter(
    (v) => v.key === 'campa-cola-750ml' || v.key === 'campa-orange-750ml',
  )

  function pickRetailer(): RetailerRow {
    const beatIdx = randInt(rng, 0, 3)
    const bucket = nth(retailersByBeat, beatIdx)
    return pick(rng, bucket)
  }

  function buildOrderLines(
    orderId: string,
    tier: RetailerRow['tier'],
    variantPool: VariantRow[],
    forceCampaScheme: boolean,
  ): { lines: (typeof salesOrderLines.$inferInsert)[]; subtotal: number; tax: number } {
    const lineCount = forceCampaScheme ? randInt(rng, 3, 6) : randInt(rng, 2, 6)
    const chosen: VariantRow[] = []
    const pool = [...variantPool]
    for (let i = 0; i < lineCount && pool.length > 0; i++) {
      const idx = Math.floor(rng() * pool.length)
      const v = pool.splice(idx, 1)[0]
      if (v) chosen.push(v)
    }
    if (forceCampaScheme) chosen[0] = pick(rng, campa750)

    let subtotal = 0
    let tax = 0
    const lines: (typeof salesOrderLines.$inferInsert)[] = []
    chosen.forEach((v, i) => {
      const isSchemeLine = forceCampaScheme && i === 0
      const cases = isSchemeLine ? randInt(rng, 12, 18) : randInt(rng, 1, 8)
      const qtyPcs = cases * v.defaultCaseSize
      const listRate = rateForRetailer(tier, pricing.ratesByVariantId, v.id)
      const ratePaise = listRate
      const taxable = paise(ratePaise * qtyPcs)
      const lineTax = percentOf(taxable, v.gstBps + v.cessBps)
      const freeQtyPcs = isSchemeLine ? v.defaultCaseSize : 0
      const appliedRules: AppliedRule[] = isSchemeLine
        ? [
            {
              ruleId: TOO_YUMM_SCHEME_ID,
              version: 1,
              kind: 'scheme',
              rewardKind: 'free_qty',
              freeQty: freeQtyPcs,
              freeVariantId: v.id,
            },
          ]
        : []
      lines.push({
        id: demoId('order-line', `${orderId}:${i}`),
        tenantId,
        orderId,
        lineNo: i + 1,
        variantId: v.id,
        enteredQty: cases,
        enteredUnit: 'case',
        packSizeAtEntry: v.defaultCaseSize,
        qtyPcs,
        freeQtyPcs,
        pickedQtyPcs: qtyPcs,
        deliveredQtyPcs: qtyPcs,
        listRatePaise: listRate,
        ratePaise,
        gstBps: v.gstBps,
        taxPaise: lineTax,
        lineTotalPaise: taxable + lineTax,
        appliedRules,
      })
      subtotal += taxable
      tax += lineTax
    })
    return { lines, subtotal, tax }
  }

  function finalStateFor(ageDays: number): FinalOrderState {
    if (ageDays >= 2) return randChance(rng, 0.7) ? 'closed' : 'delivered'
    if (ageDays === 1) return randChance(rng, 0.55) ? 'dispatched' : 'packed'
    return randChance(rng, 0.5) ? 'confirmed' : 'submitted'
  }

  const workDays = workingDaysBack(14)
  const orders: OrderRecord[] = []
  const orderLineRows: (typeof salesOrderLines.$inferInsert)[] = []
  let seq = 0

  workDays.forEach((day, dayIdx) => {
    const ageDays = ageDaysOf(day)
    const isToday = ageDays === 0
    let count = randInt(rng, 4, 8)
    if (isToday) count = Math.max(1, count - 3)

    for (let k = 0; k < count; k++) {
      seq += 1
      const retailer = pickRetailer()
      const tooYummOnly = randChance(rng, 0.08)
      const roll = rng()
      let source: OrderRecord['source'] = 'salesperson'
      let createdBy =
        retailer.beatIndex < 2 ? people.salespeople.rahul.id : people.salespeople.amit.id
      let salespersonId: string | null = createdBy
      const isAppRetailer =
        retailer.code === nth(retailersRes.retailers, 0).code ||
        retailer.code === nth(retailersRes.retailers, 9).code
      if (roll < 0.1) {
        source = 'van_sale'
        createdBy = pick(rng, [
          people.delivery.ganesh,
          people.delivery.raju,
          people.delivery.santosh,
          people.delivery.iqbal,
        ]).id
        salespersonId = null
      } else if (roll < 0.25 && isAppRetailer) {
        source = 'retailer_app'
        createdBy =
          retailer.code === nth(retailersRes.retailers, 0).code
            ? people.retailerUsers[0].id
            : people.retailerUsers[1].id
      } else if (tooYummOnly) {
        source = 'salesperson'
        createdBy = people.salespeople.pooja.id
        salespersonId = createdBy
      }

      const orderId = demoId('order', `${dayIdx}:${k}`)
      const forceCampaScheme = seq % 12 === 0
      const pool = tooYummOnly ? tooYummVariants : variants
      const { lines, subtotal, tax } = buildOrderLines(
        orderId,
        retailer.tier,
        pool,
        forceCampaScheme && !tooYummOnly,
      )
      const { rounded: totalPaise, roundOff } = roundToRupee(paise(subtotal + tax))
      const state = finalStateFor(ageDays)
      orderLineRows.push(...lines)

      orders.push({
        id: orderId,
        orderNo: null,
        retailerId: retailer.id,
        retailerCode: retailer.code,
        beatIndex: retailer.beatIndex,
        salespersonId,
        createdBy,
        source,
        state,
        day,
        subtotalPaise: subtotal,
        taxPaise: tax,
        roundOffPaise: roundOff,
        totalPaise,
        lineCount: lines.length,
      })
    }

    if (isToday) {
      for (let d = 0; d < 3; d++) {
        seq += 1
        const retailer = pickRetailer()
        const orderId = demoId('order', `draft:${d}`)
        const rep =
          retailer.beatIndex < 2 ? people.salespeople.rahul.id : people.salespeople.amit.id
        const { lines, subtotal, tax } = buildOrderLines(orderId, retailer.tier, variants, false)
        const { rounded: totalPaise, roundOff } = roundToRupee(paise(subtotal + tax))
        orderLineRows.push(...lines)
        orders.push({
          id: orderId,
          orderNo: null,
          retailerId: retailer.id,
          retailerCode: retailer.code,
          beatIndex: retailer.beatIndex,
          salespersonId: rep,
          createdBy: rep,
          source: 'salesperson',
          state: 'draft',
          day,
          subtotalPaise: subtotal,
          taxPaise: tax,
          roundOffPaise: roundOff,
          totalPaise,
          lineCount: lines.length,
        })
      }
    }
  })

  // Cancel exactly 2 orders that had reached at least `submitted`.
  const cancellable = orders.filter((o) => o.state !== 'draft' && o.state !== 'cancelled')
  const c1 = nth(cancellable, 2)
  const c2 = nth(cancellable, Math.min(9, cancellable.length - 1))
  c1.state = 'cancelled'
  if (c2.id !== c1.id) c2.state = 'cancelled'

  // Assign SO numbers (submitted-or-later, chronological) and INV numbers (invoice-eligible, chronological).
  let soSeq = 0
  let invSeq = 0
  const invoiceLineRows: (typeof invoiceLines.$inferInsert)[] = []
  const journalEntryRows: (typeof journalEntries.$inferInsert)[] = []
  const journalLineRows: (typeof journalLines.$inferInsert)[] = []
  const receiptRows: (typeof receipts.$inferInsert)[] = []
  const allocationRows: (typeof allocations.$inferInsert)[] = []
  const cashDiscountRows: (typeof cashDiscountConditions.$inferInsert)[] = []
  const invoices_: InvoiceRecord[] = []
  const invoiceFinancials = new Map<
    string,
    { subtotal: number; cgst: number; sgst: number; cessOnly: number; roundOff: number }
  >()
  const outstandingByRetailer = new Map<string, RetailerOutstanding>()
  const retailerByCode = new Map(retailersRes.retailers.map((r) => [r.code, r]))
  const linesByOrderId = new Map<string, (typeof salesOrderLines.$inferInsert)[]>()
  for (const l of orderLineRows) {
    const arr = linesByOrderId.get(l.orderId) ?? []
    arr.push(l)
    linesByOrderId.set(l.orderId, arr)
  }

  for (const order of orders) {
    if (order.state === 'draft') continue
    soSeq += 1
    order.orderNo = `SO-${String(soSeq).padStart(4, '0')}`

    if (!INVOICE_ELIGIBLE.has(order.state)) continue
    invSeq += 1
    const retailer = retailerByCode.get(order.retailerCode)
    if (!retailer) continue
    const ageFromToday = ageDaysOf(order.day)

    const orderLines = linesByOrderId.get(order.id) ?? []
    const invoiceId = demoId('invoice', order.id)
    const invoiceNo = `INV/${String(invSeq).padStart(4, '0')}`
    const subtotal = orderLines.reduce((s, l) => s + l.ratePaise * l.qtyPcs, 0)
    const gstOnly = orderLines.reduce((s, l) => {
      const v = variants.find((vv) => vv.id === l.variantId)
      return s + (v ? percentOf(paise(l.ratePaise * l.qtyPcs), v.gstBps) : 0)
    }, 0)
    const cessOnly = orderLines.reduce((s, l) => {
      const v = variants.find((vv) => vv.id === l.variantId)
      return s + (v ? percentOf(paise(l.ratePaise * l.qtyPcs), v.cessBps) : 0)
    }, 0)
    const cgst = Math.round(gstOnly / 2)
    const sgst = gstOnly - cgst
    const { rounded: totalPaise, roundOff } = roundToRupee(paise(subtotal + gstOnly + cessOnly))
    const invoiceDate = order.day
    const dueDate = isoDate(new Date(invoiceDate.getTime() + retailer.creditDays * 86_400_000))
    const cashDiscountApplies = retailer.cashDiscountBps > 0

    invoiceLineRows.push(
      ...orderLines.map((l, i) => {
        const v = variants.find((vv) => vv.id === l.variantId)
        const lots = stock.lotsByVariantId.get(l.variantId) ?? []
        const lot = lots.length > 0 ? nth(lots, lots.length - 1) : undefined
        const lineTaxable = l.ratePaise * l.qtyPcs
        const lineGst = v ? percentOf(paise(lineTaxable), v.gstBps) : 0
        const lineCess = v ? percentOf(paise(lineTaxable), v.cessBps) : 0
        return {
          id: demoId('invoice-line', `${invoiceId}:${i}`),
          tenantId,
          invoiceId,
          lineNo: i + 1,
          orderLineId: l.id,
          variantId: l.variantId,
          lotId: lot?.id ?? null,
          description: v?.name ?? 'Item',
          hsnCode: v?.hsnCode ?? '',
          batchNo: lot?.batchNo ?? null,
          mrpPaise: v?.mrpPaise ?? null,
          qtyPcs: l.qtyPcs,
          freeQtyPcs: l.freeQtyPcs,
          enteredQty: l.enteredQty,
          enteredUnit: l.enteredUnit,
          packSizeAtEntry: l.packSizeAtEntry,
          caseSize: v?.defaultCaseSize ?? null,
          ratePaise: l.ratePaise,
          taxablePaise: lineTaxable,
          gstBps: v?.gstBps ?? 0,
          cgstPaise: Math.round(lineGst / 2),
          sgstPaise: lineGst - Math.round(lineGst / 2),
          cessBps: v?.cessBps ?? 0,
          cessPaise: lineCess,
          lineTotalPaise: lineTaxable + lineGst + lineCess,
          appliedRules: l.appliedRules,
        }
      }),
    )

    // Payment outcome: invoices younger than 2 days are too recent to have been collected yet.
    let state: InvoiceRecord['state'] = 'issued'
    if (ageFromToday >= 2) {
      const outcomeRoll = rng()
      if (outcomeRoll < 0.7) {
        const withinWindow =
          cashDiscountApplies &&
          ageFromToday <= retailer.cashDiscountDays + 4 &&
          randChance(rng, 0.6)
        const cashDiscountPaise = withinWindow
          ? percentOf(paise(totalPaise), retailer.cashDiscountBps)
          : 0
        const receiptId = demoId('receipt', invoiceId)
        const receiptAmount = totalPaise - cashDiscountPaise
        const mode = randChance(rng, 0.55) ? ('cash' as const) : ('upi' as const)
        const receivedAt = atIstTime(daysAgo(Math.max(0, ageFromToday - randInt(rng, 0, 2))), 17, 0)
        receiptRows.push({
          id: receiptId,
          tenantId,
          receiptNo: `RCPT-${String(receiptRows.length + 1).padStart(4, '0')}`,
          retailerId: retailer.id,
          mode,
          amountPaise: receiptAmount,
          receivedAt,
          receivedBy: people.accountant.id,
          reference: mode === 'upi' ? `UTR${300000000 + receiptRows.length}` : null,
          upiVpa: mode === 'upi' ? `${retailer.code.toLowerCase()}@okaxis` : null,
          cashDiscountPaise,
          idempotencyKey: `receipt:${invoiceId}`,
        })
        allocationRows.push({
          id: demoId('allocation', invoiceId),
          tenantId,
          invoiceId,
          receiptId,
          amountPaise: totalPaise,
          allocatedAt: receivedAt,
        })
        journalEntryRows.push({
          id: demoId('journal-entry', `receipt:${invoiceId}`),
          tenantId,
          entryDate: isoDate(receivedAt),
          refType: 'receipt',
          refId: receiptId,
          narration: `Receipt for ${invoiceNo} (${retailer.name})`,
          idempotencyKey: `journal:receipt:${invoiceId}`,
          postedBy: people.accountant.id,
          postedAt: receivedAt,
        })
        journalLineRows.push({
          id: demoId('journal-line', `receipt:${invoiceId}:cash`),
          tenantId,
          entryId: demoId('journal-entry', `receipt:${invoiceId}`),
          accountId: acc(mode === 'cash' ? 'CASH' : 'UPI'),
          amountPaise: receiptAmount,
          partyType: 'retailer',
          partyId: retailer.id,
        })
        if (cashDiscountPaise > 0) {
          journalLineRows.push({
            id: demoId('journal-line', `receipt:${invoiceId}:cd`),
            tenantId,
            entryId: demoId('journal-entry', `receipt:${invoiceId}`),
            accountId: acc('CASH_DISCOUNT'),
            amountPaise: cashDiscountPaise,
            partyType: 'retailer',
            partyId: retailer.id,
          })
        }
        journalLineRows.push({
          id: demoId('journal-line', `receipt:${invoiceId}:ar`),
          tenantId,
          entryId: demoId('journal-entry', `receipt:${invoiceId}`),
          accountId: acc('AR'),
          amountPaise: -(receiptAmount + cashDiscountPaise),
          partyType: 'retailer',
          partyId: retailer.id,
        })
        state = 'paid'
        if (cashDiscountApplies) {
          cashDiscountRows.push({
            id: demoId('cash-discount', invoiceId),
            tenantId,
            invoiceId,
            discountBps: retailer.cashDiscountBps,
            payBy: isoDate(
              new Date(invoiceDate.getTime() + retailer.cashDiscountDays * 86_400_000),
            ),
            status: cashDiscountPaise > 0 ? ('realised' as const) : ('lapsed' as const),
            realisedReceiptId: cashDiscountPaise > 0 ? receiptId : null,
            realisedPaise: cashDiscountPaise > 0 ? cashDiscountPaise : null,
          })
        }
      } else if (outcomeRoll < 0.85) {
        const receiptId = demoId('receipt', invoiceId)
        const receiptAmount = Math.round(totalPaise * (0.4 + rng() * 0.3))
        const mode = randChance(rng, 0.5) ? ('cash' as const) : ('upi' as const)
        const receivedAt = atIstTime(daysAgo(Math.max(0, ageFromToday - 1)), 16, 30)
        receiptRows.push({
          id: receiptId,
          tenantId,
          receiptNo: `RCPT-${String(receiptRows.length + 1).padStart(4, '0')}`,
          retailerId: retailer.id,
          mode,
          amountPaise: receiptAmount,
          receivedAt,
          receivedBy: people.accountant.id,
          reference: mode === 'upi' ? `UTR${300000000 + receiptRows.length}` : null,
          upiVpa: mode === 'upi' ? `${retailer.code.toLowerCase()}@okaxis` : null,
          idempotencyKey: `receipt:${invoiceId}`,
        })
        allocationRows.push({
          id: demoId('allocation', invoiceId),
          tenantId,
          invoiceId,
          receiptId,
          amountPaise: receiptAmount,
          allocatedAt: receivedAt,
        })
        journalEntryRows.push({
          id: demoId('journal-entry', `receipt:${invoiceId}`),
          tenantId,
          entryDate: isoDate(receivedAt),
          refType: 'receipt',
          refId: receiptId,
          narration: `Part-payment for ${invoiceNo} (${retailer.name})`,
          idempotencyKey: `journal:receipt:${invoiceId}`,
          postedBy: people.accountant.id,
          postedAt: receivedAt,
        })
        journalLineRows.push(
          {
            id: demoId('journal-line', `receipt:${invoiceId}:cash`),
            tenantId,
            entryId: demoId('journal-entry', `receipt:${invoiceId}`),
            accountId: acc(mode === 'cash' ? 'CASH' : 'UPI'),
            amountPaise: receiptAmount,
            partyType: 'retailer',
            partyId: retailer.id,
          },
          {
            id: demoId('journal-line', `receipt:${invoiceId}:ar`),
            tenantId,
            entryId: demoId('journal-entry', `receipt:${invoiceId}`),
            accountId: acc('AR'),
            amountPaise: -receiptAmount,
            partyType: 'retailer',
            partyId: retailer.id,
          },
        )
        state = 'partially_paid'
      }
    }

    const record: InvoiceRecord = {
      id: invoiceId,
      invoiceNo,
      orderId: order.id,
      retailerId: retailer.id,
      retailerCode: retailer.code,
      beatIndex: retailer.beatIndex,
      invoiceDate,
      ageDays: ageFromToday,
      totalPaise,
      state,
      lines: orderLines.map((l, i) => ({
        invoiceLineId: demoId('invoice-line', `${invoiceId}:${i}`),
        variantId: l.variantId,
        qtyPcs: l.qtyPcs,
        freeQtyPcs: l.freeQtyPcs ?? 0,
        pickedQtyPcs: l.pickedQtyPcs ?? l.qtyPcs,
        ratePaise: l.ratePaise ?? 0,
        taxablePaise: (l.lineTotalPaise ?? 0) - (l.taxPaise ?? 0),
      })),
    }
    invoices_.push(record)

    const allocatedSoFar = allocationRows
      .filter((a) => a.invoiceId === invoiceId)
      .reduce((s, a) => s + a.amountPaise, 0)
    const outstanding = totalPaise - allocatedSoFar
    if (outstanding > 0) {
      const prev = outstandingByRetailer.get(retailer.id) ?? {
        outstandingPaise: 0,
        openBills: 0,
        oldestDueDate: null,
        items: [],
      }
      prev.outstandingPaise += outstanding
      prev.openBills += 1
      if (!prev.oldestDueDate || dueDate < prev.oldestDueDate) prev.oldestDueDate = dueDate
      prev.items.push({ outstandingPaise: outstanding, dueDate })
      outstandingByRetailer.set(retailer.id, prev)
    }

    journalEntryRows.push({
      id: demoId('journal-entry', `invoice:${invoiceId}`),
      tenantId,
      entryDate: isoDate(invoiceDate),
      refType: 'invoice',
      refId: invoiceId,
      narration: `Invoice ${invoiceNo} to ${retailer.name}`,
      idempotencyKey: `journal:invoice:${invoiceId}`,
      postedBy: people.accountant.id,
      postedAt: atIstTime(invoiceDate, 18, 30),
    })
    journalLineRows.push(
      {
        id: demoId('journal-line', `invoice:${invoiceId}:ar`),
        tenantId,
        entryId: demoId('journal-entry', `invoice:${invoiceId}`),
        accountId: acc('AR'),
        amountPaise: totalPaise,
        partyType: 'retailer',
        partyId: retailer.id,
      },
      {
        id: demoId('journal-line', `invoice:${invoiceId}:sales`),
        tenantId,
        entryId: demoId('journal-entry', `invoice:${invoiceId}`),
        accountId: acc('SALES'),
        amountPaise: -subtotal,
      },
      {
        id: demoId('journal-line', `invoice:${invoiceId}:cgst`),
        tenantId,
        entryId: demoId('journal-entry', `invoice:${invoiceId}`),
        accountId: acc('OUTPUT_CGST'),
        amountPaise: -cgst,
      },
      {
        id: demoId('journal-line', `invoice:${invoiceId}:sgst`),
        tenantId,
        entryId: demoId('journal-entry', `invoice:${invoiceId}`),
        accountId: acc('OUTPUT_SGST'),
        amountPaise: -sgst,
      },
    )
    if (cessOnly !== 0) {
      journalLineRows.push({
        id: demoId('journal-line', `invoice:${invoiceId}:cess`),
        tenantId,
        entryId: demoId('journal-entry', `invoice:${invoiceId}`),
        accountId: acc('OUTPUT_CESS'),
        amountPaise: -cessOnly,
      })
    }
    if (roundOff !== 0) {
      journalLineRows.push({
        id: demoId('journal-line', `invoice:${invoiceId}:roundoff`),
        tenantId,
        entryId: demoId('journal-entry', `invoice:${invoiceId}`),
        accountId: acc('ROUND_OFF'),
        amountPaise: -Number(roundOff),
      })
    }
    invoiceFinancials.set(invoiceId, { subtotal, cgst, sgst, cessOnly, roundOff })
  }

  await insertMany(
    db,
    salesOrders,
    orders.map((o) => {
      const retailer = retailerByCode.get(o.retailerCode)
      return {
        id: o.id,
        tenantId,
        orderNo: o.orderNo,
        retailerId: o.retailerId,
        state: o.state,
        source: o.source,
        createdBy: o.createdBy,
        salespersonId: o.salespersonId,
        paymentTerms: retailer?.paymentTerms ?? ('POST_FULFILLMENT' as const),
        fulfilFromLocationId: stock.godownId,
        subtotalPaise: o.subtotalPaise,
        discountPaise: 0,
        taxPaise: o.taxPaise,
        roundOffPaise: o.roundOffPaise,
        totalPaise: o.totalPaise,
        submittedAt: o.state === 'draft' ? null : atIstTime(o.day, 10, 0),
        confirmedAt: [
          'confirmed',
          'picking',
          'packed',
          'dispatched',
          'delivered',
          'closed',
        ].includes(o.state)
          ? atIstTime(o.day, 11, 0)
          : null,
        closedAt: o.state === 'closed' ? atIstTime(o.day, 20, 0) : null,
        cancelledAt: o.state === 'cancelled' ? atIstTime(o.day, 12, 0) : null,
        cancelReason:
          o.state === 'cancelled' ? 'Retailer asked to cancel; ordered by mistake.' : null,
      }
    }),
  )

  await insertMany(db, salesOrderLines, orderLineRows)

  // A compact, plausible state-transition trail per order.
  const path: { event: string; state: FinalOrderState }[] = [
    { event: 'submit', state: 'submitted' },
    { event: 'confirm', state: 'confirmed' },
    { event: 'start_picking', state: 'picking' },
    { event: 'pack', state: 'packed' },
    { event: 'dispatch', state: 'dispatched' },
    { event: 'deliver_all', state: 'delivered' },
    { event: 'close', state: 'closed' },
  ]
  const transitionRows: (typeof orderStateTransitions.$inferInsert)[] = []
  for (const order of orders) {
    if (order.state === 'draft') continue
    let from: FinalOrderState | null = 'draft'
    let hour = 10
    for (const step of path) {
      transitionRows.push({
        id: demoId('order-transition', `${order.id}:${step.event}`),
        tenantId,
        orderId: order.id,
        fromState: from,
        toState: step.state,
        event: step.event,
        actorId: order.createdBy,
        occurredAt: atIstTime(order.day, hour, 0),
      })
      from = step.state
      hour += 1
      if (order.state === 'cancelled' && step.state === 'submitted') {
        transitionRows.push({
          id: demoId('order-transition', `${order.id}:cancel`),
          tenantId,
          orderId: order.id,
          fromState: 'submitted',
          toState: 'cancelled',
          event: 'cancel',
          actorId: people.owner.id,
          occurredAt: atIstTime(order.day, hour, 0),
          reason: 'Retailer asked to cancel; ordered by mistake.',
        })
        break
      }
      if (step.state === order.state) break
    }
  }
  await insertMany(db, orderStateTransitions, transitionRows)

  await insertMany(
    db,
    invoices,
    invoices_.map((inv) => {
      const retailer = retailerByCode.get(inv.retailerCode)
      const fin = invoiceFinancials.get(inv.id)
      const subtotal = fin?.subtotal ?? 0
      const cgst = fin?.cgst ?? 0
      const sgst = fin?.sgst ?? 0
      const cessOnly = fin?.cessOnly ?? 0
      const roundOff = fin?.roundOff ?? 0
      return {
        id: inv.id,
        tenantId,
        invoiceNo: inv.invoiceNo,
        seriesCode: 'INV',
        fy: FY,
        invoiceDate: isoDate(inv.invoiceDate),
        orderId: inv.orderId,
        retailerId: inv.retailerId,
        source: 'pack' as const,
        state: inv.state,
        supplyType: 'B2C' as const,
        sellerGstin: makeTenantGstin(),
        buyerGstin: retailer?.gstin ?? null,
        buyerName: retailer?.name ?? '',
        buyerAddress: { area: 'Kalyan West', city: 'Kalyan', pincode: '421301' },
        placeOfSupplyState: '27',
        sellerFssai: SELLER_FSSAI,
        isInterState: false,
        subtotalPaise: subtotal,
        taxablePaise: subtotal,
        cgstPaise: cgst,
        sgstPaise: sgst,
        cessPaise: cessOnly,
        roundOffPaise: roundOff,
        totalPaise: inv.totalPaise,
        cashDiscountBps: retailer?.cashDiscountBps ?? 0,
        cashDiscountUntil:
          retailer && retailer.cashDiscountBps > 0
            ? isoDate(new Date(inv.invoiceDate.getTime() + retailer.cashDiscountDays * 86_400_000))
            : null,
        dueDate: retailer
          ? isoDate(new Date(inv.invoiceDate.getTime() + retailer.creditDays * 86_400_000))
          : isoDate(inv.invoiceDate),
        upiQrPayload: `upi://pay?pa=tarsun.enterprises@okhdfcbank&pn=Tarsun%20Enterprises&am=${(inv.totalPaise / 100).toFixed(2)}&tr=${inv.invoiceNo.replace(/\//g, '-')}&cu=INR`,
        issuedBy: people.accountant.id,
        issuedAt: atIstTime(inv.invoiceDate, 18, 30),
      }
    }),
  )

  await insertMany(db, invoiceLines, invoiceLineRows)
  await insertMany(db, receipts, receiptRows)
  await insertMany(db, allocations, allocationRows)
  await insertMany(db, journalEntries, journalEntryRows)
  await insertMany(db, journalLines, journalLineRows)
  await insertMany(db, cashDiscountConditions, cashDiscountRows)

  // Three credit notes for short deliveries, off three already-invoiced, delivered/closed orders.
  const shortDeliveryCandidates = invoices_.filter(
    (inv) => inv.state !== 'issued' && (linesByOrderId.get(inv.orderId)?.length ?? 0) > 0,
  )
  const cnRows: (typeof creditNotes.$inferInsert)[] = []
  const cnLineRows: (typeof creditNoteLines.$inferInsert)[] = []
  const shortDeliveries: ShortDelivery[] = []
  for (let i = 0; i < 3 && i < shortDeliveryCandidates.length; i++) {
    const inv = nth(shortDeliveryCandidates, i * 3 < shortDeliveryCandidates.length ? i * 3 : i)
    const orderLines = linesByOrderId.get(inv.orderId) ?? []
    const line = orderLines[0]
    if (!line) continue
    const v = variants.find((vv) => vv.id === line.variantId)
    if (!v) continue
    const shortPcs = Math.min(line.qtyPcs, Math.max(1, Math.round(v.defaultCaseSize / 4)))
    const rate = line.ratePaise
    const taxable = paise(rate * shortPcs)
    const tax = percentOf(taxable, v.gstBps + v.cessBps)
    const { rounded: total, roundOff } = roundToRupee(paise(taxable + tax))
    const cnId = demoId('credit-note', inv.id)
    const invoiceLineId = demoId('invoice-line', `${inv.id}:0`)
    cnRows.push({
      id: cnId,
      tenantId,
      creditNoteNo: `CN/${String(i + 1).padStart(4, '0')}`,
      seriesCode: 'CN',
      fy: FY,
      noteDate: isoDate(inv.invoiceDate),
      invoiceId: inv.id,
      retailerId: inv.retailerId,
      reason: 'short_delivery' as const,
      state: 'issued' as const,
      taxablePaise: taxable,
      cgstPaise: Math.round(tax / 2),
      sgstPaise: tax - Math.round(tax / 2),
      roundOffPaise: roundOff,
      totalPaise: total,
      issuedBy: people.accountant.id,
      issuedAt: atIstTime(inv.invoiceDate, 19, 0),
      note: `${shortPcs} pcs of ${v.name} short at delivery; adjusted against ${inv.invoiceNo}.`,
    })
    cnLineRows.push({
      id: demoId('credit-note-line', cnId),
      tenantId,
      creditNoteId: cnId,
      invoiceLineId,
      qtyPcs: shortPcs,
      saleable: false,
      ratePaise: rate,
      taxablePaise: taxable,
      gstBps: v.gstBps + v.cessBps,
      taxPaise: tax,
      lineTotalPaise: total,
    })
    shortDeliveries.push({ invoiceId: inv.id, shortPcs })
  }
  await insertMany(db, creditNotes, cnRows)
  await insertMany(db, creditNoteLines, cnLineRows)

  // A COUNTER NEVER GOES BACKWARDS. These used to `set: { nextNo }` outright, which quietly rewound a
  // series the app (or `pnpm smoke`) had already allocated past — and the very next real invoice then
  // asked for a number the table already held, so nothing could be billed at all until the next
  // reseed. `seedBilling`'s own `bumpSeries` had this right; these three did not.
  await bumpSeries(db, tenantId, 'SO', 'SO-', soSeq + 1)
  await bumpSeries(db, tenantId, 'INV', 'INV/', invSeq + 1)
  await bumpSeries(db, tenantId, 'CN', 'CN/', cnRows.length + 1)

  // Ageing snapshot as of yesterday: bucket each retailer's still-open invoices by days overdue.
  const asOf = isoDate(daysAgo(1))
  const ageingRows: (typeof ageingSnapshots.$inferInsert)[] = []
  for (const [retailerId, o] of outstandingByRetailer) {
    const buckets = { b0: 0, b8: 0, b16: 0, b31: 0, b60: 0 }
    for (const item of o.items) {
      const overdue = Math.round(
        (daysAgo(1).getTime() - new Date(item.dueDate).getTime()) / 86_400_000,
      )
      if (overdue <= 7) buckets.b0 += item.outstandingPaise
      else if (overdue <= 15) buckets.b8 += item.outstandingPaise
      else if (overdue <= 30) buckets.b16 += item.outstandingPaise
      else if (overdue <= 60) buckets.b31 += item.outstandingPaise
      else buckets.b60 += item.outstandingPaise
    }
    ageingRows.push({
      tenantId,
      retailerId,
      asOf,
      outstandingPaise: o.outstandingPaise,
      bucket0to7Paise: buckets.b0,
      bucket8to15Paise: buckets.b8,
      bucket16to30Paise: buckets.b16,
      bucket31to60Paise: buckets.b31,
      bucket60PlusPaise: buckets.b60,
      openBills: o.openBills,
      oldestDueDate: o.oldestDueDate,
    })
  }
  await insertMany(db, ageingSnapshots, ageingRows)

  return { orders, invoices: invoices_, outstandingByRetailer, shortDeliveries }
}

function makeTenantGstin(): string {
  // Fixed, plausible seller GSTIN for Tarsun Enterprises (Maharashtra), display-only.
  return '27AAXPT9021Q1ZQ'
}
