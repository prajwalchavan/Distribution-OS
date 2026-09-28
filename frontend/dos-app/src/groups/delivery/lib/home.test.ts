/**
 * The driver's home as rules (founder, 2026-09-28: "every app opens on its work, and nobody should need
 * training"). What each card is, which one is next, whether the van may leave, the one summary line,
 * and the words: every button at most 20 characters and every chip one word.
 */
import { describe, expect, it } from 'vitest'

import { strings } from '../strings'
import {
  HOME_ACTION_KEYS,
  HOME_CHIP_KEYS,
  allDoorsDone,
  billsToDeliver,
  cartonsLoaded,
  doorNeedsPhoto,
  heldOnPhone,
  homeSummary,
  loadReadiness,
  moneyPutOff,
  nextJobId,
  putMoneyOff,
  readyToDeliverAll,
  sheetOrderIds,
  sheetsForTrip,
  stopJob,
  type HomeLoadSheet,
} from './home'

const catalogue = strings as Record<string, string>

describe('one stop, as a job', () => {
  it('before the shop: waiting, and what the office planned to collect', () => {
    for (const state of ['pending', 'started'])
      expect(
        stopJob({ state, bills: [{ outcome: null }], plannedPaise: 500_00, takenPaise: 0 }),
      ).toEqual({
        kind: 'waiting',
        openBills: 1,
        leftPaise: 500_00,
        doorDone: false,
      })
  })

  it('at the shop with a bill still to hand over: here', () => {
    expect(
      stopJob({
        state: 'arrived',
        bills: [{ outcome: null }, { outcome: 'delivered' }],
        plannedPaise: 500_00,
        takenPaise: 0,
      }),
    ).toMatchObject({ kind: 'here', openBills: 1, doorDone: false })
  })

  it('a door delivered with no signal is recorded — never offered "Delivered, all items" again', () => {
    const job = stopJob({
      state: 'arrived',
      bills: [{ outcome: null, pending: 'queued' }],
      plannedPaise: 500_00,
      takenPaise: 0,
    })
    expect(job).toEqual({ kind: 'money', openBills: 0, leftPaise: 500_00, doorDone: true })
    expect(
      stopJob({
        state: 'arrived',
        bills: [{ outcome: null, pending: 'sending' }],
        plannedPaise: 0,
        takenPaise: 0,
      }).kind,
    ).toBe('finished')
  })

  it('a write the office refused is not recorded: the bill is open again', () => {
    expect(
      stopJob({
        state: 'arrived',
        bills: [{ outcome: null, pending: 'rejected' }],
        plannedPaise: 500_00,
        takenPaise: 0,
      }),
    ).toMatchObject({ kind: 'here', openBills: 1 })
    expect(heldOnPhone('rejected')).toBe(false)
    expect(heldOnPhone('kept')).toBe(false)
  })

  it('delivered with money still asked for: money; paid in full (the phone’s own receipts count): finished', () => {
    const delivered = {
      state: 'delivered',
      bills: [{ outcome: 'delivered' }],
      plannedPaise: 900_00,
    }
    expect(stopJob({ ...delivered, takenPaise: 400_00 })).toMatchObject({
      kind: 'money',
      leftPaise: 500_00,
    })
    expect(stopJob({ ...delivered, takenPaise: 900_00 })).toMatchObject({
      kind: 'finished',
      leftPaise: 0,
    })
    // More than the plan (old dues paid too) is never a negative figure.
    expect(stopJob({ ...delivered, takenPaise: 1_000_00 }).leftPaise).toBe(0)
  })

  it('a stop that failed asks for nothing more', () => {
    expect(
      stopJob({
        state: 'failed',
        bills: [{ outcome: 'failed' }],
        plannedPaise: 900_00,
        takenPaise: 0,
      }),
    ).toEqual({ kind: 'finished', openBills: 0, leftPaise: 0, doorDone: true })
  })

  it('a door with no bill of its own (old dues) is "here" until the money is taken', () => {
    expect(
      stopJob({ state: 'arrived', bills: [], plannedPaise: 300_00, takenPaise: 0 }),
    ).toMatchObject({ kind: 'here', openBills: 0, leftPaise: 300_00 })
  })
})

