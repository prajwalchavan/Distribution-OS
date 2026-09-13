/**
 * DOS-108 — O24 Settings › Support access: what the owner may do with each support request.
 *
 * Owner-service is the guarantee (`tenancy/support.service.ts`): an approval may only SHORTEN the ask
 * (400 `window_too_long`), the window is counted from the REQUEST, an approval whose window has already
 * closed is refused (409 `request_expired`), and refusing is `revoke` on a request never approved. These
 * specs pin the owner app to the same rules, so it never offers a press the service can only refuse.
 *
 * The fixtures are shaped like the Tarsun grants: in dos_qa 7232298a (dos.support, 4 h, asked 12:50 IST
 * 12 Sep, never answered, lapsed), dc9b8792 (dos.admin, 72 h, approved then revoked) and a6b5683f
 * (expired); in the batch-2 template the live dc9b8792 window (72 h asked, inserted approved for 29 days)
 * and the 4 h dos.support ask made at 12:40 IST 13 Sep. Every case runs against a fixed `now`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  chosenHours,
  supportDecision,
  windowClosesAt,
  type SupportDecision,
  type SupportGrantClock,
  type WaitingDecision,
} from './support'

const HOUR_MS = 3_600_000

/** 13:30 IST, 13 Sep 2026: the moment the owner opens Settings › Support access. */
const NOW = Date.parse('2026-09-13T08:00:00.000Z')

/** A fresh 2 h read-only ask, made half an hour before NOW. */
const FRESH_ASK: SupportGrantClock = {
  status: 'requested',
  active: false,
  requestedAt: '2026-09-13T07:30:00.000Z',
  requestedHours: 2,
  expiresAt: null,
}

/** The template's 4 h dos.support ask (12:40 IST 13 Sep): open until 16:40 IST. */
const TEMPLATE_ASK: SupportGrantClock = {
  status: 'requested',
  active: false,
  requestedAt: '2026-09-13T07:10:21.398Z',
  requestedHours: 4,
  expiresAt: null,
}

/** The template's live dc9b8792: 72 h asked, open for 29 days (12 Oct 12:40 IST). */
const LIVE_WINDOW: SupportGrantClock = {
  status: 'approved',
  active: true,
  requestedAt: '2026-09-13T07:10:29.663Z',
  requestedHours: 72,
  expiresAt: '2026-10-12T07:10:29.663Z',
}

/** dos_qa 7232298a: asked for 4 h at 12:50 IST on 12 Sep and never answered. On the wire it still reads
 * `requested` (DOS-110), with no `expiresAt`; its own hours ran out at 16:50 IST that day. */
const LAPSED_ASK: SupportGrantClock = {
  status: 'requested',
  active: false,
  requestedAt: '2026-09-12T07:20:00.000Z',
  requestedHours: 4,
  expiresAt: null,
}

/** A request the owner refused: `revoke` on a grant never approved. */
const REFUSED_ASK: SupportGrantClock = { ...FRESH_ASK, status: 'rejected' }

/** dos_qa dc9b8792: approved for 72 h, then revoked by the owner. */
const REVOKED_WINDOW: SupportGrantClock = {
  status: 'revoked',
  active: false,
  requestedAt: '2026-09-12T03:34:00.000Z',
  requestedHours: 72,
  expiresAt: '2026-09-15T03:34:00.000Z',
}

/** dos_qa a6b5683f: a 4 h window approved on 3 Sep that closed on its own. */
const EXPIRED_WINDOW: SupportGrantClock = {
  status: 'expired',
  active: false,
  requestedAt: '2026-09-03T07:10:29.663Z',
  requestedHours: 4,
  expiresAt: '2026-09-03T11:10:29.663Z',
}

const CLOSED: SupportDecision = { kind: 'closed', actions: [] }

function waiting(decision: SupportDecision): WaitingDecision {
  if (decision.kind !== 'waiting')
    throw new Error(`expected a waiting request, got ${decision.kind}`)
  return decision
}

afterEach(() => {
  vi.useRealTimers()
})

