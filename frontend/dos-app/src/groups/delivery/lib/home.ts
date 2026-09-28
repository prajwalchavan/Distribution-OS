/**
 * THE DRIVER'S HOME AS RULES (founder, 2026-09-28: "every app opens on its work, and nobody should
 * need training"; docs/22 §8, last row of the register).
 *
 * The home is the list of today's jobs in the order they should be done, each a card with its next
 * step on it. What a card IS — waiting, at the shop, money still to take, finished — and which one is
 * next, whether the van may leave, what the one summary line says and what a finished door reads as,
 * are decided HERE and nowhere else, so the screen only draws them. Nothing here writes: the writes are
 * the same functions D3, D4 and D5 call (`door-writes.ts`).
 *
 * Pure TypeScript (no React, no SQLite, no component), the pattern `doorstep.ts` and `pod.ts` set, so
 * it runs under vitest with no Metro.
 */
import { podState, type PodPolicy } from './pod'
import { isStopTerminal } from './stop-state'

// ---------------------------------------------------------------------------
// One stop, as a job
// ---------------------------------------------------------------------------

/** A bill's `_pending` while its write is still on this device and has not been refused. */
export function heldOnPhone(pending: string | null | undefined): boolean {
  return pending === 'queued' || pending === 'sending'
}

/**
 * - `waiting` — the van has not reached the shop: the next step is "I am here".
 * - `here` — at the shop and at least one bill still to hand over: "Delivered, all items".
 * - `money` — the goods side is done and the office's plan still asks for money here: "Take money".
 * - `finished` — nothing left to do at this door: the card folds to one quiet line.
 */
export type StopJobKind = 'waiting' | 'here' | 'money' | 'finished'

export interface StopJobBill {
  /** `deliveries.outcome`: null until the office has recorded the bill. */
  outcome: string | null
  /** `deliveries._pending`: a write this phone holds for the bill. */
  pending?: string | null | undefined
  /** The bill's face value (`invoices.total_paise`); null while the bill is not on this phone. */
  totalPaise?: number | null | undefined
  /** The credit notes the office has issued against this bill (`creditedByInvoice`). */
  creditedPaise?: number | undefined
}

export interface StopJob {
  kind: StopJobKind
  /** Bills with no outcome and no write held on this phone — what "Delivered, all items" records. */
  openBills: number
  /** Still to collect here (`leftToCollect`): what the driver is asked to bring back from this door. */
  leftPaise: number
  /**
   * The bills a credit shop takes on its account (verify-1 m1): not money for the driver's bag, but
   * the one figure worth printing on the card of a shop that owes nothing at the door.
   */
  creditPaise: number
  /** The goods side is over — every bill recorded (at the office or on this phone), or the stop closed. */
  doorDone: boolean
}

/**
 * The facts `leftToCollect` weighs. Only `plannedPaise` and `takenPaise` are required: with nothing
 * else known the answer is the office's plan less the money this trip has taken, as it always was.
 */
export interface DoorMoneyFacts {
  /** `trip_stops.planned_collection_paise`: the bills' totals, plus any old dues the planner agreed. */
  plannedPaise: number | null
  /** The bills riding on this stop: their outcome, face value and credit notes. */
  bills?: readonly StopJobBill[] | undefined
  /** Every receipt this trip holds for the shop — the ones still on this phone included. */
  takenPaise: number
  /** The part of `takenPaise` the office has not counted yet (`_pending` queued or sending). */
  heldPaise?: number | undefined
  /**
   * What the shop owes the office in all, as the phone last pulled it (`retailer_outstanding_summary`:
   * outstanding + undelivered). Null when the phone holds no row for the shop.
   */
  shopOwesPaise?: number | null | undefined
  /** The shop buys on credit (`onCreditTerms`): its bills go on its account, not into the bag. */
  onCredit?: boolean | undefined
}

/**
 * WHAT IS LEFT TO COLLECT AT ONE DOOR (verify-1 M1).
 *
 * The card used to say the office's plan for the stop less this trip's receipts, and nothing else.
 * After a part delivery the office raises a credit note for what came back, the shop owes that much
 * less, and the card went on asking for it: measured on TRIP-0005, "Still to collect here ₹2,404.00"
 * while the money screen said "Owes ₹2,340.00"; the driver took the ₹2,340.00, both bills were paid
 * at the office, and the card stayed "Unpaid ₹64.00 · Take money" with All done hidden for good.
 *
 * So the plan is taken down by everything that means the door owes less, all of it already on the
 * phone — which keeps this screen working with no signal (docs/23 §5.4):
 *   - a bill that did not go in at all (`failed`: it rides back on the van, nothing is credited);
 *   - the credit notes against the door's bills (`credit_notes`: short, damaged, returned goods);
 *   - for a shop on credit terms, the bills themselves — they go on its account; only what the planner
 *     added over them (agreed old dues) is asked at the door (verify-1 m1);
 *   - every receipt this trip holds for the shop, the money actually in the driver's bag.
 * And it is never more than the shop owes in all, less the money on this phone the office has not
 * counted yet: a bill settled at the desk since the plan was made is not asked for twice.
 *
 * The cap adds `undelivered_paise` back on purpose. A bill that came back on an earlier van and rides
 * again today is out of `outstanding_paise` until it is handed over, and a cap without it would tell
 * the driver to collect nothing for goods he is carrying.
 */
