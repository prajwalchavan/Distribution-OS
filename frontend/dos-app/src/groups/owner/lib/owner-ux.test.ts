/**
 * UX-O-1 … UX-O-7 — the owner UX review of the business simulation (2026-09-27, `ux-owner.md`).
 *
 * The figures below are the ones the review read off the wire on 27 Sep: 31 orders booked of which 6
 * cancelled, 9 packed orders (₹1,76,839) waiting since 10 Sep, 7 dispatched (₹80,180) since 11 Sep on a
 * trip of 12 Sep, 15 stops delivered and 1 failed, cash ₹38,930 · UPI ₹25,515 · cheque ₹29,756 collected,
 * ₹68,686 banked, and Aug 1–27 ₹42,13,759 against Sep 1–27 ₹22,55,223.
 */
import { describe, expect, it } from 'vitest'

import { billFacts } from './bill-facts'
import {
  RANGE_SEGMENT_IDS,
  SEGMENTS_MAX,
  dayRange,
  isExpired,
  olderThanADay,
  rangeOf,
  rangeParam,
  sameDaysLastMonth,
} from './dates'
import {
  FLOW_DESK_PER_ROW,
  FLOW_HREF,
  FLOW_READS,
  buildFlow,
  failedSteps,
  flowRows,
  rollupIsToday,
} from './flow'
import { monthCompare, monthCompareWindow } from './month-compare'

const NOW = Date.parse('2026-09-27T14:15:00Z') // 7:45 pm IST on 27 Sep

const order = (state: string, totalPaise: number, createdAt: string) => ({
  state,
  totalPaise,
  createdAt,
})

describe('UX-O-1: today’s flow strip', () => {
  const steps = buildFlow({
    nowMs: NOW,
    today: '2026-09-27',
    booked: {
      items: [
        order('delivered', 8_409_500, '2026-09-27T02:00:00Z'),
        order('partially_delivered', 1_635_100, '2026-09-27T03:00:00Z'),
        order('cancelled', 2_775_200, '2026-09-27T04:00:00Z'),
      ],
      nextCursor: null,
    },
    held: {
      count: 5,
      more: false,
      asked: ['2026-09-12T06:00:00Z', '2026-09-12T05:00:00Z'],
    },
    billedBills: {
      items: [
        { state: 'issued', totalPaise: 10_000_000 },
        { state: 'paid', totalPaise: 500_800 },
        { state: 'cancelled', totalPaise: 456_200 },
      ],
      nextCursor: null,
    },
    packed: {
      items: [
        order('packed', 10_000_000, '2026-09-10T05:00:00Z'),
        order('packed', 7_683_900, '2026-09-12T05:00:00Z'),
      ],
      nextCursor: null,
    },
    dispatched: {
      items: [order('dispatched', 8_018_000, '2026-09-11T05:00:00Z')],
      nextCursor: 'more',
    },
    trips: {
      items: [
        { tripNo: 'TRIP-0004', tripDate: '2026-09-12', startedAt: '2026-09-12T03:30:00Z' },
        { tripNo: 'TRIP-0010', tripDate: '2026-09-27', startedAt: null },
      ],
      nextCursor: null,
    },
    dashboard: {
      asOf: '2026-09-27T14:00:00Z',
      todayDeliveredStops: 15,
      todayFailedStops: 1,
      totalOutstandingPaise: 447_451_200,
    },
    collections: {
      cashPaise: 3_893_000,
      upiPaise: 2_551_500,
      chequePaise: 2_975_600,
      bankTransferPaise: 0,
      totalPaise: 9_420_100,
    },
    banked: { countedPaise: 6_868_600 },
  })
  const step = (id: string) => steps.find((s) => s.id === id)

  it('is the nine links of the chain, in order, each pointing at its filtered register', () => {
    expect(steps.map((s) => s.id)).toEqual([
      'booked',
      'held',
      'billed',
      'packed',
      'road',
      'delivered',
      'collected',
      'banked',
      'owed',
    ])
    expect(steps.map((s) => s.href)).toEqual(steps.map((s) => FLOW_HREF[s.id]))
    expect(FLOW_HREF.packed).toBe('/orders?state=packed&range=all')
    expect(FLOW_HREF.banked).toBe('/money/receipts?range=today&status=deposited')
  })

  it('books what is still live and names the cancelled beside it, not inside it', () => {
    expect(step('booked')).toMatchObject({
      count: 2,
      paise: 10_044_600,
      cancelled: { count: 1, paise: 2_775_200 },
      stale: false,
    })
  })

  it('turns packed, on-the-road and held ochre when they hold anything older than a day', () => {
    expect(step('packed')).toMatchObject({
      count: 2,
      paise: 17_683_900,
      oldest: '2026-09-10T05:00:00Z',
      stale: true,
    })
    expect(step('road')).toMatchObject({
      count: 1,
      more: true,
      paise: 8_018_000,
      stale: true,
      trip: { name: 'TRIP-0004', since: '2026-09-12T03:30:00Z' },
    })
    expect(step('held')).toMatchObject({ count: 5, oldest: '2026-09-12T05:00:00Z', stale: true })
  })

  it('carries the delivered/failed stops, the mode split, the banked total and the dues', () => {
    // a cancelled bill is not billed (the dashboard's own rule), so the step agrees with its register
    expect(step('billed')).toMatchObject({ count: 2, paise: 10_500_800 })
    expect(step('delivered')).toMatchObject({ count: 15, failed: 1 })
    expect(step('collected')).toMatchObject({
      paise: 9_420_100,
      modes: { cash: 3_893_000, upi: 2_551_500, cheque: 2_975_600, bank: 0 },
    })
    expect(step('banked')?.paise).toBe(6_868_600)
    expect(step('owed')?.paise).toBe(447_451_200)
  })

  it('never shows a zero it did not read: a step whose read has not answered has no count', () => {
    const empty = buildFlow({ nowMs: NOW, today: '2026-09-27' })
    expect(empty.every((s) => s.count === undefined && s.paise === undefined)).toBe(true)
    expect(empty.every((s) => !s.stale)).toBe(true)
  })

  it('a packed order from this morning is not stuck', () => {
    const fresh = buildFlow({
      nowMs: NOW,
      today: '2026-09-27',
      packed: { items: [order('packed', 100, '2026-09-27T04:00:00Z')], nextCursor: null },
    })
    expect(fresh.find((s) => s.id === 'packed')?.stale).toBe(false)
  })

  it('never passes a rollup of another day off as today: delivered goes blank and says which day', () => {
    const old = buildFlow({
      nowMs: NOW,
      today: '2026-09-27',
      dashboard: {
        asOf: '2026-09-12T12:30:00Z',
        todayDeliveredStops: 4,
        todayFailedStops: 0,
        totalOutstandingPaise: 442_437_400,
      },
    })
    expect(old.find((s) => s.id === 'delivered')).toMatchObject({
      count: undefined,
      failed: undefined,
      asOf: '2026-09-12T12:30:00Z',
    })
    expect(old.find((s) => s.id === 'owed')).toMatchObject({
      paise: 442_437_400,
      asOf: '2026-09-12T12:30:00Z',
    })
  })
})