describe('O24 Settings › Support access: what the owner may decide', () => {
  it("DOS-108: a request waiting for the owner offers Approve and Refuse, an open window offers Revoke, and a refused, revoked, expired or lapsed request (still 'requested' on the wire after its own hours) offers nothing", () => {
    expect(supportDecision(FRESH_ASK, NOW)).toMatchObject({
      kind: 'waiting',
      actions: ['approve', 'refuse'],
    })
    expect(supportDecision(TEMPLATE_ASK, NOW)).toMatchObject({
      kind: 'waiting',
      actions: ['approve', 'refuse'],
    })

    expect(supportDecision(LIVE_WINDOW, NOW)).toEqual({
      kind: 'open',
      actions: ['revoke'],
      closesAt: '2026-10-12T07:10:29.663Z',
    })

    for (const grant of [REFUSED_ASK, REVOKED_WINDOW, EXPIRED_WINDOW, LAPSED_ASK]) {
      expect(supportDecision(grant, NOW)).toEqual(CLOSED)
    }

    // The instant an ask's own hours run out it lapses: owner-service refuses a window ending at or before now.
    const lapsesAt = Date.parse(TEMPLATE_ASK.requestedAt) + 4 * HOUR_MS
    expect(supportDecision(TEMPLATE_ASK, lapsesAt - 1).kind).toBe('waiting')
    expect(supportDecision(TEMPLATE_ASK, lapsesAt)).toEqual(CLOSED)

    // A page left open past a window's end still holds `active: true` from its last read: nothing to revoke.
    const stale = Date.parse('2026-10-12T07:10:29.663Z')
    expect(supportDecision(LIVE_WINDOW, stale)).toEqual(CLOSED)
    expect(supportDecision({ ...LIVE_WINDOW, expiresAt: null }, NOW)).toEqual(CLOSED)

    // Closed by default: a status this build does not know yet (DOS-110's `lapsed`) offers nothing.
    const lapsed = 'lapsed' as unknown as SupportGrantClock['status']
    expect(supportDecision({ ...TEMPLATE_ASK, status: lapsed }, NOW)).toEqual(CLOSED)
  })

  it('DOS-108: the owner approves for the hours support asked or fewer; a 2-hour ask offers 1 h and 2 h, never the fixed 4 h owner-service refuses, and a choice no longer offered falls back to the hours asked', () => {
    const fresh = waiting(supportDecision(FRESH_ASK, NOW))
    expect(fresh.hours).toEqual([1, 2])
    expect(fresh.hours).not.toContain(4)
    expect(fresh.initialHours).toBe(2)

    expect(chosenHours(fresh, undefined)).toBe(2)
    expect(chosenHours(fresh, 1)).toBe(1)
    expect(chosenHours(fresh, 2)).toBe(2)
    // A 4 h choice carried over from another card is never sent on a 2 h ask.
    expect(chosenHours(fresh, 4)).toBe(2)

    // The template's 72 h ask, before it was approved, offers every choice up to the hours asked.
    const unanswered: SupportGrantClock = {
      ...LIVE_WINDOW,
      status: 'requested',
      active: false,
      expiresAt: null,
    }
    expect(waiting(supportDecision(unanswered, NOW)).hours).toEqual([1, 2, 4, 8, 24, 48, 72])
    expect(waiting(supportDecision(unanswered, NOW)).initialHours).toBe(72)

    // Hours asked that are not on the list stay a choice of their own, in order.
    expect(waiting(supportDecision({ ...FRESH_ASK, requestedHours: 5 }, NOW)).hours).toEqual([
      1, 2, 4, 5,
    ])

    // 1 h picked at 13:30 IST; the page is still open at 14:00, when that window closes: the ask goes.
    const later = waiting(supportDecision(FRESH_ASK, Date.parse('2026-09-13T08:30:00.000Z')))
    expect(later.hours).toEqual([2])
    expect(chosenHours(later, 1)).toBe(2)
  })

  it('DOS-108: Approve for N h closes the window at requestedAt + N h, as owner-service measures it, and an hour choice whose window would already have closed is not offered', () => {
    // The owner presses at 13:30 IST, half an hour after the ask: the window still counts from the ask.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    expect(windowClosesAt(FRESH_ASK.requestedAt, 1)).toBe('2026-09-13T08:30:00.000Z')
    expect(windowClosesAt(FRESH_ASK.requestedAt, 2)).toBe('2026-09-13T09:30:00.000Z')
    expect(windowClosesAt(TEMPLATE_ASK.requestedAt, 4)).toBe('2026-09-13T11:10:21.398Z')
    vi.useRealTimers()

    // A 4 h ask answered exactly two hours later: 1 h has closed, 2 h closes this very instant (refused as
    // `request_expired`), and only 4 h is left.
    const twoHoursOn = Date.parse(TEMPLATE_ASK.requestedAt) + 2 * HOUR_MS
    const late = waiting(supportDecision(TEMPLATE_ASK, twoHoursOn))
    expect(late.hours).toEqual([4])
    expect(chosenHours(late, 2)).toBe(4)

    // Every hour offered at NOW closes after NOW.
    const offered = waiting(supportDecision(TEMPLATE_ASK, NOW)).hours
    expect(offered).toEqual([1, 2, 4])
    for (const hours of offered) {
      expect(Date.parse(windowClosesAt(TEMPLATE_ASK.requestedAt, hours))).toBeGreaterThan(NOW)
    }
  })
})
