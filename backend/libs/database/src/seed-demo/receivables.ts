/**
 * The money side of the demo (ADR 0004): old dues carried in bill by bill, on-account payments waiting to be
 * matched, a cheque cycle that includes one that bounced, doorstep collections, two bad debts written off,
 * and the rollups the owner tile / rep shop card / retailer "my dues" screen read.
 *
 * Runs after seedDelivery so it can see the receipts that trip settlement already created, and recomputes
 * `retailer_outstanding_summary` and `ageing_snapshots` from what is actually in the database at the end —
 * not from an in-memory guess — so the numbers tie to the ledger whoever wrote the rows.
 *
 * Idempotent like the rest of the seed: every id comes from `demoId(...)`, every insert is
 * `onConflictDoNothing()`, and the two rollup tables upsert to the same values a second run computes.
 */
import { and, desc, eq, inArray, notInArray, sql } from 'drizzle-orm'
import { paise } from '@dos/domain'
import {
  accounts,
  ageingSnapshots,
  allocations,
  cashDiscountConditions,
  invoices,
  journalEntries,
  journalLines,
  receipts,
  retailerOutstandingSummary,
  tripStops,
  trips,
  writeOffs,
} from '../schema/index.js'
import type { Db } from '../client.js'
import { insertMany } from './db-helpers.js'
import { demoId } from './ids.js'
import type { PeopleResult } from './people.js'
import type { RetailersResult } from './retailers.js'
import { atIstTime, daysAgo, FY, isoDate, nth, TODAY } from './util.js'

/** Old dues carried over from the previous software, bill by bill (docs/plans/receivables.md §8.4). */
interface OpeningBill {
  no: string
  rupees: number
  /** Days before TODAY the bill was raised. */
  agedDays: number
  /** Days before TODAY it fell due — chosen to land the money in a specific ageing bucket. */
  dueDaysAgo: number
}

const OPENING_BILLS: OpeningBill[] = [
  { no: 'OPEN/0006', rupees: 63_100, agedDays: 130, dueDaysAgo: 109 }, // 90+
  { no: 'OPEN/0005', rupees: 15_600, agedDays: 110, dueDaysAgo: 89 }, // 61-90
  { no: 'OPEN/0004', rupees: 42_000, agedDays: 95, dueDaysAgo: 74 }, // 61-90
  { no: 'OPEN/0003', rupees: 9_850, agedDays: 70, dueDaysAgo: 49 }, // 31-60
  { no: 'OPEN/0002', rupees: 31_200, agedDays: 55, dueDaysAgo: 34 }, // 31-60
  { no: 'OPEN/0001', rupees: 18_400, agedDays: 40, dueDaysAgo: 19 }, // 16-30
  { no: 'OPEN/0007', rupees: 7_500, agedDays: 32, dueDaysAgo: 11 }, // 8-15
]

/** Two tiny old bills nobody is going to pay: the write-off story, and honest 90+ money until then. */
const BAD_DEBT_BILLS = [
  { no: 'OPEN/0008', rupees: 1_240, agedDays: 165, dueDaysAgo: 144 },
  { no: 'OPEN/0009', rupees: 860, agedDays: 150, dueDaysAgo: 129 },
]

const DEPOSIT_REF = 'DEP/2026/0117'
const BOUNCE_CHARGES_PAISE = 35_000
/**
 * The crew's phone and paper receipt book, exercising the offline dedupe key
 * (tenant_id, device_id, client_receipt_no). Attributed to the DELIVERY crew, not a rep: the founder's
 * answer in docs/17 §D item 4 is that a salesperson never takes money.
 */
const CREW_DEVICE_ID = 'demo-delivery-phone-1'

interface OpenBill {
  id: string
  retailerId: string
  invoiceDate: string
  dueDate: string | null
  totalPaise: number
  allocatedPaise: number
}

const openPaiseOf = (b: OpenBill): number => b.totalPaise - b.allocatedPaise

/**
 * `db.execute()` returns untyped rows; these name the shapes each raw query actually selects. Postgres
 * hands `bigint` back as a string and `date` as a string, so every numeric field is widened here and
 * narrowed with Number() at the use site.
 */
type BillRow = {
  id: string
  retailer_id: string
  invoice_date: string
  due_date: string | null
  total_paise: string | number
  allocated: string | number
}
type CreditRow = {
  retailer_id: string
  unallocated: string | number | null
  /** pg hands an aggregated timestamptz back as a string, not a Date, so coerce at the use site. */
  last_receipt_at: Date | string | null
}
type LastReceiptRow = { retailer_id: string; amount_paise: string | number }
type AgeingRow = BillRow & { credit_days: string | number }

/**
 * Credits are negative amounts in `journal_lines` (ADR 0004, debit positive). `Paise` is a branded number,
 * so unwrap before negating rather than applying unary minus to the brand.
 */
const credit = (amountPaise: number): number => -Number(amountPaise)