describe('UX-O-1, UX-O-5: the Today range', () => {
  it('reads today as one IST day and a ?range= parameter safely', () => {
    expect(rangeOf('today', '2026-09-27')).toEqual({ from: '2026-09-27', to: '2026-09-27' })
    expect(rangeParam('today', 'd30')).toBe('today')
    expect(rangeParam('fy', 'd30')).toBe('fy')
    expect(rangeParam('all', 'd30')).toBe('d30')
    expect(rangeParam(undefined, 'd90')).toBe('d90')
    expect(rangeParam(['today'], 'd30')).toBe('d30')
  })

  it('an IST date or an instant older than a day is stale; one of today is not', () => {
    expect(olderThanADay('2026-09-12', NOW)).toBe(true)
    expect(olderThanADay('2026-09-27', NOW)).toBe(false)
    expect(olderThanADay('2026-09-26T13:00:00Z', NOW)).toBe(true)
    expect(olderThanADay('2026-09-27T01:00:00Z', NOW)).toBe(false)
    expect(olderThanADay(null, NOW)).toBe(false)
  })
})

describe('UX-O-2: an expired lot is expired', () => {
  it('is past its date once its expiry day is behind today; the day itself still sells', () => {
    expect(isExpired('2026-08-31', '2026-09-27')).toBe(true)
    expect(isExpired('2026-09-27', '2026-09-27')).toBe(false)
    expect(isExpired('2027-01-15', '2026-09-27')).toBe(false)
    expect(isExpired(null, '2026-09-27')).toBe(false)
  })
})

