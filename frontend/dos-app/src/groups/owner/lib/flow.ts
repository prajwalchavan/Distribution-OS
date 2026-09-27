/**
 * The owner's day as one chain (UX-O-1, the owner UX review of 2026-09-27): Booked → Held → Billed →
 * Packed, no van → On the road → Delivered → Collected → Banked → Owed.
 *
 * The home answered "how much" and never "where is it": on 27 Sep nine packed orders (₹1,76,839) had
 * waited for a van since 10 Sep and seven dispatched orders (₹80,180) had been on a trip since 11 Sep, and
 * no screen said so. Every step here is read from a procedure the owner already holds — nothing new on
 * the wire — and a step that holds anything older than a day is marked `stale`, which the strip draws in
 * ochre. This file only adds up what the reads returned; the screen formats.
 */
import { businessDate } from '@dos/domain'

import { olderThanADay } from './dates'

export type FlowStepId =
  'booked' | 'held' | 'billed' | 'packed' | 'road' | 'delivered' | 'collected' | 'banked' | 'owed'

/** What the home links each step to: the register, filtered to exactly what the step counted. */
export const FLOW_HREF: Readonly<Record<FlowStepId, string>> = {
  booked: '/orders?range=today',
  held: '/approvals',
  billed: '/billing?range=today',
  packed: '/orders?state=packed&range=all',
  road: '/orders?state=dispatched&range=all',
  delivered: '/orders/trips',
  collected: '/money/receipts?range=today',
  banked: '/money/receipts?range=today&status=deposited',
  owed: '/money',
}

/** A page of a list read: `nextCursor` non-null means the count is a floor, and the strip says "+". */
interface Paged<T> {
  items: readonly T[]
  nextCursor: string | null
}

interface OrderLike {
  state: string
  totalPaise: number
  createdAt: string
}

interface TripLike {
  tripNo: string | null
  tripDate: string
  startedAt: string | null
}

export interface FlowInputs {
  /** `orders.list({ from: today, to: today })`. */
  booked?: Paged<OrderLike> | undefined
  /** `pendingDecisions()` of the approvals and the bargains, and their `createdAt`s. */
  held?: { count: number; more: boolean; asked: readonly string[] } | undefined
  /**
   * `billing.invoices.list({ from: today, to: today })`: count AND value, live, on the dashboard's own
   * definition (every bill dated today that is not a draft or cancelled) — so the step agrees with the
   * register it opens, and never pairs a live count with a rolled-up value of another day.
   */
  billedBills?: Paged<{ state: string; totalPaise: number }> | undefined
  /** `orders.list({ states: ['packed'] })`. */
  packed?: Paged<OrderLike> | undefined
  /** `orders.list({ states: ['dispatched'] })`. */
  dispatched?: Paged<OrderLike> | undefined
  /** `delivery.trips.list({ state: 'active' })`. */
  trips?: Paged<TripLike> | undefined
  /**
   * `reporting.dashboard.owner`, a rollup with its own `asOf`. Its TODAY figures (delivered, failed) are
   * used only when `asOf` is today in IST; otherwise the step says which day the rollup is from instead of
   * passing another day's stops off as today's.
   */
  dashboard?:
    | {
        asOf: string
        todayDeliveredStops: number
        todayFailedStops: number
        totalOutstandingPaise: number
      }
    | undefined
  /** `reporting.registers.collections({ from: today, to: today }).totals`. */
  collections?:
    | {
        cashPaise: number
        upiPaise: number
        chequePaise: number
        bankTransferPaise: number
        totalPaise: number
      }
    | undefined
  /** `receivables.receipts.list({ status: 'deposited', from: today, to: today }).totals`. */
  banked?: { countedPaise: number } | undefined
  /** Today's IST date; the dashboard's `asOf` is compared with it. */
  today: string
  nowMs?: number
}

export interface FlowStep {
  id: FlowStepId
  href: string
  /** Undefined while its read has not answered: the strip shows a dash, never a zero it did not read. */
  count?: number | undefined
  /** The count is a floor — a page ran out before the list did. */
  more: boolean
  paise?: number | undefined
  /** The oldest thing the step holds: an ISO instant or an IST date. */
  oldest?: string | undefined
  /** Holds something older than a day. */
  stale: boolean
  /** Booked: the orders cancelled today, which are NOT in the booked value. */
  cancelled?: { count: number; paise: number } | undefined
  /** On the road: the trip that has been out longest. */
  trip?: { name: string | null; since: string } | undefined
  /** Delivered: today's failed stops beside the delivered ones. */
  failed?: number | undefined
  /** A rolled-up step whose rollup is not from today: the instant it is from. */
  asOf?: string | undefined
  /** Collected: the split by mode. */
  modes?: { cash: number; upi: number; cheque: number; bank: number } | undefined
}

