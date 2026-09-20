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
 *     on the server), oldest tagged bill first, each line capped at what that bill STILL OWES and the
 *     whole split never over the money taken — the office refuses a line bigger than the bill's open
 *     balance and a split bigger than its receipt, both with a 409 at the door;
 *   - that open balance is the OFFICE'S figure, not one this device can work out: the screen asks
 *     `receivables.outstanding.get({ includeBills: true })`, and until the answer is in, a bill is
 *     listed and counted at its face value but cannot be tagged, and the screen says so;
 *   - the office's own answer is read back as sentences NAMING the bills, so the driver can say
 *     "this paid INV/0099 of June; the bill in your hand is still open" while the shopkeeper is there.
 *
 * Pure TypeScript, the pattern `doorstep.ts` set: the kit's string layer (`Translator`) and nothing
 * else — no component, no platform module — so it runs under vitest with no Metro. Money arrives as
 * integer paise and is printed by a formatter the screen passes in.
 */
import { wordFor, type Translator } from '@dos/ui'

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
  /**
   * WHAT THIS BILL STILL ASKS FOR, as the office answered a moment ago — `null` when it has not been
   * asked (no signal, or the answer has not arrived yet).
   *
   * THIS IS NOT ON THE DEVICE AND CANNOT BE DERIVED FROM WHAT IS. `LocalInvoice` carries
   * `total_paise` and `state`, and `state` is not proof of an untouched bill: on the seed's own
   * ACTIVE trip `Tc803a3a5/1` is `issued`, ₹1,180.00, with ₹1,020.00 already against it. The office
   * refuses an explicit line bigger than the open balance (`planExplicit` -> 409 CONFLICT), so a
   * split built from `totalPaise` is a refusal at a shop door with the cash already counted. The
   * screen asks `receivables.outstanding.get({ includeBills: true })` — one read, the crew's own
   * permission (DUES_READERS) — and a bill can be tagged only once that answer is in.
   */
  openPaise: number | null
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

/** What this bill still asks for: the office's figure when it has one, its face value otherwise. */
export function owedOn(bill: DoorBill): number {
  return bill.openPaise ?? bill.totalPaise
}

/**
 * The bills at this door that can still take money, oldest first.
 *
 * A bill the office has already marked `paid` is dropped: offering it again as owed is how the same
 * money gets taken twice at one door. So is a bill the office says has nothing left on it, whatever
 * the state this phone last pulled still says — the open balance is the newer fact of the two.
 */
export function billsThatTakeMoney(bills: readonly DoorBill[]): DoorBill[] {
  return bills.filter((bill) => TAKES_MONEY.has(bill.state) && owedOn(bill) > 0).sort(oldestFirst)
}

/**
 * The bills the driver may TAG — the ones that can take money AND whose open balance the office has
 * given. Tagging a bill whose balance is unknown is the refusal this fix exists to prevent: the
 * split would be built from the face value and the office would answer 409 at the door.
 */
export function billsThatCanBeTagged(bills: readonly DoorBill[]): DoorBill[] {
  return billsThatTakeMoney(bills).filter((bill) => bill.openPaise !== null)
}

/**
 * What the bills AT THIS DOOR still ask for. The stop's `planned_collection_paise` is the office's
 * plan made before the van left, so it keeps counting a bill paid since; this counts only the bills
 * that can still take money.
 */
export function owedHerePaise(bills: readonly DoorBill[]): number {
  return billsThatTakeMoney(bills).reduce((sum, bill) => sum + owedOn(bill), 0)
}

/**
 * IS THAT FIGURE WHAT THE BILLS STILL ASK FOR, OR WHAT THEY WERE BILLED AT?
 *
 * `owedHerePaise` falls back to the face value for a bill the office has not answered for — offline
 * it always does — and a part-paid bill then makes the total an OVERSTATEMENT under a label reading
 * "Owed on the bills here". That is the finding's own third bullet, surviving in the one place the
 * office cannot be asked. The figure stays (it is the only one the device has); the label stops
 * claiming to be something it is not, and says "as billed" instead.
 */
