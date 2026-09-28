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
}

export interface StopJob {
  kind: StopJobKind
  /** Bills with no outcome and no write held on this phone — what "Delivered, all items" records. */
  openBills: number
  /** Still to collect here: the office's plan for this stop less what this trip has taken at the shop. */
  leftPaise: number
  /** The goods side is over — every bill recorded (at the office or on this phone), or the stop closed. */
  doorDone: boolean
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
 * WHAT IS LEFT TO COLLECT is the office's own plan for the stop (`planned_collection_paise`, the bills'
 * totals unless the planner set old dues) less every receipt this trip holds for the shop — including
 * the ones still on this phone, which is the money actually in the driver's bag. A failed stop asks
 * for nothing more.
 */
export function stopJob(input: {
  state: string
  bills: readonly StopJobBill[]
  plannedPaise: number | null
  takenPaise: number
}): StopJob {
  const openBills = input.bills.filter(
    (bill) => bill.outcome === null && !heldOnPhone(bill.pending),
  ).length
  if (input.state === 'failed' || input.state === 'skipped')
    return { kind: 'finished', openBills: 0, leftPaise: 0, doorDone: true }
  const leftPaise = Math.max(0, (input.plannedPaise ?? 0) - Math.max(0, input.takenPaise))
  const doorDone =
    isStopTerminal(input.state) ||
    (input.state === 'arrived' && input.bills.length > 0 && openBills === 0)
  if (!doorDone)
    return {
      kind: input.state === 'arrived' ? 'here' : 'waiting',
      openBills,
      leftPaise,
      doorDone: false,
    }
  return { kind: leftPaise > 0 ? 'money' : 'finished', openBills, leftPaise, doorDone: true }
}

/**
 * WHICH CARD IS "DO THIS NEXT": the first, in trip order, that still has work — unless it is only
 * money the driver has already asked for and been told "later" ("No money now"), which records
 * nothing and leaves that card as it is, but lets the next shop be the one to drive to.
 */
export function nextJobId(
  jobs: readonly { id: string; job: StopJob }[],
  deferredMoney: ReadonlySet<string>,
): string | null {
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
 * stop and back does not make the same shop the next job again. Nothing is recorded anywhere: "No money
 * now" is a decision about what to do NEXT, not a fact about the shop.
 */
const later = new Set<string>()

export function putMoneyOff(stopId: string): ReadonlySet<string> {
  later.add(stopId)
  return new Set(later)
}

export function moneyPutOff(): ReadonlySet<string> {
  return new Set(later)
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