export async function seedReceivables(
  db: Db,
  tenantId: string,
  retailersRes: RetailersResult,
  people: PeopleResult,
): Promise<void> {
  const accountRows = await db.select().from(accounts).where(eq(accounts.tenantId, tenantId))
  const accountId = new Map(accountRows.map((a) => [a.code, a.id]))
  const acc = (code: string): string => {
    const id = accountId.get(code)
    if (!id) throw new Error(`chart of accounts missing ${code}; run bootstrapTenant first`)
    return id
  }

  const entryRows: (typeof journalEntries.$inferInsert)[] = []
  const lineRows: (typeof journalLines.$inferInsert)[] = []
  const receiptRows: (typeof receipts.$inferInsert)[] = []
  const allocationRows: (typeof allocations.$inferInsert)[] = []

  /** Posts one balanced entry. `lines` are debit-positive, credit-negative and must already sum to zero. */
  function post(
    key: string,
    entryDate: Date,
    refType: string,
    refId: string,
    narration: string,
    postedBy: string,
    lines: { code: string; amountPaise: number; retailerId?: string; memo?: string }[],
  ): string {
    const entryId = demoId('journal-entry', key)
    const sum = lines.reduce((s, l) => s + l.amountPaise, 0)
    if (sum !== 0) throw new Error(`seedReceivables: entry ${key} does not balance (${sum} paise)`)
    entryRows.push({
      id: entryId,
      tenantId,
      entryDate: isoDate(entryDate),
      refType,
      refId,
      narration,
      idempotencyKey: `journal:${key}`,
      postedBy,
      postedAt: entryDate,
    })
    lines.forEach((l, i) => {
      lineRows.push({
        id: demoId('journal-line', `${key}:${i}`),
        tenantId,
        entryId,
        accountId: acc(l.code),
        amountPaise: l.amountPaise,
        partyType: l.retailerId ? 'retailer' : null,
        partyId: l.retailerId ?? null,
        memo: l.memo ?? null,
      })
    })
    return entryId
  }

  // ---------------------------------------------------------------------------------------------------
  // 1. Opening balances: the previous software's outstanding, carried in bill by bill so that bill-to-bill
  //    allocation and the ageing buckets work from day one (docs/17 §D, "opening balances as journal
  //    entries against the OPENING account"). Each is a synthetic invoice, source = import, series OPEN.
  // ---------------------------------------------------------------------------------------------------
  const byTier = (tier: 'A' | 'B' | 'C' | 'D') =>
    retailersRes.retailers.filter((r) => r.tier === tier)
  const openingHosts = [...byTier('C'), ...byTier('B'), ...byTier('D')]
  const badDebtHosts = byTier('D')
  const invoiceRows: (typeof invoices.$inferInsert)[] = []

  const carriedBills = [...OPENING_BILLS, ...BAD_DEBT_BILLS].map((bill, i) => {
    const isBadDebt = i >= OPENING_BILLS.length
    const host = isBadDebt
      ? nth(badDebtHosts, (i - OPENING_BILLS.length) % badDebtHosts.length)
      : nth(openingHosts, (i * 3) % openingHosts.length)
    const invoiceDate = daysAgo(bill.agedDays)
    const totalPaise = paise(bill.rupees * 100)
    const invoiceId = demoId('opening-invoice', bill.no)
    invoiceRows.push({
      id: invoiceId,
      tenantId,
      invoiceNo: bill.no,
      seriesCode: 'OPEN',
      fy: FY,
      invoiceDate: isoDate(invoiceDate),
      retailerId: host.id,
      source: 'import' as const,
      state: 'issued' as const,
      supplyType: host.gstin ? ('B2B' as const) : ('B2C' as const),
      buyerGstin: host.gstin,
      buyerName: host.name,
      placeOfSupplyState: '27',
      subtotalPaise: totalPaise,
      taxablePaise: totalPaise,
      totalPaise,
      dueDate: isoDate(daysAgo(bill.dueDaysAgo)),
      issuedBy: people.accountant.id,
      issuedAt: atIstTime(invoiceDate, 11, 0),
    })
    post(
      `opening:${bill.no}`,
      invoiceDate,
      'opening',
      invoiceId,
      `Opening balance ${bill.no} (${host.name})`,
      people.accountant.id,
      [
        { code: 'AR', amountPaise: totalPaise, retailerId: host.id },
        { code: 'OPENING', amountPaise: credit(totalPaise) },
      ],
    )
    return { billNo: bill.no, invoiceId, retailerId: host.id, totalPaise, isBadDebt }
  })
  await insertMany(db, invoices, invoiceRows)

  // ---------------------------------------------------------------------------------------------------
  // 2. Everything below allocates against real open bills, so read them (including the opening ones just
  //    written) with what has already been settled.
  // ---------------------------------------------------------------------------------------------------
  const open = await loadOpenBills(db, tenantId)
  const takenInvoices = new Set<string>()
  /**
   * The carried-over dues are the demo's ageing story: they are what puts real money in the 16-30, 31-60,
   * 61-90 and 90+ buckets, so nothing below is allowed to pay one off. (That is also the truth of the
   * business — old dues are old precisely because nobody has paid them.)
   */
  const carriedInvoiceIds = new Set(carriedBills.map((b) => b.invoiceId))
  /** Picks the next open bill nobody in this step has claimed yet, largest first for a bit of realism. */
  function claimBill(predicate: (b: OpenBill) => boolean = () => true): OpenBill | undefined {
    const bill = open
      .filter(
        (b) =>
          !takenInvoices.has(b.id) &&
          !carriedInvoiceIds.has(b.id) &&
          openPaiseOf(b) > 0 &&
          predicate(b),
      )
      .sort((a, b) => openPaiseOf(b) - openPaiseOf(a))[0]
    if (bill) takenInvoices.add(bill.id)
    return bill
  }

  function addReceipt(
    key: string,
    row: Omit<typeof receipts.$inferInsert, 'id' | 'tenantId' | 'idempotencyKey'>,
  ): string {
    const id = demoId('receipt', key)
    receiptRows.push({ ...row, id, tenantId, idempotencyKey: `receipt:${key}` })
    return id
  }

  function allocate(
    key: string,
    invoiceId: string,
    source: { receiptId?: string; writeOffId?: string },
    amountPaise: number,
    at: Date,
    by: string,
  ): void {
    allocationRows.push({
      id: demoId('allocation', key),
      tenantId,
      invoiceId,
      receiptId: source.receiptId ?? null,
      creditNoteId: null,
      writeOffId: source.writeOffId ?? null,
      amountPaise,
      allocatedAt: at,
      allocatedBy: by,
    })
  }

  // ---------------------------------------------------------------------------------------------------
  // 3. Eight on-account payments: money in the drawer that nobody has matched to a bill yet, which is what
  //    the desk's `unallocatedOnly` filter and the allocation screen exist for.
  // ---------------------------------------------------------------------------------------------------
  const onAccountHosts = [...byTier('B'), ...byTier('C')]
  const onAccountRupees = [500, 1_250, 2_000, 2_750, 3_400, 4_100, 4_800, 5_000]
  onAccountRupees.forEach((rupees, i) => {
    const host = nth(onAccountHosts, (i * 5) % onAccountHosts.length)
    const amountPaise = paise(rupees * 100)
    const receivedAt = atIstTime(daysAgo(i + 1), 15, 45)
    const mode = i % 2 === 0 ? ('cash' as const) : ('upi' as const)
    const key = `on-account:${i}`
    const receiptId = addReceipt(key, {
      receiptNo: `RCPT-OA-${String(i + 1).padStart(4, '0')}`,
      retailerId: host.id,
      mode,
      amountPaise,
      receivedAt,
      receivedBy: people.accountant.id,
      reference: mode === 'upi' ? `UTR${420000000 + i}` : null,
      upiVpa: mode === 'upi' ? `${host.code.toLowerCase()}@okaxis` : null,
      note: 'Paid on account; bill not named.',
    })
    post(
      `receipt:${key}`,
      receivedAt,
      'receipt',
      receiptId,
      `On-account payment from ${host.name}`,
      people.accountant.id,
      [
        { code: mode === 'cash' ? 'CASH' : 'UPI', amountPaise },
        { code: 'AR', amountPaise: credit(amountPaise), retailerId: host.id },
      ],
    )
  })

  // ---------------------------------------------------------------------------------------------------
  // 4. Five cheques: two still in hand, two banked in one deposit batch, one returned unpaid.
  // ---------------------------------------------------------------------------------------------------
  const chequeBills = [0, 1, 2, 3, 4]
    .map(() => claimBill((b) => openPaiseOf(b) >= 200_000 && openPaiseOf(b) <= 6_000_000))
    .filter((b): b is OpenBill => b !== undefined)
  const depositedIds: string[] = []
  let depositTotal = 0
  chequeBills.forEach((bill, i) => {
    const amountPaise = openPaiseOf(bill)
    const host = retailersRes.retailers.find((r) => r.id === bill.retailerId)
    const receivedAt = atIstTime(daysAgo(i === 0 ? 0 : i === 1 ? 1 : i + 2), 12, 30)
    const deposited = i === 2 || i === 3
    const bounced = i === 4
    const key = `cheque:${i}`
    const receiptId = addReceipt(key, {
      receiptNo: `RCPT-CHQ-${String(i + 1).padStart(4, '0')}`,
      retailerId: bill.retailerId,
      mode: 'cheque',
      amountPaise,
      receivedAt,
      receivedBy: people.accountant.id,
      reference: `${560021 + i}`,
      bankName: i % 2 === 0 ? 'Bank of Maharashtra' : 'HDFC Bank',
      chequeDate: isoDate(daysAgo(i)),
      status: bounced ? ('bounced' as const) : deposited ? ('deposited' as const) : undefined,
      depositedAt: deposited ? atIstTime(daysAgo(1), 11, 0) : null,
      depositRef: deposited ? DEPOSIT_REF : null,
      depositAccountId: deposited ? acc('BANK') : null,
      bouncedAt: bounced ? atIstTime(daysAgo(1), 16, 0) : null,
      bounceReason: bounced ? 'insufficient funds' : null,
      bankChargesPaise: bounced ? BOUNCE_CHARGES_PAISE : 0,
    })
    post(
      `receipt:${key}`,
      receivedAt,
      'receipt',
      receiptId,
      `Cheque ${560021 + i} from ${host?.name ?? 'shop'}`,
      people.accountant.id,
      [
        { code: 'CHEQUES', amountPaise },
        { code: 'AR', amountPaise: credit(amountPaise), retailerId: bill.retailerId },
      ],
    )
    allocate(key, bill.id, { receiptId }, amountPaise, receivedAt, people.accountant.id)
    if (deposited) {
      depositedIds.push(receiptId)
      depositTotal += amountPaise
    }
    if (bounced) {
      // A returned cheque must put AR back exactly where it was, and the bank's fee is our cost
      // (docs/plans/00-coordination.md §7 question 9): DR BANK_CHARGES / CR BANK, never billed to the shop.
      const bouncedAt = atIstTime(daysAgo(1), 16, 0)
      const reversalId = addReceipt(`cheque-bounce:${i}`, {
        receiptNo: `RCPT-CHQ-${String(i + 1).padStart(4, '0')}-R`,
        retailerId: bill.retailerId,
        mode: 'cheque',
        amountPaise: credit(amountPaise),
        receivedAt: bouncedAt,
        receivedBy: people.accountant.id,
        reversesReceiptId: receiptId,
        status: 'cancelled' as const,
        note: 'Reverses the returned cheque; insufficient funds.',
      })
      post(
        `receipt-bounce:${i}`,
        bouncedAt,
        'receipt',
        reversalId,
        `Cheque ${560021 + i} returned unpaid (${host?.name ?? 'shop'})`,
        people.accountant.id,
        [
          { code: 'AR', amountPaise, retailerId: bill.retailerId },
          { code: 'CHEQUES', amountPaise: credit(amountPaise) },
          {
            code: 'BANK_CHARGES',
            amountPaise: BOUNCE_CHARGES_PAISE,
            memo: 'Cheque return charges',
          },
          { code: 'BANK', amountPaise: credit(BOUNCE_CHARGES_PAISE) },
        ],
      )
      allocate(
        `cheque-bounce:${i}`,
        bill.id,
        { receiptId: reversalId },
        credit(amountPaise),
        bouncedAt,
        people.accountant.id,
      )
    }
  })
  if (depositedIds.length > 0) {
    post(
      'deposit:0117',
      atIstTime(daysAgo(1), 11, 0),
      'deposit',
      DEPOSIT_REF,
      `Cheques banked, ${DEPOSIT_REF}`,
      people.accountant.id,
      [
        { code: 'BANK', amountPaise: depositTotal },
        { code: 'CHEQUES', amountPaise: credit(depositTotal) },
      ],
    )
  }

  // ---------------------------------------------------------------------------------------------------
  // 5. Three receipts written in the crew's paper book on one phone, so the offline dedupe key
  //    (tenant_id, device_id, client_receipt_no) has something to dedupe. Part payments, so the bills they
  //    touch land in `partially_paid`.
  // ---------------------------------------------------------------------------------------------------
  for (let i = 0; i < 3; i++) {
    const bill = claimBill((b) => openPaiseOf(b) >= 100_000)
    if (!bill) continue
    const amountPaise = Math.max(10_000, Math.round((openPaiseOf(bill) * 0.6) / 100) * 100)
    const receivedAt = atIstTime(daysAgo(i + 2), 18, 10)
    const key = `crew-book:${i}`
    const receiptId = addReceipt(key, {
      receiptNo: `RCPT-FLD-${String(i + 1).padStart(4, '0')}`,
      retailerId: bill.retailerId,
      mode: 'cash',
      amountPaise,
      receivedAt,
      receivedBy: people.delivery.ganesh.id,
      deviceId: CREW_DEVICE_ID,
      clientReceiptNo: `R-000${i + 1}`,
      note: 'Part payment collected at the door.',
    })
    post(
      `receipt:${key}`,
      receivedAt,
      'receipt',
      receiptId,
      `Part payment against a bill, paper receipt R-000${i + 1}`,
      people.delivery.ganesh.id,
      [
        { code: 'CASH', amountPaise },
        { code: 'AR', amountPaise: credit(amountPaise), retailerId: bill.retailerId },
      ],
    )
    allocate(key, bill.id, { receiptId }, amountPaise, receivedAt, people.delivery.ganesh.id)
  }

  // ---------------------------------------------------------------------------------------------------
  // 6. Four cash collections still riding in a van: they post to CASH_VAN, not CASH, until the trip is
  //    settled — which is what makes the owner's "cash in transit" tile a real number (§4.4 of the brief).
  // ---------------------------------------------------------------------------------------------------
  const tripPairs = await db
    .select({ tripId: trips.id, retailerId: tripStops.retailerId })
    .from(trips)
    .innerJoin(tripStops, eq(tripStops.tripId, trips.id))
    .where(eq(trips.tenantId, tenantId))
  const crew = [people.delivery.ganesh, people.delivery.raju, people.delivery.santosh]
  let vanSeq = 0
  for (const pair of tripPairs) {
    if (vanSeq >= 4) break
    const bill = claimBill((b) => b.retailerId === pair.retailerId && openPaiseOf(b) >= 50_000)
    if (!bill) continue
    const amountPaise = openPaiseOf(bill)
    const collectedAt = atIstTime(daysAgo(vanSeq === 0 ? 0 : 1), 13, 20)
    const key = `van-cash:${vanSeq}`
    const collector = nth(crew, vanSeq % crew.length)
    const receiptId = addReceipt(key, {
      receiptNo: `RCPT-VAN-${String(vanSeq + 1).padStart(4, '0')}`,
      retailerId: bill.retailerId,
      mode: 'cash',
      amountPaise,
      receivedAt: collectedAt,
      receivedBy: collector.id,
      tripId: pair.tripId,
      note: 'Cash taken at the door; not handed over yet.',
    })
    post(
      `receipt:${key}`,
      collectedAt,
      'receipt',
      receiptId,
      `Doorstep cash on a live trip (${collector.name})`,
      collector.id,
      [
        { code: 'CASH_VAN', amountPaise },
        { code: 'AR', amountPaise: credit(amountPaise), retailerId: bill.retailerId },
      ],
    )
    allocate(key, bill.id, { receiptId }, amountPaise, collectedAt, collector.id)
    vanSeq += 1
  }

  // ---------------------------------------------------------------------------------------------------
  // 7. One keying error and its reversal: a receipt is never edited, only reversed, so the ledger screen
  //    shows the pair and the "receipts are immutable" story is visible in the UI.
  // ---------------------------------------------------------------------------------------------------
  {
    const host = nth(byTier('C'), 1)
    const amountPaise = paise(2_000 * 100)
    const receivedAt = atIstTime(daysAgo(5), 17, 5)
    const reversedAt = atIstTime(daysAgo(4), 10, 15)
    const receiptId = addReceipt('keying-error', {
      receiptNo: 'RCPT-ERR-0001',
      retailerId: host.id,
      mode: 'cash',
      amountPaise,
      receivedAt,
      receivedBy: people.accountant.id,
      status: 'cancelled' as const,
      note: 'Keyed against the wrong shop; reversed the next morning.',
    })
    post(
      'receipt:keying-error',
      receivedAt,
      'receipt',
      receiptId,
      `Cash from ${host.name}`,
      people.accountant.id,
      [
        { code: 'CASH', amountPaise },
        { code: 'AR', amountPaise: credit(amountPaise), retailerId: host.id },
      ],
    )
    const reversalId = addReceipt('keying-error-reversal', {
      receiptNo: 'RCPT-ERR-0001-R',
      retailerId: host.id,
      mode: 'cash',
      amountPaise: credit(amountPaise),
      receivedAt: reversedAt,
      receivedBy: people.accountant.id,
      reversesReceiptId: receiptId,
      status: 'cancelled' as const,
      note: 'Reverses RCPT-ERR-0001 (wrong shop).',
    })
    post(
      'receipt-reversal:keying-error',
      reversedAt,
      'receipt',
      reversalId,
      `Reversal of RCPT-ERR-0001 (${host.name})`,
      people.accountant.id,
      [
        { code: 'AR', amountPaise, retailerId: host.id },
        { code: 'CASH', amountPaise: credit(amountPaise) },
      ],
    )
  }

  // ---------------------------------------------------------------------------------------------------
  // 8. Two bad debts the owner has stopped chasing. A write-off is a financial entry plus an allocation
  //    that closes the bill — never a credit note, which is a tax document.
  // ---------------------------------------------------------------------------------------------------
  const writeOffRows: (typeof writeOffs.$inferInsert)[] = []
  const writtenOffInvoiceIds: string[] = []
  carriedBills
    .filter((b) => b.isBadDebt)
    .forEach((bill, i) => {
      const writeOffId = demoId('write-off', bill.billNo)
      const at = atIstTime(daysAgo(3), 16, 40)
      const entryId = post(
        `writeoff:${bill.billNo}`,
        at,
        'writeoff',
        writeOffId,
        `Bad debt written off against ${bill.billNo}`,
        people.owner.id,
        [
          { code: 'BAD_DEBTS', amountPaise: bill.totalPaise },
          { code: 'AR', amountPaise: credit(bill.totalPaise), retailerId: bill.retailerId },
        ],
      )
      writeOffRows.push({
        id: writeOffId,
        tenantId,
        invoiceId: bill.invoiceId,
        retailerId: bill.retailerId,
        amountPaise: bill.totalPaise,
        reason: 'bad_debt',
        note: i === 0 ? 'Shop shut down; owner untraceable.' : 'Settled at zero after two years.',
        approvedBy: people.owner.id,
        journalEntryId: entryId,
        idempotencyKey: `writeoff:${bill.billNo}`,
      })
      allocate(
        `writeoff:${bill.billNo}`,
        bill.invoiceId,
        { writeOffId },
        bill.totalPaise,
        at,
        people.owner.id,
      )
      writtenOffInvoiceIds.push(bill.invoiceId)
    })

  // Order matters: write_offs points at its journal entry, and allocations point at both a receipt and a
  // write-off. Lines follow their entries because journal_lines carries an FK and a deferred balance check.
  await insertMany(db, receipts, receiptRows)
  await insertMany(db, journalEntries, entryRows)
  await insertMany(db, journalLines, lineRows)
  await insertMany(db, writeOffs, writeOffRows)
  await insertMany(db, allocations, allocationRows)

  // ---------------------------------------------------------------------------------------------------
  // 9. Four cash-discount offers whose window is still open: the desk's "collect before it shuts" queue.
  //    One row per invoice (unique index), so only bills that do not already carry an offer qualify.
  // ---------------------------------------------------------------------------------------------------
  // The candidates come from the full invoice list ordered deterministically, NOT from the open bills:
  // a bill that one of the steps above has just paid off would drop out of `open` on the next run and the
  // seed would pick a different invoice each time. An invoice already carrying an offer that this step did
  // not write (sales.ts realises or lapses its own) is skipped — one row per invoice, unique index.
  const existingCondition = new Map(
    (
      await db
        .select({ id: cashDiscountConditions.id, invoiceId: cashDiscountConditions.invoiceId })
        .from(cashDiscountConditions)
        .where(eq(cashDiscountConditions.tenantId, tenantId))
    ).map((r) => [r.invoiceId, r.id]),
  )
  const aTier = new Set(byTier('A').map((r) => r.id))
  const payByDays = [1, 2, 2, 3]
  const candidates = await db
    .select({ id: invoices.id, retailerId: invoices.retailerId })
    .from(invoices)
    .where(
      and(
        eq(invoices.tenantId, tenantId),
        notInArray(invoices.state, ['draft', 'cancelled']),
        inArray(invoices.retailerId, [...aTier]),
      ),
    )
    .orderBy(desc(invoices.invoiceDate), desc(invoices.id))
  const cashDiscountRows: (typeof cashDiscountConditions.$inferInsert)[] = []
  for (const candidate of candidates) {
    if (cashDiscountRows.length >= payByDays.length) break
    const mine = demoId('cash-discount-open', candidate.id)
    const existing = existingCondition.get(candidate.id)
    if (existing && existing !== mine) continue
    cashDiscountRows.push({
      id: mine,
      tenantId,
      invoiceId: candidate.id,
      discountBps: 200,
      payBy: isoDate(
        new Date(TODAY.getTime() + nth(payByDays, cashDiscountRows.length) * 86_400_000),
      ),
      status: 'open' as const,
    })
  }
  await insertMany(db, cashDiscountConditions, cashDiscountRows)

  // ---------------------------------------------------------------------------------------------------
  // 10. Move each touched invoice to the payment state its allocations imply. `invoices.state` is the one
  //     derived column receivables owns (docs/plans/00-coordination.md §3.2); the immutability trigger from
  //     migration 0003 is what stops anything else on an issued bill from changing.
  // ---------------------------------------------------------------------------------------------------
  await db.execute(sql`
    update invoices i
       set state = case
                     when coalesce(a.allocated, 0) >= i.total_paise then 'paid'::invoice_state
                     when coalesce(a.allocated, 0) > 0 then 'partially_paid'::invoice_state
                     else 'issued'::invoice_state
                   end
      from invoices src
      left join lateral (
        select sum(al.amount_paise) as allocated
          from allocations al
         where al.tenant_id = src.tenant_id and al.invoice_id = src.id) a on true
     where src.id = i.id
       and i.tenant_id = ${tenantId}
       and i.state not in ('draft', 'cancelled')`)
  if (writtenOffInvoiceIds.length > 0) {
    await db
      .update(invoices)
      .set({ state: 'written_off' })
      .where(and(eq(invoices.tenantId, tenantId), inArray(invoices.id, writtenOffInvoiceIds)))
  }

  await refreshOutstanding(db, tenantId, retailersRes)
  await writeAgeingSnapshots(db, tenantId)
  await assertBooksTie(db, tenantId)
}