describe('which card is next, and when the day is done', () => {
  const job = (kind: 'waiting' | 'here' | 'money' | 'finished', left = 0) => ({
    kind,
    openBills: 0,
    leftPaise: left,
    doorDone: kind === 'money' || kind === 'finished',
  })

  it('the first card, in trip order, that still has work', () => {
    const jobs = [
      { id: 'a', job: job('finished') },
      { id: 'b', job: job('money', 100) },
      { id: 'c', job: job('waiting', 200) },
    ]
    expect(nextJobId(jobs, new Set())).toBe('b')
    // "No money now" lets the next shop be the one to drive to; the money card stays where it is.
    expect(nextJobId(jobs, new Set(['b']))).toBe('c')
  })

  it('all done only when every door is over — money put off included — and the whole trip is here', () => {
    const jobs = [
      { id: 'a', job: job('finished') },
      { id: 'b', job: job('money', 100) },
    ]
    expect(allDoorsDone(jobs, 2, new Set())).toBe(false)
    expect(allDoorsDone(jobs, 2, new Set(['b']))).toBe(true)
    // Six stops planned and two on the phone so far is not a finished day.
    expect(allDoorsDone(jobs, 6, new Set(['b']))).toBe(false)
    expect(allDoorsDone([], 0, new Set())).toBe(false)
  })

  it('the summary counts doors done out of the trip’s own figure, and the money still to collect', () => {
    expect(
      homeSummary(
        [{ job: job('finished') }, { job: job('money', 150_00) }, { job: job('waiting', 250_00) }],
        6,
      ),
    ).toEqual({ done: 2, total: 6, leftPaise: 400_00 })
  })

  it('"No money now" is remembered for the running app and records nothing else', () => {
    expect(moneyPutOff().has('stop-x')).toBe(false)
    expect(putMoneyOff('stop-x').has('stop-x')).toBe(true)
    expect(moneyPutOff().has('stop-x')).toBe(true)
  })
})

describe('DOS-071 a door that owes a photo never gets the one-tap write', () => {
  it('the same rule D4 asks', () => {
    expect(doorNeedsPhoto('credit_only', 'POST_FULFILLMENT')).toBe(true)
    expect(doorNeedsPhoto('credit_only', 'ON')).toBe(false)
    expect(doorNeedsPhoto('always', 'ON')).toBe(true)
    expect(doorNeedsPhoto('never', 'POST_FULFILLMENT')).toBe(false)
  })
})

describe('"Delivered, all items" names every bill and its pieces', () => {
  const bills = [
    { id: 'd1', invoice_id: 'i1', outcome: null },
    { id: 'd2', invoice_id: 'i2', outcome: null },
    { id: 'd3', invoice_id: 'i3', outcome: 'delivered' },
    { id: 'd4', invoice_id: 'i4', outcome: null, _pending: 'queued' },
  ]
  const lines = [
    { invoice_id: 'i1', qty_pcs: 24, free_qty_pcs: 2 },
    { invoice_id: 'i1', qty_pcs: 6, free_qty_pcs: 0 },
    { invoice_id: 'i2', qty_pcs: 12, free_qty_pcs: 0 },
  ]
  const numbers: Record<string, string> = { i1: 'INV/0825', i2: 'INV/0826' }

  it('only the bills still open, with every piece counted, free pieces included', () => {
    const named = billsToDeliver(bills, (id) => numbers[id] ?? null, lines)
    expect(named).toEqual([
      { deliveryId: 'd1', invoiceId: 'i1', invoiceNo: 'INV/0825', pieces: 32 },
      { deliveryId: 'd2', invoiceId: 'i2', invoiceNo: 'INV/0826', pieces: 12 },
    ])
    expect(readyToDeliverAll(named)).toBe(true)
  })

  it('a bill whose lines have not reached the device cannot be delivered in full yet', () => {
    const named = billsToDeliver(bills, (id) => numbers[id] ?? null, lines.slice(0, 2))
    expect(named[1]?.pieces).toBeNull()
    expect(readyToDeliverAll(named)).toBe(false)
    expect(readyToDeliverAll([])).toBe(false)
  })
})

