/**
 * The godown plans the round and builds each load sheet FOR a trip — as pure functions of what the
 * floor chose (QA DOS-131, DOS-137).
 *
 * PLANNING (W10). `delivery.trips.planning` answers the crew on a date and the packed bills no open trip
 * carries yet. The chosen bills become one stop per shop, in the order each shop was first chosen, the
 * bills inside a stop in tap order. `useMutation` keys the idempotency key on its INPUT and the service
 * refuses a key sent again with a different body, so the trip id and every stop id are made ONCE, when
 * the confirm dialog opens (`snapshotPlan` / `addStopSnapshot`), and a retry after a lost reply sends the
 * very same request. Editing the form throws the snapshot away: a new intent, with new ids. The manager
 * app keeps its own copy of these functions, as it keeps its own `useCan` and `Panel`.
 *
 * LOADING (W7). A sheet names the trip it is built for and loads that trip's vehicle, so the crew finds
 * its load on its trip. Only a packed order of a shop that is a stop of the trip — and whose bill the
 * planning board does not still list as on no trip — belongs on it. Warehouse cannot read delivery on
 * the server, so this narrowing is the app's; the server stores whatever `tripId` it is given.
 */
import type { PackListItem, PlanningBill, Trip } from '@dos/contracts'

export interface PlanStop {
  readonly id: string
  readonly sequence: number
  readonly retailerId: string
  readonly invoiceIds: readonly string[]
}

export interface PlanForm {
  readonly tripDate: string
  readonly vehicleId: string | null
  readonly driverId: string | null
  readonly helperId: string | null
  /** Integer paise; a cleared field is no float. */
  readonly openingCashPaise: number | null
  /** Invoice ids in the order they were tapped. */
  readonly chosen: readonly string[]
  /**
   * QA DOS-233: the van also carries stock to SELL at shops with no order. Only offered while the tenant's
   * `van_sales` flag is on; a van-sales trip may leave with no bill at all.
   */
  readonly vanSales: boolean
}

export type PlanProblem = 'needVehicle' | 'needDriver' | 'sameCrew' | 'needBill'

/** A confirmed plan: every id fixed, frozen. */
export interface TripPlan {
  readonly id: string
  readonly tripDate: string
  readonly vehicleId: string
  readonly driverId: string
  readonly helperId: string | null
  readonly openingCashPaise: number
  readonly vanSales: boolean
  readonly stops: readonly PlanStop[]
}

/** The body `delivery.trips.create` is sent, rebuilt from one snapshot so a retry is the same request. */
export interface TripCreateBody {
  id: string
  idempotencyKey: string
  tripDate: string
  vehicleId: string
  driverId: string
  helperId?: string
  openingCashPaise: number
  vanSalesEnabled: boolean
  stops: { id: string; sequence: number; retailerId: string; invoiceIds: string[] }[]
}

/** A late bill for a trip already planned: one stop, the ids fixed. `id` is the trip. */
export interface StopPlan {
  readonly id: string
  readonly stop: {
    readonly id: string
    readonly retailerId: string
    readonly invoiceIds: readonly string[]
  }
}

/** The body `delivery.stops.add` is sent. The server puts the stop last. */
export interface AddStopBody {
  id: string
  idempotencyKey: string
  stop: { id: string; retailerId: string; invoiceIds: string[] }
}

/** The body `warehouse.loadSheets.create` is sent for a trip, before its own id and key. */
export interface LoadSheetBody {
  tripId: string
  toLocationId: string
  orderIds: string[]
  vanStock: { lotId: string; qtyPcs: number }[]
}

/**
 * One stop per shop, in the order each shop was first chosen, sequence 1..n, the bills in tap order. A
 * bill no longer on the board and a bill tapped twice are ignored. `makeId` is called once per stop.
 */