export function leftToCollect(facts: DoorMoneyFacts): number {
  const bills = facts.bills ?? []
  const face = (bill: StopJobBill): number => Math.max(0, bill.totalPaise ?? 0)
  const billed = bills.reduce((sum, bill) => sum + face(bill), 0)
  const notHandedOver = bills
    .filter((bill) => bill.outcome === 'failed')
    .reduce((sum, bill) => sum + face(bill), 0)
  const credited = bills.reduce((sum, bill) => sum + Math.max(0, bill.creditedPaise ?? 0), 0)
  const planned = Math.max(0, facts.plannedPaise ?? 0)
  const asked =
    facts.onCredit === true
      ? Math.max(0, planned - billed)
      : Math.max(0, planned - notHandedOver - credited)
  const left = Math.max(0, asked - Math.max(0, facts.takenPaise))
  if (facts.shopOwesPaise === null || facts.shopOwesPaise === undefined) return left
  return Math.min(left, Math.max(0, facts.shopOwesPaise - Math.max(0, facts.heldPaise ?? 0)))
}

/** What a credit shop takes on its account at this door: its bills, less what did not go in. */
function onAccountPaise(bills: readonly StopJobBill[]): number {
  return bills.reduce(
    (sum, bill) =>
      bill.outcome === 'failed'
        ? sum
        : sum + Math.max(0, (bill.totalPaise ?? 0) - Math.max(0, bill.creditedPaise ?? 0)),
    0,
  )
}

/**
 * A shop whose bills are not collected at the door: on credit terms (`POST_FULFILLMENT`) and not
 * stopped. A shop whose credit the office has STOPPED pays before the goods go in (DOS-066), so its
 * money is asked for like any other.
 */
export function onCreditTerms(
  paymentTerms: string | null | undefined,
  creditMode: string | null | undefined,
): boolean {
  return paymentTerms === 'POST_FULFILLMENT' && creditMode !== 'stop'
}

/**
 * The credit notes that count against a bill, by bill: issued (or already set against it). A draft
 * is not a credit yet and a cancelled one never was.
 */
export function creditedByInvoice(
  notes: readonly { invoice_id: string; state: string; total_paise: number }[],
): Map<string, number> {
  const out = new Map<string, number>()
  for (const note of notes) {
    if (note.state !== 'issued' && note.state !== 'applied') continue
    out.set(note.invoice_id, (out.get(note.invoice_id) ?? 0) + Math.max(0, note.total_paise))
  }
  return out
}

/**
 * THE STATE OF ONE CARD.
 *
 * A bill written with no signal comes back to this phone's table with `outcome` still empty — the
 * office derives the outcome from the lines when the op lands — so "recorded" is an outcome OR a write
 * held on this phone. Without that, a door delivered offline would offer "Delivered, all items" again.
 * A write the office REFUSED (`rejected`) is not recorded: that bill is open again and the tray says
 * why.
 *
 * WHAT IS LEFT TO COLLECT is `leftToCollect` above. A failed stop asks for nothing more, and a door
 * whose goods are in and whose money is all taken — or owed on credit — is finished.
 */
export function stopJob(
  input: {
    state: string
    bills: readonly StopJobBill[]
  } & DoorMoneyFacts,
): StopJob {
  const openBills = input.bills.filter(
    (bill) => bill.outcome === null && !heldOnPhone(bill.pending),
  ).length
  if (input.state === 'failed' || input.state === 'skipped')
    return { kind: 'finished', openBills: 0, leftPaise: 0, creditPaise: 0, doorDone: true }
  const leftPaise = leftToCollect(input)
  const creditPaise = input.onCredit === true ? onAccountPaise(input.bills) : 0
  const doorDone =
    isStopTerminal(input.state) ||
    (input.state === 'arrived' && input.bills.length > 0 && openBills === 0)
  if (!doorDone)
    return {
      kind: input.state === 'arrived' ? 'here' : 'waiting',
      openBills,
      leftPaise,
      creditPaise,
      doorDone: false,
    }
  return {
    kind: leftPaise > 0 ? 'money' : 'finished',
    openBills,
    leftPaise,
    creditPaise,
    doorDone: true,
  }
}

