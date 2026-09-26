/**
 * DOS-131 — M7 Trips: the desk plans a trip from the planning board's bills.
 *
 * `useMutation` keys the idempotency key on its INPUT, and the service refuses a key sent again with a
 * different body (409 "idempotencyKey was already used with a different request"). So the trip id and
 * every stop id are fixed ONCE, when the confirm dialog opens, and a retry after a lost reply sends the
 * very same body. These cases pin that, and the stop-per-shop grouping the dialog promises.
 */
import type { PlanningBill } from '@dos/contracts'
import { describe, expect, it } from 'vitest'

import {
  addStopBody,
  addStopSnapshot,
  planProblem,
  snapshotPlan,
  stopsFromBills,
  tripCreateBody,
  type PlanForm,
} from './trip-plan'

const SHOP_A = '0192a7c4-1b2e-7d3f-8a41-5c6d7e8f9a01'
const SHOP_B = '0192a7c4-1b2e-7d3f-8a41-5c6d7e8f9a02'

function bill(
  invoiceId: string,
  retailerId: string,
  overrides: Partial<PlanningBill> = {},
): PlanningBill {
  return {
    invoiceId,
    invoiceNo: `INV/${invoiceId}`,
    invoiceTotalPaise: 118_000,
    orderId: `order-${invoiceId}`,
    orderNo: `SO-${invoiceId}`,
    retailerId,
    retailerName: retailerId === SHOP_A ? 'Shree Ganesh Kirana' : 'Om Sai Stores',
    beatId: null,
    beatName: null,
    ...overrides,
  }
}

/** An id maker that counts its calls, so a test can see WHEN ids are made. */
function counter(prefix: string): { make: () => string; calls: () => number } {
  let n = 0
  return {
    make: () => {
      n += 1
      return `${prefix}-${String(n)}`
    },
    calls: () => n,
  }
}

const BILLS = [bill('INV1', SHOP_A), bill('INV2', SHOP_B), bill('INV3', SHOP_A)]

const READY: PlanForm = {
  tripDate: '2026-09-14',
  vehicleId: 'vehicle-1',
  driverId: 'driver-1',
  helperId: null,
  openingCashPaise: 200_000,
  chosen: ['INV2', 'INV3', 'INV1'],
  vanSales: false,
}

describe('M7 plan a trip', () => {
  it('DOS-131: chosen bills become one stop per shop in the order they were chosen, a plan without a vehicle, a driver or a bill, or with the driver as helper, names what is missing, and a confirmed plan keeps its trip and stop ids on a retry', () => {
    // One stop per shop, in first-chosen order; the bills keep their tap order inside the stop.
    const ids = counter('stop')
    expect(stopsFromBills(BILLS, ['INV2', 'INV3', 'INV1'], ids.make)).toEqual([
      { id: 'stop-1', sequence: 1, retailerId: SHOP_B, invoiceIds: ['INV2'] },
      { id: 'stop-2', sequence: 2, retailerId: SHOP_A, invoiceIds: ['INV3', 'INV1'] },
    ])
    // A bill no longer on the board, and a bill tapped twice, are ignored.
    expect(stopsFromBills(BILLS, ['GONE', 'INV1', 'INV1'], counter('s').make)).toEqual([
      { id: 's-1', sequence: 1, retailerId: SHOP_A, invoiceIds: ['INV1'] },
    ])

    // What is missing, named in the order the form is filled.
    expect(planProblem({ ...READY, vehicleId: null })).toBe('needVehicle')
    expect(planProblem({ ...READY, driverId: null })).toBe('needDriver')
    expect(planProblem({ ...READY, helperId: 'driver-1' })).toBe('sameCrew')
    expect(planProblem({ ...READY, chosen: [] })).toBe('needBill')
    expect(planProblem(READY)).toBeNull()
    expect(snapshotPlan({ ...READY, driverId: null }, BILLS, counter('x').make)).toBeNull()

    // The snapshot fixes every id once: two bodies built from it are the same request.
    const made = counter('id')
    const plan = snapshotPlan(READY, BILLS, made.make)
    expect(plan).not.toBeNull()
    if (plan === null) return
    const callsAtSnapshot = made.calls()
    expect(callsAtSnapshot).toBe(3) // the trip and its two stops
    const first = tripCreateBody(plan, 'key-1')
    const retry = tripCreateBody(plan, 'key-1')
    expect(retry).toEqual(first)
    expect(made.calls()).toBe(callsAtSnapshot)
    expect(first).toEqual({
      id: 'id-1',
      idempotencyKey: 'key-1',
      tripDate: '2026-09-14',
      vehicleId: 'vehicle-1',
      driverId: 'driver-1',
      openingCashPaise: 200_000,
      vanSalesEnabled: false,
      stops: [
        { id: 'id-2', sequence: 1, retailerId: SHOP_B, invoiceIds: ['INV2'] },
        { id: 'id-3', sequence: 2, retailerId: SHOP_A, invoiceIds: ['INV3', 'INV1'] },
      ],
    })
    expect(Object.isFrozen(plan)).toBe(true)
    // A helper, when named, rides along; an empty float is no float.
    const withHelper = snapshotPlan(
      { ...READY, helperId: 'helper-1', openingCashPaise: null },
      BILLS,
      counter('h').make,
    )
    expect(withHelper === null ? null : tripCreateBody(withHelper, 'k')).toMatchObject({
      helperId: 'helper-1',
      openingCashPaise: 0,
    })

    // A changed form is a new intent: a new snapshot with new ids.
    const changed = snapshotPlan({ ...READY, chosen: ['INV2'] }, BILLS, made.make)
    expect(changed?.id).not.toBe(plan.id)
    expect(changed?.stops.map((s) => s.id)).not.toContain('id-2')

    // A late bill for a trip already planned: the first chosen shop's bills, ids fixed once.
    const late = counter('late')
    const add = addStopSnapshot('trip-9', BILLS, ['INV3', 'INV2', 'INV1'], late.make)
    expect(add).toEqual({
      id: 'trip-9',
      stop: { id: 'late-1', retailerId: SHOP_A, invoiceIds: ['INV3', 'INV1'] },
    })
    if (add === null) return
    expect(addStopBody(add, 'k-2')).toEqual(addStopBody(add, 'k-2'))
    expect(late.calls()).toBe(1)
    expect(addStopSnapshot('trip-9', BILLS, [], late.make)).toBeNull()
  })

  it('DOS-233: a van-sales trip says so to the server, and may leave with no bill at all', () => {
    // Off by default: the body carries vanSalesEnabled false, and a trip with no bill is still refused.
    expect(planProblem({ ...READY, chosen: [], vanSales: false })).toBe('needBill')
    // On: nothing is missing without a bill, and the plan is one trip with no stop.
    const vanOnly = { ...READY, chosen: [], vanSales: true }
    expect(planProblem(vanOnly)).toBeNull()
    const plan = snapshotPlan(vanOnly, BILLS, counter('v').make)
    expect(plan).not.toBeNull()
    if (plan === null) return
    expect(tripCreateBody(plan, 'k')).toMatchObject({ vanSalesEnabled: true, stops: [] })
    // On, with bills too: the bills are the stops and the switch still travels.
    const both = snapshotPlan({ ...READY, vanSales: true }, BILLS, counter('b').make)
    expect(both === null ? null : tripCreateBody(both, 'k')).toMatchObject({
      vanSalesEnabled: true,
      stops: [{ retailerId: SHOP_B }, { retailerId: SHOP_A }],
    })
  })
})
