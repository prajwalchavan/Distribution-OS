/**
 * DOS-400 — what the shop's page sends is what the contract takes, and the first password it makes
 * passes the rules every login shares. Each payload is parsed with the contract's OWN input schema.
 */
import {
  GiveShopSignInInput,
  PasswordSchema,
  ShopSignInPasswordInput,
  ShopSignInStopInput,
} from '@dos/contracts'
import { describe, expect, it } from 'vitest'

import { SHOP_SIGN_IN_STRINGS } from './strings'
import {
  firstPassword,
  givePayload,
  hasMobile,
  newGiveIntent,
  passwordPayload,
  stopPayload,
  toMobile,
} from './sign-in-forms'

const shopId = '01a0d0c5-0000-7000-8000-000000000001'
const key = '01a0d0c5-0000-7000-8000-000000000002'

describe('the shop sign-in forms', () => {
  it('reads a mobile number however the desk typed it', () => {
    expect(toMobile('98765 43210')).toBe('+919876543210')
    expect(toMobile('+91 98765-43210')).toBe('+919876543210')
    expect(toMobile('09876543210')).toBe('+919876543210')
    expect(toMobile('919876543210')).toBe('+919876543210')
    expect(toMobile('2512345678')).toBeNull()
    expect(toMobile('98765')).toBeNull()
    expect(hasMobile('+919876543210')).toBe(true)
    expect(hasMobile('')).toBe(false)
    expect(hasMobile('+912512345678')).toBe(false)
  })

  it('makes a first password the rules accept, different every time', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 200; i += 1) {
      const password = firstPassword()
      expect(PasswordSchema.safeParse(password).success, password).toBe(true)
      expect(password).toMatch(/^[a-z]{5}[2-9]{4}$/)
      seen.add(password)
    }
    expect(seen.size).toBeGreaterThan(190)
  })

  it('sends payloads the contract takes, with the mobile only when the shop had none', () => {
    const withPhone = givePayload(shopId, newGiveIntent('+919876543210'), key)
    expect(GiveShopSignInInput.safeParse(withPhone).success).toBe(true)
    expect(withPhone.phone).toBe('+919876543210')
    const without = givePayload(shopId, newGiveIntent(null), key)
    expect(GiveShopSignInInput.safeParse(without).success).toBe(true)
    expect(without).not.toHaveProperty('phone')
    expect(
      ShopSignInPasswordInput.safeParse(passwordPayload(shopId, 'kpmtr4827', key)).success,
    ).toBe(true)
    expect(ShopSignInStopInput.safeParse(stopPayload(shopId, key)).success).toBe(true)
  })

  it('keeps one intent for a retry: the same ids and the same password', () => {
    const intent = newGiveIntent(null)
    expect(givePayload(shopId, intent, key)).toEqual(givePayload(shopId, intent, key))
  })

  it('never names membership, identity, tenant, link or role on the screen', () => {
    for (const [keyName, text] of Object.entries(SHOP_SIGN_IN_STRINGS)) {
      expect(text, keyName).not.toMatch(/\b(membership|identity|tenant|link|role)s?\b/i)
    }
  })
})