export function owedHereIsAsBilled(bills: readonly DoorBill[]): boolean {
  return billsThatTakeMoney(bills).some((bill) => bill.openPaise === null)
}

/**
 * THE CHIP ON A BILL THAT CAN NO LONGER TAKE MONEY — in the office's own word for it.
 *
 * It said "Paid" for every state that is not open, so a bill the office had CANCELLED or WRITTEN OFF
 * read "Paid" at the door. "Paid" is the one word a shopkeeper acts on and the one the crew cannot
 * walk back an hour later.
 *
 * Two different things end up here and both are true: a bill whose state has left the money states
 * (`paid`, `cancelled`, `written_off`, `draft`), and a bill this phone still calls `issued` that the
 * office says has nothing left on it — that one IS paid off, and the office's figure is the newer
 * fact of the two. Called only for a bill `billsThatTakeMoney` has dropped.
 */
export function settledBillChip(
  t: Translator,
  bill: DoorBill,
): { label: string; family: 'moss' | 'neutral' } {
  return bill.state === 'paid' || TAKES_MONEY.has(bill.state)
    ? { label: t('d5.paidOff'), family: 'moss' }
    : { label: wordFor(t, bill.state), family: 'neutral' }
}

/**
 * THE TAGS THAT STILL MEAN SOMETHING.
 *
 * The office's answer is re-read at every door and can land BETWEEN the tap and the press: another
 * crew, the desk or the shop's own UPI settles a bill the driver has already tagged. `tagAllocations`
 * drops such a bill from the split — correctly, the office would refuse the line — but silently, so
 * the row went on reading "Tagged" and looking selected while the money went oldest-bill-first.
 *
 * So the screen reads its tags through the same rule it sends them through. Derived, not cleared: the
 * driver's tap is kept, and if the bill comes back as taggable the tag is still his.
 */
export function liveTags(
  bills: readonly DoorBill[],
  tagged: ReadonlySet<string>,
): ReadonlySet<string> {
  const taggable = new Set(billsThatCanBeTagged(bills).map((bill) => bill.invoiceId))
  return new Set([...tagged].filter((id) => taggable.has(id)))
}

/**
 * The explicit split for the bills the driver tagged, or `null` when nothing is tagged — and `null`
 * is what sends no `allocations` at all, which is the office's oldest-bill-first rule.
 *
 * The money fills the tagged bills oldest first, each capped at WHAT THAT BILL STILL OWES — never at
 * its face value, which is the refusal this rule was reviewed for: `planExplicit` answers 409
 * CONFLICT ("bill X owes 16000 paise; 118000 was offered") at a shop door, after the cash is in the
 * driver's hand. A bill whose open balance the office has not given is skipped for the same reason,
 * and a bill that would get nothing is dropped; a surplus over the tagged bills is simply not
 * allocated (the office places it, or it stays on account). The split can never come to more than the
 * receipt either — the server answers 409 for that too.
 */
export function tagAllocations(input: {
  bills: readonly DoorBill[]
  tagged: ReadonlySet<string>
  amountPaise: number
  newId: () => string
}): TaggedAllocation[] | null {
  if (input.tagged.size === 0) return null
  const wanted = billsThatCanBeTagged(input.bills).filter((bill) =>
    input.tagged.has(bill.invoiceId),
  )
  const lines: TaggedAllocation[] = []
  let left = Math.max(0, input.amountPaise)
  for (const bill of wanted) {
    if (left <= 0 || lines.length >= MAX_SPLIT_LINES) break
    if (bill.openPaise === null) continue
    const amountPaise = Math.min(bill.openPaise, left)
    if (amountPaise <= 0) continue
    lines.push({ id: input.newId(), invoiceId: bill.invoiceId, amountPaise })
    left -= amountPaise
  }
  return lines
}

