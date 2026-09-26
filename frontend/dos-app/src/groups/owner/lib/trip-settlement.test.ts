import type { ApprovalTripSettlement } from '@dos/contracts'
import { describe, expect, it } from 'vitest'

import { cashBeyondTolerance, cashOff, stockSummary, tripName, tripOf } from './trip-settlement'

/** TRIP-0002 as the simulation left it: ₹200 short against ₹100 allowed, 154 pieces not counted back. */
const trip2: ApprovalTripSettlement = {
  tripId: '01a0de1c-ac10-77c3-957d-8af7a402cd1a',
  tripNo: 'TRIP-0002',
  tripDate: '2026-09-26',
  tripState: 'closing',
  vehicleRegNo: 'MH-05-EF-9012',
  openingCashPaise: 0,
  cashCollectedPaise: 1_161_600,
  expensesPaise: 0,
  expectedCashPaise: 1_161_600,
  handedOverCashPaise: 1_141_600,
  cashVariancePaise: -20_000,
  tolerancePaise: 10_000,
  upiCollectedPaise: 3_049_800,
  chequeCollectedPaise: 1_586_700,
  stockVariance: [
    {
      lotId: 'l1',
      variantName: 'Atta 10 kg',
      batchNo: 'AN20260905',
      caseSize: 1,
      expectedPcs: 10,
      countedPcs: 0,
      deltaPcs: -10,
      valuePaise: -400_000,
    },
    {
      lotId: 'l2',
      variantName: 'Bourbon',
      batchNo: 'SB20260802',
      caseSize: 24,
      expectedPcs: 120,
      countedPcs: 0,
      deltaPcs: -120,
      valuePaise: null,
    },
    {
      lotId: 'l3',
      variantName: 'Oil 1 l',
      batchNo: 'AN20260822',
      caseSize: 12,
      expectedPcs: 23,
      countedPcs: 25,
      deltaPcs: 2,
      valuePaise: 30_000,
    },
  ],
  stockVarianceValuePaise: -370_000,
}

describe('DOS-235 the trip settlement the owner decides', () => {
  it('names the trip by its number and vehicle, and only for a trip settlement', () => {
    expect(tripOf({ kind: 'trip_settlement', tripSettlement: trip2 })).toBe(trip2)
    expect(tripOf({ kind: 'credit_limit', tripSettlement: trip2 })).toBeNull()
    expect(tripOf({ kind: 'trip_settlement', tripSettlement: null })).toBeNull()
    expect(tripName(trip2)).toBe('TRIP-0002 · MH-05-EF-9012')
    expect(tripName({ ...trip2, tripNo: null, vehicleRegNo: null })).toBe('01a0de1c')
  })

  it('says which way the cash is off and whether it is past the allowance', () => {
    expect(cashOff(trip2)).toBe('short')
    expect(cashOff({ cashVariancePaise: 500 })).toBe('over')
    expect(cashOff({ cashVariancePaise: 0 })).toBe('exact')
    expect(cashBeyondTolerance(trip2)).toBe(true)
    expect(cashBeyondTolerance({ cashVariancePaise: -10_000, tolerancePaise: 10_000 })).toBe(false)
  })

  it('counts the pieces missing and extra and carries the value the server priced', () => {
    expect(stockSummary(trip2)).toEqual({
      lots: 3,
      missingPcs: 130,
      extraPcs: 2,
      valuePaise: -370_000,
    })
    expect(stockSummary({ stockVariance: [], stockVarianceValuePaise: null })).toEqual({
      lots: 0,
      missingPcs: 0,
      extraPcs: 0,
      valuePaise: null,
    })
  })
})