/** An instant, or an IST date read as its IST midnight. */
const atMs = (at: string): number => Date.parse(at.length === 10 ? `${at}T00:00:00+05:30` : at)

const sum = (rows: readonly { totalPaise: number }[]): number =>
  rows.reduce((total, row) => total + row.totalPaise, 0)

/** The earliest of a set of ISO strings (instants or dates compare correctly as text within a kind). */
function earliest(values: readonly string[]): string | undefined {
  return values.reduce<string | undefined>(
    (min, value) => (min === undefined || value < min ? value : min),
    undefined,
  )
}

function held(rows: Paged<OrderLike> | undefined, id: FlowStepId, nowMs: number): FlowStep {
  if (rows === undefined) return { id, href: FLOW_HREF[id], more: false, stale: false }
  const oldest = earliest(rows.items.map((row) => row.createdAt))
  return {
    id,
    href: FLOW_HREF[id],
    count: rows.items.length,
    more: rows.nextCursor !== null,
    paise: sum(rows.items),
    oldest,
    stale: olderThanADay(oldest, nowMs),
  }
}

export function buildFlow(input: FlowInputs): readonly FlowStep[] {
  const nowMs = input.nowMs ?? Date.now()
  const d = input.dashboard

  const bookedRows = input.booked?.items ?? []
  const live = bookedRows.filter((row) => row.state !== 'cancelled')
  const cancelled = bookedRows.filter((row) => row.state === 'cancelled')
  const booked: FlowStep =
    input.booked === undefined
      ? { id: 'booked', href: FLOW_HREF.booked, more: false, stale: false }
      : {
          id: 'booked',
          href: FLOW_HREF.booked,
          count: live.length,
          more: input.booked.nextCursor !== null,
          paise: sum(live),
          stale: false,
          cancelled: { count: cancelled.length, paise: sum(cancelled) },
        }

  const askedOldest = earliest(input.held?.asked ?? [])
  const heldStep: FlowStep =
    input.held === undefined
      ? { id: 'held', href: FLOW_HREF.held, more: false, stale: false }
      : {
          id: 'held',
          href: FLOW_HREF.held,
          count: input.held.count,
          more: input.held.more,
          oldest: askedOldest,
          stale: olderThanADay(askedOldest, nowMs),
        }

  const bills = (input.billedBills?.items ?? []).filter(
    (bill) => bill.state !== 'draft' && bill.state !== 'cancelled',
  )
  const billed: FlowStep =
    input.billedBills === undefined
      ? { id: 'billed', href: FLOW_HREF.billed, more: false, stale: false }
      : {
          id: 'billed',
          href: FLOW_HREF.billed,
          count: bills.length,
          more: input.billedBills.nextCursor !== null,
          paise: sum(bills),
          stale: false,
        }

  const packed = held(input.packed, 'packed', nowMs)

  const road = held(input.dispatched, 'road', nowMs)
  // The trip that has been out longest: its departure, or its plan date when it has none.
  const tripSince = (input.trips?.items ?? [])
    .map((trip) => ({ name: trip.tripNo, since: trip.startedAt ?? trip.tripDate }))
    .reduce<{ name: string | null; since: string } | undefined>(
      (min, trip) => (min === undefined || atMs(trip.since) < atMs(min.since) ? trip : min),
      undefined,
    )
  road.trip = tripSince
  road.stale = road.stale || olderThanADay(tripSince?.since, nowMs)

  const fresh = d !== undefined && businessDate(Date.parse(d.asOf)).date === input.today
  const delivered: FlowStep = {
    id: 'delivered',
    href: FLOW_HREF.delivered,
    count: fresh ? d.todayDeliveredStops : undefined,
    more: false,
    failed: fresh ? d.todayFailedStops : undefined,
    asOf: d !== undefined && !fresh ? d.asOf : undefined,
    stale: false,
  }

  const c = input.collections
  const collected: FlowStep = {
    id: 'collected',
    href: FLOW_HREF.collected,
    more: false,
    paise: c?.totalPaise,
    modes:
      c === undefined
        ? undefined
        : { cash: c.cashPaise, upi: c.upiPaise, cheque: c.chequePaise, bank: c.bankTransferPaise },
    stale: false,
  }

  const banked: FlowStep = {
    id: 'banked',
    href: FLOW_HREF.banked,
    more: false,
    paise: input.banked?.countedPaise,
    stale: false,
  }

  const owed: FlowStep = {
    id: 'owed',
    href: FLOW_HREF.owed,
    more: false,
    paise: d?.totalOutstandingPaise,
    asOf: d !== undefined && !fresh ? d.asOf : undefined,
    stale: false,
  }

  return [booked, heldStep, billed, packed, road, delivered, collected, banked, owed]
}