/** The bill numbers the driver has tagged, in the order the money will reach them. */
function taggedNumbers(bills: readonly DoorBill[], tagged: ReadonlySet<string>): string[] {
  return billsThatCanBeTagged(bills)
    .filter((bill) => tagged.has(bill.invoiceId))
    .map((bill) => bill.invoiceNo ?? bill.invoiceId.slice(0, 8))
}

/**
 * The sentence UNDER the bills, said BEFORE the money changes hands — which is when the shopkeeper is
 * standing there and can still say which bill he means.
 */
export function whereTheMoneyGoes(
  t: Translator,
  input: {
    bills: readonly DoorBill[]
    tagged: ReadonlySet<string>
    openBills: number
    /** False while the office's open balances are not in hand: the rows are not tappable either. */
    canTag: boolean
  },
): string {
  const numbers = taggedNumbers(input.bills, input.tagged)
  if (numbers.length > 0) return t('d5.goesTo', { bills: numbers.join(', ') })
  // Never invite a tap the screen will not take: the rows are inert until the office answers.
  if (!input.canTag) return t('d5.oldestFirstUntaggable')
  return input.openBills > 1
    ? t('d5.oldestFirst', { count: input.openBills })
    : t('d5.oldestFirstOne')
}

/**
 * WHAT THE DRIVER READS WHEN THE OFFICE REFUSES THE SPLIT.
 *
 * The split is capped at the office's own figure, so this is the narrow race: the bill was settled
 * between the answer and the tap (another crew, the desk, the shop's own UPI). The server's sentence
 * is exact and unreadable at a door — "bill Tc803a3a5/1 owes 16000 paise; 118000 was offered" — and
 * it does not say the one thing that gets the money in: untag and record again. Every other refusal
 * keeps the office's own words, which are already in business language (`ApiError`).
 */
export function recordRefusal(
  t: Translator,
  failed: { kind: string; message: string },
  sentSplit: boolean,
): string {
  return sentSplit && failed.kind === 'conflict' ? t('d5.tagRefused') : failed.message
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
 * paid, the bills still open, and anything that stayed on account.
 *
 * `result.invoices` IS NOT EVERY BILL AT THIS DOOR. It is `settled` — "the bills a mutation touched"
 * — so an untagged receipt that the office's oldest-first rule spends entirely on a June bill comes
 * back naming June's bill and nothing else. That is the finding's own case: ₹7,856 at Vaibhav's door
 * pays INV/0099 to the paisa, and the bill in the shopkeeper's hand, INV/0825, is absent from the
 * reply. The sentence the crew owes him — "this pays INV/0099 of 26 Jun; today's bill stays open" —
 * needs the bills RIDING ON THIS DOOR as well, which is `doorBills`.
 *
 * A door bill the reply did touch is named from the reply (the newer figure of the two) and never
 * twice; a door bill the office had already settled, or that has nothing left on it, is not money
 * owed here and is not read out at all.
 */
export function appliedLines(
  t: Translator,
  result: {
    allocations: readonly { invoiceId: string; amountPaise: number }[]
    invoices: readonly SettledBill[]
    /** The bills riding on this stop, as the screen listed them over the pad. */
    doorBills: readonly DoorBill[]
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
  const touched = new Set(result.invoices.map((bill) => bill.id))
  for (const bill of result.invoices) {
    if (bill.openPaise <= 0) continue
    lines.push(
      t('d5.leftOpen', {
        no: bill.invoiceNo ?? bill.id.slice(0, 8),
        amount: result.money(bill.openPaise),
      }),
    )
  }
  for (const bill of billsThatTakeMoney(result.doorBills)) {
    if (touched.has(bill.invoiceId)) continue
    lines.push(
      t('d5.leftOpen', {
        no: bill.invoiceNo ?? bill.invoiceId.slice(0, 8),
        amount: result.money(owedOn(bill)),
      }),
    )
  }
  if (result.unallocatedPaise > 0)
    lines.push(t('d5.onAccount', { amount: result.money(result.unallocatedPaise) }))
  return lines
}
