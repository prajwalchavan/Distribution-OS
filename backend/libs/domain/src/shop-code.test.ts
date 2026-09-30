import { describe, expect, it } from 'vitest'
import { isShopCode, normalizeShopCode, SHOP_CODE_ALPHABET } from './shop-code.js'

describe('the shop code', () => {
  it('is drawn from 31 characters, none of them 0, O, 1, I or L', () => {
    expect(SHOP_CODE_ALPHABET).toHaveLength(31)
    for (const c of ['0', 'O', '1', 'I', 'L']) expect(SHOP_CODE_ALPHABET).not.toContain(c)
  })

  it('is written XXXX-XXXX', () => {
    expect(isShopCode('K7MQ-4P2X')).toBe(true)
    expect(isShopCode('K7MQ4P2X')).toBe(false)
    expect(isShopCode('K7MQ-4P2O')).toBe(false)
  })

  it('reads what a person typed, forgiving case, spaces and dashes', () => {
    expect(normalizeShopCode('k7mq 4p2x')).toBe('K7MQ-4P2X')
    expect(normalizeShopCode(' K7MQ4P2X ')).toBe('K7MQ-4P2X')
    expect(normalizeShopCode('k7mq-4p2x')).toBe('K7MQ-4P2X')
  })

  it('never guesses a character that is not in a code', () => {
    expect(normalizeShopCode('K7MQ-4P20')).toBeNull()
    expect(normalizeShopCode('K7MQ-4P2')).toBeNull()
    expect(normalizeShopCode('')).toBeNull()
  })
})
