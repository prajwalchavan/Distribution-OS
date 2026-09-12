/**
 * DOS-025 — M7 Load-out: the sheets waiting on the manager get their own register, above the history.
 *
 * The screen makes two reads: `warehouse.loadSheets.list({ limit: 100 })` for the history and
 * `warehouse.loadSheets.list({ status: 'draft', limit: 100 })` for the queue. The server answers both in
 * `desc(id)` order, and the demo seed's ids are sha1 hashes, so id order says nothing about time. The
 * fixtures are the dos_qa shapes (Tarsun, 12 Sep 2026): 83 sheets on one page, 82 confirmed and ONE
 * draft, already approved, sitting at row 62. Every id below is chosen so that id order contradicts the
 * order the manager should read.
 */
import type { LoadSheetSummary } from '@dos/contracts'
import { describe, expect, it } from 'vitest'

import { loadOutHistory, loadOutQueue } from './load-out'

// Fixture ids: the vehicle and the approving manager are the dos_qa rows; the rest only need to be ids.
const GODOWN = '0c61d5f2-3e8a-7b14-9a52-6d0e41f7c3b8'
const VAN_AB_1234 = '3bbe6b52-9d41-7e0a-8b6f-2c95a1e4d707'
const VIKAS_MANAGER = 'a1cbd424-d568-7ccb-b5cc-b049e8ac2063'
const GODOWN_CREW = '5f7e2a19-c4b3-7d08-a1e6-90b2c3d4e5f6'
const TRIP_NEXT = '72649337-1a2b-7c3d-8e4f-5a6b7c8d9e0f'

/** A checked-out sheet, as `loadSheets.list` answers one. */
function sheet(id: string, overrides: Partial<LoadSheetSummary> = {}): LoadSheetSummary {
  return {
    id,
    status: 'confirmed',
    sheetDate: '2026-08-04',
    tripId: null,
    fromLocationId: GODOWN,
    toLocationId: VAN_AB_1234,
    vehicleRegNo: 'MH-05-AB-1234',
    orderCount: 5,
    expectedPackages: 38,
    countedPackages: 38,
    varianceNote: null,
    approvedBy: VIKAS_MANAGER,
    approvedAt: '2026-08-04T06:40:00.000Z',
    pinVerifiedBy: null,
    loadValuePaise: 15_014_700,
    ewbRequired: true,
    ewbNo: '381012345678',
    challanNo: 'DC-0074',
    confirmedBy: GODOWN_CREW,
    confirmedAt: '2026-08-04T07:10:00.000Z',
    cancelledAt: null,
    cancelReason: null,
    createdAt: '2026-08-04T05:30:00.000Z',
    ...overrides,
  }
}

/** A sheet still in the godown: no count, no challan, not checked out. */
function draft(id: string, overrides: Partial<LoadSheetSummary> = {}): LoadSheetSummary {
  return sheet(id, {
    status: 'draft',
    countedPackages: null,
    ewbNo: null,
    challanNo: null,
    confirmedBy: null,
    confirmedAt: null,
    ...overrides,
  })
}

/** An id whose first eight hex digits are `prefix`, so its place under `desc(id)` is known. */
function hexId(prefix: number): string {
  return `${prefix.toString(16).padStart(8, '0')}-5e2d-7a10-8c3b-2f9d6e1a4b70`
}

/**
 * Tarsun's page as the screen reads it: 83 rows in `desc(id)` order — 61 seeded ids above the draft's
 * `374f2089…`, then the draft, then 21 below it — with sheet dates in no order at all (28 Jul, 4 Aug,
 * 3 Sep, 21 Jul, …), because the order is the hash's.
 */
function tarsunPage(theDraft: LoadSheetSummary): LoadSheetSummary[] {
  const dates = ['2026-07-28', '2026-08-04', '2026-09-03', '2026-07-21', '2026-08-19', '2026-09-10']
  const above = Array.from({ length: 61 }, (_, i) => hexId(0x40000000 + (60 - i) * 0x01000000))
  const below = Array.from({ length: 21 }, (_, i) => hexId(0x36000000 - i * 0x01000000))
  const confirmed = [...above, ...below].map((id, i) =>
    sheet(id, { sheetDate: dates[i % dates.length] ?? '2026-08-04' }),
  )
  return [...confirmed.slice(0, 61), theDraft, ...confirmed.slice(61)]
}