describe('UX-O-4: this month against the same days of last month', () => {
  it('on 27 Sep compares 1–27 Sep with 1–27 Aug, not with the whole of August', () => {
    expect(sameDaysLastMonth('2026-09-27')).toEqual({
      current: { from: '2026-09-01', to: '2026-09-27' },
      previous: { from: '2026-08-01', to: '2026-08-27' },
    })
    expect(monthCompareWindow('2026-09-27')).toEqual({ from: '2026-08-01', to: '2026-09-27' })
    expect(dayRange({ from: '2026-08-01', to: '2026-08-27' })).toBe('1–27 Aug')
    expect(dayRange({ from: '2026-10-01', to: '2026-10-01' })).toBe('1 Oct')
  })

  it('clamps a day last month did not have, and crosses the year', () => {
    expect(sameDaysLastMonth('2026-10-31').previous).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    })
    expect(sameDaysLastMonth('2027-01-15').previous).toEqual({
      from: '2026-12-01',
      to: '2026-12-15',
    })
    expect(sameDaysLastMonth('2027-03-30').previous.to).toBe('2027-02-28')
  })

  it('sums the series on each side and states the change in whole percent (−46 %, not −53 %)', () => {
    const points = [
      { bucket: '2026-08-05', value: 400_000_000 },
      { bucket: '2026-08-27', value: 21_375_900 },
      // 28–31 Aug is outside the comparison: last month's tail is not this month's to beat yet
      { bucket: '2026-08-30', value: 62_825_000 },
      { bucket: '2026-09-02', value: 200_000_000 },
      { bucket: '2026-09-27', value: 25_522_300 },
    ]
    expect(monthCompare(points, '2026-09-27')).toMatchObject({
      previousPaise: 421_375_900,
      currentPaise: 225_522_300,
      changePct: -46,
    })
    expect(monthCompare([], '2026-09-27').changePct).toBeNull()
  })
})

describe('UX-O-7: a bill in the shop panel names its dates and what is left', () => {
  it('a new bill: billed and due dates, not late, nothing paid', () => {
    expect(
      billFacts({
        invoiceDate: '2026-09-27',
        dueDate: '2026-10-04',
        totalPaise: 262_400,
        openPaise: 262_400,
        ageDays: -7,
      }),
    ).toEqual({ billed: '2026-09-27', due: '2026-10-04', lateDays: null, partPaid: false })
  })

  it('a part-paid bill 52 days late says what is left of its total', () => {
    expect(
      billFacts({
        invoiceDate: '2026-07-30',
        dueDate: '2026-08-06',
        totalPaise: 1_011_900,
        openPaise: 456_100,
        ageDays: 52,
      }),
    ).toEqual({ billed: '2026-07-30', due: '2026-08-06', lateDays: 52, partPaid: true })
  })
})

describe('owner-ux repair: what the blind verifier found', () => {
  it('finding 1: the range segments still offer 90 days; Today is not a segment', () => {
    // The kit's <Segments> draws only its first three items: a Today segment in front pushed 90 off.
    expect(RANGE_SEGMENT_IDS.length).toBeLessThanOrEqual(SEGMENTS_MAX)
    expect(RANGE_SEGMENT_IDS).toContain('d90')
    expect(RANGE_SEGMENT_IDS).toEqual(['d7', 'd30', 'd90'])
    expect(RANGE_SEGMENT_IDS as readonly string[]).not.toContain('today')
  })

  it('finding 2: the nine steps lay out on a desk as two aligned rows, five then four', () => {
    const ids = buildFlow({ today: '2026-09-27', nowMs: NOW }).map((step) => step.id)
    const rows = flowRows(ids)
    expect(FLOW_DESK_PER_ROW).toBe(5)
    expect(rows).toEqual([
      ['booked', 'held', 'billed', 'packed', 'road'],
      ['delivered', 'collected', 'banked', 'owed'],
    ])
    expect(rows.flat()).toEqual(ids)
  })

  it('finding 3: a rollup of 12 Sep is not today’s; one of this afternoon is', () => {
    expect(rollupIsToday('2026-09-12T12:30:00Z', '2026-09-27')).toBe(false)
    expect(rollupIsToday('2026-09-27T09:00:00Z', '2026-09-27')).toBe(true)
    // the day is IST: 11:45 pm IST on the 26th is the 26th, 00:30 am IST on the 27th is the 27th
    expect(rollupIsToday('2026-09-26T18:15:00Z', '2026-09-27')).toBe(false)
    expect(rollupIsToday('2026-09-26T19:00:00Z', '2026-09-27')).toBe(true)
    expect(rollupIsToday(undefined, '2026-09-27')).toBe(false)
  })

  it('finding 5: a failed read names every step drawn from it', () => {
    expect(failedSteps(new Set())).toEqual(new Set())
    expect(failedSteps(new Set(['packed']))).toEqual(new Set(['packed']))
    expect(failedSteps(new Set(['dashboard']))).toEqual(new Set(['delivered', 'owed']))
    expect(failedSteps(new Set(['trips', 'bargains', 'collections']))).toEqual(
      new Set(['road', 'held', 'collected']),
    )
    // every step is drawn from at least one read, so no step can fail silently
    for (const reads of Object.values(FLOW_READS)) expect(reads.length).toBeGreaterThan(0)
  })
})