/**
 * WHICH CARD IS "DO THIS NEXT".
 *
 * The door the van is AT comes first: a driver who reached stop 3 before stop 2 is standing at stop 3,
 * and since only the next card carries a filled button (verify-1 m6) that is the card that must have
 * it. Otherwise it is the first, in trip order, that still has work — unless it is only money the
 * driver has already asked for and been told "later" ("No money now"), which records nothing and
 * leaves that card as it is, but lets the next shop be the one to drive to.
 */
export function nextJobId(
  jobs: readonly { id: string; job: StopJob }[],
  deferredMoney: ReadonlySet<string>,
): string | null {
  const here = jobs.find(({ job }) => job.kind === 'here')
  if (here !== undefined) return here.id
  const next = jobs.find(
    ({ id, job }) => job.kind !== 'finished' && !(job.kind === 'money' && deferredMoney.has(id)),
  )
  return next?.id ?? null
}

/**
 * Every stop's door is over — the one job left is checking the vehicle in. A door whose money the
 * driver has put off ("No money now") counts as over for this: its card stays where it is, and the
 * money can still be taken from it, but it no longer stands between the van and the godown.
 */
export function allDoorsDone(
  jobs: readonly { id: string; job: StopJob }[],
  totalStops: number,
  deferredMoney: ReadonlySet<string>,
): boolean {
  return (
    jobs.length > 0 &&
    jobs.length >= totalStops &&
    jobs.every(
      ({ id, job }) => job.kind === 'finished' || (job.kind === 'money' && deferredMoney.has(id)),
    )
  )
}

/**
 * The doors whose money the driver has put off, for as long as the app is running — so walking into a
 * stop and back does not make the same shop the next job again. Nothing is recorded at the office: "No
 * money now" is a decision about what to do NEXT, not a fact about the shop. `put-off.ts` also keeps
 * the list in this device's own storage, so a reload does not bring the card back (verify-1 m2).
 */
const later = new Set<string>()

export function putMoneyOff(stopId: string): ReadonlySet<string> {
  later.add(stopId)
  return new Set(later)
}

export function moneyPutOff(): ReadonlySet<string> {
  return new Set(later)
}

/**
 * WHICH SUMMARY SENTENCE. When every door is over the line says what is left to do — check the vehicle
 * in — because the card with that button sits at the END of the list (verify-1 m4: at the top it
 * appeared above a driver who had just taken the last money lower down, and nothing pointed to it).
 */
export function summaryKey(input: { leftPaise: number; allDone: boolean }): string {
  if (input.allDone) return input.leftPaise > 0 ? 'home.summaryDoneMoney' : 'home.summaryDone'
  return input.leftPaise > 0 ? 'home.summary' : 'home.summaryNothingLeft'
}

/** The ONE line above the list: how many doors are done, of how many, and what is still to collect. */
export function homeSummary(
  jobs: readonly { job: StopJob }[],
  totalStops: number,
): { done: number; total: number; leftPaise: number } {
  return {
    done: jobs.filter(({ job }) => job.doorDone).length,
    total: Math.max(totalStops, jobs.length),
    leftPaise: jobs.reduce((sum, { job }) => sum + job.leftPaise, 0),
  }
}

/**
 * DOES THIS DOOR OWE A PHOTOGRAPH? The same rule D4 asks (`pod.ts`, DOS-071) for a full delivery with
 * no proof yet. When it does, the card's next step is "Deliver", which opens D4: the photograph cannot
 * be skipped, so the one-tap write is never offered.
 */
export function doorNeedsPhoto(
  policy: PodPolicy,
  paymentTerms: string | null | undefined,
): boolean {
  return podState({
    policy,
    onCredit: paymentTerms === 'POST_FULFILLMENT',
    outcome: 'delivered',
    hasProof: false,
    proofTooBig: false,
  }).required
}

// ---------------------------------------------------------------------------
// "Delivered, all items" — what the confirm names
// ---------------------------------------------------------------------------

export interface BillToDeliver {
  deliveryId: string
  invoiceId: string
  invoiceNo: string | null
  /** Every piece on the bill, free pieces included; null while its lines are not on this phone. */
  pieces: number | null
}

/**
 * The bills the one tap will record in full, and their pieces, for the confirm dialog to NAME (the
 * kit's Dialog rule: the body is exactly what will be written). A bill whose lines have not reached
 * this phone has `pieces: null`, and `readyToDeliverAll` refuses the tap until they have — a full
 * delivery of a bill with no lines is not a thing the office can record.
 */