export function stopsFromBills(
  bills: readonly PlanningBill[],
  chosen: readonly string[],
  makeId: () => string,
): PlanStop[] {
  const shopOf = new Map(bills.map((bill) => [bill.invoiceId, bill.retailerId]))
  const stops: { id: string; sequence: number; retailerId: string; invoiceIds: string[] }[] = []
  const taken = new Set<string>()
  for (const invoiceId of chosen) {
    const retailerId = shopOf.get(invoiceId)
    if (retailerId === undefined || taken.has(invoiceId)) continue
    taken.add(invoiceId)
    const stop = stops.find((one) => one.retailerId === retailerId)
    if (stop === undefined)
      stops.push({ id: makeId(), sequence: stops.length + 1, retailerId, invoiceIds: [invoiceId] })
    else stop.invoiceIds.push(invoiceId)
  }
  return stops
}

/** What the plan still lacks, in the order the form is filled; null when it can be confirmed. */
export function planProblem(form: PlanForm): PlanProblem | null {
  if (form.vehicleId === null) return 'needVehicle'
  if (form.driverId === null) return 'needDriver'
  if (form.helperId !== null && form.helperId === form.driverId) return 'sameCrew'
  // A van that goes out to sell needs no bill (DOS-233); every other trip carries at least one.
  if (form.chosen.length === 0 && !form.vanSales) return 'needBill'
  return null
}

/**
 * The plan the confirm dialog shows and the mutation sends, with the trip id and every stop id made now
 * and never again. Null when the form is not ready or none of its bills is on the board any more.
 */
export function snapshotPlan(
  form: PlanForm,
  bills: readonly PlanningBill[],
  makeId: () => string,
): TripPlan | null {
  if (planProblem(form) !== null || form.vehicleId === null || form.driverId === null) return null
  const onBoard = new Set(bills.map((bill) => bill.invoiceId))
  if (!form.vanSales && !form.chosen.some((invoiceId) => onBoard.has(invoiceId))) return null
  const id = makeId()
  const stops = stopsFromBills(bills, form.chosen, makeId).map((stop) =>
    Object.freeze({ ...stop, invoiceIds: Object.freeze([...stop.invoiceIds]) }),
  )
  return Object.freeze({
    id,
    tripDate: form.tripDate,
    vehicleId: form.vehicleId,
    driverId: form.driverId,
    helperId: form.helperId,
    openingCashPaise: form.openingCashPaise ?? 0,
    vanSales: form.vanSales,
    stops: Object.freeze(stops),
  })
}

export function tripCreateBody(plan: TripPlan, idempotencyKey: string): TripCreateBody {
  return {
    id: plan.id,
    idempotencyKey,
    tripDate: plan.tripDate,
    vehicleId: plan.vehicleId,
    driverId: plan.driverId,
    ...(plan.helperId === null ? {} : { helperId: plan.helperId }),
    openingCashPaise: plan.openingCashPaise,
    vanSalesEnabled: plan.vanSales,
    stops: plan.stops.map((stop) => ({
      id: stop.id,
      sequence: stop.sequence,
      retailerId: stop.retailerId,
      invoiceIds: [...stop.invoiceIds],
    })),
  }
}

/**
 * A late bill for trip `tripId`: the bills of the FIRST chosen shop become one stop, its id made now and
 * never again. Null when none of the chosen bills is on the board.
 */
export function addStopSnapshot(
  tripId: string,
  bills: readonly PlanningBill[],
  chosen: readonly string[],
  makeId: () => string,
): StopPlan | null {
  const shopOf = new Map(bills.map((bill) => [bill.invoiceId, bill.retailerId]))
  const firstShop = chosen
    .map((invoiceId) => shopOf.get(invoiceId))
    .find((shop): shop is string => shop !== undefined)
  if (firstShop === undefined) return null
  const invoiceIds = [...new Set(chosen.filter((invoiceId) => shopOf.get(invoiceId) === firstShop))]
  return Object.freeze({
    id: tripId,
    stop: Object.freeze({
      id: makeId(),
      retailerId: firstShop,
      invoiceIds: Object.freeze(invoiceIds),
    }),
  })
}

