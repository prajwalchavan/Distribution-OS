/**
 * DOS-110 — the console had a clock of its own for what a support request IS.
 *
 * A window is counted from the moment it was ASKED for, so a four-hour ask made yesterday can never
 * be opened (`tenancy.support.approve` answers 409 `request_expired`). The wire nevertheless called
 * it `requested`, so this app carried `askLapsed()` — `requestedAt + requestedHours <= Date.now()` —
 * and every register, panel and count had to remember to use it. The server now says `lapsed`
 * itself, on both services, from one derivation, and the console reads the word it is given.
 *
 * `grantChip` is what a row looks like, from the row alone: no clock, no second rule. The labels are
 * this app's own catalogue, so a chip can never carry an English literal.
 */
import { describe, expect, it } from 'vitest'

import { strings } from '../strings'
import { grantChip } from './ui'

const catalogue: Readonly<Record<string, string>> = strings
const word = (value: string): string => catalogue[`word.${value}`] ?? value
const words = { openNow: catalogue['p6.openNow'] ?? 'Open now', word }

describe('DOS-110: a support grant’s chip is read from the server’s own status', () => {
  it('reads the status with no clock argument', () => {
    expect(grantChip({ status: 'lapsed', active: false }, words)).toEqual({
      label: 'Lapsed, no answer',
      family: 'neutral',
      solid: false,
    })
    expect(grantChip({ status: 'requested', active: false }, words)).toEqual({
      label: 'Waiting for their owner',
      family: 'clay',
      solid: false,
    })
    expect(grantChip({ status: 'approved', active: true }, words)).toEqual({
      label: 'Open now',
      family: 'moss',
      solid: true,
    })
    expect(grantChip({ status: 'rejected', active: false }, words)).toEqual({
      label: 'Refused',
      family: 'brick',
      solid: false,
    })
    expect(grantChip({ status: 'revoked', active: false }, words)).toEqual({
      label: 'Handed back',
      family: 'neutral',
      solid: false,
    })
    expect(grantChip({ status: 'expired', active: false }, words)).toEqual({
      label: 'Closed',
      family: 'neutral',
      solid: false,
    })
  })

  it('has one word for a lapsed ask, in the shared vocabulary every status reads from', () => {
    expect(catalogue['word.lapsed']).toBe('Lapsed, no answer')
    // The old screen-specific key is gone: a status word belongs with the other status words.
    expect(catalogue['p6.lapsed']).toBeUndefined()
  })
})