/** Every open bill of the tenant with what has already been settled against it. */
async function loadOpenBills(db: Db, tenantId: string): Promise<OpenBill[]> {
  const result = await db.execute(sql`
    select i.id, i.retailer_id, i.invoice_date, i.due_date, i.total_paise,
           coalesce(a.allocated, 0) as allocated
      from invoices i
      left join lateral (
        select sum(al.amount_paise) as allocated
          from allocations al
         where al.tenant_id = i.tenant_id and al.invoice_id = i.id) a on true
     where i.tenant_id = ${tenantId}
       and i.state in ('issued', 'partially_paid')`)
  return (result.rows as BillRow[]).map((row) => ({
    id: row.id,
    retailerId: row.retailer_id,
    invoiceDate: row.invoice_date,
    dueDate: row.due_date,
    totalPaise: Number(row.total_paise),
    allocatedPaise: Number(row.allocated),
  }))
}

/**
 * UPDATE-first upsert of the one row per shop that every dues screen reads (scale rule 9: a rollup, never a
 * ledger scan). `outstanding_paise` is the gross open value of the shop's bills; money paid on account that
 * has not been matched to a bill sits in `unallocated_credit_paise`, so
 * `outstanding - unallocated_credit` is the shop's AR balance in the journal.
 */
async function refreshOutstanding(
  db: Db,
  tenantId: string,
  retailersRes: RetailersResult,
): Promise<void> {
  const asOf = isoDate(TODAY)
  const bills = await loadOpenBills(db, tenantId)
  const creditDaysByRetailer = new Map(retailersRes.retailers.map((r) => [r.id, r.creditDays]))
  const creditResult = await db.execute(sql`
    select r.retailer_id,
           sum(r.amount_paise + r.cash_discount_paise) - coalesce(sum(al.allocated), 0) as unallocated,
           max(r.received_at) filter (where r.amount_paise > 0) as last_receipt_at
      from receipts r
      left join lateral (
        select sum(a.amount_paise) as allocated
          from allocations a
         where a.tenant_id = r.tenant_id and a.receipt_id = r.id) al on true
     where r.tenant_id = ${tenantId}
     group by r.retailer_id`)
  const creditByRetailer = new Map<string, { unallocated: number; lastReceiptAt: Date | null }>()
  for (const row of creditResult.rows as CreditRow[]) {
    creditByRetailer.set(row.retailer_id, {
      unallocated: Number(row.unallocated ?? 0),
      lastReceiptAt: row.last_receipt_at === null ? null : new Date(row.last_receipt_at),
    })
  }
  const lastReceiptResult = await db.execute(sql`
    select distinct on (retailer_id) retailer_id, amount_paise
      from receipts
     where tenant_id = ${tenantId} and amount_paise > 0
     order by retailer_id, received_at desc`)
  const lastReceiptPaise = new Map(
    (lastReceiptResult.rows as LastReceiptRow[]).map(
      (row) => [row.retailer_id, Number(row.amount_paise)] as const,
    ),
  )

  const rows: (typeof retailerOutstandingSummary.$inferInsert)[] = retailersRes.retailers.map(
    (retailer) => {
      const mine = bills.filter((b) => b.retailerId === retailer.id && openPaiseOf(b) > 0)
      const buckets = [0, 0, 0, 0, 0, 0]
      let overdue = 0
      let oldestDue: string | null = null
      let oldestInvoice: string | null = null
      for (const bill of mine) {
        const openPaise = openPaiseOf(bill)
        const due = dueDateOf(bill, creditDaysByRetailer.get(retailer.id) ?? 0)
        addToBucket(buckets, daysBetweenDates(due, asOf), openPaise)
        if (due < asOf) overdue += openPaise
        if (!oldestDue || due < oldestDue) oldestDue = due
        if (!oldestInvoice || bill.invoiceDate < oldestInvoice) oldestInvoice = bill.invoiceDate
      }
      const c = creditByRetailer.get(retailer.id)
      return {
        tenantId,
        retailerId: retailer.id,
        outstandingPaise: mine.reduce((s, b) => s + openPaiseOf(b), 0),
        overduePaise: overdue,
        unallocatedCreditPaise: c?.unallocated ?? 0,
        openBills: mine.length,
        oldestDueDate: oldestDue,
        oldestInvoiceDate: oldestInvoice,
        lastReceiptAt: c?.lastReceiptAt ?? null,
        lastReceiptPaise: lastReceiptPaise.get(retailer.id) ?? null,
        bucket0to7Paise: nth(buckets, 0),
        bucket8to15Paise: nth(buckets, 1),
        bucket16to30Paise: nth(buckets, 2),
        bucket31to60Paise: nth(buckets, 3),
        bucket61to90Paise: nth(buckets, 4),
        bucket90PlusPaise: nth(buckets, 5),
        asOf,
      }
    },
  )
  if (rows.length === 0) return
  await db
    .insert(retailerOutstandingSummary)
    .values(rows)
    .onConflictDoUpdate({
      target: [retailerOutstandingSummary.tenantId, retailerOutstandingSummary.retailerId],
      set: {
        outstandingPaise: sql`excluded.outstanding_paise`,
        overduePaise: sql`excluded.overdue_paise`,
        unallocatedCreditPaise: sql`excluded.unallocated_credit_paise`,
        openBills: sql`excluded.open_bills`,
        oldestDueDate: sql`excluded.oldest_due_date`,
        oldestInvoiceDate: sql`excluded.oldest_invoice_date`,
        lastReceiptAt: sql`excluded.last_receipt_at`,
        lastReceiptPaise: sql`excluded.last_receipt_paise`,
        bucket0to7Paise: sql`excluded.bucket_0_7_paise`,
        bucket8to15Paise: sql`excluded.bucket_8_15_paise`,
        bucket16to30Paise: sql`excluded.bucket_16_30_paise`,
        bucket31to60Paise: sql`excluded.bucket_31_60_paise`,
        bucket61to90Paise: sql`excluded.bucket_61_90_paise`,
        bucket90PlusPaise: sql`excluded.bucket_90_plus_paise`,
        asOf: sql`excluded.as_of`,
      },
    })
}