export function addStopBody(plan: StopPlan, idempotencyKey: string): AddStopBody {
  return {
    id: plan.id,
    idempotencyKey,
    stop: {
      id: plan.stop.id,
      retailerId: plan.stop.retailerId,
      invoiceIds: [...plan.stop.invoiceIds],
    },
  }
}

/** Tap a bill: chosen again it leaves, otherwise it joins at the end (tap order is stop order). */
export function toggleChosen(chosen: readonly string[], invoiceId: string): string[] {
  return chosen.includes(invoiceId)
    ? chosen.filter((one) => one !== invoiceId)
    : [...chosen, invoiceId]
}

/**
 * Tap a bill for ONE late stop: a bill of another shop than the ones chosen starts the choice again,
 * because one added stop is one shop.
 */
export function toggleWithinShop(
  chosen: readonly string[],
  bills: readonly PlanningBill[],
  invoiceId: string,
): string[] {
  const shopOf = new Map(bills.map((bill) => [bill.invoiceId, bill.retailerId]))
  const shop = shopOf.get(invoiceId)
  const sameShop = chosen.filter((one) => shopOf.get(one) === shop)
  return sameShop.length === chosen.length ? toggleChosen(chosen, invoiceId) : [invoiceId]
}

/** The board's pages read so far, earlier pages first, each bill once. */
export function mergeBills(
  earlier: readonly PlanningBill[],
  page: readonly PlanningBill[],
): PlanningBill[] {
  const seen = new Set<string>()
  const merged: PlanningBill[] = []
  for (const bill of [...earlier, ...page]) {
    if (seen.has(bill.invoiceId)) continue
    seen.add(bill.invoiceId)
    merged.push(bill)
  }
  return merged
}

/**
 * DOS-137: the sheet names the trip it is built for and loads that trip's own vehicle location.
 * DOS-233: a van-sales trip also takes stock to SELL — the lots and pieces the godown picked for it. A
 * lot picked twice is summed, a lot at zero pieces is left off (the server takes positive pieces only),
 * and a trip that sells nothing from the van sends none.
 */
export function loadSheetInput(
  trip: Pick<Trip, 'id' | 'vehicleLocationId'>,
  orderIds: readonly string[],
  vanStock: readonly { lotId: string; qtyPcs: number }[] = [],
): LoadSheetBody {
  const byLot = new Map<string, number>()
  for (const line of vanStock) {
    if (!Number.isSafeInteger(line.qtyPcs) || line.qtyPcs <= 0) continue
    byLot.set(line.lotId, (byLot.get(line.lotId) ?? 0) + line.qtyPcs)
  }
  return {
    tripId: trip.id,
    toLocationId: trip.vehicleLocationId,
    orderIds: [...orderIds],
    vanStock: [...byLot].map(([lotId, qtyPcs]) => ({ lotId, qtyPcs })),
  }
}

/**
 * May this packed order go on the load for `trip`? Only when its shop is a stop of the trip AND its bill
 * is not one the planning board still lists as on no open trip (`unplannedInvoiceIds`, the board's page):
 * a second packed bill of a shop on the trip that nobody planned is not this trip's load, and checking
 * it out would dispatch an order no trip carries. A bill beyond the board's page — or a pack with no
 * bill yet — cannot be told apart, and the shop alone decides. No trip chosen: nothing is loadable.
 */
export function packOnTrip(
  pack: Pick<PackListItem, 'retailerId' | 'invoiceId'>,
  trip: { readonly stops: readonly { readonly retailerId: string }[] } | null,
  unplannedInvoiceIds: ReadonlySet<string>,
): boolean {
  if (trip === null) return false
  if (!trip.stops.some((stop) => stop.retailerId === pack.retailerId)) return false
  return pack.invoiceId === null || !unplannedInvoiceIds.has(pack.invoiceId)
}