export function billsToDeliver(
  bills: readonly {
    id: string
    invoice_id: string
    outcome: string | null
    _pending?: string | null
  }[],
  invoiceNo: (invoiceId: string) => string | null,
  lines: readonly { invoice_id: string; qty_pcs: number; free_qty_pcs: number }[],
): BillToDeliver[] {
  return bills
    .filter((bill) => bill.outcome === null && !heldOnPhone(bill._pending))
    .map((bill) => {
      const own = lines.filter((line) => line.invoice_id === bill.invoice_id)
      return {
        deliveryId: bill.id,
        invoiceId: bill.invoice_id,
        invoiceNo: invoiceNo(bill.invoice_id),
        pieces:
          own.length === 0
            ? null
            : own.reduce((sum, line) => sum + line.qty_pcs + line.free_qty_pcs, 0),
      }
    })
}

export function readyToDeliverAll(bills: readonly BillToDeliver[]): boolean {
  return bills.length > 0 && bills.every((bill) => bill.pieces !== null && bill.pieces > 0)
}

// ---------------------------------------------------------------------------
// Before the van leaves
// ---------------------------------------------------------------------------

export interface HomeLoadSheet {
  id: string
  trip_id: string | null
  status: string
  expected_packages: number | null
  counted_packages: number | null
  order_ids: unknown
}

/** `order_ids` arrives as JSON text on the device (`jsonb` on the wire); anything else reads as none. */
export function sheetOrderIds(raw: unknown): string[] {
  let value: unknown = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      return []
    }
  }
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
}

/**
 * The sheets that carry THIS trip: linked by `trip_id`, or linked to none and carrying one of its
 * bills — the same two ways the office's depart gate finds them (`LoadSheetsService.draftsForTrip`).
 * A cancelled sheet carries nothing.
 */
export function sheetsForTrip<T extends HomeLoadSheet>(
  sheets: readonly T[],
  tripId: string,
  orderIds: readonly string[],
): T[] {
  const orders = new Set(orderIds)
  return sheets.filter(
    (sheet) =>
      sheet.status !== 'cancelled' &&
      (sheet.trip_id === tripId ||
        (sheet.trip_id === null && sheetOrderIds(sheet.order_ids).some((id) => orders.has(id)))),
  )
}

/**
 * CAN THE VAN LEAVE, AS FAR AS THIS PHONE CAN TELL.
 *
 * - `notStarted` — the trip is still only planned: the godown has not begun.
 * - `loading` — a sheet is still a draft, or a bill of the trip is on no confirmed sheet: the office
 *   refuses the departure in exactly these two cases (`load_sheet_not_confirmed`, `bill_not_loaded`).
 * - `ready` — every bill rides on a confirmed sheet (or the trip has no bills: a van-sales day).
 *
 * The phone never refuses more than the office would: a sheet linked by `trip_id` whose `order_ids`
 * this device cannot read is taken as covering the trip, and the office answers on the start screen.
 */
export type LoadReadiness = 'notStarted' | 'loading' | 'ready'

export function loadReadiness(input: {
  tripState: string
  sheets: readonly HomeLoadSheet[]
  orderIds: readonly string[]
}): LoadReadiness {
  if (input.tripState === 'planned') return 'notStarted'
  if (input.sheets.some((sheet) => sheet.status === 'draft')) return 'loading'
  if (input.orderIds.length === 0) return 'ready'
  const confirmed = input.sheets.filter((sheet) => sheet.status === 'confirmed')
  if (confirmed.length === 0) return 'loading'
  const carried = new Set(confirmed.flatMap((sheet) => sheetOrderIds(sheet.order_ids)))
  if (carried.size === 0) return 'ready'
  return input.orderIds.every((id) => carried.has(id)) ? 'ready' : 'loading'
}

/** Cartons on the confirmed sheets (the godown's count where it has one), or null when none is. */
export function cartonsLoaded(sheets: readonly HomeLoadSheet[]): number | null {
  const confirmed = sheets.filter((sheet) => sheet.status === 'confirmed')
  if (confirmed.length === 0) return null
  return confirmed.reduce(
    (sum, sheet) => sum + (sheet.counted_packages ?? sheet.expected_packages ?? 0),
    0,
  )
}

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

/**
 * Every button label on the home and its sheets. Rule 5 of the founder's brief (2026-09-28): the words
 * a driver would say, at most 20 characters — `home.test.ts` holds each to it.
 */
export const HOME_ACTION_KEYS = [
  'home.pickedUp',
  'home.arrive',
  'home.deliverAll',
  'home.deliver',
  'home.different',
  'home.takeMoney',
  'home.noMoney',
  'home.openShop',
  'home.checkIn',
  'home.seeDay',
  'home.confirmDeliver',
  'd5.record',
  'home.moreOptions',
  'home.map',
  'home.call',
  'home.pastTrips',
  'home.endDayNow',
  'd1.vanSale',
  'd1.addExpense',
] as const

/** The chip words on a card: the state in ONE word. */
export const HOME_CHIP_KEYS = [
  'home.chipWaiting',
  'home.chipHere',
  'home.chipUnpaid',
  'home.chipLoaded',
  'home.chipLoading',
] as const