/**
 * Three days of history (today, yesterday, a week ago) so the owner's ageing chart has a trend, each one
 * computed from the bills that existed and the money that had arrived by that date.
 */
async function writeAgeingSnapshots(db: Db, tenantId: string): Promise<void> {
  for (const back of [0, 1, 7]) {
    const asOfDate = daysAgo(back)
    const asOf = isoDate(asOfDate)
    const result = await db.execute(sql`
      select i.retailer_id, i.invoice_date, i.due_date, i.total_paise,
             coalesce(a.allocated, 0) as allocated,
             coalesce(r.credit_days, 0) as credit_days
        from invoices i
        join retailers r on r.id = i.retailer_id
        left join lateral (
          select sum(al.amount_paise) as allocated
            from allocations al
           where al.tenant_id = i.tenant_id and al.invoice_id = i.id
             and al.allocated_at < ${isoDate(daysAgo(back - 1))}::date) a on true
       where i.tenant_id = ${tenantId}
         and i.state not in ('draft', 'cancelled')
         and i.invoice_date <= ${asOf}::date`)
    const perRetailer = new Map<
      string,
      { buckets: number[]; overdue: number; open: number; bills: number; oldestDue: string | null }
    >()
    for (const row of result.rows as AgeingRow[]) {
      const openPaise = Number(row.total_paise) - Number(row.allocated)
      if (openPaise <= 0) continue
      const retailerId = row.retailer_id
      const due =
        row.due_date ??
        isoDate(
          new Date(new Date(row.invoice_date).getTime() + Number(row.credit_days) * 86_400_000),
        )
      const entry = perRetailer.get(retailerId) ?? {
        buckets: [0, 0, 0, 0, 0, 0],
        overdue: 0,
        open: 0,
        bills: 0,
        oldestDue: null,
      }
      addToBucket(entry.buckets, daysBetweenDates(due, asOf), openPaise)
      if (due < asOf) entry.overdue += openPaise
      entry.open += openPaise
      entry.bills += 1
      if (!entry.oldestDue || due < entry.oldestDue) entry.oldestDue = due
      perRetailer.set(retailerId, entry)
    }
    const rows: (typeof ageingSnapshots.$inferInsert)[] = [...perRetailer].map(
      ([retailerId, e]) => ({
        tenantId,
        retailerId,
        asOf,
        outstandingPaise: e.open,
        bucket0to7Paise: nth(e.buckets, 0),
        bucket8to15Paise: nth(e.buckets, 1),
        bucket16to30Paise: nth(e.buckets, 2),
        bucket31to60Paise: nth(e.buckets, 3),
        // The legacy roll-up column is exactly 61-90 plus 90+ (a spec asserts the identity).
        bucket60PlusPaise: nth(e.buckets, 4) + nth(e.buckets, 5),
        bucket61to90Paise: nth(e.buckets, 4),
        bucket90PlusPaise: nth(e.buckets, 5),
        overduePaise: e.overdue,
        openBills: e.bills,
        oldestDueDate: e.oldestDue,
        computedAt: atIstTime(asOfDate, 0, 30),
      }),
    )
    if (rows.length === 0) continue
    await db
      .insert(ageingSnapshots)
      .values(rows)
      .onConflictDoUpdate({
        target: [ageingSnapshots.tenantId, ageingSnapshots.retailerId, ageingSnapshots.asOf],
        set: {
          outstandingPaise: sql`excluded.outstanding_paise`,
          bucket0to7Paise: sql`excluded.bucket_0_7_paise`,
          bucket8to15Paise: sql`excluded.bucket_8_15_paise`,
          bucket16to30Paise: sql`excluded.bucket_16_30_paise`,
          bucket31to60Paise: sql`excluded.bucket_31_60_paise`,
          bucket60PlusPaise: sql`excluded.bucket_60_plus_paise`,
          bucket61to90Paise: sql`excluded.bucket_61_90_paise`,
          bucket90PlusPaise: sql`excluded.bucket_90_plus_paise`,
          overduePaise: sql`excluded.overdue_paise`,
          openBills: sql`excluded.open_bills`,
          oldestDueDate: sql`excluded.oldest_due_date`,
          computedAt: sql`excluded.computed_at`,
        },
      })
  }
}

