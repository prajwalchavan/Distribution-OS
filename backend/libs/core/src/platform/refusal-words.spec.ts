/**
 * DOS-141 — a refusal names a day and a time the way a desk says them, never a UTC ISO string.
 *
 * The walk's own sentences: a locked document read "(until 2026-10-12T00:00:00.000Z)" and a load sheet
 * "was already approved by a1cbd424-d568-7ccb-b5cc-b049e8ac2063".
 */
import { describe, expect, it } from 'vitest'

import { istDateWord, istDay, istMoment, personWord } from './refusal-words.js'

describe('refusal words (DOS-141)', () => {
  it('reads an instant as its IST day and clock time', () => {
    // 2026-09-13T10:50:00Z is 4:20 pm in Kalyan.
    expect(istMoment('2026-09-13T10:50:00.000Z')).toBe('13 Sep, 4:20 pm')
    expect(istDay('2026-09-13T10:50:00.000Z')).toBe('13 Sep')
  })

  it('moves an instant to the IST day it happened on, not the UTC one', () => {
    // 2026-10-11T18:30:00Z is midnight on the 12th in IST: the lock the walk saw as "2026-10-12T00:00".
    expect(istMoment('2026-10-11T18:30:00.000Z')).toBe('12 Oct, 12:00 am')
    expect(istMoment(new Date('2026-09-12T21:13:32.681Z'))).toBe('13 Sep, 2:43 am')
  })

  it('reads a stored IST calendar date as a day', () => {
    expect(istDateWord('2026-09-13')).toBe('13 Sep')
  })

  it('never prints an id or an empty name where a person belongs', () => {
    expect(personWord('Vikas Kadam')).toBe('Vikas Kadam')
    expect(personWord(null)).toBe('someone else')
    expect(personWord('  ')).toBe('someone else')
  })

  it('says so when there is no time at all, rather than printing Invalid Date', () => {
    expect(istMoment(null)).toBe('an unknown time')
    expect(istDay(undefined)).toBe('an unknown day')
    expect(istDateWord(null)).toBe('an unknown day')
  })
})
