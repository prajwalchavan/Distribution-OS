/**
 * DOS-136 — after a lost reply, pressing "Bank it" again must be the SAME request.
 *
 * The walk's trace: RCPT-0693 (office cash ₹5,511) was banked with slip DEP-QA-034-ACC, the service
 * committed it (journal BANK +551100 / CASH −551100) and the reply was dropped on the way back. The
 * second press carried the same id and the same idempotencyKey but `depositedAt` had moved from
 * …32.681Z to …32.964Z, so the service answered 409 "idempotencyKey was already used with a different
 * request" and the panel still read Collected over money that was in the bank.
 */
import { describe, expect, it } from 'vitest'

import {
  bounceBody,
  bounceIntent,
  bounceProblem,
  depositBody,
  depositIntent,
  keepIds,
  outcomeUnknown,
} from './money-intents'

const META = {
  id: '01a09777-e789-7c4d-9f2a-6b1e5d3c8a04',
  idempotencyKey: '01a09777-e789-7c4d-9f2a-6b1e5d3c8a04:deposit',
}
const RCPT_0693 = '01a09776-1111-7000-8000-000000000693'
const PRESSED_AT = new Date('2026-09-12T21:13:32.681Z')

describe('DOS-136 — the retry of a banking intent is byte-identical to the first press', () => {
  it('banks at the instant the intent was made, not the instant the call is built', () => {
    const intent = depositIntent([RCPT_0693], 'DEP-QA-034-ACC', PRESSED_AT)
    expect(depositBody(intent, META).depositedAt).toBe('2026-09-12T21:13:32.681Z')
    expect(depositBody(intent, META)).toEqual(depositBody(intent, META))
  })

  it('returns a cheque at the instant the intent was made', () => {
    const intent = bounceIntent(RCPT_0693, 'Funds insufficient', 59_000, PRESSED_AT)
    expect(bounceBody(intent, META).bouncedAt).toBe('2026-09-12T21:13:32.681Z')
    expect(bounceBody(intent, META)).toEqual(bounceBody(intent, META))
  })

  it('keeps every line id a surface has already made, and makes one for a new line', () => {
    let next = 0
    const make = (): string => `id-${String(++next)}`
    const first = keepIds({}, ['line-a', 'line-b'], make)
    expect(first).toEqual({ 'line-a': 'id-1', 'line-b': 'id-2' })
    // The same press again: the same ids, so the request under the spent key is the same request.
    expect(keepIds(first, ['line-a', 'line-b'], make)).toEqual(first)
    // A line the reader has just added gets its own id; the ones already made do not move.
    expect(keepIds(first, ['line-a', 'line-b', 'line-c'], make)).toEqual({
      'line-a': 'id-1',
      'line-b': 'id-2',
      'line-c': 'id-3',
    })
  })
})

describe('DOS-136 — a write whose reply never arrived is read back before the reader acts again', () => {
  it('counts a lost reply and a failed service as unknown, and a refusal as answered', () => {
    expect(outcomeUnknown({ kind: 'network' })).toBe(true)
    expect(outcomeUnknown({ kind: 'server' })).toBe(true)
    expect(outcomeUnknown({ kind: 'conflict' })).toBe(false)
    expect(outcomeUnknown({ kind: 'validation' })).toBe(false)
    expect(outcomeUnknown(undefined)).toBe(false)
  })
})

/**
 * DOS-141 — "Cheque returned" with an empty reason sent a POST and came back 400 "Input validation
 * failed". The bank's own words are what the desk needs to type, and the dialog says so before it
 * sends anything.
 */
describe('DOS-141 — a bounce with no reason is refused on the device, not by a 400', () => {
  it('asks for the reason while the field is empty, and is satisfied by real words', () => {
    expect(bounceProblem('')).toBe('needsReason')
    expect(bounceProblem('   ')).toBe('needsReason')
    expect(bounceProblem('Funds insufficient')).toBeNull()
  })
})
