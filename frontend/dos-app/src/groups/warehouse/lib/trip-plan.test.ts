/**
 * W7 and W10 — the godown plans the round and builds each load sheet FOR a trip.
 *
 * DOS-137: a sheet built on W7 used to carry no trip, so the crew's Today screen said the godown had not
 * confirmed a load it had. The sheet now names its trip and the trip's vehicle, and only a packed order of
 * a shop on that trip, whose bill is not one the planning board still lists as unplanned, may be loaded.
 *
 * DOS-131: W10 plans the trip itself, from the same board; its stops are the chosen bills, one per shop.
 */
import type { PlanningBill } from '@dos/contracts'
import { describe, expect, it } from 'vitest'

import {
  loadSheetInput,
  packOnTrip,
  planProblem,
  snapshotPlan,
  stopsFromBills,
  tripCreateBody,
  type PlanForm,
} from './trip-plan'

const VAN_LOCATION = '2c7b4801-3f88-77d1-8a25-7e903891f265'

function bill(invoiceId: string, retailerId: string): PlanningBill {
  return {
    invoiceId,
    invoiceNo: `INV/${invoiceId}`,
    invoiceTotalPaise: 54_000,
    orderId: `order-${invoiceId}`,
    orderNo: `SO-${invoiceId}`,
    retailerId,
    retailerName: `Shop ${retailerId}`,
    beatId: 'beat-1',
    beatName: 'Kalyan West',
  }
}

describe('W7 load sheet for a trip', () => {
  it("DOS-137: a load sheet built on W7 carries the trip it is built for, loads that trip's vehicle location, and refuses a packed order whose shop is not on that trip", () => {
    expect(loadSheetInput({ id: 'trip-1', vehicleLocationId: VAN_LOCATION }, ['o1', 'o2'])).toEqual(
      {
        tripId: 'trip-1',
        toLocationId: VAN_LOCATION,
        orderIds: ['o1', 'o2'],
        vanStock: [],
      },
    )
    // DOS-233: the stock picked to sell rides on the same sheet, summed per lot, zeros left off.
    expect(
      loadSheetInput(
        { id: 'trip-1', vehicleLocationId: VAN_LOCATION },
        [],
        [
          { lotId: 'lot-a', qtyPcs: 24 },
          { lotId: 'lot-b', qtyPcs: 0 },
          { lotId: 'lot-a', qtyPcs: 12 },
        ],
      ),
    ).toEqual({
      tripId: 'trip-1',
      toLocationId: VAN_LOCATION,
      orderIds: [],
      vanStock: [{ lotId: 'lot-a', qtyPcs: 36 }],
    })

    const none: ReadonlySet<string> = new Set()
    // A shop that is not a stop of the trip.
    expect(
      packOnTrip({ retailerId: 'r2', invoiceId: 'i2' }, { stops: [{ retailerId: 'r1' }] }, none),
    ).toBe(false)
    // A shop that is.
    expect(
      packOnTrip(
        { retailerId: 'r2', invoiceId: 'i2' },
        { stops: [{ retailerId: 'r1' }, { retailerId: 'r2' }] },
        none,
      ),
    ).toBe(true)
    // No trip chosen: nothing is loadable.
    expect(packOnTrip({ retailerId: 'r2', invoiceId: 'i2' }, null, none)).toBe(false)
    // A second packed bill of an on-trip shop that the board still lists as on no trip: not this load.
    expect(
      packOnTrip(
        { retailerId: 'r2', invoiceId: 'i3' },
        { stops: [{ retailerId: 'r1' }, { retailerId: 'r2' }] },
        new Set(['i3']),
      ),
    ).toBe(false)
    // A pack with no bill yet has nothing on the board to rule it out; the shop decides.
    expect(
      packOnTrip(
        { retailerId: 'r2', invoiceId: null },
        { stops: [{ retailerId: 'r2' }] },
        new Set(['i3']),
      ),
    ).toBe(true)
  })
})

describe('W10 plan a trip', () => {
  it("DOS-131: the godown's plan groups chosen bills into one stop per shop in tap order and refuses a plan with no driver or no bill", () => {
    const bills = [bill('INV1', 'shop-a'), bill('INV2', 'shop-b'), bill('INV3', 'shop-a')]
    let n = 0
    const makeId = (): string => {
      n += 1
      return `id-${String(n)}`
    }
    expect(stopsFromBills(bills, ['INV2', 'INV3', 'INV1'], makeId)).toEqual([
      { id: 'id-1', sequence: 1, retailerId: 'shop-b', invoiceIds: ['INV2'] },
      { id: 'id-2', sequence: 2, retailerId: 'shop-a', invoiceIds: ['INV3', 'INV1'] },
    ])

    const form: PlanForm = {
      tripDate: '2026-09-14',
      vehicleId: 'vehicle-1',
      driverId: 'driver-1',
      helperId: null,
      openingCashPaise: null,
      chosen: ['INV1'],
      vanSales: false,
    }
    expect(planProblem({ ...form, driverId: null })).toBe('needDriver')
    expect(planProblem({ ...form, chosen: [] })).toBe('needBill')
    expect(planProblem({ ...form, vehicleId: null })).toBe('needVehicle')
    expect(planProblem({ ...form, helperId: 'driver-1' })).toBe('sameCrew')
    expect(planProblem(form)).toBeNull()
    expect(snapshotPlan({ ...form, chosen: [] }, bills, makeId)).toBeNull()
    expect(snapshotPlan(form, bills, makeId)?.stops).toEqual([
      { id: 'id-4', sequence: 1, retailerId: 'shop-a', invoiceIds: ['INV1'] },
    ])
    // DOS-233: a van-sales trip needs no bill, and tells the server it sells from the van.
    expect(planProblem({ ...form, chosen: [], vanSales: true })).toBeNull()
    const vanOnly = snapshotPlan({ ...form, chosen: [], vanSales: true }, bills, makeId)
    expect(vanOnly === null ? null : tripCreateBody(vanOnly, 'k')).toMatchObject({
      vanSalesEnabled: true,
      stops: [],
    })
  })
})
