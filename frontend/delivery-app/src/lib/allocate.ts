/**
 * DOS-062 — WHERE THE MONEY TAKEN AT THIS DOOR ACTUALLY GOES.
 *
 * The founder's rule is bill-to-bill, oldest first unless the crew tags a bill (docs/22 §6). The rule
 * was right and the screen was silent about it: D5 listed the bill riding on this stop over a pad, the
 * driver took the exact figure "for that bill", and the office — correctly — put it on a bill from
 * June. The shopkeeper was never told, the bill in his hand stayed open, and the same bill was still
 * offered as owed afterwards, so a second tap would have taken the money twice.
 *
 * Three rules live here so both halves of the screen ask the same one:
 *   - a bill the office has marked `paid` is not money owed at this door and cannot be tagged
 *     (`invoices.state` is the PAYMENT state on the device: issued / partially_paid / paid / …);
 *   - tagging sends an explicit split (`RecordCollectionInput.allocations` -> `strategy: 'explicit'`
 *     on the server), oldest tagged bill first, each line capped at what that bill is worth and the
 *     whole split never over the money taken — the office refuses a split bigger than its receipt;
 *   - the office's own answer is read back as sentences NAMING the bills, so the driver can say
 *     "this paid INV/0099 of June; the bill in your hand is still open" while the shopkeeper is there.
 *
 * Pure TypeScript, the pattern `doorstep.ts` set: the kit's string layer (`Translator`) and nothing
 * else — no component, no platform module — so it runs under vitest with no Metro. Money arrives as
 * integer paise and is printed by a formatter the screen passes in.
 */
import type { Translator } from '@dos/ui'

/** One bill riding on this door, as the device's own tables hold it. */
export interface DoorBill {
  /** The `deliveries` row id: what the list keys on. */
  id: string
  invoiceId: string
  invoiceNo: string | null
  invoiceDate: string
  totalPaise: number
  /** The bill's payment state as the last pull left it: `issued`, `partially_paid`, `paid`, … */
  state: string
}

/** One line of the explicit split, exactly as `CollectionAllocationInput` takes it. */
export interface TaggedAllocation {
  id: string
  invoiceId: string
  amountPaise: number
}

/** The states in which a bill can still take money — the server's own rule (`requireAllocatable`). */
const TAKES_MONEY: ReadonlySet<string> = new Set(['issued', 'partially_paid'])

/** `RecordCollectionInput.allocations` is capped at 20 lines. */
const MAX_SPLIT_LINES = 20

/** Oldest bill first, and a stable order when two bills carry the same date. */
function oldestFirst(a: DoorBill, b: DoorBill): number {
  if (a.invoiceDate !== b.invoiceDate) return a.invoiceDate < b.invoiceDate ? -1 : 1
  return (a.invoiceNo ?? a.invoiceId).localeCompare(b.invoiceNo ?? b.invoiceId)
}

/**
 * The bills at this door that can still take money, oldest first.
 *
 * A bill the office has already marked `paid` is dropped: offering it again as owed is how the same
 * money gets taken twice at one door.
 */
export function billsThatTakeMoney(bills: readonly DoorBill[]): DoorBill[] {
  return bills.filter((bill) => TAKES_MONEY.has(bill.state)).sort(oldestFirst)
}

/**
 * What the bills AT THIS DOOR still ask for. The stop's `planned_collection_paise` is the office's
 * plan made before the van left, so it keeps counting a bill paid since; this counts only the bills
 * that can still take money.
 */
export function owedHerePaise(bills: readonly DoorBill[]): number {
  return billsThatTakeMoney(bills).reduce((sum, bill) => sum + bill.totalPaise, 0)
}

/**
 * The explicit split for the bills the driver tagged, or `null` when nothing is tagged — and `null`
 * is what sends no `allocations` at all, which is the office's oldest-bill-first rule.
 *
 * The money fills the tagged bills oldest first, each capped at what that bill is worth; a bill that
 * would get nothing is dropped, and a surplus over the tagged bills is simply not allocated (the
 * office places it, or it stays on account). The split can never come to more than the receipt: the
 * server answers 409 for that, at a shop door, after the cash is in the driver's hand.
 */
export function tagAllocations(input: {
  bills: readonly DoorBill[]
  tagged: ReadonlySet<string>
  amountPaise: number
  newId: () => string
}): TaggedAllocation[] | null {
  if (input.tagged.size === 0) return null
  const wanted = billsThatTakeMoney(input.bills).filter((bill) => input.tagged.has(bill.invoiceId))
  const lines: TaggedAllocation[] = []
  let left = Math.max(0, input.amountPaise)
  for (const bill of wanted) {
    if (left <= 0 || lines.length >= MAX_SPLIT_LINES) break
    const amountPaise = Math.min(bill.totalPaise, left)
    if (amountPaise <= 0) continue
    lines.push({ id: input.newId(), invoiceId: bill.invoiceId, amountPaise })
    left -= amountPaise
  }
  return lines
}

/** The bill numbers the driver has tagged, in the order the money will reach them. */
function taggedNumbers(bills: readonly DoorBill[], tagged: ReadonlySet<string>): string[] {
  return billsThatTakeMoney(bills)
    .filter((bill) => tagged.has(bill.invoiceId))
    .map((bill) => bill.invoiceNo ?? bill.invoiceId.slice(0, 8))
}

/**
 * The sentence UNDER the bills, said BEFORE the money changes hands — which is when the shopkeeper is
 * standing there and can still say which bill he means.
 */
export function whereTheMoneyGoes(
  t: Translator,
  input: { bills: readonly DoorBill[]; tagged: ReadonlySet<string>; openBills: number },
): string {
  const numbers = taggedNumbers(input.bills, input.tagged)
  if (numbers.length > 0) return t('d5.goesTo', { bills: numbers.join(', ') })
  return input.openBills > 1
    ? t('d5.oldestFirst', { count: input.openBills })
    : t('d5.oldestFirstOne')
}

/** The bills a receipt touched, exactly as `RecordCollectionOutput` reports them. */
export interface SettledBill {
  id: string
  invoiceNo: string | null
  state: string
  openPaise: number
}

/**
 * What the office actually did with the money, as lines the driver reads out at the door: the bills it
 * paid, the bills it left open, and anything that stayed on account.
 */
export function appliedLines(
  t: Translator,
  result: {
    allocations: readonly { invoiceId: string; amountPaise: number }[]
    invoices: readonly SettledBill[]
    unallocatedPaise: number
    money: (paise: number) => string
  },
): string[] {
  const numberOf = (id: string): string => {
    const bill = result.invoices.find((one) => one.id === id)
    return bill?.invoiceNo ?? id.slice(0, 8)
  }
  const lines = result.allocations.map((one) =>
    t('d5.appliedTo', { no: numberOf(one.invoiceId), amount: result.money(one.amountPaise) }),
  )
  for (const bill of result.invoices) {
    if (bill.openPaise <= 0) continue
    lines.push(
      t('d5.leftOpen', {
        no: bill.invoiceNo ?? bill.id.slice(0, 8),
        amount: result.money(bill.openPaise),
      }),
    )
  }
  if (result.unallocatedPaise > 0)
    lines.push(t('d5.onAccount', { amount: result.money(result.unallocatedPaise) }))
  return lines
}
