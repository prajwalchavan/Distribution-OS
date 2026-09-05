import { describe, expect, it } from 'vitest'
import { isUuid, uuidv7, uuidv7Time } from './ids.js'

describe('uuidv7', () => {
  it('produces valid, time-ordered ids', () => {
    const a = uuidv7(1_700_000_000_000)
    const b = uuidv7(1_700_000_000_000)
    const c = uuidv7(1_700_000_000_001)
    expect(isUuid(a)).toBe(true)
    expect(a < b).toBe(true)
    expect(b < c).toBe(true)
    expect(a.charAt(14)).toBe('7')
    expect(uuidv7Time(c)).toBe(1_700_000_000_001)
  })

  it('accepts an injected random source', () => {
    const id = uuidv7(0, (n) => new Uint8Array(n))
    expect(isUuid(id)).toBe(true)
  })
})