describe('before the van leaves', () => {
  const sheet = (over: Partial<HomeLoadSheet>): HomeLoadSheet => ({
    id: 's',
    trip_id: 'trip-1',
    status: 'confirmed',
    expected_packages: 10,
    counted_packages: null,
    order_ids: '["o1","o2"]',
    ...over,
  })

  it('order ids read from the JSON text the device holds', () => {
    expect(sheetOrderIds('["o1","o2"]')).toEqual(['o1', 'o2'])
    expect(sheetOrderIds(['o3'])).toEqual(['o3'])
    expect(sheetOrderIds('not json')).toEqual([])
    expect(sheetOrderIds(null)).toEqual([])
  })

  it('a sheet carries this trip by its trip id, or with no trip id by one of its bills', () => {
    const sheets = [
      sheet({ id: 'linked' }),
      sheet({ id: 'vehicle', trip_id: null, order_ids: '["o2"]' }),
      sheet({ id: 'other', trip_id: null, order_ids: '["o9"]' }),
      sheet({ id: 'elsewhere', trip_id: 'trip-2' }),
      sheet({ id: 'cancelled', status: 'cancelled' }),
    ]
    expect(sheetsForTrip(sheets, 'trip-1', ['o1', 'o2']).map((one) => one.id)).toEqual([
      'linked',
      'vehicle',
    ])
  })

  it('the office refuses a planned trip, a draft sheet and a bill on no confirmed sheet — so does the card', () => {
    const orderIds = ['o1', 'o2']
    expect(loadReadiness({ tripState: 'planned', sheets: [sheet({})], orderIds })).toBe(
      'notStarted',
    )
    expect(loadReadiness({ tripState: 'loading', sheets: [], orderIds })).toBe('loading')
    expect(
      loadReadiness({ tripState: 'loading', sheets: [sheet({ status: 'draft' })], orderIds }),
    ).toBe('loading')
    expect(
      loadReadiness({
        tripState: 'loading',
        sheets: [sheet({ order_ids: '["o1"]' })],
        orderIds,
      }),
    ).toBe('loading')
    expect(loadReadiness({ tripState: 'loading', sheets: [sheet({})], orderIds })).toBe('ready')
  })

  it('the phone never refuses more than the office: a van-sales day, or a sheet whose bills it cannot read', () => {
    expect(loadReadiness({ tripState: 'loading', sheets: [], orderIds: [] })).toBe('ready')
    expect(
      loadReadiness({
        tripState: 'loading',
        sheets: [sheet({ order_ids: null })],
        orderIds: ['o1'],
      }),
    ).toBe('ready')
  })

  it('cartons on board are the godown’s count where it has one, and nothing before a sheet is confirmed', () => {
    expect(cartonsLoaded([sheet({ counted_packages: 12 }), sheet({ expected_packages: 3 })])).toBe(
      15,
    )
    expect(cartonsLoaded([sheet({ status: 'draft' })])).toBeNull()
  })
})

describe('the words a driver reads (rule 5: plain, at most 20 characters)', () => {
  it('every button on the home and its sheets is declared and fits in 20 characters', () => {
    const tooLong = HOME_ACTION_KEYS.filter((key) => (catalogue[key] ?? '').length > 20)
    const missing = HOME_ACTION_KEYS.filter((key) => catalogue[key] === undefined)
    expect({ tooLong, missing }).toEqual({ tooLong: [], missing: [] })
  })

  it('every chip is one word', () => {
    expect(
      HOME_CHIP_KEYS.filter((key) => (catalogue[key] ?? '').trim().split(/\s+/).length !== 1),
    ).toEqual([])
  })

  it('the navigation keeps to the rail’s 14 characters and names each screen as it names itself', () => {
    const nav = Object.entries(catalogue).filter(([key]) => key.startsWith('nav.'))
    expect(nav.filter(([, value]) => value.length > 14)).toEqual([])
    expect(catalogue['nav.day']).toBe(catalogue['d8.title'])
    expect(catalogue['nav.expenses']).toBe(catalogue['d7.title'])
    expect(catalogue['nav.history']).toBe(catalogue['d11.title'])
  })

  it('no home word names the device — a keep is said only through keepKey (DOS-179)', () => {
    const naming = Object.entries(catalogue).filter(
      ([key, value]) =>
        key.startsWith('home.') && /\b(this|the)\s+(phone|device|browser)\b/i.test(value),
    )
    expect(naming).toEqual([])
  })

  it('no accounting or office words on the home or in the navigation', () => {
    const office =
      /\b(float|expense|expenses|load sheet|settle|settlement|allocat\w*|outstanding|ledger|sync|pending)\b/i
    const shown = Object.entries(catalogue).filter(
      ([key]) =>
        key.startsWith('home.') ||
        key.startsWith('nav.') ||
        [
          'd1.title',
          'd1.openingCash',
          'd1.collectedToday',
          'd1.addExpense',
          'd1.loadPlanned',
        ].includes(key),
    )
    expect(shown.filter(([, value]) => office.test(value))).toEqual([])
  })
})