describe('M7 Load-out registers', () => {
  it('DOS-025: the draft at row 62 of the 83-row page is the first row of the waiting register, and history never repeats it', () => {
    const todays = draft('374f2089-b8fd-720e-907c-8380307948ab', {
      sheetDate: '2026-09-12',
      tripId: TRIP_NEXT,
      approvedAt: '2026-09-12T06:40:00.000Z',
      createdAt: '2026-09-12T06:20:00.000Z',
    })
    const page = tarsunPage(todays)
    // The fixture is what dos_qa showed: 83 rows, the draft at row 62.
    expect(page).toHaveLength(83)
    expect(page.findIndex((row) => row.id === todays.id)).toBe(61)

    // The screen's `status: 'draft'` read answers the one draft; it leads the waiting register.
    const queue = loadOutQueue([todays])
    expect(queue.map((row) => row.id)).toEqual([todays.id])
    // Handed the whole unfiltered page instead, the queue still holds that draft and nothing else.
    expect(loadOutQueue(page).map((row) => row.id)).toEqual([todays.id])

    // The history register never shows it a second time, and keeps the server's order for the rest.
    const history = loadOutHistory(page)
    expect(history).toHaveLength(82)
    expect(history.some((row) => row.id === todays.id)).toBe(false)
    expect(history.every((row) => row.status !== 'draft')).toBe(true)
    expect(history.map((row) => row.id)).toEqual(
      page.filter((row) => row.id !== todays.id).map((row) => row.id),
    )
  })

  it('DOS-025: a draft missing from the history page (a tenant past 100 sheets) still leads the waiting register', () => {
    // The unfiltered read's 100 rows: all checked out, one cancelled. Van 1's sheet, built on 30 Jun
    // and never approved, sorts below every one of them, so that read never carries it.
    const historyPage = Array.from({ length: 100 }, (_, i) =>
      sheet(
        hexId(0xf0000000 - i * 0x01000000),
        i === 7
          ? {
              status: 'cancelled',
              countedPackages: null,
              challanNo: null,
              confirmedBy: null,
              confirmedAt: null,
              cancelledAt: '2026-08-11T09:00:00.000Z',
              cancelReason: 'Van broke down',
            }
          : {},
      ),
    )
    const stranded = draft('0c3a7d19-4b2e-7f61-9a08-d5e6f7a8b9c0', {
      sheetDate: '2026-06-30',
      approvedBy: null,
      approvedAt: null,
      createdAt: '2026-06-30T04:15:00.000Z',
    })
    expect(historyPage.some((row) => row.id === stranded.id)).toBe(false)

    const queue = loadOutQueue([stranded])
    expect(queue).toHaveLength(1)
    expect(queue[0]?.id).toBe(stranded.id)
    expect(queue[0]?.approvedAt).toBeNull()

    const history = loadOutHistory(historyPage)
    expect(history).toHaveLength(100)
    expect(history.filter((row) => row.status === 'cancelled')).toHaveLength(1)
  })

  it('DOS-025: a sheet waiting for approval comes before an approved draft, newest sheet date first, regardless of id order', () => {
    // Ids descend in exactly the reverse of the order the manager should read.
    const approvedYesterday = draft('f7a90b3c-2d4e-7a51-8b62-c3d4e5f6a7b8', {
      sheetDate: '2026-09-12',
      approvedAt: '2026-09-12T06:40:00.000Z',
      createdAt: '2026-09-12T06:20:00.000Z',
    })
    const approvedToday = draft('e21c4e0a-9b8c-7d6e-8f5a-4b3c2d1e0f9a', {
      sheetDate: '2026-09-13',
      approvedAt: '2026-09-13T04:10:00.000Z',
      createdAt: '2026-09-13T03:50:00.000Z',
    })
    const waitingSinceFriday = draft('a4d2c7e9-6b1f-7038-9c2d-e4f5a6b7c8d9', {
      sheetDate: '2026-09-11',
      approvedBy: null,
      approvedAt: null,
      createdAt: '2026-09-11T05:05:00.000Z',
    })
    const waitingTodayEarlier = draft('3c5b8e1d-7a2f-7c46-8d19-b0a1c2d3e4f5', {
      sheetDate: '2026-09-13',
      approvedBy: null,
      approvedAt: null,
      createdAt: '2026-09-13T02:30:00.000Z',
    })
    // A UUIDv7 minted today sorts below most seeded ids.
    const waitingTodayLatest = draft('01a09679-5c3e-7b2a-9f14-6e7d8c9b0a1f', {
      sheetDate: '2026-09-13',
      approvedBy: null,
      approvedAt: null,
      createdAt: '2026-09-13T05:00:00.000Z',
    })
    const checkedOut = sheet('ffe0d1c2-b3a4-7958-8a7b-6c5d4e3f2a1b', { sheetDate: '2026-09-13' })

    const queue = loadOutQueue([
      approvedToday,
      waitingSinceFriday,
      checkedOut,
      waitingTodayLatest,
      approvedYesterday,
      waitingSinceFriday,
      waitingTodayEarlier,
    ])

    expect(queue.map((row) => row.id)).toEqual([
      waitingTodayLatest.id,
      waitingTodayEarlier.id,
      waitingSinceFriday.id,
      approvedToday.id,
      approvedYesterday.id,
    ])
  })
})