/**
 * The seed is the first integration test (docs/plans/receivables.md §6): every entry balances to the paisa,
 * and the rollup every screen reads agrees with the double-entry book it summarises.
 */
async function assertBooksTie(db: Db, tenantId: string): Promise<void> {
  const unbalanced = await db.execute(sql`
    select entry_id, sum(amount_paise) as total
      from journal_lines where tenant_id = ${tenantId}
     group by entry_id having sum(amount_paise) <> 0`)
  if (unbalanced.rows.length > 0) {
    throw new Error(
      `seedReceivables: ${unbalanced.rows.length} journal entries do not balance, first is ${JSON.stringify(unbalanced.rows[0])}`,
    )
  }
  const [arRow] = (
    await db.execute(sql`
      select coalesce(sum(jl.amount_paise), 0) as ar
        from journal_lines jl join accounts a on a.id = jl.account_id
       where jl.tenant_id = ${tenantId} and a.code = 'AR'`)
  ).rows
  const [summaryRow] = (
    await db.execute(sql`
      select coalesce(sum(outstanding_paise - unallocated_credit_paise), 0) as net
        from retailer_outstanding_summary where tenant_id = ${tenantId}`)
  ).rows
  const ar = Number((arRow as { ar: string | number } | undefined)?.ar ?? 0)
  const net = Number((summaryRow as { net: string | number } | undefined)?.net ?? 0)
  if (ar !== net) {
    throw new Error(
      `seedReceivables: retailer_outstanding_summary nets to ${net} paise but the AR account balance is ${ar} paise`,
    )
  }
}

/** Ageing is keyed on the due date, falling back to invoice date + the shop's credit days. */
function dueDateOf(bill: OpenBill, creditDays: number): string {
  if (bill.dueDate) return bill.dueDate
  return isoDate(new Date(new Date(bill.invoiceDate).getTime() + creditDays * 86_400_000))
}

/** Whole days from `from` to `to`, both ISO dates. Negative when the bill is not due yet. */
function daysBetweenDates(from: string, to: string): number {
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000)
}

/** 0-7, 8-15, 16-30, 31-60, 61-90, 90+ days overdue; a bill not yet due counts as current. */
function addToBucket(buckets: number[], overdueDays: number, openPaise: number): void {
  const i = bucketIndex(overdueDays)
  buckets[i] = nth(buckets, i) + openPaise
}

function bucketIndex(overdueDays: number): number {
  if (overdueDays <= 7) return 0
  if (overdueDays <= 15) return 1
  if (overdueDays <= 30) return 2
  if (overdueDays <= 60) return 3
  if (overdueDays <= 90) return 4
  return 5
}
